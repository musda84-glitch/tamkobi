"""Bayat ödeme kilidi: çökme, eşzamanlı istek, devralma, çift ödeme yok."""
from __future__ import annotations

import asyncio
import copy
import importlib.util
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mysql_store import DuplicateKeyError, UpdateResult, apply_update, match_query
import idempotency
import pay_claim


class MemoryCollection:
    def __init__(self):
        self.docs = {}
        self._lock = asyncio.Lock()

    async def create_index(self, *args, **kwargs):
        return None

    async def insert_one(self, doc):
        async with self._lock:
            doc = copy.deepcopy(doc)
            if doc["_id"] in self.docs:
                raise DuplicateKeyError("dup")
            self.docs[doc["_id"]] = doc
            return doc

    async def find_one(self, query):
        async with self._lock:
            if query.keys() == {"_id"}:
                doc = self.docs.get(query["_id"])
                return copy.deepcopy(doc) if doc else None
            for doc in self.docs.values():
                if match_query(doc, query):
                    return copy.deepcopy(doc)
            return None

    def find(self, query=None):
        matched = [copy.deepcopy(d) for d in self.docs.values() if match_query(d, query or {})]
        return _Cursor(matched)

    async def update_one(self, query, update, upsert=False):
        async with self._lock:
            for doc_id, old in list(self.docs.items()):
                if match_query(old, query):
                    self.docs[doc_id] = apply_update(old, update, query)
                    return UpdateResult(1, 1, None)
            return UpdateResult(0, 0, None)

    async def update_one_atomic(self, query, update):
        doc_id = query.get("_id")
        async with self._lock:
            old = self.docs.get(doc_id)
            if not old or not match_query(old, query):
                return UpdateResult(0, 0, None)
            self.docs[doc_id] = apply_update(old, update, query)
            return UpdateResult(1, 1, None)

    async def delete_one(self, query):
        async with self._lock:
            for doc_id, old in list(self.docs.items()):
                if match_query(old, query):
                    del self.docs[doc_id]
                    return type("D", (), {"deleted_count": 1})()
            return type("D", (), {"deleted_count": 0})()


class _Cursor:
    def __init__(self, docs):
        self._docs = docs

    async def to_list(self, limit):
        return self._docs[:limit]


class MemoryDB:
    def __init__(self):
        self._cols = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        if name not in self._cols:
            self._cols[name] = MemoryCollection()
        return self._cols[name]


def _run(coro):
    return asyncio.run(coro)


def _iso(dt):
    return dt.astimezone(timezone.utc).isoformat()


NOW = datetime(2026, 10, 13, 12, 0, tzinfo=timezone.utc)


def _installment(claimed_at=None):
    doc = {
        "_id": "inst1",
        "company_id": "co1",
        "status": "pending",
        "amount": 50,
        "paid_amount": 0,
        "label": "1. Taksit",
    }
    if claimed_at is not None:
        doc["_pay_claimed_at"] = claimed_at
        doc["_pay_idempotency_key"] = "pay-key"
        doc["_pay_idempotency_company"] = "co1"
    return doc


def test_claim_query_matches_missing_and_stale_not_fresh():
    fresh = _iso(NOW)
    stale = _iso(NOW - timedelta(minutes=6))
    missing = {"_id": "inst1", "status": "pending", "amount": 50}
    assert match_query(missing, pay_claim.claim_query("inst1", now=NOW))
    assert match_query({**missing, "_pay_claimed_at": stale}, pay_claim.claim_query("inst1", now=NOW))
    assert not match_query({**missing, "_pay_claimed_at": fresh}, pay_claim.claim_query("inst1", now=NOW))
    assert not match_query({**missing, "status": "paid"}, pay_claim.claim_query("inst1", now=NOW))


