"""Fatura listesi sayfası. Salt okunur; stok, durum ve e-belge yazmaz.

``GET /invoices`` ve ``/sync`` aynı kalır. Bu modül ``GET /api/invoices/page``
içindir. Sekme, arama, ödeme, belge türü, tarih, tutar ve sıralama dilimden
önce tüm firma kümesine uygulanır. Eşitlikte ikincil anahtar id'dir.

``summary`` sayfa diliminin değil, filtrelenmiş kümenin tamamıdır.
Yanıttaki satırlarda kalem (``items``) yoktur; kalemler ``GET /invoices/{id}``
ile açılır.
"""
from __future__ import annotations

import copy
import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence
from zoneinfo import ZoneInfo

from fastapi import HTTPException

PAGE_SIZE_DEFAULT = 50
PAGE_SIZE_MAX = 200
IDS_CAP = 5000
FETCH_CAP = 50000

TABS = frozenset({"all", "sales", "purchase", "incoming", "outgoing_gib", "export", "import"})
PAYS = frozenset({"all", "paid", "unpaid", "partially_paid", "overdue"})
SORTS = frozenset({
    "date_desc", "date_asc",
    "due_asc", "due_desc",
    "amount_desc", "amount_asc",
    "contact_asc", "contact_desc",
    "number_desc", "number_asc",
    "gib_asc", "gib_desc",
    "pay_asc", "pay_desc",
})
CANCELLED_STATUSES = frozenset({"cancelled", "canceled", "cancelling", "void"})
PAY_RANK = {"unpaid": 0, "partially_paid": 1, "paid": 2}
GIB_OUT_CODES = frozenset({"1300", "1220", "1200"})
HEAVY_KEYS = (
    "items", "raw_xml", "ubl", "ubl_xml", "invoice_xml", "html", "pdf", "pdf_base64", "attachment_xml",
)
_TR_ORDER = {
    "a": 1, "b": 2, "c": 3, "ç": 4, "d": 5, "e": 6, "f": 7, "g": 8, "ğ": 9,
    "h": 10, "ı": 11, "i": 12, "j": 13, "k": 14, "l": 15, "m": 16, "n": 17,
    "o": 18, "ö": 19, "p": 20, "r": 21, "s": 22, "ş": 23, "t": 24, "u": 25,
    "ü": 26, "v": 27, "y": 28, "z": 29,
}
_IST = ZoneInfo("Europe/Istanbul")
_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_HHMM = re.compile(r"^\d{2}:\d{2}$")
_HHMMSS = re.compile(r"^\d{2}:\d{2}:\d{2}$")


def istanbul_today(now: Optional[datetime] = None) -> str:
    """Vade karşılaştırması Türkiye günü (YYYY-AA-GG)."""
    dt = now or datetime.now(_IST)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=_IST)
    return dt.astimezone(_IST).date().isoformat()


def clamp_page(page: Any) -> int:
    try:
        n = int(page)
    except (TypeError, ValueError):
        return 1
    return n if n >= 1 else 1


def require_page_size(page_size: Any) -> int:
    """Boşsa 50. 200 üstü 200'e kırpılır. 1'den küçük 422."""
    if page_size is None or page_size == "":
        return PAGE_SIZE_DEFAULT
    if isinstance(page_size, bool):
        raise HTTPException(status_code=422, detail="page_size 1 veya daha büyük olmalı")
    try:
        n = int(page_size)
    except (TypeError, ValueError):
        raise HTTPException(status_code=422, detail="page_size geçersiz")
    if n < 1:
        raise HTTPException(status_code=422, detail="page_size 1 veya daha büyük olmalı")
    return n if n <= PAGE_SIZE_MAX else PAGE_SIZE_MAX


def normalize_tab(tab: Any) -> str:
    flag = str(tab or "all").strip().lower() or "all"
    if flag not in TABS:
        raise HTTPException(status_code=400, detail="tab all, sales, purchase, incoming, outgoing_gib, export veya import olmalı.")
    return flag


