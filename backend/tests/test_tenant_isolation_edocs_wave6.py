"""Gelen e-belge kutusu kiracı dalgası 6.

Bellek içi MemDB. Canlı veritabanına, 8021 portuna ve İşNet ağına bağlanmaz.
Değer, filtre, şirket kimliği, VKN veya belge içeriği loglanmaz.
"""
from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import subprocess
import sys
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import edocs  # noqa: E402
import isnet_portal  # noqa: E402
import tenant_scope_allowlist as allowlist  # noqa: E402
from dashboard_memdb import MemColl, MemDB, _split_field_ops  # noqa: E402
from mysql_store import match_query  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
EDOC = "edoc-shared"
KEEP = "edoc-keep"
PRODUCT = "prod-shared"
PRODUCT_B = "prod-b-only"
CONTACT = "contact-shared"
_TODAY = date(2026, 10, 20)

_REMOVED = (
    ("edocs.py", "_enrich", "products", "update_many"),
    ("edocs.py", "_release_commercial_claim", "incoming_edocs", "update_one"),
    ("edocs.py", "_set_lines_core", "incoming_edocs", "update_one"),
    ("edocs.py", "_set_lines_core", "products", "find_one"),
    ("edocs.py", "_set_lines_core", "products", "update_one"),
    ("edocs.py", "approve_inbox_document", "contacts", "update_one"),
    ("edocs.py", "approve_inbox_document", "incoming_edocs", "find_one"),
    ("edocs.py", "approve_inbox_document", "incoming_edocs", "update_one"),
    ("edocs.py", "approve_inbox_document", "products", "update_one"),
    ("edocs.py", "cleanup_inbox", "incoming_edoc_xml", "delete_one"),
    ("edocs.py", "cleanup_inbox", "incoming_edocs", "delete_one"),
    ("edocs.py", "create_missing_products", "incoming_edocs", "find_one"),
    ("edocs.py", "delete_edoc", "incoming_edoc_xml", "delete_one"),
    ("edocs.py", "delete_edoc", "incoming_edocs", "delete_one"),
    ("edocs.py", "ensure_products_for_unmatched", "incoming_edocs", "update_one"),
    ("edocs.py", "ensure_supplier", "contacts", "insert_one"),
    ("edocs.py", "ensure_supplier", "incoming_edocs", "update_one"),
    ("edocs.py", "ignore_edoc", "incoming_edocs", "update_one"),
    ("edocs.py", "link_supplier", "incoming_edocs", "update_one"),
    ("edocs.py", "merge_duplicate_edocs", "incoming_edoc_xml", "delete_one"),
    ("edocs.py", "merge_duplicate_edocs", "incoming_edocs", "delete_one"),
    ("edocs.py", "process_edoc", "incoming_edocs", "update_one"),
    ("edocs.py", "process_pending_for_company", "incoming_edocs", "update_one"),
    ("edocs.py", "reject_edoc", "incoming_edocs", "update_one"),
    ("edocs.py", "reparse_inbox", "incoming_edoc_xml", "find_one"),
    ("edocs.py", "reparse_inbox", "incoming_edocs", "update_one"),
    ("edocs.py", "respond_inbox_document", "incoming_edocs", "update_one"),
)


def _run(coro):
    return asyncio.run(coro)


def _user(company_id):
    uid = "user-" + company_id
    return {
        "_id": uid,
        "id": uid,
        "name": "Yonetici",
        "role": "admin",
        "is_active": True,
        "is_super_admin": False,
        "company_ids": [company_id],
        "active_company_id": company_id,
    }


class _Coll(MemColl):
    async def delete_one(self, query=None):
        from tenant_scope import check

        check(self.name, "delete_one", query=query)
        query = _split_field_ops(query or {})
        for index, doc in enumerate(self.docs):
            if match_query(doc, query):
                del self.docs[index]
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


class _DB(MemDB):
    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = _Coll(name, self)
            self._cols[name] = coll
        return coll


class _Boom:
    def __getattr__(self, name):
        raise AssertionError("db")

    def __getitem__(self, name):
        raise AssertionError("db")


def _add(db, coll, doc):
    db[coll].docs.append(copy.deepcopy(doc))


