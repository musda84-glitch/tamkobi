"""Atölye operatör girişi: mesai girişi zorunlu."""
from attendance import (
    SHOPFLOOR_REQUIRE_CHECKIN_DETAIL,
    has_mesaim_check_in,
    shopfloor_operator_checked_in,
)


def test_has_mesaim_check_in():
    assert has_mesaim_check_in({"check_in": "08:00"}) is True
    assert has_mesaim_check_in({"check_in": "  "}) is False
    assert has_mesaim_check_in({}) is False
    assert has_mesaim_check_in(None) is False


def test_shopfloor_operator_checked_in_today():
    assert shopfloor_operator_checked_in({"check_in": "08:15"}) is True
    assert shopfloor_operator_checked_in({"check_in": "08:15", "check_out": "17:00"}) is True
    assert shopfloor_operator_checked_in({}) is False


def test_shopfloor_operator_checked_in_overnight_open():
    assert shopfloor_operator_checked_in(
        today_rec=None,
        yesterday_rec={"check_in": "22:00", "check_out": None},
    ) is True
    assert shopfloor_operator_checked_in(
        today_rec={},
        yesterday_rec={"check_in": "22:00", "check_out": "06:00"},
    ) is False


def test_require_checkin_detail_message():
    assert "Mesaim" in SHOPFLOOR_REQUIRE_CHECKIN_DETAIL
