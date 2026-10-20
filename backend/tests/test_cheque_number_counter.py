"""Çek/senet portföy numarası: atomik sayaç.

Bellek içi koleksiyon. cheques._db fixture içinde bağlanır.
Modül ortam değişkeni yazmaz; canlı API, port ve veritabanı kullanmaz.
"""
from __future__ import annotations

import asyncio
import copy
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "tests"))

import cheques  # noqa: E402
import tenant_scope  # noqa: E402
from dashboard_memdb import MemColl, MemDB, _split_field_ops  # noqa: E402
from mysql_store import apply_update, match_query, new_upsert_doc  # noqa: E402


def _run(coro):
    return asyncio.run(coro)


def _year() -> str:
    return datetime.now(timezone.utc).strftime("%Y")


class _Coll(MemColl):
    """$setOnInsert tohumu. MemColl.update_one upsert yazmaz; sayaç burada yazılır."""

    async def update_one(self, query, update, upsert=False):
        tenant_scope.check(self.name, "update_one", query=query, update=update, upsert=upsert)
        query = _split_field_ops(query or {})
        for i, doc in enumerate(self.docs):
            if not match_query(doc, query):
                continue
            self.docs[i] = apply_update(doc, update, query)
            return SimpleNamespace(modified_count=1, matched_count=1)
        if not upsert:
            return SimpleNamespace(modified_count=0, matched_count=0)
        created = new_upsert_doc(update, query)
        self.docs.append(copy.deepcopy(created))
        return SimpleNamespace(modified_count=0, matched_count=0, upserted_id=created.get("_id"))


class _DB(MemDB):
    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = _Coll(name, self)
            self._cols[name] = coll
        return coll


@pytest.fixture
def db(monkeypatch):
    database = _DB()
    monkeypatch.setattr(cheques, "_db", database)
    return database


def _cheque(company_id: str, number: str, cid: str) -> dict:
    return {"_id": cid, "company_id": company_id, "number": number, "instrument": "cheque"}


def test_first_cheque_and_promissory_use_separate_counters(db):
    year = _year()
    cek = _run(cheques._next_number("co", "cheque"))
    snt = _run(cheques._next_number("co", "promissory"))
    cek2 = _run(cheques._next_number("co", "cheque"))
    snt2 = _run(cheques._next_number("co", "promissory"))
    assert cek == f"CEK-{year}-0001"
    assert snt == f"SNT-{year}-0001"
    assert cek2 == f"CEK-{year}-0002"
    assert snt2 == f"SNT-{year}-0002"
    assert {doc["_id"] for doc in db.counters.docs} == {f"CEK-{year}-co", f"SNT-{year}-co"}
    assert {doc["_id"]: doc["seq"] for doc in db.counters.docs} == {
        f"CEK-{year}-co": 2,
        f"SNT-{year}-co": 2,
    }


def test_seed_uses_highest_numeric_suffix_not_count(db):
    year = _year()
    prev = str(int(year) - 1)
    db.cheques.docs.extend([
        _cheque("co", f"CEK-{year}-0005", "a"),
        _cheque("co", f"CEK-{year}-0002", "b"),
        _cheque("co", f"CEK-{year}-D001", "demo"),
        _cheque("co", f"CEK-{prev}-0099", "old"),
        _cheque("co", f"SNT-{year}-0088", "senet"),
        _cheque("other", f"CEK-{year}-0050", "foreign"),
    ])
    before = copy.deepcopy(db.cheques.docs)
    number = _run(cheques._next_number("co", "cheque"))
    assert number == f"CEK-{year}-0006"
    assert db.cheques.docs == before
    assert db.counters.docs[0]["_id"] == f"CEK-{year}-co"
    assert db.counters.docs[0]["seq"] == 6


def test_parsed_max_ignores_lexical_order(db):
    year = _year()
    db.cheques.docs.extend([
        _cheque("co", f"CEK-{year}-9999", "a"),
        _cheque("co", f"CEK-{year}-10000", "b"),
    ])
    number = _run(cheques._next_number("co", "cheque"))
    assert number == f"CEK-{year}-10001"


def test_deleted_cheque_does_not_reuse_number(db):
    year = _year()
    db.cheques.docs.extend([
        _cheque("co", f"CEK-{year}-0005", "a"),
        _cheque("co", f"CEK-{year}-0002", "b"),
    ])
    first = _run(cheques._next_number("co", "cheque"))
    db.cheques.docs[:] = [doc for doc in db.cheques.docs if doc["_id"] != "a"]
    second = _run(cheques._next_number("co", "cheque"))
    assert first == f"CEK-{year}-0006"
    assert second == f"CEK-{year}-0007"
    assert [doc["_id"] for doc in db.counters.docs] == [f"CEK-{year}-co"]


def test_concurrent_calls_return_distinct_numbers(db):
    year = _year()

    async def _all():
        return await asyncio.gather(*(cheques._next_number("co", "cheque") for _ in range(20)))

    numbers = _run(_all())
    assert len(numbers) == 20
    assert len(set(numbers)) == 20
    assert set(numbers) == {f"CEK-{year}-{n:04d}" for n in range(1, 21)}
    assert [doc["_id"] for doc in db.counters.docs] == [f"CEK-{year}-co"]
    assert db.counters.docs[0]["seq"] == 20


def test_companies_have_separate_counters(db):
    year = _year()
    db.cheques.docs.append(_cheque("A", f"CEK-{year}-0005", "a5"))
    a1 = _run(cheques._next_number("A", "cheque"))
    b1 = _run(cheques._next_number("B", "cheque"))
    a2 = _run(cheques._next_number("A", "cheque"))
    b_snt = _run(cheques._next_number("B", "promissory"))
    assert [a1, a2] == [f"CEK-{year}-0006", f"CEK-{year}-0007"]
    assert b1 == f"CEK-{year}-0001"
    assert b_snt == f"SNT-{year}-0001"
    assert {doc["_id"] for doc in db.counters.docs} == {
        f"CEK-{year}-A",
        f"CEK-{year}-B",
        f"SNT-{year}-B",
    }
