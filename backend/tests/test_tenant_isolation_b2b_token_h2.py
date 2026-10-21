"""B2B portal token sorguları kiracı company_id ile sınırlı.

Bellek içi MemDB. Canlı veritabanına, 8021 portuna ve ağa bağlanmaz.
Tutar ve şirket kimliği loglanmaz.
"""
from __future__ import annotations

import asyncio
import copy
import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import addons  # noqa: E402
import auth_utils  # noqa: E402
import server  # noqa: E402
import trash  # noqa: E402
import tenant_scope_allowlist as allowlist  # noqa: E402
from mysql_store import apply_update, match_query, new_upsert_doc, sort_docs  # noqa: E402

CO_A = "co-a"
CO_B = "co-b"
TOK_A = "tok-a-b2b-h2"
TOK_B = "tok-b-b2b-h2"
SECRET_TRACK = "GIZLI-TAKIP-B"
SECRET_STEP = "GizliAdimB"
SECRET_PRODUCT = "GizliUrunB"

_REMOVED = (
    ("server.py", "_create_b2b_order_core", "orders", "find_one"),
    ("server.py", "_create_b2b_order_core", "orders", "insert_one"),
    ("server.py", "_enrich_b2b_orders_production", "production_orders", "find"),
    ("server.py", "_enrich_b2b_orders_production", "recipes", "find"),
    ("server.py", "_enrich_b2b_orders_production", "work_orders", "find"),
    ("server.py", "_link_existing_b2b_order", "orders", "find_one"),
    ("server.py", "b2b_cancel_request", "orders", "find_one"),
    ("server.py", "b2b_cancel_request", "orders", "update_one"),
    ("server.py", "b2b_card_payment_status", "contacts", "find_one"),
    ("server.py", "b2b_card_payment_status", "payment_intents", "find_one"),
    ("server.py", "b2b_change_password", "contacts", "update_one"),
    ("server.py", "b2b_delete_order", "invoices", "find_one"),
    ("server.py", "b2b_edit_order", "orders", "find_one"),
    ("server.py", "b2b_edit_order", "orders", "update_one"),
    ("server.py", "b2b_portal", "cargo_shipments", "find"),
    ("server.py", "b2b_portal", "installments", "find"),
    ("server.py", "b2b_upsert_active_cart", "orders", "update_one"),
    ("server.py", "finalize_b2b_order_payment", "contacts", "find_one"),
    ("server.py", "finalize_b2b_order_payment", "orders", "find_one"),
    ("server.py", "finalize_b2b_order_payment", "payment_intents", "find_one"),
)


def _run(coro):
    return asyncio.run(coro)


class MemCursor:
    def __init__(self, docs):
        self._docs = docs
        self._sort = None
        self._limit = None

    def sort(self, key, direction=1):
        self._sort = [(key, direction)] if isinstance(key, str) else list(key)
        return self

    def limit(self, n):
        self._limit = int(n)
        return self

    async def to_list(self, length=None):
        rows = sort_docs(list(self._docs), self._sort) if self._sort else list(self._docs)
        cap = self._limit
        if length is not None:
            cap = int(length) if cap is None else min(cap, int(length))
        if cap is not None:
            rows = rows[:cap]
        return copy.deepcopy(rows)


