"""B2B tracking: teslim edilen sipariş Yolda kalmasın."""
from b2b_tracking import build_b2b_tracking, resolve_tracking_status


def test_delivered_order_beats_in_transit_shipment():
    assert resolve_tracking_status(
        {"order_status": "delivered", "cargo_tracking_number": "DEPO-B2B-1"},
        {"status": "in_transit", "tracking_number": "DEPO-B2B-1"},
    ) == "delivered"
    assert resolve_tracking_status(
        {"order_status": "completed", "cargo_tracking_number": "YK-1"},
        {"status": "in_transit"},
    ) == "delivered"


def test_shipped_warehouse_stays_in_transit():
    assert resolve_tracking_status(
        {"order_status": "shipped", "cargo_tracking_number": "DEPO-B2B-2026-0065"},
        None,
    ) == "in_transit"


def test_returned_wins():
    assert resolve_tracking_status({"order_status": "returned"}, {"status": "delivered"}) == "returned"
    assert resolve_tracking_status({"order_status": "shipped"}, {"status": "returned"}) == "returned"


def test_build_card_shows_delivered_for_completed_warehouse():
    t = build_b2b_tracking(
        {
            "order_status": "completed",
            "cargo_tracking_number": "DEPO-B2B-2026-0065",
            "cargo_carrier": "warehouse",
            "shipped_at": "2026-10-05",
            "delivered_at": "2026-10-08T10:00:00",
            "updated_at": "2026-10-08T10:00:00",
        },
        {"status": "in_transit", "carrier_code": "warehouse", "carrier_name": "warehouse", "tracking_number": "DEPO-B2B-2026-0065"},
    )
    assert t is not None
    assert t["status"] == "delivered"
    assert t["step"] == 4
    assert t["is_late"] is False
    assert (t.get("delivered_at") or "").startswith("2026-10-08")
    assert t["tracking_number"] == "DEPO-B2B-2026-0065"
    assert t["carrier"] == "Depodan sevk"


def test_build_card_warehouse_carrier_is_turkish():
    t = build_b2b_tracking(
        {
            "order_status": "shipped",
            "cargo_tracking_number": "DEPO-B2B-2026-0065",
            "cargo_carrier": "warehouse",
            "warehouse_shipped": True,
        },
        {"status": "in_transit", "carrier_code": "warehouse", "carrier_name": "warehouse", "tracking_number": "DEPO-B2B-2026-0065"},
    )
    assert t is not None
    assert t["carrier"] == "Depodan sevk"
    assert t["status"] == "in_transit"


def test_pending_without_tracking_is_none():
    assert build_b2b_tracking({"order_status": "pending"}) is None
