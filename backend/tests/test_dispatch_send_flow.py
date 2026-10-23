"""Siparişten taslak irsaliye ve GİB gönderiminde nakliye doğrulaması."""
from __future__ import annotations

import asyncio
import os
import sys
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import e_invoice  # noqa: E402
import server  # noqa: E402
import ubl_export  # noqa: E402
from despatch_shipment import shipment_problems  # noqa: E402

ETTN = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
COMPANY = "c1"
USER = {"company_ids": [COMPANY], "active_company_id": COMPANY}
OTHER_USER = {"company_ids": ["c-other"], "active_company_id": "c-other"}

OWN = {
    "despatch_mode": "own",
    "issue_date": "2026-10-15",
    "issue_time": "10:30:00",
    "shipping_address": "Teslim Mah. 1",
    "despatch_plate": "34ABC123",
    "despatch_driver_first": "Ali",
    "despatch_driver_last": "Yılmaz",
    "despatch_driver_tckn": "10000000146",
}
CARRIER = {
    "despatch_mode": "carrier",
    "issue_date": "2026-10-15",
    "issue_time": "11:00:00",
    "shipping_address": "Depo Sok. 4",
    "despatch_carrier_vkn": "4810173324",
    "despatch_carrier_name": "Hızlı Kargo A.Ş.",
    "cargo_tracking_number": "TRK100",
}


def _run(coro):
    return asyncio.run(coro)


class Coll:
    def __init__(self, rows=None):
        self.rows = [dict(r) for r in (rows or [])]
        self.queries = []
        self.updates = []

    def _match(self, row, q):
        for key, val in (q or {}).items():
            if row.get(key) != val:
                return False
        return True

    async def find_one(self, q=None, *args, **kwargs):
        self.queries.append(dict(q or {}))
        for row in self.rows:
            if self._match(row, q):
                return dict(row)
        return None

    async def insert_one(self, doc):
        self.rows.append(dict(doc))

    async def update_one(self, q, upd, *args, **kwargs):
        self.updates.append((dict(q or {}), upd))
        for row in self.rows:
            if not self._match(row, q):
                continue
            for key, val in (upd.get("$set") or {}).items():
                row[key] = val
            for key in (upd.get("$unset") or {}):
                row.pop(key, None)
            return

    def find(self, q=None, projection=None):
        class _Cursor:
            async def to_list(self, n=None):
                return []

        return _Cursor()

    async def find_one_and_update(self, q, upd, upsert=False, return_document=None):
        return {"_id": (q or {}).get("_id"), "seq": 7}


class DB:
    def __init__(self):
        self.orders = Coll()
        self.invoices = Coll()
        self.contacts = Coll()
        self.products = Coll()
        self.companies = Coll()
        self.einvoice_settings = Coll()
        self.counters = Coll()
        self.outgoing_einvoice_xml = Coll()

    def __getitem__(self, name):
        return getattr(self, name)


def _order(**extra):
    base = {
        "_id": "ord1",
        "company_id": COMPANY,
        "order_number": "SP-1",
        "contact_id": "ct1",
        "customer_name": "Yanlis Isim",
        "shipping_address": "Sipariş adresi",
        "city": "İstanbul",
        "total_amount": 50,
        "channel": "b2b",
        "items": [{
            "product_id": "p1",
            "product_name": "Un",
            "quantity": 2,
            "unit_price": 25,
            "total": 50,
        }],
    }
    base.update(extra)
    return base


def _contact():
    return {
        "_id": "ct1",
        "company_id": COMPANY,
        "name": "Doğru Cari",
        "tax_number_or_id": "4810173324",
        "address": "Cari adresi",
        "city": "Ankara",
    }


def _product():
    return {"_id": "p1", "company_id": COMPANY, "name": "Un", "unit": "Kg", "vat_rate": 10, "stock_quantity": 8}


def _company():
    return {
        "_id": COMPANY,
        "name": "Satıcı A.Ş.",
        "tax_number": "4810173324",
        "tax_office": "Tuzla",
        "address": "Cadde 1",
        "city": "İstanbul",
    }


def _settings():
    return {"_id": "es1", "company_id": COMPANY, "provider": "isnet", "status": "configured", "mode": "test", "e_dispatch_enabled": True}


