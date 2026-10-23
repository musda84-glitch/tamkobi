"""Event loop'u tıkamayan okuma yolu. Canlı veritabanına ve 8021 portuna bağlanmaz.

Üç kip (legacy süzgeç, shared_v2, dedicated) SQL'e indirilen okumada
match_query / aggregate_rows / changed_window ile aynı kümeyi verir.
"""
from __future__ import annotations

import asyncio
import json
import sqlite3
import sys
import threading
import time
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import storage_admin  # noqa: E402
import storage_dedicated  # noqa: E402
import storage_router  # noqa: E402
import storage_shared_v2  # noqa: E402
import tenant_scope  # noqa: E402
from dashboard_memdb import MemDB  # noqa: E402
from mysql_store import (  # noqa: E402
    MySQLCollection,
    aggregate_rows,
    changed_since_sql,
    changed_window,
    clear_hot_cache,
    dumps,
    filter_matching,
    indexed_prefilter_keeps,
    match_query,
    note_hot_write,
    sql_count_exact,
)
from storage_dedicated import DedicatedCollection  # noqa: E402
from storage_migrations.engine import apply  # noqa: E402
from storage_migrations.session import Session, connect  # noqa: E402

CO = "co"


def _legacy_docs():
    return [
        {"_id": "1", "company_id": "c1", "status": "open", "name": "alpha", "issued_at": "2024-01-02"},
        {"_id": "2", "company_id": "c1", "status": "closed", "name": "beta", "issued_at": "2024-03-01"},
        {"_id": "3", "company_id": "c2", "status": "open", "name": "gamma", "issued_at": "2024-02-01"},
        {"_id": "4", "company_id": "c1", "status": "open", "name": "delta", "issued_at": "2023-12-01"},
    ]


def _assert_same_set(docs, query):
    plain = [doc for doc in docs if match_query(doc, query)]
    both = [doc for doc in docs if indexed_prefilter_keeps(doc, query) and match_query(doc, query)]
    assert [doc["_id"] for doc in both] == [doc["_id"] for doc in plain]
    if sql_count_exact("invoices", query) is not None:
        only = [doc for doc in docs if indexed_prefilter_keeps(doc, query)]
        assert [doc["_id"] for doc in only] == [doc["_id"] for doc in plain]


def test_legacy_pushdown_matches_python():
    docs = _legacy_docs()
    queries = [
        {"company_id": "c1", "status": "open"},
        {"company_id": "c1", "status": {"$in": ["open", "closed"]}},
        {"company_id": "c1", "issued_at": {"$gte": "2024-01-01"}},
        {"$or": [{"company_id": "c1"}, {"company_id": "c2"}]},
        {"_id": "2"},
    ]
    for query in queries:
        _assert_same_set(docs, query)
    pipeline = [
        {"$match": {"company_id": "c1"}},
        {"$group": {"_id": "$status", "n": {"$sum": "$issued_at"}}},
    ]
    narrowed = [doc for doc in docs if indexed_prefilter_keeps(doc, {"company_id": "c1"})]
    assert aggregate_rows(narrowed, pipeline) == aggregate_rows(docs, pipeline)
    short_sql, short_args, _parsed, cap = changed_since_sql("invoices", "2024-01-01T00:00:00+00:00", "c1", 10)
    assert " AND company_id=%s" in short_sql
    assert "JSON_EXTRACT" not in short_sql
    assert "ORDER BY updated_at ASC, id ASC" in short_sql
    assert short_args[0] == "invoices"
    assert "c1" in short_args
    assert cap == 10
    long_id = "c" * 65
    long_sql, long_args, _parsed, _cap = changed_since_sql("invoices", None, long_id, 3)
    assert "JSON_EXTRACT(doc, '$.company_id')" in long_sql
    assert " AND company_id=%s" not in long_sql
    assert long_args[-2] == long_id
    column_hits = [doc["_id"] for doc in docs if doc.get("company_id") == "c1"]
    json_hits = [doc["_id"] for doc in docs if str(doc.get("company_id") or "") == "c1"]
    assert column_hits == json_hits


def _apply_shared(conn):
    apply(Session(conn, "sqlite", read_only=False), confirm=True, dry_run=False)


def _ids(docs):
    return sorted(str(doc.get("_id")) for doc in docs)


def _raw_shared(conn):
    rows = conn.execute(
        "SELECT doc FROM docs_v2 WHERE collection = ? AND company_id = ?",
        ("invoices", CO),
    ).fetchall()
    return [json.loads(row[0]) for row in rows]


