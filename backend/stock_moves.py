"""Stok hareketi birleştirme — fatura satırlarından sentetik kayıt."""


def invoice_stock_moves(invoices: list, product_id: str) -> list:
    """Fatura satırlarından sentetik stok hareketi — stock_movements yazılmayan alış/satış için."""
    rows = []
    pid = str(product_id)
    for inv in invoices or []:
        itype = inv.get("invoice_type")
        if itype not in ("sales", "purchase"):
            continue
        num = inv.get("invoice_number") or inv.get("number") or "Fatura"
        date = inv.get("issue_date") or inv.get("created_at") or ""
        contact = inv.get("contact_name") or ""
        for idx, it in enumerate(inv.get("items") or []):
            if str(it.get("product_id") or "") != pid:
                continue
            try:
                qty = float(it.get("quantity") or 0)
            except (TypeError, ValueError):
                qty = 0.0
            if qty == 0:
                continue
            change = qty if itype == "purchase" else -qty
            label = "Alış" if itype == "purchase" else "Satış"
            reason = f"{label}: {num}" + (f" · {contact}" if contact else "")
            rows.append({
                "_id": f"inv-{inv.get('_id')}-{idx}",
                "product_id": pid,
                "change": change,
                "reason": reason,
                "date": date,
                "source": "invoice",
            })
    return rows
