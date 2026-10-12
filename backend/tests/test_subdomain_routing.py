"""Subdomain split: JWT aud, cookies, CORS, public_base_url_for, SSO handoff, manifest."""
from __future__ import annotations

import asyncio
import os
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import jwt
import pytest
from fastapi import HTTPException

import auth_handoff
import auth_utils
import host_audience as ha
import public_url as pu


def _req(host: str, path: str = "/api/auth/me"):
    return SimpleNamespace(
        headers={"host": host},
        url=SimpleNamespace(path=path),
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


def test_ik_token_forbidden_on_panel_api():
    tok = auth_utils.create_access_token("u1", "a@b.com", "personel", aud="ik")
    payload = auth_utils.decode_access_payload(tok)
    with pytest.raises(HTTPException) as ei:
        auth_utils.enforce_token_audience(
            payload, _req("ik.tamkobi.com", "/api/invoices"), path="/api/invoices"
        )
    assert ei.value.status_code == 403


def test_ik_token_ok_on_self_service():
    tok = auth_utils.create_access_token("u1", "a@b.com", "personel", aud="ik")
    payload = auth_utils.decode_access_payload(tok)
    auth_utils.enforce_token_audience(
        payload, _req("ik.tamkobi.com", "/api/personnel/me"), path="/api/personnel/me"
    )


def test_site_accepts_legacy_token_without_aud():
    tok = auth_utils.create_access_token("u1", "a@b.com", "admin")  # no aud
    payload = auth_utils.decode_access_payload(tok)
    assert "aud" not in payload
    auth_utils.enforce_token_audience(
        payload, _req("tamkobi.com", "/api/version"), path="/api/version"
    )


def test_super_admin_api_only_on_site():
    tok = auth_utils.create_access_token("u1", "sa@b.com", "admin", is_super_admin=True, aud="app")
    payload = auth_utils.decode_access_payload(tok)
    with pytest.raises(HTTPException) as ei:
        auth_utils.enforce_token_audience(
            payload, _req("tamkobi.com", "/api/system/companies"), path="/api/system/companies"
        )
    assert ei.value.status_code == 401


def test_cors_origins_default_no_wildcard():
    with patch.dict(os.environ, {"CORS_ORIGINS": "", "ROOT_DOMAIN": "tamkobi.com"}, clear=False):
        # Reload module defaults use ROOT_DOMAIN at import — use helpers directly
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
    """_issue_session_for_user returns redirect without setting cookies for employee on app."""
    from unittest.mock import patch as _patch

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

        with _patch.object(server, "db", MagicMock()), _patch(
            "rbac.role_for", AsyncMock(return_value={"name": "Personel", "permissions": {}, "features": {}})
        ), _patch(
            "attendance.employee_for_user", AsyncMock(return_value={"_id": "emp1"})
        ), _patch(
            "public_url.public_base_url_for", AsyncMock(return_value="https://ik.tamkobi.com")
        ):
            return await server._issue_session_for_user(user, request, response, remember=True)

    out = asyncio.run(run())
    assert out["redirect"] == "https://ik.tamkobi.com/personelim"
    assert "token" not in out
    response.set_cookie.assert_not_called()


def test_sso_handoff_one_time_and_expired():
    class FakeCur:
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

    class FakeConn:
        def __init__(self, store):
            self.store = store

        def cursor(self):
            return FakeCur(self.store)

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

    class FakePool:
        def __init__(self):
            self.store = {}

        def acquire(self):
            return FakeConn(self.store)

    class FakeDb:
        def __init__(self):
            self._pool = FakePool()

        async def _ensure(self):
            return None

    auth_handoff.reset_table_ready_for_tests()
    db = FakeDb()

    async def run():
        code = await auth_handoff.create_handoff(db, "jwt-token-1", purpose="impersonate")
        tok = await auth_handoff.consume_handoff(db, code)
        assert tok == "jwt-token-1"
        with pytest.raises(HTTPException) as ei:
            await auth_handoff.consume_handoff(db, code)
        assert ei.value.status_code == 401

        code2 = await auth_handoff.create_handoff(db, "jwt-token-2")
        # Expire manually
        db._pool.store[code2]["expires_at"] = datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=5)
        with pytest.raises(HTTPException) as ei2:
            await auth_handoff.consume_handoff(db, code2)
        assert ei2.value.status_code == 401
        assert "süresi" in str(ei2.value.detail).lower() or "dolmuş" in str(ei2.value.detail).lower()

    asyncio.run(run())


def test_mobile_manifest_api_base_unchanged():
    import inspect
    import server

    src = inspect.getsource(server.mobile_manifest)
    assert '"api_base": "https://tamkobi.com/api"' in src or "'api_base': 'https://tamkobi.com/api'" in src


def test_create_access_token_embeds_aud():
    tok = auth_utils.create_access_token("u1", "a@b.com", "admin", aud="app")
    payload = jwt.decode(tok, auth_utils.get_jwt_secret(), algorithms=["HS256"], options={"verify_aud": False})
    assert payload["aud"] == "app"
