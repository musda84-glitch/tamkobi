"""Giden irsaliyeleri tek taslak satış faturasında birleştirme."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from mysql_store import apply_update, match_query


def _run(coro):
    return asyncio.run(coro)


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *args, **kwargs):
        return self

    async def to_list(self, n=None):
        rows = self.rows if n is None else self.rows[:n]
        return [dict(r) for r in rows]


class FakeColl:
    def __init__(self, docs=None):
        self.docs = [dict(d) for d in (docs or [])]
        self._lock = asyncio.Lock()

    async def find_one(self, q=None, projection=None):
        for doc in self.docs:
            if match_query(doc, q or {}):
                return dict(doc)
        return None

    def find(self, q=None, projection=None):
        return _Cursor([d for d in self.docs if match_query(d, q or {})])

    async def insert_one(self, doc):
        self.docs.append(dict(doc))
        return MagicMock(inserted_id=doc.get("_id"))

    async def delete_one(self, q):
        for i, doc in enumerate(self.docs):
            if match_query(doc, q or {}):
                self.docs.pop(i)
                return MagicMock(deleted_count=1)
        return MagicMock(deleted_count=0)

    async def count_documents(self, q=None):
        return sum(1 for doc in self.docs if match_query(doc, q or {}))

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
        self.idempotency_keys = None

    def __getitem__(self, name):
        return getattr(self, name)


USER = {"is_super_admin": True, "active_company_id": "c1", "company_ids": ["c1"]}


def _item(name, qty, price=100.0, product_id="p1", discount=10.0):
    return {
        "product_id": product_id,
        "name": name,
        "quantity": qty,
        "unit": "Adet",
        "unit_price": price,
        "vat_rate": 0,
        "discount_rate": discount,
        "total": qty * price,
    }


def _dispatch(did, number, **extra):
    doc = {
        "_id": did,
        "company_id": "c1",
        "invoice_type": "dispatch",
        "e_type": "e_dispatch",
        "invoice_number": number,
        "status": "draft",
        "dispatch_status": "draft",
        "contact_id": "ct1",
        "contact_name": "Cari A",
        "contact_tax_id": "1234567890",
        "currency": "USD",
        "fx_rate": 34.5,
        "fx_source": "manual",
        "general_discount_rate": 5,
        "general_discount_amount": 0,
        "issue_date": "2026-10-01",
        "items": [_item(number, 2)],
    }
    doc.update(extra)
    return doc


def _seed(db, dispatches, orders=None, stock=100):
    db.products.docs.append({"_id": "p1", "company_id": "c1", "vat_rate": 10, "stock_quantity": stock, "sku": "SKU1"})
    db.contacts.docs.append({
        "_id": "ct1", "company_id": "c1", "name": "Cari A",
        "tax_number_or_id": "1234567890", "tax_office": "Kadıköy", "balance": 0,
    })
    db.invoices.docs.extend(dispatches)
    db.orders.docs.extend(orders or [])


def _sales(db):
    return [d for d in db.invoices.docs if d.get("invoice_type") == "sales"]


async def _merge(server, db, ids):
    with patch.object(server, "db", db):
        return await server._merge_dispatches_core(ids, USER, company_id="c1")


def test_two_dispatches_become_one_draft_with_two_despatch_refs():
    import server
    import ubl_export

    db = FakeDB()
    d1 = _dispatch(
        "d1", "IRS-1", order_id="o1", order_number="SIP-1", issue_date="2026-10-01",
        items=[_item("Kalem A", 2), _item("Kalem B", 1, product_id="p1")],
    )
    d2 = _dispatch(
        "d2", "IRS-2", order_id="o2", order_number="SIP-2", issue_date="2026-10-03",
        dispatch_status="sent", einvoice_state="sent",
        gib_uuid="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        items=[_item("Kalem C", 3)],
    )
    _seed(db, [d1, d2], [
        {"_id": "o1", "company_id": "c1", "invoice_id": None, "is_invoiced": False},
        {"_id": "o2", "company_id": "c1", "invoice_id": None, "is_invoiced": False},
    ])
    doc = _run(_merge(server, db, ["d1", "d2"]))
    sales = _sales(db)
    assert len(sales) == 1
    inv = sales[0]
    assert inv["status"] == "draft"
    assert inv["e_type"] == "e_archive"
    assert inv["currency"] == "USD"
    assert float(inv["fx_rate"]) == 34.5
    assert float(inv["general_discount_rate"]) == 5
    assert inv["dispatch_ids"] == ["d1", "d2"]
    assert inv["dispatch_numbers"] == ["IRS-1", "IRS-2"]
    assert inv["order_ids"] == ["o1", "o2"]
    assert [it["name"] for it in inv["items"]] == ["Kalem A", "Kalem B", "Kalem C"]
    assert [it["dispatch_id"] for it in inv["items"]] == ["d1", "d1", "d2"]
    assert [it.get("order_id") for it in inv["items"]] == ["o1", "o1", "o2"]
    assert all(int(it["vat_rate"]) == 10 for it in inv["items"])
    assert all(float(it["discount_rate"]) == 10 for it in inv["items"])
    assert inv.get("stock_effects_from_dispatch") is False
    for did, num in (("d1", "IRS-1"), ("d2", "IRS-2")):
        row = next(x for x in db.invoices.docs if x["_id"] == did)
        assert row["converted_invoice_id"] == inv["_id"]
        assert row["converted_invoice_number"] == inv["invoice_number"]
        assert row["dispatch_status"] == "invoiced"
    for oid in ("o1", "o2"):
        order = next(x for x in db.orders.docs if x["_id"] == oid)
        assert order["invoice_id"] == inv["_id"]
        assert order["invoice_number"] == inv["invoice_number"]
        assert order.get("is_invoiced") is not True
    xml = ubl_export.build_invoice_ubl(
        inv,
        {"name": "Satıcı", "tax_number": "1234567801", "city": "İstanbul", "address": "A"},
        {"name": "Alıcı", "tax_number_or_id": "1234567890", "city": "Ankara"},
    ).decode()
    assert xml.count("<cac:DespatchDocumentReference>") == 2
    assert "IRS-1" in xml and "IRS-2" in xml
    assert "2026-10-01" in xml and "2026-10-03" in xml
    assert doc["invoice_number"] == inv["invoice_number"]

    async def _warn():
        with patch.object(server, "db", db):
            return await server.dispatch_invoice.draft_dispatch_warning(db, inv)

    warn = _run(_warn())
    assert "IRS-1" in warn
    assert "IRS-2" not in warn
    assert "taslak" in warn.lower()


def test_merge_blocks_mismatch_invoiced_cancelled_incoming_and_other_company():
    import server

    async def _expect(dispatches, ids, code, needle):
        db = FakeDB()
        _seed(db, dispatches)
        with patch.object(server, "db", db), pytest.raises(HTTPException) as exc:
            await server._merge_dispatches_core(ids, USER, company_id="c1")
        assert exc.value.status_code == code
        assert needle in exc.value.detail
        assert _sales(db) == []

    base = _dispatch("d1", "IRS-1", items=[_item("A", 1)])
    other_contact = _dispatch("d2", "IRS-2", contact_id="ct2", contact_name="Cari B", items=[_item("B", 1)])
    _run(_expect([base, other_contact], ["d1", "d2"], 409, "Farklı cari"))

    other_ccy = _dispatch("d2", "IRS-2", currency="TRY", fx_rate=1, items=[_item("B", 1)])
    _run(_expect([base, other_ccy], ["d1", "d2"], 409, "para birimi"))

    invoiced = _dispatch("d2", "IRS-2", converted_invoice_id="old", items=[_item("B", 1)])
    _run(_expect([base, invoiced], ["d1", "d2"], 409, "faturalanmış"))

    status_invoiced = _dispatch("d2", "IRS-2", dispatch_status="invoiced", items=[_item("B", 1)])
    _run(_expect([base, status_invoiced], ["d1", "d2"], 409, "faturalanmış"))

    cancelled = _dispatch("d2", "IRS-2", status="cancelled", items=[_item("B", 1)])
    _run(_expect([base, cancelled], ["d1", "d2"], 409, "İptal"))

    incoming = _dispatch("d2", "IRS-2", direction="incoming", source="edoc_inbox", items=[_item("B", 1)])
    _run(_expect([base, incoming], ["d1", "d2"], 409, "Gelen"))

    foreign = _dispatch("d9", "IRS-9", company_id="c2", items=[_item("Z", 1)])
    _run(_expect([foreign], ["d9"], 404, "İrsaliye bulunamadı"))
    db = FakeDB()
    _seed(db, [base])

    async def _missing():
        with patch.object(server, "db", db), pytest.raises(HTTPException) as exc:
            await server._merge_dispatches_core(["nope"], USER, company_id="c1")
        return exc.value

    missing = _run(_missing())
    assert missing.status_code == 404


def test_approve_drops_stock_once_and_marks_both_orders():
    import server

    db = FakeDB()
    d1 = _dispatch("d1", "IRS-1", order_id="o1", currency="TRY", fx_rate=1, items=[_item("A", 2)])
    d2 = _dispatch("d2", "IRS-2", order_id="o2", currency="TRY", fx_rate=1, items=[_item("B", 3)])
    _seed(db, [d1, d2], [
        {"_id": "o1", "company_id": "c1"},
        {"_id": "o2", "company_id": "c1"},
    ], stock=50)
    doc = _run(_merge(server, db, ["d1", "d2"]))
    product_before = next(p for p in db.products.docs if p["_id"] == "p1")["stock_quantity"]
    assert product_before == 50

    async def _approve():
        with patch.object(server, "db", db), patch.object(
            server, "_post_marketplace_settlement", AsyncMock(return_value=None)
        ), patch.object(server, "_ensure_order_contact", AsyncMock(return_value=None)):
            await server.approve_invoice(doc["_id"], USER)
            await server.approve_invoice(doc["_id"], USER)

    _run(_approve())
    product = next(p for p in db.products.docs if p["_id"] == "p1")
    contact = next(c for c in db.contacts.docs if c["_id"] == "ct1")
    inv = next(x for x in db.invoices.docs if x["_id"] == doc["_id"])
    assert product["stock_quantity"] == 45
    assert contact["balance"] == pytest.approx(server.fx.try_amount(inv))
    assert all(o["is_invoiced"] is True for o in db.orders.docs)


def test_stock_skip_when_dispatch_already_posted_stock():
    import server

    db = FakeDB()
    d1 = _dispatch("d1", "IRS-1", currency="TRY", fx_rate=1, effects_applied=True, items=[_item("A", 4)])
    d2 = _dispatch("d2", "IRS-2", currency="TRY", fx_rate=1, effects_applied=True, items=[_item("B", 1)])
    _seed(db, [d1, d2], stock=20)
    doc = _run(_merge(server, db, ["d1", "d2"]))
    inv = next(x for x in db.invoices.docs if x["_id"] == doc["_id"])
    assert inv["stock_effects_from_dispatch"] is True

    async def _apply():
        with patch.object(server, "db", db):
            await server._apply_invoice_effects(inv)

    _run(_apply())
    product = next(p for p in db.products.docs if p["_id"] == "p1")
    contact = next(c for c in db.contacts.docs if c["_id"] == "ct1")
    assert product["stock_quantity"] == 20
    assert contact["balance"] == pytest.approx(server.fx.try_amount(inv))


def test_delete_draft_releases_dispatches_and_orders():
    import server

    db = FakeDB()
    d1 = _dispatch("d1", "IRS-1", order_id="o1", dispatch_status="draft")
    d2 = _dispatch("d2", "IRS-2", order_id="o2", dispatch_status="sent", einvoice_state="sent")
    _seed(db, [d1, d2], [
        {"_id": "o1", "company_id": "c1"},
        {"_id": "o2", "company_id": "c1", "is_invoiced": True},
    ])
    doc = _run(_merge(server, db, ["d1", "d2"]))

    async def _delete():
        with patch.object(server, "db", db), patch.object(
            server, "_cancel_promissory_for_query", AsyncMock()
        ), patch.object(server.trash, "soft_delete", AsyncMock(return_value="trash1")):
            return await server._soft_delete_invoice_doc(doc, note="Taslak fatura", cascade=False)

    _run(_delete())
    d1r = next(x for x in db.invoices.docs if x["_id"] == "d1")
    d2r = next(x for x in db.invoices.docs if x["_id"] == "d2")
    assert d1r["dispatch_status"] == "draft"
    assert d2r["dispatch_status"] == "sent"
    assert "converted_invoice_id" not in d1r
    assert "converted_invoice_id" not in d2r
    for order in db.orders.docs:
        assert "invoice_id" not in order
        assert order["is_invoiced"] is False


def test_cancel_issued_invoice_releases_dispatch_links():
    import server

    db = FakeDB()
    d1 = _dispatch("d1", "IRS-1", order_id="o1", currency="TRY", fx_rate=1)
    _seed(db, [d1], [{"_id": "o1", "company_id": "c1"}])
    doc = _run(_merge(server, db, ["d1"]))
    stored = next(x for x in db.invoices.docs if x["_id"] == doc["_id"])
    stored["status"] = "approved"
    stored["e_type"] = "e_archive"
    stored["effects_applied"] = True

    async def _cancel():
        with patch.object(server, "db", db), patch.object(
            server, "_cancel_promissory_for_query", AsyncMock()
        ), patch("contact_balance.sync_contact_balance", AsyncMock()):
            return await server._cancel_invoice_core(doc["_id"], {}, USER)

    out = _run(_cancel())
    assert out["status"] == "success"
    row = next(x for x in db.invoices.docs if x["_id"] == "d1")
    assert row["dispatch_status"] == "draft"
    assert "converted_invoice_id" not in row
    order = db.orders.docs[0]
    assert "invoice_id" not in order
    assert order["is_invoiced"] is False


def test_concurrent_merge_creates_one_invoice():
    import server

    db = FakeDB()
    d1 = _dispatch("d1", "IRS-1", currency="TRY", fx_rate=1, items=[_item("A", 1)])
    d2 = _dispatch("d2", "IRS-2", currency="TRY", fx_rate=1, items=[_item("B", 1)])
    _seed(db, [d1, d2])
    real = server._create_invoice_core

    async def slow(inv, user):
        await asyncio.sleep(0)
        return await real(inv, user)

    async def _race():
        with patch.object(server, "db", db), patch.object(server, "_create_invoice_core", side_effect=slow):
            return await asyncio.gather(
                server._merge_dispatches_core(["d1", "d2"], USER, company_id="c1"),
                server._merge_dispatches_core(["d1", "d2"], USER, company_id="c1"),
                return_exceptions=True,
            )

    results = _run(_race())
    oks = [r for r in results if isinstance(r, dict)]
    errs = [r for r in results if isinstance(r, HTTPException)]
    assert len(oks) == 1
    assert len(errs) == 1
    assert errs[0].status_code == 409
    sales = _sales(db)
    assert len(sales) == 1
    winner = sales[0]["_id"]
    assert oks[0]["_id"] == winner
    for did in ("d1", "d2"):
        row = next(x for x in db.invoices.docs if x["_id"] == did)
        assert row["converted_invoice_id"] == winner


def test_same_idempotency_key_does_not_create_a_second_invoice():
    import idempotency
    import server

    db = FakeDB()
    d1 = _dispatch("d1", "IRS-1", currency="TRY", fx_rate=1, items=[_item("A", 1)])
    d2 = _dispatch("d2", "IRS-2", currency="TRY", fx_rate=1, items=[_item("B", 1)])
    _seed(db, [d1, d2])

    class FakeIdempo:
        def __init__(self):
            self.docs = {}

        async def create_index(self, *a, **k):
            return None

        async def insert_one(self, doc):
            if doc["_id"] in self.docs:
                raise idempotency.DuplicateKeyError("dup")
            self.docs[doc["_id"]] = dict(doc)

        async def find_one(self, q):
            row = self.docs.get(q.get("_id"))
            return dict(row) if row else None

        async def update_one(self, q, upd):
            row = self.docs.get(q.get("_id"))
            if not row:
                return MagicMock(matched_count=0)
            if "$set" in upd:
                row.update(upd["$set"])
            return MagicMock(matched_count=1)

        async def delete_one(self, q):
            self.docs.pop(q.get("_id"), None)
            return MagicMock(deleted_count=1)

    db.idempotency_keys = FakeIdempo()
    prev = idempotency._INDEXED
    idempotency._INDEXED = True
    request = MagicMock()
    request.headers = {}
    body = {"dispatch_ids": ["d1", "d2"], "company_id": "c1", "idempotency_key": "merge-once"}

    async def _twice():
        with patch.object(server, "db", db):
            first = await server.merge_dispatches_to_invoice(request, body, USER)
            second = await server.merge_dispatches_to_invoice(request, body, USER)
            return first, second

    try:
        first, second = _run(_twice())
    finally:
        idempotency._INDEXED = prev
    assert len(_sales(db)) == 1
    assert first["invoice"]["id"] == second["invoice"]["id"]
    assert first["status"] == "success"


def test_single_convert_uses_merge_and_keeps_exists_and_linked():
    import server

    db = FakeDB()
    sales = {
        "_id": "sf-old",
        "company_id": "c1",
        "invoice_type": "sales",
        "invoice_number": "SF-OLD",
        "status": "draft",
        "e_type": "e_archive",
    }
    linked_disp = _dispatch("d-link", "IRS-LINK", order_id="o-link", currency="TRY", fx_rate=1)
    exists_disp = _dispatch(
        "d-ex", "IRS-EX", currency="TRY", fx_rate=1, converted_invoice_id="sf-old",
    )
    fresh = _dispatch("d-new", "IRS-NEW", order_id="o-new", order_number="SIP-NEW", currency="TRY", fx_rate=1)
    db.invoices.docs.extend([sales, linked_disp, exists_disp, fresh])
    db.orders.docs.extend([
        {"_id": "o-link", "company_id": "c1", "invoice_id": "sf-old", "invoice_number": "SF-OLD"},
        {"_id": "o-new", "company_id": "c1"},
    ])
    db.products.docs.append({"_id": "p1", "company_id": "c1", "vat_rate": 10, "stock_quantity": 8, "sku": "SKU1"})
    db.contacts.docs.append({"_id": "ct1", "company_id": "c1", "name": "Cari A", "tax_number_or_id": "1234567890", "balance": 0})

    async def _calls():
        with patch.object(server, "db", db):
            exists = await server.convert_dispatch_to_invoice("d-ex", {}, USER)
            linked = await server.convert_dispatch_to_invoice("d-link", {}, USER)
            created = await server.convert_dispatch_to_invoice("d-new", {}, USER)
            return exists, linked, created

    exists, linked, created = _run(_calls())
    assert exists["status"] == "exists"
    assert "SF-OLD" in exists["message"]
    assert linked["status"] == "linked"
    assert "bağlandı" in linked["message"]
    assert created["status"] == "success"
    assert created["message"] == f"IRS-NEW → {created['invoice']['invoice_number']} satış faturası oluşturuldu."
    assert created["invoice"]["e_type"] == "e_archive"
    assert created["invoice"]["notes"].startswith("İrsaliye: IRS-NEW")
    assert "SIP-NEW" in created["invoice"]["notes"]
    sales_rows = _sales(db)
    assert len(sales_rows) == 2
    fresh_row = next(x for x in db.invoices.docs if x["_id"] == "d-new")
    assert fresh_row["dispatch_status"] == "invoiced"
    assert fresh_row["converted_invoice_number"] == created["invoice"]["invoice_number"]
