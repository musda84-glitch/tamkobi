from attendance import early_leave_is_approved, hm_reached_end, self_checkout_unlocked


def test_self_checkout_mesaim_disabled_even_after_check_in():
    rec = {"check_in": "09:00", "date": "2026-09-23"}
    sched = {"start": "09:00", "end": "18:00", "work_days": [0, 1, 2, 3, 4]}
    assert self_checkout_unlocked(rec, sched, "16:00") is False
    rec["early_leave_request"] = {"status": "approved"}
    assert early_leave_is_approved(rec) is True
    assert self_checkout_unlocked(rec, sched, "16:00") is False


def test_self_checkout_closes_after_out():
    rec = {"check_in": "09:00", "date": "2026-09-23", "check_out": "18:01"}
    sched = {"start": "09:00", "end": "18:00", "work_days": [0, 1, 2, 3, 4]}
    assert self_checkout_unlocked(rec, sched, "18:05") is False


def test_pending_planned_time_does_not_open_button():
    rec = {
        "check_in": "09:00",
        "date": "2026-09-23",
        "early_leave_request": {"status": "pending", "planned_time": "16:00"},
    }
    sched = {"start": "09:00", "end": "18:00", "work_days": [0, 1, 2, 3, 4]}
    assert early_leave_is_approved(rec) is False
    assert self_checkout_unlocked(rec, sched, "16:05") is False


def test_wrapped_expected_end_helper_still_works():
    assert hm_reached_end(16 * 60, 0, 9 * 60) is False
    assert hm_reached_end(0, 0, 9 * 60) is True
