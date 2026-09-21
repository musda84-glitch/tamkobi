"""Stok hareketi birleştirme — fatura / sipariş / transfer satırlarından kayıt."""


def _norm(value) -> str:
    return str(value or "").strip()


def product_ids_of(product: dict | None, product_id: str = "") -> list[str]:
    ids = []
    for raw in (product_id, (product or {}).get("_id"), (product or {}).get("id")):
        v = _norm(raw)
        if v and v not in ids:
            ids.append(v)
    return ids


def item_matches_product(item: dict | None, product: dict | None, product_id: str = "") -> bool:
    """product_id, sku, barkod veya ad ile satır eşle."""
    it = item or {}
    p = product or {}
    pids = set(product_ids_of(p, product_id))
    for key in ("product_id", "id", "_id"):
        if _norm(it.get(key)) in pids and pids:
            return True
    sku = _norm(p.get("sku")).lower()
    barcode = _norm(p.get("barcode")).lower()
    name = _norm(p.get("name") or p.get("product_name")).lower()
    if sku and _norm(it.get("sku")).lower() == sku:
        return True
    if barcode and _norm(it.get("barcode")).lower() == barcode:
        return True
    item_name = _norm(it.get("product_name") or it.get("name")).lower()
    if name and item_name and item_name == name:
        return True
    return False


def _qty(item: dict) -> float:
    for key in ("quantity", "qty", "change", "ordered_qty"):
        try:
            n = float(item.get(key) or 0)
        except (TypeError, ValueError):
            continue
        if n:
            return n
    return 0.0


def invoice_stock_moves(invoices: list, product_id: str, product: dict | None = None) -> list:
    """Fatura satırlarından sentetik stok hareketi — stock_movements yazılmayan alış/satış için."""
    rows = []
    for inv in invoices or []:
        itype = inv.get("invoice_type")
        sign = 1
        if itype in ("sales", "purchase_return"):
            sign = -1
            label = "Satış" if itype == "sales" else "Alış iadesi"
        elif itype in ("purchase", "sales_return"):
            sign = 1
            label = "Alış" if itype == "purchase" else "Satış iadesi"
        else:
            continue
        num = inv.get("invoice_number") or inv.get("number") or "Fatura"
        date = inv.get("issue_date") or inv.get("created_at") or ""
        contact = inv.get("contact_name") or ""
        for idx, it in enumerate(inv.get("items") or []):
            if not item_matches_product(it, product, product_id):
                continue
            qty = _qty(it)
            if not qty:
                continue
            rows.append({
                "_id": f"inv-{inv.get('_id')}-{idx}",
                "product_id": product_id,
                "change": sign * qty,
                "reason": f"{label}: {num}" + (f" · {contact}" if contact else ""),
                "date": date,
                "source": "invoice",
            })
    return rows


def order_stock_moves(orders: list, product_id: str, product: dict | None = None) -> list:
    rows = []
    for o in orders or []:
        if str(o.get("order_status") or "").lower() in ("cancelled", "canceled", "draft"):
            continue
        num = o.get("order_number") or "Sipariş"
        date = o.get("order_date") or o.get("created_at") or ""
        contact = o.get("customer_name") or o.get("contact_name") or ""
        for idx, it in enumerate(o.get("items") or []):
            if not item_matches_product(it, product, product_id):
                continue
            qty = _qty(it)
            if not qty:
                continue
            rows.append({
                "_id": f"ord-{o.get('_id')}-{idx}",
                "product_id": product_id,
                "change": -qty,
                "reason": f"Sipariş: {num}" + (f" · {contact}" if contact else ""),
                "date": date,
                "source": "order",
            })
    return rows


def transfer_stock_moves(transfers: list, product_id: str, product: dict | None = None) -> list:
    rows = []
    pids = set(product_ids_of(product, product_id))
    for t in transfers or []:
        if _norm(t.get("product_id")) not in pids:
            continue
        try:
            qty = float(t.get("quantity") or 0)
        except (TypeError, ValueError):
            qty = 0.0
        if not qty:
            continue
        rows.append({
            "_id": f"trf-{t.get('_id')}",
            "product_id": product_id,
            "change": qty,
            "reason": f"Depo transferi: {t.get('transfer_number') or ''}".strip(),
            "date": t.get("transfer_date") or t.get("created_at") or "",
            "source": "transfer",
        })
    return rows


def merge_stock_moves(*groups: list, cap: int = 80) -> list:
    merged = []
    for group in groups:
        merged.extend(group or [])
    merged.sort(key=lambda r: str(r.get("date") or ""), reverse=True)
    return merged[: max(1, cap)]
