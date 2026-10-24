"""Yeni faturalarda alıcı ünvanı ticari ünvan / GİB ünvanı sırasıyla çözülür.

Mevcut fatura kayıtları onayda yeniden yazılmaz. İşNet/GİB çağrısı yok.
"""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import e_invoice
import n11faturam
import ubl_export
from buyer_tax import invoice_buyer_name, stamp_invoice_buyer
from models import Invoice
from mysql_store import apply_update, match_query

PERSON = "Cüneyt Atman"
TITLE = "Yılmaz Desing Alüminyum Cam İnşaat Gıda San. Ve Tic. Ltd."
GIB = "Yılmaz Design Alüminyum Ltd. Şti."
REAL_TAX = "1234567890"


def _run(coro):
    return asyncio.run(coro)


def _contact(**extra):
    card = {
        "_id": "cnt_1",
        "company_id": "co",
        "name": PERSON,
        "company_title": TITLE,
        "tax_number_or_id": REAL_TAX,
        "tax_office": "Kadıköy",
        "address": "Sanayi Cad. No:4",
        "city": "İstanbul",
        "phone": "02120000000",
    }
    card.update(extra)
    return card


def test_buyer_name_resolution_order():
    assert invoice_buyer_name(_contact()) == TITLE
    assert PERSON not in invoice_buyer_name(_contact())

    plain = _contact(company_title="", tax_number_or_id="")
    assert invoice_buyer_name(plain) == PERSON

    gib_card = _contact(company_title="", gib_title=GIB)
    assert invoice_buyer_name(gib_card) == GIB
    assert invoice_buyer_name(gib_card, gib_title="Sorgu Ünvanı") == "Sorgu Ünvanı"

    placeholder = _contact(company_title="", tax_number_or_id="11111111111", gib_title=GIB)
    assert invoice_buyer_name(placeholder) == PERSON

    assert invoice_buyer_name(_contact(gib_title=GIB)) == TITLE
    assert invoice_buyer_name({"name": ""}, fallback="Form Adı") == "Form Adı"


def test_stamp_fills_new_document_and_keeps_name_without_title():
    doc = {"contact_name": PERSON, "contact_tax_id": "", "shipping_address": "", "city": ""}
    stamp_invoice_buyer(doc, _contact())
    assert doc["contact_name"] == TITLE
    assert doc["contact_tax_id"] == REAL_TAX
    assert doc["shipping_address"] == "Sanayi Cad. No:4"
    assert doc["city"] == "İstanbul"

    kept = {"contact_name": "Test Cari A.Ş.", "contact_tax_id": REAL_TAX}
    stamp_invoice_buyer(kept, _contact(company_title="", name="Test Cari A.Ş."))
    assert kept["contact_name"] == "Test Cari A.Ş."

    typed = {"contact_name": "El ile yazılan", "contact_tax_id": REAL_TAX}
    stamp_invoice_buyer(typed, _contact(company_title="", name=PERSON))
    assert typed["contact_name"] == "El ile yazılan"


def test_validate_buyer_uses_title_for_archive_and_einvoice():
    card = _contact()
    archive = e_invoice.validate_buyer(card, {"contact_name": PERSON}, "e_archive")
    einvoice = e_invoice.validate_buyer(card, {"contact_name": PERSON, "contact_tax_id": REAL_TAX}, "e_invoice")
    assert archive["name"] == TITLE
    assert einvoice["name"] == TITLE

    official = e_invoice.validate_buyer(
        _contact(company_title="", gib_title=GIB),
        {"contact_name": PERSON, "contact_tax_id": REAL_TAX},
        "e_invoice",
    )
    assert official["name"] == GIB

    retail = e_invoice.validate_buyer(
        {"name": "Perakende Müşteri", "tax_number_or_id": "11111111111", "gib_title": GIB},
        {},
        "e_archive",
    )
    assert retail["name"] == "Perakende Müşteri"


def _draft_order():
    return {
        "_id": "ord_b2b",
        "company_id": "co",
        "order_number": "ORD-B2B",
        "customer_name": PERSON,
        "channel": "b2b",
        "currency": "TRY",
        "shipping_address": "",
        "items": [{
            "product_id": "p1",
            "product_name": "Kalem",
            "name": "Kalem",
            "quantity": 1,
            "unit_price": 100,
            "vat_rate": 20,
            "unit": "Adet",
        }],
    }


def _insert_draft(contact, **order_extra):
    import server

    inserted = {}

    async def _insert(doc):
        inserted["doc"] = doc

    mock_db = MagicMock()
    mock_db.invoices.find_one = AsyncMock(return_value=None)
    mock_db.invoices.insert_one = AsyncMock(side_effect=_insert)
    mock_db.invoices.count_documents = AsyncMock(return_value=0)
    mock_db.orders.update_one = AsyncMock()
    order = {**_draft_order(), **order_extra}
    with patch.object(server, "db", mock_db), patch.object(
        server, "_ensure_order_contact", AsyncMock(return_value=contact)
    ), patch.object(server, "_fill_stock_codes", AsyncMock()):
        _run(server._create_draft_invoice_for_order(order, source="b2b"))
    return inserted["doc"], mock_db.orders.update_one.await_args.args[1]["$set"]


