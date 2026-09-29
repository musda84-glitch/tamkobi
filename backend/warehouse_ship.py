"""Depodan sevk: kargo firması olmadan siparişi sevk edildi işaretle."""
from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

WAREHOUSE_CARRIER = "warehouse"
WAREHOUSE_CARRIER_NAME = "Depodan sevk"
CLOSED_STATUSES = frozenset({"cancelled", "canceled", "returned", "partially_returned"})


def tracking_number(order_number: Optional[str] = None) -> str:
    raw = "".join(ch for ch in str(order_number or "SIP") if ch.isalnum() or ch in "-_")[:18]
    return f"DEPO-{raw or 'SIP'}"


def is_warehouse_shipped(order: Optional[Dict[str, Any]] = None) -> bool:
    if not order:
        return False
    if order.get("warehouse_shipped") or str(order.get("ship_method") or "") == WAREHOUSE_CARRIER:
        return True
    if str(order.get("cargo_carrier") or "").lower() == WAREHOUSE_CARRIER:
        return True
    return str(order.get("cargo_tracking_number") or "").upper().startswith("DEPO-")


def is_closed(order: Optional[Dict[str, Any]] = None) -> bool:
    return str((order or {}).get("order_status") or "").lower() in CLOSED_STATUSES


def has_external_cargo(order: Optional[Dict[str, Any]] = None) -> bool:
    o = order or {}
    tn = str(o.get("cargo_tracking_number") or "").strip()
    if not tn:
        return False
    if tn.upper().startswith("DEPO-"):
        return False
    if str(o.get("cargo_carrier") or "").lower() == WAREHOUSE_CARRIER:
        return False
    return True


def can_warehouse_ship(order: Optional[Dict[str, Any]] = None) -> Tuple[str, str]:
    """ok | exists | closed | cargo — UI/API karar kodu."""
    o = order or {}
    if is_closed(o):
        return "closed", "İptal veya iade sipariş depodan sevk edilemez."
    if is_warehouse_shipped(o):
        return "exists", "Bu sipariş zaten depodan sevk edildi."
    if has_external_cargo(o):
        return "cargo", f"Bu sipariş için kargo kaydı var: {o.get('cargo_tracking_number')}"
    return "ok", ""


def order_set_fields(order: Dict[str, Any], now: str) -> Dict[str, Any]:
    existing = str(order.get("cargo_tracking_number") or "").strip()
    tracking = existing if existing.upper().startswith("DEPO-") else tracking_number(order.get("order_number"))
    return {
        "order_status": "shipped",
        "pick_status": "shipped",
        "warehouse_shipped": True,
        "ship_method": WAREHOUSE_CARRIER,
        "shipped_at": now,
        "picked_at": order.get("picked_at") or now,
        "cargo_carrier": WAREHOUSE_CARRIER,
        "cargo_carrier_name": WAREHOUSE_CARRIER_NAME,
        "cargo_tracking_number": tracking,
    }


async def apply_warehouse_ship(
    db: Any,
    order_id: str,
    now: str,
    create_draft: Any = None,
    push_shopphp: Any = None,
) -> Dict[str, Any]:
    """Siparişi depodan sevk et. status: success | exists | closed | cargo | not_found."""
    o = await db.orders.find_one({"_id": order_id})
    if not o:
        o = await db.orders.find_one({"id": order_id})
    if not o:
        return {"status": "not_found", "message": "Sipariş bulunamadı."}
    code, detail = can_warehouse_ship(o)
    if code != "ok":
        return {"status": code, "message": detail, "order_id": str(o.get("_id") or order_id)}
    fields = order_set_fields(o, now)
    await db.orders.update_one({"_id": o["_id"]}, {"$set": fields})
    updated = await db.orders.find_one({"_id": o["_id"]}) or {**o, **fields}
    if push_shopphp:
        try:
            await push_shopphp(updated, reason="status")
        except Exception:
            pass
    draft = None
    draft_error = None
    if create_draft:
        try:
            draft = await create_draft(updated, source="warehouse_ship")
            if draft:
                updated = await db.orders.find_one({"_id": o["_id"]}) or updated
        except Exception as exc:
            draft_error = str(exc)[:180] or "Taslak fatura oluşturulamadı."
    msg = f"{o.get('order_number') or 'Sipariş'} depodan sevk edildi."
    if draft:
        msg = f"{msg} · taslak fatura {draft.get('invoice_number')}."
    elif updated.get("invoice_number"):
        msg = f"{msg} · mevcut fatura {updated.get('invoice_number')}."
    elif draft_error:
        msg = f"{msg} · {draft_error}"
    out: Dict[str, Any] = {
        "status": "success",
        "order_id": str(o.get("_id") or order_id),
        "order_status": "shipped",
        "warehouse_shipped": True,
        "cargo_carrier": WAREHOUSE_CARRIER,
        "cargo_carrier_name": WAREHOUSE_CARRIER_NAME,
        "cargo_tracking_number": fields.get("cargo_tracking_number"),
        "message": msg,
    }
    if draft:
        out["draft_invoice_id"] = draft.get("_id")
        out["draft_invoice_number"] = draft.get("invoice_number")
    if draft_error and not draft:
        out["draft_invoice_error"] = draft_error
    return out
