"""Subdomain split: JWT aud, cookies, CORS, public_base_url_for, SSO handoff, manifest."""
from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import jwt
import pytest
from fastapi import HTTPException

# Standalone: set secret before auth_utils.get_jwt_secret() is used
os.environ["JWT_SECRET"] = "test-subdomain-routing-jwt-secret-not-default-32b"

import auth_handoff
import auth_utils
import host_audience as ha
import public_url as pu


@pytest.fixture(autouse=True)
def _jwt_secret(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-subdomain-routing-jwt-secret-not-default-32b")


def _req(host: str, path: str = "/api/auth/me", *, xfh: str | None = None, peer: str | None = None):
    headers = {"host": host}
    if xfh is not None:
        headers["x-forwarded-host"] = xfh
    client = SimpleNamespace(host=peer) if peer is not None else None
    return SimpleNamespace(
        headers=headers,
        url=SimpleNamespace(path=path),
        client=client,
    )


def test_auth_cookie_kwargs_never_sets_domain():
    class R:
        url = "https://app.tamkobi.com/api"
        headers = {"x-forwarded-proto": "https"}

    kw = auth_utils.auth_cookie_kwargs(R(), max_age=100)
    assert "domain" not in kw
    assert kw["httponly"] is True
    assert kw["samesite"] == "lax"
    assert kw["secure"] is True
    assert kw["path"] == "/"


def test_spoofed_x_forwarded_host_ignored_without_local_proxy():
    """Client X-Forwarded-Host must not override Host on direct connections."""
    req = _req("app.tamkobi.com", xfh="ik.tamkobi.com", peer="203.0.113.9")
    assert ha.request_host(req) == "app.tamkobi.com"
    assert ha.host_kind(req) == ha.KIND_APP
    tok = auth_utils.create_access_token("u1", "a@b.com", "admin", aud="app")
    payload = auth_utils.decode_access_payload(tok)
    # Still app host → app token OK (spoof failed)
    auth_utils.enforce_token_audience(payload, req, path="/api/auth/me")


def test_x_forwarded_host_trusted_from_local_proxy():
    req = _req("127.0.0.1:8000", xfh="ik.tamkobi.com", peer="127.0.0.1")
    assert ha.request_host(req) == "ik.tamkobi.com"
    assert ha.host_kind(req) == ha.KIND_IK


def test_audience_enforce_app_rejects_ik_token():
    tok = auth_utils.create_access_token("u1", "a@b.com", "personel", aud="ik")
    payload = auth_utils.decode_access_payload(tok)
    with pytest.raises(HTTPException) as ei:
        auth_utils.enforce_token_audience(payload, _req("app.tamkobi.com"), path="/api/auth/me")
    assert ei.value.status_code == 401


def test_audience_enforce_ik_rejects_app_token():
    tok = auth_utils.create_access_token("u1", "a@b.com", "admin", aud="app")
    payload = auth_utils.decode_access_payload(tok)
    with pytest.raises(HTTPException) as ei:
        auth_utils.enforce_token_audience(payload, _req("ik.tamkobi.com"), path="/api/auth/me")
    assert ei.value.status_code == 401


def test_site_rejects_app_and_ik_tokens():
    for aud in ("app", "ik"):
        tok = auth_utils.create_access_token("u1", "a@b.com", "admin", aud=aud)
        payload = auth_utils.decode_access_payload(tok)
        with pytest.raises(HTTPException) as ei:
            auth_utils.enforce_token_audience(
                payload, _req("tamkobi.com", "/api/auth/me"), path="/api/auth/me"
            )
        assert ei.value.status_code == 401


def test_ik_token_forbidden_on_panel_api():
    tok = auth_utils.create_access_token("u1", "a@b.com", "personel", aud="ik")
    payload = auth_utils.decode_access_payload(tok)
    with pytest.raises(HTTPException) as ei:
        auth_utils.enforce_token_audience(
            payload, _req("ik.tamkobi.com", "/api/invoices"), path="/api/invoices"
        )
    assert ei.value.status_code == 403


def test_ik_token_ok_on_self_service_and_allowlist():
    tok = auth_utils.create_access_token("u1", "a@b.com", "personel", aud="ik")
    payload = auth_utils.decode_access_payload(tok)
    for path in (
        "/api/personnel/me",
        "/api/license/me",
        "/api/auth/switch-company",
        "/api/personnel/attendance/att1/time-edit-decision",
        "/api/projects/p1/stage-photos/visibility",
    ):
        auth_utils.enforce_token_audience(
            payload, _req("ik.tamkobi.com", path), path=path
        )


def test_site_accepts_legacy_token_without_aud():
    tok = auth_utils.create_access_token("u1", "a@b.com", "admin")  # no aud
    payload = auth_utils.decode_access_payload(tok)
    assert "aud" not in payload
    auth_utils.enforce_token_audience(
        payload, _req("tamkobi.com", "/api/version"), path="/api/version"
    )


def test_super_admin_api_rejects_app_aud_on_site():
    tok = auth_utils.create_access_token("u1", "sa@b.com", "admin", is_super_admin=True, aud="app")
    payload = auth_utils.decode_access_payload(tok)
    with pytest.raises(HTTPException) as ei:
        auth_utils.enforce_token_audience(
            payload, _req("tamkobi.com", "/api/system/companies"), path="/api/system/companies"
        )
    assert ei.value.status_code == 401


def test_cors_origins_default_no_wildcard():
    with patch.dict(os.environ, {"CORS_ORIGINS": "", "ROOT_DOMAIN": "tamkobi.com"}, clear=False):
        origins = ha.default_cors_origins()
    assert "https://tamkobi.com" in origins
    assert "https://app.tamkobi.com" in origins
    assert "https://b2b.tamkobi.com" in origins
    assert "https://ik.tamkobi.com" in origins
    assert not any("*" in o for o in origins)


def test_cors_origins_from_env():
    with patch.dict(os.environ, {"CORS_ORIGINS": "https://a.example,https://b.example"}, clear=False):
        assert ha.parse_cors_origins_env() == ["https://a.example", "https://b.example"]


def test_public_base_url_for_contexts():
    with patch.dict(
        os.environ,
        {
            "PUBLIC_APP_URL": "https://tamkobi.com",
            "PUBLIC_APP_HOST_URL": "",
            "PUBLIC_B2B_URL": "",
            "PUBLIC_IK_URL": "",
        },
        clear=False,
    ):
        assert pu.resolve_public_base_url_for("site") == "https://tamkobi.com"
        assert pu.resolve_public_base_url_for("app") == "https://app.tamkobi.com"
        assert pu.resolve_public_base_url_for("b2b") == "https://b2b.tamkobi.com"
        assert pu.resolve_public_base_url_for("ik") == "https://ik.tamkobi.com"


def test_public_base_url_for_env_overrides():
    with patch.dict(
        os.environ,
        {
            "PUBLIC_APP_URL": "https://tamkobi.com",
            "PUBLIC_APP_HOST_URL": "https://app.custom.test",
            "PUBLIC_B2B_URL": "https://b2b.custom.test",
            "PUBLIC_IK_URL": "https://ik.custom.test",
        },
        clear=False,
    ):
        assert pu.resolve_public_base_url_for("app") == "https://app.custom.test"
        assert pu.resolve_public_base_url_for("b2b") == "https://b2b.custom.test"
        assert pu.resolve_public_base_url_for("ik") == "https://ik.custom.test"


def test_b2b_ignores_client_explicit_base():
    with patch.dict(os.environ, {"PUBLIC_B2B_URL": "", "PUBLIC_APP_URL": "https://tamkobi.com"}, clear=False):
        out = pu.resolve_public_base_url_for("b2b", explicit="https://evil.example")
    assert out == "https://b2b.tamkobi.com"


def test_is_employee_user():
    assert ha.is_employee_user({"employee_id": "e1", "role": "personel"})
    assert not ha.is_employee_user({"employee_id": "e1", "role": "admin"})
    assert not ha.is_employee_user({"employee_id": None, "role": "personel"})


def test_employee_login_on_app_redirects_to_ik_no_cookie():
    user = {
        "_id": "u_emp",
        "email": "emp@test.com",
        "name": "Emp",
        "role": "personel",
        "employee_id": "emp1",
        "is_super_admin": False,
        "company_ids": ["c1"],
        "active_company_id": "c1",
        "preferences": {},
    }
    request = _req("app.tamkobi.com", "/api/auth/login")
    response = MagicMock()
    response.set_cookie = MagicMock()

    async def run():
        import server

        with patch.object(server, "db", MagicMock()), patch(
            "rbac.role_for", AsyncMock(return_value={"name": "Personel", "permissions": {}, "features": {}})
        ), patch(
            "attendance.employee_for_user", AsyncMock(return_value={"_id": "emp1"})
        ), patch(
            "public_url.public_base_url_for", AsyncMock(return_value="https://ik.tamkobi.com")
        ):
            return await server._issue_session_for_user(user, request, response, remember=True)

    out = asyncio.run(run())
    assert out["redirect"] == "https://ik.tamkobi.com/personelim"
    assert "token" not in out
    response.set_cookie.assert_not_called()


class _HandoffDb:
    """Minimal aiomysql-like stub for auth_handoff."""

    class Cur:
        def __init__(self, store):
            self.store = store
            self._row = None
            self.rowcount = 0

        async def execute(self, sql, args=None):
            sql_l = " ".join(sql.split()).lower()
            if sql_l.startswith("insert"):
                code, token, purpose, exp, now = args
                self.store[code] = {
                    "token": token,
                    "expires_at": exp,
                    "used_at": None,
                    "created_at": now,
                    "purpose": purpose,
                }
                self.rowcount = 1
            elif sql_l.startswith("select"):
                code = args[0]
                row = self.store.get(code)
                self._row = (row["token"], row["expires_at"], row["used_at"]) if row else None
            elif sql_l.startswith("update"):
                code = args[1]
                row = self.store.get(code)
                if row and row["used_at"] is None:
                    row["used_at"] = args[0]
                    self.rowcount = 1
                else:
                    self.rowcount = 0
            elif "create table" in sql_l:
                self.rowcount = 0

        async def fetchone(self):
            return self._row

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

    class Conn:
        def __init__(self, store):
            self.store = store

        def cursor(self):
            return _HandoffDb.Cur(self.store)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

    class Pool:
        def __init__(self):
            self.store = {}

        def acquire(self):
            return _HandoffDb.Conn(self.store)

    def __init__(self):
        self._pool = self.Pool()

    async def _ensure(self):
        return None


def test_sso_handoff_one_time_and_expired():
    auth_handoff.reset_table_ready_for_tests()
    db = _HandoffDb()

    async def run():
        code = await auth_handoff.create_handoff(db, "jwt-token-1", purpose="impersonate")
        tok = await auth_handoff.consume_handoff(db, code)
        assert tok == "jwt-token-1"
        with pytest.raises(HTTPException) as ei:
            await auth_handoff.consume_handoff(db, code)
        assert ei.value.status_code == 401

        code2 = await auth_handoff.create_handoff(db, "jwt-token-2")
        db._pool.store[code2]["expires_at"] = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=5)
        with pytest.raises(HTTPException) as ei2:
            await auth_handoff.consume_handoff(db, code2)
        assert ei2.value.status_code == 401

    asyncio.run(run())


