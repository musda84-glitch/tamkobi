"""Çek/senet özeti: yalnızca açık kayıtlar; BizimHesap snapshot yok sayılır."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from cheques import open_portfolio_balance  # noqa: E402


class TestOpenPortfolioBalance:
    def test_empty_is_zero(self):
        assert open_portfolio_balance([]) == 0.0
        assert open_portfolio_balance(None) == 0.0

    def test_ersay_style_snapshot_is_ignored_without_rows(self):
        # Cari kartındaki 177.924,83 yalnızca BH chequeandbond ise satır yok → 0.
        assert open_portfolio_balance([]) == 0.0

    def test_open_received_minus_issued(self):
        rows = [
            {"status": "open", "direction": "received", "amount": 177924.83},
            {"status": "open", "direction": "issued", "amount": 1000},
            {"status": "collected", "direction": "received", "amount": 50000},
        ]
        assert open_portfolio_balance(rows) == 176924.83

    def test_missing_status_counts_as_open(self):
        assert open_portfolio_balance([{"direction": "received", "amount": 250}]) == 250.0
