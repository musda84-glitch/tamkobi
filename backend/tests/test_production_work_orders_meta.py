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
    assert flatten_recipe_steps({}) == [{"no": 1, "name": "Üretim", "station": "", "duration_min": 0, "note": "", "images": []}]
    assert flatten_recipe_steps({"materials": [{"product_name": "X", "steps": []}], "steps": []})[0]["name"] == "Üretim"


def test_flatten_keeps_step_note():
    flat = flatten_recipe_steps({
        "materials": [{
            "product_name": "MDF",
            "steps": [{"name": "Kesim", "station": "CNC", "note": "  Delik Ø8  "}],
        }],
        "steps": [],
    })
    assert flat[0]["note"] == "Delik Ø8"


def test_enrich_fills_step_note():
    row = {"order_code": "URT-1"}
    enrich_work_order_row(row, {"step_note": "Kenar bant beyaz"})
    assert row["step_note"] == "Kenar bant beyaz"
    enrich_work_order_row(row, {"step_note": "IGNORE"})
    assert row["step_note"] == "Kenar bant beyaz"


def test_flatten_keeps_station_only_step():
    from production_work_orders import normalize_step

    assert normalize_step({"name": "", "station": "CNC OEMAK"})["name"] == "CNC OEMAK"
    flat = flatten_recipe_steps({"steps": [{"name": "", "station": "CNC OEMAK", "duration_min": 12}]})
    assert len(flat) == 1
    assert flat[0]["name"] == "CNC OEMAK"
    assert flat[0]["station"] == "CNC OEMAK"


def test_flatten_group_same_station_batches():
    from production_work_orders import group_steps_by_station

    recipe = {
        "group_same_station": True,
        "materials": [
            {
                "product_name": "MDF",
                "steps": [
                    {"name": "Kesim", "station": "HOLZHER"},
                    {"name": "Delik", "station": "OMAKSAN"},
                ],
            },
            {
                "product_name": "Kapak",
                "steps": [{"name": "Kesim", "station": "HOLZHER"}],
            },
        ],
        "steps": [],
    }
    flat = flatten_recipe_steps(recipe)
    assert [s["station"] for s in flat] == ["HOLZHER", "HOLZHER", "OMAKSAN"]
    assert [s.get("material_name") for s in flat] == ["MDF", "Kapak", "MDF"]
    assert group_steps_by_station([{"station": "A"}, {"station": "B"}, {"station": "A"}])[0]["station"] == "A"


def test_regroup_remaining_keeps_locked_and_batches_station():
    from production_work_orders import regroup_remaining_work_orders

    rows = [
        {"_id": "1", "step_no": 1, "status": "done", "station": "HOLZHER", "original_step_no": 1},
        {"_id": "2", "step_no": 2, "status": "ready", "station": "OMAKSAN", "original_step_no": 2},
        {"_id": "3", "step_no": 3, "status": "waiting", "station": "HOLZHER", "original_step_no": 3},
    ]
    out = regroup_remaining_work_orders(rows, enabled=True)
    assert [w["_id"] for w in out] == ["1", "3", "2"]
    assert [w["step_no"] for w in out] == [1, 2, 3]
    assert out[0]["status"] == "done"
    assert out[1]["status"] == "ready"
    assert out[1]["station"] == "HOLZHER"
    assert out[2]["status"] == "waiting"

    restored = regroup_remaining_work_orders(out, enabled=False)
    assert [w["_id"] for w in restored] == ["1", "2", "3"]
    assert restored[1]["status"] == "ready"
    assert restored[1]["station"] == "OMAKSAN"


def test_group_work_orders_for_display_keeps_step_no():
    from production_work_orders import group_work_orders_for_display

    rows = [
        {"id": "a", "station": "HOLZHER", "step_no": 1},
        {"id": "b", "station": "OMAKSAN", "step_no": 2},
        {"id": "c", "station": "HOLZHER", "step_no": 3},
    ]
    grouped = group_work_orders_for_display(rows)
    assert [w["id"] for w in grouped] == ["a", "c", "b"]
    assert [w["step_no"] for w in grouped] == [1, 3, 2]


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


def test_resolve_work_order_finish_plan_material_vs_product():
    from production_work_orders import (
        materials_for_work_order_step,
        recipe_step_for_work_order,
        resolve_work_order_finish_plan,
    )

    wo = {
        "planned_quantity": 1,
        "unit": "Adet",
        "material_product_id": "m1",
        "material_name": "MDF",
        "materials": [
            {"product_id": "m1", "product_name": "MDF", "needed": 16, "unit": "Metre"},
            {"product_id": "m2", "product_name": "Vida", "needed": 20, "unit": "Adet"},
        ],
    }
    plan = resolve_work_order_finish_plan(wo)
    assert plan["qty"] == 16
    assert plan["unit"] == "Metre"
    assert plan["is_material"] is True
    assert materials_for_work_order_step(wo["materials"], wo) == [wo["materials"][0]]
    assert resolve_work_order_finish_plan({"planned_quantity": 2, "unit": "Adet"})["qty"] == 2
    # Kartta tek hammadde, material_* yok → yine 16 Metre
    sole = resolve_work_order_finish_plan(
        {"planned_quantity": 1, "unit": "Adet"},
        [{"product_id": "m1", "product_name": "MDF", "needed": 16, "unit": "Metre"}],
    )
    assert sole["qty"] == 16 and sole["unit"] == "Metre" and sole["is_material"] is True
    steps = [
        {"name": "Kesim", "material_name": "MDF", "material_product_id": "m1"},
        {"name": "Montaj"},
    ]
    assert recipe_step_for_work_order(steps, {"step_no": 2, "original_step_no": 1})["material_name"] == "MDF"


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
