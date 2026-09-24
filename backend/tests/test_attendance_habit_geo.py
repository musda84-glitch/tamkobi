from attendance import (
    attendance_habit,
    apply_manager_time_edit_round,
    apply_time_edit_decision,
    geo_auto_action,
    habit_deviation,
    habit_label,
    manager_punch_time,
    manager_time_edit_doc,
    manager_time_edit_result_message,
    manager_time_edit_skips_employee,
    self_checkout_unlocked,
)


def test_checkout_always_open_after_check_in():
    rec = {"check_in": "09:00", "date": "2026-09-23"}
    sched = {"start": "09:00", "end": "18:00", "work_days": [0, 1, 2, 3, 4]}
    assert self_checkout_unlocked(rec, sched, "10:00") is True
    rec["check_out"] = "18:00"
    assert self_checkout_unlocked(rec, sched, "18:05") is False
    assert self_checkout_unlocked({}, sched, "18:00") is False


def test_geo_auto_check_in_and_out():
    assert geo_auto_action(inside=True, rec={}, was_inside=False) == "check_in"
    assert geo_auto_action(inside=False, rec={}, was_inside=False) is None
    on = {"check_in": "09:00"}
    assert geo_auto_action(inside=True, rec=on, was_inside=True) is None
    assert geo_auto_action(inside=False, rec=on, was_inside=True) == "check_out"
    assert geo_auto_action(inside=False, rec=on, was_inside=False) is None
    done = {"check_in": "09:00", "check_out": "18:00"}
    assert geo_auto_action(inside=False, rec=done, was_inside=True) is None
    assert geo_auto_action(inside=True, rec=done, was_inside=False) == "check_in"


def test_habit_median_and_deviation():
    rows = [
        {"check_in": "08:50", "check_out": "18:05", "status": "present"},
        {"check_in": "08:55", "check_out": "18:10", "status": "present"},
        {"check_in": "08:52", "check_out": "18:00", "status": "present"},
        {"check_in": "09:00", "check_out": "18:08", "status": "present"},
    ]
    habit = attendance_habit(rows)
    assert habit["sample_days"] == 4
    assert habit["typical_in"] == "08:53" or habit["typical_in"].startswith("08:")
    assert "Alışkanlık" in habit_label(habit)
    assert habit_deviation(habit, "08:52", None) is None
    note = habit_deviation(habit, "10:30", None)
    assert note and "giriş 10:30" in note


def test_manager_time_edit_requires_employee():
    edit = manager_time_edit_doc({"check_in": "09:00", "check_out": "18:10"}, {"check_in": "09:00", "check_out": "17:45"}, "2026-09-23T12:00:00")
    assert edit["prev_check_out"] == "18:10"
    assert edit["check_out"] == "17:45"
    assert edit["pending_employee"] is True
    assert manager_time_edit_doc({"check_in": "09:00"}, {"check_in": "09:00"}, "now") is None


def test_manager_punch_time_prefers_explicit_clock():
    assert manager_punch_time({"action": "check_in", "check_in": "09:13"}, "check_in", "12:00") == "09:13"
    assert manager_punch_time({"action": "check_out", "time": "18:05"}, "check_out", "12:00") == "18:05"
    assert manager_punch_time({"action": "check_in"}, "check_in", "12:00") == "12:00"


def test_manager_time_edit_third_round_skips_employee():
    existing = {"check_in": "09:00"}
    first = apply_manager_time_edit_round(existing, {"check_in": "09:13"}, "t1", "check_in")
    assert first["attempts"] == 1
    assert first["auto_confirm"] is False
    assert first["edit"]["pending_employee"] is True
    existing = {"check_in": "09:13", "manager_time_edit_rounds": first["rounds"]}
    second = apply_manager_time_edit_round(existing, {"check_in": "09:20"}, "t2", "check_in")
    assert second["attempts"] == 2
    assert second["auto_confirm"] is False
    existing = {"check_in": "09:20", "manager_time_edit_rounds": second["rounds"]}
    third = apply_manager_time_edit_round(existing, {"check_in": "09:25"}, "t3", "check_in")
    assert third["attempts"] == 3
    assert third["auto_confirm"] is True
    assert third["edit"]["pending_employee"] is False
    assert third["edit"]["auto_confirmed"] is True
    assert manager_time_edit_skips_employee(3) is True
    assert "onayı olmadan" in manager_time_edit_result_message(third)
    same = apply_manager_time_edit_round({"check_in": "09:25", "manager_time_edit_rounds": third["rounds"]}, {"check_in": "09:25"}, "t4", "check_in")
    assert same["edit"] is None


def test_time_edit_reject_restores_previous():
    rec = {
        "check_in": "09:13",
        "check_out": "18:00",
        "manager_time_edit": {
            "pending_employee": True,
            "prev_check_in": "09:00",
            "prev_check_out": "18:00",
            "check_in": "09:13",
            "check_out": "18:00",
        },
    }
    result = apply_time_edit_decision(rec, "reject", "now")
    assert result["accepted"] is False
    assert result["restore"] == {"check_in": "09:00", "check_out": "18:00"}
    assert result["upd"]["manager_time_edit"]["pending_employee"] is False
    ok = apply_time_edit_decision(rec, "approve", "now")
    assert ok["accepted"] is True
    assert ok["upd"]["employee_confirmed"] is True
