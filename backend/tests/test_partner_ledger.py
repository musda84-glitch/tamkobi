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
    company_partner_balances,
    ledger_totals,
    present_partner_balance,
    profit_share_inc,
    summary_payload,
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
    def test_lehine_minus_aleyhine_equals_ledger(self):
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
        assert tx_is_cash_inflow(shaped[0]) is True
        assert tx_is_cash_inflow(shaped[1]) is False
        assert tx_is_cash_inflow(shaped[2]) is False
        cash = cash_card_totals(shaped)
        ledger = ledger_totals(shaped)
        assert cash["cash_in"] == pytest.approx(909959.78)
        assert cash["cash_out"] == pytest.approx(39200 + 173100)
        assert cash["cash_net"] == pytest.approx(ledger["balance"])
        assert cash["card_pocket"] == pytest.approx(cash["cash_net"])
        assert ledger["balance"] == pytest.approx(697659.78)


class TestAliBalPartnerCardMatchesSelector:
    """Ali BAL hareketleri: kart toplamı = ortak bakiyelerinin toplamı.

    Seçicideki imzalı defter (Ali −288.340,22 + Mustafa +30.257,85)
    liste lehine − aleyhine ile aynıdır. Kart bu toplamı gösterir.
    """

    def test_ali_bal_movements_card_equals_sum_of_partner_balances(self):
        ali_txs = [
            {"partner_id": "ali", "type": "credit", "amount": 100000},
            {"partner_id": "ali", "type": "withdrawal", "amount": 366271.84},
            {
                "partner_id": "ali",
                "type": "withdrawal",
                "amount": 22068.38,
                "source": "bank_match",
                "bank_tx_type": "outflow",
            },
        ]
        mustafa_txs = [
            {"partner_id": "mustafa", "type": "capital_in", "amount": 30257.85},
        ]
        txs = ali_txs + mustafa_txs
        # Kayıtlı bakiye bayat; ekran bunu değil hareket defterini kullanır.
        partners = [
            {"_id": "ali", "name": "Ali BAL", "share_percent": 50, "balance": 0},
            {"_id": "mustafa", "name": "Mustafa Bal", "share_percent": 50, "balance": 999},
        ]

        ali_ledger = ledger_totals(ali_txs)
        assert ali_ledger["balance"] == pytest.approx(-288340.22)
        mustafa_ledger = ledger_totals(mustafa_txs)
        assert mustafa_ledger["balance"] == pytest.approx(30257.85)

        view = company_partner_balances(partners, txs)
        by_id = {row["_id"]: row for row in view["partners"]}
        ali = by_id["ali"]
        mustafa = by_id["mustafa"]

        assert ali["balance"] == pytest.approx(-288340.22)
        assert ali["balance"] != partners[0]["balance"]
        ali_view = present_partner_balance(ali["balance"])
        assert ali["balance_label"] == "Borçlu"
        assert ali["balance_abs"] == pytest.approx(288340.22)
        assert ali["balance_display"] == pytest.approx(ali_view["display"])
        assert ali["balance_display"] == pytest.approx(288340.22)

        assert mustafa["balance"] == pytest.approx(30257.85)
        assert mustafa["balance"] != partners[1]["balance"]
        assert mustafa["balance_label"] == "Alacaklı"
        assert mustafa["balance_abs"] == pytest.approx(30257.85)
        assert mustafa["balance_display"] == pytest.approx(-30257.85)

        signed_sum = round(ali["balance"] + mustafa["balance"], 2)
        display_sum = round(ali["balance_display"] + mustafa["balance_display"], 2)
        assert signed_sum == pytest.approx(-258082.37)
        assert view["total_balance"] == pytest.approx(signed_sum)
        assert view["total_balance"] == pytest.approx(sum(row["balance"] for row in view["partners"]))
        assert view["card_display"] == pytest.approx(display_sum)
        assert view["card_display"] == pytest.approx(sum(row["balance_display"] for row in view["partners"]))
        assert view["label"] == "Borçlu"
        assert view["abs"] == pytest.approx(258082.37)
        card = present_partner_balance(view["total_balance"])
        assert view["card_display"] == card["display"]
        assert view["label"] == card["label"]

        cash = cash_card_totals(txs)
        assert cash["cash_net"] == pytest.approx(view["total_balance"])
        assert tx_is_cash_inflow(ali_txs[2]) is False

        payload = summary_payload({**view, "cash": cash, "source_partners": partners})
        assert payload["total_balance"] == pytest.approx(view["total_balance"])
        assert payload["total_card_pocket"] == pytest.approx(view["total_balance"])
        assert payload["total_cash_net"] == pytest.approx(view["card_display"])
        assert payload["balance_label"] == "Borçlu"
        assert payload["total_cash_in"] == pytest.approx(cash["cash_in"])
        assert payload["total_cash_out"] == pytest.approx(cash["cash_out"])
        assert payload["total_card_pocket"] == pytest.approx(cash["cash_net"])
