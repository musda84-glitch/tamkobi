"""MSR belge numarası: atomik sayaç, silinen kayıt ve eşzamanlı istek."""
import asyncio
import copy
import os
import sys
from datetime import datetime, timezone
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import expenses  # noqa: E402
import personnel_payments  # noqa: E402
from mysql_store import apply_update, match_query, new_upsert_doc  # noqa: E402


def _run(coro):
    return asyncio.run(coro)


def _year() -> str:
    return datetime.now(timezone.utc).strftime("%Y")


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, n=None):
        if n is None:
            return list(self.rows)
        return list(self.rows[:n])


class _Coll:
    def __init__(self):
        self.docs = []

    async def find_one(self, query=None, projection=None):
        for doc in self.docs:
            if match_query(doc, query or {}):
                return copy.deepcopy(doc)
        return None

    def find(self, query=None, projection=None):
        rows = [copy.deepcopy(doc) for doc in self.docs if match_query(doc, query or {})]
        return _Cursor(rows)

    async def insert_one(self, doc):
        self.docs.append(copy.deepcopy(doc))
        return SimpleNamespace(inserted_id=doc.get("_id"))

    async def update_one(self, query, update, upsert=False):
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
        self.expenses = _Coll()
        self.counters = _Coll()


def _expense(company_id, number, eid):
    return {"_id": eid, "company_id": company_id, "expense_number": number}


def _bind(db):
    prev = expenses._db
    expenses.init(db)
    return prev


def test_empty_company_starts_at_0001():
    db = _Db()
    year = _year()
    prev = _bind(db)
    try:
        number = _run(expenses._next_number("co-empty"))
    finally:
        expenses._db = prev
    assert number == f"MSR-{year}-0001"
    assert db.counters.docs[0]["_id"] == f"MSR-{year}-co-empty"
    assert db.counters.docs[0]["seq"] == 1


def test_seed_uses_highest_numeric_suffix_not_count():
    db = _Db()
    year = _year()
    prev_year = str(int(year) - 1)
    db.expenses.docs.extend([
        _expense("co", f"MSR-{year}-0007", "a"),
        _expense("co", f"MSR-{year}-0003", "b"),
        _expense("co", f"MSR-{year}-D001", "demo"),
        _expense("co", f"MSR-{prev_year}-0099", "old"),
        _expense("other", f"MSR-{year}-0050", "foreign"),
    ])
    before = copy.deepcopy(db.expenses.docs)
    number = _run(expenses.next_msr_number(db, "co"))
    assert number == f"MSR-{year}-0008"
    assert db.expenses.docs == before


def test_parsed_max_ignores_lexical_order():
    db = _Db()
    year = _year()
    db.expenses.docs.extend([
        _expense("co", f"MSR-{year}-9999", "a"),
        _expense("co", f"MSR-{year}-10000", "b"),
        _expense("co", f"MSR-{year}-D001", "demo"),
    ])
    number = _run(expenses.next_msr_number(db, "co"))
    assert number == f"MSR-{year}-10001"


def test_deleted_record_does_not_lower_counter():
    db = _Db()
    year = _year()
    db.expenses.docs.extend([
        _expense("co", f"MSR-{year}-0007", "a"),
        _expense("co", f"MSR-{year}-0003", "b"),
    ])
    prev = _bind(db)
    try:
        first = _run(expenses._next_number("co"))
        db.expenses.docs[:] = [d for d in db.expenses.docs if d["_id"] != "a"]
        second = _run(personnel_payments._next_msr(db, "co"))
    finally:
        expenses._db = prev
    assert first == f"MSR-{year}-0008"
    assert second == f"MSR-{year}-0009"
    assert [d["_id"] for d in db.counters.docs] == [f"MSR-{year}-co"]


def test_concurrent_calls_return_distinct_numbers():
    db = _Db()
    year = _year()
    prev = _bind(db)

    async def alloc(i):
        if i % 2:
            return await expenses._next_number("co")
        return await personnel_payments._next_msr(db, "co")

    async def _all():
        return await asyncio.gather(*(alloc(i) for i in range(20)))

    try:
        numbers = _run(_all())
    finally:
        expenses._db = prev
    assert len(numbers) == 20
    assert len(set(numbers)) == 20
    assert set(numbers) == {f"MSR-{year}-{n:04d}" for n in range(1, 21)}


def test_expenses_and_personnel_share_one_counter():
    db = _Db()
    year = _year()
    prev = _bind(db)
    try:
        first = _run(expenses._next_number("co"))
        second = _run(personnel_payments._next_msr(db, "co"))
    finally:
        expenses._db = prev
    assert first == f"MSR-{year}-0001"
    assert second == f"MSR-{year}-0002"
    assert [d["_id"] for d in db.counters.docs] == [f"MSR-{year}-co"]
    assert db.counters.docs[0]["seq"] == 2


def test_companies_have_separate_counters():
    db = _Db()
    year = _year()
    db.expenses.docs.append(_expense("A", f"MSR-{year}-0007", "a7"))
    prev = _bind(db)
    try:
        a1 = _run(expenses._next_number("A"))
        b1 = _run(personnel_payments._next_msr(db, "B"))
        a2 = _run(personnel_payments._next_msr(db, "A"))
        b2 = _run(expenses.next_msr_number(db, "B"))
    finally:
        expenses._db = prev
    assert [a1, a2] == [f"MSR-{year}-0008", f"MSR-{year}-0009"]
    assert [b1, b2] == [f"MSR-{year}-0001", f"MSR-{year}-0002"]
    assert {d["_id"] for d in db.counters.docs} == {f"MSR-{year}-A", f"MSR-{year}-B"}
