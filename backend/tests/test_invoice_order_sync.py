"""Onaylı fatura kalemi düzenlenince bağlı sipariş senkronu."""
import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException


def _run(coro):
    return asyncio.run(coro)


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *args, **kwargs):
        return self

    async def to_list(self, n):
        return [dict(r) for r in self.rows[:n]]


class Col:
    def __init__(self, docs=None):
        self.docs = [dict(d) for d in (docs or [])]
        self.find_queries = []
        self.updates = []

    def _match(self, doc, query):
        if not query:
            return True
        for key, val in query.items():
            if key == "$nor":
                if any(self._match(doc, sub) for sub in val):
                    return False
                continue
            if key == "$or":
                if not any(self._match(doc, sub) for sub in val):
                    return False
                continue
            if isinstance(val, dict):
                if "$in" in val and doc.get(key) not in val["$in"]:
                    return False
                if "$nin" in val and doc.get(key) in val["$nin"]:
                    return False
                if "$ne" in val and doc.get(key) == val["$ne"]:
                    return False
                continue
            if doc.get(key) != val:
                return False
        return True

    async def find_one(self, query=None, projection=None):
        self.find_queries.append(query or {})
        for doc in self.docs:
            if self._match(doc, query or {}):
                return dict(doc)
        return None

    def find(self, query=None, projection=None):
        self.find_queries.append(query or {})
        rows = [d for d in self.docs if self._match(d, query or {})]
        return FakeCursor(rows)

    async def update_one(self, query, update):
        self.updates.append((query, update))
        for doc in self.docs:
            if not self._match(doc, query or {}):
                continue
            if "$set" in update:
                doc.update(update["$set"])
            if "$push" in update:
                for key, val in update["$push"].items():
                    doc.setdefault(key, []).append(val)
            return


def _db(invoice, order, sessions=None):
    db = type("DB", (), {})()
    db.invoices = Col([invoice])
    db.orders = Col([order])
    db.contacts = Col([])
    db.products = Col([])
    db.stock_movements = Col([])
    db.order_pick_sessions = Col(sessions or [])
    return db


def _invoice(**extra):
    doc = {
        "_id": "inv1",
        "company_id": "co",
        "invoice_type": "sales",
        "status": "approved",
        "e_type": "e_invoice",
        "gib_status": "Onaylandı",
        "invoice_number": "TA2026000000007",
        "order_id": "ord1",
        "contact_id": "c1",
        "currency": "USD",
        "fx_rate": 40,
        "fx_source": "manual",
        "price_mode": "excl",
        "effects_applied": False,
        "paid_amount": 0,
        "payment_status": "unpaid",
        "grand_total": 12,
        "items": [{"name": "Eski", "quantity": 1, "unit_price": 10, "vat_rate": 20}],
    }
    doc.update(extra)
    return doc


def _order(**extra):
    doc = {
        "_id": "ord1",
        "company_id": "co",
        "channel": "b2b",
        "order_status": "approved",
        "invoice_id": "inv1",
        "invoice_number": "TA2026000000007",
        "is_invoiced": True,
        "currency": "TRY",
        "fx_rate": 1,
        "grand_total": 12,
        "total_amount": 12,
        "items": [{"product_name": "Eski", "quantity": 1, "unit_price": 10, "vat_rate": 20}],
    }
    doc.update(extra)
    return doc


NEW_ITEMS = [{
    "product_id": "p1",
    "name": "Profil",
    "quantity": 2,
    "unit_price": 50000,
    "vat_rate": 20,
    "unit": "Adet",
}]


def _patches(server, db, invoice):
    async def stamp(cid, currency, on_date, rate):
        cur = currency or "TRY"
        fx = float(rate or 1)
        return {"currency": cur, "fx_rate": fx, "fx_source": "manual", "fx_date": "2026-10-15"}

    return (
        patch.object(server, "db", db),
        patch("tenant_access.get_tenant_doc", AsyncMock(return_value=dict(invoice))),
        patch.object(server, "_fill_stock_codes", AsyncMock()),
        patch.object(server.fx, "stamp", AsyncMock(side_effect=stamp)),
        patch.object(server.fx, "typed_rate", side_effect=lambda c, r, s: r),
        patch.object(server.fx, "local_of", side_effect=lambda g, r: float(g) * float(r or 1)),
    )


