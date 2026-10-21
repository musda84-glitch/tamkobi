"""Üretim / iş emrine proje, sipariş ve reçete bağı.

Bellek içi veritabanı. Canlı veritabanına ve ağa bağlanmaz.
"""
from __future__ import annotations

import asyncio
import copy
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException, Response

_BACKEND = Path(__file__).resolve().parents[1]
_TESTS = Path(__file__).resolve().parent
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))
sys.path.insert(0, str(_TESTS))

import order_pick  # noqa: E402
import server  # noqa: E402
import shopfloor_queue  # noqa: E402
from test_shopfloor_pin import MemDB, _user  # noqa: E402

CID = "c1"
OTHER = "c2"
SECRET_PROJECT = "GizliProje"
SECRET_CUSTOMER = "GizliMusteri"
SECRET_PRODUCT = "GizliUrun"
SECRET_RECIPE = "GizliRecete"


@pytest.fixture
def mem():
    db = MemDB()
    prev = server.db
    prev_pick = (order_pick._db, order_pick._create_production_order)
    server.db = db
    order_pick.init(db, {"create_production_order": server.create_production_order})
    yield db
    server.db = prev
    order_pick._db, order_pick._create_production_order = prev_pick


def _admin(company=CID):
    return _user("admin-" + company, company, name="Yonetici", role="admin")


def _seed_company(db, company, park="Kesim"):
    db.companies.docs.append({"_id": company, "work_parks": [{"name": park}]})


def _project(company, pid, number, name):
    return {"_id": pid, "company_id": company, "project_number": number, "name": name}


def _order(company, oid, number, customer, project_id, product_id="prod-1"):
    return {
        "_id": oid,
        "company_id": company,
        "order_number": number,
        "customer_name": customer,
        "contact_id": "cus-" + company,
        "project_id": project_id,
        "order_status": "approved",
        "channel": "manual",
        "items": [{
            "product_id": product_id,
            "product_name": "Dolap",
            "quantity": 2,
            "unit": "Adet",
            "type": "product",
        }],
    }


def _product(company, pid="prod-1", name="Dolap"):
    return {
        "_id": pid,
        "company_id": company,
        "name": name,
        "type": "product",
        "unit": "Adet",
        "purchase_price": 10,
    }


def _recipe(company, rid, name, product_id="prod-1"):
    return {
        "_id": rid,
        "company_id": company,
        "name": name,
        "finished_product_id": product_id,
        "finished_product_name": "Dolap",
        "target_quantity": 1,
        "unit": "Adet",
        "is_active": True,
        "job_file_name": "ORNEK-DOSYA.pdf",
        "materials": [{
            "product_id": "mat-1",
            "product_name": "Levha",
            "quantity": 1,
            "unit": "Adet",
            "steps": [{"no": 1, "name": "Kesim", "station": "Kesim", "duration_min": 5}],
        }],
        "steps": [],
    }


def test_order_paths_copy_links_onto_work_orders(mem):
    _seed_company(mem, CID)
    mem.projects.docs.append(_project(CID, "prj-1", "PRJ-0001", "Örnek Otel"))
    mem.orders.docs.append(_order(CID, "ord-1", "SP-0001", "Örnek Müşteri A", "prj-1"))
    mem.products.docs.append(_product(CID))
    user = _admin()

    created = asyncio.run(server.create_production_recipe_from_order("ord-1", {}, user))
    po = created["production_order"]
    assert po["sales_order_id"] == "ord-1"
    assert po["sales_order_no"] == "SP-0001"
    assert po["customer_id"] == "cus-" + CID
    assert po["customer_name"] == "Örnek Müşteri A"
    assert po["project_id"] == "prj-1"
    assert po["project_number"] == "PRJ-0001"
    assert po["source"] == "sales_order"
    wos = [row for row in mem.work_orders.docs if row.get("company_id") == CID and row.get("order_id") == po["id"]]
    assert wos
    for row in wos:
        assert row["project_id"] == "prj-1"
        assert row["project_name"] == "Örnek Otel"
        assert row["project_number"] == "PRJ-0001"
        assert row["sales_order_id"] == "ord-1"
        assert row["sales_order_no"] == "SP-0001"
        assert row["customer_id"] == "cus-" + CID
        assert row["customer_name"] == "Örnek Müşteri A"
        assert row["recipe_id"]

    direct = asyncio.run(server.create_production_order({
        "company_id": CID,
        "finished_product_id": "prod-1",
        "planned_quantity": 1,
        "source": "order",
        "sales_order_id": "ord-1",
        "allow_without_recipe": True,
    }, user))
    direct_wos = [row for row in mem.work_orders.docs if row.get("order_id") == direct["id"]]
    assert direct_wos
    assert direct_wos[0]["sales_order_no"] == "SP-0001"
    assert direct_wos[0]["project_name"] == "Örnek Otel"
    assert direct_wos[0]["customer_name"] == "Örnek Müşteri A"

    picked = asyncio.run(order_pick.send_missing_to_production("ord-1", user))
    assert picked["created"]
    pick_po = next(row for row in mem.production_orders.docs if row.get("order_code") == picked["created"][0]["order_code"])
    assert pick_po["source"] == "order_pick"
    assert pick_po["sales_order_id"] == "ord-1"
    assert pick_po["project_id"] == "prj-1"
    assert pick_po["customer_name"] == "Örnek Müşteri A"
    pick_wos = [row for row in mem.work_orders.docs if row.get("order_id") == pick_po["_id"]]
    assert pick_wos[0]["recipe_id"] in ("", None) or pick_wos[0]["sales_order_no"] == "SP-0001"
    assert pick_wos[0]["sales_order_no"] == "SP-0001"
    assert pick_wos[0]["project_id"] == "prj-1"