def test_sso_exchange_rejects_aud_host_mismatch():
    import server
    from server import SsoExchangeRequest

    auth_handoff.reset_table_ready_for_tests()
    db = _HandoffDb()
    # app token exchanged on ik → 401
    app_tok = auth_utils.create_access_token("u1", "a@b.com", "admin", aud="app")
    blob = json.dumps({"access_token": app_tok, "sa_return": ""})

    async def run():
        code = await auth_handoff.create_handoff(db, blob, purpose="test")
        resp = MagicMock()
        req = _req("ik.tamkobi.com", "/api/auth/sso-exchange")
        with patch.object(server, "db", db), patch(
            "auth_handoff.consume_handoff", AsyncMock(return_value=blob)
        ):
            with pytest.raises(HTTPException) as ei:
                await server.auth_sso_exchange(SsoExchangeRequest(code=code), req, resp)
            assert ei.value.status_code == 401
            assert "host" in str(ei.value.detail).lower() or "geçerli değil" in str(ei.value.detail).lower()

    asyncio.run(run())


def test_invite_accept_sets_aud_and_ok_on_matching_host():
    import rbac

    inv = {
        "_id": "inv1",
        "email": "new@test.com",
        "name": "New",
        "role": "admin",
        "company_id": "c1",
        "company_name": "C",
        "employee_id": None,
        "accepted_at": None,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
    }
    fake_db = MagicMock()
    fake_db.user_invites.find_one = AsyncMock(return_value=inv)
    fake_db.users.find_one = AsyncMock(return_value=None)
    fake_db.users.insert_one = AsyncMock()
    fake_db.user_invites.update_one = AsyncMock()
    fake_db.employees.update_one = AsyncMock()

    class Num:
        @staticmethod
        async def next_user_number(_db):
            return 42

    response = MagicMock()
    cookies = {}

    def set_cookie(key, value, **kw):
        cookies[key] = value

    response.set_cookie = set_cookie
    request = _req("app.tamkobi.com", "/api/public/invites/inv1/accept")

    async def run():
        with patch.object(rbac, "_db", fake_db), patch.object(rbac, "user_numbers", Num):
            return await rbac.accept_invite("inv1", {"name": "New", "password": "secret1"}, request, response)

    out = asyncio.run(run())
    assert out["status"] == "success"
    assert "access_token" in cookies
    payload = auth_utils.decode_access_payload(cookies["access_token"])
    assert payload["aud"] == "app"
    # Token valid on app
    auth_utils.enforce_token_audience(payload, request, path="/api/auth/me")


