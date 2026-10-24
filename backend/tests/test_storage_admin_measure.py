"""Periyodik hacim ölçümü satır çekmez. Taşıma checksum'u tam okur.

Canlı veritabanına ve 8021 portuna bağlanmaz.
"""
from __future__ import annotations

import asyncio
import inspect
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from cryptography.fernet import Fernet
from fastapi import FastAPI
from fastapi.testclient import TestClient

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(Path(__file__).resolve().parent))

os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")
os.environ["STORAGE_ADMIN_AUTO_KICK"] = "0"

from dashboard_memdb import MemDB  # noqa: E402

import saas  # noqa: E402
import scripts.storage_move as storage_move  # noqa: E402
import storage_admin  # noqa: E402
import storage_dedicated  # noqa: E402
import storage_router  # noqa: E402
import storage_shared_v2  # noqa: E402
from storage_dedicated import DedicatedCollection  # noqa: E402
from storage_migrations.engine import apply  # noqa: E402
from storage_migrations.session import connect  # noqa: E402

CID = "comp_9039c0ec"
NOW = datetime(2026, 10, 24, 12, 0, tzinfo=timezone.utc)


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture(autouse=True)
def _quiet(monkeypatch):
    monkeypatch.setenv("STORAGE_ADMIN_AUTO_KICK", "0")
    monkeypatch.delenv("STORAGE_DBA_DSN", raising=False)
    monkeypatch.delenv("STORAGE_ROUTER_ENABLED", raising=False)
    storage_admin._measure_not_before = None
    storage_admin._worker_guard = False
    yield
    storage_admin._measure_not_before = None
    storage_admin._worker_guard = False
    storage_router.reset()
    storage_dedicated.reset_pools()
    storage_shared_v2.reset_store()


def _migrate(dsn):
    session = connect(dsn, write=True)
    try:
        apply(session, confirm=True, dry_run=False)
    finally:
        session.close()


