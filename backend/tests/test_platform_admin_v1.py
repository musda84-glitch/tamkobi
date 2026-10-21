"""admin-v1 salt okunur uçlar. TestClient + bellek FakeDB. Canlı DB / port yok."""
from __future__ import annotations

import asyncio
import copy
import json
import re
import secrets
import time
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import addons
import comm_service
import company_sms
import event_notify
import mail_service
import platform_admin_v1
import platform_mail
import platform_sms
import platform_store as store
import rbac
import saas
import saas_billing
import support_tickets
import tenant_idor_allowlist as allowlist
from mysql_store import DuplicateKeyError

_OPS = {"$in", "$nin", "$ne", "$lt", "$lte", "$gt", "$gte"}


def _match(doc, q) -> bool:
    if not q:
        return True
    if not isinstance(q, dict):
        return False
    for key, expected in q.items():
        if key == "$or":
            if not any(_match(doc, clause) for clause in expected):
                return False
            continue
        if key == "$and":
            if not all(_match(doc, clause) for clause in expected):
                return False
            continue
        if isinstance(expected, dict) and any(op in expected for op in _OPS):
            cur = doc.get(key)
            if "$in" in expected:
                if isinstance(cur, list):
                    if not any(item in expected["$in"] for item in cur):
                        return False
                elif cur not in expected["$in"]:
                    return False
            if "$ne" in expected and cur == expected["$ne"]:
                return False
            if "$lt" in expected and (cur is None or not cur < expected["$lt"]):
                return False
            if "$lte" in expected and (cur is None or not cur <= expected["$lte"]):
                return False
            if "$gt" in expected and (cur is None or not cur > expected["$gt"]):
                return False
            if "$gte" in expected and (cur is None or not cur >= expected["$gte"]):
                return False
            continue
        cur = doc.get(key)
        if isinstance(cur, list) and not isinstance(expected, list):
            if expected not in cur:
                return False
        elif cur != expected:
            return False
    return True


class FakeColl:
    def __init__(self):
        self.docs = {}
        self.inserts = 0
        self.updates = 0
        self.deletes = 0
        import threading
        self._lock = threading.Lock()

    async def find_one(self, q=None, proj=None, sort=None):
        q = q or {}
        if isinstance(q, dict) and set(q) == {"_id"} and not isinstance(q.get("_id"), dict) and not sort:
            return self.docs.get(q["_id"])
        cur = self.find(q)
        if isinstance(sort, list) and sort:
            cur = cur.sort(sort[0][0], sort[0][1])
        elif isinstance(sort, str):
            cur = cur.sort(sort, 1)
        rows = await cur.to_list(1)
        return rows[0] if rows else None

    async def insert_one(self, doc):
        self.inserts += 1
        with self._lock:
            if doc["_id"] in self.docs:
                raise DuplicateKeyError(f"duplicate {doc['_id']}")
            self.docs[doc["_id"]] = dict(doc)
        return SimpleNamespace(inserted_id=doc["_id"])

    async def update_one(self, q, upd, upsert=False):
        self.updates += 1
        doc = await self.find_one(q)
        if not doc and upsert:
            doc = {"_id": q.get("_id") if isinstance(q, dict) else None}
            if "$setOnInsert" in upd:
                doc.update(upd["$setOnInsert"])
            self.docs[doc["_id"]] = doc
        if not doc:
            return SimpleNamespace(matched_count=0, modified_count=0)
        if "$set" in upd:
            doc.update(upd["$set"])
        if "$inc" in upd:
            for key, value in upd["$inc"].items():
                doc[key] = int(doc.get(key) or 0) + int(value)
        if "$unset" in upd:
            for key in upd["$unset"]:
                doc.pop(key, None)
        if "$addToSet" in upd:
            for key, value in upd["$addToSet"].items():
                cur = doc.get(key)
                if not isinstance(cur, list):
                    cur = [] if cur is None else [cur]
                if value not in cur:
                    cur = [*cur, value]
                doc[key] = cur
        self.docs[doc["_id"]] = doc
        return SimpleNamespace(matched_count=1, modified_count=1)

    async def insert_many(self, docs):
        ids = []
        for doc in docs:
            await self.insert_one(doc)
            ids.append(doc["_id"])
        return SimpleNamespace(inserted_ids=ids)

    async def find_one_and_update(self, q, upd, upsert=False, return_document=True, projection=None):
        self.updates += 1
        doc = await self.find_one(q)
        if doc is None and upsert:
            doc = {"_id": q.get("_id") if isinstance(q, dict) else None}
            if "$setOnInsert" in upd:
                doc.update(upd["$setOnInsert"])
            self.docs[doc["_id"]] = doc
        if doc is None:
            return None
        before = dict(doc)
        if "$set" in upd:
            doc.update(upd["$set"])
        if "$inc" in upd:
            for key, value in upd["$inc"].items():
                doc[key] = int(doc.get(key) or 0) + int(value)
        self.docs[doc["_id"]] = doc
        return doc if return_document else before

    async def delete_one(self, q):
        self.deletes += 1
        doc = await self.find_one(q)
        if doc:
            del self.docs[doc["_id"]]
        return SimpleNamespace(deleted_count=1 if doc else 0)

    async def count_documents(self, q=None, **kwargs):
        rows = await self.find(q or {}).to_list(10**6)
        return len(rows)

    def find(self, q=None, proj=None):
        q = q or {}

        class C:
            def __init__(self, docs, query):
                self._docs = docs
                self._q = query
                self._sort = None

            def sort(self, key, direction=1):
                self._sort = key if isinstance(key, list) else [(key, direction)]
                return self

            async def to_list(self, n):
                out = [doc for doc in self._docs if _match(doc, self._q)]
                if self._sort:
                    for field, direction in reversed(self._sort):
                        present = [doc for doc in out if doc.get(field) is not None]
                        missing = [doc for doc in out if doc.get(field) is None]
                        present.sort(key=lambda doc, field=field: doc.get(field), reverse=int(direction) < 0)
                        out = present + missing
                if n is None:
                    return out
                return out[:n]

        return C(list(self.docs.values()), q)


class FakeDB:
    def __init__(self):
        self._extra = {}
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

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._extra.get(name)
        if coll is None:
            coll = FakeColl()
            self._extra[name] = coll
        return coll


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB()
    prev = (store._db, saas._db, saas._current_user, addons._db, platform_mail._db, saas_billing._db)
    prev_deps = dict(saas_billing._deps)
    prev_sms = platform_sms._db
    prev_tickets = (support_tickets._db, support_tickets._current_user)
    prev_notify = event_notify._db
    store.init(fake)
    saas.init(fake, None)
    saas.invalidate()
    addons.init(fake)
    platform_mail.init(fake)
    saas_billing.init(fake, {})
    platform_sms.init(fake)
    support_tickets.init(fake, prev_tickets[1])
    event_notify.init(fake)
    monkeypatch.setattr(comm_service, "encrypt", lambda v: "enc:" + (v or ""))
    monkeypatch.setattr(comm_service, "decrypt", lambda v: (v or "").removeprefix("enc:"))
    yield fake
    store.init(prev[0])
    saas.init(prev[1], prev[2])
    addons.init(prev[3])
    platform_mail.init(prev[4])
    saas_billing._db = prev[5]
    saas_billing._deps.clear()
    saas_billing._deps.update(prev_deps)
    platform_sms.init(prev_sms)
    support_tickets.init(prev_tickets[0], prev_tickets[1])
    event_notify.init(prev_notify)
    saas.invalidate()


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


def _app():
    app = FastAPI()
    app.include_router(platform_admin_v1.router)
    app.include_router(saas.router)
    app.include_router(saas_billing.router)
    app.include_router(platform_sms.router)
    app.include_router(support_tickets.router)
    app.dependency_overrides[saas.require_super_admin] = lambda: {"id": "sa1", "is_super_admin": True}
    return app


def _client(ip: str = "198.51.100.20") -> TestClient:
    return TestClient(with_peer(_app(), ip))


def _get(client, secret, key_id, path, params=None):
    headers, _, nonce = _signed_headers(secret, key_id, "GET", path, b"")
    return client.get(path, params=params, headers=headers), headers, nonce


def _issue(db, scopes, *, kind="platform_admin", ip_allowlist=None, name="k", instance_id=None, product_id=None):
    async def setup():
        await store.ensure_seeded()
        if product_id:
            pid = product_id
        else:
            pid = next(p["id"] for p in await store.list_products() if p["code"] == store.PRODUCT_TAMKOBI)
        kwargs = {
            "product_id": pid,
            "name": name,
            "actor_id": "sa1",
            "scopes": scopes,
            "kind": kind,
        }
        if ip_allowlist is not None:
            kwargs["ip_allowlist"] = ip_allowlist
        if instance_id is not None:
            kwargs["instance_id"] = instance_id
        return await store.create_api_key(**kwargs)

    return asyncio.run(setup())


def _audits(db):
    return list(db.platform_audit_log.docs.values())


def _detail(response):
    return response.json().get("detail")


ALL_SCOPES = list(store.ADMIN_SCOPES)
LEAKS = (
    "LEAK-PASSWORD-HASH",
    "LEAK-TOTP",
    "LEAK-RECOVERY",
    "LEAK-SECRET-ENC",
    "LEAK-SECRET-HASH",
    "LEAK-PASSWORD-ENC",
    "LEAK-TOKEN",
    "LEAK-SMTP-PASS",
    "LEAK-EI-PASS",
    "LEAK-PLAN-TOKEN",
    "LEAK-REQ-PASSWORD",
    "LEAK-AUDIT-SECRET",
    "LEAK-USER-TOKEN",
    "LEAK-SESSION",
    "LEAK-OID",
    "LEAK-CARD",
    "LEAK-PIN",
    "LEAK-RESET-TOKEN",
    "LEAK-RESET-LINK",
    "LEAK-TICKET-TOKEN",
    "LEAK-TICKET-SECRET",
)


def _bad_key(name: str) -> bool:
    kl = str(name).lower()
    if kl in ("has_password", "password_unreadable") or kl.startswith("has_"):
        return False
    parts = (
        "password", "password_hash", "_enc", "secret", "totp", "recovery",
        "token", "api_key", "card", "cvv", "iban_enc", "smtp_pass",
    )
    if any(part in kl for part in parts):
        return True
    pieces = re.split(r"[^a-z0-9]+", kl)
    return "pan" in pieces or "pin" in pieces


def _walk_keys(obj, found):
    if isinstance(obj, dict):
        for key, value in obj.items():
            found.append(str(key))
            _walk_keys(value, found)
    elif isinstance(obj, list):
        for value in obj:
            _walk_keys(value, found)


def test_signature_required(db):
    pub, secret = _issue(db, [store.SCOPE_ADMIN_SYSTEM_READ])
    client = _client()
    path = "/api/platform/admin-v1/system/health"
    missing = client.get(path)
    assert missing.status_code == 401
    assert _detail(missing) == "Eksik imza başlıkları"

    headers, _, _ = _signed_headers(secret, pub["id"], "GET", path, b"")
    headers["X-Platform-Signature"] = "ab" * 32
    bad = client.get(path, headers=headers)
    assert bad.status_code == 401
    assert _detail(bad) == "İmza doğrulanamadı"
    assert not any(row["action"] == "admin_v1.admin.system:read" for row in _audits(db))


def test_scope_denied(db):
    pub, secret = _issue(db, [store.SCOPE_ADMIN_AUDIT_READ], name="audit-only")
    client = _client()
    response, _, _ = _get(client, secret, pub["id"], "/api/platform/admin-v1/companies")
    assert response.status_code == 403
    assert _detail(response) == "Kapsam yetersiz"


