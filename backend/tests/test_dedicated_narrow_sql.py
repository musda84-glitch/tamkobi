"""Dedicated find süzgeci SQL'e iner ve Python match_query ile aynı kümeyi verir.

Canlı veritabanına bağlanmaz. Mezar taşı sayfası since öncesini okumaz.
"""
from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

import data_sync  # noqa: E402
import storage_dedicated  # noqa: E402
import tenant_scope  # noqa: E402
import tombstone_retention  # noqa: E402
from mysql_store import match_query, newest_first  # noqa: E402
from storage_dedicated import DedicatedCollection  # noqa: E402
from storage_migrations.engine import apply  # noqa: E402
from storage_migrations.session import connect  # noqa: E402

CO = "co_narrow"
SINCE = "2026-10-20T00:00:00+00:00"


@pytest.fixture(autouse=True)
def _quiet():
    previous = tenant_scope.set_mode("off")
    storage_dedicated.reset_pools()
    prior_db = data_sync._db
    yield
    data_sync._db = prior_db
    tenant_scope.set_mode(previous)
    storage_dedicated.reset_pools()


def _run(coro):
    return asyncio.run(coro)


def _migrate(dsn: str) -> None:
    session = connect(dsn, write=True)
    try:
        apply(session, confirm=True, dry_run=False)
    finally:
        session.close()


def _dsn(tmp_path, name="narrow.db") -> str:
    path = tmp_path / name
    dsn = f"sqlite:///{path}"
    _migrate(dsn)
    return dsn


def _raw(path: Path, collection: str) -> list:
    conn = sqlite3.connect(path)
    try:
        rows = conn.execute(
            "SELECT doc FROM storage_records WHERE collection = ?",
            (collection,),
        ).fetchall()
    finally:
        conn.close()
    return [json.loads(row[0]) for row in rows]


def _ids(docs) -> list:
    return sorted(str(doc.get("_id")) for doc in docs)


def _python(docs, query) -> list:
    return [doc for doc in docs if match_query(doc, query)]


_FIXTURE = [
    {
        "_id": "s1", "company_id": CO, "status": "open", "collection": "invoices",
        "deleted_at": "2026-10-01T00:00:00+00:00", "tags": ["red", "blue"],
        "n": 3, "flag": True, "note": "Alpha",
    },
    {
        "_id": "s2", "company_id": CO, "status": "closed", "collection": "orders",
        "deleted_at": "2026-10-20T00:00:00+00:00", "tags": "red",
        "n": "3", "flag": False, "note": "alpha",
    },
    {
        "_id": "s3", "company_id": "other", "status": "open",
        "deleted_at": "2026-10-20T00:00:00+00:00",
    },
    {"_id": "s4", "company_id": CO, "status": None, "deleted_at": None},
    {
        "_id": "s5", "company_id": CO,
        "deleted_at": "2026-09-01T00:00:00+00:00",
        "tags": [["red"], "blue"],
    },
    {
        "_id": "s6", "company_id": CO, "status": ["open", "late"],
        "deleted_at": 20261021, "tags": [1, "red"],
    },
    {
        "_id": "s7", "company_id": CO, "status": "Open",
        "deleted_at": True, "obj": {"a": 1},
    },
    {
        "_id": "s8", "company_id": CO, "status": "open",
        "deleted_at": ["2026-12-01T00:00:00+00:00"],
    },
    {"_id": "s9", "company_id": CO, "deleted_at": {"d": "2026-12-01"}, "note": ""},
    {"_id": "s10", "company_id": CO, "status": "open", "nested": {"status": "closed"}},
]


