"""Sipariş listesi e-belge alanları faturadan zenginleştirilir."""
from order_ebelge_enrich import enrich_orders_with_invoices, apply_invoice_ebelge_fields


def test_enrich_orders_invoice_ebelge_copies_type_and_state():
    docs = [
        {"id": "o1", "invoice_id": "inv1", "is_invoiced": True},
        {"id": "o2", "invoice_id": "inv2", "e_type": "e_invoice"},
        {"id": "o3"},
    ]
    by_id = {
        "inv1": {"_id": "inv1", "e_type": "e_archive", "einvoice_state": "sent", "gib_status": "İletildi"},
        "inv2": {"_id": "inv2", "e_type": "e_invoice", "einvoice_state": "queued"},
    }
    out = enrich_orders_with_invoices(docs, by_id)
    assert out[0]["e_type"] == "e_archive"
    assert out[0]["invoice_e_type"] == "e_archive"
    assert out[0]["einvoice_state"] == "sent"
    assert out[0]["invoice_gib_status"] == "İletildi"
    assert out[1]["e_type"] == "e_invoice"
    assert out[1]["einvoice_state"] == "queued"
    assert "einvoice_state" not in out[2]


def test_apply_invoice_ebelge_fields_noop_without_invoice():
    o = {"id": "x"}
    assert apply_invoice_ebelge_fields(o, None) is o
    assert "e_type" not in o