def test_foreign_project_id_is_rejected(mem):
    _seed_company(mem, CID)
    _seed_company(mem, OTHER, "Montaj")
    mem.projects.docs.append(_project(OTHER, "prj-b", "PRJ-B", SECRET_PROJECT))
    mem.projects.docs.append(_project(CID, "prj-a", "PRJ-0001", "Örnek Otel"))
    mem.orders.docs.append(_order(CID, "ord-1", "SP-0001", "Örnek Müşteri A", "prj-a"))
    mem.products.docs.append(_product(CID))
    before = copy.deepcopy(mem.production_orders.docs)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.create_production_order({
            "company_id": CID,
            "finished_product_id": "prod-1",
            "planned_quantity": 1,
            "source": "order",
            "sales_order_id": "ord-1",
            "project_id": "prj-b",
            "allow_without_recipe": True,
        }, _admin()))
    assert exc.value.status_code == 400
    assert mem.production_orders.docs == before
    assert SECRET_PROJECT not in str(mem.production_orders.docs)
    assert SECRET_PROJECT not in str(mem.work_orders.docs)
    own = asyncio.run(server.create_production_order({
        "company_id": CID,
        "finished_product_id": "prod-1",
        "planned_quantity": 1,
        "source": "order_pick",
        "sales_order_id": "ord-1",
        "project_id": "prj-a",
        "allow_without_recipe": True,
    }, _admin()))
    assert own["project_id"] == "prj-a"
    assert own["project_number"] == "PRJ-0001"
    assert own.get("project_id") != "prj-b"


