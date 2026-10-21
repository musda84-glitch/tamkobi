"""Stock, warehouse and production GET routes: route-level auth and company resolution.

In-process TestClient and a memory database. No live server and no port 8021.
"""
from __future__ import annotations

import asyncio
import copy
import inspect
import os
import sys
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Response
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-stock-production-get-routes-auth-jwt-secret-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import addons  # noqa: E402
import attendance  # noqa: E402
import auth_utils  # noqa: E402
import order_pick  # noqa: E402
import rbac  # noqa: E402
import saas  # noqa: E402
import server  # noqa: E402
from mysql_store import apply_update, match_query, new_upsert_doc, project_doc, sort_docs  # noqa: E402

COMP_A = "A"
COMP_B = "B"
NEXUS = "comp_nexus_main_01"
DENY = "Bu şirket hesabına erişiminiz yok."
_NOW = datetime.now(timezone.utc)
MONTH = _NOW.strftime("%Y-%m")
_PREV = _NOW.replace(day=1) - timedelta(days=1)
PREV = _PREV.strftime("%Y-%m")
_TODAY = _NOW.date()
EXP_SOON = (_TODAY + timedelta(days=4)).isoformat()
EXP_LATER = (_TODAY + timedelta(days=40)).isoformat()
EXP_EMPTY = (_TODAY - timedelta(days=2)).isoformat()
PERF_DAY = "2026-10-01"
PERF_RANGE = {"date_from": PERF_DAY, "date_to": PERF_DAY}


def _run(coro):
    return asyncio.run(coro)


class MemCursor:
    def __init__(self, docs):
        self._docs = docs
        self._sort = None

    def sort(self, key, direction=1):
        self._sort = [(key, direction)] if isinstance(key, str) else list(key)
        return self

    def _rows(self, length=None):
        rows = sort_docs(list(self._docs), self._sort) if self._sort else list(self._docs)
        if length is not None:
            rows = rows[: int(length)]
        return copy.deepcopy(rows)

    async def to_list(self, length=None):
        return self._rows(length)

    def __aiter__(self):
        rows = self._rows()

        async def _gen():
            for row in rows:
                yield row

        return _gen()


class MemColl:
    def __init__(self, name, db):
        self.name = name
        self.db = db
        self.docs = []

    def _note(self, op):
        self.db.writes.append({"coll": self.name, "op": op})

    def find(self, query=None, projection=None):
        matched = []
        for doc in self.docs:
            if match_query(doc, query or {}):
                matched.append(project_doc(doc, projection) if projection else doc)
        return MemCursor(matched)

    async def find_one(self, query=None, projection=None, sort=None):
        rows = [doc for doc in self.docs if match_query(doc, query or {})]
        if sort:
            rows = sort_docs(rows, sort)
        for doc in rows:
            return project_doc(doc, projection) if projection else copy.deepcopy(doc)
        return None

    async def count_documents(self, query=None):
        return sum(1 for doc in self.docs if match_query(doc, query or {}))

    async def distinct(self, field, query=None):
        seen = []
        for doc in self.docs:
            if not match_query(doc, query or {}):
                continue
            value = doc.get(field)
            if value not in seen:
                seen.append(value)
        return seen

    async def insert_one(self, doc):
        self._note("insert_one")
        self.docs.append(copy.deepcopy(doc))
        return SimpleNamespace(inserted_id=doc.get("_id"))

    async def insert_many(self, docs):
        self._note("insert_many")
        self.docs.extend(copy.deepcopy(list(docs)))
        return SimpleNamespace(inserted_ids=[d.get("_id") for d in docs])

    async def update_one(self, query, update, upsert=False):
        self._note("update_one")
        for i, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                self.docs[i] = apply_update(doc, update, query)
                return SimpleNamespace(modified_count=1, matched_count=1)
        if upsert:
            self.docs.append(new_upsert_doc(update, query))
            return SimpleNamespace(modified_count=0, matched_count=0, upserted_id=self.docs[-1].get("_id"))
        return SimpleNamespace(modified_count=0, matched_count=0)

    async def update_many(self, query, update):
        self._note("update_many")
        count = 0
        for i, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                self.docs[i] = apply_update(doc, update, query)
                count += 1
        return SimpleNamespace(modified_count=count, matched_count=count)

    async def delete_one(self, query):
        self._note("delete_one")
        return SimpleNamespace(deleted_count=0)

    async def delete_many(self, query):
        self._note("delete_many")
        return SimpleNamespace(deleted_count=0)

    async def create_index(self, *args, **kwargs):
        return None


class MemDB:
    def __init__(self):
        self._cols = {}
        self.writes = []

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = MemColl(name, self)
            self._cols[name] = coll
        return coll

    def __getitem__(self, name):
        return getattr(self, name)

    async def _ensure(self):
        return None


def _user(uid, company_ids, active, *, role="admin", superadmin=False):
    return {
        "_id": uid,
        "id": uid,
        "email": f"{uid}@example.com",
        "name": uid,
        "role": role,
        "is_active": True,
        "is_super_admin": superadmin,
        "company_ids": list(company_ids),
        "active_company_id": active,
    }


def _user_a():
    return _user("user-a", [COMP_A], COMP_A)


