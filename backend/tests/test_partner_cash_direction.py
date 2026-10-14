"""Ortaklar Hesabı kasa yönü: gelen = Giriş (+), çıkan/ödenen = Çıkış (−).

Kart = Toplam Giriş − Toplam Çıkış. Kayıt tipi değişmez; yalnız hesap/gösterim.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from partner_pay import (  # noqa: E402
    annotate_partner_tx,
    cash_card_totals,
    partner_tx_effect,
    posting_inc,
    present_partner_balance,
)


def _effect(tx):
    return partner_tx_effect(tx)


def test_partner_put_money_is_giris():
    effect = _effect({"type": "capital_in", "amount": 1000})
    assert effect == {"delta": 1000.0, "side": "giris"}
    assert posting_inc({"type": "capital_in", "amount": 1000})["balance"] == 1000.0


def test_partner_withdraw_hesap_and_payment_are_cikis():
    for tx in (
        {"type": "withdrawal", "amount": 500, "description": "para çek"},
        {"type": "withdrawal", "amount": 500, "description": "hesap→ortak"},
        {"type": "withdrawal", "amount": 500, "description": "Virman → ortak"},
        {"type": "debit", "amount": 500},
        {"type": "credit", "amount": 500},
        {"type": "salary", "amount": 500},
    ):
        effect = _effect(tx)
        assert effect["side"] == "cikis", tx
        assert effect["delta"] == -500.0


def test_contact_collection_is_giris_and_contact_payment_is_cikis():
    tahsilat = _effect({"type": "withdrawal", "amount": 78400, "contact_id": "c1"})
    odeme = _effect({"type": "capital_in", "amount": 25000, "contact_id": "c1"})
    assert tahsilat == {"delta": 78400.0, "side": "giris"}
    assert odeme == {"delta": -25000.0, "side": "cikis"}


def test_expense_payment_is_cikis_even_if_stored_as_withdrawal():
    credit = _effect({"type": "credit", "amount": 39200, "expense_id": "e1", "source": "expense"})
    legacy = _effect({"type": "withdrawal", "amount": 39200, "expense_id": "e1", "source": "expense"})
    assert credit["side"] == "cikis" and credit["delta"] == -39200.0
    assert legacy == credit


def test_bank_outflow_into_partner_is_giris_inflow_is_cikis():
    out = _effect({
        "type": "capital_in",
        "amount": 80000,
        "source": "bank_match",
        "bank_tx_type": "outflow",
    })
    inn = _effect({
        "type": "withdrawal",
        "amount": 40000,
        "source": "bank_match",
        "bank_tx_type": "inflow",
        "related_bank_tx_id": "btx",
    })
    assert out == {"delta": 80000.0, "side": "giris"}
    assert inn == {"delta": -40000.0, "side": "cikis"}


def test_unpaid_profit_is_giris_paid_profit_is_zero():
    assert _effect({"type": "profit_share", "amount": 20000, "is_paid": False})["side"] == "giris"
    paid = _effect({"type": "profit_share", "amount": 9000, "is_paid": True})
    assert paid == {"delta": 0.0, "side": "zero"}


def test_card_is_giris_minus_cikis_and_display_is_absolute():
    txs = [
        {"type": "capital_in", "amount": 100000},
        {"type": "withdrawal", "amount": 78400, "contact_id": "c-col"},
        {"type": "capital_in", "amount": 25000, "contact_id": "c-pay"},
        {"type": "withdrawal", "amount": 8000},
        {"type": "credit", "amount": 12000},
    ]
    cash = cash_card_totals(txs)
    # Giriş 100000+78400=178400; Çıkış 25000+8000+12000=45000; net 133400
    assert cash["cash_in"] == pytest.approx(178400)
    assert cash["cash_out"] == pytest.approx(45000)
    assert cash["cash_net"] == pytest.approx(133400)
    assert cash["card_pocket"] == pytest.approx(cash["cash_in"] - cash["cash_out"])
    view = present_partner_balance(cash["cash_net"])
    assert view["label"] == "Alacaklı"
    assert view["display"] == pytest.approx(133400)
    assert view["display"] > 0

    debt = present_partner_balance(-30257.85)
    assert debt["label"] == "Borçlu"
    assert debt["display"] == pytest.approx(30257.85)
    alacak = present_partner_balance(30257.85)
    assert alacak["label"] == "Alacaklı"
    assert alacak["display"] == pytest.approx(30257.85)
    assert "-" not in str(alacak["display"])


def test_annotate_exposes_same_delta_for_list_and_card():
    tx = annotate_partner_tx({"type": "withdrawal", "amount": 15, "contact_id": "c1"})
    assert tx["side"] == "giris"
    assert tx["balance_delta"] == 15.0
    assert tx["type"] == "withdrawal"
