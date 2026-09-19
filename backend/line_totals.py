"""Shared product/service line math for invoices, orders and quotes.

Stored canonical unit price is always KDV hariç (net). KDV'li birim fiyat and
both net/gross line totals are derived from quantity, discount and VAT rate.
"""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Mapping, MutableMapping, Tuple

VAT_OPTIONS = (0, 1, 10, 20)


def _f(value: Any, default: float = 0.0) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def normalize_vat(rate: Any, default: float = 20.0) -> float:
    v = _f(rate, default)
    if v < 0:
        return 0.0
    return v


def normalize_discount(rate: Any) -> float:
    d = _f(rate, 0.0)
    return min(max(d, 0.0), 100.0)


def unit_incl_from_excl(excl: float, vat_rate: float) -> float:
    return excl * (1 + vat_rate / 100.0)


def unit_excl_from_incl(incl: float, vat_rate: float) -> float:
    factor = 1 + vat_rate / 100.0
    if factor == 0:
        return incl
    return incl / factor


def drop_stale_inclusive_markup(item: MutableMapping[str, Any], product: Mapping[str, Any] | None = None) -> MutableMapping[str, Any]:
    """KDV dahil rafta duran birim fiyatın üzerine yanlış unit_price_incl yazıldıysa sil.

    Stok sale_price=260 (KDV dahil) satıra unit_price=260 + unit_price_incl=286 olarak
    işlenmişse enrich tekrar KDV ekler. Raf fiyatı hâlâ unit_price'daysa brüt say.
    """
    prod = product or {}
    includes = bool(item.get("price_includes_vat") or prod.get("price_includes_vat"))
    if not includes:
        return item
    item["price_includes_vat"] = True
    sale = _f(prod.get("sale_price"))
    price = _f(item.get("unit_price"))
    incl = item.get("unit_price_incl")
    if incl in (None, ""):
        return item
    if sale and abs(price - sale) < 0.05:
        item["unit_price_incl"] = None
    return item


def quote_line_price_mode(item: Mapping[str, Any], requested: str = "excl") -> str:
    """KDV dahil stok fiyatı satırda brüt duruyorsa (unit_price_incl yok) incl say."""
    includes = bool(item.get("price_includes_vat"))
    has_incl = item.get("unit_price_incl") not in (None, "")
    if includes and not has_incl:
        return "incl"
    return (requested or "excl").lower()


def enrich_line(
    item: MutableMapping[str, Any],
    price_mode: str = "excl",
    default_vat: float = 0.0,
) -> MutableMapping[str, Any]:
    """Fill unit_price (net), unit_price_incl, total (net), total_incl, vat_amount.

    Legacy invoices may send a single unit_price in KDV-dahil mode without
    unit_price_incl; in that case unit_price is treated as gross.
    """
    qty = _f(item.get("quantity"), 0.0)
    if "vat_rate" in item and item.get("vat_rate") is not None:
        vat = normalize_vat(item.get("vat_rate"), default_vat)
    else:
        vat = default_vat
    disc = normalize_discount(item.get("discount_rate", item.get("discount_percent")))
    item["discount_rate"] = disc
    if "discount_percent" in item or disc:
        item["discount_percent"] = disc
    item["vat_rate"] = vat

    excl_raw = item.get("unit_price")
    incl_raw = item.get("unit_price_incl")
    has_incl = incl_raw not in (None, "")
    mode = (price_mode or "excl").lower()

    if mode == "incl" and not has_incl:
        gross = _f(excl_raw)
        net = unit_excl_from_incl(gross, vat)
    else:
        net = _f(excl_raw)
        if net == 0.0 and has_incl:
            net = unit_excl_from_incl(_f(incl_raw), vat)

    gross_unit = unit_incl_from_excl(net, vat)
    factor = 1 - disc / 100.0
    total_excl = round(qty * net * factor, 2)
    vat_amount = round(total_excl * vat / 100.0, 2)
    total_incl = round(total_excl + vat_amount, 2)

    item["quantity"] = qty
    item["unit_price"] = round(net, 4)
    item["unit_price_incl"] = round(gross_unit, 4)
    item["total"] = total_excl
    item["total_incl"] = total_incl
    item["vat_amount"] = vat_amount
    if not item.get("name") and item.get("product_name"):
        item["name"] = item.get("product_name")
    if not item.get("product_name") and item.get("name"):
        item["product_name"] = item.get("name")
    return item


