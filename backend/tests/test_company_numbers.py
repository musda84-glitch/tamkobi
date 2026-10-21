"""Şirket ID: sıralı backfill, tekillik, eşzamanlı üretim, kiracı salt okunur."""
from __future__ import annotations

import asyncio
import copy
import threading
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

import pytest

import company_numbers
from mysql_store import DuplicateKeyError, apply_update, match_query, new_upsert_doc

START = company_numbers.START


def _run(coro):
    return asyncio.run(coro)


class Coll:
    """Bellek koleksiyonu. update_one_atomic seq karşılaştırmasını kilitler."""

    def __init__(self, *, atomic=True, yield_after_read=True):
        self.docs = {}
        self._lock = threading.Lock()
        self._atomic = atomic
        self._yield = yield_after_read
        if not atomic:
            self.update_one_atomic = None

    async def find_one(self, query=None, projection=None, sort=None):
        with self._lock:
            found = None
            for doc in self.docs.values():
                if match_query(doc, query or {}):
                    found = copy.deepcopy(doc)
                    break
        if self._yield:
            await asyncio.sleep(0)
        return found

    def find(self, query=None, projection=None):
        with self._lock:
            rows = [copy.deepcopy(doc) for doc in self.docs.values() if match_query(doc, query or {})]

        class Cur:
            def __init__(self, rows):
                self._rows = rows

            def sort(self, key, direction=1):
                return self

            async def to_list(self, n=None):
                if n is None:
                    return list(self._rows)
                return list(self._rows[:n])

        return Cur(rows)

    async def insert_one(self, doc):
        with self._lock:
            if doc.get("_id") in self.docs:
                raise DuplicateKeyError(doc.get("_id"))
            self.docs[doc["_id"]] = copy.deepcopy(doc)
        return SimpleNamespace(inserted_id=doc.get("_id"))

    async def update_one(self, query, update, upsert=False):
        with self._lock:
            for key, doc in list(self.docs.items()):
                if match_query(doc, query or {}):
                    self.docs[key] = apply_update(doc, update, query, is_insert=False)
                    return SimpleNamespace(matched_count=1, modified_count=1)
            if not upsert:
                return SimpleNamespace(matched_count=0, modified_count=0)
            created = new_upsert_doc(update, query)
            self.docs[created["_id"]] = created
            return SimpleNamespace(matched_count=0, modified_count=1)

    async def find_one_and_update(self, query, update, upsert=False, return_document=True, projection=None):
        with self._lock:
            for key, doc in list(self.docs.items()):
                if not match_query(doc, query or {}):
                    continue
                before = copy.deepcopy(doc)
                self.docs[key] = apply_update(doc, update, query, is_insert=False)
                found = self.docs[key] if return_document else before
                return copy.deepcopy(found)
            if not upsert:
                return None
            created = new_upsert_doc(update, query)
            self.docs[created["_id"]] = created
            return copy.deepcopy(created) if return_document else None

    async def update_one_atomic(self, query, update):
        if not self._atomic:
            raise AssertionError("atomic path disabled")
        with self._lock:
            doc_id = query.get("_id")
            doc = self.docs.get(doc_id)
            if not doc or not match_query(doc, query):
                return SimpleNamespace(matched_count=0, modified_count=0)
            self.docs[doc_id] = apply_update(doc, update, query, is_insert=False)
            return SimpleNamespace(matched_count=1, modified_count=1)


class DB:
    def __init__(self, *, atomic=True, yield_after_read=False):
        self.companies = Coll(atomic=atomic, yield_after_read=yield_after_read)
        self.counters = Coll(atomic=atomic, yield_after_read=yield_after_read)

    def numbers(self):
        return {
            doc["_id"]: doc.get("company_no")
            for doc in self.companies.docs.values()
        }


def _company(cid, created_at, company_no=None):
    doc = {"_id": cid, "name": cid, "created_at": created_at}
    if company_no is not None:
        doc["company_no"] = company_no
    return doc


def test_backfill_orders_by_created_at_then_id_from_100001():
    db = DB()
    _run(db.companies.insert_one(_company("comp_c", "2026-03-01T00:00:00+00:00")))
    _run(db.companies.insert_one(_company("comp_b2", "2026-01-15T00:00:00+00:00")))
    _run(db.companies.insert_one(_company("comp_a", "2026-01-01T00:00:00+00:00")))
    _run(db.companies.insert_one(_company("comp_b1", "2026-01-15T00:00:00+00:00")))

    n = _run(company_numbers.backfill_missing_company_numbers(db))
    assert n == 4
    assert db.numbers() == {
        "comp_a": START,
        "comp_b1": START + 1,
        "comp_b2": START + 2,
        "comp_c": START + 3,
    }
    assert all(str(cid).startswith("comp_") for cid in db.numbers())

    again = _run(company_numbers.backfill_missing_company_numbers(db))
    assert again == 0
    assert db.numbers() == {
        "comp_a": START,
        "comp_b1": START + 1,
        "comp_b2": START + 2,
        "comp_c": START + 3,
    }
    assert db.counters.docs[company_numbers.KEY]["seq"] == START + 3


