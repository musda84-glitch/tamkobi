"""Sipariş listesi e-belge alanları faturadan zenginleştirilir."""
from order_ebelge_enrich import enrich_orders_with_invoices, apply_invoice_ebelge_fields


def test_enrich_orders_invoice_ebelge_copies_type_and_state():
    docs = [
        {"id": "o1", "invoice_id": "inv1", "is_invoiced": True},
        {"id": "o2", "invoice_id": "inv2", "e_type": "e_invoice"},
        {"id": "o3"},
    ]
    by_id = {
        "inv1": {
            "_id": "inv1",
            "e_type": "e_archive",
            "einvoice_state": "sent",
            "gib_status": "İletildi",
            "gib_invoice_id": "U052026000000090",
            "invoice_number": "U052026000000090",
        },
        "inv2": {"_id": "inv2", "e_type": "e_invoice", "einvoice_state": "queued"},
    }
    out = enrich_orders_with_invoices(docs, by_id)
    assert out[0]["e_type"] == "e_archive"
    assert out[0]["invoice_e_type"] == "e_archive"
    assert out[0]["einvoice_state"] == "sent"
    assert out[0]["invoice_gib_status"] == "İletildi"
    assert out[0]["gib_invoice_id"] == "U052026000000090"
    assert out[0]["invoice_number"] == "U052026000000090"
    assert out[1]["e_type"] == "e_invoice"
    assert out[1]["einvoice_state"] == "queued"
    assert "einvoice_state" not in out[2]


def test_enrich_copies_invoice_number_when_gib_e_gonderildi():
    """einvoice_state yok ama gib_status GİB'e Gönderildi → sipariş hücresinde fatura no."""
    order = {"id": "o1", "order_number": "ORD-2026-0060", "invoice_id": "inv1", "is_invoiced": True}
    inv = {
        "_id": "inv1",
        "e_type": "e_archive",
        "invoice_number": "NX202623431210",
        "gib_status": "GİB'e Gönderildi",
    }
    out = apply_invoice_ebelge_fields(order, inv)
    assert out["invoice_gib_status"] == "GİB'e Gönderildi"
    assert out["invoice_number"] == "NX202623431210"
    assert out["e_type"] == "e_archive"


def test_apply_invoice_ebelge_fields_noop_without_invoice():
    o = {"id": "x"}
    assert apply_invoice_ebelge_fields(o, None) is o
    assert "e_type" not in o
