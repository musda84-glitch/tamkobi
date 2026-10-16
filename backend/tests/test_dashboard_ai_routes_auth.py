"""Dashboard and AI summary routes: session + company, same response shape.

In-process TestClient and a memory database. No live server, port 8021,
MySQL, tamkobi_p0, or a real AI provider. get_production_ai_advice is patched.
"""
from __future__ import annotations

import asyncio
import copy
import inspect
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-dashboard-ai-routes-auth-jwt-secret-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import addons  # noqa: E402
import auth_utils  # noqa: E402
import expenses  # noqa: E402
import rbac  # noqa: E402
import saas  # noqa: E402
import server  # noqa: E402
from mysql_store import apply_update, match_query, new_upsert_doc, project_doc, sort_docs  # noqa: E402

COMP_A = "A"
COMP_B = "B"
NEXUS = "comp_nexus_main_01"
DENY = "Bu şirket hesabına erişiminiz yok."
SUMMARY_PROMPT = "Güncel üretim ve reçete durumunu yönetici için özetle; öncelikli aksiyonları madde madde yaz."
CASH_SUMMARY = (
    "Önümüzdeki 30 günde nakit akışınız pozitif trendde seyrediyor. "
    "Ay ortasındaki hammadde ödemeleri sonrası net nakit fazlasının %18 artması öngörülüyor."
)
OVERVIEW_KEYS = {"date", "tasks", "collections", "payments", "drafts", "invoices", "vat", "budget_warnings"}
OPS_GROUP_KEYS = {"pick_missing", "low_stock", "production", "shipped", "new_orders"}
TILE_KEYS = {"orders", "sevk", "personnel", "banking", "atolye", "edoc", "unread"}
STATS_KEYS = {
    "total_bank_balance", "total_receivables", "total_payables", "receivable_count", "payable_count",
    "monthly_sales", "monthly_expenses", "net_profit", "sales_change_pct", "pending_orders_count",
    "low_stock_count", "total_stock_value", "chart_data", "channels_breakdown", "recent_invoices",
    "recent_orders", "low_stock_products", "decision",
}
AI_METRIC_KEYS = {
    "company_id", "company_name", "recipes", "open_orders", "in_production", "completed_this_month",
    "missing_notifications", "open_work_orders", "paused_work_orders", "done_work_orders_recent",
}
CASH_KEYS = {"current_cash", "projected_30d_cash", "net_growth_percent", "forecast_chart", "ai_summary"}
MONTH = datetime.now(timezone.utc).strftime("%Y-%m")


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

    def _rows(self, length=None):
        rows = sort_docs(list(self._docs), self._sort) if self._sort else list(self._docs)
        cap = self._limit
        if length is not None:
            cap = int(length) if cap is None else min(cap, int(length))
        if cap is not None:
            rows = rows[:cap]
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

    def find(self, query=None, projection=None):
        matched = []
        for doc in self.docs:
            if match_query(doc, query or {}):
                matched.append(project_doc(doc, projection) if projection else copy.deepcopy(doc))
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

    async def insert_one(self, doc):
        self.docs.append(copy.deepcopy(doc))
        return SimpleNamespace(inserted_id=doc.get("_id"))

    async def insert_many(self, docs):
        copied = [copy.deepcopy(doc) for doc in docs]
        self.docs.extend(copied)
        return SimpleNamespace(inserted_ids=[doc.get("_id") for doc in copied])

    async def update_one(self, query, update, upsert=False):
        for i, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                self.docs[i] = apply_update(doc, update, query)
                return SimpleNamespace(modified_count=1, matched_count=1)
        if upsert:
            self.docs.append(new_upsert_doc(update, query))
            return SimpleNamespace(modified_count=0, matched_count=0, upserted_id=self.docs[-1].get("_id"))
        return SimpleNamespace(modified_count=0, matched_count=0)

    async def create_index(self, *args, **kwargs):
        return None


class MemDB:
    def __init__(self):
        self._cols = {}

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