def test_crash_after_write_does_not_pay_twice():
    async def scenario():
        idempotency._INDEXED = True
        db = MemoryDB()
        await db.installments.insert_one(_installment())
        key = "pay-key"
        await db.idempotency_keys.insert_one({
            "_id": idempotency._doc_id("co1", key),
            "company_id": "co1",
            "key": key,
            "endpoint": "installments/inst1/pay",
            "status": "in_progress",
            "created_at": _iso(NOW),
            "updated_at": _iso(NOW),
        })
        payments = []

        async def attempt(now):
            gate = await pay_claim.acquire_pay_claim(
                db, "installments", "inst1",
                company_id="co1", idempotency_key=key, source_type="installment",
                now=now,
            )
            if gate["action"] == "already_paid":
                return "already"
            payments.append({"claimed_at": gate["claimed_at"]})
            await idempotency.mark_payment_applied(db, "co1", key, {
                "collection": "installments",
                "doc_id": "inst1",
                "finalize": {"status": "paid", "paid_amount": 50},
                "response": {"status": "success", "amount": 50},
            })
            # Süreç burada düşer: kilit kalır, status hâlâ pending.
            return "crashed"

        assert await attempt(NOW) == "crashed"
        assert len(payments) == 1
        stuck = await db.installments.find_one({"_id": "inst1"})
        assert stuck["status"] == "pending"
        assert stuck.get("_pay_claimed_at")

        again = await attempt(NOW + timedelta(minutes=6))
        assert again == "already"
        assert len(payments) == 1
        done = await db.installments.find_one({"_id": "inst1"})
        assert done["status"] == "paid"
        assert done.get("paid_amount") == 50
        assert "_pay_claimed_at" not in done

    _run(scenario())


def test_concurrent_requests_single_payment():
    async def scenario():
        db = MemoryDB()
        await db.installments.insert_one(_installment())
        payments = []

        async def attempt():
            try:
                gate = await pay_claim.acquire_pay_claim(
                    db, "installments", "inst1",
                    company_id="co1", idempotency_key="", source_type="installment",
                    now=NOW,
                )
            except HTTPException as exc:
                return ("err", exc.status_code)
            if gate["action"] == "already_paid":
                return ("already",)
            payments.append(1)
            await asyncio.sleep(0.02)
            kind = await pay_claim.finish_pay_claim(
                db, "installments", "inst1", gate["claimed_at"],
                {"status": "paid", "paid_amount": 50},
            )
            return ("paid", kind)

        results = await asyncio.gather(attempt(), attempt())
        assert sorted(r[0] for r in results) == ["err", "paid"]
        assert len(payments) == 1
        doc = await db.installments.find_one({"_id": "inst1"})
        assert doc["status"] == "paid"
        assert "_pay_claimed_at" not in doc

    _run(scenario())


def test_stale_lock_is_taken_over_when_payment_missing():
    async def scenario():
        db = MemoryDB()
        await db.installments.insert_one(_installment(_iso(NOW - timedelta(minutes=10))))
        gate = await pay_claim.acquire_pay_claim(
            db, "installments", "inst1",
            company_id="co1", idempotency_key="new-key", source_type="installment",
            now=NOW,
        )
        assert gate["action"] == "proceed"
        assert gate["claimed_at"] == _iso(NOW)
        await pay_claim.finish_pay_claim(
            db, "installments", "inst1", gate["claimed_at"],
            {"status": "paid", "paid_amount": 50},
        )
        doc = await db.installments.find_one({"_id": "inst1"})
        assert doc["status"] == "paid"
        assert "_pay_claimed_at" not in doc

    _run(scenario())


def test_fresh_lock_is_not_taken_over():
    async def scenario():
        db = MemoryDB()
        await db.installments.insert_one(_installment(_iso(NOW - timedelta(minutes=1))))
        with pytest.raises(HTTPException) as exc:
            await pay_claim.acquire_pay_claim(
                db, "installments", "inst1",
                company_id="co1", idempotency_key="other", source_type="installment",
                now=NOW,
            )
        assert exc.value.status_code == 409
        doc = await db.installments.find_one({"_id": "inst1"})
        assert doc["_pay_claimed_at"] == _iso(NOW - timedelta(minutes=1))

    _run(scenario())