def _doc(db, coll, doc_id, company_id):
    for row in db[coll].docs:
        if row.get("_id") == doc_id and row.get("company_id") == company_id:
            return row
    return None


def _digest(db, company_id):
    payload = []
    for name in sorted(db._cols):
        rows = [copy.deepcopy(d) for d in db._cols[name].docs if d.get("company_id") == company_id]
        if not rows:
            continue
        rows.sort(key=lambda d: json.dumps(d, sort_keys=True, default=str))
        payload.append([name, rows])
    raw = json.dumps(payload, sort_keys=True, default=str).encode()
    return hashlib.sha256(raw).hexdigest()


def _bind(db, deps=None):
    prev = (edocs._db, dict(edocs._deps))
    edocs.init(db, deps or {})
    return prev


def _unbind(prev):
    edocs._db = prev[0]
    edocs._deps.clear()
    edocs._deps.update(prev[1])


def _line(mark, **extra):
    row = {
        "name": "Kalem " + mark,
        "sku": "SKU-" + mark,
        "quantity": 2,
        "unit": "C62",
        "unit_price": 10,
        "vat_rate": 20,
        "total": 20,
        "product_id": None,
    }
    row.update(extra)
    return row


def _edoc(company_id, mark, **extra):
    doc = {
        "_id": EDOC,
        "company_id": company_id,
        "status": "pending",
        "kind": "invoice",
        "number": "GF-" + mark,
        "uuid": "11111111-2222-3333-4444-" + ("a" * 12 if mark == "A" else "b" * 12),
        "issue_date": "2026-10-18",
        "profile": "TEMELFATURA",
        "source": "ubl_xml",
        "supplier": {"name": "Tedarik " + mark, "tax_id": "1111111111"},
        "lines": [_line(mark)],
        "subtotal": 20,
        "vat_total": 4,
        "grand_total": 24,
        "contact_id": None,
        "contact_name": None,
        "matched_lines": 0,
        "received_at": "2026-10-01T00:00:00" if mark == "B" else "2026-10-02T00:00:00",
        "mark": mark,
    }
    doc.update(extra)
    return doc


def _product(company_id, mark, **extra):
    doc = {
        "_id": PRODUCT,
        "company_id": company_id,
        "name": "Urun " + mark,
        "sku": "SAME",
        "barcode": "",
        "show_in_b2b": True,
        "supplier_codes": [],
        "stock_quantity": 9 if mark == "B" else 1,
        "marketplace_aliases": [],
    }
    doc.update(extra)
    return doc


def _contact(company_id, mark, **extra):
    doc = {
        "_id": CONTACT,
        "company_id": company_id,
        "name": "Cari " + mark,
        "type": "supplier",
        "tax_number_or_id": "1111111111",
        "balance": 900 if mark == "B" else 3,
    }
    doc.update(extra)
    return doc


def _xml(mark):
    body = (
        "<Invoice>"
        f"<ID>GF-{mark}</ID>"
        f"<UUID>{'a' * 8}-bbbb-cccc-dddd-eeeeeeeeeeee</UUID>"
        "<IssueDate>2026-10-18</IssueDate>"
        "<ProfileID>TEMELFATURA</ProfileID>"
        "<AccountingSupplierParty><Party>"
        f"<PartyName><Name>Tedarik {mark}</Name></PartyName>"
        '<PartyIdentification><ID schemeID="VKN">1111111111</ID></PartyIdentification>'
        "</Party></AccountingSupplierParty>"
        "<LegalMonetaryTotal><PayableAmount currencyID=\"TRY\">24</PayableAmount></LegalMonetaryTotal>"
        "<InvoiceLine>"
        "<InvoicedQuantity unitCode=\"C62\">2</InvoicedQuantity>"
        "<LineExtensionAmount>20</LineExtensionAmount>"
        f"<Item><Name>Kalem {mark}</Name><SellersItemIdentification><ID>SKU-{mark}</ID></SellersItemIdentification></Item>"
        "<Price><PriceAmount>10</PriceAmount></Price>"
        "</InvoiceLine>"
        "</Invoice>"
    )
    return body


def _blank(company_id, mark):
    return _edoc(
        company_id,
        mark,
        lines=[],
        supplier={},
        subtotal=0,
        vat_total=0,
        grand_total=0,
        number="",
        uuid="",
    )


