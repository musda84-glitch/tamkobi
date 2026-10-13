"""Satış faturası VKN senkronu başka şirketin carisine yazmamalı."""
from __future__ import annotations

import asyncio
from contextlib import ExitStack
from unittest.mock import AsyncMock, MagicMock, patch

from models import Invoice, InvoiceItem


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
        self.update_filters = []

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

    async def count_documents(self, q=None):
        return len([d for d in self.docs if self._match(d, q or {})])

    async def update_one(self, q, upd):
        self.update_filters.append(dict(q or {}))
        d = next((x for x in self.docs if self._match(x, q or {})), None)
        if not d:
            return MagicMock(matched_count=0, modified_count=0)
        if "$set" in upd:
            d.update(upd["$set"])
        return MagicMock(matched_count=1, modified_count=1)


def _mock_db(contacts, invoices=None):
    db = MagicMock()
    db.contacts = FakeColl(contacts)
    db.invoices = FakeColl(invoices or [])
    db.products = FakeColl([])
    db.stock_lots = FakeColl([])
    return db


FOREIGN = {
    "_id": "cnt_other",
    "company_id": "comp_other",
    "name": "Başka Şirket Carisi",
    "tax_number_or_id": "",
    "tax_office": "",
}
OWN = {
    "_id": "cnt_own",
    "company_id": "comp_a",
    "name": "Kendi Carisi",
    "tax_number_or_id": "",
    "tax_office": "",
}
USER = {"is_super_admin": True, "company_ids": ["comp_a"], "active_company_id": "comp_a"}
TAX_ID = "3680486408"
TAX_OFFICE = "Başakşehir"


def _sales_invoice(**extra):
    data = dict(
        company_id="comp_a",
        invoice_type="sales",
        e_type="e_archive",
        contact_id="cnt_other",
        contact_name="Başka Şirket Carisi",
        contact_tax_id=TAX_ID,
        contact_tax_office=TAX_OFFICE,
        status="draft",
        items=[InvoiceItem(name="Kalem", quantity=1, unit_price=10, total=10, vat_rate=20)],
    )
    data.update(extra)
    return Invoice(**data)


async def _stamp(*a, **k):
    return {"currency": "TRY", "fx_rate": 1.0, "fx_date": "2026-10-13", "fx_source": "manual"}


def _create_stack(server, db):
    stack = ExitStack()
    stack.enter_context(patch.object(server, "db", db))
    stack.enter_context(patch.object(server, "_fill_stock_codes", AsyncMock()))
    stack.enter_context(patch.object(server.fx, "stamp", AsyncMock(side_effect=_stamp)))
    stack.enter_context(patch.object(server.fx, "typed_rate", return_value=None))
    stack.enter_context(patch.object(server.fx, "local_of", side_effect=lambda g, r: float(g or 0) * float(r or 1)))
    return stack


def test_sync_skips_without_company_id_and_foreign_contact():
    import server

    db = _mock_db([dict(FOREIGN)])
    with patch.object(server, "db", db):
        _run(server._sync_contact_tax_from_sales_invoice(
            "sales", "cnt_other", TAX_ID, TAX_OFFICE, contact=dict(FOREIGN),
        ))
        _run(server._sync_contact_tax_from_sales_invoice(
            "sales", "cnt_other", TAX_ID, TAX_OFFICE,
            contact=dict(FOREIGN), company_id="comp_a",
        ))
        _run(server._sync_contact_tax_from_sales_invoice(
            "sales", "cnt_other", TAX_ID, TAX_OFFICE, company_id="comp_a",
        ))
    row = next(x for x in db.contacts.docs if x["_id"] == "cnt_other")
    assert row["tax_number_or_id"] == ""
    assert row["tax_office"] == ""
    assert db.contacts.update_filters == []


