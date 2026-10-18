"""GET /dashboard/manager-summary — geçici MongoDB 27999, tamkobi_test_* .

Canlı veritabanına ve 8021 portuna bağlanmaz.
"""
from __future__ import annotations

import asyncio
import inspect
import os
import sys
from datetime import datetime
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import HTTPException

os.environ.setdefault("JWT_SECRET", "test-dashboard-manager-summary-jwt-secret-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import addons  # noqa: E402
import rbac  # noqa: E402
import saas  # noqa: E402
import server  # noqa: E402
from mongo_27999 import ensure_mongod  # noqa: E402

CO = "co_mgr"
CO_OTHER = "co_other"
CO_NOV = "co_nov"
CO_LIC = "co_lic"
OCT18 = datetime(2026, 10, 18, 12, 0, tzinfo=server._IST)
NOV1 = datetime(2026, 11, 1, 1, 0, tzinfo=server._IST)


def _run(coro):
    return asyncio.run(coro)


def _user(uid, companies, active, role="admin"):
    return {
        "_id": uid,
        "id": uid,
        "email": f"{uid}@example.com",
        "name": uid,
        "role": role,
        "is_active": True,
        "is_super_admin": False,
        "company_ids": list(companies),
        "active_company_id": active,
    }


def _bind(db):
    prev = (server.db, rbac._db, saas._db, addons._db)
    server.db = db
    rbac._db = db
    saas._db = db
    addons._db = db
    saas.invalidate()
    return prev


def _restore(prev):
    server.db, rbac._db, saas._db, addons._db = prev
    saas.invalidate()


async def _role(db, cid, code, production, projects):
    await db.roles.insert_one({
        "_id": f"role_{cid}_{code}",
        "company_id": cid,
        "code": code,
        "name": code,
        "is_system": False,
        "perm_levels_v2": True,
        "permissions": {
            "/": "view",
            "/production": production,
            "/projects": projects,
        },
    })


@pytest.fixture(scope="module")
def mongo_url():
    url = ensure_mongod()
    assert "27999" in url and "8021" not in url
    return url


def test_route_resolves_company_and_passes_cid_to_role_for():
    src = inspect.getsource(server.dashboard_manager_summary)
    access = inspect.getsource(server._manager_summary_access)
    assert "comp_nexus_main_01" not in src
    assert "comp_nexus_main_01" not in access
    assert "resolve_company_id(user, company_id)" in src
    assert "role_for(user, cid)" in access
    assert any(getattr(route, "path", "") == "/api/dashboard/manager-summary" for route in server.app.routes)


def test_manager_summary_permissions_and_payload(mongo_url):
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _go():
        client = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=4000)
        name = "tamkobi_test_dashboard_mgr"
        db = client[name]
        await client.drop_database(name)
        prev = _bind(db)
        try:
            await _seed_october(db)
            await _role(db, CO, "prodonly", "view", "none")
            await _role(db, CO, "projonly", "none", "view")
            await _role(db, CO, "norole", "none", "none")
            with patch.object(server, "_tr_now", return_value=OCT18):
                admin = await server.dashboard_manager_summary(company_id=CO, user=_user("admin", [CO], CO))
                prod = await server.dashboard_manager_summary(
                    company_id=CO, user=_user("p", [CO], CO, role="prodonly"),
                )
                proj = await server.dashboard_manager_summary(
                    company_id=CO, user=_user("j", [CO], CO, role="projonly"),
                )
                empty = await server.dashboard_manager_summary(
                    company_id=CO, user=_user("n", [CO], CO, role="norole"),
                )
            assert set(admin) == {"production", "projects"}
            _assert_production(admin["production"])
            _assert_projects(admin["projects"])
            assert "projects" not in prod
            assert "production" in prod
            assert prod["production"]["open"] == admin["production"]["open"]
            assert "production" not in proj
            assert "projects" in proj
            assert proj["projects"]["active"] == admin["projects"]["active"]
            assert empty == {}
            with pytest.raises(HTTPException) as exc:
                await server.dashboard_manager_summary(company_id=CO_OTHER, user=_user("admin", [CO], CO))
            assert exc.value.status_code in (403, 404)
        finally:
            _restore(prev)
            client.close()

    _run(_go())


