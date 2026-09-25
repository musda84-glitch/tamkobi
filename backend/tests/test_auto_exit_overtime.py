"""Mesai bitişinde otomatik çıkış + konum sonrası fazla mesai yönetici onayı."""
from attendance import (
    build_overtime_confirm_request,
    day_end_hm,
    minutes_past_hm,
    overtime_confirm_decision_message,
    overtime_confirm_should_notify,
    parse_overtime_confirm_decision,
    potential_overtime_hours,
    should_auto_checkout,
)


SCH = {"start": "09:00", "end": "18:00", "work_days": [0, 1, 2, 3, 4], "break_minutes": 60}


def test_day_end_hm_from_schedule_and_plan():
    assert day_end_hm(SCH, "2026-09-14") == "18:00"  # Pazartesi
    assert day_end_hm(SCH, "2026-09-13") is None  # Pazar — tatil
    assert day_end_hm(SCH, "2026-09-14", {"end": "17:30"}) == "17:30"
    assert day_end_hm(SCH, "2026-09-14", {"off": True}) is None


def test_should_auto_checkout_at_schedule_end():
    rec = {"check_in": "09:00", "status": "present"}
    assert should_auto_checkout(rec, end_hm="18:00", now_hm="18:00") is True
    assert should_auto_checkout(rec, end_hm="18:00", now_hm="17:59") is False
    assert should_auto_checkout({**rec, "check_out": "18:00"}, end_hm="18:00", now_hm="19:00") is False
    assert should_auto_checkout({"status": "leave", "check_in": "09:00"}, end_hm="18:00", now_hm="18:00") is False
    assert should_auto_checkout({}, end_hm="18:00", now_hm="18:00") is False


def test_potential_overtime_hours():
    assert potential_overtime_hours("18:00", "18:00") == 0
    assert potential_overtime_hours("18:00", "19:30") == 1.5
    assert minutes_past_hm("18:00", "19:00") == 60


def test_overtime_confirm_after_exit_tolerance_with_location():
    rec = {"check_in": "09:00", "check_out": "18:00", "auto_checkout": True}
    assert overtime_confirm_should_notify(
        location_active=True, end_hm="18:00", now_hm="18:30",
        tolerance_minutes=0, existing=None, rec=rec,
    ) is True
    assert overtime_confirm_should_notify(
        location_active=True, end_hm="18:00", now_hm="18:30",
        tolerance_minutes=60, existing=None, rec=rec,
    ) is False
    assert overtime_confirm_should_notify(
        location_active=True, end_hm="18:00", now_hm="19:00",
        tolerance_minutes=60, existing=None, rec=rec,
    ) is True
    assert overtime_confirm_should_notify(
        location_active=False, end_hm="18:00", now_hm="19:00",
        tolerance_minutes=0, existing=None, rec=rec,
    ) is False
    assert overtime_confirm_should_notify(
        location_active=True, end_hm="18:00", now_hm="19:00",
        tolerance_minutes=0, existing={"status": "pending"}, rec=rec,
    ) is False


def test_overtime_confirm_skips_manual_late_checkout():
    rec = {"check_in": "09:00", "check_out": "20:00"}  # manuel geç çıkış
    assert overtime_confirm_should_notify(
        location_active=True, end_hm="18:00", now_hm="20:30",
        tolerance_minutes=0, existing=None, rec=rec,
    ) is False


def test_build_and_parse_overtime_confirm():
    req = build_overtime_confirm_request(end_hm="18:00", now_hm="19:30", tolerance_minutes=15)
    assert req["status"] == "pending"
    assert req["schedule_end"] == "18:00"
    assert req["proposed_out"] == "19:30"
    assert req["hours"] == 1.5
    assert req["tolerance_minutes"] == 15
    assert parse_overtime_confirm_decision({"decision": "evet"}) == "yes"
    assert parse_overtime_confirm_decision({"decision": "hayır"}) == "no"
    assert parse_overtime_confirm_decision({"decision": "yes"}) == "yes"
    assert parse_overtime_confirm_decision({"decision": "no"}) == "no"
    try:
        parse_overtime_confirm_decision({"decision": "maybe"})
        assert False, "expected ValueError"
    except ValueError:
        pass


def test_exit_tolerance_reduces_early_leave():
    from attendance import compute_day
    sch = {**SCH, "late_tolerance_minutes": 10, "exit_tolerance_minutes": 15, "overtime_tolerance_minutes": 15, "break_minutes": 60}
    out = compute_day({"date": "2026-09-14", "check_in": "09:00", "check_out": "17:50"}, sch)
    assert out["early_leave_minutes"] == 0  # 10 dk erken, 15 dk tolerans
    out2 = compute_day({"date": "2026-09-14", "check_in": "09:00", "check_out": "17:30"}, sch)
    assert out2["early_leave_minutes"] == 15  # 30 - 15


def test_overtime_confirm_messages():
    assert "fazla mesai" in overtime_confirm_decision_message("yes", 1.5, "19:30").lower()
    assert "yazılmadı" in overtime_confirm_decision_message("no").lower()
