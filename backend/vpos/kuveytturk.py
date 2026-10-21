"""Kuveyt Türk güvenli ortak ödeme (hosted).

Kart bu akışta bize gelmez. Sunucu OAuth2 client_credentials (scope public)
ile ``secureCommonPaymentToken`` alır; müşteri ``value.url`` adresine tam
sayfa gider. Dönüş parametresi kanıt değildir. Sonuç
``getMerchantOrderDetail`` (gerekirse ``orderDetailWithPaymentId``) ile
doğrulanır.

Gateway ve token uçları sabittir; ayardan URL okunmaz.

hashData bileşimi API Market katalogunda yok. Legacy formül yalnız
``hashed_password`` / ``token_hash`` / ``query_hash`` içindedir.
"""
from __future__ import annotations

import base64
import hashlib
import logging
import re
import time
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, Mapping, Optional
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

from safe_error import mask_sensitive_text

from .base import VposAdapter, VposStartError, register
from .http import open_async_client

logger = logging.getLogger("vpos.kuveytturk")

FAMILY = "kuveytturk"
MODEL = "secure_partner"

# API Market test tabanı (resmi SDK varsayılanı) ve canlı kimlik keşfi.
# Kullanıcıdan adres alınmaz.
TEST_TOKEN_URL = "https://idprep.kuveytturk.com.tr/api/connect/token"
LIVE_TOKEN_URL = "https://prod-kuveytturk-identityserver.kuveytturk.com.tr/connect/token"
TEST_GATEWAY = "https://apitest.kuveytturk.com.tr/prep"
LIVE_GATEWAY = "https://api.kuveytturk.com.tr"
TOKEN_PATH = "/v1/vpos/secureCommonPaymentToken"
ORDER_PATH = "/v1/vpos/getMerchantOrderDetail"
PAYMENT_PATH = "/v1/vpos/orderDetailWithPaymentId"
SCOPE = "public"
CURRENCY_CODE = "0949"
TRANSACTION_TYPE = "Sale"
TOKEN_TYPE = "PaymentWithLink"
TIMEOUT = 20.0
_TOKEN_CACHE_MAX_S = 120.0
_IST = ZoneInfo("Europe/Istanbul")

# Katalog sayısal durum tablosu yayınlamıyor. KTPay örnek yanıtında
# OrderStatus "Satış (1)" ve TransactionStatus "Basarılı (1)" satış onaydır.
# lastOrderStatus "İptal (6)" sonradan iptaldir.
ORDER_STATUS_SALE = 1
TRANSACTION_STATUS_OK = 1
_CANCEL_LAST = frozenset({2, 6})
_TRY_CODES = frozenset({"TRY", "TL", "949", "0949"})
_MASKED_PAN = re.compile(r"^\d{6}\*{4,}\d{4}$")
_HOST_SUFFIX = ".kuveytturk.com.tr"

# (mode, client_id, secret_sha256) -> (access_token, monotonic_expiry)
_TOKEN_CACHE: Dict[tuple, tuple] = {}


# ---------------------------------------------------------------------------
# hashData yer tutucu
# secureCommonPaymentToken ve getMerchantOrderDetail hashData birleşimi
# katalogda yazmıyor (örnek değer Base64-SHA1 görünümünde). Banka teyidi
# gelene kadar legacy formül yalnız bu üç fonksiyondadır. Çağıran kod
# formülü bilmez. Testler örnek Base64'e değil deterministikliğe bağlanır.
# TODO(kuveytturk-hash): banka formülü gelince yalnız bu fonksiyonlar değişir.
# Legacy: Base64(SHA1(MerchantId+MerchantOrderId+Amount+SuccessUrl+FailUrl
#         +UserName+Base64(SHA1(password, ISO-8859-9))))
# ---------------------------------------------------------------------------


def _sha1_b64(text: str) -> str:
    raw = text.encode("iso-8859-9")
    digest = hashlib.sha1(raw, usedforsecurity=False).digest()
    return base64.b64encode(digest).decode("ascii")