def test_b2b_draft_stamps_commercial_title():
    doc, order_set = _insert_draft(_contact())
    assert doc["status"] == "draft"
    assert doc["source_channel"] == "b2b"
    assert doc["contact_name"] == TITLE
    assert doc["contact_tax_id"] == REAL_TAX
    assert doc["shipping_address"] == "Sanayi Cad. No:4"
    assert order_set["contact_name"] == PERSON
    assert order_set["is_invoiced"] is False


def test_draft_keeps_cari_adi_when_title_empty():
    doc, _order_set = _insert_draft(_contact(company_title="", name="Test Cari A.Ş."))
    assert doc["contact_name"] == "Test Cari A.Ş."


def test_draft_uses_gib_title_when_commercial_title_empty():
    doc, _order_set = _insert_draft(_contact(company_title="", gib_title=GIB))
    assert doc["contact_name"] == GIB
    assert PERSON not in doc["contact_name"]


def test_create_invoice_core_stamps_proforma_and_sales():
    import server

    captured = []

    async def _insert(doc):
        captured.append(dict(doc))

    mock_db = MagicMock()
    mock_db.contacts.find_one = AsyncMock(return_value=_contact())
    mock_db.invoices.insert_one = AsyncMock(side_effect=_insert)

    async def _stamp(*_a, **_k):
        return {"currency": "TRY", "fx_rate": 1.0, "fx_date": "2026-10-24", "fx_source": "manual"}

    def _go(invoice_type):
        inv = Invoice(
            company_id="co",
            invoice_type=invoice_type,
            e_type="e_archive",
            invoice_number=f"N-{invoice_type}",
            contact_id="cnt_1",
            contact_name=PERSON,
            items=[],
        )
        return _run(server._create_invoice_core(inv, {"is_super_admin": True}))

    with patch.object(server, "db", mock_db), patch.object(
        server, "_fill_stock_codes", AsyncMock()
    ), patch.object(
        server, "_sync_contact_tax_from_sales_invoice", AsyncMock()
    ), patch.object(server.fx, "typed_rate", lambda *_a, **_k: None), patch.object(
        server.fx, "stamp", _stamp
    ), patch.object(server.fx, "local_of", lambda total, _rate: total), patch.object(
        server.tenant_access, "resolve_company_id", lambda _user, company_id=None: company_id or "co"
    ):
        sales = _go("sales")
        proforma = _go("proforma")

    assert sales["contact_name"] == TITLE
    assert proforma["contact_name"] == TITLE
    assert captured[0]["shipping_address"] == "Sanayi Cad. No:4"
    assert captured[1]["invoice_type"] == "proforma"


def _ubl_invoice(e_type):
    return {
        "_id": "inv1",
        "invoice_number": "NX202600000001",
        "e_type": e_type,
        "issue_date": "2026-10-24",
        "contact_name": PERSON,
        "contact_tax_id": REAL_TAX,
        "items": [{"name": "Kalem", "quantity": 1, "unit": "Adet", "unit_price": 10, "vat_rate": 20, "total": 10}],
        "subtotal": 10,
        "vat_total": 2,
        "grand_total": 12,
    }


def _assert_party_title(xml: str):
    assert TITLE in xml
    assert PERSON not in xml


def test_ubl_einvoice_and_earchive_party_name_is_title():
    seller = {"name": "Satıcı A.Ş.", "tax_number": "6320984412", "city": "İstanbul", "address": "Merkez"}
    contact = _contact()
    for e_type in ("e_invoice", "e_archive"):
        inv = _ubl_invoice(e_type)
        buyer = ubl_export._buyer_from(inv, contact)
        assert buyer["name"] == TITLE
        xml = ubl_export.build_invoice_ubl(inv, seller, buyer).decode()
        _assert_party_title(xml)


def test_n11_ubl_party_name_is_title():
    inv = _ubl_invoice("e_archive")
    company = {"name": "Satıcı A.Ş.", "tax_number": "6320984412", "city": "İstanbul", "address": "Merkez"}
    xml, _ettn, _iid = n11faturam.build_ubl(inv, company, _contact())
    _assert_party_title(xml)
    xml_inv, _e2, _i2 = n11faturam.build_ubl({**inv, "e_type": "e_invoice"}, company, _contact())
    _assert_party_title(xml_inv)


