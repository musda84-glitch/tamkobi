"""Erken çıkış / gün içi izin onayında ücretten düşüm seçimi."""
from attendance import (
    DEFAULT_SCHEDULE,
    compute_day,
    early_leave_wage_minutes,
    leave_wage_decision_message,
    parse_leave_wage_decision,
)


def test_parse_leave_wage_approve_without_deduct():
    assert parse_leave_wage_decision({"decision": "approve", "wage_deduction": False}) == {
        "decision": "approve",
        "wage_deduction": False,
    }
    assert parse_leave_wage_decision({"decision": "approve"}) == {
        "decision": "approve",
        "wage_deduction": False,
    }


def test_parse_leave_wage_approve_with_deduct():
    assert parse_leave_wage_decision({"decision": "approve", "wage_deduction": True})["wage_deduction"] is True
    assert parse_leave_wage_decision({"decision": "deduct"}) == {
        "decision": "approve",
        "wage_deduction": True,
    }
    assert parse_leave_wage_decision({"decision": "approve", "wage_deduction": "evet"})["wage_deduction"] is True


def test_parse_leave_wage_reject_clears_deduct():
    assert parse_leave_wage_decision({"decision": "reject", "wage_deduction": True}) == {
        "decision": "reject",
        "wage_deduction": False,
    }


def test_leave_wage_messages():
    assert "düşülmeyecek" in leave_wage_decision_message("early_leave", True, False)
    assert "düşülecek" in leave_wage_decision_message("early_leave", True, True)
    assert "reddedildi" in leave_wage_decision_message("intraday_leave", False, True)


def test_early_leave_wage_minutes_skips_when_paid():
    rec = {
        "early_leave_approved": True,
        "early_leave_request": {"status": "approved", "wage_deduction": False},
    }
    assert early_leave_wage_minutes(rec, 90) == 0
    assert early_leave_wage_minutes(
        {"early_leave_approved": True, "early_leave_request": {"status": "approved", "wage_deduction": True}},
        90,
    ) == 90
    assert early_leave_wage_minutes({"early_leave_request": {"status": "pending"}}, 45) == 45


def test_compute_day_early_leave_paid_zeroes_minutes():
    rec = {
        "date": "2026-09-07",
        "check_in": "09:00",
        "check_out": "16:00",
        "early_leave_approved": True,
        "early_leave_request": {"status": "approved", "wage_deduction": False},
    }
    out = compute_day(rec, {**DEFAULT_SCHEDULE})
    assert out["early_leave_minutes"] == 0
    out2 = compute_day(
        {
            **rec,
            "early_leave_request": {"status": "approved", "wage_deduction": True},
        },
        {**DEFAULT_SCHEDULE},
    )
    assert out2["early_leave_minutes"] == 120
