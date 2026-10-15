"""Sipariş listesine fatura e-belge alanlarını yansıt.

«E-belge kesildi» kuralı frontend `orderHasEInvoiceIssued` ile aynıdır:
e_type e_invoice / e_archive / e_export olmalı VE (gib_uuid veya
gib_invoice_id dolu VEYA einvoice_state=accepted VEYA GİB başarı durumu).
paper, expense_slip, draft, error ve yalnız queued e-belge sayılmaz.
"""
import re

_EDOC_TYPES = frozenset({"e_invoice", "e_archive", "e_export"})
_NOT_ISSUED_STATES = frozenset({"paper", "draft", "error", "queued", "not_applicable"})
_GIB_SENT_RE = re.compile(
    r"ziplen|zarflan|ileti|gönderildi|1300|başarıyla tamamland",
    re.IGNORECASE,
)
_GIB_ERR_RE = re.compile(r"^\s*hata\s*:", re.IGNORECASE)


def _text(value) -> str:
    return str(value or "").strip()


def invoice_is_ebelge_issued(doc: dict | None) -> bool:
    """Gerçek GİB e-belgesi mi? Kağıt, gider pusulası, taslak, hata ve kuyruk değil."""
    if not doc:
        return False
    e_type = _text(doc.get("invoice_e_type") or doc.get("e_type")).lower()
    if e_type not in _EDOC_TYPES:
        return False
    state = _text(doc.get("einvoice_state")).lower()
    if state in _NOT_ISSUED_STATES:
        return False
    gs = str(doc.get("invoice_gib_status") or doc.get("gib_status") or "")
    if _GIB_ERR_RE.match(gs):
        return False
    if state == "accepted":
        return True
    if _text(doc.get("gib_uuid") or doc.get("invoice_gib_uuid")):
        return True
    if _text(doc.get("gib_invoice_id")):
        return True
    return bool(_GIB_SENT_RE.search(gs))


def _invoice_looks_gib_sent(inv: dict, state: str | None) -> bool:
    """Geriye dönük ad. Yeni kod `invoice_is_ebelge_issued` kullanır."""
    doc = dict(inv or {})
    if state and not doc.get("einvoice_state"):
        doc["einvoice_state"] = state
    return invoice_is_ebelge_issued(doc)


def apply_invoice_ebelge_fields(order: dict, inv: dict | None) -> dict:
    """Fatura e_type / einvoice_state / GİB no sipariş rozeti için order üzerine yazılır.

    Sipariş invoice_number yalnız gerçek GİB numarası varsa ezilir.
    Yerel (TA…) numara local_invoice_number alanına yazılır.
    """
    if not order or not inv:
        return order
    e_type = inv.get("e_type")
    if e_type:
        order["invoice_e_type"] = e_type
        if not order.get("e_type"):
            order["e_type"] = e_type
    state = inv.get("einvoice_state") or order.get("einvoice_state")
    if state:
        order["einvoice_state"] = state
    if inv.get("gib_status"):
        order["invoice_gib_status"] = inv.get("gib_status")
    gib_no = _text(inv.get("gib_invoice_id"))
    inv_no = _text(inv.get("invoice_number"))
    local_saved = _text(inv.get("local_invoice_number"))
    order_no = _text(order.get("order_number"))
    if gib_no:
        order["gib_invoice_id"] = gib_no
    if gib_no and invoice_is_ebelge_issued(inv):
        order["invoice_number"] = gib_no
    local = local_saved
    if not local and inv_no and inv_no != order_no and inv_no != gib_no:
        local = inv_no
    if local and local != gib_no:
        order["local_invoice_number"] = local
    if inv.get("gib_uuid"):
        order["invoice_gib_uuid"] = inv.get("gib_uuid")
    if inv.get("gib_tracking_id"):
        order["invoice_gib_tracking_id"] = inv.get("gib_tracking_id")
    return order


def enrich_orders_with_invoices(docs: list, invoices_by_id: dict) -> list:
    if not docs:
        return docs
    for o in docs:
        inv = invoices_by_id.get(o.get("invoice_id")) if o.get("invoice_id") else None
        if inv:
            apply_invoice_ebelge_fields(o, inv)
    return docs