def _edit(server, db, invoice, req):
    from contextlib import ExitStack
    stack = ExitStack()
    for ctx in _patches(server, db, invoice):
        stack.enter_context(ctx)
    stack.__enter__()
    try:
        return _run(server.update_invoice("inv1", req, user={"is_super_admin": True}))
    finally:
        stack.__exit__(None, None, None)


def test_approved_unlocked_updates_order_without_relinking():
    import server

    invoice = _invoice()
    order = _order()
    db = _db(invoice, order)
    out = _edit(server, db, invoice, {"items": NEW_ITEMS})
    saved = db.orders.docs[0]
    assert out["grand_total"] == pytest.approx(120000)
    assert saved["grand_total"] == pytest.approx(120000)
    assert saved["items"][0]["product_name"] == "Profil"
    assert saved["items"][0]["quantity"] == 2
    assert saved["is_invoiced"] is True
    assert saved["invoice_id"] == "inv1"
    assert saved["invoice_number"] == "TA2026000000007"
    assert saved["order_status"] == "approved"
    assert saved["currency"] == "USD"
    assert saved["fx_rate"] == pytest.approx(40)
    assert saved["local_total"] == pytest.approx(4800000)
    assert saved["order_history"][-1]["message"] == "Fatura TA2026000000007 düzenlemesinden güncellendi"
    assert saved["order_history"][-1]["updated_at"]
    assert saved["updated_at"]
    set_keys = set()
    for _q, upd in db.orders.updates:
        set_keys |= set((upd.get("$set") or {}))
    assert "order_status" not in set_keys
    assert db.products.updates == []
    assert db.contacts.updates == []
    assert db.stock_movements.updates == []
    assert db.order_pick_sessions.updates == []


def test_approved_paper_invoice_updates_order():
    import server

    invoice = _invoice(e_type="paper", einvoice_state="paper", gib_status="Kağıt Fatura (Matbu)", currency="TRY", fx_rate=1)
    order = _order(currency="TRY", fx_rate=1)
    db = _db(invoice, order)
    _edit(server, db, invoice, {"items": NEW_ITEMS})
    saved = db.orders.docs[0]
    assert saved["items"][0]["product_name"] == "Profil"
    assert saved["is_invoiced"] is True
    assert saved["currency"] == "TRY"


def test_gib_sent_invoice_rejects_and_leaves_order():
    import server

    invoice = _invoice(einvoice_state="sent", gib_status="Başarıyla Tamamlandı", gib_tracking_id="EAR-1")
    order = _order()
    db = _db(invoice, order)
    with pytest.raises(HTTPException) as ei:
        _edit(server, db, invoice, {"items": NEW_ITEMS})
    assert ei.value.status_code == 400
    assert db.orders.updates == []
    assert db.orders.docs[0]["grand_total"] == 12
    assert db.orders.docs[0]["items"][0]["product_name"] == "Eski"
    assert db.invoices.updates == []


def test_order_linked_to_another_invoice_is_not_touched():
    import server

    invoice = _invoice()
    order = _order(invoice_id="inv_other", invoice_number="TA-OTHER")
    db = _db(invoice, order)
    _edit(server, db, invoice, {"items": NEW_ITEMS})
    assert db.orders.updates == []
    assert db.orders.docs[0]["items"][0]["product_name"] == "Eski"
    assert db.orders.docs[0]["invoice_id"] == "inv_other"
    assert db.invoices.docs[0]["items"][0]["name"] == "Profil"


