"""aud'lu destek oturumu: iptal edilmiş imp_session 401, InvalidAudienceError loglanmaz."""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi import HTTPException

os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:8000")
os.environ.setdefault("JWT_SECRET", "test-imp-session-audience-secret-32b-min")

import server  # noqa: E402
import support_access  # noqa: E402
from auth_utils import JWT_ALGORITHM, get_jwt_secret  # noqa: E402


class _Url:
    path = "/api/invoices"


class _Req:
    def __init__(self, token: str):
        self.headers = {"Authorization": f"Bearer {token}"}
        self.cookies = {}
        self.url = _Url()
        self.client = None


def _aud_token(imp_session: str = "ss_revoked") -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {
            "sub": "user-1",
            "email": "a@firma.com",
            "role": "admin",
            "type": "access",
            "aud": "app",
            "imp_session": imp_session,
            "iat": int(now.timestamp()),
            "exp": now + timedelta(hours=2),
        },
        get_jwt_secret(),
        algorithm=JWT_ALGORITHM,
    )


def test_aud_token_revoked_imp_session_is_401_without_error_log(monkeypatch, caplog):
    async def _user(token, db, request=None, path=None):
        return {
            "_id": "user-1",
            "id": "user-1",
            "email": "a@firma.com",
            "role": "admin",
            "is_active": True,
        }

    async def _session(sid):
        assert sid == "ss_revoked"
        return {
            "_id": sid,
            "status": "revoked",
            "company_id": "c1",
            "expires_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
        }

    monkeypatch.setattr(server, "get_user_from_token", _user)
    monkeypatch.setattr(support_access, "session_by_id", _session)

    logged = []

    def _exception(self, msg, *args, **kwargs):
        logged.append(str(msg))

    monkeypatch.setattr(logging.Logger, "exception", _exception)
    caplog.set_level(logging.ERROR)

    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.get_current_user(_Req(_aud_token())))
    assert exc.value.status_code == 401
    assert "kapatıldı" in str(exc.value.detail)
    assert not logged
    assert "InvalidAudienceError" not in caplog.text
    assert "Beklenmeyen hata" not in caplog.text
