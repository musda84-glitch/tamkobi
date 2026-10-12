"""Süper admin TOTP 2FA, kısa oturum ve Secure çerez bayrakları."""
from __future__ import annotations

import asyncio
import os
import sys
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, call

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


def test_auth_cookie_kwargs_secure_only_on_https():
    class R:
        def __init__(self, secure):
            self.url = "https://x" if secure else "http://x"
            self.headers = {}

    kw = auth_utils.auth_cookie_kwargs(R(True), max_age=100)
    assert kw["secure"] is True and kw["samesite"] == "lax"
    assert "secure" not in auth_utils.auth_cookie_kwargs(R(False))


def test_superadmin_access_token_shorter_than_tenant():
    sa = auth_utils.create_access_token("u1", "a@b.com", "admin", is_super_admin=True, mfa=True)
    tenant = auth_utils.create_access_token("u2", "t@b.com", "admin", is_super_admin=False)
    psa = jwt.decode(sa, auth_utils.get_jwt_secret(), algorithms=["HS256"])
    pt = jwt.decode(tenant, auth_utils.get_jwt_secret(), algorithms=["HS256"])
    now = datetime.now(timezone.utc).timestamp()
    assert psa["exp"] - now <= auth_utils.SUPERADMIN_ACCESS_SECONDS + 30
    assert pt["exp"] - now >= auth_utils.TENANT_ACCESS_SECONDS - 60
    assert psa.get("sa") is True and psa.get("mfa") is True and "iat" in psa
    assert "mfa" not in pt


def test_access_cookie_max_age_sa_vs_tenant():
    assert auth_utils.access_cookie_max_age(is_super_admin=True, remember=True) == auth_utils.SUPERADMIN_ACCESS_SECONDS
    assert auth_utils.access_cookie_max_age(is_super_admin=False, remember=True) == auth_utils.TENANT_ACCESS_SECONDS
    assert auth_utils.access_cookie_max_age(is_super_admin=True, remember=False) is None


def test_totp_encrypt_roundtrip():
    secret = sa2fa.generate_totp_secret()
    enc = sa2fa.encrypt_totp_secret(secret)
    assert sa2fa.decrypt_totp_secret(enc) == secret


def test_totp_verify_success_and_fail():
    secret = sa2fa.generate_totp_secret()
    code = pyotp.TOTP(secret).now()
    assert sa2fa.verify_totp(secret, code) is True
    assert sa2fa.verify_totp(secret, "000000") is False


def test_matching_totp_counter():
    secret = sa2fa.generate_totp_secret()
    code = pyotp.TOTP(secret).now()
    counter = sa2fa.matching_totp_counter(secret, code)
    assert counter is not None
    assert counter == int(time.time()) // 30 or abs(counter - int(time.time()) // 30) <= 1


def test_recovery_codes_single_use():
    plain, hashes = sa2fa.generate_recovery_codes(10)
    matched = sa2fa.verify_recovery_code(plain[0], hashes)
    remaining = [h for h in hashes if h != matched]
    assert sa2fa.verify_recovery_code(plain[0], remaining) is None


def test_pending_2fa_token_roundtrip():
    tok, jti = sa2fa.create_pending_2fa_token("uid1", "sa@tamkobi.com", remember=True)
    p = sa2fa.decode_pending_2fa_token(tok)
    assert p["sub"] == "uid1" and p["jti"] == jti and p["remember"] is True


def test_needs_2fa_setup_flag():
    assert sa2fa.needs_2fa_setup({"is_super_admin": True, "totp_enabled": False}, {"require_superadmin_2fa": True})
    assert not sa2fa.needs_2fa_setup({"is_super_admin": True, "totp_enabled": True, "totp_secret": "x"}, {"require_superadmin_2fa": True})


def test_qr_and_uri():
    uri = sa2fa.provisioning_uri(sa2fa.generate_totp_secret(), "admin@tamkobi.com")
    assert uri.startswith("otpauth://totp/")
    assert sa2fa.qr_png_data_url(uri).startswith("data:image/png;base64,")


def test_2fa_verify_allowlisted():
    assert rbac.is_public_api_path("/api/auth/2fa/verify", "POST")
    assert rbac.is_public_api_path("/api/auth/2fa/setup/start", "POST") is False


