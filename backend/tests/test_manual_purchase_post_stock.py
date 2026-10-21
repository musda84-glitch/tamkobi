"""Elle alış: Stoğa işle seçeneği onay ve doğrudan kayıtta aynı stok kararını verir."""
from __future__ import annotations

import asyncio
import copy
from contextlib import ExitStack
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

    async def insert_one(self, doc):
        self.docs.append(dict(doc))
        return MagicMock(inserted_id=doc.get("_id"))

    async def update_one(self, q, upd, upsert=False):
        for i, doc in enumerate(self.docs):
            if match_query(doc, q or {}):
                self.docs[i] = apply_update(doc, upd, q)
                return MagicMock(matched_count=1, modified_count=1)
        return MagicMock(matched_count=0, modified_count=0)

    async def update_one_atomic(self, q, upd):
        async with self._lock:
            return await self.update_one(q, upd)

    async def update_many(self, q, upd):
        n = 0
        for i, doc in enumerate(self.docs):
            if match_query(doc, q or {}):
                self.docs[i] = apply_update(doc, upd, q)
                n += 1
        return MagicMock(matched_count=n, modified_count=n)


class FakeDB:
    def __init__(self):
        self.invoices = FakeColl()
        self.orders = FakeColl()
        self.products = FakeColl()
        self.contacts = FakeColl()
        self.stock_lots = FakeColl()
        self.installments = FakeColl()
        self.bank_transactions = FakeColl()
        self.partner_transactions = FakeColl()
        self.incoming_edocs = FakeColl()

    def __getitem__(self, name):
        return getattr(self, name)


USER = {"is_super_admin": True, "active_company_id": "co", "company_ids": ["co"]}
OTHER = {"is_super_admin": False, "active_company_id": "co-a", "company_ids": ["co-a"]}


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
        "grand_total": 200.0,
        "local_total": 200.0,
        "currency": "TRY",
        "fx_rate": 1,
        "gib_status": "Taslak",
        "effects_applied": False,
        "items": [{"product_id": "p1", "name": "Mal", "quantity": 2, "unit": "Adet", "unit_price": 100}],
        "notes": "",
    }
    doc.update(extra)
    return doc


def _seed(db, inv, *, balance=0.0, stock=10.0):
    db.invoices.docs = [dict(inv)]
    cid = inv.get("company_id") or "co"
    db.contacts.docs = [{"_id": "c1", "company_id": cid, "name": "Tedarikçi", "balance": balance}]
    db.products.docs = [
        {"_id": "p1", "company_id": cid, "name": "Mal", "stock_quantity": stock},
        {"_id": "p1", "company_id": "diger", "name": "Mal", "stock_quantity": 3},
    ]
    db.orders.docs = []


def _ctx(db):
    import server

    stack = ExitStack()
    stack.enter_context(patch.object(server, "db", db))
    stack.enter_context(patch.object(server, "_post_marketplace_settlement", AsyncMock(return_value=None)))
    stack.enter_context(patch.object(server, "_ensure_order_contact", AsyncMock(return_value=None)))
    stack.enter_context(patch.object(server, "_fill_stock_codes", AsyncMock()))
    stack.enter_context(patch.object(server, "_cancel_promissory_for_query", AsyncMock()))
    stack.enter_context(patch("contact_balance.sync_contact_balance", AsyncMock()))
    return stack


def _balance(db):
    return db.contacts.docs[0]["balance"]


def _stock(db, company_id="co"):
    return next(p["stock_quantity"] for p in db.products.docs if p["company_id"] == company_id)


def test_approve_post_stock_true_posts_balance_and_stock_once():
    import server

    db = FakeDB()
    _seed(db, _paper(post_stock=True))
    with _ctx(db):
        first = _run(server.approve_invoice("al107", USER))
        second = _run(server.approve_invoice("al107", USER))
    inv = db.invoices.docs[0]
    assert first["status"] == "success"
    assert second["message"] == "Fatura zaten onaylı."
    assert inv["status"] == "approved"
    assert inv["post_stock"] is True
    assert inv["stock_effects_applied"] is True
    assert _balance(db) == pytest.approx(-200.0)
    assert _stock(db) == pytest.approx(12.0)
    assert _stock(db, "diger") == pytest.approx(3.0)


