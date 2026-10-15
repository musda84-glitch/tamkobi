"""Sipariş listesi e-belge alanları faturadan zenginleştirilir."""
from order_ebelge_enrich import (
    apply_invoice_ebelge_fields,
    enrich_orders_with_invoices,
    invoice_is_ebelge_issued,
)


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


def test_enrich_keeps_local_number_when_gib_status_without_official_id():
    """GİB başarı durumu var ama resmi gib_invoice_id yok → yerel no ezilmez."""
    order = {"id": "o1", "order_number": "ORD-2026-0060", "invoice_id": "inv1", "is_invoiced": True}
    inv = {
        "_id": "inv1",
        "e_type": "e_archive",
        "invoice_number": "NX202623431210",
        "gib_status": "GİB'e Gönderildi",
    }
    out = apply_invoice_ebelge_fields(order, inv)
    assert out["invoice_gib_status"] == "GİB'e Gönderildi"
    assert out.get("invoice_number") != "NX202623431210"
    assert out["local_invoice_number"] == "NX202623431210"
    assert "gib_invoice_id" not in out
    assert out["e_type"] == "e_archive"
    assert invoice_is_ebelge_issued(inv) is True


def test_enrich_paper_queued_error_accepted():
    paper_order = {"id": "p", "order_number": "B2B-2026-0080", "invoice_id": "ip", "is_invoiced": True}
    paper = apply_invoice_ebelge_fields(paper_order, {
        "_id": "ip",
        "e_type": "paper",
        "einvoice_state": "paper",
        "gib_status": "Kağıt Fatura (Matbu)",
        "invoice_number": "TA2026000000069",
    })
    assert invoice_is_ebelge_issued(paper) is False
    assert paper["einvoice_state"] == "paper"
    assert paper["local_invoice_number"] == "TA2026000000069"
    assert "gib_invoice_id" not in paper
    assert paper.get("invoice_number") != "TA2026000000069"

    queued = {"e_type": "e_invoice", "einvoice_state": "queued", "invoice_number": "TA1"}
    assert invoice_is_ebelge_issued(queued) is False
    q_order = apply_invoice_ebelge_fields({"id": "q", "order_number": "Q-1"}, queued)
    assert q_order["einvoice_state"] == "queued"
    assert q_order["local_invoice_number"] == "TA1"
    assert "invoice_number" not in q_order

    err = {
        "e_type": "e_archive",
        "einvoice_state": "error",
        "gib_status": "Hata: şema",
        "gib_uuid": "uuid-err",
        "invoice_number": "TAERR",
    }
    assert invoice_is_ebelge_issued(err) is False

    accepted = {"e_type": "e_invoice", "einvoice_state": "accepted"}
    assert invoice_is_ebelge_issued(accepted) is True
    accepted_no = {
        "e_type": "e_archive",
        "einvoice_state": "sent",
        "gib_invoice_id": "U052026000000090",
        "invoice_number": "TA2026000000001",
        "local_invoice_number": "TA2026000000001",
    }
    assert invoice_is_ebelge_issued(accepted_no) is True
    stamped = apply_invoice_ebelge_fields(
        {"id": "a", "order_number": "B2B-1", "invoice_number": "B2B-1"},
        accepted_no,
    )
    assert stamped["invoice_number"] == "U052026000000090"
    assert stamped["gib_invoice_id"] == "U052026000000090"
    assert stamped["local_invoice_number"] == "TA2026000000001"

    assert invoice_is_ebelge_issued({"e_type": "expense_slip", "einvoice_state": "sent", "gib_uuid": "u"}) is False
    assert invoice_is_ebelge_issued({"e_type": "e_archive", "einvoice_state": "draft", "gib_uuid": "u"}) is False
    assert invoice_is_ebelge_issued({"einvoice_state": "sent"}) is False
    assert invoice_is_ebelge_issued({"e_type": "paper", "einvoice_state": "sent"}) is False


def test_apply_invoice_ebelge_fields_noop_without_invoice():
    o = {"id": "x"}
    assert apply_invoice_ebelge_fields(o, None) is o
    assert "e_type" not in o