def test_shared_v2_matches_python(monkeypatch):
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "")
    previous = tenant_scope.set_mode("off")
    storage_router.reset()
    storage_shared_v2.reset_store()
    conn = sqlite3.connect(":memory:", isolation_level=None)
    try:
        _apply_shared(conn)
        storage_shared_v2.bind_sqlite(conn)
        coll = storage_shared_v2.collection_for(CO, "invoices")

        async def run():
            await coll.insert_one({
                "_id": "a", "status": "open", "total": 2, "updated_at": "2024-01-01T00:00:00+00:00",
            })
            await coll.insert_one({
                "_id": "b", "status": "closed", "total": 5, "updated_at": "2024-02-01T00:00:00+00:00",
            })
            await coll.insert_one({
                "_id": "c", "status": "open", "total": 9, "updated_at": "2024-03-01T00:00:00+00:00",
            })
            raw = _raw_shared(conn)
            query = {"company_id": CO, "status": "open"}
            found = await coll.find(query).to_list(None)
            expect = [doc for doc in raw if match_query(doc, query)]
            assert _ids(found) == _ids(expect)
            assert await coll.count_documents(query) == len(expect)
            pipeline = [
                {"$match": {"company_id": CO}},
                {"$group": {"_id": "$status", "n": {"$sum": "$total"}}},
            ]
            got = await coll.aggregate(pipeline).to_list(None)
            exp = aggregate_rows(raw, pipeline)
            assert sorted(got, key=lambda row: str(row.get("_id"))) == sorted(exp, key=lambda row: str(row.get("_id")))
            page, _cursor, more = await coll.changed_since(None, company_id=CO, limit=10)
            window, _wcursor, wmore = changed_window(raw, None, 10)
            assert [doc["_id"] for doc in page] == [doc["_id"] for doc in window]
            assert more is wmore
            later, _cursor, _more = await coll.changed_since("2024-02-01T00:00:00+00:00", company_id=CO, limit=10)
            expect_later, _c2, _m2 = changed_window(raw, "2024-02-01T00:00:00+00:00", 10)
            assert [doc["_id"] for doc in later] == [doc["_id"] for doc in expect_later]

        asyncio.run(run())
    finally:
        tenant_scope.set_mode(previous)
        storage_router.reset()
        storage_shared_v2.reset_store()
        conn.close()


def _raw_dedicated(path):
    conn = sqlite3.connect(path)
    try:
        rows = conn.execute(
            "SELECT doc FROM storage_records WHERE collection = ?",
            ("invoices",),
        ).fetchall()
    finally:
        conn.close()
    return [json.loads(row[0]) for row in rows]


def test_dedicated_matches_python(monkeypatch, tmp_path):
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "")
    previous = tenant_scope.set_mode("off")
    storage_router.reset()
    storage_dedicated.reset_pools()
    path = tmp_path / "dedicated.db"
    dsn = f"sqlite:///{path}"
    session = connect(dsn, write=True)
    try:
        apply(session, confirm=True, dry_run=False)
    finally:
        session.close()
    coll = DedicatedCollection(CO, "invoices", dsn)
    try:
        async def run():
            await coll.insert_one({
                "_id": "a", "company_id": CO, "status": "open", "total": 2,
            })
            await coll.insert_one({
                "_id": "b", "company_id": CO, "status": "closed", "total": 5,
            })
            await coll.insert_one({
                "_id": "c", "company_id": "other", "status": "open", "total": 9,
            })
            await coll.insert_one({"_id": "d", "status": "open", "total": 1})
            raw = _raw_dedicated(path)
            query = {"company_id": CO, "status": "open"}
            found = await coll.find(query).to_list(None)
            expect = [doc for doc in raw if match_query(doc, query)]
            assert _ids(found) == _ids(expect)
            assert await coll.count_documents(query) == len(expect)
            assert await coll.find_one({"_id": "b"})
            pipeline = [
                {"$match": {"company_id": CO}},
                {"$group": {"_id": "$status", "n": {"$sum": "$total"}}},
            ]
            got = await coll.aggregate(pipeline).to_list(None)
            exp = aggregate_rows(raw, pipeline)
            assert sorted(got, key=lambda row: str(row.get("_id"))) == sorted(exp, key=lambda row: str(row.get("_id")))
            owned = []
            for doc in raw:
                owner = str(doc.get("company_id") or CO)
                if storage_router.canonical_company_id(owner) == CO:
                    owned.append(doc)
            page, _cursor, more = await coll.changed_since(None, company_id=CO, limit=10)
            window, _wcursor, wmore = changed_window(owned, None, 10)
            assert [doc["_id"] for doc in page] == [doc["_id"] for doc in window]
            assert more is wmore
            assert "d" in [doc["_id"] for doc in page]
            assert "c" not in [doc["_id"] for doc in page]

        asyncio.run(run())
    finally:
        tenant_scope.set_mode(previous)
        storage_dedicated.reset_pools()
        storage_router.reset()


