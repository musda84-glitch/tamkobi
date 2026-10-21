"""Ürün görseli, fatura, irsaliye, taksit ve GİB yazımları kiracı dalgası 25.

Bellek içi MemDB. Canlı veritabanına, 8021 portuna ve ağa bağlanmaz.
Tutar, miktar, stok, fiyat, maliyet ve şirket kimliği loglanmaz.
"""
from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException
from starlette.requests import Request

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import cheques  # noqa: E402
import dispatch_invoice  # noqa: E402
import e_invoice  # noqa: E402
import pay_claim  # noqa: E402
import rbac  # noqa: E402
import server  # noqa: E402
import tenant_access  # noqa: E402
import tenant_scope_allowlist as allowlist  # noqa: E402
import trash  # noqa: E402
from dashboard_memdb import MemColl, MemDB  # noqa: E402
from models import Invoice, InvoiceItem, ProductVariant  # noqa: E402
from mysql_store import match_query  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
INV = "inv-shared"
PROD = "prod-shared"
CONTACT = "ct-shared"
ORDER = "ord-shared"
DISP = "disp-shared"
SALES = "sales-shared"
SLIP = "slip-shared"
INST = "inst-shared"
EDOC = "edoc-shared"
FILE = "file-shared"
SECRET_NAME = "UrunB-Gizli"
SECRET_TAX = "9988776655"
SECRET_STOCK = 4242
SECRET_NOTE = "GizliNotB"
SECRET_DUE = "2099-12-31"
TAX_A = "1234567890"

_REMOVED = (
    ("server.py", "_apply_invoice_effects", "contacts", "update_one"),
    ("server.py", "_apply_invoice_effects", "invoices", "update_one"),
    ("server.py", "_apply_invoice_effects", "products", "update_one"),
    ("server.py", "_approve_invoice_already_ok", "orders", "find_one"),
    ("server.py", "_attach_product_image_from_url", "products", "find_one"),
    ("server.py", "_attach_promissory", "installments", "find"),
    ("server.py", "_cancel_invoice_core", "bank_transactions", "find"),
    ("server.py", "_cancel_invoice_core", "bank_transactions", "update_one"),
    ("server.py", "_cancel_invoice_core", "contacts", "update_one"),
    ("server.py", "_cancel_invoice_core", "incoming_edocs", "update_one"),
    ("server.py", "_cancel_invoice_core", "installments", "update_many"),
    ("server.py", "_cancel_invoice_core", "invoices", "update_one"),
    ("server.py", "_cancel_invoice_core", "partner_transactions", "find"),
    ("server.py", "_cancel_invoice_core", "partner_transactions", "update_one"),
    ("server.py", "_cancel_promissory_for_query", "installments", "find"),
    ("server.py", "_create_expense_slip_from_invoice_core", "invoices", "find_one"),
    ("server.py", "_create_expense_slip_from_invoice_core", "invoices", "update_one"),
    ("server.py", "_create_invoice_core", "invoices", "insert_one"),
    ("server.py", "_create_invoice_installments", "installments", "insert_many"),
    ("server.py", "_create_invoice_installments", "invoices", "update_one"),
    ("server.py", "_do", "installments", "find_one"),
    ("server.py", "_invoice_finance_block", "bank_transactions", "count_documents"),
    ("server.py", "_invoice_finance_block", "installments", "count_documents"),
    ("server.py", "_merge_dispatches_core", "invoices", "find_one"),
    ("server.py", "_post_incoming_purchase_invoice", "invoices", "find_one"),
    ("server.py", "_post_incoming_purchase_invoice", "invoices", "update_one"),
    ("server.py", "_reverse_invoice_effects", "contacts", "update_one"),
    ("server.py", "_reverse_invoice_effects", "invoices", "update_one"),
    ("server.py", "_reverse_invoice_effects", "products", "update_one"),
    ("server.py", "_send_dispatch_to_isnet_if_configured", "invoices", "find_one"),
    ("server.py", "_send_dispatch_to_isnet_if_configured", "invoices", "update_one"),
    ("server.py", "_set_invoice_item_product", "invoices", "update_one"),
    ("server.py", "_set_invoice_item_product", "products", "update_one"),
    ("server.py", "_soft_delete_invoice_doc", "installments", "find"),
    ("server.py", "_unlink_dispatch_refs", "invoices", "update_many"),
    ("server.py", "_unlink_dispatch_refs", "orders", "update_many"),
    ("server.py", "_unlink_orders_from_invoice", "orders", "update_many"),
    ("server.py", "accept_incoming_invoice", "incoming_edocs", "update_one"),
    ("server.py", "accept_incoming_invoice", "invoices", "find_one"),
    ("server.py", "accept_incoming_invoice", "invoices", "update_one"),
    ("server.py", "approve_invoice", "contacts", "find_one"),
    ("server.py", "approve_invoice", "orders", "find_one"),
    ("server.py", "convert_dispatch_to_invoice", "invoices", "find_one"),
    ("server.py", "copy_invoice", "invoices", "find_one"),
    ("server.py", "copy_invoice", "invoices", "update_one"),
    ("server.py", "copy_invoice", "purchase_orders", "insert_one"),
    ("server.py", "create_dispatch_from_invoice", "contacts", "find_one"),
    ("server.py", "create_dispatch_from_invoice", "invoices", "find_one"),
    ("server.py", "create_dispatch_from_invoice", "invoices", "update_one"),
    ("server.py", "create_invoice_installments", "installments", "count_documents"),
    ("server.py", "create_invoice_installments", "installments", "delete_many"),
    ("server.py", "create_invoice_installments", "installments", "find"),
    ("server.py", "delete_invoice_installments", "installments", "count_documents"),
    ("server.py", "delete_invoice_installments", "installments", "delete_many"),
    ("server.py", "delete_invoice_installments", "invoices", "update_one"),
    ("server.py", "list_invoice_installments", "installments", "find"),
    ("server.py", "reject_incoming_invoice", "incoming_edocs", "update_one"),
    ("server.py", "reject_incoming_invoice", "invoices", "update_one"),
    ("server.py", "send_invoice_to_gib", "invoices", "find_one"),
    ("server.py", "send_invoice_to_gib", "invoices", "update_one"),
    ("server.py", "serve_file", "files", "find_one"),
    ("server.py", "update_invoice", "contacts", "find_one"),
    ("server.py", "update_invoice", "invoices", "find_one"),
    ("server.py", "update_invoice", "invoices", "update_one"),
    ("server.py", "update_product_images", "products", "find_one"),
    ("server.py", "update_product_images", "products", "update_one"),
    ("server.py", "update_product_variants", "products", "find_one"),
    ("server.py", "update_product_variants", "products", "update_one"),
)


def _run(coro):
    return asyncio.run(coro)


def _user(company_id=CO_A):
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
        "company_id": company_id,
    }


