"""Kişiye özel mesai: gün penceresi, erken giriş kaydı, alışkanlık."""
from attendance import (
    compute_day,
    day_window,
    is_early_hours,
    merge_schedule,
    schedule_start_hm,
)
from personnel_wage import scheduled_work_minutes


def test_merge_schedule_day_override_and_work_days():
    company = {"work_schedule": {"start": "09:00", "end": "18:30", "work_days": [0, 1, 2, 3, 4], "break_minutes": 60}}
    emp = {"work_schedule": {
        "work_days": [0, 1, 2, 3, 4, 5],
        "days": {"5": {"start": "10:00", "end": "14:00", "break_minutes": 0}},
    }}
    sch = merge_schedule(company, emp)
    assert sch["work_days"] == [0, 1, 2, 3, 4, 5]
    assert day_window(sch, 0)["start"] == "09:00"
    assert day_window(sch, 0)["end"] == "18:30"
    assert day_window(sch, 5) == {"start": "10:00", "end": "14:00", "break_minutes": 0}


def test_schedule_start_hm_uses_day_window():
    sch = {
        "start": "09:00", "end": "18:00", "work_days": [0, 1, 2, 3, 4, 5, 6],
        "days": {"6": {"start": "01:47", "end": "02:00", "break_minutes": 0}},
    }
    # 2026-09-27 Pazar
    assert schedule_start_hm(sch, "2026-09-27") == "01:47"
    assert schedule_start_hm(sch, "2026-09-26") == "09:00"  # Cumartesi
    assert is_early_hours("01:00", sch, "2026-09-27") is True
    assert is_early_hours("02:00", sch, "2026-09-27") is False


def test_early_check_in_keeps_punch_uses_scheduled_start_for_hours():
    sch = {
        "start": "09:00", "end": "18:30", "break_minutes": 60,
        "work_days": [0, 1, 2, 3, 4, 5],
        "late_tolerance_minutes": 10,
        "exit_tolerance_minutes": 0,
        "overtime_tolerance_minutes": 15,
        "count_early_as_overtime": False,
    }
    # Cumartesi 2026-09-26 — 08:00 erken giriş, 18:30 çıkış
    out = compute_day(
        {"date": "2026-09-26", "check_in": "08:00", "check_out": "18:30", "status": "present"},
        sch,
    )
    assert out["scheduled_start"] == "09:00"
    assert out["scheduled_end"] == "18:30"
    assert out["early_arrival_minutes"] == 60
    assert out["late_minutes"] == 0
    # Çalışma: 09:00–18:30 − 60 mola = 8.5 sa (erken 08:00 sayılmaz)
    assert out["hours"] == 8.5
    assert out["overtime_hours"] == 0


def test_early_as_overtime_when_flag_on():
    sch = {
        "start": "09:00", "end": "18:00", "break_minutes": 60,
        "work_days": [0, 1, 2, 3, 4],
        "overtime_tolerance_minutes": 15,
        "count_early_as_overtime": True,
    }
    # Pazartesi 2026-09-21
    out = compute_day(
        {"date": "2026-09-21", "check_in": "08:00", "check_out": "18:00", "status": "present"},
        sch,
    )
    assert out["early_arrival_minutes"] == 60
    assert out["hours"] == 9.0  # 08:00–18:00 − 60
    assert out["overtime_hours"] == 1.0


def test_scheduled_work_minutes_prefers_day_window():
    sch = {"start": "09:00", "end": "18:00", "break_minutes": 60}
    assert scheduled_work_minutes(sch) == 480
    assert scheduled_work_minutes(sch, {"start": "10:00", "end": "14:00", "break_minutes": 0}) == 240
