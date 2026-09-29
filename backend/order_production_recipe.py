"""Sipariş satırlarından tek seferlik birleşik reçete (iş dosyası) oluşturma."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import uuid


def _safe_float(val: Any, default: float = 0.0) -> float:
    try:
        if val is None or val == "":
            return default
        return float(val)
    except (TypeError, ValueError):
        return default


def product_can_produce(product: Optional[Dict[str, Any]]) -> bool:
    if not product:
        return False
    t = str(product.get("type") or "product")
    return t not in ("service", "raw_material")


def line_can_produce(item: Dict[str, Any], product: Optional[Dict[str, Any]] = None) -> bool:
    """Stok kartı yoksa sipariş satırının type alanına bak."""
    src = product or item or {}
    t = str(src.get("type") or item.get("type") or "product")
    return t not in ("service", "raw_material")


def resolve_order_line_product(item: Dict[str, Any], catalog: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not item or not catalog:
        return None
    pid = item.get("product_id") or item.get("productId")
    sku = str(item.get("sku") or "").strip()
    barcode = str(item.get("barcode") or "").strip()
    for p in catalog:
        pid_p = p.get("_id") or p.get("id")
        if pid and pid_p and str(pid_p) == str(pid):
            return p
        if sku and p.get("sku") and str(p.get("sku")) == sku:
            return p
        if barcode and p.get("barcode") and str(p.get("barcode")) == barcode:
            return p
    return None


def producible_order_lines(
    order: Dict[str, Any],
    catalog: Optional[List[Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """Siparişte üretilebilir kalemler — stok kartı bulunamasa da satırdan üret."""
    items = order.get("items") if isinstance(order.get("items"), list) else []
    catalog = catalog or []
    out: List[Dict[str, Any]] = []
    for idx, it in enumerate(items):
        if not isinstance(it, dict):
            continue
        p = resolve_order_line_product(it, catalog)
        if not line_can_produce(it, p):
            continue
        qty = _safe_float(it.get("quantity"), 0.0)
        if qty <= 0:
            qty = 1.0
        name = (
            str(it.get("product_name") or it.get("name") or (p or {}).get("name") or "").strip()
            or "Ürün"
        )
        pid = str(
            (p or {}).get("_id")
            or (p or {}).get("id")
            or it.get("product_id")
            or it.get("productId")
            or ""
        ).strip() or f"order-line-{idx}"
        unit = str(it.get("unit") or (p or {}).get("unit") or "Adet").strip() or "Adet"
        out.append({
            "product": p or {
                "_id": pid,
                "id": pid,
                "name": name,
                "type": str(it.get("type") or "product"),
                "unit": unit,
                "purchase_price": _safe_float(it.get("purchase_price") or it.get("unit_cost")),
            },
            "product_id": pid,
            "product_name": name,
            "quantity": qty,
            "unit": unit,
            "note": str(it.get("note") or it.get("line_note") or it.get("stock_note") or "").strip()[:500],
        })
    return out


def build_order_recipe_payload(
    order: Dict[str, Any],
    lines: List[Dict[str, Any]],
    *,
    company_id: Optional[str] = None,
    default_station: Optional[str] = None,
) -> Dict[str, Any]:
    """Tüm sipariş kalemlerini tek reçetede topla (kalem başına Üretim adımı)."""
    if not lines:
        raise ValueError("Bu siparişte üretilebilir ürün yok.")
    first = lines[0]
    order_number = str(order.get("order_number") or order.get("held_label") or "").strip() or "Sipariş"
    customer = str(order.get("customer_name") or "").strip()
    cid = str(order.get("contact_id") or "").strip() or None
    station = str(default_station or "").strip()
    materials: List[Dict[str, Any]] = []
    for line in lines:
        prod = line.get("product") or {}
        stock_note = str(line.get("note") or "").strip()[:500]
        # Atölye «Not:» alanında B2B sipariş stok açıklaması görünsün.
        if stock_note:
            step_note = stock_note
        else:
            step_note = f"{line['quantity']:g}× {line['product_name']}"
        mat: Dict[str, Any] = {
            "product_id": line["product_id"],
            "product_name": line["product_name"],
            "quantity": float(line["quantity"]),
            "unit": line.get("unit") or "Adet",
            "wastage_percent": 0.0,
            "cost_per_unit": _safe_float(prod.get("purchase_price")),
            "vat_rate": _safe_float(
                prod.get("purchase_vat_rate") if prod.get("purchase_vat_rate") not in (None, "") else prod.get("vat_rate"),
                20.0,
            ),
            "steps": [{
                "no": 1,
                "name": "Üretim",
                "station": station,
                "duration_min": 0,
                "note": step_note,
            }],
        }
        if stock_note:
            mat["note"] = stock_note
            mat["stock_note"] = stock_note
        materials.append(mat)
    notes_parts = [f"Sipariş {order_number}"]
    if customer:
        notes_parts.append(customer)
    notes_parts.append(f"{len(lines)} kalem")
    return {
        "company_id": company_id or order.get("company_id") or "comp_nexus_main_01",
        "name": f"Sipariş {order_number}",
        "code": f"BOM-{str(uuid.uuid4().int)[:6]}",
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


def recipe_mongo_doc(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Pydantic'siz reçete belgesi — doğrulama 500'lerini önler."""
    now = datetime.now(timezone.utc).isoformat()
    sales_order_id = payload.get("sales_order_id")
    sales_order_number = payload.get("sales_order_number")
    doc = {
        "_id": str(uuid.uuid4()),
        "company_id": payload.get("company_id") or "comp_nexus_main_01",
        "name": payload.get("name") or "Sipariş reçetesi",
        "code": payload.get("code") or f"BOM-{str(uuid.uuid4().int)[:6]}",
        "finished_product_id": str(payload.get("finished_product_id") or ""),
        "finished_product_name": str(payload.get("finished_product_name") or "Ürün"),
        "target_quantity": _safe_float(payload.get("target_quantity"), 1.0) or 1.0,
        "unit": str(payload.get("unit") or "Adet"),
        "materials": list(payload.get("materials") or []),
        "steps": list(payload.get("steps") or []),
        "labor_cost": _safe_float(payload.get("labor_cost")),
        "overhead_cost": _safe_float(payload.get("overhead_cost")),
        "notes": payload.get("notes"),
        "contact_id": payload.get("contact_id"),
        "contact_name": payload.get("contact_name"),
        "job_file_name": payload.get("job_file_name"),
        "one_time": True,
        "group_same_station": bool(payload.get("group_same_station")),
        "is_active": True,
        "created_at": now,
        "updated_at": now,
        "total_estimated_cost": 0.0,
        "unit_cost": 0.0,
    }
    if sales_order_id:
        doc["sales_order_id"] = sales_order_id
    if sales_order_number:
        doc["sales_order_number"] = sales_order_number
    return {k: v for k, v in doc.items() if v is not None}