def _db_for_order(order=None):
    db = DB()
    db.orders.rows = [_order() if order is None else order]
    db.contacts.rows = [_contact()]
    db.products.rows = [_product()]
    db.companies.rows = [_company()]
    db.einvoice_settings.rows = [_settings()]
    return db


def _dispatch(**extra):
    base = {
        "_id": "d1",
        "company_id": COMPANY,
        "invoice_number": "IRS-2026-0007",
        "invoice_type": "dispatch",
        "e_type": "e_dispatch",
        "status": "draft",
        "contact_id": "ct1",
        "contact_name": "Doğru Cari",
        "contact_tax_id": "4810173324",
        "items": [{"name": "Un", "quantity": 1, "unit": "Kg", "unit_price": 10, "vat_rate": 10, "total": 10}],
    }
    base.update(extra)
    return base


def _db_for_dispatch(inv):
    db = DB()
    db.invoices.rows = [inv]
    db.contacts.rows = [_contact()]
    db.companies.rows = [_company()]
    db.einvoice_settings.rows = [_settings()]
    return db


def test_order_create_dispatch_is_draft_and_skips_isnet():
    db = _db_for_order()
    send = AsyncMock(side_effect=AssertionError("İşNet çağrılmamalı"))

    async def go():
        with patch.object(server, "db", db), patch.object(server, "_send_dispatch_to_isnet_if_configured", send):
            out = await server.create_dispatch("ord1", USER)
            again = await server.create_dispatch("ord1", USER)
        return out, again

    out, again = _run(go())
    assert out["status"] == "success"
    disp = out["dispatch"]
    assert disp["status"] == "draft"
    assert disp["e_type"] == "e_dispatch"
    assert disp["invoice_number"].startswith("IRS-")
    assert disp["contact_id"] == "ct1"
    assert disp["contact_name"] == "Doğru Cari"
    assert disp["items"][0]["unit"] == "Kg"
    assert disp["items"][0]["vat_rate"] == 10
    assert send.await_count == 0
    assert db.products.updates == []
    assert db.contacts.updates == []
    assert all("name" not in q for q in db.contacts.queries)
    assert again["status"] == "exists"
    assert len(db.invoices.rows) == 1


def test_order_create_dispatch_requires_contact_id_not_name():
    db = _db_for_order(_order(contact_id="", customer_name="Doğru Cari"))

    async def go():
        with patch.object(server, "db", db):
            with pytest.raises(HTTPException) as exc:
                await server.create_dispatch("ord1", USER)
            return exc.value

    err = _run(go())
    assert err.status_code == 400
    assert err.detail == "Önce cari seçin"
    assert db.invoices.rows == []
    assert all("name" not in q for q in db.contacts.queries)


def test_order_create_dispatch_other_company_is_404():
    db = _db_for_order()

    async def go():
        with patch.object(server, "db", db):
            with pytest.raises(HTTPException) as exc:
                await server.create_dispatch("ord1", OTHER_USER)
            return exc.value

    err = _run(go())
    assert err.status_code == 404
    assert db.invoices.rows == []


def _bind(db):
    e_invoice.init(db, {"password_fn": lambda _s: "secret"})


def _mock_send():
    return AsyncMock(return_value={
        "ettn": ETTN,
        "invoice_id": "OFFICIAL-999",
        "official_invoice_id": "OFFICIAL-999",
        "number_source": "soap",
        "verified": True,
        "gib_status_raw": "Succeed",
        "gib_status_code": "1300",
        "mode": "test",
    })


def test_issue_dispatch_missing_shipment_is_422():
    db = _db_for_dispatch(_dispatch())
    send = _mock_send()

    async def go():
        _bind(db)
        with patch.object(e_invoice.isnet, "send_document", send):
            with pytest.raises(HTTPException) as exc:
                await e_invoice.issue_invoice("d1", company_id=COMPANY, e_type="e_dispatch")
            return exc.value

    err = _run(go())
    assert err.status_code == 422
    assert "Sevk tarihi" in err.detail or "Araç plakası" in err.detail
    assert send.await_count == 0