def _seal(monkeypatch, tmp_path):
    monkeypatch.setenv("CREDENTIAL_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    import comm_service

    comm_service.reset_fernet_for_tests()


def _company(mode="legacy", **extra):
    body = {"_id": CID, "name": "Ersay", "storage_mode": mode}
    body.update(extra)
    return body


def test_measure_docs_stays_a_full_read():
    text = inspect.getsource(storage_move._measure_docs)
    assert "COUNT(*)" not in text
    assert "measure_volume" not in text
    inspect_src = inspect.getsource(storage_move._inspect)
    assert "measure_collection" not in inspect_src
    assert "_read(" in inspect_src
    assert "_prepare_with_stats" in inspect_src

    async def _case():
        docs = [{"_id": "a", "company_id": CID, "name": "Kalem"}]
        count, nbytes = await storage_move._measure_docs(docs, CID, "orders")
        assert count == 1
        assert nbytes == storage_move._bytes(storage_move._prepare_many(docs, CID, "orders"))

    _run(_case())


def test_dedicated_measure_volume_uses_count_not_documents(tmp_path):
    dsn = f"sqlite:///{tmp_path / 'ersay.db'}"
    _migrate(dsn)
    coll = DedicatedCollection(CID, "sync_tombstones", dsn)
    sqls = []
    real = DedicatedCollection._fetch_sql

    def wrap(self, session, sql, args):
        sqls.append(str(sql))
        return real(self, session, sql, args)

    coll._fetch_sql = wrap.__get__(coll, DedicatedCollection)

    async def _case():
        for index in range(5):
            await coll.insert_one({
                "_id": f"t{index}",
                "company_id": CID,
                "doc_id": f"d{index}",
                "deleted_at": "2026-10-01T00:00:00+00:00",
            })
        count, nbytes = await coll.measure_volume(CID, with_bytes=True)
        assert count == 5
        assert nbytes > 0
        light, skipped = await coll.measure_volume(CID, with_bytes=False)
        assert light == 5
        assert skipped == 0

    _run(_case())
    assert sqls
    assert all("COUNT(*)" in sql for sql in sqls)
    assert any("SUM(LENGTH(doc))" in sql for sql in sqls)
    assert all("SELECT doc" not in sql for sql in sqls)
    assert sqls[-1].startswith("SELECT COUNT(*) FROM storage_records")
    assert "SUM(LENGTH" not in sqls[-1]


def test_dedicated_mysql_measure_leaves_the_event_loop(monkeypatch):
    seen = {}

    async def fake_blocking(fn, *args, **kwargs):
        seen["fn"] = fn
        seen["args"] = args
        return (180506, 4096)

    monkeypatch.setattr("platform_lease.call_blocking", fake_blocking)
    coll = DedicatedCollection(CID, "sync_tombstones", "mysql://u@127.0.0.1/unused")

    async def _case():
        assert await coll.measure_volume(CID, with_bytes=True) == (180506, 4096)

    _run(_case())
    assert seen["fn"] == coll._run
    assert seen["args"]


def test_mysql_measure_volume_sql_shape():
    import mysql_store

    coll = mysql_store.MySQLCollection.__new__(mysql_store.MySQLCollection)
    coll.name = "sync_tombstones"
    coll.queries = []

    async def _fetch(sql, params):
        coll.queries.append((sql, list(params)))
        return [(180506, 8192)]

    coll._fetch_rows = _fetch

    async def _case():
        assert await coll.measure_volume(CID, with_bytes=True) == (180506, 8192)
        assert await coll.measure_volume(CID, with_bytes=False) == (180506, 0)

    _run(_case())
    full, probe = coll.queries
    assert "COUNT(*)" in full[0]
    assert "SUM(LENGTH(doc))" in full[0]
    assert "SELECT doc" not in full[0]
    assert full[1] == ["sync_tombstones", CID]
    assert probe[0].startswith("SELECT COUNT(*)")
    assert "SUM(LENGTH" not in probe[0]
    assert "SELECT doc" not in probe[0]


def test_shared_measure_volume_does_not_load_docs(tmp_path):
    import sqlite3

    from storage_migrations.session import Session

    connection = sqlite3.connect(tmp_path / "shared.db")
    try:
        apply(Session(connection, "sqlite", read_only=False), confirm=True, dry_run=False)
        storage_shared_v2.bind_sqlite(connection)
        coll = storage_shared_v2.collection_for(CID, "sync_tombstones")

        async def _case():
            await coll.insert_one({"_id": "t1", "company_id": CID, "doc_id": "d1"})
            store = storage_shared_v2.get_store()
            before = store.docs_loaded
            count, nbytes = await coll.measure_volume(CID, with_bytes=True)
            assert count == 1
            assert nbytes > 0
            assert store.docs_loaded == before
            counts = [sql for sql in store.statements if "COUNT(*)" in sql]
            assert counts
            assert all("SELECT doc" not in sql for sql in counts)
            assert "SUM(LENGTH(doc))" in counts[-1]

        _run(_case())
    finally:
        connection.close()


def test_legacy_volume_names_lists_collections_without_documents():
    class Coll:
        def __init__(self):
            self.sql = []

        async def _fetch_rows(self, sql, params):
            self.sql.append((sql, list(params)))
            return [("sync_tombstones",), ("orders",)]

    class DB:
        def __init__(self):
            self.coll = Coll()

        def __getitem__(self, name):
            return self.coll

    db = DB()

    async def _case():
        names = await storage_move.volume_names(db, "legacy", CID, {})
        assert names == ["orders", "sync_tombstones"]

    _run(_case())
    sql, params = db.coll.sql[0]
    assert "DISTINCT collection" in sql
    assert "SELECT doc" not in sql
    assert params == [CID]


def test_read_volume_does_not_fetch_rows_when_sql_counts(monkeypatch):
    calls = []

    async def names(*_args, **_kwargs):
        return ["orders", "sync_tombstones"]

    async def measure(_db, _mode, _cid, name, _company, *, with_bytes=True):
        calls.append((name, with_bytes))
        if name == "sync_tombstones":
            return (180506, 9000 if with_bytes else 0)
        return (3, 40 if with_bytes else 0)

    async def full_read(*_args, **_kwargs):
        raise AssertionError("ölçüm satır çekti")

    monkeypatch.setattr(storage_move, "volume_names", names)
    monkeypatch.setattr(storage_move, "measure_collection", measure)
    monkeypatch.setattr(storage_move, "_read", full_read)

    async def _case():
        db = MemDB()
        volume = await storage_admin.read_volume(db, _company())
        assert volume["error"] == ""
        assert {row["name"]: row["count"] for row in volume["collections"]} == {
            "orders": 3,
            "sync_tombstones": 180506,
        }
        assert sum(row["bytes"] for row in volume["collections"]) == 9040

    _run(_case())
    assert calls == [("orders", True), ("sync_tombstones", True)]


def test_sql_error_does_not_fall_back_to_a_full_read(monkeypatch):
    async def names(*_args, **_kwargs):
        return ["sync_tombstones"]

    async def measure(*_args, **_kwargs):
        raise RuntimeError("sayım koptu")

    async def full_read(*_args, **_kwargs):
        raise AssertionError("ölçüm satır çekti")

    monkeypatch.setattr(storage_move, "volume_names", names)
    monkeypatch.setattr(storage_move, "measure_collection", measure)
    monkeypatch.setattr(storage_move, "_read", full_read)

    async def _case():
        volume = await storage_admin.read_volume(MemDB(), _company())
        assert volume["collections"] == []
        assert volume["error"]

    _run(_case())


def test_small_change_reuses_bytes_and_large_change_sums(monkeypatch):
    calls = []

    async def names(*_args, **_kwargs):
        return ["sync_tombstones"]

    async def measure(_db, _mode, _cid, name, _company, *, with_bytes=True):
        calls.append(with_bytes)
        if with_bytes:
            return (200000, 7777)
        return (180520, 0)

    monkeypatch.setattr(storage_move, "volume_names", names)
    monkeypatch.setattr(storage_move, "measure_collection", measure)

    async def _case():
        db = MemDB()
        await db.companies.insert_one(_company())
        await db[storage_admin.SUMMARIES].insert_one({
            "_id": CID,
            "company_id": CID,
            "measured_at": "2020-01-01T00:00:00+00:00",
            "records": 180506,
            "bytes": 5000,
            "collections": [{"name": "sync_tombstones", "count": 180506, "bytes": 5000}],
        })
        thresholds = dict(storage_admin.DEFAULT_THRESHOLDS)
        small = await storage_admin.measure_company(db, _company(), thresholds, today="2026-10-24", now=NOW)
        assert small["records"] == 180520
        assert small["bytes"] == 5000
        assert calls == [False]
        calls.clear()

        await db[storage_admin.SUMMARIES].update_one(
            {"_id": CID},
            {"$set": {
                "measured_at": "2020-01-01T00:00:00+00:00",
                "collections": [{"name": "sync_tombstones", "count": 180506, "bytes": 5000}],
            }},
        )

        async def grown(_db, _mode, _cid, name, _company, *, with_bytes=True):
            calls.append(with_bytes)
            return (200000, 7777 if with_bytes else 0)

        monkeypatch.setattr(storage_move, "measure_collection", grown)
        large = await storage_admin.measure_company(db, _company(), thresholds, today="2026-10-24", now=NOW)
        assert large["records"] == 200000
        assert large["bytes"] == 7777
        assert calls == [False, True]

    _run(_case())


def test_fresh_summary_is_cached_until_forced(monkeypatch):
    calls = []

    async def names(*_args, **_kwargs):
        return ["orders"]

    async def measure(*_args, **kwargs):
        calls.append(kwargs.get("with_bytes"))
        return (1, 1)

    monkeypatch.setattr(storage_move, "volume_names", names)
    monkeypatch.setattr(storage_move, "measure_collection", measure)

    async def _case():
        db = MemDB()
        await db.companies.insert_one(_company())
        await db[storage_admin.SUMMARIES].insert_one({
            "_id": CID,
            "measured_at": NOW.isoformat(),
            "records": 10,
            "bytes": 20,
            "collections": [{"name": "orders", "count": 10, "bytes": 20}],
        })
        thresholds = dict(storage_admin.DEFAULT_THRESHOLDS)
        cached = await storage_admin.measure_company(db, _company(), thresholds, now=NOW)
        assert cached["records"] == 10
        assert calls == []
        forced = await storage_admin.measure_now(db, company_id=CID, now=NOW)
        assert forced["companies"] == 1
        assert calls == [True]

    _run(_case())


def test_maybe_measure_waits_for_startup_and_interval(monkeypatch):
    calls = {"n": 0}

    async def fake_all(*_args, **_kwargs):
        calls["n"] += 1
        return {"measured_at": NOW.isoformat(), "companies": 1}

    monkeypatch.setattr(storage_admin, "measure_all", fake_all)

    async def _case():
        db = MemDB()
        storage_admin.arm_measure_delay(NOW)
        assert await storage_admin.maybe_measure(db, now=NOW + timedelta(seconds=30)) is False
        assert calls["n"] == 0
        opened = NOW + timedelta(seconds=storage_admin.measure_start_delay() + 1)
        assert await storage_admin.maybe_measure(db, now=opened) is True
        assert calls["n"] == 1
        assert await storage_admin.maybe_measure(db, now=opened + timedelta(minutes=5)) is False
        assert calls["n"] == 1
        later = opened + timedelta(seconds=storage_admin.measure_seconds() + 1)
        assert await storage_admin.maybe_measure(db, now=later) is True
        assert calls["n"] == 2

    _run(_case())
    assert "arm_measure_delay" in inspect.getsource(storage_admin.scheduler_loop)


def test_failed_measure_does_not_retry_every_tick(monkeypatch):
    calls = {"n": 0}

    async def boom(*_args, **_kwargs):
        calls["n"] += 1
        raise RuntimeError("kopuk")

    monkeypatch.setattr(storage_admin, "measure_all", boom)

    async def _case():
        db = MemDB()
        assert await storage_admin.maybe_measure(db, now=NOW) is False
        assert await storage_admin.maybe_measure(db, now=NOW + timedelta(seconds=90)) is False
        assert calls["n"] == 1
        meta = await db[storage_admin.SETTINGS].find_one({"_id": storage_admin.META_ID})
        assert meta["measured_at"]

    _run(_case())


def test_dedicated_read_volume_counts_tombstones(monkeypatch, tmp_path):
    _seal(monkeypatch, tmp_path)
    path = tmp_path / "ersay.db"
    dsn = f"sqlite:///{path}"
    _migrate(dsn)
    sqls = []
    real = DedicatedCollection._fetch_sql

    def wrap(self, session, sql, args):
        sqls.append(str(sql))
        return real(self, session, sql, args)

    monkeypatch.setattr(DedicatedCollection, "_fetch_sql", wrap)

    async def full_read(*_args, **_kwargs):
        raise AssertionError("ölçüm satır çekti")

    async def _seed():
        coll = DedicatedCollection(CID, "sync_tombstones", dsn)
        for index in range(4):
            await coll.insert_one({
                "_id": f"t{index}",
                "company_id": CID,
                "doc_id": f"d{index}",
                "deleted_at": "2026-10-01T00:00:00+00:00",
            })

    _run(_seed())
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    monkeypatch.setattr(storage_move, "_read", full_read)

    async def _case():
        db = MemDB()
        sealed = storage_router.seal_dedicated_dsn(dsn)
        company = _company("dedicated", dedicated_dsn_ref=sealed)
        await db.companies.insert_one(company)
        volume = await storage_admin.read_volume(db, company)
        assert volume["error"] == ""
        assert volume["read_mode"] == "dedicated"
        tombs = next(row for row in volume["collections"] if row["name"] == "sync_tombstones")
        assert tombs["count"] == 4
        assert tombs["bytes"] > 0

    _run(_case())
    assert sqls
    assert all("COUNT(*)" in sql for sql in sqls)
    assert all("SELECT doc" not in sql for sql in sqls)


def test_measure_endpoint_requires_super_admin():
    db = MemDB()
    storage_admin.init(db)
    saas._db = db
    app = FastAPI()
    app.include_router(storage_admin.router)
    client = TestClient(app)
    missing = client.post("/api/system/storage-admin/measure")
    assert missing.status_code == 401
