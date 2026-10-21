"""Sipariş, pazaryeri ve webhook kiracı dalgası 26.

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

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import server  # noqa: E402
import tenant_scope_allowlist as allowlist  # noqa: E402
from dashboard_memdb import MemColl, MemDB  # noqa: E402
from mysql_store import match_query  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
OID = "ord-shared"
SECRET_NAME = "MusteriB-Gizli"
SECRET_NOTE = "NotB-Gizli"
SECRET_KEY = "ApiKeyB-Gizli"
SECRET_PRICE = 4242

_REMOVED = (
    ("server.py", "_consume_expected_settlement", "bank_transactions", "find"),
    ("server.py", "_consume_expected_settlement", "bank_transactions", "update_one"),
    ("server.py", "_enrich_marketplace_claims", "invoices", "find_one"),
    ("server.py", "_enrich_orders_invoice_ebelge", "invoices", "find"),
    ("server.py", "_enrich_orders_production_flags", "recipes", "find"),
    ("server.py", "_ensure_marketplace_contact", "contacts", "insert_one"),
    ("server.py", "_ensure_order_contact", "contacts", "find_one"),
    ("server.py", "_ensure_order_contact", "contacts", "insert_one"),
    ("server.py", "_ensure_order_contact", "orders", "update_one"),
    ("server.py", "_list_orders_filtered", "orders", "delete_many"),
    ("server.py", "_mark_sales_order_sent_to_production", "orders", "update_one"),
    ("server.py", "_persist", "orders", "update_one"),
    ("server.py", "_process_wa_webhook", "whatsapp_settings", "find_one"),
    ("server.py", "_push_order_to_shopphp", "invoices", "find_one"),
    ("server.py", "_push_order_to_shopphp", "orders", "update_one"),
    ("server.py", "_push_trendyol_approve", "orders", "update_one"),
    ("server.py", "_push_trendyol_cargo", "orders", "update_one"),
    ("server.py", "_run_bank_auto_sync_tick", "bank_connections", "find"),
    ("server.py", "_shopphp_refresh_cached_prices", "marketplace_product_cache", "update_one"),
    ("server.py", "_sync_draft_invoice_items", "invoices", "find_one"),
    ("server.py", "_sync_draft_invoice_items", "invoices", "update_one"),
    ("server.py", "_sync_draft_order_items", "orders", "find_one"),
    ("server.py", "_sync_draft_order_items", "orders", "update_one"),
    ("server.py", "_sync_ecommerce_channel_core", "integration_configs", "find_one"),
    ("server.py", "_sync_ecommerce_channel_core", "integration_configs", "update_one"),
    ("server.py", "_update_bonus_core", "bonus_payments", "find_one"),
    ("server.py", "_update_bonus_core", "bonus_payments", "update_one"),
    ("server.py", "_update_bonus_core", "bonus_payments", "update_one_atomic"),
    ("server.py", "_upsert_marketplace_orders", "orders", "insert_one"),
    ("server.py", "_upsert_marketplace_orders", "orders", "update_one"),
    ("server.py", "add_ecommerce_channel", "integration_configs", "find_one"),
    ("server.py", "answer_marketplace_question", "marketplace_questions", "find_one"),
    ("server.py", "answer_marketplace_question", "marketplace_questions", "update_one"),
    ("server.py", "approve_order", "orders", "find_one"),
    ("server.py", "approve_order", "orders", "update_one"),
    ("server.py", "create_product_from_marketplace", "products", "find_one"),
    ("server.py", "create_product_from_marketplace", "products", "insert_one"),
    ("server.py", "expense_slip_for_marketplace_claim", "invoices", "find_one"),
    ("server.py", "expense_slip_for_marketplace_claim", "marketplace_claims", "update_one"),
    ("server.py", "marketplace_push_logs", "marketplace_push_logs", "update_one"),
    ("server.py", "marketplace_push_price_stock", "marketplace_product_cache", "update_one"),
    ("server.py", "match_order_item_product", "orders", "update_one"),
    ("server.py", "match_order_item_product", "products", "update_one"),
    ("server.py", "remove_ecommerce_channel", "integration_configs", "delete_one"),
    ("server.py", "return_order", "orders", "find_one"),
    ("server.py", "return_order", "orders", "update_one"),
    ("server.py", "return_order", "products", "update_one"),
    ("server.py", "return_order", "stock_movements", "insert_one"),
    ("server.py", "set_channel_settlement_account", "integration_configs", "update_one"),
    ("server.py", "set_shopphp_rest_credentials", "integration_configs", "update_one"),
    ("server.py", "test_ecommerce_connection", "integration_configs", "update_one"),
    ("server.py", "update_ecommerce_integration", "integration_configs", "find_one"),
    ("server.py", "update_ecommerce_integration", "integration_configs", "update_one"),
    ("server.py", "update_order", "invoices", "find_one"),
    ("server.py", "update_order", "orders", "find_one"),
    ("server.py", "update_order", "orders", "update_one"),
    ("server.py", "update_order", "warehouses", "find_one"),
    ("server.py", "update_order_cargo_carrier", "orders", "find_one"),
    ("server.py", "update_order_cargo_carrier", "orders", "update_one"),
    ("server.py", "wa_webhook_verify", "whatsapp_settings", "find_one"),
)

_TENANT_OK = (
    "oturumsuz Meta webhook doğrulaması",
    "oturumsuz Meta webhook; phone_number_id",
    "kanal _id'si (collection, id) birincil anahtarıdır",
    "arka plan pazaryeri senkronu oturumsuz",
    "zamanlayıcı auto_sync açık tüm şirketlerin banka bağlantılarını tarar",
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
        query = query or {}
        for index, doc in enumerate(self.docs):
            if match_query(doc, query):
                del self.docs[index]
                return type("R", (), {"deleted_count": 1})()
        return type("R", (), {"deleted_count": 0})()

    async def delete_many(self, query=None):
        query = query or {}
        kept = []
        deleted = 0
        for doc in self.docs:
            if match_query(doc, query):
                deleted += 1
            else:
                kept.append(doc)
        self.docs[:] = kept
        return type("R", (), {"deleted_count": deleted})()

    async def update_one_atomic(self, query, update, upsert=False):
        return await self.update_one(query, update, upsert=upsert)


class _DB(MemDB):
    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = _Coll(name, self)
            self._cols[name] = coll
        return coll


class _Req:
    def __init__(self, **params):
        self.query_params = params


class _Ty:
    def __init__(self, cfg):
        self.cfg = cfg

    async def orders(self, **kwargs):
        return []

    async def update_price_inventory(self, items):
        return {"batchRequestId": "batch-1"}

    async def batch_status(self, bid):
        return {"status": "COMPLETED", "itemCount": 1, "items": []}

    async def set_package_status(self, pkg, status, lines):
        return {"ok": True}

    async def update_cargo_provider(self, pkg, provider):
        return {"ok": True}

    async def answer(self, qid, text):
        return {"ok": True}

    async def close(self):
        return None


class _TyExpired(_Ty):
    async def answer(self, qid, text):
        raise HTTPException(status_code=400, detail=server.marketplace_providers.TY_QNA_TIME_LIMIT_KEY)


class _Shop:
    async def set_order_status(self, order_no, status):
        return {"ok": True}

    async def update_order(self, *args, **kwargs):
        return {"ok": True}

    async def close(self):
        return None


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
    prev = server.db
    server.db = db
    return prev


def _restore(prev):
    server.db = prev


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


def _rows(db, coll, company_id):
    return [doc for doc in db[coll].docs if doc.get("company_id") == company_id]


def _item(**extra):
    row = {
        "product_name": "Kalem",
        "name": "Kalem",
        "quantity": 1,
        "unit_price": 10,
        "vat_rate": 20,
        "unit": "Adet",
        "sku": "SKU1",
    }
    row.update(extra)
    return row


def _order(company_id, doc_id=OID, **extra):
    row = {
        "_id": doc_id,
        "company_id": company_id,
        "order_number": "SIP-A" if company_id == CO_A else "SIP-B",
        "channel": "manual",
        "customer_name": "MusteriA" if company_id == CO_A else SECRET_NAME,
        "order_status": "pending",
        "items": [_item()],
        "order_date": "2026-01-01T00:00:00+00:00",
        "total_amount": 10,
    }
    row.update(extra)
    return row


def _cfg(company_id, doc_id="ch-shared", **extra):
    row = {
        "_id": doc_id,
        "company_id": company_id,
        "channel": "trendyol",
        "channel_name": "Trendyol",
        "is_active": True,
        "status": "live" if company_id == CO_B else "not_configured",
        "api_key": SECRET_KEY if company_id == CO_B else "key-a",
        "api_secret": "secret-b" if company_id == CO_B else "secret-a",
        "supplier_id": "9" if company_id == CO_B else "1",
    }
    row.update(extra)
    return row


@pytest.fixture
def iso(monkeypatch):
    database = _DB()
    prev = _bind(database)

    async def _allow(*_args, **_kwargs):
        return None

    monkeypatch.setattr(server.saas, "check_contact_limit", _allow)
    monkeypatch.setattr(server.saas, "check_product_limit", _allow)
    monkeypatch.setattr(server.tenant_access, "get_tenant_doc", _own)
    try:
        yield database
    finally:
        _restore(prev)


def test_match_order_item_product_stays_in_company(iso):
    db = iso
    _add(db, "products", {"_id": "prod-1", "company_id": CO_B, "name": SECRET_NAME, "sku": "SKU-B", "barcode": "BCB"})
    _add(db, "products", {"_id": "prod-1", "company_id": CO_A, "name": "UrunA", "sku": "SKU-A", "barcode": "BCA"})
    _add(db, "orders", _order(CO_B, items=[_item(product_name=SECRET_NAME)]))
    _add(db, "orders", _order(CO_A, items=[_item(barcode="BCA")]))
    before = _digest(db, CO_B)
    out = _run(server.match_order_item_product(OID, {"idx": 0, "product_id": "prod-1"}, user=_user(CO_A)))
    assert out["product"]["name"] == "UrunA"
    assert _row(db, "orders", CO_A, OID)["items"][0]["product_id"] == "prod-1"
    assert _row(db, "orders", CO_A, OID)["items"][0]["matched_product_name"] == "UrunA"
    assert SECRET_NAME not in json.dumps(_row(db, "products", CO_A, "prod-1").get("marketplace_aliases"))
    assert _row(db, "orders", CO_B, OID)["items"][0]["product_name"] == SECRET_NAME
    assert _digest(db, CO_B) == before


def test_match_order_item_product_other_company_404(iso):
    db = iso
    _add(db, "orders", _order(CO_B))
    _add(db, "products", {"_id": "prod-1", "company_id": CO_B, "name": SECRET_NAME, "sku": "SKU-B"})
    before = _digest(db, CO_B)
    with pytest.raises(HTTPException) as exc:
        _run(server.match_order_item_product(OID, {"idx": 0, "product_id": "prod-1"}, user=_user(CO_A)))
    assert exc.value.status_code == 404
    assert _digest(db, CO_B) == before


def test_update_order_warehouse_stays_in_company(iso):
    db = iso
    _add(db, "warehouses", {"_id": "wh-1", "company_id": CO_B, "name": SECRET_NAME})
    _add(db, "warehouses", {"_id": "wh-1", "company_id": CO_A, "name": "DepoA"})
    _add(db, "orders", _order(CO_B, warehouse_name=SECRET_NAME))
    _add(db, "orders", _order(CO_A))
    before = _digest(db, CO_B)
    out = _run(server.update_order(OID, {"warehouse_id": "wh-1"}, user=_user(CO_A)))
    assert out["order"]["warehouse_name"] == "DepoA"
    assert _row(db, "orders", CO_A, OID)["warehouse_id"] == "wh-1"
    assert _row(db, "orders", CO_B, OID)["warehouse_name"] == SECRET_NAME
    assert _digest(db, CO_B) == before


def test_update_order_other_company_404(iso):
    db = iso
    _add(db, "orders", _order(CO_B, notes=SECRET_NOTE))
    before = _digest(db, CO_B)
    with pytest.raises(HTTPException) as exc:
        _run(server.update_order(OID, {"notes": "yeni"}, user=_user(CO_A)))
    assert exc.value.status_code == 404
    assert _row(db, "orders", CO_B, OID)["notes"] == SECRET_NOTE
    assert _digest(db, CO_B) == before


def test_update_bonus_note_stays_in_company(iso):
    db = iso
    _add(db, "employees", {"_id": "emp-b", "company_id": CO_B, "full_name": SECRET_NAME})
    _add(db, "employees", {"_id": "emp-a", "company_id": CO_A, "full_name": "Ali"})
    _add(db, "bonus_payments", {
        "_id": "bon-1", "company_id": CO_B, "employee_id": "emp-b", "status": "pending",
        "amount": 10, "type": "bonus", "type_label": "Prim", "period": "2026-01", "note": SECRET_NOTE,
    })
    _add(db, "bonus_payments", {
        "_id": "bon-1", "company_id": CO_A, "employee_id": "emp-a", "status": "pending",
        "amount": 10, "type": "bonus", "type_label": "Prim", "period": "2026-01", "note": "eski",
    })
    before = _digest(db, CO_B)
    out = _run(server._update_bonus_core("bon-1", {"note": "guncel"}, _user(CO_A)))
    assert out["note"] == "guncel"
    assert _row(db, "bonus_payments", CO_A, "bon-1")["note"] == "guncel"
    assert _row(db, "bonus_payments", CO_B, "bon-1")["note"] == SECRET_NOTE
    assert _digest(db, CO_B) == before


def test_update_bonus_pay_stays_in_company(iso, monkeypatch):
    db = iso

    async def _bal(*_args, **_kwargs):
        return 0

    monkeypatch.setattr(server.account_balance, "recalc_account_balance", _bal)
    _add(db, "employees", {"_id": "emp-b", "company_id": CO_B, "full_name": SECRET_NAME})
    _add(db, "employees", {"_id": "emp-a", "company_id": CO_A, "full_name": "Ali"})
    _add(db, "bank_accounts", {"_id": "acc-1", "company_id": CO_B, "account_name": SECRET_NAME, "type": "cash", "current_balance": SECRET_PRICE})
    _add(db, "bank_accounts", {"_id": "acc-1", "company_id": CO_A, "account_name": "KasaA", "type": "cash", "current_balance": 100})
    _add(db, "bonus_payments", {
        "_id": "bon-1", "company_id": CO_B, "employee_id": "emp-b", "status": "pending",
        "amount": 10, "type": "bonus", "type_label": "Prim", "period": "2026-01", "note": SECRET_NOTE,
    })
    _add(db, "bonus_payments", {
        "_id": "bon-1", "company_id": CO_A, "employee_id": "emp-a", "status": "pending",
        "amount": 10, "type": "bonus", "type_label": "Prim", "period": "2026-01", "note": "eski",
    })
    before = _digest(db, CO_B)
    out = _run(server._update_bonus_core("bon-1", {"account_id": "acc-1"}, _user(CO_A)))
    assert out["status"] == "paid"
    assert _row(db, "bonus_payments", CO_A, "bon-1")["status"] == "paid"
    assert _row(db, "bonus_payments", CO_B, "bon-1")["status"] == "pending"
    assert _row(db, "bank_accounts", CO_B, "acc-1")["current_balance"] == SECRET_PRICE
    assert _digest(db, CO_B) == before


def test_sync_draft_invoice_items_stays_in_company(iso):
    db = iso
    _add(db, "invoices", {"_id": "inv-1", "company_id": CO_B, "status": "draft", "items": [_item(name=SECRET_NAME)], "invoice_number": SECRET_NOTE})
    _add(db, "invoices", {"_id": "inv-1", "company_id": CO_A, "status": "draft", "items": [_item()], "invoice_number": "TA-A"})
    order = _order(CO_A, invoice_id="inv-1", is_invoiced=False)
    before = _digest(db, CO_B)
    _run(server._sync_draft_invoice_items(order, [_item(name="KalemYeni", product_name="KalemYeni", quantity=2, unit_price=15)]))
    names = [it.get("name") or it.get("product_name") for it in _row(db, "invoices", CO_A, "inv-1")["items"]]
    assert "KalemYeni" in names
    assert _row(db, "invoices", CO_B, "inv-1")["invoice_number"] == SECRET_NOTE
    assert _digest(db, CO_B) == before


def test_sync_draft_order_items_stays_in_company(iso):
    db = iso
    _add(db, "orders", _order(CO_B, customer_name=SECRET_NAME, invoice_id="inv-1"))
    _add(db, "orders", _order(CO_A, invoice_id="inv-1", is_invoiced=False))
    invoice = {"_id": "inv-1", "company_id": CO_A, "status": "draft", "order_id": OID, "invoice_number": "TA-A"}
    before = _digest(db, CO_B)
    _run(server._sync_draft_order_items(invoice, [_item(name="KalemYeni", product_name="KalemYeni", quantity=2, unit_price=15, total=30)]))
    names = [it.get("product_name") for it in _row(db, "orders", CO_A, OID)["items"]]
    assert "KalemYeni" in names
    assert _row(db, "orders", CO_B, OID)["customer_name"] == SECRET_NAME
    assert _digest(db, CO_B) == before


def test_approve_order_stays_in_company(iso, monkeypatch):
    db = iso

    async def _no_draft(*_args, **_kwargs):
        return None

    monkeypatch.setattr(server, "_create_draft_invoice_for_order", _no_draft)
    _add(db, "orders", _order(CO_B, order_status="pending"))
    _add(db, "orders", _order(CO_A, channel="manual"))
    before = _digest(db, CO_B)
    out = _run(server.approve_order(OID, {}, user=_user(CO_A)))
    assert out["order_status"] == "approved"
    assert _row(db, "orders", CO_A, OID)["order_status"] == "approved"
    assert _row(db, "orders", CO_B, OID)["order_status"] == "pending"
    assert _digest(db, CO_B) == before


def test_approve_order_other_company_404(iso):
    db = iso
    _add(db, "orders", _order(CO_B))
    before = _digest(db, CO_B)
    with pytest.raises(HTTPException) as exc:
        _run(server.approve_order(OID, {}, user=_user(CO_A)))
    assert exc.value.status_code == 404
    assert _digest(db, CO_B) == before


def test_update_order_cargo_carrier_stays_in_company(iso):
    db = iso
    _add(db, "orders", _order(CO_B, cargo_carrier="gizli"))
    _add(db, "orders", _order(CO_A, channel="manual"))
    before = _digest(db, CO_B)
    out = _run(server.update_order_cargo_carrier(OID, {"cargo_carrier": "yurtici"}, user=_user(CO_A)))
    assert out["cargo_carrier"] == "yurtici"
    assert _row(db, "orders", CO_A, OID)["cargo_carrier"] == "yurtici"
    assert _row(db, "orders", CO_B, OID)["cargo_carrier"] == "gizli"
    assert _digest(db, CO_B) == before


def test_return_order_restock_stays_in_company(iso):
    db = iso
    _add(db, "products", {"_id": "prod-1", "company_id": CO_B, "name": SECRET_NAME, "stock_quantity": SECRET_PRICE})
    _add(db, "products", {"_id": "prod-1", "company_id": CO_A, "name": "UrunA", "stock_quantity": 3})
    _add(db, "orders", _order(CO_B, items=[_item(product_id="prod-1")]))
    _add(db, "orders", _order(CO_A, channel="manual", items=[_item(product_id="prod-1", quantity=2)]))
    before = _digest(db, CO_B)
    out = _run(server.return_order(OID, {"restock": True}, user=_user(CO_A)))
    assert out["status"] == "success"
    assert _row(db, "orders", CO_A, OID)["order_status"] == "returned"
    assert _row(db, "products", CO_A, "prod-1")["stock_quantity"] == 5
    assert _row(db, "orders", CO_B, OID)["order_status"] == "pending"
    assert _row(db, "products", CO_B, "prod-1")["stock_quantity"] == SECRET_PRICE
    moves = _rows(db, "stock_movements", CO_A)
    assert len(moves) == 1 and moves[0]["company_id"] == CO_A
    assert _digest(db, CO_B) == before


def test_return_order_other_company_404(iso):
    db = iso
    _add(db, "orders", _order(CO_B))
    _add(db, "products", {"_id": "prod-1", "company_id": CO_B, "name": SECRET_NAME, "stock_quantity": SECRET_PRICE})
    before = _digest(db, CO_B)
    with pytest.raises(HTTPException) as exc:
        _run(server.return_order(OID, {"restock": True}, user=_user(CO_A)))
    assert exc.value.status_code == 404
    assert _digest(db, CO_B) == before


def test_wa_webhook_verify_uses_token_not_other_company(iso):
    db = iso
    _add(db, "whatsapp_settings", {"_id": "wa-1", "company_id": CO_B, "verify_token": "tok-b", "challenge_note": SECRET_NOTE})
    _add(db, "whatsapp_settings", {"_id": "wa-1", "company_id": CO_A, "verify_token": "tok-a"})
    before = _digest(db, CO_B)
    res = _run(server.wa_webhook_verify(_Req(**{"hub.mode": "subscribe", "hub.verify_token": "tok-a", "hub.challenge": "ch-a"})))
    assert res.body == b"ch-a"
    assert _digest(db, CO_B) == before
    with pytest.raises(HTTPException) as exc:
        _run(server.wa_webhook_verify(_Req(**{"hub.mode": "subscribe", "hub.verify_token": "yok", "hub.challenge": "x"})))
    assert exc.value.status_code == 403
    assert _digest(db, CO_B) == before


def test_process_wa_webhook_writes_matched_company(iso):
    db = iso
    _add(db, "whatsapp_settings", {"_id": "wa-1", "company_id": CO_B, "phone_number_id": "pn-b", "note": SECRET_NOTE})
    _add(db, "whatsapp_settings", {"_id": "wa-1", "company_id": CO_A, "phone_number_id": "pn-a"})
    payload = {"entry": [{"changes": [{"value": {
        "metadata": {"phone_number_id": "pn-a"},
        "messages": [{"from": "905551112233", "id": "m1", "type": "text", "text": {"body": "merhaba"}}],
        "contacts": [],
    }}]}]}
    before = _digest(db, CO_B)
    out = _run(server._process_wa_webhook(payload))
    assert out["saved"] == 1
    logs = _rows(db, "whatsapp_logs", CO_A)
    assert len(logs) == 1 and logs[0]["company_id"] == CO_A
    assert _rows(db, "whatsapp_logs", CO_B) == []
    assert _digest(db, CO_B) == before


def test_update_ecommerce_integration_stays_in_company(iso):
    db = iso
    _add(db, "integration_configs", _cfg(CO_B, status="live"))
    _add(db, "integration_configs", _cfg(CO_A, status="not_configured"))
    before = _digest(db, CO_B)
    out = _run(server.update_ecommerce_integration("ch-shared", {"status": "paused"}, user=_user(CO_A)))
    assert out["status"] == "paused"
    assert _row(db, "integration_configs", CO_A, "ch-shared")["status"] == "paused"
    assert _row(db, "integration_configs", CO_B, "ch-shared")["status"] == "live"
    assert _row(db, "integration_configs", CO_B, "ch-shared")["api_key"] == SECRET_KEY
    assert _digest(db, CO_B) == before


def test_upsert_marketplace_orders_updates_own_row(iso):
    db = iso
    _add(db, "orders", _order(
        CO_B, channel="trendyol", order_number="TY-100", customer_name=SECRET_NAME,
        contact_id="cnt-b", invoice_id="inv-b", is_invoiced=True,
    ))
    _add(db, "orders", _order(
        CO_A, channel="trendyol", order_number="TY-100", customer_name="Eski",
        contact_id="cnt-a", invoice_id="inv-a", is_invoiced=True,
    ))
    before = _digest(db, CO_B)
    incoming = {
        "channel": "trendyol",
        "order_number": "TY-100",
        "customer_name": "YeniA",
        "items": [_item()],
        "total_amount": 10,
        "order_status": "approved",
    }
    out = _run(server._upsert_marketplace_orders(CO_A, [incoming]))
    assert out["updated"] == 1
    assert _row(db, "orders", CO_A, OID)["customer_name"] == "YeniA"
    assert _row(db, "orders", CO_B, OID)["customer_name"] == SECRET_NAME
    assert _digest(db, CO_B) == before


def test_upsert_marketplace_orders_inserts_own_company(iso, monkeypatch):
    db = iso

    async def _none(*_args, **_kwargs):
        return None

    monkeypatch.setattr(server, "_ensure_order_contact", _none)
    monkeypatch.setattr(server, "_attach_draft_invoice_on_intake", _none)
    monkeypatch.setattr(server, "_try_shopphp_settlement", _none)
    _add(db, "orders", _order(CO_B, channel="trendyol", order_number="TY-200", customer_name=SECRET_NAME))
    before = _digest(db, CO_B)
    incoming = {
        "channel": "trendyol",
        "order_number": "TY-200",
        "customer_name": "YeniA",
        "items": [_item()],
        "total_amount": 10,
        "order_status": "approved",
    }
    out = _run(server._upsert_marketplace_orders(CO_A, [incoming]))
    assert out["inserted"] == 1
    created = _rows(db, "orders", CO_A)
    assert len(created) == 1 and created[0]["customer_name"] == "YeniA"
    assert created[0]["company_id"] == CO_A
    assert _row(db, "orders", CO_B, OID)["customer_name"] == SECRET_NAME
    assert _digest(db, CO_B) == before


def test_ensure_order_contact_stays_in_company(iso):
    db = iso
    _add(db, "orders", _order(CO_B, customer_name=SECRET_NAME))
    _add(db, "orders", _order(CO_A, customer_name="MusteriA"))
    _add(db, "contacts", {"_id": "cnt-b", "company_id": CO_B, "name": SECRET_NAME, "type": "customer"})
    before = _digest(db, CO_B)
    out = _run(server._ensure_order_contact(_row(db, "orders", CO_A, OID)))
    assert out["company_id"] == CO_A
    assert out["name"] == "MusteriA"
    assert _row(db, "orders", CO_A, OID)["contact_id"] == out["_id"]
    assert _row(db, "orders", CO_B, OID).get("contact_id") in (None, "")
    assert _row(db, "contacts", CO_B, "cnt-b")["name"] == SECRET_NAME
    assert _digest(db, CO_B) == before


def test_set_shopphp_rest_credentials_stays_in_company(iso):
    db = iso
    _add(db, "integration_configs", _cfg(CO_B, channel="shopphp", rest_email="b@secret.example"))
    _add(db, "integration_configs", _cfg(CO_A, channel="shopphp", rest_email="old@a.example"))
    before = _digest(db, CO_B)
    out = _run(server.set_shopphp_rest_credentials("ch-shared", {"rest_email": "yeni@a.example", "rest_auto_push": True}, user=_user(CO_A)))
    assert out["rest_email"] == "yeni@a.example"
    assert _row(db, "integration_configs", CO_A, "ch-shared")["rest_email"] == "yeni@a.example"
    assert _row(db, "integration_configs", CO_B, "ch-shared")["rest_email"] == "b@secret.example"
    assert _digest(db, CO_B) == before


def test_push_trendyol_approve_stays_in_company(iso, monkeypatch):
    db = iso
    monkeypatch.setattr(server.marketplace_providers, "TrendyolClient", _Ty)
    _add(db, "integration_configs", _cfg(CO_A))
    _add(db, "orders", _order(CO_B, channel="trendyol", marketplace_status="Created"))
    order = _order(CO_A, channel="trendyol", shipment_package_id="pkg-1", items=[_item(line_id="ln-1")])
    _add(db, "orders", order)
    before = _digest(db, CO_B)
    out = _run(server._push_trendyol_approve(order))
    assert out["ok"] is True
    assert _row(db, "orders", CO_A, OID)["marketplace_status"] == "Picking"
    assert _row(db, "orders", CO_B, OID)["marketplace_status"] == "Created"
    assert _digest(db, CO_B) == before


def test_push_trendyol_cargo_stays_in_company(iso, monkeypatch):
    db = iso
    monkeypatch.setattr(server.marketplace_providers, "TrendyolClient", _Ty)
    _add(db, "integration_configs", _cfg(CO_A))
    _add(db, "orders", _order(CO_B, channel="trendyol", cargo_carrier="gizli"))
    order = _order(CO_A, channel="trendyol", shipment_package_id="pkg-1", cargo_carrier="yurtici")
    _add(db, "orders", order)
    before = _digest(db, CO_B)
    out = _run(server._push_trendyol_cargo(order))
    assert out["ok"] is True
    assert _row(db, "orders", CO_A, OID).get("marketplace_push", {}).get("reason") == "cargo"
    assert _row(db, "orders", CO_B, OID)["cargo_carrier"] == "gizli"
    assert _digest(db, CO_B) == before


def test_push_order_to_shopphp_stays_in_company(iso, monkeypatch):
    db = iso
    monkeypatch.setattr(server, "_shopphp_rest_client", lambda cfg: _Shop())
    _add(db, "integration_configs", _cfg(CO_A, channel="shopphp", rest_email="a@a.example", rest_password_enc="enc", rest_auto_push=True))
    _add(db, "invoices", {"_id": "inv-1", "company_id": CO_B, "invoice_number": SECRET_NOTE})
    _add(db, "invoices", {"_id": "inv-1", "company_id": CO_A, "invoice_number": "TA-A"})
    _add(db, "orders", _order(CO_B, channel="shopphp", invoice_id="inv-1"))
    order = _order(CO_A, channel="shopphp", order_status="approved", invoice_id="inv-1", cargo_carrier="yurtici", cargo_tracking_number="TRK1")
    _add(db, "orders", order)
    before = _digest(db, CO_B)
    log = _run(server._push_order_to_shopphp(order, reason="manual"))
    assert log["ok"] is True
    assert log["sent"]["faturaNo"] == "TA-A"
    assert _row(db, "orders", CO_A, OID)["shopphp_push"]["ok"] is True
    assert _row(db, "orders", CO_B, OID).get("shopphp_push") is None
    assert _row(db, "invoices", CO_B, "inv-1")["invoice_number"] == SECRET_NOTE
    assert _digest(db, CO_B) == before


def test_set_channel_settlement_account_stays_in_company(iso):
    db = iso
    _add(db, "bank_accounts", {"_id": "acc-1", "company_id": CO_B, "account_name": SECRET_NAME, "type": "cash"})
    _add(db, "bank_accounts", {"_id": "acc-1", "company_id": CO_A, "account_name": "KasaA", "type": "cash"})
    _add(db, "integration_configs", _cfg(CO_B, settlement_account_name=SECRET_NAME))
    _add(db, "integration_configs", _cfg(CO_A))
    before = _digest(db, CO_B)
    out = _run(server.set_channel_settlement_account("ch-shared", {"account_id": "acc-1"}, user=_user(CO_A)))
    assert out["settlement_account_name"] == "KasaA"
    assert _row(db, "integration_configs", CO_A, "ch-shared")["settlement_account_id"] == "acc-1"
    assert _row(db, "integration_configs", CO_B, "ch-shared")["settlement_account_name"] == SECRET_NAME
    assert _digest(db, CO_B) == before


def test_ensure_marketplace_contact_inserts_own_company(iso):
    db = iso
    _add(db, "contacts", {"_id": "cnt-b", "company_id": CO_B, "name": SECRET_NAME, "source": "marketplace:trendyol", "category": "Pazaryeri"})
    before = _digest(db, CO_B)
    out = _run(server._ensure_marketplace_contact(CO_A, "trendyol"))
    assert out["company_id"] == CO_A
    assert out["source"] == "marketplace:trendyol"
    assert _row(db, "contacts", CO_B, "cnt-b")["name"] == SECRET_NAME
    assert len(_rows(db, "contacts", CO_A)) == 1
    assert _digest(db, CO_B) == before


def test_consume_expected_settlement_stays_in_company(iso):
    db = iso
    for company, label in ((CO_B, SECRET_NOTE), (CO_A, "bekleyen-a")):
        _add(db, "bank_transactions", {
            "_id": "exp-1", "company_id": company, "account_id": "acc-1", "type": "inflow",
            "amount": 100, "source": "marketplace_settlement_expected", "match_status": "expected",
            "contact_name": label, "order_id": "ord-x",
        })
        _add(db, "bank_transactions", {
            "_id": "tx-1", "company_id": company, "account_id": "acc-1", "type": "inflow",
            "amount": 100, "match_status": "unmatched", "description": label,
        })
    before = _digest(db, CO_B)
    tx = copy.deepcopy(_row(db, "bank_transactions", CO_A, "tx-1"))
    assert _run(server._consume_expected_settlement(tx)) is True
    assert _row(db, "bank_transactions", CO_A, "exp-1")["match_status"] == "matched"
    assert _row(db, "bank_transactions", CO_A, "tx-1")["matched_via"] == "marketplace_settlement"
    assert _row(db, "bank_transactions", CO_B, "exp-1")["match_status"] == "expected"
    assert _row(db, "bank_transactions", CO_B, "tx-1").get("matched_via") is None
    assert _digest(db, CO_B) == before


def test_test_ecommerce_connection_stays_in_company(iso, monkeypatch):
    db = iso
    monkeypatch.setattr(server.marketplace_providers, "TrendyolClient", _Ty)
    _add(db, "integration_configs", _cfg(CO_B, status="error", last_error=SECRET_NOTE))
    _add(db, "integration_configs", _cfg(CO_A, status="not_configured"))
    before = _digest(db, CO_B)
    out = _run(server.test_ecommerce_connection("ch-shared", user=_user(CO_A)))
    assert out["status"] == "success"
    assert _row(db, "integration_configs", CO_A, "ch-shared")["status"] == "connected"
    assert _row(db, "integration_configs", CO_B, "ch-shared")["status"] == "error"
    assert _row(db, "integration_configs", CO_B, "ch-shared")["last_error"] == SECRET_NOTE
    assert _digest(db, CO_B) == before


def test_add_ecommerce_channel_shopphp_id_collision(iso):
    db = iso
    _add(db, "integration_configs", {
        "_id": "ecom_shopphp", "company_id": CO_B, "channel": "shopphp",
        "channel_name": "ShopPHP", "api_key": SECRET_KEY, "status": "live",
    })
    before = _digest(db, CO_B)
    out = _run(server.add_ecommerce_channel({"company_id": CO_A, "channel": "shopphp"}, user=_user(CO_A)))
    created = out["channel"]
    assert created["id"] != "ecom_shopphp"
    assert created["company_id"] == CO_A
    assert SECRET_KEY not in json.dumps(out)
    stored = _rows(db, "integration_configs", CO_A)
    assert len(stored) == 1 and stored[0]["_id"] != "ecom_shopphp"
    assert _row(db, "integration_configs", CO_B, "ecom_shopphp")["api_key"] == SECRET_KEY
    assert _digest(db, CO_B) == before


def test_remove_ecommerce_channel_stays_in_company(iso):
    db = iso
    _add(db, "integration_configs", _cfg(CO_B, channel="hepsiburada", channel_name="Hepsiburada"))
    _add(db, "integration_configs", _cfg(CO_A, channel="hepsiburada", channel_name="Hepsiburada"))
    before = _digest(db, CO_B)
    out = _run(server.remove_ecommerce_channel("ch-shared", user=_user(CO_A)))
    assert out["status"] == "success"
    assert _row(db, "integration_configs", CO_A, "ch-shared") is None
    assert _row(db, "integration_configs", CO_B, "ch-shared")["api_key"] == SECRET_KEY
    assert _digest(db, CO_B) == before


def test_sync_ecommerce_channel_core_user_stays_in_company(iso, monkeypatch):
    db = iso
    seen = {}

    async def _fake_upsert(company_id, docs):
        seen["company_id"] = company_id
        seen["count"] = len(docs)
        return {"inserted": 0, "updated": 0, "inserted_orders": []}

    async def _noop(*_args, **_kwargs):
        return None

    monkeypatch.setattr(server, "_upsert_marketplace_orders", _fake_upsert)
    monkeypatch.setattr(server, "_notify_marketplace_inserted", _noop)
    _add(db, "integration_configs", _cfg(CO_B, channel="hepsiburada", api_key="", api_secret="", supplier_id="", status="live"))
    _add(db, "integration_configs", _cfg(CO_A, channel="hepsiburada", api_key="", api_secret="", supplier_id="", status="not_configured"))
    before = _digest(db, CO_B)
    out = _run(server._sync_ecommerce_channel_core("ch-shared", user=_user(CO_A)))
    assert out["status"] == "success"
    assert seen["company_id"] == CO_A
    assert _row(db, "integration_configs", CO_A, "ch-shared").get("last_synced_at")
    assert _row(db, "integration_configs", CO_B, "ch-shared")["status"] == "live"
    assert _row(db, "integration_configs", CO_B, "ch-shared").get("last_synced_at") is None
    assert _digest(db, CO_B) == before


def test_sync_ecommerce_channel_core_background_uses_loaded_company(iso, monkeypatch):
    db = iso
    seen = {}

    async def _fake_upsert(company_id, docs):
        seen["company_id"] = company_id
        return {"inserted": 0, "updated": 0, "inserted_orders": []}

    async def _noop(*_args, **_kwargs):
        return None

    monkeypatch.setattr(server, "_upsert_marketplace_orders", _fake_upsert)
    monkeypatch.setattr(server, "_notify_marketplace_inserted", _noop)
    _add(db, "integration_configs", _cfg(CO_A, channel="hepsiburada", api_key="", api_secret="", supplier_id="", status="not_configured"))
    _add(db, "integration_configs", _cfg(CO_B, channel="hepsiburada", api_key="", api_secret="", supplier_id="", status="live"))
    before_b = _digest(db, CO_B)
    out = _run(server._sync_ecommerce_channel_core("ch-shared", user=None))
    assert out["status"] == "success"
    assert seen["company_id"] == CO_A
    assert _row(db, "integration_configs", CO_A, "ch-shared").get("last_synced_at")
    assert _row(db, "integration_configs", CO_B, "ch-shared").get("last_synced_at") is None
    assert _digest(db, CO_B) == before_b


def test_run_bank_auto_sync_tick_scans_without_cross_write(iso, monkeypatch):
    db = iso
    seen = []

    async def _core(conn_id):
        seen.append(conn_id)
        return None

    monkeypatch.setattr(server, "_sync_bank_connection_core", _core)
    monkeypatch.setattr("bank_auto_sync.should_background_sync", lambda conn: True)
    _add(db, "bank_connections", {"_id": "bc-b", "company_id": CO_B, "auto_sync": True, "note": SECRET_NOTE})
    _add(db, "bank_connections", {"_id": "bc-a", "company_id": CO_A, "auto_sync": True})
    before_b = _digest(db, CO_B)
    before_a = _digest(db, CO_A)
    _run(server._run_bank_auto_sync_tick())
    assert seen == ["bc-b", "bc-a"]
    assert _digest(db, CO_B) == before_b
    assert _digest(db, CO_A) == before_a


def test_shopphp_refresh_cached_prices_stays_in_company(iso):
    db = iso
    _add(db, "marketplace_product_cache", {"_id": "cache-1", "company_id": CO_B, "channel": "shopphp", "items": [{"barcode": "BC1", "sale_price": SECRET_PRICE}]})
    _add(db, "marketplace_product_cache", {"_id": "cache-1", "company_id": CO_A, "channel": "shopphp", "items": [{"barcode": "BC1", "sale_price": 10}]})
    before = _digest(db, CO_B)
    _run(server._shopphp_refresh_cached_prices(CO_A, [{"barcode": "BC1", "fiyat": 42}]))
    assert _row(db, "marketplace_product_cache", CO_A, "cache-1")["items"][0]["sale_price"] == 42
    assert _row(db, "marketplace_product_cache", CO_B, "cache-1")["items"][0]["sale_price"] == SECRET_PRICE
    assert _digest(db, CO_B) == before


def test_marketplace_push_price_stock_stays_in_company(iso, monkeypatch):
    db = iso
    monkeypatch.setattr(server.marketplace_providers, "TrendyolClient", _Ty)
    _add(db, "integration_configs", _cfg(CO_A))
    _add(db, "marketplace_product_cache", {"_id": "cache-1", "company_id": CO_B, "channel": "trendyol", "items": [{"barcode": "BC1", "sale_price": SECRET_PRICE}]})
    _add(db, "marketplace_product_cache", {"_id": "cache-1", "company_id": CO_A, "channel": "trendyol", "items": [{"barcode": "BC1", "sale_price": 10}]})
    before = _digest(db, CO_B)
    out = _run(server.marketplace_push_price_stock(
        {"company_id": CO_A, "channel": "trendyol", "items": [{"barcode": "BC1", "sale_price": 42, "quantity": 3}]},
        user=_user(CO_A),
    ))
    assert out["sent"] == 1
    assert _row(db, "marketplace_product_cache", CO_A, "cache-1")["items"][0]["sale_price"] == 42
    assert _row(db, "marketplace_product_cache", CO_B, "cache-1")["items"][0]["sale_price"] == SECRET_PRICE
    assert _digest(db, CO_B) == before


def test_marketplace_push_logs_stays_in_company(iso, monkeypatch):
    db = iso
    monkeypatch.setattr(server.marketplace_providers, "TrendyolClient", _Ty)
    _add(db, "integration_configs", _cfg(CO_A))
    _add(db, "marketplace_push_logs", {
        "_id": "log-1", "company_id": CO_B, "channel": "trendyol", "items": [{"barcode": "BC1"}],
        "batch_request_id": "batch-b", "created_at": "2026-01-02T00:00:00+00:00", "status": "SENT",
    })
    _add(db, "marketplace_push_logs", {
        "_id": "log-1", "company_id": CO_A, "channel": "trendyol", "items": [{"barcode": "BC1"}],
        "batch_request_id": "batch-a", "created_at": "2026-01-02T00:00:00+00:00", "status": "SENT",
    })
    before = _digest(db, CO_B)
    out = _run(server.marketplace_push_logs(company_id=CO_A, channel="trendyol", check=True, user=_user(CO_A)))
    assert out[0]["status"] == "COMPLETED"
    assert _row(db, "marketplace_push_logs", CO_A, "log-1")["status"] == "COMPLETED"
    assert _row(db, "marketplace_push_logs", CO_B, "log-1")["status"] == "SENT"
    assert _digest(db, CO_B) == before


def test_create_product_from_marketplace_same_barcode(iso):
    db = iso
    _add(db, "products", {"_id": "prod-b", "company_id": CO_B, "name": SECRET_NAME, "sku": "SKU-B", "barcode": "BC-SHARED", "stock_quantity": SECRET_PRICE})
    before = _digest(db, CO_B)
    out = _run(server.create_product_from_marketplace(
        {"company_id": CO_A, "product_name": "YeniA", "barcode": "BC-SHARED", "sku": "SKU-A", "channel": "trendyol"},
        user=_user(CO_A),
    ))
    assert out["product"]["name"] == "YeniA"
    assert out["product"]["company_id"] == CO_A
    created = _rows(db, "products", CO_A)
    assert len(created) == 1 and created[0]["barcode"] == "BC-SHARED"
    assert _row(db, "products", CO_B, "prod-b")["name"] == SECRET_NAME
    assert _digest(db, CO_B) == before


def test_enrich_marketplace_claims_invoice_stays_in_company(iso):
    db = iso
    _add(db, "invoices", {
        "_id": "inv-1", "company_id": CO_B, "status": "approved", "e_type": "e_invoice",
        "invoice_type": "sales", "expense_slip_id": "slip-b", "expense_slip_number": SECRET_NOTE,
        "contact_id": "c", "items": [_item()], "invoice_number": SECRET_NOTE,
    })
    _add(db, "invoices", {
        "_id": "inv-1", "company_id": CO_A, "status": "approved", "e_type": "e_archive",
        "invoice_type": "sales", "contact_id": "c", "items": [_item()], "invoice_number": "TA-A",
    })
    _add(db, "orders", _order(CO_B, channel="trendyol", order_number="TY-1", invoice_id="inv-1"))
    _add(db, "orders", _order(CO_A, channel="trendyol", order_number="TY-1", invoice_id="inv-1"))
    claim = {
        "_id": "claim-1", "company_id": CO_A, "channel": "trendyol", "order_number": "TY-1",
        "status": "WaitingInAction", "cargo_arrived": True,
    }
    before = _digest(db, CO_B)
    out = _run(server._enrich_marketplace_claims([claim]))
    assert out[0]["invoice_id"] == "inv-1"
    assert out[0].get("expense_slip_id") in (None, "")
    assert out[0].get("expense_slip_number") in (None, "")
    assert _row(db, "invoices", CO_B, "inv-1")["expense_slip_number"] == SECRET_NOTE
    assert _digest(db, CO_B) == before


def test_expense_slip_existing_stays_in_company(iso):
    db = iso
    _add(db, "invoices", {"_id": "slip-1", "company_id": CO_B, "status": "approved", "invoice_number": SECRET_NOTE})
    _add(db, "invoices", {"_id": "slip-1", "company_id": CO_A, "status": "approved", "invoice_number": "GP-A"})
    _add(db, "marketplace_claims", {"_id": "claim-1", "company_id": CO_B, "expense_slip_id": "slip-1", "status": "Accepted", "cargo_arrived": True})
    _add(db, "marketplace_claims", {"_id": "claim-1", "company_id": CO_A, "expense_slip_id": "slip-1", "status": "Accepted", "cargo_arrived": True, "channel": "trendyol"})
    before = _digest(db, CO_B)
    out = _run(server.expense_slip_for_marketplace_claim("claim-1", user=_user(CO_A)))
    assert out["status"] == "exists"
    assert out["invoice"]["invoice_number"] == "GP-A"
    assert _digest(db, CO_B) == before


def test_expense_slip_update_stays_in_company(iso, monkeypatch):
    db = iso

    async def _core(inv_id, user):
        assert inv_id == "inv-1"
        return {"invoice": {"id": "slip-new", "invoice_number": "GP-YENI"}, "status": "success"}

    monkeypatch.setattr(server, "_create_expense_slip_from_invoice_core", _core)
    _add(db, "orders", _order(CO_A, channel="trendyol", order_number="TY-9", invoice_id="inv-1"))
    _add(db, "marketplace_claims", {
        "_id": "claim-1", "company_id": CO_B, "channel": "trendyol", "order_number": "TY-9",
        "status": "WaitingInAction", "cargo_arrived": True, "note": SECRET_NOTE,
    })
    _add(db, "marketplace_claims", {
        "_id": "claim-1", "company_id": CO_A, "channel": "trendyol", "order_number": "TY-9",
        "status": "WaitingInAction", "cargo_arrived": True,
    })
    before = _digest(db, CO_B)
    out = _run(server.expense_slip_for_marketplace_claim("claim-1", user=_user(CO_A)))
    assert out["status"] == "success"
    assert _row(db, "marketplace_claims", CO_A, "claim-1")["expense_slip_id"] == "slip-new"
    assert _row(db, "marketplace_claims", CO_B, "claim-1").get("expense_slip_id") is None
    assert _row(db, "marketplace_claims", CO_B, "claim-1")["note"] == SECRET_NOTE
    assert _digest(db, CO_B) == before


def test_answer_marketplace_question_stays_in_company(iso):
    db = iso
    _add(db, "marketplace_questions", {
        "_id": "q-1", "company_id": CO_B, "channel": "trendyol", "status": "WAITING_FOR_ANSWER",
        "answer": SECRET_NOTE,
    })
    _add(db, "marketplace_questions", {
        "_id": "q-1", "company_id": CO_A, "channel": "manual", "status": "WAITING_FOR_ANSWER",
    })
    before = _digest(db, CO_B)
    text = "Bu yanit on karakterden uzun."
    out = _run(server.answer_marketplace_question("q-1", {"text": text}, user=_user(CO_A)))
    assert out["answer"] == text
    assert out["status"] == "ANSWERED"
    assert _row(db, "marketplace_questions", CO_B, "q-1")["answer"] == SECRET_NOTE
    assert _row(db, "marketplace_questions", CO_B, "q-1")["status"] == "WAITING_FOR_ANSWER"
    assert _digest(db, CO_B) == before


def test_answer_marketplace_question_time_limit_stays_in_company(iso, monkeypatch):
    db = iso
    monkeypatch.setattr(server.marketplace_providers, "TrendyolClient", _TyExpired)
    _add(db, "integration_configs", _cfg(CO_A))
    _add(db, "marketplace_questions", {
        "_id": "q-1", "company_id": CO_B, "channel": "trendyol", "status": "WAITING_FOR_ANSWER",
        "external_id": "ext-b", "answer": SECRET_NOTE,
    })
    _add(db, "marketplace_questions", {
        "_id": "q-1", "company_id": CO_A, "channel": "trendyol", "status": "WAITING_FOR_ANSWER",
        "external_id": "ext-a",
    })
    before = _digest(db, CO_B)
    with pytest.raises(HTTPException) as exc:
        _run(server.answer_marketplace_question("q-1", {"text": "Bu yanit on karakterden uzun."}, user=_user(CO_A)))
    assert exc.value.status_code == 400
    assert _row(db, "marketplace_questions", CO_A, "q-1")["status"] == "ANSWER_EXPIRED"
    assert _row(db, "marketplace_questions", CO_B, "q-1")["status"] == "WAITING_FOR_ANSWER"
    assert _row(db, "marketplace_questions", CO_B, "q-1")["answer"] == SECRET_NOTE
    assert _digest(db, CO_B) == before


def test_persist_stock_match_stays_in_company(iso):
    db = iso
    _add(db, "products", {"_id": "prod-b", "company_id": CO_B, "name": SECRET_NAME, "barcode": "BC1", "sku": "SKU-B"})
    _add(db, "products", {"_id": "prod-a", "company_id": CO_A, "name": "UrunA", "barcode": "BC1", "sku": "SKU-A"})
    _add(db, "orders", _order(CO_B, channel="trendyol", items=[_item(barcode="BC1", product_name=SECRET_NAME)]))
    _add(db, "orders", _order(CO_A, channel="trendyol", items=[_item(barcode="BC1", product_name="Kalem")]))
    before = _digest(db, CO_B)

    async def _go():
        docs = [copy.deepcopy(_row(db, "orders", CO_A, OID))]
        out = await server._enrich_orders_stock_matches(docs, company_id=CO_A)
        await asyncio.sleep(0)
        return out

    out = _run(_go())
    assert out[0]["items"][0]["product_id"] == "prod-a"
    assert _row(db, "orders", CO_A, OID)["items"][0]["product_id"] == "prod-a"
    assert _row(db, "orders", CO_B, OID)["items"][0].get("product_id") in (None, "")
    assert _row(db, "orders", CO_B, OID)["items"][0]["product_name"] == SECRET_NAME
    assert _digest(db, CO_B) == before


def test_list_orders_filtered_dedupe_stays_in_company(iso):
    db = iso
    _add(db, "orders", _order(CO_B, doc_id="ord-drop", channel="trendyol", order_number="TY-DUP", customer_name=SECRET_NAME))
    _add(db, "orders", _order(CO_A, doc_id="ord-keep", channel="trendyol", order_number="TY-DUP", invoice_id="inv-a", is_invoiced=True))
    _add(db, "orders", _order(CO_A, doc_id="ord-drop", channel="trendyol", order_number="TY-DUP"))
    before = _digest(db, CO_B)
    _run(server._list_orders_filtered(
        CO_A, None, True, None, None, None, None, None, None, None, None, None, 1, 50, False, None,
    ))
    assert _row(db, "orders", CO_A, "ord-keep") is not None
    assert _row(db, "orders", CO_A, "ord-drop") is None
    assert _row(db, "orders", CO_B, "ord-drop")["customer_name"] == SECRET_NAME
    assert _digest(db, CO_B) == before


def test_enrich_orders_invoice_ebelge_stays_in_company(iso):
    db = iso
    _add(db, "invoices", {
        "_id": "inv-1", "company_id": CO_B, "e_type": "gizli_ebelge", "einvoice_state": SECRET_NOTE,
        "invoice_number": SECRET_NOTE, "grand_total": SECRET_PRICE,
    })
    _add(db, "invoices", {
        "_id": "inv-1", "company_id": CO_A, "e_type": "e_archive", "einvoice_state": "draft",
        "invoice_number": "TA-A", "grand_total": 10,
    })
    before = _digest(db, CO_B)
    docs = [_order(CO_A, invoice_id="inv-1")]
    out = _run(server._enrich_orders_invoice_ebelge(docs))
    assert out[0].get("invoice_e_type") == "e_archive"
    assert out[0].get("e_type") == "e_archive"
    assert SECRET_NOTE not in json.dumps(out[0])
    assert _row(db, "invoices", CO_B, "inv-1")["e_type"] == "gizli_ebelge"
    assert _digest(db, CO_B) == before


def test_enrich_orders_production_flags_stays_in_company(iso):
    db = iso
    _add(db, "recipes", {"_id": "rcp-b", "company_id": CO_B, "sales_order_id": OID, "is_active": True, "name": SECRET_NAME})
    _add(db, "recipes", {"_id": "rcp-a", "company_id": CO_A, "sales_order_id": OID, "is_active": True, "name": "ReceteA"})
    before = _digest(db, CO_B)
    docs = [_order(CO_A)]
    out = _run(server._enrich_orders_production_flags(docs, company_id=CO_A))
    assert out[0]["has_production_order"] is True
    assert out[0]["production_recipe_id"] == "rcp-a"
    assert _row(db, "recipes", CO_B, "rcp-b")["name"] == SECRET_NAME
    assert _digest(db, CO_B) == before


def test_mark_sales_order_sent_to_production_stays_in_company(iso):
    db = iso
    _add(db, "orders", _order(CO_B))
    _add(db, "orders", _order(CO_A))
    before = _digest(db, CO_B)
    _run(server._mark_sales_order_sent_to_production(OID, recipe_id="rcp-a", company_id=CO_A))
    assert _row(db, "orders", CO_A, OID).get("sent_to_production_at")
    assert _row(db, "orders", CO_A, OID)["production_recipe_id"] == "rcp-a"
    assert _row(db, "orders", CO_B, OID).get("sent_to_production_at") is None
    assert _digest(db, CO_B) == before


def test_wave26_tenant_ok_comments():
    text = (_BACKEND / "server.py").read_text(encoding="utf-8")
    for snippet in _TENANT_OK:
        assert snippet in text


def test_wave26_baseline_keys_removed():
    base = allowlist.TENANT_SCOPE_BASELINE
    present = [key for key in _REMOVED if key in base]
    assert present == []
    assert len(_REMOVED) == len(set(_REMOVED))
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