def _settings(company_id, mark):
    return {
        "_id": "set-" + mark,
        "company_id": company_id,
        "provider": "isnet",
        "status": "configured",
    }


async def _expect(coro, status, detail):
    with pytest.raises(HTTPException) as exc:
        await coro
    assert exc.value.status_code == status
    assert exc.value.detail == detail


def test_other_company_document_is_not_read(monkeypatch):
    db = _DB()
    for cid, mark in ((CO_B, "B"), (CO_A, "A")):
        _add(db, "incoming_edocs", _edoc(cid, mark, profile="TICARIFATURA"))
        _add(db, "incoming_edoc_xml", {"_id": EDOC, "company_id": cid, "xml": _xml(mark)})
        _add(db, "products", _product(cid, mark))
        _add(db, "contacts", _contact(cid, mark))
        _add(db, "einvoice_settings", _settings(cid, mark))
    before = _digest(db, CO_B)
    user = _user(CO_A)
    calls = []

    async def fake_respond(_settings_doc, _password, **kwargs):
        calls.append(kwargs.get("approval"))
        return {"ok": True}

    monkeypatch.setattr(isnet_portal, "respond_incoming_invoice", fake_respond)
    monkeypatch.setattr(edocs, "_portal_password", lambda _settings_doc: "x")
    monkeypatch.setattr(edocs, "_istanbul_today", lambda: _TODAY)
    monkeypatch.setattr(edocs.saas, "check_contact_limit", AsyncMock())
    prev = _bind(db, {"create_product": AsyncMock(return_value={"product": {"id": "p-new", "name": "Kalem"}})})
    try:
        async def run():
            await _expect(edocs.set_lines(EDOC, {"lines": [{"idx": 0, "product_id": PRODUCT}]}, user), 404, "E-belge bulunamadı.")
            await _expect(edocs.create_missing_products(EDOC, {}, user), 404, "E-belge bulunamadı.")
            await _expect(edocs.create_supplier(EDOC, {}, user), 404, "E-belge bulunamadı.")
            await _expect(edocs.link_supplier(EDOC, {"contact_id": CONTACT}, user), 404, "E-belge bulunamadı.")
            await _expect(edocs.approve_edoc(EDOC, {"allow_unmatched": True}, user), 404, "E-belge bulunamadı.")
            await _expect(edocs.process_edoc(EDOC, {}, user), 404, "E-belge bulunamadı.")
            await _expect(edocs.respond_edoc(EDOC, {"approval": "KABUL"}, user), 404, "E-belge bulunamadı.")
            await _expect(edocs.reject_edoc(EDOC, {"reason": "yok"}, user), 404, "E-belge bulunamadı.")
            await _expect(edocs.ignore_edoc(EDOC, {"reason": "yok"}, user), 404, "E-belge bulunamadı.")
            await _expect(edocs.delete_edoc(EDOC, user), 404, "E-belge bulunamadı.")

        _run(run())
    finally:
        _unbind(prev)
    assert calls == []
    assert _doc(db, "incoming_edocs", EDOC, CO_B)["status"] == "pending"
    assert _doc(db, "incoming_edocs", EDOC, CO_B)["number"] == "GF-B"
    assert _doc(db, "incoming_edoc_xml", EDOC, CO_B)["xml"] == _xml("B")
    assert _digest(db, CO_B) == before