def test_reset_script_requires_confirm_and_live_cmd():
    text = (Path(__file__).resolve().parents[1] / "scripts" / "reset_superadmin_2fa.py").read_text()
    assert "CONFIRM=yes" in text
    assert "/var/www/tamkobi.com/backend" in text
    assert "close_async" in text
    assert "2fa:" in text


def test_login_sets_secure_cookie_source():
    root = Path(__file__).resolve().parents[1]
    assert "auth_cookie_kwargs" in (root / "server.py").read_text()
    assert "auth_cookie_kwargs" in (root / "rbac.py").read_text()


def test_system_login_remember_default_off():
    text = Path(__file__).resolve().parents[2].joinpath("frontend/src/pages/SystemLoginPage.jsx").read_text()
    assert "useState(false)" in text


def test_require_superadmin_2fa_in_settings_defaults():
    import saas_billing
    assert saas_billing.DEFAULT_SETTINGS["require_superadmin_2fa"] is False


def test_web_auth_context_handles_requires_2fa():
    text = Path(__file__).resolve().parents[2].joinpath("frontend/src/context/AuthContext.jsx").read_text()
    assert "requires_2fa" in text
    assert "/sistem/giris" in text


def test_mobile_auth_context_blocks_sa_2fa():
    text = Path(__file__).resolve().parents[2].joinpath("mobile/src/auth/AuthContext.tsx").read_text()
    assert "requires_2fa" in text
    assert "Platform yöneticisi web panelinden giriş yapmalı" in text


def _fake_http_request(url="http://127.0.0.1:8000/api", proto=None):
    req = MagicMock()
    req.headers = {"x-forwarded-proto": proto} if proto else {}
    req.cookies = {}
    req.client = MagicMock(host="127.0.0.1")
    req.url = url
    return req


class _FakeResponse:
    def __init__(self):
        self.cookies = []

    def set_cookie(self, **kw):
        self.cookies.append(kw)


class _UpdateResult:
    def __init__(self, matched=1, modified=1):
        self.matched_count = matched
        self.modified_count = modified


def _sa_user(**extra):
    secret = sa2fa.generate_totp_secret()
    base = {
        "_id": "sa1",
        "email": "sa@tamkobi.com",
        "name": "SA",
        "password_hash": auth_utils.hash_password("Secret123!"),
        "is_super_admin": True,
        "is_active": True,
        "totp_enabled": True,
        "totp_secret": sa2fa.encrypt_totp_secret(secret),
        "totp_recovery_hashes": [],
        "totp_enabled_at": datetime.now(timezone.utc).isoformat(),
        "pending_2fa_jti": "",
        "pending_2fa_attempts": 0,
        "role": "admin",
        "company_ids": ["c1"],
        "active_company_id": "c1",
        "preferences": {},
    }
    base.update(extra)
    return base, secret


def _mock_db_for_session(user, monkeypatch, server, *, lock_doc=None, update_side_effect=None):
    mock_db = MagicMock()
    mock_db.login_attempts = MagicMock()
    mock_db.login_attempts.find_one = AsyncMock(return_value=lock_doc)
    mock_db.login_attempts.delete_one = AsyncMock()
    mock_db.login_attempts.update_one = AsyncMock()
    mock_db.users = MagicMock()
    mock_db.users.find_one = AsyncMock(return_value=user)
    mock_db.users.update_one = AsyncMock(
        side_effect=update_side_effect or (lambda *a, **k: _UpdateResult())
    )
    mock_db.companies = MagicMock()
    mock_db.companies.find = MagicMock(return_value=MagicMock(to_list=AsyncMock(return_value=[])))
    monkeypatch.setattr(server, "db", mock_db)
    monkeypatch.setattr(server.rbac, "role_for", AsyncMock(return_value={"name": "admin", "permissions": {}}))
    monkeypatch.setattr(server.attendance, "employee_for_user", AsyncMock(return_value=None))
    monkeypatch.setattr(server.user_numbers, "ensure_user_number", AsyncMock(return_value=1))
    monkeypatch.setattr(server.saas, "effective", AsyncMock(return_value={}))
    monkeypatch.setattr(server.saas_billing, "settings", AsyncMock(return_value={"require_superadmin_2fa": False}))
    return mock_db


