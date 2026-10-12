"""Süper admin TOTP 2FA, kısa oturum ve Secure çerez bayrakları."""
from __future__ import annotations

import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import jwt
import pyotp
import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ["JWT_SECRET"] = "test-superadmin-2fa-jwt-secret-not-default-32b"
os.environ["CREDENTIAL_ENCRYPTION_KEY"] = Fernet.generate_key().decode()

import auth_utils  # noqa: E402
import comm_service  # noqa: E402
import rbac  # noqa: E402
import superadmin_2fa as sa2fa  # noqa: E402

comm_service.reset_fernet_for_tests()


def test_cookie_secure_https_and_forwarded():
    class R:
        def __init__(self, url="", proto=None):
            self.url = url
            self.headers = {"x-forwarded-proto": proto} if proto else {}

    assert auth_utils.cookie_secure_flag(R("https://tamkobi.com/api")) is True
    assert auth_utils.cookie_secure_flag(R("http://127.0.0.1:8000/api")) is False
    assert auth_utils.cookie_secure_flag(R("http://backend/", "https")) is True
    assert auth_utils.cookie_secure_flag(R("http://backend/", "http")) is False


def test_auth_cookie_kwargs_secure_only_on_https():
    class R:
        def __init__(self, secure):
            self.url = "https://x" if secure else "http://x"
            self.headers = {}

    kw = auth_utils.auth_cookie_kwargs(R(True), max_age=100)
    assert kw["secure"] is True
    assert kw["samesite"] == "lax"
    assert kw["httponly"] is True
    assert kw["max_age"] == 100

    kw2 = auth_utils.auth_cookie_kwargs(R(False))
    assert "secure" not in kw2
    assert "max_age" not in kw2


def test_superadmin_access_token_shorter_than_tenant():
    sa = auth_utils.create_access_token("u1", "a@b.com", "admin", is_super_admin=True)
    tenant = auth_utils.create_access_token("u2", "t@b.com", "admin", is_super_admin=False)
    psa = jwt.decode(sa, auth_utils.get_jwt_secret(), algorithms=["HS256"])
    pt = jwt.decode(tenant, auth_utils.get_jwt_secret(), algorithms=["HS256"])
    now = datetime.now(timezone.utc).timestamp()
    assert psa["exp"] - now <= auth_utils.SUPERADMIN_ACCESS_SECONDS + 30
    assert pt["exp"] - now >= auth_utils.TENANT_ACCESS_SECONDS - 60
    assert psa.get("sa") is True
    assert "sa" not in pt


def test_access_cookie_max_age_sa_vs_tenant():
    assert auth_utils.access_cookie_max_age(is_super_admin=True, remember=True) == auth_utils.SUPERADMIN_ACCESS_SECONDS
    assert auth_utils.access_cookie_max_age(is_super_admin=False, remember=True) == auth_utils.TENANT_ACCESS_SECONDS
    assert auth_utils.access_cookie_max_age(is_super_admin=True, remember=False) is None


def test_totp_encrypt_roundtrip():
    secret = sa2fa.generate_totp_secret()
    enc = sa2fa.encrypt_totp_secret(secret)
    assert enc != secret
    assert sa2fa.decrypt_totp_secret(enc) == secret


def test_totp_verify_success_and_fail():
    secret = sa2fa.generate_totp_secret()
    code = pyotp.TOTP(secret).now()
    assert sa2fa.verify_totp(secret, code) is True
    assert sa2fa.verify_totp(secret, "000000") is False
    assert sa2fa.verify_totp(secret, "abc") is False


def test_recovery_codes_single_use():
    plain, hashes = sa2fa.generate_recovery_codes(10)
    assert len(plain) == 10
    matched = sa2fa.verify_recovery_code(plain[0], hashes)
    assert matched == hashes[0]
    remaining = [h for h in hashes if h != matched]
    assert sa2fa.verify_recovery_code(plain[0], remaining) is None
    assert sa2fa.verify_recovery_code(plain[1], remaining) == hashes[1]


def test_pending_2fa_token_roundtrip():
    tok = sa2fa.create_pending_2fa_token("uid1", "sa@tamkobi.com", remember=True)
    p = sa2fa.decode_pending_2fa_token(tok)
    assert p["sub"] == "uid1"
    assert p["type"] == sa2fa.PENDING_2FA_TYPE
    assert p["remember"] is True


def test_needs_2fa_setup_flag():
    user = {"is_super_admin": True, "totp_enabled": False}
    assert sa2fa.needs_2fa_setup(user, {"require_superadmin_2fa": True}) is True
    assert sa2fa.needs_2fa_setup(user, {"require_superadmin_2fa": False}) is False
    enabled = {"is_super_admin": True, "totp_enabled": True, "totp_secret": "x"}
    assert sa2fa.needs_2fa_setup(enabled, {"require_superadmin_2fa": True}) is False


def test_qr_and_uri():
    secret = sa2fa.generate_totp_secret()
    uri = sa2fa.provisioning_uri(secret, "admin@tamkobi.com")
    assert uri.startswith("otpauth://totp/")
    data = sa2fa.qr_png_data_url(uri)
    assert data.startswith("data:image/png;base64,")


