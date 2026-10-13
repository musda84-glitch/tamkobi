"""Google Identity Services (ID token) doğrulama ve kayıt bekleyen profil JWT."""
from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional, Tuple

import jwt
from fastapi import HTTPException
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token as google_id_token

from auth_utils import JWT_ALGORITHM, get_jwt_secret

PENDING_GOOGLE_TYPE = "pending_google_signup"
PENDING_GOOGLE_MINUTES = 30
ALLOWED_ISSUERS = frozenset({"accounts.google.com", "https://accounts.google.com"})

GOOGLE_CLIENT_ID_VALUE = "359977032625-m1essfnlouaa4tmh0jsqfk8dca0fn67o.apps.googleusercontent.com"


def google_client_id() -> str:
    return (os.environ.get("GOOGLE_CLIENT_ID") or "").strip()


def google_auth_configured() -> bool:
    return bool(google_client_id())


def verify_google_id_token(credential: str) -> Dict[str, Any]:
    """Google ID token doğrula. aud=GOOGLE_CLIENT_ID, iss accounts.google.com, email_verified zorunlu."""
    client_id = google_client_id()
    if not client_id:
        raise HTTPException(status_code=404, detail="Google girişi yapılandırılmamış.")
    token = (credential or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Google kimlik bilgisi gerekli.")
    try:
        info = google_id_token.verify_oauth2_token(
            token,
            google_requests.Request(),
            audience=client_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=401, detail=f"Geçersiz Google kimliği: {e}") from e
    except Exception as e:
        raise HTTPException(status_code=401, detail="Google kimliği doğrulanamadı.") from e

    iss = str(info.get("iss") or "")
    if iss not in ALLOWED_ISSUERS:
        raise HTTPException(status_code=401, detail="Geçersiz Google kimlik kaynağı.")
    if info.get("aud") != client_id:
        raise HTTPException(status_code=401, detail="Google istemci kimliği eşleşmiyor.")
    if not info.get("email_verified"):
        raise HTTPException(status_code=401, detail="Google e-posta adresi doğrulanmamış.")
    email = (info.get("email") or "").strip().lower()
    sub = str(info.get("sub") or "").strip()
    if not email or "@" not in email or not sub:
        raise HTTPException(status_code=401, detail="Google hesabında e-posta bulunamadı.")
    return {
        "email": email,
        "google_sub": sub,
        "name": (info.get("name") or info.get("given_name") or email.split("@")[0]).strip(),
        "picture": (info.get("picture") or "").strip(),
        "raw": info,
    }


def create_pending_google_token(
    *,
    google_sub: str,
    email: str,
    name: str,
    picture: str = "",
) -> str:
    payload = {
        "type": PENDING_GOOGLE_TYPE,
        "google_sub": google_sub,
        "email": (email or "").strip().lower(),
        "name": (name or "").strip(),
        "picture": (picture or "").strip(),
        "exp": datetime.now(timezone.utc) + timedelta(minutes=PENDING_GOOGLE_MINUTES),
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def decode_pending_google_token(token: str) -> Dict[str, Any]:
    try:
        payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
    except Exception as e:
        raise HTTPException(status_code=401, detail="Google kayıt oturumu geçersiz veya süresi dolmuş.") from e
    if payload.get("type") != PENDING_GOOGLE_TYPE:
        raise HTTPException(status_code=401, detail="Google kayıt oturumu geçersiz.")
    if not payload.get("google_sub") or not payload.get("email"):
        raise HTTPException(status_code=401, detail="Google kayıt oturumu eksik.")
    return payload


def profile_complete(company_name: Optional[str], phone: Optional[str]) -> bool:
    return bool((company_name or "").strip() and (phone or "").strip())


# /auth/google IP limitleri
GOOGLE_IP_PER_MINUTE = 20
GOOGLE_SIGNUP_PER_HOUR = 5


def _minute_bucket(now: Optional[datetime] = None) -> str:
    n = now or datetime.now(timezone.utc)
    return n.strftime("%Y%m%d%H%M")


def _hour_bucket(now: Optional[datetime] = None) -> str:
    n = now or datetime.now(timezone.utc)
    return n.strftime("%Y%m%d%H")


async def enforce_google_ip_rate(db, client_ip: str) -> None:
    """Tüm /auth/google istekleri: 20/dk/IP → 429."""
    ip = (client_ip or "unknown").strip() or "unknown"
    identifier = f"google_rl:{ip}:{_minute_bucket()}"
    attempt = await db.login_attempts.find_one({"identifier": identifier})
    count = int((attempt or {}).get("count") or 0)
    if count >= GOOGLE_IP_PER_MINUTE:
        raise HTTPException(
            status_code=429,
            detail="Çok fazla Google giriş denemesi. Lütfen bir dakika sonra tekrar deneyin.",
        )
    await db.login_attempts.update_one(
        {"identifier": identifier},
        {"$inc": {"count": 1}, "$set": {"last_attempt": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )


async def enforce_google_signup_rate(db, client_ip: str) -> None:
    """Yeni Google kayıt: 5/saat/IP → 429."""
    ip = (client_ip or "unknown").strip() or "unknown"
    identifier = f"google_signup:{ip}:{_hour_bucket()}"
    attempt = await db.login_attempts.find_one({"identifier": identifier})
    count = int((attempt or {}).get("count") or 0)
    if count >= GOOGLE_SIGNUP_PER_HOUR:
        raise HTTPException(
            status_code=429,
            detail="Bu IP üzerinden çok fazla Google kaydı denendi. Lütfen daha sonra tekrar deneyin.",
        )
    await db.login_attempts.update_one(
        {"identifier": identifier},
        {"$inc": {"count": 1}, "$set": {"last_attempt": datetime.now(timezone.utc).isoformat()}},
        upsert=True,
    )

