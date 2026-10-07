"""Cari bakiye hesaplama — ödeme silme / fatura iptali kayması."""
from contact_balance import (
    bank_tx_balance_delta,
    compute_contact_balance,
    infer_opening_balance,
    invoice_balance_delta,
)


def test_sales_invoice_and_tahsilat():
    inv = {"invoice_type": "sales", "status": "approved", "effects_applied": True, "grand_total": 1000}
    pay = {"contact_id": "c1", "type": "inflow", "amount": 400, "source": "manual"}
    assert invoice_balance_delta(inv) == 1000
    assert bank_tx_balance_delta(pay) == -400
    assert compute_contact_balance(invoices=[inv], bank_txs=[pay]) == 600


def test_expense_tx_ignored():
    tx = {"contact_id": "c1", "type": "outflow", "amount": 50, "source": "expense"}
    assert bank_tx_balance_delta(tx) == 0


def test_virman_outflow_to_contact():
    tx = {"contact_id": "c1", "type": "outflow", "amount": 80, "source": "virman", "category": "Virman Çıkışı (Cari)"}
    assert bank_tx_balance_delta(tx) == 80


def test_account_transfer_with_contact_display_ignored():
    tx = {
        "contact_id": "c1",
        "type": "transfer",
        "amount": 50,
        "customer_card": True,
        "source": "virman",
    }
    assert bank_tx_balance_delta(tx) == 0


def test_cancelled_invoice_zero():
    assert invoice_balance_delta({"invoice_type": "sales", "status": "cancelled", "grand_total": 900}) == 0


def test_infer_opening_keeps_bizimhesap_devir():
    # Kayıtlı 506190, hareket yok → tamamı açılış
    assert infer_opening_balance(506190.96, 0) == 506190.96
    # Kayıtlı 600, hareket 100 → açılış 500
    assert infer_opening_balance(600, 100) == 500


def test_opening_plus_movements():
    assert compute_contact_balance(
        opening_balance=506190.96,
        invoices=[],
        bank_txs=[],
    ) == 506190.96
