"""B2B portal feature flags and installment decoration."""
from datetime import date, datetime, timedelta, timezone

import server


def test_decorate_installment_string_due():
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    past = (date.fromisoformat(today) - timedelta(days=3)).isoformat()
    row = server._decorate_installment({
        "_id": "inst1",
        "due_date": past,
        "status": "pending",
        "amount": 100,
        "paid_amount": 0,
        "label": "1. Taksit",
        "invoice_number": "F-1",
    })
    assert row["id"] == "inst1"
    assert row["is_overdue"] is True
    assert row["days_left"] == -3
    assert row["due_date"] == past


def test_decorate_installment_datetime_due():
    due = datetime.now(timezone.utc) + timedelta(days=5)
    row = server._decorate_installment({
        "_id": "inst2",
        "due_date": due,
        "status": "pending",
        "amount": 50,
        "paid_amount": 10,
    })
    assert row["is_overdue"] is False
    assert row["days_left"] == 5
    assert row["due_date"] == due.strftime("%Y-%m-%d")


def test_decorate_installment_bad_due_does_not_crash():
    row = server._decorate_installment({"_id": "inst3", "due_date": "not-a-date", "status": "pending"})
    assert row["is_overdue"] is False
    assert row["days_left"] is None


def test_b2b_defaults_include_feature_flags():
    for k in (
        "enabled", "login_method", "allow_ai_cart", "show_stock", "show_prices",
        "allow_orders", "show_statement", "show_installments", "min_order_amount", "welcome_note",
    ):
        assert k in server.B2B_DEFAULTS