class MemColl:
    def __init__(self):
        self.docs = []
        self.queries = []

    def _rows(self, query):
        return [d for d in self.docs if match_query(d, query or {})]

    def find(self, query=None, projection=None):
        self.queries.append(copy.deepcopy(query or {}))
        return MemCursor(self._rows(query))

    async def find_one(self, query=None, projection=None):
        self.queries.append(copy.deepcopy(query or {}))
        rows = self._rows(query or {})
        return copy.deepcopy(rows[0]) if rows else None

    async def insert_one(self, doc):
        if any(d.get("_id") == doc.get("_id") for d in self.docs):
            raise RuntimeError("duplicate")
        self.docs.append(copy.deepcopy(doc))
        return SimpleNamespace(inserted_id=doc.get("_id"))

    async def count_documents(self, query=None, **kwargs):
        return len(self._rows(query or {}))

    def _replace(self, doc, updated):
        doc.clear()
        doc.update(updated)

    async def update_one(self, query, update, upsert=False):
        self.queries.append(copy.deepcopy(query or {}))
        for doc in self.docs:
            if match_query(doc, query or {}):
                self._replace(doc, apply_update(doc, update or {}, query, is_insert=False))
                return SimpleNamespace(matched_count=1, modified_count=1, upserted_id=None)
        if not upsert:
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)
        created = new_upsert_doc(update or {}, query)
        self.docs.append(copy.deepcopy(created))
        return SimpleNamespace(matched_count=0, modified_count=1, upserted_id=created.get("_id"))

    async def update_many(self, query, update):
        n = 0
        for doc in self.docs:
            if match_query(doc, query or {}):
                self._replace(doc, apply_update(doc, update or {}, query, is_insert=False))
                n += 1
        return SimpleNamespace(matched_count=n, modified_count=n)

    async def delete_one(self, query):
        for i, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                self.docs.pop(i)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def delete_many(self, query):
        kept = [d for d in self.docs if not match_query(d, query or {})]
        deleted = len(self.docs) - len(kept)
        self.docs[:] = kept
        return SimpleNamespace(deleted_count=deleted)


class MemDB:
    def __init__(self):
        self._cols = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = MemColl()
            self._cols[name] = coll
        return coll

    def __getitem__(self, name):
        return getattr(self, name)


def _contact(cid, company, token, name, balance, **extra):
    doc = {
        "_id": cid,
        "company_id": company,
        "name": name,
        "email": f"{cid}@example.com",
        "phone": "555",
        "address": "Adres",
        "city": "İstanbul",
        "balance": balance,
        "b2b_enabled": True,
        "b2b_token": token,
        "is_active": True,
        "b2b_discount": 0,
    }
    doc.update(extra)
    return doc


def _company(cid):
    return {
        "_id": cid,
        "name": cid,
        "b2b_settings": {"enabled": True, "allow_orders": True, "show_statement": True, "show_installments": True},
    }


def _product(pid, company, name="Vida"):
    return {
        "_id": pid,
        "company_id": company,
        "name": name,
        "sku": pid,
        "unit": "Adet",
        "sale_price": 100.0,
        "vat_rate": 20,
        "price_includes_vat": False,
        "stock_quantity": 10,
        "track_stock": True,
        "show_in_b2b": True,
        "type": "goods",
    }


def _order(oid, company, contact, name, status="pending", **extra):
    doc = {
        "_id": oid,
        "company_id": company,
        "contact_id": contact,
        "customer_name": name,
        "order_number": oid,
        "order_status": status,
        "order_date": "2026-10-01T10:00:00+00:00",
        "items": [{"product_id": "p-a", "product_name": "Vida", "quantity": 1, "unit_price": 100, "total": 100}],
        "total_amount": 100,
        "grand_total": 120,
        "channel": "b2b",
    }
    doc.update(extra)
    return doc


def _db():
    db = MemDB()
    db.companies.docs.append(_company(CO_A))
    db.companies.docs.append(_company(CO_B))
    db.contacts.docs.append(_contact("ct-a", CO_A, TOK_A, "Cari A", 500))
    db.contacts.docs.append(_contact("ct-b", CO_B, TOK_B, "Cari B", 800, b2b_password_hash="hash-b"))
    db.products.docs.append(_product("p-a", CO_A))
    db.products.docs.append(_product("p-b", CO_B, "Gizli Urun"))
    return db


def _bind(db):
    prev = server.db
    server.db = db
    trash.init(db)
    return prev


def _restore(prev):
    server.db = prev


def _doc(db, coll, oid):
    return next(row for row in getattr(db, coll).docs if row.get("_id") == oid)


