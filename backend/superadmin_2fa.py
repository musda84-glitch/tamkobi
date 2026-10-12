"""Süper admin TOTP 2FA (Google Authenticator uyumlu) yardımcıları."""
from __future__ import annotations

import base64
import hashlib
import hmac
import io
import secrets
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional, Tuple

import jwt
import pyotp
import qrcode

from auth_utils import JWT_ALGORITHM, get_jwt_secret
from comm_service import decrypt, encrypt

ISSUER = "TamKobi Platform"
PENDING_2FA_TYPE = "pending_2fa"
PENDING_2FA_MINUTES = 10
RECOVERY_CODE_COUNT = 10
TOTP_DIGITS = 6


def generate_totp_secret() -> str:
    return pyotp.random_base32()


def encrypt_totp_secret(secret: str) -> str:
    return encrypt(secret or "")


def decrypt_totp_secret(stored: str) -> str:
    return decrypt(stored or "")


def provisioning_uri(secret: str, email: str) -> str:
    totp = pyotp.TOTP(secret, digits=TOTP_DIGITS)
    return totp.provisioning_uri(name=(email or "superadmin").strip().lower(), issuer_name=ISSUER)


def qr_png_data_url(uri: str) -> str:
    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def verify_totp(secret: str, code: str) -> bool:
    code = (code or "").strip().replace(" ", "")
    if not secret or not code.isdigit() or len(code) != TOTP_DIGITS:
        return False
    totp = pyotp.TOTP(secret, digits=TOTP_DIGITS)
    return bool(totp.verify(code, valid_window=1))


def _hash_recovery(code: str) -> str:
    normalized = (code or "").strip().upper().replace(" ", "").replace("-", "")
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def generate_recovery_codes(count: int = RECOVERY_CODE_COUNT) -> Tuple[List[str], List[str]]:
    """Düz metin kodlar + saklanacak SHA-256 özetleri."""
    plain: List[str] = []
    hashes: List[str] = []
    for _ in range(count):
        raw = secrets.token_hex(4).upper()  # 8 hex
        pretty = f"{raw[:4]}-{raw[4:]}"
        plain.append(pretty)
        hashes.append(_hash_recovery(pretty))
    return plain, hashes


def verify_recovery_code(code: str, hashes: Optional[List[str]]) -> Optional[str]:
    """Eşleşen hash'i döndürür (tek kullanımlık tüketim için); yoksa None."""
    if not hashes:
        return None
    target = _hash_recovery(code)
    for h in hashes:
        if hmac.compare_digest(str(h), target):
            return str(h)
    return None


def create_pending_2fa_token(user_id: str, email: str, *, remember: bool = False) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "type": PENDING_2FA_TYPE,
        "remember": bool(remember),
        "exp": datetime.now(timezone.utc) + timedelta(minutes=PENDING_2FA_MINUTES),
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def decode_pending_2fa_token(token: str) -> Dict[str, Any]:
    payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
    if payload.get("type") != PENDING_2FA_TYPE:
        raise jwt.InvalidTokenError("invalid pending 2fa type")
    return payload


def user_totp_enabled(user: Optional[dict]) -> bool:
    return bool(user and user.get("totp_enabled") and user.get("totp_secret"))


def needs_2fa_setup(user: Optional[dict], platform_settings: Optional[dict]) -> bool:
    """Zorunluluk açık ve kullanıcı henüz 2FA kurmamışsa True."""
    if not user or not user.get("is_super_admin"):
        return False
    if not (platform_settings or {}).get("require_superadmin_2fa"):
        return False
    return not user_totp_enabled(user)


async def platform_requires_2fa(db: Any) -> bool:
    doc = await db.platform_settings.find_one({"_id": "platform"}) or {}
    return bool(doc.get("require_superadmin_2fa"))