def test_set_lines_does_not_match_other_company_product():
    db = _DB()
    _add(db, "products", _product(CO_B, "B"))
    _add(db, "products", _product(CO_A, "A"))
    _add(db, "products", {
        "_id": PRODUCT_B,
        "company_id": CO_B,
        "name": "Yalniz B",
        "sku": "BONLY",
        "show_in_b2b": True,
        "supplier_codes": ["B-ONLY"],
        "stock_quantity": 7,
    })
    _add(db, "incoming_edocs", _edoc(CO_A, "A", lines=[_line("A"), _line("A", sku="SKU-A")]))
    _add(db, "incoming_edocs", _edoc(CO_B, "B"))
    before = _digest(db, CO_B)
    prev = _bind(db)
    try:
        out = _run(edocs._set_lines_core(EDOC, {"lines": [
            {"idx": 0, "product_id": PRODUCT_B},
            {"idx": 1, "product_id": PRODUCT},
        ]}, _user(CO_A)))
    finally:
        _unbind(prev)
    assert out["lines"][0]["product_id"] is None
    assert out["lines"][0].get("product_name") is None
    assert out["lines"][1]["product_id"] == PRODUCT
    assert out["lines"][1]["product_name"] == "Urun A"
    assert "Yalniz B" not in json.dumps(out, default=str)
    assert "Urun B" not in json.dumps(out, default=str)
    assert _doc(db, "products", PRODUCT, CO_A)["show_in_b2b"] is False
    assert _doc(db, "products", PRODUCT, CO_A)["supplier_codes"] == ["SKU-A"]
    assert _doc(db, "products", PRODUCT, CO_B)["show_in_b2b"] is True
    assert _doc(db, "products", PRODUCT, CO_B)["supplier_codes"] == []
    assert _doc(db, "products", PRODUCT_B, CO_B)["supplier_codes"] == ["B-ONLY"]
    assert _doc(db, "products", PRODUCT_B, CO_B)["stock_quantity"] == 7
    assert _doc(db, "incoming_edocs", EDOC, CO_B)["lines"][0]["name"] == "Kalem B"
    assert _digest(db, CO_B) == before


def test_create_missing_and_supplier_stay_in_company(monkeypatch):
    db = _DB()
    _add(db, "incoming_edocs", _edoc(CO_A, "A", contact_id=None))
    _add(db, "incoming_edocs", _edoc(CO_B, "B", contact_id=None))
    _add(db, "contacts", _contact(CO_B, "B"))
    _add(db, "contacts", _contact(CO_A, "A", tax_number_or_id="9999999999", name="Cari A"))
    before = _digest(db, CO_B)
    seen = []

    async def create_product(spec):
        seen.append(spec.get("company_id"))
        return {"product": {"id": "p-new", "name": spec.get("product_name")}}

    monkeypatch.setattr(edocs.saas, "check_contact_limit", AsyncMock())
    prev = _bind(db, {"create_product": create_product})
    try:
        async def run():
            created = await edocs.create_missing_products(EDOC, {"markup": 1.4}, _user(CO_A))
            fresh = await edocs.create_supplier(EDOC, {}, _user(CO_A))
            return created, fresh

        created, fresh = _run(run())
    finally:
        _unbind(prev)
    assert created["created_products"] == 1
    assert created["lines"][0]["product_id"] == "p-new"
    assert created["number"] == "GF-A"
    assert "Kalem B" not in json.dumps(created, default=str)
    assert seen == [CO_A]
    assert fresh["contact_name"] == "Tedarik A"
    assert _doc(db, "incoming_edocs", EDOC, CO_A)["contact_name"] == "Tedarik A"
    assert _doc(db, "incoming_edocs", EDOC, CO_B)["lines"][0]["name"] == "Kalem B"
    assert _doc(db, "incoming_edocs", EDOC, CO_B).get("contact_id") is None
    assert _doc(db, "contacts", CONTACT, CO_B)["balance"] == 900
    new_contacts = [row for row in db.contacts.docs if row.get("_id") != CONTACT]
    assert new_contacts and all(row.get("company_id") == CO_A for row in new_contacts)
    assert _digest(db, CO_B) == before

    direct = _DB()
    _add(direct, "incoming_edocs", _edoc(CO_B, "B"))
    _add(direct, "incoming_edocs", _edoc(CO_A, "A"))
    before_d = _digest(direct, CO_B)
    prev = _bind(direct, {"create_product": create_product})
    try:
        n = _run(edocs.ensure_products_for_unmatched(_edoc(CO_A, "A")))
    finally:
        _unbind(prev)
    assert n == 1
    assert _doc(direct, "incoming_edocs", EDOC, CO_A)["lines"][0]["product_id"] == "p-new"
    assert _doc(direct, "incoming_edocs", EDOC, CO_B)["lines"][0].get("product_id") is None
    assert _digest(direct, CO_B) == before_d