def test_issue_dispatch_own_vehicle_and_carrier_send():
    send = _mock_send()

    async def once(fields):
        db = _db_for_dispatch(_dispatch(**fields))
        _bind(db)
        with patch.object(e_invoice.isnet, "send_document", send):
            out = await e_invoice.issue_invoice("d1", company_id=COMPANY, e_type="e_dispatch")
        stored = next(r for r in db.invoices.rows if r["_id"] == "d1")
        return out, stored

    own, own_row = _run(once(OWN))
    carrier, carrier_row = _run(once(CARRIER))
    assert own["einvoice_state"] == "sent"
    assert carrier["einvoice_state"] == "sent"
    assert send.await_count == 2
    assert own_row["invoice_number"] == "IRS-2026-0007"
    assert carrier_row["invoice_number"] == "IRS-2026-0007"
    assert "0000000000" not in str(send.await_args_list)


def test_error_dispatch_can_be_corrected_and_resent_with_same_number():
    db = _db_for_dispatch(_dispatch(
        status="approved",
        einvoice_state="error",
        gib_status="Hata: şema",
        gib_uuid="bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
        invoice_number="IRS-2026-0008",
    ))
    send = _mock_send()

    async def go():
        _bind(db)
        with patch.object(server, "db", db), patch.object(e_invoice.isnet, "send_document", send):
            out = await server.send_invoice_to_gib("d1", {**OWN, "e_type": "e_dispatch"}, USER)
        return out

    out = _run(go())
    stored = db.invoices.rows[0]
    assert out["status"] == "success"
    assert send.await_count == 1
    assert stored["invoice_number"] == "IRS-2026-0008"
    assert stored["despatch_plate"] == "34ABC123"
    assert stored["einvoice_state"] == "sent"


def test_accepted_dispatch_cannot_be_resent():
    db = _db_for_dispatch(_dispatch(
        **OWN,
        status="approved",
        einvoice_state="sent",
        gib_status_code="1300",
        gib_uuid=ETTN,
        gib_status="Başarıyla Tamamlandı",
    ))
    send = _mock_send()

    async def go():
        _bind(db)
        with patch.object(server, "db", db), patch.object(e_invoice.isnet, "send_document", send):
            with pytest.raises(HTTPException) as exc:
                await server.send_invoice_to_gib("d1", {"e_type": "e_dispatch"}, USER)
            return exc.value

    err = _run(go())
    assert err.status_code == 409
    assert "kabul" in err.detail.lower()
    assert send.await_count == 0


def test_ubl_omits_empty_stage_and_fake_carrier():
    seller = {"name": "Satıcı", "tax_number": "0000000000", "address": "A", "city": "İstanbul", "tax_office": "X"}
    buyer = {"name": "Alıcı", "tax_number_or_id": "4810173324", "address": "B", "city": "Ankara"}
    bare = {"invoice_number": "IRS1", "items": [{"name": "X", "quantity": 1, "unit": "Adet"}]}
    with pytest.raises(ValueError) as exc:
        ubl_export.build_despatch_ubl(bare, seller, buyer, send_ready=True)
    assert "plaka" in str(exc.value).lower() or "taşıyıcı" in str(exc.value).lower()
    preview = ubl_export.build_despatch_ubl(bare, seller, buyer, send_ready=False)
    assert b"ShipmentStage" not in preview
    assert b"CarrierParty" not in preview

    carrier_inv = {
        "invoice_number": "IRS2",
        "items": [{"name": "X", "quantity": 1, "unit": "Adet", "unit_price": 1, "total": 1}],
        **CARRIER,
    }
    real_seller = {"name": "Satıcı", "tax_number": "4810173324", "address": "A", "city": "İstanbul", "tax_office": "X"}
    xml = ubl_export.build_despatch_ubl(carrier_inv, real_seller, buyer, send_ready=True)
    assert b"ShipmentStage" not in xml
    assert b"4810173324" in xml
    assert b"0000000000" not in xml
    assert "Hızlı Kargo".encode("utf-8") in xml

    assert shipment_problems({"despatch_mode": "own"}) 
    assert any("plaka" in p.lower() for p in shipment_problems({"despatch_mode": "own", "issue_date": "2026-10-15", "issue_time": "10:00:00", "shipping_address": "Adres"}))
