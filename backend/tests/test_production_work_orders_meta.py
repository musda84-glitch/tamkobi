"""İş emri: istasyon + iş dosyası adı reçeteden kopyalanır / listede zenginleştirilir."""
from production_work_orders import (
    enrich_work_order_row,
    recipe_job_fields,
    recipe_materials_for_qty,
    work_order_trash_label,
    work_order_trash_note,
)
from trash import TYPE_LABELS


def test_recipe_job_fields():
    assert recipe_job_fields({"name": " Dolap ", "job_file_name": " AHM-014 "}) == {
        "job_file_name": "AHM-014",
        "recipe_name": "Dolap",
    }
    assert recipe_job_fields({}) == {"job_file_name": None, "recipe_name": None}
    assert recipe_job_fields(None) == {"job_file_name": None, "recipe_name": None}


def test_enrich_work_order_row_fills_missing():
    row = {"station": None, "order_code": "URT-1"}
    enrich_work_order_row(row, {"job_file_name": "DOSYA-1", "recipe_name": "Reçete A"})
    assert row["job_file_name"] == "DOSYA-1"
    assert row["recipe_name"] == "Reçete A"
    assert row["station"] == "Genel"


def test_enrich_does_not_overwrite_existing():
    row = {"job_file_name": "KEEP", "station": "CNC"}
    enrich_work_order_row(row, {"job_file_name": "NEW", "recipe_name": "X"})
    assert row["job_file_name"] == "KEEP"
    assert row["station"] == "CNC"
    assert row["recipe_name"] == "X"


def test_recipe_materials_for_qty_scales_with_plan():
    recipe = {
        "target_quantity": 2,
        "materials": [
            {"product_id": "p1", "product_name": "MDF 18mm", "unit": "m²", "quantity": 4, "wastage_percent": 10},
            {"product_id": "p2", "product_name": "Vida", "unit": "Adet", "quantity": 20, "wastage_percent": 0},
        ],
    }
    rows = recipe_materials_for_qty(recipe, 1)
    assert rows[0]["product_name"] == "MDF 18mm"
    assert rows[0]["needed"] == 2.2  # 4 * 0.5 * 1.1
    assert rows[1]["needed"] == 10
    assert recipe_materials_for_qty({}, 1) == []


def test_enrich_attaches_materials():
    row = {"order_code": "URT-1"}
    enrich_work_order_row(row, {"materials": [{"product_name": "X", "needed": 1, "unit": "Adet"}]})
    assert row["materials"][0]["product_name"] == "X"


def test_work_order_trash_label_and_note():
    wo = {
        "order_code": "URT-1",
        "step_name": "Kesim",
        "product_name": "MDF",
        "station": "CNC",
        "job_file_name": "AHM-014",
    }
    assert work_order_trash_label(wo) == "URT-1 · Kesim · MDF"
    assert "CNC" in work_order_trash_note(wo)
    assert "AHM-014" in work_order_trash_note(wo)
    assert TYPE_LABELS["work_order"] == "İş Emri (Atölye)"