def test_2fa_verify_allowlisted():
    assert rbac.is_public_api_path("/api/auth/2fa/verify", "POST")
    assert rbac.is_public_api_path("/api/auth/2fa/setup/start", "POST") is False


def test_reset_script_requires_confirm():
    script = Path(__file__).resolve().parents[1] / "scripts" / "reset_superadmin_2fa.py"
    text = script.read_text(encoding="utf-8")
    assert "CONFIRM" in text
    assert 'CONFIRM=yes' in text or "CONFIRM" in text
    assert "totp_enabled" in text


def test_login_sets_secure_cookie_source():
    root = Path(__file__).resolve().parents[1]
    assert "auth_cookie_kwargs" in (root / "server.py").read_text()
    assert "auth_cookie_kwargs" in (root / "saas_extras.py").read_text()
    assert "sa_return" in (root / "saas_extras.py").read_text()
    assert "cookie_secure_flag" in (root / "auth_utils.py").read_text()


def test_system_login_remember_default_off():
    text = Path(__file__).resolve().parents[2].joinpath("frontend/src/pages/SystemLoginPage.jsx").read_text()
    assert "useState(false)" in text
    assert "sys-remember" in text


def test_require_superadmin_2fa_in_settings_defaults():
    import saas_billing
    assert "require_superadmin_2fa" in saas_billing.DEFAULT_SETTINGS
    assert saas_billing.DEFAULT_SETTINGS["require_superadmin_2fa"] is False


def _fake_http_request(url="http://127.0.0.1:8000/api"):
    req = MagicMock()
    req.headers = {}
    req.cookies = {}
    req.client = MagicMock(host="127.0.0.1")
    req.url = url
    return req


class _FakeResponse:
    def __init__(self):
        self.cookies = []

    def set_cookie(self, **kw):
        self.cookies.append(kw)


def test_login_requires_2fa_when_enabled(monkeypatch):
    import server

    secret = sa2fa.generate_totp_secret()
    user = {
        "_id": "sa1",
        "email": "sa@tamkobi.com",
        "name": "SA",
        "password_hash": auth_utils.hash_password("Secret123!"),
        "is_super_admin": True,
        "is_active": True,
        "totp_enabled": True,
        "totp_secret": sa2fa.encrypt_totp_secret(secret),
        "role": "admin",
        "company_ids": [],
        "active_company_id": "c1",
    }
    mock_db = MagicMock()
    mock_db.login_attempts = MagicMock()
    mock_db.login_attempts.find_one = AsyncMock(return_value=None)
    mock_db.login_attempts.delete_one = AsyncMock()
    mock_db.login_attempts.update_one = AsyncMock()
    mock_db.users = MagicMock()
    mock_db.users.find_one = AsyncMock(return_value=user)
    mock_db.users.update_one = AsyncMock()
    monkeypatch.setattr(server, "db", mock_db)

    class Req:
        email = "sa@tamkobi.com"
        password = "Secret123!"
        remember = False

    resp = _FakeResponse()
    out = asyncio.run(server.login(Req(), _fake_http_request(), resp))
    assert out["requires_2fa"] is True
    assert out["pending_token"]
    assert resp.cookies == []


def test_2fa_verify_wrong_code(monkeypatch):
    import server

    secret = sa2fa.generate_totp_secret()
    user = {
        "_id": "sa1",
        "email": "sa@tamkobi.com",
        "name": "SA",
        "is_super_admin": True,
        "is_active": True,
        "totp_enabled": True,
        "totp_secret": sa2fa.encrypt_totp_secret(secret),
        "totp_recovery_hashes": [],
        "role": "admin",
        "company_ids": [],
        "active_company_id": "c1",
    }
    mock_db = MagicMock()
    mock_db.users = MagicMock()
    mock_db.users.find_one = AsyncMock(return_value=user)
    mock_db.users.update_one = AsyncMock()
    monkeypatch.setattr(server, "db", mock_db)
    pending = sa2fa.create_pending_2fa_token("sa1", "sa@tamkobi.com")

    with pytest.raises(HTTPException) as e:
        asyncio.run(
            server.auth_2fa_verify(
                server.TwoFAVerifyRequest(pending_token=pending, code="000000"),
                _fake_http_request(),
                _FakeResponse(),
            )
        )
    assert e.value.status_code == 401