def test_link_supplier_rejects_other_company_contact():
    db = _DB()
    _add(db, "incoming_edocs", _edoc(CO_A, "A"))
    _add(db, "incoming_edocs", _edoc(CO_B, "B"))
    _add(db, "contacts", _contact(CO_B, "B"))
    _add(db, "contacts", _contact(CO_A, "A"))
    before = _digest(db, CO_B)
    admin = _user(CO_A)
    admin["is_super_admin"] = True
    prev = _bind(db)
    try:
        async def run():
            await _expect(
                edocs.link_supplier(EDOC, {"contact_id": CONTACT}, admin),
                404,
                "Cari bulunamadı.",
            )
            _add(db, "contacts", _contact(CO_A, "A", _id="contact-a2", name="Cari A2"))
            linked = await edocs.link_supplier(EDOC, {"contact_id": "contact-a2"}, _user(CO_A))
            return linked

        linked = _run(run())
    finally:
        _unbind(prev)
    assert linked["contact_name"] == "Cari A2"
    assert _doc(db, "incoming_edocs", EDOC, CO_A)["contact_name"] == "Cari A2"
    assert _doc(db, "incoming_edocs", EDOC, CO_B).get("contact_name") is None
    assert _doc(db, "contacts", CONTACT, CO_B)["name"] == "Cari B"
    assert _digest(db, CO_B) == before


def test_approve_and_process_do_not_touch_other_company(monkeypatch):
    db = _DB()
    for cid, mark in ((CO_B, "B"), (CO_A, "A")):
        _add(db, "incoming_edocs", _edoc(
            cid, mark,
            contact_id=CONTACT,
            contact_name="Cari " + mark,
            lines=[_line(mark, product_id=PRODUCT)],
        ))
        _add(db, "products", _product(cid, mark, sku="SKU-" + mark))
        _add(db, "contacts", _contact(cid, mark))
    before = _digest(db, CO_B)
    monkeypatch.setattr(edocs.saas, "check_contact_limit", AsyncMock())
    prev = _bind(db)
    try:
        async def run():
            approved = await edocs.approve_inbox_document(
                EDOC, {"update_stock": True, "update_cost": True, "allow_unmatched": True}, company_id=CO_A,
            )
            return approved

        approved = _run(run())
    finally:
        _unbind(prev)
    assert approved["status"] == "success"
    assert approved["invoice_number"] == "GF-A"
    assert "GF-B" not in approved["message"]
    assert _doc(db, "incoming_edocs", EDOC, CO_A)["status"] == "approved"
    assert _doc(db, "incoming_edocs", EDOC, CO_B)["status"] == "pending"
    assert _doc(db, "products", PRODUCT, CO_A)["stock_quantity"] == 3
    assert _doc(db, "products", PRODUCT, CO_B)["stock_quantity"] == 9
    assert _doc(db, "contacts", CONTACT, CO_A)["balance"] == 3 - 24
    assert _doc(db, "contacts", CONTACT, CO_B)["balance"] == 900
    invoices = [row for row in db.invoices.docs if row.get("company_id") == CO_B]
    assert invoices == []
    assert _digest(db, CO_B) == before

    db2 = _DB()
    _add(db2, "incoming_edocs", _edoc(CO_A, "A", contact_id=None))
    _add(db2, "incoming_edocs", _edoc(CO_B, "B", contact_id=CONTACT, contact_name="Cari B"))
    _add(db2, "products", _product(CO_B, "B"))
    _add(db2, "products", _product(CO_A, "A"))
    _add(db2, "contacts", _contact(CO_B, "B"))
    before_b = _digest(db2, CO_B)
    monkeypatch.setattr(edocs.saas, "check_contact_limit", AsyncMock())
    prev = _bind(db2)
    try:
        processed = _run(edocs.process_edoc(EDOC, {"update_stock": False}, _user(CO_A)))
    finally:
        _unbind(prev)
    assert processed["status"] == "success"
    assert processed["invoice_number"] == "GF-A"
    assert _doc(db2, "incoming_edocs", EDOC, CO_A)["status"] == "approved"
    assert _doc(db2, "incoming_edocs", EDOC, CO_B)["status"] == "pending"
    assert _doc(db2, "products", PRODUCT, CO_B)["show_in_b2b"] is True
    assert _doc(db2, "contacts", CONTACT, CO_B)["balance"] == 900
    assert _digest(db2, CO_B) == before_b