def _routes():
    return [
        (server.reorder_preview, server.get_current_user, "/api/products/reorder-preview", {}),
        (server.list_purchase_orders, server.get_current_user, "/api/purchase-orders", {}),
        (server.list_stock_lots, server.get_current_user, "/api/stock-lots", {}),
        (server.list_stock_counts, server.get_current_user, "/api/warehouses/stock-counts", {}),
        (server.list_warehouses, server.get_current_user, "/api/warehouses", {}),
        (server.list_warehouse_transfers, server.get_current_user, "/api/warehouses/transfers", {}),
        (server.list_recipes, server.get_current_user, "/api/production/recipes", {}),
        (server.production_missing_plan, server.get_current_user, "/api/production/missing-plan", {}),
        (server.production_order_kpis, server.get_current_user, "/api/production/kpis", {}),
        (server.list_production_orders, server.get_current_user, "/api/production/orders", {}),
        (server.list_work_orders, server.get_current_user, "/api/production/work-orders", {}),
        (server.list_stations, server.get_current_user, "/api/production/work-orders/stations", {}),
        (server.get_shopfloor_settings, server.get_current_user, "/api/production/work-orders/shopfloor-settings", {}),
        (server.get_pause_policy, server.get_current_user, "/api/production/work-orders/pause-policy", {}),
        (server.work_order_performance, server.get_current_user, "/api/production/work-orders/performance", PERF_RANGE),
        (order_pick.list_pickable, order_pick._user_dep, "/api/order-picks", {}),
    ]


def _invoke(fn, **kwargs):
    if fn is server.list_work_orders:
        kwargs.setdefault("response", Response())
    return _run(fn(**kwargs))


def _ids(body):
    if isinstance(body, dict):
        rows = body.get("lines") or body.get("items") or body.get("orders") or body.get("cheques") or []
        if rows and isinstance(rows, list) and isinstance(rows[0], dict):
            return [row.get("id") for row in rows]
        return []
    return [row.get("id") for row in body if isinstance(row, dict)]


def _no_foreign(text):
    assert "B-SECRET" not in text
    assert "NEXUS-ONLY" not in text


def _snapshot(db):
    return {name: copy.deepcopy(coll.docs) for name, coll in db._cols.items()}


