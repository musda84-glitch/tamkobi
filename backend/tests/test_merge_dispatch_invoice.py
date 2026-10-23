"""Giden irsaliyeleri tek taslak satış faturasında birleştirme."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from mysql_store import apply_update, match_query, new_upsert_doc


def _run(coro):
    return asyncio.run(coro)


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *args, **kwargs):
        return self

    def limit(self, n=None):
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
                return MagicMock(matched_count=1, modified_count=1, upserted_id=None)
        if not upsert:
            return MagicMock(matched_count=0, modified_count=0, upserted_id=None)
        created = new_upsert_doc(upd, q)
        self.docs.append(created)
        return MagicMock(matched_count=0, modified_count=0, upserted_id=created.get("_id"))

    async def find_one_and_update(self, q, upd, upsert=False, return_document=True, projection=None):
        for i, doc in enumerate(self.docs):
            if not match_query(doc, q or {}):
                continue
            before = dict(doc)
            self.docs[i] = apply_update(doc, upd, q)
            found = self.docs[i] if return_document else before
            return dict(found)
        if not upsert:
            return None
        created = new_upsert_doc(upd, q)
        self.docs.append(created)
        return dict(created) if return_document else None

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
        self.counters = FakeColl()
        self.companies = FakeColl()
        self.einvoice_settings = FakeColl()
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
        gib_invoice_id="GIB2026000002",
        gib_issue_date="2026-10-04",
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
    assert xml.count("<cac:DespatchDocumentReference>") == 1
    assert "GIB2026000002" in xml
    assert "2026-10-04" in xml
    assert "<cbc:DocumentTypeCode>IRSALIYE</cbc:DocumentTypeCode>" not in xml
    assert inv.get("despatch_gib_ids") == ["GIB2026000002"]
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
        {"_id": "o2", "company_id": "c1"},
    ])
    doc = _run(_merge(server, db, ["d1", "d2"]))
    next(x for x in db.orders.docs if x["_id"] == "o2")["is_invoiced"] = True

    async def _delete():
        with patch.object(server, "db", db), patch.object(
            server, "_cancel_promissory_for_query", AsyncMock()
        ), patch.object(server.trash, "soft_delete", AsyncMock(return_value="trash1")):
            return await server._soft_delete_invoice_doc(doc, note="Taslak fatura")

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


def test_vat_rate_keeps_explicit_zero_and_defaults_missing():
    import dispatch_invoice

    assert dispatch_invoice.vat_rate_for_line({"vat_rate": 0}, {}) == 0
    assert dispatch_invoice.vat_rate_for_line({"vat_rate": "0"}, {}) == 0
    assert dispatch_invoice.vat_rate_for_line({}, {}) == 20
    assert dispatch_invoice.vat_rate_for_line({"vat_rate": None}, {}) == 20
    assert dispatch_invoice.vat_rate_for_line({"product_id": "p", "vat_rate": 0}, {"p": {"vat_rate": 10}}) == 10
    assert dispatch_invoice.vat_rate_for_line({"product_id": "p", "vat_rate": 0}, {"p": {"vat_rate": 0}}) == 0


def test_marketplace_intake_drafts_collapse_and_repeat_is_idempotent():
    import server

    db = FakeDB()
    draft = {
        "_id": "draft-old",
        "company_id": "c1",
        "invoice_type": "sales",
        "invoice_number": "TA-OLD",
        "status": "draft",
        "einvoice_state": "draft",
        "order_id": "o1",
        "grand_total": 10,
    }
    d1 = _dispatch(
        "d1", "IRS-1", order_id="o1", order_number="SIP-1", currency="TRY", fx_rate=1,
        source_channel="trendyol", shipping_address="Adres 1", city="İstanbul",
        customer_order_number="TY-100", payment_method="Kredi Kartı",
        items=[_item("Kalem A", 1, price=80, discount=0)],
    )
    d2 = _dispatch(
        "d2", "IRS-2", order_id="o1", order_number="SIP-1", currency="TRY", fx_rate=1,
        source_channel="trendyol",
        items=[_item("Kalem B", 1, price=40, discount=0)],
    )
    order = {
        "_id": "o1",
        "company_id": "c1",
        "order_number": "SIP-1",
        "channel": "trendyol",
        "invoice_id": "draft-old",
        "invoice_number": "TA-OLD",
        "is_invoiced": False,
        "customer_order_number": "TY-100",
        "payment_method": "Kredi Kartı",
        "shipping_address": "Adres 1",
        "city": "İstanbul",
    }
    _seed(db, [draft, d1, d2], [order])
    db.contacts.docs[0]["tax_office"] = "Kadıköy"
    first = _run(_merge(server, db, ["d1", "d2"]))
    second = _run(_merge(server, db, ["d1", "d2"]))
    drafts = [d for d in _sales(db) if str(d.get("status") or "") == "draft"]
    assert len(drafts) == 1
    assert drafts[0]["_id"] == first["_id"] == second["_id"]
    assert all(d["_id"] != "draft-old" for d in db.invoices.docs)
    saved = next(x for x in db.orders.docs if x["_id"] == "o1")
    assert saved["invoice_id"] == first["_id"]
    assert saved["invoice_number"] == first["invoice_number"]
    assert saved.get("is_invoiced") is not True
    assert first.get("internet_sale") == "EVET"
    assert first.get("customer_order_number") == "TY-100"
    assert first.get("payment_method") == "Kredi Kartı"
    assert first.get("shipping_address") == "Adres 1"
    assert first.get("contact_tax_office") == "Kadıköy"


def test_merge_blocks_issued_order_and_non_draft_invoice():
    import server

    async def _expect(order, code, needle):
        db = FakeDB()
        d1 = _dispatch("d1", "IRS-1", order_id="o1", currency="TRY", fx_rate=1, items=[_item("A", 1)])
        _seed(db, [d1], [order])
        with patch.object(server, "db", db), pytest.raises(HTTPException) as exc:
            await server._merge_dispatches_core(["d1"], USER, company_id="c1")
        assert exc.value.status_code == code
        assert needle in exc.value.detail
        assert len(_sales(db)) == (1 if order.get("invoice_id") == "sf-live" else 0)

    issued = {
        "_id": "o1", "company_id": "c1", "order_number": "SIP-1",
        "is_invoiced": True, "invoice_id": None,
    }
    _run(_expect(issued, 409, "faturalanmış"))
    live = {
        "_id": "sf-live", "company_id": "c1", "invoice_type": "sales",
        "invoice_number": "TA-LIVE", "status": "approved", "einvoice_state": "sent",
    }
    order = {
        "_id": "o1", "company_id": "c1", "order_number": "SIP-1",
        "is_invoiced": False, "invoice_id": "sf-live", "invoice_number": "TA-LIVE",
    }

    async def _live():
        db = FakeDB()
        d1 = _dispatch("d1", "IRS-1", order_id="o1", currency="TRY", fx_rate=1, items=[_item("A", 1)])
        _seed(db, [d1, live], [order])
        with patch.object(server, "db", db), pytest.raises(HTTPException) as exc:
            await server._merge_dispatches_core(["d1"], USER, company_id="c1")
        return exc.value, db

    err, db = _run(_live())
    assert err.status_code == 409
    assert "taslak değil" in err.detail
    assert any(d["_id"] == "sf-live" for d in db.invoices.docs)
    assert len([d for d in _sales(db) if d.get("status") == "draft"]) == 0


def _zero_vat_order():
    line = {
        "product_id": "p0",
        "product_name": "İhracat",
        "quantity": 2,
        "unit": "Adet",
        "unit_price": 100,
        "unit_price_incl": 100,
        "vat_rate": 0,
        "discount_rate": 10,
        "sku": "SKU0",
        "barcode": "8690000000001",
        "price_includes_vat": False,
        "total": 180,
    }
    return {
        "_id": "o-fx",
        "company_id": "c1",
        "order_number": "SIP-FX",
        "contact_id": "ct1",
        "customer_name": "Cari A",
        "channel": "manual",
        "currency": "EUR",
        "fx_rate": 36.5,
        "fx_source": "manual",
        "shipping_address": "Adres",
        "city": "İstanbul",
        "subtotal": 180,
        "vat_total": 0,
        "discount_total": 20,
        "grand_total": 180,
        "items": [line],
    }


def test_dispatch_and_merge_keep_zero_vat_discount_and_currency():
    import server

    db = FakeDB()
    order = _zero_vat_order()
    db.orders.docs.append(order)
    db.products.docs.append({"_id": "p0", "company_id": "c1", "vat_rate": 0, "unit": "Adet", "sku": "SKU0", "barcode": "8690000000001"})
    db.contacts.docs.append({
        "_id": "ct1", "company_id": "c1", "name": "Cari A",
        "tax_number_or_id": "1234567890", "tax_office": "Kadıköy", "balance": 0,
    })

    async def _go():
        with patch.object(server, "db", db):
            created = await server.create_dispatch("o-fx", USER)
            merged = await server._merge_dispatches_core([created["dispatch"]["id"]], USER, company_id="c1")
            return created, merged

    created, merged = _run(_go())
    disp = next(x for x in db.invoices.docs if x.get("invoice_type") == "dispatch")
    line = disp["items"][0]
    assert int(line["vat_rate"]) == 0
    assert float(line["discount_rate"]) == 10
    assert line["sku"] == "SKU0"
    assert line["barcode"] == "8690000000001"
    assert "unit_price_incl" in line
    assert disp["currency"] == "EUR"
    assert float(disp["fx_rate"]) == 36.5
    assert float(disp["subtotal"]) == 180
    assert float(disp["vat_total"]) == 0
    assert float(disp["grand_total"]) == 180
    assert merged["currency"] == "EUR"
    assert float(merged["fx_rate"]) == 36.5
    assert float(merged["grand_total"]) == 180
    assert float(merged["vat_total"]) == 0
    assert float(merged["subtotal"]) == 180
    assert int(merged["items"][0]["vat_rate"]) == 0
    assert float(merged["items"][0]["discount_rate"]) == 10
    saved = db.orders.docs[0]
    assert saved["invoice_id"] == merged["_id"]


def test_issue_rejects_draft_dispatch_and_ubl_uses_gib_number_once():
    import e_invoice
    import server
    import ubl_export

    db = FakeDB()
    d_draft = _dispatch("d1", "IRS-1", currency="TRY", fx_rate=1, items=[_item("A", 1, discount=0)])
    d_ok = _dispatch(
        "d2", "IRS-2", currency="TRY", fx_rate=1,
        dispatch_status="sent", einvoice_state="sent",
        gib_uuid="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        gib_invoice_id="GIB2026000009",
        gib_issue_date="2026-10-09",
        items=[_item("B", 1, discount=0)],
    )
    _seed(db, [d_draft, d_ok])
    merged = _run(_merge(server, db, ["d2"]))
    stored = next(x for x in db.invoices.docs if x["_id"] == merged["_id"])
    stored["dispatch_ids"] = ["d1"]
    stored["dispatch_id"] = "d1"
    prev = e_invoice._db
    e_invoice._db = db

    async def _reject():
        with pytest.raises(HTTPException) as exc:
            await e_invoice.issue_invoice(merged["_id"], company_id="c1")
        return exc.value

    try:
        draft_err = _run(_reject())
    finally:
        e_invoice._db = prev
    assert draft_err.status_code == 409
    assert "gönderilmemiş" in draft_err.detail
    assert "IRS-1" in draft_err.detail

    async def _refs():
        row = dict(merged)
        row["dispatch_ids"] = ["d2"]
        row["dispatch_id"] = "d2"
        return await server.dispatch_invoice.attach_official_despatch_refs(db, row)

    stamped = _run(_refs())
    xml = ubl_export.build_invoice_ubl(
        stamped,
        {"name": "Satıcı", "tax_number": "1234567801", "city": "İstanbul", "address": "A"},
        {"name": "Alıcı", "tax_number_or_id": "1234567890", "city": "Ankara"},
    ).decode()
    assert xml.count("<cac:DespatchDocumentReference>") == 1
    assert xml.count("GIB2026000009") == 1
    assert "2026-10-09" in xml
    assert "IRS-2" not in xml.split("<cac:DespatchDocumentReference>")[1].split("</cac:DespatchDocumentReference>")[0]
    assert "<cbc:DocumentTypeCode>IRSALIYE</cbc:DocumentTypeCode>" not in xml


ERSAY = "ERSAY HOME ÜRETİM TEDARİK İÇ VE DIŞ TİCARET LİMİTED ŞTİ."


def test_merge_and_convert_do_not_create_b2b_order():
    """Alıcı ünvanı başka bir TamKobi şirketi olsa da birleştirme ve dönüşüm sipariş açmaz."""
    import dispatch_invoice
    import server
    from models import Order, OrderItem

    db = FakeDB()
    db.companies.docs.append({"_id": "comp_9039c0ec", "name": ERSAY})
    shelf = _item("Duvar Rafı", 2, price=4567.08, discount=0)
    d1 = _dispatch(
        "d1", "IRS-1", order_id="o1", order_number="SIP-1",
        contact_name=ERSAY, items=[shelf], currency="TRY", fx_rate=1, fx_source="manual",
    )
    d2 = _dispatch(
        "d2", "IRS-2", order_id="o2", order_number="SIP-2",
        contact_name=ERSAY, items=[_item("Duvar Rafı", 1, price=1826.84, discount=0)],
        currency="TRY", fx_rate=1, fx_source="manual",
    )
    d3 = _dispatch(
        "d3", "IRS-3", order_id="o3", order_number="SIP-3",
        contact_name=ERSAY, items=[dict(shelf)],
        currency="TRY", fx_rate=1, fx_source="manual",
        general_discount_rate=0,
    )
    _seed(db, [d1, d2, d3], [
        {
            "_id": "o1", "company_id": "c1", "invoice_id": None, "is_invoiced": False,
            "order_number": "SIP-1", "contact_id": "ct1", "customer_name": ERSAY,
            "channel": "manual", "order_status": "approved",
            "items": [{"product_id": "p1", "product_name": "Duvar Rafı", "quantity": 2, "unit_price": 100, "vat_rate": 20, "total": 200}],
            "currency": "TRY", "subtotal": 200, "vat_total": 40, "grand_total": 240,
        },
        {
            "_id": "o2", "company_id": "c1", "invoice_id": None, "is_invoiced": False,
            "order_number": "SIP-2", "contact_id": "ct1", "customer_name": ERSAY,
            "channel": "b2b", "order_status": "approved",
        },
        {
            "_id": "o3", "company_id": "c1", "invoice_id": None, "is_invoiced": False,
            "order_number": "SIP-3", "contact_id": "ct1", "customer_name": ERSAY,
            "channel": "manual", "order_status": "approved",
        },
    ])
    db.contacts.docs[0]["name"] = ERSAY
    contact = {
        "_id": "ct1", "company_id": "c1", "name": ERSAY,
        "email": "ersay@example.com", "phone": "0212", "address": "Adres", "city": "İstanbul",
    }
    line = OrderItem(product_name="Duvar Rafı", quantity=1, unit_price=100, vat_rate=20, total=100)
    fresh_order = Order(
        company_id="c1", channel="b2b", customer_name=ERSAY,
        shipping_address="Adres", city="İstanbul", items=[line], total_amount=120,
    )
    blocked = []
    real_point = dispatch_invoice._point_orders

    async def _point_and_refuse(*args, **kwargs):
        with pytest.raises(HTTPException) as b2b_exc:
            await server._create_b2b_order_core(contact, [line], {})
        with pytest.raises(HTTPException) as panel_exc:
            await server.create_order(fresh_order, USER)
        blocked.append((b2b_exc.value.status_code, panel_exc.value.status_code))
        await real_point(*args, **kwargs)

    async def _go():
        with patch.object(server, "db", db), patch.object(dispatch_invoice, "_point_orders", _point_and_refuse):
            merged = await server._merge_dispatches_core(["d1", "d2"], USER, company_id="c1")
            before_convert = [o["_id"] for o in db.orders.docs]
            converted = await server.convert_dispatch_to_invoice("d3", {}, USER)
            dispatched = await server.create_dispatch("o1", USER)
        return merged, converted, dispatched, before_convert

    merged, converted, dispatched, before_convert = _run(_go())
    numbers = [o.get("order_number") for o in db.orders.docs]
    assert numbers == ["SIP-1", "SIP-2", "SIP-3"]
    assert before_convert == ["o1", "o2", "o3"]
    assert blocked == [(409, 409), (409, 409)]
    assert not any(str(c.get("_id") or "").startswith("B2B-") for c in db.counters.docs)
    assert merged["contact_name"] == ERSAY
    assert converted["status"] in ("success", "exists", "linked")
    assert dispatched["status"] in ("success", "exists")
    assert not any(str(o.get("order_number") or "").startswith("B2B-") for o in db.orders.docs)

    async def _portal():
        with patch.object(server, "db", db), \
             patch.object(server, "_notify_company", AsyncMock()), \
             patch.object(server, "_attach_draft_invoice_on_intake", AsyncMock()), \
             patch.object(server, "_clear_b2b_active_cart", AsyncMock()):
            return await server._create_b2b_order_core(contact, [line], {})

    opened = _run(_portal())
    b2b_rows = [o for o in db.orders.docs if str(o.get("order_number") or "").startswith("B2B-")]
    assert len(b2b_rows) == 1
    assert b2b_rows[0]["order_status"] == "pending"
    assert b2b_rows[0]["channel"] == "b2b"
    assert b2b_rows[0]["source"] == "b2b_portal"
    assert b2b_rows[0]["customer_name"] == ERSAY
    assert b2b_rows[0]["company_id"] == "c1"
    assert opened["order"]["order_number"] == b2b_rows[0]["order_number"]
