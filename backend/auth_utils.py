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
    mfa: bool = False,
    aud: Optional[str] = None,
) -> str:
    if expires_delta is None:
        seconds = SUPERADMIN_ACCESS_SECONDS if is_super_admin else TENANT_ACCESS_SECONDS
        expires_delta = timedelta(seconds=seconds)
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user_id,
        "email": email,
        "role": role,
        "iat": int(now.timestamp()),
        "exp": now + expires_delta,
        "type": "access",
    }
    if is_super_admin:
        payload["sa"] = True
    if mfa:
        payload["mfa"] = True
    if aud:
        payload["aud"] = aud
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
    """access_token / refresh_token / sa_return ortak çerez bayrakları (SameSite=Lax).

    Domain ASLA set edilmez — host-only çerez (alt alan adları arası sızıntı yok).
    """
    kw: dict = {"httponly": True, "samesite": "lax", "path": "/"}
    if cookie_secure_flag(request):
        kw["secure"] = True
    if max_age is not None:
        kw["max_age"] = int(max_age)
    # Explicitly never set domain (host-only)
    kw.pop("domain", None)
    return kw


def decode_access_payload(token: str) -> dict:
    """Decode access JWT without audience validation (caller enforces aud)."""
    return jwt.decode(
        token,
        get_jwt_secret(),
        algorithms=[JWT_ALGORITHM],
        options={"verify_aud": False},
    )


def enforce_token_audience(payload: dict, request: Any, *, path: Optional[str] = None) -> None:
    """Raise HTTPException if JWT aud does not match the request host kind."""
    from host_audience import (
        KIND_APP,
        KIND_IK,
        KIND_SITE,
        KIND_YNT,
        AUD_APP,
        AUD_IK,
        AUD_YNT,
        host_kind,
        is_ik_allowed_api_path,
        is_ynt_allowed_path,
        is_super_admin_api_path,
        superadmin_ynt_only,
        ynt_host,
    )

    kind = host_kind(request)
    aud = payload.get("aud")
    p = path or ""

    # aud=ynt is never valid outside ynt
    if aud == AUD_YNT and kind != KIND_YNT:
        raise HTTPException(status_code=401, detail="Bu oturum yalnızca platform yönetimi için geçerli")

    if kind == KIND_YNT:
        if aud != AUD_YNT:
            raise HTTPException(status_code=401, detail=f"Bu oturum {ynt_host()} için geçerli değil")
        if not payload.get("sa"):
            raise HTTPException(status_code=403, detail="Yalnızca süper admin giriş yapabilir")
        if p.startswith("/api") and not is_ynt_allowed_path(p):
            raise HTTPException(status_code=403, detail="Bu uç platform yönetimi oturumunda kullanılamaz")
        return

    if kind == KIND_APP:
        if aud != AUD_APP:
            raise HTTPException(status_code=401, detail="Bu oturum app.tamkobi.com için geçerli değil")
        return

    if kind == KIND_IK:
        if aud != AUD_IK:
            raise HTTPException(status_code=401, detail="Bu oturum ik.tamkobi.com için geçerli değil")
        method = getattr(request, "method", None) or "GET"
        if p.startswith("/api") and not is_ik_allowed_api_path(p, method):
            raise HTTPException(status_code=403, detail="Personel oturumu yalnızca self-servis uçlarında geçerli")
        return

    if kind == KIND_SITE:
        # Site: only legacy mobile (aud None) or aud=site. app/ik/ynt tokens → 401.
        if aud not in (None, "site"):
            raise HTTPException(
                status_code=401,
                detail="Bu oturum tamkobi.com için geçerli değil",
            )
        # Bayrak 1: süper admin API yalnızca ynt'de
        if is_super_admin_api_path(p) and superadmin_ynt_only():
            raise HTTPException(
                status_code=403,
                detail=f"Yönetim paneli {ynt_host()} adresine taşındı",
            )
        return


