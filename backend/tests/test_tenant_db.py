"""Kiracı DB katmanı. Bellek içi MemDB; canlı veritabanına ve 8021'e bağlanmaz.

dashboard_memdb.MemColl delete / distinct / replace / upsert bilmez.
Eksikler bu dosyadaki yerel alt sınıfta. dashboard_memdb.py değişmez.
"""
from __future__ import annotations

import asyncio
import copy
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(Path(__file__).resolve().parent))

os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

from dashboard_memdb import MemColl, MemDB, _split_field_ops  # noqa: E402
from mysql_store import match_query, new_upsert_doc, values_at  # noqa: E402
from schema_catalog import COLLECTIONS, SCOPE_PLATFORM, SCOPE_TENANT  # noqa: E402
import tenant_db  # noqa: E402
import tenant_scope  # noqa: E402
from tenant_scope import TenantScope, TenantScopeViolation, collection_kind  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
CO_C = "co_c"

_TOKEN_COLLECTIONS = ("password_resets", "b2b_password_resets", "push_receipts_pending")
_NEW_TENANT = (
    "cheques",
    "company_events",
    "leave_year_archives",
    "personnel_movements",
    "personnel_receipts",
    "work_order_trash_requests",
    "assigned_tasks",
    "idempotency_keys",
)
_NEW_PLATFORM = (
    "platform_mail_logs",
    "support_tickets",
    "support_sessions",
    "deletion_confirmations",
)


def _user(*company_ids, active=None, role="admin", super_admin=False):
    ids = list(company_ids)
    return {
        "_id": "user-" + "-".join(ids or ["none"]),
        "id": "user-" + "-".join(ids or ["none"]),
        "email": "user@example.com",
        "name": "Kullanıcı",
        "role": role,
        "is_active": True,
        "is_super_admin": super_admin,
        "company_ids": ids,
        "active_company_id": active if active is not None else (ids[0] if ids else ""),
    }


def _scope(company_id=CO_A, allowed=None, kind="user", actor_id="user-a", reason="test", contact_id=None):
    return TenantScope(
        company_id=company_id,
        allowed=frozenset(allowed if allowed is not None else {company_id}),
        kind=kind,
        actor_id=actor_id,
        reason=reason,
        contact_id=contact_id,
    )


class RecordingColl(MemColl):
    """Testin ihtiyaç duyduğu silme, distinct, replace ve upsert."""

    def __init__(self, name, db):
        super().__init__(name, db)
        self.seen = []

    def find(self, query=None, projection=None):
        self.seen.append(("find", copy.deepcopy(query)))
        return super().find(query, projection)

    def aggregate(self, pipeline):
        self.seen.append(("aggregate", copy.deepcopy(list(pipeline or []))))
        return super().aggregate(pipeline)

    async def update_one(self, query, update, upsert=False):
        self.seen.append(("update_one", copy.deepcopy(query), copy.deepcopy(update), upsert))
        result = await MemColl.update_one(self, query, update, upsert=False)
        if result.matched_count or not upsert:
            return result
        new_doc = new_upsert_doc(update, _split_field_ops(query or {}))
        self.docs.append(copy.deepcopy(new_doc))
        return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=new_doc.get("_id"))

    async def delete_one(self, query):
        query = _split_field_ops(query or {})
        for i, doc in enumerate(self.docs):
            if match_query(doc, query):
                self.docs.pop(i)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def delete_many(self, query):
        query = _split_field_ops(query or {})
        kept = []
        deleted = 0
        for doc in self.docs:
            if match_query(doc, query):
                deleted += 1
            else:
                kept.append(doc)
        self.docs = kept
        return SimpleNamespace(deleted_count=deleted)

    async def distinct(self, key, query=None):
        query = _split_field_ops(query or {})
        seen = []
        for doc in self.docs:
            if not match_query(doc, query):
                continue
            for val in values_at(doc, key):
                if val not in seen:
                    seen.append(val)
        return seen

    async def replace_one(self, query, replacement, upsert=False):
        query = _split_field_ops(query or {})
        body = copy.deepcopy(replacement)
        for i, doc in enumerate(self.docs):
            if match_query(doc, query):
                body["_id"] = doc.get("_id") or body.get("_id")
                self.docs[i] = body
                return SimpleNamespace(matched_count=1, modified_count=1, upserted_id=None)
        if not upsert:
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)
        if not body.get("_id"):
            body["_id"] = f"repl-{len(self.docs)}"
        self.docs.append(body)
        return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=body["_id"])

    async def update_one_atomic(self, query, update):
        return await self.update_one(query, update, upsert=False)

    async def find_one_and_update(self, query, update, upsert=False, return_document=True, projection=None):
        before = await self.find_one(query)
        result = await self.update_one(query, update, upsert=upsert)
        if not result.matched_count and not getattr(result, "upserted_id", None):
            return None
        after = await self.find_one({"_id": (before or {}).get("_id") or result.upserted_id})
        return after if return_document else before


