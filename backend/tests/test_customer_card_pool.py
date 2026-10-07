"""Müşteri Kredi Kartları havuz kasası + cari virman via_customer_card."""
import asyncio
from unittest.mock import AsyncMock, MagicMock

from bank_guard import (
    CUSTOMER_CARD_POOL_NAME,
    ensure_customer_card_pool,
    is_customer_card,
    is_customer_card_pool,
    pin_customer_card_pool_balance,
)


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


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


def test_ensure_pool_resets_nonzero_balance():
    existing = {
        "_id": "pool1",
        "company_id": "c1",
        "is_customer_card_pool": True,
        "type": "credit_card",
        "current_balance": -35000.0,
    }
    db = MagicMock()
    db.bank_accounts.find_one = AsyncMock(return_value=existing)
    db.bank_accounts.update_one = AsyncMock()
    out = _run(ensure_customer_card_pool(db, "c1"))
    assert out["current_balance"] == 0.0
    db.bank_accounts.update_one.assert_awaited()
    args = db.bank_accounts.update_one.await_args
    assert args.args[1] == {"$set": {"current_balance": 0.0}}


def test_pin_pool_balance():
    db = MagicMock()
    db.bank_accounts.update_one = AsyncMock()
    _run(pin_customer_card_pool_balance(db, "pool1"))
    db.bank_accounts.update_one.assert_awaited_once_with(
        {"_id": "pool1", "is_customer_card_pool": True},
        {"$set": {"current_balance": 0.0}},
    )
