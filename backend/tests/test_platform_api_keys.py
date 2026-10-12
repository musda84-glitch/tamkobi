"""Platform API keys: secret once, HMAC, scope, nonce race, IP limit, audit scrub."""
from __future__ import annotations

import asyncio
import json
import secrets
import time
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import platform_store as store
from mysql_store import DuplicateKeyError
import platform_v1


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
    monkeypatch.setattr("comm_service.encrypt", lambda v: "enc:" + (v or ""))
    monkeypatch.setattr("comm_service.decrypt", lambda v: (v or "").removeprefix("enc:"))
    return fake


async def _seed_two_products(db):
    await store.ensure_seeded()
    other = await store.create_product(
        {"code": "shopx", "name": "Shop X", "kind": "ecommerce"},
        actor_id="sa1",
    )
    tam = (await store.list_products())[0]
    # ensure tamkobi is first product
    tam = next(p for p in await store.list_products() if p["code"] == "tamkobi")
    await db.platform_instances.insert_one({
        "_id": "pi_a",
        "product_id": other["id"],
        "external_ref": "ext_a",
        "name": "A",
        "company_id": None,
        "status": "active",
        "plan_code": "basic",
        "modules": {},
    })
    await db.platform_instances.insert_one({
        "_id": "pi_b",
        "product_id": other["id"],
        "external_ref": "ext_b",
        "name": "B",
        "company_id": None,
        "status": "active",
        "plan_code": "pro",
        "modules": {},
    })
    await db.companies.insert_one({"_id": "comp_1", "name": "C1"})
    await db.companies.insert_one({"_id": "comp_2", "name": "C2"})
    return tam, other


def test_secret_shown_once_and_not_in_list(db):
    async def run():
        await store.ensure_seeded()
        prod = await store.list_products()
        pid = prod[0]["id"]
        pub, secret = await store.create_api_key(
            product_id=pid, name="t1", actor_id="sa1", ip="1.2.3.4"
        )
        assert secret and len(secret) > 20
        assert "secret" not in pub
        listed = await store.list_api_keys()
        assert secret not in json.dumps(listed[0])
        audit = (await store.list_audit())[0]
        assert secret not in json.dumps(audit.get("details") or {})

    asyncio.run(run())


def test_empty_scopes_rejected(db):
    async def run():
        await store.ensure_seeded()
        pid = (await store.list_products())[0]["id"]
        with pytest.raises(ValueError):
            await store.create_api_key(
                product_id=pid, name="x", scopes=[], actor_id="sa1"
            )

    asyncio.run(run())


def test_product_a_key_cannot_read_product_b_license(db, monkeypatch):
    async def run():
        tam, other = await _seed_two_products(db)

        async def fake_eff(cid):
            return {
                "status": "active", "locked": False, "plan_name": "Pro",
                "plan_id": "p", "expires_at": "2099-01-01T00:00:00+00:00",
                "modules": {}, "user_limit": 5,
            }

        monkeypatch.setattr("saas.effective", fake_eff)
        # Key for shopx (other), try to verify tamkobi company
        pub, _ = await store.create_api_key(
            product_id=other["id"], name="shop", actor_id="sa1",
            scopes=["license:verify", "platform:all"],
        )
        key = db.platform_api_keys.docs[pub["id"]]
        with pytest.raises(store.KeyScopeError):
            await store.verify_license(key_doc=key, company_id="comp_1")

        # Key for tamkobi with platform:all can read company
        pub2, _ = await store.create_api_key(
            product_id=tam["id"], name="tk", actor_id="sa1",
            scopes=["license:verify", "platform:all"],
        )
        key2 = db.platform_api_keys.docs[pub2["id"]]
        out = await store.verify_license(key_doc=key2, company_id="comp_1")
        assert out["valid"] is True

    asyncio.run(run())


def test_instance_bound_key_cannot_write_other_instance(db):
    async def run():
        _, other = await _seed_two_products(db)
        pub, _ = await store.create_api_key(
            product_id=other["id"], name="bound", actor_id="sa1",
            instance_id="pi_a", scopes=["heartbeat", "usage:write"],
        )
        key = db.platform_api_keys.docs[pub["id"]]
        await store.record_heartbeat(key_doc=key, instance_ref="pi_a", version="1")
        with pytest.raises(store.KeyScopeError):
            await store.record_heartbeat(key_doc=key, instance_ref="pi_b", version="1")
        with pytest.raises(store.KeyScopeError):
            await store.record_usage(key_doc=key, instance_ref="pi_b", metrics={"x": 1})
        usage = await store.record_usage(key_doc=key, instance_ref="pi_a", metrics={"x": 1})
        row = db.platform_usage.docs[usage["id"]]
        assert row["key_id"] == pub["id"]
        assert row["product_id"] == other["id"]

    asyncio.run(run())


