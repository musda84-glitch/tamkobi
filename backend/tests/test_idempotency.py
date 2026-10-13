"""Idempotency-Key + atomic status helpers."""
import asyncio
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException

import idempotency
from idempotency import DuplicateKeyError


def _run(coro):
    return asyncio.run(coro)


class FakeIdempo:
    def __init__(self):
        self.docs = {}

    async def create_index(self, *a, **k):
        return None

    async def insert_one(self, doc):
        if doc["_id"] in self.docs:
            raise DuplicateKeyError("dup")
        self.docs[doc["_id"]] = dict(doc)

    async def find_one(self, q):
        d = self.docs.get(q.get("_id"))
        return dict(d) if d else None

    async def update_one(self, q, upd):
        d = self.docs.get(q.get("_id"))
        if not d:
            return MagicMock(matched_count=0)
        if "$set" in upd:
            d.update(upd["$set"])
        return MagicMock(matched_count=1)

    async def delete_one(self, q):
        self.docs.pop(q.get("_id"), None)
        return MagicMock(deleted_count=1)


def test_idempotency_caches_response():
    import idempotency

    idempotency._INDEXED = True
    db = MagicMock()
    db.idempotency_keys = FakeIdempo()
    calls = {"n": 0}

    async def fn():
        calls["n"] += 1
        return {"ok": True, "n": calls["n"]}

    req = MagicMock()
    req.headers = {"Idempotency-Key": "k1"}

    r1 = _run(idempotency.run(db, "co1", req, "test", fn))
    r2 = _run(idempotency.run(db, "co1", req, "test", fn))
    assert r1 == {"ok": True, "n": 1}
    assert r2 == {"ok": True, "n": 1}
    assert calls["n"] == 1


def test_idempotency_in_progress_conflict():
    import idempotency

    idempotency._INDEXED = True
    store = FakeIdempo()
    store.docs["co1:k2"] = {
        "_id": "co1:k2",
        "company_id": "co1",
        "key": "k2",
        "status": "in_progress",
        "created_at": datetime.now(timezone.utc),
    }
    db = MagicMock()
    db.idempotency_keys = store
    req = MagicMock()
    req.headers = {"Idempotency-Key": "k2"}

    with pytest.raises(HTTPException) as ei:
        _run(idempotency.run(db, "co1", req, "test", AsyncMock(return_value={})))
    assert ei.value.status_code == 409


def test_compensating_txn_rolls_back_reverse_order():
    import finance_txn

    order = []

    async def body(cx):
        async def u1():
            order.append("undo1")

        async def u2():
            order.append("undo2")

        cx.push("a", u1)
        cx.push("b", u2)
        raise RuntimeError("boom")

    with pytest.raises(RuntimeError):
        _run(finance_txn.CompensatingTxn("t").run(body))
    assert order == ["undo2", "undo1"]