def test_kind_rules(db):
    async def run():
        await store.ensure_seeded()
        tam = next(p for p in await store.list_products() if p["code"] == "tamkobi")
        other = await store.create_product(
            {"code": "shopx", "name": "Shop", "kind": "ecommerce"},
            actor_id="sa1",
        )
        with pytest.raises(ValueError, match="Yönetim kapsamları yalnızca platform_admin"):
            await store.create_api_key(
                product_id=tam["id"], name="prod-admin", actor_id="sa1",
                scopes=["admin.companies:read"], kind="product",
            )
        with pytest.raises(ValueError):
            await store.create_api_key(
                product_id=tam["id"], name="mix", actor_id="sa1",
                scopes=["admin.companies:read", "license:verify"], kind="platform_admin",
            )
        with pytest.raises(ValueError):
            await store.create_api_key(
                product_id=tam["id"], name="mix-all", actor_id="sa1",
                scopes=["admin.audit:read", "platform:all"], kind="platform_admin",
            )
        with pytest.raises(ValueError):
            await store.create_api_key(
                product_id=tam["id"], name="bound", actor_id="sa1",
                scopes=["admin.system:read"], kind="platform_admin", instance_id="pi_x",
            )
        with pytest.raises(ValueError):
            await store.create_api_key(
                product_id=other["id"], name="other", actor_id="sa1",
                scopes=["admin.system:read"], kind="platform_admin",
            )
        plain, _ = await store.create_api_key(
            product_id=tam["id"], name="plain", actor_id="sa1", scopes=["license:verify"],
        )
        assert plain["kind"] == "product"
        legacy = db.platform_api_keys.docs[plain["id"]]
        assert "kind" in legacy
        del legacy["kind"]
        assert store._public_key(legacy)["kind"] == "product"
        rotated, _ = await store.rotate_api_key(plain["id"], actor_id="sa1")
        assert rotated["kind"] == "product"

        admin, _ = await store.create_api_key(
            product_id=tam["id"], name="adm", actor_id="sa1",
            scopes=["admin.audit:read"], kind="platform_admin",
        )
        assert admin["kind"] == "platform_admin"
        spun, _ = await store.rotate_api_key(admin["id"], actor_id="sa1")
        assert spun["kind"] == "platform_admin"
        assert db.platform_api_keys.docs[spun["id"]]["kind"] == "platform_admin"

    asyncio.run(run())


def test_platform_admin_key_with_instance_id_is_forbidden(db):
    async def plant():
        await store.ensure_seeded()
        tam = next(p for p in await store.list_products() if p["code"] == "tamkobi")
        await db.platform_api_keys.insert_one({
            "_id": "pk_bound_admin",
            "product_id": tam["id"],
            "instance_id": "comp_bound",
            "name": "bound-admin",
            "kind": "platform_admin",
            "scopes": ["admin.system:read"],
            "ip_allowlist": [],
            "secret_enc": "enc:bound-admin-secret",
            "secret_hash": "not-used",
            "revoked_at": None,
            "expires_at": None,
            "grace_until": None,
        })

    asyncio.run(plant())
    response, _, _ = _get(
        _client(), "bound-admin-secret", "pk_bound_admin", "/api/platform/admin-v1/system/health",
    )
    assert response.status_code == 403
    assert _detail(response) == "Kapsam yetersiz"


def test_product_key_with_admin_scope_in_db_is_forbidden(db):
    async def plant():
        await store.ensure_seeded()
        tam = next(p for p in await store.list_products() if p["code"] == "tamkobi")
        await db.platform_api_keys.insert_one({
            "_id": "pk_sneaky",
            "product_id": tam["id"],
            "instance_id": None,
            "name": "sneaky",
            "kind": "product",
            "scopes": ["admin.companies:read"],
            "ip_allowlist": [],
            "secret_enc": "enc:sneaky-secret",
            "secret_hash": "not-used",
            "revoked_at": None,
            "expires_at": None,
            "grace_until": None,
        })

    asyncio.run(plant())
    response, _, _ = _get(_client(), "sneaky-secret", "pk_sneaky", "/api/platform/admin-v1/companies")
    assert response.status_code == 403
    assert _detail(response) == "Kapsam yetersiz"


def test_ip_allowlist(db):
    pub, secret = _issue(
        db, [store.SCOPE_ADMIN_SYSTEM_READ], ip_allowlist=["203.0.113.7"], name="ip",
    )
    path = "/api/platform/admin-v1/system/health"
    allowed, _, _ = _get(_client("203.0.113.7"), secret, pub["id"], path)
    assert allowed.status_code == 200, allowed.text
    denied, headers, _ = _get(_client("198.51.100.9"), secret, pub["id"], path)
    assert denied.status_code == 403
    assert _detail(denied) == "IP adresi bu anahtar için izinli değil"
    rows = [row for row in _audits(db) if row["action"] == "admin_v1.auth.ip_denied"]
    assert len(rows) == 1
    assert rows[0]["details"] == {"path": path, "scope": "admin.system:read"}
    blob = json.dumps(rows[0])
    assert secret not in blob
    assert headers["X-Platform-Signature"] not in blob
    assert "203.0.113.7" not in json.dumps(rows[0]["details"])


def test_company_pagination_and_detail(db):
    async def seed():
        for i in range(1, 6):
            await db.companies.insert_one({
                "_id": f"comp_p{i}",
                "name": "Beta Firma" if i == 2 else f"Firma {i}",
                "created_at": f"2026-01-0{i}T00:00:00+00:00",
            })

    asyncio.run(seed())
    pub, secret = _issue(db, [store.SCOPE_ADMIN_COMPANIES_READ], name="cos")
    client = _client()
    page, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/companies",
        params={"limit": 2, "offset": 2},
    )
    assert page.status_code == 200, page.text
    body = page.json()
    assert body["limit"] == 2
    assert body["offset"] == 2
    assert body["total"] == 5
    # created_at azalan: p5, p4, p3, p2, p1 → offset 2 = p3, p2
    assert [item["id"] for item in body["items"]] == ["comp_p3", "comp_p2"]
    assert "plan_name" in body["items"][0]["membership"]
    assert "company_count" in body["items"][0]["membership"]
    assert "users" not in body["items"][0]

    found, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/companies", params={"q": "beta"},
    )
    assert found.status_code == 200
    assert found.json()["total"] == 1
    assert found.json()["items"][0]["id"] == "comp_p2"

    too_big, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/companies", params={"limit": 201},
    )
    assert too_big.status_code == 422

    missing, _, _ = _get(client, secret, pub["id"], "/api/platform/admin-v1/companies/nope")
    assert missing.status_code == 404
    assert _detail(missing) == "Şirket bulunamadı."

    detail, _, _ = _get(client, secret, pub["id"], "/api/platform/admin-v1/companies/comp_p1")
    assert detail.status_code == 200, detail.text
    item = detail.json()["item"]
    assert item["id"] == "comp_p1"
    assert "users" not in item
    assert "quota_usage" in item
    assert "requests" in item
    assert "membership" in item

    rows = [row for row in _audits(db) if row["action"] == "admin_v1.admin.companies:read"]
    assert rows
    assert rows[-1]["details"]["path"].startswith("/api/platform/admin-v1/companies")
    assert "secret" not in json.dumps(rows[-1]["details"])


def test_audit_cursor(db):
    async def seed():
        for i in range(1, 6):
            await db.platform_audit_log.insert_one({
                "_id": f"pal_seed_{i}",
                "at": f"2026-01-01T00:00:0{i}+00:00",
                "action": "seed.event",
                "actor_id": "actor-1" if i % 2 else "actor-2",
                "actor_type": "superadmin",
                "target_type": "company",
                "target_id": f"comp_{i}",
                "details": {"n": i},
                "ip": "",
            })

    asyncio.run(seed())
    pub, secret = _issue(db, [store.SCOPE_ADMIN_AUDIT_READ], name="aud")
    client = _client()
    first, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/audit",
        params={"action": "seed.event", "limit": 2},
    )
    assert first.status_code == 200, first.text
    body = first.json()
    assert [item["id"] for item in body["items"]] == ["pal_seed_5", "pal_seed_4"]
    assert body["limit"] == 2
    assert body["next_cursor"] == "2026-01-01T00:00:04+00:00"
    assert "offset" not in body

    second, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/audit",
        params={"action": "seed.event", "limit": 2, "before": body["next_cursor"]},
    )
    assert [item["id"] for item in second.json()["items"]] == ["pal_seed_3", "pal_seed_2"]
    assert second.json()["next_cursor"] == "2026-01-01T00:00:02+00:00"

    last, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/audit",
        params={"action": "seed.event", "limit": 2, "before": second.json()["next_cursor"]},
    )
    assert [item["id"] for item in last.json()["items"]] == ["pal_seed_1"]
    assert last.json()["next_cursor"] is None

    filtered, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/audit",
        params={"action": "seed.event", "actor_id": "actor-2", "target_type": "company", "limit": 50},
    )
    assert filtered.status_code == 200
    assert {item["id"] for item in filtered.json()["items"]} == {"pal_seed_2", "pal_seed_4"}

    too_big, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/audit", params={"limit": 201},
    )
    assert too_big.status_code == 422

    rows = [row for row in _audits(db) if row["action"] == "admin_v1.admin.audit:read"]
    assert rows
    assert secret not in json.dumps(rows[-1]["details"])


