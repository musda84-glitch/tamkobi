"""ERP / personel / panel şifre sıfırlama yardımcıları."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional


ERP_FORGOT_MSG = "Kayıtlı bir hesap varsa şifre sıfırlama bağlantısı e-posta adresine gönderildi."
ERP_FORGOT_SMS_MSG = "Kayıtlı bir hesap varsa SMS gönderildi."
MIN_PASSWORD = 6

# Public forgot yanıtında yalnızca bu anahtarlar istemciye gider.
PUBLIC_FORGOT_KEYS = ("status", "message", "channel")


def normalize_email(value: Any) -> str:
    return str(value or "").strip().lower()


def mask_email(email: Any) -> str:
    raw = str(email or "").strip()
    if "@" not in raw:
        return ""
    local, domain = raw.split("@", 1)
    prefix = local[:2]
    return f"{prefix}•••@{domain}"


def mask_phone(phone: Any) -> str:
    digits = "".join(ch for ch in str(phone or "") if ch.isdigit())
    if len(digits) < 4:
        return ""
    return f"•••{digits[-4:]}"


def login_next(value: Any) -> str:
    v = str(value or "").strip().lower()
    if v in ("sistem", "panel", "system"):
        return "sistem"
    return "login"


def forgot_channel(value: Any) -> str:
    v = str(value or "").strip().lower()
    if v in ("sms", "phone", "gsm"):
        return "sms"
    return "email"


def reset_path(token: str, next_kind: Any = "login") -> str:
    path = f"/sifre/{token}"
    if login_next(next_kind) == "sistem":
        path += "?next=sistem"
    return path


def reset_link(base: Any, token: str, next_kind: Any = "login") -> str:
    path = reset_path(token, next_kind)
    root = str(base or "").rstrip("/")
    return f"{root}{path}" if root else path


def redirect_after_reset(next_kind: Any) -> str:
    return "/sistem/giris" if login_next(next_kind) == "sistem" else "/login"


def password_error(password: Any) -> Optional[str]:
    if len(str(password or "")) < MIN_PASSWORD:
        return "Şifre en az 6 karakter olmalı."
    return None


def reset_row_error(row: Optional[dict], now: Optional[datetime] = None) -> Optional[str]:
    if not row:
        return "Sıfırlama bağlantısı geçersiz."
    if row.get("used_at"):
        return "Bu bağlantı zaten kullanılmış. Yeni istek oluşturun."
    exp = row.get("expires_at") or ""
    try:
        exp_dt = datetime.fromisoformat(str(exp).replace("Z", "+00:00"))
        if exp_dt.tzinfo is None:
            exp_dt = exp_dt.replace(tzinfo=timezone.utc)
        if exp_dt < (now or datetime.now(timezone.utc)):
            return "Sıfırlama bağlantısının süresi doldu."
    except Exception:
        return "Sıfırlama bağlantısı geçersiz."
    return None


def generic_forgot_response(channel: Any = "email") -> dict:
    ch = forgot_channel(channel)
    msg = ERP_FORGOT_SMS_MSG if ch == "sms" else ERP_FORGOT_MSG
    return {"status": "ok", "message": msg, "channel": ch}


def public_forgot_payload(out: dict, *, channel: Any = None) -> dict:
    """Strip delivery status / detail / tokens — enumeration-safe body."""
    ch = forgot_channel(channel or (out or {}).get("channel") or "email")
    base = generic_forgot_response(ch)
    msg = str((out or {}).get("message") or "").strip()
    if msg:
        base["message"] = msg
    return {k: base[k] for k in PUBLIC_FORGOT_KEYS}


MAIL_FAIL_PUBLIC_DETAIL = (
    "E-posta şu an gönderilemedi. Mail ayarlarını kontrol edip daha sonra tekrar deneyin. "
    "Güvenlik nedeniyle bağlantı ekranda gösterilmez."
)

SMS_FAIL_PUBLIC_DETAIL = (
    "SMS şu an gönderilemedi. Platform SMS ayarlarını kontrol edip daha sonra tekrar deneyin. "
    "Güvenlik nedeniyle bağlantı ekranda gösterilmez."
)


def finalize_forgot_mail_result(out: dict, *, mail_status: str, mail_detail: str = "") -> dict:
    """Forgot yanıtı: yalnızca status/message/channel; reset_url/token asla ekleme."""
    _ = mail_status, mail_detail  # logged by caller; never returned to client
    return public_forgot_payload(out, channel="email")


def finalize_forgot_sms_result(out: dict, *, sms_status: str, sms_detail: str = "") -> dict:
    """Forgot SMS yanıtı: yalnızca status/message/channel; reset_url/token asla ekleme."""
    _ = sms_status, sms_detail  # logged by caller; never returned to client
    return public_forgot_payload(out, channel="sms")


def sms_reset_message(*, name: Any, link: str, brand: Any = "TamKobi") -> str:
    who = str(name or "").strip() or "Kullanıcı"
    label = str(brand or "TamKobi").strip() or "TamKobi"
    return (
        f"{label}: Merhaba {who}, sifre sifirlama baglantiniz (1 saat): {link}"
    )[:400]
