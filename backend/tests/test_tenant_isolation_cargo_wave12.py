"""Kargo etiketi, entegrasyon ve gönderi kiracı dalgası 12. Bellek içi MemDB.

Canlı veritabanına, 8021 portuna, ağa ve gerçek kargo sağlayıcısına bağlanmaz.
API anahtarı, parola, alıcı ve etiket içeriği loglanmaz.
"""
from __future__ import annotations

import ast
import asyncio
import copy
import hashlib
import json
import logging
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import server  # noqa: E402
import tenant_scope_allowlist as allowlist  # noqa: E402
from dashboard_memdb import MemColl, MemDB, _split_field_ops  # noqa: E402
from mysql_store import match_query  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
ORDER = "order-shared"
SHIP = "shp-shared"
CFG = "cargo-cfg-shared"
PROD = "prod-shared"
SHIP_B = "shp-b-only"
API_KEY = "ck_live_kargo_anahtar_91"
API_SECRET = "ck_live_kargo_gizli_91"
API_PASSWORD = "ck_live_kargo_parola_91"
LABEL_A = "https://a.example/a.pdf"
LABEL_B = "https://b.example/etiket-b.pdf"
TRACK_B = "TRK-B-KEEP"
MASK = "••••••••"

_REMOVED = (
    ("server.py", "_enrich_order_items_from_products", "products", "find"),
    ("server.py", "_resolve_order_cargo_label", "cargo_shipments", "find_one"),
    ("server.py", "_resolve_order_cargo_label", "cargo_shipments", "update_one"),
    ("server.py", "_resolve_order_cargo_label", "orders", "find_one"),
    ("server.py", "_resolve_order_cargo_label", "orders", "update_one"),
    ("server.py", "add_cargo_integration", "cargo_configs", "insert_one"),
    ("server.py", "cargo_auto_ship", "cargo_auto_runs", "insert_one"),
    ("server.py", "create_cargo_shipment", "cargo_shipments", "insert_one"),
    ("server.py", "create_cargo_shipment", "orders", "find_one"),
    ("server.py", "create_cargo_shipment", "orders", "update_one"),
    ("server.py", "delete_cargo_integration", "cargo_configs", "delete_one"),
    ("server.py", "refresh_cargo_shipment", "cargo_shipments", "find_one"),
    ("server.py", "refresh_cargo_shipment", "cargo_shipments", "update_one"),
    ("server.py", "refresh_cargo_shipment", "orders", "find_one"),
    ("server.py", "refresh_cargo_shipment", "orders", "update_one"),
    ("server.py", "test_cargo_integration", "cargo_configs", "update_one"),
    ("server.py", "update_cargo_integration", "cargo_configs", "find_one"),
    ("server.py", "update_cargo_integration", "cargo_configs", "update_one"),
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
        query = _split_field_ops(query or {})
        for i, doc in enumerate(self.docs):
            if match_query(doc, query):
                del self.docs[i]
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


def _bind(db):
    prev = server.db
    server.db = db
    return prev


def _restore(prev):
    server.db = prev


async def _own(db_arg, collection, doc_id, actor, **kwargs):
    """Aynı _id iki şirkette de varken çağıranın satırını yükle."""
    allowed = {str(item) for item in (actor.get("company_ids") or [])}
    for row in db_arg[collection].docs:
        if str(row.get("_id")) == str(doc_id) and str(row.get("company_id") or "") in allowed:
            return copy.deepcopy(row)
    raise HTTPException(status_code=404, detail=kwargs.get("not_found") or "Kayıt bulunamadı.")


def _order(company_id, **extra):
    doc = {
        "_id": ORDER,
        "company_id": company_id,
        "channel": "shopphp",
        "order_status": "approved",
        "order_number": "SP-" + company_id,
        "customer_name": "Alici " + company_id,
        "customer_phone": "555000",
        "shipping_address": "Adres " + company_id,
        "city": "Ankara",
        "items": [{"product_id": PROD, "product_name": "Ham", "sku": "HAM", "quantity": 1}],
    }
    doc.update(extra)
    return doc


def _seed_shared(db, *, product_b_last=True, order_tracking_b=TRACK_B):
    """Yazım ilk eşleşeni, ürün listesi son eşleşeni vurur; B o konumda durur."""
    _add(db, "cargo_configs", {
        "_id": CFG, "company_id": CO_B, "carrier_code": "geliver", "carrier_name": "Geliver",
        "api_key": API_KEY, "api_secret": API_SECRET, "api_password": API_PASSWORD,
        "status": "connected", "is_active": True, "sender_address_id": "addr-b",
    })
    _add(db, "cargo_configs", {
        "_id": CFG, "company_id": CO_A, "carrier_code": "geliver", "carrier_name": "Geliver",
        "api_key": API_KEY, "api_secret": API_SECRET, "api_password": API_PASSWORD,
        "status": "connected", "is_active": True, "sender_address_id": "addr-a",
    })
    _add(db, "cargo_shipments", {
        "_id": SHIP, "company_id": CO_B, "order_id": ORDER, "carrier_code": "geliver",
        "provider_shipment_id": "glv-b", "tracking_number": TRACK_B, "label_url": LABEL_B, "status": "created",
    })
    _add(db, "cargo_shipments", {
        "_id": SHIP, "company_id": CO_A, "order_id": ORDER, "carrier_code": "geliver",
        "provider_shipment_id": "glv-a", "tracking_number": "TRK-A", "label_url": LABEL_A, "status": "created",
    })
    _add(db, "cargo_shipments", {
        "_id": SHIP_B, "company_id": CO_B, "order_id": ORDER, "carrier_code": "geliver",
        "tracking_number": TRACK_B, "label_url": LABEL_B, "status": "created",
    })
    _add(db, "orders", _order(CO_B, cargo_tracking_number=order_tracking_b, cargo_label_url=LABEL_B, order_status="preparing"))
    _add(db, "orders", _order(CO_A, cargo_shipment_id=SHIP, cargo_label_url="", cargo_tracking_number=None))
    products = [
        {"_id": PROD, "company_id": CO_A, "name": "Urun A", "sku": "SKU-A", "desi": 2, "weight": 0.4},
        {"_id": PROD, "company_id": CO_B, "name": "Urun B", "sku": "SKU-B", "desi": 8, "weight": 3},
    ]
    if not product_b_last:
        products.reverse()
    for row in products:
        _add(db, "products", row)


def _stamp_company(fn_names):
    def tracer(frame, event, arg):
        if event == "line" and frame.f_code.co_name in fn_names:
            locs = frame.f_locals
            for key in ("creds", "packed", "summary", "extra"):
                blob = locs.get(key)
                if isinstance(blob, dict):
                    blob["company_id"] = CO_B
        return tracer
    return tracer


def test_resolve_without_company_writes_nothing():
    db = _DB()
    _seed_shared(db)
    prev = _bind(db)
    try:
        before_a = _digest(db, CO_A)
        before_b = _digest(db, CO_B)
        bare = {"_id": "order-bare", "order_status": "approved", "customer_name": "Eski"}
        _add(db, "orders", bare)
        for empty in ("", None):
            with pytest.raises(HTTPException) as exc:
                _run(server._resolve_order_cargo_label(ORDER, empty))
            assert exc.value.status_code == 404
            assert exc.value.detail == "Sipariş bulunamadı."
        with pytest.raises(HTTPException) as exc:
            _run(server.get_order_cargo_label("order-bare", _user(CO_A)))
        assert exc.value.status_code == 404
        assert exc.value.detail == "Sipariş bulunamadı."
        assert db.orders.docs[-1] == bare
    finally:
        _restore(prev)
    assert _digest(db, CO_A) == before_a
    assert _digest(db, CO_B) == before_b


def test_label_ignores_other_company_shipment(monkeypatch):
    user = _user(CO_A)
    monkeypatch.setattr(server.tenant_access, "get_tenant_doc", _own)

    db = _DB()
    _seed_shared(db)
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        out = _run(server.get_order_cargo_label(ORDER, user))
    finally:
        _restore(prev)
    assert out["label_url"] == LABEL_A
    assert LABEL_B not in json.dumps(out)
    assert TRACK_B not in json.dumps(out)
    assert _digest(db, CO_B) == before

    db = _DB()
    _seed_shared(db)
    for row in db.orders.docs:
        if row.get("company_id") == CO_A:
            row["cargo_shipment_id"] = SHIP_B
            row["cargo_label_url"] = ""
    db.cargo_shipments.docs = [row for row in db.cargo_shipments.docs if row.get("company_id") != CO_A]
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        out = _run(server.get_order_cargo_label(ORDER, user))
    finally:
        _restore(prev)
    assert not out.get("label_url")
    assert LABEL_B not in json.dumps(out)
    assert _doc(db, "cargo_shipments", SHIP_B, CO_B)["label_url"] == LABEL_B
    assert _digest(db, CO_B) == before


def test_refresh_test_update_delete_leave_other_company(monkeypatch, caplog):
    user = _user(CO_A)
    monkeypatch.setattr(server.tenant_access, "get_tenant_doc", _own)
    pushed = []

    async def _push(order, reason="manual", raise_errors=False):
        pushed.append({"company_id": order.get("company_id"), "reason": reason})
        return None

    async def _info(cfg, sid):
        return {
            "tracking_number": "TRK-REFRESH-A",
            "barcode": "BC-A",
            "label_url": "https://a.example/refresh.pdf",
            "tracking_url": "https://a.example/track",
            "status": "TRANSIT",
        }

    async def _ok(cfg):
        return {"ok": True, "addresses": [{"id": "addr-a"}]}

    async def _bad(cfg):
        raise HTTPException(status_code=400, detail="Kayıtlı token okunamadı")

    monkeypatch.setattr(server, "_push_order_to_shopphp", _push)
    monkeypatch.setattr(server.cargo_providers, "geliver_get_shipment", _info)

    db = _DB()
    _seed_shared(db)
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        with caplog.at_level(logging.DEBUG):
            out = _run(server.refresh_cargo_shipment(SHIP, user))
    finally:
        _restore(prev)
    assert out["tracking_number"] == "TRK-REFRESH-A"
    assert out["company_id"] == CO_A
    assert _doc(db, "cargo_shipments", SHIP, CO_A)["tracking_number"] == "TRK-REFRESH-A"
    assert _doc(db, "orders", ORDER, CO_A)["cargo_tracking_number"] == "TRK-REFRESH-A"
    assert _doc(db, "cargo_shipments", SHIP, CO_B)["tracking_number"] == TRACK_B
    assert _doc(db, "cargo_shipments", SHIP, CO_B)["label_url"] == LABEL_B
    assert _doc(db, "orders", ORDER, CO_B)["cargo_label_url"] == LABEL_B
    assert _doc(db, "orders", ORDER, CO_B)["order_status"] == "preparing"
    assert pushed == [{"company_id": CO_A, "reason": "cargo_tracking"}]
    assert _digest(db, CO_B) == before

    pushed.clear()
    db = _DB()
    _seed_shared(db)
    for row in db.cargo_shipments.docs:
        if row.get("company_id") == CO_A and row.get("_id") == SHIP:
            row["order_id"] = "order-b-only"
    _add(db, "orders", _order(CO_B, _id="order-b-only", cargo_tracking_number=TRACK_B, order_status="preparing"))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        _run(server.refresh_cargo_shipment(SHIP, user))
    finally:
        _restore(prev)
    assert pushed == []
    assert _doc(db, "orders", "order-b-only", CO_B)["cargo_tracking_number"] == TRACK_B
    assert _doc(db, "orders", "order-b-only", CO_B)["order_status"] == "preparing"
    assert _digest(db, CO_B) == before

    monkeypatch.setattr(server.cargo_providers, "geliver_test", _ok)
    db = _DB()
    _seed_shared(db)
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        with caplog.at_level(logging.DEBUG):
            out = _run(server.test_cargo_integration(CFG, user))
    finally:
        _restore(prev)
    assert out["simulated"] is False
    assert _doc(db, "cargo_configs", CFG, CO_A)["status"] == "connected"
    assert _doc(db, "cargo_configs", CFG, CO_A)["sender_addresses"] == [{"id": "addr-a"}]
    assert _doc(db, "cargo_configs", CFG, CO_B)["api_key"] == API_KEY
    assert "sender_addresses" not in _doc(db, "cargo_configs", CFG, CO_B)
    assert _digest(db, CO_B) == before

    monkeypatch.setattr(server.cargo_providers, "geliver_test", _bad)
    db = _DB()
    _seed_shared(db)
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        with pytest.raises(HTTPException) as exc:
            _run(server.test_cargo_integration(CFG, user))
        assert exc.value.status_code == 400
    finally:
        _restore(prev)
    assert "api_key" not in _doc(db, "cargo_configs", CFG, CO_A)
    assert _doc(db, "cargo_configs", CFG, CO_A)["is_active"] is False
    assert _doc(db, "cargo_configs", CFG, CO_A)["status"] == "not_configured"
    assert _doc(db, "cargo_configs", CFG, CO_B)["api_key"] == API_KEY
    assert _doc(db, "cargo_configs", CFG, CO_B)["is_active"] is True
    assert _digest(db, CO_B) == before

    db = _DB()
    _seed_shared(db)
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        with caplog.at_level(logging.DEBUG):
            out = _run(server.update_cargo_integration(CFG, {
                "api_key": API_KEY,
                "api_secret": API_SECRET,
                "api_password": API_PASSWORD,
                "sender_address_id": "addr-real-1",
                "is_active": True,
            }, user))
    finally:
        _restore(prev)
    assert out["company_id"] == CO_A
    assert out["api_key"] == MASK
    assert out["api_secret"] == MASK
    assert out["api_password"] == MASK
    body = json.dumps(out)
    assert API_KEY not in body
    assert API_SECRET not in body
    assert API_PASSWORD not in body
    stored = _doc(db, "cargo_configs", CFG, CO_A)
    assert stored["api_key"] != API_KEY
    assert stored["sender_address_id"] == "addr-real-1"
    assert _doc(db, "cargo_configs", CFG, CO_B)["api_key"] == API_KEY
    assert _doc(db, "cargo_configs", CFG, CO_B)["api_secret"] == API_SECRET
    assert _doc(db, "cargo_configs", CFG, CO_B)["api_password"] == API_PASSWORD
    assert _doc(db, "cargo_configs", CFG, CO_B)["sender_address_id"] == "addr-b"
    assert API_KEY not in caplog.text
    assert API_SECRET not in caplog.text
    assert API_PASSWORD not in caplog.text
    assert stored["api_key"] not in caplog.text
    assert _digest(db, CO_B) == before

    db = _DB()
    _seed_shared(db)
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        out = _run(server.delete_cargo_integration(CFG, user))
    finally:
        _restore(prev)
    assert out == {"status": "success"}
    assert _doc(db, "cargo_configs", CFG, CO_A) is None
    assert _doc(db, "cargo_configs", CFG, CO_B)["api_key"] == API_KEY
    assert _digest(db, CO_B) == before


def test_create_shipment_does_not_touch_other_order(monkeypatch):
    user = _user(CO_A)
    pushed = []

    async def _push(order, reason="manual", raise_errors=False):
        pushed.append(order.get("company_id") if order else None)
        return None

    monkeypatch.setattr(server, "_push_order_to_shopphp", _push)

    db = _DB()
    _add(db, "orders", _order(CO_B, cargo_tracking_number=TRACK_B, cargo_label_url=LABEL_B, order_status="preparing"))
    _add(db, "products", {"_id": PROD, "company_id": CO_A, "name": "Urun A", "sku": "SKU-A", "desi": 2})
    _add(db, "products", {"_id": PROD, "company_id": CO_B, "name": "Urun B", "sku": "SKU-B", "desi": 8})
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        out = _run(server.create_cargo_shipment({
            "company_id": CO_A,
            "carrier_code": "yurtici",
            "order_id": ORDER,
            "customer_name": "Alici A",
            "address": "Adres A",
            "city": "Ankara",
        }, user))
    finally:
        _restore(prev)
    assert out["company_id"] == CO_A
    assert _doc(db, "orders", ORDER, CO_B)["order_status"] == "preparing"
    assert _doc(db, "orders", ORDER, CO_B)["cargo_tracking_number"] == TRACK_B
    assert _doc(db, "orders", ORDER, CO_B)["cargo_label_url"] == LABEL_B
    assert db.cargo_shipments.docs
    assert all(row.get("company_id") == CO_A for row in db.cargo_shipments.docs)
    assert pushed == []
    assert _digest(db, CO_B) == before

    pushed.clear()
    db = _DB()
    _seed_shared(db, order_tracking_b=TRACK_B)
    prev = _bind(db)
    traced = sys.gettrace()
    sys.settrace(_stamp_company({"create_cargo_shipment"}))
    try:
        before = _digest(db, CO_B)
        out = _run(server.create_cargo_shipment({
            "carrier_code": "yurtici",
            "order_id": ORDER,
            "customer_name": "Alici A",
            "address": "Adres A",
            "city": "Ankara",
        }, user))
    finally:
        sys.settrace(traced)
        _restore(prev)
    assert out["company_id"] == CO_A
    assert db.cargo_shipments.docs[-1]["company_id"] == CO_A
    assert db.cargo_shipments.docs[-1]["desi"] == 2
    assert _doc(db, "orders", ORDER, CO_A)["order_status"] == "shipped"
    assert _doc(db, "orders", ORDER, CO_A)["cargo_tracking_number"]
    assert _doc(db, "orders", ORDER, CO_B)["order_status"] == "preparing"
    assert _doc(db, "orders", ORDER, CO_B)["cargo_tracking_number"] == TRACK_B
    assert _doc(db, "orders", ORDER, CO_B)["cargo_label_url"] == LABEL_B
    assert pushed == [CO_A]
    assert _digest(db, CO_B) == before


def test_enrich_skips_foreign_and_blank_company():
    db = _DB()
    _seed_shared(db)
    calls = []
    real = db.products.find

    def _find(query=None, projection=None):
        calls.append(copy.deepcopy(query))
        return real(query, projection)

    db.products.find = _find
    prev = _bind(db)
    try:
        bare = {"_id": ORDER, "items": [{"product_id": PROD, "product_name": "Ham", "sku": "HAM", "quantity": 1}]}
        out = _run(server._enrich_order_items_from_products(bare))
        assert out is bare
        assert calls == []
        blank = {**bare, "company_id": ""}
        out = _run(server._enrich_order_items_from_products(blank))
        assert out is blank
        assert calls == []
        own = {
            "_id": ORDER,
            "company_id": CO_A,
            "items": [{"product_id": PROD, "product_name": "Ham", "sku": "HAM", "quantity": 1}],
        }
        out = _run(server._enrich_order_items_from_products(own))
    finally:
        _restore(prev)
    assert calls == [{"_id": {"$in": [PROD]}, "company_id": CO_A}]
    assert out["items"][0]["desi"] == 2
    assert out["items"][0]["product_name"] == "Ham"
    assert out["items"][0]["sku"] == "HAM"
    assert "Urun B" not in json.dumps(out)
    assert "SKU-B" not in json.dumps(out)
    assert _doc(db, "products", PROD, CO_B)["name"] == "Urun B"
    assert _doc(db, "products", PROD, CO_B)["desi"] == 8


def test_add_and_auto_ship_keep_caller_company(monkeypatch):
    user = _user(CO_A)
    pushed = []

    async def _push(order, reason="manual", raise_errors=False):
        pushed.append(order.get("company_id") if order else None)
        return None

    monkeypatch.setattr(server, "_push_order_to_shopphp", _push)

    db = _DB()
    _seed_shared(db)
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        with pytest.raises(HTTPException) as exc:
            _run(server.add_cargo_integration({
                "company_id": CO_B,
                "carrier_code": "yurtici",
                "api_password": API_PASSWORD,
            }, user))
        assert exc.value.status_code == 403
        with pytest.raises(HTTPException) as exc:
            _run(server.cargo_auto_ship({
                "company_id": CO_B,
                "carrier_code": "yurtici",
                "allow_simulated": True,
            }, user))
        assert exc.value.status_code == 403
    finally:
        _restore(prev)
    assert db.cargo_auto_runs.docs == []
    assert all(row.get("carrier_code") != "yurtici" for row in db.cargo_configs.docs)
    assert _digest(db, CO_B) == before

    db = _DB()
    _add(db, "orders", _order(CO_B, cargo_tracking_number=None, order_status="approved"))
    _add(db, "orders", _order(CO_A, cargo_tracking_number=None, order_status="approved", cargo_label_url=""))
    prev = _bind(db)
    traced = sys.gettrace()
    sys.settrace(_stamp_company({"add_cargo_integration", "cargo_auto_ship"}))
    try:
        before = _digest(db, CO_B)
        added = _run(server.add_cargo_integration({
            "carrier_code": "yurtici",
            "api_password": API_PASSWORD,
            "customer_number": "100",
            "api_username": "user-a",
        }, user))
        summary = _run(server.cargo_auto_ship({
            "company_id": CO_A,
            "carrier_code": "yurtici",
            "channels": ["shopphp"],
            "allow_simulated": True,
            "summary": {"company_id": CO_B},
        }, user))
    finally:
        sys.settrace(traced)
        _restore(prev)
    assert added["company_id"] == CO_A
    assert added.get("api_password") == MASK
    assert API_PASSWORD not in json.dumps(added)
    stored_cfg = next(row for row in db.cargo_configs.docs if row.get("carrier_code") == "yurtici")
    assert stored_cfg["company_id"] == CO_A
    assert stored_cfg.get("api_password") != API_PASSWORD
    assert summary["candidates"] == 1
    assert summary["created"] == 1
    assert db.cargo_auto_runs.docs
    assert all(row.get("company_id") == CO_A for row in db.cargo_auto_runs.docs)
    assert _doc(db, "orders", ORDER, CO_A)["order_status"] == "shipped"
    assert _doc(db, "orders", ORDER, CO_B)["order_status"] == "approved"
    assert _doc(db, "orders", ORDER, CO_B).get("cargo_tracking_number") in (None, "")
    assert CO_B not in pushed
    assert _digest(db, CO_B) == before


def test_wave12_baseline_keys_removed():
    base = allowlist.TENANT_SCOPE_BASELINE
    present = [key for key in _REMOVED if key in base]
    assert present == []
    assert len(_REMOVED) == 18
    assert len({key for key in _REMOVED}) == 18
    assert all(key[0] == "server.py" for key in _REMOVED)
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


def test_insert_company_id_is_after_spread():
    tree = ast.parse(Path(server.__file__).read_text(encoding="utf-8"))
    wanted = {"add_cargo_integration", "cargo_auto_ship", "create_cargo_shipment"}
    found = set()
    for fn in ast.walk(tree):
        if not isinstance(fn, ast.AsyncFunctionDef) or fn.name not in wanted:
            continue
        inserts = [
            node for node in ast.walk(fn)
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "insert_one"
        ]
        assert len(inserts) == 1
        arg = inserts[0].args[0]
        if isinstance(arg, ast.Name):
            assigned = [
                node.value for node in ast.walk(fn)
                if isinstance(node, ast.Assign)
                and any(isinstance(target, ast.Name) and target.id == arg.id for target in node.targets)
            ]
            assert len(assigned) == 1
            arg = assigned[0]
        assert isinstance(arg, ast.Dict)
        last_spread = max((i for i, key in enumerate(arg.keys) if key is None), default=-1)
        company_at = next(i for i, key in enumerate(arg.keys) if isinstance(key, ast.Constant) and key.value == "company_id")
        assert company_at > last_spread
        found.add(fn.name)
    assert found == wanted
