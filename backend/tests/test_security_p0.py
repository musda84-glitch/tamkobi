"""P0 güvenlik: tokensız 401, allowlist, JWT fail-closed, tenant IDOR, demo koruması, seed."""
from __future__ import annotations

import asyncio
import os
import sys
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# İmza / token üreten yardımcıları bozmamak için test ortamında güvenli secret
os.environ.setdefault("JWT_SECRET", "test-security-p0-jwt-secret-not-default-32b")

import auth_utils  # noqa: E402
import rbac  # noqa: E402
import tenant_access  # noqa: E402


# ---------- 1) get_current_user / session: token yoksa 401 ----------

def test_session_token_bos_bearer_yok_sayilir():
    class R:
        headers = {"Authorization": "Bearer "}
        cookies = {}

    assert auth_utils.session_token(R()) is None


def test_get_current_user_demo_fallback_yok():
    from pathlib import Path
    text = Path(__file__).resolve().parents[1].joinpath("server.py").read_text()
    start = text.index("async def get_current_user")
    end = text.index("\nasync def ", start + 1)
    body = text[start:end]
    assert "admin@nexus.com" not in body
    assert "session_token" in body
    assert "HTTP_401_UNAUTHORIZED" in body or "401" in body


# ---------- 2) Allowlist + varsayılan reddet ----------

@pytest.mark.parametrize(
    "path,method",
    [
        ("/api/auth/login", "POST"),
        ("/api/auth/register", "POST"),
        ("/api/auth/forgot-password", "POST"),
        ("/api/auth/reset/abc", "GET"),
        ("/api/auth/me", "GET"),
        ("/api/auth/2fa/verify", "POST"),
        ("/api/auth/impersonate/exit", "POST"),
        ("/api/public/plans", "GET"),
        ("/api/public/legal", "GET"),
        ("/api/public/b2b/login", "POST"),
        ("/api/setup/status", "GET"),
        ("/api/version", "GET"),
        ("/api/health", "GET"),
        ("/api/mobile/manifest", "GET"),
        ("/api/platform/notices", "GET"),
        ("/api/webhook/stripe", "POST"),
        ("/api/payments/paytr/callback", "POST"),
        ("/api/comm/whatsapp/webhook", "GET"),
    ],
)
def test_public_allowlist_paths(path, method):
    assert rbac.is_public_api_path(path, method)


def test_files_get_public_post_not():
    assert rbac.is_public_api_path("/api/files/x/y.jpg", "GET") is True
    assert rbac.is_public_api_path("/api/files/upload", "POST") is False


@pytest.mark.parametrize(
    "path",
    [
        "/api/contacts",
        "/api/contacts/cnt_01",
        "/api/demo/load",
        "/api/demo/clear",
        "/api/system/companies",
        "/api/license/me",
        "/api/products",
        "/api/invoices",
        "/api/orders",
        "/api/invoices/inv_x/pdf",
    ],
)
def test_protected_paths_not_public(path):
    assert rbac.is_public_api_path(path, "GET") is False
    assert rbac.is_public_api_path(path, "POST") is False


def test_auth_me_and_notices_and_impersonate_exit_public():
    assert rbac.is_public_api_path("/api/auth/me", "GET") is True
    assert rbac.is_public_api_path("/api/platform/notices", "GET") is True
    assert rbac.is_public_api_path("/api/auth/impersonate/exit", "POST") is True
    assert rbac.is_public_api_path("/api/auth/impersonate/exit", "GET") is False


