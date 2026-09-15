"""BizimHesap stock import helpers — in-memory match index (no live API)."""
from migration import _bh_index_existing_products, _bh_match_existing


def test_bh_index_and_match_prefers_bizimhesap_id():
    docs = [
        {"_id": "1", "bizimhesap_id": "bh-1", "barcode": "111", "sku": "SKU-A"},
        {"_id": "2", "bizimhesap_id": "bh-2", "barcode": "222", "sku": "SKU-B"},
        {"_id": "3", "bizimhesap_id": "", "barcode": "111", "sku": "SKU-C"},  # duplicate barcode ignored for index
    ]
    by_bh, by_bc, by_sku = _bh_index_existing_products(docs)
    assert by_bh["bh-1"]["_id"] == "1"
    assert by_bc["111"]["_id"] == "1"  # first wins
    assert by_sku["sku-b"]["_id"] == "2"
    assert _bh_match_existing(by_bh, by_bc, by_sku, "bh-2", "111", "SKU-A")["_id"] == "2"
    assert _bh_match_existing(by_bh, by_bc, by_sku, "", "222", "")["_id"] == "2"
    assert _bh_match_existing(by_bh, by_bc, by_sku, "", "", "SKU-A")["_id"] == "1"
    assert _bh_match_existing(by_bh, by_bc, by_sku, "missing", "999", "NOPE") is None


def test_bh_index_handles_empty():
    by_bh, by_bc, by_sku = _bh_index_existing_products([])
    assert by_bh == by_bc == by_sku == {}