def enrich_items(
    items: Iterable[MutableMapping[str, Any]],
    price_mode: str = "excl",
    default_vat: float = 0.0,
) -> List[MutableMapping[str, Any]]:
    out = []
    for it in items:
        drop_stale_inclusive_markup(it)
        mode = quote_line_price_mode(it, price_mode)
        out.append(enrich_line(it, price_mode=mode, default_vat=default_vat))
    return out


def invoice_document_totals(
    items: Iterable[Mapping[str, Any]],
    general_discount_rate: Any = 0,
    general_discount_amount: Any = 0,
    withholding_rate: Any = 0,
) -> Dict[str, float]:
    rows = list(items)
    items_sum = sum(_f(i.get("total")) for i in rows)
    gd_rate = _f(general_discount_rate)
    gd_amt = _f(general_discount_amount)
    gd = gd_amt if gd_amt else items_sum * gd_rate / 100.0
    gd = round(min(max(gd, 0.0), items_sum), 2)
    factor = (items_sum - gd) / items_sum if items_sum else 1.0
    subtotal = round(items_sum - gd, 2)
    vat_total = round(sum(_f(i.get("total")) * factor * _f(i.get("vat_rate")) / 100.0 for i in rows), 2)
    withholding = round(vat_total * _f(withholding_rate), 2)
    grand = round(subtotal + vat_total - withholding, 2)
    line_discount = round(
        sum(_f(i.get("quantity")) * _f(i.get("unit_price")) * _f(i.get("discount_rate")) / 100.0 for i in rows),
        2,
    )
    return {
        "discount_total": gd,
        "general_discount_amount": gd,
        "subtotal": subtotal,
        "vat_total": vat_total,
        "withholding_amount": withholding,
        "grand_total": grand,
        "line_discount_total": line_discount,
    }


def order_document_totals(items: Iterable[Mapping[str, Any]]) -> Tuple[float, float, float, float]:
    rows = list(items)
    subtotal = round(sum(_f(i.get("total")) for i in rows), 2)
    vat_total = round(sum(_f(i.get("vat_amount")) for i in rows), 2)
    discount_total = round(
        sum(_f(i.get("quantity")) * _f(i.get("unit_price")) * _f(i.get("discount_rate")) / 100.0 for i in rows),
        2,
    )
    grand = round(subtotal + vat_total, 2)
    return subtotal, vat_total, discount_total, grand


def pick_fields(item: Mapping[str, Any], fields: Iterable[str]) -> Dict[str, Any]:
    return {k: item[k] for k in fields if k in item}


INVOICE_ITEM_FIELDS = (
    "product_id", "name", "quantity", "unit", "unit_price", "unit_price_incl",
    "vat_rate", "discount_percent", "discount_rate", "total", "total_incl",
    "vat_amount", "is_service", "sku", "barcode", "gtip", "origin_country",
    "net_weight", "landed_unit_try", "note",
)

ORDER_ITEM_FIELDS = (
    "product_id", "product_name", "sku", "barcode", "quantity", "unit",
    "unit_price", "unit_price_incl", "vat_rate", "discount_rate", "total",
    "total_incl", "vat_amount", "is_service", "note", "price_includes_vat",
)


def order_items_to_invoice_items(items: Iterable[Mapping[str, Any]]) -> List[Dict[str, Any]]:
    """Copy order lines onto invoice lines, preserving VAT, discount and dual prices.

    Canonical stored unit_price is always KDV hariç. Legacy B2B lines with
    price_includes_vat and no unit_price_incl are treated as gross.
    Missing vat_rate falls back to 20% (invoice default), not a hardcoded overwrite
    of an explicit 0 / 1 / 10.
    """
    out: List[Dict[str, Any]] = []
    for itm in items or []:
        d = dict(itm)
        d["name"] = d.get("name") or d.get("product_name") or "Kalem"
        d["product_name"] = d.get("product_name") or d.get("name")
        d.setdefault("unit", "Adet")
        includes = bool(d.get("price_includes_vat"))
        has_incl = d.get("unit_price_incl") not in (None, "")
        mode = "incl" if includes and not has_incl else "excl"
        enrich_line(d, price_mode=mode, default_vat=20.0)
        d["discount_percent"] = d.get("discount_rate") or 0
        row = pick_fields(d, INVOICE_ITEM_FIELDS)
        if "name" not in row:
            row["name"] = d["name"]
        out.append(row)
    return out
