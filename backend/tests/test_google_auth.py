"""Google ID token ile giriş / kayıt."""
from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ["JWT_SECRET"] = "test-google-auth-jwt-secret-not-default-32bytes!!"
os.environ["CREDENTIAL_ENCRYPTION_KEY"] = Fernet.generate_key().decode()
os.environ["GOOGLE_CLIENT_ID"] = "359977032625-m1essfnlouaa4tmh0jsqfk8dca0fn67o.apps.googleusercontent.com"

import google_auth  # noqa: E402
import superadmin_2fa as sa2fa  # noqa: E402


class _FakeResponse:
    def __init__(self):
        self.cookies = {}

    def set_cookie(self, **kw):
        self.cookies[kw.get("key")] = kw.get("value")


def _fake_request(host="app.tamkobi.com"):
    class R:
        def __init__(self):
            self.headers = {"host": host, "x-forwarded-proto": "https"}
            self.client = MagicMock(host="127.0.0.1")
            self.url = MagicMock()
            self.url.path = "/api/auth/google"
            self.url.scheme = "https"
            self.url.hostname = host

    return R()


def _idinfo(**over):
    base = {
        "iss": "accounts.google.com",
        "aud": os.environ["GOOGLE_CLIENT_ID"],
        "email": "yeni@example.com",
        "email_verified": True,
        "sub": "google-sub-123",
        "name": "Yeni Kullanıcı",
        "picture": "https://example.com/p.png",
    }
    base.update(over)
    return base


def test_google_not_configured_404(monkeypatch):
    monkeypatch.delenv("GOOGLE_CLIENT_ID", raising=False)
    assert google_auth.google_auth_configured() is False
    import server
    with pytest.raises(HTTPException) as ei:
        asyncio.run(server.auth_google({}, _fake_request(), _FakeResponse()))
    assert ei.value.status_code == 404