_QUERIES = [
    {"company_id": CO, "status": "open"},
    {"company_id": CO, "status": {"$in": ["open", "closed"]}},
    {"company_id": CO, "status": {"$eq": "closed"}},
    {"company_id": CO, "deleted_at": {"$gte": "2026-10-01T00:00:00+00:00"}},
    {"company_id": CO, "deleted_at": {"$gt": "2026-10-01T00:00:00+00:00"}},
    {"company_id": CO, "deleted_at": {"$lt": "2026-10-15T00:00:00+00:00"}},
    {"company_id": CO, "deleted_at": {"$lte": "2026-10-01T00:00:00+00:00"}},
    {"company_id": CO, "deleted_at": {"$gte": "2026-10-01T00:00:00+00:00", "$lt": "2026-11-01T00:00:00+00:00"}},
    {"_id": "s2"},
    {"_id": {"$in": ["s1", "s9"]}},
    {"_id": {"$in": []}},
    {"company_id": CO, "tags": "red"},
    {"company_id": CO, "note": "Alpha"},
    {"company_id": CO, "note": "alpha"},
    {"company_id": CO, "n": 3},
    {"company_id": CO, "flag": True},
    {"status": None},
    {"$or": [{"status": "closed"}, {"note": "Alpha"}], "company_id": CO},
    {"company_id": CO, "nested.status": "closed"},
    {"company_id": CO, "collection": "invoices", "deleted_at": {"$gte": "2026-10-01T00:00:00+00:00"}},
    {"company_id": "missing"},
    {"company_id": CO, "external_id": "e1"},
    {},
]


def test_find_matches_python_filter(tmp_path):
    dsn = _dsn(tmp_path)
    path = tmp_path / "narrow.db"
    coll = DedicatedCollection(CO, "invoices", dsn)

    async def run():
        for doc in _FIXTURE:
            await coll.insert_one(dict(doc))
        raw = _raw(path, "invoices")
        assert len(raw) == len(_FIXTURE)
        for query in _QUERIES:
            found = await coll.find(query).to_list(None)
            expect = _python(raw, query)
            assert _ids(found) == _ids(expect), query
            assert await coll.count_documents(query) == len(expect), query
            ordered = newest_first(expect)
            assert [doc["_id"] for doc in found] == [doc["_id"] for doc in ordered]
        updated = await coll.update_one(
            {"company_id": CO, "status": "closed"},
            {"$set": {"touched": 1}},
        )
        assert updated.matched_count == 1
        closed = await coll.find_one({"_id": "s2"})
        assert closed["touched"] == 1

    _run(run())


def test_mysql_narrow_sql_pushes_tombstone_predicates():
    coll = DedicatedCollection(CO, "sync_tombstones", "mysql://u@127.0.0.1/unused")
    sql, args = coll._narrow_sql({
        "collection": "invoices",
        "company_id": CO,
        "deleted_at": {"$gte": SINCE},
        "external_id": "e1",
    })
    assert "company_id = ?" in sql
    assert "JSON_UNQUOTE(JSON_EXTRACT(doc, '$.deleted_at'))" in sql
    assert "JSON_UNQUOTE(JSON_EXTRACT(doc, '$.collection')) = ?" in sql
    assert "JSON_UNQUOTE(JSON_EXTRACT(doc, '$.external_id')) = ?" in sql
    assert ">= ?" in sql
    assert CO in args
    assert "invoices" in args
    assert SINCE in args
    assert "LIMIT" not in sql


def test_since_cursor_excludes_older_tombstones(tmp_path):
    dsn = _dsn(tmp_path)
    coll = DedicatedCollection(CO, "sync_tombstones", dsn)

    async def run():
        rows = [
            ("old", "2026-10-19T23:59:59+00:00"),
            ("edge", SINCE),
            ("new", "2026-10-21T00:00:00+00:00"),
        ]
        for doc_id, stamp in rows:
            await coll.insert_one({
                "_id": f"tomb-{doc_id}",
                "collection": "invoices",
                "company_id": CO,
                "doc_id": doc_id,
                "deleted_at": stamp,
            })
        ids, more, cursor = await coll.deleted_since("invoices", CO, SINCE, 10)
        assert more is False
        assert cursor is None
        assert ids == ["edge", "new"]
        other, _more, _cursor = await coll.deleted_since("orders", CO, SINCE, 10)
        assert other == []

    _run(run())