def test_users_plans_keys_integrators_mail_health(db):
    async def seed():
        await db.companies.insert_one({
            "_id": "comp_u",
            "name": "Üyeler",
            "email": "ada@example.com",
            "created_at": "2026-03-01T00:00:00+00:00",
        })
        for name, role in (("Cem", "user"), ("Ada", "admin"), ("Bora", "user")):
            await db.users.insert_one({
                "_id": f"usr_{name}",
                "name": name,
                "email": f"{name.lower()}@example.com",
                "role": role,
                "company_ids": ["comp_u"],
                "is_super_admin": False,
                "password_hash": "LEAK-PASSWORD-HASH" if name == "Ada" else "",
                "is_active": True,
            })
        await db.users.insert_one({
            "_id": "usr_root",
            "name": "Root",
            "email": "root@example.com",
            "role": "admin",
            "company_ids": ["comp_u"],
            "is_super_admin": True,
            "password_hash": "LEAK-PASSWORD-HASH",
        })
        await db.saas_plans.insert_one({
            "_id": "plan_pro", "name": "Profesyonel", "sort": 1, "code": "pro",
            "modules": [], "price_monthly": 10, "token": "LEAK-PLAN-TOKEN",
        })
        await db.company_licenses.insert_one({"_id": "comp_u", "plan_id": "plan_pro", "status": "active"})
        await db.platform_mail_servers.insert_one({
            "_id": "pms_1",
            "name": "Posta",
            "smtp_host": "smtp.example.com",
            "password_enc": "LEAK-PASSWORD-ENC",
            "created_at": "2026-01-01T00:00:00+00:00",
        })
        await db.platform_mailboxes.insert_one({
            "_id": "pmb_1",
            "email": "destek@example.com",
            "server_id": "pms_1",
            "is_default": True,
            "is_active": True,
            "password_enc": "LEAK-PASSWORD-ENC",
            "allowed_user_ids": ["usr_root"],
            "allow_all_admins": True,
            "created_at": "2026-01-02T00:00:00+00:00",
        })

    asyncio.run(seed())
    pub, secret = _issue(db, ALL_SCOPES, name="wide")
    client = _client()

    users, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/companies/comp_u/users",
        params={"limit": 1, "offset": 1},
    )
    assert users.status_code == 200, users.text
    ubody = users.json()
    assert ubody["total"] == 3
    assert ubody["limit"] == 1
    assert ubody["offset"] == 1
    assert ubody["items"][0]["name"] == "Bora"
    assert "usr_root" not in json.dumps(ubody)
    full, _, _ = _get(client, secret, pub["id"], "/api/platform/admin-v1/companies/comp_u/users")
    ada = next(row for row in full.json()["items"] if row["name"] == "Ada")
    assert ada["has_password"] is True
    assert "password_hash" not in ada

    missing, _, _ = _get(client, secret, pub["id"], "/api/platform/admin-v1/companies/yok/users")
    assert missing.status_code == 404

    plans, _, _ = _get(client, secret, pub["id"], "/api/platform/admin-v1/plans")
    assert plans.status_code == 200, plans.text
    pitem = plans.json()["item"]
    assert pitem["plans"][0]["id"] == "plan_pro"
    assert pitem["plans"][0]["company_count"] == 1
    assert "token" not in pitem["plans"][0]
    assert "LEAK-PLAN-TOKEN" not in plans.text
    assert isinstance(pitem["catalog"], list) and pitem["catalog"]

    keys, _, _ = _get(client, secret, pub["id"], "/api/platform/admin-v1/api-keys", params={"limit": 1, "offset": 0})
    assert keys.status_code == 200, keys.text
    kbody = keys.json()
    assert kbody["limit"] == 1
    assert kbody["total"] >= 1
    assert kbody["items"][0]["kind"] == "platform_admin"
    assert secret not in keys.text
    assert "secret_enc" not in keys.text
    tam_id = kbody["items"][0]["product_id"]
    filtered, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/api-keys",
        params={"product_id": tam_id},
    )
    assert filtered.status_code == 200
    assert filtered.json()["total"] == kbody["total"]
    empty, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/api-keys",
        params={"product_id": "pp_missing"},
    )
    assert empty.json()["total"] == 0
    assert empty.json()["items"] == []

    products, _, _ = _get(client, secret, pub["id"], "/api/platform/admin-v1/integrators")
    assert products.status_code == 200, products.text
    assert "instances" not in products.json()["item"]
    assert any(row["code"] == "tamkobi" for row in products.json()["item"]["products"])
    both, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/integrators",
        params={"include_instances": "true"},
    )
    assert both.status_code == 200, both.text
    assert "instances" in both.json()["item"]

    mail, _, _ = _get(client, secret, pub["id"], "/api/platform/admin-v1/mail/status")
    assert mail.status_code == 200, mail.text
    mitem = mail.json()["item"]
    assert "admins" not in mitem and "presets" not in mitem
    assert mitem["default_from"] == "destek@example.com"
    assert mitem["servers"][0]["has_password"] is True
    assert "password_enc" not in mitem["servers"][0]
    box = mitem["mailboxes"][0]
    assert box["has_password"] is True
    assert "password_enc" not in box
    assert "allowed_user_ids" not in box
    assert "allow_all_admins" not in box
    assert "usr_root" not in mail.text
    assert "LEAK-PASSWORD-ENC" not in mail.text

    health, _, _ = _get(client, secret, pub["id"], "/api/platform/admin-v1/system/health")
    assert health.status_code == 200, health.text
    hitem = health.json()["item"]
    assert hitem["status"] == "healthy"
    assert "version" in hitem and "git_sha" in hitem
    assert set(hitem) == {"status", "version", "git_sha"}


def test_redact_strips_secrets_and_keeps_has_password(db, monkeypatch):
    sends = {}
    for name in (
        "smtp_send", "smtp_login_test", "netgsm_send", "iletimerkezi_send",
        "verimor_send", "sms_send", "imap_test", "imap_list", "imap_fetch",
    ):
        sends[name] = AsyncMock()
        monkeypatch.setattr(comm_service, name, sends[name])
    monkeypatch.setattr(platform_mail, "dispatch_password_reset_mail", AsyncMock())

    async def seed():
        await db.companies.insert_one({
            "_id": "comp_sec",
            "name": "Gizli A.Ş.",
            "email": "ada@example.com",
            "created_at": "2026-04-01T00:00:00+00:00",
            "token": "LEAK-TOKEN",
            "password_hash": "LEAK-PASSWORD-HASH",
        })
        await db.users.insert_one({
            "_id": "usr_ada",
            "name": "Ada",
            "email": "ada@example.com",
            "role": "admin",
            "company_ids": ["comp_sec"],
            "is_super_admin": False,
            "password_hash": "LEAK-PASSWORD-HASH",
            "totp_secret": "LEAK-TOTP",
            "recovery_codes": ["LEAK-RECOVERY"],
            "token": "LEAK-USER-TOKEN",
            "is_active": True,
        })
        await db.einvoice_settings.insert_one({
            "_id": "ei_sec",
            "company_id": "comp_sec",
            "provider": "foriba",
            "password_enc": "LEAK-EI-PASS",
            "token": "LEAK-TOKEN",
        })
        await db.upgrade_requests.insert_one({
            "_id": "ur_sec",
            "company_id": "comp_sec",
            "status": "pending",
            "created_at": "2026-04-02T00:00:00+00:00",
            "token": "LEAK-TOKEN",
            "password": "LEAK-REQ-PASSWORD",
        })
        await db.saas_plans.insert_one({
            "_id": "plan_sec", "name": "Gizli", "sort": 3, "code": "sec",
            "modules": [], "token": "LEAK-PLAN-TOKEN", "password_hash": "LEAK-PASSWORD-HASH",
        })
        await db.platform_mail_servers.insert_one({
            "_id": "pms_sec",
            "name": "SMTP",
            "smtp_host": "smtp.example.com",
            "password_enc": "LEAK-PASSWORD-ENC",
            "smtp_pass": "LEAK-SMTP-PASS",
            "token": "LEAK-TOKEN",
            "totp_secret": "LEAK-TOTP",
            "secret_enc": "LEAK-SECRET-ENC",
            "secret_hash": "LEAK-SECRET-HASH",
            "created_at": "2026-01-01T00:00:00+00:00",
        })
        await db.platform_mailboxes.insert_one({
            "_id": "pmb_sec",
            "email": "gizli@example.com",
            "is_default": True,
            "is_active": True,
            "password_enc": "LEAK-PASSWORD-ENC",
            "token": "LEAK-TOKEN",
            "recovery_codes": ["LEAK-RECOVERY"],
            "created_at": "2026-01-02T00:00:00+00:00",
        })
        await db.platform_audit_log.insert_one({
            "_id": "pal_sec",
            "at": "2026-04-03T00:00:00+00:00",
            "action": "seed.event",
            "actor_id": "x",
            "actor_type": "api_key",
            "target_type": "company",
            "target_id": "comp_sec",
            "details": {"secret": "LEAK-AUDIT-SECRET", "token": "LEAK-TOKEN", "path": "/ok"},
            "ip": "",
        })

    asyncio.run(seed())
    # Ürün belgesine sır alanları: list_products hepsini kopyalar, redact düşürür.
    asyncio.run(store.ensure_seeded())
    tam = next(iter(db.platform_products.docs.values()))
    tam["recovery_codes"] = ["LEAK-RECOVERY"]
    tam["secret_hash"] = "LEAK-SECRET-HASH"
    tam["secret_enc"] = "LEAK-SECRET-ENC"
    tam["token"] = "LEAK-TOKEN"

    pub, secret = _issue(db, ALL_SCOPES, name="redact")
    client = _client()
    paths = [
        ("/api/platform/admin-v1/companies", {"q": "gizli"}),
        ("/api/platform/admin-v1/companies/comp_sec", None),
        ("/api/platform/admin-v1/companies/comp_sec/users", None),
        ("/api/platform/admin-v1/plans", None),
        ("/api/platform/admin-v1/api-keys", None),
        ("/api/platform/admin-v1/integrators", {"include_instances": "true"}),
        ("/api/platform/admin-v1/audit", {"action": "seed.event"}),
        ("/api/platform/admin-v1/mail/status", None),
        ("/api/platform/admin-v1/system/health", None),
        ("/api/platform/admin-v1/overview", None),
        ("/api/platform/admin-v1/quotas", None),
        ("/api/platform/admin-v1/upgrade-requests", None),
        ("/api/platform/admin-v1/payments", None),
        ("/api/platform/admin-v1/platform-users", None),
        ("/api/platform/admin-v1/sms/settings", None),
        ("/api/platform/admin-v1/sms/logs", None),
        ("/api/platform/admin-v1/sms/failed-resets", None),
        ("/api/platform/admin-v1/companies/comp_sec/sms", None),
        ("/api/platform/admin-v1/companies/comp_sec/notify-prefs", None),
        ("/api/platform/admin-v1/companies/comp_sec/notify-mail-log", None),
        ("/api/platform/admin-v1/support/tickets", None),
    ]
    blobs = []
    for path, params in paths:
        response, headers, _ = _get(client, secret, pub["id"], path, params=params)
        assert response.status_code == 200, f"{path} {response.text}"
        payload = response.json()
        blobs.append(json.dumps(payload))
        found = []
        _walk_keys(payload, found)
        assert not any(_bad_key(key) for key in found), found
        assert secret not in blobs[-1]
        assert headers["X-Platform-Signature"] not in blobs[-1]

    joined = "\n".join(blobs)
    for leak in LEAKS:
        assert leak not in joined
    assert '"has_password": true' in joined or '"has_password":true' in joined

    mail = json.loads(blobs[paths.index(("/api/platform/admin-v1/mail/status", None))])
    assert mail["item"]["servers"][0]["has_password"] is True
    detail = json.loads(blobs[1])
    assert detail["item"]["einvoice"]["has_password"] is True
    assert "users" not in detail["item"]

    for mock in sends.values():
        assert mock.await_count == 0
        assert mock.call_count == 0
    assert platform_mail.dispatch_password_reset_mail.await_count == 0

    for scope in ALL_SCOPES:
        if not str(scope).endswith(":read"):
            continue
        assert any(row["action"] == f"admin_v1.{scope}" for row in _audits(db))
    for row in _audits(db):
        if not str(row.get("action") or "").startswith("admin_v1."):
            continue
        dumped = json.dumps(row.get("details") or {})
        assert secret not in dumped
        for leak in LEAKS:
            assert leak not in dumped


def test_rate_limits(db, monkeypatch):
    pub, secret = _issue(db, [store.SCOPE_ADMIN_SYSTEM_READ], name="rate")
    path = "/api/platform/admin-v1/system/health"

    async def _no(*args, **kwargs):
        return False

    monkeypatch.setattr(store, "check_rate_limit", _no)
    limited, _, _ = _get(_client(), secret, pub["id"], path)
    assert limited.status_code == 429
    assert _detail(limited) == "Dakika limiti aşıldı"

    monkeypatch.setattr(store, "check_rate_limit", AsyncMock(return_value=True))
    monkeypatch.setattr(store, "check_ip_rate_limit", _no)
    ip_limited, _, _ = _get(_client(), secret, pub["id"], path)
    assert ip_limited.status_code == 429
    assert _detail(ip_limited) == "IP dakika limiti aşıldı"


