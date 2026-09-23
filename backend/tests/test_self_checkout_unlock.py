from attendance import early_leave_is_approved, self_checkout_unlocked


def test_self_checkout_locked_before_end_until_early_leave_approved():
    rec = {"check_in": "09:00", "date": "2026-09-23"}
    sched = {"start": "09:00", "end": "18:00", "work_days": [0, 1, 2, 3, 4]}
    assert self_checkout_unlocked(rec, sched, "16:00") is False
    rec["early_leave_request"] = {"status": "approved"}
    assert early_leave_is_approved(rec) is True
    assert self_checkout_unlocked(rec, sched, "16:00") is True


def test_self_checkout_opens_at_schedule_end():
    rec = {"check_in": "09:00", "date": "2026-09-23"}
    sched = {"start": "09:00", "end": "18:00", "work_days": [0, 1, 2, 3, 4]}
    assert self_checkout_unlocked(rec, sched, "18:00") is True
    rec["check_out"] = "18:01"
    assert self_checkout_unlocked(rec, sched, "18:05") is False