def _raw(name="orders"):
    db = MemDB()
    coll = RecordingColl(name, db)
    db._cols[name] = coll
    return db, coll


def _scoped(allowed=None, company_id=CO_A, name="orders"):
    db, raw = _raw(name)
    scope = _scope(company_id, allowed if allowed is not None else {company_id})
    return db, raw, tenant_db.ScopedCollection(raw, scope)


async def _seed(raw):
    await raw.insert_one({"_id": "a1", "company_id": CO_A, "name": "kalem", "status": "open"})
    await raw.insert_one({"_id": "b1", "company_id": CO_B, "name": "kalem", "status": "open"})
    await raw.insert_one({"_id": "c1", "company_id": CO_C, "name": "defter", "status": "open"})
    await raw.insert_one({"_id": "a2", "company_id": CO_A, "name": "silgi", "status": "closed"})


def _ids(docs):
    return sorted(doc["_id"] for doc in docs)


def test_scoped_reads_stay_on_company_a():
    _db, raw, coll = _scoped()

    async def run():
        await _seed(raw)
        found = await coll.find({}).to_list(20)
        assert _ids(found) == ["a1", "a2"]
        assert await coll.find_one({"_id": "b1"}) is None
        found_a = await coll.find_one({"_id": "a1"})
        assert found_a["name"] == "kalem"
        assert await coll.count_documents({}) == 2
        assert await coll.count_documents({"status": "open"}) == 1
        assert await coll.distinct("name") == ["kalem", "silgi"]
        assert await coll.distinct("company_id") == [CO_A]

    asyncio.run(run())


def test_write_does_not_touch_other_company_or_caller_dict():
    _db, raw, coll = _scoped()

    async def run():
        await _seed(raw)
        before = copy.deepcopy(raw.docs)
        updated = await coll.update_one({"_id": "b1"}, {"$set": {"name": "hack"}})
        assert updated.matched_count == 0
        deleted = await coll.delete_one({"_id": "b1"})
        assert deleted.deleted_count == 0
        assert raw.docs == before

        original = {"_id": "n1", "name": "yeni"}
        await coll.insert_one(original)
        assert "company_id" not in original
        stored = next(doc for doc in raw.docs if doc["_id"] == "n1")
        assert stored["company_id"] == CO_A

        with pytest.raises(TenantScopeViolation) as exc:
            await coll.insert_one({"_id": "n2", "company_id": CO_B, "name": "yabanci"})
        assert exc.value.status_code == 404
        assert exc.value.detail == "Kayıt bulunamadı."
        assert all(doc["_id"] != "n2" for doc in raw.docs)

        snapshot = copy.deepcopy(raw.docs)
        with pytest.raises(TenantScopeViolation):
            await coll.update_one({"_id": "a1"}, {"$set": {"company_id": CO_B}})
        with pytest.raises(TenantScopeViolation):
            await coll.update_one({"_id": "a1"}, {"$unset": {"company_id": ""}})
        assert raw.docs == snapshot

        caller_update = {"$set": {"name": "upsert-kalem"}}
        await coll.update_one({"_id": "up1"}, caller_update, upsert=True)
        assert caller_update == {"$set": {"name": "upsert-kalem"}}
        upserted = next(doc for doc in raw.docs if doc["_id"] == "up1")
        assert upserted["company_id"] == CO_A
        recorded = next(item for item in reversed(raw.seen) if item[0] == "update_one")
        assert recorded[2]["$setOnInsert"]["company_id"] == CO_A

    asyncio.run(run())


