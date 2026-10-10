"""Ortak borç/alacak fişi — kasa dokunmadan bakiye; çift onay türleri."""
import os
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from partner_pay import (  # noqa: E402
    LEDGER_TYPES,
    MUTABLE_TYPES,
    balance_inc,
    cash_card_totals,
    ledger_totals,
    profit_share_inc,
    tx_balance_delta,
    tx_is_cash_inflow,
)


class TestPartnerLedgerBalance:
    def test_credit_increases_partner_claim(self):
        assert balance_inc("credit", 1000) == {"balance": 1000}
        assert balance_inc("capital_in", 1000) == {"balance": 1000, "total_capital_in": 1000}

    def test_salary_increases_partner_claim_without_capital(self):
        assert balance_inc("salary", 8000) == {"balance": 8000}
        assert "salary" in LEDGER_TYPES

    def test_debit_decreases_without_withdrawal_counter(self):
        assert balance_inc("debit", 500) == {"balance": -500}
        assert balance_inc("withdrawal", 500) == {"balance": -500, "total_withdrawn": 500}

    def test_ledger_types_are_mutable(self):
        assert set(LEDGER_TYPES) <= set(MUTABLE_TYPES)

    def test_unknown_type_rejected(self):
        with pytest.raises(HTTPException):
            balance_inc("profit_share", 10)


class TestProfitShareBalance:
    def test_accrual_increases_balance(self):
        assert tx_balance_delta({"type": "profit_share", "amount": 1200, "is_paid": False}) == 1200
        assert profit_share_inc(1200, False, applying=True) == {"total_profit_share": 1200, "balance": 1200}
        assert profit_share_inc(1200, False, applying=False) == {"total_profit_share": -1200, "balance": -1200}

    def test_paid_does_not_touch_balance(self):
        assert tx_balance_delta({"type": "profit_share", "amount": 1200, "is_paid": True}) == 0
        assert profit_share_inc(1200, True, applying=True) == {"total_profit_share": 1200}
        assert profit_share_inc(1200, True, applying=False) == {"total_profit_share": -1200}

    def test_ledger_totals_from_mixed_txs(self):
        totals = ledger_totals([
            {"type": "capital_in", "amount": 10000},
            {"type": "credit", "amount": 2000},
            {"type": "salary", "amount": 3000},
            {"type": "withdrawal", "amount": 1500},
            {"type": "debit", "amount": 500},
            {"type": "profit_share", "amount": 4000, "is_paid": False},
            {"type": "profit_share", "amount": 1000, "is_paid": True},
        ])
        assert totals["balance"] == 10000 + 2000 + 3000 - 1500 - 500 + 4000
        assert totals["total_capital_in"] == 10000
        assert totals["total_withdrawn"] == 1500
        assert totals["total_profit_share"] == 5000


class TestPartnerCashCardTotals:
    def test_cash_net_differs_from_ledger_when_credit_and_bank_outflow(self):
        # Ledger: credit +909959.78 − withdrawal 39200 − bank withdrawal 173100 = 697659.78
        # Kasa: Giriş 173100 (bank outflow etiketi) − Çıkış (credit+withdrawal) = −776059.78
        shaped = [
            {"type": "credit", "amount": 909959.78},
            {"type": "withdrawal", "amount": 39200},
            {
                "type": "withdrawal",
                "amount": 173100,
                "source": "bank_match",
                "bank_tx_type": "outflow",
            },
        ]
        assert tx_is_cash_inflow(shaped[0]) is False
        assert tx_is_cash_inflow(shaped[1]) is False
        assert tx_is_cash_inflow(shaped[2]) is True
        cash = cash_card_totals(shaped)
        assert cash["cash_in"] == 173100
        assert cash["cash_out"] == pytest.approx(909959.78 + 39200)
        assert cash["cash_net"] == pytest.approx(-776059.78)
        assert cash["card_pocket"] == pytest.approx(776059.78)
        ledger = ledger_totals(shaped)
        assert ledger["balance"] == pytest.approx(697659.78)
        assert cash["cash_net"] != ledger["balance"]
