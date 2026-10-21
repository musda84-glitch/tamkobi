"""admin-v1 oturum middleware’inden geçer; imza platform_auth katmanındadır.

Tam FastAPI uygulaması (server.app + PermissionAndAuditMiddleware). Bellek
FakeDB. Canlı veritabanı ve port yok.
"""
from __future__ import annotations

import asyncio
import inspect
import os
import secrets
import sys
import time
from pathlib import Path

import pytest
from fastapi.routing import APIRoute
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-admin-v1-middleware-jwt-secret-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import comm_service  # noqa: E402
import platform_admin_v1  # noqa: E402
import platform_admin_v1_accounts  # noqa: E402
import platform_admin_v1_content  # noqa: E402
import platform_admin_v1_danger  # noqa: E402
import platform_admin_v1_integrations  # noqa: E402
import platform_admin_v1_ops  # noqa: E402
import platform_admin_v1_write  # noqa: E402
import platform_store as store  # noqa: E402
import rbac  # noqa: E402
from mysql_store import DuplicateKeyError  # noqa: E402

_SESSION_401 = "Giriş yapmanız gerekiyor."
_MISSING_SIG = "Eksik imza başlıkları"
_ADMIN_PREFIX = "/api/platform/admin-v1/"

_ROUTERS = (
    platform_admin_v1.router,
    platform_admin_v1_write.router,
    platform_admin_v1_ops.router,
    platform_admin_v1_danger.router,
    platform_admin_v1_accounts.router,
    platform_admin_v1_integrations.router,
    platform_admin_v1_content.router,
)

_MUST_EXIST = (
    "/api/platform/admin-v1/system/health",
    "/api/platform/admin-v1/overview",
    "/api/platform/admin-v1/companies/{company_id}/impersonate",
    "/api/platform/admin-v1/impersonation/{session_id}/end",
    "/api/platform/admin-v1/danger/{action}/prepare",
    "/api/platform/admin-v1/danger/{action}/confirm",
    "/api/platform/admin-v1/companies/{company_id}/quotas",
    "/api/platform/admin-v1/api-keys",
    "/api/platform/admin-v1/database",
    "/api/platform/admin-v1/sms/settings",
)


class FakeColl:
    def __init__(self):
        self.docs = {}

    async def find_one(self, q=None, proj=None, sort=None):
        q = q or {}
        if isinstance(q, dict) and set(q) == {"_id"} and not isinstance(q.get("_id"), dict):
            return self.docs.get(q["_id"])
        for doc in self.docs.values():
            if all(doc.get(key) == expected for key, expected in q.items()):
                return doc
        return None

    async def insert_one(self, doc):
        if doc["_id"] in self.docs:
            raise DuplicateKeyError(f"duplicate {doc['_id']}")
        self.docs[doc["_id"]] = dict(doc)
        return doc

    async def update_one(self, q, upd, upsert=False):
        doc = await self.find_one(q)
        if doc is None and upsert and isinstance(q, dict) and "_id" in q:
            doc = {"_id": q["_id"]}
            self.docs[doc["_id"]] = doc
        if doc is None:
            return None
        if "$set" in upd:
            doc.update(upd["$set"])
        if "$inc" in upd:
            for key, value in upd["$inc"].items():
                doc[key] = int(doc.get(key) or 0) + int(value)
        self.docs[doc["_id"]] = doc
        return doc

    def find(self, q=None, proj=None):
        q = q or {}
        docs = self.docs

        class _Cursor:
            def sort(self, *args, **kwargs):
                return self

            async def to_list(self, n):
                out = [
                    doc for doc in docs.values()
                    if all(doc.get(key) == expected for key, expected in q.items())
                ]
                return out if n is None else out[:n]

        return _Cursor()


class FakeDB:
    def __init__(self):
        self.platform_products = FakeColl()
        self.platform_api_keys = FakeColl()
        self.platform_audit_log = FakeColl()
        self.platform_nonces = FakeColl()
        self.platform_rate = FakeColl()


def _admin_routes():
    found = []
    for router in _ROUTERS:
        for route in router.routes:
            if not isinstance(route, APIRoute):
                continue
            path = route.path if route.path.startswith("/api/") else "/api" + route.path
            if path.startswith(_ADMIN_PREFIX) or path == _ADMIN_PREFIX.rstrip("/"):
                found.append((path, route.endpoint))
    return found


def _signed_headers(secret, key_id, method, path, body: bytes = b""):
    ts = str(int(time.time()))
    nonce = secrets.token_hex(8)
    sig = store.sign_payload(secret, ts, nonce, method, path, body)
    return {
        "X-Platform-Key": key_id,
        "X-Platform-Timestamp": ts,
        "X-Platform-Nonce": nonce,
        "X-Platform-Signature": sig,
    }