def test_login_requires_2fa_when_enabled(monkeypatch):
    import server
    user, _ = _sa_user()
    mock_db = MagicMock()
    mock_db.login_attempts = MagicMock()
    mock_db.login_attempts.find_one = AsyncMock(return_value=None)
    mock_db.login_attempts.delete_one = AsyncMock()
    mock_db.users = MagicMock()
    mock_db.users.find_one = AsyncMock(return_value=user)
    mock_db.users.update_one = AsyncMock()
    monkeypatch.setattr(server, "db", mock_db)

    class Req:
        email = "sa@tamkobi.com"
        password = "Secret123!"
        remember = False

    out = asyncio.run(server.login(Req(), _fake_http_request(), _FakeResponse()))
    assert out["requires_2fa"] is True
    assert out["pending_token"]
    # jti kullanıcıya yazıldı
    set_kw = mock_db.users.update_one.call_args_list[-1][0][1]["$set"]
    assert set_kw.get("pending_2fa_jti")
    assert set_kw.get("pending_2fa_attempts") == 0


def test_2fa_verify_wrong_code(monkeypatch):
    import server
    user, secret = _sa_user()
    tok, jti = sa2fa.create_pending_2fa_token("sa1", "sa@tamkobi.com")
    user["pending_2fa_jti"] = jti
    mock_db = _mock_db_for_session(user, monkeypatch, server)

    # after fail, re-fetch user with incremented attempts
    async def find_user(q):
        if "identifier" in (q or {}):
            return None
        return user

    mock_db.users.find_one = AsyncMock(return_value=user)
    mock_db.login_attempts.find_one = AsyncMock(return_value=None)

    with pytest.raises(HTTPException) as e:
        asyncio.run(
            server.auth_2fa_verify(
                server.TwoFAVerifyRequest(pending_token=tok, code="000000"),
                _fake_http_request(),
                _FakeResponse(),
            )
        )
    assert e.value.status_code == 401


def test_2fa_verify_success_and_recovery_consume(monkeypatch):
    import server
    plain, hashes = sa2fa.generate_recovery_codes(2)
    user, secret = _sa_user(totp_recovery_hashes=list(hashes))
    tok, jti = sa2fa.create_pending_2fa_token("sa1", "sa@tamkobi.com", remember=True)
    user["pending_2fa_jti"] = jti
    mock_db = _mock_db_for_session(user, monkeypatch, server)

    code = pyotp.TOTP(secret).now()
    out = asyncio.run(
        server.auth_2fa_verify(
            server.TwoFAVerifyRequest(pending_token=tok, code=code),
            _fake_http_request(),
            _FakeResponse(),
        )
    )
    assert out["user"]["is_super_admin"] is True
    payload = jwt.decode(out["token"], auth_utils.get_jwt_secret(), algorithms=["HS256"])
    assert payload.get("mfa") is True and "iat" in payload

    # recovery: find + $set remaining (dizi-içerir SQL filtresi yok)
    user["pending_2fa_jti"] = jti
    user["totp_recovery_hashes"] = list(hashes)
    tok2, jti2 = sa2fa.create_pending_2fa_token("sa1", "sa@tamkobi.com")
    user["pending_2fa_jti"] = jti2
    mock_db.users.find_one = AsyncMock(return_value=user)
    asyncio.run(
        server.auth_2fa_verify(
            server.TwoFAVerifyRequest(pending_token=tok2, code=plain[0]),
            _fake_http_request(),
            _FakeResponse(),
        )
    )
    set_calls = [
        c for c in mock_db.users.update_one.call_args_list
        if isinstance(c[0][1], dict) and "totp_recovery_hashes" in (c[0][1].get("$set") or {})
    ]
    assert set_calls
    remaining = set_calls[0][0][1]["$set"]["totp_recovery_hashes"]
    assert hashes[0] not in remaining
    assert hashes[1] in remaining
    # Sorunlu desen kalmamalı
    bad = [
        c for c in mock_db.users.update_one.call_args_list
        if isinstance(c[0][0], dict) and "totp_recovery_hashes" in c[0][0]
    ]
    assert not bad


