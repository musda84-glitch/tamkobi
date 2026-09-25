"""Puantaj ay günleri + yıllık izin arşivi birimleri."""
from attendance import (
    STATUS_LABELS,
    build_employee_month_days,
    leave_covers_date,
    leave_year_balance,
)


def test_leave_year_balance_with_carry():
    bal = leave_year_balance({"annual_leave_days": 14, "used_leave_days": 3, "leave_carry_days": 2, "leave_year": 2026})
    assert bal["year"] == 2026
    assert bal["annual"] == 14
    assert bal["used"] == 3
    assert bal["carry"] == 2
    assert bal["remaining"] == 13


def test_leave_covers_date_approved_only():
    leaves = [
        {"start_date": "2026-09-10", "end_date": "2026-09-12", "status": "pending"},
        {"start_date": "2026-09-10", "end_date": "2026-09-12", "status": "approved", "type": "annual"},
    ]
    assert leave_covers_date(leaves, "2026-09-09") is None
    assert leave_covers_date(leaves, "2026-09-11")["type"] == "annual"


def test_build_employee_month_days_statuses():
    days = build_employee_month_days(
        "2026-09",
        [
            {"date": "2026-09-01", "status": "present", "check_in": "09:00", "check_out": "18:00", "hours": 8, "overtime_hours": 0},
            {"date": "2026-09-02", "status": "absent"},
            {"date": "2026-09-03", "status": "present", "check_in": "09:00", "check_out": "20:00", "hours": 10, "overtime_hours": 2, "assigned_overtime_hours": 0},
        ],
        [{"start_date": "2026-09-04", "end_date": "2026-09-04", "status": "approved", "type": "annual"}],
        {"work_days": [0, 1, 2, 3, 4]},
    )
    by = {d["date"]: d for d in days}
    assert by["2026-09-01"]["status"] == "present"
    assert by["2026-09-01"]["status_label"] == STATUS_LABELS["present"]
    assert by["2026-09-02"]["status"] == "absent"
    assert by["2026-09-03"]["overtime_hours"] == 2
    assert by["2026-09-04"]["status"] == "leave"
    assert by["2026-09-05"]["status"] == "off"  # Saturday
    assert len(days) == 30
