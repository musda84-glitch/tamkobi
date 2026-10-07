"""Müşteri Kredi Kartları havuz kasası + cari virman via_customer_card."""
from bank_guard import (
    CUSTOMER_CARD_POOL_NAME,
    is_customer_card,
    is_customer_card_pool,
)


def test_pool_is_not_per_cari_customer_card():
    pool = {
        "type": "credit_card",
        "card_owner": "customer",
        "is_customer_card_pool": True,
        "account_name": CUSTOMER_CARD_POOL_NAME,
    }
    assert is_customer_card_pool(pool)
    assert not is_customer_card(pool)


def test_legacy_customer_card_still_detected():
    card = {
        "type": "credit_card",
        "card_owner": "customer",
        "linked_contact_id": "c1",
        "is_customer_card_pool": False,
    }
    assert is_customer_card(card)
    assert not is_customer_card_pool(card)


def test_company_card_neither():
    company = {"type": "credit_card", "card_owner": "company"}
    assert not is_customer_card(company)
    assert not is_customer_card_pool(company)
