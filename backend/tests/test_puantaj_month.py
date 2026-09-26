"""Puantaj ay günleri + yıllık izin arşivi birimleri."""
from attendance import (
    STATUS_LABELS,
    build_employee_month_days,
    enrich_puantaj_day_wages,
    leave_covers_date,
    leave_year_balance,
)
from personnel_wage import calculated_day_wage


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


def test_calculated_day_wage_late_cut():
    emp = {"pay_type": "daily", "daily_wage": 1000}
    schedule = {"start": "09:00", "end": "18:00", "break_minutes": 60}
    assert calculated_day_wage(emp, {"late_minutes": 0}, schedule) == 1000
    # 480 dk mesai; 48 dk geç → %10 kesinti
    assert calculated_day_wage(emp, {"late_minutes": 48}, schedule) == 900


def test_enrich_puantaj_day_wages_and_ot_pay():
    emp = {"pay_type": "daily", "daily_wage": 1000, "overtime_method": "fixed", "overtime_hourly_rate": 100}
    schedule = {"start": "09:00", "end": "18:00", "break_minutes": 60, "work_days": [0, 1, 2, 3, 4], "overtime_multiplier": 1.5, "holiday_multiplier": 2.0}
    records = [
        {"date": "2026-09-01", "status": "present", "hours": 8, "overtime_hours": 2, "late_minutes": 0},
        {"date": "2026-09-03", "status": "present", "hours": 10, "overtime_hours": 1, "is_off_day": True},
    ]
    days = build_employee_month_days("2026-09", records, [], schedule)
    info = enrich_puantaj_day_wages(days, records, emp, schedule)
    by = {d["date"]: d for d in days}
    assert by["2026-09-01"]["wage"] == 1000
    assert by["2026-09-01"]["overtime_pay"] == 200  # 2 × 100
    assert by["2026-09-02"]["wage"] is None
    # 3 Eylül Perşembe — is_off_day from record → holiday rate
    assert by["2026-09-03"]["overtime_pay"] == round(1 * info["holiday_rate"], 2)
    assert info["wage_total"] == 2000
    assert info["overtime_pay"] == round(200 + by["2026-09-03"]["overtime_pay"], 2)