def test_backfill_keeps_existing_numbers_and_continues_after_max():
    db = DB()
    _run(db.companies.insert_one(_company("comp_old", "2020-01-01T00:00:00+00:00", 100050)))
    _run(db.companies.insert_one(_company("comp_new", "2026-05-01T00:00:00+00:00")))
    _run(db.companies.insert_one(_company("comp_mid", "2024-01-01T00:00:00+00:00")))

    n = _run(company_numbers.backfill_missing_company_numbers(db))
    assert n == 2
    assert db.numbers()["comp_old"] == 100050
    assert db.numbers()["comp_mid"] == 100051
    assert db.numbers()["comp_new"] == 100052
    assert len(set(db.numbers().values())) == 3

    assert _run(company_numbers.backfill_missing_company_numbers(db)) == 0
    assert db.numbers()["comp_old"] == 100050
    assert db.numbers()["comp_mid"] == 100051


def test_backfill_limit_is_idempotent_and_resumes_in_order():
    db = DB()
    for cid, created in (
        ("comp_3", "2026-03-01T00:00:00+00:00"),
        ("comp_1", "2026-01-01T00:00:00+00:00"),
        ("comp_2", "2026-02-01T00:00:00+00:00"),
    ):
        _run(db.companies.insert_one(_company(cid, created)))

    assert _run(company_numbers.backfill_missing_company_numbers(db, limit=2)) == 2
    assert db.numbers()["comp_1"] == START
    assert db.numbers()["comp_2"] == START + 1
    assert "company_no" not in db.companies.docs["comp_3"]

    assert _run(company_numbers.backfill_missing_company_numbers(db, limit=2)) == 1
    assert db.numbers() == {"comp_1": START, "comp_2": START + 1, "comp_3": START + 2}
    assert _run(company_numbers.backfill_missing_company_numbers(db)) == 0


def test_ensure_same_company_does_not_consume_a_second_number():
    db = DB()
    _run(db.companies.insert_one(_company("comp_one", "2026-01-01T00:00:00+00:00")))
    first = _run(company_numbers.ensure_company_no(db, {"_id": "comp_one"}))
    second = _run(company_numbers.ensure_company_no(db, db.companies.docs["comp_one"]))
    third = _run(company_numbers.next_company_no(db))
    assert first == START
    assert second == START
    assert third == START + 1
    assert db.numbers()["comp_one"] == START


def test_fallback_increment_starts_at_100001_without_atomic():
    db = DB(atomic=False)

    async def _two():
        return await company_numbers.next_company_no(db), await company_numbers.next_company_no(db)

    assert _run(_two()) == (START, START + 1)


def test_concurrent_create_assigns_unique_numbers():
    db = DB(yield_after_read=True)

    async def _create(i):
        number = await company_numbers.next_company_no(db)
        cid = f"comp_{i:04d}"
        await db.companies.insert_one({
            "_id": cid,
            "name": f"Firma {i}",
            "created_at": "2026-06-01T00:00:00+00:00",
            "company_no": number,
        })
        return cid, number

    async def _all():
        return await asyncio.gather(*(_create(i) for i in range(30)))

    rows = _run(_all())
    numbers = [number for _, number in rows]
    assert sorted(numbers) == list(range(START, START + 30))
    assert len(set(numbers)) == 30
    assert {cid for cid, _ in rows} == {f"comp_{i:04d}" for i in range(30)}
    assert set(db.numbers().values()) == set(numbers)


def test_threaded_signups_do_not_share_a_number():
    db = DB(yield_after_read=True)
    barrier = threading.Barrier(12)

    def _one(i):
        barrier.wait(timeout=5)

        async def _go():
            number = await company_numbers.next_company_no(db)
            await db.companies.insert_one({
                "_id": f"comp_t{i}",
                "name": f"T{i}",
                "company_no": number,
                "created_at": "2026-07-01T00:00:00+00:00",
            })
            return number

        return asyncio.run(_go())

    with ThreadPoolExecutor(max_workers=12) as pool:
        numbers = list(pool.map(_one, range(12)))
    assert sorted(numbers) == list(range(START, START + 12))
    assert len(set(db.numbers().values())) == 12


def test_tenant_update_cannot_rewrite_company_no_or_id(monkeypatch):
    import server

    db = DB()
    _run(db.companies.insert_one(_company("comp_keep", "2026-01-01T00:00:00+00:00", START)))
    monkeypatch.setattr(server, "db", db)

    saved = _run(server.update_company("comp_keep", {
        "name": "Yeni Ünvan",
        "company_no": 1,
        "id": "comp_other",
        "_id": "comp_other",
    }))
    assert saved["id"] == "comp_keep"
    assert saved["name"] == "Yeni Ünvan"
    assert saved["company_no"] == START
    stored = db.companies.docs["comp_keep"]
    assert stored["_id"] == "comp_keep"
    assert stored["company_no"] == START
    assert "comp_other" not in db.companies.docs

    loaded = _run(server.get_company("comp_keep"))
    assert loaded["id"] == "comp_keep"
    assert loaded["company_no"] == START
    assert loaded["name"] == "Yeni Ünvan"


def test_matches_exact_company_no_not_prefix():
    assert company_numbers.matches_exact(100001, "100001")
    assert not company_numbers.matches_exact(100001, "10000")
    assert not company_numbers.matches_exact(100001, "1000010")
    assert not company_numbers.matches_exact(100001, "0100001")
    assert not company_numbers.matches_exact(None, "100001")
    assert company_numbers.as_int(True) is None
