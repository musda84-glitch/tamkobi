"""shared_v2 ile legacy sözleşme. Canlı veritabanına ve 8021 portuna bağlanmaz.

Geçici sqlite üzerinde aynı senaryo iki arka uçta aynı sonucu verir.
Pushdown sorgusu firma belgelerinin tamamını Python'a taşımaz.
"""
from __future__ import annotations

import asyncio
import copy
import json
import logging
import os
import re
import sqlite3
import sys
import threading
import time
from pathlib import Path

import pytest

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from dashboard_memdb import MemDB  # noqa: E402
from mysql_store import (  # noqa: E402
    DuplicateKeyError,
    aggregate_rows,
    apply_update,
    match_query,
    new_upsert_doc,
    project_doc,
    sort_docs,
    unique_conflict,
)
from tenant_scope import TenantScope  # noqa: E402
import storage_router  # noqa: E402
import storage_shared_v2  # noqa: E402
import tenant_db  # noqa: E402

MIGRATION = _BACKEND / "storage_migrations" / "migrations" / "0003_docs_v2.py"
_DOCS_WORD = re.compile(r"\bdocs\b", re.IGNORECASE)
_ALLOWED = re.compile(r"^(create|insert|alter)\b", re.IGNORECASE)
_FILE = re.compile(r"^(\d{4})_([a-z0-9_]+)\.(sql|py)$")
CO = "co"
OTHER = "co_b"


def _apply(conn):
    from storage_migrations.engine import apply
    from storage_migrations.session import Session

    apply(Session(conn, "sqlite", read_only=False), confirm=True, dry_run=False)


@pytest.fixture
def conn():
    storage_router.reset()
    storage_shared_v2.reset_store()
    connection = sqlite3.connect(":memory:", isolation_level=None)
    _apply(connection)
    storage_shared_v2.bind_sqlite(connection)
    yield connection
    storage_router.reset()
    storage_shared_v2.reset_store()
    connection.close()


def _shared(company_id=CO, name="invoices"):
    return storage_shared_v2.collection_for(company_id, name)


class _LegacyCursor:
    def __init__(self, coll, query, projection):
        self._coll = coll
        self._query = query or {}
        self._projection = projection
        self._sort = None
        self._limit = None
        self._skip = 0

    def sort(self, key, direction=1):
        self._sort = [(key, direction)] if isinstance(key, str) else key
        return self

    def limit(self, n):
        self._limit = n
        return self

    def skip(self, n):
        self._skip = n
        return self

    async def to_list(self, length=None):
        docs = [doc for doc in self._coll.docs if match_query(doc, self._query)]
        docs = sort_docs(docs, self._sort)
        if self._skip:
            docs = docs[self._skip:]
        if self._limit is not None:
            docs = docs[: self._limit]
        if length is not None:
            docs = docs[: int(length)]
        return [project_doc(doc, self._projection) if self._projection else copy.deepcopy(doc) for doc in docs]


class _Legacy:
    """mysql_store Python yolu. Tek firma, id sırasında ilk yazma eşleşmesi."""

    def __init__(self, name="invoices"):
        self.name = name
        self.docs = []
        self.indexes = []

    def find(self, query=None, projection=None):
        return _LegacyCursor(self, query, projection)

    async def find_one(self, query=None, projection=None, sort=None, skip=0):
        cursor = self.find(query, projection)
        if sort:
            cursor.sort(sort)
        cursor.skip(skip)
        cursor.limit(1)
        rows = await cursor.to_list(1)
        return rows[0] if rows else None

    async def count_documents(self, query=None):
        return sum(1 for doc in self.docs if match_query(doc, query or {}))

    async def distinct(self, key, query=None):
        from mysql_store import values_at
        seen = []
        for doc in self._by_id():
            if not match_query(doc, query or {}):
                continue
            for value in values_at(doc, key) or []:
                if value not in seen:
                    seen.append(value)
        return seen

    def aggregate(self, pipeline):
        coll = self
        stages = list(pipeline or [])

        class _Cursor:
            async def to_list(self, length=None):
                docs = coll._by_id()
                rows = aggregate_rows(docs, stages)
                if length is None:
                    return list(rows)
                return list(rows)[: int(length)]

        return _Cursor()

    async def insert_one(self, doc):
        body = copy.deepcopy(doc)
        self._unique(body, None)
        if any(str(item.get("_id")) == str(body.get("_id")) for item in self.docs):
            raise DuplicateKeyError("duplicate key")
        self.docs.append(body)
        return type("R", (), {"inserted_id": body.get("_id")})()

    async def update_one(self, query, update, upsert=False):
        for index, old in enumerate(self._by_id()):
            if not match_query(old, query or {}):
                continue
            new_doc = apply_update(old, update, query, is_insert=False)
            if new_doc == old:
                return _result(1, 0, None)
            self._unique(new_doc, old.get("_id"))
            self._replace(old.get("_id"), new_doc)
            return _result(1, 1, None)
        if not upsert:
            return _result(0, 0, None)
        created = new_upsert_doc(update, query)
        await self.insert_one(created)
        return _result(0, 1, created.get("_id"))

    async def delete_one(self, query):
        for old in self._by_id():
            if match_query(old, query or {}):
                self.docs = [doc for doc in self.docs if doc.get("_id") != old.get("_id")]
                return type("D", (), {"deleted_count": 1})()
        return type("D", (), {"deleted_count": 0})()

    async def delete_many(self, query):
        kept = []
        removed = 0
        for doc in self.docs:
            if match_query(doc, query or {}):
                removed += 1
            else:
                kept.append(doc)
        self.docs = kept
        return type("D", (), {"deleted_count": removed})()

    async def create_index(self, keys, unique=False, **kwargs):
        if isinstance(keys, str):
            fields = (keys,)
        else:
            fields = tuple(item[0] if isinstance(item, (list, tuple)) else item for item in keys)
        partial = kwargs.get("partialFilterExpression")
        spec = (fields, bool(unique), partial) if partial else (fields, bool(unique))
        if spec not in self.indexes:
            self.indexes.append(spec)
        return "_".join(fields)

    def _by_id(self):
        return sorted(self.docs, key=lambda doc: str(doc.get("_id")))

    def _replace(self, doc_id, new_doc):
        self.docs = [new_doc if doc.get("_id") == doc_id else doc for doc in self.docs]

    def _unique(self, doc, exclude_id):
        others = [
            item for item in self.docs
            if str(item.get("_id")) != str(exclude_id) and str(item.get("_id")) != str(doc.get("_id"))
        ]
        try:
            unique_conflict(doc, others, self.indexes, self.name)
        except DuplicateKeyError:
            raise DuplicateKeyError("duplicate key") from None