def hashed_password(password: str) -> str:
    """TODO(kuveytturk-hash): Base64(SHA1(password, ISO-8859-9)). Banka teyidi yok."""
    return _sha1_b64(password or "")


def token_hash(
    merchant_id: str,
    merchant_order_id: str,
    amount: str,
    success_url: str,
    fail_url: str,
    user_name: str,
    password: str,
) -> str:
    """TODO(kuveytturk-hash): secureCommonPaymentToken hashData yer tutucusu."""
    material = f"{merchant_id}{merchant_order_id}{amount}{success_url}{fail_url}{user_name}{hashed_password(password)}"
    return _sha1_b64(material)


def query_hash(merchant_id: str, merchant_order_id: str, user_name: str, password: str) -> str:
    """TODO(kuveytturk-hash): sipariş sorgu hashData yer tutucusu.

    Katalog formülü yok. Token hash'inden ayrı durur; SuccessUrl/FailUrl
    ve tutar bu birleşime girmez. Banka teyidi gelince yalnız burası değişir.
    """
    material = f"{merchant_id}{merchant_order_id}{user_name}{hashed_password(password)}"
    return _sha1_b64(material)


def clear_token_cache() -> None:
    _TOKEN_CACHE.clear()


def format_amount_kurus(amount: Any) -> str:
    """Intent tutarını kuruş dizesine çevirir. Yuvarlama yok."""
    text = str(amount if amount is not None else "").strip().replace(" ", "").replace(",", ".")
    if not text:
        raise ValueError("amount")
    try:
        dec = Decimal(text)
    except (InvalidOperation, ValueError) as exc:
        raise ValueError("amount") from exc
    try:
        quantized = dec.quantize(Decimal("0.01"))
    except InvalidOperation as exc:
        raise ValueError("amount") from exc
    if dec != quantized or dec <= 0:
        raise ValueError("amount")
    kurus = dec * Decimal(100)
    if kurus != kurus.to_integral_value():
        raise ValueError("amount")
    return str(int(kurus))


def redact(text: Any, secrets: list, limit: int = 120) -> str:
    raw = mask_sensitive_text(text)
    for secret in secrets:
        value = str(secret or "")
        if len(value) >= 4:
            raw = raw.replace(value, "[mask]")
    raw = re.sub(r"Bearer\s+\S+", "Bearer [mask]", raw, flags=re.IGNORECASE)
    raw = re.sub(r"\s+", " ", raw).strip()
    return raw[:limit]


def gateway_base(mode: str) -> str:
    return TEST_GATEWAY if str(mode or "").strip().lower() == "test" else LIVE_GATEWAY


def token_url(mode: str) -> str:
    return TEST_TOKEN_URL if str(mode or "").strip().lower() == "test" else LIVE_TOKEN_URL


def _clip(value: Any, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _lookup(data: Mapping[str, Any], *names: str) -> Any:
    if not isinstance(data, Mapping):
        return None
    for name in names:
        if name in data:
            return data[name]
    lowered = {str(key).lower(): value for key, value in data.items()}
    for name in names:
        if name.lower() in lowered:
            return lowered[name.lower()]
    return None


def _flag(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"true", "1"}


def _code(value: Any) -> str:
    return str(value or "").strip()


_LOG_CODES = frozenset({
    "declined", "amount_mismatch", "currency_mismatch", "order_mismatch",
    "query_failed", "transport", "failed", "url", "http", "json", "magaza",
    "amount", "order", "return_url", "access_token", "response", "hash",
})


def _log_code(value: Any) -> str:
    """Logger'a yalnız bilinen kod veya 2-4 haneli banka kodu gider."""
    text = _code(value)[:40]
    if text in _LOG_CODES or re.fullmatch(r"\d{2,4}", text):
        return text
    return "failed"


def _ip(value: Any) -> str:
    text = str(value or "").strip()
    if not text or len(text) > 45 or any(ch in text for ch in " \r\n\t/\\"):
        return "127.0.0.1"
    return text


def _decimal(value: Any) -> Optional[Decimal]:
    if isinstance(value, Decimal):
        dec = value
    else:
        text = str(value if value is not None else "").strip().replace(" ", "").replace(",", ".")
        if not text:
            return None
        try:
            dec = Decimal(text)
        except (InvalidOperation, ValueError):
            return None
    try:
        quantized = dec.quantize(Decimal("0.01"))
    except InvalidOperation:
        return None
    if dec != quantized:
        return None
    return quantized


def _status_code(value: Any) -> Optional[int]:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, Decimal) and value == value.to_integral_value():
        return int(value)
    text = str(value).strip()
    if not text:
        return None
    if re.fullmatch(r"-?\d+", text):
        return int(text)
    match = re.search(r"\((\d+)\)\s*$", text)
    if match:
        return int(match.group(1))
    folded = text.casefold()
    if "iptal" in folded:
        return 6
    if "iade" in folded:
        return 2
    if "satış" in folded or "satis" in folded:
        return ORDER_STATUS_SALE
    if "başar" in folded or "basar" in folded:
        return TRANSACTION_STATUS_OK
    return None