def test_system_company_detail_keeps_users(db):
    async def seed():
        await db.companies.insert_one({
            "_id": "comp_reg",
            "name": "Regresyon",
            "email": "ada@example.com",
            "created_at": "2026-05-01T00:00:00+00:00",
            "city": "İstanbul",
        })
        await db.users.insert_one({
            "_id": "usr_ada",
            "name": "Ada",
            "email": "ada@example.com",
            "role": "admin",
            "company_ids": ["comp_reg"],
            "is_super_admin": False,
            "password_hash": "LEAK-PASSWORD-HASH",
            "is_active": True,
        })
        await db.users.insert_one({
            "_id": "usr_bora",
            "name": "Bora",
            "email": "bora@example.com",
            "role": "user",
            "company_ids": ["comp_reg"],
            "is_super_admin": False,
            "password_hash": "",
            "is_active": True,
        })
        await db.upgrade_requests.insert_one({
            "_id": "ur_old",
            "company_id": "comp_reg",
            "status": "pending",
            "created_at": "2026-05-01T00:00:00+00:00",
            "note": "eski",
        })
        await db.upgrade_requests.insert_one({
            "_id": "ur_new",
            "company_id": "comp_reg",
            "status": "pending",
            "created_at": "2026-05-02T00:00:00+00:00",
            "token": "LEAK-REQ-TOKEN",
            "note": "yeni",
        })
        await db.saas_plans.insert_one({
            "_id": "plan_pro", "name": "Profesyonel", "sort": 1, "code": "pro", "modules": ["/invoices"],
        })
        await db.company_licenses.insert_one({
            "_id": "comp_reg", "plan_id": "plan_pro", "status": "active", "started_at": "2026-05-01T00:00:00+00:00",
        })
        await db.products.insert_one({"_id": "prd_1", "company_id": "comp_reg", "name": "Kalem"})

    asyncio.run(seed())
    saas.invalidate()

    async def load():
        via_route = await saas.get_company("comp_reg", {})
        via_detail = await saas.company_detail("comp_reg", include_users=True)
        slim = await saas.company_detail("comp_reg", include_users=False)
        try:
            await saas.get_company("missing", {})
            missing = None
        except HTTPException as exc:
            missing = exc
        return via_route, via_detail, slim, missing

    via_route, via_detail, slim, missing = asyncio.run(load())
    assert via_route == via_detail
    assert missing is not None and missing.status_code == 404
    assert missing.detail == "Şirket bulunamadı."
    assert "users" in via_route
    assert [user["id"] for user in via_route["users"]] == ["usr_ada", "usr_bora"]
    assert via_route["users"][0]["has_password"] is True
    assert "password_hash" not in via_route["users"][0]
    assert [req["id"] for req in via_route["requests"]] == ["ur_new", "ur_old"]
    # Sistem yolu redact edilmez: eski _clean davranışı durur.
    assert via_route["requests"][0]["token"] == "LEAK-REQ-TOKEN"
    assert "quota_usage" in via_route
    assert via_route["quota_usage"]["product_count"] == 1
    assert via_route["membership"]["product_count"] == 1
    assert via_route["membership"]["plan_name"] == "Profesyonel"
    assert "users" not in slim
    assert slim["requests"] == via_route["requests"]
    assert slim["quota_usage"] == via_route["quota_usage"]
    assert slim["membership"] == via_route["membership"]

    client = _client()
    http = client.get("/api/system/companies/comp_reg")
    assert http.status_code == 200, http.text
    body = http.json()
    assert "users" in body
    assert body["users"][0]["email"] == "ada@example.com"
    assert body["id"] == "comp_reg"
    assert body["requests"][0]["id"] == "ur_new"


def test_list_audit_before_is_optional_for_existing_callers(db):
    async def run():
        await db.platform_audit_log.insert_one({
            "_id": "pal_a", "at": "2026-01-01T00:00:01+00:00", "action": "a",
            "actor_id": "", "target_type": "", "details": {},
        })
        await db.platform_audit_log.insert_one({
            "_id": "pal_b", "at": "2026-01-01T00:00:02+00:00", "action": "b",
            "actor_id": "", "target_type": "", "details": {},
        })
        rows = await store.list_audit(limit=10)
        assert [row["id"] for row in rows] == ["pal_b", "pal_a"]
        older = await store.list_audit(limit=10, before="2026-01-01T00:00:02+00:00")
        assert [row["id"] for row in older] == ["pal_a"]

    asyncio.run(run())


_COMMERCIAL = (
    ("/api/platform/admin-v1/overview", store.SCOPE_ADMIN_OVERVIEW_READ),
    ("/api/platform/admin-v1/quotas", store.SCOPE_ADMIN_QUOTAS_READ),
    ("/api/platform/admin-v1/upgrade-requests", store.SCOPE_ADMIN_REQUESTS_READ),
    ("/api/platform/admin-v1/payments", store.SCOPE_ADMIN_PAYMENTS_READ),
    ("/api/platform/admin-v1/platform-users", store.SCOPE_ADMIN_PLATFORM_USERS_READ),
)
_AUTH_WRITE_COLLS = {
    "platform_audit_log",
    "platform_nonces",
    "platform_rate",
    "platform_api_keys",
}


def _coll_map(db):
    names = [
        "platform_products", "platform_instances", "platform_api_keys",
        "platform_audit_log", "platform_nonces", "platform_rate",
        "platform_usage", "platform_heartbeats", "companies",
        "company_licenses", "saas_plans", "platform_settings",
    ]
    found = {name: getattr(db, name) for name in names}
    found.update(db._extra)
    return found


def _write_counts(db):
    return {
        name: (coll.inserts, coll.updates, coll.deletes)
        for name, coll in _coll_map(db).items()
    }


def _assert_no_extra_writes(before, after):
    for name in set(before) | set(after):
        if name in _AUTH_WRITE_COLLS:
            continue
        assert before.get(name, (0, 0, 0)) == after.get(name, (0, 0, 0)), name


def _plant_key(db, *, key_id, secret, kind, scopes, instance_id=None):
    async def run():
        await store.ensure_seeded()
        tam = next(p for p in await store.list_products() if p["code"] == "tamkobi")
        await db.platform_api_keys.insert_one({
            "_id": key_id,
            "product_id": tam["id"],
            "instance_id": instance_id,
            "name": key_id,
            "kind": kind,
            "scopes": list(scopes),
            "ip_allowlist": [],
            "secret_enc": "enc:" + secret,
            "secret_hash": "not-used",
            "revoked_at": None,
            "expires_at": None,
            "grace_until": None,
        })

    asyncio.run(run())


def _seed_commercial(db):
    async def run():
        await db.saas_plans.insert_one({
            "_id": "plan_pro",
            "name": "Profesyonel",
            "sort": 1,
            "code": "pro",
            "modules": ["/invoices"],
            "price_monthly": 120,
            "price_yearly": 1200,
            "user_limit": 10,
            "company_limit": 2,
            "product_limit": 0,
            "contact_limit": 0,
            "storage_limit_mb": 0,
            "token": "LEAK-PLAN-TOKEN",
            "password_hash": "LEAK-PASSWORD-HASH",
        })
        for cid, name, created, status, period in (
            ("comp_a", "Ada", "2026-01-01T00:00:00+00:00", "active", "monthly"),
            ("comp_b", "Beta", "2026-02-01T00:00:00+00:00", "trial", "monthly"),
            ("comp_c", "Cem", "2026-03-01T00:00:00+00:00", "active", "yearly"),
        ):
            await db.companies.insert_one({
                "_id": cid,
                "name": name,
                "email": f"{name.lower()}@example.com",
                "created_at": created,
                "token": "LEAK-TOKEN",
                "password_hash": "LEAK-PASSWORD-HASH",
            })
            await db.company_licenses.insert_one({
                "_id": cid,
                "plan_id": "plan_pro",
                "status": status,
                "billing_period": period,
                "expires_at": "2099-01-01T00:00:00+00:00",
                "user_limit": 4,
                "secret": "LEAK-SECRET-ENC",
                "token": "LEAK-TOKEN",
                "pin_hash": "LEAK-PIN",
            })
        await db.company_licenses.insert_one({
            "_id": "lic_orphan",
            "plan_id": "plan_pro",
            "status": "active",
            "secret": "LEAK-SECRET-ENC",
        })
        await db.users.insert_one({
            "_id": "usr_tenant",
            "name": "Tenant",
            "email": "tenant@example.com",
            "role": "user",
            "company_ids": ["comp_a"],
            "is_super_admin": False,
            "password_hash": "LEAK-PASSWORD-HASH",
            "is_active": True,
        })
        await db.users.insert_one({
            "_id": "usr_ada",
            "name": "Ada",
            "email": "ada@example.com",
            "phone": "",
            "role": "admin",
            "company_ids": ["comp_a"],
            "is_super_admin": True,
            "is_active": True,
            "password_hash": "LEAK-PASSWORD-HASH",
            "totp_secret": "LEAK-TOTP",
            "totp_recovery_hashes": ["LEAK-RECOVERY"],
            "recovery_codes": ["LEAK-RECOVERY"],
            "token": "LEAK-USER-TOKEN",
            "pin_hash": "LEAK-PIN",
            "pin": "LEAK-PIN",
            "punch_pin": "LEAK-PIN",
        })
        await db.users.insert_one({
            "_id": "usr_bora",
            "name": "Bora",
            "email": "bora@example.com",
            "role": "admin",
            "company_ids": ["comp_b"],
            "is_super_admin": True,
            "is_active": True,
            "user_number": "U-000050",
            "password_hash": "",
        })
        await db.users.insert_one({
            "_id": "usr_cem",
            "name": "Cem",
            "email": "cem@example.com",
            "role": "admin",
            "company_ids": [],
            "is_super_admin": True,
            "is_active": True,
        })
        await db.upgrade_requests.insert_one({
            "_id": "ur_new",
            "company_id": "comp_a",
            "status": "pending",
            "plan_id": "plan_pro",
            "created_at": "2026-04-04T00:00:00+00:00",
            "token": "LEAK-TOKEN",
            "password": "LEAK-REQ-PASSWORD",
            "pin": "LEAK-PIN",
            "pin_hash": "LEAK-PIN",
            "punch_pin": "LEAK-PIN",
            "pinned": "keep-pinned",
            "shipping": "keep-shipping",
            "company": "keep-company",
        })
        await db.upgrade_requests.insert_one({
            "_id": "ur_ok",
            "company_id": "comp_b",
            "status": "approved",
            "plan_id": "plan_pro",
            "created_at": "2026-04-03T00:00:00+00:00",
        })
        await db.upgrade_requests.insert_one({
            "_id": "ur_old",
            "company_id": "comp_b",
            "status": "pending",
            "plan_id": "plan_pro",
            "created_at": "2026-04-02T00:00:00+00:00",
        })
        await db.upgrade_requests.insert_one({
            "_id": "ur_no",
            "company_id": "comp_c",
            "status": "rejected",
            "plan_id": "plan_pro",
            "created_at": "2026-04-01T00:00:00+00:00",
        })
        await db.support_tickets.insert_one({
            "_id": "stk_1",
            "status": "open",
            "company_id": "comp_a",
        })
        payments = [
            {
                "_id": "tx_fail",
                "provider": "paytr",
                "session_id": "LEAK-SESSION",
                "merchant_oid": "LEAK-OID",
                "card_number": "LEAK-CARD",
                "pan": "LEAK-CARD",
                "cvv": "LEAK-CARD",
                "pin": "LEAK-PIN",
                "company_id": "comp_c",
                "plan_id": "plan_pro",
                "plan_name": "Profesyonel",
                "period": "monthly",
                "product_type": "subscription",
                "amount": 9,
                "currency": "try",
                "status": "failed",
                "payment_status": "failed",
                "applied": False,
                "failed_reason_code": "99",
                "failed_reason_msg": "Kart reddedildi",
                "paytr_error": "reddedildi",
                "created_at": "2026-06-04T00:00:00+00:00",
                "updated_at": "2026-06-04T00:00:00+00:00",
                "token": "LEAK-TOKEN",
            },
            {
                "_id": "tx_wait",
                "provider": "stripe",
                "session_id": "LEAK-SESSION",
                "merchant_oid": "LEAK-OID",
                "card_number": "LEAK-CARD",
                "pan": "LEAK-CARD",
                "cvv": "LEAK-CARD",
                "company_id": "comp_b",
                "plan_id": "plan_pro",
                "plan_name": "Profesyonel",
                "period": "monthly",
                "product_type": "subscription",
                "amount": 7,
                "currency": "try",
                "status": "initiated",
                "payment_status": "pending",
                "applied": False,
                "created_at": "2026-06-03T00:00:00+00:00",
                "updated_at": "2026-06-03T00:00:00+00:00",
            },
            {
                "_id": "tx_paid",
                "provider": "paytr",
                "session_id": "LEAK-SESSION",
                "merchant_oid": "LEAK-OID",
                "card_number": "LEAK-CARD",
                "pan": "LEAK-CARD",
                "cvv": "LEAK-CARD",
                "company_id": "comp_a",
                "plan_id": "plan_pro",
                "plan_name": "Profesyonel",
                "period": "monthly",
                "product_type": "subscription",
                "pack_id": None,
                "credits": 0,
                "amount": 100,
                "currency": "try",
                "status": "completed",
                "payment_status": "paid",
                "applied": True,
                "applied_at": "2026-06-02T00:00:00+00:00",
                "paid_at": "2026-06-02T00:00:00+00:00",
                "created_at": "2026-06-02T00:00:00+00:00",
                "updated_at": "2026-06-02T00:00:00+00:00",
                "invoice_id": "inv_1",
                "invoice_number": "ABN2026000001",
                "payment_type": "card",
                "invoice_mail": {"status": "sent", "token": "LEAK-TOKEN", "password": "LEAK-REQ-PASSWORD"},
            },
            {
                "_id": "tx_paid_old",
                "provider": "stripe",
                "session_id": "LEAK-SESSION",
                "merchant_oid": "LEAK-OID",
                "company_id": "comp_a",
                "plan_id": "plan_pro",
                "plan_name": "Profesyonel",
                "period": "yearly",
                "product_type": "subscription",
                "amount": 50,
                "currency": "try",
                "status": "completed",
                "payment_status": "paid",
                "applied": True,
                "created_at": "2026-06-01T00:00:00+00:00",
                "updated_at": "2026-06-01T00:00:00+00:00",
            },
        ]
        for row in payments:
            await db.payment_transactions.insert_one(row)

    asyncio.run(run())