def _result(matched, modified, upserted):
    return type("U", (), {
        "matched_count": matched,
        "modified_count": modified,
        "upserted_id": upserted,
    })()


def _upd(result):
    return (result.matched_count, result.modified_count, result.upserted_id)


async def _exercise(api):
    await api.create_index("invoice_number", unique=True)
    rows = [
        {"_id": "a", "company_id": CO, "status": "open", "invoice_number": "A-1",
         "created_at": "2024-01-01", "date": "2024-01-01", "contact_id": "c1", "note": "bir", "qty": 1},
        {"_id": "c", "company_id": CO, "status": "open", "invoice_number": "C-1",
         "created_at": "2024-03-01", "date": "2024-03-01", "contact_id": "c2", "note": "uc", "qty": 2},
        {"_id": "b", "company_id": CO, "status": "closed", "invoice_number": "B-1",
         "created_at": "2024-03-01", "date": "2024-02-01", "contact_id": "c1", "note": "iki", "qty": 4},
        {"_id": "d", "company_id": CO, "status": "draft", "invoice_number": "D-1",
         "created_at": "2024-04-01", "date": None, "contact_id": "c3", "qty": 1},
        {"_id": "e", "company_id": CO, "status": "open", "invoice_number": "E-1",
         "created_at": "2024-05-01", "contact_id": "c2", "note": "bes", "qty": 3, "rank": "2"},
        {"_id": "f", "company_id": CO, "invoice_number": "F-1",
         "created_at": "2024-05-02", "date": "2024-05-02", "contact_id": "c9", "rank": None, "qty": 1},
    ]
    for row in rows:
        await api.insert_one(row)
    out = {}
    out["newest"] = [doc["_id"] for doc in await api.find({"company_id": CO}).to_list(None)]
    out["page"] = [
        doc["_id"] for doc in await api.find({"status": "open"}).sort("created_at", -1).skip(1).limit(1).to_list(10)
    ]
    out["eq"] = [doc["_id"] for doc in await api.find({"contact_id": "c1"}).sort("_id", 1).to_list(20)]
    out["inn"] = sorted(doc["_id"] for doc in await api.find({"status": {"$in": ["open", "draft"]}}).to_list(20))
    out["nin"] = sorted(doc["_id"] for doc in await api.find({"status": {"$nin": ["open"]}}).to_list(20))
    out["ne"] = sorted(doc["_id"] for doc in await api.find({"status": {"$ne": "open"}}).to_list(20))
    out["range"] = sorted(
        doc["_id"] for doc in await api.find(
            {"$and": [{"date": {"$gte": "2024-02-01"}}, {"date": {"$lt": "2024-05-01"}}]}
        ).to_list(20)
    )
    out["before"] = sorted(doc["_id"] for doc in await api.find({"date": {"$lt": "2024-03-01"}}).to_list(20))
    out["after"] = sorted(doc["_id"] for doc in await api.find({"date": {"$gt": "2024-03-01"}}).to_list(20))
    out["prefix"] = sorted(doc["_id"] for doc in await api.find({"invoice_number": {"$regex": "^A-"}}).to_list(20))
    out["exists"] = sorted(doc["_id"] for doc in await api.find({"note": {"$exists": True}}).to_list(20))
    out["missing"] = sorted(doc["_id"] for doc in await api.find({"note": {"$exists": False}}).to_list(20))
    out["null_date"] = sorted(doc["_id"] for doc in await api.find({"date": None}).to_list(20))
    out["or"] = sorted(
        doc["_id"] for doc in await api.find({"$or": [{"status": "draft"}, {"contact_id": "c9"}]}).to_list(20)
    )
    out["count"] = await api.count_documents({"status": "open"})
    out["count_all"] = await api.count_documents({})
    one = await api.find_one({"invoice_number": "B-1"})
    out["one"] = one["_id"] if one else None
    projected = await api.find_one({"_id": "a"}, {"status": 1, "invoice_number": 1})
    out["project"] = projected
    hidden = await api.find_one({"_id": "a"}, {"note": 0})
    out["hidden_note"] = "note" in (hidden or {})
    out["tie"] = [
        doc["_id"] for doc in await api.find({"created_at": "2024-03-01"}).sort([("status", 1), ("rank", -1)]).to_list(10)
    ]
    ranked = await api.find({"invoice_number": {"$in": ["E-1", "F-1"]}}).sort([("rank", -1), ("_id", 1)]).to_list(10)
    out["rank"] = [doc["_id"] for doc in ranked]
    grouped = await api.aggregate([
        {"$match": {"status": "open"}},
        {"$group": {"_id": "$contact_id", "n": {"$sum": "$qty"}}},
    ]).to_list(None)
    out["group"] = sorted((row.get("_id"), row.get("n")) for row in grouped)
    out["distinct"] = await api.distinct("contact_id", {"status": "open"})
    updated = await api.update_one({"_id": "a"}, {"$set": {"status": "paid"}, "$inc": {"qty": 1}})
    out["update"] = _upd(updated)
    same = await api.update_one({"_id": "a"}, {"$set": {"status": "paid"}})
    out["same"] = _upd(same)
    upserted = await api.update_one(
        {"_id": "z", "company_id": CO},
        {"$setOnInsert": {"invoice_number": "Z-1", "status": "open", "created_at": "2024-06-01", "qty": 1}},
        upsert=True,
    )
    out["upsert"] = _upd(upserted)
    out["upserted"] = (await api.find_one({"_id": "z"}))["invoice_number"]
    try:
        await api.insert_one({
            "_id": "dup", "company_id": CO, "invoice_number": "A-1", "status": "open", "created_at": "2024-01-02",
        })
        out["dup"] = "allowed"
    except DuplicateKeyError:
        out["dup"] = "rejected"
    multi = await api.find({"date": {"$gte": "2024-01-01", "$lt": "2024-02-01"}}).sort("_id", 1).to_list(20)
    out["multi"] = [doc["_id"] for doc in multi]
    removed = await api.delete_one({"status": "draft"})
    out["delete_one"] = removed.deleted_count
    out["draft_left"] = await api.count_documents({"status": "draft"})
    many = await api.delete_many({"contact_id": "c9"})
    out["delete_many"] = many.deleted_count
    out["left"] = await api.count_documents({})
    return out


