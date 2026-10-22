"""Gerçek tablo katmanı. Canlı veritabanına ve 8021 portuna bağlanmaz.

orders, invoices, stock_movements, bank_transactions shared_v2 kipinde
kendi tablolarına gider. Migration sürümleri load_migrations() sonucundan okunur.
"""
from __future__ import annotations

import asyncio
import itertools
import os
import re
import sqlite3
import sys
import threading
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from urllib.parse import unquote, urlparse

import pytest

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(Path(__file__).resolve().parent))

os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

from dashboard_memdb import MemDB  # noqa: E402
from mysql_store import DuplicateKeyError  # noqa: E402
from storage_migrations.engine import apply  # noqa: E402
from storage_migrations.loader import load_migrations, steps_for  # noqa: E402
from storage_migrations.session import Session  # noqa: E402
from tenant_scope import TenantScope  # noqa: E402
import storage_router  # noqa: E402
import storage_shared_v2  # noqa: E402
import storage_tables  # noqa: E402
import tenant_db  # noqa: E402

_DOCS_WORD = re.compile(r"\bdocs\b", re.IGNORECASE)
_ALLOWED = re.compile(r"^(create|insert|alter)\b", re.IGNORECASE)
_LAYOUT_NAMES = frozenset({"docs_v2", "storage_records", "collection_tables"})
CO = "co"
OTHER = "co_b"


class _CountSession(Session):
    def __init__(self, conn):
        super().__init__(conn, "sqlite", read_only=False)
        self.writes = 0

    def execute(self, sql, params=None):
        head = sql.strip().lstrip().upper()
        if not head.startswith(("SELECT", "PRAGMA", "WITH", "EXPLAIN", "SHOW")):
            self.writes += 1
        return super().execute(sql, params)


def _memory():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    return _CountSession(conn)


def _apply_conn(conn):
    apply(Session(conn, "sqlite", read_only=False), confirm=True, dry_run=False)


def _pack():
    return load_migrations()


def _by_name(pack=None):
    items = pack if pack is not None else _pack()
    return {item.name: item for item in items}


def _real(pack=None):
    return _by_name(pack)["collection_tables"]


@pytest.fixture
def conn():
    storage_router.reset()
    storage_shared_v2.reset_store()
    connection = sqlite3.connect(":memory:", isolation_level=None, check_same_thread=False)
    _apply_conn(connection)
    storage_shared_v2.bind_sqlite(connection)
    yield connection
    storage_router.reset()
    storage_shared_v2.reset_store()
    connection.close()


def _orders(company_id=CO):
    return storage_tables.collection_for(company_id, "orders")


def _scope(company_id):
    return TenantScope(
        company_id=company_id,
        allowed=frozenset({company_id}),
        kind="user",
        actor_id="user-a",
        reason="test",
    )


def test_migration_matches_layout_and_stays_independent():
    pack = _pack()
    named = _by_name(pack)
    assert set(_LAYOUT_NAMES) <= set(named)
    real = named["collection_tables"]
    assert real.mysql_steps
    blob = "\n".join(real.steps + real.mysql_steps)
    lowered = blob.lower()
    assert _DOCS_WORD.search(blob) is None
    assert "docs_v2" not in lowered
    assert "storage_records" not in lowered
    for step in real.steps + real.mysql_steps:
        assert _ALLOWED.match(step)
    sqlite_blob = "\n".join(real.steps)
    mysql_blob = "\n".join(real.mysql_steps)
    assert "doc LONGTEXT NOT NULL" in sqlite_blob
    assert "doc JSON NOT NULL" in mysql_blob
    assert "CREATE INDEX IF NOT EXISTS" in sqlite_blob
    assert "CREATE INDEX IF NOT EXISTS" not in mysql_blob
    assert "PRIMARY KEY (company_id, id)" in sqlite_blob
    assert "PRIMARY KEY (company_id, collection, field_name, value_hash)" in sqlite_blob
    for spec in storage_tables.SPECS.values():
        assert f"CREATE TABLE IF NOT EXISTS {spec.table} " in sqlite_blob
        for column, field, width in spec.fields:
            if field in spec.numeric:
                declared = f"{column} {storage_tables.DECIMAL_SQL}"
            else:
                declared = f"{column} VARCHAR({width})"
            assert declared in sqlite_blob
            assert declared in mysql_blob
        for index_name, columns in spec.indexes:
            listed = ", ".join(columns)
            assert f"idx" in index_name
            assert f"{index_name} ON {spec.table} ({listed})" in mysql_blob
            assert f"IF NOT EXISTS {index_name} ON {spec.table} ({listed})" in sqlite_blob
    engine = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin"
    for step in real.mysql_steps:
        if step.upper().startswith("CREATE TABLE"):
            assert engine in step
    bin_fix = named["utf8mb4_bin"]
    assert bin_fix.version > named["docs_v2"].version
    assert bin_fix.version > real.version
    mysql_fix = "\n".join(bin_fix.mysql_steps)
    assert "ALTER TABLE docs_v2 CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin" in mysql_fix
    assert "ALTER TABLE docs_v2_unique CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_bin" in mysql_fix
    assert "CONVERT TO" not in "\n".join(bin_fix.steps)
    assert "company_id VARCHAR(64) NOT NULL" in sqlite_blob
    assert "id VARCHAR(191) NOT NULL" in sqlite_blob
    others = "\n".join(named["docs_v2"].steps + named["storage_records"].steps).lower()
    assert "t_orders" not in others
    assert "t_row_unique" not in others
    source = (_BACKEND / "storage_tables.py").read_text(encoding="utf-8")
    assert "CREATE TABLE" not in source
    versions = [item.version for item in pack]
    assert versions == sorted(versions)
    assert versions[0] == 1
    assert real.version == 5
    assert named["docs_v2"].version < real.version
    assert named["storage_records"].version < real.version


def test_second_apply_writes_nothing_and_interrupted_index_resumes():
    session = _memory()
    pack = _pack()
    real = _real(pack)
    first = apply(session, confirm=True, dry_run=False)
    assert first.advanced == len(pack)
    assert [row.state for row in first.rows] == ["uygulandı"] * len(first.rows)
    assert "t_orders" in session.tables()
    assert "t_invoices" in session.tables()
    assert "t_stock_moves" in session.tables()
    assert "t_bank_transactions" in session.tables()
    assert "t_row_unique" in session.tables()
    session.writes = 0
    second = apply(session, confirm=True, dry_run=False)
    assert second.advanced == 0
    assert session.writes == 0
    total = len(steps_for(real, session.dialect))
    index_name = "idx_t_orders_date"
    found = session.fetchall(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?",
        (index_name,),
    )[0][0]
    assert found == 1
    session.execute(
        "UPDATE schema_version SET state = ?, step_no = ?, applied_at = ? WHERE version = ?",
        ("applying", total - 1, "", real.version),
    )
    session.commit()
    resumed = apply(session, confirm=True, dry_run=False)
    row = next(item for item in resumed.rows if item.version == real.version)
    assert row.state == "uygulandı"
    assert row.step == total
    found = session.fetchall(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?",
        (index_name,),
    )[0][0]
    assert found == 1
    session.execute(
        "UPDATE schema_version SET state = ?, step_no = ?, applied_at = ? WHERE version = ?",
        ("applying", 4, "", real.version),
    )
    session.commit()
    continued = apply(session, confirm=True, dry_run=False)
    row = next(item for item in continued.rows if item.version == real.version)
    assert row.state == "uygulandı"
    assert row.step == row.total
    session.writes = 0
    idle = apply(session, confirm=True, dry_run=False)
    assert idle.advanced == 0
    assert session.writes == 0


def test_layout_migrations_apply_cleanly_in_any_order():
    pack = _pack()
    named = _by_name(pack)
    chosen = tuple(named[name] for name in sorted(_LAYOUT_NAMES))
    floor = min(item.version for item in chosen)
    earlier = tuple(item for item in pack if item.version < floor)
    expected = {
        "docs_v2": "docs_v2",
        "storage_records": "storage_records",
        "collection_tables": "t_orders",
    }
    for item in chosen:
        session = _memory()
        alone = apply(session, earlier + (item,), confirm=True, dry_run=False)
        assert alone.advanced == len(earlier) + 1
        assert expected[item.name] in session.tables()
        for other in chosen:
            if other.name == item.name:
                continue
            assert expected[other.name] not in session.tables()
        rest = apply(session, confirm=True, dry_run=False)
        assert rest.advanced == len(pack) - len(earlier) - 1
        assert [row.state for row in rest.rows] == ["uygulandı"] * len(rest.rows)
        for marker in expected.values():
            assert marker in session.tables()
    for order in itertools.permutations(chosen):
        session = _memory()
        applied = apply(session, earlier + order, confirm=True, dry_run=False)
        assert applied.advanced == len(earlier) + len(order)
        assert [row.state for row in applied.rows] == ["uygulandı"] * len(applied.rows)
        for marker in expected.values():
            assert marker in session.tables()
        session.writes = 0
        again = apply(session, earlier + order, confirm=True, dry_run=False)
        assert again.advanced == 0
        assert session.writes == 0