def _seed(db):
    db.companies.docs.extend([
        {
            "_id": COMP_A, "name": "Firma A", "shopfloor_group_same_station": True,
            "work_parks": [{"id": "holzher", "name": "HOLZHER"}, {"id": "omaksan", "name": "OMAKSAN"}],
        },
        {
            "_id": COMP_B, "name": "Firma B", "shopfloor_group_same_station": False,
            "work_parks": [{"id": "gizli", "name": "B-SECRET-PARK"}],
        },
        {"_id": NEXUS, "name": "Nexus", "work_parks": [{"id": "nexus", "name": "NEXUS-ONLY"}]},
    ])
    db.products.docs.extend([
        {
            "_id": "prodLowA", "company_id": COMP_A, "name": "Urun A", "sku": "SKU-A", "unit": "Adet",
            "type": "product", "track_stock": True, "has_recipe": False, "stock_quantity": 1,
            "min_stock_alert": 5, "purchase_price": 12, "vat_rate": 20,
        },
        {
            "_id": "prodOkA", "company_id": COMP_A, "name": "Yeterli A", "sku": "SKU-OK", "unit": "Adet",
            "type": "product", "track_stock": True, "has_recipe": False, "stock_quantity": 10,
            "min_stock_alert": 2, "purchase_price": 3, "vat_rate": 20,
        },
        {
            "_id": "prodPlanA", "company_id": COMP_A, "name": "Plan A", "sku": "SKU-PLAN", "unit": "Adet",
            "type": "product", "track_stock": True, "has_recipe": True, "stock_quantity": 0,
            "min_stock_alert": 4, "purchase_price": 7, "vat_rate": 20,
        },
        {
            "_id": "prodLowB", "company_id": COMP_B, "name": "B-SECRET", "sku": "SKU-B", "unit": "Adet",
            "type": "product", "track_stock": True, "has_recipe": True, "stock_quantity": 0,
            "min_stock_alert": 9, "purchase_price": 99, "vat_rate": 20,
        },
        {
            "_id": "prodLowN", "company_id": NEXUS, "name": "NEXUS-ONLY", "sku": "SKU-N", "unit": "Adet",
            "type": "product", "track_stock": True, "has_recipe": True, "stock_quantity": 0,
            "min_stock_alert": 3, "purchase_price": 1, "vat_rate": 20,
        },
    ])
    db.contacts.docs.extend([
        {"_id": "ctA", "company_id": COMP_A, "name": "Tedarik A"},
        {"_id": "ctB", "company_id": COMP_B, "name": "B-SECRET"},
    ])
    db.invoices.docs.extend([
        {
            "_id": "invA", "company_id": COMP_A, "invoice_type": "purchase", "status": "issued",
            "issue_date": "2026-10-02", "contact_id": "ctA", "contact_name": "Tedarik A",
            "items": [{"product_id": "prodLowA", "unit_price": 44}],
        },
        {
            "_id": "invB", "company_id": COMP_B, "invoice_type": "purchase", "status": "issued",
            "issue_date": "2026-10-05", "contact_id": "ctB", "contact_name": "B-SECRET",
            "items": [{"product_id": "prodLowA", "unit_price": 999}],
        },
    ])
    db.purchase_orders.docs.extend([
        {"_id": "poOld", "company_id": COMP_A, "order_number": "VSP-A-1", "order_date": "2026-10-01",
         "order_status": "draft", "supplier_name": "Tedarik A"},
        {"_id": "poNew", "company_id": COMP_A, "order_number": "VSP-A-2", "order_date": "2026-10-03",
         "order_status": "sent", "supplier_name": "Tedarik A"},
        {"_id": "poB", "company_id": COMP_B, "order_number": "VSP-B-1", "order_date": "2026-10-04",
         "order_status": "draft", "supplier_name": "B-SECRET"},
        {"_id": "poN", "company_id": NEXUS, "order_number": "VSP-N-1", "order_date": "2026-10-04",
         "order_status": "draft", "supplier_name": "NEXUS-ONLY"},
    ])
    db.stock_lots.docs.extend([
        {"_id": "lotAempty", "company_id": COMP_A, "product_id": "prodLowA", "quantity": 0,
         "expiry_date": EXP_EMPTY, "is_active": True, "lot_number": "EMPTY"},
        {"_id": "lotA0", "company_id": COMP_A, "product_id": "prodLowA", "quantity": 1,
         "expiry_date": EXP_SOON, "is_active": True, "lot_number": "A0"},
        {"_id": "lotA1", "company_id": COMP_A, "product_id": "prodLowA", "quantity": 2,
         "expiry_date": EXP_LATER, "is_active": True, "lot_number": "A1"},
        {"_id": "lotAoff", "company_id": COMP_A, "product_id": "prodLowA", "quantity": 5,
         "expiry_date": EXP_SOON, "is_active": False, "lot_number": "OFF"},
        {"_id": "lotB", "company_id": COMP_B, "product_id": "prodLowB", "quantity": 9,
         "expiry_date": "2026-10-01", "is_active": True, "lot_number": "B-SECRET"},
        {"_id": "lotN", "company_id": NEXUS, "product_id": "prodLowN", "quantity": 1,
         "expiry_date": "2026-10-01", "is_active": True, "lot_number": "NEXUS-ONLY"},
    ])
    db.stock_counts.docs.extend([
        {"_id": "scA1", "company_id": COMP_A, "name": "Sayim A1", "created_at": "2026-10-01T00:00:00"},
        {"_id": "scA2", "company_id": COMP_A, "name": "Sayim A2", "created_at": "2026-10-04T00:00:00"},
        {"_id": "scB", "company_id": COMP_B, "name": "B-SECRET", "created_at": "2026-10-05T00:00:00"},
        {"_id": "scN", "company_id": NEXUS, "name": "NEXUS-ONLY", "created_at": "2026-10-05T00:00:00"},
    ])
    db.warehouses.docs.extend([
        {"_id": "whA1", "company_id": COMP_A, "name": "Depo A"},
        {"_id": "whB", "company_id": COMP_B, "name": "B-SECRET"},
        {"_id": "whA2", "company_id": COMP_A, "name": "Depo A2"},
        {"_id": "whN", "company_id": NEXUS, "name": "NEXUS-ONLY"},
    ])
    db.warehouse_transfers.docs.extend([
        {"_id": "trA1", "company_id": COMP_A, "transfer_number": "TRF-A-1", "transfer_date": "2026-10-01"},
        {"_id": "trA2", "company_id": COMP_A, "transfer_number": "TRF-A-2", "transfer_date": "2026-10-05"},
        {"_id": "trB", "company_id": COMP_B, "transfer_number": "TRF-B", "transfer_date": "2026-10-06",
         "notes": "B-SECRET"},
        {"_id": "trN", "company_id": NEXUS, "transfer_number": "TRF-N", "transfer_date": "2026-10-06",
         "notes": "NEXUS-ONLY"},
    ])
    mat = {"product_id": "matA", "quantity": 2, "cost_per_unit": 5, "wastage_percent": 0, "unit": "Adet"}
    db.recipes.docs.extend([
        {"_id": "recA1", "company_id": COMP_A, "name": "Recete Eski", "finished_product_id": "prodOkA",
         "created_at": "2026-10-01", "materials": [mat], "labor_cost": 1, "overhead_cost": 0, "target_quantity": 1},
        {"_id": "recA2", "company_id": COMP_A, "name": "Recete Plan", "finished_product_id": "prodPlanA",
         "created_at": "2026-10-04", "materials": [mat], "labor_cost": 1, "overhead_cost": 0, "target_quantity": 1},
        {"_id": "recB", "company_id": COMP_B, "name": "B-SECRET", "finished_product_id": "prodLowB",
         "created_at": "2026-10-05", "materials": [], "labor_cost": 0, "overhead_cost": 0, "target_quantity": 1},
        {"_id": "recN", "company_id": NEXUS, "name": "NEXUS-ONLY", "finished_product_id": "prodLowN",
         "created_at": "2026-10-05", "materials": [], "labor_cost": 0, "overhead_cost": 0, "target_quantity": 1},
    ])
    db.notifications.docs.extend([
        {
            "_id": "nA", "company_id": COMP_A, "type": "order_pick_missing", "is_read": False,
            "created_at": "2026-10-02T00:00:00", "ref_id": "ordPickA", "order_number": "SIP-A",
            "customer_name": "Musteri A",
            "missing_items": [{"product_name": "Eksik A", "sku": "SKU-EX", "unit": "Adet", "missing_qty": 3}],
        },
        {
            "_id": "nAread", "company_id": COMP_A, "type": "order_pick_missing", "is_read": True,
            "created_at": "2026-10-01T00:00:00", "missing_items": [{"product_name": "Okundu A", "missing_qty": 1}],
        },
        {
            "_id": "nB", "company_id": COMP_B, "type": "order_pick_missing", "is_read": False,
            "created_at": "2026-10-03T00:00:00", "customer_name": "B-SECRET",
            "missing_items": [{"product_name": "B-SECRET", "missing_qty": 8}],
        },
        {
            "_id": "nN", "company_id": NEXUS, "type": "order_pick_missing", "is_read": False,
            "created_at": "2026-10-03T00:00:00",
            "missing_items": [{"product_name": "NEXUS-ONLY", "missing_qty": 1}],
        },
    ])
    db.production_orders.docs.extend([
        {"_id": "poAold", "company_id": COMP_A, "order_code": "URT-A-0", "status": "completed",
         "finished_product_id": "prodOkA", "finished_product_name": "Yeterli A", "created_at": f"{PREV}-15",
         "end_date": f"{PREV}-15", "planned_quantity": 1, "completed_quantity": 1, "internal_note": "gizli-a"},
        {"_id": "poAdone", "company_id": COMP_A, "order_code": "URT-A-1", "status": "completed",
         "finished_product_id": "prodOkA", "finished_product_name": "Yeterli A", "created_at": f"{MONTH}-01",
         "end_date": f"{MONTH}-01", "planned_quantity": 1, "completed_quantity": 1},
        {"_id": "poAprod", "company_id": COMP_A, "order_code": "URT-A-2", "status": "in_production",
         "recipe_id": "", "finished_product_id": "prodPlanA", "finished_product_name": "Plan A",
         "created_at": f"{MONTH}-02", "planned_quantity": 2, "completed_quantity": 0, "internal_note": "gizli-a"},
        {"_id": "poAplan", "company_id": COMP_A, "order_code": "URT-A-3", "status": "planned",
         "finished_product_id": "prodLowA", "finished_product_name": "Urun A", "created_at": f"{MONTH}-04",
         "planned_quantity": 4, "completed_quantity": 0},
        {"_id": "poBprod", "company_id": COMP_B, "order_code": "URT-B", "status": "planned",
         "finished_product_name": "B-SECRET", "created_at": "2026-10-05", "planned_quantity": 9,
         "end_date": "2026-10-05"},
        {"_id": "poNprod", "company_id": NEXUS, "order_code": "URT-N", "status": "in_production",
         "finished_product_name": "NEXUS-ONLY", "created_at": "2026-10-05", "planned_quantity": 1},
    ])
    db.work_orders.docs.extend([
        {
            "_id": "woA0", "company_id": COMP_A, "order_id": "poAprod", "order_code": "URT-A-2",
            "step_no": 1, "step_name": "Kesim", "station": "HOLZHER", "status": "ready",
            "planned_date": "2026-10-01", "images": [], "step_note": "hazir", "planned_quantity": 2,
        },
        {
            "_id": "woA1", "company_id": COMP_A, "order_id": "poAprod", "order_code": "URT-A-2",
            "step_no": 2, "step_name": "Delme", "station": "OMAKSAN", "status": "waiting",
            "planned_date": "2026-10-01", "images": [], "step_note": "hazir", "planned_quantity": 2,
        },
        {
            "_id": "woDone", "company_id": COMP_A, "order_id": "poAdone", "order_code": "URT-A-1",
            "step_no": 1, "step_name": "Bitis", "station": "HOLZHER", "status": "done",
            "operator_name": "Op A", "produced_qty": 4, "scrap_qty": 0, "planned_date": "2026-10-01",
            "started_at": "2026-10-01T09:00:00", "finished_at": "2026-10-01T10:00:00", "images": [],
            "step_note": "bitti",
        },
        {
            "_id": "woLeak", "company_id": COMP_B, "order_id": "poAprod", "order_code": "URT-B-LEAK",
            "step_no": 1, "step_name": "B-SECRET-STEP", "station": "B-SECRET", "status": "ready",
            "planned_date": "2026-10-01", "images": [], "step_note": "B-SECRET",
        },
        {
            "_id": "woB", "company_id": COMP_B, "order_id": "poBprod", "order_code": "URT-B",
            "step_no": 1, "step_name": "B-SECRET", "station": "B-SECRET", "status": "done",
            "operator_name": "B-SECRET", "produced_qty": 9, "scrap_qty": 1, "planned_date": "2026-10-01",
            "started_at": f"{PERF_DAY}T09:00:00", "finished_at": f"{PERF_DAY}T11:00:00", "images": [],
        },
        {
            "_id": "woN", "company_id": NEXUS, "order_id": "poNprod", "order_code": "URT-N",
            "step_no": 1, "step_name": "NEXUS-ONLY", "station": "NEXUS-ONLY", "status": "done",
            "operator_name": "NEXUS-ONLY", "produced_qty": 1, "scrap_qty": 0, "planned_date": "2026-10-01",
            "started_at": "2026-10-01T09:00:00", "finished_at": "2026-10-01T10:00:00", "images": [],
        },
    ])
    db.employees.docs.extend([
        {"_id": "empA", "company_id": COMP_A, "full_name": "Op A", "status": "active"},
        {"_id": "empB", "company_id": COMP_B, "full_name": "B-SECRET", "status": "active"},
    ])
    db.orders.docs.extend([
        {
            "_id": "ordPickA", "company_id": COMP_A, "order_number": "SIP-A", "customer_name": "Musteri A",
            "order_status": "pending", "channel": "b2b", "order_date": "2026-10-02T00:00:00",
            "items": [{"quantity": 2, "product_name": "Urun A"}],
        },
        {
            "_id": "ordShipA", "company_id": COMP_A, "order_number": "SIP-A-SEVK", "customer_name": "Sevk A",
            "order_status": "shipped", "channel": "b2b", "order_date": "2026-10-03T00:00:00",
            "items": [{"quantity": 1, "product_name": "Urun A"}],
        },
        {
            "_id": "ordMarket", "company_id": COMP_A, "order_number": "SIP-TY", "customer_name": "Pazar A",
            "order_status": "shipped", "channel": "trendyol", "order_date": "2026-10-04T00:00:00",
            "items": [{"quantity": 1}],
        },
        {
            "_id": "ordCancel", "company_id": COMP_A, "order_number": "SIP-IPTAL", "customer_name": "Iptal A",
            "order_status": "cancelled", "channel": "b2b", "order_date": "2026-10-04T00:00:00", "items": [],
        },
        {
            "_id": "ordB", "company_id": COMP_B, "order_number": "SIP-B", "customer_name": "B-SECRET",
            "order_status": "pending", "channel": "b2b", "order_date": "2026-10-05T00:00:00",
            "items": [{"quantity": 9}],
        },
        {
            "_id": "ordN", "company_id": NEXUS, "order_number": "SIP-N", "customer_name": "NEXUS-ONLY",
            "order_status": "pending", "channel": "manual", "order_date": "2026-10-05T00:00:00", "items": [],
        },
    ])
    db.order_pick_sessions.docs.extend([
        {
            "_id": "sesA", "company_id": COMP_A, "order_id": "ordPickA", "status": "open",
            "items": [{"ordered_qty": 2, "picked_qty": 1, "product_name": "Urun A"}],
        },
        {
            "_id": "sesLeak", "company_id": COMP_B, "order_id": "ordPickA", "status": "open",
            "items": [{"ordered_qty": 2, "picked_qty": 2, "product_name": "B-SECRET"}],
        },
    ])
    db.roles.docs.append({
        "_id": "role_A_personel",
        "company_id": COMP_A,
        "code": "personel",
        "name": "Personel",
        "is_system": True,
        "perm_levels_v2": True,
        "permissions": {},
        "features": {},
    })


