"""Puantaj giriş/çıkış tutarsızlık olasılık testleri.

Senaryo (canlı ekran): giriş 13:09, çıkış 13:07, gün içi izin 13:04–13:36
Eski davranış: çıkış < giriş → +24s gece sarması → ~22.52 sa / ~18 sa fazla mesai.
Doğru davranış: ters sıra veri hatası → 0 saat, time_order_invalid.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from attendance import (  # noqa: E402
    DEFAULT_SCHEDULE,
    _hm,
    approved_intraday_gap_minutes,
    compute_day,
)


SCH = {**DEFAULT_SCHEDULE, "start": "09:00", "end": "18:30", "break_minutes": 60, "late_tolerance_minutes": 10}


def _rec(**kw):
    base = {
        "date": "2026-09-23",  # Çarşamba
        "intraday_leave_approved": True,
        "intraday_leave_request": {"status": "approved", "out_time": "13:04", "return_time": "13:36"},
    }
    base.update(kw)
    return base


def test_screenshot_inverted_times_no_longer_inflate_to_22h():
    """Canlı ekrandaki 22.52 sa şişirmesini yeniden üretip düzeltmeyi doğrula."""
    rec = _rec(check_in="13:09", check_out="13:07")
    out = compute_day(rec, SCH)
    assert out["time_order_invalid"] is True
    assert out["hours"] == 0.0
    assert out["overtime_hours"] == 0.0
    assert out["late_minutes"] == 239  # 13:09 − 09:00 − 10 dk tolerans
    # Gece sarması olsaydı ≈22.52 sa olurdu — regresyon kilidi
    assert out["hours"] < 1.0


def test_legacy_overnight_wrap_math_documented():
    """Eski formülün neden 22.52 verdiğini belgele (regresyon referansı)."""
    a, b = _hm("13:09"), _hm("13:07")
    assert b < a
    wrapped = b + 24 * 60
    leave = 27
    worked = wrapped - a - 60 - leave
    assert round(worked / 60, 2) == 22.52


def test_normal_day_shift_unchanged():
    out = compute_day({"date": "2026-09-23", "check_in": "09:00", "check_out": "18:30"}, SCH)
    assert out["time_order_invalid"] is False
    assert out["hours"] == 8.5  # 9.5 − 1 sa mola
    assert out["overtime_hours"] == 0.0
    assert out["late_minutes"] == 0


def test_late_checkin_early_checkout_valid_order():
    out = compute_day({"date": "2026-09-23", "check_in": "13:09", "check_out": "14:00"}, SCH)
    assert out["time_order_invalid"] is False
    assert out["hours"] == 0.0  # 51 dk − 60 mola → 0
    assert out["late_minutes"] == 239


def test_same_minute_ok():
    out = compute_day({"date": "2026-09-23", "check_in": "13:09", "check_out": "13:09"}, SCH)
    assert out["time_order_invalid"] is False
    assert out["hours"] == 0.0


def test_one_minute_inverted_is_invalid():
    out = compute_day({"date": "2026-09-23", "check_in": "13:09", "check_out": "13:08"}, SCH)
    assert out["time_order_invalid"] is True
    assert out["hours"] == 0.0
    assert out["overtime_hours"] == 0.0


def test_intraday_leave_with_inverted_check_does_not_clamp_via_wrap():
    rec = _rec(check_in="13:09", check_out="13:07")
    # Tam izin aralığı (sıkıştırma yok) — 32 dk değil, 27? 13:04–13:36 = 32 dk
    assert approved_intraday_gap_minutes(rec) == 32
    out = compute_day(rec, SCH)
    assert out["intraday_leave_minutes"] == 32
    assert out["hours"] == 0.0


def test_intraday_leave_clamped_when_order_valid():
    rec = _rec(check_in="09:00", check_out="18:30")
    assert approved_intraday_gap_minutes(rec) == 32
    out = compute_day(rec, SCH)
    assert out["hours"] == round((570 - 60 - 32) / 60, 2)  # 09–18:30 = 570 dk


def test_checkin_only_still_shows_late():
    out = compute_day({"date": "2026-09-23", "check_in": "13:09"}, SCH)
    assert out["hours"] == 0.0
    assert out["late_minutes"] == 239
    assert out.get("time_order_invalid") is False


def test_hours_from_time_range_still_supports_assigned_ot_overnight():
    """Atanan mesai aralığı (22:00–00:30) gece sarmasını korur — günlük giriş/çıkıştan ayrı."""
    from attendance import hours_from_time_range

    assert hours_from_time_range("22:00", "00:30") == 2.5
    assert hours_from_time_range("18:00", "20:00") == 2.0


def test_enrich_attendance_row_recomputes_stored_inflated_hours():
    from attendance import enrich_attendance_row

    stored = _rec(check_in="13:09", check_out="13:07", hours=22.52, overtime_hours=18.62)
    fixed = enrich_attendance_row(stored, SCH)
    assert fixed["hours"] == 0.0
    assert fixed["overtime_hours"] == 0.0
    assert fixed["time_order_invalid"] is True
    assert fixed["late_minutes"] == 239