def test_tamkobi_unbound_needs_platform_all(db, monkeypatch):
    async def run():
        tam, _ = await _seed_two_products(db)
        monkeypatch.setattr(
            "saas.effective",
            AsyncMock(return_value={
                "status": "active", "locked": False, "plan_name": "P",
                "modules": {}, "user_limit": 1,
            }),
        )
        pub, _ = await store.create_api_key(
            product_id=tam["id"], name="noall", actor_id="sa1",
            scopes=["license:verify"],
        )
        key = db.platform_api_keys.docs[pub["id"]]
        with pytest.raises(store.KeyScopeError):
            await store.verify_license(key_doc=key, company_id="comp_1")

    asyncio.run(run())


def test_valid_signature_and_bad_cases(db):
    async def run():
        await store.ensure_seeded()
        prod = (await store.list_products())[0]
        pub, secret = await store.create_api_key(
            product_id=prod["id"], name="sig", actor_id="sa1"
        )
        path = "/api/platform/v1/licenses/verify"
        body = b'{"company_id":"c1"}'
        ts = str(int(time.time()))
        nonce = "n1"
        sig = store.sign_payload(secret, ts, nonce, "POST", path, body)
        assert store.verify_signature(secret, ts, nonce, "POST", path, body, sig)
        assert store.verify_signature(secret, ts, nonce, "POST", path, body, sig.upper())
        assert not store.verify_signature(secret, ts, nonce, "POST", path, body, "deadbeef")
        assert not store.verify_signature(secret, ts, nonce, "POST", path, body, "not-hex!!!")
        assert not store.verify_signature(secret, ts, nonce, "POST", path, body, "ab")
        assert await store.check_and_store_nonce(pub["id"], nonce)
        assert not await store.check_and_store_nonce(pub["id"], nonce)

    asyncio.run(run())


def test_revoke_and_rotation_grace(db):
    async def run():
        await store.ensure_seeded()
        prod = (await store.list_products())[0]
        pub, secret = await store.create_api_key(
            product_id=prod["id"], name="r", actor_id="sa1"
        )
        await store.revoke_api_key(pub["id"], actor_id="sa1")
        doc, sec = await store.resolve_key_for_auth(pub["id"])
        assert doc is None

        old_pub, old_secret = await store.create_api_key(
            product_id=prod["id"], name="rot", actor_id="sa1"
        )
        new_pub, new_secret = await store.rotate_api_key(old_pub["id"], actor_id="sa1")
        doc, sec = await store.resolve_key_for_auth(old_pub["id"])
        assert sec == old_secret
        db.platform_api_keys.docs[old_pub["id"]]["grace_until"] = "2000-01-01T00:00:00+00:00"
        doc3, _ = await store.resolve_key_for_auth(old_pub["id"])
        assert doc3 is None
        assert (await store.resolve_key_for_auth(new_pub["id"]))[1] == new_secret

    asyncio.run(run())


def test_last_used_and_rate_limit(db):
    async def run():
        await store.ensure_seeded()
        prod = (await store.list_products())[0]
        pub, _ = await store.create_api_key(
            product_id=prod["id"], name="lu", actor_id="sa1"
        )
        await store.touch_last_used(pub["id"], "9.9.9.9")
        assert db.platform_api_keys.docs[pub["id"]].get("last_used_at")
        for _ in range(store.KEY_RATE_LIMIT):
            assert await store.check_rate_limit(pub["id"])
        assert not await store.check_rate_limit(pub["id"])

    asyncio.run(run())


def test_scrub_details_nested():
    dirty = {
        "ok": 1,
        "secret": "x",
        "nested": {
            "password": "p",
            "token": "t",
            "api_key": "k",
            "authorization": "Bearer x",
            "cookie": "a=b",
            "foo_enc": "enc",
            "keep": "yes",
            "deeper": [{"refresh_token": "r", "n": 1}],
        },
    }
    clean = store.scrub_details(dirty)
    assert clean == {"ok": 1, "nested": {"keep": "yes", "deeper": [{"n": 1}]}}


