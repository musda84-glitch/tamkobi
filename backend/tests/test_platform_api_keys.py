"""Platform API keys: secret once, HMAC verify, nonce, grace, rate, audit."""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import platform_store as store


class FakeColl:
    def __init__(self):
        self.docs = {}

    async def find_one(self, q, proj=None):
        if isinstance(q, dict) and "_id" in q and len(q) == 1:
            return self.docs.get(q["_id"])
        for d in self.docs.values():
            ok = True
            for k, v in q.items():
                if k == "$or":
                    if not any(all(d.get(kk) == vv for kk, vv in clause.items()) for clause in v):
                        ok = False
                        break
                elif d.get(k) != v:
                    ok = False
                    break
            if ok:
                return d
        return None

    async def insert_one(self, doc):
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
            def __init__(self, docs):
                self._docs = docs

            def sort(self, *a, **k):
                return self

            async def to_list(self, n):
                out = []
                for d in self._docs:
                    ok = all(d.get(k) == v for k, v in q.items()) if q else True
                    if ok:
                        out.append(d)
                return out[:n]

        return C(list(self.docs.values()))


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
    # Fernet stub via comm_service — use identity-ish encrypt if key missing
    monkeypatch.setattr(
        "comm_service.encrypt",
        lambda v: "enc:" + (v or ""),
    )
    monkeypatch.setattr(
        "comm_service.decrypt",
        lambda v: (v or "").removeprefix("enc:"),
    )
    return fake


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
        assert "secret_enc" not in pub
        listed = await store.list_api_keys()
        assert listed[0]["id"] == pub["id"]
        assert "secret" not in listed[0]
        # DB stores only secret_enc / secret_hash — list/public never expose secret
        raw = db.platform_api_keys.docs[pub["id"]]
        assert raw["secret_enc"].startswith("enc:")
        assert "secret_hash" in raw
        assert "secret" not in raw
        dumped_pub = json.dumps(listed[0])
        assert secret not in dumped_pub
        assert "secret" not in dumped_pub
        audit = (await store.list_audit())[0]
        assert "secret" not in (audit.get("details") or {})
        assert secret not in json.dumps(audit.get("details") or {})

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
        assert not store.verify_signature(secret, ts, nonce, "POST", path, body, "deadbeef")
        # replay nonce
        assert await store.check_and_store_nonce(pub["id"], nonce)
        assert not await store.check_and_store_nonce(pub["id"], nonce)

    asyncio.run(run())


def test_revoke_and_expired_rejected(db):
    async def run():
        await store.ensure_seeded()
        prod = (await store.list_products())[0]
        pub, secret = await store.create_api_key(
            product_id=prod["id"], name="r", actor_id="sa1"
        )
        await store.revoke_api_key(pub["id"], actor_id="sa1")
        doc, sec = await store.resolve_key_for_auth(pub["id"])
        assert doc is None and sec is None

    asyncio.run(run())


def test_rotation_grace(db):
    async def run():
        await store.ensure_seeded()
        prod = (await store.list_products())[0]
        old_pub, old_secret = await store.create_api_key(
            product_id=prod["id"], name="rot", actor_id="sa1"
        )
        new_pub, new_secret = await store.rotate_api_key(old_pub["id"], actor_id="sa1")
        assert new_secret != old_secret
        # old still usable during grace
        doc, sec = await store.resolve_key_for_auth(old_pub["id"])
        assert doc is not None and sec == old_secret
        assert db.platform_api_keys.docs[old_pub["id"]].get("grace_until")
        # new usable
        doc2, sec2 = await store.resolve_key_for_auth(new_pub["id"])
        assert sec2 == new_secret
        # past grace → old rejected
        db.platform_api_keys.docs[old_pub["id"]]["grace_until"] = "2000-01-01T00:00:00+00:00"
        doc3, sec3 = await store.resolve_key_for_auth(old_pub["id"])
        assert doc3 is None

    asyncio.run(run())


def test_scope_check_via_missing_scope(db):
    async def run():
        await store.ensure_seeded()
        prod = (await store.list_products())[0]
        pub, secret = await store.create_api_key(
            product_id=prod["id"], name="sc", scopes=["heartbeat"], actor_id="sa1"
        )
        doc, _ = await store.resolve_key_for_auth(pub["id"])
        assert "license:verify" not in (doc.get("scopes") or [])

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
        # rate
        for _ in range(store.KEY_RATE_LIMIT):
            assert await store.check_rate_limit(pub["id"])
        assert not await store.check_rate_limit(pub["id"])

    asyncio.run(run())


def test_verify_uses_saas_effective(db, monkeypatch):
    async def run():
        await store.ensure_seeded()

        async def fake_eff(cid):
            return {
                "status": "active",
                "locked": False,
                "plan_name": "Pro",
                "plan_id": "plan_pro",
                "expires_at": "2099-01-01T00:00:00+00:00",
                "modules": {"/orders": True},
                "user_limit": 10,
            }

        monkeypatch.setattr("saas.effective", fake_eff)
        out = await store.verify_license(company_id="comp_x")
        assert out["valid"] is True
        assert out["plan"] == "Pro"
        assert out["seats"] == 10

    asyncio.run(run())
