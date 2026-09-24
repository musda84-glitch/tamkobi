"""00:00 sonrası günlük giriş/çıkış sıfırlama ve gece kapanışı."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from attendance import (  # noqa: E402
    DEFAULT_SCHEDULE,
    archive_closed_segment,
    compute_day,
    is_early_hours,
    is_overnight_pair,
    previous_ymd,
    same_morning_early_shift,
    same_shift_order_error,
    self_punch_is_correction,
    self_punch_is_reentry,
    should_clear_orphan_early_checkout,
    should_close_previous_day,
    should_rehome_early_checkout,
)

SCH = {**DEFAULT_SCHEDULE, "start": "09:00", "end": "18:00", "break_minutes": 60}


def test_previous_ymd():
    assert previous_ymd("2026-09-24") == "2026-09-23"
    assert previous_ymd("2026-10-01") == "2026-09-30"
    assert previous_ymd("2026-01-01") == "2025-12-31"


def test_is_early_hours_before_schedule_start():
    assert is_early_hours("00:00", SCH) is True
    assert is_early_hours("01:20", SCH) is True
    assert is_early_hours("08:59", SCH) is True
    assert is_early_hours("09:00", SCH) is False
    assert is_early_hours("18:00", SCH) is False


def test_should_close_previous_day_after_midnight():
    yest = {"check_in": "18:00"}
    assert should_close_previous_day("01:20", SCH, {}, yest) is True
    # 09:30 bugünün girişi — 07:00 hâlâ dünü kapatır (ekran kaydı)
    assert should_close_previous_day("07:00", SCH, {"check_in": "09:30"}, yest) is True
    assert should_close_previous_day("01:20", SCH, {"check_in": "06:55"}, yest) is True
    # Aynı sabah 06:00–07:00 bugünün vardiyası
    assert should_close_previous_day("07:00", SCH, {"check_in": "06:00"}, yest) is False
    assert should_close_previous_day("10:00", SCH, {}, yest) is False
    assert should_close_previous_day("01:20", SCH, {}, {"check_in": "18:00", "check_out": "23:00"}) is False
    assert should_close_previous_day("01:20", SCH, {}, {}) is False


def test_screenshot_0930_in_0700_out_are_different_days():
    assert is_overnight_pair("09:30", "07:00", SCH) is True
    assert same_morning_early_shift("09:30", "07:00", SCH) is False
    assert same_shift_order_error("check_in", "09:30", {"check_out": "07:00"}, SCH) is None
    assert same_shift_order_error("check_out", "07:00", {"check_in": "09:30"}, SCH) is None
    # Aynı gün bozuk sıra hâlâ hata
    assert same_shift_order_error("check_in", "13:09", {"check_out": "13:07"}, SCH)
    assert "sonra olamaz" in same_shift_order_error("check_in", "13:09", {"check_out": "13:07"}, SCH)


def test_should_rehome_inverted_today_out_to_open_yesterday():
    today = {"check_in": "06:55", "check_out": "01:20"}
    yest = {"check_in": "18:00"}
    assert should_rehome_early_checkout(today, yest, SCH) is True
    assert should_rehome_early_checkout({"check_in": "09:30", "check_out": "07:00"}, yest, SCH) is True
    assert should_rehome_early_checkout({"check_out": "01:20"}, yest, SCH) is True
    assert should_rehome_early_checkout(today, {"check_in": "18:00", "check_out": "23:50"}, SCH) is False
    # Geçerli aynı-gün erken vardiya 00:30–02:00 taşınmaz
    assert should_rehome_early_checkout({"check_in": "00:30", "check_out": "02:00"}, yest, SCH) is False
    # 06:00–07:00 durur; 09:30'a çevrilince 07:00 düne gider
    assert should_rehome_early_checkout({"check_in": "06:00", "check_out": "07:00"}, yest, SCH) is False
    assert should_rehome_early_checkout({"check_in": "06:00", "check_out": "07:00"}, yest, SCH, proposed_in="09:30") is True


def test_should_clear_orphan_inverted_or_lone_early_out():
    today = {"check_in": "06:55", "check_out": "01:20"}
    closed = {"check_in": "09:00", "check_out": "18:00"}
    assert should_clear_orphan_early_checkout(today, closed, SCH) is True
    assert should_clear_orphan_early_checkout({"check_in": "09:30", "check_out": "07:00"}, closed, SCH) is True
    assert should_clear_orphan_early_checkout({"check_out": "01:20"}, closed, SCH) is True
    assert should_clear_orphan_early_checkout(today, {"check_in": "18:00"}, SCH) is False
    assert should_clear_orphan_early_checkout({"check_in": "00:30", "check_out": "02:00"}, closed, SCH) is False
    assert should_clear_orphan_early_checkout({"check_in": "06:00", "check_out": "07:00"}, closed, SCH, proposed_in="09:30") is True


def test_overnight_checkout_wraps_hours():
    rec = {"date": "2026-09-23", "check_in": "18:00", "check_out": "01:20", "overnight_checkout": True}
    out = compute_day(rec, SCH)
    assert out["time_order_invalid"] is False
    assert out["hours"] == 6.33  # 18:00→01:20+24h − 60 dk mola
    assert out["hours"] > 6


def test_overnight_live_case_0655_to_0120():
    rec = {"date": "2026-09-23", "check_in": "06:55", "check_out": "01:20", "overnight_checkout": True}
    out = compute_day(rec, SCH)
    assert out["time_order_invalid"] is False
    assert out["hours"] == 17.42


def test_inverted_same_day_without_flag_stays_invalid():
    rec = {"date": "2026-09-24", "check_in": "06:55", "check_out": "01:20"}
    out = compute_day(rec, SCH)
    assert out["time_order_invalid"] is True
    assert out["hours"] == 0.0


def test_screenshot_inverted_still_invalid():
    rec = {"date": "2026-09-23", "check_in": "13:09", "check_out": "13:07"}
    out = compute_day(rec, SCH)
    assert out["time_order_invalid"] is True
    assert out["hours"] == 0.0


def test_reentry_after_checkout_is_new_segment():
    closed = {"check_in": "09:30", "check_out": "12:00"}
    assert self_punch_is_reentry(closed, "check_in") is True
    assert self_punch_is_correction(closed, "check_in") is False
    segs = archive_closed_segment(closed)
    assert segs == [{"check_in": "09:30", "check_out": "12:00"}]
    rec = {
        "date": "2026-09-24",
        "check_in": "13:00",
        "check_out": "18:00",
        "punch_segments": segs,
    }
    out = compute_day(rec, SCH)
    assert out["time_order_invalid"] is False
    # 09:30–12:00 = 150 + 13:00–18:00 = 300 → 7.5 sa (mola dilimler arası)
    assert out["hours"] == 7.5
    assert out["late_minutes"] == 20  # 09:30 − 09:00 − 10 dk
