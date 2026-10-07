"""Yıllık izin kalan günü: yıl filtresi, type boş, devir, bekleyen."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from attendance import (  # noqa: E402
    approved_annual_used,
    compute_leave_balance,
    is_annual_leave,
    leave_in_year,
)


def test_is_annual_leave_treats_empty_type_as_annual():
    assert is_annual_leave({"type": "annual"})
    assert is_annual_leave({"type": ""})
    assert is_annual_leave({})
    assert is_annual_leave({"type": "Yıllık"})
    assert not is_annual_leave({"type": "sick"})


def test_leave_in_year_by_start_date():
    assert leave_in_year({"start_date": "2026-03-01"}, 2026)
    assert not leave_in_year({"start_date": "2025-12-20"}, 2026)


def test_approved_annual_used_filters_year_and_type():
    leaves = [
        {"type": "annual", "status": "approved", "days": 3, "start_date": "2026-02-01"},
        {"type": "", "status": "approved", "days": 2, "start_date": "2026-04-01"},  # eski kayıt
        {"type": "annual", "status": "approved", "days": 5, "start_date": "2025-08-01"},  # önceki yıl
        {"type": "sick", "status": "approved", "days": 4, "start_date": "2026-05-01"},
        {"type": "annual", "status": "pending", "days": 1, "start_date": "2026-06-01"},
        {"type": "annual", "status": "cancelled", "days": 2, "start_date": "2026-01-10"},
    ]
    assert approved_annual_used(leaves, 2026) == 5.0
    assert approved_annual_used(leaves, 2025) == 5.0


def test_compute_leave_balance_remaining_with_carry_and_pending():
    emp = {
        "annual_leave_days": 14,
        "used_leave_days": 99,  # drift — leaves üzerinden ezilecek
        "leave_carry_days": 2,
        "leave_year": 2026,
    }
    leaves = [
        {"type": "annual", "status": "approved", "days": 3, "start_date": "2026-02-01"},
        {"type": "annual", "status": "pending", "days": 2, "start_date": "2026-07-01"},
    ]
    bal = compute_leave_balance(emp, leaves)
    assert bal["used"] == 3
    assert bal["carry"] == 2
    assert bal["remaining"] == 13  # 14 + 2 - 3
    assert bal["pending_days"] == 2
    assert bal["available"] == 11  # remaining - pending
    assert bal["pending"] == 1


def test_compute_without_leaves_uses_denormalized():
    bal = compute_leave_balance({"annual_leave_days": 20, "used_leave_days": 5, "leave_carry_days": 1})
    assert bal["remaining"] == 16
    assert bal["pending_days"] == 0