def test_manager_summary_hides_unlicensed_module(mongo_url):
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _go():
        client = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=4000)
        name = "tamkobi_test_dashboard_mgr_lic"
        db = client[name]
        await client.drop_database(name)
        prev = _bind(db)
        try:
            await db.companies.insert_one({"_id": CO_LIC, "name": "Lisans"})
            await db.company_licenses.insert_one({
                "_id": CO_LIC,
                "status": "active",
                "plan_id": "plan_missing",
                "module_overrides": {"/projects": False},
            })
            saas.invalidate()
            with patch.object(server, "_tr_now", return_value=OCT18):
                body = await server.dashboard_manager_summary(
                    company_id=CO_LIC, user=_user("admin", [CO_LIC], CO_LIC),
                )
            assert "projects" not in body
            assert set(body) == {"production"}
            await db.company_licenses.update_one(
                {"_id": CO_LIC},
                {"$set": {"module_overrides": {"/production": False, "/projects": False}}},
            )
            saas.invalidate()
            with patch.object(server, "_tr_now", return_value=OCT18):
                closed = await server.dashboard_manager_summary(
                    company_id=CO_LIC, user=_user("admin", [CO_LIC], CO_LIC),
                )
            assert closed == {}
        finally:
            _restore(prev)
            client.close()

    _run(_go())


def test_completed_month_and_kpis_use_istanbul(mongo_url):
    from motor.motor_asyncio import AsyncIOMotorClient

    async def _go():
        client = AsyncIOMotorClient(mongo_url, serverSelectionTimeoutMS=4000)
        name = "tamkobi_test_dashboard_mgr_month"
        db = client[name]
        await client.drop_database(name)
        prev = _bind(db)
        try:
            await db.companies.insert_one({"_id": CO_NOV, "name": "Kasım"})
            await db.production_orders.insert_many([
                {"_id": "nov-date", "company_id": CO_NOV, "status": "completed", "end_date": "2026-11-02",
                 "order_code": "N1"},
                {"_id": "oct-date", "company_id": CO_NOV, "status": "completed", "end_date": "2026-10-31",
                 "order_code": "N2"},
                {"_id": "utc-spill", "company_id": CO_NOV, "status": "completed",
                 "end_date": "2026-10-31T22:00:00Z", "order_code": "N3"},
                {"_id": "dec-spill", "company_id": CO_NOV, "status": "completed",
                 "end_date": "2026-11-30T22:00:00Z", "order_code": "N4"},
                {"_id": "blank", "company_id": CO_NOV, "status": "completed", "end_date": None, "order_code": "N5"},
            ])
            user = _user("admin", [CO_NOV], CO_NOV)
            with patch.object(server, "_tr_now", return_value=NOV1):
                body = await server.dashboard_manager_summary(company_id=CO_NOV, user=user)
                kpis = await server.production_order_kpis(company_id=CO_NOV, user=user)
            matched = await db.production_orders.find(
                server._completed_in_tr_month_query(CO_NOV, NOV1), {"_id": 1},
            ).to_list(20)
            assert sorted(r["_id"] for r in matched) == ["nov-date", "utc-spill"]
            assert body["production"]["completed_this_month"] == 2
            # KPI ayı _tr_now() ile TR YYYY-MM öneki. "2026-11-30T22:00:00Z" önekle
            # Kasım'a düşer; "2026-10-31T22:00:00Z" düşmez. Gün sınırı yönetici özetindedir.
            kpi_rows = await db.production_orders.find(
                {"company_id": CO_NOV, "status": "completed", "end_date": {"$regex": "^2026-11"}},
                {"_id": 1},
            ).to_list(20)
            assert sorted(r["_id"] for r in kpi_rows) == ["dec-spill", "nov-date"]
            assert kpis["completed_this_month"] == 2
            assert NOV1.astimezone(server._IST).strftime("%Y-%m") == "2026-11"
            assert NOV1.astimezone(server._IST).strftime("%Y-%m-%d") == "2026-11-01"
        finally:
            _restore(prev)
            client.close()

    _run(_go())