def _blob(value):
    return json.dumps(value, ensure_ascii=False, default=str)


def _b_snapshot(db):
    return {
        "contact": copy.deepcopy(_doc(db, "contacts", "ct-b")),
        "orders": copy.deepcopy([row for row in db.orders.docs if row.get("company_id") == CO_B]),
        "invoices": copy.deepcopy([row for row in db.invoices.docs if row.get("company_id") == CO_B]),
        "installments": copy.deepcopy([row for row in db.installments.docs if row.get("company_id") == CO_B]),
        "shipments": copy.deepcopy([row for row in db.cargo_shipments.docs if row.get("company_id") == CO_B]),
        "intents": copy.deepcopy([row for row in db.payment_intents.docs if row.get("company_id") == CO_B]),
    }


async def _is_off(*_a, **_k):
    return False


def test_portal_hides_other_company_shipment_installment_and_production(monkeypatch):
    db = _db()
    db.orders.docs.append(_order(
        "ord-a", CO_A, "ct-a", "Cari A",
        production_order_id="po-a",
        production_recipe_id="rc-a",
        sent_to_production_at="2026-10-01T00:00:00+00:00",
    ))
    db.orders.docs.append(_order("ord-b", CO_B, "ct-b", "Cari B", production_order_id="po-b"))
    db.cargo_shipments.docs.append({
        "_id": "sh-a", "company_id": CO_A, "order_id": "ord-a",
        "tracking_number": "TAKIP-A", "status": "in_transit", "created_at": "2026-10-02",
    })
    db.cargo_shipments.docs.append({
        "_id": "sh-b", "company_id": CO_B, "order_id": "ord-a",
        "tracking_number": SECRET_TRACK, "status": "in_transit", "created_at": "2026-10-03",
    })
    db.installments.docs.append({
        "_id": "ins-a", "company_id": CO_A, "contact_id": "ct-a",
        "status": "pending", "due_date": "2026-11-01", "amount": 42,
    })
    db.installments.docs.append({
        "_id": "ins-b", "company_id": CO_B, "contact_id": "ct-a",
        "status": "pending", "due_date": "2026-11-02", "amount": 99999,
    })
    db.production_orders.docs.append({
        "_id": "po-a", "company_id": CO_A, "recipe_id": "rc-a", "status": "in_production",
        "finished_product_name": "Raf A", "order_code": "URT-A",
    })
    db.production_orders.docs.append({
        "_id": "po-b", "company_id": CO_B, "recipe_id": "rc-a", "status": "in_production",
        "finished_product_name": SECRET_PRODUCT, "order_code": "URT-B",
    })
    db.recipes.docs.append({
        "_id": "rc-a", "company_id": CO_A, "name": "Recete A",
        "finished_product_name": "Raf A",
        "steps": [{"no": 1, "name": "Kesim", "station": "CNC"}],
    })
    db.recipes.docs.append({
        "_id": "rc-b", "company_id": CO_B, "name": "Recete B",
        "finished_product_name": SECRET_PRODUCT,
        "steps": [{"no": 1, "name": SECRET_STEP, "station": "Gizli"}],
    })
    db.work_orders.docs.append({
        "_id": "wo-a", "company_id": CO_A, "order_id": "po-a",
        "step_no": 1, "step_name": "Kesim", "status": "in_progress",
    })
    db.work_orders.docs.append({
        "_id": "wo-b", "company_id": CO_B, "order_id": "po-a",
        "step_no": 1, "step_name": SECRET_STEP, "status": "in_progress",
    })
    before = _b_snapshot(db)
    monkeypatch.setattr(addons, "is_on", _is_off)
    prev = _bind(db)
    try:
        body = _run(server.b2b_portal(TOK_A))
    finally:
        _restore(prev)
    blob = _blob(body)
    assert SECRET_TRACK not in blob
    assert SECRET_STEP not in blob
    assert SECRET_PRODUCT not in blob
    assert "99999" not in blob
    assert body["contact"]["balance"] == 500
    tracking = [o.get("tracking") or {} for o in body["orders"]]
    assert any((t.get("tracking_number") == "TAKIP-A") for t in tracking)
    assert [row["amount"] for row in body["installments"]] == [42]
    own = next(o for o in body["orders"] if o["id"] == "ord-a")
    assert own["production"]["product_name"] == "Raf A"
    assert _b_snapshot(db) == before


