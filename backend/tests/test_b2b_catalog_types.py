"""B2B katalog: tüm ürün türleri (ticari mal, hammadde, mamul, hizmet) listelenir."""
from b2b_catalog import b2b_catalog_mongo_filter


def test_b2b_catalog_filter_does_not_exclude_types():
    q = b2b_catalog_mongo_filter("comp_1")
    assert q == {
        "company_id": "comp_1",
        "show_in_b2b": {"$ne": False},
    }
    assert "type" not in q


def test_b2b_catalog_filter_optional_active_and_price():
    q = b2b_catalog_mongo_filter("comp_1", require_active=True, require_sale_price=True)
    assert q["is_active"] == {"$ne": False}
    assert q["sale_price"] == {"$gt": 0}
    assert "type" not in q


def test_b2b_catalog_allows_stock_card_kinds():
    """Stok kartı Tür seçenekleri type filtresiyle elenmez."""
    kinds = ("product", "raw_material", "finished_good", "service")
    q = b2b_catalog_mongo_filter("c")
    assert "type" not in q
    # Explicit: none of the stock-card kinds are blacklisted
    blocked = q.get("type")
    assert blocked is None or all(k not in str(blocked) for k in kinds)