def test_crud_query_sort_page_and_company_isolation(conn):
    own = _orders(CO)
    other = _orders(OTHER)
    invoices = storage_tables.collection_for(CO, "invoices")
    stock = storage_tables.collection_for(CO, "stock_movements")
    bank = storage_tables.collection_for(OTHER, "bank_transactions")

    async def run():
        await own.create_index(
            [("company_id", 1), ("channel", 1), ("order_number", 1)],
            unique=True,
        )
        rows = [
            {"_id": "b", "order_number": "B-1", "order_status": "open", "order_date": "2024-03-01",
             "contact_id": "c1", "channel": "b2b", "total_amount": 20, "note": "iki"},
            {"_id": "a", "order_number": "A-1", "order_status": "open", "order_date": "2024-01-01",
             "contact_id": "c2", "channel": "manual", "total_amount": "10.50", "note": "bir"},
            {"_id": "c", "order_number": "C-1", "order_status": "closed", "order_date": "2024-02-01",
             "contact_id": "c1", "channel": "b2b", "total_amount": 5, "note": "uc"},
        ]
        for row in rows:
            await own.insert_one(row)
        await other.insert_one({
            "_id": "a", "order_number": "A-1", "order_status": "open", "order_date": "2024-01-01",
            "contact_id": "c9", "channel": "b2b", "total_amount": 1,
        })
        await other.insert_one({
            "_id": "z", "order_number": "B-1", "order_status": "open", "order_date": "2024-04-01",
            "contact_id": "c9", "channel": "b2b", "total_amount": 9,
        })
        page = await own.find({"order_status": "open"}).sort("order_date", -1).skip(1).limit(1).to_list(10)
        counted = await own.count_documents({"order_status": "open"})
        by_note = await own.find({"note": "bir"}).to_list(5)
        by_contact = await own.find({"contact_id": "c1"}).sort("order_date", 1).to_list(10)
        ranged = await own.find({
            "$and": [
                {"order_date": {"$gte": "2024-02-01"}},
                {"order_date": {"$lt": "2024-04-01"}},
            ],
        }).to_list(10)
        hidden = await own.find({"company_id": OTHER}).to_list(10)
        prefix = await own.find({"order_number": {"$regex": "^A-"}}).to_list(5)
        grouped = await own.aggregate([
            {"$match": {"order_status": "open"}},
            {"$group": {"_id": "$contact_id", "n": {"$sum": "$total_amount"}}},
        ]).to_list(None)
        distinct = await own.distinct("channel", {"order_status": "open"})
        updated = await own.update_one({"_id": "a"}, {"$set": {"order_status": "paid", "total_amount": 11}})
        same = await own.update_one({"_id": "a"}, {"$set": {"order_status": "paid"}})
        removed = await own.delete_one({"_id": "c"})
        await invoices.insert_one({
            "_id": "i1", "invoice_number": "F-1", "status": "open", "issue_date": "2024-01-15",
            "contact_id": "c2", "grand_total": 12.5,
        })
        invoice_page = await invoices.find({"status": "open"}).sort("issue_date", -1).limit(1).to_list(5)
        await stock.insert_one({
            "_id": "m1", "product_id": "p1", "date": "2024-01-02", "change": -2, "status": "done",
            "doc_no": "ST-1",
        })
        moves = await stock.find({"product_id": "p1"}).to_list(5)
        await bank.insert_one({
            "_id": "t1", "date": "2024-05-01", "amount": 10.5, "contact_id": "c1",
            "match_status": "unmatched", "account_id": "acc", "doc_no": "DK-1",
        })
        txs = await bank.find({"match_status": "unmatched", "contact_id": "c1"}).sort("date", -1).to_list(5)
        leaked = await own.find({}).to_list(20)
        with pytest.raises(DuplicateKeyError):
            await own.insert_one({
                "_id": "dup", "order_number": "B-1", "order_status": "open", "order_date": "2024-06-01",
                "channel": "b2b", "contact_id": "c3",
            })
        await own.insert_one({
            "_id": "other-channel", "order_number": "B-1", "order_status": "open",
            "order_date": "2024-06-02", "channel": "manual", "contact_id": "c3",
        })
        many = await own.delete_many({"order_status": "open"})
        return {
            "page": [doc["_id"] for doc in page],
            "counted": counted,
            "note": [doc["_id"] for doc in by_note],
            "contact": [doc["_id"] for doc in by_contact],
            "range": sorted(doc["_id"] for doc in ranged),
            "hidden": hidden,
            "prefix": [doc["_id"] for doc in prefix],
            "group": sorted((row.get("_id"), row.get("n")) for row in grouped),
            "distinct": sorted(distinct),
            "updated": (updated.matched_count, updated.modified_count),
            "same": (same.matched_count, same.modified_count),
            "removed": removed.deleted_count,
            "many": many.deleted_count,
            "invoice": invoice_page[0]["invoice_number"],
            "move": moves[0]["change"],
            "tx": txs[0]["amount"],
            "companies": {doc["company_id"] for doc in leaked},
            "left": await own.count_documents({}),
        }

    storage_shared_v2.get_store().capture_plans = True
    storage_shared_v2.get_store().python_scans = 0
    got = asyncio.run(run())
    assert got["page"] == ["a"]
    assert got["counted"] == 2
    assert got["note"] == ["a"]
    assert got["contact"] == ["c", "b"]
    assert got["range"] == ["b", "c"]
    assert got["hidden"] == []
    assert got["prefix"] == ["a"]
    assert got["group"] == [("c1", 20.0), ("c2", 10.5)]
    assert got["distinct"] == ["b2b", "manual"]
    assert got["updated"] == (1, 1)
    assert got["same"] == (1, 0)
    assert got["removed"] == 1
    assert got["many"] == 2
    assert got["invoice"] == "F-1"
    assert got["move"] == -2
    assert got["tx"] == 10.5
    assert got["companies"] == {CO}
    assert got["left"] == 1
    assert storage_shared_v2.get_store().python_scans == 0
    assert "company_id" in storage_shared_v2.get_store().last_plan
    status = conn.execute("SELECT order_status, total_amount FROM t_orders WHERE id = 'a'").fetchone()
    assert status[0] == "paid"
    assert float(status[1]) == 11
    amount = conn.execute("SELECT amount, doc_date FROM t_stock_moves WHERE id = 'm1'").fetchone()
    assert float(amount[0]) == -2
    assert amount[1] == "2024-01-02"
    bank_row = conn.execute(
        "SELECT amount, doc_date, match_status FROM t_bank_transactions WHERE company_id = ?",
        (OTHER,),
    ).fetchone()
    assert float(bank_row[0]) == 10.5
    assert bank_row[1] == "2024-05-01"
    assert bank_row[2] == "unmatched"
    invoice = conn.execute("SELECT grand_total FROM t_invoices WHERE id = 'i1'").fetchone()
    assert float(invoice[0]) == 12.5
    foreign = conn.execute("SELECT id FROM t_orders WHERE company_id = ?", (OTHER,)).fetchall()
    assert sorted(row[0] for row in foreign) == ["a", "z"]


def test_long_values_are_clipped_in_column_and_match_full_text(conn):
    number = "N" * 64 + "A"
    other_number = "N" * 64 + "B"
    status = "S" * 100
    coll = _orders()

    async def run():
        await coll.create_index("order_number", unique=True)
        await coll.insert_one({
            "_id": "long",
            "order_number": number,
            "order_status": status,
            "order_date": "2024-01-01",
            "channel": "b2b",
            "contact_id": "C" * 80,
        })
        await coll.insert_one({
            "_id": "tail",
            "order_number": other_number,
            "order_status": "open",
            "order_date": "2024-01-02",
            "channel": "b2b",
        })
        stored = await coll.find_one({"_id": "long"})
        by_full = await coll.find({"order_number": number}).to_list(5)
        by_prefix = await coll.find({"order_number": "N" * 64}).to_list(5)
        by_status = await coll.find({"order_status": status}).to_list(5)
        return stored, by_full, by_prefix, by_status

    stored, by_full, by_prefix, by_status = asyncio.run(run())
    assert stored["order_number"] == number
    assert stored["order_status"] == status
    assert stored["contact_id"] == "C" * 80
    assert [doc["_id"] for doc in by_full] == ["long"]
    assert by_prefix == []
    assert [doc["_id"] for doc in by_status] == ["long"]
    column = conn.execute(
        "SELECT order_number, order_status, contact_id FROM t_orders WHERE id = 'long'"
    ).fetchone()
    assert column[0] == "N" * storage_tables.TEXT_WIDTH
    assert column[1] == "S" * storage_tables.TEXT_WIDTH
    assert column[2] == "C" * storage_tables.TEXT_WIDTH
    assert len(column[0]) == storage_tables.TEXT_WIDTH