def test_other_company_order_is_not_touched():
    import server

    invoice = _invoice()
    order = _order(company_id="other")
    db = _db(invoice, order)
    _edit(server, db, invoice, {"items": NEW_ITEMS})
    assert db.orders.updates == []
    assert db.orders.docs[0]["company_id"] == "other"
    assert db.orders.docs[0]["grand_total"] == 12
    assert any(q.get("company_id") == "co" and q.get("_id") == "ord1" for q in db.orders.find_queries)


def test_cancelled_and_returned_orders_stay():
    import server

    for status in ("cancelled", "returned", "partially_returned"):
        invoice = _invoice()
        order = _order(order_status=status)
        db = _db(invoice, order)
        _edit(server, db, invoice, {"items": NEW_ITEMS})
        assert db.orders.updates == [], status
        assert db.orders.docs[0]["order_status"] == status


def test_marketplace_and_shipped_and_open_pick_only_warn():
    import server

    invoice = _invoice()
    market = _order(channel="trendyol")
    db = _db(invoice, market)
    _edit(server, db, invoice, {"items": NEW_ITEMS})
    assert db.orders.updates == []

    shipped = _order(order_status="shipped")
    db = _db(invoice, shipped)
    _edit(server, db, invoice, {"items": NEW_ITEMS})
    assert db.orders.updates == []
    assert db.order_pick_sessions.updates == []

    picking = _order(pick_status="picking")
    ses = {"_id": "ses1", "company_id": "co", "order_id": "ord1", "status": "picking", "items": [{"ordered_qty": 1}]}
    db = _db(invoice, picking, sessions=[ses])
    _edit(server, db, invoice, {"items": NEW_ITEMS})
    assert db.orders.updates == []
    assert db.order_pick_sessions.updates == []
    assert db.order_pick_sessions.docs[0]["items"] == [{"ordered_qty": 1}]


def test_draft_edit_still_updates_order_link_and_skips_invoiced():
    import server

    invoice = _invoice(status="draft", e_type="e_archive", gib_status="Taslak", currency="TRY", fx_rate=1)
    order = _order(is_invoiced=False, order_status="pending", currency="TRY", fx_rate=1)
    db = _db(invoice, order)
    _edit(server, db, invoice, {"items": NEW_ITEMS})
    saved = db.orders.docs[0]
    assert saved["items"][0]["product_name"] == "Profil"
    assert saved["grand_total"] == pytest.approx(120000)
    assert saved["is_invoiced"] is False
    assert saved["invoice_id"] == "inv1"
    assert saved["invoice_number"] == "TA2026000000007"
    assert saved["order_status"] == "pending"

    invoiced = _order(is_invoiced=True)
    invoice = _invoice(status="draft", gib_status="Taslak")
    db = _db(invoice, invoiced)
    _edit(server, db, invoice, {"items": NEW_ITEMS})
    assert db.orders.docs[0]["items"][0]["product_name"] == "Eski"
    assert db.orders.updates == []


def test_discount_change_syncs_order_and_source_order_id():
    import server

    invoice = _invoice(
        order_id=None,
        source_order_id="ord1",
        currency="TRY",
        fx_rate=1,
        items=[{"name": "Kalem", "quantity": 3, "unit_price": 100, "vat_rate": 20, "unit": "Adet"}],
    )
    order = _order(currency="TRY", fx_rate=1)
    db = _db(invoice, order)
    _edit(server, db, invoice, {"general_discount_rate": 10})
    saved = db.orders.docs[0]
    assert saved["items"][0]["product_name"] == "Kalem"
    assert saved["items"][0]["quantity"] == 3
    assert any(q.get("_id") == "ord1" and q.get("company_id") == "co" for q in db.orders.find_queries)