def test_write_audit_scrubs_nested(db):
    async def run():
        await store.write_audit(
            actor_type="system", actor_id="s", action="t",
            details={"secret": "no", "nested": {"password": "x", "ok": True}},
        )
        entry = list(db.platform_audit_log.docs.values())[0]
        assert "secret" not in entry["details"]
        assert "password" not in entry["details"]["nested"]
        assert entry["details"]["nested"]["ok"] is True

    asyncio.run(run())


def test_cleanup_platform_ephemera(db):
    async def run():
        await db.platform_nonces.insert_one({
            "_id": "old", "expires_at": "2000-01-01T00:00:00+00:00", "created_at": "2000-01-01T00:00:00+00:00",
        })
        await db.platform_nonces.insert_one({
            "_id": "new", "expires_at": "2099-01-01T00:00:00+00:00", "created_at": "2099-01-01T00:00:00+00:00",
        })
        await db.platform_rate.insert_one({
            "_id": "rl_old", "expires_at": "2000-01-01T00:00:00+00:00", "count": 1,
        })
        out = await store.cleanup_platform_ephemera(db)
        assert out["nonces"] == 1
        assert out["rates"] == 1
        assert "old" not in db.platform_nonces.docs
        assert "new" in db.platform_nonces.docs

    asyncio.run(run())


def _make_client(db, monkeypatch):
    store.init(db)
    platform_v1.init(db)
    monkeypatch.setattr("comm_service.encrypt", lambda v: "enc:" + (v or ""))
    monkeypatch.setattr("comm_service.decrypt", lambda v: (v or "").removeprefix("enc:"))
    app = FastAPI()
    app.include_router(platform_v1.router)
    return TestClient(app)


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


def test_ip_rate_limit_before_signature_does_not_burn_key(db, monkeypatch):
    """200 bad-signature requests then a valid signed request still succeeds (key quota intact)."""
    async def setup():
        await store.ensure_seeded()
        prod = (await store.list_products())[0]
        return await store.create_api_key(
            product_id=prod["id"], name="ip", actor_id="sa1",
            scopes=["license:verify", "platform:all"],
        )

    pub, secret = asyncio.run(setup())
    client = _make_client(db, monkeypatch)
    path = "/api/platform/v1/licenses/verify"
    body = b'{"company_id":"comp_x"}'

    monkeypatch.setattr(
        "saas.effective",
        AsyncMock(return_value={
            "status": "active", "locked": False, "plan_name": "P",
            "modules": {}, "user_limit": 1,
        }),
    )
    # Ensure company exists for resolve
    asyncio.run(db.companies.insert_one({"_id": "comp_x", "name": "X"}))

    for i in range(200):
        ts = str(int(time.time()))
        nonce = f"bad{i}"
        r = client.post(
            path,
            content=body,
            headers={
                "X-Platform-Key": pub["id"],
                "X-Platform-Timestamp": ts,
                "X-Platform-Nonce": nonce,
                "X-Platform-Signature": "0" * 64,
                "Content-Type": "application/json",
            },
        )
        assert r.status_code == 401, i

    hdrs, _, _ = _signed_headers(secret, pub["id"], "POST", path, body)
    r = client.post(path, content=body, headers=hdrs)
    assert r.status_code == 200, r.text


def test_concurrent_nonce_exactly_one_success(db, monkeypatch):
    async def setup():
        await store.ensure_seeded()
        prod = (await store.list_products())[0]
        await db.companies.insert_one({"_id": "comp_n", "name": "N"})
        return await store.create_api_key(
            product_id=prod["id"], name="n", actor_id="sa1",
            scopes=["license:verify", "platform:all"],
        )

    pub, secret = asyncio.run(setup())
    client = _make_client(db, monkeypatch)
    monkeypatch.setattr(
        "saas.effective",
        AsyncMock(return_value={
            "status": "active", "locked": False, "plan_name": "P",
            "modules": {}, "user_limit": 1,
        }),
    )
    path = "/api/platform/v1/licenses/verify"
    body = b'{"company_id":"comp_n"}'
    ts = str(int(time.time()))
    nonce = "same-nonce-race"
    sig = store.sign_payload(secret, ts, nonce, "POST", path, body)
    headers = {
        "X-Platform-Key": pub["id"],
        "X-Platform-Timestamp": ts,
        "X-Platform-Nonce": nonce,
        "X-Platform-Signature": sig,
        "Content-Type": "application/json",
    }

    def one():
        return client.post(path, content=body, headers=headers).status_code

    with ThreadPoolExecutor(max_workers=5) as ex:
        codes = list(ex.map(lambda _: one(), range(5)))

    assert codes.count(200) == 1, codes
    assert codes.count(401) == 4, codes
    assert 500 not in codes