def test_sync_fills_own_company_contact():
    import server

    db = _mock_db([dict(OWN)])
    with patch.object(server, "db", db):
        _run(server._sync_contact_tax_from_sales_invoice(
            "sales", "cnt_own", TAX_ID, TAX_OFFICE, company_id="comp_a",
        ))
    row = next(x for x in db.contacts.docs if x["_id"] == "cnt_own")
    assert row["tax_number_or_id"] == TAX_ID
    assert row["tax_office"] == TAX_OFFICE
    assert db.contacts.update_filters == [{"_id": "cnt_own", "company_id": "comp_a"}]


def test_create_sales_invoice_does_not_patch_foreign_company_contact():
    import server

    db = _mock_db([dict(FOREIGN), dict(OWN)])
    inv = _sales_invoice()
    with _create_stack(server, db):
        _run(server._create_invoice_core(inv, USER))
    foreign = next(x for x in db.contacts.docs if x["_id"] == "cnt_other")
    own = next(x for x in db.contacts.docs if x["_id"] == "cnt_own")
    assert foreign["tax_number_or_id"] == ""
    assert foreign["tax_office"] == ""
    assert own["tax_number_or_id"] == ""
    assert own["tax_office"] == ""


def test_create_sales_invoice_patches_own_company_contact():
    import server

    db = _mock_db([dict(OWN)])
    inv = _sales_invoice(contact_id="cnt_own", contact_name="Kendi Carisi")
    with _create_stack(server, db):
        _run(server._create_invoice_core(inv, USER))
    own = next(x for x in db.contacts.docs if x["_id"] == "cnt_own")
    assert own["tax_number_or_id"] == TAX_ID
    assert own["tax_office"] == TAX_OFFICE


def test_update_sales_invoice_does_not_patch_foreign_company_contact():
    import server

    inv = {
        "_id": "inv1",
        "company_id": "comp_a",
        "invoice_type": "sales",
        "status": "draft",
        "contact_id": "cnt_other",
        "contact_name": "Başka Şirket Carisi",
        "contact_tax_id": "",
        "contact_tax_office": "",
        "grand_total": 12,
        "currency": "TRY",
        "fx_rate": 1,
    }
    db = _mock_db([dict(FOREIGN)], [dict(inv)])
    with patch.object(server, "db", db), \
            patch("tenant_access.get_tenant_doc", AsyncMock(return_value=dict(inv))), \
            patch.object(server, "_invoice_gib_locked", return_value=False):
        _run(server.update_invoice("inv1", {
            "contact_tax_id": TAX_ID,
            "contact_tax_office": TAX_OFFICE,
        }, user=USER))
    foreign = next(x for x in db.contacts.docs if x["_id"] == "cnt_other")
    assert foreign["tax_number_or_id"] == ""
    assert foreign["tax_office"] == ""
    assert all(f.get("company_id") == "comp_a" for f in db.contacts.update_filters)


def test_update_sales_invoice_patches_own_company_contact():
    import server

    inv = {
        "_id": "inv1",
        "company_id": "comp_a",
        "invoice_type": "sales",
        "status": "draft",
        "contact_id": "cnt_own",
        "contact_name": "Kendi Carisi",
        "contact_tax_id": TAX_ID,
        "contact_tax_office": TAX_OFFICE,
        "grand_total": 12,
        "currency": "TRY",
        "fx_rate": 1,
    }
    db = _mock_db([dict(OWN)], [dict(inv)])
    with patch.object(server, "db", db), \
            patch("tenant_access.get_tenant_doc", AsyncMock(return_value=dict(inv))), \
            patch.object(server, "_invoice_gib_locked", return_value=False):
        _run(server.update_invoice("inv1", {
            "contact_id": "cnt_own",
            "contact_tax_id": TAX_ID,
            "contact_tax_office": TAX_OFFICE,
        }, user=USER))
    own = next(x for x in db.contacts.docs if x["_id"] == "cnt_own")
    assert own["tax_number_or_id"] == TAX_ID
    assert own["tax_office"] == TAX_OFFICE
    assert {"_id": "cnt_own", "company_id": "comp_a"} in db.contacts.update_filters