def test_worker_lease_is_single_leader(monkeypatch):
    source = __import__("inspect").getsource(storage_admin.worker)
    assert "try_acquire" in source
    assert "claim_next" in source
    assert "execute" in source
    board = {"owner": None}

    class DB:
        _pool = object()

    async def fake_acquire(_db, name, owner, ttl_s=60):
        assert name == storage_admin._WORKER_LEASE
        if board["owner"] in (None, owner):
            board["owner"] = owner
            return True
        return False

    async def fake_release(_db, name, owner):
        if board["owner"] == owner:
            board["owner"] = None

    monkeypatch.setattr("platform_lease.try_acquire", fake_acquire)
    monkeypatch.setattr("platform_lease.release", fake_release)
    first = storage_admin._StoreLease(DB())
    second = storage_admin._StoreLease(DB())

    async def run():
        assert await first.try_acquire(storage_admin._WORKER_LEASE, "worker-a") is True
        assert await second.try_acquire(storage_admin._WORKER_LEASE, "worker-b") is False
        await first.release(storage_admin._WORKER_LEASE, "worker-a")
        assert await second.try_acquire(storage_admin._WORKER_LEASE, "worker-b") is True
        await second.release(storage_admin._WORKER_LEASE, "worker-b")
        opened = storage_admin._StoreLease(MemDB())
        assert await opened.try_acquire(storage_admin._WORKER_LEASE, "mem") is True

    asyncio.run(run())


def test_worker_on_memory_catalog_still_runs():
    storage_admin._worker_guard = False

    async def run():
        assert await storage_admin.worker(MemDB()) == 0

    try:
        asyncio.run(run())
    finally:
        storage_admin._worker_guard = False


def test_hot_cache_drops_on_write(monkeypatch):
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "")
    monkeypatch.setenv("HOT_DOC_CACHE_TTL", "5")
    clear_hot_cache()
    calls = {"n": 0}

    class DB:
        _indexes = {}

    coll = MySQLCollection(DB(), "companies")

    async def fake_fetch(_sql, _params):
        calls["n"] += 1
        name = "Ada" if calls["n"] == 1 else "Bora"
        return [(dumps({"_id": "c1", "name": name, "city": "Ankara"}),)]

    coll._fetch_rows = fake_fetch

    async def run():
        first = await coll.find_one({"_id": "c1"}, {"name": 1})
        second = await coll.find_one({"_id": "c1"})
        assert first["name"] == "Ada"
        assert "city" not in first
        assert second["name"] == "Ada"
        assert second["city"] == "Ankara"
        assert calls["n"] == 1
        note_hot_write("companies", "c1")
        third = await coll.find_one({"_id": "c1"})
        assert third["name"] == "Bora"
        assert calls["n"] == 2
        note_hot_write("companies", "c1")
        monkeypatch.setenv("HOT_DOC_CACHE_TTL", "0.05")
        await coll.find_one({"_id": "c1"})
        await asyncio.sleep(0.08)
        await coll.find_one({"_id": "c1"})
        assert calls["n"] == 4

    try:
        asyncio.run(run())
    finally:
        clear_hot_cache()


def test_heavy_match_leaves_the_event_loop(monkeypatch):
    holder = {}
    stamps = {}
    main = threading.get_ident()
    seen = []

    def busy(docs, query):
        seen.append(threading.get_ident())
        stamps["start"] = time.perf_counter()
        holder["loop"].call_soon_threadsafe(holder["gate"].set)
        deadline = time.perf_counter() + 0.45
        while time.perf_counter() < deadline:
            pass
        return [doc for doc in docs if match_query(doc, query)]

    monkeypatch.setattr("mysql_store._filter_docs", busy)
    docs = [{"_id": str(i), "name": "x"} for i in range(40)]

    async def waiter():
        await holder["gate"].wait()
        await asyncio.sleep(0)
        stamps["ran"] = time.perf_counter()

    async def run():
        holder["loop"] = asyncio.get_running_loop()
        holder["gate"] = asyncio.Event()
        task = asyncio.create_task(waiter())
        await asyncio.sleep(0)
        found = await filter_matching(docs, {"name": "x"})
        await task
        assert len(found) == 40

    asyncio.run(run())
    assert seen and seen[0] != main
    assert stamps["ran"] - stamps["start"] < 0.2


def test_slow_sql_log_splits_time_and_hides_vkn(monkeypatch):
    captured = {}

    def capture(op, collection, doc_id=None, duration_ms=0, **fields):
        captured["op"] = op
        captured["collection"] = collection
        captured["duration_ms"] = duration_ms
        captured["fields"] = fields

    monkeypatch.setattr("applog.log_sql", capture)
    import applog

    token = applog._sql_endpoint.set("GET /api/companies/12345678901")
    try:
        import mysql_store

        mysql_store._SQL_SLOT.set({
            "collection": "companies",
            "acquire_ms": 11.0,
            "query_ms": 1.5,
            "mark": time.perf_counter() - 0.25,
        })
        mysql_store._emit_sql_slot(0)
    finally:
        applog._sql_endpoint.reset(token)
        import mysql_store

        mysql_store._SQL_SLOT.set(None)
    assert captured["op"] == "SELECT"
    fields = captured["fields"]
    assert fields["acquire_ms"] == 11.0
    assert fields["query_ms"] == 1.5
    assert fields["process_ms"] >= 200
    assert "12345678901" not in fields["caller"]
    assert "test_event_loop_hotpath" in fields["caller"]
    blob = json.dumps(fields)
    assert "12345678901" not in blob