def test_signed_pdf_allowlist_requires_valid_t(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-security-p0-jwt-secret-not-default-32b")
    import signed_links
    assert rbac.is_public_api_path("/api/invoices/inv1/pdf", "GET") is False
    assert rbac.is_public_api_path("/api/invoices/inv1/pdf", "GET", "bad") is False
    tok = signed_links.make_doc_share_token("inv1", "invoices-pdf")
    assert rbac.is_public_api_path("/api/invoices/inv1/pdf", "GET", tok) is True
    assert rbac.is_public_api_path("/api/invoices/inv1/pdf", "POST", tok) is False


def test_user_allowed_company_ids_ignores_active_only():
    user = {"company_ids": ["a"], "active_company_id": "b"}
    assert tenant_access.user_allowed_company_ids(user) == {"a"}
    assert tenant_access.user_may_access_company(user, "b") is False
    assert tenant_access.user_may_access_company(user, "a") is True


def test_allowlist_tek_kaynak():
    assert hasattr(rbac, "PUBLIC_API_ALLOWLIST")
    assert "/api/auth/login" in rbac.PUBLIC_API_ALLOWLIST
    assert not any("admin@nexus.com" in str(x) for x in rbac.PUBLIC_API_ALLOWLIST)


def test_middleware_tokensuz_korumali_401():
    """PermissionAndAuditMiddleware: allowlist dışı + tokensız → 401."""

    class Scope(dict):
        pass

    class FakeRequest:
        def __init__(self, path):
            self.url = MagicMock(path=path)
            self.method = "GET"
            self.headers = {}
            self.cookies = {}
            self.query_params = {}
            self.scope = {"query_string": b""}

    mw = rbac.PermissionAndAuditMiddleware(app=MagicMock())
    rbac._db = MagicMock()

    async def call_next(_req):
        raise AssertionError("call_next tokensız korumalı yolda çağrılmamalı")

    resp = asyncio.run(mw.dispatch(FakeRequest("/api/contacts"), call_next))
    assert resp.status_code == 401


def test_middleware_allowlist_tokensuz_gecer():
    class FakeRequest:
        def __init__(self, path):
            self.url = MagicMock(path=path)
            self.method = "GET"
            self.headers = {}
            self.cookies = {}
            self.query_params = {}
            self.scope = {"query_string": b""}

    mw = rbac.PermissionAndAuditMiddleware(app=MagicMock())
    rbac._db = MagicMock()
    seen = {"ok": False}

    async def call_next(_req):
        seen["ok"] = True
        return MagicMock(status_code=200)

    resp = asyncio.run(mw.dispatch(FakeRequest("/api/version"), call_next))
    assert seen["ok"] is True
    assert resp.status_code == 200


# ---------- 3) Tenant company_id / IDOR ----------

def test_user_may_access_company_oturumsuz_false():
    assert tenant_access.user_may_access_company(None, "comp_a") is False
    import saas
    assert saas.user_may_access_company(None, "comp_a") is False


def test_resolve_company_id_yabanci_403():
    user = {"company_ids": ["comp_a"], "active_company_id": "comp_a", "is_super_admin": False}
    assert tenant_access.resolve_company_id(user, "comp_a") == "comp_a"
    with pytest.raises(HTTPException) as e:
        tenant_access.resolve_company_id(user, "comp_b")
    assert e.value.status_code == 403


def test_get_tenant_doc_baska_sirket_404():
    class Coll:
        async def find_one(self, q):
            return {"_id": "cnt_x", "company_id": "comp_other", "name": "X"}

    class DB:
        def __getitem__(self, name):
            return Coll()

    user = {"company_ids": ["comp_mine"], "active_company_id": "comp_mine"}
    with pytest.raises(HTTPException) as e:
        asyncio.run(tenant_access.get_tenant_doc(DB(), "contacts", "cnt_x", user, not_found="Cari hesap bulunamadı."))
    assert e.value.status_code == 404


def test_get_tenant_doc_kendi_sirket():
    class Coll:
        async def find_one(self, q):
            return {"_id": "cnt_x", "company_id": "comp_mine", "name": "X"}

    class DB:
        def __getitem__(self, name):
            return Coll()

    user = {"company_ids": ["comp_mine"], "active_company_id": "comp_mine"}
    doc = asyncio.run(tenant_access.get_tenant_doc(DB(), "contacts", "cnt_x", user))
    assert doc["name"] == "X"


# ---------- 4) Demo uçları: admin zorunlu ----------

def test_require_company_admin():
    user = {"company_ids": ["c1"], "active_company_id": "c1", "role": "sales"}
    with pytest.raises(HTTPException) as e:
        asyncio.run(tenant_access.require_company_admin(user, "c1"))
    assert e.value.status_code == 403
    admin = {**user, "role": "admin"}
    asyncio.run(tenant_access.require_company_admin(admin, "c1"))


def test_demo_routes_use_auth_dep():
    import demo
    import inspect
    for name in ("demo_load", "demo_clear", "demo_status"):
        sig = inspect.signature(getattr(demo, name))
        assert "user" in sig.parameters


# ---------- 5) admin@nexus.com seed / koruma ----------

def test_protected_emails_nexus_yok():
    import saas
    assert "admin@nexus.com" not in saas.PROTECTED_USER_EMAILS


def test_seed_data_nexus_email_yok():
    from pathlib import Path
    text = Path(__file__).resolve().parents[1].joinpath("seed_data.py").read_text()
    assert "admin@nexus.com" not in text
    assert "admin@tamkobi.local" in text


def test_saas_seed_login_attempts_silmez():
    from pathlib import Path
    import ast
    src = Path(__file__).resolve().parents[1].joinpath("saas.py").read_text()
    # seed() gövdesinde SUPER_ADMIN için login_attempts.delete_many olmamalı
    fn_start = src.index("async def seed():")
    fn_end = src.index("\nasync def ", fn_start + 1)
    body = src[fn_start:fn_end]
    assert "login_attempts.delete_many" not in body
    # Kod yolu olarak sabit e-posta yükseltilmemeli (yorum satırı hariç)
    code_lines = [ln for ln in body.splitlines() if not ln.strip().startswith("#")]
    assert not any('"admin@nexus.com"' in ln or "'admin@nexus.com'" in ln for ln in code_lines)


# ---------- 6) JWT_SECRET fail-closed ----------

def test_jwt_secret_eksik_fail_closed(monkeypatch):
    monkeypatch.delenv("JWT_SECRET", raising=False)
    with pytest.raises(RuntimeError) as e:
        auth_utils.require_secure_jwt_secret()
    assert "JWT_SECRET" in str(e.value)


def test_jwt_secret_varsayilan_fail_closed(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "nexus_default_secret_key_99482910")
    with pytest.raises(RuntimeError):
        auth_utils.require_secure_jwt_secret()
    assert auth_utils.jwt_secret_is_insecure("nexus_default_secret_key_99482910") is True


def test_jwt_secret_guvenli(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "a-sufficiently-long-random-test-secret-key")
    assert auth_utils.require_secure_jwt_secret().startswith("a-sufficiently")


# ---------- 7) Disable script onay kapısı ----------

def test_disable_script_onay_kapisi():
    from pathlib import Path
    text = (Path(__file__).resolve().parents[1] / "scripts" / "disable_nexus_admin.py").read_text()
    assert "CONFIRM_DISABLE_NEXUS_ADMIN" in text
    assert "is_active" in text
    assert "delete_one" not in text  # otomatik silme yok
