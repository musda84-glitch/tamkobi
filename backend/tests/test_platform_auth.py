"""Platform HMAC authenticator: shared module, IP allowlist, atomic rate buckets.

In-memory FakeDB + FastAPI TestClient only. No live database, no port 8021.
"""
from __future__ import annotations

import asyncio
import json
import logging
import secrets
import time
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import APIRouter, FastAPI, Request
from fastapi.testclient import TestClient

import platform_admin
import platform_auth
import platform_store as store
import platform_v1
import saas
from mysql_store import DuplicateKeyError


class FakeColl:
    def __init__(self):
        self.docs = {}
        import threading
        self._lock = threading.Lock()
        self.atomic_calls = 0

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
        return SimpleNamespace(inserted_id=doc["_id"])

    async def update_one(self, q, upd, upsert=False):
        doc = await self.find_one(q)
        if not doc and upsert:
            doc = {"_id": q.get("_id")}
            self.docs[doc["_id"]] = doc
        if not doc:
            return SimpleNamespace(matched_count=0, modified_count=0)
        if "$set" in upd:
            doc.update(upd["$set"])
        if "$inc" in upd:
            for k, v in upd["$inc"].items():
                doc[k] = int(doc.get(k) or 0) + int(v)
        self.docs[doc["_id"]] = doc
        return SimpleNamespace(matched_count=1, modified_count=1)

    async def update_one_atomic(self, q, upd):
        """Equality _id plus $lt, under a thread lock. Yields once so gather overlaps."""
        await asyncio.sleep(0)
        with self._lock:
            self.atomic_calls += 1
            doc_id = q.get("_id")
            doc = self.docs.get(doc_id)
            if doc is None or not _atomic_match(doc, q):
                return SimpleNamespace(matched_count=0, modified_count=0)
            if "$set" in upd:
                doc.update(upd["$set"])
            if "$inc" in upd:
                for k, v in upd["$inc"].items():
                    doc[k] = int(doc.get(k) or 0) + int(v)
            self.docs[doc["_id"]] = doc
            return SimpleNamespace(matched_count=1, modified_count=1)

    async def delete_one(self, q):
        doc = await self.find_one(q)
        if doc:
            del self.docs[doc["_id"]]
        return SimpleNamespace(deleted_count=1 if doc else 0)

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


class RacyColl(FakeColl):
    """update_one yields between the caller's read and the write."""

    def __init__(self):
        super().__init__()
        self.update_calls = 0

    async def update_one(self, q, upd, upsert=False):
        self.update_calls += 1
        await asyncio.sleep(0)
        return await super().update_one(q, upd, upsert=upsert)


def _atomic_match(doc, q) -> bool:
    for key, expected in q.items():
        if isinstance(expected, dict) and "$lt" in expected:
            cur = doc.get(key)
            if cur is None or not cur < expected["$lt"]:
                return False
        elif doc.get(key) != expected:
            return False
    return True


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


def _mock_effective(monkeypatch):
    monkeypatch.setattr(
        "saas.effective",
        AsyncMock(return_value={
            "status": "active",
            "locked": False,
            "plan_name": "P",
            "modules": {"invoices": True},
            "user_limit": 3,
            "expires_at": "2099-01-01T00:00:00+00:00",
        }),
    )


def _issue(db, scopes=None, ip_allowlist=None, name="k"):
    async def setup():
        await store.ensure_seeded()
        prod = (await store.list_products())[0]
        if "comp_x" not in db.companies.docs:
            await db.companies.insert_one({"_id": "comp_x", "name": "X"})
        kwargs = {
            "product_id": prod["id"],
            "name": name,
            "actor_id": "sa1",
            "scopes": scopes or ["license:verify", "platform:all"],
        }
        if ip_allowlist is not None:
            kwargs["ip_allowlist"] = ip_allowlist
        return await store.create_api_key(**kwargs)

    return asyncio.run(setup())


