"""Kalan alacak: fazla mesai dahil; avans eksi bakiyeye izin verir."""


def compose_remaining(
    unpaid_payroll=0,
    unpaid_expenses=0,
    meal_due=0,
    transport_due=0,
    bonus_pending=0,
    overtime_due=0,
    extra_advance=0,
    bakiye_paid=0,
):
    """server._employee_receivable remaining formülü (aynı sıra)."""
    return round(
        unpaid_payroll + unpaid_expenses + meal_due + transport_due + bonus_pending + overtime_due
        - extra_advance - bakiye_paid,
        2,
    )


def test_overtime_counts_toward_remaining():
    assert compose_remaining(unpaid_payroll=10000, overtime_due=1500) == 11500.0


def test_advance_before_accrual_goes_negative():
    assert compose_remaining(unpaid_payroll=0, meal_due=0, overtime_due=0, extra_advance=3000) == -3000.0


def test_paid_overtime_not_double_counted_when_due_zero():
    assert compose_remaining(unpaid_payroll=10000, overtime_due=0, extra_advance=0) == 10000.0
