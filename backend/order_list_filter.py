"""Sipariş listesi filtreleri (saf).

Paneldeki arama, durum, kanal, belge, fatura, kargo ve tarih seçimleri
burada AND ile uygulanır. Tarih aralığı Europe/Istanbul takvim günüdür
(başlangıç 00:00, bitiş ertesi gün 00:00 hariç — 23:59:59 dahil).

Saat dilimi olmayan ISO zamanlar UTC anı kabul edilir; böylece
21:30Z ertesi İstanbul gününe düşer. Yalnızca YYYY-MM-DD değerleri
İstanbul günü 00:00 olarak okunur.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, time, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence
from zoneinfo import ZoneInfo

IST = ZoneInfo("Europe/Istanbul")

ORDER_LIST_SCAN_CAP = 20000
ORDER_LIST_PAGE_MAX = 1000
ORDER_LIST_EXPORT_MAX = 5000

CLOSED_STATUSES = frozenset({"cancelled", "returned", "partially_returned", "canceled"})
INCOMING_STATUSES = frozenset({"pending", "new", "approved", "held_cart", "active_cart"})
DISPATCHED_STATUSES = frozenset({"shipped", "delivered", "completed"})
DOC_STATUS_ALL = ("draft", "dispatched", "invoiced", "cancelled")

_TR_FOLD = str.maketrans({
    "ş": "s", "Ş": "s",
    "ı": "i", "İ": "i", "I": "i",
    "ğ": "g", "Ğ": "g",
    "ü": "u", "Ü": "u",
    "ö": "o", "Ö": "o",
    "ç": "c", "Ç": "c",
})
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_GIB_OK = re.compile(r"ziplen|zarflan|ileti|gönderildi|1300|başarıyla tamamland", re.IGNORECASE)
_GIB_ERR = re.compile(r"^\s*hata\s*:", re.IGNORECASE)


def fold_tr(value: Any) -> str:
    """Türkçe karakterleri katlar (ş=s, ı=i, ğ=g, ü=u, ö=o, ç=c) ve küçük harfe çevirir."""
    return str(value or "").translate(_TR_FOLD).casefold()


def is_active_cart(order: Optional[dict]) -> bool:
    if not order:
        return False
    return (
        order.get("order_status") == "active_cart"
        or order.get("is_active_cart") is True
        or order.get("source") == "b2b_active_cart"
    )


def is_incoming_order(order: Optional[dict]) -> bool:
    if not order:
        return False
    return order.get("order_status") in INCOMING_STATUSES and not order.get("cargo_tracking_number")


def is_dispatched_order(order: Optional[dict]) -> bool:
    if not order:
        return False
    if order.get("order_status") in DISPATCHED_STATUSES:
        return True
    return bool(order.get("cargo_tracking_number")) and order.get("order_status") not in CLOSED_STATUSES


def order_has_einvoice(order: Optional[dict]) -> bool:
    if not order:
        return False
    state = str(order.get("einvoice_state") or "").lower()
    if state in ("sent", "queued", "accepted"):
        return True
    if order.get("invoice_gib_uuid") or order.get("gib_uuid") or order.get("invoice_gib_tracking_id") or order.get("gib_tracking_id"):
        return True
    if order.get("gib_invoice_id"):
        return True
    gs = str(order.get("invoice_gib_status") or order.get("gib_status") or "")
    if _GIB_OK.search(gs) and not _GIB_ERR.search(gs):
        return True
    return False


def order_doc_status(order: Optional[dict]) -> str:
    st = str((order or {}).get("order_status") or "").lower()
    if st in ("cancelled", "canceled"):
        return "cancelled"
    if (order or {}).get("is_invoiced"):
        return "invoiced"
    if (order or {}).get("dispatch_number") or (order or {}).get("dispatch_id") or (order or {}).get("e_type") == "e_dispatch":
        return "dispatched"
    return "draft"


def doc_status_filter_active(selected: Optional[Sequence[str]]) -> bool:
    if not selected:
        return False
    picked = list(selected)
    if len(picked) >= len(DOC_STATUS_ALL) and all(k in picked for k in DOC_STATUS_ALL):
        return False
    return True


def order_display_amount(order: Optional[dict]) -> float:
    """Satırda görünen tutar: grand_total varsa o, yoksa total_amount."""
    if not order:
        return 0.0
    raw = order.get("grand_total")
    if raw in (None, ""):
        raw = order.get("total_amount")
    try:
        return float(raw or 0)
    except (TypeError, ValueError):
        return 0.0


def order_search_blob(order: Optional[dict]) -> str:
    if not order:
        return ""
    parts: List[str] = [
        str(order.get("order_number") or ""),
        str(order.get("customer_name") or ""),
        str(order.get("customer_phone") or ""),
        str(order.get("cargo_tracking_number") or ""),
        str(order.get("marketplace_order_id") or ""),
    ]
    for item in order.get("items") or []:
        if not isinstance(item, dict):
            continue
        parts.append(str(item.get("product_name") or ""))
        parts.append(str(item.get("sku") or ""))
        parts.append(str(item.get("product_sku") or ""))
        parts.append(str(item.get("barcode") or ""))
        parts.append(str(item.get("note") or ""))
    return fold_tr(" ".join(p for p in parts if p))


def parse_order_instant(value: Any) -> Optional[datetime]:
    """Sipariş anını Europe/Istanbul'a çevirir."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        text = str(value).strip()
        if not text:
            return None
        if _DATE_RE.match(text[:10]) and len(text) == 10:
            day = datetime.strptime(text, "%Y-%m-%d").date()
            return datetime.combine(day, time.min, tzinfo=IST)
        try:
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(IST)


