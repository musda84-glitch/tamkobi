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
