"""Lot/seri, stok sayımı ve depo transferi kiracı dalgası 15.

Bellek içi MemDB. Canlı veritabanına, 8021 portuna ve ağa bağlanmaz.
Tutar, miktar, stok, fiyat, maliyet ve şirket kimliği loglanmaz.
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

import pytest
from fastapi import HTTPException

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import rbac  # noqa: E402
import server  # noqa: E402
import tenant_scope_allowlist as allowlist  # noqa: E402
import trash  # noqa: E402
from dashboard_memdb import MemColl, MemDB, _split_field_ops  # noqa: E402
from models import Warehouse, WarehouseTransfer  # noqa: E402
from mysql_store import match_query  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
PROD = "prod-shared"
PROD_B = "prod-b-only"
PROD_VAR = "prod-var"
LOT = "lot-shared"
SERIAL = "serial-shared"
COUNT = "count-shared"
WH = "wh-shared"
WH_B = "wh-b-only"
SECRET_REASON = "gizli-sayim-b"
SECRET_WH = "DepoB-Gizli"
SECRET_STOCK = 4242

_REMOVED = (
    ("server.py", "_apply_lot_delta", "stock_lots", "find_one"),
    ("server.py", "_apply_lot_delta", "stock_lots", "update_one"),
    ("server.py", "complete_stock_count", "products", "find_one"),
    ("server.py", "complete_stock_count", "products", "update_one"),
    ("server.py", "complete_stock_count", "stock_counts", "update_one"),
    ("server.py", "complete_stock_count", "stock_movements", "insert_one"),
    ("server.py", "create_stock_count", "warehouses", "find_one"),
    ("server.py", "create_stock_lot", "stock_lots", "insert_one"),
    ("server.py", "create_warehouse", "warehouses", "insert_one"),
    ("server.py", "create_warehouse_transfer", "warehouse_transfers", "insert_one"),
    ("server.py", "create_warehouse_transfer", "warehouses", "find_one"),
    ("server.py", "delete_stock_lot", "products", "update_one"),
    ("server.py", "delete_stock_lot", "stock_lots", "delete_one"),
    ("server.py", "list_product_movements", "stock_movements", "find"),
    ("server.py", "scan_stock_count", "stock_counts", "update_one"),
    ("server.py", "set_stock_count_item", "stock_counts", "find_one"),
    ("server.py", "set_stock_count_item", "stock_counts", "update_one"),
    ("server.py", "update_stock_lot", "products", "update_one"),
    ("server.py", "update_stock_lot", "stock_lots", "find_one"),
    ("server.py", "update_stock_lot", "stock_lots", "update_one"),
)
_KEPT = ("server.py", "list_product_movements", "products", "find_one")


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


async def _own(db_arg, collection, doc_id, actor, **kwargs):
    """Aynı _id iki şirkette de varken çağıranın satırını yükle."""
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


def _product(company_id, doc_id=PROD, **extra):
    row = {
        "_id": doc_id,
        "company_id": company_id,
        "name": "UrunA" if company_id == CO_A else "UrunB",
        "sku": "SKU-A" if company_id == CO_A else "SKU-B",
        "barcode": "BAR-A" if company_id == CO_A else "BAR-B",
        "stock_quantity": 10 if company_id == CO_A else 50,
        "purchase_price": 4,
        "sale_price": 9,
        "warehouse_id": WH,
    }
    row.update(extra)
    return row


def _lot(company_id, doc_id=LOT, **extra):
    row = {
        "_id": doc_id,
        "company_id": company_id,
        "product_id": PROD,
        "product_name": "UrunA" if company_id == CO_A else "UrunB",
        "lot_number": "L-1",
        "tracking_type": "lot",
        "quantity": 5 if company_id == CO_A else 9,
        "is_active": True,
        "warehouse_id": WH,
    }
    row.update(extra)
    return row


def _warehouse(company_id, doc_id=WH, **extra):
    row = {
        "_id": doc_id,
        "company_id": company_id,
        "name": "DepoA" if company_id == CO_A else SECRET_WH,
        "code": "A" if company_id == CO_A else "B",
        "location": "L",
    }
    row.update(extra)
    return row


def _count(company_id, **extra):
    row = {
        "_id": COUNT,
        "company_id": company_id,
        "name": "SayimA" if company_id == CO_A else "SayimB",
        "warehouse_id": WH,
        "warehouse_name": "DepoA" if company_id == CO_A else SECRET_WH,
        "status": "open",
        "items": [],
        "created_at": "2026-03-01T00:00:00+00:00",
    }
    row.update(extra)
    return row


def _seed_pair(db, *builders, b_first=True):
    order = (CO_B, CO_A) if b_first else (CO_A, CO_B)
    for company_id in order:
        for build in builders:
            _add(db, build[0], build[1](company_id))


def test_lot_writes_stay_in_company(monkeypatch):
    monkeypatch.setattr(server.tenant_access, "get_tenant_doc", _own)
    user = _user(CO_A)
    db = _DB()
    _seed_pair(db, ("products", _product), ("stock_lots", _lot))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        updated = _run(server.update_stock_lot(LOT, {"quantity": 1, "is_active": False}, user))
        assert updated["quantity"] == 1
        assert updated["is_active"] is False
        assert updated["company_id"] == CO_A
        assert _row(db, "stock_lots", CO_A, LOT)["quantity"] == 1
        assert _row(db, "products", CO_A, PROD)["stock_quantity"] == 6
        assert _row(db, "stock_lots", CO_B, LOT)["quantity"] == 9
        assert _row(db, "stock_lots", CO_B, LOT)["is_active"] is True
        assert _row(db, "products", CO_B, PROD)["stock_quantity"] == 50
        assert _digest(db, CO_B) == before

        deleted = _run(server.delete_stock_lot(LOT, user))
        assert deleted["message"] == "Lot silindi."
        assert _row(db, "stock_lots", CO_A, LOT) is None
        assert _row(db, "products", CO_A, PROD)["stock_quantity"] == 5
        assert _row(db, "stock_lots", CO_B, LOT)["quantity"] == 9
        assert _row(db, "stock_lots", CO_B, LOT)["is_active"] is True
        assert _row(db, "products", CO_B, PROD)["stock_quantity"] == 50
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_lot_delta_ignores_other_company_and_empty_company(caplog):
    db = _DB()
    _seed_pair(db, ("stock_lots", _lot))
    _add(db, "stock_lots", _lot(CO_B, SERIAL, tracking_type="serial", quantity=1, is_active=True))
    _add(db, "stock_lots", _lot(CO_A, SERIAL, tracking_type="serial", quantity=1, is_active=True))
    prev = _bind(db)
    try:
        before_b = _digest(db, CO_B)
        caplog.clear()
        with caplog.at_level(logging.DEBUG, logger="TamKobiERP"):
            for sign in (-1.0, 1.0):
                _run(server._apply_lot_delta({"lot_id": LOT, "quantity": 2}, sign, CO_A))
                _run(server._apply_lot_delta(
                    {"lot_id": SERIAL, "quantity": 1}, sign, CO_A,
                ))
                for empty in (None, "", "   "):
                    _run(server._apply_lot_delta({"lot_id": LOT, "quantity": 2}, sign, empty))
                    _run(server._apply_lot_delta({"lot_id": SERIAL, "quantity": 1}, sign, empty))
        assert _row(db, "stock_lots", CO_B, LOT)["quantity"] == 9
        assert _row(db, "stock_lots", CO_B, LOT)["is_active"] is True
        assert _row(db, "stock_lots", CO_B, SERIAL)["quantity"] == 1
        assert _row(db, "stock_lots", CO_B, SERIAL)["is_active"] is True
        assert _digest(db, CO_B) == before_b
        # -2 sonra +2 kendi lotunu 5'te bırakır. Seri -1 sonra +1 yine 1 ve aktiftir.
        assert _row(db, "stock_lots", CO_A, LOT)["quantity"] == 5
        assert _row(db, "stock_lots", CO_A, LOT)["is_active"] is True
        assert _row(db, "stock_lots", CO_A, SERIAL)["quantity"] == 1
        assert _row(db, "stock_lots", CO_A, SERIAL)["is_active"] is True
        for rec in caplog.records:
            if rec.name != "TamKobiERP":
                continue
            text = rec.getMessage()
            assert CO_A not in text
            assert CO_B not in text
            assert LOT not in text
            assert SERIAL not in text
            assert SECRET_WH not in text

        _run(server._apply_lot_delta({"lot_id": LOT, "quantity": 5}, -1.0, CO_A))
        assert _row(db, "stock_lots", CO_A, LOT)["quantity"] == 0
        assert _row(db, "stock_lots", CO_A, LOT)["is_active"] is False
        _run(server._apply_lot_delta({"lot_id": SERIAL, "quantity": 1}, -1.0, CO_A))
        assert _row(db, "stock_lots", CO_A, SERIAL)["quantity"] == 0
        assert _row(db, "stock_lots", CO_A, SERIAL)["is_active"] is False
        _run(server._apply_lot_delta({"lot_id": SERIAL, "quantity": 1}, 1.0, CO_A))
        assert _row(db, "stock_lots", CO_A, SERIAL)["quantity"] == 1
        assert _row(db, "stock_lots", CO_A, SERIAL)["is_active"] is True
        assert _row(db, "stock_lots", CO_B, LOT)["quantity"] == 9
        assert _row(db, "stock_lots", CO_B, SERIAL)["quantity"] == 1
        assert _digest(db, CO_B) == before_b
    finally:
        _restore(prev)


def test_invoice_lot_delta_uses_invoice_company():
    db = _DB()
    _seed_pair(db, ("stock_lots", _lot))
    prev = _bind(db)
    try:
        before_b = _digest(db, CO_B)
        sales = {
            "invoice_type": "sales",
            "company_id": CO_A,
            "items": [{"lot_id": LOT, "quantity": 1}],
        }
        _run(server._apply_invoice_effects(sales))
        assert _row(db, "stock_lots", CO_A, LOT)["quantity"] == 4
        assert _row(db, "stock_lots", CO_B, LOT)["quantity"] == 9
        _run(server._reverse_invoice_effects(sales))
        assert _row(db, "stock_lots", CO_A, LOT)["quantity"] == 5
        assert _row(db, "stock_lots", CO_B, LOT)["quantity"] == 9

        purchase = {
            "invoice_type": "purchase",
            "company_id": CO_A,
            "stock_effects_applied": False,
            "items": [{"lot_id": LOT, "quantity": 2}],
        }
        _run(server._apply_invoice_effects(purchase))
        assert _row(db, "stock_lots", CO_A, LOT)["quantity"] == 7
        assert _row(db, "stock_lots", CO_B, LOT)["quantity"] == 9

        bare = {"invoice_type": "sales", "items": [{"lot_id": LOT, "quantity": 4}]}
        _run(server._apply_invoice_effects(bare))
        _run(server._reverse_invoice_effects(bare))
        assert _row(db, "stock_lots", CO_A, LOT)["quantity"] == 7
        assert _row(db, "stock_lots", CO_B, LOT)["quantity"] == 9
        assert _digest(db, CO_B) == before_b
    finally:
        _restore(prev)


def test_product_movements_hide_other_company():
    user = _user(CO_A)
    db = _DB()
    _add(db, "products", _product(CO_A))
    _add(db, "products", _product(CO_B))
    _add(db, "stock_movements", {
        "_id": "mov-b",
        "company_id": CO_B,
        "product_id": PROD,
        "product_name": "UrunB",
        "change": -3,
        "new_stock": SECRET_STOCK,
        "reason": SECRET_REASON,
        "date": "2026-03-02T00:00:00+00:00",
    })
    _add(db, "stock_movements", {
        "_id": "mov-a",
        "company_id": CO_A,
        "product_id": PROD,
        "product_name": "UrunA",
        "change": 2,
        "new_stock": 10,
        "reason": "sayim-a",
        "date": "2026-03-01T00:00:00+00:00",
    })
    _add(db, "products", {
        "_id": "prod-bare",
        "name": "Bare",
        "sku": "BARE",
        "stock_quantity": 1,
    })
    _add(db, "stock_movements", {
        "_id": "mov-bare",
        "product_id": "prod-bare",
        "change": 1,
        "new_stock": SECRET_STOCK,
        "reason": SECRET_REASON,
        "date": "2026-03-03T00:00:00+00:00",
    })
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        body = _run(server.list_product_movements(PROD, 80, user))
        reasons = [row.get("reason") for row in body["movements"]]
        assert "sayim-a" in reasons
        assert SECRET_REASON not in reasons
        assert str(SECRET_STOCK) not in json.dumps(body)
        assert _digest(db, CO_B) == before

        bare = _run(server.list_product_movements("prod-bare", 80, user))
        assert SECRET_REASON not in [row.get("reason") for row in bare["movements"]]
        assert bare["movements"] == []
    finally:
        _restore(prev)


def test_stock_count_writes_stay_in_company(monkeypatch):
    monkeypatch.setattr(server.tenant_access, "get_tenant_doc", _own)
    user = _user(CO_A)
    db = _DB()
    _seed_pair(db, ("products", _product), ("warehouses", _warehouse), ("stock_counts", _count))
    _add(db, "products", _product(CO_B, PROD_B, stock_quantity=3, name="UrunB-Tek", barcode="BAR-B2"))
    _add(db, "products", _product(
        CO_B, PROD_VAR, stock_quantity=9, barcode="BAR-V",
        variants=[{"variant_id": "v1", "name": "Kirmizi", "sku": "V-B", "barcode": "BAR-V1", "stock": 9}],
    ))
    _add(db, "products", _product(
        CO_A, PROD_VAR, stock_quantity=4, barcode="BAR-V",
        variants=[{"variant_id": "v1", "name": "Kirmizi", "sku": "V-A", "barcode": "BAR-V1", "stock": 4}],
    ))
    _add(db, "products", _product(CO_A, "prod-quiet", stock_quantity=1, barcode="BAR-Q"))
    _add(db, "warehouses", _warehouse(CO_B, WH_B, name=SECRET_WH))
    _row(db, "stock_counts", CO_A, COUNT)["items"] = [
        {"product_id": PROD, "variant_id": None, "product_name": "UrunA", "expected": 10, "counted": 8, "scanned": True},
        {"product_id": PROD_B, "variant_id": None, "product_name": "UrunB-Tek", "expected": 3, "counted": 1, "scanned": True},
        {"product_id": PROD_VAR, "variant_id": "v1", "product_name": "UrunA - Kirmizi", "expected": 4, "counted": 2, "scanned": True},
        {"product_id": "prod-quiet", "variant_id": None, "product_name": "Sessiz", "expected": 1, "counted": 99, "scanned": False},
    ]
    _row(db, "stock_counts", CO_B, COUNT)["items"] = [
        {"product_id": PROD, "variant_id": None, "product_name": "UrunB", "expected": 50, "counted": 50, "scanned": False},
    ]
    _row(db, "stock_counts", CO_B, COUNT)["status"] = "open"
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        created = _run(server.create_stock_count({"warehouse_id": WH_B, "name": "Yeni sayim"}, user))
        assert created["warehouse_name"] == "Tüm Depolar"
        assert SECRET_WH not in json.dumps(created)
        assert created["company_id"] == CO_A
        named = _run(server.create_stock_count({"warehouse_id": WH, "name": "Depo sayimi"}, user))
        assert named["warehouse_name"] == "DepoA"
        assert SECRET_WH not in json.dumps(named)

        scanned = _run(server.scan_stock_count(COUNT, {"barcode": "BAR-A", "quantity": 1}, user))
        assert scanned["status"] == "success"
        assert scanned["item"]["counted"] == 9
        assert _row(db, "stock_counts", CO_B, COUNT)["items"][0]["counted"] == 50
        assert _row(db, "stock_counts", CO_B, COUNT)["warehouse_name"] == SECRET_WH

        edited = _run(server.set_stock_count_item(COUNT, {
            "product_id": PROD, "variant_id": None, "counted": 8,
        }, user))
        assert edited["company_id"] == CO_A
        own_item = next(i for i in edited["items"] if i["product_id"] == PROD and not i.get("variant_id"))
        assert own_item["counted"] == 8
        assert _row(db, "stock_counts", CO_B, COUNT)["items"][0]["counted"] == 50

        done = _run(server.complete_stock_count(COUNT, {"apply": True, "only_scanned": True}, user))
        assert done["status"] == "success"
        assert done["adjusted"] == 2
        assert _row(db, "products", CO_A, PROD)["stock_quantity"] == 8
        assert _row(db, "products", CO_B, PROD)["stock_quantity"] == 50
        assert _row(db, "products", CO_B, PROD_B)["stock_quantity"] == 3
        assert _row(db, "products", CO_A, PROD_VAR)["variants"][0]["stock"] == 2
        assert _row(db, "products", CO_B, PROD_VAR)["variants"][0]["stock"] == 9
        assert _row(db, "products", CO_B, PROD_VAR)["stock_quantity"] == 9
        assert _row(db, "products", CO_A, "prod-quiet")["stock_quantity"] == 1
        assert _row(db, "stock_counts", CO_A, COUNT)["status"] == "completed"
        assert _row(db, "stock_counts", CO_B, COUNT)["status"] == "open"
        moves = [row for row in db.stock_movements.docs if row.get("reason") == "Stok Sayımı: SayimA"]
        assert len(moves) == 2
        assert all(row.get("company_id") == CO_A for row in moves)
        assert all(row.get("company_id") for row in db.stock_movements.docs)
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_warehouse_writes_stay_in_company(monkeypatch):
    monkeypatch.setattr(server.tenant_access, "get_tenant_doc", _own)
    user = _user(CO_A)
    db = _DB()
    _seed_pair(db, ("products", _product), ("warehouses", _warehouse))
    _add(db, "warehouses", _warehouse(CO_B, WH_B, name=SECRET_WH))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        with pytest.raises(HTTPException) as denied:
            _run(server.create_warehouse(Warehouse(
                company_id=CO_B, name="Sizma", code="S", location="L",
            ), user))
        assert denied.value.status_code == 403
        assert _digest(db, CO_B) == before

        created = _run(server.create_warehouse(Warehouse(
            company_id="", name="Depo yeni", code="Y", location="L",
        ), user))
        assert created["company_id"] == CO_A
        stored = next(row for row in db.warehouses.docs if row.get("name") == "Depo yeni")
        assert stored["company_id"] == CO_A

        with pytest.raises(HTTPException) as foreign_wh:
            _run(server.create_warehouse_transfer(WarehouseTransfer(
                company_id=CO_A, transfer_number="", source_warehouse_id=WH_B,
                target_warehouse_id=WH, product_id=PROD, product_name="UrunA", quantity=2,
            ), user))
        assert foreign_wh.value.status_code == 404
        assert foreign_wh.value.detail == "Depo bulunamadı."
        assert _row(db, "products", CO_A, PROD)["warehouse_id"] == WH
        assert db.warehouse_transfers.docs == []

        moved = _run(server.create_warehouse_transfer(WarehouseTransfer(
            company_id="", transfer_number="", source_warehouse_id=WH,
            target_warehouse_id="main_warehouse", product_id=PROD, product_name="UrunA", quantity=2,
        ), user))
        assert moved["company_id"] == CO_A
        assert moved["source_warehouse_id"] == WH
        assert moved["target_warehouse_id"] == "main_warehouse"
        assert _row(db, "products", CO_A, PROD)["warehouse_id"] == "main_warehouse"
        assert _row(db, "products", CO_B, PROD)["warehouse_id"] == WH
        assert _row(db, "warehouses", CO_B, WH)["name"] == SECRET_WH
        transfer = next(row for row in db.warehouse_transfers.docs if row.get("product_id") == PROD)
        assert transfer["company_id"] == CO_A
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_stock_lot_insert_uses_product_company(monkeypatch):
    monkeypatch.setattr(server.tenant_access, "get_tenant_doc", _own)
    user = _user(CO_A)
    db = _DB()
    _seed_pair(db, ("products", _product))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        with pytest.raises(HTTPException) as denied:
            _run(server.create_stock_lot({
                "company_id": CO_B, "product_id": PROD, "quantity": 2, "lot_number": "L-X",
            }, user))
        assert denied.value.status_code == 403
        assert _digest(db, CO_B) == before

        created = _run(server.create_stock_lot({
            "product_id": PROD, "quantity": 2, "lot_number": "L-A", "tracking_type": "lot",
        }, user))
        assert created["company_id"] == CO_A
        stored = next(row for row in db.stock_lots.docs if row.get("lot_number") == "L-A")
        assert stored["company_id"] == CO_A
        assert stored["quantity"] == 2
        assert _row(db, "products", CO_A, PROD)["stock_quantity"] == 12
        assert _row(db, "products", CO_B, PROD)["stock_quantity"] == 50
        move = next(row for row in db.stock_movements.docs if row.get("lot_id") == stored["_id"])
        assert move["company_id"] == CO_A
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_insert_company_stays_after_stamp(monkeypatch):
    monkeypatch.setattr(server.tenant_access, "get_tenant_doc", _own)
    user = _user(CO_A)
    db = _DB()
    _add(db, "products", _product(CO_A))
    prev = _bind(db)
    traced = sys.gettrace()

    def _stamp(frame, event, arg):
        if event == "line" and frame.f_code.co_name in (
            "create_stock_lot", "create_warehouse", "create_warehouse_transfer",
        ):
            blob = frame.f_locals.get("doc")
            if isinstance(blob, dict):
                blob["company_id"] = CO_B
        return _stamp

    sys.settrace(_stamp)
    try:
        _run(server.create_stock_lot({
            "product_id": PROD, "quantity": 1, "lot_number": "Damgali", "tracking_type": "lot",
        }, user))
        lot = next(row for row in db.stock_lots.docs if row.get("lot_number") == "Damgali")
        assert lot["company_id"] == CO_A

        _run(server.create_warehouse(Warehouse(
            company_id=CO_A, name="Damgali depo", code="D", location="L",
        ), user))
        wh = next(row for row in db.warehouses.docs if row.get("name") == "Damgali depo")
        assert wh["company_id"] == CO_A

        _run(server.create_warehouse_transfer(WarehouseTransfer(
            company_id=CO_A, transfer_number="TRF-DAMGA", source_warehouse_id="main_warehouse",
            target_warehouse_id=wh["_id"], product_id=PROD, product_name="UrunA", quantity=1,
        ), user))
        transfer = next(row for row in db.warehouse_transfers.docs if row.get("transfer_number") == "TRF-DAMGA")
        assert transfer["company_id"] == CO_A
        assert all(row.get("company_id") != CO_B for row in db.stock_lots.docs)
        assert all(row.get("company_id") != CO_B for row in db.warehouses.docs)
        assert all(row.get("company_id") != CO_B for row in db.warehouse_transfers.docs)
    finally:
        sys.settrace(traced)
        _restore(prev)


def test_insert_company_id_is_after_spread():
    tree = ast.parse(Path(server.__file__).read_text(encoding="utf-8"))
    wanted = {"create_stock_lot", "create_warehouse", "create_warehouse_transfer"}
    found = set()
    for fn in ast.walk(tree):
        if not isinstance(fn, ast.AsyncFunctionDef) or fn.name not in wanted:
            continue
        inserts = [
            node for node in ast.walk(fn)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "insert_one"
        ]
        assert inserts
        for call in inserts:
            arg = call.args[0]
            assert isinstance(arg, ast.Dict)
            last_spread = max((i for i, key in enumerate(arg.keys) if key is None), default=-1)
            company_at = next(
                i for i, key in enumerate(arg.keys)
                if isinstance(key, ast.Constant) and key.value == "company_id"
            )
            assert company_at > last_spread
        found.add(fn.name)
    assert found == wanted


def test_lot_delta_calls_pass_company():
    tree = ast.parse(Path(server.__file__).read_text(encoding="utf-8"))
    callers = {"_pos_return_core", "_apply_invoice_effects", "_reverse_invoice_effects"}
    seen = {name: 0 for name in callers}
    for fn in ast.walk(tree):
        if not isinstance(fn, ast.AsyncFunctionDef) or fn.name not in callers:
            continue
        for node in ast.walk(fn):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            name = func.id if isinstance(func, ast.Name) else getattr(func, "attr", "")
            if name != "_apply_lot_delta":
                continue
            assert len(node.args) == 3
            seen[fn.name] += 1
    assert seen == {
        "_pos_return_core": 2,
        "_apply_invoice_effects": 2,
        "_reverse_invoice_effects": 2,
    }


def test_wave15_baseline_keys_removed():
    base = allowlist.TENANT_SCOPE_BASELINE
    present = [key for key in _REMOVED if key in base]
    assert present == []
    assert len(_REMOVED) == 20
    assert len(set(_REMOVED)) == 20
    assert all(key[0] == "server.py" for key in _REMOVED)
    assert _KEPT in base
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