def test_effect_reapply_is_once_and_rollback_skips_order():
    import server

    invoice = _invoice(effects_applied=True, currency="TRY", fx_rate=1)
    order = _order(currency="TRY", fx_rate=1)
    db = _db(invoice, order)
    apply = AsyncMock()
    reverse = AsyncMock()
    from contextlib import ExitStack
    stack = ExitStack()
    for ctx in _patches(server, db, invoice):
        stack.enter_context(ctx)
    stack.enter_context(patch.object(server, "_apply_invoice_effects", apply))
    stack.enter_context(patch.object(server, "_reverse_invoice_effects", reverse))
    stack.__enter__()
    try:
        _run(server.update_invoice("inv1", {"items": NEW_ITEMS}, user={"is_super_admin": True}))
    finally:
        stack.__exit__(None, None, None)
    assert apply.await_count == 1
    assert reverse.await_count == 1
    assert db.orders.docs[0]["items"][0]["product_name"] == "Profil"
    assert db.products.updates == []

    invoice = _invoice(effects_applied=True, currency="TRY", fx_rate=1)
    order = _order(currency="TRY", fx_rate=1)
    db = _db(invoice, order)
    apply = AsyncMock(side_effect=RuntimeError("stock"))
    reverse = AsyncMock()
    stack = ExitStack()
    for ctx in _patches(server, db, invoice):
        stack.enter_context(ctx)
    stack.enter_context(patch.object(server, "_apply_invoice_effects", apply))
    stack.enter_context(patch.object(server, "_reverse_invoice_effects", reverse))
    stack.__enter__()
    try:
        with pytest.raises(HTTPException) as ei:
            _run(server.update_invoice("inv1", {"items": NEW_ITEMS}, user={"is_super_admin": True}))
    finally:
        stack.__exit__(None, None, None)
    assert ei.value.status_code == 500
    assert db.orders.updates == []
    assert db.orders.docs[0]["grand_total"] == 12


def test_list_and_detail_warning_uses_one_invoice_query():
    import server

    orders = [
        {"_id": "a", "id": "a", "company_id": "co", "invoice_id": "inv1", "grand_total": 100, "order_number": "B2B-1", "order_status": "approved", "order_date": "2026-10-01T00:00:00+00:00"},
        {"_id": "b", "id": "b", "company_id": "co", "invoice_id": "inv2", "grand_total": 50, "order_number": "B2B-2", "order_status": "approved", "order_date": "2026-10-02T00:00:00+00:00"},
    ]
    invoices = [
        {"_id": "inv1", "company_id": "co", "grand_total": 180, "e_type": "paper", "invoice_number": "TA1"},
        {"_id": "inv2", "company_id": "co", "grand_total": 50, "e_type": "e_archive", "invoice_number": "TA2"},
    ]
    db = type("DB", (), {})()
    db.orders = Col(orders)
    db.invoices = Col(invoices)

    async def identity(docs, company_id=None):
        return docs

    with patch.object(server, "db", db), \
         patch.object(server, "_enrich_orders_marketplace_item_media", identity), \
         patch.object(server, "_enrich_orders_stock_matches", identity), \
         patch.object(server, "_enrich_orders_production_flags", identity):
        listed = _run(server.list_orders(company_id="co"))
    invoice_finds = [q for q in db.invoices.find_queries if "$in" in str(q.get("_id"))]
    assert len(invoice_finds) == 1
    assert set(invoice_finds[0]["_id"]["$in"]) == {"inv1", "inv2"}
    by_no = {row["order_number"]: row for row in listed}
    assert by_no["B2B-1"]["invoice_mismatch_warning"] == "Fatura siparişten farklı (Fatura: 180,00 TL)"
    assert "invoice_mismatch_warning" not in by_no["B2B-2"]

    db.invoices.find_queries.clear()
    with patch.object(server, "db", db), \
         patch("tenant_access.get_tenant_doc", AsyncMock(return_value=dict(orders[0]))):
        detail = _run(server.get_order("a", user={"is_super_admin": True}))
    assert detail["invoice_mismatch_warning"] == "Fatura siparişten farklı (Fatura: 180,00 TL)"
    detail_finds = [q for q in db.invoices.find_queries if "$in" in str(q.get("_id"))]
    assert len(detail_finds) == 1
