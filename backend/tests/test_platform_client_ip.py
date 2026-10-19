"""Platform API and super-admin audit use the nginx client IP, not the Uvicorn peer.

In-memory only: no live database, no live server, no bound port.
Starlette 0.37 TestClient has no client= argument (the peer is "testclient"),
so HTTP cases go through an ASGI wrapper that sets scope["client"].
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import secrets
import sys
import time
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from starlette.requests import Request
from starlette.responses import Response

os.environ.setdefault("JWT_SECRET", "test-platform-client-ip-jwt-secret-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import platform_admin  # noqa: E402
import platform_store as store  # noqa: E402
import platform_v1  # noqa: E402
import server  # noqa: E402
from mysql_store import DuplicateKeyError  # noqa: E402


class FakeColl:
    def __init__(self):
        self.docs = {}
        import threading
        self._lock = threading.Lock()

    async def find_one(self, q, proj=None):
        if isinstance(q, dict) and "_id" in q and len(q) == 1:
            return self.docs.get(q["_id"])
        for d in self.docs.values():
            ok = True
            for k, v in q.items():
                if k == "$or":
                    if not any(
                        all(d.get(kk) == vv for kk, vv in clause.items())
                        for clause in v
                    ):
                        ok = False
                        break
                elif d.get(k) != v:
                    ok = False
                    break
            if ok:
                return d
        return None

    async def insert_one(self, doc):
        with self._lock:
            if doc["_id"] in self.docs:
                raise DuplicateKeyError(f"duplicate {doc['_id']}")
            self.docs[doc["_id"]] = dict(doc)
        return MagicMock(inserted_id=doc["_id"])

    async def update_one(self, q, upd, upsert=False):
        doc = await self.find_one(q)
        if not doc and upsert:
            doc = {"_id": q.get("_id")}
            self.docs[doc["_id"]] = doc
        if not doc:
            return MagicMock(modified_count=0)
        if "$set" in upd:
            doc.update(upd["$set"])
        if "$inc" in upd:
            for k, v in upd["$inc"].items():
                doc[k] = int(doc.get(k) or 0) + int(v)
        self.docs[doc["_id"]] = doc
        return MagicMock(modified_count=1)

    async def delete_one(self, q):
        doc = await self.find_one(q)
        if doc:
            del self.docs[doc["_id"]]
        return MagicMock(deleted_count=1 if doc else 0)

    def find(self, q=None):
        q = q or {}

        class C:
            def __init__(self, docs, query):
                self._docs = docs
                self._q = query

            def sort(self, *a, **k):
                return self

            async def to_list(self, n):
                out = []
                for d in self._docs:
                    ok = all(d.get(k) == v for k, v in self._q.items()) if self._q else True
                    if ok:
                        out.append(d)
                return out[:n]

        return C(list(self.docs.values()), q)


class FakeDB:
    def __init__(self):
        self.platform_products = FakeColl()
        self.platform_instances = FakeColl()
        self.platform_api_keys = FakeColl()
        self.platform_audit_log = FakeColl()
        self.platform_nonces = FakeColl()
        self.platform_rate = FakeColl()
        self.platform_usage = FakeColl()
        self.platform_heartbeats = FakeColl()
        self.companies = FakeColl()
        self.company_licenses = FakeColl()
        self.saas_plans = FakeColl()
        self.platform_settings = FakeColl()


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB()
    store.init(fake)
    platform_v1.init(fake)
    monkeypatch.setattr("comm_service.encrypt", lambda v: "enc:" + (v or ""))
    monkeypatch.setattr("comm_service.decrypt", lambda v: (v or "").removeprefix("enc:"))
    return fake


def _signed_headers(secret, key_id, method, path, body: bytes, nonce=None, ts=None):
    ts = ts or str(int(time.time()))
    nonce = nonce or secrets.token_hex(8)
    sig = store.sign_payload(secret, ts, nonce, method, path, body)
    return {
        "X-Platform-Key": key_id,
        "X-Platform-Timestamp": ts,
        "X-Platform-Nonce": nonce,
        "X-Platform-Signature": sig,
        "Content-Type": "application/json",
    }, ts, nonce


def with_peer(app, ip: str):
    """Copy the ASGI scope and set the TCP peer. TestClient cannot do this itself."""

    async def application(scope, receive, send):
        if scope.get("type") == "http":
            scope = dict(scope)
            scope["client"] = (ip, 1234)
        await app(scope, receive, send)

    return application


def _peer_client(ip: str) -> TestClient:
    app = FastAPI()
    app.include_router(platform_v1.router)
    return TestClient(with_peer(app, ip))


def _request(method: str, path: str, peer: str, headers: dict) -> Request:
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "headers": [(k.lower().encode(), v.encode()) for k, v in headers.items()],
        "client": (peer, 1234),
        "server": ("127.0.0.1", 8000),
    }
    return Request(scope)


def _mock_effective(monkeypatch):
    monkeypatch.setattr(
        "saas.effective",
        AsyncMock(return_value={
            "status": "active",
            "locked": False,
            "plan_name": "P",
            "modules": {},
            "user_limit": 1,
        }),
    )


def _issue_key(db):
    async def setup():
        await store.ensure_seeded()
        prod = (await store.list_products())[0]
        if "comp_x" not in db.companies.docs:
            await db.companies.insert_one({"_id": "comp_x", "name": "X"})
        return await store.create_api_key(
            product_id=prod["id"],
            name="ip",
            actor_id="sa1",
            scopes=["license:verify", "platform:all"],
        )

    return asyncio.run(setup())


_VERIFY = "/api/platform/v1/licenses/verify"
_BODY = b'{"company_id":"comp_x"}'


def _rate_ids(db):
    return list(db.platform_rate.docs)


def _audits(db):
    return list(db.platform_audit_log.docs.values())


def test_forwarded_for_behind_loopback_is_rate_audit_and_last_used(db, monkeypatch):
    _mock_effective(monkeypatch)
    pub, secret = _issue_key(db)
    client = _peer_client("127.0.0.1")
    headers, _, _ = _signed_headers(secret, pub["id"], "POST", _VERIFY, _BODY)
    headers["X-Forwarded-For"] = "203.0.113.7"

    response = client.post(_VERIFY, content=_BODY, headers=headers)

    assert response.status_code == 200, response.text
    ids = _rate_ids(db)
    assert any(bucket.startswith("rl:ip:203.0.113.7:") for bucket in ids)
    assert not any(bucket.startswith("rl:ip:127.0.0.1:") for bucket in ids)
    assert _audits(db)[-1]["ip"] == "203.0.113.7"
    assert db.platform_api_keys.docs[pub["id"]]["last_used_ip"] == "203.0.113.7"


def test_x_real_ip_wins_over_forwarded_for(db, monkeypatch):
    _mock_effective(monkeypatch)
    pub, secret = _issue_key(db)
    client = _peer_client("127.0.0.1")
    headers, _, _ = _signed_headers(secret, pub["id"], "POST", _VERIFY, _BODY)
    headers["X-Real-IP"] = "198.51.100.4"
    headers["X-Forwarded-For"] = "203.0.113.9"

    response = client.post(_VERIFY, content=_BODY, headers=headers)

    assert response.status_code == 200, response.text
    ids = _rate_ids(db)
    assert any(bucket.startswith("rl:ip:198.51.100.4:") for bucket in ids)
    assert not any(bucket.startswith("rl:ip:203.0.113.9:") for bucket in ids)
    assert _audits(db)[-1]["ip"] == "198.51.100.4"


def test_spoofed_xff_from_non_proxy_peer_is_ignored(db, monkeypatch):
    _mock_effective(monkeypatch)
    pub, secret = _issue_key(db)
    client = _peer_client("198.51.100.20")
    headers, _, _ = _signed_headers(secret, pub["id"], "POST", _VERIFY, _BODY)
    headers["X-Forwarded-For"] = "203.0.113.1"

    response = client.post(_VERIFY, content=_BODY, headers=headers)

    assert response.status_code == 200, response.text
    ids = _rate_ids(db)
    assert any(bucket.startswith("rl:ip:198.51.100.20:") for bucket in ids)
    assert _audits(db)[-1]["ip"] == "198.51.100.20"
    assert db.platform_api_keys.docs[pub["id"]]["last_used_ip"] == "198.51.100.20"
    blob = json.dumps({"rates": ids, "audits": _audits(db), "key": db.platform_api_keys.docs[pub["id"]]})
    assert "203.0.113.1" not in blob


def test_distinct_forwarded_ips_have_separate_buckets(db, monkeypatch):
    monkeypatch.setattr(store, "IP_RATE_LIMIT", 3)
    pub, _secret = _issue_key(db)
    client = _peer_client("127.0.0.1")

    def broken(xff: str):
        ts = str(int(time.time()))
        headers = {
            "X-Platform-Key": pub["id"],
            "X-Platform-Timestamp": ts,
            "X-Platform-Nonce": secrets.token_hex(8),
            "X-Platform-Signature": "0" * 64,
            "Content-Type": "application/json",
            "X-Forwarded-For": xff,
        }
        return client.post(_VERIFY, content=_BODY, headers=headers)

    for _ in range(3):
        first = broken("203.0.113.10")
        assert first.status_code == 401, first.text
    limited = broken("203.0.113.10")
    assert limited.status_code == 429, limited.text

    other = broken("203.0.113.11")
    assert other.status_code == 401, other.text

    ids = _rate_ids(db)
    assert any(bucket.startswith("rl:ip:203.0.113.10:") for bucket in ids)
    assert any(bucket.startswith("rl:ip:203.0.113.11:") for bucket in ids)
    assert not any(bucket.startswith("rl:ip:127.0.0.1:") for bucket in ids)


def test_platform_admin_ip_helper_writes_audit(db):
    peer_ip = "203.0.113.40"
    request = _request("POST", "/api/platform/admin/products", "127.0.0.1", {"x-forwarded-for": peer_ip})
    ip = platform_admin._ip(request)
    assert ip == peer_ip

    async def run():
        return await store.create_product(
            {"code": "ipprod", "name": "IP Prod", "kind": "other"},
            actor_id="sa1",
            ip=ip,
        )

    asyncio.run(run())
    created = [row for row in _audits(db) if row["action"] == "product.create"]
    assert len(created) == 1
    assert created[0]["ip"] == peer_ip


def test_platform_admin_audit_middleware_records_forwarded_ip(db):
    store.init(db)

    async def call_next(_request):
        return Response(status_code=200)

    post = _request(
        "POST",
        "/api/system/plans",
        "127.0.0.1",
        {"x-forwarded-for": "203.0.113.50"},
    )
    asyncio.run(server._platform_admin_audit_middleware(post, call_next))
    rows = _audits(db)
    assert len(rows) == 1
    assert rows[0]["ip"] == "203.0.113.50"
    assert rows[0]["action"] == "post /api/system/plans"

    get = _request(
        "GET",
        "/api/system/plans",
        "127.0.0.1",
        {"x-forwarded-for": "203.0.113.50"},
    )
    asyncio.run(server._platform_admin_audit_middleware(get, call_next))
    assert len(_audits(db)) == 1


def test_audit_details_and_logs_do_not_leak_secrets(db, monkeypatch, caplog):
    _mock_effective(monkeypatch)
    pub, secret = _issue_key(db)
    client = _peer_client("127.0.0.1")
    headers, _, _ = _signed_headers(secret, pub["id"], "POST", _VERIFY, _BODY)
    signature = headers["X-Platform-Signature"]
    auth_value = "Bearer plat-auth-do-not-leak"
    headers["X-Forwarded-For"] = "203.0.113.7"
    headers["Authorization"] = auth_value

    caplog.set_level(logging.DEBUG)
    response = client.post(_VERIFY, content=_BODY, headers=headers)

    assert response.status_code == 200, response.text
    details = json.dumps(_audits(db)[-1]["details"])
    logged = caplog.text
    for hidden in (secret, signature, auth_value, "plat-auth-do-not-leak"):
        assert hidden not in details
        assert hidden not in logged
