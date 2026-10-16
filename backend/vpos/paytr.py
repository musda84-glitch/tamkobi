"""PayTR iFrame API.

Token: PayTR iFrame 1. adım. ``paytr_token`` =
base64(HMAC_SHA256(merchant_key, merchant_id + user_ip + merchant_oid + email
+ payment_amount + user_basket + no_installment + max_installment + currency
+ test_mode + merchant_salt)).

Bildirim hash: base64(HMAC_SHA256(merchant_key, merchant_oid + merchant_salt
+ status + total_amount)).

Kart bu modelde PayTR sayfasındadır. merchant_key ve merchant_salt istek
gövdesine konmaz. Ödeme sonucu yalnız hash'i doğrulanmış bildirim POST'undan
yazılır; merchant_ok_url / merchant_fail_url bilgi sayfasıdır.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import re
from decimal import Decimal, InvalidOperation
from typing import Any, Dict, Mapping

from safe_error import mask_sensitive_text

from vpos_http import AsyncClient

from .base import VposAdapter, VposStartError, register

logger = logging.getLogger("vpos.paytr")

FAMILY = "paytr"
MODEL = "iframe"
TOKEN_URL = "https://www.paytr.com/odeme/api/get-token"
IFRAME_PREFIX = "https://www.paytr.com/odeme/guvenli/"
TIMEOUT = 20.0

_OID = re.compile(r"^[A-Za-z0-9]{1,64}$")
_TOKEN = re.compile(r"^[A-Za-z0-9]{8,128}$")


def paytr_token(
    merchant_key: str,
    merchant_id: str,
    user_ip: str,
    merchant_oid: str,
    email: str,
    payment_amount: str,
    user_basket: str,
    no_installment: str,
    max_installment: str,
    currency: str,
    test_mode: str,
    merchant_salt: str,
) -> str:
    message = (
        f"{merchant_id}{user_ip}{merchant_oid}{email}{payment_amount}{user_basket}"
        f"{no_installment}{max_installment}{currency}{test_mode}{merchant_salt}"
    )
    digest = hmac.new((merchant_key or "").encode("utf-8"), message.encode("utf-8"), hashlib.sha256).digest()
    return base64.b64encode(digest).decode("ascii")


def notify_hash(merchant_key: str, merchant_oid: str, merchant_salt: str, status: str, total_amount: str) -> str:
    message = f"{merchant_oid}{merchant_salt}{status}{total_amount}"
    digest = hmac.new((merchant_key or "").encode("utf-8"), message.encode("utf-8"), hashlib.sha256).digest()
    return base64.b64encode(digest).decode("ascii")


def hashes_equal(expected: str, received: str) -> bool:
    left = expected or ""
    right = (received or "").strip()
    if not left or not right or len(left) != len(right):
        return False
    return hmac.compare_digest(left, right)


def payment_amount_kurus(amount: Any) -> str:
    """Intent tutarını kuruşa çevirir. Yuvarlama yok; 2 haneden fazlası reddedilir."""
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


def format_amount(amount: Any) -> str:
    text = str(amount if amount is not None else "").strip().replace(" ", "").replace(",", ".")
    dec = Decimal(text)
    if dec != dec.quantize(Decimal("0.01")) or dec <= 0:
        raise ValueError("amount")
    return f"{dec:.2f}"


def user_basket(label: str, amount: str) -> str:
    name = (label or "Odeme").strip()[:80] or "Odeme"
    raw = json.dumps([[name, format_amount(amount), 1]], separators=(",", ":"), ensure_ascii=False)
    return base64.b64encode(raw.encode("utf-8")).decode("ascii")


def redact(text: Any, secrets: list, limit: int = 120) -> str:
    raw = mask_sensitive_text(text)
    for secret in secrets:
        value = str(secret or "")
        if len(value) >= 4:
            raw = raw.replace(value, "[mask]")
    raw = re.sub(r"\s+", " ", raw).strip()
    return raw[:limit]


def _verdict(intent: Mapping[str, Any], *, ok: bool, approved: bool, error: str) -> Dict[str, Any]:
    return {
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


def _clip(value: Any, limit: int) -> str:
    return str(value or "").strip()[:limit]


class PaytrAdapter(VposAdapter):
    family = FAMILY
    model = MODEL

    def build_3d_form(self, config: Mapping[str, Any], intent: Mapping[str, Any], return_urls: Mapping[str, Any]) -> Dict[str, Any]:
        raise NotImplementedError

    def verify_callback(self, config: Mapping[str, Any], intent: Mapping[str, Any], form: Mapping[str, Any]) -> Dict[str, Any]:
        """Tarayıcı dönüşü kanıt değildir. Bildirim hash'i olmadan onay yazılmaz."""
        return _verdict(intent, ok=False, approved=False, error="not_notification")

    async def start(self, config: Mapping[str, Any], intent: Mapping[str, Any], ctx: Mapping[str, Any], client: Any = None) -> Dict[str, Any]:
        merchant_id = str(config.get("merchant_id") or "").strip()
        merchant_key = str(config.get("merchant_key") or "")
        merchant_salt = str(config.get("merchant_salt") or "")
        secrets = [merchant_key, merchant_salt]
        if not merchant_id.isdigit() or not merchant_key or not merchant_salt:
            raise VposStartError("token_failed", "magaza bilgisi eksik")
        order_id = str(intent.get("order_id") or "")
        if not _OID.match(order_id):
            raise VposStartError("token_failed", "merchant_oid")
        try:
            minor = payment_amount_kurus(intent.get("amount"))
            amount_text = format_amount(intent.get("amount"))
        except (ValueError, InvalidOperation) as exc:
            raise VposStartError("token_failed", "amount") from exc
        mode = str(config.get("mode") or "test").strip().lower()
        test_mode = "1" if mode == "test" else "0"
        no_installment = "1" if config.get("no_installment") else "0"
        try:
            max_installment = str(int(config.get("max_installment") or 0))
        except (TypeError, ValueError):
            max_installment = "0"
        ctx = ctx or {}
        user_ip = _clip(ctx.get("user_ip") or "127.0.0.1", 39) or "127.0.0.1"
        email = _clip(ctx.get("email") or "test@example.com", 100) or "test@example.com"
        basket = user_basket(str(ctx.get("basket_label") or "Test odemesi"), amount_text)
        token = paytr_token(
            merchant_key, merchant_id, user_ip, order_id, email, minor, basket,
            no_installment, max_installment, "TL", test_mode, merchant_salt,
        )
        ok_url = _clip(ctx.get("ok_url") or ctx.get("callback_url"), 400)
        fail_url = _clip(ctx.get("fail_url") or ok_url, 400)
        fields = {
            "merchant_id": merchant_id,
            "user_ip": user_ip,
            "merchant_oid": order_id,
            "email": email,
            "payment_amount": minor,
            "paytr_token": token,
            "user_basket": basket,
            "debug_on": "1" if test_mode == "1" else "0",
            "test_mode": test_mode,
            "no_installment": no_installment,
            "max_installment": max_installment,
            "user_name": _clip(ctx.get("name") or "Test", 60) or "Test",
            "user_address": _clip(ctx.get("address") or "-", 400) or "-",
            "user_phone": _clip(ctx.get("phone") or "-", 20) or "-",
            "merchant_ok_url": ok_url,
            "merchant_fail_url": fail_url,
            "timeout_limit": "30",
            "currency": "TL",
            "lang": "tr",
        }
        try:
            payload = await self._post_token(client, fields, secrets)
        except VposStartError as exc:
            exc.detail = redact(exc.detail, secrets)
            logger.warning("vpos paytr token_failed %s", exc.detail)
            raise
        except Exception as exc:
            reason = redact(exc, secrets)
            logger.warning("vpos paytr token_failed transport %s", reason)
            raise VposStartError("token_failed", reason or "transport") from exc
        status = str((payload or {}).get("status") or "")
        if status != "success":
            reason = redact((payload or {}).get("reason") or status or "failed", secrets)
            logger.warning("vpos paytr token_failed %s", reason)
            raise VposStartError("token_failed", reason or "failed")
        iframe_token = str((payload or {}).get("token") or "")
        if not _TOKEN.match(iframe_token):
            logger.warning("vpos paytr token_failed token_shape")
            raise VposStartError("token_failed", "token")
        return {"kind": "iframe", "iframe_url": IFRAME_PREFIX + iframe_token}

    async def _post_token(self, client: Any, fields: Mapping[str, str], secrets: list) -> Dict[str, Any]:
        async def _call(http: Any) -> Dict[str, Any]:
            response = await http.post(TOKEN_URL, data=dict(fields), follow_redirects=False)
            code = int(getattr(response, "status_code", 0) or 0)
            text = str(getattr(response, "text", "") or "")
            if code >= 400:
                raise VposStartError("token_failed", redact(text, secrets))
            try:
                data = response.json()
            except Exception as exc:
                raise VposStartError("token_failed", redact(text or exc, secrets)) from exc
            if not isinstance(data, dict):
                raise VposStartError("token_failed", "response")
            return data

        if client is not None:
            return await _call(client)
        async with AsyncClient(timeout=TIMEOUT) as owned:
            return await _call(owned)

    async def confirm(self, config: Mapping[str, Any], intent: Mapping[str, Any], payload: Mapping[str, Any], client: Any = None) -> Dict[str, Any]:
        form = payload or {}
        merchant_key = str(config.get("merchant_key") or "")
        merchant_salt = str(config.get("merchant_salt") or "")
        oid = str(form.get("merchant_oid") or "")
        status = str(form.get("status") or "")
        total_raw = str(form.get("total_amount") or "")
        received = str(form.get("hash") or "")
        if not hashes_equal(notify_hash(merchant_key, oid, merchant_salt, status, total_raw), received):
            return _verdict(intent, ok=False, approved=False, error="bad_hash")
        if oid != str(intent.get("order_id") or ""):
            return _verdict(intent, ok=False, approved=False, error="order_mismatch")
        try:
            expected = payment_amount_kurus(intent.get("amount"))
        except ValueError:
            return _verdict(intent, ok=False, approved=False, error="amount_mismatch")
        if total_raw.strip() != expected:
            return _verdict(intent, ok=False, approved=False, error="amount_mismatch")
        approved = status == "success"
        return _verdict(intent, ok=True, approved=approved, error="" if approved else "declined")


def notification_hash_ok(config: Mapping[str, Any], form: Mapping[str, Any]) -> bool:
    """Intent aranmadan önce hash. Kötü hash intent'e dokunulmamasını sağlar."""
    oid = str(form.get("merchant_oid") or "")
    status = str(form.get("status") or "")
    total = str(form.get("total_amount") or "")
    received = str(form.get("hash") or "")
    expected = notify_hash(
        str(config.get("merchant_key") or ""),
        oid,
        str(config.get("merchant_salt") or ""),
        status,
        total,
    )
    return hashes_equal(expected, received)


ADAPTER = PaytrAdapter()
register(ADAPTER)
