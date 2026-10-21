"""Elle girilmiş taslak kağıt alış: approve cari ve stoku bir kez işler."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

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
                return type("R", (), {"matched_count": 1, "modified_count": 1})()
        return type("R", (), {"matched_count": 0, "modified_count": 0})()

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


def _paper(**extra):
    doc = {
        "_id": "al107",
        "company_id": "co",
        "status": "draft",
        "e_type": "paper",
        "invoice_type": "purchase",
        "invoice_number": "AL202600000107",
        "contact_id": "c1",
        "contact_name": "Tedarikçi",
        "grand_total": 65000.0,
        "local_total": 65000.0,
        "currency": "TRY",
        "fx_rate": 1,
        "gib_status": "Taslak",
        "effects_applied": False,
        "items": [{"product_id": "p1", "name": "Mal", "quantity": 2, "unit_price": 32500}],
        "notes": "",
    }
    doc.update(extra)
    return doc


def _seed(db, inv, *, balance=0.0, stock=10.0):
    db.invoices.docs = [dict(inv)]
    db.contacts.docs = [{"_id": "c1", "company_id": inv.get("company_id") or "co", "name": "Tedarikçi", "balance": balance}]
    db.products.docs = [{"_id": "p1", "company_id": inv.get("company_id") or "co", "name": "Mal", "stock_quantity": stock}]
    db.orders.docs = []


def _ctx(db):
    import server
    from contextlib import ExitStack

    stack = ExitStack()
    stack.enter_context(patch.object(server, "db", db))
    stack.enter_context(patch.object(server, "_post_marketplace_settlement", AsyncMock(return_value=None)))
    stack.enter_context(patch.object(server, "_ensure_order_contact", AsyncMock(return_value=None)))
    return stack


def test_paper_purchase_draft_approve_posts_balance_and_stock_once():
    import server

    db = FakeDB()
    _seed(db, _paper())
    with _ctx(db):
        first = _run(server.approve_invoice("al107", USER))
        balance = db.contacts.docs[0]["balance"]
        stock = db.products.docs[0]["stock_quantity"]
        second = _run(server.approve_invoice("al107", USER))
    inv = db.invoices.docs[0]
    assert first["status"] == "success"
    assert inv["status"] == "approved"
    assert inv["effects_applied"] is True
    assert inv["gib_status"] == "Kağıt Fatura (Matbu)"
    assert balance == pytest.approx(-65000.0)
    assert stock == pytest.approx(12.0)
    assert second["message"] == "Fatura zaten onaylı."
    assert db.contacts.docs[0]["balance"] == pytest.approx(-65000.0)
    assert db.products.docs[0]["stock_quantity"] == pytest.approx(12.0)
    assert len(db.invoices.docs) == 1


def test_other_company_approve_is_404():
    import server

    db = FakeDB()
    _seed(db, _paper(company_id="co-b"), balance=40.0, stock=7.0)
    user = {"is_super_admin": False, "active_company_id": "co-a", "company_ids": ["co-a"]}
    with _ctx(db):
        with pytest.raises(HTTPException) as ei:
            _run(server.approve_invoice("al107", user))
    assert ei.value.status_code == 404
    assert db.contacts.docs[0]["balance"] == pytest.approx(40.0)
    assert db.products.docs[0]["stock_quantity"] == pytest.approx(7.0)
    assert db.invoices.docs[0]["status"] == "draft"


def test_incoming_purchase_still_uses_post_path():
    import server

    db = FakeDB()
    _seed(db, _paper(
        _id="inv_in",
        e_type="e_invoice",
        direction="incoming",
        source="edoc_inbox",
        gib_status="Gelen E-Fatura (Yanıt Bekleniyor)",
        grand_total=120.0,
        local_total=120.0,
    ))
    with _ctx(db):
        with patch.object(server, "_post_incoming_purchase_invoice", wraps=server._post_incoming_purchase_invoice) as spy:
            out = _run(server.approve_invoice("inv_in", USER))
    assert spy.await_count == 1
    assert out["already"] is False
    inv = db.invoices.docs[0]
    assert inv["status"] == "approved"
    assert inv["gib_status"] == "Gelen E-Fatura (Yanıt Bekleniyor)"
    assert inv["gib_status"] != "Kağıt Fatura (Matbu)"
    assert db.contacts.docs[0]["balance"] == pytest.approx(-120.0)
    assert db.products.docs[0]["stock_quantity"] == pytest.approx(12.0)