def test_filter_merge_preserves_and_rejects_other_company():
    _db, raw, coll = _scoped(allowed={CO_A, CO_C})

    async def run():
        await _seed(raw)
        caller = {"$and": [{"name": "kalem"}, {"status": "open"}]}
        rows = await coll.find(caller).to_list(20)
        assert [doc["_id"] for doc in rows] == ["a1"]
        assert caller == {"$and": [{"name": "kalem"}, {"status": "open"}]}
        passed = next(item[1] for item in raw.seen if item[0] == "find")
        assert {"name": "kalem"} in passed["$and"]
        assert {"status": "open"} in passed["$and"]
        assert {"company_id": CO_A} in passed["$and"]

        raw.seen.clear()
        both = await coll.find({"company_id": {"$in": [CO_A, CO_C]}}).to_list(20)
        assert _ids(both) == ["a1", "a2", "c1"]
        forwarded = next(item[1] for item in raw.seen if item[0] == "find")
        assert forwarded["company_id"]["$in"] == [CO_A, CO_C]

        before = copy.deepcopy(raw.docs)
        with pytest.raises(TenantScopeViolation) as exc:
            await coll.find({"company_id": CO_B}).to_list(10)
        assert exc.value.status_code == 404
        assert exc.value.detail == "Kayıt bulunamadı."
        with pytest.raises(TenantScopeViolation):
            await coll.find({"company_id": {"$in": [CO_A, CO_B]}}).to_list(10)
        assert raw.docs == before

        same = {"company_id": CO_A, "name": "silgi"}
        only = await coll.find(same).to_list(10)
        assert [doc["_id"] for doc in only] == ["a2"]

    asyncio.run(run())


def test_aggregate_prefixes_match_and_keeps_only_a():
    _db, raw, coll = _scoped()

    async def run():
        await _seed(raw)
        rows = await coll.aggregate([{"$match": {"name": "kalem"}}]).to_list(20)
        assert _ids(rows) == ["a1"]
        pipeline = next(item[1] for item in raw.seen if item[0] == "aggregate")
        assert pipeline[0] == {"$match": {"company_id": CO_A}}
        assert pipeline[1] == {"$match": {"name": "kalem"}}
        with pytest.raises(TenantScopeViolation):
            coll.aggregate([{"$match": {"company_id": CO_B}}])

    asyncio.run(run())


def test_replace_and_bulk_stay_on_company_a():
    _db, raw, coll = _scoped()

    async def run():
        await _seed(raw)
        many = await coll.update_many({}, {"$set": {"touched": True}})
        assert many.matched_count == 2
        assert all(doc.get("touched") for doc in raw.docs if doc["company_id"] == CO_A)
        assert all("touched" not in doc for doc in raw.docs if doc["company_id"] != CO_A)

        deleted = await coll.delete_many({"status": "open"})
        assert deleted.deleted_count == 1
        assert next(doc for doc in raw.docs if doc["_id"] == "b1")["status"] == "open"
        assert all(doc["_id"] != "a1" for doc in raw.docs)

        await coll.replace_one({"_id": "a2"}, {"_id": "a2", "name": "silgi-2", "status": "closed"})
        replaced = next(doc for doc in raw.docs if doc["_id"] == "a2")
        assert replaced["company_id"] == CO_A
        assert replaced["name"] == "silgi-2"
        with pytest.raises(TenantScopeViolation):
            await coll.replace_one({"_id": "a2"}, {"_id": "a2", "company_id": CO_B, "name": "x"})

        changed = await coll.find_one_and_update({"_id": "a2"}, {"$set": {"name": "silgi-3"}})
        assert changed["name"] == "silgi-3"
        assert changed["company_id"] == CO_A
        atomic = await coll.update_one_atomic({"_id": "a2"}, {"$set": {"status": "closed"}})
        assert atomic.matched_count == 1

    asyncio.run(run())