def test_overlong_key_names_the_field(conn):
    coll = storage_tables.TableCollection(
        storage_shared_v2.get_store(), "K" * (storage_tables.COMPANY_WIDTH + 1), "orders",
        storage_tables.SPECS["orders"],
    )

    async def long_company():
        await coll.insert_one({"_id": "1", "order_number": "A-1", "order_status": "open"})

    with pytest.raises(ValueError, match="company_id"):
        asyncio.run(long_company())

    async def long_id():
        await _orders().insert_one({
            "_id": "I" * (storage_tables.ID_WIDTH + 1),
            "order_number": "A-2",
            "order_status": "open",
        })

    with pytest.raises(ValueError, match="_id"):
        asyncio.run(long_id())
    assert conn.execute("SELECT COUNT(*) FROM t_orders").fetchone()[0] == 0


def test_router_sends_only_the_four_collections(monkeypatch):
    storage_router.reset()
    storage_shared_v2.reset_store()
    monkeypatch.delenv("STORAGE_ROUTER_ENABLED", raising=False)
    db = MemDB()

    async def off():
        await db.companies.insert_one({"_id": CO, "storage_mode": "shared_v2"})
        handle = tenant_db.TenantDB(db, _scope(CO))
        return handle._collection("orders")._raw, handle._collection("invoices")._raw

    orders_off, invoices_off = asyncio.run(off())
    assert orders_off is db.orders
    assert invoices_off is db.invoices

    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    storage_router.reset()

    async def on():
        await db.companies.insert_one({"_id": OTHER, "storage_mode": "legacy"})
        shared = tenant_db.TenantDB(db, _scope(CO))
        legacy = tenant_db.TenantDB(db, _scope(OTHER))
        routed = {
            name: type(shared._collection(name)._raw).__name__
            for name in ("orders", "invoices", "stock_movements", "bank_transactions", "products", "contacts")
        }
        legacy_orders = legacy._collection("orders")._raw
        return routed, legacy_orders

    routed, legacy_orders = asyncio.run(on())
    assert routed["orders"] == "TableCollection"
    assert routed["invoices"] == "TableCollection"
    assert routed["stock_movements"] == "TableCollection"
    assert routed["bank_transactions"] == "TableCollection"
    assert routed["products"] == "SharedV2Collection"
    assert routed["contacts"] == "SharedV2Collection"
    assert legacy_orders is db.orders
    assert storage_shared_v2.get_store().conn is None
    storage_router.reset()
    storage_shared_v2.reset_store()


def test_concurrent_unique_write_has_one_winner(tmp_path):
    path = tmp_path / "tables.db"
    setup = sqlite3.connect(path, isolation_level=None, check_same_thread=False, timeout=15)
    _apply_conn(setup)
    storage_router.reset()
    storage_shared_v2.reset_store()
    storage_shared_v2.bind_sqlite(setup)
    coll = _orders()

    async def prepare():
        await coll.create_index("order_number", unique=True)
        await coll.insert_one({
            "_id": "keep", "order_number": "KEEP", "order_status": "open",
            "order_date": "2024-01-01", "channel": "b2b",
        })

    asyncio.run(prepare())
    indexes = storage_shared_v2.get_store().indexes
    outcomes = []
    errors = []

    def worker(doc_id):
        local = sqlite3.connect(path, isolation_level=None, check_same_thread=False, timeout=15)
        try:
            store = storage_shared_v2.SharedV2Store()
            store.attach(local, "sqlite", owned=False)
            store.indexes = indexes
            api = storage_tables.TableCollection(store, CO, "orders", storage_tables.SPECS["orders"])
            try:
                asyncio.run(api.insert_one({
                    "_id": doc_id,
                    "order_number": "RACE",
                    "order_status": "open",
                    "order_date": "2024-02-01",
                    "channel": "b2b",
                }))
                outcomes.append("ok")
            except DuplicateKeyError:
                outcomes.append("dup")
            except Exception as exc:
                errors.append(f"{doc_id} {type(exc).__name__}: {exc}")
        finally:
            local.close()

    threads = [
        threading.Thread(target=worker, args=("race-a",)),
        threading.Thread(target=worker, args=("race-b",)),
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=20)
    assert not [thread.name for thread in threads if thread.is_alive()]
    assert errors == [], errors
    assert sorted(outcomes) == ["dup", "ok"]
    raced = setup.execute(
        "SELECT id FROM t_orders WHERE company_id = ? AND order_number = ?",
        (CO, "RACE"),
    ).fetchall()
    assert len(raced) == 1
    storage_shared_v2.reset_store()
    setup.close()


_MOMENTS = {
    "m2": datetime(2024, 1, 5, 9, 0),
    "m3": datetime(2024, 1, 12, 9, 0),
    "m1": datetime(2024, 1, 20, 9, 0),
}
_DATE_FIELDS = (
    ("orders", "order_date", "t_orders", "order_date"),
    ("invoices", "issue_date", "t_invoices", "issue_date"),
    ("stock_movements", "date", "t_stock_moves", "doc_date"),
    ("bank_transactions", "date", "t_bank_transactions", "doc_date"),
)


def test_stored_value_follows_doc_json_scalar():
    body = {
        "date": datetime(2024, 1, 12, 8, 30),
        "change": Decimal("10.50"),
        "flag": True,
        "note": None,
        "order_number": "N" * 80,
    }
    assert storage_tables.stored_value(body, "date", 40) == "2024-01-12 08:30:00"
    assert storage_tables.stored_decimal(body, "change") is None
    assert storage_tables.stored_value(body, "flag", 64) is None
    assert storage_tables.stored_value(body, "note", 64) is None
    assert storage_tables.stored_value(body, "missing", 64) is None
    assert storage_tables.stored_value(body, "order_number", 64) == "N" * 64
    assert storage_tables.stored_decimal({"change": 10.5}, "change") == "10.5000"
    assert storage_tables.stored_decimal({"change": Decimal("10.50")}, "change") is None
    for raw in ("abc", "1e20", "123456789012345", "9" * 20, 1e300, 10**15, Decimal("Infinity"), Decimal("NaN")):
        assert storage_tables.stored_decimal({"change": raw}, "change") is None


async def _datetime_parity(company):
    report = {}
    for name, field, _table, _column in _DATE_FIELDS:
        docs = storage_shared_v2.collection_for(company, name)
        real = storage_tables.collection_for(company, name)
        for doc_id, moment in _MOMENTS.items():
            body = {"_id": doc_id, field: moment, "status": "open"}
            await docs.insert_one(dict(body))
            await real.insert_one(dict(body))

        async def ids(api, query, direction, field=field):
            found = await api.find(query).sort(field, direction).to_list(10)
            return [doc["_id"] for doc in found]

        encoded = "2024-01-12 09:00:00"
        report[name] = {
            "asc": (await ids(docs, {}, 1), await ids(real, {}, 1)),
            "desc": (await ids(docs, {}, -1), await ids(real, {}, -1)),
            "gt": (
                await ids(docs, {field: {"$gt": "2024-01-10"}}, 1),
                await ids(real, {field: {"$gt": "2024-01-10"}}, 1),
            ),
            "gte": (
                await ids(docs, {field: {"$gte": "2024-01-10"}}, 1),
                await ids(real, {field: {"$gte": "2024-01-10"}}, 1),
            ),
            "eq": (
                await ids(docs, {field: encoded}, 1),
                await ids(real, {field: encoded}, 1),
            ),
        }
    return report


def _assert_datetime_parity(report):
    for name, got in report.items():
        assert got["asc"][0] == ["m2", "m3", "m1"], name
        assert got["desc"][0] == ["m1", "m3", "m2"], name
        assert got["gt"][0] == ["m3", "m1"], name
        assert got["gte"][0] == ["m3", "m1"], name
        assert got["eq"][0] == ["m3"], name
        for key, pair in got.items():
            assert pair[1] == pair[0], (name, key, pair)


def test_datetime_sort_range_and_equality_match_docs_v2(conn):
    report = asyncio.run(_datetime_parity("co-dt"))
    _assert_datetime_parity(report)
    for _name, _field, table, column in _DATE_FIELDS:
        stored = conn.execute(
            f"SELECT {column} FROM {table} WHERE id = ?",
            ("m3",),
        ).fetchone()[0]
        assert stored == "2024-01-12 09:00:00"


def test_numeric_range_uses_amount_index(conn):
    coll = _orders("co-num")

    async def run():
        await coll.insert_one({
            "_id": "low", "order_number": "L", "order_status": "open",
            "order_date": "2024-01-01", "total_amount": 10,
        })
        await coll.insert_one({
            "_id": "mid", "order_number": "M", "order_status": "open",
            "order_date": "2024-01-02", "total_amount": 10.5,
        })
        await coll.insert_one({
            "_id": "high", "order_number": "H", "order_status": "open",
            "order_date": "2024-01-03", "total_amount": 20,
        })
        store = storage_shared_v2.get_store()
        store.capture_plans = True
        store.python_scans = 0
        store.statements.clear()
        gt = await coll.find({"total_amount": {"$gt": 10}}).sort("total_amount", 1).to_list(10)
        gte = await coll.find({"total_amount": {"$gte": 10.5}}).sort("total_amount", 1).to_list(10)
        return {
            "gt": [doc["_id"] for doc in gt],
            "gte": [doc["_id"] for doc in gte],
            "scans": store.python_scans,
            "plan": store.last_plan,
            "sql": next(
                sql for sql in reversed(store.statements)
                if sql.lstrip().upper().startswith("SELECT DOC")
            ),
        }

    got = asyncio.run(run())
    assert got["gt"] == ["mid", "high"]
    assert got["gte"] == ["mid", "high"]
    assert got["scans"] == 0
    assert "total_amount >=" in got["sql"]
    assert "idx_t_orders_amount" in got["plan"]
    stored = conn.execute(
        "SELECT total_amount FROM t_orders WHERE company_id = ? AND id = ?",
        ("co-num", "mid"),
    ).fetchone()[0]
    assert float(stored) == 10.5