def access_cookie_max_age(*, is_super_admin: bool, remember: bool) -> Optional[int]:
    """remember=False → oturum çerezi (max_age yok). SA remember → 4s; tenant → 7g."""
    if not remember:
        return None
    return SUPERADMIN_ACCESS_SECONDS if is_super_admin else TENANT_ACCESS_SECONDS


def refresh_cookie_max_age(*, is_super_admin: bool, remember: bool) -> Optional[int]:
    if not remember:
        return None
    return SUPERADMIN_REFRESH_SECONDS if is_super_admin else TENANT_REFRESH_SECONDS

async def get_user_from_token(token: str, db: Any, *, request: Any = None, path: Optional[str] = None) -> dict:
    try:
        # aud is enforced separately against Host (verify_aud=False here).
        payload = jwt.decode(
            token,
            get_jwt_secret(),
            algorithms=[JWT_ALGORITHM],
            options={"verify_aud": False},
        )
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Geçersiz token türü")
        if request is not None:
            enforce_token_audience(payload, request, path=path or getattr(getattr(request, "url", None), "path", None))
        user = await db.users.find_one({"_id": payload["sub"]})
        if not user:
            # Try finding with id string or int if any
            user = await db.users.find_one({"email": payload.get("email")})
        if not user:
            raise HTTPException(status_code=401, detail="Kullanıcı bulunamadı")
        if user.get("is_active") is False:
            raise HTTPException(status_code=401, detail="Hesabınız pasifleştirilmiş.")
        iat = payload.get("iat")
        # E-posta değişimi / açık oturum iptali: sessions_revoked_at sonrası JWT reddedilir.
        # (Refresh JWT sunucuda saklanmıyor; erişim JWT iat kontrolü ile düşer. Tenant access TTL: TENANT_ACCESS_SECONDS.)
        revoked_raw = user.get("sessions_revoked_at")
        if revoked_raw:
            try:
                from superadmin_2fa import parse_enabled_at
                revoked_ts = parse_enabled_at(revoked_raw)
            except Exception:
                revoked_ts = None
            if revoked_ts is not None and (iat is None or int(float(iat)) < int(float(revoked_ts))):
                raise HTTPException(status_code=401, detail="Oturum yenilenmeli, tekrar giriş yapın")
        # Süper admin + TOTP açık: MFA onaylı oturum zorunlu (impersonation hariç)
        if user.get("is_super_admin") and user.get("totp_enabled") and user.get("totp_secret") and not payload.get("imp_by"):
            if not payload.get("mfa"):
                raise HTTPException(status_code=401, detail="Oturum yenilenmeli, tekrar giriş yapın")
            try:
                from superadmin_2fa import parse_enabled_at
                enabled_ts = parse_enabled_at(user.get("totp_enabled_at"))
            except Exception:
                enabled_ts = None
            # Compare at whole-second resolution so a token minted in the same
            # second as totp_enabled_at is accepted (JWT iat is typically int seconds).
            if enabled_ts is not None and (iat is None or int(float(iat)) < int(float(enabled_ts))):
                raise HTTPException(status_code=401, detail="Oturum yenilenmeli, tekrar giriş yapın")
        user["id"] = str(user.get("_id", user.get("id")))
        user["_token_aud"] = payload.get("aud")
        user["_token_payload"] = payload
        user.pop("password_hash", None)
        return user
    except HTTPException:
        raise
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Oturum süresi doldu")
    except jwt.InvalidTokenError:
        principal = await _shopfloor_device_principal(token, db)
        if principal is not None:
            return principal
        raise HTTPException(status_code=401, detail="Geçersiz oturum anahtarı")


async def _shopfloor_device_principal(token: str, db: Any) -> Optional[dict]:
    """JWT olmayan cihaz token'ı. Normal kullanıcı akışı bu yola girmez."""
    try:
        import shopfloor_devices
    except Exception:
        return None
    if not shopfloor_devices.looks_like_device_token(token):
        return None
    return await shopfloor_devices.principal_from_token(token, db)
