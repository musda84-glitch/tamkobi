import os
import secrets
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


def token_version_of(user: Optional[dict]) -> int:
    """Kullanıcı belgesindeki oturum kuşağı. Yoksa 0 (eski JWT'ler tv=0 sayılır)."""
    if not user:
        return 0
    try:
        value = int(user.get("token_version") or 0)
    except (TypeError, ValueError):
        return 0
    return value if value > 0 else 0


def session_claims(token_version: int = 0) -> dict:
    """Her oturum JWT'sine kuşağı ve tekil jti yazar. jti loglanmaz."""
    return {"tv": token_version_of({"token_version": token_version}), "jti": secrets.token_urlsafe(16)}


def session_generation_current(payload: Optional[dict], user: Optional[dict]) -> bool:
    """Access ve refresh aynı kuşağı taşır. Çıkış token_version artırınca ikisi de düşer."""
    claimed = 0
    if payload is not None:
        try:
            claimed = int(payload.get("tv") or 0)
        except (TypeError, ValueError):
            return False
    return claimed == token_version_of(user)


def create_access_token(
    user_id: str,
    email: str,
    role: str,
    *,
    expires_delta: Optional[timedelta] = None,
    is_super_admin: bool = False,
    mfa: bool = False,
    aud: Optional[str] = None,
    token_version: int = 0,
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
    payload.update(session_claims(token_version))
    if is_super_admin:
        payload["sa"] = True
    if mfa:
        payload["mfa"] = True
    if aud:
        payload["aud"] = aud
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str, *, is_super_admin: bool = False, token_version: int = 0) -> str:
    seconds = SUPERADMIN_REFRESH_SECONDS if is_super_admin else TENANT_REFRESH_SECONDS
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(seconds=seconds),
        "type": "refresh",
    }
    payload.update(session_claims(token_version))
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


AUTH_COOKIE_NAMES = ("access_token", "refresh_token", "sa_return")


def clear_auth_cookies(response: Any, request: Any) -> None:
    """Oturum çerezini yazıldığı bayraklarla siler.

    Secure çerez, Secure'suz Set-Cookie ile düşmez. Domain yine yazılmaz.
    """
    kw = auth_cookie_kwargs(request)
    path = kw.get("path") or "/"
    secure = bool(kw.get("secure"))
    samesite = kw.get("samesite") or "lax"
    for name in AUTH_COOKIE_NAMES:
        response.delete_cookie(
            key=name,
            path=path,
            secure=secure,
            httponly=True,
            samesite=samesite,
        )


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
        # Çıkış token_version artırır. Eski access ve refresh (tv yok = 0) reddedilir.
        if not session_generation_current(payload, user):
            raise HTTPException(status_code=401, detail="Oturum sonlandırıldı. Tekrar giriş yapın.")
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


def _decode_any_session(token: str) -> Optional[dict]:
    """İmza doğruysa süresi dolmuş access/refresh de okunur. Değer loglanmaz."""
    text = (token or "").strip()
    if not text or text.count(".") != 2:
        return None
    try:
        payload = jwt.decode(
            text,
            get_jwt_secret(),
            algorithms=[JWT_ALGORITHM],
            options={"verify_aud": False, "verify_exp": False},
        )
    except Exception:
        return None
    if not isinstance(payload, dict):
        return None
    if payload.get("type") not in ("access", "refresh"):
        return None
    return payload


def _request_cookie(request: Any, name: str) -> str:
    cookies = getattr(request, "cookies", None) or {}
    try:
        return str(cookies.get(name) or "").strip()
    except Exception:
        return ""


async def revoke_open_qr_sessions(db: Any, user_ids: list) -> None:
    """Onaylanmış veya bekleyen QR web girişini düşürür. Koleksiyon yoksa sessiz.

    Eski QR kodu çıkıştan sonra yeni access üretemez. Ham kod yazılmaz.
    """
    ids = [str(item) for item in (user_ids or []) if str(item or "").strip()]
    if not ids or db is None:
        return
    col = getattr(db, "web_login_qr", None)
    if col is None or not hasattr(col, "find"):
        return
    now = datetime.now(timezone.utc).isoformat()
    try:
        cursor = col.find({"user_id": {"$in": ids}})
        rows = await cursor.to_list(200) if hasattr(cursor, "to_list") else []
    except Exception:
        return
    for row in rows or []:
        if str((row or {}).get("status") or "") not in ("pending", "approved"):
            continue
        try:
            await col.update_one(
                {"_id": row.get("_id")},
                {"$set": {"status": "revoked", "revoked_at": now}},
            )
        except Exception:
            return


async def revoke_login_sessions(db: Any, request: Any) -> list:
    """Bu istekteki access ve refresh öznelerinin kuşak numarasını bir artırır.

    Atölye cihaz token'ı JWT değildir; dokunulmaz (yalnız Cihazdan çık kapatır).
    sa_return çerezi silinir ama yönetici JWT'si burada düşürülmez.
    Dönüş kullanıcı kimlikleridir, token değildir.
    """
    if db is None or request is None:
        return []
    raws = [session_token(request) or "", _request_cookie(request, "refresh_token")]
    subjects = []
    for raw in raws:
        payload = _decode_any_session(raw)
        if not payload:
            continue
        sub = str(payload.get("sub") or "").strip()
        if sub and sub not in subjects:
            subjects.append(sub)
    bumped = []
    for sub in subjects:
        try:
            user = await db.users.find_one({"_id": sub})
        except Exception:
            continue
        if not user or str(user.get("account_type") or "") == "atolye_device":
            continue
        try:
            await db.users.update_one({"_id": sub}, {"$inc": {"token_version": 1}})
            bumped.append(sub)
        except Exception:
            continue
    await revoke_open_qr_sessions(db, bumped)
    return bumped
