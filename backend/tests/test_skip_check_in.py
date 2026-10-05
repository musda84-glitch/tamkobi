"""Giriş/çıkış dışı personel: planlanan mesai otomatik sayılır."""
from attendance import (
    build_employee_month_days,
    compute_day,
    employee_skips_check_in,
    merge_schedule,
)


def test_employee_skips_check_in_flag():
    assert employee_skips_check_in(None) is False
    assert employee_skips_check_in({}) is False
    assert employee_skips_check_in({"skip_check_in": True}) is True
    assert employee_skips_check_in({"skip_check_in": False}) is False


def test_merge_schedule_copies_skip_flag():
    s = merge_schedule({}, {"skip_check_in": True})
    assert s["skip_check_in"] is True
    s2 = merge_schedule({}, {"skip_check_in": False})
    assert s2["skip_check_in"] is False


def test_compute_day_assumes_schedule_when_skip_check_in():
    sch = {
        "start": "09:00", "end": "18:00", "break_minutes": 60,
        "work_days": [0, 1, 2, 3, 4], "skip_check_in": True,
        "late_tolerance_minutes": 10, "exit_tolerance_minutes": 0, "overtime_tolerance_minutes": 15,
    }
    # 2026-10-05 = Monday
    out = compute_day({"date": "2026-10-05", "status": "present"}, sch)
    assert out["assumed_schedule"] is True
    assert out["hours"] == 8.0
    assert out["normal_hours"] == 8.0
    assert out["overtime_hours"] == 0.0
    assert out["late_minutes"] == 0
    assert out["scheduled_start"] == "09:00"
    assert out["scheduled_end"] == "18:00"


def test_compute_day_skip_does_not_fill_leave_or_off():
    sch = {
        "start": "09:00", "end": "18:00", "break_minutes": 60,
        "work_days": [0, 1, 2, 3, 4], "skip_check_in": True,
    }
    leave = compute_day({"date": "2026-10-05", "status": "leave"}, sch)
    assert leave["hours"] == 0.0
    # Saturday
    off = compute_day({"date": "2026-10-03", "status": "present"}, sch)
    assert off["is_off_day"] is True
    assert off["hours"] == 0.0


def test_month_days_fill_assumed_present_until_as_of():
    sch = {
        "start": "08:00", "end": "17:00", "break_minutes": 60,
        "work_days": [0, 1, 2, 3, 4], "skip_check_in": True,
    }
    days = build_employee_month_days(
        "2026-10", [], [], sch,
        hire_date="2026-10-01", as_of="2026-10-07",
    )
    by = {d["date"]: d for d in days}
    # Mon 5 Oct — assumed
    assert by["2026-10-05"]["status"] == "present"
    assert by["2026-10-05"]["assumed_schedule"] is True
    assert by["2026-10-05"]["hours"] == 8.0
    assert by["2026-10-05"]["check_in"] == "08:00"
    assert by["2026-10-05"]["check_out"] == "17:00"
    # Sat 3 — off
    assert by["2026-10-03"]["status"] == "off"
    # Future workday after as_of — empty
    assert by["2026-10-08"]["status"] == "empty"
    # Leave still wins
    days2 = build_employee_month_days(
        "2026-10", [],
        [{"start_date": "2026-10-05", "end_date": "2026-10-05", "status": "approved", "type": "annual"}],
        sch, as_of="2026-10-07",
    )
    assert {d["date"]: d for d in days2}["2026-10-05"]["status"] == "leave"