def test_migration_contract_and_no_startup_create():
    from storage_migrations.loader import load_migrations

    assert _FILE.match(MIGRATION.name)
    version, name, suffix = _FILE.match(MIGRATION.name).groups()
    assert version == "0003"
    assert name == "docs_v2"
    assert suffix == "py"
    mig = next(item for item in load_migrations() if item.version == 3)
    assert mig.mysql_steps
    for step in mig.steps + mig.mysql_steps:
        assert _ALLOWED.match(step)
        assert _DOCS_WORD.search(step) is None
    sqlite_blob = "\n".join(mig.steps)
    mysql_blob = "\n".join(mig.mysql_steps)
    for blob in (sqlite_blob, mysql_blob):
        assert "PRIMARY KEY (company_id, collection, id)" in blob
        assert "PRIMARY KEY (company_id, collection, field_name, value_hash)" in blob
        assert "value_hash CHAR(64) NOT NULL" in blob
        assert " g_status TEXT" not in blob
        assert "doc TEXT " not in blob
    assert "doc LONGTEXT NOT NULL" in sqlite_blob
    assert "substr(json_extract(doc, '$.status'), 1, 64)" in sqlite_blob
    assert "CREATE INDEX IF NOT EXISTS idx_v2_status " in sqlite_blob
    assert "doc JSON NOT NULL" in mysql_blob
    assert "LEFT(JSON_UNQUOTE(JSON_EXTRACT(doc, '$.status')), 64)" in mysql_blob
    assert "LEFT(JSON_UNQUOTE(JSON_EXTRACT(doc, '$.account_name')), 191)" in mysql_blob
    assert "g_status VARCHAR(64)" in mysql_blob
    assert "g_account_name VARCHAR(191)" in mysql_blob
    assert "CREATE INDEX IF NOT EXISTS" not in mysql_blob
    assert "CREATE INDEX idx_v2_status " in mysql_blob
    for column, field, _width in storage_shared_v2.GENERATED_COLUMNS:
        for blob in (sqlite_blob, mysql_blob):
            assert column in blob
            assert f"{column}_bad" in blob
            assert f"$.{field}" in blob
            assert f"idx_v2_{field} " in blob
            assert f"idx_v2_{field}_bad" in blob
    source = (_BACKEND / "storage_shared_v2.py").read_text(encoding="utf-8")
    assert "CREATE TABLE" not in source
    assert "docs_v2" not in (_BACKEND / "mysql_store.py").read_text(encoding="utf-8")
    assert "docs_v2" not in (_BACKEND / "schema.mysql.sql").read_text(encoding="utf-8")


