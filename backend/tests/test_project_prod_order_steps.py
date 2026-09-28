"""Proje dosyası: üretim emri adımları."""
from production_work_orders import customer_work_order_steps
from server import _public_project_view


def test_customer_work_order_steps_from_wos():
    steps = customer_work_order_steps([
        {"step_no": 2, "step_name": "Montaj", "station": "Montaj", "material_name": ""},
        {"step_no": 1, "step_name": "Kesim", "station": "CNC", "step_note": "18mm", "material_name": "MDF"},
    ])
    assert [s["name"] for s in steps] == ["Kesim", "Montaj"]
    assert steps[0]["station"] == "CNC"
    assert steps[0]["note"] == "18mm"
    assert steps[0]["material_name"] == "MDF"


def test_public_view_shows_production_order_label():
    p = {
        "project_number": "PRJ-1",
        "name": "Dolap",
        "status": "active",
        "production_order_id": "po1",
        "production_order_code": "URT-2026-1",
        "recipe_name": "URT-2026-1 · Mutfak dolabı",
        "show_production_steps": True,
        "production_steps": [{"no": 1, "name": "Kesim", "station": "CNC"}],
        "tasks": [],
    }
    view = _public_project_view(p, {"name": "Firma"}, [], [])
    assert view["recipe_name"] == "URT-2026-1 · Mutfak dolabı"
    assert view["production_steps"][0]["name"] == "Kesim"
