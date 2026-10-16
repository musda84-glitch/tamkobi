"""Sipariş listesi sayfası. Salt okunur; sipariş, stok ve faturaya yazmaz.

``GET /orders`` page ve page_size yokken eskisi gibi bir dizi döner
(``paged=1`` paneli de eski gövdedir). İkisi verilip ``paged`` yoksa yanıt
``{items, total, page, page_size, has_more, truncated, summary}`` olur.

Arama, durum, kanal, belge, fatura, kargo, tarih, cari ve sıralama dilimden
önce uygulanır. Eşitlikte ikincil anahtar id'dir (panel ``sort_orders``).
``summary.total_amount`` ve ``summary.count`` sayfa diliminin değil,
filtrelenmiş kümenin tamamının toplamıdır. Sekme sayaçları
(``pool_*``) aktif sepet hariç taranan kümedendir; onlar da sayfa dilimi değildir.
"""
from __future__ import annotations

from typing import Any, Callable, Dict, List, Optional, Sequence

from order_dedupe import dedupe_orders_by_marketplace_key
from order_list_filter import (
    ORDER_LIST_SCAN_CAP,
    OrderListFilter,
    apply_order_list,
    is_active_cart,
    needs_invoice_ebelge_filter,
    order_date_sql_range,
    order_display_amount,
    panel_summary,
    parse_doc_status,
    sort_orders,
)

PAGE_SIZE_DEFAULT = 50
PAGE_SIZE_MAX = 200
FETCH_CAP = ORDER_LIST_SCAN_CAP


def clamp_page(page: Any) -> int:
    try:
        n = int(page)
    except (TypeError, ValueError):
        return 1
    return n if n >= 1 else 1


def clamp_page_size(page_size: Any) -> int:
    if page_size is None or page_size == "":
        return PAGE_SIZE_DEFAULT
    try:
        n = int(page_size)
    except (TypeError, ValueError):
        return PAGE_SIZE_DEFAULT
    if n < 1:
        return PAGE_SIZE_DEFAULT
    return n if n <= PAGE_SIZE_MAX else PAGE_SIZE_MAX


def order_row_id(order: dict) -> str:
    return str((order or {}).get("id") or (order or {}).get("_id") or "")


def decorate_held_order(order: dict) -> dict:
    """Panel ``_decorate_b2b_held_order`` ile aynı işaretler. Yazmaz."""
    if not order:
        return order
    if order.get("order_status") == "active_cart" or order.get("is_active_cart") or order.get("source") == "b2b_active_cart":
        order["is_active_cart"] = True
        order["is_held_cart"] = False
        order["view_only"] = True
        order["held_label"] = order.get("held_label") or "Aktif sepet"
        order["order_status"] = "active_cart"
        return order
    if order.get("order_status") == "held_cart" or order.get("is_held_cart") or order.get("source") == "b2b_held_cart":
        seq = int(order.get("held_seq") or 1)
        order["is_held_cart"] = True
        order["is_active_cart"] = False
        order["view_only"] = True
        order["held_seq"] = seq
        order["held_label"] = order.get("held_label") or f"Bekleyen sepet #{seq}"
        order["order_status"] = "held_cart"
    return order


def public_docs(docs: Sequence[dict]) -> List[dict]:
    out = []
    for doc in docs or []:
        if not isinstance(doc, dict):
            continue
        row = dict(doc)
        if "_id" in row:
            row["id"] = str(row.pop("_id"))
        elif row.get("id") is not None:
            row["id"] = str(row["id"])
        for secret in ("b2b_password_hash", "password_hash", "shopfloor_pin_hash", "cashier_pin_hash", "punch_pin_hash"):
            row.pop(secret, None)
        out.append(row)
    return out


def build_filter(
    *,
    q: str = "",
    status: str = "all",
    channel: str = "all",
    invoiced: str = "all",
    cargo: str = "all",
    doc_status: Any = None,
    date_from: str = "",
    date_to: str = "",
    customer: str = "",
    sort: str = "date_desc",
    scope: str = "",
    cancel_request: str = "all",
) -> OrderListFilter:
    parsed = doc_status if isinstance(doc_status, (list, tuple)) else parse_doc_status(doc_status)
    return OrderListFilter(
        q=q or "",
        status=status or "all",
        channel=channel or "all",
        invoiced=invoiced or "all",
        cargo=cargo or "all",
        doc_status=parsed,
        date_from=date_from or "",
        date_to=date_to or "",
        customer=customer or "",
        sort=sort or "date_desc",
        scope=scope or "",
        cancel_request=(cancel_request or "all").strip().lower() or "all",
    )


