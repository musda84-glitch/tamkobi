"""order_dedupe: pazaryeri sipariş tekilleştirme."""
from order_dedupe import (
    dedupe_orders_by_marketplace_key,
    duplicate_ids_to_drop,
    marketplace_order_key,
    merge_keep_fields,
    order_keep_score,
    pick_canonical_order,
)


def test_marketplace_order_key_normalizes_channel():
    assert marketplace_order_key({"company_id": "c1", "channel": "Trendyol", "order_number": "116"}) == ("c1", "trendyol", "116")


def test_pick_canonical_prefers_invoiced_then_newer():
    a = {"_id": "a", "order_number": "1", "channel": "trendyol", "company_id": "c", "updated_at": "2026-01-02", "items": [1]}
    b = {"_id": "b", "order_number": "1", "channel": "trendyol", "company_id": "c", "invoice_id": "inv1", "updated_at": "2026-01-01", "items": []}
    assert pick_canonical_order([a, b])["_id"] == "b"
    assert order_keep_score(b) > order_keep_score(a)


def test_dedupe_orders_keeps_one_per_channel_number():
    rows = [
        {"_id": "1", "company_id": "c", "channel": "trendyol", "order_number": "11658423947", "updated_at": "2026-01-01", "items": []},
        {"_id": "2", "company_id": "c", "channel": "trendyol", "order_number": "11658423947", "updated_at": "2026-01-02", "contact_id": "cnt", "items": [1, 2]},
        {"_id": "3", "company_id": "c", "channel": "trendyol", "order_number": "OTHER", "updated_at": "2026-01-01", "items": []},
        {"_id": "4", "company_id": "c", "channel": "manual", "order_number": "11658423947", "updated_at": "2026-01-03", "items": []},
    ]
    out = dedupe_orders_by_marketplace_key(rows)
    ids = [o["_id"] for o in out]
    assert ids == ["2", "3", "4"]
    assert duplicate_ids_to_drop(rows[:2]) == ["1"]


def test_merge_keep_fields_preserves_invoice():
    existing = {"invoice_id": "inv", "is_invoiced": True, "contact_id": "c1", "marketplace_status": "old"}
    incoming = {"marketplace_status": "Shipped", "order_status": "shipped", "total_amount": 10}
    m = merge_keep_fields(existing, incoming)
    assert m["invoice_id"] == "inv"
    assert m["is_invoiced"] is True
    assert m["contact_id"] == "c1"
    assert m["marketplace_status"] == "Shipped"
