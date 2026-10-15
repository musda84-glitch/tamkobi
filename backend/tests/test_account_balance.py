"""Kasa bakiyesi = hareket toplamı (açılış / virman)."""
import asyncio
import copy
from unittest.mock import AsyncMock, MagicMock

from mysql_store import match_query

from account_balance import (
    group_txs_by_account,
    movement_balance,
    opening_tx_doc,
    sync_cash_box_balances,
    tx_signed_amount,
)


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


def test_sync_all_cash_boxes_two_cash_queries():
    accounts = [
        {"_id": f"c{i}", "company_id": "co", "type": "cash_box", "current_balance": 5}
        for i in range(4)
    ]
    accounts.append({"_id": "bank", "company_id": "co", "type": "bank", "current_balance": 80})
    own = [
        {"_id": "in0", "company_id": "co", "account_id": "c0", "type": "inflow", "amount": 10},
        {"_id": "out1", "company_id": "co", "account_id": "c1", "type": "outflow", "amount": 3},
        {"_id": "tr", "company_id": "co", "account_id": "c0", "target_account_id": "c2", "type": "transfer", "amount": 4},
    ]
    finds = []

    class _Cursor:
        def __init__(self, rows):
            self.rows = rows

        async def to_list(self, n=None):
            return list(self.rows if n is None else self.rows[:n])

    def find(query=None, projection=None):
        finds.append((query, projection))
        q = query or {}
        if q.get("company_id") != "co":
            rows = own + [{"_id": "x", "company_id": "other", "account_id": "c0", "type": "inflow", "amount": 1000}]
        else:
            rows = [row for row in own if match_query(row, q)]
        return _Cursor(rows)

    db = MagicMock()
    db.bank_transactions.find = find
    db.bank_accounts.update_one = AsyncMock()
    out = asyncio.get_event_loop().run_until_complete(sync_cash_box_balances(db, accounts))
    assert len(finds) == 2
    assert finds[0][0]["company_id"] == "co"
    assert finds[1][0]["company_id"] == "co"
    assert set(finds[0][0]["account_id"]["$in"]) == {f"c{i}" for i in range(4)}
    assert set(finds[1][0]["target_account_id"]["$in"]) == {f"c{i}" for i in range(4)}
    assert "$or" not in finds[0][0] and "$or" not in finds[1][0]
    assert finds[0][1]["account_id"] == 1
    assert finds[0][1]["_id"] == 1
    assert out[0]["current_balance"] == 6  # 10 − transfer 4
    assert out[1]["current_balance"] == -3
    assert out[2]["current_balance"] == 4
    assert out[3]["current_balance"] == 0
    assert out[4]["current_balance"] == 80


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_cash_balance_matches_full_scan_transfer_cancel_pool():
    """Dar iki sorgu, şirketin tamamını okuyan eski toplamla aynı.

    Transfer hedefi kasa, iptal ve havuz kuralları korunur.
    Başka şirketin hareketi ve kasa dışı satırlar okunmaz.
    """
    accounts = [
        {"_id": "cash", "company_id": "co", "type": "cash_box", "current_balance": 1, "account_name": "Kasa"},
        {"_id": "cash2", "company_id": "co", "type": "cash_box", "current_balance": 1, "account_name": "Kasa 2"},
        {"_id": "bank", "company_id": "co", "type": "bank", "current_balance": 50, "account_name": "Banka"},
        {
            "_id": "pool",
            "company_id": "co",
            "type": "credit_card",
            "is_customer_card_pool": True,
            "current_balance": 9,
            "account_name": "Havuz",
        },
    ]
    company = [
        {"_id": "in", "company_id": "co", "account_id": "cash", "type": "inflow", "amount": 100},
        {"_id": "out", "company_id": "co", "account_id": "cash", "type": "outflow", "amount": 40},
        {"_id": "to-cash", "company_id": "co", "account_id": "bank", "target_account_id": "cash", "type": "transfer", "amount": 80},
        {"_id": "from-cash", "company_id": "co", "account_id": "cash", "target_account_id": "bank", "type": "transfer", "amount": 25},
        {"_id": "cash-cash", "company_id": "co", "account_id": "cash", "target_account_id": "cash2", "type": "transfer", "amount": 10},
        {"_id": "cancel", "company_id": "co", "account_id": "cash", "type": "inflow", "amount": 500, "status": "cancelled"},
        {"_id": "voided", "company_id": "co", "account_id": "cash2", "type": "inflow", "amount": 70, "status": "void"},
        {"_id": "pool-only", "company_id": "co", "account_id": "pool", "type": "inflow", "amount": 77, "customer_card_pool_ledger": True},
        {"_id": "pool-on-cash", "company_id": "co", "account_id": "cash", "type": "inflow", "amount": 33, "customer_card_pool_ledger": True},
        {
            "_id": "via-card",
            "company_id": "co",
            "account_id": "cash",
            "customer_card_account_id": "cash",
            "via_customer_card": True,
            "type": "inflow",
            "amount": 12,
        },
        {"_id": "pool-to-cash", "company_id": "co", "account_id": "pool", "target_account_id": "cash", "type": "transfer", "amount": 15},
        {"_id": "bank-only", "company_id": "co", "account_id": "bank", "type": "inflow", "amount": 999},
        {"_id": "card-stmt", "company_id": "co", "account_id": "cash", "type": "outflow", "amount": 200, "source": "card_statement"},
        {"_id": "ledger", "company_id": "co", "account_id": "cash", "type": "inflow", "amount": 999, "source": "ledger"},
    ]
    other = [
        {"_id": "other-in", "company_id": "other", "account_id": "cash", "type": "inflow", "amount": 1000},
        {"_id": "other-target", "company_id": "other", "account_id": "bank", "target_account_id": "cash", "type": "transfer", "amount": 400},
    ]
    docs = company + other
    by_acc = {a["_id"]: a for a in accounts}
    grouped = group_txs_by_account(company)
    expected = {
        aid: movement_balance(grouped.get(aid, []), aid, by_acc[aid])
        for aid in ("cash", "cash2")
    }
    assert expected["cash"] == 120  # 100−40+80−25−10+15; iptal/havuz/ekstre/ledger 0
    assert expected["cash2"] == 10

    yielded = []
    finds = []

    class _Cursor:
        def __init__(self, rows):
            self.rows = rows

        async def to_list(self, n=None):
            got = self.rows if n is None else self.rows[:n]
            yielded.extend(copy.deepcopy(got))
            return copy.deepcopy(got)

    def find(query=None, projection=None):
        finds.append((copy.deepcopy(query), projection))
        q = query or {}
        cid = q.get("company_id") if isinstance(q, dict) else None
        pool = docs if not isinstance(cid, str) else [d for d in docs if d.get("company_id") == cid]
        return _Cursor([d for d in pool if match_query(d, q)])

    db = MagicMock()
    db.bank_transactions.find = find
    db.bank_accounts.update_one = AsyncMock()
    out = _run(sync_cash_box_balances(db, copy.deepcopy(accounts)))
    by_id = {a["_id"]: a for a in out}
    assert by_id["cash"]["current_balance"] == expected["cash"]
    assert by_id["cash2"]["current_balance"] == expected["cash2"]
    assert by_id["bank"]["current_balance"] == 50
    assert by_id["pool"]["current_balance"] == 9
    assert len(finds) == 2
    assert {tuple(sorted((q or {}))) for q, _proj in finds} == {
        ("account_id", "company_id"),
        ("company_id", "target_account_id"),
    }
    read_ids = {row["_id"] for row in yielded}
    assert "to-cash" in read_ids
    assert "pool-on-cash" in read_ids
    assert "cancel" in read_ids
    assert "bank-only" not in read_ids
    assert "pool-only" not in read_ids
    assert not any(row.get("company_id") == "other" for row in yielded)

    finds.clear()
    shared = _run(sync_cash_box_balances(db, copy.deepcopy(accounts), txs=list(company), persist=False))
    assert finds == []
    shared_by = {a["_id"]: a for a in shared}
    assert shared_by["cash"]["current_balance"] == expected["cash"]
    assert shared_by["cash2"]["current_balance"] == expected["cash2"]
    db.bank_accounts.update_one.assert_awaited()