def test_redact_pin_part_keeps_lookalikes():
    raw = {
        "pin": "1",
        "pin_hash": "2",
        "punch_pin": "3",
        "PIN": "8",
        "shipping": "4",
        "pinned": "5",
        "company": "6",
        "plan_id": "7",
        "has_password": True,
        "has_pin": True,
        "nested": {"pin": "9", "company_name": "Ada", "pinned_note": "stay"},
    }
    out = platform_admin_v1._redact(raw)
    assert "pin" not in out and "pin_hash" not in out and "punch_pin" not in out and "PIN" not in out
    assert out["shipping"] == "4"
    assert out["pinned"] == "5"
    assert out["company"] == "6"
    assert out["plan_id"] == "7"
    assert out["has_password"] is True
    assert out["has_pin"] is True
    assert "pin" not in out["nested"]
    assert out["nested"]["company_name"] == "Ada"
    assert out["nested"]["pinned_note"] == "stay"
    assert raw["pin"] == "1"


def test_commercial_auth_matrix(db):
    scopes = [scope for _, scope in _COMMERCIAL]
    _plant_key(db, key_id="pk_product_admin", secret="product-secret", kind="product", scopes=scopes)
    _plant_key(
        db, key_id="pk_bound_commercial", secret="bound-secret", kind="platform_admin",
        scopes=scopes, instance_id="comp_bound",
    )
    wrong, wrong_secret = _issue(db, [store.SCOPE_ADMIN_AUDIT_READ], name="audit-only")
    allowed, allowed_secret = _issue(
        db, scopes, ip_allowlist=["203.0.113.7"], name="commercial-ip",
    )
    open_client = _client()
    inside = _client("203.0.113.7")
    outside = _client("198.51.100.9")
    for path, scope in _COMMERCIAL:
        missing = open_client.get(path)
        assert missing.status_code == 401, path
        assert _detail(missing) == "Eksik imza başlıkları"

        denied, _, _ = _get(open_client, wrong_secret, wrong["id"], path)
        assert denied.status_code == 403, path
        assert _detail(denied) == "Kapsam yetersiz"

        product, _, _ = _get(open_client, "product-secret", "pk_product_admin", path)
        assert product.status_code == 403, path
        assert _detail(product) == "Kapsam yetersiz"

        bound, _, _ = _get(open_client, "bound-secret", "pk_bound_commercial", path)
        assert bound.status_code == 403, path
        assert _detail(bound) == "Kapsam yetersiz"

        far, _, _ = _get(outside, allowed_secret, allowed["id"], path)
        assert far.status_code == 403, path
        assert _detail(far) == "IP adresi bu anahtar için izinli değil"

        near, headers, _ = _get(inside, allowed_secret, allowed["id"], path)
        assert near.status_code == 200, f"{path} {near.text}"
        rows = [row for row in _audits(db) if row["action"] == f"admin_v1.{scope}"]
        assert rows, scope
        blob = json.dumps(rows[-1].get("details") or {})
        assert allowed_secret not in blob
        assert headers["X-Platform-Signature"] not in blob
        assert "203.0.113.7" not in blob


def test_commercial_reads_do_not_write_or_leak(db):
    _seed_commercial(db)
    saas.invalidate()
    before_users = copy.deepcopy(db.users.docs)
    before_counters = copy.deepcopy(db.counters.docs)
    pub, secret = _issue(db, [scope for _, scope in _COMMERCIAL], name="commercial")
    client = _client()
    blobs = []
    for path, scope in _COMMERCIAL:
        before = _write_counts(db)
        response, headers, _ = _get(client, secret, pub["id"], path)
        assert response.status_code == 200, f"{path} {response.text}"
        _assert_no_extra_writes(before, _write_counts(db))
        payload = response.json()
        found = []
        _walk_keys(payload, found)
        assert not any(_bad_key(key) for key in found), (path, found)
        text = json.dumps(payload)
        blobs.append(text)
        assert secret not in text
        assert headers["X-Platform-Signature"] not in text
        rows = [row for row in _audits(db) if row["action"] == f"admin_v1.{scope}"]
        assert rows
        details = json.dumps(rows[-1].get("details") or {})
        assert secret not in details
        assert headers["X-Platform-Signature"] not in details
        for leak in LEAKS:
            assert leak not in details

    joined = "\n".join(blobs)
    for leak in LEAKS:
        assert leak not in joined
    assert db.users.docs == before_users
    assert db.counters.docs == before_counters
    assert "user_number" not in db.users.docs["usr_ada"]
    assert "user_number" not in db.users.docs["usr_cem"]
    assert db.users.docs["usr_bora"]["user_number"] == "U-000050"

    users = json.loads(blobs[_COMMERCIAL.index(("/api/platform/admin-v1/platform-users", store.SCOPE_ADMIN_PLATFORM_USERS_READ))])
    assert set(users) == {"items", "limit", "offset", "total"}
    ada = next(row for row in users["items"] if row["id"] == "usr_ada")
    assert ada["user_number"] is None
    assert ada["is_super_admin"] is True
    assert "password_hash" not in ada
    assert "usr_tenant" not in json.dumps(users)

    requests_body = json.loads(blobs[2])
    pending = next(row for row in requests_body["items"] if row["id"] == "ur_new")
    assert pending["pinned"] == "keep-pinned"
    assert pending["shipping"] == "keep-shipping"
    assert pending["company"] == "keep-company"
    assert pending["plan_id"] == "plan_pro"
    assert "pin" not in pending and "token" not in pending and "password" not in pending


def test_commercial_pagination_and_filters(db):
    _seed_commercial(db)
    saas.invalidate()
    pub, secret = _issue(db, [scope for _, scope in _COMMERCIAL], name="page")
    client = _client()

    quotas, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/quotas",
        params={"limit": 1, "offset": 1},
    )
    assert quotas.status_code == 200, quotas.text
    qbody = quotas.json()
    assert qbody["limit"] == 1 and qbody["offset"] == 1 and qbody["total"] == 3
    assert [row["id"] for row in qbody["items"]] == ["comp_b"]
    assert qbody["items"][0]["name"] == "Beta"
    assert {plan["id"] for plan in qbody["plans"]} == {"plan_pro"}
    found, _, _ = _get(client, secret, pub["id"], "/api/platform/admin-v1/quotas", params={"q": "BETA"})
    assert found.json()["total"] == 1
    assert found.json()["items"][0]["id"] == "comp_b"
    empty_q, _, _ = _get(client, secret, pub["id"], "/api/platform/admin-v1/quotas", params={"offset": 9})
    assert empty_q.json()["items"] == []
    assert empty_q.json()["total"] == 3
    for bad_limit in (0, 201):
        rejected, _, _ = _get(
            client, secret, pub["id"], "/api/platform/admin-v1/quotas", params={"limit": bad_limit},
        )
        assert rejected.status_code == 422

    page, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/upgrade-requests",
        params={"limit": 1, "offset": 1},
    )
    assert page.status_code == 200, page.text
    assert page.json()["total"] == 4
    assert [row["id"] for row in page.json()["items"]] == ["ur_ok"]
    past, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/upgrade-requests", params={"offset": 9},
    )
    assert past.json()["items"] == [] and past.json()["total"] == 4
    bad_status, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/upgrade-requests", params={"status": "foo"},
    )
    assert bad_status.status_code == 400
    assert _detail(bad_status) == "Geçersiz durum."
    pending, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/upgrade-requests", params={"status": "pending"},
    )
    assert [row["id"] for row in pending.json()["items"]] == ["ur_new", "ur_old"]
    assert pending.json()["total"] == 2
    by_company, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/upgrade-requests",
        params={"company_id": "comp_b", "status": "approved"},
    )
    assert [row["id"] for row in by_company.json()["items"]] == ["ur_ok"]
    assert by_company.json()["total"] == 1
    for bad_limit in (0, 201):
        rejected, _, _ = _get(
            client, secret, pub["id"], "/api/platform/admin-v1/upgrade-requests",
            params={"limit": bad_limit},
        )
        assert rejected.status_code == 422

    payments, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/payments",
        params={"limit": 1, "offset": 1},
    )
    assert payments.status_code == 200, payments.text
    pbody = payments.json()
    assert pbody["limit"] == 1 and pbody["offset"] == 1 and pbody["total"] == 4
    assert pbody["total_paid"] == 150.0
    assert pbody["paid_count"] == 2
    assert [row["id"] for row in pbody["items"]] == ["tx_wait"]
    assert "session_id" not in pbody["items"][0]
    assert "merchant_oid" not in pbody["items"][0]
    far, _, _ = _get(client, secret, pub["id"], "/api/platform/admin-v1/payments", params={"offset": 10})
    assert far.json()["items"] == [] and far.json()["total"] == 4
    assert far.json()["total_paid"] == 150.0
    failed, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/payments", params={"status": "failed"},
    )
    assert failed.json()["total"] == 1
    assert failed.json()["total_paid"] == 0
    assert failed.json()["paid_count"] == 0
    assert failed.json()["items"][0]["paytr_error"] == "reddedildi"
    assert failed.json()["items"][0]["failed_reason_msg"] == "Kart reddedildi"
    assert "session_id" not in failed.json()["items"][0]
    paid, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/payments",
        params={"payment_status": "paid", "company_id": "comp_a"},
    )
    assert paid.json()["total"] == 2
    assert paid.json()["paid_count"] == 2
    assert paid.json()["total_paid"] == 150.0
    assert [row["id"] for row in paid.json()["items"]] == ["tx_paid", "tx_paid_old"]
    mailed = next(row for row in paid.json()["items"] if row["id"] == "tx_paid")
    assert mailed["invoice_mail_status"] == "sent"
    assert "invoice_mail" not in mailed
    waiting, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/payments", params={"company_id": "comp_b"},
    )
    assert waiting.json()["total"] == 1
    assert waiting.json()["total_paid"] == 0
    assert waiting.json()["items"][0]["id"] == "tx_wait"
    for bad_limit in (0, 201):
        rejected, _, _ = _get(
            client, secret, pub["id"], "/api/platform/admin-v1/payments", params={"limit": bad_limit},
        )
        assert rejected.status_code == 422

    staff, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/platform-users",
        params={"limit": 1, "offset": 1},
    )
    assert staff.status_code == 200, staff.text
    assert staff.json()["total"] == 3
    assert [row["id"] for row in staff.json()["items"]] == ["usr_bora"]
    assert staff.json()["items"][0]["user_number"] == "U-000050"
    named, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/platform-users", params={"q": "bora"},
    )
    assert [row["id"] for row in named.json()["items"]] == ["usr_bora"]
    numbered, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/platform-users", params={"q": "u-000050"},
    )
    assert [row["id"] for row in numbered.json()["items"]] == ["usr_bora"]
    mailed_user, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/platform-users", params={"q": "ada@"},
    )
    assert [row["id"] for row in mailed_user.json()["items"]] == ["usr_ada"]
    none_left, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/platform-users", params={"offset": 9},
    )
    assert none_left.json()["items"] == [] and none_left.json()["total"] == 3
    for bad_limit in (0, 201):
        rejected, _, _ = _get(
            client, secret, pub["id"], "/api/platform/admin-v1/platform-users",
            params={"limit": bad_limit},
        )
        assert rejected.status_code == 422