def normalize_pay(pay: Any) -> str:
    flag = str(pay or "all").strip().lower() or "all"
    if flag == "partial":
        flag = "partially_paid"
    if flag not in PAYS:
        raise HTTPException(status_code=400, detail="pay all, paid, unpaid, partial veya overdue olmalı.")
    return flag


def normalize_sort(sort: Any) -> str:
    flag = str(sort or "date_desc").strip().lower() or "date_desc"
    if flag not in SORTS:
        raise HTTPException(status_code=400, detail="sort geçersiz.")
    return flag


def normalize_etype(etype: Any) -> str:
    flag = str(etype or "all").strip() or "all"
    if flag.lower() == "all":
        return "all"
    return flag


def js_lower(value: Any) -> str:
    """JS String.toLowerCase (Unicode). Türkçe harfler küçülür; ş→s katlanmaz."""
    return str(value if value is not None else "").lower()


def js_truthy(value: Any) -> bool:
    if value is None or value is False:
        return False
    if value is True:
        return True
    if isinstance(value, float) and value != value:
        return False
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value != ""
    return True


def js_number(value: Any) -> float:
    """JS Number(). null → 0, boş/uygunsuz → NaN."""
    if value is None:
        return float("nan")
    if value is True:
        return 1.0
    if value is False:
        return 0.0
    if isinstance(value, (int, float)):
        return float(value)
    try:
        n = float(str(value).strip())
    except (TypeError, ValueError):
        return float("nan")
    return n


def row_id(row: dict) -> str:
    return str((row or {}).get("id") or (row or {}).get("_id") or "")


def _fold_cancel(value: Any) -> str:
    text = js_lower(value).strip()
    return text.replace("ı", "i").replace("i\u0307", "i")


def is_cancelled_invoice(inv: dict) -> bool:
    """utils/invoiceStatus.js isCancelledInvoice."""
    if not inv:
        return False
    if _fold_cancel(inv.get("status")) in CANCELLED_STATUSES:
        return True
    if _fold_cancel(inv.get("payment_status")) in CANCELLED_STATUSES:
        return True
    return "iptal" in _fold_cancel(inv.get("gib_status"))


def is_incoming_gib_invoice(inv: dict) -> bool:
    """utils/dataSync.js isIncomingGibInvoice."""
    if not inv:
        return False
    if inv.get("direction") == "incoming" or inv.get("source") == "edoc_inbox" or inv.get("edoc_id"):
        return True
    if inv.get("invoice_type") == "purchase" and (inv.get("gib_uuid") or inv.get("gib_tracking_id")):
        return True
    if inv.get("invoice_type") == "purchase" and inv.get("e_type") == "e_invoice":
        return True
    gib = str(inv.get("gib_status") or "")
    return inv.get("invoice_type") == "purchase" and bool(re.search(r"gelen|received", gib, re.I))


def _outgoing_gib_text(inv: dict) -> str:
    raw = str(inv.get("gib_status") or "")
    raw = re.sub(r"^test\s*·\s*", "", raw, count=1, flags=re.I).strip()
    text = js_lower(raw)
    for src, dst in (("ı", "i"), ("i\u0307", "i"), ("ö", "o"), ("ü", "u"), ("ş", "s"), ("ğ", "g"), ("ç", "c")):
        text = text.replace(src, dst)
    return text


def is_outgoing_gib_invoice(inv: dict) -> bool:
    """utils/dataSync.js isOutgoingGibInvoice."""
    if not inv or inv.get("invoice_type") == "dispatch":
        return False
    if inv.get("e_type") in ("paper", "expense_slip") or inv.get("einvoice_state") == "paper":
        return False
    if is_incoming_gib_invoice(inv):
        return False
    gs = _outgoing_gib_text(inv)
    if inv.get("einvoice_state") == "error" or re.search(r"^\s*hata\s*:", gs, re.I):
        return False
    code = str(inv.get("gib_status_code") or "").strip()
    if code in GIB_OUT_CODES:
        return True
    if inv.get("einvoice_state") in ("sent", "queued"):
        return True
    if inv.get("gib_tracking_id") or inv.get("gib_uuid"):
        return True
    if re.search(r"ziplen|zarflan", gs):
        return True
    return bool(re.search(r"gib'?e (ilet|gonder)|n11 faturam|e-ihracat.*ileti", gs))


