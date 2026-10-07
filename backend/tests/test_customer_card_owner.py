"""Müşteri kredi kartı → tedarikçi ödemesinde cari sahibi bakiyesi."""
from bank_guard import customer_card_owner_delta


def test_company_card_no_owner_delta():
    assert customer_card_owner_delta(
        {"type": "credit_card", "card_owner": "company", "linked_contact_id": "c1"},
        "outflow",
        100,
        "sup1",
    ) is None


def test_customer_card_outflow_debits_owner():
    hit = customer_card_owner_delta(
        {
            "type": "credit_card",
            "card_owner": "customer",
            "linked_contact_id": "cust1",
            "linked_contact_name": "Ali",
        },
        "outflow",
        250,
        "sup9",
    )
    assert hit == ("cust1", -250.0)


def test_customer_card_skips_when_payee_is_owner():
    assert customer_card_owner_delta(
        {"type": "credit_card", "card_owner": "customer", "linked_contact_id": "cust1"},
        "outflow",
        50,
        "cust1",
    ) is None


def test_customer_card_inflow_no_delta():
    assert customer_card_owner_delta(
        {"type": "credit_card", "card_owner": "customer", "linked_contact_id": "cust1"},
        "inflow",
        50,
        "sup1",
    ) is None


def test_requires_linked_contact():
    assert customer_card_owner_delta(
        {"type": "credit_card", "card_owner": "customer"},
        "outflow",
        10,
        "sup1",
    ) is None