def test_2fa_verify_success_and_recovery_consume(monkeypatch):
    import server

    secret = sa2fa.generate_totp_secret()
    plain, hashes = sa2fa.generate_recovery_codes(2)
    user = {
        "_id": "sa1",
        "email": "sa@tamkobi.com",
        "name": "SA",
        "is_super_admin": True,
        "is_active": True,
        "totp_enabled": True,
        "totp_secret": sa2fa.encrypt_totp_secret(secret),
        "totp_recovery_hashes": list(hashes),
        "role": "admin",
        "company_ids": ["c1"],
        "active_company_id": "c1",
        "preferences": {},
    }
    mock_db = MagicMock()
    mock_db.users = MagicMock()
    mock_db.users.find_one = AsyncMock(return_value=user)
    mock_db.users.update_one = AsyncMock()
    mock_db.companies = MagicMock()
    mock_db.companies.find = MagicMock(return_value=MagicMock(to_list=AsyncMock(return_value=[])))
    monkeypatch.setattr(server, "db", mock_db)
    monkeypatch.setattr(server.rbac, "role_for", AsyncMock(return_value={"name": "admin", "permissions": {}}))
    monkeypatch.setattr(server.attendance, "employee_for_user", AsyncMock(return_value=None))
    monkeypatch.setattr(server.user_numbers, "ensure_user_number", AsyncMock(return_value=1))
    monkeypatch.setattr(server.saas, "effective", AsyncMock(return_value={}))
    monkeypatch.setattr(server.saas_billing, "settings", AsyncMock(return_value={"require_superadmin_2fa": False}))

    code = pyotp.TOTP(secret).now()
    pending = sa2fa.create_pending_2fa_token("sa1", "sa@tamkobi.com", remember=True)
    resp = _FakeResponse()
    out = asyncio.run(
        server.auth_2fa_verify(
            server.TwoFAVerifyRequest(pending_token=pending, code=code),
            _fake_http_request(),
            resp,
        )
    )
    assert out["user"]["is_super_admin"] is True
    assert out["token"]
    access = next(c for c in resp.cookies if c.get("key") == "access_token")
    assert access.get("max_age") == auth_utils.SUPERADMIN_ACCESS_SECONDS
    assert "secure" not in access

    user["totp_recovery_hashes"] = list(hashes)
    pending2 = sa2fa.create_pending_2fa_token("sa1", "sa@tamkobi.com")
    out2 = asyncio.run(
        server.auth_2fa_verify(
            server.TwoFAVerifyRequest(pending_token=pending2, code=plain[0]),
            _fake_http_request(),
            _FakeResponse(),
        )
    )
    assert out2["token"]
    set_doc = mock_db.users.update_one.call_args[0][1]["$set"]
    assert hashes[0] not in set_doc["totp_recovery_hashes"]


def test_setup_confirm_emits_recovery_once(monkeypatch):
    import server

    secret = sa2fa.generate_totp_secret()
    user = {
        "_id": "sa1",
        "email": "sa@tamkobi.com",
        "name": "SA",
        "is_super_admin": True,
        "totp_enabled": False,
        "totp_secret": sa2fa.encrypt_totp_secret(secret),
    }
    mock_db = MagicMock()
    mock_db.users = MagicMock()
    mock_db.users.find_one = AsyncMock(return_value=user)
    mock_db.users.update_one = AsyncMock()
    monkeypatch.setattr(server, "db", mock_db)

    code = pyotp.TOTP(secret).now()
    out = asyncio.run(
        server.auth_2fa_setup_confirm(server.TwoFASetupConfirmRequest(code=code), user)
    )
    assert out["totp_enabled"] is True
    assert len(out["recovery_codes"]) == 10


def test_https_login_sets_secure_flag(monkeypatch):
    import server

    user = {
        "_id": "sa1",
        "email": "sa@tamkobi.com",
        "name": "SA",
        "password_hash": auth_utils.hash_password("Secret123!"),
        "is_super_admin": True,
        "is_active": True,
        "totp_enabled": False,
        "role": "admin",
        "company_ids": [],
        "active_company_id": "c1",
        "preferences": {},
    }
    mock_db = MagicMock()
    mock_db.login_attempts = MagicMock()
    mock_db.login_attempts.find_one = AsyncMock(return_value=None)
    mock_db.login_attempts.delete_one = AsyncMock()
    mock_db.users = MagicMock()
    mock_db.users.find_one = AsyncMock(return_value=user)
    mock_db.users.update_one = AsyncMock()
    mock_db.companies = MagicMock()
    mock_db.companies.find = MagicMock(return_value=MagicMock(to_list=AsyncMock(return_value=[])))
    monkeypatch.setattr(server, "db", mock_db)
    monkeypatch.setattr(server.rbac, "role_for", AsyncMock(return_value={"name": "admin", "permissions": {}}))
    monkeypatch.setattr(server.attendance, "employee_for_user", AsyncMock(return_value=None))
    monkeypatch.setattr(server.user_numbers, "ensure_user_number", AsyncMock(return_value=1))
    monkeypatch.setattr(server.saas, "effective", AsyncMock(return_value={}))
    monkeypatch.setattr(
        server.saas_billing,
        "settings",
        AsyncMock(return_value={"require_superadmin_2fa": True}),
    )

    class Req:
        email = "sa@tamkobi.com"
        password = "Secret123!"
        remember = True

    req = _fake_http_request("https://tamkobi.com/api/auth/login")
    resp = _FakeResponse()
    out = asyncio.run(server.login(Req(), req, resp))
    assert out["requires_2fa_setup"] is True
    access = next(c for c in resp.cookies if c.get("key") == "access_token")
    assert access.get("secure") is True
    assert access.get("samesite") == "lax"
    assert access.get("max_age") == auth_utils.SUPERADMIN_ACCESS_SECONDS