async def _case_distinct_companies():
    upper = storage_tables.collection_for("CoX", "orders")
    lower = storage_tables.collection_for("cox", "orders")
    await upper.create_index("order_number", unique=True)
    await upper.insert_one({
        "_id": "1", "order_number": "SAME", "order_status": "open", "order_date": "2024-01-01",
    })
    await lower.insert_one({
        "_id": "1", "order_number": "SAME", "order_status": "open", "order_date": "2024-01-02",
    })
    await upper.delete_one({"_id": "1"})
    with pytest.raises(DuplicateKeyError):
        await lower.insert_one({
            "_id": "2", "order_number": "SAME", "order_status": "open", "order_date": "2024-01-03",
        })
    await upper.insert_one({
        "_id": "3", "order_number": "SAME", "order_status": "open", "order_date": "2024-01-04",
    })
    kept = await lower.find({}).to_list(5)
    return [doc["_id"] for doc in kept]


_EXTREME_AMOUNTS = (
    ("sci", "1e20"),
    ("wide", "123456789012345"),
    ("text", "abc"),
    ("huge", 1e300),
    ("wide_num", 10**15),
    ("inf", Decimal("Infinity")),
    ("nan", Decimal("NaN")),
    ("small", 10),
    ("mid", 10.5),
)
_NULL_AMOUNT_IDS = ("sci", "wide", "text", "huge", "wide_num", "inf", "nan")


async def _amount_extreme_parity(company):
    docs = storage_shared_v2.collection_for(company, "orders")
    real = storage_tables.collection_for(company, "orders")
    for doc_id, amount in _EXTREME_AMOUNTS:
        body = {
            "_id": doc_id,
            "order_number": doc_id,
            "order_status": "open",
            "order_date": "2024-01-01",
            "total_amount": amount,
        }
        await docs.insert_one(dict(body))
        await real.insert_one(dict(body))
        stored = await real.find_one({"_id": doc_id})
        assert stored is not None
        assert stored["order_number"] == doc_id

    async def ids(api, query, direction=1):
        found = await api.find(query).sort("total_amount", direction).to_list(20)
        return [doc["_id"] for doc in found]

    queries = {
        "eq_text": {"total_amount": "abc"},
        "eq_sci": {"total_amount": "1e20"},
        "eq_wide": {"total_amount": "123456789012345"},
        "eq_num": {"total_amount": 10},
        "eq_inf": {"total_amount": "Infinity"},
        "eq_nan": {"total_amount": "NaN"},
        "gt": {"total_amount": {"$gt": 10}},
        "gte": {"total_amount": {"$gte": 10.5}},
        "lt": {"total_amount": {"$lt": 10**15}},
        "gt_text": {"total_amount": {"$gt": "2"}},
        "in_text": {"total_amount": {"$in": ["abc", "1e20", "NaN"]}},
        "in_mix": {"total_amount": {"$in": ["abc", 10, "Infinity"]}},
    }
    report = {}
    for name, query in queries.items():
        report[name] = (await ids(docs, query), await ids(real, query))
    report["asc"] = (await ids(docs, {}, 1), await ids(real, {}, 1))
    report["desc"] = (await ids(docs, {}, -1), await ids(real, {}, -1))
    return report


def _assert_amount_parity(report):
    expected = [doc_id for doc_id, _amount in _EXTREME_AMOUNTS]
    assert report["asc"][0]
    assert set(report["asc"][0]) == set(expected)
    assert len(report["asc"][0]) == len(expected)
    assert "text" in report["eq_text"][0]
    assert "sci" in report["eq_sci"][0]
    assert "huge" in report["gt"][0]
    assert "wide_num" in report["gt"][0]
    assert "small" not in report["gt"][0]
    assert "mid" in report["gte"][0]
    assert "small" in report["lt"][0]
    assert "huge" not in report["lt"][0]
    for name, pair in report.items():
        assert pair[1] == pair[0], (name, pair)


def test_extreme_amounts_match_docs_v2(conn):
    report = asyncio.run(_amount_extreme_parity("co-ext"))
    _assert_amount_parity(report)
    for doc_id in _NULL_AMOUNT_IDS:
        stored = conn.execute(
            "SELECT total_amount FROM t_orders WHERE company_id = ? AND id = ?",
            ("co-ext", doc_id),
        ).fetchone()[0]
        assert stored is None
    kept = conn.execute(
        "SELECT total_amount FROM t_orders WHERE company_id = ? AND id = ?",
        ("co-ext", "small"),
    ).fetchone()[0]
    assert float(kept) == 10


def _bank(store, company):
    return storage_tables.TableCollection(
        store, company, "bank_transactions", storage_tables.SPECS["bank_transactions"],
    )


def _docs_bank(store, company):
    return storage_shared_v2.SharedV2Collection(store, company, "bank_transactions")


async def _text_bound_parity(company):
    docs = storage_shared_v2.collection_for(company, "bank_transactions")
    real = storage_tables.collection_for(company, "bank_transactions")
    for doc_id, amount in (("a", 20), ("b", 3), ("c", 0), ("d", 9)):
        body = {"_id": doc_id, "amount": amount, "date": "2024-01-01"}
        await docs.insert_one(dict(body))
        await real.insert_one(dict(body))

    async def ids(api, query):
        found = await api.find(query).sort("_id", 1).to_list(20)
        return [doc["_id"] for doc in found]

    report = {
        "gt_text": (
            await ids(docs, {"amount": {"$gt": "1"}}),
            await ids(real, {"amount": {"$gt": "1"}}),
        ),
    }
    for doc_id, amount in (("e", "abc"),):
        body = {"_id": doc_id, "amount": amount, "date": "2024-01-02"}
        await docs.insert_one(dict(body))
        await real.insert_one(dict(body))
    queries = {
        "gt_with_text": {"amount": {"$gt": "1"}},
        "gte_text": {"amount": {"$gte": "3"}},
        "lt_text": {"amount": {"$lt": "3"}},
        "lte_text": {"amount": {"$lte": "3"}},
        "eq_text": {"amount": "abc"},
        "eq_number_text": {"amount": "20"},
        "in_mix": {"amount": {"$in": ["abc", 20, 0]}},
        "in_text": {"amount": {"$in": ["abc", "1"]}},
    }
    for name, query in queries.items():
        report[name] = (await ids(docs, query), await ids(real, query))
    return report


def _assert_text_bounds(report):
    assert report["gt_text"][0] == ["a", "b", "d"]
    assert report["gt_with_text"][0] == ["a", "b", "d", "e"]
    assert report["eq_text"][0] == ["e"]
    assert report["eq_number_text"][0] == []
    assert report["in_mix"][0] == ["a", "c", "e"]
    assert report["in_text"][0] == ["e"]
    for name, pair in report.items():
        assert pair[1] == pair[0], (name, pair)


def test_text_bounds_on_amount_match_docs_v2(conn):
    report = asyncio.run(_text_bound_parity("co-text"))
    _assert_text_bounds(report)


_AMOUNT_ORDER = (
    ("a", 5),
    ("b", 12.5),
    ("d", 100),
    ("e", 0.1),
    ("g", -3),
)
_SORT_COLS = (
    ("orders", "total_amount", "order_date", "order_status"),
    ("invoices", "grand_total", "issue_date", "status"),
    ("stock_movements", "change", "date", "status"),
    ("bank_transactions", "amount", "date", "match_status"),
)
_NULL_AMOUNTS = (
    ("a", 5),
    ("b", 12.5),
    ("d", 100),
    ("e", 0.1),
    ("g", -3),
    ("m", "missing"),
    ("n", None),
)
_MULTI_ROWS = (
    ("a", 5, "2024-03-01", "open"),
    ("b", 12.5, "2024-01-01", "open"),
    ("c", 12.5, "2024-06-01", "closed"),
    ("d", 100, "2024-01-01", "open"),
    ("e", 5, "2024-01-15", "closed"),
    ("f", None, "2024-02-01", "open"),
    ("g", -3, "2024-05-01", "draft"),
    ("h", "missing", "2024-01-01", "open"),
    ("i", 100, "2024-01-01", "open"),
)
_TIE_ROWS = (
    ("a", 5, "2024-03-01", "open"),
    ("b", 12.5, "2024-01-01", "open"),
    ("c", 12.5, "2024-06-01", "open"),
    ("d", 100, "2024-01-01", "closed"),
    ("e", 5, "2024-01-15", "closed"),
    ("i", 100, "2024-01-01", "closed"),
)
_TEXT_SORTS = (
    ("orders", "order_date", "order_status", "order_number"),
    ("invoices", "issue_date", "status", "invoice_number"),
)
_TEXT_ORDER_ROWS = (
    ("p", "2024-03-01", "open", "A-10"),
    ("q", "2024-01-09", "closed", "A-2"),
    ("r", "2024-01-10", "draft", "B-1"),
    ("s", "2024-01-10 09:00:00", "Open", "a-3"),
    ("t", "2024-12-01", "pending", "A-100"),
)


