"""Sipariş toplama ve araç kiracı dalgası 18.

Bellek içi MemDB. Canlı veritabanına, 8021 portuna ve ağa bağlanmaz.
Tutar, miktar, fiyat, stok, token ve şirket kimliği loglanmaz.
"""
from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import logging
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import attendance  # noqa: E402
import event_notify  # noqa: E402
import notify  # noqa: E402
import order_pick  # noqa: E402
import tenant_access  # noqa: E402
import tenant_scope_allowlist as allowlist  # noqa: E402
import vehicles  # noqa: E402
from dashboard_memdb import MemColl, MemDB, _split_field_ops  # noqa: E402
from mysql_store import match_query  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
ORDER = "order-shared"
SES = "ses-shared"
PROD = "prod-shared"
VEH = "veh-shared"
SHIP = "shp-shared"
SHIP_B = "shp-b-only"
SECRET_NAME = "GizliKalemB"
SECRET_BAR = "BAR-B"
SECRET_BRAND = "GizliMarka"

_REMOVED = (
    ("order_pick.py", "_enrich_items", "products", "find_one"),
    ("order_pick.py", "_session_for", "order_pick_sessions", "find_one"),
    ("order_pick.py", "_session_for", "order_pick_sessions", "insert_one"),
    ("order_pick.py", "_session_for", "orders", "update_one"),
    ("order_pick.py", "_sync_product_label_fields", "order_pick_sessions", "update_one"),
    ("order_pick.py", "_sync_stock_notes", "order_pick_sessions", "update_one"),
    ("order_pick.py", "adjust_pick", "order_pick_sessions", "find_one"),
    ("order_pick.py", "adjust_pick", "order_pick_sessions", "update_one"),
    ("order_pick.py", "complete_pick", "cargo_shipments", "update_many"),
    ("order_pick.py", "complete_pick", "order_pick_sessions", "find_one"),
    ("order_pick.py", "complete_pick", "order_pick_sessions", "update_one"),
    ("order_pick.py", "complete_pick", "orders", "find_one"),
    ("order_pick.py", "complete_pick", "orders", "update_one"),
    ("order_pick.py", "notify_missing", "order_pick_sessions", "update_one"),
    ("order_pick.py", "scan_pick", "order_pick_sessions", "find_one"),
    ("order_pick.py", "scan_pick", "order_pick_sessions", "update_one"),
    ("order_pick.py", "scan_pick", "orders", "update_one"),
    ("order_pick.py", "send_missing_to_production", "order_pick_sessions", "update_one"),
    ("vehicles.py", "create_vehicle", "vehicles", "insert_one"),
    ("vehicles.py", "update_vehicle", "vehicles", "find_one"),
    ("vehicles.py", "update_vehicle", "vehicles", "update_one"),
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
        for index, doc in enumerate(self.docs):
            if match_query(doc, query):
                del self.docs[index]
                return type("R", (), {"deleted_count": 1})()
        return type("R", (), {"deleted_count": 0})()


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


def _row(db, coll, company_id, doc_id):
    for doc in db[coll].docs:
        if doc.get("_id") == doc_id and doc.get("company_id") == company_id:
            return doc
    return None


def _bind(db, produce=None, push=None):
    prev = {
        "pick": order_pick._db,
        "produce": order_pick._create_production_order,
        "push": order_pick._push_order_to_shopphp,
        "draft": order_pick._create_draft_invoice_for_order,
        "veh": vehicles._db,
    }
    deps = {}
    if produce is not None:
        deps["create_production_order"] = produce
    if push is not None:
        deps["push_order_to_shopphp"] = push
    order_pick.init(db, deps)
    vehicles.init(db)
    return prev


def _restore(prev):
    order_pick._db = prev["pick"]
    order_pick._create_production_order = prev["produce"]
    order_pick._push_order_to_shopphp = prev["push"]
    order_pick._create_draft_invoice_for_order = prev["draft"]
    vehicles._db = prev["veh"]


async def _own(db_arg, collection, doc_id, actor, **kwargs):
    """Aynı _id iki şirkette de varken çağıranın satırını yükle."""
    allowed = {str(item) for item in (actor.get("company_ids") or [])}
    for row in db_arg[collection].docs:
        if str(row.get("_id")) == str(doc_id) and str(row.get("company_id") or "") in allowed:
            return copy.deepcopy(row)
    raise HTTPException(status_code=404, detail=kwargs.get("not_found") or "Kayıt bulunamadı.")


async def _quiet_managers(*_args, **_kwargs):
    return {"status": "sent", "mail": {"status": "skipped"}}


async def _quiet_note(*_args, **_kwargs):
    return {"status": "ok"}


async def _quiet_flag(*_args, **_kwargs):
    return False


def _silence(monkeypatch):
    monkeypatch.setattr(tenant_access, "get_tenant_doc", _own)
    monkeypatch.setattr(attendance, "notify_managers", _quiet_managers)
    monkeypatch.setattr(notify, "insert_notification", _quiet_note)
    monkeypatch.setattr(event_notify, "inapp_enabled", _quiet_flag)
    monkeypatch.setattr(event_notify, "queue_event_email", _quiet_note)


def _product(company_id, doc_id=PROD, **extra):
    row = {
        "_id": doc_id,
        "company_id": company_id,
        "name": "UrunA" if company_id == CO_A else "UrunB",
        "sku": "SKU-A" if company_id == CO_A else "SKU-B",
        "barcode": "BAR-A" if company_id == CO_A else SECRET_BAR,
        "image_url": "http://a.example/a.png" if company_id == CO_A else "http://b.example/gizli.png",
    }
    row.update(extra)
    return row


def _order(company_id, **extra):
    row = {
        "_id": ORDER,
        "company_id": company_id,
        "channel": "b2b",
        "order_status": "pending",
        "order_number": "SP-A" if company_id == CO_A else "SP-B",
        "customer_name": "AliciA" if company_id == CO_A else "GizliMusteriB",
        "city": "Ankara",
        "items": [{
            "product_id": PROD,
            "product_name": "KalemA" if company_id == CO_A else SECRET_NAME,
            "sku": "SKU-A" if company_id == CO_A else "SKU-B",
            "barcode": "BAR-A" if company_id == CO_A else SECRET_BAR,
            "quantity": 3,
        }],
    }
    row.update(extra)
    return row


def _session(company_id, **extra):
    name = "KalemA" if company_id == CO_A else SECRET_NAME
    barcode = "BAR-A" if company_id == CO_A else SECRET_BAR
    sku = "SKU-A" if company_id == CO_A else "SKU-B"
    row = {
        "_id": SES,
        "company_id": company_id,
        "order_id": ORDER,
        "status": "open",
        "items": [{
            "line_index": 0,
            "product_id": PROD,
            "product_name": name,
            "sku": sku,
            "barcode": barcode,
            "codes": [barcode, sku],
            "ordered_qty": 3,
            "picked_qty": 0,
        }],
    }
    row.update(extra)
    return row


def _cargo(company_id, doc_id=SHIP, **extra):
    row = {
        "_id": doc_id,
        "company_id": company_id,
        "order_id": ORDER,
        "status": "created",
        "tracking_number": "TRK-A" if company_id == CO_A else "TRK-B-KEEP",
    }
    row.update(extra)
    return row


def _vehicle(company_id, **extra):
    plate = "34 AA 001" if company_id == CO_A else "34 BB 001"
    row = {
        "_id": VEH,
        "company_id": company_id,
        "plate": plate,
        "plate_key": "34AA001" if company_id == CO_A else "34BB001",
        "brand": "Ford" if company_id == CO_A else SECRET_BRAND,
        "model": "Transit",
        "status": "active",
    }
    row.update(extra)
    return row


def test_pick_actions_leave_other_company_unchanged(monkeypatch):
    _silence(monkeypatch)
    user = _user(CO_A)
    db = _DB()
    _add(db, "products", _product(CO_B))
    _add(db, "products", _product(CO_A))
    _add(db, "orders", _order(CO_B))
    _add(db, "orders", _order(CO_A))
    _add(db, "order_pick_sessions", _session(CO_B))
    _add(db, "order_pick_sessions", _session(CO_A))
    _add(db, "cargo_shipments", _cargo(CO_B))
    _add(db, "cargo_shipments", _cargo(CO_A))
    seen = []

    async def _produce(payload):
        seen.append(payload.get("company_id"))
        return {"order_code": "UE-1", "needs_recipe": False}

    prev = _bind(db, produce=_produce)
    try:
        before = _digest(db, CO_B)
        opened = _run(order_pick.open_pick(ORDER, user))
        blob = json.dumps(opened, default=str)
        assert SECRET_NAME not in blob
        assert "GizliMusteriB" not in blob
        assert opened["items"][0]["product_name"] == "KalemA"
        scanned = _run(order_pick.scan_pick(ORDER, {"barcode": "BAR-A", "quantity": 1}, user))
        assert scanned["items"][0]["picked_qty"] == 1
        adjusted = _run(order_pick.adjust_pick(ORDER, {"line_index": 0, "picked_qty": 1}, user))
        assert adjusted["items"][0]["picked_qty"] == 1
        noted = _run(order_pick.notify_missing(ORDER, user))
        assert noted["missing"]
        sent = _run(order_pick.send_missing_to_production(ORDER, user))
        assert sent["created"]
        assert seen == [CO_A]
        done = _run(order_pick.complete_pick(ORDER, {"mode": "ready"}, user))
        assert done["message"]
        assert _digest(db, CO_B) == before
        assert _row(db, "orders", CO_B, ORDER)["order_status"] == "pending"
        assert _row(db, "order_pick_sessions", CO_B, SES)["items"][0]["picked_qty"] == 0
        assert _row(db, "cargo_shipments", CO_B, SHIP)["status"] == "created"
        assert _row(db, "products", CO_B, PROD)["name"] == "UrunB"
        assert _row(db, "orders", CO_A, ORDER)["pick_status"] == "ready"
        assert _row(db, "order_pick_sessions", CO_A, SES)["status"] == "ready"
    finally:
        _restore(prev)


def test_session_for_creates_own_session(monkeypatch):
    _silence(monkeypatch)
    user = _user(CO_A)
    db = _DB()
    _add(db, "products", _product(CO_B))
    _add(db, "products", _product(CO_A, "prod-a"))
    _add(db, "orders", _order(CO_B))
    _add(db, "orders", _order(CO_A, items=[{
        "product_id": PROD,
        "sku": "SKU-A",
        "quantity": 2,
    }]))
    _add(db, "order_pick_sessions", _session(CO_B))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        opened = _run(order_pick.open_pick(ORDER, user))
        blob = json.dumps(opened, default=str)
        assert SECRET_NAME not in blob
        assert "UrunB" not in blob
        assert SECRET_BAR not in blob
        assert opened["items"][0]["product_name"] == "UrunA"
        assert opened["items"][0]["barcode"] == "BAR-A"
        assert _digest(db, CO_B) == before
        own = [row for row in db.order_pick_sessions.docs if row.get("company_id") == CO_A]
        assert len(own) == 1
        assert own[0]["order_id"] == ORDER
        assert own[0]["_id"] != SES
        assert _row(db, "order_pick_sessions", CO_B, SES)["items"][0]["product_name"] == SECRET_NAME
    finally:
        _restore(prev)


def test_enrich_items_ignores_other_company_product():
    db = _DB()
    _add(db, "products", _product(CO_B))
    _add(db, "products", _product(CO_A, "prod-a"))
    prev = _bind(db)
    try:
        items = _run(order_pick._enrich_items(CO_A, [{
            "product_id": PROD,
            "sku": "SKU-A",
            "quantity": 2,
        }]))
        assert items[0]["product_name"] == "UrunA"
        assert items[0]["barcode"] == "BAR-A"
        assert items[0]["sku"] == "SKU-A"
        blob = json.dumps(items, default=str)
        assert "UrunB" not in blob
        assert SECRET_BAR not in blob
        assert "gizli" not in blob.lower()
    finally:
        _restore(prev)


def test_enrich_items_skips_product_read_without_company():
    db = _DB()
    _add(db, "products", _product(CO_B))
    calls = []
    original = db.products.find_one

    async def _spy(query=None, projection=None, sort=None):
        calls.append(query)
        return await original(query, projection, sort)

    db.products.find_one = _spy
    prev = _bind(db)
    try:
        items = _run(order_pick._enrich_items("", [{"product_id": PROD, "quantity": 1}]))
        assert calls == []
        assert items[0]["product_name"] == "Kalem"
        assert items[0]["barcode"] == ""
        assert _row(db, "products", CO_B, PROD)["name"] == "UrunB"
    finally:
        _restore(prev)


def test_complete_deliver_does_not_close_other_cargo(monkeypatch):
    _silence(monkeypatch)
    user = _user(CO_A)
    db = _DB()
    _add(db, "orders", _order(CO_B, order_status="shipped"))
    _add(db, "orders", _order(CO_A, order_status="shipped"))
    _add(db, "order_pick_sessions", _session(CO_B, status="picking"))
    _add(db, "order_pick_sessions", _session(CO_A, status="picking"))
    _add(db, "cargo_shipments", _cargo(CO_B))
    _add(db, "cargo_shipments", _cargo(CO_B, SHIP_B))
    _add(db, "cargo_shipments", _cargo(CO_A))
    pushed = []

    async def _push(order, reason="status"):
        pushed.append((order.get("company_id"), reason, order.get("order_status")))

    prev = _bind(db, push=_push)
    try:
        before = _digest(db, CO_B)
        out = _run(order_pick.complete_pick(ORDER, {"mode": "deliver"}, user))
        assert out["message"] == "Sipariş teslim edildi."
        assert _digest(db, CO_B) == before
        assert _row(db, "cargo_shipments", CO_B, SHIP)["status"] == "created"
        assert _row(db, "cargo_shipments", CO_B, SHIP_B)["status"] == "created"
        assert _row(db, "cargo_shipments", CO_A, SHIP)["status"] == "delivered"
        assert _row(db, "orders", CO_A, ORDER)["order_status"] == "delivered"
        assert _row(db, "orders", CO_B, ORDER)["order_status"] == "shipped"
        assert _row(db, "order_pick_sessions", CO_B, SES)["status"] == "picking"
        assert _row(db, "order_pick_sessions", CO_A, SES)["status"] == "delivered"
        assert pushed == [(CO_A, "status", "delivered")]
    finally:
        _restore(prev)


def test_vehicle_update_leaves_other_company(monkeypatch):
    monkeypatch.setattr(tenant_access, "get_tenant_doc", _own)
    user = _user(CO_A)
    db = _DB()
    _add(db, "vehicles", _vehicle(CO_B))
    _add(db, "vehicles", _vehicle(CO_A))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        out = _run(vehicles.update_vehicle(VEH, {"plate": "34 BB 001", "brand": "Fiat"}, user))
        assert out["plate"] == "34 BB 001"
        assert out["brand"] == "Fiat"
        assert out["company_id"] == CO_A
        assert _digest(db, CO_B) == before
        assert _row(db, "vehicles", CO_B, VEH)["brand"] == SECRET_BRAND
        assert _row(db, "vehicles", CO_B, VEH)["plate"] == "34 BB 001"
        assert _row(db, "vehicles", CO_A, VEH)["brand"] == "Fiat"
    finally:
        _restore(prev)


def test_vehicle_insert_company_is_callers(monkeypatch):
    user = _user(CO_A)
    db = _DB()
    _add(db, "vehicles", _vehicle(CO_B))
    prev = _bind(db)
    traced = sys.gettrace()

    def _stamp(frame, event, arg):
        if event == "line" and frame.f_code.co_name == "create_vehicle":
            blob = frame.f_locals.get("doc")
            if isinstance(blob, dict):
                blob["company_id"] = CO_B
        return _stamp

    sys.settrace(_stamp)
    try:
        before = _digest(db, CO_B)
        out = _run(vehicles.create_vehicle({
            "plate": "06 TK 01",
            "brand": "Ford",
            "model": "Transit",
        }, user))
        assert out["company_id"] == CO_A
        stored = next(row for row in db.vehicles.docs if row.get("plate") == "06 TK 01")
        assert stored["company_id"] == CO_A
        assert _digest(db, CO_B) == before
    finally:
        sys.settrace(traced)
        _restore(prev)


def test_vehicle_without_company_is_not_written(monkeypatch):
    async def _legacy(db_arg, collection, doc_id, actor, **kwargs):
        for row in db_arg[collection].docs:
            if str(row.get("_id")) == str(doc_id):
                return copy.deepcopy(row)
        raise HTTPException(status_code=404, detail=kwargs.get("not_found") or "Kayıt bulunamadı.")

    monkeypatch.setattr(tenant_access, "get_tenant_doc", _legacy)
    user = _user(CO_A)
    db = _DB()
    _add(db, "vehicles", {"_id": VEH, "plate": "34 AA 001", "plate_key": "34AA001", "brand": "Ford", "status": "active"})
    prev = _bind(db)
    try:
        with pytest.raises(HTTPException) as exc:
            _run(vehicles.update_vehicle(VEH, {"brand": "Fiat"}, user))
        assert exc.value.status_code == 404
        assert db.vehicles.docs[0]["brand"] == "Ford"
        assert "company_id" not in db.vehicles.docs[0]
    finally:
        _restore(prev)


def test_wave18_baseline_keys_removed():
    base = allowlist.TENANT_SCOPE_BASELINE
    present = [key for key in _REMOVED if key in base]
    assert present == []
    assert len(_REMOVED) == 21
    assert len(set(_REMOVED)) == 21
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


def test_pick_logs_omit_company_and_amounts(caplog):
    caplog.set_level(logging.DEBUG, logger="TamKobiERP")
    user = _user(CO_A)
    db = _DB()
    order = _order(CO_A)
    order.pop("company_id", None)
    _add(db, "orders", order)
    prev = _bind(db)
    try:
        with pytest.raises(HTTPException) as exc:
            _run(order_pick.scan_pick(ORDER, {"barcode": "BAR-A"}, user))
        assert exc.value.status_code == 404
        blob = " ".join(record.getMessage() for record in caplog.records if record.name.startswith("TamKobiERP"))
        assert CO_A not in blob
        assert CO_B not in blob
    finally:
        _restore(prev)