def test_pagination_returns_every_tombstone(tmp_path):
    dsn = _dsn(tmp_path)
    coll = DedicatedCollection(CO, "sync_tombstones", dsn)
    stamps = [
        "2026-10-20T01:00:00+00:00",
        "2026-10-20T01:00:00+00:00",
        "2026-10-20T01:00:00+00:00",
        "2026-10-21T02:00:00+00:00",
        "2026-10-21T02:00:00+00:00",
        "2026-10-22T03:00:00+00:00",
    ]

    async def run():
        for index, stamp in enumerate(stamps):
            await coll.insert_one({
                "_id": f"tomb-{index}",
                "collection": "invoices",
                "company_id": CO,
                "doc_id": f"doc-{index}",
                "deleted_at": stamp,
            })
        seen = []
        cursor = SINCE
        more = True
        guard = 0
        while more and guard < 10:
            page, more, nxt = await coll.deleted_since("invoices", CO, cursor, 2)
            assert page
            seen.extend(page)
            if more:
                assert nxt and nxt > cursor
                cursor = nxt
            guard += 1
        assert sorted(seen) == [f"doc-{i}" for i in range(len(stamps))]
        assert len(seen) == len(set(seen))

    _run(run())


def test_sync_pages_do_not_drop_deletes(tmp_path):
    dsn = _dsn(tmp_path)
    invoices = DedicatedCollection(CO, "invoices", dsn)
    tombs = DedicatedCollection(CO, "sync_tombstones", dsn)

    class _DB:
        def __getitem__(self, name):
            return {"invoices": invoices, "sync_tombstones": tombs}[name]

        def __getattr__(self, name):
            if name.startswith("_"):
                raise AttributeError(name)
            return self[name]

    data_sync.init(_DB())
    anchor = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(days=2)
    since = anchor.isoformat()

    async def run():
        for index in range(7):
            stamp = (anchor + timedelta(hours=index + 1)).isoformat()
            await tombs.insert_one({
                "_id": f"tomb-{index}",
                "collection": "invoices",
                "company_id": CO,
                "doc_id": f"gone-{index}",
                "deleted_at": stamp,
            })
        await tombs.insert_one({
            "_id": "tomb-old",
            "collection": "invoices",
            "company_id": CO,
            "doc_id": "gone-old",
            "deleted_at": (anchor - timedelta(days=3)).isoformat(),
        })
        user = {"company_ids": [CO], "active_company_id": CO, "role": "admin"}
        seen = set()
        cursor = since
        more = True
        guard = 0
        while more and guard < 10:
            body = await data_sync.incremental_sync(
                company_id=CO,
                since=cursor,
                collections="invoices",
                limit=2,
                user=user,
            )
            assert body["full"] is False
            chunk = body["collections"]["invoices"]
            seen.update(chunk["deleted"])
            more = chunk["more"]
            assert "gone-old" not in chunk["deleted"]
            if more:
                assert chunk["cursor"] != cursor
                cursor = chunk["cursor"]
            guard += 1
        assert seen == {f"gone-{i}" for i in range(7)}
        assert guard > 1

    _run(run())


