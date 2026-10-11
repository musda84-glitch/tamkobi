"""Tek seferlik reçete: üretim tamamlanınca soft-delete."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import server


def _user(company_id="c1"):
    return {"id": "u1", "company_ids": [company_id], "active_company_id": company_id}


def test_complete_production_deletes_one_time_recipe():
    order = {
        "_id": "po1",
        "company_id": "c1",
        "status": "in_production",
        "planned_quantity": 2,
        "completed_quantity": 0,
        "recipe_id": "rec1",
        "finished_product_id": "prod1",
        "finished_product_name": "Masa",
    }
    recipe = {
        "_id": "rec1",
        "name": "Masa Reçetesi",
        "finished_product_id": "prod1",
        "finished_product_name": "Masa",
        "unit": "Adet",
        "target_quantity": 1,
        "materials": [],
        "labor_cost": 0,
        "overhead_cost": 0,
        "one_time": True,
    }

    fake_db = MagicMock()
    fake_db.production_orders.find_one = AsyncMock(return_value=order)
    fake_db.recipes.find_one = AsyncMock(return_value=recipe)
    fake_db.products.update_one = AsyncMock()
    fake_db.production_orders.update_one = AsyncMock()
    fake_db.recipes.count_documents = AsyncMock(return_value=0)
    fake_db.work_orders.find = MagicMock(return_value=MagicMock(to_list=AsyncMock(return_value=[])))
    fake_db.stock_movements.insert_one = AsyncMock()

    soft = AsyncMock()

    async def run():
        with patch.object(server, "db", fake_db), \
             patch.object(server.tenant_access, "get_tenant_doc", AsyncMock(return_value=order)), \
             patch.object(server, "_requirements", AsyncMock(return_value=[])), \
             patch.object(server.trash, "soft_delete", soft):
            return await server._complete_production_order_core("po1", {"quantity": 2, "allow_over": True}, _user())

    r = asyncio.run(run())
    assert r["finished"] is True
    assert r["recipe_deleted"] is True
    soft.assert_awaited()
    assert "Tek seferlik reçete silindi" in r["message"]


def test_complete_production_keeps_normal_recipe():
    order = {
        "_id": "po2",
        "company_id": "c1",
        "status": "in_production",
        "planned_quantity": 1,
        "completed_quantity": 0,
        "recipe_id": "rec2",
        "finished_product_id": "prod2",
        "finished_product_name": "Sandalye",
    }
    recipe = {
        "_id": "rec2",
        "name": "Standart",
        "finished_product_id": "prod2",
        "unit": "Adet",
        "target_quantity": 1,
        "materials": [],
        "labor_cost": 0,
        "overhead_cost": 0,
        "one_time": False,
    }
    fake_db = MagicMock()
    fake_db.production_orders.find_one = AsyncMock(return_value=order)
    fake_db.recipes.find_one = AsyncMock(return_value=recipe)
    fake_db.products.update_one = AsyncMock()
    fake_db.production_orders.update_one = AsyncMock()
    fake_db.work_orders.find = MagicMock(return_value=MagicMock(to_list=AsyncMock(return_value=[])))
    fake_db.stock_movements.insert_one = AsyncMock()
    soft = AsyncMock()

    async def run():
        with patch.object(server, "db", fake_db), \
             patch.object(server.tenant_access, "get_tenant_doc", AsyncMock(return_value=order)), \
             patch.object(server, "_requirements", AsyncMock(return_value=[])), \
             patch.object(server.trash, "soft_delete", soft):
            return await server._complete_production_order_core("po2", {"quantity": 1}, _user())

    r = asyncio.run(run())
    assert r["finished"] is True
    assert r.get("recipe_deleted") is False
    soft.assert_not_awaited()
