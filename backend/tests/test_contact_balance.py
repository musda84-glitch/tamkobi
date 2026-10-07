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


def test_virman_card_mirror_ignored():
    """Ortak/hesap havuz görünüm satırı cari bakiyeyi etkilemesin."""
    tx = {
        "contact_id": "c1",
        "type": "inflow",
        "amount": 120,
        "source": "virman_card_mirror",
        "via_customer_card": True,
    }
    assert bank_tx_balance_delta(tx) == 0


def test_legacy_cari_card_virman_pair_signs():
    """Eski havuz çifti: kaynak outflow + hedef mirror inflow → doğru cari yön."""
    amount = 100.0
    legacy_src = {
        "contact_id": "src",
        "target_contact_id": "tgt",
        "type": "outflow",
        "amount": amount,
        "source": "virman",
        "via_customer_card": True,
        "customer_card_pool_ledger": True,
    }
    legacy_tgt = {
        "contact_id": "tgt",
        "type": "inflow",
        "amount": amount,
        "source": "virman_card_mirror",
        "via_customer_card": True,
        "customer_card_pool_ledger": True,
    }
    assert bank_tx_balance_delta(legacy_src) == -amount
    assert bank_tx_balance_delta(legacy_tgt) == amount


def test_cari_virman_pair_signs_match_inc():
    """Cari↔cari: kaynak inflow (−), hedef outflow (+) — $inc ile aynı yön."""
    amount = 250.0
    src_tx = {"contact_id": "src", "type": "inflow", "amount": amount, "source": "virman"}
    tgt_tx = {"contact_id": "tgt", "type": "outflow", "amount": amount, "source": "virman"}
    assert bank_tx_balance_delta(src_tx) == -amount
    assert bank_tx_balance_delta(tgt_tx) == amount
    assert compute_contact_balance(bank_txs=[src_tx]) == -amount
    assert compute_contact_balance(bank_txs=[tgt_tx]) == amount


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