def _currency_try(value: Any) -> bool:
    raw = str(value or "").strip().upper()
    if not raw:
        return True
    if raw in _TRY_CODES:
        return True
    if "0949" in raw or raw.endswith("(TRY)"):
        return True
    return False


def _zero(value: Any) -> bool:
    if value in (None, ""):
        return True
    dec = _decimal(value)
    return dec is not None and dec == 0


def _short_code(value: Any, limit: int = 32) -> str:
    text = re.sub(r"[^A-Za-z0-9]", "", "" if value is None else str(value))[:limit]
    digits = re.sub(r"\D", "", text)
    if len(digits) >= 13:
        return ""
    return text


def _masked_pan(row: Mapping[str, Any]) -> str:
    raw = str(_lookup(row, "cardNumber", "CardNumber") or "")
    if _MASKED_PAN.fullmatch(raw):
        return raw
    return ""


def _redirect_ok(url: str) -> bool:
    parsed = urlparse(url or "")
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not host or parsed.username or parsed.password:
        return False
    if host != "kuveytturk.com.tr" and not host.endswith(_HOST_SUFFIX):
        return False
    path = parsed.path or ""
    if "KTPay/SecurePayment" not in path or "SecurePaymentResult" in path:
        return False
    query = parse_qs(parsed.query)
    token = query.get("token") or query.get("Token") or []
    return bool(token and str(token[0]).strip())


def _rows(payload: Mapping[str, Any]) -> list:
    value = _lookup(payload or {}, "value", "Value")
    if isinstance(value, list):
        return [row for row in value if isinstance(row, Mapping)]
    if isinstance(value, Mapping):
        return [value]
    return []


def _find_row(payload: Mapping[str, Any], merchant_order_id: str) -> Optional[Mapping[str, Any]]:
    wanted = str(merchant_order_id or "")
    for row in _rows(payload):
        if str(_lookup(row, "merchantOrderId", "MerchantOrderId") or "") == wanted:
            return row
    return None


def _missing_decision(row: Mapping[str, Any]) -> bool:
    return _status_code(_lookup(row, "orderStatus", "OrderStatus")) is None and _status_code(
        _lookup(row, "transactionStatus", "TransactionStatus")
    ) is None


def _query_dates() -> tuple:
    today = datetime.now(_IST)
    start = today - timedelta(days=1)
    end = today + timedelta(days=1)
    return start.strftime("%d.%m.%Y"), end.strftime("%d.%m.%Y")


def _installment_count(intent: Mapping[str, Any]) -> int:
    raw = intent.get("installment")
    if raw in (None, ""):
        return 0
    try:
        number = int(raw)
    except (TypeError, ValueError):
        return 0
    if number <= 1:
        return 0
    if number > 12:
        return 0
    return number


