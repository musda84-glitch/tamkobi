"""Atölye iş emri silme — yönetici onay kuyruğu."""
from __future__ import annotations

from typing import Any, Dict, List, Optional

KIND = "work_order_trash"


def build_trash_request(
    wo: Dict[str, Any],
    *,
    requested_by: str,
    reason: str = "",
    now_iso: str,
) -> Dict[str, Any]:
    """Yeni bekleyen silme talebi dokümanı (id çağıran üretir)."""
    order_code = str(wo.get("order_code") or "").strip()
    step = wo.get("step_no")
    product = str(wo.get("product_name") or "").strip()
    step_name = str(wo.get("step_name") or "").strip()
    return {
        "company_id": wo.get("company_id"),
        "work_order_id": wo.get("_id") or wo.get("id"),
        "order_id": wo.get("order_id"),
        "order_code": order_code,
        "step_no": step,
        "step_name": step_name,
        "product_name": product,
        "station": wo.get("station"),
        "status": "pending",
        "requested_by": requested_by,
        "reason": str(reason or "").strip(),
        "requested_at": now_iso,
        "created_at": now_iso,
    }


def inbox_item(req: Dict[str, Any]) -> Dict[str, Any]:
    """Personel talepleri kutusu satırı."""
    code = str(req.get("order_code") or "").strip() or "URT"
    step = req.get("step_no")
    product = str(req.get("product_name") or "").strip()
    step_name = str(req.get("step_name") or "").strip()
    detail_bits = [b for b in [code, f"Adım {step}" if step else None, product or step_name] if b]
    if req.get("reason"):
        detail_bits.append(str(req["reason"]))
    return {
        "kind": KIND,
        "id": req.get("_id") or req.get("id"),
        "employee_id": None,
        "employee_name": str(req.get("requested_by") or "Operatör").strip() or "Operatör",
        "title": "İş emri silme talebi",
        "detail": " · ".join(detail_bits),
        "created_at": req.get("requested_at") or req.get("created_at") or "",
        "link": "/atolye",
        "meta": {
            "work_order_id": req.get("work_order_id"),
            "order_id": req.get("order_id"),
            "order_code": code,
            "step_no": step,
            "station": req.get("station"),
        },
    }


def pending_ids_for_work_orders(requests: Optional[List[Dict[str, Any]]] = None) -> set:
    """Bekleyen taleplerin work_order_id kümesi."""
    out = set()
    for r in requests or []:
        if str(r.get("status") or "") != "pending":
            continue
        wid = r.get("work_order_id")
        if wid:
            out.add(str(wid))
    return out