def test_tenant_db_routes_kinds():
    db = MemDB()
    scope = _scope()
    tdb = tenant_db.TenantDB(db, scope)

    async def run():
        await db.users.insert_one({"_id": "ua", "company_ids": [CO_A], "email": "a@example.com"})
        await db.users.insert_one({"_id": "ub", "company_ids": [CO_B], "email": "b@example.com"})
        await db.users.insert_one({"_id": "uac", "company_ids": [CO_A, CO_C], "email": "ac@example.com"})
        users = await tdb.users.find({}).to_list(10)
        assert _ids(users) == ["ua", "uac"]
        assert await tdb.users.find_one({"_id": "ub"}) is None
        with pytest.raises(NotImplementedError):
            await tdb.users.insert_one({"_id": "nope"})
        with pytest.raises(NotImplementedError):
            await tdb.users.update_one({"_id": "ua"}, {"$set": {"name": "x"}})

        await db.companies.insert_one({"_id": CO_A, "name": "A"})
        await db.companies.insert_one({"_id": CO_B, "name": "B"})
        companies = await tdb.companies.find({}).to_list(10)
        assert [doc["_id"] for doc in companies] == [CO_A]
        assert await tdb.companies.find_one({"name": "B"}) is None

        await db.help_articles.insert_one({"_id": "h1", "slug": "giris", "title": "Giriş"})
        await db.password_resets.insert_one({"_id": "pr1", "user_id": "ua", "email": "a@example.com"})
        assert tdb.help_articles is db.help_articles
        assert tdb.password_resets is db.password_resets
        assert tdb.b2b_password_resets is db.b2b_password_resets
        assert tdb.push_receipts_pending is db.push_receipts_pending
        article = await tdb.help_articles.find_one({"_id": "h1"})
        assert article["title"] == "Giriş"
        assert await tdb.password_resets.count_documents({}) == 1

        await db.not_in_catalog_xyz.insert_one({"_id": "1", "company_id": CO_A, "n": 1})
        await db.not_in_catalog_xyz.insert_one({"_id": "2", "company_id": CO_B, "n": 2})
        unknown = tdb.not_in_catalog_xyz
        assert isinstance(unknown, tenant_db.ScopedCollection)
        rows = await unknown.find({}).to_list(10)
        assert [doc["_id"] for doc in rows] == ["1"]

    asyncio.run(run())


def test_collection_kind_follows_catalog():
    for name, meta in COLLECTIONS.items():
        kind = collection_kind(name)
        if name == "users":
            assert kind == "membership"
        elif name == "companies":
            assert kind == "company"
        elif name in _TOKEN_COLLECTIONS:
            assert kind == "token"
            assert meta["scope"] == SCOPE_TENANT
        elif meta["scope"] == SCOPE_TENANT:
            assert kind == "tenant", name
        else:
            assert meta["scope"] == SCOPE_PLATFORM
            assert kind == "platform", name
    assert collection_kind("no_such_collection_zz") == "unknown"
    assert len(_NEW_TENANT) + len(_NEW_PLATFORM) == 12
    for name in _NEW_TENANT:
        assert name in COLLECTIONS
        assert COLLECTIONS[name]["scope"] == SCOPE_TENANT
        assert COLLECTIONS[name]["description"]
        assert COLLECTIONS[name]["keys"]
        assert collection_kind(name) == "tenant"
    for name in _NEW_PLATFORM:
        assert name in COLLECTIONS
        assert COLLECTIONS[name]["scope"] == SCOPE_PLATFORM
        assert COLLECTIONS[name]["description"]
        assert COLLECTIONS[name]["keys"]
        assert collection_kind(name) == "platform"


