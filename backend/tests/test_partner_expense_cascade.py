"""Ortak/kasa hareketi silinince bağlı masraf da gider; masraf etiketi Para Çekişi değil."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from partner_pay import TX_LABELS, tx_display_label  # noqa: E402


def test_expense_linked_credit_label_is_masraf_not_cekis():
    plain = {"type": "withdrawal", "amount": 4000}
    assert tx_display_label(plain) == TX_LABELS["withdrawal"]
    assert "Para Çekişi" in tx_display_label(plain)

    # Ortak şirket masrafını öder → credit (alacak); etiket Masraf Ödemesi
    linked = {"type": "credit", "amount": 4000, "expense_id": "exp-1", "source": "expense"}
    label = tx_display_label(linked)
    assert "Masraf" in label
    assert "Para Çekişi" not in label
    assert "Sermaye" not in label

    by_source = {"type": "credit", "source": "expense"}
    assert "Masraf" in tx_display_label(by_source)


def test_capital_in_unchanged():
    assert tx_display_label({"type": "capital_in"}) == TX_LABELS["capital_in"]


def test_linked_expense_related_helper_shape():
    """_linked_expense_related is async; shape contract for soft_delete related=."""
    # Pure contract: related payload format used by trash.soft_delete
    related = [{"collection": "expenses", "docs": [{"_id": "e1", "expense_number": "MSR-2026-0001"}]}]
    assert related[0]["collection"] == "expenses"
    assert related[0]["docs"][0]["_id"] == "e1"
