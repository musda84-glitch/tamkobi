import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from invoice_status import is_cancelled_invoice  # noqa: E402


def test_active_invoices_are_not_cancelled():
    assert is_cancelled_invoice({"status": "approved", "gib_status": "Gelen E-Fatura Onaylandı"}) is False
    assert is_cancelled_invoice({"status": "draft", "gib_status": "Taslak"}) is False
    assert is_cancelled_invoice({"invoice_number": "OP1"}) is False


def test_cancelled_and_iptal_gib_are_hidden():
    assert is_cancelled_invoice({"status": "cancelled", "invoice_number": "OP02026000000546"}) is True
    assert is_cancelled_invoice({"status": "void"}) is True
    assert is_cancelled_invoice({"status": "approved", "gib_status": "Gelen E-Fatura İptal"}) is True
    assert is_cancelled_invoice({"gib_status": "İptal edildi"}) is True
    assert is_cancelled_invoice({"payment_status": "cancelled"}) is True