def _verdict_base(intent: Mapping[str, Any], *, ok: bool, approved: bool, error: str, row: Optional[Mapping[str, Any]] = None, retryable: bool = False) -> Dict[str, Any]:
    bank = row or {}
    out = {
        "ok": bool(ok),
        "approved": bool(approved),
        "amount": "" if intent.get("amount") is None else str(intent.get("amount")),
        "currency": "TRY",
        "order_id": str(intent.get("order_id") or ""),
        "auth_code": _short_code(_lookup(bank, "provNumber", "ProvNumber", "authNumber", "AuthNumber")),
        "proc_return_code": _short_code(_lookup(bank, "responseCode", "ResponseCode"), 8),
        "md_status": "",
        "masked_pan": _masked_pan(bank),
        "error": error or "",
    }
    if retryable:
        out["retryable"] = True
    return out


def _approved(row: Mapping[str, Any]) -> bool:
    order_code = _status_code(_lookup(row, "orderStatus", "OrderStatus"))
    tx_code = _status_code(_lookup(row, "transactionStatus", "TransactionStatus"))
    last_code = _status_code(_lookup(row, "lastOrderStatus", "LastOrderStatus"))
    response = _code(_lookup(row, "responseCode", "ResponseCode"))
    if order_code != ORDER_STATUS_SALE or tx_code != TRANSACTION_STATUS_OK:
        return False
    if last_code in _CANCEL_LAST:
        return False
    if response not in ("", "00"):
        return False
    if not _zero(_lookup(row, "cancelAmount", "CancelAmount")):
        return False
    if not _zero(_lookup(row, "drawbackAmount", "DrawbackAmount")):
        return False
    return True


def _verdict(detail: Mapping[str, Any], intent: Mapping[str, Any]) -> Dict[str, Any]:
    """Sipariş sorgu yanıtı. Tutar daima intent tutarıdır. Kart alanı yazılmaz."""
    payload = detail or {}
    if not _flag(_lookup(payload, "success", "Success")):
        return _verdict_base(intent, ok=True, approved=False, error="declined")
    row = _find_row(payload, str(intent.get("order_id") or ""))
    if row is None:
        if _rows(payload):
            return _verdict_base(intent, ok=False, approved=False, error="order_mismatch")
        return _verdict_base(intent, ok=True, approved=False, error="declined")
    expected = str(intent.get("_merchant_id") or "").strip()
    merchant = _lookup(row, "merchantId", "MerchantId")
    if expected and merchant not in (None, ""):
        got = str(merchant).strip()
        if expected.isdigit():
            expected = str(int(expected))
        if got.isdigit():
            got = str(int(got))
        if got != expected:
            return _verdict_base(intent, ok=False, approved=False, error="order_mismatch", row=row)
    if not _currency_try(_lookup(row, "fec", "FEC", "currency", "Currency")):
        return _verdict_base(intent, ok=False, approved=False, error="currency_mismatch", row=row)
    paid = _decimal(_lookup(row, "firstAmount", "FirstAmount"))
    if paid is None:
        paid = _decimal(_lookup(row, "amount", "Amount"))
    intent_amount = _decimal(intent.get("amount"))
    if paid is None or intent_amount is None or paid != intent_amount:
        return _verdict_base(intent, ok=False, approved=False, error="amount_mismatch", row=row)
    if not _approved(row):
        return _verdict_base(intent, ok=True, approved=False, error="declined", row=row)
    return _verdict_base(intent, ok=True, approved=True, error="", row=row)


def _secret_list(config: Mapping[str, Any]) -> list:
    return [
        str(config.get("kt_password") or ""),
        str(config.get("api_client_secret") or ""),
        str(config.get("access_token") or ""),
    ]


def _cache_key(mode: str, client_id: str, secret: str) -> tuple:
    digest = hashlib.sha256((secret or "").encode("utf-8")).hexdigest()
    return (str(mode or "").strip().lower(), client_id, digest)


def _cache_get(key: tuple) -> str:
    item = _TOKEN_CACHE.get(key)
    if not item:
        return ""
    token, expiry = item
    if time.monotonic() >= expiry:
        _TOKEN_CACHE.pop(key, None)
        return ""
    return str(token or "")


