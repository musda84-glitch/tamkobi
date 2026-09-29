"""Sipariş → tek reçete yardımcıları."""
from order_production_recipe import (
    build_order_recipe_payload,
    producible_order_lines,
    product_can_produce,
    recipe_mongo_doc,
    resolve_order_line_product,
    summarize_lines,
)


def test_product_can_produce():
    assert product_can_produce({"type": "product"}) is True
    assert product_can_produce({"type": "raw_material"}) is False
    assert product_can_produce({"type": "service"}) is False
    assert product_can_produce(None) is False


def test_resolve_by_id_or_sku():
    catalog = [
        {"_id": "p1", "sku": "A", "name": "Raf", "type": "product"},
        {"_id": "p2", "sku": "B", "name": "Levha", "type": "raw_material"},
    ]
    assert resolve_order_line_product({"product_id": "p1"}, catalog)["_id"] == "p1"
    assert resolve_order_line_product({"sku": "B"}, catalog)["sku"] == "B"
    assert resolve_order_line_product({"sku": "NO"}, catalog) is None


def test_producible_lines_skip_service_and_raw():
    order = {
        "_id": "o1",
        "order_number": "B2B-9",
        "customer_name": "Ayşe",
        "contact_id": "c1",
        "items": [
            {"product_id": "p1", "product_name": "Raf", "quantity": 2},
            {"product_id": "p2", "product_name": "Levha", "quantity": 1},
            {"product_id": "p3", "product_name": "Montaj", "quantity": 1},
        ],
    }
    catalog = [
        {"_id": "p1", "name": "Raf", "type": "product", "unit": "Adet", "purchase_price": 5},
        {"_id": "p2", "name": "Levha", "type": "raw_material"},
        {"_id": "p3", "name": "Montaj", "type": "service"},
    ]
    lines = producible_order_lines(order, catalog)
    assert len(lines) == 1
    assert lines[0]["product_name"] == "Raf"
    assert lines[0]["quantity"] == 2.0


def test_producible_lines_without_catalog_uses_order_items():
    order = {
        "_id": "o2",
        "order_number": "B2B-14",
        "items": [
            {"product_id": "p1", "product_name": "Kapı", "quantity": 2},
            {"product_name": "Masa", "quantity": 1},
            {"product_id": "s1", "product_name": "Montaj", "type": "service", "quantity": 1},
        ],
    }
    lines = producible_order_lines(order, [])
    assert [l["product_name"] for l in lines] == ["Kapı", "Masa"]
    payload = build_order_recipe_payload(order, lines, company_id="c")
    doc = recipe_mongo_doc(payload)
    assert doc["one_time"] is True
    assert doc["sales_order_id"] == "o2"
    assert doc["code"].startswith("BOM-")
    assert len(doc["materials"]) == 2
    assert doc["_id"]


def test_build_one_recipe_for_all_products():
    order = {
        "_id": "ord-1",
        "order_number": "B2B-2026-0014",
        "customer_name": "Demo AŞ",
        "contact_id": "c9",
        "company_id": "comp_x",
        "items": [
            {"product_id": "p1", "product_name": "Kapı", "quantity": 3},
            {"product_id": "p2", "product_name": "Masa", "quantity": 1},
        ],
    }
    catalog = [
        {"_id": "p1", "name": "Kapı", "type": "product", "unit": "Adet", "purchase_price": 100},
        {"_id": "p2", "name": "Masa", "type": "product", "unit": "Adet"},
    ]
    lines = producible_order_lines(order, catalog)
    payload = build_order_recipe_payload(order, lines, company_id="comp_x")
    assert payload["name"] == "Sipariş B2B-2026-0014"
    assert payload["job_file_name"] == "B2B-2026-0014"
    assert payload["one_time"] is True
    assert payload["contact_id"] == "c9"
    assert payload["contact_name"] == "Demo AŞ"
    assert payload["sales_order_id"] == "ord-1"
    assert len(payload["materials"]) == 2
    assert payload["materials"][0]["quantity"] == 3.0
    assert payload["materials"][0]["steps"][0]["name"] == "Üretim"
    assert "3× Kapı" in payload["materials"][0]["steps"][0]["note"]
    assert payload["finished_product_id"] == "p1"
    assert payload["target_quantity"] == 1.0
    summary = summarize_lines(lines)
    assert summary == [
        {"product_id": "p1", "product_name": "Kapı", "quantity": 3.0, "unit": "Adet"},
        {"product_id": "p2", "product_name": "Masa", "quantity": 1.0, "unit": "Adet"},
    ]


def test_build_raises_without_lines():
    try:
        build_order_recipe_payload({"order_number": "X"}, [])
        assert False, "expected ValueError"
    except ValueError as e:
        assert "üretil" in str(e).lower() or "ürün" in str(e).lower()