def test_linked_move_blocks_second_payment_without_idempotency_flag():
    async def scenario():
        db = MemoryDB()
        await db.installments.insert_one(_installment(_iso(NOW - timedelta(minutes=8))))
        await db.bank_transactions.insert_one({
            "_id": "tx1",
            "company_id": "co1",
            "installment_id": "inst1",
            "source_type": "installment",
            "source_id": "inst1",
            "amount": 50,
        })
        payments = []
        gate = await pay_claim.acquire_pay_claim(
            db, "installments", "inst1",
            company_id="co1", idempotency_key="pay-key", source_type="installment",
            now=NOW,
        )
        if gate["action"] == "proceed":
            payments.append(1)
        assert gate["action"] == "already_paid"
        assert payments == []
        txs = await db.bank_transactions.find({"installment_id": "inst1"}).to_list(10)
        assert len(txs) == 1
        doc = await db.installments.find_one({"_id": "inst1"})
        assert doc["status"] == "paid"
        assert "_pay_claimed_at" not in doc

    _run(scenario())


def test_release_does_not_clear_a_newer_claim():
    async def scenario():
        db = MemoryDB()
        await db.installments.insert_one(_installment())
        gate = await pay_claim.acquire_pay_claim(
            db, "installments", "inst1",
            company_id="co1", idempotency_key="a", source_type="installment",
            now=NOW,
        )
        newer = _iso(NOW + timedelta(minutes=6))
        await db.installments.update_one_atomic(
            {"_id": "inst1", "_pay_claimed_at": gate["claimed_at"]},
            {"$set": {"_pay_claimed_at": newer}},
        )
        await pay_claim.release_pay_claim(db, "installments", "inst1", gate["claimed_at"])
        doc = await db.installments.find_one({"_id": "inst1"})
        assert doc["_pay_claimed_at"] == newer

    _run(scenario())


def test_clear_stale_claims_dry_run_then_apply():
    async def scenario():
        db = MemoryDB()
        await db.installments.insert_one(_installment(_iso(NOW - timedelta(minutes=9))))
        await db.payrolls.insert_one({
            "_id": "pay1",
            "company_id": "co1",
            "status": "pending",
            "_pay_claimed_at": _iso(NOW - timedelta(seconds=30)),
        })
        preview = await pay_claim.clear_stale_claims(db, dry_run=True, now=NOW, company_id="co1")
        assert preview["dry_run"] is True
        assert preview["count"] == 1
        assert preview["items"][0]["id"] == "inst1"
        assert preview["items"][0]["action"] == "release"
        assert (await db.installments.find_one({"_id": "inst1"})).get("_pay_claimed_at")

        applied = await pay_claim.clear_stale_claims(db, dry_run=False, now=NOW, company_id="co1")
        assert applied["dry_run"] is False
        assert applied["released"] == 1
        assert applied["finalized"] == 0
        assert "_pay_claimed_at" not in (await db.installments.find_one({"_id": "inst1"}))
        assert (await db.payrolls.find_one({"_id": "pay1"})).get("_pay_claimed_at")

    _run(scenario())


def test_clear_stale_finalizes_written_payment():
    async def scenario():
        idempotency._INDEXED = True
        db = MemoryDB()
        await db.installments.insert_one(_installment(_iso(NOW - timedelta(minutes=12))))
        await db.idempotency_keys.insert_one({
            "_id": idempotency._doc_id("co1", "pay-key"),
            "company_id": "co1",
            "key": "pay-key",
            "endpoint": "installments/inst1/pay",
            "status": "in_progress",
            "payment_applied": True,
            "payment": {
                "collection": "installments",
                "doc_id": "inst1",
                "finalize": {"status": "paid", "paid_amount": 50},
                "response": {"status": "success", "already_paid": True},
            },
            "created_at": _iso(NOW - timedelta(minutes=12)),
            "updated_at": _iso(NOW - timedelta(minutes=12)),
        })
        preview = await pay_claim.clear_stale_claims(db, dry_run=True, now=NOW)
        assert preview["items"][0]["payment_written"] is True
        assert preview["items"][0]["via"] == "idempotency"
        assert (await db.installments.find_one({"_id": "inst1"}))["status"] == "pending"

        applied = await pay_claim.clear_stale_claims(db, dry_run=False, now=NOW)
        assert applied["finalized"] == 1
        assert applied["released"] == 0
        doc = await db.installments.find_one({"_id": "inst1"})
        assert doc["status"] == "paid"
        assert "_pay_claimed_at" not in doc

    _run(scenario())