def _set_portal(db, features):
    role = next(row for row in db.roles.docs if row.get("code") == "personel" and row.get("company_id") == COMP_A)
    role["features"] = dict(features)


@pytest.fixture
def api():
    db = MemDB()
    db.users.docs.append(_user("user-a", [COMP_A], COMP_A))
    db.users.docs.append(_user("user-b", [COMP_B], COMP_B))
    db.users.docs.append(_user("user-sa", [], "", superadmin=True))
    db.users.docs.append(_user("user-sa-a", [COMP_A], COMP_A, superadmin=True))
    db.users.docs.append(_user("user-portal", [COMP_A], COMP_A, role="personel"))
    _seed(db)
    prev = (
        server.db, rbac._db, saas._db, addons._db,
        order_pick._db, order_pick._current_user, attendance._db,
    )
    server.db = db
    rbac._db = db
    saas._db = db
    addons._db = db
    order_pick._db = db
    order_pick._current_user = server.get_current_user
    attendance._db = db
    saas.invalidate()
    router = server.app.router
    saved_up = list(router.on_startup)
    saved_down = list(router.on_shutdown)
    router.on_startup.clear()
    router.on_shutdown.clear()
    client = TestClient(server.app)
    entered = False
    try:
        client.__enter__()
        entered = True
        yield client, db
    finally:
        if entered:
            client.__exit__(None, None, None)
        (
            server.db, rbac._db, saas._db, addons._db,
            order_pick._db, order_pick._current_user, attendance._db,
        ) = prev
        router.on_startup[:] = saved_up
        router.on_shutdown[:] = saved_down
        saas.invalidate()


