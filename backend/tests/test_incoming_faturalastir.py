"""Gelen fatura Faturalaştır: sipariş taslağı ile aynı onay servisi, tek kayıt."""
import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException


def _run(coro):
    return asyncio.run(coro)


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, n):
        return list(self.rows)[:n]


class FakeColl:
    def __init__(self, docs=None):
        self.docs = list(docs or [])

    def _match(self, d, q):
        if not q:
            return True
        for k, v in q.items():
            if isinstance(v, dict) and "$ne" in v:
                if d.get(k) == v["$ne"]:
                    return False
                continue
            if d.get(k) != v:
                return False
        return True

    async def find_one(self, q=None, projection=None):
        d = next((x for x in self.docs if self._match(x, q or {})), None)
        return dict(d) if d else None

    def find(self, q=None, projection=None):
        return FakeCursor([d for d in self.docs if self._match(d, q or {})])

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    async def update_one(self, q, upd):
        d = next((x for x in self.docs if self._match(x, q or {})), None)
        if not d:
            return type("R", (), {"matched_count": 0, "modified_count": 0})()
        if "$set" in upd:
            d.update(upd["$set"])
        if "$inc" in upd:
            for k, v in upd["$inc"].items():
                d[k] = float(d.get(k) or 0) + float(v)
        return type("R", (), {"matched_count": 1, "modified_count": 1})()


def _db(contact_balance=0.0, stock=5.0):
    from unittest.mock import MagicMock

    contact = {"_id": "c1", "company_id": "co", "name": "Tedarikçi", "balance": contact_balance}
    product = {"_id": "p1", "company_id": "co", "name": "Mal", "stock_quantity": stock}
    inv = {
        "_id": "inv_in",
        "company_id": "co",
        "invoice_number": "GLN-1",
        "invoice_type": "purchase",
        "e_type": "e_invoice",
        "direction": "incoming",
        "source": "edoc_inbox",
        "status": "draft",
        "effects_applied": False,
        "gib_status": "Gelen E-Fatura (Yanıt Bekleniyor)",
        "contact_id": "c1",
        "contact_name": "Tedarikçi",
        "items": [{
            "product_id": "p1",
            "name": "Mal",
            "quantity": 2,
            "unit_price": 50,
            "vat_rate": 20,
            "total": 100,
        }],
        "grand_total": 120.0,
        "currency": "TRY",
        "paid_amount": 0,
        "payment_status": "unpaid",
    }
    db = MagicMock()
    db.contacts = FakeColl([contact])
    db.products = FakeColl([product])
    db.invoices = FakeColl([inv])
    db.stock_lots = FakeColl([])
    return db


def _patch(db):
    import server

    async def get_doc(_db, _coll, doc_id, _user, not_found="Fatura bulunamadı."):
        row = await db.invoices.find_one({"_id": doc_id})
        if not row:
            raise HTTPException(status_code=404, detail=not_found)
        return row

    return patch.object(server, "db", db), patch("tenant_access.get_tenant_doc", AsyncMock(side_effect=get_doc))


def test_single_click_posts_purchase_balance_and_stock():
    import server

    db = _db()
    db_patch, doc_patch = _patch(db)

    async def run():
        with db_patch, doc_patch:
            out = await server.approve_invoice("inv_in", user={"is_super_admin": True})
        return out

    out = _run(run())
    assert out["already"] is False
    assert out["payment_status"] == "unpaid"
    assert "cariye işlendi" in out["message"]
    inv = db.invoices.docs[0]
    assert len(db.invoices.docs) == 1
    assert inv["status"] == "approved"
    assert inv["invoice_type"] == "purchase"
    assert inv["effects_applied"] is True
    assert inv["stock_effects_applied"] is True
    assert inv["payment_status"] == "unpaid"
    assert inv["e_type"] == "e_invoice"
    assert inv["gib_status"] == "Gelen E-Fatura (Yanıt Bekleniyor)"
    assert inv["posting_lock"] is False
    contact = db.contacts.docs[0]
    product = db.products.docs[0]
    assert contact["balance"] == pytest.approx(-120.0)
    assert product["stock_quantity"] == pytest.approx(7.0)


def test_second_click_does_not_duplicate_ledger():
    import server

    db = _db()
    db_patch, doc_patch = _patch(db)

    async def run():
        with db_patch, doc_patch:
            first = await server.approve_invoice("inv_in", user={"is_super_admin": True})
            second = await server.approve_invoice("inv_in", user={"is_super_admin": True})
        return first, second

    first, second = _run(run())
    assert first["already"] is False
    assert second["already"] is True
    assert "zaten" in second["message"]
    assert len(db.invoices.docs) == 1
    assert db.contacts.docs[0]["balance"] == pytest.approx(-120.0)
    assert db.products.docs[0]["stock_quantity"] == pytest.approx(7.0)


def test_overlapping_clicks_apply_effects_once():
    import server

    db = _db()
    real_apply = server._apply_invoice_effects

    async def slow_apply(inv):
        await asyncio.sleep(0)
        await real_apply(inv)

    db_patch, doc_patch = _patch(db)

    async def run():
        with db_patch, doc_patch, patch.object(server, "_apply_invoice_effects", new=slow_apply):
            first, second = await asyncio.gather(
                server.approve_invoice("inv_in", user={"is_super_admin": True}),
                server.approve_invoice("inv_in", user={"is_super_admin": True}),
            )
        return first, second

    first, second = _run(run())
    flags = {first["already"], second["already"]}
    assert flags == {False, True}
    assert len(db.invoices.docs) == 1
    assert db.contacts.docs[0]["balance"] == pytest.approx(-120.0)
    assert db.products.docs[0]["stock_quantity"] == pytest.approx(7.0)


def test_locked_draft_is_not_posted_again():
    import server

    db = _db()
    db.invoices.docs[0]["posting_lock"] = True
    db.contacts.docs[0]["balance"] = -50.0
    db_patch, doc_patch = _patch(db)

    async def run():
        with db_patch, doc_patch:
            return await server.approve_invoice("inv_in", user={"is_super_admin": True})

    out = _run(run())
    assert out["already"] is True
    assert db.contacts.docs[0]["balance"] == pytest.approx(-50.0)
    assert db.products.docs[0]["stock_quantity"] == pytest.approx(5.0)
    assert len(db.invoices.docs) == 1