def _user(uid, company_ids, active, *, superadmin=False, role="admin", employee_id=None):
    row = {
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
    if employee_id:
        row["employee_id"] = employee_id
    return row


def _user_a():
    return _user("user-a", [COMP_A], COMP_A)


def _license(company_id, production=True, advisor=True):
    return {
        "_id": company_id,
        "status": "active",
        "addon_overrides": {"ai.production": production, "ai.advisor": advisor},
    }


def _set_addon(db, company_id, key, enabled):
    for doc in db.company_licenses.docs:
        if doc.get("_id") == company_id:
            doc.setdefault("addon_overrides", {})[key] = enabled
    saas.invalidate()


def _seed(db):
    db.companies.docs.extend([
        {"_id": COMP_A, "name": "Firma A"},
        {"_id": COMP_B, "name": "B-SECRET LTD"},
        {"_id": NEXUS, "name": "NEXUS-ONLY"},
    ])
    db.company_licenses.docs.extend([
        _license(COMP_A),
        _license(COMP_B),
        _license(NEXUS, production=False, advisor=False),
    ])
    db.users.docs.extend([
        _user("user-a", [COMP_A], COMP_A),
        _user("user-b", [COMP_B], COMP_B),
        _user("user-sa", [], "", superadmin=True),
        _user("user-sa-a", [COMP_A], COMP_A, superadmin=True),
        _user("user-staff", [COMP_A], COMP_A, role="warehouse", employee_id="emp-staff"),
    ])
    db.bank_accounts.docs.extend([
        {"_id": "accA", "company_id": COMP_A, "current_balance": 111, "account_name": "Kasa A"},
        {"_id": "accB", "company_id": COMP_B, "current_balance": 222, "account_name": "B-SECRET"},
        {"_id": "accN", "company_id": NEXUS, "current_balance": 777777, "account_name": "NEXUS-ONLY"},
    ])
    db.contacts.docs.extend([
        {"_id": "ctA", "company_id": COMP_A, "name": "Cari A", "balance": 50},
        {"_id": "ctB", "company_id": COMP_B, "name": "B-SECRET", "balance": 99999},
        {"_id": "ctN", "company_id": NEXUS, "name": "NEXUS-ONLY", "balance": 1},
    ])
    db.invoices.docs.extend([
        {
            "_id": "invA", "company_id": COMP_A, "invoice_type": "sales", "status": "issued",
            "payment_status": "unpaid", "grand_total": 80, "paid_amount": 0, "vat_total": 8,
            "issue_date": f"{MONTH}-02", "due_date": "2020-01-01", "contact_name": "Cari A",
            "invoice_number": "A-1",
        },
        {
            "_id": "invB", "company_id": COMP_B, "invoice_type": "sales", "status": "issued",
            "payment_status": "unpaid", "grand_total": 5000, "paid_amount": 0, "vat_total": 900,
            "issue_date": f"{MONTH}-02", "due_date": "2020-01-01", "contact_name": "B-SECRET",
            "invoice_number": "B-SECRET-1",
        },
    ])
    db.expenses.docs.extend([
        {"_id": "expA", "company_id": COMP_A, "date": f"{MONTH}-03", "category": "Kira", "total": 90, "vat_amount": 10},
        {"_id": "expB", "company_id": COMP_B, "date": f"{MONTH}-03", "category": "B-SECRET", "total": 400, "vat_amount": 70},
    ])
    db.expense_budgets.docs.extend([
        {"_id": "budA", "company_id": COMP_A, "category": "Kira", "monthly_limit": 100},
        {"_id": "budB", "company_id": COMP_B, "category": "B-SECRET", "monthly_limit": 10},
        {"_id": "budN", "company_id": NEXUS, "category": "NEXUS-ONLY", "monthly_limit": 1},
    ])
    db.products.docs.extend([
        {"_id": "pA", "company_id": COMP_A, "name": "Ürün A", "sku": "SKU-A", "stock_quantity": 1,
         "min_stock_alert": 5, "purchase_price": 4, "track_stock": True},
        {"_id": "pB", "company_id": COMP_B, "name": "B-SECRET-URUN", "sku": "SKU-B", "stock_quantity": 0,
         "min_stock_alert": 3, "purchase_price": 9, "track_stock": True},
    ])
    orders = [
        {"_id": "oA1", "company_id": COMP_A, "order_status": "pending", "cargo_tracking_number": None,
         "order_number": "A-1", "customer_name": "Cari A", "grand_total": 10, "channel": "manual", "created_at": "2026-10-01"},
        {"_id": "oA2", "company_id": COMP_A, "order_status": "preparing", "cargo_tracking_number": "",
         "order_number": "A-2", "customer_name": "Cari A", "grand_total": 12, "channel": "manual", "created_at": "2026-10-02"},
        {"_id": "oA3", "company_id": COMP_A, "order_status": "approved", "cargo_tracking_number": "TRK-A",
         "order_number": "A-3", "customer_name": "Cari A", "grand_total": 14, "channel": "b2b", "created_at": "2026-10-03"},
    ]
    for i in range(8):
        orders.append({
            "_id": f"oB{i}", "company_id": COMP_B, "order_status": "pending", "cargo_tracking_number": None,
            "order_number": f"B-SECRET-{i}", "customer_name": "B-SECRET", "grand_total": 999, "channel": "manual",
            "created_at": f"2026-10-{i + 1:02d}",
        })
    db.orders.docs.extend(orders)
    db.notifications.docs.extend([
        {"_id": "nPickA", "company_id": COMP_A, "type": "order_pick_missing", "is_read": False,
         "roles": ["warehouse"], "title": "Depo A", "message": "eksik A", "created_at": "2026-10-01"},
        {"_id": "nRoleA", "company_id": COMP_A, "type": "order_new", "is_read": False,
         "roles": ["admin", "sales"], "title": "Sipariş A", "message": "yeni", "created_at": "2026-10-02"},
        {"_id": "nMine", "company_id": COMP_A, "type": "task_assigned", "is_read": False,
         "user_id": "user-staff", "employee_id": "emp-staff", "roles": [], "title": "Bana", "created_at": "2026-10-03"},
        {"_id": "nOther", "company_id": COMP_A, "type": "task_assigned", "is_read": False,
         "user_id": "user-x", "employee_id": "emp-x", "roles": [], "title": "Başkası", "created_at": "2026-10-04"},
        {"_id": "nBank", "company_id": COMP_A, "type": "bank_sync", "is_read": False,
         "title": "Banka A", "created_at": "2026-10-05"},
        {"_id": "nRead", "company_id": COMP_A, "type": "order_new", "is_read": True, "title": "Okundu", "created_at": "2026-10-06"},
        {"_id": "nB1", "company_id": COMP_B, "type": "order_pick_missing", "is_read": False, "title": "B-SECRET-PICK", "created_at": "2026-10-07"},
        {"_id": "nB2", "company_id": COMP_B, "type": "order_pick_missing", "is_read": False, "title": "B-SECRET-PICK-2", "created_at": "2026-10-08"},
        {"_id": "nB3", "company_id": COMP_B, "type": "order_pick_production", "is_read": False, "title": "B-SECRET-PROD", "created_at": "2026-10-09"},
        {"_id": "nB4", "company_id": COMP_B, "type": "order_pick_missing", "is_read": False, "title": "B-SECRET-PICK-3", "created_at": "2026-10-10"},
        {"_id": "nB5", "company_id": COMP_B, "type": "order_new", "is_read": False, "title": "B-SECRET-NOTE", "created_at": "2026-10-11"},
    ])
    db.leave_requests.docs.extend([
        {"_id": "lvA", "company_id": COMP_A, "status": "pending"},
        {"_id": "lvB1", "company_id": COMP_B, "status": "pending"},
        {"_id": "lvB2", "company_id": COMP_B, "status": "pending"},
        {"_id": "lvB3", "company_id": COMP_B, "status": "pending"},
    ])
    db.attendance.docs.extend([
        {"_id": "attE", "company_id": COMP_A, "early_leave_request": {"status": "pending"}},
        {"_id": "attI", "company_id": COMP_A, "intraday_leave_request": {"status": "pending"}},
        {"_id": "attG", "company_id": COMP_A, "geo_confirm_request": {"status": "pending"}},
        {"_id": "attD", "company_id": COMP_A, "dispute_note": "itiraz", "dispute_resolved": False},
        {"_id": "attB", "company_id": COMP_B, "early_leave_request": {"status": "pending"}, "dispute_note": "B-SECRET"},
    ])
    db.bonus_payments.docs.extend([
        {"_id": "advA", "company_id": COMP_A, "type": "advance", "source": "self", "status": "pending"},
        {"_id": "advB", "company_id": COMP_B, "type": "advance", "source": "self", "status": "pending"},
    ])
    db.bank_transactions.docs.extend([
        {"_id": "txA1", "company_id": COMP_A, "source": "bank_sync", "match_status": "unmatched"},
        {"_id": "txA2", "company_id": COMP_A, "source": "bank_sync", "match_status": "unmatched"},
        {"_id": "txB", "company_id": COMP_B, "source": "bank_sync", "match_status": "unmatched", "description": "B-SECRET"},
    ])
    for extra in range(4):
        db.bank_transactions.docs.append({
            "_id": f"txB{extra}", "company_id": COMP_B, "source": "bank_sync", "match_status": "unmatched",
        })
    db.work_orders.docs.extend([
        {"_id": "woR", "company_id": COMP_A, "status": "ready", "step_name": "Hazır", "station": "S1"},
        {"_id": "woI", "company_id": COMP_A, "status": "in_progress", "step_name": "Kesim", "station": "S2",
         "finished_product_name": "Mamul A"},
        {"_id": "woP", "company_id": COMP_A, "status": "paused", "step_name": "Durdu", "station": "S3"},
        {"_id": "woD", "company_id": COMP_A, "status": "done", "step_name": "Bitti", "station": "S4"},
        {"_id": "woB", "company_id": COMP_B, "status": "ready", "step_name": "B-SECRET-STEP", "station": "BX"},
    ])
    for extra in range(3):
        db.work_orders.docs.append({"_id": f"woB{extra}", "company_id": COMP_B, "status": "ready", "step_name": "B-SECRET-STEP"})
    db.incoming_edocs.docs.extend([
        {"_id": "edA", "company_id": COMP_A, "status": "pending"},
        {"_id": "edB", "company_id": COMP_B, "status": "pending"},
        {"_id": "edB2", "company_id": COMP_B, "status": "pending"},
    ])
    db.recipes.docs.extend([
        {"_id": "recA", "company_id": COMP_A, "name": "Reçete A", "finished_product_name": "Mamul A",
         "materials": [{"product_id": "pA"}], "steps": [{"name": "kes"}], "unit_cost": 4},
        {"_id": "recB", "company_id": COMP_B, "name": "B-SECRET-RECETE", "finished_product_name": "B-SECRET",
         "materials": [{}, {}], "steps": [{}, {}], "unit_cost": 99},
    ])
    db.production_orders.docs.extend([
        {"_id": "poA", "company_id": COMP_A, "status": "in_production", "order_code": "PO-A",
         "finished_product_name": "Mamul A", "planned_quantity": 2, "end_date": f"{MONTH}-04"},
        {"_id": "poB", "company_id": COMP_B, "status": "planned", "order_code": "B-SECRET-PO",
         "finished_product_name": "B-SECRET", "planned_quantity": 50},
    ])


def _routes():
    return [
        ("get", server.dashboard_overview, "/api/dashboard/overview", None),
        ("get", server.dashboard_ops_alerts, "/api/dashboard/ops-alerts", None),
        ("get", server.dashboard_tile_badges, "/api/dashboard/tile-badges", None),
        ("get", server.get_dashboard_stats, "/api/dashboard/stats", None),
        ("get", server.ai_production_summary, "/api/ai/production-summary", None),
        ("post", server.ask_production_ai, "/api/ai/production-advisor", {"message": "yorum"}),
        ("get", server.get_ai_cashflow_forecast, "/api/ai/cashflow-forecast", None),
    ]


def _no_foreign(text):
    assert "B-SECRET" not in text
    assert "NEXUS-ONLY" not in text


def _require_detail(company_id, key):
    try:
        _run(addons.require(company_id, key))
    except HTTPException as exc:
        assert exc.status_code == 403
        return exc.detail
    raise AssertionError(f"{key} was enabled for {company_id}")


@pytest.fixture
def api():
    db = MemDB()
    _seed(db)
    prev = (server.db, rbac._db, saas._db, addons._db, expenses._db)
    server.db = db
    rbac._db = db
    saas._db = db
    addons._db = db
    expenses._db = db
    saas.invalidate()
    router = server.app.router
    saved_up = list(router.on_startup)
    saved_down = list(router.on_shutdown)
    router.on_startup.clear()
    router.on_shutdown.clear()
    calls = []

    async def fake_advice(context, prompt, history=None):
        calls.append({"context": copy.deepcopy(context), "prompt": prompt, "history": history})
        return "MOCK-ADVICE"

    client = TestClient(server.app)
    entered = False
    try:
        with patch.object(server, "get_production_ai_advice", fake_advice):
            client.__enter__()
            entered = True
            yield client, db, calls
    finally:
        if entered:
            client.__exit__(None, None, None)
        server.db, rbac._db, saas._db, addons._db, expenses._db = prev
        router.on_startup[:] = saved_up
        router.on_shutdown[:] = saved_down
        saas.invalidate()


def _token(uid, *, superadmin=False, role="admin"):
    return auth_utils.create_access_token(uid, f"{uid}@example.com", role, is_super_admin=superadmin)


def _auth(uid, *, superadmin=False, role="admin"):
    return {"Authorization": f"Bearer {_token(uid, superadmin=superadmin, role=role)}"}


def _call(method, client, path, *, params=None, json_body=None, headers=None):
    if method == "get":
        return client.get(path, params=params, headers=headers)
    return client.post(path, params=params, json=json_body if json_body is not None else {}, headers=headers)


def test_route_signatures_and_payload_helpers():
    for method, fn, _path, _body in _routes():
        sig = inspect.signature(fn)
        assert sig.parameters["user"].default.dependency is server.get_current_user
        src = inspect.getsource(fn)
        assert "comp_nexus_main_01" not in src
        assert "resolve_company_id" in src
        if method == "get":
            assert sig.parameters["company_id"].default is None
    tile = inspect.getsource(server.dashboard_tile_badges)
    assert "request" not in inspect.signature(server.dashboard_tile_badges).parameters
    assert "try:" not in tile
    assert "await get_current_user(" not in tile
    payload = inspect.getsource(server.dashboard_tile_badges_payload)
    assert "get_current_user" not in payload
    assert "filter_notifications" in payload
    assert list(inspect.signature(server.dashboard_overview_payload).parameters) == ["company_id"]
    assert list(inspect.signature(server.dashboard_ops_alerts_payload).parameters) == ["company_id"]
    assert list(inspect.signature(server.dashboard_tile_badges_payload).parameters) == ["company_id", "user"]
    assert list(inspect.signature(server.dashboard_stats_payload).parameters) == ["company_id"]
    overview = inspect.getsource(server.dashboard_overview)
    assert "dashboard_overview_payload" in overview
    assert "get_budgets" not in overview
    assert "budgets_payload" not in overview
    assert "_dashboard_budgets" not in overview
    payload_src = inspect.getsource(server.dashboard_overview_payload)
    assert "expenses.budgets_payload(company_id)" in payload_src
    assert "get_budgets" not in payload_src
    assert "_dashboard_budgets" not in payload_src
    summary = inspect.getsource(server.ai_production_summary)
    assert summary.index("resolve_company_id") < summary.index("addons.require")
    assert summary.index("addons.require") < summary.index("_production_ai_context")
    assert summary.index("_production_ai_context") < summary.index("get_production_ai_advice")
    advisor = inspect.getsource(server.ask_production_ai)
    assert 'resolve_company_id(user, req.company_id)' in advisor
    assert advisor.index("resolve_company_id") < advisor.index("addons.require")
    assert advisor.index("addons.require") < advisor.index("_production_ai_context")
    assert advisor.index("get_production_ai_advice") > advisor.index("addons.require")
    cash = inspect.getsource(server.get_ai_cashflow_forecast)
    assert cash.index("resolve_company_id") < cash.index('addons.require')
    assert cash.index("addons.require") < cash.index("bank_accounts.find")
    assert "500000.0" in cash
    text = Path(server.__file__).read_text(encoding="utf-8")
    for name in (
        "dashboard_overview(", "dashboard_ops_alerts(", "dashboard_tile_badges(", "get_dashboard_stats(",
        "ai_production_summary(", "ask_production_ai(", "get_ai_cashflow_forecast(",
    ):
        assert f"await {name}" not in text
    root = _BACKEND
    needles = (
        "dashboard_overview(", "dashboard_ops_alerts(", "dashboard_tile_badges(", "get_dashboard_stats(",
        "ai_production_summary(", "ask_production_ai(", "get_ai_cashflow_forecast(",
    )
    for path in root.rglob("*.py"):
        if "tests" in path.parts or path.name == "server.py":
            continue
        blob = path.read_text(encoding="utf-8", errors="ignore")
        for needle in needles:
            assert needle not in blob, f"{path} calls {needle}"


def test_no_token_is_401(api):
    client, _db, calls = api
    for method, _fn, path, body in _routes():
        response = _call(method, client, path, json_body=body)
        assert response.status_code == 401, (path, response.text)
        assert response.json()["detail"] == "Giriş yapmanız gerekiyor."
        _no_foreign(response.text)
    assert calls == []


def test_other_company_is_403_and_ai_is_not_called(api):
    client, _db, calls = api
    headers = _auth("user-a")
    for method, _fn, path, body in _routes():
        payload = dict(body or {})
        payload["company_id"] = COMP_B
        if method == "get":
            response = client.get(path, params={"company_id": COMP_B}, headers=headers)
        else:
            response = client.post(path, json=payload, headers=headers)
        assert response.status_code == 403, (path, response.text)
        assert response.json()["detail"] == DENY
        _no_foreign(response.text)
    assert calls == []


def test_direct_other_company_is_403_without_ai(api):
    _client, _db, calls = api
    user = _user_a()
    for method, fn, _path, body in _routes():
        with pytest.raises(HTTPException) as exc:
            if method == "get":
                _run(fn(company_id=COMP_B, user=user))
            else:
                _run(fn(server.ProductionAIChatRequest(message="yorum", company_id=COMP_B), user=user))
        assert exc.value.status_code == 403
        assert exc.value.detail == DENY
    with pytest.raises(HTTPException) as exc:
        _run(server.ai_production_summary(company_id=COMP_A, user=None))
    assert exc.value.status_code == 401
    assert calls == []


def test_missing_company_uses_active_company(api):
    client, db, calls = api
    headers = _auth("user-a")
    user = _user_a()
    overview = client.get("/api/dashboard/overview", headers=headers)
    assert overview.status_code == 200, overview.text
    assert set(overview.json()) == OVERVIEW_KEYS
    assert overview.json() == _run(server.dashboard_overview_payload(COMP_A))
    _no_foreign(overview.text)

    ops = client.get("/api/dashboard/ops-alerts", headers=headers)
    assert ops.status_code == 200, ops.text
    assert {g["key"] for g in ops.json()["groups"]} == OPS_GROUP_KEYS
    assert ops.json() == _run(server.dashboard_ops_alerts_payload(COMP_A))
    _no_foreign(ops.text)

    badges = client.get("/api/dashboard/tile-badges", headers=headers)
    assert badges.status_code == 200, badges.text
    assert set(badges.json()) == TILE_KEYS
    assert badges.json() == _run(server.dashboard_tile_badges_payload(COMP_A, user))
    _no_foreign(badges.text)

    stats = client.get("/api/dashboard/stats", headers=headers)
    assert stats.status_code == 200, stats.text
    assert set(stats.json()) == STATS_KEYS
    assert len(stats.json()["chart_data"]) == 6
    assert stats.json()["total_bank_balance"] == 111
    assert stats.json()["total_receivables"] == 50
    _no_foreign(stats.text)

    summary = client.get("/api/ai/production-summary", headers=headers)
    assert summary.status_code == 200, summary.text
    assert set(summary.json()) == {"advice", "metrics"}
    assert set(summary.json()["metrics"]) == AI_METRIC_KEYS
    assert summary.json()["advice"] == "MOCK-ADVICE"
    assert summary.json()["metrics"]["company_id"] == COMP_A
    assert len(calls) == 1
    assert calls[0]["prompt"] == SUMMARY_PROMPT
    assert calls[0]["context"]["company_id"] == COMP_A
    assert calls[0]["context"]["company_name"] == "Firma A"
    assert calls[0]["context"]["recipes"] == 1
    assert "B-SECRET" not in json.dumps(calls[0]["context"], ensure_ascii=False)

    advisor = client.post("/api/ai/production-advisor", json={"message": "durum"}, headers=headers)
    assert advisor.status_code == 200, advisor.text
    assert advisor.json()["advice"] == "MOCK-ADVICE"
    assert advisor.json()["metrics"]["company_id"] == COMP_A
    assert len(calls) == 2
    assert calls[1]["prompt"] == "durum"
    assert calls[1]["context"]["company_id"] == COMP_A
    assert "B-SECRET" not in json.dumps(calls[1]["context"], ensure_ascii=False)

    cash = client.get("/api/ai/cashflow-forecast", headers=headers)
    assert cash.status_code == 200, cash.text
    body = cash.json()
    assert set(body) == CASH_KEYS
    assert body["current_cash"] == 111
    assert body["ai_summary"] == CASH_SUMMARY
    assert len(body["forecast_chart"]) == 30
    assert set(body["forecast_chart"][0]) == {"day", "projected_cash", "inflow", "outflow", "confidence"}
    direct = _run(server.get_ai_cashflow_forecast(company_id=None, user=user))
    assert body == direct
    assert len(calls) == 2


def test_own_company_matches_payload_and_previous_keys(api):
    client, _db, calls = api
    headers = _auth("user-a")
    user = _user_a()
    overview = client.get("/api/dashboard/overview", params={"company_id": COMP_A}, headers=headers)
    assert overview.status_code == 200, overview.text
    assert overview.json() == _run(server.dashboard_overview_payload(COMP_A))
    assert set(overview.json()["collections"]) == {"total", "overdue", "not_due"}
    assert set(overview.json()["vat"]) == {"month", "calculated", "deductible", "payable", "declaration_date", "days_left"}
    _no_foreign(overview.text)

    ops = client.get("/api/dashboard/ops-alerts", params={"company_id": COMP_A}, headers=headers)
    assert ops.json() == _run(server.dashboard_ops_alerts_payload(COMP_A))
    for group in ops.json()["groups"]:
        assert set(group) == {"key", "label", "path", "count", "items"}
    _no_foreign(ops.text)

    stats = client.get("/api/dashboard/stats", params={"company_id": COMP_A}, headers=headers)
    assert set(stats.json()) == STATS_KEYS
    assert stats.json()["total_bank_balance"] == 111
    assert "B-SECRET" not in stats.text
    assert calls == []


def test_super_admin_explicit_company_is_200(api):
    client, _db, calls = api
    headers = _auth("user-sa", superadmin=True)
    missing = client.get("/api/dashboard/overview", headers=headers)
    assert missing.status_code == 400, missing.text
    assert missing.json()["detail"] == "Şirket seçilmedi."
    _no_foreign(missing.text)

    overview = client.get("/api/dashboard/overview", params={"company_id": COMP_B}, headers=headers)
    assert overview.status_code == 200, overview.text
    assert overview.json() == _run(server.dashboard_overview_payload(COMP_B))
    assert any(row.get("category") == "B-SECRET" for row in overview.json()["budget_warnings"])
    assert "NEXUS-ONLY" not in overview.text

    ops = client.get("/api/dashboard/ops-alerts", params={"company_id": COMP_B}, headers=headers)
    assert ops.status_code == 200, ops.text
    low = next(g for g in ops.json()["groups"] if g["key"] == "low_stock")
    assert any("B-SECRET" in item.get("title", "") or "B-SECRET" in item.get("detail", "") for item in low["items"])

    badges = client.get("/api/dashboard/tile-badges", params={"company_id": COMP_B}, headers=headers)
    assert badges.status_code == 200, badges.text
    assert badges.json()["orders"] >= 8

    stats = client.get("/api/dashboard/stats", params={"company_id": COMP_B}, headers=headers)
    assert stats.status_code == 200, stats.text
    assert stats.json()["total_bank_balance"] == 222
    assert "Cari A" not in stats.text

    summary = client.get("/api/ai/production-summary", params={"company_id": COMP_B}, headers=headers)
    assert summary.status_code == 200, summary.text
    assert summary.json()["metrics"]["company_id"] == COMP_B
    assert calls[-1]["context"]["company_name"] == "B-SECRET LTD"
    assert calls[-1]["context"]["recipes"] == 1
    assert "Reçete A" not in json.dumps(calls[-1]["context"], ensure_ascii=False)

    advisor = client.post(
        "/api/ai/production-advisor",
        json={"message": "bak", "company_id": COMP_B},
        headers=_auth("user-sa-a", superadmin=True),
    )
    assert advisor.status_code == 200, advisor.text
    assert calls[-1]["context"]["company_id"] == COMP_B
    assert "Mamul A" not in json.dumps(calls[-1]["context"], ensure_ascii=False)

    cash = client.get("/api/ai/cashflow-forecast", params={"company_id": COMP_B}, headers=headers)
    assert cash.status_code == 200, cash.text
    assert cash.json()["current_cash"] == 222
    assert len(calls) == 2


def test_addon_off_matches_require_and_skips_ai(api):
    client, db, calls = api
    _set_addon(db, COMP_A, "ai.production", False)
    _set_addon(db, COMP_A, "ai.advisor", False)
    detail_prod = _require_detail(COMP_A, "ai.production")
    detail_adv = _require_detail(COMP_A, "ai.advisor")
    user = _user_a()
    headers = _auth("user-a")

    with pytest.raises(HTTPException) as exc:
        _run(server.ai_production_summary(company_id=COMP_A, user=user))
    assert exc.value.status_code == 403
    assert exc.value.detail == detail_prod
    with pytest.raises(HTTPException) as exc:
        _run(server.ask_production_ai(server.ProductionAIChatRequest(message="yorum", company_id=COMP_A), user=user))
    assert exc.value.status_code == 403
    assert exc.value.detail == detail_prod
    with pytest.raises(HTTPException) as exc:
        _run(server.get_ai_cashflow_forecast(company_id=COMP_A, user=user))
    assert exc.value.status_code == 403
    assert exc.value.detail == detail_adv

    summary = client.get("/api/ai/production-summary", params={"company_id": COMP_A}, headers=headers)
    assert summary.status_code == 403, summary.text
    advisor = client.post(
        "/api/ai/production-advisor",
        json={"message": "yorum", "company_id": COMP_A},
        headers=headers,
    )
    assert advisor.status_code == 403, advisor.text
    cash = client.get("/api/ai/cashflow-forecast", params={"company_id": COMP_A}, headers=headers)
    assert cash.status_code == 403, cash.text
    assert "111" not in cash.text
    assert calls == []

    async def _allow(*_args, **_kwargs):
        return None

    with patch.object(addons, "guard_request", _allow), patch.object(rbac, "_license_guard", _allow):
        summary = client.get("/api/ai/production-summary", params={"company_id": COMP_A}, headers=headers)
        advisor = client.post(
            "/api/ai/production-advisor",
            json={"message": "yorum", "company_id": COMP_A},
            headers=headers,
        )
        cash = client.get("/api/ai/cashflow-forecast", params={"company_id": COMP_A}, headers=headers)
    assert summary.status_code == 403, summary.text
    assert summary.json() == {"detail": detail_prod}
    assert advisor.status_code == 403, advisor.text
    assert advisor.json() == {"detail": detail_prod}
    assert cash.status_code == 403, cash.text
    assert cash.json() == {"detail": detail_adv}
    assert calls == []


def test_body_company_addon_off_is_require_even_if_active_company_is_on(api):
    """Middleware reads query/active company, not the JSON body."""
    client, db, calls = api
    _set_addon(db, COMP_B, "ai.production", False)
    detail = _require_detail(COMP_B, "ai.production")
    response = client.post(
        "/api/ai/production-advisor",
        json={"message": "yorum", "company_id": COMP_B},
        headers=_auth("user-sa-a", superadmin=True),
    )
    assert response.status_code == 403, response.text
    assert response.json() == {"detail": detail}
    assert calls == []


def test_own_company_with_addon_calls_ai_once_with_own_context(api):
    client, _db, calls = api
    headers = _auth("user-a")
    summary = client.get("/api/ai/production-summary", params={"company_id": COMP_A}, headers=headers)
    assert summary.status_code == 200, summary.text
    assert len(calls) == 1
    ctx = calls[0]["context"]
    assert ctx["company_id"] == COMP_A
    assert ctx["recipes"] == 1
    assert ctx["open_orders"] == 1
    assert ctx["in_production"] == 1
    assert ctx["open_work_orders"] == 2
    assert ctx["paused_work_orders"] == 1
    assert ctx["done_work_orders_recent"] == 1
    assert ctx["missing_notifications"] == 1
    assert [r["name"] for r in ctx["recipes_sample"]] == ["Reçete A"]
    assert "B-SECRET" not in json.dumps(ctx, ensure_ascii=False)
    assert summary.json()["metrics"]["company_name"] == "Firma A"
    assert "recipes_sample" not in summary.json()["metrics"]


def test_tile_badges_are_company_scoped_and_follow_visibility(api):
    client, _db, calls = api
    admin = client.get("/api/dashboard/tile-badges", params={"company_id": COMP_A}, headers=_auth("user-a"))
    assert admin.status_code == 200, admin.text
    body = admin.json()
    assert body == {
        "orders": 1,
        "sevk": 3,
        "personnel": 6,
        "banking": 2,
        "atolye": 3,
        "edoc": 1,
        "unread": 5,
    }
    assert body == _run(server.dashboard_tile_badges_payload(COMP_A, _user_a()))
    staff_user = _user("user-staff", [COMP_A], COMP_A, role="warehouse", employee_id="emp-staff")
    staff = client.get(
        "/api/dashboard/tile-badges",
        params={"company_id": COMP_A},
        headers=_auth("user-staff", role="warehouse"),
    )
    assert staff.status_code == 200, staff.text
    assert staff.json()["orders"] == 1
    assert staff.json()["sevk"] == 3
    assert staff.json()["personnel"] == 6
    assert staff.json()["unread"] == 2
    assert staff.json() == _run(server.dashboard_tile_badges_payload(COMP_A, staff_user))
    assert "B-SECRET" not in admin.text
    assert calls == []


def test_overview_budget_follows_whichever_helper_exists(api):
    client, _db, calls = api
    headers = _auth("user-a")
    helper = getattr(expenses, "budgets_payload", None) or expenses.get_budgets
    expected = _run(helper(COMP_A))
    overview = client.get("/api/dashboard/overview", params={"company_id": COMP_A}, headers=headers)
    assert overview.status_code == 200, overview.text
    assert overview.json()["budget_warnings"] == expected["warnings"]
    assert any(row.get("category") == "Kira" for row in overview.json()["budget_warnings"])
    assert all(row.get("category") != "B-SECRET" for row in overview.json()["budget_warnings"])

    async def budgets_payload(company_id, month=None):
        assert company_id == COMP_A
        return {"month": month or MONTH, "rows": [], "warnings": [{"category": "FROM-PAYLOAD", "status": "over"}], "totals": {}}

    with patch.object(expenses, "budgets_payload", budgets_payload, create=True):
        forced = _run(server.dashboard_overview_payload(COMP_A))
    assert forced["budget_warnings"] == [{"category": "FROM-PAYLOAD", "status": "over"}]
    assert calls == []
