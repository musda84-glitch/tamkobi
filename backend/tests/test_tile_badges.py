from tile_badges import tile_badge_payload


def test_tile_badge_payload_prefers_live_zero():
    out = tile_badge_payload(
        pending_orders=2,
        incoming_orders=5,
        pickable=1,
        pick_missing=8,
        personnel=0,
        unmatched=3,
        atolye=4,
        edoc=0,
        unread=12,
    )
    assert out == {
        "orders": 5,
        "sevk": 8,
        "personnel": 0,
        "banking": 3,
        "atolye": 4,
        "edoc": 0,
        "unread": 12,
    }


def test_tile_badge_payload_tolerates_none():
    assert tile_badge_payload()["orders"] == 0
    assert tile_badge_payload(pending_orders=None, incoming_orders="3")["orders"] == 3