def _token(uid, *, superadmin=False, role="admin"):
    return auth_utils.create_access_token(uid, f"{uid}@example.com", role, is_super_admin=superadmin)


def _auth(uid, *, superadmin=False, role="admin"):
    return {"Authorization": f"Bearer {_token(uid, superadmin=superadmin, role=role)}"}


def test_route_signatures_have_auth_and_no_nexus_default():
    routes = _routes()
    assert len(routes) == 16
    for fn, dep, _path, _extra in routes:
        sig = inspect.signature(fn)
        assert sig.parameters["company_id"].default is None
        assert sig.parameters["user"].default.dependency is dep
        src = inspect.getsource(fn)
        assert "comp_nexus_main_01" not in src
        assert "resolve_company_id" in src
    wo = inspect.signature(server.list_work_orders)
    assert wo.parameters["response"].default is inspect.Parameter.empty
    helper = inspect.getsource(server._stock_lots_payload)
    assert "resolve_company_id" not in helper
    assert ".to_list(2000)" in helper
    lots_route = inspect.getsource(server.list_stock_lots)
    assert "_stock_lots_payload" in lots_route
    product_lots = inspect.getsource(server.product_lots)
    assert "_stock_lots_payload" in product_lots
    assert "list_stock_lots(" not in product_lots
    assert ".to_list(1000)" in inspect.getsource(server.list_purchase_orders)
    assert ".to_list(100)" in inspect.getsource(server.list_stock_counts)
    assert ".to_list(5000)" in inspect.getsource(server.work_order_performance)
    assert ".to_list(100)" in inspect.getsource(server.list_warehouses)
    assert ".to_list(300)" in inspect.getsource(server.list_recipes)
    assert ".to_list(300)" in inspect.getsource(server.list_production_orders)
    assert ".to_list(1000)" in inspect.getsource(server.list_work_orders)
    assert "[:200]" in inspect.getsource(order_pick.list_pickable)
    rbac_text = Path(rbac.__file__).read_text(encoding="utf-8")
    assert "PUBLIC_API_ALLOWLIST" in rbac_text
    assert "portal_atolye" in rbac_text