def _cache_put(key: tuple, token: str, expires_in: Any) -> None:
    try:
        ttl = float(expires_in)
    except (TypeError, ValueError):
        ttl = 60.0
    ttl = min(max(ttl - 30.0, 0.0), _TOKEN_CACHE_MAX_S)
    if ttl <= 0 or not token:
        return
    now = time.monotonic()
    stale = [item for item, (_token, expiry) in _TOKEN_CACHE.items() if expiry <= now]
    for item in stale:
        _TOKEN_CACHE.pop(item, None)
    if len(_TOKEN_CACHE) > 64:
        _TOKEN_CACHE.clear()
    _TOKEN_CACHE[key] = (token, now + ttl)


async def _read_json(response: Any, _hidden: list) -> Dict[str, Any]:
    code = int(getattr(response, "status_code", 0) or 0)
    text = str(getattr(response, "text", "") or "")
    if code < 200 or code >= 300:
        raise VposStartError("token_failed", "http")
    stripped = text.lstrip()
    if not stripped or stripped[0] not in "{[":
        raise VposStartError("token_failed", "json")
    import json
    try:
        data = json.loads(text, parse_float=Decimal)
    except Exception:
        raise VposStartError("token_failed", "json") from None
    if not isinstance(data, dict):
        raise VposStartError("token_failed", "response")
    return data


async def _post(client: Any, url: str, *, data: Optional[dict] = None, content: Optional[bytes] = None, headers: Mapping[str, str], hidden: list) -> Dict[str, Any]:
    async def _call(http: Any) -> Dict[str, Any]:
        response = await http.post(url, data=data, content=content, headers=dict(headers), follow_redirects=False)
        return await _read_json(response, hidden)

    if client is not None:
        return await _call(client)
    async with open_async_client(timeout=TIMEOUT) as owned:
        return await _call(owned)


async def _gateway_token(config: Mapping[str, Any], client: Any = None) -> str:
    """client_credentials, scope public. Bellekte en fazla iki dakika."""
    mode = str(config.get("mode") or "test").strip().lower()
    client_id = str(config.get("api_client_id") or "").strip()
    secret = str(config.get("api_client_secret") or "")
    hidden = _secret_list(config)
    if mode not in ("test", "live") or not client_id or not secret:
        raise VposStartError("token_failed", "magaza")
    key = _cache_key(mode, client_id, secret)
    cached = _cache_get(key)
    if cached:
        return cached
    try:
        payload = await _post(
            client,
            token_url(mode),
            data={
                "grant_type": "client_credentials",
                "client_id": client_id,
                "client_secret": secret,
                "scope": SCOPE,
            },
            headers={"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"},
            hidden=hidden,
        )
    except VposStartError:
        raise
    except Exception:
        raise VposStartError("token_failed", "transport") from None
    access = str(payload.get("access_token") or payload.get("accessToken") or "").strip()
    kind = str(payload.get("token_type") or payload.get("tokenType") or "Bearer").strip().lower()
    if not access or kind != "bearer":
        raise VposStartError("token_failed", "access_token")
    _cache_put(key, access, payload.get("expires_in") if payload.get("expires_in") is not None else payload.get("expiresIn"))
    return access


def _identity(config: Mapping[str, Any]) -> tuple:
    merchant_id = str(config.get("merchant_id") or "").strip()
    customer_id = str(config.get("customer_id") or "").strip()
    user_name = str(config.get("api_username") or "").strip()
    password = str(config.get("kt_password") or "")
    if not merchant_id.isdigit() or not customer_id.isdigit() or not user_name or not password:
        raise VposStartError("token_failed", "magaza")
    return str(int(merchant_id)), str(int(customer_id)), user_name, password