class _Coll(MemColl):
    async def delete_one(self, query=None):
        from dashboard_memdb import _split_field_ops

        query = _split_field_ops(query or {})
        for index, doc in enumerate(self.docs):
            if match_query(doc, query):
                del self.docs[index]
                return type("R", (), {"deleted_count": 1})()
        return type("R", (), {"deleted_count": 0})()

    async def delete_many(self, query=None):
        from dashboard_memdb import _split_field_ops

        query = _split_field_ops(query or {})
        kept = []
        deleted = 0
        for doc in self.docs:
            if match_query(doc, query):
                deleted += 1
            else:
                kept.append(doc)
        self.docs[:] = kept
        return type("R", (), {"deleted_count": deleted})()


class _DB(MemDB):
    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = _Coll(name, self)
            self._cols[name] = coll
        return coll


def _add(db, coll, doc):
    db[coll].docs.append(copy.deepcopy(doc))


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


def _bind(db):
    prev = {"server": server.db, "rbac": rbac._db, "trash": trash._db}
    server.db = db
    rbac._db = db
    trash._db = db
    return prev


def _restore(prev):
    server.db = prev["server"]
    rbac._db = prev["rbac"]
    trash._db = prev["trash"]


def _use(db, monkeypatch):
    monkeypatch.setattr(tenant_access, "get_tenant_doc", _own)
    return _bind(db)


async def _own(db_arg, collection, doc_id, actor, **kwargs):
    allowed = {str(item) for item in (actor.get("company_ids") or [])}
    for row in db_arg[collection].docs:
        if str(row.get("_id")) == str(doc_id) and str(row.get("company_id") or "") in allowed:
            return copy.deepcopy(row)
    raise HTTPException(status_code=404, detail=kwargs.get("not_found") or "Kayıt bulunamadı.")


def _row(db, coll, company_id, doc_id):
    for doc in db[coll].docs:
        if doc.get("_id") == doc_id and doc.get("company_id") == company_id:
            return doc
    return None


def _secrets(payload):
    raw = json.dumps(payload, default=str, ensure_ascii=False)
    for token in (SECRET_NAME, SECRET_TAX, str(SECRET_STOCK), SECRET_NOTE, SECRET_DUE):
        assert token not in raw


def _request():
    return Request({
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/",
        "raw_path": b"/",
        "query_string": b"",
        "headers": [],
        "client": ("127.0.0.1", 1),
        "server": ("test", 80),
    })


def _product(company, **extra):
    row = {
        "_id": PROD,
        "company_id": company,
        "name": "UrunA" if company == CO_A else SECRET_NAME,
        "sku": "SKU-A" if company == CO_A else "SKU-B",
        "stock_quantity": 10 if company == CO_A else SECRET_STOCK,
        "show_in_b2b": True,
        "image_url": "a.jpg" if company == CO_A else "gizli.jpg",
        "unit": "Adet",
        "vat_rate": 20,
    }
    row.update(extra)
    return row


def _contact(company, **extra):
    row = {
        "_id": CONTACT,
        "company_id": company,
        "name": "CariA" if company == CO_A else SECRET_NAME,
        "tax_number_or_id": TAX_A if company == CO_A else SECRET_TAX,
        "tax_office": "Kadikoy",
        "address": "Adres A" if company == CO_A else "Adres Gizli",
        "city": "Istanbul",
        "balance": 0 if company == CO_A else SECRET_STOCK,
    }
    row.update(extra)
    return row


def _item(company):
    return {
        "product_id": PROD,
        "name": "KalemA" if company == CO_A else SECRET_NAME,
        "quantity": 2,
        "unit": "Adet",
        "unit_price": 10,
        "total": 20,
        "vat_rate": 20,
        "sku": "SKU-A" if company == CO_A else "SKU-B",
    }


def _inv(company, doc_id=INV, **extra):
    row = {
        "_id": doc_id,
        "company_id": company,
        "invoice_number": "TA-A" if company == CO_A else "TA-GIZLI",
        "invoice_type": "sales",
        "e_type": "e_archive",
        "status": "draft",
        "contact_id": CONTACT,
        "contact_name": "CariA" if company == CO_A else SECRET_NAME,
        "items": [_item(company)],
        "grand_total": 80,
        "subtotal": 80,
        "currency": "TRY",
        "fx_rate": 1,
        "paid_amount": 0,
        "payment_status": "unpaid",
        "effects_applied": False,
        "issue_date": "2026-10-21",
    }
    row.update(extra)
    return row


def _both(db, coll, builder):
    _add(db, coll, builder(CO_B))
    _add(db, coll, builder(CO_A))


def _patch_notes(monkeypatch):
    seen = []

    async def cancel(ids):
        seen.extend(list(ids or []))
        return 0

    async def create(docs, include_down_payment=False):
        return []

    monkeypatch.setattr(cheques, "cancel_promissory_for_installments", cancel)
    monkeypatch.setattr(cheques, "create_promissory_for_installments", create)
    return seen


def _patch_issue(monkeypatch):
    called = []

    async def issue(invoice_id, **kwargs):
        called.append((invoice_id, kwargs.get("company_id"), kwargs.get("e_type")))
        return {"message": "iletildi"}

    monkeypatch.setattr(e_invoice, "issue_invoice", issue)
    return called


def _raises(status, fn):
    with pytest.raises(HTTPException) as exc:
        _run(fn())
    assert exc.value.status_code == status
    return exc.value