def test_no_token_is_401(api):
    client, db = api
    before = _snapshot(db)
    for _fn, _dep, path, extra in _routes():
        response = client.get(path, params=extra or None)
        assert response.status_code == 401, (path, response.text)
        assert response.json()["detail"] == "Giriş yapmanız gerekiyor."
        _no_foreign(response.text)
    assert _snapshot(db) == before
    assert db.writes == []


def test_direct_call_without_user_is_401(api):
    _client, db = api
    before = _snapshot(db)
    for fn, _dep, path, extra in _routes():
        with pytest.raises(HTTPException) as exc:
            _invoke(fn, company_id=COMP_A, user=None, **extra)
        assert exc.value.status_code == 401, path
        assert exc.value.detail == "Giriş yapmanız gerekiyor."
    assert _snapshot(db) == before
    assert db.writes == []


def test_other_company_is_403_and_returns_nothing(api):
    client, db = api
    before = _snapshot(db)
    headers = _auth("user-a")
    for _fn, _dep, path, extra in _routes():
        response = client.get(path, params={"company_id": COMP_B, **extra}, headers=headers)
        assert response.status_code == 403, (path, response.text)
        assert response.json()["detail"] == DENY
        _no_foreign(response.text)
    assert _snapshot(db) == before
    assert db.writes == []


def test_direct_call_other_company_is_403_without_middleware(api):
    _client, db = api
    user_a = _user_a()
    before = _snapshot(db)
    for fn, _dep, path, extra in _routes():
        with pytest.raises(HTTPException) as exc:
            _invoke(fn, company_id=COMP_B, user=user_a, **extra)
        assert exc.value.status_code == 403, path
        assert exc.value.detail == DENY
    assert _snapshot(db) == before
    assert db.writes == []


def test_missing_company_id_uses_active_company_only(api):
    client, db = api
    headers = _auth("user-a")
    user_a = _user_a()
    for fn, _dep, path, extra in _routes():
        response = client.get(path, params=extra or None, headers=headers)
        assert response.status_code == 200, (path, response.text)
        _no_foreign(response.text)
        direct = _invoke(fn, company_id=None, user=user_a, **extra)
        assert response.json() == direct
    blank = client.get("/api/warehouses", params={"company_id": ""}, headers=headers)
    assert blank.status_code == 200, blank.text
    assert _ids(blank.json()) == ["whA1", "whA2"]
    _no_foreign(blank.text)
    assert db.writes == []