def test_tombstone_read_skips_old_rows(tmp_path):
    """Eski daraltma bütün şirketi okur. since süzgeci yalnız yeni satırları getirir."""
    dsn = _dsn(tmp_path)
    path = tmp_path / "narrow.db"
    session = connect(dsn, write=True)
    try:
        for index in range(400):
            doc = {
                "_id": f"old-{index}",
                "collection": "invoices",
                "company_id": CO,
                "doc_id": f"old-{index}",
                "deleted_at": "2026-09-01T00:00:00+00:00",
            }
            session.execute(
                "INSERT INTO storage_records (collection, doc_id, doc) VALUES (?, ?, ?)",
                ("sync_tombstones", doc["_id"], json.dumps(doc)),
            )
        for index in range(3):
            doc = {
                "_id": f"new-{index}",
                "collection": "invoices",
                "company_id": CO,
                "doc_id": f"new-{index}",
                "deleted_at": f"2026-10-2{index + 1}T00:00:00+00:00",
            }
            session.execute(
                "INSERT INTO storage_records (collection, doc_id, doc) VALUES (?, ?, ?)",
                ("sync_tombstones", doc["_id"], json.dumps(doc)),
            )
        session.commit()
    finally:
        session.close()
    conn = sqlite3.connect(path)
    try:
        old_rows = conn.execute(
            "SELECT doc FROM storage_records WHERE collection = ? AND company_id = ?",
            ("sync_tombstones", CO),
        ).fetchall()
    finally:
        conn.close()
    assert len(old_rows) == 403
    fetched = {"rows": 0, "sql": []}
    original = DedicatedCollection._fetch_sql

    def _wrap(self, db_session, sql, args):
        rows = original(self, db_session, sql, args)
        fetched["rows"] += len(rows)
        fetched["sql"].append(sql)
        return rows

    coll = DedicatedCollection(CO, "sync_tombstones", dsn)
    DedicatedCollection._fetch_sql = _wrap
    try:
        ids, more, _cursor = _run(coll.deleted_since("invoices", CO, SINCE, 50))
    finally:
        DedicatedCollection._fetch_sql = original
    assert more is False
    assert ids == ["new-0", "new-1", "new-2"]
    assert fetched["rows"] == 3
    assert any("LIMIT" in sql for sql in fetched["sql"])
    assert fetched["rows"] < len(old_rows)


def test_retention_report_is_dry_run(tmp_path):
    dsn = _dsn(tmp_path)
    path = tmp_path / "narrow.db"
    coll = DedicatedCollection(CO, "sync_tombstones", dsn)
    moment = datetime(2026, 10, 24, tzinfo=timezone.utc)

    class _DB:
        sync_tombstones = coll

    async def run():
        await coll.insert_one({
            "_id": "old",
            "collection": "invoices",
            "company_id": CO,
            "doc_id": "old-doc",
            "deleted_at": (moment - timedelta(days=40)).isoformat(),
        })
        await coll.insert_one({
            "_id": "new",
            "collection": "invoices",
            "company_id": CO,
            "doc_id": "new-doc",
            "deleted_at": (moment - timedelta(days=2)).isoformat(),
        })
        report = await tombstone_retention.report_tombstones(
            _DB(), older_than_days=30, company_id=CO, now=moment,
        )
        assert report["dry_run"] is True
        assert report["deleted"] == 0
        assert report["count"] == 1
        with pytest.raises(ValueError):
            await tombstone_retention.report_tombstones(_DB(), apply=True, now=moment)

    _run(run())
    conn = sqlite3.connect(path)
    try:
        left = conn.execute(
            "SELECT COUNT(*) FROM storage_records WHERE collection = ?",
            ("sync_tombstones",),
        ).fetchone()[0]
    finally:
        conn.close()
    assert left == 2


def test_mysql_reads_leave_the_event_loop(monkeypatch):
    called = []

    async def fake(fn, *args, **kwargs):
        called.append(fn)
        return []

    import platform_lease

    monkeypatch.setattr(platform_lease, "call_blocking", fake)
    coll = DedicatedCollection(CO, "sync_tombstones", "mysql://u@127.0.0.1/unused")

    async def run():
        await coll.find({"company_id": CO, "collection": "invoices"}).to_list(None)

    _run(run())
    assert called


def test_sqlite_reads_stay_on_the_caller(tmp_path, monkeypatch):
    called = []

    async def fake(fn, *args, **kwargs):
        called.append(fn)
        return []

    import platform_lease

    monkeypatch.setattr(platform_lease, "call_blocking", fake)
    dsn = _dsn(tmp_path, "stay.db")
    coll = DedicatedCollection(CO, "invoices", dsn)

    async def run():
        await coll.insert_one({"_id": "a", "company_id": CO, "status": "open"})
        found = await coll.find({"company_id": CO, "status": "open"}).to_list(None)
        assert [doc["_id"] for doc in found] == ["a"]

    _run(run())
    assert called == []