def select_orders(docs: Sequence[dict], filt: OrderListFilter, *, include_active_cart: bool = False) -> List[dict]:
    """Filtre, sonra sıralama. Sıra: birincil anahtar, eşitlikte id (artan, kararlı)."""
    rows = list(docs or [])
    if (filt.scope or "") == "cancellations":
        matched = apply_order_list(rows, filt)
    else:
        keep_carts = include_active_cart or (filt.status or "all") == "active_cart"
        pool = rows if keep_carts else [row for row in rows if not is_active_cart(row)]
        matched = apply_order_list(pool, filt)
    return sort_orders(matched, filt.sort or "date_desc")


def summarize_filtered(rows: Sequence[dict]) -> dict:
    """Para ve sayaç filtrelenmiş kümenin tamamıdır."""
    ordered = list(rows or [])
    counts = panel_summary(ordered)
    return {
        "count": len(ordered),
        "total_amount": round(sum(order_display_amount(row) for row in ordered), 2),
        "open_count": counts["open_count"],
        "closed_count": counts["closed_count"],
        "missing_contact": counts["missing_contact"],
        "counts": counts["counts"],
        "channels": counts["channels"],
    }


def _pool_rows(docs: Sequence[dict], *, include_active_cart: bool) -> List[dict]:
    rows = list(docs or [])
    if include_active_cart:
        return rows
    return [row for row in rows if not is_active_cart(row)]


def _attach_pool(summary: dict, pool: Sequence[dict]) -> dict:
    """Sekme rozetleri: sayfa dilimi değil, aktif sepet hariç taranan küme."""
    base = panel_summary(pool)
    out = dict(summary or {})
    out["pool_open_count"] = base["open_count"]
    out["pool_closed_count"] = base["closed_count"]
    out["pool_missing_contact"] = base["missing_contact"]
    out["pool_counts"] = base["counts"]
    out["pool_channels"] = base["channels"]
    return out


def _clean(docs: Sequence[dict], clean: Optional[Callable]) -> List[dict]:
    fn = clean or public_docs
    return [dict(row) for row in fn(list(docs or [])) if isinstance(row, dict)]


def _company_query(company_id: str, *, date_from: str = "", date_to: str = "") -> dict:
    query: Dict[str, Any] = {"company_id": str(company_id or "")}
    date_range = order_date_sql_range(date_from or "", date_to or "")
    if date_range:
        query["order_date"] = date_range
    return query


async def fetch_order_rows(db, company_id: str, *, date_from: str = "", date_to: str = "") -> tuple:
    """Şirket siparişleri. Üst sınır aşılırsa truncated. Yazmaz."""
    cid = str(company_id or "")
    query = _company_query(cid, date_from=date_from, date_to=date_to)
    cursor = db.orders.find(query)
    cursor = cursor.sort([("order_date", -1), ("_id", -1)])
    fetched = await cursor.to_list(FETCH_CAP + 1)
    truncated = len(fetched or []) > FETCH_CAP
    rows = []
    for row in (fetched or [])[:FETCH_CAP]:
        if isinstance(row, dict) and str(row.get("company_id") or "") == cid:
            rows.append(row)
    return rows, truncated


async def load_order_docs(
    db,
    company_id: str,
    *,
    date_from: str = "",
    date_to: str = "",
    clean: Optional[Callable] = None,
    prepare: Optional[Callable] = None,
    invoiced: str = "all",
    doc_status: Any = None,
) -> tuple:
    rows, truncated = await fetch_order_rows(db, company_id, date_from=date_from, date_to=date_to)
    docs = _clean(rows, clean)
    docs = [dict(row) for row in dedupe_orders_by_marketplace_key(docs)]
    for row in docs:
        decorate_held_order(row)
    parsed = doc_status if isinstance(doc_status, (list, tuple)) else parse_doc_status(doc_status)
    if prepare is not None and needs_invoice_ebelge_filter(invoiced or "all", parsed):
        prepared = await prepare(docs)
        docs = [dict(row) for row in (prepared or []) if isinstance(row, dict)]
    return docs, truncated