def test_own_company_returns_only_own_records(api, monkeypatch):
    client, db = api
    headers = _auth("user-a")
    user_a = _user_a()

    preview = client.get("/api/products/reorder-preview", params={"company_id": COMP_A}, headers=headers)
    assert preview.status_code == 200, preview.text
    body = preview.json()
    assert body["company_id"] == COMP_A
    assert [row["product_id"] for row in body["lines"]] == ["prodLowA", "prodPlanA"]
    assert body["count"] == 2
    low = body["lines"][0]
    assert low["quantity"] == 4
    assert low["unit_price"] == 44
    assert low["contact_id"] == "ctA"
    assert low["contact_name"] == "Tedarik A"
    _no_foreign(preview.text)
    assert preview.json() == _invoke(server.reorder_preview, company_id=COMP_A, user=user_a)

    one = client.get(
        "/api/products/reorder-preview",
        params={"company_id": COMP_A, "product_ids": "prodOkA"},
        headers=headers,
    )
    assert [row["product_id"] for row in one.json()["lines"]] == ["prodOkA"]

    orders = client.get("/api/purchase-orders", params={"company_id": COMP_A}, headers=headers)
    assert orders.status_code == 200, orders.text
    assert _ids(orders.json()) == ["poNew", "poOld"]
    _no_foreign(orders.text)
    drafts = client.get("/api/purchase-orders", params={"company_id": COMP_A, "status": "draft"}, headers=headers)
    assert _ids(drafts.json()) == ["poOld"]

    lots = client.get("/api/stock-lots", params={"company_id": COMP_A}, headers=headers)
    assert lots.status_code == 200, lots.text
    assert _ids(lots.json()) == ["lotA0", "lotA1"]
    _no_foreign(lots.text)
    soon = client.get("/api/stock-lots", params={"company_id": COMP_A, "expiring_days": 10}, headers=headers)
    assert _ids(soon.json()) == ["lotA0"]
    with_empty = client.get(
        "/api/stock-lots",
        params={"company_id": COMP_A, "product_id": "prodLowA", "include_empty": True},
        headers=headers,
    )
    assert _ids(with_empty.json()) == ["lotAempty", "lotA0", "lotA1"]
    helper = _invoke(
        server._stock_lots_payload, company_id=COMP_A, product_id="prodLowA", include_empty=False,
    )
    listed = client.get("/api/stock-lots", params={"company_id": COMP_A, "product_id": "prodLowA"}, headers=headers)
    via_product = client.get("/api/products/prodLowA/lots", headers=headers)
    assert listed.status_code == 200 and via_product.status_code == 200
    assert listed.json() == helper
    assert via_product.json() == helper
    via_empty = client.get("/api/products/prodLowA/lots", params={"include_empty": True}, headers=headers)
    assert via_empty.json() == _invoke(
        server._stock_lots_payload, company_id=COMP_A, product_id="prodLowA", include_empty=True,
    )
    hidden = client.get("/api/products/prodLowB/lots", headers=headers)
    assert hidden.status_code == 404
    _no_foreign(hidden.text)

    counts = client.get("/api/warehouses/stock-counts", params={"company_id": COMP_A}, headers=headers)
    assert _ids(counts.json()) == ["scA2", "scA1"]
    _no_foreign(counts.text)

    warehouses = client.get("/api/warehouses", params={"company_id": COMP_A}, headers=headers)
    assert _ids(warehouses.json()) == ["whA1", "whA2"]
    _no_foreign(warehouses.text)

    transfers = client.get("/api/warehouses/transfers", params={"company_id": COMP_A}, headers=headers)
    assert _ids(transfers.json()) == ["trA2", "trA1"]
    _no_foreign(transfers.text)

    recipes = client.get("/api/production/recipes", params={"company_id": COMP_A}, headers=headers)
    assert recipes.status_code == 200, recipes.text
    assert _ids(recipes.json()) == ["recA2", "recA1"]
    assert recipes.json()[0]["unit_cost"] == 11
    assert recipes.json()[0]["material_cost"] == 10
    assert "total_estimated_cost" in recipes.json()[0]
    _no_foreign(recipes.text)
    only_plan = client.get(
        "/api/production/recipes",
        params={"company_id": COMP_A, "product_id": "prodPlanA"},
        headers=headers,
    )
    assert _ids(only_plan.json()) == ["recA2"]

    missing = client.get("/api/production/missing-plan", params={"company_id": COMP_A}, headers=headers)
    assert missing.status_code == 200, missing.text
    names = [row["product_name"] for row in missing.json()["items"]]
    assert names == ["Plan A", "Urun A"]
    assert missing.json()["notification_count"] == 1
    assert missing.json()["count"] == 2
    assert missing.json()["link"] == "/production?tab=missing"
    _no_foreign(missing.text)
    assert missing.json() == _invoke(server.production_missing_plan, company_id=COMP_A, user=user_a)

    kpis = client.get("/api/production/kpis", params={"company_id": COMP_A}, headers=headers)
    assert kpis.status_code == 200, kpis.text
    assert kpis.json() == {
        "open": 2,
        "in_production": 1,
        "completed_this_month": 1,
        "recipes": 2,
        "missing_notifications": 1,
    }
    _no_foreign(kpis.text)

    produced = client.get("/api/production/orders", params={"company_id": COMP_A}, headers=headers)
    assert produced.status_code == 200, produced.text
    assert _ids(produced.json()) == ["poAplan", "poAprod", "poAdone", "poAold"]
    assert "internal_note" not in produced.json()[0]
    assert "gizli-a" not in produced.text
    _no_foreign(produced.text)
    opened = client.get("/api/production/orders", params={"company_id": COMP_A, "status": "open"}, headers=headers)
    assert _ids(opened.json()) == ["poAplan", "poAprod"]
    steps = client.get(
        "/api/production/orders",
        params={"company_id": COMP_A, "include_steps": True, "product_id": "prodPlanA"},
        headers=headers,
    )
    assert steps.status_code == 200, steps.text
    assert _ids(steps.json()) == ["poAprod"]
    summary = steps.json()[0]["steps_summary"]
    assert [row["name"] for row in summary["steps"]] == ["Kesim", "Delme"]
    assert "B-SECRET" not in steps.text

    work = client.get("/api/production/work-orders", params={"company_id": COMP_A}, headers=headers)
    assert work.status_code == 200, work.text
    assert work.headers["cache-control"] == "no-store, no-cache, must-revalidate, max-age=0"
    assert work.headers["pragma"] == "no-cache"
    assert {row["id"] for row in work.json()} == {"woA0", "woA1", "woDone"}
    _no_foreign(work.text)
    station = client.get(
        "/api/production/work-orders",
        params={"company_id": COMP_A, "station": "HOLZHER"},
        headers=headers,
    )
    assert [row["id"] for row in station.json()] == ["woDone", "woA0"]

    stations = client.get("/api/production/work-orders/stations", params={"company_id": COMP_A}, headers=headers)
    assert stations.json() == ["HOLZHER", "OMAKSAN"]
    _no_foreign(stations.text)

    settings = client.get("/api/production/work-orders/shopfloor-settings", params={"company_id": COMP_A}, headers=headers)
    assert settings.json() == {"group_same_station": True}

    # Duraklat penceresi Europe/Istanbul 09:00-18:00. Giriş yapmış kullanıcıda
    # operatör, sorgu parametresi değil çağıranın adıdır (2b90a6fa). Saat
    # dondurulunca allowed False sabit kalır ve istemci Op A seçemez.
    monkeypatch.setattr(
        attendance,
        "local_now",
        lambda schedule=None: datetime(2026, 10, 21, 20, 30, tzinfo=ZoneInfo("Europe/Istanbul")),
    )
    pause = client.get("/api/production/work-orders/pause-policy", params={"company_id": COMP_A}, headers=headers)
    assert pause.status_code == 200, pause.text
    assert pause.json()["allowed"] is False
    assert pause.json()["operator_name"] == "user-a"
    _no_foreign(pause.text)
    named = client.get(
        "/api/production/work-orders/pause-policy",
        params={"company_id": COMP_A, "operator_name": "Op A"},
        headers=headers,
    )
    assert named.status_code == 200, named.text
    assert named.json()["operator_name"] == "user-a"
    assert named.json()["employee_id"] is None
    _no_foreign(named.text)

    perf = client.get("/api/production/work-orders/performance", params={"company_id": COMP_A, **PERF_RANGE}, headers=headers)
    assert perf.status_code == 200, perf.text
    assert perf.json()["date_from"] == PERF_DAY
    assert perf.json()["date_to"] == PERF_DAY
    assert perf.json()["total_done"] == 1
    assert perf.json()["operators"][0]["name"] == "Op A"
    assert perf.json()["operators"][0]["produced"] == 4
    assert perf.json()["stations"][0]["name"] == "HOLZHER"
    _no_foreign(perf.text)

    picks = client.get("/api/order-picks", params={"company_id": COMP_A}, headers=headers)
    assert picks.status_code == 200, picks.text
    assert _ids(picks.json()) == ["ordShipA", "ordPickA"]
    by_id = {row["id"]: row for row in picks.json()}
    assert by_id["ordShipA"]["can_mark_delivered"] is True
    assert by_id["ordPickA"]["pick_status"] == "open"
    assert by_id["ordPickA"]["progress"]["picked"] == 1
    assert by_id["ordPickA"]["progress"]["ordered"] == 2
    _no_foreign(picks.text)
    assert picks.json() == _invoke(order_pick.list_pickable, company_id=COMP_A, user=user_a)

    cookie = client.get("/api/warehouses", params={"company_id": COMP_A}, cookies={"access_token": _token("user-a")})
    assert cookie.status_code == 200, cookie.text
    assert cookie.request.headers.get("authorization") is None
    assert cookie.json() == warehouses.json()
    assert db.writes == []