def test_card_payment_status_other_company_is_404(monkeypatch):
    db = _db()
    db.payment_intents.docs.append({
        "_id": "intent-b", "company_id": CO_B, "contact_id": "ct-b",
        "purpose": "b2b_collection", "status": "paid", "amount": "10.00",
        "ledger_amount": "10.00", "installment": 1, "result": {"ok": True},
    })
    db.payment_intents.docs.append({
        "_id": "intent-a", "company_id": CO_A, "contact_id": "ct-a",
        "purpose": "b2b_order", "status": "paid", "amount": "20.00",
        "ledger_amount": "20.00", "installment": 1, "b2b_order_id": "ord-a",
        "order_number": "B2B-A",
    })
    before = _b_snapshot(db)
    prev = _bind(db)
    try:
        with pytest.raises(HTTPException) as caught:
            _run(server.b2b_card_payment_status(TOK_A, "intent-b"))
        own = _run(server.b2b_card_payment_status(TOK_A, "intent-a"))
    finally:
        _restore(prev)
    assert caught.value.status_code == 404
    assert caught.value.detail == "Ödeme bulunamadı."
    assert own["status"] == "paid"
    assert own["balance"] == 500
    assert own["order_number"] == "B2B-A"
    assert _b_snapshot(db) == before


def test_change_password_scopes_company_and_leaves_other_contact():
    db = _db()
    before = _b_snapshot(db)
    prev = _bind(db)
    try:
        result = _run(server.b2b_change_password(TOK_A, {"current_password": "", "new_password": "yeni-sifre"}))
    finally:
        _restore(prev)
    assert result["status"] == "success"
    fresh_a = _doc(db, "contacts", "ct-a")
    assert auth_utils.verify_password("yeni-sifre", fresh_a["b2b_password_hash"])
    assert any(q.get("company_id") == CO_A for q in db.contacts.queries)
    assert _b_snapshot(db) == before
    assert _doc(db, "contacts", "ct-b")["balance"] == 800
    assert _doc(db, "contacts", "ct-b")["b2b_password_hash"] == "hash-b"


def test_active_cart_update_does_not_touch_other_company():
    db = _db()
    db.orders.docs.append(_order(
        "cart-a", CO_A, "ct-a", "Cari A", status="active_cart",
        source="b2b_active_cart", is_active_cart=True, grand_total=10, total_amount=10,
    ))
    db.orders.docs.append(_order(
        "cart-b", CO_B, "ct-b", "Cari B", status="active_cart",
        source="b2b_active_cart", is_active_cart=True, grand_total=77, total_amount=77,
    ))
    before = _b_snapshot(db)
    prev = _bind(db)
    try:
        result = _run(server.b2b_upsert_active_cart(TOK_A, {"items": [{"product_id": "p-a", "quantity": 2}]}))
    finally:
        _restore(prev)
    assert result["status"] == "success"
    assert result["order"]["id"] == "cart-a"
    assert any(q.get("company_id") == CO_A and q.get("contact_id") == "ct-a" for q in db.orders.queries)
    assert _doc(db, "orders", "cart-b")["grand_total"] == 77
    assert _b_snapshot(db) == before