def test_shopfloor_filters_and_old_rows(mem):
    _seed_company(mem, CID)
    mem.projects.docs.extend([
        _project(CID, "prj-1", "PRJ-0001", "Örnek Otel"),
        _project(CID, "prj-2", "PRJ-0002", "Örnek Okul"),
    ])
    mem.recipes.docs.extend([
        _recipe(CID, "rec-1", "Örnek Reçete Dolap-60"),
        _recipe(CID, "rec-2", "Örnek Reçete Raf-120"),
    ])
    mem.production_orders.docs.extend([
        {
            "_id": "po-1", "company_id": CID, "status": "in_production", "order_code": "URT-1",
            "recipe_id": "rec-1", "recipe_name": "Örnek Reçete Dolap-60",
            "project_id": "prj-1", "project_number": "PRJ-0001",
            "sales_order_id": "ord-1", "sales_order_no": "SP-0001",
            "customer_id": "cus-c1", "customer_name": "Örnek Müşteri A", "priority": 2,
        },
        {
            "_id": "po-2", "company_id": CID, "status": "in_production", "order_code": "URT-2",
            "recipe_id": "rec-2", "recipe_name": "Örnek Reçete Raf-120",
            "project_id": "prj-2", "sales_order_no": "SP-0002",
            "customer_name": "Örnek Müşteri B", "priority": 1,
        },
        {
            "_id": "po-none", "company_id": CID, "status": "planned", "order_code": "URT-3",
            "recipe_id": "rec-1", "priority": 3,
        },
        {"_id": "po-old", "company_id": CID, "status": "planned", "order_code": "URT-OLD", "priority": 4},
        {"_id": "po-cancel", "company_id": CID, "status": "cancelled", "order_code": "URT-X"},
    ])
    def _job(wid, order_id, station, **extra):
        row = {
            "_id": wid, "company_id": CID, "order_id": order_id, "order_code": order_id,
            "product_name": "Dolap", "step_name": "Kesim", "step_no": 1, "station": station,
            "status": "ready", "planned_quantity": 10, "unit": "Adet", "images": [],
            "step_note": "eski", "operator_name": "", "operator_employee_id": "",
        }
        row.update(extra)
        return row
    mem.work_orders.docs.extend([
        _job("wo-1", "po-1", "Kesim", project_id="prj-1", project_number="PRJ-0001", project_name="Örnek Otel",
             recipe_id="rec-1", recipe_name="Örnek Reçete Dolap-60", sales_order_no="SP-0001",
             customer_name="Örnek Müşteri A", job_file_name="ORNEK-DOSYA.pdf"),
        _job("wo-2", "po-2", "Montaj", project_id="prj-2", project_name="Örnek Okul", recipe_id="rec-2",
             recipe_name="Örnek Reçete Raf-120", sales_order_no="SP-0002", customer_name="Örnek Müşteri B"),
        _job("wo-none", "po-none", "Kesim", recipe_id="rec-1", recipe_name="Örnek Reçete Dolap-60"),
        _job("wo-old", "po-old", "Kesim", product_name="Eski Dolap"),
        _job("wo-cancel", "po-cancel", "Kesim", product_name="Iptal"),
        _job("wo-done", "po-1", "Kesim", status="done"),
    ])
    stored_old = copy.deepcopy(next(row for row in mem.work_orders.docs if row["_id"] == "wo-old"))
    user = _admin()
    listed = asyncio.run(server.list_work_orders(Response(), company_id=CID, user=user))
    by_id = {row["id"]: row for row in listed}
    assert "wo-cancel" not in by_id
    assert by_id["wo-old"]["product_name"] == "Eski Dolap"
    assert by_id["wo-old"]["order_code"] == "po-old"
    assert by_id["wo-old"].get("status") == "ready"
    assert "project_id" not in stored_old or not stored_old.get("project_id")
    fresh_old = next(row for row in mem.work_orders.docs if row["_id"] == "wo-old")
    assert "project_id" not in fresh_old
    assert fresh_old["product_name"] == "Eski Dolap"

    queue = asyncio.run(shopfloor_queue.list_next(user, None))
    qids = [row["id"] for row in queue]
    assert "wo-old" in qids
    assert "wo-done" not in qids
    assert "wo-cancel" not in qids
    old = next(row for row in queue if row["id"] == "wo-old")
    for key in ("recipe_id", "recipe_name", "customer_name", "project_id", "project_name", "sales_order_no", "job_file_name"):
        assert key in old
        assert old[key] in (None, "")
    card = next(row for row in queue if row["id"] == "wo-1")
    assert card["project_name"] == "Örnek Otel"
    assert card["sales_order_no"] == "SP-0001"
    assert card["customer_name"] == "Örnek Müşteri A"
    assert card["recipe_id"] == "rec-1"
    assert card["recipe_name"] == "Örnek Reçete Dolap-60"
    assert card["job_file_name"] == "ORNEK-DOSYA.pdf"

    only_hotel = asyncio.run(shopfloor_queue.list_next(user, None, project_id="prj-1"))
    assert {row["id"] for row in only_hotel} == {"wo-1"}
    only_recipe = asyncio.run(shopfloor_queue.list_next(user, None, recipe_id="rec-2"))
    assert [row["id"] for row in only_recipe] == ["wo-2"]
    unassigned = asyncio.run(shopfloor_queue.list_next(user, None, project_id="none"))
    assert {row["id"] for row in unassigned} == {"wo-none", "wo-old"}
    listed_none = asyncio.run(server.list_work_orders(Response(), company_id=CID, project_id="none", user=user))
    assert {row["id"] for row in listed_none} == {"wo-none", "wo-old"}
    listed_recipe = asyncio.run(server.list_work_orders(Response(), company_id=CID, recipe_id="rec-1", user=user))
    assert {row["id"] for row in listed_recipe} == {"wo-1", "wo-none", "wo-done"}

    device = _user("dev1", CID, name="Kiosk", role="atolye_device", account_type="atolye_device", stations=["Kesim"])
    filters = asyncio.run(shopfloor_queue.list_filters(device))
    project_ids = {row["project_id"]: row["job_count"] for row in filters["projects"]}
    assert project_ids["prj-1"] == 1
    assert "prj-2" not in project_ids
    assert project_ids["none"] == 2
    recipe_ids = {row["recipe_id"]: row["job_count"] for row in filters["recipes"]}
    assert recipe_ids["rec-1"] == 2
    assert "rec-2" not in recipe_ids
    with pytest.raises(HTTPException) as denied:
        asyncio.run(shopfloor_queue.list_filters(device, "Montaj"))
    assert denied.value.status_code == 403


