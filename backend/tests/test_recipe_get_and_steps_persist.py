"""Reçete GET + oluşturmada kalem adımları korunur."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import server


def test_get_recipe_returns_material_steps():
    doc = {
        "_id": "r1",
        "name": "Dolap",
        "code": "BOM-1",
        "finished_product_id": "p1",
        "materials": [
            {
                "product_id": "m1",
                "product_name": "MDF",
                "quantity": 2,
                "unit": "Adet",
                "steps": [{"no": 1, "name": "Kesim", "station": "CNC OEMAK", "duration_min": 10}],
            }
        ],
        "steps": [],
        "labor_cost": 0,
        "overhead_cost": 0,
        "target_quantity": 1,
    }
    fake_db = MagicMock()
    fake_db.recipes.find_one = AsyncMock(return_value=dict(doc))

    async def run():
        with patch.object(server, "db", fake_db), \
             patch.object(server, "_recipe_costs", return_value={"unit_cost": 1, "total_estimated_cost": 1}):
            return await server.get_recipe("r1")

    out = asyncio.run(run())
    assert out["id"] == "r1"
    assert out["materials"][0]["steps"][0]["station"] == "CNC OEMAK"


def test_normalize_recipe_steps_payload_keeps_station_only():
    doc = {
        "steps": [{"name": "", "station": "CNC"}],
        "materials": [
            {"product_id": "m1", "product_name": "X", "quantity": 1, "unit": "Adet", "steps": [{"name": "", "station": "Pres"}]},
            {"product_id": "m2", "product_name": "Y", "quantity": 1, "unit": "Adet", "steps": '[{"name":"Bant","station":"Holzher"}]'},
        ],
    }
    out = server._normalize_recipe_steps_payload(doc)
    assert out["steps"][0]["name"] == "CNC"
    assert out["materials"][0]["steps"][0]["name"] == "Pres"
    assert out["materials"][1]["steps"][0]["name"] == "Bant"
