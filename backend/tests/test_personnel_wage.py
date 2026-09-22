from personnel_wage import (
    attendance_yevmiye_covered_days,
    monthly_load,
    pay_type_of,
    payroll_days_minus_attendance_yevmiye,
    payroll_wage_line,
    period_wage,
    reference_daily_wage,
    scheduled_work_minutes,
    wage_line,
    yevmiye_adjusted_amount,
    yevmiye_adjustment_needed,
)


def test_monthly_uses_salary():
    emp = {"pay_type": "monthly", "salary": 28075.5, "daily_wage": 1500}
    assert pay_type_of(emp) == "monthly"
    assert period_wage(emp, 20) == 28075.5
    assert monthly_load(emp) == 28075.5


def test_daily_times_present_days():
    emp = {"pay_type": "daily", "salary": 0, "daily_wage": 1500}
    assert pay_type_of(emp) == "daily"
    assert period_wage(emp, 18) == 27000
    assert period_wage(emp, 0) == 0
    assert monthly_load(emp) == 39000


def test_yevmiye_alias():
    assert pay_type_of({"pay_type": "yevmiye"}) == "daily"
    assert period_wage({"pay_type": "günlük", "daily_wage": "2000"}, 2) == 4000


def test_wage_line():
    assert wage_line(18, 1500) == "18 gün × 1500 ₺"
    assert payroll_wage_line({"pay_type": "daily", "worked_days": 12, "daily_wage": 1250.5}) == "12 gün × 1250.5 ₺"
    assert payroll_wage_line({"pay_type": "monthly", "worked_days": 22, "daily_wage": 0}) == ""
    assert monthly_load({"pay_type": "daily", "daily_wage": 1000}) == 26000


def test_reference_daily_wage_falls_back_to_salary():
    assert reference_daily_wage({"daily_wage": 1500, "salary": 39000}) == 1500
    assert reference_daily_wage({"daily_wage": 0, "salary": 26000}) == 1000
    assert reference_daily_wage({}) == 0


def test_yevmiye_adjusted_by_late_and_early():
    assert yevmiye_adjusted_amount(1600, 0, 0, 480) == 1600
    assert yevmiye_adjusted_amount(1600, 48, 0, 480) == 1440
    assert yevmiye_adjusted_amount(1600, 0, 96, 480) == 1280
    assert yevmiye_adjusted_amount(1600, 48, 48, 480) == 1280
    assert yevmiye_adjusted_amount(1600, 480, 0, 480) == 0
    assert yevmiye_adjustment_needed(0, 0) is False
    assert yevmiye_adjustment_needed(10, 0) is True
    assert scheduled_work_minutes({"start": "09:00", "end": "18:00", "break_minutes": 60}) == 480


def test_payroll_skips_attendance_yevmiye_days():
    bonuses = [
        {"type": "yevmiye", "source": "attendance", "worked_days": 1},
        {"type": "yevmiye", "source": "attendance", "worked_days": 1},
        {"type": "yevmiye", "source": "manual", "worked_days": 3},
    ]
    assert attendance_yevmiye_covered_days(bonuses) == 2
    assert payroll_days_minus_attendance_yevmiye(18, 2) == 16
    assert payroll_days_minus_attendance_yevmiye(1, 3) == 0
