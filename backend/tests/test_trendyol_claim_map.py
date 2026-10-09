"""Trendyol iade talebi map + aksiyon bayrakları."""
from marketplace_providers import map_trendyol_claim


def _raw(status="WaitingInAction"):
    return {
        "id": 555,
        "orderNumber": "11658423947",
        "customerFirstName": "Ali",
        "customerLastName": "Veli",
        "claimDate": 1697000000000,
        "lastModifiedDate": 1697100000000,
        "cargoTrackingNumber": "YK123",
        "cargoProviderName": "Yurtiçi Kargo",
        "items": [{
            "orderLine": {"productName": "Raf", "barcode": "869", "price": 199.0, "quantity": 2},
            "claimItems": [{
                "id": "line-1",
                "orderLineItemId": "ol-1",
                "claimItemStatus": {"id": 1, "name": status},
                "customerClaimItemReason": {"name": "Beğenmedim"},
                "customerNote": "kutu bozuk",
            }],
        }],
    }


def test_map_waiting_in_action_marks_cargo_arrived():
    doc = map_trendyol_claim(_raw("WaitingInAction"), "c1", "trendyol")
    assert doc["status"] == "WaitingInAction"
    assert doc["cargo_arrived"] is True
    assert doc["can_approve"] is True
    assert doc["can_reject"] is True
    assert doc["cargo_tracking_number"] == "YK123"
    assert doc["total"] == 398.0
    assert doc["items"][0]["quantity"] == 2
    assert doc["items"][0]["status"] == "WaitingInAction"


def test_map_created_not_actionable():
    doc = map_trendyol_claim(_raw("Created"), "c1", "trendyol")
    assert doc["status"] == "Created"
    assert doc["cargo_arrived"] is False
    assert doc["can_approve"] is False