def test_mysql_equality_uses_unquoted_generated_text():
    store = storage_shared_v2.SharedV2Store()
    store.dialect = "mysql"
    coll = storage_shared_v2.SharedV2Collection(store, CO, "invoices")
    where, params, fields = coll._filter_sql({"status": "open", "company_id": CO})
    assert "g_status = ?" in where
    assert "JSON_QUOTE" not in where
    assert "JSON_UNQUOTE(g_status)" not in where
    assert "STRING" in where
    assert "JSON_UNQUOTE(JSON_EXTRACT(doc, '$.status')) = ?" in where
    assert params == ["open", "open"]
    assert fields == ("status",)
    long_status = "S" * 100
    long_where, long_params, _long_fields = coll._filter_sql({"status": long_status})
    assert "g_status = ?" not in long_where
    assert "JSON_UNQUOTE(JSON_EXTRACT(doc, '$.status')) = ?" in long_where
    assert long_params == [long_status]
    note_where, note_params, _note_fields = coll._filter_sql({"note": "bir"})
    assert "JSON_UNQUOTE(JSON_EXTRACT(doc, '$.note')) = ?" in note_where
    assert note_params == ["bir"]
    store.dialect = "sqlite"
    where, params, _fields = coll._filter_sql({"status": "open"})
    assert "g_status = ?" in where
    assert "json_extract(doc, '$.status') = ?" in where
    assert params == ["open", "open"]
    assert "COALESCE(json_type(doc, '$.status'), '') = 'text'" in where
    assert "JSON_QUOTE" not in where
    assert "JSON_UNQUOTE" not in where


def test_same_results_as_legacy_python_path(conn):
    shared = _shared()
    legacy = _Legacy()

    async def run():
        return await _exercise(shared), await _exercise(legacy)

    got, expected = asyncio.run(run())
    assert got == expected


def test_company_isolation_and_scoped_unique(conn):
    own = _shared(CO)
    other = _shared(OTHER)

    async def run():
        await own.create_index("invoice_number", unique=True)
        await own.insert_one({
            "_id": "1", "company_id": CO, "invoice_number": "INV-1", "status": "open", "created_at": "2024-01-01",
        })
        await other.insert_one({
            "_id": "1", "company_id": OTHER, "invoice_number": "INV-1", "status": "open", "created_at": "2024-01-01",
        })
        await other.insert_one({
            "_id": "2", "company_id": OTHER, "invoice_number": "INV-2", "status": "closed", "created_at": "2024-02-01",
        })
        with pytest.raises(DuplicateKeyError):
            await own.insert_one({
                "_id": "3", "company_id": CO, "invoice_number": "INV-1", "status": "open", "created_at": "2024-03-01",
            })
        found = await own.find({}).to_list(20)
        ids = sorted(doc["_id"] for doc in found)
        companies = {doc["company_id"] for doc in found}
        other_rows = await other.find({"invoice_number": "INV-1"}).to_list(10)
        return ids, companies, [doc["_id"] for doc in other_rows]

    storage_shared_v2.get_store().capture_plans = True
    ids, companies, other_ids = asyncio.run(run())
    assert ids == ["1"]
    assert companies == {CO}
    assert other_ids == ["1"]
    plan = storage_shared_v2.get_store().last_unique_plan
    assert "company_id" in plan
    assert "idx_v2_invoice_number" in plan
    assert storage_shared_v2.get_store().python_scans == 0


