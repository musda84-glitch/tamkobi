"""İş emri: istasyon + iş dosyası adı reçeteden kopyalanır / listede zenginleştirilir."""
from production_work_orders import (
    enrich_work_order_row,
    flatten_recipe_steps,
    production_order_trash_block_reason,
    production_order_trash_label,
    recipe_job_fields,
    recipe_materials_for_qty,
    work_order_step_label,
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


def test_flatten_recipe_steps_material_then_recipe():
    recipe = {
        "materials": [
            {
                "product_id": "m1",
                "product_name": "MDF",
                "steps": [{"no": 1, "name": "Kesim", "station": "CNC", "duration_min": 10, "images": ["/api/files/a.jpg", "/api/files/a.jpg"]}],
            },
            {
                "product_id": "m2",
                "product_name": "Medelak",
                "steps": [
                    {"no": 1, "name": "Kaplama", "station": "Pres", "duration_min": 15},
                    {"no": 2, "name": "Kenar", "station": "Bant", "duration_min": 5},
                ],
            },
            {"product_id": "m3", "product_name": "Vida", "steps": []},
        ],
        "steps": [{"no": 1, "name": "Montaj", "station": "Montaj", "duration_min": 20, "images": [{"url": "/api/files/b.jpg"}]}],
    }
    flat = flatten_recipe_steps(recipe)
    assert [s["name"] for s in flat] == ["Kesim", "Kaplama", "Kenar", "Montaj"]
    assert flat[0]["material_name"] == "MDF"
    assert flat[0]["images"] == ["/api/files/a.jpg"]
    assert flat[1]["material_product_id"] == "m2"
    assert flat[3].get("material_name") is None
    assert flat[3]["images"] == ["/api/files/b.jpg"]
    assert work_order_step_label(flat[1], 1) == "Kaplama — Medelak"
    assert work_order_step_label(flat[3], 3) == "Montaj"


def test_flatten_recipe_steps_default_uretim():
    assert flatten_recipe_steps({}) == [{"no": 1, "name": "Üretim", "station": "", "duration_min": 0, "images": []}]
    assert flatten_recipe_steps({"materials": [{"product_name": "X", "steps": []}], "steps": []})[0]["name"] == "Üretim"


def test_flatten_keeps_station_only_step():
    from production_work_orders import normalize_step

    assert normalize_step({"name": "", "station": "CNC OEMAK"})["name"] == "CNC OEMAK"
    flat = flatten_recipe_steps({"steps": [{"name": "", "station": "CNC OEMAK", "duration_min": 12}]})
    assert len(flat) == 1
    assert flat[0]["name"] == "CNC OEMAK"
    assert flat[0]["station"] == "CNC OEMAK"


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


def test_production_order_trash_block_and_label():
    assert production_order_trash_block_reason({"status": "planned"}) is None
    assert production_order_trash_block_reason({"status": "completed"})
    assert production_order_trash_block_reason({"completed_quantity": 2})
    assert production_order_trash_label(
        {"order_code": "URT-9", "finished_product_name": "Dolap"},
        {"product_name": "X"},
    ) == "URT-9 · Dolap"
