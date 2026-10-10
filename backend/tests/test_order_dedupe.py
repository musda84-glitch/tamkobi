"""order_dedupe: pazaryeri sipariş tekilleştirme."""
from order_dedupe import (
    dedupe_orders_by_marketplace_key,
    duplicate_ids_to_drop,
    marketplace_order_key,
    merge_keep_fields,
    merge_order_items,
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


def test_merge_clears_marketplace_false_invoiced_without_invoice():
    """Eski TY sync Shipped→is_invoiced=True yazmış; invoice_id yoksa False'a düş."""
    existing = {"is_invoiced": True, "marketplace_status": "Shipped", "contact_id": "c1"}
    incoming = {"marketplace_status": "Delivered", "order_status": "delivered", "is_invoiced": False}
    m = merge_keep_fields(existing, incoming)
    assert m["is_invoiced"] is False
    assert m["contact_id"] == "c1"
    assert m["marketplace_status"] == "Delivered"


def test_merge_order_items_preserves_matched_product_and_image():
    """Sync Trendyol kalemini yeniden yazınca manuel eşleşme + görsel kaybolmasın."""
    existing = [{
        "line_id": "L1",
        "barcode": "869111",
        "sku": "NK-1",
        "product_name": "Namaz Kıble Ibadet Mihrab",
        "quantity": 1,
        "unit_price": 100,
        "product_id": "prod_local_01",
        "matched_product_name": "Mihrab Dekor",
        "image_url": "https://cdn.example/mihrab.jpg",
    }]
    incoming = [{
        "line_id": "L1",
        "barcode": "869111",
        "sku": "NK-1",
        "product_name": "Namaz Kıble Ibadet Mihrab Köşesi",
        "quantity": 1,
        "unit_price": 120,
        "total": 120,
    }]
    out = merge_order_items(existing, incoming)
    assert out[0]["product_id"] == "prod_local_01"
    assert out[0]["matched_product_name"] == "Mihrab Dekor"
    assert out[0]["image_url"] == "https://cdn.example/mihrab.jpg"
    assert out[0]["product_name"] == "Namaz Kıble Ibadet Mihrab Köşesi"
    assert out[0]["unit_price"] == 120


def test_merge_order_items_keeps_local_id_over_shopphp_store_id():
    """ShopPHP sync urunID yazsa bile eşleşmiş stok kartı id'si kalsın."""
    existing = [{
        "sku": "STK-9",
        "product_name": "Kitap Standı",
        "product_id": "prod_tamkobi",
        "matched_product_name": "Kitap Okuma Standı",
        "quantity": 1,
    }]
    incoming = [{
        "sku": "STK-9",
        "product_name": "Kitap Standı",
        "product_id": "998877",  # mağaza urunID
        "quantity": 1,
        "unit_price": 50,
    }]
    out = merge_order_items(existing, incoming)
    assert out[0]["product_id"] == "prod_tamkobi"
    assert out[0]["matched_product_name"] == "Kitap Okuma Standı"


def test_merge_keep_fields_preserves_item_matches():
    existing = {
        "invoice_id": "inv1",
        "contact_id": "c1",
        "items": [{
            "barcode": "BC1",
            "product_name": "Eski",
            "product_id": "p1",
            "matched_product_name": "Stok Adı",
            "image_url": "/old.jpg",
            "quantity": 2,
        }],
    }
    incoming = {
        "marketplace_status": "Picking",
        "items": [{"barcode": "BC1", "product_name": "Yeni TY Ad", "quantity": 2, "unit_price": 10}],
    }
    m = merge_keep_fields(existing, incoming)
    assert m["invoice_id"] == "inv1"
    assert m["items"][0]["product_id"] == "p1"
    assert m["items"][0]["matched_product_name"] == "Stok Adı"
    assert m["items"][0]["image_url"] == "/old.jpg"
    assert m["items"][0]["product_name"] == "Yeni TY Ad"
