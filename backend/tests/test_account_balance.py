"""Kasa bakiyesi = hareket toplamı (açılış / virman)."""
import asyncio
from unittest.mock import AsyncMock, MagicMock

from account_balance import movement_balance, opening_tx_doc, sync_cash_box_balances, tx_signed_amount


def test_inflow_outflow_net():
    aid = "cash1"
    txs = [
        {"account_id": aid, "type": "inflow", "amount": 100},
        {"account_id": aid, "type": "outflow", "amount": 40},
    ]
    assert movement_balance(txs, aid) == 60.0


def test_transfer_in_and_out():
    cash = "cash1"
    bank = "bank1"
    out_tx = {"account_id": cash, "target_account_id": bank, "type": "transfer", "amount": 25}
    in_tx = {"account_id": bank, "target_account_id": cash, "type": "transfer", "amount": 80}
    assert tx_signed_amount(out_tx, cash) == -25
    assert tx_signed_amount(in_tx, cash) == 80
    assert movement_balance([out_tx, in_tx], cash) == 55.0


def test_ledger_ignored():
    aid = "cash1"
    txs = [{"account_id": aid, "type": "inflow", "amount": 50, "source": "ledger"}]
    assert movement_balance(txs, aid) == 0.0


def test_no_txs_is_zero():
    assert movement_balance([], "cash1") == 0.0


def test_opening_tx_doc_positive():
    doc = opening_tx_doc(
        {"_id": "c1", "company_id": "co", "account_name": "MATEK", "currency": "TRY"},
        35000,
    )
    assert doc["type"] == "inflow"
    assert doc["amount"] == 35000
    assert doc["source"] == "opening"
    assert doc["category"] == "Açılış bakiyesi"


def test_opening_tx_doc_skips_zero():
    assert opening_tx_doc({"_id": "c1"}, 0) is None
    assert opening_tx_doc({"_id": "c1"}, 0.001) is None


def test_sync_cash_box_zeros_balance_without_txs():
    acc = {"_id": "cash1", "type": "cash_box", "current_balance": 35000}
    bank = {"_id": "bank1", "type": "bank", "current_balance": 100}

    cursor = MagicMock()
    cursor.to_list = AsyncMock(return_value=[])
    db = MagicMock()
    db.bank_transactions.find = MagicMock(return_value=cursor)
    db.bank_accounts.update_one = AsyncMock()
    out = asyncio.get_event_loop().run_until_complete(sync_cash_box_balances(db, [acc, bank]))
    assert out[0]["current_balance"] == 0
    assert out[1]["current_balance"] == 100
    db.bank_accounts.update_one.assert_awaited()