def test_order_write_routes_other_company_are_404():
    db = _db()
    db.orders.docs.append(_order("ord-a", CO_A, "ct-a", "Cari A"))
    db.orders.docs.append(_order("ord-name", CO_A, "baskasi", "Cari A"))
    db.orders.docs.append(_order("ord-b", CO_B, "ct-b", "Cari B", status="approved", grand_total=333, total_amount=333))
    db.orders.docs.append(_order("ord-b-del", CO_B, "ct-b", "Cari B", status="pending"))
    db.invoices.docs.append({
        "_id": "inv-b", "company_id": CO_B, "contact_id": "ct-b",
        "status": "draft", "grand_total": 50, "invoice_number": "TASLAK-B",
    })
    db.orders.docs.append(_order("ord-a-inv", CO_A, "ct-a", "Cari A", invoice_id="inv-b"))
    before = _b_snapshot(db)
    prev = _bind(db)
    try:
        with pytest.raises(HTTPException) as edit_miss:
            _run(server.b2b_edit_order(TOK_A, "ord-b", {"items": [{"product_id": "p-a", "quantity": 1}]}))
        with pytest.raises(HTTPException) as delete_miss:
            _run(server.b2b_delete_order(TOK_A, "ord-b-del"))
        with pytest.raises(HTTPException) as cancel_miss:
            _run(server.b2b_cancel_request(TOK_A, "ord-b", {"reason": "yabanci"}))
        edited = _run(server.b2b_edit_order(TOK_A, "ord-a", {"items": [{"product_id": "p-a", "quantity": 3}], "note": "guncel"}))
        named = _run(server.b2b_edit_order(TOK_A, "ord-name", {"items": [{"product_id": "p-a", "quantity": 1}]}))
        db.orders.docs[:] = [row for row in db.orders.docs]
        approved = _order("ord-ok", CO_A, "ct-a", "Cari A", status="approved")
        db.orders.docs.append(approved)
        cancelled = _run(server.b2b_cancel_request(TOK_A, "ord-ok", {"reason": "vazgectim"}))
        deleted = _run(server.b2b_delete_order(TOK_A, "ord-a-inv"))
    finally:
        _restore(prev)
    assert edit_miss.value.status_code == 404
    assert delete_miss.value.status_code == 404
    assert cancel_miss.value.status_code == 404
    assert edit_miss.value.detail == "Sipariş bulunamadı."
    assert delete_miss.value.detail == "Sipariş bulunamadı."
    assert cancel_miss.value.detail == "Sipariş bulunamadı."
    assert edited["status"] == "success"
    assert edited["order"]["notes"] == "guncel"
    assert named["status"] == "success"
    assert cancelled["order"]["cancel_request"]["status"] == "pending"
    assert cancelled["order"]["cancel_request"]["reason"] == "vazgectim"
    assert deleted["status"] == "success"
    assert _doc(db, "invoices", "inv-b")["status"] == "draft"
    assert _doc(db, "orders", "ord-b")["order_status"] == "approved"
    assert _doc(db, "orders", "ord-b")["grand_total"] == 333
    assert "cancel_request" not in _doc(db, "orders", "ord-b")
    assert _doc(db, "orders", "ord-b-del")["order_status"] == "pending"
    b_now = _b_snapshot(db)
    assert b_now["contact"] == before["contact"]
    assert b_now["orders"] == before["orders"]
    assert b_now["invoices"] == before["invoices"]


def _line():
    return {
        "product_id": "p-a",
        "product_name": "Vida",
        "sku": "p-a",
        "quantity": 1,
        "unit": "Adet",
        "unit_price": 100,
        "vat_rate": 20,
        "discount_rate": 0,
        "total": 100,
        "vat_amount": 20,
        "price_includes_vat": False,
    }


def _draft():
    return {
        "items": [_line()],
        "grand_total": 120.0,
        "note": "",
        "shipping_address": "Adres",
        "city": "İstanbul",
        "customer_order_number": "",
        "legal_accept": {},
    }