def _amount_body(doc_id, amount, amount_field, date_field, status_field, date_value, status):
    body = {"_id": doc_id, date_field: date_value, status_field: status}
    if amount != "missing":
        body[amount_field] = amount
    return body


async def _sorted_ids(api, sort, skip=0, limit=None):
    cursor = api.find({}).sort(sort)
    if skip:
        cursor = cursor.skip(skip)
    if limit is not None:
        cursor = cursor.limit(limit)
    found = await cursor.to_list(20)
    return [doc["_id"] for doc in found]


async def _one_id(api, sort):
    doc = await api.find_one({}, sort=sort)
    return None if doc is None else doc["_id"]


def _pairs(docs_ids, real_ids):
    return (docs_ids, real_ids)


async def _numeric_sort_parity(company):
    report = {}
    store = storage_shared_v2.get_store()
    for name, field, date_field, status_field in _SORT_COLS:
        docs = storage_shared_v2.collection_for(company, name)
        real = storage_tables.collection_for(company, name)
        gap = storage_tables.collection_for(company + "-gap", name)
        await gap.insert_one(_amount_body("gap", "missing", field, date_field, status_field, "2024-01-01", "open"))
        for doc_id, amount in _AMOUNT_ORDER:
            body = _amount_body(doc_id, amount, field, date_field, status_field, "2024-01-01", "open")
            await docs.insert_one(dict(body))
            await real.insert_one(dict(body))

        sides = {}
        for label, direction, skip, limit in (
            ("asc", 1, 0, None),
            ("desc", -1, 0, None),
            ("asc_limit", 1, 0, 3),
            ("desc_limit", -1, 0, 3),
            ("asc_page", 1, 1, 2),
            ("desc_page", -1, 2, 2),
        ):
            spec = [(field, direction)]
            sides[label] = _pairs(
                await _sorted_ids(docs, spec, skip, limit),
                await _sorted_ids(real, spec, skip, limit),
            )
        before = store.python_scans
        real_desc = await _sorted_ids(real, [(field, -1)], 0, 3)
        scans = store.python_scans - before
        sides["one_asc"] = _pairs(await _one_id(docs, [(field, 1)]), await _one_id(real, [(field, 1)]))
        sides["one_desc"] = _pairs(await _one_id(docs, [(field, -1)]), await _one_id(real, [(field, -1)]))
        sides["sql_desc_limit"] = real_desc
        sides["scans"] = scans
        report[name] = sides
    return report


def _assert_numeric_sort(report):
    asc = ["g", "e", "a", "b", "d"]
    desc = ["d", "b", "a", "e", "g"]
    for name, sides in report.items():
        assert sides["asc"][0] == asc, name
        assert sides["desc"][0] == desc, name
        assert sides["asc_limit"][0] == ["g", "e", "a"], name
        assert sides["desc_limit"][0] == ["d", "b", "a"], name
        assert sides["asc_page"][0] == ["e", "a"], name
        assert sides["desc_page"][0] == ["a", "e"], name
        assert sides["one_asc"][0] == "g", name
        assert sides["one_desc"][0] == "d", name
        assert sides["sql_desc_limit"] == ["d", "b", "a"], name
        assert sides["scans"] == 0, name
        for label, pair in sides.items():
            if label in ("scans", "sql_desc_limit"):
                continue
            assert pair[1] == pair[0], (name, label, pair)


def test_numeric_sort_matches_docs_v2(conn):
    report = asyncio.run(_numeric_sort_parity("co-sort"))
    _assert_numeric_sort(report)


async def _legacy_sort_parity(company):
    """Eksik/None tutar ve çok anahtar, sort_docs ile docs_v2'ye düşer."""
    report = {}
    store = storage_shared_v2.get_store()
    for name, field, date_field, status_field in _SORT_COLS:
        docs = storage_shared_v2.collection_for(company, name)
        real = storage_tables.collection_for(company, name)
        for doc_id, amount in _NULL_AMOUNTS:
            body = _amount_body(doc_id, amount, field, date_field, status_field, "2024-01-01", "open")
            await docs.insert_one(dict(body))
            await real.insert_one(dict(body))
        multi_company = company + "-mix"
        docs_mix = storage_shared_v2.collection_for(multi_company, name)
        real_mix = storage_tables.collection_for(multi_company, name)
        for doc_id, amount, date_value, status in _MULTI_ROWS:
            body = _amount_body(doc_id, amount, field, date_field, status_field, date_value, status)
            await docs_mix.insert_one(dict(body))
            await real_mix.insert_one(dict(body))
        tie_company = company + "-tie"
        docs_tie = storage_shared_v2.collection_for(tie_company, name)
        real_tie = storage_tables.collection_for(tie_company, name)
        for doc_id, amount, date_value, status in _TIE_ROWS:
            body = _amount_body(doc_id, amount, field, date_field, status_field, date_value, status)
            await docs_tie.insert_one(dict(body))
            await real_tie.insert_one(dict(body))

        amount_date = [(field, 1), (date_field, -1)]
        status_amount = [(status_field, 1), (field, -1)]
        sides = {}
        for label, spec, skip, limit, api_docs, api_real in (
            ("null_asc", [(field, 1)], 0, None, docs, real),
            ("null_desc", [(field, -1)], 0, None, docs, real),
            ("null_limit", [(field, -1)], 0, 3, docs, real),
            ("null_page", [(field, 1)], 1, 2, docs, real),
            ("amount_date", amount_date, 0, None, docs_mix, real_mix),
            ("amount_date_limit", amount_date, 0, 3, docs_mix, real_mix),
            ("amount_date_page", amount_date, 2, 2, docs_mix, real_mix),
            ("status_amount", status_amount, 0, None, docs_mix, real_mix),
            ("status_amount_limit", status_amount, 0, 3, docs_mix, real_mix),
            ("status_amount_page", status_amount, 1, 2, docs_mix, real_mix),
            ("tie_amount_date", amount_date, 0, None, docs_tie, real_tie),
            ("tie_status_amount", status_amount, 0, None, docs_tie, real_tie),
            ("tie_page", status_amount, 1, 2, docs_tie, real_tie),
        ):
            sides[label] = _pairs(
                await _sorted_ids(api_docs, spec, skip, limit),
                await _sorted_ids(api_real, spec, skip, limit),
            )
        sides["null_one"] = _pairs(await _one_id(docs, [(field, -1)]), await _one_id(real, [(field, -1)]))
        sides["amount_date_one"] = _pairs(
            await _one_id(docs_mix, amount_date), await _one_id(real_mix, amount_date),
        )
        sides["status_amount_one"] = _pairs(
            await _one_id(docs_mix, status_amount), await _one_id(real_mix, status_amount),
        )
        sides["tie_one"] = _pairs(
            await _one_id(docs_tie, status_amount), await _one_id(real_tie, status_amount),
        )
        before = store.python_scans
        await _sorted_ids(real, [(field, 1)])
        await _sorted_ids(real_mix, amount_date)
        await _sorted_ids(real_mix, status_amount)
        await _sorted_ids(real_tie, status_amount)
        sides["scans"] = store.python_scans - before
        report[name] = sides
    return report


def _assert_legacy_sort(report):
    null_asc = ["g", "e", "d", "b", "a", "m", "n"]
    null_desc = ["m", "n", "a", "b", "d", "e", "g"]
    for name, sides in report.items():
        assert sides["null_asc"][0] == null_asc, (name, sides["null_asc"])
        assert sides["null_desc"][0] == null_desc, (name, sides["null_desc"])
        assert sides["null_limit"][0] == null_desc[:3], name
        assert sides["null_page"][0] == null_asc[1:3], name
        assert sides["null_one"][0] == null_desc[0], name
        assert sides["amount_date"][0], name
        assert sides["status_amount"][0], name
        assert len(sides["amount_date"][0]) == len(_MULTI_ROWS), name
        assert len(sides["status_amount"][0]) == len(_MULTI_ROWS), name
        assert len(sides["tie_status_amount"][0]) == len(_TIE_ROWS), name
        assert sides["tie_status_amount"][0] != sorted(sides["tie_status_amount"][0]), name
        assert sides["scans"] >= 4, name
        for label, pair in sides.items():
            if label == "scans":
                continue
            assert pair[1] == pair[0], (name, label, pair)


def test_legacy_amount_sort_matches_docs_v2(conn):
    report = asyncio.run(_legacy_sort_parity("co-legacy"))
    _assert_legacy_sort(report)


