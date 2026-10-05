"""Ortak borç/alacak fişi — kasa dokunmadan bakiye; çift onay türleri."""
import os
import sys

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from partner_pay import LEDGER_TYPES, MUTABLE_TYPES, balance_inc  # noqa: E402


class TestPartnerLedgerBalance:
    def test_credit_increases_partner_claim(self):
        assert balance_inc("credit", 1000) == {"balance": 1000, "total_capital_in": 1000}
        assert balance_inc("capital_in", 1000) == {"balance": 1000, "total_capital_in": 1000}

    def test_salary_increases_partner_claim(self):
        assert balance_inc("salary", 8000) == {"balance": 8000, "total_capital_in": 8000}
        assert "salary" in LEDGER_TYPES

    def test_ledger_types_are_mutable(self):
        assert set(LEDGER_TYPES) <= set(MUTABLE_TYPES)

    def test_unknown_type_rejected(self):
        with pytest.raises(HTTPException):
            balance_inc("profit_share", 10)