def test_finalize_does_not_create_order_when_contact_company_differs(monkeypatch):
    db = _db()
    draft = _draft()
    db.payment_intents.docs.append({
        "_id": "intent-mix",
        "company_id": CO_A,
        "contact_id": "ct-b",
        "purpose": "b2b_order",
        "status": "paid",
        "collection_tx_id": "tx-mix",
        "ledger_amount": "120.00",
        "order_draft": draft,
        "order_draft_hash": server._b2b_order_draft_hash(draft),
    })
    db.orders.docs.append(_order("ord-b", CO_B, "ct-b", "Cari B", grand_total=800, total_amount=800))
    before_orders = copy.deepcopy(db.orders.docs)
    before_contact = copy.deepcopy(_doc(db, "contacts", "ct-b"))

    async def _num(*_a, **_k):
        return "B2B-2026-0009"

    async def _quiet(*_a, **_k):
        return None

    monkeypatch.setattr(server, "_next_order_number", _num)
    monkeypatch.setattr(server, "_notify_company", _quiet)
    monkeypatch.setattr(server, "_attach_draft_invoice_on_intake", _quiet)
    prev = _bind(db)
    try:
        _run(server.finalize_b2b_order_payment("intent-mix"))
    finally:
        _restore(prev)
    assert db.orders.docs == before_orders
    assert _doc(db, "contacts", "ct-b") == before_contact
    assert _doc(db, "contacts", "ct-a")["balance"] == 500
    intent = _doc(db, "payment_intents", "intent-mix")
    assert "b2b_order_id" not in intent


def test_finalize_same_company_creates_order_and_duplicate_stays_in_company(monkeypatch):
    db = _db()
    draft = _draft()
    db.payment_intents.docs.append({
        "_id": "intent-a",
        "company_id": CO_A,
        "contact_id": "ct-a",
        "purpose": "b2b_order",
        "status": "paid",
        "collection_tx_id": "tx-a",
        "ledger_amount": "120.00",
        "order_draft": draft,
        "order_draft_hash": server._b2b_order_draft_hash(draft),
    })
    db.orders.docs.append(_order("b2bord_intent-foreign", CO_B, "ct-b", "Cari B", order_number="B-SECRET"))

    async def _num(*_a, **_k):
        return "B2B-2026-0001"

    async def _quiet(*_a, **_k):
        return None

    monkeypatch.setattr(server, "_next_order_number", _num)
    monkeypatch.setattr(server, "_notify_company", _quiet)
    monkeypatch.setattr(server, "_attach_draft_invoice_on_intake", _quiet)
    prev = _bind(db)
    try:
        _run(server.finalize_b2b_order_payment("intent-a"))
        contact = _doc(db, "contacts", "ct-a")
        with pytest.raises(RuntimeError, match="duplicate"):
            _run(server._create_b2b_order_core(contact, [_line()], _draft(), order_id="b2bord_intent-foreign"))
        same = _order("b2bord_intent-a", CO_A, "ct-a", "Cari A", order_number="B2B-2026-0001")
        # Aynı şirketteki mükerrer kayıt mevcut siparişi döner.
        again = _run(server._create_b2b_order_core(contact, [_line()], _draft(), order_id="b2bord_intent-a"))
    finally:
        _restore(prev)
    sales = [row for row in db.orders.docs if row.get("company_id") == CO_A and row.get("source") == "b2b_portal"]
    assert len(sales) == 1
    assert sales[0]["_id"] == "b2bord_intent-a"
    assert sales[0]["order_number"] == "B2B-2026-0001"
    assert _doc(db, "payment_intents", "intent-a")["b2b_order_id"] == "b2bord_intent-a"
    foreign = _doc(db, "orders", "b2bord_intent-foreign")
    assert foreign["company_id"] == CO_B
    assert foreign["order_number"] == "B-SECRET"
    assert again["order"]["id"] == "b2bord_intent-a"
    assert same["company_id"] == CO_A


def test_b2b_token_baseline_keys_removed():
    base = allowlist.TENANT_SCOPE_BASELINE
    present = [key for key in _REMOVED if key in base]
    assert present == []
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
