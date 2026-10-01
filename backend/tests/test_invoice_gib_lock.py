"""GİB'e iletilmemiş faturalar düzenlenebilir; iletilmiş olanlar kilitli."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from invoice_edit_lock import invoice_gib_locked  # noqa: E402


def test_draft_not_locked():
    assert invoice_gib_locked({"status": "draft", "e_type": "e_invoice"}) is False


def test_approved_without_gib_not_locked():
    assert invoice_gib_locked({"status": "approved", "e_type": "e_invoice", "gib_status": "Taslak"}) is False
    assert invoice_gib_locked({"status": "approved", "e_type": "e_invoice"}) is False


def test_sent_or_tracking_locked():
    assert invoice_gib_locked({"status": "approved", "einvoice_state": "sent"}) is True
    assert invoice_gib_locked({"status": "approved", "gib_tracking_id": "abc", "e_type": "e_invoice"}) is True
    assert invoice_gib_locked({"status": "approved", "gib_status_code": "1300"}) is True
    assert invoice_gib_locked({"status": "approved", "gib_status": "Test · Başarıyla Tamamlandı"}) is True


def test_error_status_not_locked_by_hata_text():
    assert invoice_gib_locked({"status": "approved", "einvoice_state": "error", "gib_status": "Hata: Schematron"}) is False
