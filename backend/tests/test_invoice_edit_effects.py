"""Onaylı fatura düzenleme: reverse → reapply (stok + cari + kur)."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


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
            return MagicMock(matched_count=0, modified_count=0)
        if "$set" in upd:
            d.update(upd["$set"])
        if "$inc" in upd:
            for k, v in upd["$inc"].items():
                d[k] = float(d.get(k) or 0) + float(v)
        if "$unset" in upd:
            for k in upd["$unset"]:
                d.pop(k, None)
        return MagicMock(matched_count=1, modified_count=1)


def _mock_db(contacts, products, invoices):
    db = MagicMock()
    db.contacts = FakeColl(contacts)
    db.products = FakeColl(products)
    db.invoices = FakeColl(invoices)
    db.stock_lots = FakeColl([])
    return db


def test_purchase_qty_change_updates_stock_and_contact():
    import server

    contact = {"_id": "c1", "company_id": "co", "name": "Tedarikçi", "balance": -120.0}
    product = {"_id": "p1", "company_id": "co", "name": "Mal", "stock_quantity": 10.0}
    items = [{
        "product_id": "p1", "name": "Mal", "quantity": 2, "unit_price": 50,
        "vat_rate": 20, "total": 100, "vat_amount": 20, "total_incl": 120,
    }]
    inv = {
        "_id": "inv1", "company_id": "co", "invoice_type": "purchase",
        "status": "approved", "effects_applied": True, "stock_effects_applied": True,
        "edoc_id": "ed1", "source": "edoc_inbox",
        "contact_id": "c1", "contact_name": "Tedarikçi",
        "items": items, "grand_total": 120, "local_total": 120,
        "currency": "TRY", "fx_rate": 1, "paid_amount": 0, "payment_status": "unpaid",
        "price_mode": "excl",
    }
    db = _mock_db([contact], [product], [inv])
    new_items = [{
        "product_id": "p1", "name": "Mal", "quantity": 3, "unit_price": 50,
        "vat_rate": 20, "discount_rate": 0,
    }]

    async def stamp(*a, **k):
        return {"currency": "TRY", "fx_rate": 1.0, "fx_source": "manual"}

    with patch.object(server, "db", db), \
         patch("tenant_access.get_tenant_doc", AsyncMock(return_value=dict(inv))), \
         patch.object(server, "_invoice_gib_locked", return_value=False), \
         patch.object(server, "_fill_stock_codes", AsyncMock()), \
         patch.object(server.fx, "stamp", AsyncMock(side_effect=stamp)), \
         patch.object(server.fx, "typed_rate", return_value=None), \
         patch.object(server.fx, "local_of", side_effect=lambda g, r: float(g) * float(r or 1)), \
         patch.object(server.fx, "try_amount", side_effect=lambda d, a=None: float(a if a is not None else d.get("local_total") or d.get("grand_total") or 0)):
        out = _run(server.update_invoice("inv1", {"items": new_items}, user={"is_super_admin": True}))

    c = next(x for x in db.contacts.docs if x["_id"] == "c1")
    p = next(x for x in db.products.docs if x["_id"] == "p1")
    # 2→3 adet: stok +1; alış bakiyesi daha negatif (cari borç artar)
    assert p["stock_quantity"] == pytest.approx(11.0)
    assert c["balance"] < -120.0
    assert out.get("effects_applied") is True or inv.get("effects_applied")


def test_sales_contact_change_moves_balance():
    import server

    c_old = {"_id": "old", "company_id": "co", "name": "Eski", "balance": 100.0}
    c_new = {"_id": "new", "company_id": "co", "name": "Yeni", "balance": 0.0}
    product = {"_id": "p1", "company_id": "co", "name": "Mal", "stock_quantity": 5.0}
    items = [{
        "product_id": "p1", "name": "Mal", "quantity": 1, "unit_price": 100,
        "vat_rate": 0, "total": 100, "vat_amount": 0, "total_incl": 100,
    }]
    inv = {
        "_id": "inv2", "company_id": "co", "invoice_type": "sales",
        "status": "approved", "effects_applied": True,
        "contact_id": "old", "contact_name": "Eski",
        "items": items, "grand_total": 100, "local_total": 100,
        "currency": "TRY", "fx_rate": 1, "paid_amount": 0, "payment_status": "unpaid",
        "price_mode": "excl",
    }
    db = _mock_db([c_old, c_new], [product], [inv])

    async def stamp(*a, **k):
        return {"currency": "TRY", "fx_rate": 1.0, "fx_source": "manual"}

    with patch.object(server, "db", db), \
         patch("tenant_access.get_tenant_doc", AsyncMock(return_value=dict(inv))), \
         patch.object(server, "_invoice_gib_locked", return_value=False), \
         patch.object(server.fx, "stamp", AsyncMock(side_effect=stamp)), \
         patch.object(server.fx, "typed_rate", return_value=None), \
         patch.object(server.fx, "local_of", side_effect=lambda g, r: float(g) * float(r or 1)), \
         patch.object(server.fx, "try_amount", side_effect=lambda d, a=None: float(a if a is not None else d.get("local_total") or d.get("grand_total") or 0)):
        _run(server.update_invoice("inv2", {"contact_id": "new"}, user={"is_super_admin": True}))

    old = next(x for x in db.contacts.docs if x["_id"] == "old")
    new = next(x for x in db.contacts.docs if x["_id"] == "new")
    assert old["balance"] == pytest.approx(0.0)
    assert new["balance"] == pytest.approx(100.0)


def test_fx_rate_change_applies_contact_diff():
    import server

    contact = {"_id": "c1", "company_id": "co", "name": "Müşteri", "balance": 100.0}
    inv = {
        "_id": "inv3", "company_id": "co", "invoice_type": "sales",
        "status": "approved", "effects_applied": True,
        "contact_id": "c1", "contact_name": "Müşteri",
        "items": [{"name": "Hizmet", "quantity": 1, "unit_price": 100, "vat_rate": 0, "total": 100, "total_incl": 100}],
        "grand_total": 100, "local_total": 100, "currency": "USD", "fx_rate": 1.0,
        "paid_amount": 0, "payment_status": "unpaid", "price_mode": "excl",
    }
    db = _mock_db([contact], [], [inv])

    async def stamp(cid, currency, date, rate):
        r = float(rate or 1)
        return {"currency": currency or "USD", "fx_rate": r, "fx_source": "manual"}

    def try_amount(d, a=None):
        if a is not None:
            return float(a) * float(d.get("fx_rate") or 1)
        return float(d.get("local_total") or 0) or float(d.get("grand_total") or 0) * float(d.get("fx_rate") or 1)

    with patch.object(server, "db", db), \
         patch("tenant_access.get_tenant_doc", AsyncMock(return_value=dict(inv))), \
         patch.object(server, "_invoice_gib_locked", return_value=False), \
         patch.object(server.fx, "stamp", AsyncMock(side_effect=stamp)), \
         patch.object(server.fx, "typed_rate", side_effect=lambda c, r, s: r), \
         patch.object(server.fx, "local_of", side_effect=lambda g, r: float(g) * float(r or 1)), \
         patch.object(server.fx, "try_amount", side_effect=try_amount):
        _run(server.update_invoice("inv3", {"fx_rate": 2.0}, user={"is_super_admin": True}))

    c = next(x for x in db.contacts.docs if x["_id"] == "c1")
    # Eski local 100 geri alındı, yeni local 200 uygulandı → bakiye 200
    assert c["balance"] == pytest.approx(200.0)