def test_setup_confirm_emits_recovery_once(monkeypatch):
    import server
    secret = sa2fa.generate_totp_secret()
    user = {
        "_id": "sa1", "email": "sa@tamkobi.com", "name": "SA",
        "is_super_admin": True, "totp_enabled": False,
        "totp_secret": sa2fa.encrypt_totp_secret(secret),
    }
    mock_db = MagicMock()
    mock_db.users = MagicMock()
    mock_db.users.find_one = AsyncMock(return_value=user)
    mock_db.users.update_one = AsyncMock(return_value=_UpdateResult())
    monkeypatch.setattr(server, "db", mock_db)
    out = asyncio.run(
        server.auth_2fa_setup_confirm(server.TwoFASetupConfirmRequest(code=pyotp.TOTP(secret).now()), user)
    )
    assert out["totp_enabled"] is True and len(out["recovery_codes"]) == 10
    set_doc = mock_db.users.update_one.call_args[0][1]["$set"]
    assert "totp_last_counter" in set_doc


def test_https_login_sets_secure_flag(monkeypatch):
    import server
    user = {
        "_id": "sa1", "email": "sa@tamkobi.com", "name": "SA",
        "password_hash": auth_utils.hash_password("Secret123!"),
        "is_super_admin": True, "is_active": True, "totp_enabled": False,
        "role": "admin", "company_ids": [], "active_company_id": "c1", "preferences": {},
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
    monkeypatch.setattr(server.saas_billing, "settings", AsyncMock(return_value={"require_superadmin_2fa": True}))

    class Req:
        email = "sa@tamkobi.com"
        password = "Secret123!"
        remember = True

    resp = _FakeResponse()
    out = asyncio.run(server.login(Req(), _fake_http_request("https://tamkobi.com/api/auth/login"), resp))
    assert out["requires_2fa_setup"] is True
    access = next(c for c in resp.cookies if c.get("key") == "access_token")
    assert access.get("secure") is True
    token_p = jwt.decode(out["token"], auth_utils.get_jwt_secret(), algorithms=["HS256"])
    assert token_p.get("mfa") is True


def test_sixth_bad_code_returns_429(monkeypatch):
    """5 hatalı kod sonrası kilit; 6. denemede 429 (şifre kilidi ile aynı model)."""
    import server
    user, _ = _sa_user(pending_2fa_attempts=0)
    tok, jti = sa2fa.create_pending_2fa_token("sa1", "sa@tamkobi.com")
    user["pending_2fa_jti"] = jti
    lock = {
        "identifier": "2fa:sa1",
        "count": 5,
        "last_attempt": datetime.now(timezone.utc).isoformat(),
    }
    _mock_db_for_session(user, monkeypatch, server, lock_doc=lock)

    with pytest.raises(HTTPException) as e:
        asyncio.run(
            server.auth_2fa_verify(
                server.TwoFAVerifyRequest(pending_token=tok, code="000000"),
                _fake_http_request(),
                _FakeResponse(),
            )
        )
    assert e.value.status_code == 429
    assert "15 dakika" in str(e.value.detail)


def test_password_relogin_does_not_clear_2fa_lock(monkeypatch):
    import server
    user, _ = _sa_user()
    mock_db = MagicMock()
    mock_db.login_attempts = MagicMock()
    mock_db.login_attempts.find_one = AsyncMock(return_value=None)
    mock_db.login_attempts.delete_one = AsyncMock()
    mock_db.users = MagicMock()
    mock_db.users.find_one = AsyncMock(return_value=user)
    mock_db.users.update_one = AsyncMock()
    monkeypatch.setattr(server, "db", mock_db)

    class Req:
        email = "sa@tamkobi.com"
        password = "Secret123!"
        remember = False

    asyncio.run(server.login(Req(), _fake_http_request(), _FakeResponse()))
    deleted = [c[0][0].get("identifier") for c in mock_db.login_attempts.delete_one.call_args_list]
    assert "2fa:sa1" not in deleted
    # password identifier may be cleared
    assert any(isinstance(x, str) and x.startswith("127.0.0.1:") for x in deleted) or deleted


def test_totp_replay_rejected(monkeypatch):
    import server
    user, secret = _sa_user()
    code = pyotp.TOTP(secret).now()
    counter = sa2fa.matching_totp_counter(secret, code)
    user["totp_last_counter"] = counter  # already used
    tok, jti = sa2fa.create_pending_2fa_token("sa1", "sa@tamkobi.com")
    user["pending_2fa_jti"] = jti
    mock_db = _mock_db_for_session(user, monkeypatch, server)
    mock_db.login_attempts.find_one = AsyncMock(return_value=None)

    with pytest.raises(HTTPException) as e:
        asyncio.run(
            server.auth_2fa_verify(
                server.TwoFAVerifyRequest(pending_token=tok, code=code),
                _fake_http_request(),
                _FakeResponse(),
            )
        )
    assert e.value.status_code == 401


def test_pending_token_second_use_401(monkeypatch):
    import server
    user, secret = _sa_user()
    tok, jti = sa2fa.create_pending_2fa_token("sa1", "sa@tamkobi.com")
    user["pending_2fa_jti"] = jti
    mock_db = _mock_db_for_session(user, monkeypatch, server)

    code = pyotp.TOTP(secret).now()
    asyncio.run(
        server.auth_2fa_verify(
            server.TwoFAVerifyRequest(pending_token=tok, code=code),
            _fake_http_request(),
            _FakeResponse(),
        )
    )
    # jti cleared after success
    user["pending_2fa_jti"] = ""
    mock_db.users.find_one = AsyncMock(return_value=user)
    with pytest.raises(HTTPException) as e:
        asyncio.run(
            server.auth_2fa_verify(
                server.TwoFAVerifyRequest(pending_token=tok, code=code),
                _fake_http_request(),
                _FakeResponse(),
            )
        )
    assert e.value.status_code == 401


def test_old_sa_token_without_mfa_rejected(monkeypatch):
    user, _ = _sa_user()
    # Pre-2FA-style token: no mfa claim
    old = auth_utils.create_access_token("sa1", "sa@tamkobi.com", "admin", is_super_admin=True, mfa=False)
    mock_db = MagicMock()
    mock_db.users = MagicMock()
    mock_db.users.find_one = AsyncMock(return_value=user)

    with pytest.raises(HTTPException) as e:
        asyncio.run(auth_utils.get_user_from_token(old, mock_db))
    assert e.value.status_code == 401
    assert "yenilenmeli" in e.value.detail


def test_old_token_before_totp_enabled_at_rejected(monkeypatch):
    enabled_at = datetime.now(timezone.utc)
    user, _ = _sa_user(totp_enabled_at=enabled_at.isoformat())
    # Token issued 1 hour before 2FA enabled
    past = enabled_at - timedelta(hours=1)
    tok = jwt.encode(
        {
            "sub": "sa1", "email": "sa@tamkobi.com", "role": "admin",
            "type": "access", "sa": True, "mfa": True,
            "iat": int(past.timestamp()),
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        },
        auth_utils.get_jwt_secret(),
        algorithm="HS256",
    )
    mock_db = MagicMock()
    mock_db.users = MagicMock()
    mock_db.users.find_one = AsyncMock(return_value=user)
    with pytest.raises(HTTPException) as e:
        asyncio.run(auth_utils.get_user_from_token(tok, mock_db))
    assert e.value.status_code == 401


def test_impersonation_token_skips_mfa_check(monkeypatch):
    user, _ = _sa_user()
    # Impersonation target is not SA typically; simulate SA payload with imp_by
    tok = jwt.encode(
        {
            "sub": "sa1", "email": "sa@tamkobi.com", "role": "admin",
            "type": "access", "imp_by": "platform@x.com",
            "iat": int(time.time()),
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        },
        auth_utils.get_jwt_secret(),
        algorithm="HS256",
    )
    mock_db = MagicMock()
    mock_db.users = MagicMock()
    mock_db.users.find_one = AsyncMock(return_value=user)
    out = asyncio.run(auth_utils.get_user_from_token(tok, mock_db))
    assert out["email"] == "sa@tamkobi.com"


def test_require_super_admin_blocks_without_2fa_setup(monkeypatch):
    import saas
    user = {"_id": "sa1", "email": "sa@tamkobi.com", "is_super_admin": True, "totp_enabled": False}

    async def from_token(token, db):
        return user

    monkeypatch.setattr(saas, "get_user_from_token", from_token)
    monkeypatch.setattr(saas, "_db", MagicMock())
    monkeypatch.setattr(sa2fa, "platform_requires_2fa", AsyncMock(return_value=True))
    # patch module used inside require_super_admin
    import superadmin_2fa as mod
    monkeypatch.setattr(mod, "platform_requires_2fa", AsyncMock(return_value=True))

    class Req:
        headers = {"Authorization": "Bearer tok"}
        cookies = {}

    with pytest.raises(HTTPException) as e:
        asyncio.run(saas.require_super_admin(Req()))
    assert e.value.status_code == 403
    assert e.value.detail["code"] == "2fa_setup_required"


def test_setup_start_allowed_via_get_current_user(monkeypatch):
    """Zorunluluk açık + kurulum yokken setup/start get_current_user ile 200."""
    import server
    user = {
        "_id": "sa1", "email": "sa@tamkobi.com", "name": "SA",
        "is_super_admin": True, "totp_enabled": False, "is_active": True,
    }
    mock_db = MagicMock()
    mock_db.users = MagicMock()
    mock_db.users.find_one = AsyncMock(return_value=user)
    mock_db.users.update_one = AsyncMock(return_value=_UpdateResult())
    monkeypatch.setattr(server, "db", mock_db)
    out = asyncio.run(server.auth_2fa_setup_start(user))
    assert out["secret"] and out["qr_data_url"]


def test_invite_cookie_secure_with_forwarded_proto(monkeypatch):
    """Davet kabul çerezleri X-Forwarded-Proto=https iken Secure."""
    captured = []

    class Resp:
        def set_cookie(self, **kw):
            captured.append(kw)

    inv = {
        "_id": "inv1", "email": "new@x.com", "name": "Y", "role": "staff",
        "company_id": "c1", "accepted_at": None,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
    }
    mock_db = MagicMock()
    mock_db.user_invites = MagicMock()
    mock_db.user_invites.find_one = AsyncMock(return_value=inv)
    mock_db.user_invites.update_one = AsyncMock()
    mock_db.users = MagicMock()
    mock_db.users.find_one = AsyncMock(return_value=None)
    mock_db.users.insert_one = AsyncMock()
    mock_db.employees = MagicMock()
    mock_db.employees.update_one = AsyncMock()
    monkeypatch.setattr(rbac, "_db", mock_db)
    monkeypatch.setattr(rbac.user_numbers, "next_user_number", AsyncMock(return_value=9))

    req = _fake_http_request("http://backend/api/public/invites/inv1/accept", proto="https")
    asyncio.run(rbac.accept_invite("inv1", {"password": "secret1", "name": "Y"}, req, Resp()))
    assert captured
    assert all(c.get("secure") is True for c in captured)
    assert all(c.get("samesite") == "lax" for c in captured)


def test_mysql_store_sql_list_scalar_filter_is_broken():
    """MariaDB SQL pushdown dizi-içerir eşitliğini desteklemez — bu yüzden $pull+filtre kullanılmaz."""
    from mysql_store import match_query, sql_pushdown

    doc = {"_id": "u1", "totp_recovery_hashes": ["a", "b"]}
    # Python eşleştirici doğru çalışır
    assert match_query(doc, {"_id": "u1", "totp_recovery_hashes": "a"}) is True
    # Ama SQL JSON_EXTRACT = skaler üretir (dizi içeremez)
    sql, params = sql_pushdown("users", {"_id": "u1", "totp_recovery_hashes": "a"})
    assert "totp_recovery_hashes" in sql
    assert "=" in sql
    assert "a" in params


def test_recovery_consume_find_set_matches_mysql_store_semantics():
    """Gerçek eşleştirme: find_one(_id) + Python remaining + $set (SQL dizi filtresi yok)."""
    from mysql_store import match_query, apply_update

    plain, hashes = sa2fa.generate_recovery_codes(3)
    doc = {"_id": "sa1", "totp_recovery_hashes": list(hashes)}
    matched = sa2fa.verify_recovery_code(plain[0], doc["totp_recovery_hashes"])
    assert matched
    # Sorunlu filtre SQL'te boş dönerdi; biz yalnızca _id ile yükleriz
    assert match_query(doc, {"_id": "sa1"}) is True
    remaining = [h for h in doc["totp_recovery_hashes"] if h != matched]
    out = apply_update(doc, {"$set": {"totp_recovery_hashes": remaining}}, {"_id": "sa1"})
    assert matched not in out["totp_recovery_hashes"]
    assert len(out["totp_recovery_hashes"]) == 2
    # İkinci tüketim yok
    assert sa2fa.verify_recovery_code(plain[0], out["totp_recovery_hashes"]) is None


def test_no_list_scalar_totp_filter_in_server_source():
    text = Path(__file__).resolve().parents[1].joinpath("server.py").read_text()
    assert '"totp_recovery_hashes": matched' not in text
    assert '"$pull": {"totp_recovery_hashes"' not in text
    assert "_2fa_verify_lock" in text