def test_approve_post_stock_false_skips_stock():
    import server

    db = FakeDB()
    _seed(db, _paper(post_stock=False))
    with _ctx(db):
        _run(server.approve_invoice("al107", USER))
        _run(server.approve_invoice("al107", USER))
    inv = db.invoices.docs[0]
    assert inv["post_stock"] is False
    assert inv.get("stock_effects_applied") is not True
    assert inv.get("stock_skipped") is True
    assert _balance(db) == pytest.approx(-200.0)
    assert _stock(db) == pytest.approx(10.0)
    assert _stock(db, "diger") == pytest.approx(3.0)


def _direct(db, *, post_stock, number):
    import server
    from models import Invoice

    invoice = Invoice(
        company_id="co",
        invoice_type="purchase",
        e_type="paper",
        invoice_number=number,
        contact_id="c1",
        contact_name="Tedarikçi",
        status="approved",
        post_stock=post_stock,
        items=[{
            "name": "Mal",
            "quantity": 2,
            "unit": "Adet",
            "unit_price": 100,
            "total": 200,
            "vat_rate": 0,
            "product_id": "p1",
        }],
    )
    with _ctx(db):
        _run(server._create_invoice_core(invoice, USER))


def test_direct_approved_create_matches_approve_paths():
    import server

    db = FakeDB()
    _seed(db, _paper())
    db.invoices.docs = []
    _direct(db, post_stock=True, number="AL-T")
    posted = db.invoices.docs[0]
    assert posted["status"] == "approved"
    assert posted["post_stock"] is True
    assert posted["stock_effects_applied"] is True
    assert posted["effects_applied"] is True
    assert _balance(db) == pytest.approx(-200.0)
    assert _stock(db) == pytest.approx(12.0)

    db2 = FakeDB()
    _seed(db2, _paper())
    db2.invoices.docs = []
    _direct(db2, post_stock=False, number="AL-F")
    skipped = db2.invoices.docs[0]
    assert skipped["post_stock"] is False
    assert skipped.get("stock_effects_applied") is not True
    assert skipped.get("stock_skipped") is True
    assert _balance(db2) == pytest.approx(-200.0)
    assert _stock(db2) == pytest.approx(10.0)
    assert server  # imported for the create path side effects above


def test_missing_field_on_old_draft_defaults_true_and_old_approved_stays():
    import server

    db = FakeDB()
    _seed(db, _paper())
    assert "post_stock" not in db.invoices.docs[0]
    with _ctx(db):
        _run(server.approve_invoice("al107", USER))
    assert db.invoices.docs[0]["post_stock"] is True
    assert db.invoices.docs[0]["stock_effects_applied"] is True
    assert _stock(db) == pytest.approx(12.0)

    old = FakeDB()
    approved = _paper(
        status="approved",
        effects_applied=True,
        stock_effects_applied=True,
        gib_status="Kağıt Fatura (Matbu)",
    )
    approved.pop("post_stock", None)
    _seed(old, approved, balance=-200.0, stock=12.0)
    before = copy.deepcopy(old.invoices.docs[0])
    with _ctx(old):
        out = _run(server.approve_invoice("al107", USER))
    assert out["message"] == "Fatura zaten onaylı."
    assert old.invoices.docs[0] == before
    assert "post_stock" not in old.invoices.docs[0]
    assert _balance(old) == pytest.approx(-200.0)
    assert _stock(old) == pytest.approx(12.0)


def test_concurrent_approve_posts_once():
    import server

    db = FakeDB()
    _seed(db, _paper(post_stock=True))

    async def both():
        return await asyncio.gather(
            server.approve_invoice("al107", USER),
            server.approve_invoice("al107", USER),
            return_exceptions=True,
        )

    with _ctx(db):
        results = _run(both())
    assert _balance(db) == pytest.approx(-200.0)
    assert _stock(db) == pytest.approx(12.0)
    assert db.invoices.docs[0]["stock_effects_applied"] is True
    successes = [r for r in results if isinstance(r, dict) and r.get("status") == "success"]
    assert len(successes) >= 1