def test_pushdown_does_not_load_the_company(conn):
    coll = _shared(CO, "orders")

    async def run():
        for index in range(30):
            await coll.insert_one({
                "_id": f"{index:02d}",
                "company_id": CO,
                "status": "open" if index % 3 == 0 else "closed",
                "created_at": f"2024-01-{(index % 27) + 1:02d}T00:{index:02d}:00",
            })
        store = storage_shared_v2.get_store()
        store.docs_loaded = 0
        store.python_scans = 0
        store.statements.clear()
        store.capture_plans = True
        page = await coll.find({"status": "open"}).sort("created_at", -1).limit(5).to_list(5)
        return page

    page = asyncio.run(run())
    store = storage_shared_v2.get_store()
    assert len(page) == 5
    assert store.python_scans == 0
    assert store.docs_loaded == 5
    select = [sql for sql in store.statements if sql.startswith("SELECT doc")][-1]
    assert "company_id=?" in select.replace(" ", "")
    assert "LIMIT ?" in select
    assert "USING INDEX" in store.last_plan
    assert "company_id" in store.last_plan
    assert all(doc["status"] == "open" for doc in page)
    assert all(doc["company_id"] == CO for doc in page)


def test_unsupported_operator_falls_back_without_logging_values(conn, caplog):
    coll = _shared()
    secret = "SENTINEL-991"

    async def run():
        await coll.insert_one({
            "_id": "1", "company_id": CO, "status": secret, "created_at": "2024-01-01",
        })
        await _shared(OTHER).insert_one({
            "_id": "9", "company_id": OTHER, "status": secret, "created_at": "2024-01-01",
        })
        store = storage_shared_v2.get_store()
        store.docs_loaded = 0
        store.python_scans = 0
        with caplog.at_level(logging.WARNING, logger="storage_shared_v2"):
            rows = await coll.find({"$expr": {"$eq": ["$status", secret]}}).to_list(10)
        return rows, store.python_scans, store.docs_loaded

    rows, scans, loaded = asyncio.run(run())
    assert [doc["_id"] for doc in rows] == ["1"]
    assert scans == 1
    assert loaded == 1
    assert secret not in caplog.text
    assert "operator:$expr" in caplog.text
    assert ENV_LEAK() not in caplog.text


def ENV_LEAK():
    return "mysql://user"


def test_multi_operator_matches_python_instead_of_guessing(conn, caplog):
    coll = _shared()
    legacy = _Legacy()

    async def run(api):
        await api.insert_one({
            "_id": "1", "company_id": CO, "date": "2024-03-01", "created_at": "2024-03-01", "status": "open",
        })
        await api.insert_one({
            "_id": "2", "company_id": CO, "date": "2024-01-01", "created_at": "2024-01-01", "status": "open",
        })
        rows = await api.find({"date": {"$gte": "2024-02-01", "$lt": "2024-06-01"}}).sort("_id", 1).to_list(10)
        return [doc["_id"] for doc in rows]

    with caplog.at_level(logging.WARNING, logger="storage_shared_v2"):
        shared_ids = asyncio.run(run(coll))
    legacy_ids = asyncio.run(run(legacy))
    assert shared_ids == legacy_ids
    assert "operator:multi" in caplog.text
    assert "2024-02-01" not in caplog.text


def test_non_scalar_value_falls_back_to_python(conn):
    shared = _shared(CO, "orders")
    legacy = _Legacy("orders")

    async def run(api):
        await api.insert_one({
            "_id": "s", "company_id": CO, "status": "open", "created_at": "2024-01-02",
        })
        await api.insert_one({
            "_id": "n", "company_id": CO, "status": 1, "created_at": "2024-01-03",
        })
        await api.insert_one({
            "_id": "arr", "company_id": CO, "status": ["open"], "created_at": "2024-01-04",
        })
        rows = await api.find({"status": "open"}).sort("_id", 1).to_list(10)
        return [doc["_id"] for doc in rows]

    assert asyncio.run(run(shared)) == asyncio.run(run(legacy))
    assert storage_shared_v2.get_store().python_scans >= 1


def test_router_roundtrip_stays_on_legacy_for_other_company(conn, monkeypatch):
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    db = MemDB()

    async def run():
        await db.companies.insert_one({"_id": CO, "storage_mode": "shared_v2"})
        await db.companies.insert_one({"_id": "legacy-co"})
        scope = TenantScope(company_id=CO, allowed=frozenset({CO}), kind="user", actor_id="u", reason="test")
        handle = tenant_db.TenantDB(db, scope)
        await handle.invoices.insert_one({
            "_id": "inv", "status": "open", "created_at": "2024-01-01", "invoice_number": "R-1",
        })
        rows = await handle.invoices.find({"status": "open"}).limit(5).to_list(5)
        legacy_scope = TenantScope(
            company_id="legacy-co", allowed=frozenset({"legacy-co"}), kind="user", actor_id="u", reason="test",
        )
        legacy = tenant_db.TenantDB(db, legacy_scope)
        legacy_raw = legacy._collection("invoices")._raw
        return rows, legacy_raw

    rows, legacy_raw = asyncio.run(run())
    assert rows[0]["_id"] == "inv"
    assert rows[0]["company_id"] == CO
    assert type(legacy_raw).__name__ != "SharedV2Collection"
    assert storage_shared_v2.get_store().python_scans == 0


