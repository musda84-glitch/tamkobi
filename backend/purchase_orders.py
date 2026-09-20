"""Verilen sipariş (tedarikçi alış siparişi) yardımcıları."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from line_totals import enrich_line, order_document_totals
from models import PurchaseOrder, PurchaseOrderItem

PO_STATUSES = ("draft", "sent", "received", "invoiced", "cancelled")
PO_STATUS_LABEL = {
    "draft": "Taslak",
    "sent": "Gönderildi",
    "received": "Teslim alındı",
    "invoiced": "Faturalandı",
    "cancelled": "İptal",
}


def build_po_item(
    *,
    product_id: str = "",
    product_name: str,
    sku: str = "",
    quantity: float = 1,
    unit: str = "Adet",
    unit_price: float = 0.0,
    vat_rate: float = 20.0,
) -> PurchaseOrderItem:
    row = {
        "product_id": product_id or "",
        "product_name": product_name,
        "sku": sku or "",
        "quantity": float(quantity) or 1,
        "unit": unit or "Adet",
        "unit_price": float(unit_price) or 0,
        "vat_rate": float(vat_rate) if vat_rate is not None else 20,
        "discount_rate": 0,
    }
    enrich_line(row, price_mode="excl", default_vat=20)
    return PurchaseOrderItem(
        product_id=row.get("product_id") or "",
        product_name=row.get("product_name") or product_name,
        sku=row.get("sku") or "",
        quantity=float(row.get("quantity") or 1),
        unit=row.get("unit") or "Adet",
        unit_price=float(row.get("unit_price") or 0),
        vat_rate=float(row.get("vat_rate") or 20),
        total=float(row.get("total") or 0),
        vat_amount=float(row.get("vat_amount") or 0),
        total_incl=float(row.get("total_incl") or 0),
    )


def apply_po_totals(items: List[PurchaseOrderItem]) -> Dict[str, float]:
    rows = [it.model_dump() if hasattr(it, "model_dump") else dict(it) for it in items]
    subtotal, vat_total, _disc, grand = order_document_totals(rows)
    return {"subtotal": subtotal, "vat_total": vat_total, "grand_total": grand}


def make_purchase_order(
    *,
    company_id: str,
    order_number: str,
    supplier_name: str,
    contact_id: Optional[str],
    items: List[PurchaseOrderItem],
    notes: Optional[str] = None,
    source_channel: Optional[str] = None,
    order_status: str = "draft",
) -> PurchaseOrder:
    totals = apply_po_totals(items)
    status = order_status if order_status in PO_STATUSES else "draft"
    return PurchaseOrder(
        company_id=company_id,
        order_number=order_number,
        supplier_name=supplier_name,
        contact_id=contact_id or None,
        items=items,
        subtotal=totals["subtotal"],
        vat_total=totals["vat_total"],
        grand_total=totals["grand_total"],
        order_status=status,
        notes=notes,
        source_channel=source_channel,
    )


def po_to_invoice_items(items: Any) -> List[Dict[str, Any]]:
    """Verilen sipariş kalemlerini alış faturası satırına çevir."""
    out = []
    for it in items or []:
        d = it.model_dump() if hasattr(it, "model_dump") else dict(it)
        qty = float(d.get("quantity") or 1)
        price = float(d.get("unit_price") or 0)
        vat = int(round(float(d.get("vat_rate") or 20)))
        total = float(d.get("total") or round(qty * price, 2))
        out.append({
            "product_id": d.get("product_id") or "",
            "name": d.get("product_name") or d.get("name") or "Kalem",
            "sku": d.get("sku") or "",
            "quantity": qty,
            "unit": d.get("unit") or "Adet",
            "unit_price": price,
            "vat_rate": vat,
            "total": total,
        })
    return out
