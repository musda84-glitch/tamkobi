"""Reçete adım güncellemesi açık iş emirlerini yeniler."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import server


def test_generate_work_orders_force_rebuilds():
    order = {
        "_id": "po1",
        "company_id": "c1",
        "order_code": "URT-1",
        "finished_product_name": "MDF Dolap",
        "planned_quantity": 1,
        "planned_date": "2026-09-28",
        "recipe_name": "Dolap",
    }
    recipe = {
        "_id": "r1",
        "name": "Dolap",
        "unit": "Adet",
        "job_file_name": "Ferhat_bey",
        "steps": [{"no": 1, "name": "Kesim", "station": "CNC OEMAK", "duration_min": 10}],
    }
    inserted = []
    fake_db = MagicMock()
    fake_db.work_orders.count_documents = AsyncMock(side_effect=[1, 0])  # existing, then busy=0
    fake_db.work_orders.delete_many = AsyncMock()
    fake_db.work_orders.insert_many = AsyncMock(side_effect=lambda docs: inserted.extend(docs))
    fake_db.companies.find_one = AsyncMock(return_value={"_id": "c1", "work_parks": [{"name": "CNC OEMAK"}]})

    async def run():
        with patch.object(server, "db", fake_db):
            await server._generate_work_orders(order, recipe, force=True)

    asyncio.run(run())
    fake_db.work_orders.delete_many.assert_awaited_once()
    assert len(inserted) == 1
    assert inserted[0]["step_name"] == "Kesim"
    assert inserted[0]["station"] == "CNC OEMAK"
    assert inserted[0]["job_file_name"] == "Ferhat_bey"


def test_update_recipe_normalizes_station_only_and_rebuilds():
    existing = {
        "_id": "r1",
        "name": "Eski",
        "finished_product_id": "p1",
        "materials": [{"product_id": "m1", "product_name": "MDF", "quantity": 1, "unit": "Adet", "steps": []}],
        "steps": [],
        "labor_cost": 0,
        "overhead_cost": 0,
        "target_quantity": 1,
    }
    updated = {
        **existing,
        "steps": [{"no": 1, "name": "CNC OEMAK", "station": "CNC OEMAK", "duration_min": 0, "images": []}],
    }
    fake_db = MagicMock()
    fake_db.recipes.find_one = AsyncMock(side_effect=[existing, updated, updated])
    fake_db.recipes.update_one = AsyncMock()
    rebuild = AsyncMock(return_value=1)

    async def run():
        with patch.object(server, "db", fake_db), \
             patch.object(server, "_fill_material_costs", AsyncMock()), \
             patch.object(server, "_recipe_costs", return_value={"total_estimated_cost": 0, "unit_cost": 0}), \
             patch.object(server, "_rebuild_open_work_orders_for_recipe", rebuild):
            return await server.update_recipe("r1", {
                "steps": [{"name": "", "station": "CNC OEMAK"}],
                "materials": existing["materials"],
            })

    out = asyncio.run(run())
    set_doc = fake_db.recipes.update_one.await_args[0][1]["$set"]
    assert set_doc["steps"][0]["name"] == "CNC OEMAK"
    assert set_doc["steps"][0]["station"] == "CNC OEMAK"
    rebuild.assert_awaited_once_with("r1")
    assert out.get("work_orders_rebuilt") == 1