_VERIFY = "/api/platform/v1/licenses/verify"
_BODY = b'{"company_id":"comp_x"}'
_LICENSE_FIELDS = {"valid", "plan", "status", "valid_until", "modules", "seats"}


def _audits(db):
    return list(db.platform_audit_log.docs.values())


def _detail(response):
    body = response.json()
    return body.get("detail")


def test_valid_signature_ok(db, monkeypatch):
    _mock_effective(monkeypatch)
    pub, secret = _issue(db)
    client = _peer_client("127.0.0.1")
    headers, _, _ = _signed_headers(secret, pub["id"], "POST", _VERIFY, _BODY)
    response = client.post(_VERIFY, content=_BODY, headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    assert _LICENSE_FIELDS <= set(body)
    assert body["valid"] is True
    assert body["plan"] == "P"
    assert body["status"] == "active"
    assert body["modules"] == {"invoices": True}
    assert body["seats"] == 3


def test_bad_signature_401(db, monkeypatch):
    _mock_effective(monkeypatch)
    pub, secret = _issue(db)
    client = _peer_client("127.0.0.1")
    headers, _, _ = _signed_headers(secret, pub["id"], "POST", _VERIFY, _BODY)
    headers["X-Platform-Signature"] = "0" * 64
    response = client.post(_VERIFY, content=_BODY, headers=headers)
    assert response.status_code == 401
    assert _detail(response) == "İmza doğrulanamadı"
    assert db.platform_nonces.docs == {}
    assert not any(bucket.startswith("rl:key:") for bucket in db.platform_rate.docs)


def test_replay_nonce_401(db, monkeypatch):
    _mock_effective(monkeypatch)
    pub, secret = _issue(db)
    client = _peer_client("127.0.0.1")
    headers, _, _ = _signed_headers(secret, pub["id"], "POST", _VERIFY, _BODY, nonce="replay-1")
    first = client.post(_VERIFY, content=_BODY, headers=headers)
    assert first.status_code == 200, first.text
    second = client.post(_VERIFY, content=_BODY, headers=headers)
    assert second.status_code == 401
    assert _detail(second) == "Tekrarlanan nonce"


def test_expired_timestamp_401(db, monkeypatch):
    pub, secret = _issue(db)
    client = _peer_client("127.0.0.1")
    old = str(int(time.time()) - 301)
    headers, _, _ = _signed_headers(secret, pub["id"], "POST", _VERIFY, _BODY, ts=old)
    response = client.post(_VERIFY, content=_BODY, headers=headers)
    assert response.status_code == 401
    assert _detail(response) == "Timestamp kayması çok büyük"

    bad, _, _ = _signed_headers(secret, pub["id"], "POST", _VERIFY, _BODY)
    bad["X-Platform-Timestamp"] = "abc"
    response = client.post(_VERIFY, content=_BODY, headers=bad)
    assert response.status_code == 401
    assert _detail(response) == "Geçersiz timestamp"

    missing, _, _ = _signed_headers(secret, pub["id"], "POST", _VERIFY, _BODY)
    del missing["X-Platform-Signature"]
    response = client.post(_VERIFY, content=_BODY, headers=missing)
    assert response.status_code == 401
    assert _detail(response) == "Eksik imza başlıkları"


def test_scope_deny_403(db, monkeypatch):
    pub, secret = _issue(db, scopes=["heartbeat"], name="hb")
    client = _peer_client("127.0.0.1")
    headers, _, _ = _signed_headers(secret, pub["id"], "POST", _VERIFY, _BODY)
    response = client.post(_VERIFY, content=_BODY, headers=headers)
    assert response.status_code == 403
    assert _detail(response) == "Kapsam yetersiz"

    async def _published(**kwargs):
        return []

    monkeypatch.setattr("help_center.fetch_published", _published)
    wide, wide_secret = _issue(db, scopes=["platform:all"], name="all")
    path = "/api/platform/v1/help/articles"
    headers, _, _ = _signed_headers(wide_secret, wide["id"], "GET", path, b"")
    listed = client.get(path, headers=headers)
    assert listed.status_code == 200, listed.text
    assert listed.json()["count"] == 0


def test_ip_allowlist_allow(db, monkeypatch):
    _mock_effective(monkeypatch)
    pub, secret = _issue(db, ip_allowlist=["203.0.113.7"], name="allow")
    client = _peer_client("127.0.0.1")
    headers, _, _ = _signed_headers(secret, pub["id"], "POST", _VERIFY, _BODY)
    headers["X-Real-IP"] = "203.0.113.7"
    response = client.post(_VERIFY, content=_BODY, headers=headers)
    assert response.status_code == 200, response.text
    assert _LICENSE_FIELDS <= set(response.json())


def test_ip_allowlist_deny(db, monkeypatch):
    calls = {"n": 0}
    real = store.verify_signature

    def _counted(*args, **kwargs):
        calls["n"] += 1
        return real(*args, **kwargs)

    monkeypatch.setattr(store, "verify_signature", _counted)
    pub, secret = _issue(db, ip_allowlist=["203.0.113.7"], name="deny")
    client = _peer_client("127.0.0.1")
    headers, _, nonce = _signed_headers(secret, pub["id"], "POST", _VERIFY, _BODY)
    headers["X-Real-IP"] = "198.51.100.9"
    response = client.post(_VERIFY, content=_BODY, headers=headers)
    assert response.status_code == 403
    assert _detail(response) == "IP adresi bu anahtar için izinli değil"
    denied = [row for row in _audits(db) if row["action"] == "v1.auth.ip_denied"]
    assert len(denied) == 1
    assert denied[0]["actor_type"] == "api_key"
    assert denied[0]["actor_id"] == pub["id"]
    assert denied[0]["target_id"] == pub["id"]
    assert denied[0]["ip"] == "198.51.100.9"
    assert denied[0]["details"] == {"path": _VERIFY, "scope": "license:verify"}
    assert nonce not in db.platform_nonces.docs
    assert db.platform_nonces.docs == {}
    assert not any(bucket.startswith("rl:key:") for bucket in db.platform_rate.docs)
    assert calls["n"] == 0
    assert "203.0.113.7" not in json.dumps(denied)
    assert secret not in json.dumps(denied)

    unknown = _peer_client("not-an-ip")
    bad_headers, _, _ = _signed_headers(secret, pub["id"], "POST", _VERIFY, _BODY)
    invalid = unknown.post(_VERIFY, content=_BODY, headers=bad_headers)
    assert invalid.status_code == 403
    assert _detail(invalid) == "IP adresi bu anahtar için izinli değil"
    blank = _peer_client("")
    blank_headers, _, _ = _signed_headers(secret, pub["id"], "POST", _VERIFY, _BODY)
    missing_peer = blank.post(_VERIFY, content=_BODY, headers=blank_headers)
    assert missing_peer.status_code == 403
    assert [row["ip"] for row in _audits(db) if row["action"] == "v1.auth.ip_denied"] == [
        "198.51.100.9",
        "not-an-ip",
        "unknown",
    ]
    assert calls["n"] == 0


def test_ip_allowlist_cidr(db, monkeypatch):
    _mock_effective(monkeypatch)
    pub, secret = _issue(db, ip_allowlist=["10.0.0.0/24"], name="cidr")
    client = _peer_client("127.0.0.1")

    def post(ip):
        headers, _, _ = _signed_headers(secret, pub["id"], "POST", _VERIFY, _BODY)
        headers["X-Real-IP"] = ip
        return client.post(_VERIFY, content=_BODY, headers=headers)

    allowed = post("10.0.0.42")
    assert allowed.status_code == 200, allowed.text
    denied = post("10.0.1.1")
    assert denied.status_code == 403
    assert _detail(denied) == "IP adresi bu anahtar için izinli değil"


def test_ip_allowlist_ipv6(db, monkeypatch):
    _mock_effective(monkeypatch)
    pub, secret = _issue(db, ip_allowlist=["2001:db8::/32"], name="v6")
    client = _peer_client("127.0.0.1")

    def post(ip):
        headers, _, _ = _signed_headers(secret, pub["id"], "POST", _VERIFY, _BODY)
        headers["X-Real-IP"] = ip
        return client.post(_VERIFY, content=_BODY, headers=headers)

    allowed = post("2001:db8::1")
    assert allowed.status_code == 200, allowed.text
    denied = post("2001:db9::1")
    assert denied.status_code == 403
    assert _detail(denied) == "IP adresi bu anahtar için izinli değil"

    mapped, mapped_secret = _issue(db, ip_allowlist=["192.0.2.0/24"], name="mapped")
    headers, _, _ = _signed_headers(mapped_secret, mapped["id"], "POST", _VERIFY, _BODY)
    headers["X-Real-IP"] = "::ffff:192.0.2.5"
    response = client.post(_VERIFY, content=_BODY, headers=headers)
    assert response.status_code == 200, response.text


def test_ip_allowlist_empty_allows_all(db, monkeypatch):
    _mock_effective(monkeypatch)
    empty, empty_secret = _issue(db, ip_allowlist=[], name="empty")
    assert empty["ip_allowlist"] == []
    legacy, legacy_secret = _issue(db, name="legacy")
    del db.platform_api_keys.docs[legacy["id"]]["ip_allowlist"]
    client = _peer_client("127.0.0.1")

    def post(secret, key_id, ip):
        headers, _, _ = _signed_headers(secret, key_id, "POST", _VERIFY, _BODY)
        headers["X-Real-IP"] = ip
        return client.post(_VERIFY, content=_BODY, headers=headers)

    for secret, key_id, ip in (
        (empty_secret, empty["id"], "198.51.100.9"),
        (empty_secret, empty["id"], "2001:db8::9"),
        (legacy_secret, legacy["id"], "203.0.113.7"),
        (legacy_secret, legacy["id"], "10.1.2.3"),
    ):
        response = post(secret, key_id, ip)
        assert response.status_code == 200, response.text


def test_ip_allowlist_validation(db):
    async def run():
        await store.ensure_seeded()
        pid = (await store.list_products())[0]["id"]
        with pytest.raises(ValueError, match="Geçersiz"):
            await store.create_api_key(
                product_id=pid, name="bad-ip", actor_id="sa1", ip_allowlist=["not-an-ip"],
            )
        with pytest.raises(ValueError, match="Geçersiz"):
            await store.create_api_key(
                product_id=pid, name="host-bits", actor_id="sa1", ip_allowlist=["10.0.0.5/24"],
            )
        pub, secret = await store.create_api_key(
            product_id=pid,
            name="canon",
            actor_id="sa1",
            scopes=["license:verify"],
            ip_allowlist=["1.2.3.4", "  1.2.3.4  "],
        )
        assert pub["ip_allowlist"] == ["1.2.3.4/32"]
        assert "secret" not in pub
        assert "secret_enc" not in pub
        assert "secret_hash" not in pub
        assert secret not in json.dumps(pub)
        assert "enc:" not in json.dumps(pub)
        stored = db.platform_api_keys.docs[pub["id"]]
        assert stored["ip_allowlist"] == ["1.2.3.4/32"]
        created = [row for row in _audits(db) if row["action"] == "api_key.create" and row["target_id"] == pub["id"]]
        assert created[0]["details"]["ip_allowlist"] == ["1.2.3.4/32"]
        assert secret not in json.dumps(created)
        new_pub, new_secret = await store.rotate_api_key(pub["id"], actor_id="sa1")
        assert new_pub["ip_allowlist"] == ["1.2.3.4/32"]
        assert db.platform_api_keys.docs[new_pub["id"]]["ip_allowlist"] == ["1.2.3.4/32"]
        assert new_secret not in json.dumps(new_pub)
        assert "secret" not in new_pub
        return pid

    pid = asyncio.run(run())
    app = FastAPI()
    app.include_router(platform_admin.router)
    app.dependency_overrides[saas.require_super_admin] = lambda: {"id": "sa1", "is_super_admin": True}
    client = TestClient(app)
    for bad in (["not-an-ip"], ["10.0.0.5/24"]):
        response = client.post(
            "/api/platform/admin/api-keys",
            json={"product_id": pid, "name": "http-bad", "ip_allowlist": bad},
        )
        assert response.status_code == 400, response.text
        assert "Geçersiz" in response.json()["detail"]
    ok = client.post(
        "/api/platform/admin/api-keys",
        json={
            "product_id": pid,
            "name": "http-ok",
            "ip_allowlist": ["1.2.3.4", "  1.2.3.4  "],
        },
    )
    assert ok.status_code == 200, ok.text
    key = ok.json()["key"]
    assert key["ip_allowlist"] == ["1.2.3.4/32"]
    assert ok.json()["secret"] not in json.dumps(key)
    assert "enc:" not in json.dumps(key)


def _count_true(results):
    return sum(1 for item in results if item)


def test_rate_limit_atomic_concurrent(db, monkeypatch):
    monkeypatch.setattr(store.time, "time", lambda: 1_800_000_000.0)
    minute = 1_800_000_000 // 60

    async def gather_key():
        return await asyncio.gather(*[
            store.check_rate_limit("pk_gather") for _ in range(store.KEY_RATE_LIMIT + 30)
        ])

    before = db.platform_rate.atomic_calls
    key_results = asyncio.run(gather_key())
    key_bucket = f"rl:key:pk_gather:{minute}"
    assert _count_true(key_results) == store.KEY_RATE_LIMIT
    assert db.platform_rate.docs[key_bucket]["count"] == store.KEY_RATE_LIMIT
    assert db.platform_rate.atomic_calls - before == store.KEY_RATE_LIMIT + 30

    def thread_key(_n):
        return asyncio.run(store.check_rate_limit("pk_threads"))

    before = db.platform_rate.atomic_calls
    with ThreadPoolExecutor(max_workers=8) as pool:
        thread_results = list(pool.map(thread_key, range(store.KEY_RATE_LIMIT + 30)))
    thread_bucket = f"rl:key:pk_threads:{minute}"
    assert _count_true(thread_results) == store.KEY_RATE_LIMIT
    assert db.platform_rate.docs[thread_bucket]["count"] == store.KEY_RATE_LIMIT
    assert db.platform_rate.atomic_calls - before == store.KEY_RATE_LIMIT + 30

    async def gather_ip():
        return await asyncio.gather(*[
            store.check_ip_rate_limit("198.51.100.77") for _ in range(store.IP_RATE_LIMIT + 20)
        ])

    before = db.platform_rate.atomic_calls
    ip_results = asyncio.run(gather_ip())
    ip_bucket = f"rl:ip:198.51.100.77:{minute}"
    assert _count_true(ip_results) == store.IP_RATE_LIMIT
    assert db.platform_rate.docs[ip_bucket]["count"] == store.IP_RATE_LIMIT
    assert db.platform_rate.atomic_calls - before == store.IP_RATE_LIMIT + 20

    def thread_ip(_n):
        return asyncio.run(store.check_ip_rate_limit("198.51.100.78"))

    before = db.platform_rate.atomic_calls
    with ThreadPoolExecutor(max_workers=8) as pool:
        ip_thread_results = list(pool.map(thread_ip, range(store.IP_RATE_LIMIT + 20)))
    ip_thread_bucket = f"rl:ip:198.51.100.78:{minute}"
    assert _count_true(ip_thread_results) == store.IP_RATE_LIMIT
    assert db.platform_rate.docs[ip_thread_bucket]["count"] == store.IP_RATE_LIMIT
    assert db.platform_rate.atomic_calls - before == store.IP_RATE_LIMIT + 20

    limit = 5
    burst = 20

    async def old_bump(coll, bucket):
        doc = await coll.find_one({"_id": bucket})
        count = int((doc or {}).get("count") or 0)
        if count >= limit:
            return False
        await coll.update_one(
            {"_id": bucket},
            {"$inc": {"count": 1}, "$set": {
                "key_id": "old",
                "updated_at": "t",
                "expires_at": "2099-01-01T00:00:00+00:00",
            }},
            upsert=True,
        )
        return True

    old_coll = RacyColl()

    async def run_old():
        return await asyncio.gather(*[old_bump(old_coll, "rl:key:old:1") for _ in range(burst)])

    old_results = asyncio.run(run_old())
    assert _count_true(old_results) == burst
    assert old_coll.docs["rl:key:old:1"]["count"] == burst
    assert old_coll.update_calls == burst
    assert old_coll.atomic_calls == 0

    new_coll = RacyColl()
    db.platform_rate = new_coll

    async def run_new():
        return await asyncio.gather(*[
            store._bump_rate("rl:key:new:1", limit, key_id="new") for _ in range(burst)
        ])

    new_results = asyncio.run(run_new())
    assert _count_true(new_results) == limit
    assert new_coll.docs["rl:key:new:1"]["count"] == limit
    assert new_coll.atomic_calls == burst
    assert new_coll.update_calls == 0


def test_rate_limit_429_contract(db, monkeypatch):
    _mock_effective(monkeypatch)
    pub, secret = _issue(db, ip_allowlist=["203.0.113.7"], name="quota")

    async def fill_key():
        oks = []
        for _ in range(store.KEY_RATE_LIMIT):
            oks.append(await store.check_rate_limit(pub["id"]))
        return oks

    assert all(asyncio.run(fill_key()))
    client = _peer_client("127.0.0.1")
    headers, _, _ = _signed_headers(secret, pub["id"], "POST", _VERIFY, _BODY)
    headers["X-Real-IP"] = "203.0.113.7"
    limited = client.post(_VERIFY, content=_BODY, headers=headers)
    assert limited.status_code == 429
    assert _detail(limited) == "Dakika limiti aşıldı"
    key_buckets = [k for k in db.platform_rate.docs if k.startswith(f"rl:key:{pub['id']}:")]
    assert len(key_buckets) == 1
    assert key_buckets[0].rsplit(":", 1)[-1].isdigit()
    assert db.platform_rate.docs[key_buckets[0]]["count"] == store.KEY_RATE_LIMIT

    ip = "203.0.113.8"

    async def fill_ip():
        oks = []
        for _ in range(store.IP_RATE_LIMIT):
            oks.append(await store.check_ip_rate_limit(ip))
        return oks

    assert all(asyncio.run(fill_ip()))
    ip_buckets = [k for k in db.platform_rate.docs if k.startswith(f"rl:ip:{ip}:")]
    assert len(ip_buckets) == 1
    assert ip_buckets[0].rsplit(":", 1)[-1].isdigit()
    assert db.platform_rate.docs[ip_buckets[0]]["count"] == store.IP_RATE_LIMIT

    calls = {"n": 0}
    real = store.verify_signature

    def _counted(*args, **kwargs):
        calls["n"] += 1
        return real(*args, **kwargs)

    monkeypatch.setattr(store, "verify_signature", _counted)
    proxied = _peer_client("127.0.0.1")
    ip_headers, _, _ = _signed_headers(secret, pub["id"], "POST", _VERIFY, _BODY)
    ip_headers["X-Real-IP"] = ip
    ip_limited = proxied.post(_VERIFY, content=_BODY, headers=ip_headers)
    assert ip_limited.status_code == 429
    assert _detail(ip_limited) == "IP dakika limiti aşıldı"
    assert db.platform_rate.docs[ip_buckets[0]]["count"] == store.IP_RATE_LIMIT
    assert calls["n"] == 0
    assert not any(row["action"] == "v1.auth.ip_denied" and row["ip"] == ip for row in _audits(db))

    async def expire_and_clean():
        for doc in db.platform_rate.docs.values():
            assert doc.get("expires_at")
            doc["expires_at"] = "2000-01-01T00:00:00+00:00"
        return await store.cleanup_platform_ephemera(db)

    cleaned = asyncio.run(expire_and_clean())
    assert cleaned["rates"] >= 1
    assert db.platform_rate.docs == {}


def test_audit_key_id_ip_no_secret(db, monkeypatch, caplog):
    _mock_effective(monkeypatch)
    pub, secret = _issue(db, name="audit")
    client = _peer_client("127.0.0.1")
    headers, _, _ = _signed_headers(secret, pub["id"], "POST", _VERIFY, _BODY)
    signature = headers["X-Platform-Signature"]
    headers["X-Real-IP"] = "203.0.113.77"
    caplog.set_level(logging.DEBUG)
    response = client.post(_VERIFY, content=_BODY, headers=headers)
    assert response.status_code == 200, response.text
    success = [row for row in _audits(db) if row["action"] == "v1.license:verify"]
    assert len(success) == 1
    assert success[0]["actor_type"] == "api_key"
    assert success[0]["actor_id"] == pub["id"]
    assert success[0]["target_id"] == pub["id"]
    assert success[0]["ip"] == "203.0.113.77"
    assert success[0]["details"] == {"path": _VERIFY}

    denied_pub, denied_secret = _issue(db, ip_allowlist=["203.0.113.7"], name="audit-deny")
    deny_headers, _, _ = _signed_headers(denied_secret, denied_pub["id"], "POST", _VERIFY, _BODY)
    deny_sig = deny_headers["X-Platform-Signature"]
    deny_headers["X-Real-IP"] = "198.51.100.9"
    denied = client.post(_VERIFY, content=_BODY, headers=deny_headers)
    assert denied.status_code == 403
    deny_rows = [row for row in _audits(db) if row["action"] == "v1.auth.ip_denied"]
    assert len(deny_rows) == 1
    assert deny_rows[0]["actor_id"] == denied_pub["id"]
    assert deny_rows[0]["ip"] == "198.51.100.9"
    assert deny_rows[0]["details"] == {"path": _VERIFY, "scope": "license:verify"}

    blob = json.dumps(_audits(db))
    for hidden in (secret, denied_secret, signature, deny_sig, "enc:"):
        assert hidden not in blob
        assert hidden not in caplog.text


def test_platform_auth_reusable(db, monkeypatch):
    router = APIRouter()

    @router.post("/api/platform/admin-v1-test")
    async def admin_v1_test(request: Request):
        key_doc, payload = await platform_auth.authenticate(
            request,
            required_scope="x:y",
            audit_prefix="admin_v1",
        )
        return {"ok": True, "key_id": key_doc["_id"], "n": payload.get("n")}

    app = FastAPI()
    app.include_router(router)
    pub, secret = _issue(db, scopes=["x:y"], name="reuse")
    path = "/api/platform/admin-v1-test"
    body = b'{"n":1}'
    headers, _, _ = _signed_headers(secret, pub["id"], "POST", path, body)
    response = TestClient(app).post(path, content=body, headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["key_id"] == pub["id"]
    assert response.json()["n"] == 1
    rows = [row for row in _audits(db) if row["action"] == "admin_v1.x:y"]
    assert len(rows) == 1
    assert rows[0]["actor_id"] == pub["id"]
    assert rows[0]["target_id"] == pub["id"]
    assert rows[0]["actor_type"] == "api_key"
