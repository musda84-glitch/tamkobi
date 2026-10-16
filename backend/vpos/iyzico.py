"""iyzico Checkout Form (CF).

Kimlik: IYZWSv2. signature = hex(HMAC_SHA256(secret_key, rnd + uri_path + body_json)).
Authorization = "IYZWSv2 " + base64("apiKey:"+api_key+"&randomKey:"+rnd+"&signature:"+signature).
body_json bir kez üretilir; aynı dizi hem imzalanır hem gönderilir.

Ödeme kararı sunucunun yaptığı retrieve yanıtıdır. Tarayıcının callback
token'ı tek başına ödendi yazdırmaz.

Retrieve imzası (resmi yanıt imzası, Checkout Form detail):
paymentStatus:paymentId:currency:basketId:conversationId:paidPrice:price:token
Fiyat alanlarında sondaki sıfırlar düşülür. Ayracı ":".
https://docs.iyzico.com/en/advanced/response-signature-validation
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import re
import secrets
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, Mapping, Optional
from urllib.parse import urlparse

from safe_error import mask_sensitive_text

from .base import VposAdapter, VposStartError, register
from .http import open_async_client

logger = logging.getLogger("vpos.iyzico")

FAMILY = "iyzico"
MODEL = "checkout_form"
TEST_BASE = "https://sandbox-api.iyzipay.com"
LIVE_BASE = "https://api.iyzipay.com"
INIT_PATH = "/payment/iyzipos/checkoutform/initialize/auth/ecom"
RETRIEVE_PATH = "/payment/iyzipos/checkoutform/auth/ecom/detail"
TIMEOUT = 20.0

# Checkout Form örnek entegrasyondaki alıcı kimliği. Yalnız test modunda,
# ctx kimlik vermezse kullanılır. Canlıda yerine konmaz.
DOCUMENTED_TEST_IDENTITY = "74300864791"

# CF retrieve yanıt imzası alan sırası (dokümandaki tablo).
RETRIEVE_SIGNATURE_FIELDS = (
    "paymentStatus",
    "paymentId",
    "currency",
    "basketId",
    "conversationId",
    "paidPrice",
    "price",
    "token",
)
_PRICE_FIELDS = frozenset({"paidPrice", "price"})


def base_url_for_mode(mode: str) -> str:
    return TEST_BASE if str(mode or "").strip().lower() == "test" else LIVE_BASE


def request_signature(secret_key: str, rnd: str, uri_path: str, body_json: str) -> str:
    payload = f"{rnd}{uri_path}{body_json or ''}"
    return hmac.new((secret_key or "").encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()


def authorization_header(api_key: str, rnd: str, signature: str) -> str:
    raw = f"apiKey:{api_key}&randomKey:{rnd}&signature:{signature}"
    encoded = base64.b64encode(raw.encode("utf-8")).decode("ascii")
    return "IYZWSv2 " + encoded


def strip_trailing_zeros(value: Any) -> str:
    """iyzico yanıt imzasında fiyat: 10.50 → 10.5, 10.00 → 10."""
    if isinstance(value, Decimal):
        text = format(value, "f")
    else:
        text = "" if value is None else str(value).strip()
    if not text:
        return ""
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text


def response_signature(secret_key: str, payload: Mapping[str, Any]) -> str:
    parts = []
    for name in RETRIEVE_SIGNATURE_FIELDS:
        value = payload.get(name)
        if name in _PRICE_FIELDS:
            parts.append(strip_trailing_zeros(value))
        else:
            parts.append("" if value is None else str(value))
    message = ":".join(parts)
    return hmac.new((secret_key or "").encode("utf-8"), message.encode("utf-8"), hashlib.sha256).hexdigest()


def signatures_equal(expected: str, received: str) -> bool:
    left = (expected or "").strip().lower()
    right = (received or "").strip().lower()
    if not left or not right or len(left) != len(right):
        return False
    return hmac.compare_digest(left, right)


def redact(text: Any, secrets_list: list, limit: int = 120) -> str:
    raw = mask_sensitive_text(text)
    for secret in secrets_list:
        value = str(secret or "")
        if len(value) >= 4:
            raw = raw.replace(value, "[mask]")
    raw = re.sub(r"\s+", " ", raw).strip()
    return raw[:limit]


def _money(value: Any) -> Optional[Decimal]:
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


def format_amount(value: Any) -> str:
    dec = _money(value)
    if dec is None or dec <= 0:
        raise ValueError("amount")
    return f"{dec:.2f}"


def dumps(body: Mapping[str, Any]) -> str:
    return json.dumps(body, separators=(",", ":"), ensure_ascii=False)


def _clip(value: Any, limit: int) -> str:
    return str(value or "").strip()[:limit]


def _person(name: str) -> tuple:
    parts = [part for part in (name or "").split() if part]
    if not parts:
        return "Musteri", "Firma"
    if len(parts) == 1:
        return parts[0][:40], "Firma"
    return parts[0][:40], " ".join(parts[1:])[:40]


def _host_ok(url: str) -> bool:
    parsed = urlparse(url or "")
    host = (parsed.hostname or "").lower()
    if parsed.scheme != "https" or not host or parsed.username or parsed.password:
        return False
    return host == "iyzipay.com" or host.endswith(".iyzipay.com")


def _verdict(intent: Mapping[str, Any], *, ok: bool, approved: bool, error: str, retryable: bool = False) -> Dict[str, Any]:
    out = {
        "ok": bool(ok),
        "approved": bool(approved),
        "amount": "" if intent.get("amount") is None else str(intent.get("amount")),
        "currency": "TRY",
        "order_id": str(intent.get("order_id") or ""),
        "auth_code": "",
        "proc_return_code": "",
        "md_status": "",
        "error": error or "",
    }
    if retryable:
        out["retryable"] = True
    return out


def build_initialize_body(config: Mapping[str, Any], intent: Mapping[str, Any], ctx: Mapping[str, Any]) -> Dict[str, Any]:
    ctx = ctx or {}
    mode = str(config.get("mode") or "test").strip().lower()
    amount = format_amount(intent.get("amount"))
    given_name, surname = _person(str(ctx.get("name") or ""))
    email = _clip(ctx.get("email") or "odeme@example.com", 100) or "odeme@example.com"
    phone = _clip(ctx.get("phone") or "+905350000000", 20) or "+905350000000"
    address = _clip(ctx.get("address") or "Adres belirtilmedi", 200) or "Adres belirtilmedi"
    city = _clip(ctx.get("city") or "Istanbul", 40) or "Istanbul"
    country = _clip(ctx.get("country") or "Turkey", 40) or "Turkey"
    ip = _clip(ctx.get("user_ip") or "127.0.0.1", 39) or "127.0.0.1"
    identity = _clip(ctx.get("identity_number"), 11)
    if not identity and mode == "test":
        identity = DOCUMENTED_TEST_IDENTITY
    if not identity or (mode != "test" and identity == DOCUMENTED_TEST_IDENTITY):
        raise ValueError("identity")
    contact = _clip(f"{given_name} {surname}", 60)
    label = _clip(ctx.get("basket_label") or "Test odemesi", 80) or "Test odemesi"
    intent_id = str(intent.get("_id") or "")
    order_id = str(intent.get("order_id") or "")
    callback = str(ctx.get("callback_url") or "").strip()
    return {
        "locale": "tr",
        "conversationId": intent_id,
        "price": amount,
        "paidPrice": amount,
        "currency": "TRY",
        "basketId": order_id,
        "paymentGroup": "PRODUCT",
        "callbackUrl": callback,
        "buyer": {
            "id": ("BY" + re.sub(r"[^A-Za-z0-9]", "", intent_id))[:20] or "BY1",
            "name": given_name,
            "surname": surname,
            "identityNumber": identity,
            "email": email,
            "gsmNumber": phone,
            "registrationAddress": address,
            "city": city,
            "country": country,
            "ip": ip,
        },
        "shippingAddress": {
            "address": address,
            "contactName": contact,
            "city": city,
            "country": country,
        },
        "billingAddress": {
            "address": address,
            "contactName": contact,
            "city": city,
            "country": country,
        },
        "basketItems": [
            {
                "id": ("BI" + re.sub(r"[^A-Za-z0-9]", "", order_id))[:20] or "BI1",
                "name": label,
                "category1": "Genel",
                "itemType": "VIRTUAL",
                "price": amount,
            }
        ],
    }


def judge_retrieve(config: Mapping[str, Any], intent: Mapping[str, Any], payload: Mapping[str, Any]) -> Dict[str, Any]:
    """Retrieve JSON'unun alan eşleşmesi ve yanıt imzası. HTTP hatası burada yok."""
    data = payload or {}
    status = str(data.get("status") or "")
    payment_status = str(data.get("paymentStatus") or "")
    if status != "success" or payment_status != "SUCCESS":
        return _verdict(intent, ok=True, approved=False, error="declined")
    paid = _money(data.get("paidPrice"))
    intent_amount = _money(intent.get("amount"))
    if paid is None or intent_amount is None or paid != intent_amount:
        return _verdict(intent, ok=False, approved=False, error="amount_mismatch")
    if str(data.get("currency") or "").strip().upper() != "TRY":
        return _verdict(intent, ok=False, approved=False, error="currency_mismatch")
    if str(data.get("basketId") or "") != str(intent.get("order_id") or ""):
        return _verdict(intent, ok=False, approved=False, error="order_mismatch")
    if str(data.get("conversationId") or "") != str(intent.get("_id") or ""):
        return _verdict(intent, ok=False, approved=False, error="conversation_mismatch")
    secret = str(config.get("secret_key") or "")
    if not signatures_equal(response_signature(secret, data), str(data.get("signature") or "")):
        return _verdict(intent, ok=False, approved=False, error="bad_signature")
    return _verdict(intent, ok=True, approved=True, error="")