def is_gib_sent_or_received(inv: dict) -> bool:
    if not inv:
        return False
    return is_incoming_gib_invoice(inv) or is_outgoing_gib_invoice(inv)


def invoice_type_matches(inv: dict, tab: str) -> bool:
    """utils/dataSync.js invoiceTypeFilter."""
    if not inv:
        return False
    if tab == "export":
        return inv.get("trade_kind") == "export" and inv.get("invoice_type") != "dispatch"
    if tab == "import":
        return inv.get("trade_kind") == "import" and inv.get("invoice_type") != "dispatch"
    if tab == "incoming":
        return is_incoming_gib_invoice(inv) and inv.get("invoice_type") != "dispatch"
    if tab == "outgoing_gib":
        return is_outgoing_gib_invoice(inv)
    if tab == "sales":
        return inv.get("invoice_type") == "sales" and not is_gib_sent_or_received(inv)
    if tab == "purchase":
        return inv.get("invoice_type") == "purchase" and not is_gib_sent_or_received(inv)
    if not tab or tab == "all":
        return inv.get("invoice_type") != "dispatch"
    return inv.get("invoice_type") == tab


def _js_field(value: Any, *, empty_if_falsy: bool) -> str:
    """Şablon dizisi. ``|| ""`` alanları falsy ise boş; diğerleri null ise ``undefined``."""
    if empty_if_falsy:
        if not js_truthy(value):
            return ""
        return str(value)
    if value is None:
        return "undefined"
    return str(value)


def search_blob(inv: dict) -> str:
    return js_lower(
        f"{_js_field(inv.get('invoice_number'), empty_if_falsy=False)} "
        f"{_js_field(inv.get('contact_name'), empty_if_falsy=False)} "
        f"{_js_field(inv.get('contact_tax_id'), empty_if_falsy=True)} "
        f"{_js_field(inv.get('notes'), empty_if_falsy=True)}"
    )


def matches_search(inv: dict, q: Any) -> bool:
    raw = "" if q is None else str(q)
    needle = js_lower(raw.strip())
    if needle == "":
        return True
    return needle in search_blob(inv)


def matches_pay(inv: dict, pay: str, *, today: str) -> bool:
    """InvoiceToolbar applyInvoiceFilters ödeme kolu."""
    if pay == "all":
        return True
    if pay == "overdue":
        if inv.get("payment_status") == "paid":
            return False
        due = inv.get("due_date")
        if not js_truthy(due):
            return False
        return str(due) < str(today)
    current = inv.get("payment_status") or "unpaid"
    return current == pay


def matches_etype(inv: dict, etype: str) -> bool:
    if not etype or etype == "all":
        return True
    return inv.get("e_type") == etype


def _date_before(issue_date: Any, bound: str) -> bool:
    """JS ``inv.issue_date < bound``. Eksik tarih karşılaştırması false'tur."""
    if issue_date is None:
        return False
    return str(issue_date) < bound


def _date_after(issue_date: Any, bound: str) -> bool:
    if issue_date is None:
        return False
    return str(issue_date) > bound


def matches_dates(inv: dict, date_from: str, date_to: str) -> bool:
    if date_from and _date_before(inv.get("issue_date"), date_from):
        return False
    if date_to and _date_after(inv.get("issue_date"), date_to):
        return False
    return True