def test_same_idempotency_key_after_crash_does_not_repay():
    async def scenario():
        idempotency._INDEXED = True
        db = MemoryDB()
        await db.installments.insert_one({
            "_id": "inst1", "company_id": "co1", "status": "pending", "amount": 50, "paid_amount": 0,
        })
        old = _iso(NOW - timedelta(minutes=10))
        key = "same-key"
        await db.idempotency_keys.insert_one({
            "_id": idempotency._doc_id("co1", key),
            "company_id": "co1",
            "key": key,
            "endpoint": "installments/inst1/pay",
            "status": "in_progress",
            "payment_applied": True,
            "payment": {
                "collection": "installments",
                "doc_id": "inst1",
                "finalize": {"status": "paid", "paid_amount": 50},
                "response": {"status": "success", "amount": 50},
            },
            "response": None,
            "created_at": old,
            "updated_at": old,
        })
        calls = {"n": 0}

        async def fn():
            calls["n"] += 1
            return {"status": "success", "amount": 99}

        req = type("R", (), {"headers": {"Idempotency-Key": key}})()
        out = await idempotency.run(db, "co1", req, "installments/inst1/pay", fn)
        assert out["amount"] == 50
        assert calls["n"] == 0
        doc = await db.installments.find_one({"_id": "inst1"})
        assert doc["status"] == "paid"

    _run(scenario())


def test_stale_idempotency_key_reclaimed_once():
    async def scenario():
        idempotency._INDEXED = True
        db = MemoryDB()
        old = _iso(NOW - timedelta(minutes=10))
        key = "retry-key"
        await db.idempotency_keys.insert_one({
            "_id": idempotency._doc_id("co1", key),
            "company_id": "co1",
            "key": key,
            "endpoint": "installments/inst1/pay",
            "status": "in_progress",
            "created_at": old,
            "updated_at": old,
        })
        calls = {"n": 0}
        started = asyncio.Event()
        release = asyncio.Event()

        async def fn():
            calls["n"] += 1
            started.set()
            await release.wait()
            return {"ok": True, "n": calls["n"]}

        req = type("R", (), {"headers": {"Idempotency-Key": key}})()

        async def call():
            try:
                out = await idempotency.run(db, "co1", req, "installments/inst1/pay", fn)
                return ("ok", out)
            except HTTPException as exc:
                return ("err", exc.status_code)

        first = asyncio.create_task(call())
        await started.wait()
        second = asyncio.create_task(call())
        await asyncio.sleep(0.05)
        release.set()
        results = await asyncio.gather(first, second)
        oks = [r for r in results if r[0] == "ok"]
        errs = [r for r in results if r[0] == "err"]
        assert len(oks) == 1, results
        assert len(errs) == 1 and errs[0][1] == 409
        assert calls["n"] == 1

    _run(scenario())


def test_cli_defaults_to_dry_run():
    path = Path(__file__).resolve().parents[1] / "scripts" / "clear_stale_pay_claims.py"
    spec = importlib.util.spec_from_file_location("clear_stale_pay_claims", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    args = mod.build_parser().parse_args([])
    assert args.apply is False
    assert args.dry_run is False
    assert args.older_than_minutes == 5.0
    args_apply = mod.build_parser().parse_args(["--apply", "--company", "co1"])
    assert args_apply.apply is True
    assert args_apply.company == "co1"
