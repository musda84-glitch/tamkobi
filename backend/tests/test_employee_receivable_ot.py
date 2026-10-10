"""Kalan alacak: fazla mesai dahil; avans eksi bakiyeye izin verir."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from attendance import bonus_counts_as_advance  # noqa: E402
from employee_pay import compose_remaining, extra_advance_due  # noqa: E402


def test_overtime_counts_toward_remaining():
    assert compose_remaining(unpaid_payroll=10000, overtime_due=1500) == 11500.0


def test_advance_before_accrual_goes_negative():
    assert compose_remaining(unpaid_payroll=0, meal_due=0, overtime_due=0, extra_advance=3000) == -3000.0


def test_paid_overtime_not_double_counted_when_due_zero():
    assert compose_remaining(unpaid_payroll=10000, overtime_due=0, extra_advance=0) == 10000.0


def test_future_period_advance_counts_immediately():
    """Kasım avansı Ekim'de ödendiyse kalan alacaktan düşer (eksi borç)."""
    bonuses = [{"type": "advance", "status": "paid", "period": "2026-11", "amount": 3000}]
    assert extra_advance_due(bonuses, [], counts_as_advance=bonus_counts_as_advance) == 3000.0
    assert compose_remaining(unpaid_payroll=480, extra_advance=3000) == -2520.0


def test_advance_recovered_on_payroll_not_double_counted():
    bonuses = [{"type": "advance", "status": "paid", "period": "2026-11", "amount": 3000}]
    payrolls = [{"period": "2026-11", "status": "pending", "advance_payment": 3000, "final_payable": 7000}]
    assert extra_advance_due(bonuses, payrolls, counts_as_advance=bonus_counts_as_advance) == 0.0
    assert compose_remaining(unpaid_payroll=7000, extra_advance=0) == 7000.0


def test_advance_cleared_after_paid_payroll():
    bonuses = [{"type": "advance", "status": "paid", "period": "2026-11", "amount": 3000}]
    payrolls = [{"period": "2026-11", "status": "paid", "advance_payment": 3000}]
    assert extra_advance_due(bonuses, payrolls, counts_as_advance=bonus_counts_as_advance) == 0.0
    assert compose_remaining(extra_advance=0) == 0.0