async def _text_column_sort_parity(company):
    report = {}
    for name, date_field, status_field, number_field in _TEXT_SORTS:
        docs = storage_shared_v2.collection_for(company, name)
        real = storage_tables.collection_for(company, name)
        amount_field = "total_amount" if name == "orders" else "grand_total"
        for doc_id, date_value, status, number in _TEXT_ORDER_ROWS:
            body = {
                "_id": doc_id,
                date_field: date_value,
                status_field: status,
                number_field: number,
                amount_field: 1,
            }
            await docs.insert_one(dict(body))
            await real.insert_one(dict(body))
        sides = {}
        for field, label in (
            (date_field, "date"),
            (status_field, "status"),
            (number_field, "number"),
        ):
            for direction, suffix in ((1, "asc"), (-1, "desc")):
                key = f"{label}_{suffix}"
                sides[key] = (
                    await _sorted_ids(docs, [(field, direction)]),
                    await _sorted_ids(real, [(field, direction)]),
                )
            sides[f"{label}_page"] = (
                await _sorted_ids(docs, [(field, 1)], 1, 2),
                await _sorted_ids(real, [(field, 1)], 1, 2),
            )
        report[name] = sides
    return report


def _assert_text_column_sort(report):
    expected = {
        "date_asc": ["q", "r", "s", "p", "t"],
        "status_asc": ["s", "q", "r", "p", "t"],
        "number_asc": ["p", "t", "q", "r", "s"],
    }
    for name, sides in report.items():
        for key, ids in expected.items():
            assert sides[key][0] == ids, (name, key, sides[key])
            assert sides[key.replace("_asc", "_desc")][0] == list(reversed(ids)), name
            assert sides[key.replace("_asc", "_page")][0] == ids[1:3], name
        for label, pair in sides.items():
            assert pair[1] == pair[0], (name, label, pair)


def test_text_column_sort_matches_docs_v2(conn):
    report = asyncio.run(_text_column_sort_parity("co-colsort"))
    _assert_text_column_sort(report)


_LONG_PREFIX = "x" * 70
_LONG_TEXT_ROWS = (
    ("b", _LONG_PREFIX + "2", "2024-01-01", 2),
    ("a", _LONG_PREFIX + "0", "2024-01-01", 1),
    ("c", _LONG_PREFIX + "1", "2024-01-01", 3),
    ("d", "short", "2024-02-01", 0),
)
# docs_v2'de generated kolonu olmayan alanlar tam metinle sıralanır.
_LONG_FIELDS = (
    ("orders", "order_status", "order_date", "total_amount", True),
    ("invoices", "status", "issue_date", "grand_total", False),
    ("stock_movements", "doc_no", "date", "change", True),
    ("bank_transactions", "match_status", "date", "amount", True),
)


async def _long_text_sort_parity(company):
    report = {}
    store = storage_shared_v2.get_store()
    for name, text_field, date_field, amount_field, _full in _LONG_FIELDS:
        docs = storage_shared_v2.collection_for(company, name)
        real = storage_tables.collection_for(company, name)
        for doc_id, text, date_value, amount in _LONG_TEXT_ROWS:
            body = {
                "_id": doc_id,
                text_field: text,
                date_field: date_value,
                amount_field: amount,
            }
            await docs.insert_one(dict(body))
            await real.insert_one(dict(body))
        date_text = [(date_field, 1), (text_field, 1)]
        text_amount = [(text_field, 1), (amount_field, -1)]
        sides = {}
        plans = (
            ("asc", [(text_field, 1)], 0, None),
            ("desc", [(text_field, -1)], 0, None),
            ("limit", [(text_field, 1)], 0, 2),
            ("page", [(text_field, 1)], 1, 2),
            ("date_text", date_text, 0, None),
            ("date_text_page", date_text, 1, 2),
            ("text_amount", text_amount, 0, None),
            ("text_amount_page", text_amount, 1, 2),
        )
        for label, spec, skip, limit in plans:
            sides[label] = _pairs(
                await _sorted_ids(docs, spec, skip, limit),
                await _sorted_ids(real, spec, skip, limit),
            )
        sides["one_asc"] = _pairs(
            await _one_id(docs, [(text_field, 1)]),
            await _one_id(real, [(text_field, 1)]),
        )
        sides["one_desc"] = _pairs(
            await _one_id(docs, [(text_field, -1)]),
            await _one_id(real, [(text_field, -1)]),
        )
        sides["date_one"] = _pairs(
            await _one_id(docs, date_text),
            await _one_id(real, date_text),
        )
        sides["amount_one"] = _pairs(
            await _one_id(docs, text_amount),
            await _one_id(real, text_amount),
        )
        before = store.python_scans
        await _sorted_ids(real, [(text_field, 1)])
        await _sorted_ids(real, date_text)
        sides["scans"] = store.python_scans - before
        report[name] = sides
    return report


def _assert_long_text_sort(report):
    full_asc = ["d", "a", "c", "b"]
    prefix_asc = ["d", "a", "b", "c"]
    full_group = ["a", "c", "b", "d"]
    prefix_group = ["a", "b", "c", "d"]
    amount_desc = ["b", "c", "a", "d"]
    for name, _text, _date, _amount, full in _LONG_FIELDS:
        sides = report[name]
        asc = full_asc if full else prefix_asc
        desc = ["b", "c", "a", "d"] if full else ["a", "b", "c", "d"]
        grouped = full_group if full else prefix_group
        assert sides["asc"][0] == asc, (name, sides["asc"])
        assert sides["desc"][0] == desc, (name, sides["desc"])
        assert sides["limit"][0] == asc[:2], name
        assert sides["page"][0] == asc[1:3], name
        assert sides["one_asc"][0] == asc[0], name
        assert sides["one_desc"][0] == desc[0], name
        assert sides["date_text"][0] == grouped, (name, sides["date_text"])
        assert sides["date_text_page"][0] == grouped[1:3], name
        assert sides["date_one"][0] == grouped[0], name
        assert sides["text_amount"][0] == amount_desc, (name, sides["text_amount"])
        assert sides["text_amount_page"][0] == amount_desc[1:3], name
        assert sides["amount_one"][0] == amount_desc[0], name
        assert sides["scans"] == 0, name
        for label, pair in sides.items():
            if label == "scans":
                continue
            assert pair[1] == pair[0], (name, label, pair)


def test_long_text_sort_matches_docs_v2(conn):
    report = asyncio.run(_long_text_sort_parity("co-long"))
    _assert_long_text_sort(report)


_NULL_TEXT_ROWS = (
    ("0", "Paid", "2024-01-01", 1),
    ("1", None, "2024-01-01", 2),
    ("2", "Kapali", "2024-01-01", 3),
    ("3", "abc", "2024-01-01", 4),
)
_NULL_TEXT_FIELDS = (
    ("orders", "order_status", "order_date", "total_amount", "order_number"),
    ("invoices", "status", "issue_date", "grand_total", None),
    ("stock_movements", "status", "date", "change", None),
    ("bank_transactions", "match_status", "date", "amount", None),
)


def _json_null_text_order(dialect):
    """MariaDB JSON null'ı 'null' sıralar. SQLite json_extract NULL → 'None'."""
    if dialect == "mysql":
        return ["2", "0", "3", "1"], ["1", "3", "0", "2"]
    return ["2", "1", "0", "3"], ["3", "0", "1", "2"]


async def _json_null_text_sort_parity(company):
    report = {}
    store = storage_shared_v2.get_store()
    for name, text_field, date_field, amount_field, extra_field in _NULL_TEXT_FIELDS:
        docs = storage_shared_v2.collection_for(company, name)
        real = storage_tables.collection_for(company, name)
        for doc_id, text, date_value, amount in _NULL_TEXT_ROWS:
            body = {
                "_id": doc_id,
                text_field: text,
                date_field: date_value,
                amount_field: amount,
            }
            if extra_field:
                body[extra_field] = text
            await docs.insert_one(dict(body))
            await real.insert_one(dict(body))
        date_text = [(text_field, 1), (date_field, 1)]
        text_amount = [(text_field, 1), (amount_field, -1)]
        plans = [
            ("asc", [(text_field, 1)], 0, None),
            ("desc", [(text_field, -1)], 0, None),
            ("limit", [(text_field, 1)], 0, 2),
            ("page", [(text_field, 1)], 1, 2),
            ("date_text", date_text, 0, None),
            ("date_text_page", date_text, 1, 2),
            ("text_amount", text_amount, 0, None),
            ("text_amount_page", text_amount, 1, 2),
        ]
        if extra_field:
            plans.append(("extra_asc", [(extra_field, 1)], 0, None))
            plans.append(("extra_desc", [(extra_field, -1)], 0, None))
        sides = {}
        for label, spec, skip, limit in plans:
            sides[label] = _pairs(
                await _sorted_ids(docs, spec, skip, limit),
                await _sorted_ids(real, spec, skip, limit),
            )
        sides["one_asc"] = _pairs(
            await _one_id(docs, [(text_field, 1)]),
            await _one_id(real, [(text_field, 1)]),
        )
        sides["one_desc"] = _pairs(
            await _one_id(docs, [(text_field, -1)]),
            await _one_id(real, [(text_field, -1)]),
        )
        sides["date_one"] = _pairs(await _one_id(docs, date_text), await _one_id(real, date_text))
        sides["amount_one"] = _pairs(
            await _one_id(docs, text_amount), await _one_id(real, text_amount),
        )
        before = store.python_scans
        await _sorted_ids(real, [(text_field, 1)])
        await _sorted_ids(real, date_text)
        sides["scans"] = store.python_scans - before
        report[name] = sides
    report["dialect"] = store.dialect
    return report