def test_respond_reject_ignore_delete_stay_in_company(monkeypatch):
    db = _DB()
    for cid, mark in ((CO_A, "A"), (CO_B, "B")):
        _add(db, "incoming_edocs", _edoc(cid, mark, profile="TICARIFATURA"))
        _add(db, "incoming_edoc_xml", {"_id": EDOC, "company_id": cid, "xml": _xml(mark)})
        _add(db, "einvoice_settings", _settings(cid, mark))
    before = _digest(db, CO_B)
    calls = []

    async def fake_respond(_settings_doc, _password, **kwargs):
        calls.append(kwargs.get("approval"))
        return {"ok": True}

    monkeypatch.setattr(isnet_portal, "respond_incoming_invoice", fake_respond)
    monkeypatch.setattr(edocs, "_portal_password", lambda _settings_doc: "x")
    monkeypatch.setattr(edocs, "_istanbul_today", lambda: _TODAY)
    prev = _bind(db)
    try:
        out = _run(edocs.respond_edoc(EDOC, {"approval": "KABUL"}, _user(CO_A)))
    finally:
        _unbind(prev)
    assert calls == ["KABUL"]
    assert out["commercial_response"] == "accepted"
    assert "GF-B" not in out["message"]
    assert _doc(db, "incoming_edocs", EDOC, CO_A)["commercial_response"] == "accepted"
    assert _doc(db, "incoming_edocs", EDOC, CO_B).get("commercial_response") is None
    assert _digest(db, CO_B) == before

    rejected = _DB()
    _add(rejected, "incoming_edocs", _edoc(CO_A, "A"))
    _add(rejected, "incoming_edocs", _edoc(CO_B, "B"))
    before_r = _digest(rejected, CO_B)
    prev = _bind(rejected)
    try:
        body = _run(edocs.reject_edoc(EDOC, {"reason": "yerel"}, _user(CO_A)))
    finally:
        _unbind(prev)
    assert body["status"] == "success"
    assert _doc(rejected, "incoming_edocs", EDOC, CO_A)["status"] == "rejected"
    assert _doc(rejected, "incoming_edocs", EDOC, CO_B)["status"] == "pending"
    assert _digest(rejected, CO_B) == before_r

    ignored = _DB()
    _add(ignored, "incoming_edocs", _edoc(CO_A, "A"))
    _add(ignored, "incoming_edocs", _edoc(CO_B, "B"))
    before_i = _digest(ignored, CO_B)
    prev = _bind(ignored)
    try:
        body = _run(edocs.ignore_edoc(EDOC, {"reason": "yok"}, _user(CO_A)))
    finally:
        _unbind(prev)
    assert body["status"] == "success"
    assert _doc(ignored, "incoming_edocs", EDOC, CO_A)["status"] == "ignored"
    assert _doc(ignored, "incoming_edocs", EDOC, CO_B)["status"] == "pending"
    assert _digest(ignored, CO_B) == before_i

    removed = _DB()
    _add(removed, "incoming_edocs", _edoc(CO_A, "A"))
    _add(removed, "incoming_edocs", _edoc(CO_B, "B"))
    _add(removed, "incoming_edoc_xml", {"_id": EDOC, "company_id": CO_A, "xml": _xml("A")})
    _add(removed, "incoming_edoc_xml", {"_id": EDOC, "company_id": CO_B, "xml": _xml("B")})
    before_d = _digest(removed, CO_B)
    prev = _bind(removed)
    try:
        body = _run(edocs.delete_edoc(EDOC, _user(CO_A)))
    finally:
        _unbind(prev)
    assert body == {"status": "success"}
    assert _doc(removed, "incoming_edocs", EDOC, CO_A) is None
    assert _doc(removed, "incoming_edoc_xml", EDOC, CO_A) is None
    assert _doc(removed, "incoming_edocs", EDOC, CO_B)["number"] == "GF-B"
    assert _doc(removed, "incoming_edoc_xml", EDOC, CO_B)["xml"] == _xml("B")
    assert _digest(removed, CO_B) == before_d


