import os
import bcrypt
import jwt
from datetime import datetime, timezone, timedelta
from fastapi import Request, HTTPException, Depends
from typing import Optional, Any

JWT_ALGORITHM = "HS256"

# Bilinen güvensiz değerler — asla üretimde kullanılmamalı.
_JWT_LEGACY_DEFAULT = "nexus_default_secret_key_99482910"
_INSECURE_JWT = frozenset({"", "change-me", _JWT_LEGACY_DEFAULT, "secret", "jwt-secret"})

JWT_SECRET_REQUIRED_MSG = (
    "JWT_SECRET tanımlı değil veya güvensiz varsayılan bir değer. "
    "backend/.env içinde uzun, rastgele bir JWT_SECRET ayarlayın "
    "(ör. openssl rand -hex 32). Uygulama bu olmadan başlamaz."
)


def jwt_secret_is_insecure(secret: Optional[str] = None) -> bool:
    if secret is None:
        value = (os.environ.get("JWT_SECRET") or "").strip()
    else:
        value = (secret or "").strip()
    return value in _INSECURE_JWT


def require_secure_jwt_secret() -> str:
    """JWT_SECRET yoksa veya bilinen varsayılansa RuntimeError (açılışta fail-closed)."""
    secret = (os.environ.get("JWT_SECRET") or "").strip()
    if jwt_secret_is_insecure(secret):
        raise RuntimeError(JWT_SECRET_REQUIRED_MSG)
    return secret


def get_jwt_secret() -> str:
    """İmza için gizli anahtar. Güvensizse RuntimeError — sessiz fallback yok."""
    return require_secure_jwt_secret()


def session_token(request: Any) -> Optional[str]:
    """Dolu Bearer, yoksa dolu access_token çerezi. Boş `Bearer ` yok sayılır."""
    headers = getattr(request, "headers", None) or {}
    cookies = getattr(request, "cookies", None) or {}
    auth = headers.get("Authorization") or ""
    if auth.startswith("Bearer "):
        tok = auth[7:].strip()
        if tok:
            return tok
    cookie = (cookies.get("access_token") or "").strip()
    return cookie or None

def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False

# Tenant: 7 gün access / 30 gün refresh. Süper admin: kısa oturum (4 saat).
TENANT_ACCESS_SECONDS = 7 * 86400
TENANT_REFRESH_SECONDS = 30 * 86400
SUPERADMIN_ACCESS_SECONDS = 4 * 3600
SUPERADMIN_REFRESH_SECONDS = 4 * 3600


def create_access_token(
    user_id: str,
    email: str,
    role: str,
    *,
    expires_delta: Optional[timedelta] = None,
    is_super_admin: bool = False,
) -> str:
    if expires_delta is None:
        seconds = SUPERADMIN_ACCESS_SECONDS if is_super_admin else TENANT_ACCESS_SECONDS
        expires_delta = timedelta(seconds=seconds)
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "exp": datetime.now(timezone.utc) + expires_delta,
        "type": "access",
    }
    if is_super_admin:
        payload["sa"] = True
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str, *, is_super_admin: bool = False) -> str:
    seconds = SUPERADMIN_REFRESH_SECONDS if is_super_admin else TENANT_REFRESH_SECONDS
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(seconds=seconds),
        "type": "refresh",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def cookie_secure_flag(request: Any) -> bool:
    """Üretim HTTPS (veya X-Forwarded-Proto=https) için Secure=True; yerel http'de False."""
    try:
        url = str(getattr(request, "url", "") or "")
        if url.startswith("https://"):
            return True
    except Exception:
        pass
    headers = getattr(request, "headers", None) or {}
    proto = (headers.get("x-forwarded-proto") or headers.get("X-Forwarded-Proto") or "").split(",")[0].strip().lower()
    return proto == "https"


def auth_cookie_kwargs(request: Any, *, max_age: Optional[int] = None) -> dict:
    """access_token / refresh_token / sa_return ortak çerez bayrakları (SameSite=Lax)."""
    kw: dict = {"httponly": True, "samesite": "lax", "path": "/"}
    if cookie_secure_flag(request):
        kw["secure"] = True
    if max_age is not None:
        kw["max_age"] = int(max_age)
    return kw


def access_cookie_max_age(*, is_super_admin: bool, remember: bool) -> Optional[int]:
    """remember=False → oturum çerezi (max_age yok). SA remember → 4s; tenant → 7g."""
    if not remember:
        return None
    return SUPERADMIN_ACCESS_SECONDS if is_super_admin else TENANT_ACCESS_SECONDS


def refresh_cookie_max_age(*, is_super_admin: bool, remember: bool) -> Optional[int]:
    if not remember:
        return None
    return SUPERADMIN_REFRESH_SECONDS if is_super_admin else TENANT_REFRESH_SECONDS

async def get_user_from_token(token: str, db: Any) -> dict:
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Geçersiz token türü")
        user = await db.users.find_one({"_id": payload["sub"]})
        if not user:
            # Try finding with id string or int if any
            user = await db.users.find_one({"email": payload.get("email")})
        if not user:
            raise HTTPException(status_code=401, detail="Kullanıcı bulunamadı")
        if user.get("is_active") is False:
            raise HTTPException(status_code=401, detail="Hesabınız pasifleştirilmiş.")
        user["id"] = str(user.get("_id", user.get("id")))
        user.pop("password_hash", None)
        return user
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Oturum süresi doldu")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Geçersiz oturum anahtarı")