async def _seed_october(db):
    await db.companies.insert_one({
        "_id": CO,
        "name": "Yönetim",
        "project_stages": [
            {"key": "planning", "label": "Planlama", "tone": "slate"},
            {"key": "build", "label": "İmalat", "tone": "blue"},
            {"key": "shipped", "label": "Teslim", "tone": "emerald", "is_final": True},
        ],
    })
    await db.production_orders.insert_many([
        {"_id": "u1", "company_id": CO, "order_code": "U1", "status": "planned",
         "finished_product_name": "Masa", "planned_quantity": 10, "completed_quantity": 2,
         "planned_date": "2026-10-17", "created_at": "2026-10-01"},
        {"_id": "u2", "company_id": CO, "order_code": "U2", "status": "planned",
         "finished_product_name": "Sandalye", "planned_quantity": 4, "completed_quantity": 0,
         "planned_date": "2026-10-18", "created_at": "2026-10-02"},
        {"_id": "u3", "company_id": CO, "order_code": "U3", "status": "planned",
         "finished_product_name": "Dolap", "planned_quantity": 1, "completed_quantity": 0,
         "planned_date": "2026-10-19", "created_at": "2026-10-03"},
        {"_id": "u4", "company_id": CO, "order_code": "U4", "status": "planned",
         "finished_product_name": "Raf", "planned_quantity": 8, "completed_quantity": 0,
         "planned_date": "2026-10-25", "created_at": "2026-10-04"},
        {"_id": "u5", "company_id": CO, "order_code": "U5", "status": "in_production",
         "finished_product_name": "Kapı", "planned_quantity": 3, "completed_quantity": 1,
         "planned_date": None, "created_at": "2026-10-05"},
        {"_id": "u6", "company_id": CO, "order_code": "U6", "status": "completed",
         "finished_product_name": "Eski", "planned_quantity": 1, "completed_quantity": 1,
         "planned_date": "2026-10-17", "end_date": "2026-10-17", "created_at": "2026-10-06"},
    ])
    start, end = server._tr_day_utc_bounds(OCT18.date())
    await db.work_orders.insert_many([
        {"_id": "w1a", "company_id": CO, "order_id": "u1", "step_no": 1, "step_name": "Hazırlık",
         "status": "done", "operator_name": "Ali"},
        {"_id": "w1b", "company_id": CO, "order_id": "u1", "step_no": 2, "step_name": "Kesim",
         "status": "in_progress", "operator_name": "Ayşe"},
        {"_id": "w4", "company_id": CO, "order_id": "u4", "step_no": 1, "step_name": "Gizli",
         "status": "done"},
        {"_id": "d-start", "company_id": CO, "order_id": "u2", "status": "done",
         "finished_at": start, "produced_qty": 2},
        {"_id": "d-before", "company_id": CO, "order_id": "u2", "status": "done",
         "finished_at": "2026-10-17T20:59:59Z", "produced_qty": 9},
        {"_id": "d-late", "company_id": CO, "order_id": "u2", "status": "done",
         "finished_at": "2026-10-18T20:59:59Z", "produced_qty": 3},
        {"_id": "d-next", "company_id": CO, "order_id": "u2", "status": "done",
         "finished_at": end + "Z", "produced_qty": 7},
        {"_id": "d-open", "company_id": CO, "order_id": "u2", "status": "in_progress",
         "finished_at": "2026-10-18T10:00:00Z", "produced_qty": 4},
        {"_id": "d-other", "company_id": CO_OTHER, "order_id": "xx", "status": "done",
         "finished_at": "2026-10-18T10:00:00Z", "produced_qty": 100},
    ])
    await db.projects.insert_many([
        {"_id": "p-over", "company_id": CO, "name": "Geciken", "project_number": "PRJ-1",
         "status": "build", "end_date": "2026-10-10", "budget": 100},
        {"_id": "p-soon", "company_id": CO, "name": "Yakın", "project_number": "PRJ-2",
         "status": "planning", "end_date": "2026-10-20", "budget": 30},
        {"_id": "p-later", "company_id": CO, "name": "Uzak", "project_number": "PRJ-3",
         "status": "build", "end_date": "2026-11-01", "budget": 5},
        {"_id": "p-weird", "company_id": CO, "name": "Bilinmeyen", "project_number": "PRJ-4",
         "status": "weird", "end_date": "2026-10-12", "budget": 1},
        {"_id": "p-final", "company_id": CO, "name": "Teslim", "project_number": "PRJ-5",
         "status": "shipped", "end_date": "2026-10-01", "budget": 999},
        {"_id": "p-done", "company_id": CO, "name": "Bitti", "project_number": "PRJ-6",
         "status": "completed", "end_date": "2026-10-01", "budget": 888},
    ])
    await db.expenses.insert_many([
        {"_id": "e1", "company_id": CO, "project_id": "p-over", "total": 40},
        {"_id": "e2", "company_id": CO, "project_id": "p-soon", "total": 10},
        {"_id": "e3", "company_id": CO, "project_id": "p-final", "total": 5000},
    ])
    await db.invoices.insert_many([
        {"_id": "i1", "company_id": CO, "project_id": "p-over", "invoice_type": "purchase",
         "status": "issued", "grand_total": 60},
        {"_id": "i2", "company_id": CO, "project_id": "p-over", "invoice_type": "purchase",
         "status": "cancelled", "grand_total": 500},
        {"_id": "i3", "company_id": CO, "project_id": "p-over", "invoice_type": "sales",
         "status": "issued", "grand_total": 999},
        {"_id": "i4", "company_id": CO, "project_id": "p-soon", "invoice_type": "purchase",
         "status": "draft", "grand_total": 50},
        {"_id": "i5", "company_id": CO, "project_id": "p-final", "invoice_type": "purchase",
         "status": "issued", "grand_total": 70},
    ])


