"""Duraklat: mesai/mola/OT penceresi + bitiş toleransında otomatik."""
from shopfloor_pause import (
    PAUSE_OUTSIDE_DETAIL,
    break_window_minutes,
    pause_deadline_hm,
    resolve_pause_phase,
    should_auto_pause_now,
)

SCH = {
    "start": "09:00",
    "end": "18:00",
    "break_minutes": 60,
    "work_days": [0, 1, 2, 3, 4],
    "exit_tolerance_minutes": 15,
    "timezone": "Europe/Istanbul",
}


def test_break_window_centered():
    b0, b1 = break_window_minutes(9 * 60, 18 * 60, 60)
    # Midday ~13:30 → mola 13:00–14:00
    assert b0 == 13 * 60
    assert b1 == 14 * 60


def test_pause_allowed_during_mesai():
    r = resolve_pause_phase(schedule=SCH, date="2026-09-28", now_hm="10:30")  # Monday
    assert r["allowed"] is True
    assert r["phase"] == "mesai"


def test_pause_allowed_during_break():
    r = resolve_pause_phase(schedule=SCH, date="2026-09-28", now_hm="13:15")
    assert r["allowed"] is True
    assert r["phase"] == "mola"


def test_pause_allowed_during_assigned_ot():
    rec = {"assigned_overtime_hours": 2}
    r = resolve_pause_phase(schedule=SCH, rec=rec, date="2026-09-28", now_hm="19:00")
    assert r["allowed"] is True
    assert r["phase"] == "fazla_mesai"
    assert r["deadline"] == "20:15"  # 18:00+2h + 15 tol


def test_pause_allowed_in_exit_tolerance():
    r = resolve_pause_phase(schedule=SCH, date="2026-09-28", now_hm="18:10")
    assert r["allowed"] is True
    assert r["phase"] == "tolerans"


def test_pause_blocked_outside():
    r = resolve_pause_phase(schedule=SCH, date="2026-09-28", now_hm="21:00")
    assert r["allowed"] is False
    assert r["phase"] == "outside"
    assert PAUSE_OUTSIDE_DETAIL in (r["reason"] or "")


def test_pause_blocked_weekend_without_plan():
    r = resolve_pause_phase(schedule=SCH, date="2026-09-26", now_hm="10:00")  # Saturday
    assert r["allowed"] is False


def test_deadline_includes_exit_tolerance():
    assert pause_deadline_hm(SCH, {}, "2026-09-28") == "18:15"


def test_auto_pause_after_deadline():
    assert should_auto_pause_now(schedule=SCH, date="2026-09-28", now_hm="18:15") is True
    assert should_auto_pause_now(schedule=SCH, date="2026-09-28", now_hm="18:14") is False


def test_auto_pause_after_ot_deadline():
    rec = {"assigned_overtime_hours": 1}
    assert should_auto_pause_now(schedule=SCH, rec=rec, date="2026-09-28", now_hm="19:14") is False
    assert should_auto_pause_now(schedule=SCH, rec=rec, date="2026-09-28", now_hm="19:15") is True