def _assert_json_null_text_sort(report):
    asc, desc = _json_null_text_order(report["dialect"])
    amount_desc = ["3", "0", "1", "2"]
    for name, _text, _date, _amount, extra in _NULL_TEXT_FIELDS:
        sides = report[name]
        assert sides["asc"][0] == asc, (name, report["dialect"], sides["asc"])
        assert sides["desc"][0] == desc, (name, sides["desc"])
        assert sides["limit"][0] == asc[:2], name
        assert sides["page"][0] == asc[1:3], name
        assert sides["one_asc"][0] == asc[0], name
        assert sides["one_desc"][0] == desc[0], name
        assert sides["date_text"][0] == asc, (name, sides["date_text"])
        assert sides["date_text_page"][0] == asc[1:3], name
        assert sides["date_one"][0] == asc[0], name
        assert sides["text_amount"][0] == amount_desc, (name, sides["text_amount"])
        assert sides["text_amount_page"][0] == amount_desc[1:3], name
        assert sides["amount_one"][0] == amount_desc[0], name
        assert sides["scans"] == 0, name
        if extra:
            assert sides["extra_asc"][0] == asc, (name, sides["extra_asc"])
            assert sides["extra_desc"][0] == desc, name
        for label, pair in sides.items():
            if label == "scans":
                continue
            assert pair[1] == pair[0], (name, label, pair)


def test_json_null_text_sort_matches_docs_v2(conn):
    report = asyncio.run(_json_null_text_sort_parity("co-jnull"))
    _assert_json_null_text_sort(report)


async def _cached_amount_ids(store, company, query):
    found = await _bank(store, company).find(query).sort("_id", 1).to_list(10)
    return [doc["_id"] for doc in found]


def test_amount_safety_is_rechecked_for_each_store(tmp_path):
    path = tmp_path / "amounts.db"
    setup = sqlite3.connect(path, isolation_level=None, check_same_thread=False)
    _apply_conn(setup)
    setup.close()
    company = "co-vis"

    def open_store():
        conn = sqlite3.connect(path, check_same_thread=False, timeout=15)
        conn.row_factory = sqlite3.Row
        store = storage_shared_v2.SharedV2Store()
        store.attach(conn, "sqlite", owned=False)
        return conn, store

    conn_a, store_a = open_store()
    conn_b, store_b = open_store()
    query = {"amount": {"$gt": 10}}
    try:
        async def put(store, doc):
            await _docs_bank(store, company).insert_one(dict(doc))
            await _bank(store, company).insert_one(dict(doc))

        asyncio.run(put(store_a, {"_id": "p", "amount": 20, "date": "2024-01-01"}))
        first = asyncio.run(_cached_amount_ids(store_a, company, query))
        conn_a.rollback()
        asyncio.run(put(store_b, {"_id": "q", "amount": 10**15, "date": "2024-01-02"}))
        conn_b.commit()
        conn_a.rollback()
        second = asyncio.run(_cached_amount_ids(store_a, company, query))
        assert (company, "bank_transactions", "amount") not in store_a.scalar_ok
        assert (company, "bank_transactions", "amount") not in store_a.scalar_bad
        docs = asyncio.run(
            _docs_bank(store_a, company).find(query).sort("_id", 1).to_list(10)
        )
        assert first == ["p"]
        assert [doc["_id"] for doc in docs] == ["p", "q"]
        assert second == ["p", "q"]
    finally:
        conn_a.close()
        conn_b.close()
        storage_shared_v2.reset_store()


def test_case_distinct_companies_keep_unique_rows(conn):
    assert asyncio.run(_case_distinct_companies()) == ["1"]
    rows = conn.execute(
        "SELECT company_id FROM t_row_unique ORDER BY company_id, doc_id"
    ).fetchall()
    assert [row[0] for row in rows] == ["CoX", "cox"]


def _mariadb_dsn():
    raw = (
        os.environ.get("STORAGE_MARIADB_DSN")
        or os.environ.get("STORAGE_SHARED_V2_TEST_DSN")
        or ""
    ).strip()
    if not raw:
        return ""
    from mariadb_fixture import isolated_dsn
    return isolated_dsn(raw)


def _drop_mariadb(cur):
    for table in (
        "t_row_unique",
        "t_orders",
        "t_invoices",
        "t_stock_moves",
        "t_bank_transactions",
        "docs_v2_unique",
        "docs_v2",
        "storage_records",
        "storage_marker",
        "storage_meta",
        "schema_version",
    ):
        cur.execute(f"DROP TABLE IF EXISTS {table}")


def test_mariadb_datetime_case_collation_and_amount_index():
    dsn = _mariadb_dsn()
    if not dsn:
        pytest.skip("STORAGE_MARIADB_DSN / STORAGE_SHARED_V2_TEST_DSN yok")
    import pymysql

    from storage_migrations.session import connect

    parsed = urlparse(dsn.replace("mariadb://", "mysql://", 1).replace("mysql+pymysql://", "mysql://", 1))
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
            _drop_mariadb(cur)
    finally:
        admin.close()

    opened = connect(dsn, write=True)
    try:
        opened.execute(
            "SET SESSION sql_mode = "
            "'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'"
        )
        pack = _pack()
        first = apply(opened, confirm=True, dry_run=False)
        assert first.advanced == len(pack)
        fix = _by_name(pack)["utf8mb4_bin"]
        opened.execute(
            "UPDATE schema_version SET state = ?, step_no = ?, applied_at = ? WHERE version = ?",
            ("applying", 0, "", fix.version),
        )
        opened.commit()
        rerun = apply(opened, confirm=True, dry_run=False)
        row = next(item for item in rerun.rows if item.version == fix.version)
        assert row.state == "uygulandı"
        assert row.step == row.total
        collations = {
            str(item[0]): str(item[1]).lower()
            for item in opened.fetchall(
                "SELECT table_name, table_collation FROM information_schema.tables "
                "WHERE table_schema = DATABASE() AND table_name IN "
                "('t_orders','t_invoices','t_stock_moves','t_bank_transactions',"
                "'t_row_unique','docs_v2','docs_v2_unique')"
            )
        }
        assert set(collations) == {
            "t_orders", "t_invoices", "t_stock_moves", "t_bank_transactions",
            "t_row_unique", "docs_v2", "docs_v2_unique",
        }
        assert set(collations.values()) == {"utf8mb4_bin"}
        amount_type = opened.fetchall(
            "SELECT data_type FROM information_schema.columns "
            "WHERE table_schema = DATABASE() AND table_name = 't_orders' "
            "AND column_name = 'total_amount'"
        )[0][0]
        assert str(amount_type).lower() == "decimal"
        storage_shared_v2.reset_store()
        store = storage_shared_v2.get_store()
        store.attach(opened.conn, "mysql", owned=False)
        report = asyncio.run(_datetime_parity("co-dt"))
        _assert_datetime_parity(report)
        for _name, _field, table, column in _DATE_FIELDS:
            stored = opened.fetchall(
                f"SELECT {column} FROM {table} WHERE id = ?",
                ("m3",),
            )[0][0]
            assert stored == "2024-01-12 09:00:00"
        assert asyncio.run(_case_distinct_companies()) == ["1"]
        companies = [
            str(item[0])
            for item in opened.fetchall(
                "SELECT company_id FROM t_row_unique ORDER BY company_id, doc_id"
            )
        ]
        assert companies == ["CoX", "cox"]
        orders = storage_tables.collection_for("co-num", "orders")

        async def amounts():
            await orders.insert_one({
                "_id": "low", "order_number": "L", "order_status": "open",
                "total_amount": 10, "order_date": "2024-01-01",
            })
            await orders.insert_one({
                "_id": "mid", "order_number": "M", "order_status": "open",
                "total_amount": 10.5, "order_date": "2024-01-02",
            })
            await orders.insert_one({
                "_id": "high", "order_number": "H", "order_status": "open",
                "total_amount": 20, "order_date": "2024-01-03",
            })
            store.python_scans = 0
            found = await orders.find({"total_amount": {"$gt": 10}}).sort("total_amount", 1).to_list(10)
            return [doc["_id"] for doc in found], store.python_scans

        ids, scans = asyncio.run(amounts())
        assert ids == ["mid", "high"]
        assert scans == 0
        plan = opened.fetchall(
            "EXPLAIN SELECT doc FROM t_orders WHERE company_id = ? AND total_amount > ?",
            ("co-num", "10.0000"),
        )
        blob = " ".join(str(part) for row in plan for part in row).lower()
        assert "idx_t_orders_amount" in blob
        extreme = asyncio.run(_amount_extreme_parity("co-ext"))
        _assert_amount_parity(extreme)
        for doc_id in _NULL_AMOUNT_IDS:
            stored = opened.fetchall(
                "SELECT total_amount FROM t_orders WHERE company_id = ? AND id = ?",
                ("co-ext", doc_id),
            )[0][0]
            assert stored is None
        kept = opened.fetchall(
            "SELECT total_amount FROM t_orders WHERE company_id = ? AND id = ?",
            ("co-ext", "mid"),
        )[0][0]
        assert float(kept) == 10.5
        _assert_text_bounds(asyncio.run(_text_bound_parity("co-text")))
        _assert_numeric_sort(asyncio.run(_numeric_sort_parity("co-sort")))
        _assert_legacy_sort(asyncio.run(_legacy_sort_parity("co-legacy")))
        _assert_text_column_sort(asyncio.run(_text_column_sort_parity("co-colsort")))
        _assert_long_text_sort(asyncio.run(_long_text_sort_parity("co-long")))
        _assert_json_null_text_sort(asyncio.run(_json_null_text_sort_parity("co-jnull")))
        other = pymysql.connect(
            host=parsed.hostname or "127.0.0.1",
            port=parsed.port or 3306,
            user=unquote(parsed.username or ""),
            password=unquote(parsed.password or ""),
            database=database,
            charset="utf8mb4",
            autocommit=False,
            connect_timeout=5,
        )
        try:
            with other.cursor() as cur:
                cur.execute(
                    "SET SESSION sql_mode = "
                    "'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'"
                )
            other.commit()
            store_b = storage_shared_v2.SharedV2Store()
            store_b.attach(other, "mysql", owned=False)
            company = "co-vis"
            query = {"amount": {"$gt": 10}}

            async def put(store, doc):
                await _docs_bank(store, company).insert_one(dict(doc))
                await _bank(store, company).insert_one(dict(doc))

            asyncio.run(put(store, {"_id": "p", "amount": 20, "date": "2024-01-01"}))
            first = asyncio.run(_cached_amount_ids(store, company, query))
            opened.rollback()
            asyncio.run(put(store_b, {"_id": "q", "amount": 10**15, "date": "2024-01-02"}))
            other.commit()
            opened.rollback()
            second = asyncio.run(_cached_amount_ids(store, company, query))
            assert (company, "bank_transactions", "amount") not in store.scalar_ok
            assert (company, "bank_transactions", "amount") not in store.scalar_bad
            docs = asyncio.run(
                _docs_bank(store, company).find(query).sort("_id", 1).to_list(10)
            )
            assert first == ["p"]
            assert [doc["_id"] for doc in docs] == ["p", "q"]
            assert second == ["p", "q"]
        finally:
            other.close()
    finally:
        storage_shared_v2.reset_store()
        try:
            opened.rollback()
            with opened.conn.cursor() as cur:
                _drop_mariadb(cur)
            opened.commit()
        finally:
            opened.close()


