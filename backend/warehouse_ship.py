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
