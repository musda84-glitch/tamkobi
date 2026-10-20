"""Dış ticaret dosya numarası: atomik sayaç, silinen kayıt ve eşzamanlı istek."""
import asyncio
import copy
import os
import sys
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import trade  # noqa: E402
from mysql_store import apply_update, match_query, new_upsert_doc  # noqa: E402


def _run(coro):
    return asyncio.run(coro)


def _year() -> str:
    return datetime.now(timezone.utc).strftime("%Y")


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, n=None):
        await asyncio.sleep(0)
        if n is None:
            return list(self.rows)
        return list(self.rows[:n])


class _Coll:
    def __init__(self):
        self.docs = []

    async def find_one(self, query=None, projection=None):
        await asyncio.sleep(0)
        for doc in self.docs:
            if match_query(doc, query or {}):
                return copy.deepcopy(doc)
        return None

    def find(self, query=None, projection=None):
        rows = [copy.deepcopy(doc) for doc in self.docs if match_query(doc, query or {})]
        return _Cursor(rows)

    async def insert_one(self, doc):
        await asyncio.sleep(0)
        self.docs.append(copy.deepcopy(doc))
        return SimpleNamespace(inserted_id=doc.get("_id"))

    async def update_one(self, query, update, upsert=False):
        await asyncio.sleep(0)
        for i, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                self.docs[i] = apply_update(doc, update, query)
                return SimpleNamespace(matched_count=1, modified_count=1, upserted_id=None)
        if not upsert:
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)
        created = new_upsert_doc(update, query)
        self.docs.append(created)
        return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=created.get("_id"))

    async def find_one_and_update(self, query, update, upsert=False, return_document=True, projection=None):
        await asyncio.sleep(0)
        for i, doc in enumerate(self.docs):
            if not match_query(doc, query or {}):
                continue
            before = copy.deepcopy(doc)
            self.docs[i] = apply_update(doc, update, query)
            found = self.docs[i] if return_document else before
            return copy.deepcopy(found)
        if not upsert:
            return None
        created = new_upsert_doc(update, query)
        self.docs.append(created)
        return copy.deepcopy(created) if return_document else None


class _Db:
    def __init__(self):
        self.trade_files = _Coll()
        self.counters = _Coll()


def _file(company_id, number, fid, kind="export"):
    return {"_id": fid, "company_id": company_id, "kind": kind, "file_number": number}


@pytest.fixture
def db(monkeypatch):
    database = _Db()
    monkeypatch.setattr(trade, "_db", database)
    return database


def test_first_export_and_import_start_at_0001(db):
    year = _year()
    export_no = _run(trade._next_file_number("co", "export"))
    import_no = _run(trade._next_file_number("co", "import"))
    assert export_no == f"IHR-{year}-0001"
    assert import_no == f"ITH-{year}-0001"
    assert {d["_id"]: d["seq"] for d in db.counters.docs} == {
        f"TRADE-IHR-{year}-co": 1,
        f"TRADE-ITH-{year}-co": 1,
    }


def test_next_after_0004_and_0001_is_0005(db):
    year = _year()
    prev = str(int(year) - 1)
    db.trade_files.docs.extend([
        _file("co", f"IHR-{year}-0004", "a"),
        _file("co", f"IHR-{year}-0001", "b"),
        _file("co", f"IHR-{year}-D001", "demo"),
        _file("co", f"IHR-{prev}-0099", "old"),
        _file("co", f"ITH-{year}-0050", "imp", "import"),
        _file("other", f"IHR-{year}-0008", "foreign"),
    ])
    before = copy.deepcopy(db.trade_files.docs)
    number = _run(trade._next_file_number("co", "export"))
    assert number == f"IHR-{year}-0005"
    assert db.trade_files.docs == before
    assert db.counters.docs[0]["_id"] == f"TRADE-IHR-{year}-co"
    assert db.counters.docs[0]["seq"] == 5


def test_seed_uses_numeric_max_not_lexical_order(db):
    year = _year()
    db.trade_files.docs.extend([
        _file("co", f"IHR-{year}-9999", "a"),
        _file("co", f"IHR-{year}-10000", "b"),
        _file("co", f"IHR-{year}-D001", "demo"),
    ])
    number = _run(trade._next_file_number("co", "export"))
    assert number == f"IHR-{year}-10001"


def test_deleted_file_does_not_reuse_number(db):
    year = _year()
    db.trade_files.docs.extend([
        _file("co", f"IHR-{year}-0004", "a"),
        _file("co", f"IHR-{year}-0001", "b"),
    ])
    first = _run(trade._next_file_number("co", "export"))
    db.trade_files.docs[:] = [d for d in db.trade_files.docs if d["_id"] != "a"]
    second = _run(trade._next_file_number("co", "export"))
    assert first == f"IHR-{year}-0005"
    assert second == f"IHR-{year}-0006"
    assert [d["_id"] for d in db.counters.docs] == [f"TRADE-IHR-{year}-co"]
    assert db.counters.docs[0]["seq"] == 6


def test_concurrent_calls_return_distinct_numbers(db):
    year = _year()

    async def _all():
        return await asyncio.gather(*(trade._next_file_number("co", "export") for _ in range(20)))

    numbers = _run(_all())
    assert len(numbers) == 20
    assert len(set(numbers)) == 20
    assert set(numbers) == {f"IHR-{year}-{n:04d}" for n in range(1, 21)}
    assert db.counters.docs[0]["_id"] == f"TRADE-IHR-{year}-co"
    assert db.counters.docs[0]["seq"] == 20


def test_companies_have_separate_counters(db):
    year = _year()
    db.trade_files.docs.append(_file("A", f"IHR-{year}-0004", "a4"))
    a1 = _run(trade._next_file_number("A", "export"))
    b1 = _run(trade._next_file_number("B", "export"))
    a2 = _run(trade._next_file_number("A", "export"))
    b_import = _run(trade._next_file_number("B", "import"))
    assert [a1, a2] == [f"IHR-{year}-0005", f"IHR-{year}-0006"]
    assert b1 == f"IHR-{year}-0001"
    assert b_import == f"ITH-{year}-0001"
    assert {d["_id"] for d in db.counters.docs} == {
        f"TRADE-IHR-{year}-A",
        f"TRADE-IHR-{year}-B",
        f"TRADE-ITH-{year}-B",
    }


def test_manual_file_number_is_kept(db):
    year = _year()
    user = {"company_ids": ["co"], "active_company_id": "co"}
    created = _run(trade.create_trade_file({
        "company_id": "co",
        "kind": "export",
        "contact_name": "TEST Cari",
        "currency": "USD",
        "fx_rate": 40,
        "file_number": "EL-2026-7",
        "items": [{"name": "Kalem", "quantity": 1, "unit_price_fx": 10}],
    }, user))
    assert created["file_number"] == "EL-2026-7"
    assert db.trade_files.docs[0]["file_number"] == "EL-2026-7"
    assert db.counters.docs == []
    auto = _run(trade._next_file_number("co", "export"))
    assert auto == f"IHR-{year}-0001"
