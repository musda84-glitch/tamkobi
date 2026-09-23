from attendance import early_leave_is_approved, hm_reached_end, self_checkout_unlocked


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


def test_pending_planned_time_does_not_unlock():
    rec = {
        "check_in": "09:00",
        "date": "2026-09-23",
        "early_leave_request": {"status": "pending", "planned_time": "16:00"},
    }
    sched = {"start": "09:00", "end": "18:00", "work_days": [0, 1, 2, 3, 4]}
    assert early_leave_is_approved(rec) is False
    assert self_checkout_unlocked(rec, sched, "16:05") is False


def test_wrapped_expected_end_stays_locked_until_after_midnight():
    rec = {"check_in": "09:00", "date": "2026-09-23", "expected_end": "00:00"}
    sched = {"start": "09:00", "end": "18:00", "work_days": [0, 1, 2, 3, 4]}
    assert hm_reached_end(16 * 60, 0, 9 * 60) is False
    assert self_checkout_unlocked(rec, sched, "09:00") is False
    assert self_checkout_unlocked(rec, sched, "16:00") is False
    assert self_checkout_unlocked(rec, sched, "23:59") is False
    assert self_checkout_unlocked(rec, sched, "00:00") is True
    assert self_checkout_unlocked(rec, sched, "00:30") is True
    rec["expected_end"] = "06:00"
    assert self_checkout_unlocked(rec, sched, "03:00") is False
    assert self_checkout_unlocked(rec, sched, "06:00") is True