def _return_urls(ctx: Mapping[str, Any]) -> tuple:
    ctx = ctx or {}
    success = str(ctx.get("ok_url") or ctx.get("success_url") or "").strip()
    fail = str(ctx.get("fail_url") or "").strip()
    if not success.startswith("https://") or not fail.startswith("https://"):
        raise VposStartError("token_failed", "return_url")
    if "/api/vpos/kuveytturk/return/" not in success or "/api/vpos/kuveytturk/return/" not in fail:
        raise VposStartError("token_failed", "return_url")
    return success, fail


async def _query(config: Mapping[str, Any], path: str, body: Mapping[str, Any], client: Any, access: str) -> Dict[str, Any]:
    import json
    hidden = _secret_list(config) + [access]
    raw = json.dumps({"request": body}, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    try:
        return await _post(
            client,
            gateway_base(str(config.get("mode") or "test")) + path,
            content=raw,
            headers={
                "Authorization": f"Bearer {access}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            hidden=hidden,
        )
    except VposStartError:
        raise
    except Exception:
        raise VposStartError("token_failed", "transport") from None


async def fetch_order_detail(config: Mapping[str, Any], merchant_order_id: str, client: Any = None) -> Dict[str, Any]:
    """getMerchantOrderDetail. Karar alanı yoksa ve paymentId varsa ikinci sorgu."""
    merchant_id, customer_id, user_name, password = _identity(config)
    order_id = str(merchant_order_id or "").strip()
    if not order_id:
        raise VposStartError("token_failed", "order")
    start, end = _query_dates()
    access = await _gateway_token(config, client=client)
    body = {
        "merchantId": int(merchant_id),
        "customerId": int(customer_id),
        "userName": user_name,
        "orderId": "",
        "merchantOrderId": order_id,
        "hashData": query_hash(merchant_id, order_id, user_name, password),
        "startDate": start,
        "endDate": end,
    }
    payload = await _query(config, ORDER_PATH, body, client, access)
    row = _find_row(payload, order_id)
    payment_id = ""
    if row is not None:
        payment_id = str(_lookup(row, "paymentId", "PaymentId") or "").strip()
    if row is not None and _missing_decision(row) and payment_id.isdigit() and payment_id != "0":
        extra_body = {
            "merchantId": int(merchant_id),
            "customerId": int(customer_id),
            "userName": user_name,
            "orderId": 0,
            "merchantOrderId": order_id,
            "startDate": None,
            "endDate": None,
            "hashData": query_hash(merchant_id, order_id, user_name, password),
            "amount": 0,
            "okUrl": "",
            "failUrl": "",
            "paymentId": int(payment_id),
            "parentPaymentId": 0,
        }
        extra = await _query(config, PAYMENT_PATH, extra_body, client, access)
        if _find_row(extra, order_id) is not None:
            return extra
    return payload


async def create_payment_token(config: Mapping[str, Any], intent: Mapping[str, Any], ctx: Mapping[str, Any], client: Any = None) -> str:
    """secureCommonPaymentToken. Dönüş: bankanın ödeme sayfası URL'i."""
    intent_id = str((intent or {}).get("_id") or "")
    merchant_id, _customer_id, user_name, password = _identity(config)
    hidden = _secret_list(config)
    try:
        amount = format_amount_kurus((intent or {}).get("amount"))
    except ValueError as exc:
        raise VposStartError("token_failed", "amount") from exc
    order_id = str((intent or {}).get("order_id") or "").strip()
    if not order_id:
        raise VposStartError("token_failed", "order")
    success_url, fail_url = _return_urls(ctx or {})
    ip = _ip((ctx or {}).get("user_ip"))
    try:
        digest = token_hash(merchant_id, order_id, amount, success_url, fail_url, user_name, password)
    except (ValueError, UnicodeEncodeError):
        raise VposStartError("token_failed", "hash") from None
    request = {
        "merchantId": int(merchant_id),
        "userName": user_name,
        "amount": amount,
        "merchantOrderId": order_id,
        "currencyCode": CURRENCY_CODE,
        "transactionType": TRANSACTION_TYPE,
        "TokenType": TOKEN_TYPE,
        "successUrl": success_url,
        "failUrl": fail_url,
        "hashData": digest,
        "installmentCount": _installment_count(intent or {}),
        "clientIp": ip,
        "cardHolderIp": ip,
    }
    email = _clip((ctx or {}).get("email"), 100)
    if email and "@" in email and " " not in email and "\n" not in email:
        request["email"] = email
    label = re.sub(r"[\r\n\t]+", " ", _clip((ctx or {}).get("basket_label"), 80)).strip()
    if label:
        request["orderDescription"] = label
    import json
    access = await _gateway_token(config, client=client)
    hidden = hidden + [access, digest]
    raw = json.dumps({"request": request}, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    try:
        payload = await _post(
            client,
            gateway_base(str(config.get("mode") or "test")) + TOKEN_PATH,
            content=raw,
            headers={
                "Authorization": f"Bearer {access}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            hidden=hidden,
        )
    except VposStartError as exc:
        safe = _log_code(exc.detail)
        exc.detail = safe
        logger.warning("vpos kuveytturk start id=%s family=%s code=%s", intent_id, FAMILY, safe)
        raise
    except Exception:
        logger.warning("vpos kuveytturk start id=%s family=%s code=%s", intent_id, FAMILY, "transport")
        raise VposStartError("token_failed", "transport") from None
    value = _lookup(payload, "value", "Value") or {}
    if not isinstance(value, Mapping):
        value = {}
    response_code = _code(_lookup(value, "responseCode", "ResponseCode") or _lookup(payload, "responseCode", "ResponseCode"))
    page = str(_lookup(value, "url", "Url") or "").strip()
    ok = _flag(_lookup(payload, "success", "Success")) and response_code == "00" and _redirect_ok(page)
    if not ok:
        if not _flag(_lookup(payload, "success", "Success")) or response_code != "00":
            code = _log_code(response_code or "failed")
        else:
            code = "url"
        logger.warning("vpos kuveytturk start id=%s family=%s code=%s", intent_id, FAMILY, code)
        raise VposStartError("token_failed", code)
    return page


class KuveytTurkAdapter(VposAdapter):
    family = FAMILY
    model = MODEL

    def build_3d_form(self, config: Mapping[str, Any], intent: Mapping[str, Any], return_urls: Mapping[str, Any]) -> Dict[str, Any]:
        raise NotImplementedError

    def verify_callback(self, config: Mapping[str, Any], intent: Mapping[str, Any], form: Mapping[str, Any]) -> Dict[str, Any]:
        """Tarayıcı dönüşü kanıt değildir."""
        return _verdict_base(intent, ok=False, approved=False, error="not_order_detail")

    async def start(self, config: Mapping[str, Any], intent: Mapping[str, Any], ctx: Mapping[str, Any], client: Any = None) -> Dict[str, Any]:
        url = await create_payment_token(config, intent, ctx, client=client)
        return {"kind": "redirect", "url": url}

    async def confirm(self, config: Mapping[str, Any], intent: Mapping[str, Any], payload: Mapping[str, Any], client: Any = None) -> Dict[str, Any]:
        """Dönüş gövdesi okunmaz. Karar sipariş sorgusundadır."""
        intent_id = str((intent or {}).get("_id") or "")
        enriched = dict(intent or {})
        enriched["_merchant_id"] = str((config or {}).get("merchant_id") or "").strip()
        try:
            detail = await fetch_order_detail(config, str(enriched.get("order_id") or ""), client=client)
        except Exception:
            logger.warning("vpos kuveytturk confirm id=%s family=%s code=%s", intent_id, FAMILY, "query_failed")
            return _verdict_base(intent, ok=False, approved=False, error="query_failed", retryable=True)
        verdict = _verdict(detail, enriched)
        code = _log_code(verdict.get("proc_return_code") or verdict.get("error") or "")
        logger.info("vpos kuveytturk confirm id=%s family=%s code=%s", intent_id, FAMILY, code)
        return verdict


ADAPTER = KuveytTurkAdapter()
register(ADAPTER)
