from attendance import (
    attendance_habit,
    geo_auto_action,
    habit_deviation,
    habit_label,
    manager_time_edit_doc,
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
