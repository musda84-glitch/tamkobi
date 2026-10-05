"""İrsaliye cari bakiyeye yazılmaz."""
from __future__ import annotations

from contact_payments import purchase_invoice_leftover_payment


def _is_dispatch_doc(inv: dict) -> bool:
    return bool(inv) and (inv.get("invoice_type") == "dispatch" or inv.get("e_type") == "e_dispatch")


def test_purchase_leftover_skips_dispatch():
    assert purchase_invoice_leftover_payment(
        {"_id": "d1", "invoice_type": "dispatch", "e_type": "e_dispatch", "status": "approved", "grand_total": 236.36},
        236.36,
    ) is None
    assert purchase_invoice_leftover_payment(
        {"_id": "d2", "invoice_type": "purchase", "e_type": "e_dispatch", "status": "approved"},
        50,
    ) is None


def test_dispatch_docs_are_excluded_from_balance_effects():
    """Mirror server._is_dispatch_doc — apply/reverse skip these."""
    assert _is_dispatch_doc({"invoice_type": "dispatch", "e_type": "e_dispatch", "grand_total": 236.36})
    assert _is_dispatch_doc({"invoice_type": "sales", "e_type": "e_dispatch"})
    assert not _is_dispatch_doc({"invoice_type": "sales", "e_type": "e_archive", "grand_total": 150})
    assert not _is_dispatch_doc({"invoice_type": "purchase", "e_type": "e_invoice"})
