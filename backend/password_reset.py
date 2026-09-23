"""ERP / personel / panel şifre sıfırlama yardımcıları."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional


ERP_FORGOT_MSG = "Eşleşen bir hesap varsa şifre sıfırlama bağlantısı e-posta adresine gönderildi."
MIN_PASSWORD = 6


def normalize_email(value: Any) -> str:
    return str(value or "").strip().lower()


def mask_email(email: Any) -> str:
    raw = str(email or "").strip()
    if "@" not in raw:
        return ""
    local, domain = raw.split("@", 1)
    prefix = local[:2]
    return f"{prefix}•••@{domain}"


def login_next(value: Any) -> str:
    v = str(value or "").strip().lower()
    if v in ("sistem", "panel", "system"):
        return "sistem"
    return "login"


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


def generic_forgot_response() -> dict:
    return {"status": "ok", "message": ERP_FORGOT_MSG, "mail_status": "skipped"}


MAIL_FAIL_PUBLIC_DETAIL = (
    "E-posta şu an gönderilemedi. Mail ayarlarını kontrol edip daha sonra tekrar deneyin. "
    "Güvenlik nedeniyle bağlantı ekranda gösterilmez."
)


def finalize_forgot_mail_result(out: dict, *, mail_status: str, mail_detail: str = "") -> dict:
    """Forgot yanıtına mail durumunu yaz; reset_url/token asla ekleme."""
    result = dict(out or {})
    result["mail_status"] = mail_status
    if mail_status == "sent":
        result["detail"] = mail_detail or "E-posta gönderildi."
    else:
        result["detail"] = MAIL_FAIL_PUBLIC_DETAIL
    result.pop("reset_url", None)
    result.pop("reset_token", None)
    return result
