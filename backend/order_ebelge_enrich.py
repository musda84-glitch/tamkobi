"""Sipariş listesine fatura e-belge alanlarını yansıt."""


def apply_invoice_ebelge_fields(order: dict, inv: dict | None) -> dict:
    """Fatura e_type / einvoice_state sipariş rozeti için order üzerine yazılır."""
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
    return order


def enrich_orders_with_invoices(docs: list, invoices_by_id: dict) -> list:
    if not docs:
        return docs
    for o in docs:
        inv = invoices_by_id.get(o.get("invoice_id")) if o.get("invoice_id") else None
        if inv:
            apply_invoice_ebelge_fields(o, inv)
    return docs
