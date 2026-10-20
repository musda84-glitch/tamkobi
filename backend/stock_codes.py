"""Copy product SKU / barcode onto document lines when missing (print, scan, UBL)."""
from __future__ import annotations

import logging
from typing import Any, Iterable, Mapping, MutableMapping, Optional

from line_totals import drop_stale_inclusive_markup

logger = logging.getLogger("tamkobi.stock_codes")


def line_get(it: Any, key: str, default: str = "") -> Any:
    if isinstance(it, dict):
        val = it.get(key)
    else:
        val = getattr(it, key, None)
    return val if val not in (None, "") else default


def line_set(it: Any, key: str, val: Any) -> None:
    if isinstance(it, dict):
        it[key] = val
        return
    try:
        setattr(it, key, val)
    except (ValueError, TypeError, AttributeError):
        try:
            object.__setattr__(it, key, val)
        except Exception:
            logger.exception("line_set failed for %s", key)


def _variant_source(product: Mapping[str, Any], sku: str, barcode: str, name: str) -> Mapping[str, Any]:
    src: Mapping[str, Any] = product
    for v in product.get("variants") or []:
        if not isinstance(v, Mapping):
            continue
        if (sku and v.get("sku") == sku) or (barcode and v.get("barcode") == barcode) or (sku and v.get("barcode") == sku):
            return v
        if name and v.get("sku") and v.get("sku") in name:
            return v
    return src


def apply_stock_codes(items: Iterable[Any], products: Mapping[str, Mapping[str, Any]]) -> list:
    """Fill missing sku/barcode from a product map (variant sku/barcode match)."""
    out = list(items or [])
    for it in out:
        p = products.get(line_get(it, "product_id"))
        if not p:
            continue
        sku = line_get(it, "sku")
        barcode = line_get(it, "barcode")
        name = line_get(it, "name") or line_get(it, "product_name")
        src = _variant_source(p, sku, barcode, name)
        if not sku:
            line_set(it, "sku", src.get("sku") or p.get("sku") or "")
        if not barcode:
            line_set(it, "barcode", src.get("barcode") or p.get("barcode") or "")
        if p.get("price_includes_vat"):
            line_set(it, "price_includes_vat", True)
            if isinstance(it, dict):
                drop_stale_inclusive_markup(it, p)
            else:
                d = {k: line_get(it, k) for k in ("unit_price", "unit_price_incl", "price_includes_vat", "vat_rate")}
                drop_stale_inclusive_markup(d, p)
                if d.get("unit_price_incl") in (None, ""):
                    line_set(it, "unit_price_incl", None)
    return out


async def load_products_for_items(db, items: Iterable[Any], *, company_id: str) -> dict:
    """Load product docs keyed by _id for the given lines."""
    if db is None or not items or not str(company_id or "").strip():
        return {}
    pids = [pid for it in items if (pid := line_get(it, "product_id"))]
    if not pids:
        return {}
    found = await db.products.find({"company_id": company_id, "_id": {"$in": pids}}).to_list(len(pids) + 10)
    return {p["_id"]: p for p in found}


async def fill_stock_codes(db, company_id: Optional[str], items: list) -> list:
    """Copy product SKU / barcode onto document lines when missing (print + scan + UBL)."""
    if not items:
        return items
    products = await load_products_for_items(db, items, company_id=str(company_id or ""))
    if not products:
        return items
    apply_stock_codes(items, products)
    return items