def _assert_production(prod):
    assert prod["open"] == 5
    assert prod["in_production"] == 1
    assert prod["late"] == 1
    assert prod["today_done_steps"] == 2
    assert prod["today_produced"] == 5
    assert len(prod["top_orders"]) == 3
    assert [row["order_code"] for row in prod["top_orders"]] == ["U1", "U2", "U3"]
    assert [row["late"] for row in prod["top_orders"]] == [True, False, False]
    assert prod["top_orders"][0]["steps"] == {"done": 1, "total": 2, "current_step_name": "Kesim"}
    assert "Gizli" not in str(prod["top_orders"])


def _assert_projects(projects):
    assert projects["active"] == 4
    assert projects["overdue"] == 2
    assert projects["budget_total"] == 136
    assert projects["cost_total"] == 110
    assert [row["project_number"] for row in projects["top_projects"]] == ["PRJ-1", "PRJ-4", "PRJ-2"]
    first, unknown, soon = projects["top_projects"]
    assert first["overdue"] is True
    assert first["stage_label"] == "İmalat"
    assert first["progress_pct"] == 67
    assert first["cost_total"] == 100
    assert first["budget"] == 100
    assert unknown["progress_pct"] == 0
    assert unknown["stage_label"] == ""
    assert unknown["overdue"] is True
    assert soon["overdue"] is False
    assert soon["stage_label"] == "Planlama"
    assert soon["progress_pct"] == 33
    assert soon["cost_total"] == 10