def test_product_image_attach_updates_only_own_company(monkeypatch):
    db = _DB()
    _both(db, "products", _product)
    seen = {}

    class _Resp:
        status_code = 200
        content = b"\xff\xd8\xff" + b"\x00" * 32
        headers = {"content-type": "image/jpeg"}

    class _Http:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def get(self, url):
            return _Resp()

    async def store(product, data, content_type, filename="image.jpg", variant_id=None):
        seen["company"] = product.get("company_id")
        seen["name"] = product.get("name")
        await server.db.products.update_one(
            {"_id": product["_id"], "company_id": product.get("company_id")},
            {"$set": {"image_url": "owned.jpg"}},
        )
        return {"image_url": "owned.jpg"}

    monkeypatch.setattr(server.httpx, "AsyncClient", _Http)
    monkeypatch.setattr(server, "_store_product_image_bytes", store)
    prev = _use(db, monkeypatch)
    try:
        before = _digest(db, CO_B)
        out = _run(server._attach_product_image_from_url(PROD, "https://cdn.example/a.jpg", CO_A))
        assert out == "owned.jpg"
        assert seen["company"] == CO_A
        assert seen["name"] == "UrunA"
        assert _row(db, "products", CO_A, PROD)["image_url"] == "owned.jpg"
        assert _row(db, "products", CO_B, PROD)["image_url"] == "gizli.jpg"
        assert _row(db, "products", CO_B, PROD)["name"] == SECRET_NAME
        missed = _run(server._attach_product_image_from_url(PROD, "https://cdn.example/a.jpg", None))
        assert missed is None
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_update_product_images_and_variants_keep_other_company(monkeypatch):
    user = _user()
    db = _DB()
    _both(db, "products", _product)
    prev = _use(db, monkeypatch)
    try:
        before = _digest(db, CO_B)
        images = _run(server.update_product_images(PROD, {"images": ["kapak.jpg"], "image_url": "kapak.jpg"}, user=user))
        _secrets(images)
        assert images["image_url"] == "kapak.jpg"
        assert _row(db, "products", CO_A, PROD)["image_url"] == "kapak.jpg"
        assert _row(db, "products", CO_B, PROD)["image_url"] == "gizli.jpg"
        variants = _run(server.update_product_variants(
            PROD,
            server.VariantsUpdateRequest(
                variant_options=[{"name": "Renk", "values": ["Mavi"]}],
                variants=[ProductVariant(name="Mavi", sku="V-A", stock=3, price=10)],
            ),
            user=user,
        ))
        _secrets(variants)
        assert _row(db, "products", CO_A, PROD)["stock_quantity"] == 3
        assert _row(db, "products", CO_B, PROD)["stock_quantity"] == SECRET_STOCK
        assert _row(db, "products", CO_B, PROD)["name"] == SECRET_NAME
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_serve_file_uses_storage_path_and_leaves_other_company(monkeypatch):
    db = _DB()
    _add(db, "files", {
        "_id": FILE, "company_id": CO_B, "storage_path": "products/b.jpg",
        "is_deleted": False, "content_type": "application/pdf", "note": SECRET_NOTE,
    })
    _add(db, "files", {
        "_id": FILE, "company_id": CO_A, "storage_path": "products/a.jpg",
        "is_deleted": False, "content_type": "image/jpeg",
    })

    def fake_get(path):
        return b"\xff\xd8" + b"a" * 40, "application/octet-stream"

    monkeypatch.setattr(server, "get_object", fake_get)
    prev = _use(db, monkeypatch)
    try:
        before = _digest(db, CO_B)
        res = _run(server.serve_file("products/a.jpg", _request(), w=None, fmt=None, t=None))
        assert res.media_type == "image/jpeg"
        assert _row(db, "files", CO_B, FILE)["content_type"] == "application/pdf"
        assert _row(db, "files", CO_B, FILE)["note"] == SECRET_NOTE
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_send_dispatch_updates_only_own_invoice(monkeypatch):
    db = _DB()
    _add(db, "invoices", _inv(CO_B, INV, invoice_number="TA-GIZLI", despatch_plate="GIZLI34"))
    _add(db, "invoices", _inv(CO_A, INV, invoice_number="TA-A"))
    _add(db, "einvoice_settings", {
        "_id": "set-a", "company_id": CO_A, "provider": "isnet", "status": "configured",
        "despatch_plate": "34ABC01",
    })
    called = _patch_issue(monkeypatch)
    prev = _use(db, monkeypatch)
    try:
        before = _digest(db, CO_B)
        sent = _run(server._send_dispatch_to_isnet_if_configured(_row(db, "invoices", CO_A, INV)))
        assert sent["sent"] is True
        assert called[-1][1] == CO_A
        assert _row(db, "invoices", CO_A, INV).get("despatch_plate")
        assert _row(db, "invoices", CO_B, INV).get("despatch_plate") == "GIZLI34"
        assert _row(db, "invoices", CO_B, INV)["invoice_number"] == "TA-GIZLI"
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_create_dispatch_reads_own_contact_and_existing_dispatch(monkeypatch):
    user = _user()
    db = _DB()
    _both(db, "contacts", _contact)
    _add(db, "invoices", _inv(
        CO_B, DISP, invoice_type="dispatch", e_type="e_dispatch", invoice_number="IRS-GIZLI",
        status="draft",
    ))
    _add(db, "invoices", _inv(
        CO_A, DISP, invoice_type="dispatch", e_type="e_dispatch", invoice_number="IRS-A", status="draft",
    ))
    _add(db, "invoices", _inv(CO_B, INV, dispatch_id=DISP, contact_tax_id=""))
    _add(db, "invoices", _inv(CO_A, INV, dispatch_id=DISP, contact_tax_id=""))
    prev = _use(db, monkeypatch)
    try:
        before = _digest(db, CO_B)
        exists = _run(server.create_dispatch_from_invoice(INV, user=user))
        _secrets(exists)
        assert exists["status"] == "exists"
        assert "IRS-A" in exists["message"]
        assert "IRS-GIZLI" not in exists["message"]
        assert _digest(db, CO_B) == before
        bare_b = _inv(CO_B, "inv-open", contact_tax_id="", dispatch_id=None)
        bare_a = _inv(CO_A, "inv-open", contact_tax_id="", dispatch_id=None)
        bare_b.pop("dispatch_id", None)
        bare_a.pop("dispatch_id", None)
        _add(db, "invoices", bare_b)
        _add(db, "invoices", bare_a)
        before = _digest(db, CO_B)
        created = _run(server.create_dispatch_from_invoice("inv-open", user=user))
        _secrets(created)
        assert created["status"] == "success"
        assert created["dispatch"]["contact_tax_id"] == TAX_A
        assert _row(db, "invoices", CO_A, "inv-open").get("dispatch_id")
        assert _row(db, "invoices", CO_B, "inv-open").get("dispatch_id") in (None, "")
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_copy_invoice_same_contact_and_supplier_order(monkeypatch):
    user = _user()
    db = _DB()
    _both(db, "contacts", _contact)
    _both(db, "products", _product)
    _both(db, "invoices", lambda company: _inv(company, INV))
    prev = _use(db, monkeypatch)
    try:
        before = _digest(db, CO_B)
        order = _run(server.copy_invoice(INV, {"mode": "to_supplier_order", "contact_id": CONTACT}, user=user))
        _secrets(order)
        assert order["kind"] == "purchase_order"
        assert order["purchase_order"]["company_id"] == CO_A
        assert order["purchase_order"].get("supplier_name") == "CariA"
        copied = _run(server.copy_invoice(INV, {"mode": "same_contact"}, user=user))
        _secrets(copied)
        assert copied["kind"] == "invoice"
        assert copied["invoice"]["company_id"] == CO_A
        assert copied["invoice"]["contact_name"] == "CariA"
        assert _row(db, "invoices", CO_B, INV)["invoice_number"] == "TA-GIZLI"
        assert _row(db, "invoices", CO_B, INV)["contact_name"] == SECRET_NAME
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_expense_slip_existing_and_create_ignore_other_company(monkeypatch):
    user = _user()
    db = _DB()
    _both(db, "contacts", _contact)
    _both(db, "products", _product)
    _add(db, "invoices", _inv(CO_B, SLIP, invoice_number="GP-GIZLI", status="approved", e_type="expense_slip"))
    _add(db, "invoices", _inv(CO_A, SLIP, invoice_number="GP-A", status="approved", e_type="expense_slip"))
    _add(db, "invoices", _inv(CO_B, INV, status="approved", expense_slip_id=SLIP))
    _add(db, "invoices", _inv(CO_A, INV, status="approved", expense_slip_id=SLIP))
    prev = _use(db, monkeypatch)
    try:
        before = _digest(db, CO_B)
        exists = _run(server._create_expense_slip_from_invoice_core(INV, user))
        _secrets(exists)
        assert exists["status"] == "exists"
        assert "GP-A" in exists["message"]
        assert "GP-GIZLI" not in exists["message"]
        assert _digest(db, CO_B) == before
        _add(db, "invoices", _inv(CO_B, "inv-src", status="approved"))
        _add(db, "invoices", _inv(CO_A, "inv-src", status="approved"))
        before = _digest(db, CO_B)
        created = _run(server._create_expense_slip_from_invoice_core("inv-src", user))
        _secrets(created)
        assert created["status"] == "success"
        assert _row(db, "invoices", CO_A, "inv-src").get("expense_slip_id")
        assert not _row(db, "invoices", CO_B, "inv-src").get("expense_slip_id")
        assert _row(db, "products", CO_B, PROD)["stock_quantity"] == SECRET_STOCK
        assert _row(db, "contacts", CO_B, CONTACT)["balance"] == SECRET_STOCK
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_convert_dispatch_returns_own_invoice(monkeypatch):
    user = _user()
    db = _DB()
    _add(db, "invoices", _inv(CO_B, SALES, invoice_number="TA-GIZLI", invoice_type="sales", status="draft"))
    _add(db, "invoices", _inv(CO_A, SALES, invoice_number="TA-A", invoice_type="sales", status="draft"))
    _add(db, "invoices", _inv(
        CO_B, DISP, invoice_type="dispatch", e_type="e_dispatch", converted_invoice_id=SALES,
        invoice_number="IRS-GIZLI", status="draft",
    ))
    _add(db, "invoices", _inv(
        CO_A, DISP, invoice_type="dispatch", e_type="e_dispatch", converted_invoice_id=SALES,
        invoice_number="IRS-A", status="draft",
    ))
    prev = _use(db, monkeypatch)
    try:
        before = _digest(db, CO_B)
        out = _run(server.convert_dispatch_to_invoice(DISP, {}, user=user))
        _secrets(out)
        assert out["status"] == "exists"
        assert "TA-A" in out["message"]
        assert _row(db, "invoices", CO_B, SALES)["invoice_number"] == "TA-GIZLI"
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_merge_dispatches_loads_own_dispatch(monkeypatch):
    user = _user()
    db = _DB()
    _both(db, "contacts", _contact)
    _both(db, "products", _product)

    def dispatch(company):
        return _inv(
            company, "disp-merge", invoice_type="dispatch", e_type="e_dispatch", status="draft",
            dispatch_status="draft", converted_invoice_id=None, currency="TRY",
            invoice_number="IRS-A" if company == CO_A else "IRS-GIZLI",
        )

    _both(db, "invoices", dispatch)
    prev = _use(db, monkeypatch)
    try:
        before = _digest(db, CO_B)
        doc = _run(server._merge_dispatches_core(["disp-merge"], user, company_id=CO_A))
        assert doc["company_id"] == CO_A
        names = [it.get("name") for it in doc.get("items") or []]
        assert "KalemA" in names
        assert SECRET_NAME not in names
        assert _row(db, "invoices", CO_B, "disp-merge")["dispatch_status"] == "draft"
        assert _row(db, "invoices", CO_B, "disp-merge")["invoice_number"] == "IRS-GIZLI"
        assert _row(db, "invoices", CO_A, "disp-merge")["dispatch_status"] == "invoiced"
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_create_invoice_core_stamps_caller_company(monkeypatch):
    user = _user()
    db = _DB()
    _both(db, "contacts", _contact)
    _both(db, "products", _product)
    _add(db, "invoices", _inv(CO_B, INV))
    prev = _use(db, monkeypatch)
    try:
        before = _digest(db, CO_B)
        draft = Invoice(
            company_id=CO_A,
            invoice_type="sales",
            contact_id=CONTACT,
            contact_name="CariA",
            items=[InvoiceItem(name="KalemA", quantity=1, unit_price=10, total=10)],
            currency="TRY",
            status="draft",
        )
        out = _run(server._create_invoice_core(draft, user))
        _secrets(out)
        assert out["company_id"] == CO_A
        stored = [d for d in db.invoices.docs if d.get("company_id") == CO_A and d.get("source_channel") != "keep"]
        assert stored
        assert all(d.get("company_id") == CO_A for d in db.invoices.docs if d.get("_id") != INV or d.get("company_id") == CO_A)
        assert _row(db, "invoices", CO_B, INV)["invoice_number"] == "TA-GIZLI"
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_apply_and_reverse_effects_touch_only_own_rows():
    db = _DB()
    _both(db, "contacts", _contact)
    _both(db, "products", _product)
    sales = _inv(CO_A, "inv-sales", invoice_type="sales", grand_total=80)
    _add(db, "invoices", _inv(CO_B, "inv-sales", invoice_number="TA-GIZLI"))
    _add(db, "invoices", sales)
    purchase = _inv(
        CO_A, "inv-pur", invoice_type="purchase", e_type="e_invoice", direction="incoming",
        edoc_id=EDOC, stock_effects_applied=False, grand_total=40,
    )
    _add(db, "invoices", _inv(
        CO_B, "inv-pur", invoice_type="purchase", stock_effects_applied=False, invoice_number="AL-GIZLI",
    ))
    _add(db, "invoices", purchase)
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        _run(server._apply_invoice_effects(sales))
        assert _row(db, "contacts", CO_A, CONTACT)["balance"] == 80
        assert _row(db, "products", CO_A, PROD)["stock_quantity"] == 8
        assert _row(db, "contacts", CO_B, CONTACT)["balance"] == SECRET_STOCK
        assert _row(db, "products", CO_B, PROD)["stock_quantity"] == SECRET_STOCK
        _run(server._reverse_invoice_effects(sales))
        assert _row(db, "contacts", CO_A, CONTACT)["balance"] == 0
        assert _row(db, "products", CO_A, PROD)["stock_quantity"] == 10
        _run(server._apply_invoice_effects(purchase))
        assert _row(db, "products", CO_A, PROD)["stock_quantity"] == 12
        assert _row(db, "invoices", CO_A, "inv-pur")["stock_effects_applied"] is True
        assert _row(db, "invoices", CO_B, "inv-pur")["stock_effects_applied"] is False
        _run(server._reverse_invoice_effects(_row(db, "invoices", CO_A, "inv-pur")))
        assert _row(db, "products", CO_A, PROD)["stock_quantity"] == 10
        assert _row(db, "invoices", CO_B, "inv-pur")["invoice_number"] == "AL-GIZLI"
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_post_incoming_purchase_posts_own_draft(monkeypatch):
    db = _DB()
    _both(db, "contacts", _contact)
    _both(db, "products", _product)

    def incoming(company):
        return _inv(
            company, "inv-in", invoice_type="purchase", e_type="e_invoice", direction="incoming",
            status="draft", effects_applied=False, stock_effects_applied=False, edoc_id=EDOC,
            invoice_number="AL-A" if company == CO_A else "AL-GIZLI",
        )

    _both(db, "invoices", incoming)
    prev = _use(db, monkeypatch)
    try:
        before = _digest(db, CO_B)
        out = _run(server._post_incoming_purchase_invoice("inv-in", _row(db, "invoices", CO_A, "inv-in")))
        assert out["already"] is False
        assert _row(db, "invoices", CO_A, "inv-in")["status"] == "approved"
        assert _row(db, "invoices", CO_B, "inv-in")["status"] == "draft"
        assert _row(db, "invoices", CO_B, "inv-in")["invoice_number"] == "AL-GIZLI"
        assert _row(db, "products", CO_A, PROD)["stock_quantity"] == 12
        assert _row(db, "products", CO_B, PROD)["stock_quantity"] == SECRET_STOCK
        assert _digest(db, CO_B) == before

        async def boom(inv):
            raise RuntimeError("uygulanamadi")

        monkeypatch.setattr(server, "_apply_invoice_effects", boom)
        _add(db, "invoices", _inv(
            CO_B, "inv-lock", invoice_type="purchase", status="draft", effects_applied=False,
            marker=SECRET_NOTE,
        ))
        _add(db, "invoices", _inv(
            CO_A, "inv-lock", invoice_type="purchase", e_type="e_invoice", direction="incoming",
            status="draft", effects_applied=False, stock_effects_applied=False,
        ))
        before = _digest(db, CO_B)
        with pytest.raises(RuntimeError):
            _run(server._post_incoming_purchase_invoice("inv-lock", _row(db, "invoices", CO_A, "inv-lock")))
        assert _row(db, "invoices", CO_A, "inv-lock").get("posting_lock") is False
        assert _row(db, "invoices", CO_A, "inv-lock")["status"] == "draft"
        assert _row(db, "invoices", CO_B, "inv-lock").get("marker") == SECRET_NOTE
        assert "posting_lock" not in _row(db, "invoices", CO_B, "inv-lock")
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_approve_already_ok_does_not_mark_other_order(monkeypatch):
    user = _user()
    db = _DB()
    _add(db, "orders", {"_id": ORDER, "company_id": CO_B, "is_invoiced": False, "customer_name": SECRET_NAME})
    _add(db, "orders", {"_id": ORDER, "company_id": CO_A, "is_invoiced": True, "customer_name": "MusteriA"})
    _add(db, "invoices", _inv(CO_B, INV, status="approved", order_id=ORDER))
    _add(db, "invoices", _inv(CO_A, INV, status="approved", order_id=ORDER))
    prev = _use(db, monkeypatch)
    try:
        before = _digest(db, CO_B)
        out = _run(server.approve_invoice(INV, user=user))
        _secrets(out)
        assert out["status"] == "success"
        assert _row(db, "orders", CO_A, ORDER)["is_invoiced"] is True
        assert _row(db, "orders", CO_B, ORDER)["is_invoiced"] is False
        assert _row(db, "orders", CO_B, ORDER)["customer_name"] == SECRET_NAME
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_approve_invoice_reads_own_order_and_contact(monkeypatch):
    user = _user()
    db = _DB()
    _both(db, "contacts", _contact)
    _both(db, "products", _product)
    _add(db, "orders", {
        "_id": ORDER, "company_id": CO_B, "is_invoiced": False, "customer_name": SECRET_NAME,
        "order_number": "SP-GIZLI",
    })
    _add(db, "orders", {
        "_id": ORDER, "company_id": CO_A, "is_invoiced": False, "customer_name": "MusteriA",
        "order_number": "SP-A",
    })
    _both(db, "invoices", lambda company: _inv(company, INV, status="draft", order_id=ORDER))
    seen = {}

    async def scoped_mark(db_arg, inv):
        cid = str(inv.get("company_id") or "").strip()
        for oid in dispatch_invoice.order_ids_of(inv):
            await db_arg.orders.update_one(
                {"_id": oid, "company_id": cid},
                {"$set": {"is_invoiced": True, "invoice_id": inv.get("_id")}},
            )

    async def settle(order, inv, contact):
        seen["order"] = (order or {}).get("customer_name")
        seen["contact"] = (contact or {}).get("name")
        return None

    monkeypatch.setattr(dispatch_invoice, "mark_orders_invoiced", scoped_mark)
    monkeypatch.setattr(server, "_post_marketplace_settlement", settle)
    prev = _use(db, monkeypatch)
    try:
        before = _digest(db, CO_B)
        out = _run(server.approve_invoice(INV, user=user))
        _secrets(out)
        assert out["status"] == "success"
        assert seen["order"] == "MusteriA"
        assert seen["contact"] == "CariA"
        assert _row(db, "orders", CO_A, ORDER)["is_invoiced"] is True
        assert _row(db, "orders", CO_B, ORDER)["is_invoiced"] is False
        assert _row(db, "orders", CO_B, ORDER)["customer_name"] == SECRET_NAME
        assert _row(db, "invoices", CO_A, INV)["status"] == "approved"
        assert _row(db, "invoices", CO_B, INV)["status"] == "draft"
        assert _row(db, "products", CO_B, PROD)["stock_quantity"] == SECRET_STOCK
        assert _row(db, "contacts", CO_B, CONTACT)["balance"] == SECRET_STOCK
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_update_invoice_locked_fields_and_contact(monkeypatch):
    user = _user()
    db = _DB()
    _both(db, "contacts", _contact)
    _add(db, "invoices", _inv(
        CO_B, INV, status="approved", einvoice_state="sent", e_type="e_archive", due_date=SECRET_DUE,
    ))
    _add(db, "invoices", _inv(
        CO_A, INV, status="approved", einvoice_state="sent", e_type="e_archive", due_date="2026-01-01",
    ))
    prev = _use(db, monkeypatch)
    try:
        before = _digest(db, CO_B)
        locked = _run(server.update_invoice(INV, {"due_date": "2026-06-15"}, user=user))
        _secrets(locked)
        assert locked["due_date"] == "2026-06-15"
        assert _row(db, "invoices", CO_A, INV)["due_date"] == "2026-06-15"
        assert _row(db, "invoices", CO_B, INV)["due_date"] == SECRET_DUE
        _add(db, "invoices", _inv(CO_B, "inv-draft", status="draft", effects_applied=False, contact_name=SECRET_NAME))
        _add(db, "invoices", _inv(CO_A, "inv-draft", status="draft", effects_applied=False, contact_id=CONTACT))
        before = _digest(db, CO_B)
        edited = _run(server.update_invoice("inv-draft", {"contact_id": CONTACT}, user=user))
        _secrets(edited)
        assert edited["contact_name"] == "CariA"
        assert _row(db, "invoices", CO_B, "inv-draft")["contact_name"] == SECRET_NAME
        assert _row(db, "contacts", CO_B, CONTACT)["name"] == SECRET_NAME
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_finance_block_unlink_and_soft_delete_ignore_other_company(monkeypatch):
    db = _DB()
    _patch_notes(monkeypatch)

    async def fake_trash(collection, doc, *args, **kwargs):
        await server.db[collection].delete_one({"_id": doc.get("_id"), "company_id": doc.get("company_id")})
        for block in kwargs.get("related") or []:
            for row in block.get("docs") or []:
                await server.db[block["collection"]].delete_one(
                    {"_id": row.get("_id"), "company_id": row.get("company_id")},
                )
        return "trash-1"

    monkeypatch.setattr(trash, "soft_delete", fake_trash)
    _add(db, "orders", {
        "_id": "ord-b", "company_id": CO_B, "invoice_id": DISP, "dispatch_id": DISP,
        "is_invoiced": True, "tag": SECRET_NOTE,
    })
    _add(db, "orders", {
        "_id": "ord-a", "company_id": CO_A, "invoice_id": DISP, "dispatch_id": DISP, "is_invoiced": True,
    })
    _add(db, "invoices", _inv(CO_B, "sales-b", dispatch_id=DISP, invoice_number="TA-GIZLI"))
    _add(db, "invoices", _inv(CO_A, "sales-a", dispatch_id=DISP, invoice_number="TA-A"))
    _add(db, "invoices", _inv(
        CO_B, DISP, invoice_type="dispatch", e_type="e_dispatch", status="draft", invoice_number="IRS-GIZLI",
    ))
    _add(db, "invoices", _inv(
        CO_A, DISP, invoice_type="dispatch", e_type="e_dispatch", status="draft", invoice_number="IRS-A",
    ))
    _add(db, "installments", {
        "_id": "inst-b", "company_id": CO_B, "invoice_id": DISP, "status": "paid", "amount": SECRET_STOCK,
        "no": 1, "label": SECRET_NOTE, "due_date": "2026-12-01",
    })
    _add(db, "installments", {
        "_id": "inst-a", "company_id": CO_A, "invoice_id": DISP, "status": "pending", "amount": 10,
        "no": 1, "label": "1. Taksit", "due_date": "2026-12-01",
    })
    _add(db, "bank_transactions", {
        "_id": "bank-b", "company_id": CO_B, "related_invoice_id": DISP, "amount": 3,
    })
    _add(db, "installments", {
        "_id": "inst-paid-a", "company_id": CO_A, "invoice_id": "inv-paid", "status": "paid", "amount": 15,
        "no": 1, "label": "Pesin", "due_date": "2026-12-01",
    })
    _add(db, "invoices", _inv(CO_A, "inv-paid", status="draft"))
    prev = _use(db, monkeypatch)
    try:
        assert _run(server._invoice_finance_block(_row(db, "invoices", CO_A, DISP))) is None
        blocked = _run(server._invoice_finance_block(_row(db, "invoices", CO_A, "inv-paid")))
        assert blocked and "Ödenmiş taksit" in blocked
        _run(server._unlink_orders_from_invoice("inv-paid", CO_A))
        before = _digest(db, CO_B)
        _run(server._soft_delete_invoice_doc(_row(db, "invoices", CO_A, DISP), note="Taslak irsaliye"))
        assert _row(db, "invoices", CO_A, DISP) is None
        assert _row(db, "invoices", CO_B, DISP)["invoice_number"] == "IRS-GIZLI"
        assert _row(db, "invoices", CO_B, DISP)["status"] == "draft"
        assert _row(db, "orders", CO_B, "ord-b")["is_invoiced"] is True
        assert _row(db, "orders", CO_B, "ord-b")["invoice_id"] == DISP
        assert _row(db, "orders", CO_B, "ord-b")["tag"] == SECRET_NOTE
        assert _row(db, "orders", CO_A, "ord-a").get("invoice_id") in (None, "")
        assert _row(db, "invoices", CO_B, "sales-b")["dispatch_id"] == DISP
        assert _row(db, "invoices", CO_A, "sales-a").get("dispatch_id") in (None, "")
        assert _row(db, "installments", CO_B, "inst-b")["status"] == "paid"
        assert _row(db, "installments", CO_A, "inst-a") is None
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_cancel_invoice_rolls_back_only_own_links(monkeypatch):
    user = _user()
    db = _DB()
    seen = _patch_notes(monkeypatch)
    _both(db, "contacts", _contact)
    _both(db, "products", _product)

    def incoming(company):
        return _inv(
            company, INV, invoice_type="purchase", e_type="e_invoice", direction="incoming",
            status="approved", effects_applied=True, stock_effects_applied=True, edoc_id=EDOC,
            invoice_number="AL-A" if company == CO_A else "AL-GIZLI",
            gib_status="Gelen" if company == CO_A else SECRET_NOTE,
        )

    _both(db, "invoices", incoming)
    _add(db, "incoming_edocs", {"_id": EDOC, "company_id": CO_B, "status": "gizli-edoc"})
    _add(db, "incoming_edocs", {"_id": EDOC, "company_id": CO_A, "status": "open"})
    for company, bid in ((CO_B, "bank-b"), (CO_A, "bank-a")):
        _add(db, "bank_transactions", {
            "_id": bid, "company_id": company, "related_invoice_id": INV, "contact_id": CONTACT,
            "amount": 7, "type": "inflow", "category": "Tahsilat",
        })
    for company, pid in ((CO_B, "ptx-b"), (CO_A, "ptx-a")):
        _add(db, "partner_transactions", {
            "_id": pid, "company_id": company, "related_invoice_id": INV, "contact_id": CONTACT,
            "amount": 5, "type": "withdrawal",
        })
    for company, iid in ((CO_B, "inst-b"), (CO_A, "inst-a")):
        _add(db, "installments", {
            "_id": iid, "company_id": company, "invoice_id": INV, "status": "pending", "amount": 10,
            "no": 1, "label": SECRET_NOTE if company == CO_B else "1. Taksit", "due_date": "2026-12-01",
        })
    prev = _use(db, monkeypatch)
    try:
        before = _digest(db, CO_B)
        out = _run(server._cancel_invoice_core(INV, {"reason": "iade"}, user))
        _secrets(out)
        assert out["status"] == "success"
        assert _row(db, "invoices", CO_A, INV)["status"] == "cancelled"
        assert _row(db, "invoices", CO_B, INV)["status"] == "approved"
        assert _row(db, "invoices", CO_B, INV)["gib_status"] == SECRET_NOTE
        assert _row(db, "incoming_edocs", CO_A, EDOC)["status"] == "cancelled"
        assert _row(db, "incoming_edocs", CO_B, EDOC)["status"] == "gizli-edoc"
        assert _row(db, "bank_transactions", CO_A, "bank-a").get("related_invoice_id") in (None, "")
        assert _row(db, "bank_transactions", CO_B, "bank-b")["related_invoice_id"] == INV
        assert _row(db, "bank_transactions", CO_B, "bank-b")["category"] == "Tahsilat"
        assert _row(db, "partner_transactions", CO_B, "ptx-b")["related_invoice_id"] == INV
        assert _row(db, "partner_transactions", CO_A, "ptx-a").get("related_invoice_id") in (None, "")
        assert _row(db, "installments", CO_A, "inst-a")["status"] == "cancelled"
        assert _row(db, "installments", CO_B, "inst-b")["status"] == "pending"
        assert "inst-b" not in seen
        assert "inst-a" in seen
        assert _row(db, "products", CO_B, PROD)["stock_quantity"] == SECRET_STOCK
        assert _row(db, "contacts", CO_B, CONTACT)["balance"] == SECRET_STOCK
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_send_invoice_to_gib_patches_own_dispatch_and_effects(monkeypatch):
    user = _user()
    db = _DB()
    _both(db, "contacts", _contact)
    _both(db, "products", _product)
    _add(db, "invoices", _inv(
        CO_B, DISP, invoice_type="dispatch", e_type="e_dispatch", status="draft",
        despatch_plate="GIZLI34", invoice_number="IRS-GIZLI",
    ))
    _add(db, "invoices", _inv(
        CO_A, DISP, invoice_type="dispatch", e_type="e_dispatch", status="draft",
        invoice_number="IRS-A",
    ))
    called = _patch_issue(monkeypatch)
    prev = _use(db, monkeypatch)
    try:
        before = _digest(db, CO_B)
        out = _run(server.send_invoice_to_gib(DISP, {"despatch_plate": "34 ABC 01"}, user=user))
        assert out["message"] == "iletildi"
        assert called[-1][1] == CO_A
        assert _row(db, "invoices", CO_A, DISP).get("despatch_plate")
        assert _row(db, "invoices", CO_B, DISP)["despatch_plate"] == "GIZLI34"
        _add(db, "invoices", _inv(
            CO_B, "inv-in", invoice_type="purchase", e_type="e_invoice", direction="incoming",
            status="draft", effects_applied=False, invoice_number="AL-GIZLI",
        ))
        _add(db, "invoices", _inv(
            CO_A, "inv-in", invoice_type="purchase", e_type="e_invoice", direction="incoming",
            status="draft", effects_applied=False, stock_effects_applied=False,
        ))
        before = _digest(db, CO_B)
        posted = _run(server.send_invoice_to_gib("inv-in", {}, user=user))
        assert posted["message"] == "iletildi"
        assert _row(db, "invoices", CO_A, "inv-in")["effects_applied"] is True
        assert _row(db, "invoices", CO_B, "inv-in")["effects_applied"] is False
        assert _row(db, "products", CO_B, PROD)["stock_quantity"] == SECRET_STOCK
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_set_invoice_item_product_updates_own_card(monkeypatch):
    db = _DB()
    _both(db, "products", _product)
    _add(db, "invoices", _inv(CO_B, INV, items=[{"name": SECRET_NAME, "sku": "SKU-B", "quantity": 1}]))
    _add(db, "invoices", _inv(CO_A, INV, items=[{"name": "KalemA", "sku": "SKU-A", "quantity": 1}]))
    prev = _use(db, monkeypatch)
    try:
        before = _digest(db, CO_B)
        out = _run(server._set_invoice_item_product(_row(db, "invoices", CO_A, INV), 0, PROD))
        assert out["items"][0]["product_id"] == PROD
        assert out["items"][0]["matched_product_name"] == "UrunA"
        assert _row(db, "products", CO_A, PROD)["show_in_b2b"] is False
        assert _row(db, "products", CO_B, PROD)["show_in_b2b"] is True
        assert _row(db, "products", CO_B, PROD)["name"] == SECRET_NAME
        assert _row(db, "invoices", CO_B, INV)["items"][0]["name"] == SECRET_NAME
        assert _row(db, "invoices", CO_A, INV)["items"][0]["product_id"] == PROD
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_accept_and_reject_incoming_stay_on_own_edoc(monkeypatch):
    user = _user()
    db = _DB()
    _both(db, "contacts", _contact)
    _both(db, "products", _product)

    def draft(company):
        return _inv(
            company, "inv-acc", invoice_type="purchase", e_type="e_invoice", direction="incoming",
            status="draft", effects_applied=False, stock_effects_applied=False, edoc_id=EDOC,
            gib_status="Gelen" if company == CO_A else SECRET_NOTE,
        )

    _both(db, "invoices", draft)
    _add(db, "incoming_edocs", {"_id": EDOC, "company_id": CO_B, "status": "gizli-edoc"})
    _add(db, "incoming_edocs", {"_id": EDOC, "company_id": CO_A, "status": "pending"})
    prev = _use(db, monkeypatch)
    try:
        before = _digest(db, CO_B)
        accepted = _run(server.accept_incoming_invoice("inv-acc", user=user))
        _secrets(accepted)
        assert accepted["status"] == "success"
        assert _row(db, "invoices", CO_A, "inv-acc")["gib_response"] == "accepted"
        assert _row(db, "invoices", CO_B, "inv-acc")["gib_status"] == SECRET_NOTE
        assert _row(db, "incoming_edocs", CO_A, EDOC)["status"] == "approved"
        assert _row(db, "incoming_edocs", CO_B, EDOC)["status"] == "gizli-edoc"
        assert _row(db, "products", CO_B, PROD)["stock_quantity"] == SECRET_STOCK
        assert _digest(db, CO_B) == before

        def approved(company):
            return _inv(
                company, "inv-rej", invoice_type="purchase", e_type="e_invoice", direction="incoming",
                status="approved", effects_applied=True, stock_effects_applied=True, edoc_id="edoc-rej",
                gib_status="Gelen" if company == CO_A else SECRET_NOTE, paid_amount=0,
            )

        _both(db, "invoices", approved)
        _add(db, "incoming_edocs", {"_id": "edoc-rej", "company_id": CO_B, "status": "gizli-edoc"})
        _add(db, "incoming_edocs", {"_id": "edoc-rej", "company_id": CO_A, "status": "open"})
        before = _digest(db, CO_B)
        rejected = _run(server.reject_incoming_invoice("inv-rej", {"reason": "uyusmadi"}, user=user))
        _secrets(rejected)
        assert _row(db, "invoices", CO_A, "inv-rej")["status"] == "cancelled"
        assert _row(db, "invoices", CO_A, "inv-rej")["gib_response"] == "rejected"
        assert _row(db, "invoices", CO_B, "inv-rej")["status"] == "approved"
        assert _row(db, "incoming_edocs", CO_A, "edoc-rej")["status"] == "rejected"
        assert _row(db, "incoming_edocs", CO_B, "edoc-rej")["status"] == "gizli-edoc"
        assert _row(db, "products", CO_B, PROD)["stock_quantity"] == SECRET_STOCK
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_installments_and_promissory_stay_on_own_company(monkeypatch):
    user = _user()
    db = _DB()
    seen = _patch_notes(monkeypatch)
    _both(db, "contacts", lambda company: _contact(company, balance=100 if company == CO_A else SECRET_STOCK))
    _add(db, "installments", {
        "_id": "inst-direct-a", "company_id": CO_B, "invoice_id": INV, "status": "pending",
        "amount": SECRET_STOCK, "no": 1, "label": SECRET_NOTE, "due_date": "2026-12-01",
    })
    _add(db, "installments", {
        "_id": "inst-direct-b", "company_id": CO_B, "invoice_id": INV, "status": "pending",
        "amount": 11, "no": 2, "label": "B-diger", "due_date": "2026-12-02",
    })
    _add(db, "installments", {
        "_id": "inst-direct-a", "company_id": CO_A, "invoice_id": INV, "status": "pending",
        "amount": 10, "no": 1, "label": "1. Taksit", "due_date": "2026-12-01",
    })
    _add(db, "installments", {
        "_id": "bal-b", "company_id": CO_B, "invoice_id": None, "contact_id": CONTACT,
        "status": "pending", "amount": SECRET_STOCK, "no": 1, "label": SECRET_NOTE, "due_date": "2026-12-01",
    })
    _add(db, "installments", {
        "_id": "bal-a", "company_id": CO_A, "invoice_id": None, "contact_id": CONTACT,
        "status": "pending", "amount": 20, "no": 1, "label": "Bakiye", "due_date": "2026-12-01",
    })
    _add(db, "invoices", _inv(CO_B, INV, installment_plan="gizli-plan"))
    _add(db, "invoices", _inv(CO_A, INV, grand_total=100))
    _add(db, "installments", {
        "_id": "paid-b", "company_id": CO_B, "invoice_id": INV, "status": "paid",
        "amount": SECRET_STOCK, "no": 9, "label": SECRET_NOTE, "due_date": "2026-01-01",
    })
    prev = _use(db, monkeypatch)
    try:
        before = _digest(db, CO_B)
        _run(server._cancel_promissory_for_query({"invoice_id": INV, "company_id": CO_A}))
        assert "inst-direct-a" in seen
        assert "inst-direct-b" not in seen
        assert "paid-b" not in seen
        attached = _run(server._attach_promissory(
            [_row(db, "installments", CO_A, "inst-direct-a")],
            {"create_promissory": True},
        ))
        labels = [row.get("label") for row in attached["installments"]]
        assert "1. Taksit" in labels
        assert SECRET_NOTE not in labels
        _run(server.create_contact_balance_installments(
            CONTACT, {"count": 1, "first_due_date": "2026-11-01", "total": 100}, user=user,
        ))
        assert "bal-a" in seen
        assert "bal-b" not in seen
        assert _row(db, "installments", CO_B, "bal-b")["label"] == SECRET_NOTE
        listed = _run(server.list_invoice_installments(INV, user=user))
        _secrets(listed)
        assert [row["label"] for row in listed] == ["1. Taksit"]
        created = _run(server.create_invoice_installments(
            INV, {"count": 2, "first_due_date": "2026-11-01"}, user=user,
        ))
        _secrets(created)
        assert created
        assert all(row.get("company_id") == CO_A for row in created)
        assert _row(db, "installments", CO_B, "paid-b")["status"] == "paid"
        assert _row(db, "invoices", CO_B, INV)["installment_plan"] == "gizli-plan"
        assert _row(db, "invoices", CO_A, INV).get("installment_plan")
        deleted = _run(server.delete_invoice_installments(INV, user=user))
        assert deleted["status"] == "success"
        assert _row(db, "installments", CO_B, "paid-b")["status"] == "paid"
        assert _row(db, "invoices", CO_B, INV)["installment_plan"] == "gizli-plan"
        assert "installment_plan" not in _row(db, "invoices", CO_A, INV)
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_pay_installment_reads_own_remaining(monkeypatch):
    user = _user()
    db = _DB()
    _add(db, "installments", {
        "_id": INST, "company_id": CO_B, "amount": SECRET_STOCK, "paid_amount": 0,
        "status": "pending", "label": SECRET_NOTE, "due_date": "2026-12-01", "no": 1,
    })
    _add(db, "installments", {
        "_id": INST, "company_id": CO_A, "amount": 100, "paid_amount": 0,
        "status": "pending", "label": "1. Taksit", "due_date": "2026-12-01", "no": 1,
    })

    async def acquire(*args, **kwargs):
        return {"action": "proceed", "claimed_at": "t0"}

    async def release(*args, **kwargs):
        return None

    monkeypatch.setattr(pay_claim, "acquire_pay_claim", acquire)
    monkeypatch.setattr(pay_claim, "release_pay_claim", release)
    prev = _use(db, monkeypatch)
    try:
        before = _digest(db, CO_B)
        err = _raises(400, lambda: server.pay_installment(INST, {"amount": 99999}, _request(), user=user))
        assert "4242" not in str(err.detail)
        assert "100" in str(err.detail)
        assert _row(db, "installments", CO_B, INST)["amount"] == SECRET_STOCK
        assert _row(db, "installments", CO_A, INST)["paid_amount"] == 0
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_other_company_record_is_404(monkeypatch):
    user = _user()
    db = _DB()
    _add(db, "products", _product(CO_B))
    _add(db, "invoices", _inv(CO_B, INV, status="approved", order_id=ORDER))
    _add(db, "invoices", _inv(CO_B, DISP, invoice_type="dispatch", e_type="e_dispatch", status="draft"))
    _add(db, "installments", {
        "_id": INST, "company_id": CO_B, "amount": SECRET_STOCK, "paid_amount": 0, "status": "pending",
        "due_date": "2026-12-01", "no": 1,
    })
    prev = _use(db, monkeypatch)
    try:
        before = _digest(db, CO_B)
        calls = (
            lambda: server.update_product_images(PROD, {"images": ["x.jpg"]}, user=user),
            lambda: server.update_product_variants(
                PROD, server.VariantsUpdateRequest(variants=[ProductVariant(name="M", sku="S", stock=1, price=1)]), user=user,
            ),
            lambda: server.create_dispatch_from_invoice(INV, user=user),
            lambda: server.copy_invoice(INV, {"mode": "same_contact"}, user=user),
            lambda: server.convert_dispatch_to_invoice(DISP, {}, user=user),
            lambda: server.approve_invoice(INV, user=user),
            lambda: server.update_invoice(INV, {"due_date": "2026-02-02"}, user=user),
            lambda: server.send_invoice_to_gib(INV, {}, user=user),
            lambda: server.accept_incoming_invoice(INV, user=user),
            lambda: server.reject_incoming_invoice(INV, {}, user=user),
            lambda: server.list_invoice_installments(INV, user=user),
            lambda: server.create_invoice_installments(INV, {"count": 1}, user=user),
            lambda: server.delete_invoice_installments(INV, user=user),
            lambda: server.pay_installment(INST, {"amount": 1}, _request(), user=user),
        )
        for call in calls:
            _raises(404, call)
        assert _row(db, "products", CO_B, PROD)["stock_quantity"] == SECRET_STOCK
        assert _row(db, "invoices", CO_B, INV)["invoice_number"] == "TA-GIZLI"
        assert _row(db, "installments", CO_B, INST)["amount"] == SECRET_STOCK
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_wave25_baseline_keys_removed():
    base = allowlist.TENANT_SCOPE_BASELINE
    present = [key for key in _REMOVED if key in base]
    assert present == []
    assert len(_REMOVED) == 68
    assert len(_REMOVED) == len(set(_REMOVED))
    assert all(key[0] == "server.py" for key in _REMOVED)
    assert sum(1 for key in base if key[0] == "server.py") <= 415 - len(_REMOVED)
    script = _BACKEND / "scripts" / "tenant_scope_baseline.py"
    proc = subprocess.run(
        [sys.executable, str(script), "--check"],
        cwd=str(_BACKEND.parent),
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "temiz" in proc.stdout