def test_verify_invalid_token(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", os.environ["GOOGLE_CLIENT_ID"])

    def boom(*a, **k):
        raise ValueError("Token used too late")

    with patch.object(google_auth.google_id_token, "verify_oauth2_token", side_effect=boom):
        with pytest.raises(HTTPException) as ei:
            google_auth.verify_google_id_token("bad.token")
    assert ei.value.status_code == 401
    assert "Geçersiz" in str(ei.value.detail)


def test_verify_wrong_aud(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", os.environ["GOOGLE_CLIENT_ID"])
    info = _idinfo(aud="other-client.apps.googleusercontent.com")

    def fake_verify(token, req, audience=None):
        return info

    with patch.object(google_auth.google_id_token, "verify_oauth2_token", side_effect=fake_verify):
        # verify_oauth2_token already checks aud in real lib; we simulate post-check
        with patch.object(google_auth.google_id_token, "verify_oauth2_token", return_value=info):
            with pytest.raises(HTTPException) as ei:
                google_auth.verify_google_id_token("tok")
    assert ei.value.status_code == 401
    assert "istemci" in str(ei.value.detail).lower() or "eşleşmiyor" in str(ei.value.detail).lower()


def test_verify_email_not_verified(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", os.environ["GOOGLE_CLIENT_ID"])
    info = _idinfo(email_verified=False)
    with patch.object(google_auth.google_id_token, "verify_oauth2_token", return_value=info):
        with pytest.raises(HTTPException) as ei:
            google_auth.verify_google_id_token("tok")
    assert ei.value.status_code == 401
    assert "doğrulanmamış" in str(ei.value.detail).lower()


def test_verify_wrong_issuer(monkeypatch):
    monkeypatch.setenv("GOOGLE_CLIENT_ID", os.environ["GOOGLE_CLIENT_ID"])
    info = _idinfo(iss="evil.example.com")
    with patch.object(google_auth.google_id_token, "verify_oauth2_token", return_value=info):
        with pytest.raises(HTTPException) as ei:
            google_auth.verify_google_id_token("tok")
    assert ei.value.status_code == 401


def _mock_db_empty():
    db = MagicMock()
    db.users = MagicMock()
    db.users.find_one = AsyncMock(return_value=None)
    db.users.insert_one = AsyncMock()
    db.users.update_one = AsyncMock()
    db.companies = MagicMock()
    db.companies.insert_one = AsyncMock()
    db.companies.find = MagicMock(return_value=MagicMock(to_list=AsyncMock(return_value=[])))
    db.saas_plans = MagicMock()
    db.saas_plans.find_one = AsyncMock(return_value={"_id": "plan_trial", "name": "Deneme", "is_public": True})
    db.login_attempts = MagicMock()
    db.login_attempts.find_one = AsyncMock(return_value=None)
    db.login_attempts.update_one = AsyncMock()
    db.login_attempts.delete_one = AsyncMock()
    return db


def test_existing_user_login(monkeypatch):
    import server
    monkeypatch.setenv("GOOGLE_CLIENT_ID", os.environ["GOOGLE_CLIENT_ID"])
    user = {
        "_id": "usr1",
        "email": "var@example.com",
        "name": "Var Olan",
        "role": "admin",
        "company_ids": ["c1"],
        "active_company_id": "c1",
        "is_active": True,
        "is_super_admin": False,
    }
    db = _mock_db_empty()
    db.users.find_one = AsyncMock(return_value=user)
    db.companies.find = MagicMock(return_value=MagicMock(to_list=AsyncMock(return_value=[{"_id": "c1", "name": "Co"}])))
    monkeypatch.setattr(server, "db", db)
    monkeypatch.setattr(server.rbac, "role_for", AsyncMock(return_value={"name": "Yönetici", "permissions": {}}))
    monkeypatch.setattr(server.rbac, "role_features", lambda *a, **k: {})
    monkeypatch.setattr(server.attendance, "employee_for_user", AsyncMock(return_value=None))
    monkeypatch.setattr(server.user_numbers, "ensure_user_number", AsyncMock(return_value=1))
    monkeypatch.setattr(server.saas, "effective", AsyncMock(return_value={}))
    monkeypatch.setattr(server.saas_billing, "settings", AsyncMock(return_value={}))

    info = _idinfo(email="var@example.com", sub="sub-var")
    with patch.object(google_auth.google_id_token, "verify_oauth2_token", return_value=info):
        out = asyncio.run(server.auth_google({"credential": "tok", "remember": True}, _fake_request(), _FakeResponse()))
    assert out.get("user", {}).get("email") == "var@example.com"
    assert out.get("token")
    assert not out.get("needs_profile")


def test_new_user_needs_profile(monkeypatch):
    import server
    monkeypatch.setenv("GOOGLE_CLIENT_ID", os.environ["GOOGLE_CLIENT_ID"])
    db = _mock_db_empty()
    monkeypatch.setattr(server, "db", db)
    info = _idinfo(email="yeni@example.com")
    with patch.object(google_auth.google_id_token, "verify_oauth2_token", return_value=info):
        out = asyncio.run(server.auth_google({"credential": "tok"}, _fake_request(), _FakeResponse()))
    assert out["needs_profile"] is True
    assert out["pending_token"]
    assert out["email"] == "yeni@example.com"
    assert "company_name" in out["missing"] and "phone" in out["missing"]


def test_new_user_signup_complete(monkeypatch):
    import server
    monkeypatch.setenv("GOOGLE_CLIENT_ID", os.environ["GOOGLE_CLIENT_ID"])
    db = _mock_db_empty()
    created = {}

    async def insert_user(doc):
        created["user"] = doc
        db.users.find_one = AsyncMock(return_value=doc)

    async def insert_co(doc):
        created["company"] = doc

    db.users.insert_one = AsyncMock(side_effect=insert_user)
    db.companies.insert_one = AsyncMock(side_effect=insert_co)
    db.companies.find = MagicMock(return_value=MagicMock(to_list=AsyncMock(return_value=[])))
    monkeypatch.setattr(server, "db", db)
    monkeypatch.setattr(server.rbac, "ensure_roles", AsyncMock())
    monkeypatch.setattr(server.rbac, "role_for", AsyncMock(return_value={"name": "Yönetici", "permissions": {}}))
    monkeypatch.setattr(server.rbac, "role_features", lambda *a, **k: {})
    monkeypatch.setattr(server.attendance, "employee_for_user", AsyncMock(return_value=None))
    monkeypatch.setattr(server.user_numbers, "next_user_number", AsyncMock(return_value=42))
    monkeypatch.setattr(server.user_numbers, "ensure_user_number", AsyncMock(return_value=42))
    monkeypatch.setattr(server.company_numbers, "next_company_no", AsyncMock(return_value=100001))
    monkeypatch.setattr(server.saas, "start_trial", AsyncMock())
    monkeypatch.setattr(server.saas, "effective", AsyncMock(return_value={"plan_name": "Deneme", "days_left": 14}))
    monkeypatch.setattr(server.saas_billing, "settings", AsyncMock(return_value={"trial_days": 14, "trial_plan_id": "plan_trial"}))
    monkeypatch.setattr(server.saas, "normalize_module_keys", lambda x: [])
    import demo
    monkeypatch.setattr(demo, "seed_for_new_company", AsyncMock())

    pending = google_auth.create_pending_google_token(
        google_sub="google-sub-123", email="yeni@example.com", name="Yeni Kullanıcı",
    )
    out = asyncio.run(server.auth_google({
        "pending_token": pending,
        "company_name": "Yeni AŞ",
        "phone": "05551234567",
        "accept_mss": True,
        "accept_obf": True,
        "accept_kvkk": True,
    }, _fake_request(), _FakeResponse()))
    assert created["user"]["auth_provider"] == "google"
    assert created["user"]["google_sub"] == "google-sub-123"
    assert created["company"]["name"] == "Yeni AŞ"
    assert created["company"]["_id"].startswith("comp_")
    assert created["company"]["company_no"] == 100001
    assert out.get("status") == "success" or out.get("user")


def test_super_admin_rejected(monkeypatch):
    import server
    monkeypatch.setenv("GOOGLE_CLIENT_ID", os.environ["GOOGLE_CLIENT_ID"])
    user = {
        "_id": "sa1",
        "email": "sa@tamkobi.com",
        "name": "SA",
        "role": "admin",
        "is_super_admin": True,
        "is_active": True,
        "totp_enabled": True,
        "totp_secret": "x",
    }
    db = _mock_db_empty()
    db.users.find_one = AsyncMock(return_value=user)
    monkeypatch.setattr(server, "db", db)
    info = _idinfo(email="sa@tamkobi.com", sub="sa-sub")
    with patch.object(google_auth.google_id_token, "verify_oauth2_token", return_value=info):
        with pytest.raises(HTTPException) as ei:
            asyncio.run(server.auth_google({"credential": "tok"}, _fake_request(), _FakeResponse()))
    assert ei.value.status_code == 403
    assert "Süper admin" in str(ei.value.detail)


def test_user_with_2fa_gets_pending(monkeypatch):
    import server
    monkeypatch.setenv("GOOGLE_CLIENT_ID", os.environ["GOOGLE_CLIENT_ID"])
    secret = sa2fa.generate_totp_secret()
    user = {
        "_id": "u2fa",
        "email": "mfa@example.com",
        "name": "MFA User",
        "role": "admin",
        "company_ids": ["c1"],
        "active_company_id": "c1",
        "is_active": True,
        "is_super_admin": False,
        "totp_enabled": True,
        "totp_secret": sa2fa.encrypt_totp_secret(secret),
    }
    db = _mock_db_empty()
    db.users.find_one = AsyncMock(return_value=user)
    monkeypatch.setattr(server, "db", db)
    info = _idinfo(email="mfa@example.com", sub="mfa-sub")
    with patch.object(google_auth.google_id_token, "verify_oauth2_token", return_value=info):
        out = asyncio.run(server.auth_google({"credential": "tok"}, _fake_request(), _FakeResponse()))
    assert out["requires_2fa"] is True
    assert out["pending_token"]


def test_public_allowlist_includes_google():
    import rbac
    assert "/api/auth/google" in rbac.PUBLIC_API_ALLOWLIST
    assert rbac.is_public_api_path("/api/auth/google", "POST") is True


def test_google_sub_mismatch_403(monkeypatch):
    """Kullanıcıda kayıtlı google_sub farklıysa 403."""
    import server
    monkeypatch.setenv("GOOGLE_CLIENT_ID", os.environ["GOOGLE_CLIENT_ID"])
    user = {
        "_id": "usr1",
        "email": "var@example.com",
        "name": "Var Olan",
        "role": "admin",
        "company_ids": ["c1"],
        "active_company_id": "c1",
        "is_active": True,
        "is_super_admin": False,
        "google_sub": "stored-sub-aaa",
    }
    db = _mock_db_empty()
    db.users.find_one = AsyncMock(return_value=user)
    monkeypatch.setattr(server, "db", db)
    info = _idinfo(email="var@example.com", sub="different-sub-bbb")
    with patch.object(google_auth.google_id_token, "verify_oauth2_token", return_value=info):
        with pytest.raises(HTTPException) as ei:
            asyncio.run(server.auth_google({"credential": "tok"}, _fake_request(), _FakeResponse()))
    assert ei.value.status_code == 403
    assert "Google hesabına" in str(ei.value.detail)


def test_google_ip_rate_limit_429(monkeypatch):
    import server
    monkeypatch.setenv("GOOGLE_CLIENT_ID", os.environ["GOOGLE_CLIENT_ID"])
    db = _mock_db_empty()
    db.login_attempts.find_one = AsyncMock(return_value={"identifier": "x", "count": 20})
    monkeypatch.setattr(server, "db", db)
    with pytest.raises(HTTPException) as ei:
        asyncio.run(server.auth_google({"credential": "tok"}, _fake_request(), _FakeResponse()))
    assert ei.value.status_code == 429


def test_google_signup_rate_limit_429(monkeypatch):
    import server
    monkeypatch.setenv("GOOGLE_CLIENT_ID", os.environ["GOOGLE_CLIENT_ID"])
    db = _mock_db_empty()
    # Dakikalık limit geçilsin, saatlik signup limitinde takılsın
    calls = {"n": 0}

    async def find_one(q):
        ident = (q or {}).get("identifier") or ""
        if ident.startswith("google_signup:"):
            return {"identifier": ident, "count": 5}
        return None

    db.login_attempts.find_one = AsyncMock(side_effect=find_one)
    monkeypatch.setattr(server, "db", db)
    pending = google_auth.create_pending_google_token(
        google_sub="google-sub-123", email="yeni@example.com", name="Yeni Kullanıcı",
    )
    with pytest.raises(HTTPException) as ei:
        asyncio.run(server.auth_google({
            "pending_token": pending,
            "company_name": "Yeni AŞ",
            "phone": "05551234567",
            "accept_mss": True,
            "accept_obf": True,
            "accept_kvkk": True,
        }, _fake_request(), _FakeResponse()))
    assert ei.value.status_code == 429


def test_verify_google_id_token_via_to_thread(monkeypatch):
    """credential doğrulaması event loop dışında (to_thread) çalışır."""
    import server
    monkeypatch.setenv("GOOGLE_CLIENT_ID", os.environ["GOOGLE_CLIENT_ID"])
    db = _mock_db_empty()
    monkeypatch.setattr(server, "db", db)
    info = _idinfo(email="yeni@example.com")
    seen = {"threaded": False}

    real_to_thread = asyncio.to_thread

    async def spy_to_thread(fn, *a, **k):
        seen["threaded"] = True
        return await real_to_thread(fn, *a, **k)

    with patch.object(google_auth.google_id_token, "verify_oauth2_token", return_value=info):
        with patch.object(asyncio, "to_thread", side_effect=spy_to_thread):
            out = asyncio.run(server.auth_google({"credential": "tok"}, _fake_request(), _FakeResponse()))
    assert seen["threaded"] is True
    assert out["needs_profile"] is True


def test_enforce_google_ip_rate_unit():
    db = MagicMock()
    db.login_attempts.find_one = AsyncMock(return_value={"count": 19})
    db.login_attempts.update_one = AsyncMock()
    asyncio.run(google_auth.enforce_google_ip_rate(db, "1.2.3.4"))
    db.login_attempts.update_one.assert_awaited()
    db.login_attempts.find_one = AsyncMock(return_value={"count": 20})
    with pytest.raises(HTTPException) as ei:
        asyncio.run(google_auth.enforce_google_ip_rate(db, "1.2.3.4"))
    assert ei.value.status_code == 429
