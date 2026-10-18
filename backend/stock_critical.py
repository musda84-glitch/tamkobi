"""Kritik stok kuralı — dashboard, operasyon, AI danışman ve sabah özeti aynı sayıyı kullanır.

Varsayılan min (5) yoktur. Min boş, 0 veya geçersizse ürün kritik değildir.
"""
from __future__ import annotations

from typing import Any, Optional

# Mongo / mysql_store sorgusu. company_id çağıran yerde eklenir.
CRITICAL_STOCK_FILTER = {
    "track_stock": {"$ne": False},
    "min_stock_alert": {"$gt": 0},
    "$expr": {"$lte": [{"$ifNull": ["$stock_quantity", 0]}, "$min_stock_alert"]},
}


def _positive_min(raw: Any) -> Optional[float]:
    if raw is None or raw == "":
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    if value > 0:
        return value
    return None


def _is_critical_stock(p: Any) -> bool:
    """True ancak üçü birden: stok takibi açık, min > 0, stok <= min."""
    if not isinstance(p, dict) or p.get("track_stock") is False:
        return False
    minimum = _positive_min(p.get("min_stock_alert"))
    if minimum is None:
        return False
    try:
        qty = float(p.get("stock_quantity") or 0)
    except (TypeError, ValueError):
        return False
    return qty <= minimum


def critical_stock_query(company_id: str) -> dict:
    return {"company_id": company_id, **CRITICAL_STOCK_FILTER}