def test_mariadb_strict_migration_and_concurrent_unique():
    dsn = _mariadb_dsn()
    if not dsn:
        pytest.skip("STORAGE_MARIADB_DSN / STORAGE_SHARED_V2_TEST_DSN yok")
    import pymysql

    from storage_migrations.session import connect

    parsed = urlparse(dsn.replace("mariadb://", "mysql://", 1).replace("mysql+pymysql://", "mysql://", 1))
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
            _drop_mariadb(cur)
    finally:
        admin.close()

    pack = _pack()
    real = _real(pack)
    opened = connect(dsn, write=True)
    try:
        opened.execute(
            "SET SESSION sql_mode = "
            "'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'"
        )
        first = apply(opened, confirm=True, dry_run=False)
        assert first.advanced == len(pack)
        assert {row.version for row in first.rows} == {item.version for item in pack}
        assert [row.state for row in first.rows] == ["uygulandı"] * len(pack)
        second = apply(opened, confirm=True, dry_run=False)
        assert second.advanced == 0
        total = len(steps_for(real, opened.dialect))
        opened.execute(
            "UPDATE schema_version SET state = ?, step_no = ?, applied_at = ? WHERE version = ?",
            ("applying", total - 1, "", real.version),
        )
        opened.commit()
        resumed = apply(opened, confirm=True, dry_run=False)
        row = next(item for item in resumed.rows if item.version == real.version)
        assert row.state == "uygulandı"
        assert row.step == total
        indexes = {
            str(item[0])
            for item in opened.fetchall(
                "SELECT index_name FROM information_schema.statistics "
                "WHERE table_schema = DATABASE() AND table_name = 't_orders'"
            )
        }
        assert "idx_t_orders_date" in indexes
        assert "idx_t_orders_status" in indexes
        assert "idx_t_orders_contact" in indexes
        doc_type = opened.fetchall(
            "SELECT data_type FROM information_schema.columns "
            "WHERE table_schema = DATABASE() AND table_name = 't_invoices' AND column_name = 'doc'"
        )[0][0]
        assert str(doc_type).lower() in ("json", "longtext")
        status_type = opened.fetchall(
            "SELECT column_type FROM information_schema.columns "
            "WHERE table_schema = DATABASE() AND table_name = 't_invoices' AND column_name = 'status'"
        )[0][0]
        assert "varchar(64)" in str(status_type).lower()
    finally:
        opened.close()

    def connect_worker():
        worker = pymysql.connect(
            host=parsed.hostname or "127.0.0.1",
            port=parsed.port or 3306,
            user=unquote(parsed.username or ""),
            password=unquote(parsed.password or ""),
            database=database,
            charset="utf8mb4",
            autocommit=False,
            connect_timeout=5,
        )
        with worker.cursor() as cur:
            cur.execute(
                "SET SESSION sql_mode = "
                "'STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION'"
            )
            cur.execute("SET SESSION innodb_lock_wait_timeout = 2")
        worker.commit()
        return worker

    storage_shared_v2.reset_store()
    original = storage_tables.TableCollection._sync_unique
    setup = connect_worker()
    number = "F" * 80
    try:
        store = storage_shared_v2.SharedV2Store()
        store.attach(setup, "mysql", owned=False)
        api = storage_tables.TableCollection(store, CO, "invoices", storage_tables.SPECS["invoices"])

        async def prepare():
            await api.create_index("invoice_number", unique=True)
            await api.insert_one({
                "_id": "keep",
                "invoice_number": number,
                "status": "S" * 100,
                "issue_date": "2024-01-01",
                "grand_total": "1",
            })

        asyncio.run(prepare())
        kept = asyncio.run(api.find_one({"invoice_number": number}))
        assert kept["status"] == "S" * 100
        assert asyncio.run(api.find({"status": "S" * 64}).to_list(5)) == []
        column = setup.cursor()
        column.execute(
            "SELECT status, invoice_number FROM t_invoices WHERE id = %s",
            ("keep",),
        )
        stored = column.fetchone()
        column.close()
        assert stored[0] == "S" * storage_tables.TEXT_WIDTH
        assert stored[1] == "F" * storage_tables.TEXT_WIDTH
        indexes = store.indexes
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

        storage_tables.TableCollection._sync_unique = synced
        outcomes = []
        errors = []

        def worker(doc_id):
            local = connect_worker()
            try:
                local_store = storage_shared_v2.SharedV2Store()
                local_store.attach(local, "mysql", owned=False)
                local_store.indexes = indexes
                coll = storage_tables.TableCollection(
                    local_store, CO, "invoices", storage_tables.SPECS["invoices"],
                )
                try:
                    asyncio.run(coll.insert_one({
                        "_id": doc_id,
                        "invoice_number": "RACE",
                        "status": "open",
                        "issue_date": "2024-02-01",
                    }))
                    outcomes.append("ok")
                except DuplicateKeyError:
                    outcomes.append("dup")
                except Exception as exc:
                    errors.append(f"{doc_id} {type(exc).__name__}: {exc}")
            except Exception as exc:
                errors.append(f"{doc_id} bağlantı {type(exc).__name__}: {exc}")
            finally:
                local.close()

        threads = [
            threading.Thread(target=worker, args=("race-a",), name="race-a"),
            threading.Thread(target=worker, args=("race-b",), name="race-b"),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=20)
        assert not [thread.name for thread in threads if thread.is_alive()]
        assert errors == [], errors
        assert sorted(outcomes) == ["dup", "ok"]
        setup.commit()
        with setup.cursor() as cur:
            cur.execute(
                "SELECT id FROM t_invoices WHERE company_id = %s AND "
                "JSON_UNQUOTE(JSON_EXTRACT(doc, '$.invoice_number')) = %s",
                (CO, "RACE"),
            )
            raced = cur.fetchall()
        assert len(raced) == 1
    finally:
        storage_tables.TableCollection._sync_unique = original
        storage_shared_v2.reset_store()
        try:
            setup.close()
        finally:
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
                    _drop_mariadb(cur)
            finally:
                admin.close()
