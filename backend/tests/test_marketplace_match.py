from marketplace_match import (
    apply_exact_stock_matches,
    build_product_match_index,
    score_row_product,
    suggest_for_rows,
    suggest_matches,
)


def test_exact_barcode_scores_one():
    row = {"barcode": "8692577197348", "title": "MDF", "stock_code": "X"}
    product = {"_id": "p1", "name": "MDF Levha", "barcode": "8692577197348", "sku": "M1"}
    assert score_row_product(row, product) == 1.0


def test_name_similarity_suggests_best():
    row = {"barcode": "b1", "title": "İtalyan Oval Çekme Antik Sarı", "stock_code": ""}
    products = [
        {"_id": "a", "name": "Vida paketi", "sku": "V1", "barcode": "9"},
        {"_id": "b", "name": "İtalyan Oval Çekme Antik Sarı 128mm", "sku": "CK-1", "barcode": "8"},
    ]
    sug = suggest_matches(row, products, limit=2, min_score=0.4)
    assert sug[0]["product_id"] == "b"
    assert sug[0]["score"] >= 0.45


def test_suggest_for_rows_keyed_by_barcode():
    rows = [{"barcode": "bc1", "title": "ADL10 Lükens Ayak"}]
    products = [{"_id": "p-adl", "name": "ADL10 Lükens Ayak 8x8", "sku": "ADL", "barcode": "1"}]
    out = suggest_for_rows(rows, products, min_score=0.4)
    assert "bc1" in out
    assert out["bc1"][0]["product_id"] == "p-adl"


def test_apply_exact_stock_matches_heals_lost_match_by_alias():
    products = [{
        "_id": "prod_mihrab",
        "name": "Mihrab Dekor",
        "sku": "MDF-1",
        "barcode": "869999",
        "marketplace_aliases": ["869111", "namaz kıble ibadet mihrab"],
        "thumbnail_url": "/t-mihrab.webp",
    }]
    idx = build_product_match_index(products)
    items = [{
        "barcode": "869111",
        "product_name": "Namaz Kıble Ibadet Mihrab",
        "quantity": 1,
    }]
    out = apply_exact_stock_matches(items, idx)
    assert out is not items
    assert out[0]["product_id"] == "prod_mihrab"
    assert out[0]["matched_product_name"] == "Mihrab Dekor"
    assert out[0]["image_url"] == "/t-mihrab.webp"


def test_apply_exact_stock_matches_skips_already_matched():
    idx = build_product_match_index([{
        "_id": "other",
        "name": "Other",
        "barcode": "869111",
        "marketplace_aliases": [],
    }])
    items = [{
        "barcode": "869111",
        "product_id": "kept",
        "matched_product_name": "Kept Name",
        "quantity": 1,
    }]
    out = apply_exact_stock_matches(items, idx)
    assert out is items
    assert out[0]["product_id"] == "kept"