class _Req:
    def __init__(self, company_id=None):
        self.query_params = {} if company_id is None else {"company_id": company_id}


def test_get_tenant_db_binds_resets_and_rejects():
    holder = {}

    async def current_user(request):
        return holder["user"]

    tenant_db.init(MemDB(), current_user)
    leaks = []
    app = FastAPI()

    @app.middleware("http")
    async def _watch(request, call_next):
        try:
            return await call_next(request)
        finally:
            leaks.append(tenant_scope.current())

    @app.get("/scope")
    async def scope_route(tdb=Depends(tenant_db.get_tenant_db)):
        cur = tenant_scope.current()
        return {
            "company_id": cur.company_id,
            "allowed": sorted(cur.allowed),
            "kind": cur.kind,
            "wrapped": isinstance(tdb, tenant_db.TenantDB),
        }

    client = TestClient(app)
    holder["user"] = _user(CO_A, CO_C, active=CO_A)
    res = client.get("/scope")
    assert res.status_code == 200
    assert res.json()["company_id"] == CO_A
    assert res.json()["allowed"] == [CO_A, CO_C]
    assert res.json()["kind"] == "user"
    assert res.json()["wrapped"] is True
    assert leaks[-1] is None
    assert tenant_scope.current() is None

    res = client.get("/scope", params={"company_id": CO_C})
    assert res.status_code == 200
    assert res.json()["company_id"] == CO_C
    assert leaks[-1] is None

    res = client.get("/scope", params={"company_id": CO_B})
    assert res.status_code == 403
    assert leaks[-1] is None
    assert tenant_scope.current() is None

    holder["user"] = _user(super_admin=True)
    res = client.get("/scope")
    assert res.status_code == 400
    assert leaks[-1] is None

    holder["user"] = _user(CO_A, CO_C, active=CO_A, super_admin=True)
    res = client.get("/scope", params={"company_id": CO_C})
    assert res.status_code == 200
    assert res.json()["company_id"] == CO_C
    assert res.json()["allowed"] == [CO_C]

    async def same_task():
        holder["user"] = _user(CO_A, CO_C, active=CO_A)
        agen = tenant_db.get_tenant_db(_Req(CO_C))
        tdb = await agen.__anext__()
        try:
            assert tenant_scope.current().company_id == CO_C
            assert isinstance(tdb, tenant_db.TenantDB)
        finally:
            await agen.aclose()
        assert tenant_scope.current() is None

        denied = tenant_db.get_tenant_db(_Req(CO_B))
        with pytest.raises(HTTPException) as exc:
            await denied.__anext__()
        assert exc.value.status_code == 403
        assert tenant_scope.current() is None

    asyncio.run(same_task())