def test_list_benchmark_against_legacy_python(conn):
    total = 100_000
    docs = []
    payload = []
    for index in range(total):
        status = "open" if index % 7 == 0 else "closed"
        created = f"2024-{(index % 12) + 1:02d}-{(index % 27) + 1:02d}T{index % 24:02d}:00:{index % 60:02d}"
        doc = {
            "_id": f"{index:06d}",
            "company_id": CO,
            "status": status,
            "created_at": created,
            "contact_id": f"c{index % 50}",
        }
        docs.append(doc)
        payload.append((CO, "orders", doc["_id"], json.dumps(doc, ensure_ascii=False)))
    conn.executemany(
        "INSERT INTO docs_v2 (company_id, collection, id, doc) VALUES (?,?,?,?)",
        payload,
    )
    coll = _shared(CO, "orders")
    query = {"company_id": CO, "status": "open"}

    def legacy_page():
        matched = [doc for doc in docs if match_query(doc, query)]
        matched = sort_docs(matched, [("created_at", -1)])
        return matched[:50]

    started = time.perf_counter()
    legacy_rows = legacy_page()
    legacy_s = time.perf_counter() - started

    async def shared_page():
        return await coll.find(query).sort("created_at", -1).limit(50).to_list(50)

    store = storage_shared_v2.get_store()
    store.python_scans = 0
    store.docs_loaded = 0
    started = time.perf_counter()
    shared_rows = asyncio.run(shared_page())
    shared_s = time.perf_counter() - started
    started = time.perf_counter()
    warm_rows = asyncio.run(shared_page())
    warm_s = time.perf_counter() - started
    assert [doc["_id"] for doc in shared_rows] == [doc["_id"] for doc in legacy_rows]
    assert [doc["_id"] for doc in warm_rows] == [doc["_id"] for doc in legacy_rows]
    assert store.python_scans == 0
    assert store.docs_loaded == 100
    print(
        f"BENCHMARK n={total} legacy={legacy_s:.4f}s shared={shared_s:.4f}s warm={warm_s:.4f}s"
    )


def test_unique_index_is_company_scoped_and_releases_on_delete(conn):
    coll = _shared(CO, "invoices")

    async def run():
        await coll.insert_one({
            "_id": "1", "company_id": CO, "invoice_number": "INV-1", "status": "open", "created_at": "2024-01-01",
        })
        await coll.insert_one({
            "_id": "2", "company_id": CO, "invoice_number": "INV-1", "status": "open", "created_at": "2024-01-02",
        })
        await coll.create_index("invoice_number", unique=True)
        with pytest.raises(DuplicateKeyError):
            await coll.insert_one({
                "_id": "3", "company_id": CO, "invoice_number": "INV-9", "status": "open", "created_at": "2024-01-03",
            })
        return "backfill-should-have-failed"

    with pytest.raises(DuplicateKeyError):
        asyncio.run(run())
    storage_shared_v2.reset_store()
    storage_shared_v2.bind_sqlite(conn)

    async def clean():
        fresh = _shared(CO, "invoices")
        other = _shared(OTHER, "invoices")
        orders = _shared(CO, "orders")
        await fresh.delete_many({})
        await fresh.create_index("invoice_number", unique=True)
        await fresh.insert_one({
            "_id": "1", "company_id": CO, "invoice_number": "INV-1", "status": "open", "created_at": "2024-01-01",
        })
        with pytest.raises(DuplicateKeyError):
            await fresh.insert_one({
                "_id": "2", "company_id": CO, "invoice_number": "INV-1", "status": "paid", "created_at": "2024-01-02",
            })
        await other.insert_one({
            "_id": "2", "company_id": OTHER, "invoice_number": "INV-1", "status": "open", "created_at": "2024-01-02",
        })
        await orders.insert_one({
            "_id": "2", "company_id": CO, "invoice_number": "INV-1", "status": "open", "created_at": "2024-01-02",
        })
        await fresh.delete_one({"_id": "1"})
        await fresh.insert_one({
            "_id": "3", "company_id": CO, "invoice_number": "INV-1", "status": "open", "created_at": "2024-01-03",
        })
        return conn.execute("SELECT company_id, collection, doc_id FROM docs_v2_unique ORDER BY company_id, collection").fetchall()

    rows = asyncio.run(clean())
    assert ("co", "invoices", "3") in [(row[0], row[1], row[2]) for row in rows]
    assert ("co", "invoices", "1") not in [(row[0], row[1], row[2]) for row in rows]
    held = conn.execute(
        "SELECT company_id, collection FROM docs_v2_unique "
        "WHERE field_name='invoice_number' AND field_value=? ORDER BY company_id",
        ('["INV-1"]',),
    ).fetchall()
    assert [(row[0], row[1]) for row in held] == [(CO, "invoices"), (OTHER, "invoices")]


