"""Reçete müşteri (cari) + iş dosyası alanları."""
from unittest.mock import AsyncMock, MagicMock, patch
import asyncio


def test_recipe_model_has_customer_and_job_fields():
    from models import Recipe, RecipeItem

    r = Recipe(
        company_id="co",
        name="Test",
        finished_product_id="p1",
        finished_product_name="Mamul",
        materials=[RecipeItem(product_id="m1", product_name="H1", quantity=1, unit="Adet")],
        contact_id="c1",
        contact_name="Acme",
        job_file_name="AHM-014",
    )
    doc = r.to_mongo()
    assert doc["contact_id"] == "c1"
    assert doc["contact_name"] == "Acme"
    assert doc["job_file_name"] == "AHM-014"


def test_update_recipe_allows_contact_and_job_file():
    import server

    existing = {
        "_id": "r1",
        "name": "Eski",
        "finished_product_id": "p1",
        "materials": [],
        "labor_cost": 0,
        "overhead_cost": 0,
        "target_quantity": 1,
    }
    db = MagicMock()
    db.recipes.find_one = AsyncMock(side_effect=[
        existing,
        {**existing, "contact_id": "c9", "contact_name": "Müşteri", "job_file_name": "DOSYA-1", "name": "Yeni"},
    ])
    db.recipes.update_one = AsyncMock()

    async def run():
        with patch.object(server, "db", db), \
             patch.object(server, "_fill_material_costs", AsyncMock()), \
             patch.object(server, "_recipe_costs", return_value={"total_estimated_cost": 0, "unit_cost": 0}):
            out = await server.update_recipe("r1", {
                "name": "Yeni",
                "contact_id": "c9",
                "contact_name": "Müşteri",
                "job_file_name": "DOSYA-1",
                "hack": "ignored",
            })
            assert out.get("contact_id") == "c9" or db.recipes.update_one.await_count == 1
            set_doc = db.recipes.update_one.await_args[0][1]["$set"]
            assert set_doc.get("contact_id") == "c9"
            assert set_doc.get("job_file_name") == "DOSYA-1"
            assert "hack" not in set_doc

    asyncio.run(run())
