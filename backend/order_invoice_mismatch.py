"""Sipariş ile bağlı fatura tutarı arasındaki fark ve senkron kararları.

Liste ve detay, sipariş grand_total bağlı faturanınkinden 1 kuruştan fazla
ayrıldığında aynı uyarı metnini gösterir. Senkron kararı stok, cari veya
toplama satırına dokunmaz; yalnız belge alanlarının yazılıp yazılmayacağını söyler.
"""
from __future__ import annotations

from typing import Any, Iterable, Mapping, MutableMapping, Optional, Sequence, Tuple

SYNC_CHANNELS = frozenset({"b2b", "manual", "saha"})
CLOSED_ORDER_STATUSES = frozenset({"cancelled", "returned", "partially_returned"})
SHIPPED_ORDER_STATUSES = frozenset({"shipped", "in_transit", "delivered", "completed"})
PICK_OPEN_STATUSES = frozenset({"open", "picking", "partial", "ready"})
PICK_CLOSED_STATUSES = frozenset({"shipped", "delivered"})

_CLOSED_ALIASES = frozenset({"iade edildi", "iade", "iptal", "iptal edildi", "kısmi iade"})


def format_tl(amount: Any) -> str:
    """1.250,50 biçimi. Uyarı metnindeki fatura tutarı."""
    try:
        n = round(float(amount or 0), 2)
    except (TypeError, ValueError):
        n = 0.0
    sign = "-" if n < 0 else ""
    whole, frac = f"{abs(n):.2f}".split(".")
    groups = []
    while whole:
        groups.append(whole[-3:])
        whole = whole[:-3]
    return f"{sign}{'.'.join(reversed(groups))},{frac}"


def mismatch_warning_text(invoice_grand: Any) -> str:
    return f"Fatura siparişten farklı (Fatura: {format_tl(invoice_grand)} TL)"


def _cents(value: Any) -> int:
    try:
        n = round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0
    return int(round(n * 100))


def totals_differ(order_grand: Any, invoice_grand: Any) -> bool:
    """0,01 TL (1 kuruş) ve altı fark uyarı değildir."""
    return abs(_cents(order_grand) - _cents(invoice_grand)) > 1


def attach_invoice_mismatch_warnings(
    docs: Optional[Sequence[MutableMapping[str, Any]]],
    invoices_by_id: Optional[Mapping[str, Mapping[str, Any]]],
) -> list:
    """Bağlı fatura toplamı siparişten ayrılıyorsa uyarı alanını yazar.

    Başka firmanın faturası eşleşmez; tutar sızdırılmaz.
    """
    rows = list(docs or [])
    by_id = invoices_by_id or {}
    for order in rows:
        if not isinstance(order, MutableMapping):
            continue
        inv_id = order.get("invoice_id")
        inv = by_id.get(inv_id) if inv_id else None
        warning = _warning_for(order, inv)
        if warning:
            order["invoice_mismatch_warning"] = warning
            order["invoice_grand_total"] = _money(inv.get("grand_total"))
        else:
            order.pop("invoice_mismatch_warning", None)
    return rows


def _warning_for(order: Mapping[str, Any], inv: Optional[Mapping[str, Any]]) -> str:
    if not order or not inv or not order.get("invoice_id"):
        return ""
    oc = str(order.get("company_id") or "")
    ic = str(inv.get("company_id") or "")
    if oc and ic and oc != ic:
        return ""
    inv_grand = inv.get("grand_total")
    if not totals_differ(order.get("grand_total"), inv_grand):
        return ""
    return mismatch_warning_text(inv_grand)


def _money(value: Any) -> float:
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0.0


FULFILLMENT_LINE_WARNING = (
    "Ürün veya miktar değişikliği toplama açık ya da sevk edilmiş siparişe uygulanmadı."
)
CLOSED_INVOICE_LINE_WARNING = (
    "İptal, iade veya reddedilmiş faturaya ticari değişiklik uygulanmadı."
)

_CLOSED_INVOICE_STATUSES = frozenset({
    "cancelled",
    "canceled",
    "void",
    "rejected",
    "refused",
    "returned",
    "partially_returned",
    "iptal",
    "iptal edildi",
    "reddedildi",
    "reddedilmis",
    "iade",
    "iade edildi",
})


def _fold_status(value: Any) -> str:
    return str(value or "").strip().lower().replace("ı", "i").replace("i̇", "i")


def invoice_closed_for_commercial_sync(invoice: Optional[Mapping[str, Any]]) -> bool:
    """İptal, iade veya ret. GİB kilidi olmasa da kalem ve cari/stok etkisi yazılmaz."""
    if not invoice:
        return False
    from invoice_status import is_cancelled_invoice

    if is_cancelled_invoice(invoice):
        return True
    if _fold_status(invoice.get("status")) in _CLOSED_INVOICE_STATUSES:
        return True
    if invoice.get("returned") is True:
        return True
    response = _fold_status(invoice.get("gib_response"))
    return response in ("rejected", "refused", "reddedildi", "reddedilmis")