def test_long_text_is_stored_and_matches_exactly(conn):
    status = "S" * 100
    account = "N" * 300
    renamed = "M" * 300
    coll = _shared(CO, "invoices")

    async def run():
        await coll.insert_one({
            "_id": "long",
            "company_id": CO,
            "status": status,
            "account_name": account,
            "created_at": "2024-01-01",
        })
        stored = await coll.find_one({"_id": "long"})
        by_full = await coll.find({"status": status}).to_list(5)
        by_prefix = await coll.find({"status": status[:64]}).to_list(5)
        await coll.update_one({"_id": "long"}, {"$set": {"account_name": renamed, "status": "T" * 80}})
        updated = await coll.find_one({"account_name": renamed})
        await coll.create_index("account_name", unique=True)
        with pytest.raises(DuplicateKeyError):
            await coll.insert_one({
                "_id": "dup",
                "company_id": CO,
                "status": "open",
                "account_name": renamed,
                "created_at": "2024-01-02",
            })
        other_tail = "M" * 191 + "Z"
        await coll.insert_one({
            "_id": "tail",
            "company_id": CO,
            "status": "open",
            "account_name": other_tail,
            "created_at": "2024-01-03",
        })
        return stored, by_full, by_prefix, updated

    stored, by_full, by_prefix, updated = asyncio.run(run())
    assert stored["status"] == status
    assert stored["account_name"] == account
    assert [doc["_id"] for doc in by_full] == ["long"]
    assert by_prefix == []
    assert updated["account_name"] == renamed
    assert updated["status"] == "T" * 80
    column = conn.execute(
        "SELECT g_status, g_account_name FROM docs_v2 WHERE id='long'"
    ).fetchone()
    assert column[0] == "T" * 64
    assert column[1] == "M" * 191
    hashes = conn.execute(
        "SELECT value_hash, field_value FROM docs_v2_unique WHERE doc_id='long'"
    ).fetchall()
    assert len(hashes) == 1
    assert len(hashes[0][0]) == 64
    assert hashes[0][1] == hashes[0][0]


def _mariadb_dsn():
    return (os.environ.get("STORAGE_SHARED_V2_TEST_DSN") or "").strip()