def test_cancel_reverses_stock_only_when_posted():
    import server

    db = FakeDB()
    _seed(db, _paper(post_stock=True, e_type="e_archive"))
    with _ctx(db):
        _run(server.approve_invoice("al107", USER))
        assert _stock(db) == pytest.approx(12.0)
        _run(server.cancel_invoice("al107", {}, USER))
        assert _stock(db) == pytest.approx(10.0)
        assert _balance(db) == pytest.approx(0.0)
        with pytest.raises(HTTPException) as ei:
            _run(server.cancel_invoice("al107", {}, USER))
    assert ei.value.status_code == 409
    assert _stock(db) == pytest.approx(10.0)
    assert _balance(db) == pytest.approx(0.0)

    skipped = FakeDB()
    _seed(skipped, _paper(post_stock=False, e_type="e_archive"))
    with _ctx(skipped):
        _run(server.approve_invoice("al107", USER))
        _run(server.cancel_invoice("al107", {}, USER))
        with pytest.raises(HTTPException):
            _run(server.cancel_invoice("al107", {}, USER))
    assert _stock(skipped) == pytest.approx(10.0)
    assert _balance(skipped) == pytest.approx(0.0)


def test_approved_post_stock_is_locked_draft_is_editable():
    import server

    db = FakeDB()
    _seed(db, _paper(post_stock=True))
    with _ctx(db):
        _run(server.approve_invoice("al107", USER))
        with pytest.raises(HTTPException) as ei:
            _run(server.update_invoice("al107", {"post_stock": False}, USER))
        assert ei.value.status_code == 409
        assert ei.value.detail == "Onaylı faturada 'Stoğa işle' değiştirilemez."
        assert db.invoices.docs[0]["post_stock"] is True
        same = _run(server.update_invoice("al107", {"post_stock": True}, USER))
        assert same["post_stock"] is True
        assert db.invoices.docs[0]["post_stock"] is True

    draft = FakeDB()
    _seed(draft, _paper(post_stock=True))
    with _ctx(draft):
        updated = _run(server.update_invoice("al107", {"post_stock": False}, USER))
        assert updated["post_stock"] is False
        assert draft.invoices.docs[0]["post_stock"] is False
        _run(server.approve_invoice("al107", USER))
    assert draft.invoices.docs[0]["post_stock"] is False
    assert draft.invoices.docs[0].get("stock_effects_applied") is not True
    assert _stock(draft) == pytest.approx(10.0)
    assert _balance(draft) == pytest.approx(-200.0)


def test_dispatch_stock_is_not_posted_again_or_reversed():
    import server

    db = FakeDB()
    _seed(db, _paper(
        e_type="e_archive",
        post_stock=True,
        stock_effects_from_dispatch=True,
        stock_effects_applied=True,
    ), stock=12.0)
    with _ctx(db):
        _run(server.approve_invoice("al107", USER))
        assert _stock(db) == pytest.approx(12.0)
        assert _balance(db) == pytest.approx(-200.0)
        _run(server.cancel_invoice("al107", {}, USER))
    assert _stock(db) == pytest.approx(12.0)
    assert _balance(db) == pytest.approx(0.0)
    assert _stock(db, "diger") == pytest.approx(3.0)


def test_incoming_ignores_post_stock():
    import server

    db = FakeDB()
    _seed(db, _paper(
        _id="inv_in",
        e_type="e_invoice",
        direction="incoming",
        source="edoc_inbox",
        gib_status="Gelen E-Fatura (Yanıt Bekleniyor)",
        post_stock=False,
    ))
    with _ctx(db):
        out = _run(server.approve_invoice("inv_in", USER))
    assert out["already"] is False
    inv = db.invoices.docs[0]
    assert inv["status"] == "approved"
    assert inv["gib_status"] == "Gelen E-Fatura (Yanıt Bekleniyor)"
    assert inv["stock_effects_applied"] is True
    assert _balance(db) == pytest.approx(-200.0)
    assert _stock(db) == pytest.approx(12.0)


def test_other_company_approve_put_cancel_are_404():
    import server

    db = FakeDB()
    _seed(db, _paper(company_id="co-b", post_stock=True, e_type="e_archive", status="approved", effects_applied=True, stock_effects_applied=True), balance=-200.0, stock=12.0)
    with _ctx(db):
        with pytest.raises(HTTPException) as approve_err:
            _run(server.approve_invoice("al107", OTHER))
        with pytest.raises(HTTPException) as put_err:
            _run(server.update_invoice("al107", {"post_stock": False}, OTHER))
        with pytest.raises(HTTPException) as cancel_err:
            _run(server.cancel_invoice("al107", {}, OTHER))
    assert approve_err.value.status_code == 404
    assert put_err.value.status_code == 404
    assert cancel_err.value.status_code == 404
    assert db.invoices.docs[0]["post_stock"] is True
    assert db.invoices.docs[0]["status"] == "approved"
    assert _balance(db) == pytest.approx(-200.0)
    assert _stock(db, "co-b") == pytest.approx(12.0)