def matches_amount(inv: dict, min_amount: Any, max_amount: Any) -> bool:
    """``if (f.min && Number(grand_total) < Number(f.min))``. NaN karşılaştırma false."""
    grand = js_number(inv.get("grand_total"))
    if js_truthy(min_amount):
        bound = js_number(min_amount)
        if grand == grand and bound == bound and grand < bound:
            return False
    if js_truthy(max_amount):
        bound = js_number(max_amount)
        if grand == grand and bound == bound and grand > bound:
            return False
    return True


def invoice_activity_stamp(inv: dict) -> str:
    """utils/invoiceSortStamp.js invoiceActivityStamp."""
    if not inv:
        return ""
    candidates = []
    for key in ("updated_at", "issued_at", "created_at", "queued_at"):
        value = inv.get(key)
        if value:
            candidates.append(str(value))
    day = str(inv.get("issue_date") or "")[:10]
    if _DAY.match(day):
        clock = str(inv.get("issue_time") or "00:00:00").strip()[:8]
        if _HHMM.match(clock):
            clock = f"{clock}:00"
        if not _HHMMSS.match(clock):
            clock = "00:00:00"
        candidates.append(f"{day}T{clock}")
    if not candidates:
        return ""
    return sorted(candidates)[-1]


def tr_sort_key(value: Any) -> tuple:
    parts = []
    for ch in str(value or ""):
        folded = ch.lower()
        if folded == "i\u0307":
            folded = "i"
        order = _TR_ORDER.get(folded)
        if order is None:
            parts.append((1, ord(ch)))
        else:
            parts.append((0, order, 0 if ch.isupper() else 1))
    return tuple(parts)


class _Desc:
    def __init__(self, value: Any):
        self.value = value

    def __lt__(self, other: "_Desc") -> bool:
        return self.value > other.value

    def __eq__(self, other: object) -> bool:
        return isinstance(other, _Desc) and self.value == other.value


def _or_zero(value: Any) -> float:
    if not js_truthy(value):
        return 0.0
    n = js_number(value)
    if n != n:
        return 0.0
    return n


def _pay_rank(inv: dict) -> int:
    status = inv.get("payment_status")
    if status in PAY_RANK:
        return PAY_RANK[status]
    return 0


def sort_invoices(rows: Sequence[dict], sort: str) -> List[dict]:
    """Birincil anahtar, eşitlikte id artan."""
    items = list(rows or [])
    sort_n = normalize_sort(sort)

    def ident(row: dict) -> str:
        return row_id(row)

    if sort_n == "date_desc":
        return sorted(items, key=lambda r: (_Desc(invoice_activity_stamp(r)), ident(r)))
    if sort_n == "date_asc":
        return sorted(items, key=lambda r: (invoice_activity_stamp(r), ident(r)))
    if sort_n == "due_asc":
        return sorted(items, key=lambda r: (str(r.get("due_date") or "9"), ident(r)))
    if sort_n == "due_desc":
        return sorted(items, key=lambda r: (_Desc(str(r.get("due_date") or "")), ident(r)))
    if sort_n == "amount_desc":
        return sorted(items, key=lambda r: (-_or_zero(r.get("grand_total")), ident(r)))
    if sort_n == "amount_asc":
        return sorted(items, key=lambda r: (_or_zero(r.get("grand_total")), ident(r)))
    if sort_n == "contact_asc":
        return sorted(items, key=lambda r: (tr_sort_key(r.get("contact_name")), ident(r)))
    if sort_n == "contact_desc":
        return sorted(items, key=lambda r: (_Desc(tr_sort_key(r.get("contact_name"))), ident(r)))
    if sort_n == "number_desc":
        return sorted(items, key=lambda r: (_Desc(str(r.get("invoice_number") or "")), ident(r)))
    if sort_n == "number_asc":
        return sorted(items, key=lambda r: (str(r.get("invoice_number") or ""), ident(r)))
    if sort_n == "gib_asc":
        return sorted(items, key=lambda r: (tr_sort_key(r.get("gib_status")), ident(r)))
    if sort_n == "gib_desc":
        return sorted(items, key=lambda r: (_Desc(tr_sort_key(r.get("gib_status"))), ident(r)))
    if sort_n == "pay_asc":
        return sorted(items, key=lambda r: (_pay_rank(r), ident(r)))
    return sorted(items, key=lambda r: (-_pay_rank(r), ident(r)))


