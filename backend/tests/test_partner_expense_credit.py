"""Şirket masrafını ortak öder → ortak alacaklı (credit), para çekişi değil."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from partner_pay import balance_inc, tx_display_label  # noqa: E402


def test_expense_credit_increases_partner_claim():
    assert balance_inc("credit", 4000) == {"balance": 4000, "total_capital_in": 4000}
    assert balance_inc("withdrawal", 4000) == {"balance": -4000, "total_withdrawn": 4000}


def test_expense_credit_display_label():
    label = tx_display_label({"type": "credit", "expense_id": "e1", "source": "expense", "amount": 4000})
    assert "Masraf" in label
    assert "Para Çekişi" not in label