def test_inbox_maintenance_does_not_touch_other_company(monkeypatch):
    db = _DB()
    _add(db, "incoming_edocs", _blank(CO_B, "B"))
    _add(db, "incoming_edocs", _blank(CO_A, "A"))
    _add(db, "incoming_edoc_xml", {"_id": EDOC, "company_id": CO_B, "xml": _xml("B")})
    _add(db, "incoming_edoc_xml", {"_id": EDOC, "company_id": CO_A, "xml": _xml("A")})
    before = _digest(db, CO_B)
    prev = _bind(db)
    try:
        parsed = _run(edocs.reparse_inbox(CO_A))
    finally:
        _unbind(prev)
    assert parsed["fixed"] == 1
    assert _doc(db, "incoming_edocs", EDOC, CO_A)["supplier"]["name"] == "Tedarik A"
    assert (_doc(db, "incoming_edocs", EDOC, CO_B).get("supplier") or {}) == {}
    assert _doc(db, "incoming_edocs", EDOC, CO_B)["lines"] == []
    assert _digest(db, CO_B) == before

    cleaned = _DB()
    _add(cleaned, "incoming_edocs", _blank(CO_B, "B"))
    _add(cleaned, "incoming_edocs", _blank(CO_A, "A"))
    _add(cleaned, "incoming_edoc_xml", {"_id": EDOC, "company_id": CO_B, "xml": _xml("B")})
    _add(cleaned, "incoming_edoc_xml", {"_id": EDOC, "company_id": CO_A, "xml": _xml("A")})
    before_c = _digest(cleaned, CO_B)
    prev = _bind(cleaned)
    try:
        result = _run(edocs.cleanup_inbox(CO_A))
    finally:
        _unbind(prev)
    assert result["deleted"] == 1
    assert _doc(cleaned, "incoming_edocs", EDOC, CO_A) is None
    assert _doc(cleaned, "incoming_edoc_xml", EDOC, CO_A) is None
    assert _doc(cleaned, "incoming_edocs", EDOC, CO_B)["mark"] == "B"
    assert _doc(cleaned, "incoming_edoc_xml", EDOC, CO_B)["xml"] == _xml("B")
    assert _digest(cleaned, CO_B) == before_c

    merged = _DB()
    shared_uuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    _add(merged, "incoming_edocs", _edoc(CO_B, "B", uuid=shared_uuid, status="pending"))
    _add(merged, "incoming_edocs", _edoc(CO_A, "A", uuid=shared_uuid, status="pending"))
    _add(merged, "incoming_edocs", _edoc(CO_A, "A", _id=KEEP, uuid=shared_uuid, status="approved", number="GF-KEEP"))
    _add(merged, "incoming_edoc_xml", {"_id": EDOC, "company_id": CO_B, "xml": _xml("B")})
    _add(merged, "incoming_edoc_xml", {"_id": EDOC, "company_id": CO_A, "xml": _xml("A")})
    before_m = _digest(merged, CO_B)
    prev = _bind(merged)
    try:
        removed = _run(edocs.merge_duplicate_edocs(CO_A))
    finally:
        _unbind(prev)
    assert removed == 1
    assert _doc(merged, "incoming_edocs", EDOC, CO_A) is None
    assert _doc(merged, "incoming_edocs", KEEP, CO_A)["status"] == "approved"
    assert _doc(merged, "incoming_edocs", EDOC, CO_B)["number"] == "GF-B"
    assert _doc(merged, "incoming_edoc_xml", EDOC, CO_B)["xml"] == _xml("B")
    assert _digest(merged, CO_B) == before_m

    pending = _DB()
    _add(pending, "incoming_edocs", _edoc(CO_B, "B", supplier={}))
    _add(pending, "incoming_edocs", _edoc(CO_A, "A", supplier={}))
    _add(pending, "products", _product(CO_B, "B"))
    _add(pending, "products", _product(CO_A, "A"))
    before_p = _digest(pending, CO_B)
    monkeypatch.setattr(edocs.saas, "check_contact_limit", AsyncMock())
    prev = _bind(pending)
    try:
        batch = _run(edocs.process_pending_for_company(CO_A, {"auto_create_products": False}))
    finally:
        _unbind(prev)
    assert _doc(pending, "incoming_edocs", EDOC, CO_B)["lines"][0]["name"] == "Kalem B"
    assert _doc(pending, "incoming_edocs", EDOC, CO_B)["status"] == "pending"
    assert _doc(pending, "products", PRODUCT, CO_B)["show_in_b2b"] is True
    assert "GF-B" not in json.dumps(batch, default=str)
    assert _digest(pending, CO_B) == before_p

    enriched = _DB()
    _add(enriched, "products", _product(CO_B, "B"))
    _add(enriched, "products", _product(CO_A, "A"))
    doc = _edoc(CO_A, "A", lines=[_line("A", sku="SAME", name="Kalem")])
    before_e = _digest(enriched, CO_B)
    prev = _bind(enriched)
    try:
        out = _run(edocs._enrich(doc, CO_A))
    finally:
        _unbind(prev)
    assert out["lines"][0]["product_name"] == "Urun A"
    assert _doc(enriched, "products", PRODUCT, CO_A)["show_in_b2b"] is False
    assert _doc(enriched, "products", PRODUCT, CO_B)["show_in_b2b"] is True
    assert _digest(enriched, CO_B) == before_e


