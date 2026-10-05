"""B2B portal üretim durumu / aşama özeti."""
from b2b_production import build_b2b_production, order_shows_production, production_status_label


def test_production_status_labels():
    assert production_status_label("in_production") == "Üretimde"
    assert production_status_label("planned") == "Üretim planlandı"
    assert production_status_label("completed") == "Üretim tamamlandı"


def test_build_from_work_orders_marks_current_and_done():
    po = {
        "_id": "po1",
        "order_code": "URT-2026-1",
        "status": "in_production",
        "finished_product_name": "Raf",
    }
    wos = [
        {"step_no": 1, "step_name": "Kesim", "station": "CNC", "status": "done"},
        {"step_no": 2, "step_name": "Montaj", "station": "Atölye", "status": "in_progress"},
        {"step_no": 3, "step_name": "Paket", "station": "", "status": "waiting"},
    ]
    prod = build_b2b_production(production_order=po, work_orders=wos)
    assert prod is not None
    assert prod["status"] == "in_production"
    assert prod["status_label"] == "Üretimde"
    assert prod["active"] is True
    assert prod["done"] == 1
    assert prod["total"] == 3
    assert prod["current_step_name"] == "Montaj"
    assert prod["product_name"] == "Raf"
    assert [s["name"] for s in prod["steps"]] == ["Kesim", "Montaj", "Paket"]
    assert prod["steps"][0]["done"] is True
    assert prod["steps"][1]["current"] is True
    assert prod["steps"][2]["done"] is False


def test_build_from_recipe_when_no_po():
    recipe = {
        "name": "Özel reçete",
        "finished_product_name": "Dolap",
        "steps": [
            {"no": 1, "name": "Hazırlık", "station": "Depo"},
            {"no": 2, "name": "Boyama", "station": "Boya"},
        ],
    }
    prod = build_b2b_production(recipe=recipe, sent_to_production=True)
    assert prod["status"] == "planned"
    assert prod["status_label"] == "Üretim planlandı"
    assert prod["active"] is True
    assert prod["total"] == 2
    assert prod["steps"][0]["current"] is True
    assert prod["steps"][0]["done"] is False


def test_build_fallback_single_step():
    prod = build_b2b_production(
        production_order={"status": "in_production", "order_code": "X"},
        sent_to_production=True,
    )
    assert prod["total"] == 1
    assert prod["steps"][0]["name"] == "Üretim"
    assert prod["steps"][0]["current"] is True


def test_order_shows_production_active():
    assert order_shows_production({
        "order_status": "pending",
        "production": {"status": "in_production", "active": True},
    }) is True


def test_order_hides_production_when_shipped_or_tracking_done():
    assert order_shows_production({
        "order_status": "shipped",
        "production": {"status": "completed", "active": False},
    }) is False
    assert order_shows_production({
        "order_status": "approved",
        "tracking": {"status": "in_transit"},
        "production": {"status": "completed", "active": False},
    }) is False


def test_build_none_without_signals():
    assert build_b2b_production() is None
