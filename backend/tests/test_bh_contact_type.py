"""BizimHesap cari aktarımında müşteri / tedarikçi ayrımı.

Aktarım her cariyi "customer" olarak kaydediyordu (tür koşulu `and False` ile
kapatılmıştı), bu yüzden Cariler ekranındaki "Tedarikçiler" sekmesi boş kalıyordu.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from migration import bh_contact_type  # noqa: E402


class TestBizimHesapContactType:
    def test_explicit_type_field_wins_over_balance(self):
        assert bh_contact_type({"customerType": "Tedarikçi"}, 5000.0) == "supplier"
        assert bh_contact_type({"type": "Müşteri"}, -5000.0) == "customer"
        assert bh_contact_type({"cariTuru": "Her ikisi"}, 0.0) == "both"

    def test_type_field_name_variants(self):
        for key in ("type", "customerType", "cari_turu", "AccountType", "kind"):
            assert bh_contact_type({key: "satıcı"}, 100.0) == "supplier", key

    def test_account_code_decides_when_no_type_field(self):
        # Tek düzen hesap planı: 320 satıcılar, 120 alıcılar.
        assert bh_contact_type({"code": "320.01.005"}, 4200.0) == "supplier"
        assert bh_contact_type({"code": "120 05"}, -4200.0) == "customer"

    def test_balance_sign_is_the_last_resort(self):
        assert bh_contact_type({"code": ""}, -1500.0) == "supplier"
        assert bh_contact_type({}, 1500.0) == "customer"
        assert bh_contact_type({}, 0.0) == "customer"

    def test_user_can_force_a_single_type(self):
        row = {"code": "120.01", "type": "Müşteri"}
        assert bh_contact_type(row, 900.0, "supplier") == "supplier"
        assert bh_contact_type(row, 900.0, "both") == "both"
        assert bh_contact_type({"code": "320.01"}, -900.0, "customer") == "customer"

    def test_auto_is_the_default_and_still_separates(self):
        rows = [{"code": "320.01"}, {"code": "120.01"}, {"code": ""}]
        assert [bh_contact_type(r, -10.0) for r in rows] == ["supplier", "customer", "supplier"]
        assert bh_contact_type({"code": "999"}, 10.0, "auto") == "customer"

    def test_unknown_row_shapes_do_not_crash(self):
        assert bh_contact_type({}, 0.0) == "customer"
        assert bh_contact_type({"code": None, "type": None}, 0.0) == "customer"
