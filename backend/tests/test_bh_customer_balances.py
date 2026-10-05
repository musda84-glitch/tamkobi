"""BizimHesap cari aktarımında çek/senet bakiyesi seçeneği."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from migration import bh_customer_balances  # noqa: E402


class TestBhCustomerBalances:
    def test_default_does_not_take_cheques(self):
        row = {"balance": "1500,50", "chequeandbond": "800,00"}
        bal, cheque = bh_customer_balances(row)
        assert abs(bal - 1500.50) < 0.001
        assert cheque == 0.0

    def test_include_cheques_keeps_fields_separate(self):
        row = {"balance": 1500.5, "chequeandbond": 800}
        bal, cheque = bh_customer_balances(row, include_cheques=True)
        assert abs(bal - 1500.5) < 0.001
        assert abs(cheque - 800) < 0.001
        # Çek bakiyesi cari bakiyeye eklenmez.
        assert abs((bal + cheque) - 2300.5) < 0.001

    def test_invert_sign_does_not_flip_cheque(self):
        row = {"balance": 200, "chequeandbond": 50}
        bal, cheque = bh_customer_balances(row, invert=True, include_cheques=True)
        assert abs(bal + 200) < 0.001
        assert abs(cheque - 50) < 0.001

    def test_missing_or_invalid_values_are_zero(self):
        assert bh_customer_balances({}) == (0.0, 0.0)
        assert bh_customer_balances({"balance": None, "chequeandbond": ""}, include_cheques=True) == (0.0, 0.0)
        assert bh_customer_balances({"balance": "abc", "chequeandbond": "xyz"}, include_cheques=True) == (0.0, 0.0)

    def test_exclude_ignores_chequeandbond_even_when_present(self):
        row = {"balance": 0, "chequeandbond": 999}
        bal, cheque = bh_customer_balances(row, include_cheques=False)
        assert bal == 0.0
        assert cheque == 0.0