def summarize_lines(lines: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    for ln in lines:
        row = {
            "product_id": ln["product_id"],
            "product_name": ln["product_name"],
            "quantity": ln["quantity"],
            "unit": ln.get("unit") or "Adet",
        }
        note = str(ln.get("note") or "").strip()
        if note:
            row["note"] = note
        out.append(row)
    return out


def apply_station_to_recipe_materials(
    recipe: Dict[str, Any],
    station: str,
    *,
    force: bool = False,
) -> Dict[str, Any]:
    """Seçilen istasyonu reçete malzeme adımlarına yaz.

    force=True: sipariş→üretim emri — tüm adımlara yazılır (UI taahhüdü).
    force=False: yalnızca boş istasyon doldurulur.
    """
    st = str(station or "").strip()
    if not st or not isinstance(recipe, dict):
        return recipe
    mats = []
    for m in recipe.get("materials") or []:
        if not isinstance(m, dict):
            mats.append(m)
            continue
        row = dict(m)
        steps = []
        for step in row.get("steps") or []:
            if not isinstance(step, dict):
                steps.append(step)
                continue
            s = dict(step)
            if force or not str(s.get("station") or "").strip():
                s["station"] = st
            steps.append(s)
        if steps:
            row["steps"] = steps
        mats.append(row)
    recipe["materials"] = mats
    # Genel (malzeme dışı) adımlar
    top_steps = []
    for step in recipe.get("steps") or []:
        if not isinstance(step, dict):
            top_steps.append(step)
            continue
        s = dict(step)
        if force or not str(s.get("station") or "").strip():
            s["station"] = st
        top_steps.append(s)
    if top_steps:
        recipe["steps"] = top_steps
    return recipe


def apply_stock_notes_to_recipe_materials(
    recipe: Dict[str, Any],
    lines: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Sipariş kalemlerindeki stok notunu reçete malzemelerine yaz (yeniden kullanımda da)."""
    if not isinstance(recipe, dict):
        return recipe
    by_pid: Dict[str, Dict[str, Any]] = {}
    for line in lines or []:
        if not isinstance(line, dict):
            continue
        pid = str(line.get("product_id") or "").strip()
        if pid and pid not in by_pid:
            by_pid[pid] = line
    mats = []
    for m in recipe.get("materials") or []:
        if not isinstance(m, dict):
            mats.append(m)
            continue
        row = dict(m)
        pid = str(row.get("product_id") or "").strip()
        line = by_pid.get(pid) or {}
        stock_note = str(line.get("note") or row.get("stock_note") or row.get("note") or "").strip()[:500]
        if stock_note:
            row["note"] = stock_note
            row["stock_note"] = stock_note
            steps = []
            for step in row.get("steps") or []:
                if not isinstance(step, dict):
                    steps.append(step)
                    continue
                s = dict(step)
                qty = row.get("quantity")
                try:
                    qty_s = f"{float(qty):g}"
                except (TypeError, ValueError):
                    qty_s = str(qty or "").strip() or "1"
                pname = str(row.get("product_name") or "").strip() or "Ürün"
                base = f"{qty_s}× {pname}"
                # Atölye Not: B2B stok açıklamasını göster.
                s["note"] = stock_note or base
                steps.append(s)
            if steps:
                row["steps"] = steps
        mats.append(row)
    recipe["materials"] = mats
    return recipe


def order_has_production(order: Optional[Dict[str, Any]] = None) -> bool:
    """Sipariş üretime gönderildi mi (buton rengi / rozet)."""
    o = order or {}
    if o.get("has_production_order") is True:
        return True
    if o.get("has_production_order") is False and not (
        o.get("sent_to_production_at") or o.get("production_recipe_id") or o.get("production_order_id")
    ):
        return False
    return bool(
        o.get("sent_to_production_at")
        or o.get("production_recipe_id")
        or o.get("production_order_id")
    )


def production_mark_for_order(
    *,
    recipe_id: Optional[str] = None,
    production_order_id: Optional[str] = None,
    now_iso: Optional[str] = None,
) -> Dict[str, Any]:
    """Siparişe yazılacak üretim gönderildi alanları."""
    now = now_iso or datetime.now(timezone.utc).isoformat()
    patch: Dict[str, Any] = {
        "sent_to_production_at": now,
        "has_production_order": True,
        "updated_at": now,
    }
    rid = str(recipe_id or "").strip()
    if rid:
        patch["production_recipe_id"] = rid
    pid = str(production_order_id or "").strip()
    if pid:
        patch["production_order_id"] = pid
    return patch