@pytest.fixture
def app_client(monkeypatch):
    import server

    fake = FakeDB()
    prev = store._db
    store.init(fake)
    monkeypatch.setattr(comm_service, "encrypt", lambda value: "enc:" + (value or ""))
    monkeypatch.setattr(comm_service, "decrypt", lambda value: (value or "").removeprefix("enc:"))
    router = server.app.router
    saved_up = list(router.on_startup)
    saved_down = list(router.on_shutdown)
    router.on_startup.clear()
    router.on_shutdown.clear()
    client = TestClient(server.app)
    client.__enter__()
    try:
        yield client
    finally:
        client.__exit__(None, None, None)
        store.init(prev)
        router.on_startup[:] = saved_up
        router.on_shutdown[:] = saved_down


def test_admin_v1_prefix_is_public_and_bounded():
    assert "/api/platform/admin-v1/" in rbac.PUBLIC_API_ALLOWLIST
    assert rbac.is_public_api_path("/api/platform/admin-v1", "GET") is True
    assert rbac.is_public_api_path("/api/platform/admin-v1/system/health", "GET") is True
    assert rbac.is_public_api_path("/api/platform/admin-v1/overview", "GET") is True
    assert rbac.is_public_api_path("/api/platform/admin-v1/danger/company.delete/prepare", "POST") is True
    assert rbac.is_public_api_path("/api/platform/admin-v1/danger/company.delete/confirm", "POST") is True
    assert rbac.is_public_api_path("/api/platform/admin-v1/companies/c1/impersonate", "POST") is True
    assert rbac.is_public_api_path("/api/platform/v1/licenses/verify", "POST") is True
    for path in (
        "/api/platform/admin-v1extra",
        "/api/platform/admin-v1-other/health",
        "/api/platform/admin-v10/system/health",
        "/api/platform/admin-v1foo/overview",
        "/api/platform/admin",
        "/api/contacts",
    ):
        assert rbac.is_public_api_path(path, "GET") is False, path
        assert rbac.is_public_api_path(path, "POST") is False, path


def test_every_admin_v1_route_calls_platform_auth():
    routes = _admin_routes()
    paths = {path for path, _fn in routes}
    assert paths.issuperset(_MUST_EXIST)
    assert "platform_auth.authenticate(" in inspect.getsource(platform_admin_v1._auth)
    assert "await _auth(" in inspect.getsource(platform_admin_v1_write._write)
    for path, endpoint in routes:
        src = inspect.getsource(endpoint)
        assert (
            "await _auth(" in src
            or "await _write(" in src
            or "platform_auth.authenticate(" in src
        ), path


def test_signed_admin_v1_passes_session_middleware(app_client):
    async def issue():
        await store.ensure_seeded()
        product_id = next(
            row["id"] for row in await store.list_products() if row["code"] == store.PRODUCT_TAMKOBI
        )
        return await store.create_api_key(
            product_id=product_id,
            name="mw-admin",
            actor_id="sa1",
            scopes=[store.SCOPE_ADMIN_SYSTEM_READ],
            kind="platform_admin",
        )

    pub, secret = asyncio.run(issue())
    path = "/api/platform/admin-v1/system/health"
    response = app_client.get(path, headers=_signed_headers(secret, pub["id"], "GET", path))
    assert response.status_code == 200, response.text
    assert response.json()["item"]["status"] == "healthy"
    assert response.json().get("detail") != _SESSION_401


@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", "/api/platform/admin-v1/system/health"),
        ("GET", "/api/platform/admin-v1/overview"),
        ("POST", "/api/platform/admin-v1/companies/comp_x/impersonate"),
        ("POST", "/api/platform/admin-v1/impersonation/sess_x/end"),
        ("POST", "/api/platform/admin-v1/danger/company.delete/prepare"),
        ("POST", "/api/platform/admin-v1/danger/company.delete/confirm"),
    ],
)
def test_unsigned_admin_v1_rejected_by_platform_auth(app_client, method, path):
    response = app_client.request(method, path)
    assert response.status_code == 401, response.text
    assert response.json().get("detail") == _MISSING_SIG


@pytest.mark.parametrize(
    "path",
    [
        "/api/platform/admin-v1extra",
        "/api/platform/admin-v10/system/health",
        "/api/platform/admin-v1-other/health",
    ],
)
def test_near_miss_paths_still_require_session(app_client, path):
    response = app_client.get(path)
    assert response.status_code == 401, response.text
    assert response.json().get("detail") == _SESSION_401
