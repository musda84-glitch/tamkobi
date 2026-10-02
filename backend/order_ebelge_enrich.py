"""Sipariş listesine fatura e-belge alanlarını yansıt."""
import re

_GIB_SENT_RE = re.compile(
    r"ziplen|zarflan|ileti|gönderildi|1300|başarıyla tamamland",
    re.IGNORECASE,
)


def _invoice_looks_gib_sent(inv: dict, state: str | None) -> bool:
    if state in ("sent", "queued", "accepted"):
        return True
    if inv.get("gib_uuid") or inv.get("gib_tracking_id") or inv.get("gib_invoice_id"):
        return True
    gs = str(inv.get("gib_status") or "")
    if re.match(r"^\s*hata\s*:", gs, re.IGNORECASE):
        return False
    return bool(_GIB_SENT_RE.search(gs))


def apply_invoice_ebelge_fields(order: dict, inv: dict | None) -> dict:
    """Fatura e_type / einvoice_state / GİB no sipariş rozeti için order üzerine yazılır."""
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
    gib_no = str(inv.get("gib_invoice_id") or "").strip()
    inv_no = str(inv.get("invoice_number") or "").strip()
    order_no = str(order.get("order_number") or "").strip()
    # Resmi GİB serisi (entegratör) — sipariş satırında gösterilir
    if gib_no:
        order["gib_invoice_id"] = gib_no
    display_no = gib_no or (inv_no if inv_no and inv_no != order_no else "")
    if display_no and (gib_no or _invoice_looks_gib_sent(inv, state) or inv.get("invoice_number")):
        # GİB gönderilmiş veya fatura bağlıysa numarayı sipariş hücresine taşı
        if gib_no or _invoice_looks_gib_sent(inv, state):
            order["invoice_number"] = display_no
        elif inv_no and inv_no != order_no:
            order.setdefault("invoice_number", inv_no)
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