def row_display_amount(inv: dict) -> float:
    """InvoicesPage toplamı: local_total doluysa o, değilse TRY grand_total, o da yoksa grand_total."""
    local = inv.get("local_total")
    currency = inv.get("currency") or "TRY"
    grand = inv.get("grand_total")
    if js_truthy(local):
        chosen = local
    elif currency == "TRY":
        chosen = grand
    else:
        chosen = 0
    primary = js_number(chosen)
    if primary == primary and primary != 0:
        return float(primary)
    fallback = js_number(grand)
    if fallback != fallback:
        return 0.0
    return float(fallback or 0.0)


def summarize(rows: Sequence[dict]) -> dict:
    ordered = list(rows or [])
    total = 0.0
    draft_count = 0
    approved_count = 0
    for row in ordered:
        total += row_display_amount(row)
        status = row.get("status")
        if status == "draft":
            draft_count += 1
        elif status == "approved":
            approved_count += 1
    return {
        "count": len(ordered),
        "total_amount": round(total, 2),
        "draft_count": draft_count,
        "approved_count": approved_count,
    }


def select_invoices(
    docs: Sequence[dict],
    *,
    tab: str = "all",
    contact_id: str = "",
    q: str = "",
    pay: str = "all",
    etype: str = "all",
    date_from: str = "",
    date_to: str = "",
    min_amount: Any = "",
    max_amount: Any = "",
    sort: str = "date_desc",
    show_cancelled: bool = False,
    today: Optional[str] = None,
) -> List[dict]:
    """Sekme, filtre, sonra sıralama. Sayfa dilimi yok."""
    tab_n = normalize_tab(tab)
    pay_n = normalize_pay(pay)
    etype_n = normalize_etype(etype)
    sort_n = normalize_sort(sort)
    day = today or istanbul_today()
    contact = str(contact_id or "").strip()
    matched = []
    for row in docs or []:
        if not isinstance(row, dict):
            continue
        if not invoice_type_matches(row, tab_n):
            continue
        if contact and str(row.get("contact_id") or "") != contact:
            continue
        if not show_cancelled and is_cancelled_invoice(row):
            continue
        if not matches_search(row, q or ""):
            continue
        if not matches_pay(row, pay_n, today=day):
            continue
        if not matches_etype(row, etype_n):
            continue
        if not matches_dates(row, date_from or "", date_to or ""):
            continue
        if not matches_amount(row, min_amount, max_amount):
            continue
        matched.append(row)
    return sort_invoices(matched, sort_n)


def lite_invoice(doc: dict) -> dict:
    """Satır alanları. Kalemler ve gömülü XML/PDF yok."""
    row = copy.deepcopy(doc)
    if "_id" in row:
        row["id"] = str(row.pop("_id"))
    elif row.get("id") is not None:
        row["id"] = str(row["id"])
    for key in HEAVY_KEYS:
        row.pop(key, None)
    for secret in ("b2b_password_hash", "password_hash", "shopfloor_pin_hash", "cashier_pin_hash", "punch_pin_hash"):
        row.pop(secret, None)
    return row