def test_system_commercial_routes_keep_their_shape(db):
    _seed_commercial(db)
    saas.invalidate()
    client = _client()

    overview = client.get("/api/system/overview")
    assert overview.status_code == 200, overview.text
    obody = overview.json()
    assert set(obody) == {
        "companies", "users", "platform_admins", "by_status", "by_plan", "mrr",
        "module_usage", "expiring", "pending_requests", "open_tickets", "recent",
    }
    assert obody["companies"] == 3
    assert obody["users"] == 1
    assert obody["platform_admins"] == 3
    assert obody["mrr"] == 220.0
    assert obody["by_status"] == {"active": 2, "trial": 1}
    assert obody["by_plan"] == {"Profesyonel": 3}
    assert obody["pending_requests"] == 2
    assert obody["open_tickets"] == 1
    assert obody["expiring"] == []
    assert [row["id"] for row in obody["recent"]] == ["comp_c", "comp_b", "comp_a"]
    direct_overview = asyncio.run(saas.overview_stats())
    assert obody == direct_overview

    quotas = client.get("/api/system/quotas")
    assert quotas.status_code == 200, quotas.text
    qbody = quotas.json()
    assert set(qbody) == {"quotas", "plans"}
    assert [row["id"] for row in qbody["quotas"]] == ["comp_a", "comp_b", "comp_c"]
    assert list(qbody["quotas"][0]) == [
        "id", "name", "plan_id", "plan_name", "plan_color", "status", "status_label",
        "user_limit", "company_limit", "product_limit", "contact_limit", "storage_limit_mb",
        "user_count", "company_count", "product_count", "contact_count", "storage_bytes",
        "plan_defaults", "overrides",
    ]
    assert qbody["quotas"][0]["name"] == "Ada"
    assert qbody["quotas"][0]["user_limit"] == 4
    assert qbody["quotas"][0]["overrides"]["user_limit"] == 4
    assert "secret" not in qbody["quotas"][0]
    assert "lic_orphan" not in json.dumps(qbody["quotas"])
    assert asyncio.run(saas.quota_rows()) == qbody

    requests_http = client.get("/api/system/upgrade-requests")
    assert requests_http.status_code == 200, requests_http.text
    rbody = requests_http.json()
    assert [row["id"] for row in rbody] == ["ur_new", "ur_ok", "ur_old", "ur_no"]
    assert rbody[0]["token"] == "LEAK-TOKEN"
    assert rbody[0]["password"] == "LEAK-REQ-PASSWORD"
    ignored = client.get("/api/system/upgrade-requests", params={"company_id": "comp_b"})
    assert ignored.json() == rbody
    only_pending = client.get("/api/system/upgrade-requests", params={"status": "pending"})
    assert [row["id"] for row in only_pending.json()] == ["ur_new", "ur_old"]
    assert asyncio.run(saas.upgrade_request_rows(status="pending")) == only_pending.json()

    payments = client.get("/api/system/payments")
    assert payments.status_code == 200, payments.text
    pay = payments.json()
    assert set(pay) == {"items", "total_paid", "paid_count"}
    assert [row["id"] for row in pay["items"]] == ["tx_fail", "tx_wait", "tx_paid", "tx_paid_old"]
    assert pay["total_paid"] == 150.0
    assert pay["paid_count"] == 2
    assert pay["items"][0]["session_id"] == "LEAK-SESSION"
    assert pay["items"][0]["merchant_oid"] == "LEAK-OID"
    assert pay["items"][0]["company_name"] == "Cem"
    assert pay["items"][2]["company_name"] == "Ada"
    assert asyncio.run(saas_billing.payment_rows()) == pay

    users_before = copy.deepcopy(db.users.docs)
    assert "user_number" not in users_before["usr_ada"]
    listed = client.get("/api/system/users")
    assert listed.status_code == 200, listed.text
    ubody = listed.json()
    assert set(ubody) == {"users", "companies", "roles"}
    assert [row["id"] for row in ubody["users"]] == ["usr_ada", "usr_bora", "usr_cem"]
    assert ubody["users"][0]["user_number"]
    assert ubody["users"][1]["user_number"] == "U-000050"
    assert ubody["users"][2]["user_number"]
    assert "password_hash" not in ubody["users"][0]
    assert {row["id"] for row in ubody["companies"]} == {"comp_a", "comp_b", "comp_c"}
    assert ubody["roles"] == [{"code": role["code"], "name": role["name"]} for role in rbac.DEFAULT_ROLES]
    assert db.users.docs["usr_ada"]["user_number"] == ubody["users"][0]["user_number"]
    assert db.users.docs["usr_cem"]["user_number"]
    assert db.counters.docs["USER_NO"]["seq"] >= 1
    direct_users = asyncio.run(saas.platform_user_rows(assign_numbers=True))
    assert direct_users["users"] == ubody["users"]
    assert direct_users["roles"] == ubody["roles"]


_ADMIN_ALLOW_REASON = (
    "Platform yönetim API'si; HMAC platform_admin anahtarı "
    "(kind=platform_admin, admin.* kapsamı), şirket oturumu yok"
)
_SMS_SUPPORT = (
    ("/api/platform/admin-v1/sms/settings", store.SCOPE_ADMIN_SMS_READ),
    ("/api/platform/admin-v1/sms/logs", store.SCOPE_ADMIN_SMS_READ),
    ("/api/platform/admin-v1/sms/failed-resets", store.SCOPE_ADMIN_SMS_READ),
    ("/api/platform/admin-v1/companies/comp_a/sms", store.SCOPE_ADMIN_SMS_READ),
    ("/api/platform/admin-v1/support/tickets", store.SCOPE_ADMIN_SUPPORT_READ),
    ("/api/platform/admin-v1/support/tickets/stk_open", store.SCOPE_ADMIN_SUPPORT_READ),
)
_RAW_PHONE = "+905551112233"
_RESET_MESSAGE = "Sifre sifirlama https://app.example/sifre-sifirla?t=LEAK-RESET-LINK"
_LOG_KEYS = {
    "id", "company_id", "context", "provider", "status", "detail", "code",
    "job_id", "contact_name", "created_at", "phone_masked", "message", "message_redacted",
}


def _seed_sms_support(db):
    async def run():
        for cid, name in (("comp_a", "Ada"), ("comp_b", "Beta"), ("comp_c", "Cem")):
            await db.companies.insert_one({"_id": cid, "name": name, "created_at": "2026-01-01T00:00:00+00:00"})
        await db.platform_settings.insert_one({
            "_id": "platform_sms",
            "provider": "netgsm",
            "usercode": "user1",
            "password_enc": "LEAK-PASSWORD-ENC",
            "msgheader": "TAMKOBI",
            "is_active": True,
            "verified": True,
            "verified_at": "2026-01-01T00:00:00+00:00",
            "verify_message": "OK",
            "last_test_at": None,
            "updated_at": "2026-01-02T00:00:00+00:00",
            "token": "LEAK-TOKEN",
            "password": "LEAK-REQ-PASSWORD",
        })
        await db.sms_settings.insert_one({
            "_id": "sms_comp_a",
            "company_id": "comp_a",
            "provider": "netgsm",
            "usercode": "cuser",
            "password_enc": "LEAK-PASSWORD-ENC",
            "is_active": True,
            "verified": True,
            "token": "LEAK-TOKEN",
        })
        logs = [
            {
                "_id": "sms_ann",
                "company_id": "comp_a",
                "phone": "+905559998877",
                "message": "Planli duyuru",
                "context": "announcement",
                "ref_id": None,
                "contact_name": "Ada",
                "provider": "netgsm",
                "status": "sent",
                "detail": "OK",
                "code": "00",
                "job_id": "job-ann",
                "source": "platform",
                "created_at": "2026-05-04T00:00:00+00:00",
            },
            {
                "_id": "sms_reset",
                "company_id": "comp_a",
                "phone": _RAW_PHONE,
                "message": _RESET_MESSAGE,
                "context": "erp_reset",
                "ref_id": "LEAK-RESET-TOKEN",
                "contact_name": "Ada",
                "provider": "netgsm",
                "status": "sent",
                "detail": "OK",
                "code": "00",
                "job_id": "job-reset",
                "source": "platform",
                "created_at": "2026-05-03T00:00:00+00:00",
                "password_enc": "LEAK-PASSWORD-ENC",
                "token": "LEAK-TICKET-TOKEN",
            },
            {
                "_id": "sms_unknown",
                "company_id": "comp_a",
                "phone": _RAW_PHONE,
                "message": "gizli https://app.example/sifre-sifirla?t=LEAK-RESET-LINK",
                "context": "custom_alert",
                "ref_id": "LEAK-RESET-TOKEN",
                "contact_name": "Ada",
                "provider": "netgsm",
                "status": "failed",
                "detail": "operator",
                "code": "30",
                "job_id": "job-unknown",
                "source": "platform",
                "created_at": "2026-05-02T00:00:00+00:00",
            },
            {
                "_id": "sms_maint",
                "company_id": "comp_b",
                "phone": "+905550000111",
                "message": "Bakim penceresi",
                "context": "maintenance",
                "provider": "netgsm",
                "status": "failed",
                "detail": "operator",
                "code": "30",
                "job_id": "job-maint",
                "contact_name": "Beta",
                "source": "platform",
                "created_at": "2026-05-01T00:00:00+00:00",
            },
            {
                "_id": "sms_event",
                "company_id": "comp_b",
                "phone": "+905550000222",
                "message": "Olay bildirimi",
                "context": "event_notify",
                "provider": "netgsm",
                "status": "sent",
                "detail": "OK",
                "code": "00",
                "job_id": "job-event",
                "contact_name": "Beta",
                "source": "platform",
                "created_at": "2026-04-30T00:00:00+00:00",
            },
            {
                "_id": "sms_test",
                "company_id": "comp_a",
                "phone": "+905550000333",
                "message": "Test metni",
                "context": "platform_test",
                "provider": "netgsm",
                "status": "sent",
                "detail": "OK",
                "code": "00",
                "job_id": "job-test",
                "contact_name": "Ada",
                "source": "platform",
                "created_at": "2026-04-29T00:00:00+00:00",
            },
            {
                "_id": "sms_co",
                "company_id": "comp_a",
                "phone": _RAW_PHONE,
                "message": "LEAK-RESET-LINK",
                "context": "announcement",
                "ref_id": "LEAK-RESET-TOKEN",
                "status": "failed",
                "source": "company",
                "created_at": "2026-07-01T00:00:00+00:00",
                "password_enc": "LEAK-PASSWORD-ENC",
            },
        ]
        for row in logs:
            await db.sms_logs.insert_one(row)
        await db.password_resets.insert_one({
            "_id": "pr_full_id_123456",
            "token": "LEAK-TOKEN",
            "phone": _RAW_PHONE,
            "email": "ada@example.com",
            "sms_failed": True,
            "mail_failed": False,
            "sms_error": "operator down",
            "company_id": "comp_a",
            "created_at": "2026-05-03T00:00:00+00:00",
            "channel": "sms",
            "reset_link": "https://app.example/sifre-sifirla?t=LEAK-RESET-LINK",
        })
        await db.password_resets.insert_one({
            "_id": "pr_mail_fail",
            "token": "LEAK-TOKEN",
            "phone": "",
            "email": "bora@example.com",
            "sms_failed": False,
            "mail_failed": True,
            "mail_error": "mailbox down",
            "company_id": "comp_b",
            "created_at": "2026-05-02T00:00:00+00:00",
            "channel": "email",
        })
        await db.password_resets.insert_one({
            "_id": "pr_ok",
            "token": "LEAK-TOKEN",
            "phone": _RAW_PHONE,
            "email": "ada@example.com",
            "sms_failed": False,
            "mail_failed": False,
            "created_at": "2026-05-04T00:00:00+00:00",
        })
        await db.support_tickets.insert_one({
            "_id": "stk_open",
            "number": "DST-2026-0001",
            "company_id": "comp_a",
            "company_name": "Ada",
            "subject": "Yazici bozuk",
            "category": "teknik",
            "priority": "high",
            "status": "open",
            "created_by_email": "ada@example.com",
            "created_at": "2026-06-01T00:00:00+00:00",
            "updated_at": "2026-06-05T00:00:00+00:00",
            "token": "LEAK-TOKEN",
            "password": "LEAK-REQ-PASSWORD",
            "messages": [
                {
                    "id": "m1",
                    "body": "Yazici kagit yemiyor",
                    "is_internal": False,
                    "is_staff": False,
                    "token": "LEAK-TICKET-TOKEN",
                    "secret": "LEAK-TICKET-SECRET",
                    "attachments": [{
                        "url": "/api/files/shot1",
                        "filename": "ekran.png",
                        "content_type": "image/png",
                        "size": 1200,
                        "token": "LEAK-TICKET-TOKEN",
                    }],
                },
                {
                    "id": "m2",
                    "body": "ic not",
                    "is_internal": True,
                    "is_staff": True,
                    "secret": "LEAK-TICKET-SECRET",
                },
            ],
        })
        await db.support_tickets.insert_one({
            "_id": "stk_prog",
            "number": "DST-2026-0002",
            "company_id": "comp_b",
            "company_name": "Beta",
            "subject": "Beta faturasi",
            "category": "fatura",
            "priority": "normal",
            "status": "in_progress",
            "created_by_email": "bora@example.com",
            "updated_at": "2026-06-04T00:00:00+00:00",
            "messages": [{"id": "m3", "body": "fatura", "is_internal": False}],
        })
        await db.support_tickets.insert_one({
            "_id": "stk_wait",
            "number": "DST-2026-0003",
            "company_id": "comp_a",
            "company_name": "Ada",
            "subject": "Bekleyen konu",
            "status": "waiting_customer",
            "created_by_email": "ada@example.com",
            "updated_at": "2026-06-03T00:00:00+00:00",
            "messages": [],
        })
        await db.support_tickets.insert_one({
            "_id": "stk_res",
            "number": "DST-2026-0004",
            "company_id": "comp_c",
            "company_name": "Cem",
            "subject": "Cozuldu",
            "status": "resolved",
            "created_by_email": "cem@example.com",
            "updated_at": "2026-06-02T00:00:00+00:00",
            "messages": [],
        })
        await db.support_tickets.insert_one({
            "_id": "stk_closed",
            "number": "DST-2026-0005",
            "company_id": "comp_c",
            "company_name": "Cem",
            "subject": "Kapali kayit",
            "status": "closed",
            "created_by_email": "cem@example.com",
            "updated_at": "2026-06-01T00:00:00+00:00",
            "messages": [],
        })

    asyncio.run(run())


