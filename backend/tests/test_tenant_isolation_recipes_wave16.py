"""Reçete (BOM) ve eksik ürün planı kiracı dalgası 16.

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

import rbac  # noqa: E402
import server  # noqa: E402
import tenant_scope_allowlist as allowlist  # noqa: E402
import trash  # noqa: E402
from dashboard_memdb import MemColl, MemDB, _split_field_ops  # noqa: E402
from models import Recipe  # noqa: E402
from mysql_store import match_query  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
PROD = "prod-shared"
RECIPE = "recipe-shared"
ORDER = "order-shared"
SES = "ses-shared"
SECRET_NAME = "UrunB-Gizli"
SECRET_STOCK = 4242
SECRET_PRICE = 777

_REMOVED = (
    ("server.py", "_fill_material_costs", "products", "find_one"),
    ("server.py", "_open_po", "recipes", "update_one"),
    ("server.py", "_open_po", "work_orders", "update_many"),
    ("server.py", "_rebuild_open_work_orders_for_recipe", "production_orders", "find"),
    ("server.py", "_rebuild_open_work_orders_for_recipe", "recipes", "find_one"),
    ("server.py", "_rebuild_open_work_orders_for_recipe", "work_orders", "count_documents"),
    ("server.py", "_requirements", "products", "find"),
    ("server.py", "_restore_recipe", "products", "update_one"),
    ("server.py", "copy_recipe", "products", "update_one"),
    ("server.py", "copy_recipe", "recipes", "insert_one"),
    ("server.py", "create_production_recipe_from_order", "orders", "find_one"),
    ("server.py", "create_production_recipe_from_order", "products", "find"),
    ("server.py", "create_production_recipe_from_order", "products", "update_one"),
    ("server.py", "create_production_recipe_from_order", "recipes", "insert_one"),
    ("server.py", "create_production_recipe_from_order", "recipes", "update_one"),
    ("server.py", "create_recipe", "recipes", "insert_one"),
    ("server.py", "delete_recipe", "products", "update_one"),
    ("server.py", "delete_recipe", "recipes", "count_documents"),
    ("server.py", "production_missing_plan", "order_pick_sessions", "find"),
    ("server.py", "production_missing_plan", "orders", "find"),
    ("server.py", "production_missing_plan", "products", "find"),
    ("server.py", "production_missing_plan_create", "order_pick_sessions", "find_one"),
    ("server.py", "production_missing_plan_create", "order_pick_sessions", "update_one"),
    ("server.py", "update_recipe", "recipes", "find_one"),
    ("server.py", "update_recipe", "recipes", "update_one"),
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

    async def delete_many(self, query=None):
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
        "name": "UrunA" if company_id == CO_A else SECRET_NAME,
        "sku": "SKU-A" if company_id == CO_A else "SKU-B",
        "stock_quantity": 2 if company_id == CO_A else SECRET_STOCK,
        "purchase_price": 4 if company_id == CO_A else SECRET_PRICE,
        "has_recipe": False,
        "unit": "Adet",
        "type": "product",
    }
    row.update(extra)
    return row


def _recipe(company_id, doc_id=RECIPE, **extra):
    row = {
        "_id": doc_id,
        "company_id": company_id,
        "name": "ReceteA" if company_id == CO_A else "ReceteB-Gizli",
        "code": "BOM-A" if company_id == CO_A else "BOM-B-GIZLI",
        "finished_product_id": PROD,
        "finished_product_name": "UrunA" if company_id == CO_A else SECRET_NAME,
        "target_quantity": 1,
        "unit": "Adet",
        "materials": [{
            "product_id": PROD,
            "product_name": "KalemA" if company_id == CO_A else SECRET_NAME,
            "quantity": 5,
            "unit": "Adet",
            "cost_per_unit": 2,
            "wastage_percent": 0,
            "steps": [{"no": 1, "name": "KesimA" if company_id == CO_A else "GizliAdim", "station": "CNC", "duration_min": 1}],
        }],
        "steps": [],
        "labor_cost": 0,
        "overhead_cost": 0,
        "is_active": True,
        "one_time": False,
    }
    row.update(extra)
    return row


def test_recipe_writes_stay_in_company(monkeypatch):
    monkeypatch.setattr(server.tenant_access, "get_tenant_doc", _own)
    user = _user(CO_A)
    db = _DB()
    _add(db, "products", _product(CO_B))
    _add(db, "products", _product(CO_A))
    _add(db, "recipes", _recipe(CO_B))
    _add(db, "recipes", _recipe(CO_A))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        created = _run(server.create_recipe(Recipe(
            company_id=CO_A,
            name="Yeni BOM",
            finished_product_id=PROD,
            finished_product_name="UrunA",
            materials=[{
                "product_id": PROD,
                "product_name": "Kalem",
                "quantity": 2,
                "unit": "Adet",
            }],
        ), user))
        assert created["company_id"] == CO_A
        stored = next(row for row in db.recipes.docs if row.get("name") == "Yeni BOM")
        assert stored["company_id"] == CO_A
        assert _row(db, "products", CO_A, PROD)["has_recipe"] is True
        assert _row(db, "products", CO_B, PROD)["has_recipe"] is False
        assert _row(db, "products", CO_B, PROD)["stock_quantity"] == SECRET_STOCK
        assert _digest(db, CO_B) == before

        copied = _run(server.copy_recipe(RECIPE, user))
        assert copied["company_id"] == CO_A
        assert copied["id"] != RECIPE
        copy_row = _row(db, "recipes", CO_A, copied["id"])
        assert copy_row["company_id"] == CO_A
        assert _row(db, "recipes", CO_B, RECIPE)["name"] == "ReceteB-Gizli"
        assert _row(db, "products", CO_B, PROD)["has_recipe"] is False
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_fill_costs_ignores_other_company_and_blank_company():
    db = _DB()
    _add(db, "products", _product(CO_B))
    _add(db, "products", _product(CO_A))
    prev = _bind(db)
    try:
        blank = [{"product_id": PROD, "product_name": "Kalem", "quantity": 1, "unit": "Adet"}]
        _run(server._fill_material_costs(blank, None))
        _run(server._fill_material_costs(blank, ""))
        assert blank[0]["product_name"] == "Kalem"
        assert "cost_per_unit" not in blank[0]
        assert _row(db, "products", CO_B, PROD)["stock_quantity"] == SECRET_STOCK

        own = [{"product_id": PROD, "product_name": "Kalem", "quantity": 1, "unit": "Adet"}]
        _run(server._fill_material_costs(own, CO_A))
        assert own[0]["cost_per_unit"] == 4
        assert own[0]["product_name"] == "Kalem"
        assert SECRET_NAME not in json.dumps(own)
    finally:
        _restore(prev)


def test_requirements_use_caller_stock_and_fail_closed():
    recipe = _recipe(
        CO_A, "rec-req", finished_product_id="finished-a", finished_product_name="MamulA",
        materials=[{
            "product_id": PROD, "product_name": "KalemA", "quantity": 1, "unit": "Adet",
            "cost_per_unit": 2, "wastage_percent": 0,
        }],
    )
    db = _DB()
    _add(db, "products", _product(CO_A))
    _add(db, "products", _product(CO_B))
    prev = _bind(db)
    try:
        closed = _run(server._requirements(recipe, 5, stock_company_id=""))
        row = next(item for item in closed if item["product_id"] == PROD)
        assert row["in_stock"] == 0
        assert row["shortage"] == 5
        assert SECRET_NAME not in json.dumps(closed)
        none_stock = _run(server._requirements(recipe, 5, stock_company_id=None))
        assert next(item for item in none_stock if item["product_id"] == PROD)["in_stock"] == 0

        owned = _run(server._requirements(recipe, 5, stock_company_id=CO_A))
        own_row = next(item for item in owned if item["product_id"] == PROD)
        assert own_row["in_stock"] == 2
        assert own_row["shortage"] == 3
        assert own_row["product_name"] != SECRET_NAME
        assert _row(db, "products", CO_B, PROD)["stock_quantity"] == SECRET_STOCK
    finally:
        _restore(prev)


def test_production_order_requirements_pass_order_company():
    user = _user(CO_A)
    recipe = _recipe(
        CO_A, "rec-req", finished_product_id="finished-a", finished_product_name="MamulA",
        materials=[{
            "product_id": PROD, "product_name": "KalemA", "quantity": 1, "unit": "Adet",
            "cost_per_unit": 2, "wastage_percent": 0,
        }],
    )
    db = _DB()
    _add(db, "products", _product(CO_A, stock_quantity=2))
    _add(db, "products", _product(CO_B))
    _add(db, "recipes", recipe)
    _add(db, "production_orders", {
        "_id": "po-short",
        "company_id": CO_A,
        "status": "planned",
        "recipe_id": "rec-req",
        "planned_quantity": 5,
        "order_code": "URT-A",
        "shortages": [],
        "finished_product_id": "finished-a",
        "finished_product_name": "MamulA",
    })
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        created = _run(server.create_production_order({
            "company_id": CO_A,
            "recipe_id": "rec-req",
            "planned_quantity": 5,
        }, user))
        req = next(item for item in created["requirements"] if item["product_id"] == PROD)
        assert req["in_stock"] == 2
        assert req["shortage"] == 3
        assert SECRET_NAME not in json.dumps(created["requirements"])

        produced = _run(server.produce_production_order_shortages("po-short", {}, user))
        assert produced["created"][0]["qty"] == 3
        assert produced["created"][0]["product_id"] == PROD
        assert _row(db, "products", CO_A, PROD)["stock_quantity"] == 2
        assert _row(db, "products", CO_B, PROD)["stock_quantity"] == SECRET_STOCK
        assert _row(db, "products", CO_B, PROD)["name"] == SECRET_NAME
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_order_recipe_does_not_import_other_company_product(monkeypatch):
    monkeypatch.setattr(server.tenant_access, "get_tenant_doc", _own)
    user = _user(CO_A)
    db = _DB()
    _add(db, "products", _product(CO_B, "prod-b-only", has_recipe=False))
    _add(db, "orders", {
        "_id": "ord-num-b",
        "company_id": CO_B,
        "order_number": "SIP-SHARED",
        "customer_name": "MusteriGizli",
        "items": [{"product_id": "prod-b-only", "quantity": 2}],
    })
    _add(db, "orders", {
        "_id": ORDER,
        "company_id": CO_B,
        "order_number": "SIP-B",
        "customer_name": "MusteriGizli",
        "items": [],
    })
    _add(db, "orders", {
        "_id": "ord-num-a",
        "company_id": CO_A,
        "order_number": "SIP-SHARED",
        "customer_name": "MusteriA",
        "items": [{"product_id": "prod-b-only", "quantity": 2}],
    })
    _add(db, "orders", {
        "_id": ORDER,
        "company_id": CO_A,
        "order_number": "SIP-A",
        "customer_name": "MusteriA",
        "items": [],
    })
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        out = _run(server.create_production_recipe_from_order(
            "SIP-SHARED", {"create_production_order": True, "station": "CNC-A"}, user,
        ))
        assert out["reused"] is False
        assert out["recipe"]["company_id"] == CO_A
        blob = json.dumps(out, default=str)
        assert SECRET_NAME not in blob
        assert "MusteriGizli" not in blob
        assert str(SECRET_PRICE) not in blob
        stored = next(row for row in db.recipes.docs if row.get("company_id") == CO_A)
        assert stored["company_id"] == CO_A
        assert SECRET_NAME not in json.dumps(stored, default=str)
        assert _row(db, "products", CO_B, "prod-b-only")["has_recipe"] is False
        assert _row(db, "orders", CO_B, "ord-num-b").get("sent_to_production_at") is None
        assert _digest(db, CO_B) == before

        empty = {"_id": "u0", "id": "u0", "role": "admin", "company_ids": [], "active_company_id": ""}
        with pytest.raises(HTTPException) as exc:
            _run(server.create_production_recipe_from_order("SIP-SHARED", {}, empty))
        assert exc.value.status_code == 404
        assert exc.value.detail == "Sipariş bulunamadı."
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_delete_clears_own_has_recipe_when_other_company_keeps_recipe():
    user = _user(CO_A)
    db = _DB()
    _add(db, "products", _product(CO_B, has_recipe=True))
    _add(db, "products", _product(CO_A, has_recipe=True))
    _add(db, "recipes", _recipe(CO_B, "rec-b"))
    _add(db, "recipes", _recipe(CO_A, "rec-a"))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        out = _run(server.delete_recipe("rec-a", user))
        assert out["message"] == "Reçete çöp kutusuna taşındı."
        assert _row(db, "products", CO_A, PROD)["has_recipe"] is False
        assert _row(db, "products", CO_B, PROD)["has_recipe"] is True
        assert _row(db, "recipes", CO_B, "rec-b")["name"] == "ReceteB-Gizli"
        assert _row(db, "recipes", CO_A, "rec-a") is None
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_restore_recipe_updates_only_own_product():
    db = _DB()
    _add(db, "products", _product(CO_B, has_recipe=False))
    _add(db, "products", _product(CO_A, has_recipe=False))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        _run(server._restore_recipe({"_id": "rec-a", "finished_product_id": PROD}, None))
        assert _row(db, "products", CO_A, PROD)["has_recipe"] is False
        assert _row(db, "products", CO_B, PROD)["has_recipe"] is False
        _run(server._restore_recipe({
            "_id": "rec-a",
            "company_id": CO_A,
            "finished_product_id": PROD,
        }, None))
        assert _row(db, "products", CO_A, PROD)["has_recipe"] is True
        assert _row(db, "products", CO_B, PROD)["has_recipe"] is False
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_rebuild_open_work_orders_skips_other_company(monkeypatch):
    monkeypatch.setattr(server.tenant_access, "get_tenant_doc", _own)
    user = _user(CO_A)
    db = _DB()
    _add(db, "recipes", _recipe(CO_B))
    _add(db, "recipes", _recipe(CO_A))
    _add(db, "production_orders", {
        "_id": "po-b",
        "company_id": CO_B,
        "recipe_id": RECIPE,
        "status": "planned",
        "planned_quantity": 1,
        "finished_product_name": SECRET_NAME,
        "order_code": "URT-B",
    })
    _add(db, "production_orders", {
        "_id": "po-a",
        "company_id": CO_A,
        "recipe_id": RECIPE,
        "status": "planned",
        "planned_quantity": 1,
        "finished_product_name": "UrunA",
        "order_code": "URT-A",
    })
    _add(db, "work_orders", {
        "_id": "wo-b",
        "company_id": CO_B,
        "order_id": "po-b",
        "status": "ready",
        "step_name": "GizliAdim",
    })
    _add(db, "work_orders", {
        "_id": "wo-a",
        "company_id": CO_A,
        "order_id": "po-a",
        "status": "ready",
        "step_name": "Eski",
    })
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        assert _run(server._rebuild_open_work_orders_for_recipe(RECIPE, "")) == 0
        assert _run(server._rebuild_open_work_orders_for_recipe(RECIPE, None)) == 0
        assert _digest(db, CO_B) == before
        direct = _run(server._rebuild_open_work_orders_for_recipe(RECIPE, CO_A))
        assert direct == 1
        assert _row(db, "work_orders", CO_B, "wo-b")["step_name"] == "GizliAdim"
        assert _digest(db, CO_B) == before

        out = _run(server.update_recipe(RECIPE, {
            "steps": [{"name": "PaketA", "station": "PAKET"}],
            "materials": _recipe(CO_A)["materials"],
        }, user))
        assert out.get("work_orders_rebuilt") == 1
        assert _row(db, "recipes", CO_B, RECIPE)["name"] == "ReceteB-Gizli"
        assert _row(db, "work_orders", CO_B, "wo-b")["step_name"] == "GizliAdim"
        assert _digest(db, CO_B) == before
        assert all(row.get("company_id") == CO_A for row in db.work_orders.docs if row.get("order_id") == "po-a")
    finally:
        _restore(prev)


def test_missing_plan_hides_other_company_stock_and_session():
    user = _user(CO_A)
    db = _DB()
    _add(db, "products", _product(CO_A, stock_quantity=3, has_recipe=False))
    _add(db, "products", _product(CO_B, stock_quantity=SECRET_STOCK, has_recipe=True))
    _add(db, "order_pick_sessions", {
        "_id": SES,
        "company_id": CO_A,
        "order_id": ORDER,
        "items": [{
            "product_id": PROD,
            "product_name": "TaslakA",
            "ordered_qty": 5,
            "picked_qty": 1,
        }],
    })
    _add(db, "order_pick_sessions", {
        "_id": SES,
        "company_id": CO_B,
        "order_id": ORDER,
        "items": [{
            "product_id": PROD,
            "product_name": "GizliOturum",
            "ordered_qty": 9,
            "picked_qty": 0,
        }],
    })
    _add(db, "orders", {
        "_id": ORDER,
        "company_id": CO_A,
        "order_number": "SIP-A",
        "customer_name": "MusteriA",
        "items": [],
    })
    _add(db, "orders", {
        "_id": ORDER,
        "company_id": CO_B,
        "order_number": "SIP-B",
        "customer_name": "MusteriGizli",
        "items": [],
    })
    _add(db, "notifications", {
        "_id": "n-a",
        "company_id": CO_A,
        "type": "order_pick_missing",
        "is_read": False,
        "created_at": "2026-10-02T00:00:00",
        "ref_id": ORDER,
        "order_number": "SIP-A",
    })
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        plan = _run(server.production_missing_plan(CO_A, user))
        blob = json.dumps(plan, default=str)
        assert SECRET_NAME not in blob
        assert "GizliOturum" not in blob
        assert "MusteriGizli" not in blob
        assert str(SECRET_STOCK) not in blob
        assert plan["count"] == 1
        item = plan["items"][0]
        assert item["product_name"] == "UrunA"
        assert item["stock_quantity"] == 3
        assert item["missing_qty"] == 4
        assert item["sources"][0]["customer_name"] == "MusteriA"
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_missing_plan_create_does_not_write_other_company_session():
    user = _user(CO_A)
    db = _DB()
    _add(db, "products", _product(CO_B))
    _add(db, "products", _product(CO_A))
    _add(db, "order_pick_sessions", {
        "_id": "ses-b-only",
        "company_id": CO_B,
        "order_id": "order-b-only",
        "sent_to_production_at": "B-OLD",
        "production_orders": [{"product_id": "keep", "order_code": "URT-B"}],
    })
    _add(db, "order_pick_sessions", {
        "_id": SES,
        "company_id": CO_B,
        "order_id": ORDER,
        "sent_to_production_at": "B-OLD",
        "production_orders": [{"product_id": "keep", "order_code": "URT-B"}],
    })
    _add(db, "order_pick_sessions", {
        "_id": SES,
        "company_id": CO_A,
        "order_id": ORDER,
        "items": [],
    })
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        out = _run(server.production_missing_plan_create({
            "company_id": CO_A,
            "items": [{
                "product_id": PROD,
                "product_name": "UrunA",
                "planned_quantity": 2,
                "sources": [
                    {"order_id": "order-b-only", "order_number": "SIP-B"},
                    {"order_id": ORDER, "order_number": "SIP-A"},
                ],
            }],
        }, user))
        assert out["status"] == "ok"
        assert len(out["created"]) == 1
        own = _row(db, "order_pick_sessions", CO_A, SES)
        assert own.get("sent_to_production_at")
        assert own["production_orders"][0]["product_id"] == PROD
        foreign_only = _row(db, "order_pick_sessions", CO_B, "ses-b-only")
        assert foreign_only["sent_to_production_at"] == "B-OLD"
        assert foreign_only["production_orders"] == [{"product_id": "keep", "order_code": "URT-B"}]
        shared = _row(db, "order_pick_sessions", CO_B, SES)
        assert shared["sent_to_production_at"] == "B-OLD"
        assert shared["production_orders"] == [{"product_id": "keep", "order_code": "URT-B"}]
        assert _row(db, "products", CO_B, PROD)["has_recipe"] is False
        assert _row(db, "products", CO_B, PROD)["stock_quantity"] == SECRET_STOCK
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_wave16_baseline_keys_removed():
    base = allowlist.TENANT_SCOPE_BASELINE
    present = [key for key in _REMOVED if key in base]
    assert present == []
    assert len(_REMOVED) == 25
    assert len(set(_REMOVED)) == 25
    assert all(key[0] == "server.py" for key in _REMOVED)
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
