"""Trendyol paket durumu yerel is_invoiced üretmemeli."""
from marketplace_providers import map_trendyol_order
from order_dedupe import merge_keep_fields


def _pkg(status: str):
    return {
        "orderNumber": "TY-INV-1",
        "id": 99,
        "shipmentPackageStatus": status,
        "totalPrice": 100,
        "currencyCode": "TRY",
        "orderDate": 1697000000000,
        "estimatedDeliveryEndDate": 1697200000000,
        "lines": [{"productName": "X", "price": 100, "quantity": 1, "barcode": "1"}],
        "shipmentAddress": {},
        "invoiceAddress": {},
        "customerFirstName": "A",
        "customerLastName": "B",
    }


def test_map_trendyol_never_sets_is_invoiced_from_package_status():
    for st in ("Created", "Picking", "Invoiced", "Shipped", "Delivered", "Cancelled"):
        doc = map_trendyol_order(_pkg(st), "c1", "trendyol")
        assert doc["is_invoiced"] is False, st
        assert doc.get("order_date")
        if st in ("Shipped", "Delivered", "Invoiced"):
            assert doc.get("estimated_delivery")


def test_merge_heals_false_positive_invoiced():
    existing = {"is_invoiced": True, "marketplace_status": "Shipped"}
    incoming = map_trendyol_order(_pkg("Delivered"), "c1", "trendyol")
    m = merge_keep_fields(existing, incoming)
    assert m["is_invoiced"] is False