def test_sms_support_allowlist_reasons():
    pairs = (
        ("GET", "/platform/admin-v1/companies/{company_id}/sms"),
        ("GET", "/platform/admin-v1/support/tickets/{ticket_id}"),
    )
    for pair in pairs:
        assert pair in allowlist.TENANT_IDOR_ALLOWLIST
        assert allowlist.ALLOWLIST_REASONS[pair] == _ADMIN_ALLOW_REASON


def test_sms_support_auth_matrix(db):
    _seed_sms_support(db)
    scopes = [store.SCOPE_ADMIN_SMS_READ, store.SCOPE_ADMIN_SUPPORT_READ]
    _plant_key(db, key_id="pk_product_sms", secret="product-secret", kind="product", scopes=scopes)
    _plant_key(
        db, key_id="pk_bound_sms", secret="bound-secret", kind="platform_admin",
        scopes=scopes, instance_id="comp_bound",
    )
    sms_key, sms_secret = _issue(db, [store.SCOPE_ADMIN_SMS_READ], name="sms-only")
    support_key, support_secret = _issue(db, [store.SCOPE_ADMIN_SUPPORT_READ], name="support-only")
    allowed, allowed_secret = _issue(db, scopes, ip_allowlist=["203.0.113.7"], name="sms-support-ip")
    open_client = _client()
    inside = _client("203.0.113.7")
    outside = _client("198.51.100.9")
    for path, scope in _SMS_SUPPORT:
        missing = open_client.get(path)
        assert missing.status_code == 401, path
        assert _detail(missing) == "Eksik imza başlıkları"

        if scope == store.SCOPE_ADMIN_SMS_READ:
            wrong_secret, wrong_id = support_secret, support_key["id"]
        else:
            wrong_secret, wrong_id = sms_secret, sms_key["id"]
        denied, _, _ = _get(open_client, wrong_secret, wrong_id, path)
        assert denied.status_code == 403, path
        assert _detail(denied) == "Kapsam yetersiz"

        product, _, _ = _get(open_client, "product-secret", "pk_product_sms", path)
        assert product.status_code == 403, path
        assert _detail(product) == "Kapsam yetersiz"

        bound, _, _ = _get(open_client, "bound-secret", "pk_bound_sms", path)
        assert bound.status_code == 403, path
        assert _detail(bound) == "Kapsam yetersiz"

        far, _, _ = _get(outside, allowed_secret, allowed["id"], path)
        assert far.status_code == 403, path
        assert _detail(far) == "IP adresi bu anahtar için izinli değil"

        near, headers, _ = _get(inside, allowed_secret, allowed["id"], path)
        assert near.status_code == 200, f"{path} {near.text}"
        rows = [row for row in _audits(db) if row["action"] == f"admin_v1.{scope}" and row.get("details", {}).get("path") == path]
        assert rows, scope
        blob = json.dumps(rows[-1].get("details") or {})
        assert allowed_secret not in blob
        assert headers["X-Platform-Signature"] not in blob
        assert "203.0.113.7" not in blob
        assert _RAW_PHONE not in blob


def test_sms_support_reads_do_not_write_or_leak(db, monkeypatch):
    _seed_sms_support(db)
    hit = []

    def _forbid(name):
        async def inner(*args, **kwargs):
            hit.append(name)
            raise AssertionError(name)
        return inner

    monkeypatch.setattr(comm_service, "sms_balance", _forbid("sms_balance"))
    monkeypatch.setattr(comm_service, "sms_send", _forbid("sms_send"))
    monkeypatch.setattr(platform_sms, "send_platform_sms", _forbid("send_platform_sms"))
    monkeypatch.setattr(platform_sms, "notify_companies_sms", _forbid("notify_companies_sms"))
    monkeypatch.setattr(mail_service, "send_mail", _forbid("send_mail"))
    sms_decrypts = {"n": 0}

    def _decrypt(value):
        if value == "LEAK-PASSWORD-ENC":
            sms_decrypts["n"] += 1
        return (value or "").removeprefix("enc:")

    monkeypatch.setattr(comm_service, "decrypt", _decrypt)
    before_ticket = copy.deepcopy(db.support_tickets.docs["stk_open"])
    pub, secret = _issue(db, [store.SCOPE_ADMIN_SMS_READ, store.SCOPE_ADMIN_SUPPORT_READ], name="sms-support")
    client = _client()
    blobs = []
    for path, scope in _SMS_SUPPORT:
        before = _write_counts(db)
        response, headers, _ = _get(client, secret, pub["id"], path)
        assert response.status_code == 200, f"{path} {response.text}"
        _assert_no_extra_writes(before, _write_counts(db))
        payload = response.json()
        found = []
        _walk_keys(payload, found)
        assert not any(_bad_key(key) for key in found), (path, [key for key in found if _bad_key(key)])
        text = json.dumps(payload)
        blobs.append(text)
        assert secret not in text
        assert headers["X-Platform-Signature"] not in text
        assert _RAW_PHONE not in text
        assert "905551112233" not in text
        rows = [row for row in _audits(db) if row["action"] == f"admin_v1.{scope}"]
        assert rows
        details = json.dumps(rows[-1].get("details") or {})
        assert secret not in details
        assert headers["X-Platform-Signature"] not in details
        assert _RAW_PHONE not in details
        for leak in LEAKS:
            assert leak not in details

    joined = "\n".join(blobs)
    for leak in LEAKS:
        assert leak not in joined
    assert hit == []
    assert sms_decrypts["n"] == 1
    assert db.support_tickets.docs["stk_open"] == before_ticket

    settings = json.loads(blobs[0])["item"]
    assert settings["has_password"] is True
    assert settings["password_unreadable"] is False
    assert settings["usercode"] == "user1"
    assert "password_enc" not in settings

    logs = json.loads(blobs[1])
    by_id = {row["id"]: row for row in logs["items"]}
    assert set(by_id) == {"sms_ann", "sms_reset", "sms_unknown", "sms_maint", "sms_event", "sms_test"}
    assert "sms_co" not in by_id
    for row in by_id.values():
        assert set(row) == _LOG_KEYS
        assert "phone" not in row
        assert "ref_id" not in row
    assert by_id["sms_ann"]["message"] == "Planli duyuru"
    assert by_id["sms_ann"]["message_redacted"] is False
    assert by_id["sms_ann"]["phone_masked"] == "•••8877"
    assert by_id["sms_maint"]["message"] == "Bakim penceresi"
    assert by_id["sms_maint"]["message_redacted"] is False
    assert by_id["sms_event"]["message"] == "Olay bildirimi"
    assert by_id["sms_event"]["message_redacted"] is False
    assert by_id["sms_test"]["message"] == "Test metni"
    assert by_id["sms_test"]["message_redacted"] is False
    assert by_id["sms_reset"]["message"] is None
    assert by_id["sms_reset"]["message_redacted"] is True
    assert by_id["sms_reset"]["phone_masked"] == "•••2233"
    assert by_id["sms_unknown"]["message"] is None
    assert by_id["sms_unknown"]["message_redacted"] is True
    assert logs["summary"] == {"sent": 4, "failed": 2}

    company = json.loads(blobs[3])["item"]
    direct_company = asyncio.run(company_sms.company_sms_summary(db, "comp_a"))
    assert company == direct_company
    assert company["connected"] is True
    assert company["operator"] == "Netgsm"
    assert company["provider"] == "netgsm"
    assert company["error_count"] == 2
    assert company["last_sent_at"] == "2026-07-01T00:00:00+00:00"
    assert company["readonly"] is True
    assert company["company_id"] == "comp_a"

    listed = json.loads(blobs[4])
    opened = next(row for row in listed["items"] if row["id"] == "stk_open")
    assert "messages" not in opened
    assert opened["message_count"] == 2
    assert "token" not in opened
    assert "password" not in opened

    detail = json.loads(blobs[5])
    assert detail["id"] == "stk_open"
    assert len(detail["messages"]) == 2
    assert detail["messages"][1]["is_internal"] is True
    attachment = detail["messages"][0]["attachments"][0]
    assert set(attachment) == {"url", "filename", "content_type", "size"}
    assert attachment["url"] == "/api/files/shot1"
    assert "token" not in detail["messages"][0]
    assert "secret" not in detail["messages"][0]
    assert db.support_tickets.docs["stk_open"] == before_ticket

    def _raise(value):
        if value == "LEAK-PASSWORD-ENC":
            raise RuntimeError("decrypt-failed-marker")
        return (value or "").removeprefix("enc:")

    monkeypatch.setattr(comm_service, "decrypt", _raise)
    before = _write_counts(db)
    unread, _, _ = _get(client, secret, pub["id"], "/api/platform/admin-v1/sms/settings")
    assert unread.status_code == 200, unread.text
    _assert_no_extra_writes(before, _write_counts(db))
    assert hit == []
    item = unread.json()["item"]
    assert item["has_password"] is False
    assert item["password_unreadable"] is True
    assert "LEAK-PASSWORD-ENC" not in unread.text
    assert "decrypt-failed-marker" not in unread.text


