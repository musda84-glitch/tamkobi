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


def test_sync_all_cash_boxes_one_company_query():
    accounts = [
        {"_id": f"c{i}", "company_id": "co", "type": "cash_box", "current_balance": 5}
        for i in range(4)
    ]
    accounts.append({"_id": "bank", "company_id": "co", "type": "bank", "current_balance": 80})
    own = [
        {"company_id": "co", "account_id": "c0", "type": "inflow", "amount": 10},
        {"company_id": "co", "account_id": "c1", "type": "outflow", "amount": 3},
        {"company_id": "co", "account_id": "c0", "target_account_id": "c2", "type": "transfer", "amount": 4},
    ]
    finds = []

    class _Cursor:
        def __init__(self, rows):
            self.rows = rows

        async def to_list(self, n=None):
            return list(self.rows if n is None else self.rows[:n])

    def find(query=None, projection=None):
        finds.append((query, projection))
        rows = own if (query or {}).get("company_id") == "co" else own + [
            {"company_id": "other", "account_id": "c0", "type": "inflow", "amount": 1000}
        ]
        return _Cursor(rows)

    db = MagicMock()
    db.bank_transactions.find = find
    db.bank_accounts.update_one = AsyncMock()
    out = asyncio.get_event_loop().run_until_complete(sync_cash_box_balances(db, accounts))
    assert len(finds) == 1
    assert finds[0][0] == {"company_id": "co"}
    assert "$or" not in finds[0][0]
    assert finds[0][1]["account_id"] == 1
    assert out[0]["current_balance"] == 6  # 10 − transfer 4
    assert out[1]["current_balance"] == -3
    assert out[2]["current_balance"] == 4
    assert out[3]["current_balance"] == 0
    assert out[4]["current_balance"] == 80