def test_blank_company_does_not_query():
    boom = _Boom()
    prev = _bind(boom, {"create_product": AsyncMock()})
    try:
        async def run():
            merged = await edocs.merge_duplicate_edocs("")
            parsed = await edocs.reparse_inbox("")
            cleaned = await edocs.cleanup_inbox("")
            pending = await edocs.process_pending_for_company("")
            created = await edocs.ensure_products_for_unmatched({"_id": EDOC, "lines": [_line("A")]})
            await edocs._release_commercial_claim(EDOC, company_id="")
            return merged, parsed, cleaned, pending, created

        merged, parsed, cleaned, pending, created = _run(run())
    finally:
        _unbind(prev)
    assert merged == 0
    assert parsed["fixed"] == 0
    assert cleaned["deleted"] == 0
    assert pending["processed"] == 0
    assert created == 0

    empty = _DB()
    _add(empty, "incoming_edocs", _edoc(CO_B, "B", contact_id=CONTACT, contact_name="Cari B", lines=[_line("B", product_id=PRODUCT)]))
    _add(empty, "incoming_edocs", _edoc(CO_A, "A", contact_id=CONTACT, contact_name="Cari A", lines=[_line("A", product_id=PRODUCT)]))
    before_empty = _digest(empty, CO_B)
    prev = _bind(empty)
    try:
        with pytest.raises(HTTPException) as missing:
            _run(edocs.approve_inbox_document(EDOC, {"allow_unmatched": True}, company_id=""))
    finally:
        _unbind(prev)
    assert missing.value.status_code == 400
    assert missing.value.detail == "Belge bulunamadı ya da zaten işlenmiş."
    assert _doc(empty, "incoming_edocs", EDOC, CO_B)["status"] == "pending"
    assert _digest(empty, CO_B) == before_empty


def test_release_claim_does_not_clear_other_company():
    db = _DB()
    _add(db, "incoming_edocs", _edoc(CO_B, "B", commercial_response="sending"))
    _add(db, "incoming_edocs", _edoc(CO_A, "A", commercial_response="sending"))
    before = _digest(db, CO_B)
    prev = _bind(db)
    try:
        _run(edocs._release_commercial_claim(EDOC, company_id=CO_A))
    finally:
        _unbind(prev)
    assert "commercial_response" not in _doc(db, "incoming_edocs", EDOC, CO_A)
    assert _doc(db, "incoming_edocs", EDOC, CO_B)["commercial_response"] == "sending"
    assert _digest(db, CO_B) == before


def test_wave6_baseline_keys_removed():
    base = allowlist.TENANT_SCOPE_BASELINE
    present = [key for key in _REMOVED if key in base]
    assert present == []
    assert len(_REMOVED) == 27
    assert all(key[0] == "edocs.py" for key in _REMOVED)
    script = _BACKEND / "scripts" / "tenant_scope_baseline.py"
    proc = subprocess.run(
        [sys.executable, str(script), "--check"],
        cwd=str(_BACKEND.parent),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "temiz" in proc.stdout