def test_sms_support_pagination_and_filters(db):
    _seed_sms_support(db)
    pub, secret = _issue(db, [store.SCOPE_ADMIN_SMS_READ, store.SCOPE_ADMIN_SUPPORT_READ], name="page")
    client = _client()

    first, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/sms/logs", params={"limit": 2},
    )
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["limit"] == 2
    assert [row["id"] for row in body["items"]] == ["sms_ann", "sms_reset"]
    assert body["next_cursor"] == "2026-05-03T00:00:00+00:00"
    assert body["summary"] == {"sent": 4, "failed": 2}
    second, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/sms/logs",
        params={"limit": 2, "before": body["next_cursor"]},
    )
    assert [row["id"] for row in second.json()["items"]] == ["sms_unknown", "sms_maint"]
    assert second.json()["next_cursor"] == "2026-05-01T00:00:00+00:00"
    assert second.json()["summary"] == {"sent": 4, "failed": 2}
    third, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/sms/logs",
        params={"limit": 2, "before": second.json()["next_cursor"]},
    )
    assert [row["id"] for row in third.json()["items"]] == ["sms_event", "sms_test"]
    assert third.json()["next_cursor"] is None
    seen = [row["id"] for row in first.json()["items"] + second.json()["items"] + third.json()["items"]]
    assert seen == ["sms_ann", "sms_reset", "sms_unknown", "sms_maint", "sms_event", "sms_test"]
    assert len(seen) == len(set(seen))

    sent, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/sms/logs", params={"status": "sent"},
    )
    assert [row["id"] for row in sent.json()["items"]] == ["sms_ann", "sms_reset", "sms_event", "sms_test"]
    assert sent.json()["summary"] == {"sent": 4, "failed": 2}
    only_maint, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/sms/logs",
        params={"status": "failed", "context": "maintenance"},
    )
    assert [row["id"] for row in only_maint.json()["items"]] == ["sms_maint"]
    assert only_maint.json()["next_cursor"] is None
    announce, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/sms/logs", params={"context": "announcement"},
    )
    assert [row["id"] for row in announce.json()["items"]] == ["sms_ann"]
    assert announce.json()["items"][0]["message"] == "Planli duyuru"
    for bad_limit in (0, 201):
        rejected, _, _ = _get(
            client, secret, pub["id"], "/api/platform/admin-v1/sms/logs", params={"limit": bad_limit},
        )
        assert rejected.status_code == 422

    resets, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/sms/failed-resets", params={"limit": 1},
    )
    assert resets.status_code == 200, resets.text
    assert resets.json()["total"] == 1
    assert resets.json()["items"][0]["id"] == "pr_full_…"
    assert resets.json()["items"][0]["phone_masked"] == "•••2233"
    assert resets.json()["items"][0]["email_masked"] == "ad•••@example.com"
    assert "token" not in resets.json()["items"][0]
    assert _RAW_PHONE not in resets.text
    both, _, _ = _get(client, secret, pub["id"], "/api/platform/admin-v1/sms/failed-resets")
    assert both.json()["total"] == 2
    assert [row["id"] for row in both.json()["items"]] == ["pr_full_…", "pr_mail_…"]
    assert both.json()["items"][1]["email_masked"] == "bo•••@example.com"
    assert "pr_ok" not in both.text
    for bad_limit in (0, 201):
        rejected, _, _ = _get(
            client, secret, pub["id"], "/api/platform/admin-v1/sms/failed-resets",
            params={"limit": bad_limit},
        )
        assert rejected.status_code == 422

    missing_co, _, _ = _get(client, secret, pub["id"], "/api/platform/admin-v1/companies/nope/sms")
    assert missing_co.status_code == 404
    assert _detail(missing_co) == "Şirket bulunamadı."

    page, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/support/tickets",
        params={"limit": 1, "offset": 1},
    )
    assert page.status_code == 200, page.text
    assert page.json()["limit"] == 1 and page.json()["offset"] == 1 and page.json()["total"] == 5
    assert [row["id"] for row in page.json()["items"]] == ["stk_prog"]
    assert page.json()["counts"] == {
        "open": 1, "in_progress": 1, "waiting_customer": 1, "resolved": 1, "closed": 1,
    }
    assert page.json()["open_count"] == 3
    assert "statuses" in page.json() and "categories" in page.json() and "priorities" in page.json()
    past, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/support/tickets", params={"offset": 9},
    )
    assert past.json()["items"] == [] and past.json()["total"] == 5
    bad_status, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/support/tickets", params={"status": "foo"},
    )
    assert bad_status.status_code == 400
    assert _detail(bad_status) == "Geçersiz durum."
    opened, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/support/tickets",
        params={"status": "open", "company_id": "comp_a", "q": "YAZICI"},
    )
    assert [row["id"] for row in opened.json()["items"]] == ["stk_open"]
    assert opened.json()["total"] == 1
    assert opened.json()["counts"]["closed"] == 1
    closed, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/support/tickets",
        params={"company_id": "comp_c", "status": "closed"},
    )
    assert [row["id"] for row in closed.json()["items"]] == ["stk_closed"]
    named, _, _ = _get(
        client, secret, pub["id"], "/api/platform/admin-v1/support/tickets", params={"q": "ada@"},
    )
    assert [row["id"] for row in named.json()["items"]] == ["stk_open", "stk_wait"]
    for bad_limit in (0, 201):
        rejected, _, _ = _get(
            client, secret, pub["id"], "/api/platform/admin-v1/support/tickets",
            params={"limit": bad_limit},
        )
        assert rejected.status_code == 422
    missing_tk, _, _ = _get(client, secret, pub["id"], "/api/platform/admin-v1/support/tickets/nope")
    assert missing_tk.status_code == 404
    assert _detail(missing_tk) == "Destek talebi bulunamadı."


def test_system_sms_and_support_routes_keep_their_shape(db):
    _seed_sms_support(db)
    client = _client()

    settings = client.get("/api/system/sms")
    assert settings.status_code == 200, settings.text
    direct_settings = asyncio.run(platform_sms.load_settings())
    assert settings.json() == platform_sms._public_view(direct_settings)
    assert settings.json()["has_password"] is True
    assert settings.json()["password_unreadable"] is False
    assert "password_enc" not in settings.json()
    assert "LEAK-PASSWORD-ENC" not in settings.text

    logs = client.get("/api/system/sms/logs")
    assert logs.status_code == 200, logs.text
    raw_rows = asyncio.run(platform_sms.platform_sms_log_rows(100))
    expect_logs = [platform_sms.sms_log_public(row) for row in raw_rows]
    assert logs.json() == {"items": expect_logs, "total": len(expect_logs)}
    assert "LEAK-RESET-TOKEN" not in logs.text
    assert _RAW_PHONE not in logs.text
    assert _RESET_MESSAGE not in logs.text
    for row in logs.json()["items"]:
        assert "ref_id" not in row
        assert "phone" not in row
    reset = next(row for row in logs.json()["items"] if row["id"] == "sms_reset")
    assert reset["phone_masked"]
    assert reset["message"] is None
    assert reset["message_redacted"] is True
    announce = next(row for row in logs.json()["items"] if row["id"] == "sms_ann")
    assert announce["message"] == "Planli duyuru"
    assert "sms_co" not in {row["id"] for row in logs.json()["items"]}
    ignored = client.get(
        "/api/system/sms/logs",
        params={"status": "failed", "context": "nope", "before": "1999-01-01T00:00:00+00:00"},
    )
    assert ignored.json() == logs.json()
    one = client.get("/api/system/sms/logs", params={"limit": 1})
    assert one.json()["total"] == 1
    assert one.json()["items"][0]["id"] == "sms_ann"
    assert one.json()["items"][0]["phone_masked"] == "•••8877"
    assert "phone" not in one.json()["items"][0]
    zero = client.get("/api/system/sms/logs", params={"limit": 0})
    assert zero.json()["total"] == 6

    failed = client.get("/api/system/password-resets/failed")
    assert failed.status_code == 200, failed.text
    assert failed.json() == asyncio.run(platform_sms.failed_reset_rows(40))
    assert [row["id"] for row in failed.json()["items"]] == ["pr_full_…", "pr_mail_…"]
    assert failed.json()["items"][0]["phone_masked"] == "•••2233"
    assert "LEAK-TOKEN" not in failed.text
    assert "LEAK-RESET-LINK" not in failed.text
    assert _RAW_PHONE not in failed.text
    assert client.get("/api/system/password-resets/failed", params={"limit": 1}).json()["total"] == 1
    assert client.get("/api/system/password-resets/failed", params={"limit": 0}).json()["total"] == 2

    company = client.get("/api/system/companies/comp_a/sms")
    assert company.status_code == 200, company.text
    assert company.json() == asyncio.run(company_sms.company_sms_summary(db, "comp_a"))
    assert "password_enc" not in company.json()
    missing = client.get("/api/system/companies/nope/sms")
    assert missing.status_code == 404
    assert missing.json()["detail"] == "Şirket bulunamadı."

    listed = client.get("/api/system/support-tickets")
    assert listed.status_code == 200, listed.text
    rows = asyncio.run(support_tickets.admin_ticket_rows())
    counts = asyncio.run(support_tickets.ticket_counts())
    expect = {
        "tickets": [support_tickets.public_ticket(row, staff=True, include_messages=False) for row in rows],
        "counts": counts,
        "open_count": counts["open"] + counts["in_progress"] + counts["waiting_customer"],
        **support_tickets.meta(),
    }
    assert listed.json() == expect
    assert listed.json()["tickets"][0]["id"] == "stk_open"
    assert listed.json()["tickets"][0]["token"] == "LEAK-TOKEN"
    assert "messages" not in listed.json()["tickets"][0]
    assert listed.json()["tickets"][0]["message_count"] == 2
    filtered = client.get("/api/system/support-tickets", params={"status": "open", "q": "yazici"})
    filtered_rows = asyncio.run(support_tickets.admin_ticket_rows(status="open", q="yazici"))
    assert [row["id"] for row in filtered.json()["tickets"]] == ["stk_open"]
    assert len(filtered_rows) == 1

    detail = client.get("/api/system/support-tickets/stk_open")
    assert detail.status_code == 200, detail.text
    assert detail.json() == support_tickets.public_ticket(db.support_tickets.docs["stk_open"], staff=True)
    assert detail.json()["messages"][0]["token"] == "LEAK-TICKET-TOKEN"
    assert detail.json()["messages"][0]["secret"] == "LEAK-TICKET-SECRET"
    assert detail.json()["messages"][0]["attachments"][0]["token"] == "LEAK-TICKET-TOKEN"
    missing_tk = client.get("/api/system/support-tickets/nope")
    assert missing_tk.status_code == 404
    assert missing_tk.json()["detail"] == "Destek talebi bulunamadı."
