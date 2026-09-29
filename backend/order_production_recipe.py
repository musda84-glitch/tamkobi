"""Sipariş satırlarından tek seferlik birleşik reçete (iş dosyası) oluşturma."""
from __future__ import annotations

from typing import Any, Dict, List, Optional


def product_can_produce(product: Optional[Dict[str, Any]]) -> bool:
    if not product:
        return False
    t = str(product.get("type") or "product")
    return t not in ("service", "raw_material")


def resolve_order_line_product(item: Dict[str, Any], catalog: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not item or not catalog:
        return None
    pid = item.get("product_id") or item.get("productId")
    sku = str(item.get("sku") or "").strip()
    for p in catalog:
        pid_p = p.get("_id") or p.get("id")
        if pid and pid_p and str(pid_p) == str(pid):
            return p
        if sku and p.get("sku") and str(p.get("sku")) == sku:
            return p
    return None


def producible_order_lines(
    order: Dict[str, Any],
    catalog: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    """Siparişte üretilebilir kalemler: product, quantity, name."""
    items = order.get("items") if isinstance(order.get("items"), list) else []
    out: List[Dict[str, Any]] = []
    for it in items:
        if not isinstance(it, dict):
            continue
        p = resolve_order_line_product(it, catalog)
        if not product_can_produce(p):
            continue
        try:
            qty = float(it.get("quantity") or 0)
        except (TypeError, ValueError):
            qty = 0.0
        if qty <= 0:
            qty = 1.0
        name = (
            str(it.get("product_name") or it.get("name") or p.get("name") or "Ürün").strip()
            or "Ürün"
        )
        out.append({
            "product": p,
            "product_id": str(p.get("_id") or p.get("id")),
            "product_name": name,
            "quantity": qty,
            "unit": str(it.get("unit") or p.get("unit") or "Adet"),
        })
    return out


def build_order_recipe_payload(
    order: Dict[str, Any],
    lines: List[Dict[str, Any]],
    *,
    company_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Tüm sipariş kalemlerini tek reçetede topla (kalem başına Üretim adımı)."""
    if not lines:
        raise ValueError("Bu siparişte üretilebilir ürün yok.")
    first = lines[0]
    order_number = str(order.get("order_number") or order.get("held_label") or "").strip() or "Sipariş"
    customer = str(order.get("customer_name") or "").strip()
    cid = str(order.get("contact_id") or "").strip() or None
    materials: List[Dict[str, Any]] = []
    for line in lines:
        materials.append({
            "product_id": line["product_id"],
            "product_name": line["product_name"],
            "quantity": float(line["quantity"]),
            "unit": line.get("unit") or "Adet",
            "wastage_percent": 0,
            "cost_per_unit": float((line.get("product") or {}).get("purchase_price") or 0),
            "vat_rate": float(
                (line.get("product") or {}).get("purchase_vat_rate")
                or (line.get("product") or {}).get("vat_rate")
                or 20
            ),
            "steps": [{
                "no": 1,
                "name": "Üretim",
                "station": "",
                "duration_min": 0,
                "note": f"{line['quantity']:g}× {line['product_name']}",
            }],
        })
    notes_parts = [f"Sipariş {order_number}"]
    if customer:
        notes_parts.append(customer)
    notes_parts.append(f"{len(lines)} kalem")
    return {
        "company_id": company_id or order.get("company_id") or "comp_nexus_main_01",
        "name": f"Sipariş {order_number}",
        "code": "",
        "finished_product_id": first["product_id"],
        "finished_product_name": first["product_name"],
        "target_quantity": 1.0,
        "unit": "Adet",
        "materials": materials,
        "steps": [],
        "labor_cost": 0.0,
        "overhead_cost": 0.0,
        "notes": " · ".join(notes_parts),
        "contact_id": cid,
        "contact_name": customer or None,
        "job_file_name": order_number,
        "one_time": True,
        "group_same_station": False,
        "is_active": True,
        "sales_order_id": str(order.get("_id") or order.get("id") or "") or None,
        "sales_order_number": order_number,
    }


def summarize_lines(lines: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [
        {
            "product_id": ln["product_id"],
            "product_name": ln["product_name"],
            "quantity": ln["quantity"],
            "unit": ln.get("unit") or "Adet",
        }
        for ln in lines
    ]