def test_pdf_draws_commercial_title():
    from saas_docs import build_invoice_pdf

    drawn = []

    def capture_draw(self, x, y, text):
        drawn.append(str(text))
        return None

    with patch("reportlab.pdfgen.canvas.Canvas.drawString", capture_draw), patch(
        "reportlab.pdfgen.canvas.Canvas.drawRightString", capture_draw
    ):
        pdf = build_invoice_pdf(
            {
                **_ubl_invoice("e_archive"),
                "shipping_address": "Eski Adres",
            },
            {"name": "Satıcı A.Ş.", "tax_number": "6320984412", "address": "X", "city": "Y"},
            _contact(),
        )
    assert pdf[:4] == b"%PDF"
    assert any(TITLE in line for line in drawn)
    assert not any(PERSON in line for line in drawn)


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, n=None):
        rows = self.rows if n is None else self.rows[:n]
        return [dict(r) for r in rows]


class _Coll:
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


class _Db:
    def __init__(self):
        self.invoices = _Coll()
        self.contacts = _Coll()
        self.orders = _Coll()
        self.products = _Coll()
        self.stock_lots = _Coll()

    def __getitem__(self, name):
        return getattr(self, name)


def test_approve_does_not_rewrite_stored_buyer_name():
    import server

    db = _Db()
    invoices = _Coll([{
        "_id": "inv_d",
        "company_id": "co",
        "status": "draft",
        "e_type": "paper",
        "invoice_type": "sales",
        "invoice_number": "T-1",
        "contact_id": "cnt_1",
        "contact_name": PERSON,
        "contact_tax_id": REAL_TAX,
        "grand_total": 10.0,
        "local_total": 10.0,
        "currency": "TRY",
        "fx_rate": 1,
        "gib_status": "Taslak",
        "items": [],
        "notes": "",
    }])
    contacts = _Coll([_contact(balance=0.0)])
    db.invoices = invoices
    db.contacts = contacts

    user = {"is_super_admin": True, "active_company_id": "co", "company_ids": ["co"]}
    with patch.object(server, "db", db), patch.object(
        server, "_post_marketplace_settlement", AsyncMock(return_value=None)
    ), patch.object(server, "_ensure_order_contact", AsyncMock(return_value=None)), patch.object(
        server, "_apply_invoice_effects", AsyncMock()
    ):
        out = _run(server.approve_invoice("inv_d", user))
    assert out["status"] == "success"
    assert invoices.docs[0]["status"] == "approved"
    assert invoices.docs[0]["contact_name"] == PERSON


def test_issue_attaches_gib_title_in_memory_only():
    inv = {
        "_id": "inv_gib",
        "company_id": "co",
        "invoice_type": "sales",
        "e_type": "e_invoice",
        "status": "draft",
        "contact_id": "cnt_1",
        "contact_name": PERSON,
        "contact_tax_id": REAL_TAX,
        "invoice_number": "NX9",
        "items": [{"name": "Kalem", "quantity": 1, "unit": "Adet", "unit_price": 10, "vat_rate": 20, "total": 10}],
        "subtotal": 10,
        "vat_total": 2,
        "grand_total": 12,
    }
    contact = _contact(company_title="")
    company = {"_id": "co", "name": "Satıcı A.Ş.", "tax_number": "6320984412"}
    fake_db = MagicMock()

    async def find_invoice(q, *args, **kwargs):
        if q.get("_id") == "inv_gib":
            return dict(inv)
        return None

    fake_db.invoices.find_one = AsyncMock(side_effect=find_invoice)
    fake_db.invoices.update_one = AsyncMock()
    fake_db.contacts.find_one = AsyncMock(return_value=dict(contact))
    fake_db.contacts.update_one = AsyncMock()
    fake_db.companies.find_one = AsyncMock(return_value=company)
    fake_db.einvoice_settings.find_one = AsyncMock(return_value={"status": "simulated"})
    fake_db.outgoing_einvoice_xml.update_one = AsyncMock()
    e_invoice.init(fake_db, {"consume_credits": AsyncMock(return_value=3)})

    seen = {}

    async def _capture(invoice, company_doc, buyer_contact, scenario):
        seen["invoice_name"] = invoice.get("contact_name")
        seen["buyer"] = ubl_export._buyer_from(invoice, buyer_contact)
        return b"<Invoice/>"

    gib = {
        "name": GIB,
        "is_e_invoice_user": True,
        "suggested_e_type": "e_invoice",
        "alias": "urn:mail:defaultpk@ornek.com.tr",
    }
    with patch.object(e_invoice, "resolve_buyer_mukellef", AsyncMock(return_value=gib)), patch.object(
        e_invoice, "build_and_store_xml", _capture
    ):
        result = _run(e_invoice.issue_invoice("inv_gib", company_id="co", e_type="e_invoice"))

    assert result["status"] == "success"
    assert seen["invoice_name"] == PERSON
    assert seen["buyer"]["name"] == GIB
    for call in fake_db.invoices.update_one.await_args_list:
        payload = call.args[1] if len(call.args) > 1 else {}
        assert "contact_name" not in (payload.get("$set") or {})
    for call in fake_db.contacts.update_one.await_args_list:
        payload = call.args[1] if len(call.args) > 1 else {}
        assert "gib_title" not in (payload.get("$set") or {})
    assert "gib_title" not in contact
