"""B2B/panel sevk sonrası Teslim edildi yardımcıları."""
from order_pick import can_mark_delivered, is_pick_session_closed


def test_can_mark_delivered_b2b_and_panel_only():
    assert can_mark_delivered({"channel": "b2b", "order_status": "shipped"}) is True
    assert can_mark_delivered({"channel": "manual", "order_status": "shipped"}) is True
    assert can_mark_delivered({"channel": "saha", "order_status": "shipped"}) is True
    assert can_mark_delivered({"order_status": "shipped"}) is True  # panel default manual
    assert can_mark_delivered({"channel": "trendyol", "order_status": "shipped"}) is False
    assert can_mark_delivered({"channel": "b2b", "order_status": "preparing"}) is False
    assert can_mark_delivered({"channel": "b2b", "order_status": "delivered"}) is False


def test_pick_session_closed():
    assert is_pick_session_closed({"order_status": "delivered"}) is True
    assert is_pick_session_closed({"order_status": "cancelled"}) is True
    assert is_pick_session_closed({"channel": "trendyol", "order_status": "shipped"}) is True
    assert is_pick_session_closed({"channel": "b2b", "order_status": "shipped"}) is False
    assert is_pick_session_closed({"channel": "manual", "order_status": "approved"}) is False
