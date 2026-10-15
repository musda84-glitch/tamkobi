"""Fatura / sipariş tutar farkı uyarısı."""
from order_invoice_mismatch import (
    attach_invoice_mismatch_warnings,
    format_tl,
    mismatch_warning_text,
    order_sync_skip_reason,
    totals_differ,
)


def test_format_and_threshold():
    assert format_tl(1250.5) == "1.250,50"
    assert format_tl(100) == "100,00"
    assert totals_differ(100, 100.01) is False
    assert totals_differ(100, 100.02) is True
    assert mismatch_warning_text(1250.5) == "Fatura siparişten farklı (Fatura: 1.250,50 TL)"


def test_warning_field_and_foreign_company_hidden():
    orders = [
        {"_id": "o1", "company_id": "co", "invoice_id": "inv1", "grand_total": 100, "order_number": "B2B-1"},
        {"_id": "o2", "company_id": "co", "invoice_id": "inv2", "grand_total": 100.01, "order_number": "B2B-2"},
        {"_id": "o3", "company_id": "co", "invoice_id": "inv3", "grand_total": 10, "order_number": "B2B-3"},
    ]
    by_id = {
        "inv1": {"_id": "inv1", "company_id": "co", "grand_total": 1250.5},
        "inv2": {"_id": "inv2", "company_id": "co", "grand_total": 100.01},
        "inv3": {"_id": "inv3", "company_id": "other", "grand_total": 999},
    }
    out = attach_invoice_mismatch_warnings(orders, by_id)
    assert out[0]["invoice_mismatch_warning"] == "Fatura siparişten farklı (Fatura: 1.250,50 TL)"
    assert out[0]["invoice_grand_total"] == 1250.5
    assert "invoice_mismatch_warning" not in out[1]
    assert "invoice_mismatch_warning" not in out[2]
    assert "invoice_grand_total" not in out[2]


def test_skip_reasons_do_not_touch_closed_or_marketplace():
    invoice = {"_id": "inv", "company_id": "co"}
    base = {"_id": "o", "company_id": "co", "invoice_id": "inv", "channel": "b2b", "order_status": "approved"}
    assert order_sync_skip_reason(base, invoice, items_changed=True, pick_open=False) is None
    assert order_sync_skip_reason({**base, "company_id": "other"}, invoice, items_changed=True, pick_open=False) == "company"
    assert order_sync_skip_reason({**base, "invoice_id": "other"}, invoice, items_changed=False, pick_open=False) == "other_invoice"
    assert order_sync_skip_reason({**base, "order_status": "cancelled"}, invoice, items_changed=True, pick_open=False) == "closed"
    assert order_sync_skip_reason({**base, "order_status": "returned"}, invoice, items_changed=True, pick_open=False) == "closed"
    assert order_sync_skip_reason({**base, "channel": "trendyol"}, invoice, items_changed=True, pick_open=False) == "marketplace"
    assert order_sync_skip_reason({**base, "order_status": "shipped"}, invoice, items_changed=True, pick_open=False) == "fulfillment"
    assert order_sync_skip_reason({**base, "order_status": "shipped"}, invoice, items_changed=False, pick_open=False) is None
    assert order_sync_skip_reason(base, invoice, items_changed=True, pick_open=True) == "fulfillment"
