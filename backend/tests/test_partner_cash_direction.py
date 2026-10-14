"""Ortaklar Hesabı: kart = listedeki Toplam Giriş − Toplam Çıkış (aynı fonksiyon)."""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from partner_pay import (  # noqa: E402
    cash_card_totals,
    company_partner_balances,
    present_partner_balance,
    summary_payload,
)

# test_balance_reconciliation.ALI_BAL_TXS ile aynı hareketler.
ALI_BAL_TXS = [
    {"type": "capital_in", "amount": 100000, "description": "para koy"},
    {"type": "capital_in", "amount": 25000, "contact_id": "c-pay", "description": "cari ödeme"},
    {"type": "withdrawal", "amount": 78400, "contact_id": "c-col", "description": "cari tahsilat"},
    {"type": "withdrawal", "amount": 12000, "description": "Virman → ortak"},
    {"type": "withdrawal", "amount": 8000, "description": "hesap→ortak"},
    {"type": "credit", "amount": 705389.78, "description": "Ortak Alacak Fişi"},
    {"type": "salary", "amount": 150000, "description": "Eylül maaşı"},
    {"type": "credit", "amount": 39200, "expense_id": "msr", "source": "expense", "description": "MSR masraf"},
    {"type": "debit", "amount": 15000, "description": "borç fişi"},
    {"type": "withdrawal", "amount": 80000, "source": "bank_match", "bank_tx_type": "outflow", "description": "banka çıkış"},
    {"type": "capital_in", "amount": 40000, "source": "bank_match", "bank_tx_type": "inflow", "description": "banka giriş"},
    {"type": "profit_share", "amount": 20000, "is_paid": False, "description": "tahakkuk kâr payı"},
    {"type": "profit_share", "amount": 9000, "is_paid": True, "description": "ödenmiş kâr payı"},
]


def test_ali_bal_card_equals_list_giris_minus_cikis():
    """Kart büyük rakamı = Toplam Giriş − Toplam Çıkış; tutar mutlak, etiket Alacaklı."""
    cash = cash_card_totals(ALI_BAL_TXS)
    assert cash["cash_in"] == pytest.approx(1079589.78)
    assert cash["cash_out"] == pytest.approx(193400)
    assert cash["cash_net"] == pytest.approx(cash["cash_in"] - cash["cash_out"])
    assert cash["cash_net"] == pytest.approx(886189.78)

    view = company_partner_balances(
        [{"_id": "ali", "name": "Ali BAL", "balance": -886189.78, "share_percent": 50}],
        [{**tx, "partner_id": "ali"} for tx in ALI_BAL_TXS],
    )
    assert view["total_balance"] == pytest.approx(cash["cash_net"])
    ali = view["partners"][0]
    assert ali["balance"] == pytest.approx(cash["cash_net"])
    assert ali["balance"] != -886189.78
    assert ali["balance_label"] == "Alacaklı"
    assert ali["balance_display"] == pytest.approx(886189.78)

    payload = summary_payload({**view, "cash": cash, "source_partners": view["partners"]})
    assert payload["total_card_pocket"] == pytest.approx(cash["cash_in"] - cash["cash_out"])
    assert payload["total_cash_in"] == pytest.approx(cash["cash_in"])
    assert payload["total_cash_out"] == pytest.approx(cash["cash_out"])
    shown = present_partner_balance(payload["total_card_pocket"])
    assert shown["label"] == "Alacaklı"
    assert shown["display"] == pytest.approx(abs(cash["cash_net"]))
    assert shown["display"] == pytest.approx(cash["cash_in"] - cash["cash_out"])