def prefilter_query(
    company_id: str,
    *,
    tab: str,
    contact_id: str = "",
    etype: str = "all",
) -> dict:
    """SQL'e itilebilen daraltma. Sonuç kümesinin üst kümesi; asıl süzgeç Python'da.

    Tarih, arama, tutar, vade ve iptal metni itilmez (eksik alan ve Türkçe
    metin kuralları SQL'de daralırsa sayfa kümesi eksilir).
    """
    cid = str(company_id or "")
    query: Dict[str, Any] = {"company_id": cid}
    contact = str(contact_id or "").strip()
    if contact:
        query["contact_id"] = contact
    if etype and etype != "all":
        query["e_type"] = etype
    if tab == "all" or tab == "outgoing_gib":
        query["invoice_type"] = {"$ne": "dispatch"}
    elif tab == "sales":
        query["invoice_type"] = "sales"
    elif tab == "purchase":
        query["invoice_type"] = "purchase"
    elif tab == "export":
        query["trade_kind"] = "export"
        query["invoice_type"] = {"$ne": "dispatch"}
    elif tab == "import":
        query["trade_kind"] = "import"
        query["invoice_type"] = {"$ne": "dispatch"}
    return query


async def fetch_invoice_rows(db, company_id: str, query: dict) -> List[dict]:
    """Firma faturaları. Yazmaz."""
    cid = str(company_id or "")
    if not cid:
        return []
    fetched = await db.invoices.find({**query, "company_id": cid}).to_list(FETCH_CAP + 1)
    rows = []
    for row in (fetched or [])[:FETCH_CAP]:
        if isinstance(row, dict) and str(row.get("company_id") or "") == cid:
            rows.append(row)
    return rows


def _view(docs: Sequence[dict], **kwargs) -> List[dict]:
    cleaned = []
    for doc in docs or []:
        if isinstance(doc, dict):
            cleaned.append(lite_invoice(doc))
    return select_invoices(cleaned, **kwargs)


async def _load(db, company_id: str, **kwargs) -> List[dict]:
    tab = normalize_tab(kwargs.get("tab") or "all")
    etype = normalize_etype(kwargs.get("etype") or "all")
    query = prefilter_query(
        company_id,
        tab=tab,
        contact_id=kwargs.get("contact_id") or "",
        etype=etype,
    )
    docs = await fetch_invoice_rows(db, company_id, query)
    view_kwargs = dict(kwargs)
    view_kwargs["tab"] = tab
    view_kwargs["etype"] = etype
    return _view(docs, **view_kwargs)


async def list_invoices_unpaged(db, company_id: str, **kwargs) -> List[dict]:
    """Aynı filtre ve sıra, sayfa dilimi yok. Yazmaz."""
    return await _load(db, company_id, **kwargs)


async def list_invoices_paged(
    db,
    company_id: str,
    *,
    page: Any = 1,
    page_size: Any = None,
    **kwargs,
) -> dict:
    """Sayfa döner. invoices koleksiyonuna yazılmaz."""
    size = require_page_size(page_size)
    page_n = clamp_page(page)
    ordered = await _load(db, company_id, **kwargs)
    total = len(ordered)
    start = (page_n - 1) * size
    page_rows = ordered[start:start + size] if start < total else []
    return {
        "items": page_rows,
        "total": total,
        "page": page_n,
        "page_size": size,
        "has_more": start + len(page_rows) < total,
        "summary": summarize(ordered),
    }


async def list_invoice_ids(db, company_id: str, **kwargs) -> dict:
    """Aynı süzgeç, yalnız id. Üst sınır 5000."""
    ordered = await _load(db, company_id, **kwargs)
    ids = [row_id(row) for row in ordered if row_id(row)]
    return {"ids": ids[:IDS_CAP], "total": len(ids)}


async def list_invoices_page_for_user(db, user: dict, company_id: Optional[str] = None, **kwargs) -> dict:
    """company_id kullanıcının erişimindeki şirketle çözülür; başka şirket 403."""
    import tenant_access

    cid = tenant_access.resolve_company_id(user, company_id)
    return await list_invoices_paged(db, cid, **kwargs)


async def list_invoice_ids_for_user(db, user: dict, company_id: Optional[str] = None, **kwargs) -> dict:
    import tenant_access

    cid = tenant_access.resolve_company_id(user, company_id)
    return await list_invoice_ids(db, cid, **kwargs)