def test_super_admin_follows_resolve_company_id(api):
    client, db = api
    for _fn, _dep, path, extra in _routes():
        missing = client.get(path, params=extra or None, headers=_auth("user-sa", superadmin=True))
        assert missing.status_code == 400, (path, missing.text)
        assert missing.json()["detail"] == "Şirket seçilmedi."
        _no_foreign(missing.text)
    with pytest.raises(HTTPException) as exc:
        _invoke(server.list_warehouses, user=_user("user-sa", [], "", superadmin=True))
    assert exc.value.status_code == 400

    active = client.get("/api/warehouses", headers=_auth("user-sa-a", superadmin=True))
    assert active.status_code == 200, active.text
    assert _ids(active.json()) == ["whA1", "whA2"]
    _no_foreign(active.text)

    headers = _auth("user-sa", superadmin=True)
    foreign = client.get("/api/purchase-orders", params={"company_id": COMP_B}, headers=headers)
    assert foreign.status_code == 200, foreign.text
    assert _ids(foreign.json()) == ["poB"]
    assert "B-SECRET" in foreign.text
    assert "Tedarik A" not in foreign.text
    nexus = client.get("/api/warehouses", params={"company_id": NEXUS}, headers=headers)
    assert _ids(nexus.json()) == ["whN"]
    assert "Depo A" not in nexus.text
    lots = client.get("/api/products/prodLowB/lots", params={"company_id": COMP_B}, headers=headers)
    assert lots.status_code == 200, lots.text
    assert _ids(lots.json()) == ["lotB"]
    assert lots.json() == _invoke(server._stock_lots_payload, company_id=COMP_B, product_id="prodLowB")
    assert db.writes == []


def test_portal_users_can_read_their_company_gets(api):
    client, db = api
    headers = _auth("user-portal", role="personel")
    phases = (
        ("portal_atolye", [
            "/api/production/work-orders",
            "/api/production/work-orders/stations",
            "/api/production/work-orders/pause-policy",
            "/api/production/work-orders/shopfloor-settings",
            "/api/production/work-orders/performance",
        ]),
        ("portal_sayim", ["/api/warehouses/stock-counts"]),
        ("portal_pick", ["/api/order-picks"]),
    )
    for feature, paths in phases:
        _set_portal(db, {feature: True})
        for path in paths:
            extra = PERF_RANGE if path.endswith("/performance") else {}
            response = client.get(path, params={"company_id": COMP_A, **extra}, headers=headers)
            assert response.status_code == 200, (feature, path, response.text)
            _no_foreign(response.text)
            denied = client.get(path, params={"company_id": COMP_B, **extra}, headers=headers)
            assert denied.status_code == 403, (feature, path, denied.text)
            assert denied.json()["detail"] == DENY
        for other_feature, other_paths in phases:
            if other_feature == feature:
                continue
            for path in other_paths:
                extra = PERF_RANGE if path.endswith("/performance") else {}
                blocked = client.get(path, params={"company_id": COMP_A, **extra}, headers=headers)
                assert blocked.status_code == 403, (feature, path, blocked.text)
