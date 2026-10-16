"""NestPay / EST (Payten) 3D Pay Hosting — hash ver3.

Payten «Hash Ver3 Dokümantasyon 2024» ile aynı hesap:

1. ``hash`` ve ``encoding`` dışındaki bütün alan adları büyük/küçük harf
   duyarsız A→Z sıralanır (PHP ``natcasesort`` / .NET ``OrdinalIgnoreCase``).
2. Değerlerde önce ``\\`` sonra ``|`` kaçırılır (``\\`` → ``\\\\``, ``|`` → ``\\|``).
   Boş değer de sıraya girer.
3. Değerler ``|`` ile birleştirilir; sona kaçırılmış store key eklenir
   (store key'in ardında ``|`` yoktur).
4. ``Base64(SHA-512(utf-8 plaintext))``.

Kart bu modelde banka sayfasındadır; istek alanlarında PAN/CVV yoktur.
Test ucu Payten entegrasyon 3D kapısıdır. Canlı uç, bankanın kendi
``est3Dgate`` adresidir ve ayardan okunur.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import re
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, Mapping, Optional

from .base import VposAdapter, register

PAYTEN_TEST_3D_URL = "https://entegrasyon.asseco-see.com.tr/fim/est3Dgate"
PAYTEN_TEST_HOST = "entegrasyon.asseco-see.com.tr"
MODEL = "3d_pay_hosting"
CURRENCY_NUMERIC = "949"
HASH_EXCLUDED = frozenset({"hash", "encoding"})

_TRY_CODES = frozenset({"TRY", "TL", "949"})
_APPROVED_MD = frozenset({"1", "2", "3", "4"})
_MASKED_PAN = re.compile(r"(\d{6})\D+(\d{4})")
_MASKED_PAN_STORED = re.compile(r"^\d{6}\*{4,}\d{4}$")


def escape_hash_value(value: str) -> str:
    return (value or "").replace("\\", "\\\\").replace("|", "\\|")


def hash_field_names(params: Mapping[str, Any]) -> list:
    names = [str(key) for key in params.keys() if str(key).lower() not in HASH_EXCLUDED]
    names.sort(key=str.casefold)
    return names


def hash_plaintext(params: Mapping[str, Any], store_key: str) -> str:
    parts = []
    for name in hash_field_names(params):
        raw = params.get(name)
        parts.append(escape_hash_value("" if raw is None else str(raw)))
    parts.append(escape_hash_value(store_key or ""))
    return "|".join(parts)


def hash_ver3(params: Mapping[str, Any], store_key: str) -> str:
    digest = hashlib.sha512(hash_plaintext(params, store_key).encode("utf-8")).digest()
    return base64.b64encode(digest).decode("ascii")


def hashes_equal(expected: str, received: str) -> bool:
    left = expected or ""
    right = (received or "").strip()
    if not left or not right or len(left) != len(right):
        return False
    return hmac.compare_digest(left, right)


def _ci(form: Mapping[str, Any], *names: str) -> str:
    wanted = {name.lower() for name in names}
    for key, value in form.items():
        if str(key).lower() in wanted:
            return "" if value is None else str(value).strip()
    return ""


def _money(value: Any) -> Optional[Decimal]:
    text = str(value or "").strip().replace(" ", "").replace(",", ".")
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


def _currency(value: Any) -> str:
    raw = str(value or "").strip().upper()
    if raw in _TRY_CODES:
        return "TRY"
    return raw


def _parse_dt(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def is_expired(intent: Mapping[str, Any], now: Optional[datetime] = None) -> bool:
    exp = _parse_dt(intent.get("expires_at"))
    if exp is None:
        return True
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return exp <= current


def _short_code(value: str, limit: int = 32) -> str:
    text = re.sub(r"[^A-Za-z0-9]", "", value or "")[:limit]
    digits = re.sub(r"\D", "", text)
    if len(digits) >= 13:
        return ""
    return text


def _masked_pan(form: Mapping[str, Any]) -> str:
    for key, value in form.items():
        if str(key).lower() not in {"maskedpan", "maskedcreditcard", "masked_pan"}:
            continue
        raw = "" if value is None else str(value)
        if "*" not in raw and "X" not in raw.upper():
            continue
        match = _MASKED_PAN.search(raw)
        if not match:
            continue
        masked = f"{match.group(1)}******{match.group(2)}"
        if _MASKED_PAN_STORED.match(masked):
            return masked
    return ""


def _verdict(intent: Mapping[str, Any], *, ok: bool, approved: bool, error: str, form: Optional[Mapping[str, Any]] = None, include_bank: bool = False) -> Dict[str, Any]:
    bank = form or {}
    return {
        "ok": bool(ok),
        "approved": bool(approved),
        "amount": "" if intent.get("amount") is None else str(intent.get("amount")),
        "currency": "TRY",
        "order_id": str(intent.get("order_id") or ""),
        "auth_code": _short_code(_ci(bank, "AuthCode", "auth_code")) if include_bank else "",
        "proc_return_code": _short_code(_ci(bank, "ProcReturnCode", "proc_return_code"), 8) if include_bank else "",
        "md_status": _short_code(_ci(bank, "mdStatus", "md_status"), 4) if include_bank else "",
        "masked_pan": _masked_pan(bank) if include_bank else "",
        "error": error or "",
    }


class NestpayAdapter(VposAdapter):
    family = "nestpay"
    model = MODEL

    def build_3d_form(self, config: Mapping[str, Any], intent: Mapping[str, Any], return_urls: Mapping[str, Any]) -> Dict[str, Any]:
        import secrets

        mode = str(config.get("mode") or "").strip().lower()
        if mode == "test":
            action = PAYTEN_TEST_3D_URL
        else:
            action = str(config.get("gateway_3d_url") or "").strip()
        if not action.startswith("https://"):
            raise ValueError("gateway")
        store_key = str(config.get("store_key") or "")
        if not store_key:
            raise ValueError("store_key")
        client_id = str(config.get("client_id") or "").strip()
        if not client_id:
            raise ValueError("client_id")
        ok_url = str(return_urls.get("ok_url") or "").strip()
        fail_url = str(return_urls.get("fail_url") or "").strip()
        if not ok_url.startswith("https://") or not fail_url.startswith("https://"):
            raise ValueError("return_url")
        fields = {
            "clientid": client_id,
            "storetype": MODEL,
            "hashAlgorithm": "ver3",
            "TranType": "Auth",
            "amount": format_amount(intent.get("amount")),
            "currency": CURRENCY_NUMERIC,
            "oid": str(intent.get("order_id") or ""),
            "okUrl": ok_url,
            "failUrl": fail_url,
            "lang": "tr",
            "rnd": secrets.token_hex(8),
            "Instalment": "",
            "encoding": "utf-8",
        }
        fields["hash"] = hash_ver3(fields, store_key)
        return {"action_url": action, "fields": fields}

    def verify_callback(self, config: Mapping[str, Any], intent: Mapping[str, Any], form: Mapping[str, Any]) -> Dict[str, Any]:
        if str(config.get("company_id") or "") != str(intent.get("company_id") or ""):
            return _verdict(intent, ok=False, approved=False, error="company_mismatch")
        if is_expired(intent):
            return _verdict(intent, ok=False, approved=False, error="expired")
        store_key = str(config.get("store_key") or "")
        received = _ci(form, "hash", "HASH")
        if not hashes_equal(hash_ver3(form, store_key), received):
            return _verdict(intent, ok=False, approved=False, error="bad_hash")
        order_id = _ci(form, "oid", "OrderId", "orderid")
        if order_id != str(intent.get("order_id") or ""):
            return _verdict(intent, ok=False, approved=False, error="order_mismatch")
        callback_amount = _money(_ci(form, "amount"))
        intent_amount = _money(intent.get("amount"))
        if callback_amount is None or intent_amount is None or callback_amount != intent_amount:
            return _verdict(intent, ok=False, approved=False, error="amount_mismatch")
        if _currency(_ci(form, "currency")) != _currency(intent.get("currency") or "TRY"):
            return _verdict(intent, ok=False, approved=False, error="currency_mismatch")
        response = _ci(form, "Response", "response").lower()
        proc = _ci(form, "ProcReturnCode", "proc_return_code")
        md_status = _ci(form, "mdStatus", "md_status")
        approved = response == "approved" and proc == "00" and md_status in _APPROVED_MD
        return _verdict(
            intent,
            ok=True,
            approved=approved,
            error="" if approved else "declined",
            form=form,
            include_bank=True,
        )


ADAPTER = NestpayAdapter()
register(ADAPTER)