def _disc_rate(it: Mapping[str, Any]) -> float:
    disc = it.get("discount_rate")
    if disc in (None, ""):
        disc = it.get("discount_percent") or 0
    return _money(disc)


def _line_identity(it: Mapping[str, Any]) -> Tuple:
    return (
        str(it.get("product_id") or ""),
        str(it.get("product_name") or it.get("name") or "").strip(),
        round(_money(it.get("quantity")), 4),
    )


def _line_price(it: Mapping[str, Any]) -> Tuple:
    return (
        round(_money(it.get("unit_price")), 4),
        round(_disc_rate(it), 4),
        round(_money(it.get("vat_rate")), 4),
    )


def order_items_identity_signature(items: Optional[Iterable[Mapping[str, Any]]]) -> Tuple:
    """Ürün ve miktar. Toplama/sevk kilidini bozan fark."""
    rows = []
    for it in items or []:
        if isinstance(it, Mapping):
            rows.append(_line_identity(it))
    return tuple(rows)


def order_items_price_signature(items: Optional[Iterable[Mapping[str, Any]]]) -> Tuple:
    """Fiyat, iskonto ve KDV. Ürün ile miktar bu imzada yoktur."""
    rows = []
    for it in items or []:
        if isinstance(it, Mapping):
            rows.append(_line_price(it))
    return tuple(rows)


def commercial_change_only(
    before: Optional[Iterable[Mapping[str, Any]]],
    after: Optional[Iterable[Mapping[str, Any]]],
) -> bool:
    """Ürün ve miktar aynı, fiyat/iskonto/KDV farklı."""
    return (
        order_items_identity_signature(before) == order_items_identity_signature(after)
        and order_items_price_signature(before) != order_items_price_signature(after)
    )


def order_items_signature(items: Optional[Iterable[Mapping[str, Any]]]) -> Tuple:
    """Toplama satırını bozacak kalem farkı: ürün, ad, miktar, fiyat, iskonto, KDV."""
    rows = []
    for it in items or []:
        if not isinstance(it, Mapping):
            continue
        rows.append(_line_identity(it) + _line_price(it))
    return tuple(rows)


def order_channel_syncable(order: Optional[Mapping[str, Any]]) -> bool:
    ch = str((order or {}).get("channel") or "").strip().lower()
    if not ch:
        ch = "manual"
    return ch in SYNC_CHANNELS


def order_is_shipped_for_sync(order: Optional[Mapping[str, Any]]) -> bool:
    o = order or {}
    status = str(o.get("order_status") or "").strip().lower()
    if status in SHIPPED_ORDER_STATUSES:
        return True
    if str(o.get("cargo_tracking_number") or "").strip():
        return True
    if o.get("warehouse_shipped"):
        return True
    return str(o.get("pick_status") or "").strip().lower() == "shipped"


def pick_status_is_open(order: Optional[Mapping[str, Any]]) -> bool:
    return str((order or {}).get("pick_status") or "").strip().lower() in PICK_OPEN_STATUSES


def order_sync_skip_reason(
    order: Optional[Mapping[str, Any]],
    invoice: Optional[Mapping[str, Any]],
    *,
    items_changed: bool,
    pick_open: bool,
    price_only: bool = False,
) -> Optional[str]:
    """None ise sipariş belgesi güncellenebilir. Stok/cari/rezervasyon burada yoktur.

    price_only: ürün ve miktar aynı, yalnız fiyat/iskonto/KDV değişti. Toplama
    açık veya sevk edilmiş siparişe de yazılır. Ürün/miktar değişimi eskisi gibi
    fulfillment ile atlanır.
    """
    if not order or not invoice:
        return "missing"
    ic = str(invoice.get("company_id") or "")
    oc = str(order.get("company_id") or "")
    if not ic or not oc or ic != oc:
        return "company"
    linked = str(order.get("invoice_id") or "")
    inv_ids = {str(invoice.get("_id") or ""), str(invoice.get("id") or "")}
    inv_ids.discard("")
    if linked and inv_ids and linked not in inv_ids:
        return "other_invoice"
    status = str(order.get("order_status") or "").strip().lower()
    if status in CLOSED_ORDER_STATUSES or status in _CLOSED_ALIASES:
        return "closed"
    if not order_channel_syncable(order):
        return "marketplace"
    if items_changed and not price_only and (order_is_shipped_for_sync(order) or pick_open):
        return "fulfillment"
    return None