def test_unscoped_requires_reason_and_logs_without_payload(monkeypatch):
    seen = []

    def capture(event, message="", **fields):
        seen.append({"event": event, "message": message, "fields": dict(fields)})

    monkeypatch.setattr(tenant_scope, "log_event", capture)
    with pytest.raises(ValueError):
        with tenant_scope.unscoped(""):
            pass
    with pytest.raises(ValueError):
        with tenant_scope.unscoped("   "):
            pass

    secret_filter = {"company_id": CO_B, "email": "a@example.com", "token": "gizli"}
    secret_doc = {"password": "yok", "body": "belge"}
    with tenant_scope.unscoped("bakim penceresi"):
        assert secret_filter["company_id"] == CO_B
        assert secret_doc["body"] == "belge"
    assert seen
    row = seen[-1]
    assert row["event"] == "tenant_guard.escape"
    assert row["fields"]["reason"] == "bakim penceresi"
    assert row["fields"]["kind"] == "unscoped"
    assert row["fields"]["caller"].startswith("test_tenant_db.py:")
    assert not row["fields"]["caller"].startswith("tenant_scope.py")
    assert not row["fields"]["caller"].startswith("tenant_db.py")
    blob = repr(row)
    assert CO_B not in blob
    assert "a@example.com" not in blob
    assert "gizli" not in blob
    assert "belge" not in blob
    assert set(row["fields"]) <= {"reason", "caller", "kind"}

    def boom(*args, **kwargs):
        raise RuntimeError("log down")

    monkeypatch.setattr(tenant_scope, "log_event", boom)
    with tenant_scope.unscoped("log kirilir"):
        pass

    db = MemDB()
    tdb = tenant_db.TenantDB(db, _scope())
    monkeypatch.setattr(tenant_scope, "log_event", capture)
    seen.clear()
    assert tdb.unscoped("ham okuma") is db
    assert seen[-1]["fields"]["reason"] == "ham okuma"
    assert seen[-1]["fields"]["caller"].startswith("test_tenant_db.py:")


def test_for_company_and_b2b_contact_bind_and_isolate():
    tenant_db.init(MemDB())

    async def run():
        seen = {}

        async def work(cid, delay):
            async with tenant_db.for_company(cid, "gece-" + cid) as handle:
                await asyncio.sleep(delay)
                cur = tenant_scope.current()
                seen[cid] = cur.company_id
                assert cur.kind == "system"
                assert cur.reason == "gece-" + cid
                assert cur.allowed == frozenset({cid})
                assert isinstance(handle, tenant_db.TenantDB)
            assert tenant_scope.current() is None

        await asyncio.gather(work(CO_A, 0.02), work(CO_B, 0.01))
        assert seen == {CO_A: CO_A, CO_B: CO_B}
        assert tenant_scope.current() is None

        async with tenant_db.from_b2b_contact({"_id": "ct1", "company_id": CO_A}) as handle:
            cur = tenant_scope.current()
            assert cur.kind == "b2b"
            assert cur.company_id == CO_A
            assert cur.contact_id == "ct1"
            assert cur.actor_id == "ct1"
            assert cur.allowed == frozenset({CO_A})
            assert isinstance(handle, tenant_db.TenantDB)
        assert tenant_scope.current() is None

        with pytest.raises(ValueError):
            async with tenant_db.for_company("", "sebep"):
                pass
        with pytest.raises(ValueError):
            async with tenant_db.for_company("   ", "sebep"):
                pass
        with pytest.raises(HTTPException) as exc:
            async with tenant_db.from_b2b_contact({"_id": "ct-bos"}):
                pass
        assert exc.value.status_code == 404
        assert exc.value.detail == "Kayıt bulunamadı."
        with pytest.raises(HTTPException) as exc:
            async with tenant_db.from_b2b_contact({"company_id": "  ", "id": "x"}):
                pass
        assert exc.value.status_code == 404
        assert tenant_scope.current() is None

    asyncio.run(run())


def test_static_no_default_company_and_no_route_uses_tenant_db():
    scope_text = (_BACKEND / "tenant_scope.py").read_text(encoding="utf-8")
    db_text = (_BACKEND / "tenant_db.py").read_text(encoding="utf-8")
    server_text = (_BACKEND / "server.py").read_text(encoding="utf-8")
    assert "comp_nexus_main_01" not in scope_text
    assert "comp_nexus_main_01" not in db_text
    assert "get_tenant_db" not in server_text
    assert "tenant_db.for_company" not in server_text
    assert "tenant_db.from_b2b_contact" not in server_text
    assert "from_b2b_contact" not in server_text
    assert "tenant_db.init(db, get_current_user)" in server_text