def _view(docs: Sequence[dict], filt: OrderListFilter, *, include_active_cart: bool) -> dict:
    pool = _pool_rows(docs, include_active_cart=include_active_cart or (filt.status or "all") == "active_cart")
    ordered = select_orders(docs, filt, include_active_cart=include_active_cart)
    summary = _attach_pool(summarize_filtered(ordered), pool)
    return {"rows": ordered, "summary": summary}


async def list_orders_unpaged(
    db,
    company_id: str,
    *,
    include_active_cart: bool = False,
    q: str = "",
    status: str = "all",
    channel: str = "all",
    invoiced: str = "all",
    cargo: str = "all",
    doc_status: Any = None,
    date_from: str = "",
    date_to: str = "",
    customer: str = "",
    sort: str = "date_desc",
    scope: str = "",
    cancel_request: str = "all",
    clean: Optional[Callable] = None,
    prepare: Optional[Callable] = None,
) -> List[dict]:
    """Aynı filtre ve sıra ile sayfasız küme. Yazmaz."""
    docs, _truncated = await load_order_docs(
        db,
        company_id,
        date_from=date_from,
        date_to=date_to,
        clean=clean,
        prepare=prepare,
        invoiced=invoiced,
        doc_status=doc_status,
    )
    filt = build_filter(
        q=q, status=status, channel=channel, invoiced=invoiced, cargo=cargo,
        doc_status=doc_status, date_from=date_from, date_to=date_to, customer=customer,
        sort=sort, scope=scope, cancel_request=cancel_request,
    )
    return _view(docs, filt, include_active_cart=include_active_cart)["rows"]


async def list_orders_paged(
    db,
    company_id: str,
    *,
    page: Any = 1,
    page_size: Any = None,
    include_active_cart: bool = False,
    q: str = "",
    status: str = "all",
    channel: str = "all",
    invoiced: str = "all",
    cargo: str = "all",
    doc_status: Any = None,
    date_from: str = "",
    date_to: str = "",
    customer: str = "",
    sort: str = "date_desc",
    scope: str = "",
    cancel_request: str = "all",
    export: bool = False,
    clean: Optional[Callable] = None,
    prepare: Optional[Callable] = None,
    decorate_page: Optional[Callable] = None,
) -> dict:
    """Sayfa döner. orders / invoices / stok yazılmaz."""
    exporting = bool(export)
    if exporting:
        size = FETCH_CAP
        page_n = 1
    else:
        size = clamp_page_size(page_size)
        page_n = clamp_page(page)
    docs, truncated = await load_order_docs(
        db,
        company_id,
        date_from=date_from,
        date_to=date_to,
        clean=clean,
        prepare=prepare,
        invoiced=invoiced,
        doc_status=doc_status,
    )
    filt = build_filter(
        q=q, status=status, channel=channel, invoiced=invoiced, cargo=cargo,
        doc_status=doc_status, date_from=date_from, date_to=date_to, customer=customer,
        sort=sort, scope=scope, cancel_request=cancel_request,
    )
    view = _view(docs, filt, include_active_cart=include_active_cart)
    ordered = view["rows"]
    total = len(ordered)
    start = (page_n - 1) * size
    page_rows = ordered[start:start + size]
    if decorate_page is not None and page_rows:
        skip = needs_invoice_ebelge_filter(filt.invoiced, filt.doc_status)
        decorated = await decorate_page(page_rows, company_id=str(company_id or ""), skip_ebelge=skip)
        page_rows = [row for row in (decorated or []) if isinstance(row, dict)]
    return {
        "items": page_rows,
        "total": total,
        "page": page_n,
        "page_size": size,
        "has_more": start + len(page_rows) < total,
        "truncated": bool(truncated),
        "summary": view["summary"],
    }


async def list_orders_for_user(db, user: dict, company_id: Optional[str] = None, *, paged: bool = False, **kwargs) -> Any:
    """company_id kullanıcının erişimindeki şirketle çözülür; başka şirket 403."""
    import tenant_access

    cid = tenant_access.resolve_company_id(user, company_id)
    if paged:
        return await list_orders_paged(db, cid, **kwargs)
    return await list_orders_unpaged(db, cid, **kwargs)