def test_same_id_stays_inside_company(mem):
    _seed_company(mem, CID)
    _seed_company(mem, OTHER, "Montaj")
    mem.projects.docs.extend([
        _project(CID, "prj", "PRJ-A", "Örnek Otel"),
        _project(OTHER, "prj", "PRJ-B", SECRET_PROJECT),
    ])
    mem.recipes.docs.extend([
        _recipe(CID, "rec", "Örnek Reçete"),
        _recipe(OTHER, "rec", SECRET_RECIPE),
    ])
    mem.orders.docs.extend([
        _order(CID, "ord", "SP-A", "Örnek Müşteri A", "prj"),
        _order(OTHER, "ord", "SP-B", SECRET_CUSTOMER, "prj", product_id="prod-b"),
    ])
    mem.products.docs.extend([
        _product(CID, "prod-1", "Dolap"),
        _product(OTHER, "prod-b", SECRET_PRODUCT),
    ])
    mem.production_orders.docs.extend([
        {
            "_id": "po", "company_id": CID, "status": "in_production", "order_code": "URT-A",
            "recipe_id": "rec", "recipe_name": "Örnek Reçete", "project_id": "prj",
            "project_number": "PRJ-A", "sales_order_id": "ord", "sales_order_no": "SP-A",
            "customer_id": "cus-c1", "customer_name": "Örnek Müşteri A", "priority": 1,
            "finished_product_name": "Dolap",
        },
        {
            "_id": "po", "company_id": OTHER, "status": "in_production", "order_code": "URT-B",
            "recipe_id": "rec", "recipe_name": SECRET_RECIPE, "project_id": "prj",
            "project_number": "PRJ-B", "sales_order_id": "ord", "sales_order_no": "SP-B",
            "customer_name": SECRET_CUSTOMER, "priority": 1,
            "finished_product_name": SECRET_PRODUCT,
        },
    ])
    mem.work_orders.docs.extend([
        {
            "_id": "wo", "company_id": CID, "order_id": "po", "order_code": "URT-A",
            "product_name": "Dolap", "step_name": "Kesim", "step_no": 1, "station": "Kesim",
            "status": "ready", "planned_quantity": 1, "unit": "Adet", "images": [], "step_note": "a",
        },
        {
            "_id": "wo", "company_id": OTHER, "order_id": "po", "order_code": "URT-B",
            "product_name": SECRET_PRODUCT, "step_name": "Montaj", "step_no": 1, "station": "Montaj",
            "status": "ready", "planned_quantity": 1, "unit": "Adet", "images": [], "step_note": "b",
            "project_name": SECRET_PROJECT, "customer_name": SECRET_CUSTOMER, "recipe_name": SECRET_RECIPE,
        },
    ])
    user = _admin()
    listed = asyncio.run(server.list_work_orders(Response(), company_id=CID, user=user))
    assert len(listed) == 1
    assert listed[0]["product_name"] == "Dolap"
    assert listed[0]["project_name"] == "Örnek Otel"
    assert listed[0]["customer_name"] == "Örnek Müşteri A"
    assert listed[0]["recipe_name"] == "Örnek Reçete"
    assert listed[0]["sales_order_no"] == "SP-A"
    blob = str(listed)
    assert SECRET_PROJECT not in blob
    assert SECRET_CUSTOMER not in blob
    assert SECRET_PRODUCT not in blob
    assert SECRET_RECIPE not in blob

    queue = asyncio.run(shopfloor_queue.list_next(user, None))
    assert len(queue) == 1
    assert queue[0]["project_name"] == "Örnek Otel"
    assert SECRET_PROJECT not in str(queue)
    assert SECRET_PRODUCT not in str(queue)
    filters = asyncio.run(shopfloor_queue.list_filters(user))
    assert SECRET_PROJECT not in str(filters)
    assert filters["projects"][0]["project_name"] == "Örnek Otel"
    assert filters["projects"][0]["job_count"] == 1

    created = asyncio.run(server.create_production_order({
        "company_id": CID,
        "recipe_id": "rec",
        "planned_quantity": 1,
        "source": "order",
        "sales_order_id": "ord",
    }, user))
    assert created["customer_name"] == "Örnek Müşteri A"
    assert created["recipe_name"] != SECRET_RECIPE
    made = [row for row in mem.work_orders.docs if row.get("order_id") == created["id"]]
    assert made
    assert made[0]["project_name"] == "Örnek Otel"
    assert made[0]["customer_name"] == "Örnek Müşteri A"
    assert SECRET_PROJECT not in str(made)
    assert SECRET_RECIPE not in str(made)