def test_invite_accept_personel_handoff_to_ik():
    import rbac

    inv = {
        "_id": "inv2",
        "email": "emp@test.com",
        "name": "Emp",
        "role": "personel",
        "company_id": "c1",
        "company_name": "C",
        "employee_id": "e1",
        "accepted_at": None,
        "expires_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
    }
    fake_db = MagicMock()
    fake_db.user_invites.find_one = AsyncMock(return_value=inv)
    fake_db.users.find_one = AsyncMock(return_value=None)
    fake_db.users.insert_one = AsyncMock()
    fake_db.user_invites.update_one = AsyncMock()
    fake_db.employees.update_one = AsyncMock()
    # handoff table
    hdb = _HandoffDb()
    fake_db._pool = hdb._pool
    fake_db._ensure = hdb._ensure

    class Num:
        @staticmethod
        async def next_user_number(_db):
            return 7

    response = MagicMock()
    response.set_cookie = MagicMock()
    # Accept on app host → SSO to ik
    request = _req("app.tamkobi.com", "/api/public/invites/inv2/accept")

    async def run():
        auth_handoff.reset_table_ready_for_tests()
        with patch.object(rbac, "_db", fake_db), patch.object(rbac, "user_numbers", Num), patch(
            "public_url.public_base_url_for", AsyncMock(return_value="https://ik.tamkobi.com")
        ):
            return await rbac.accept_invite("inv2", {"name": "Emp", "password": "secret1"}, request, response)

    out = asyncio.run(run())
    assert out["redirect"].startswith("https://ik.tamkobi.com/sso?code=")
    response.set_cookie.assert_not_called()


def test_mobile_manifest_api_base_unchanged():
    import inspect
    import server

    src = inspect.getsource(server.mobile_manifest)
    assert '"api_base": "https://tamkobi.com/api"' in src or "'api_base': 'https://tamkobi.com/api'" in src


def test_create_access_token_embeds_aud():
    tok = auth_utils.create_access_token("u1", "a@b.com", "admin", aud="app")
    payload = jwt.decode(tok, auth_utils.get_jwt_secret(), algorithms=["HS256"], options={"verify_aud": False})
    assert payload["aud"] == "app"