def test_mariadb_migration_twice_and_concurrent_unique():
    dsn = _mariadb_dsn()
    if not dsn:
        pytest.skip("STORAGE_SHARED_V2_TEST_DSN yok")
    import pymysql
    from urllib.parse import unquote, urlparse

    from storage_migrations.engine import apply
    from storage_migrations.session import connect

    parsed = urlparse(dsn.replace("mariadb://", "mysql://", 1))
    database = (parsed.path or "/").lstrip("/").split("?")[0]
    admin = pymysql.connect(
        host=parsed.hostname or "127.0.0.1",
        port=parsed.port or 3306,
        user=unquote(parsed.username or ""),
        password=unquote(parsed.password or ""),
        database=database,
        charset="utf8mb4",
        autocommit=True,
        connect_timeout=5,
    )
    try:
        with admin.cursor() as cur:
            cur.execute("DROP TABLE IF EXISTS docs_v2_unique")
            cur.execute("DROP TABLE IF EXISTS docs_v2")
            cur.execute("DROP TABLE IF EXISTS storage_records")
            cur.execute("DROP TABLE IF EXISTS schema_version")
            cur.execute("DROP TABLE IF EXISTS storage_marker")
            cur.execute("DROP TABLE IF EXISTS storage_meta")
    finally:
        admin.close()

    from storage_migrations.loader import load_migrations

    opened = connect(dsn, write=True)
    try:
        opened.execute(
            "SET SESSION sql_mode='STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'"
        )
        pack = load_migrations()
        first = apply(opened, confirm=True, dry_run=False)
        assert first.advanced == len(pack)
        assert {row.version for row in first.rows} == {item.version for item in pack}
        assert [row.state for row in first.rows] == ["uygulandı"] * len(pack)
        assert "storage_records" in opened.tables()
        second = apply(opened, confirm=True, dry_run=False)
        assert second.advanced == 0
        indexes = opened.fetchall(
            "SELECT index_name FROM information_schema.statistics "
            "WHERE table_schema = DATABASE() AND table_name = 'docs_v2'"
        )
        names = {row[0] for row in indexes}
        assert "idx_v2_status" in names
        assert "PRIMARY" in names
        total = opened.fetchall(
            "SELECT step_no FROM schema_version WHERE version = 3"
        )[0][0]
        opened.execute(
            "UPDATE schema_version SET state = %s, step_no = %s WHERE version = %s",
            ("applying", int(total) - 1, 3),
        )
        opened.commit()
        third = apply(opened, confirm=True, dry_run=False)
        version_3 = next(row for row in third.rows if row.version == 3)
        assert version_3.state == "uygulandı"
        assert version_3.step == int(total)
        unique_idx = opened.fetchall(
            "SELECT COUNT(*) FROM information_schema.statistics "
            "WHERE table_schema = DATABASE() AND table_name = 'docs_v2_unique' "
            "AND index_name = 'idx_v2_unique_doc'"
        )[0][0]
        assert int(unique_idx) >= 1
        columns = opened.fetchall(
            "SELECT column_type FROM information_schema.columns "
            "WHERE table_schema = DATABASE() AND table_name = 'docs_v2' AND column_name = 'g_status'"
        )
        assert columns and "varchar" in str(columns[0][0]).lower()
        doc_type = opened.fetchall(
            "SELECT data_type FROM information_schema.columns "
            "WHERE table_schema = DATABASE() AND table_name = 'docs_v2' AND column_name = 'doc'"
        )[0][0]
        assert str(doc_type).lower() in ("json", "longtext")
    finally:
        opened.close()

    def connect_worker():
        conn = pymysql.connect(
            host=parsed.hostname or "127.0.0.1",
            port=parsed.port or 3306,
            user=unquote(parsed.username or ""),
            password=unquote(parsed.password or ""),
            database=database,
            charset="utf8mb4",
            autocommit=False,
            connect_timeout=5,
        )
        with conn.cursor() as cur:
            cur.execute(
                "SET SESSION sql_mode='STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'"
            )
            cur.execute("SET SESSION innodb_lock_wait_timeout=2")
        conn.commit()
        return conn

    storage_shared_v2.reset_store()
    original = storage_shared_v2.SharedV2Collection._sync_unique
    setup = connect_worker()
    try:
        setup_store = storage_shared_v2.SharedV2Store()
        setup_store.attach(setup, "mysql", owned=False)
        setup_coll = storage_shared_v2.SharedV2Collection(setup_store, CO, "invoices")

        async def prepare():
            await setup_coll.create_index("invoice_number", unique=True)
            await setup_coll.insert_one({
                "_id": "keep", "company_id": CO, "invoice_number": "OTHER",
                "status": "S" * 100, "account_name": "N" * 300, "created_at": "2024-01-01",
            })

        asyncio.run(prepare())
        kept = asyncio.run(setup_coll.find_one({"status": "S" * 100}))
        assert kept["account_name"] == "N" * 300
        assert asyncio.run(setup_coll.find({"status": "S" * 64}).to_list(5)) == []
        indexes = setup_store.indexes
        barrier = threading.Barrier(2)
        entered = {"n": 0}
        gate = threading.Lock()

        def synced(self, doc):
            with gate:
                entered["n"] += 1
                turn = entered["n"]
            if turn <= 2:
                barrier.wait(timeout=8)
            return original(self, doc)

        storage_shared_v2.SharedV2Collection._sync_unique = synced
        outcomes = []
        errors = []

        def worker(doc_id):
            conn = connect_worker()
            try:
                store = storage_shared_v2.SharedV2Store()
                store.attach(conn, "mysql", owned=False)
                store.indexes = indexes
                coll = storage_shared_v2.SharedV2Collection(store, CO, "invoices")
                try:
                    asyncio.run(coll.insert_one({
                        "_id": doc_id,
                        "company_id": CO,
                        "invoice_number": "RACE",
                        "status": "open",
                        "created_at": "2024-02-01",
                    }))
                    outcomes.append("ok")
                except DuplicateKeyError:
                    outcomes.append("dup")
                except Exception as exc:
                    errors.append(f"{doc_id} {type(exc).__name__}: {exc}")
            except Exception as exc:
                errors.append(f"{doc_id} bağlantı {type(exc).__name__}: {exc}")
            finally:
                conn.close()

        threads = [
            threading.Thread(target=worker, args=("race-a",), name="race-a"),
            threading.Thread(target=worker, args=("race-b",), name="race-b"),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=20)
        alive = [thread.name for thread in threads if thread.is_alive()]
        assert not alive, alive
        assert errors == [], errors
        assert sorted(outcomes) == ["dup", "ok"], outcomes
        setup.commit()
        with setup.cursor() as cur:
            cur.execute(
                "SELECT id FROM docs_v2 WHERE company_id=%s AND collection=%s AND "
                "JSON_UNQUOTE(JSON_EXTRACT(doc, '$.invoice_number'))=%s",
                (CO, "invoices", "RACE"),
            )
            raced = cur.fetchall()
        assert len(raced) == 1, (outcomes, errors, raced)
    finally:
        storage_shared_v2.SharedV2Collection._sync_unique = original
        storage_shared_v2.reset_store()
        setup.close()
