"""Proje dosyası: sabit üretim reçete adımları + müşteri görünürlüğü."""
from production_work_orders import customer_recipe_steps
from server import _public_project_view


def test_customer_recipe_steps_strips_cost_fields():
    recipe = {
        "materials": [
            {
                "product_name": "MDF",
                "steps": [{"name": "Kesim", "station": "HOLZHER", "note": "18mm", "duration_min": 10}],
            }
        ],
        "steps": [{"name": "Montaj", "station": "Montaj"}],
        "group_same_station": False,
    }
    steps = customer_recipe_steps(recipe)
    assert [s["name"] for s in steps] == ["Kesim", "Montaj"]
    assert steps[0]["station"] == "HOLZHER"
    assert steps[0]["note"] == "18mm"
    assert steps[0]["material_name"] == "MDF"
    assert "duration_min" not in steps[0]
    assert "images" not in steps[0]


def test_public_view_hides_production_steps_by_default():
    p = {
        "project_number": "PRJ-1",
        "name": "Dolap",
        "status": "active",
        "recipe_id": "r1",
        "recipe_name": "Mutfak dolabı",
        "show_production_steps": False,
        "production_steps": [{"no": 1, "name": "Kesim", "station": "CNC"}],
        "tasks": [],
    }
    view = _public_project_view(p, {"name": "Firma"}, [], [])
    assert "production_steps" not in view
    assert "recipe_id" not in view
    assert "recipe_name" not in view


def test_public_view_shows_production_steps_when_enabled():
    p = {
        "project_number": "PRJ-1",
        "name": "Dolap",
        "status": "active",
        "recipe_name": "Mutfak dolabı",
        "show_production_steps": True,
        "production_steps": [
            {"no": 1, "name": "Kesim", "station": "CNC", "note": "Ø8", "material_name": "MDF"},
            {"no": 2, "name": "Montaj", "station": ""},
        ],
        "tasks": [],
    }
    view = _public_project_view(p, {"name": "Firma"}, [], [])
    assert view["recipe_name"] == "Mutfak dolabı"
    assert [s["name"] for s in view["production_steps"]] == ["Kesim", "Montaj"]
    assert view["production_steps"][0]["note"] == "Ø8"
    assert "recipe_id" not in view