def istanbul_day_start(ymd: str) -> Optional[datetime]:
    text = str(ymd or "")[:10]
    if not _DATE_RE.match(text):
        return None
    day = datetime.strptime(text, "%Y-%m-%d").date()
    return datetime.combine(day, time.min, tzinfo=IST)


def istanbul_day_end_exclusive(ymd: str) -> Optional[datetime]:
    start = istanbul_day_start(ymd)
    if start is None:
        return None
    return start + timedelta(days=1)


def in_istanbul_range(order: dict, date_from: str, date_to: str) -> bool:
    start = istanbul_day_start(date_from) if date_from else None
    end = istanbul_day_end_exclusive(date_to) if date_to else None
    if start is None and end is None:
        return True
    instant = parse_order_instant(order.get("order_date") or order.get("created_at"))
    if instant is None:
        return False
    if start is not None and instant < start:
        return False
    if end is not None and instant >= end:
        return False
    return True


def parse_doc_status(raw: Optional[str]) -> Optional[List[str]]:
    if raw is None:
        return None
    text = str(raw).strip()
    if not text:
        return None
    parts: List[str] = []
    for piece in text.split(","):
        key = piece.strip()
        if key in DOC_STATUS_ALL and key not in parts:
            parts.append(key)
    if not doc_status_filter_active(parts):
        return None
    return parts


@dataclass
class OrderListFilter:
    q: str = ""
    status: str = "all"
    channel: str = "all"
    invoiced: str = "all"
    cargo: str = "all"
    doc_status: Optional[Sequence[str]] = None
    date_from: str = ""
    date_to: str = ""
    customer: str = ""
    sort: str = "date_desc"
    scope: str = ""


def order_matches(order: dict, filt: OrderListFilter) -> bool:
    if not order:
        return False
    if filt.scope == "cancellations":
        return (order.get("order_status") or "") in ("cancelled", "returned") and not is_active_cart(order)

    needle = fold_tr(filt.q).strip()
    if needle and needle not in order_search_blob(order):
        return False

    status = filt.status or "all"
    if status in ("all", "incoming") and (order.get("order_status") or "") in CLOSED_STATUSES:
        return False
    if status == "incoming" and not is_incoming_order(order):
        return False
    if status == "dispatched" and not is_dispatched_order(order):
        return False
    if status not in ("all", "incoming", "dispatched"):
        if status == "active_cart":
            if not is_active_cart(order):
                return False
        elif (order.get("order_status") or "") != status:
            return False

    if filt.channel and filt.channel != "all" and (order.get("channel") or "b2b") != filt.channel:
        return False

    invoiced = filt.invoiced or "all"
    if invoiced == "yes" and not order.get("invoice_id"):
        return False
    if invoiced == "einvoice" and not order_has_einvoice(order):
        return False
    if invoiced == "no" and order.get("invoice_id"):
        return False

    cargo = filt.cargo or "all"
    if cargo == "yes" and not order.get("cargo_tracking_number"):
        return False
    if cargo == "no" and order.get("cargo_tracking_number"):
        return False

    if doc_status_filter_active(filt.doc_status) and order_doc_status(order) not in set(filt.doc_status or []):
        return False

    if filt.customer and (order.get("customer_name") or "") != filt.customer:
        return False

    if not in_istanbul_range(order, filt.date_from, filt.date_to):
        return False
    return True