class IyzicoAdapter(VposAdapter):
    family = FAMILY
    model = MODEL

    def build_3d_form(self, config: Mapping[str, Any], intent: Mapping[str, Any], return_urls: Mapping[str, Any]) -> Dict[str, Any]:
        raise NotImplementedError

    def verify_callback(self, config: Mapping[str, Any], intent: Mapping[str, Any], form: Mapping[str, Any]) -> Dict[str, Any]:
        """Tarayıcı token'ı kanıt değildir."""
        return _verdict(intent, ok=False, approved=False, error="not_retrieve")

    async def start(self, config: Mapping[str, Any], intent: Mapping[str, Any], ctx: Mapping[str, Any], client: Any = None, rnd: Optional[str] = None) -> Dict[str, Any]:
        api_key = str(config.get("api_key") or "").strip()
        secret_key = str(config.get("secret_key") or "")
        hidden = [secret_key, api_key]
        if not api_key or not secret_key:
            raise VposStartError("init_failed", "magaza bilgisi eksik", "errorMessage")
        callback = str((ctx or {}).get("callback_url") or "").strip()
        if not callback.startswith("https://"):
            raise VposStartError("init_failed", "callback", "errorMessage")
        try:
            body = build_initialize_body(config, intent, ctx or {})
        except ValueError as exc:
            raise VposStartError("init_failed", str(exc)[:40], "errorMessage") from exc
        body_json = dumps(body)
        nonce = rnd or secrets.token_hex(8)
        signature = request_signature(secret_key, nonce, INIT_PATH, body_json)
        headers = {
            "Authorization": authorization_header(api_key, nonce, signature),
            "x-iyzi-rnd": nonce,
            "Content-Type": "application/json",
        }
        url = base_url_for_mode(str(config.get("mode") or "test")) + INIT_PATH
        try:
            data = await self._post_json(client, url, body_json, headers, hidden)
        except VposStartError as exc:
            exc.detail = redact(exc.detail, hidden)
            logger.warning("vpos iyzico init_failed %s", exc.detail)
            raise
        except Exception as exc:
            reason = redact(exc, hidden)
            logger.warning("vpos iyzico init_failed transport %s", reason)
            raise VposStartError("init_failed", reason or "transport", "errorMessage") from exc
        if str(data.get("status") or "") != "success":
            message = redact(data.get("errorMessage") or data.get("errorCode") or "failed", hidden)
            logger.warning("vpos iyzico init_failed %s", message)
            raise VposStartError("init_failed", message or "failed", "errorMessage")
        token = str(data.get("token") or "").strip()
        page = str(data.get("paymentPageUrl") or "").strip()
        if not token or not _host_ok(page):
            logger.warning("vpos iyzico init_failed page")
            raise VposStartError("init_failed", "paymentPageUrl", "errorMessage")
        return {"kind": "redirect", "url": page, "provider_ref": token}

    async def confirm(self, config: Mapping[str, Any], intent: Mapping[str, Any], payload: Mapping[str, Any], client: Any = None, rnd: Optional[str] = None) -> Dict[str, Any]:
        """Sunucu retrieve. Taşıma hatasında retryable; intent pending kalır."""
        token = str((payload or {}).get("token") or intent.get("provider_ref") or "")
        secret_key = str(config.get("secret_key") or "")
        api_key = str(config.get("api_key") or "").strip()
        hidden = [secret_key, api_key]
        if not token or not secret_key or not api_key:
            return _verdict(intent, ok=False, approved=False, error="config", retryable=True)
        body_json = dumps({
            "locale": "tr",
            "conversationId": str(intent.get("_id") or ""),
            "token": token,
        })
        nonce = rnd or secrets.token_hex(8)
        signature = request_signature(secret_key, nonce, RETRIEVE_PATH, body_json)
        headers = {
            "Authorization": authorization_header(api_key, nonce, signature),
            "x-iyzi-rnd": nonce,
            "Content-Type": "application/json",
        }
        url = base_url_for_mode(str(config.get("mode") or "test")) + RETRIEVE_PATH
        try:
            data = await self._post_json(client, url, body_json, headers, hidden)
        except Exception as exc:
            logger.warning("vpos iyzico retrieve failed %s", redact(exc, hidden))
            return _verdict(intent, ok=False, approved=False, error="retrieve_failed", retryable=True)
        return judge_retrieve(config, intent, data)

    async def _post_json(self, client: Any, url: str, body_json: str, headers: Mapping[str, str], hidden: list) -> Dict[str, Any]:
        raw = body_json.encode("utf-8")

        async def _call(http: Any) -> Dict[str, Any]:
            response = await http.post(url, content=raw, headers=dict(headers), follow_redirects=False)
            code = int(getattr(response, "status_code", 0) or 0)
            text = str(getattr(response, "text", "") or "")
            if code >= 400 or code < 200:
                raise VposStartError("init_failed", redact(text, hidden), "errorMessage")
            try:
                data = json.loads(text, parse_float=Decimal)
            except Exception as exc:
                raise VposStartError("init_failed", redact(text or exc, hidden), "errorMessage") from exc
            if not isinstance(data, dict):
                raise VposStartError("init_failed", "response", "errorMessage")
            data.pop("checkoutFormContent", None)
            return data

        if client is not None:
            return await _call(client)
        async with open_async_client(timeout=TIMEOUT) as owned:
            return await _call(owned)


ADAPTER = IyzicoAdapter()
register(ADAPTER)
