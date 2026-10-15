"""Taslak fatura onayında atomik claim: etkiler bir kez, hata→draft, bayat approving."""
from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from mysql_store import apply_update, match_query


def _run(coro):
    return asyncio.run(coro)


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, n=None):
        rows = self.rows if n is None else self.rows[:n]
        return [dict(r) for r in rows]


class FakeColl:
    def __init__(self, docs=None):
        self.docs = [dict(d) for d in (docs or [])]
        self._lock = asyncio.Lock()

    def _find(self, q=None):
        return [d for d in self.docs if match_query(d, q or {})]

    async def find_one(self, q=None, projection=None):
        found = self._find(q)
        return dict(found[0]) if found else None

    def find(self, q=None, projection=None):
        return _Cursor([dict(d) for d in self._find(q)])

    async def update_one(self, q, upd, upsert=False):
        for i, doc in enumerate(self.docs):
            if match_query(doc, q or {}):
                self.docs[i] = apply_update(doc, upd, q)
                return MagicMock(matched_count=1, modified_count=1)
        return MagicMock(matched_count=0, modified_count=0)

    async def update_one_atomic(self, q, upd):
        async with self._lock:
            return await self.update_one(q, upd)


class FakeDB:
    def __init__(self):
        self.invoices = FakeColl()
        self.orders = FakeColl()
        self.products = FakeColl()
        self.contacts = FakeColl()
        self.stock_lots = FakeColl()

    def __getitem__(self, name):
        return getattr(self, name)


USER = {"is_super_admin": True, "active_company_id": "co", "company_ids": ["co"]}


def _draft(**extra):
    doc = {
        "_id": "inv_d",
        "company_id": "co",
        "status": "draft",
        "e_type": "e_archive",
        "invoice_type": "sales",
        "invoice_number": "T-1",
        "contact_id": "c1",
        "contact_name": "Cari",
        "grand_total": 100.0,
        "local_total": 100.0,
        "currency": "TRY",
        "fx_rate": 1,
        "gib_status": "Taslak",
        "items": [{"product_id": "p1", "name": "Mal", "quantity": 1, "unit_price": 100}],
        "notes": "",
    }
    doc.update(extra)
    return doc


def _seed(db, inv, *, balance=0.0, stock=10.0):
    db.invoices.docs = [dict(inv)]
    db.contacts.docs = [{"_id": "c1", "company_id": "co", "name": "Cari", "balance": balance}]
    db.products.docs = [{"_id": "p1", "company_id": "co", "name": "Mal", "stock_quantity": stock}]
    db.orders.docs = []


def _ctx(db, extra=()):
    import server
    from contextlib import ExitStack

    stack = ExitStack()
    stack.enter_context(patch.object(server, "db", db))
    stack.enter_context(patch.object(server, "_post_marketplace_settlement", AsyncMock(return_value=None)))
    stack.enter_context(patch.object(server, "_ensure_order_contact", AsyncMock(return_value=None)))
    for c in extra:
        stack.enter_context(c)
    return stack


def test_concurrent_approve_applies_effects_once():
    import server

    db = FakeDB()
    _seed(db, _draft())

    async def run():
        with _ctx(db):
            a, b = await asyncio.gather(
                server.approve_invoice("inv_d", USER),
                server.approve_invoice("inv_d", USER),
                return_exceptions=True,
            )
            return a, b

    a, b = _run(run())
    oks = [x for x in (a, b) if isinstance(x, dict) and x.get("status") == "success"]
    others = [x for x in (a, b) if x not in oks]
    assert len(oks) >= 1
    # İkinci: 409 (approving) veya «zaten onaylı»
    assert db.contacts.docs[0]["balance"] == pytest.approx(100.0)
    assert db.products.docs[0]["stock_quantity"] == pytest.approx(9.0)
    assert db.invoices.docs[0]["status"] == "approved"
    busy_or_done = False
    for x in others:
        if isinstance(x, HTTPException):
            assert x.status_code == 409
            busy_or_done = True
        elif isinstance(x, dict) and "zaten onaylı" in (x.get("message") or ""):
            busy_or_done = True
    assert busy_or_done or len(oks) == 2 and any("zaten onaylı" in (x.get("message") or "") for x in oks)


def test_approve_error_rolls_back_to_draft_and_reverses():
    import server

    db = FakeDB()
    _seed(db, _draft(), balance=0.0, stock=10.0)

    real_apply = server._apply_invoice_effects

    async def boom(inv):
        await real_apply(inv)
        raise RuntimeError("onay kırıldı")

    with _ctx(db, extra=[patch.object(server, "_apply_invoice_effects", boom)]):
        with pytest.raises(RuntimeError):
            _run(server.approve_invoice("inv_d", USER))
    assert db.invoices.docs[0]["status"] == "draft"
    assert db.invoices.docs[0].get("approving_at") in (None, "")
    assert db.contacts.docs[0]["balance"] == pytest.approx(0.0)
    assert db.products.docs[0]["stock_quantity"] == pytest.approx(10.0)


def test_stale_approving_can_be_approved_again():
    import server

    db = FakeDB()
    stale_at = (datetime.now(timezone.utc) - timedelta(minutes=11)).isoformat()
    _seed(db, _draft(status="approving", approving_at=stale_at))
    with _ctx(db):
        out = _run(server.approve_invoice("inv_d", USER))
    assert out["status"] == "success"
    assert "onaylandı" in out["message"].lower()
    assert db.invoices.docs[0]["status"] == "approved"
    assert db.contacts.docs[0]["balance"] == pytest.approx(100.0)


def test_fresh_approving_is_409():
    import server

    db = FakeDB()
    now = datetime.now(timezone.utc).isoformat()
    _seed(db, _draft(status="approving", approving_at=now))
    with _ctx(db):
        with pytest.raises(HTTPException) as ei:
            _run(server.approve_invoice("inv_d", USER))
    assert ei.value.status_code == 409
    assert "onaylanıyor" in ei.value.detail
    assert db.contacts.docs[0]["balance"] == pytest.approx(0.0)


def test_already_approved_keeps_existing_message():
    import server

    db = FakeDB()
    _seed(db, _draft(status="approved", effects_applied=True, gib_status="Onaylandı"))
    with _ctx(db):
        out = _run(server.approve_invoice("inv_d", USER))
    assert out["message"] == "Fatura zaten onaylı."
    assert db.contacts.docs[0]["balance"] == pytest.approx(0.0)