def apply_order_list(orders: Iterable[dict], filt: OrderListFilter) -> List[dict]:
    return [o for o in (orders or []) if order_matches(o, filt)]


def sort_orders(orders: Sequence[dict], sort_key: str) -> List[dict]:
    key = sort_key or "date_desc"
    reverse = key in {
        "date_desc", "amount_desc", "number", "status_desc", "items_desc", "customer_desc",
    }

    def date_key(order: dict) -> str:
        return str(order.get("order_date") or order.get("created_at") or "")

    def sk(order: dict):
        if key in ("date_desc", "date_asc"):
            return date_key(order)
        if key in ("amount_desc", "amount_asc"):
            return order_display_amount(order)
        if key in ("customer", "customer_desc"):
            return fold_tr(order.get("customer_name"))
        if key in ("number", "number_asc"):
            return str(order.get("order_number") or "")
        if key in ("status_asc", "status_desc"):
            return str(order.get("order_status") or "")
        if key in ("items_asc", "items_desc"):
            return len(order.get("items") or [])
        return date_key(order)

    tied = sorted(list(orders), key=lambda o: str(o.get("id") or o.get("_id") or o.get("order_number") or ""))
    return sorted(tied, key=sk, reverse=reverse)


def paginate_orders(orders: Sequence[dict], page: int, page_size: int) -> Dict[str, Any]:
    size = max(1, int(page_size or 50))
    page_n = max(1, int(page or 1))
    total = len(orders)
    start = (page_n - 1) * size
    items = [] if start >= total else list(orders[start:start + size])
    return {
        "items": items,
        "total": total,
        "page": page_n,
        "page_size": size,
        "has_more": start + size < total,
        "total_amount": round(sum(order_display_amount(o) for o in orders), 2),
    }


def panel_summary(orders: Iterable[dict]) -> Dict[str, Any]:
    """Aktif sepet hariç şirket özeti. Filtre seçiminden bağımsız sayaçlar."""
    counts: Dict[str, int] = {}
    channels = set()
    open_count = 0
    closed_count = 0
    missing_contact = 0
    for order in orders or []:
        if is_active_cart(order):
            counts["active_cart"] = counts.get("active_cart", 0) + 1
            continue
        status = str(order.get("order_status") or "")
        counts[status] = counts.get(status, 0) + 1
        channels.add(order.get("channel") or "b2b")
        if status in ("cancelled", "returned"):
            closed_count += 1
        if status not in CLOSED_STATUSES:
            open_count += 1
        if not order.get("contact_id"):
            missing_contact += 1
        if is_incoming_order(order):
            counts["incoming"] = counts.get("incoming", 0) + 1
        if is_dispatched_order(order):
            counts["dispatched"] = counts.get("dispatched", 0) + 1
    return {
        "counts": counts,
        "channels": sorted(channels),
        "open_count": open_count,
        "closed_count": closed_count,
        "missing_contact": missing_contact,
    }


def query_orders(
    orders: Iterable[dict],
    filt: OrderListFilter,
    *,
    page: int = 1,
    page_size: int = 50,
    include_active_cart: bool = False,
) -> Dict[str, Any]:
    rows = list(orders or [])
    summary = panel_summary(rows)
    if filt.scope == "cancellations":
        matched = apply_order_list(rows, filt)
    else:
        keep_carts = include_active_cart or (filt.status or "all") == "active_cart"
        pool = rows if keep_carts else [o for o in rows if not is_active_cart(o)]
        matched = apply_order_list(pool, filt)
    matched = sort_orders(matched, filt.sort)
    out = paginate_orders(matched, page, page_size)
    out.update(summary)
    return out
