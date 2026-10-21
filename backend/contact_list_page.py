"""Cari listesi sayfası. Salt okunur; cari bakiyesine yazmaz.

``GET /contacts`` page ve page_size yokken eskisi gibi bir dizi döner.
İkisi verilirse yanıt ``{items, total, page, page_size, has_more, summary}`` olur.
Arama, durum, finansal filtre ve sıralama dilimden önce uygulanır.
Bakiye kolonu kayıttaki değerdir. Alacak/borç toplamı sayfa diliminin değil,
filtrelenmiş kümenin toplamıdır. Facet sayıları finansal filtreden önceki
kümeden gelir; böylece açılır listedeki adetler seçili sayfaya sıkışmaz.
"""
from __future__ import annotations

import copy
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Dict, List, Optional, Sequence

from fastapi import HTTPException

PAGE_SIZE_DEFAULT = 50
PAGE_SIZE_MAX = 200
FETCH_CAP = 10000
LITE_CAP = 5000
FLAG_CAP = 20000
OPEN_CAP = 10000
FLAG_DAYS = 7

_STATUSES = frozenset({"all", "active", "inactive"})
_FINS = frozenset({"all", "debtors", "creditors", "overdue", "installments", "clear"})
_SORTS = frozenset({"name", "name_desc", "balance_asc", "balance_desc"})

LITE_PROJ = {
    "name": 1,
    "phone": 1,
    "email": 1,
    "address": 1,
    "city": 1,
    "district": 1,
    "type": 1,
    "company_id": 1,
    "tax_number_or_id": 1,
    "balance": 1,
    "company_title": 1,
    "is_active": 1,
}


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


def contact_id(contact: dict) -> str:
    return str((contact or {}).get("id") or (contact or {}).get("_id") or "")


def js_lower(value: Any) -> str:
    """JS String.toLowerCase() (Unicode varsayılanı; tr-TR değil)."""
    return str(value or "").lower()


def signed_balance(balance: Any) -> float:
    """Karşılaştırma için sayı. Boş / sayı olmayan değer 0; işaret filtresine girmez."""
    if isinstance(balance, bool) or balance is None or balance == "":
        return 0.0
    try:
        return float(balance)
    except (TypeError, ValueError):
        return 0.0


def is_clear_balance(balance: Any) -> bool:
    """Panel: ``!(balance || 0)``. Sayısal 0 ve boş değer sıfırdır; ``"0"`` değil."""
    if balance is None or balance is False or balance == "":
        return True
    if isinstance(balance, bool):
        return False
    if isinstance(balance, (int, float)):
        return balance == 0
    return False


def matches_search(contact: dict, q: str) -> bool:
    """Ünvan ve ticari unvan küçük harf; VKN/TCKN paneldeki gibi olduğu gibi."""
    raw = "" if q is None else str(q)
    if raw == "":
        return True
    needle = js_lower(raw)
    if needle in js_lower((contact or {}).get("name") or ""):
        return True
    title = (contact or {}).get("company_title")
    if title and needle in js_lower(title):
        return True
    tax = (contact or {}).get("tax_number_or_id")
    if tax is None:
        tax = ""
    return raw in str(tax)


def normalize_status(status: Any) -> str:
    flag = str(status or "all").strip().lower() or "all"
    if flag not in _STATUSES:
        raise HTTPException(status_code=400, detail="status all, active veya inactive olmalı.")
    return flag


def normalize_fin(fin: Any) -> str:
    flag = str(fin or "all").strip().lower() or "all"
    if flag not in _FINS:
        raise HTTPException(status_code=400, detail="fin all, debtors, creditors, overdue, installments veya clear olmalı.")
    return flag


def normalize_sort(sort: Any) -> str:
    flag = str(sort or "name").strip().lower() or "name"
    if flag not in _SORTS:
        raise HTTPException(status_code=400, detail="sort name, name_desc, balance_asc veya balance_desc olmalı.")
    return flag


def matches_status(contact: dict, status: str) -> bool:
    if status == "all":
        return True
    active = (contact or {}).get("is_active") is not False
    if status == "active":
        return active
    return not active


def empty_flag() -> dict:
    return {
        "overdue_amount": 0.0,
        "overdue_count": 0,
        "installment_due_amount": 0.0,
        "installment_due_count": 0,
        "installment_overdue_count": 0,
    }


def flag_of(flags: Optional[dict], cid: str) -> dict:
    row = (flags or {}).get(cid) if cid else None
    if not isinstance(row, dict):
        return empty_flag()
    return row


def matches_fin(contact: dict, fin: str, flags: Optional[dict]) -> bool:
    if fin == "all":
        return True
    bal = (contact or {}).get("balance")
    if fin == "debtors":
        return signed_balance(bal) > 0
    if fin == "creditors":
        return signed_balance(bal) < 0
    if fin == "clear":
        return is_clear_balance(bal)
    info = flag_of(flags, contact_id(contact))
    if fin == "overdue":
        return int(info.get("overdue_count") or 0) > 0 or int(info.get("installment_overdue_count") or 0) > 0
    if fin == "installments":
        return int(info.get("installment_due_count") or 0) > 0
    return True


def sort_contacts(rows: Sequence[dict], sort: str) -> List[dict]:
    """name: veritabanının ünvan artan sırası korunur (sayfasız liste ile aynı)."""
    items = list(rows or [])
    if sort == "name":
        return items
    if sort == "name_desc":
        return sorted(items, key=lambda c: (str(c.get("name") or ""), contact_id(c)), reverse=True)

    def bal_key(c):
        return (signed_balance(c.get("balance")), js_lower(c.get("name")), contact_id(c))

    if sort == "balance_asc":
        return sorted(items, key=bal_key)
    return sorted(items, key=lambda c: (-signed_balance(c.get("balance")), js_lower(c.get("name")), contact_id(c)))


def facet_counts(rows: Sequence[dict], flags: Optional[dict]) -> dict:
    counts = {"total": 0, "debtors": 0, "creditors": 0, "overdue": 0, "installments": 0, "clear": 0}
    for row in rows or []:
        counts["total"] += 1
        if matches_fin(row, "debtors", flags):
            counts["debtors"] += 1
        if matches_fin(row, "creditors", flags):
            counts["creditors"] += 1
        if matches_fin(row, "overdue", flags):
            counts["overdue"] += 1
        if matches_fin(row, "installments", flags):
            counts["installments"] += 1
        if matches_fin(row, "clear", flags):
            counts["clear"] += 1
    return counts


def summarize(rows: Sequence[dict], facets: dict) -> dict:
    """Para toplamı finansal filtre uygulanmış kümenin tamamıdır."""
    receivable = 0.0
    payable = 0.0
    for row in rows or []:
        bal = signed_balance(row.get("balance"))
        if bal > 0:
            receivable += bal
        elif bal < 0:
            payable += -bal
    facets = facets or {}
    return {
        "count": len(list(rows or [])),
        "balance_total": round(receivable - payable, 2),
        "receivable_total": round(receivable, 2),
        "payable_total": round(payable, 2),
        "debtors": int(facets.get("debtors") or 0),
        "creditors": int(facets.get("creditors") or 0),
        "overdue": int(facets.get("overdue") or 0),
        "installments": int(facets.get("installments") or 0),
        "clear": int(facets.get("clear") or 0),
        "facet_total": int(facets.get("total") or 0),
    }


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


def _num(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


_OPEN_EPS = 0.01
_SKIP_INVOICE_STATUS = frozenset({"draft", "cancelled", "canceled", "void", "rejected"})


def _doc_id(doc: dict) -> str:
    return str((doc or {}).get("_id") or (doc or {}).get("id") or "")


def invoice_open_remaining(inv: dict) -> float:
    """Faturaya yazılmış paid_amount düşülmüş kalan. Alanın kendisi değişmez."""
    return round(max(0.0, _num((inv or {}).get("grand_total")) - _num((inv or {}).get("paid_amount"))), 2)


def _open_for_offset(inv: dict) -> bool:
    """Cari mahsup havuzuna giren fatura. Taslak, iptal ve irsaliye bakiyeye yazılmaz."""
    if not isinstance(inv, dict):
        return False
    status = str(inv.get("status") or "")
    if status in _SKIP_INVOICE_STATUS:
        return False
    if inv.get("invoice_type") == "dispatch" or inv.get("e_type") == "e_dispatch":
        return False
    if str(inv.get("payment_status") or "") == "paid":
        return False
    return invoice_open_remaining(inv) > _OPEN_EPS


def _offset_direction(inv: dict) -> str:
    return "receivable" if inv.get("invoice_type") == "sales" else "payable"


def _due_sort_key(inv: dict) -> tuple:
    due = str(inv.get("due_date") or inv.get("issue_date") or "")[:10]
    return (due or "9999-99-99", str(inv.get("issue_date") or ""), _doc_id(inv))


def effective_open_map(invoices, balance, *, balance_known: bool = True) -> Dict[str, float]:
    """Fatura kimliği → cari ödemesi düşülmüş açık kalan.

    Faturaya bağlanmamış net ödeme, yönün açık fatura kalanı ile carinin o yöndeki
    bakiyesi (en az 0) arasındaki farktır. En eski vadeden başlayarak düşülür.
    Bakiye 0 ise açık faturaların efektif kalanı 0 olur. paid_amount yazılmaz.
    Cari kaydı yoksa (bakiye bilinmiyor) kalanlar olduğu gibi kalır.
    """
    rows = [inv for inv in (invoices or []) if isinstance(inv, dict)]
    if not balance_known:
        return {_doc_id(inv): invoice_open_remaining(inv) for inv in rows if _doc_id(inv)}

    eligible = [inv for inv in rows if _open_for_offset(inv) and _doc_id(inv)]
    if abs(signed_balance(balance)) <= _OPEN_EPS:
        return {_doc_id(inv): 0.0 for inv in eligible}

    grouped: Dict[str, List[dict]] = {"receivable": [], "payable": []}
    for inv in eligible:
        grouped[_offset_direction(inv)].append(inv)

    bal = signed_balance(balance)
    out: Dict[str, float] = {}
    for direction, group in grouped.items():
        open_sum = round(sum(invoice_open_remaining(inv) for inv in group), 2)
        directional = bal if direction == "receivable" else -bal
        directional = directional if directional > 0 else 0.0
        pool = round(open_sum - directional, 2)
        if pool < 0:
            pool = 0.0
        for inv in sorted(group, key=_due_sort_key):
            rem = invoice_open_remaining(inv)
            take = rem if pool >= rem else pool
            if take < 0:
                take = 0.0
            pool = round(pool - take, 2)
            out[_doc_id(inv)] = round(rem - take, 2)
    return out


def apply_effective_open(invoices, balance, *, balance_known: bool = True) -> None:
    """Okuma kopyasına effective_open yazar. paid_amount ve veritabanı değişmez."""
    mapping = effective_open_map(invoices, balance, balance_known=balance_known)
    for inv in invoices or []:
        if not isinstance(inv, dict) or not _open_for_offset(inv):
            continue
        iid = _doc_id(inv)
        if iid in mapping:
            inv["effective_open"] = mapping[iid]


def overdue_totals(invoices, balance, *, balance_known: bool, today: str) -> tuple:
    """(vadesi geçmiş tutar, adet). Bakiye 0 ise ikisi de 0. Çift düşüm yok."""
    if balance_known and abs(signed_balance(balance)) <= _OPEN_EPS:
        return 0.0, 0
    opens = effective_open_map(invoices, balance, balance_known=balance_known)
    amount = 0.0
    count = 0
    today_s = str(today or "")
    for inv in invoices or []:
        if not _open_for_offset(inv):
            continue
        due = str(inv.get("due_date") or inv.get("issue_date") or "")[:10]
        if not due or due >= today_s:
            continue
        rem = opens.get(_doc_id(inv), invoice_open_remaining(inv))
        if rem > _OPEN_EPS:
            amount = round(amount + rem, 2)
            count += 1
    return amount, count


async def stamp_invoice_effective_open(db, company_id: str, docs: Sequence[dict]) -> None:
    """Fatura listesine effective_open. Bakiyeler tek find; cari başına sorgu yok."""
    cid = str(company_id or "").strip()
    if not cid or not docs:
        return
    contact_ids: List[str] = []
    seen = set()
    for doc in docs:
        if not isinstance(doc, dict):
            continue
        contact = str(doc.get("contact_id") or "").strip()
        if contact and contact not in seen:
            seen.add(contact)
            contact_ids.append(contact)
    if not contact_ids:
        return
    fetched = await db.contacts.find(
        {"company_id": cid, "_id": {"$in": contact_ids}},
        {"_id": 1, "balance": 1},
    ).to_list(len(contact_ids))
    known: Dict[str, Any] = {}
    for row in fetched or []:
        key = str(row.get("_id") or "")
        if key:
            known[key] = row.get("balance")
    if not known:
        return
    open_rows = await db.invoices.find(
        {
            "company_id": cid,
            "contact_id": {"$in": list(known)},
            "payment_status": {"$ne": "paid"},
            "status": {"$nin": ["cancelled", "canceled", "void", "draft"]},
        },
        {
            "contact_id": 1,
            "invoice_type": 1,
            "e_type": 1,
            "grand_total": 1,
            "paid_amount": 1,
            "due_date": 1,
            "issue_date": 1,
            "status": 1,
            "payment_status": 1,
        },
    ).to_list(FLAG_CAP)
    grouped: Dict[str, List[dict]] = {key: [] for key in known}
    have = set()
    for inv in open_rows or []:
        contact = str(inv.get("contact_id") or "")
        iid = _doc_id(inv)
        if contact in grouped and iid:
            grouped[contact].append(inv)
            have.add(iid)
    for doc in docs:
        if not isinstance(doc, dict):
            continue
        contact = str(doc.get("contact_id") or "")
        iid = _doc_id(doc)
        if contact in grouped and iid and iid not in have and _open_for_offset(doc):
            grouped[contact].append(doc)
            have.add(iid)
    maps = {
        contact: effective_open_map(grouped.get(contact) or [], known[contact], balance_known=True)
        for contact in known
    }
    for doc in docs:
        if not isinstance(doc, dict) or not _open_for_offset(doc):
            continue
        contact = str(doc.get("contact_id") or "")
        iid = _doc_id(doc)
        mapping = maps.get(contact)
        if mapping is not None and iid in mapping:
            doc["effective_open"] = mapping[iid]


def show_inactive(include_inactive: Optional[bool], lite: bool) -> bool:
    return include_inactive if include_inactive is not None else (not lite)


def contact_query(company_id: str, *, type: Optional[str], lite: bool, include_inactive: Optional[bool]) -> dict:
    query: Dict[str, Any] = {"company_id": str(company_id or "")}
    if type and type != "all":
        query["type"] = type
    if not show_inactive(include_inactive, lite):
        query["is_active"] = {"$ne": False}
    return query


async def fetch_contact_rows(
    db,
    company_id: str,
    *,
    type: Optional[str] = None,
    lite: bool = False,
    include_inactive: Optional[bool] = None,
) -> List[dict]:
    if not str(company_id or "").strip():
        return []
    query = contact_query(company_id, type=type, lite=lite, include_inactive=include_inactive)
    proj = LITE_PROJ if lite else None
    cap = LITE_CAP if lite else FETCH_CAP
    rows = await db.contacts.find({**query, "company_id": company_id}, proj).sort("name", 1).to_list(cap)
    return list(rows or [])


async def compute_open_amounts(db, company_id: str) -> Dict[str, float]:
    rows = await db.invoices.find(
        {"company_id": company_id, "invoice_type": "sales", "status": {"$nin": ["draft", "cancelled"]}},
        {"contact_id": 1, "grand_total": 1, "paid_amount": 1},
    ).to_list(OPEN_CAP)
    sums: Dict[str, float] = {}
    for row in rows or []:
        cid = str(row.get("contact_id") or "").strip()
        if not cid:
            continue
        sums[cid] = sums.get(cid, 0.0) + _num(row.get("grand_total")) - _num(row.get("paid_amount"))
    return {cid: round(val, 2) for cid, val in sums.items()}


def _today_horizon(today: Optional[str], days: int) -> tuple:
    if today:
        today_s = str(today)
        horizon = (datetime.strptime(today_s, "%Y-%m-%d") + timedelta(days=days)).strftime("%Y-%m-%d")
        return today_s, horizon
    now = datetime.now(timezone.utc)
    return now.strftime("%Y-%m-%d"), (now + timedelta(days=days)).strftime("%Y-%m-%d")


async def compute_flags(db, company_id: str, *, today: Optional[str] = None, days: int = FLAG_DAYS) -> Dict[str, dict]:
    """``GET /contacts/flags`` ile aynı sayım. Yalnız okur."""
    today_s, horizon = _today_horizon(today, days)
    flags: Dict[str, dict] = {}

    def slot(cid: str) -> dict:
        return flags.setdefault(cid, empty_flag())

    invoices = await db.invoices.find(
        {"company_id": company_id, "payment_status": {"$ne": "paid"}, "status": {"$nin": ["cancelled", "draft"]}},
        {
            "contact_id": 1,
            "invoice_type": 1,
            "e_type": 1,
            "grand_total": 1,
            "paid_amount": 1,
            "due_date": 1,
            "issue_date": 1,
            "status": 1,
            "payment_status": 1,
        },
    ).to_list(FLAG_CAP)
    # Bakiyeler tek turda. Cari başına ek sorgu yok; kaydı olmayan cari eski kalanını korur.
    balance_rows = await db.contacts.find(
        {"company_id": company_id},
        {"_id": 1, "balance": 1},
    ).to_list(FLAG_CAP)
    balances: Dict[str, Any] = {}
    for row in balance_rows or []:
        key = str(row.get("_id") or "")
        if key:
            balances[key] = row.get("balance")
    grouped: Dict[str, List[dict]] = {}
    for inv in invoices or []:
        cid = str(inv.get("contact_id") or "")
        if cid:
            grouped.setdefault(cid, []).append(inv)
    for cid, rows in grouped.items():
        known = cid in balances
        amount, count = overdue_totals(rows, balances.get(cid), balance_known=known, today=today_s)
        if count:
            slot_row = slot(cid)
            slot_row["overdue_amount"] = amount
            slot_row["overdue_count"] = count
    installments = await db.installments.find(
        {"company_id": company_id, "status": {"$ne": "paid"}},
        {"contact_id": 1, "amount": 1, "paid_amount": 1, "due_date": 1},
    ).to_list(FLAG_CAP)
    for it in installments or []:
        cid = it.get("contact_id")
        if not cid:
            continue
        row = slot(str(cid))
        due = str(it.get("due_date") or "")
        if due <= horizon:
            row["installment_due_amount"] = round(row["installment_due_amount"] + _num(it.get("amount")) - _num(it.get("paid_amount")), 2)
            row["installment_due_count"] += 1
        if due < today_s:
            row["installment_overdue_count"] += 1
    return flags


def stamp_open_amounts(docs: Sequence[dict], opens: Optional[dict]) -> None:
    if not opens:
        return
    for doc in docs or []:
        cid = contact_id(doc)
        if cid in opens:
            doc["open_amount"] = opens[cid]


def apply_view(
    docs: Sequence[dict],
    flags: Optional[dict],
    *,
    q: str = "",
    status: str = "all",
    fin: str = "all",
    sort: str = "name",
) -> dict:
    """Durum + arama kümesi üzerinden facet; finansal filtre ve sıralama sonra."""
    status_n = normalize_status(status)
    fin_n = normalize_fin(fin)
    sort_n = normalize_sort(sort)
    base = [row for row in docs or [] if matches_status(row, status_n) and matches_search(row, q or "")]
    facets = facet_counts(base, flags)
    chosen = [row for row in base if matches_fin(row, fin_n, flags)]
    ordered = sort_contacts(chosen, sort_n)
    return {"rows": ordered, "base": base, "facets": facets, "summary": summarize(ordered, facets)}


def _clean(docs: Sequence[dict], clean: Optional[Callable]) -> List[dict]:
    fn = clean or public_docs
    return list(fn(list(docs or [])))


async def _opens_for(db, company_id: str, lite: bool, open_amounts: Optional[dict]) -> dict:
    if lite:
        return {}
    if open_amounts is not None:
        return open_amounts
    try:
        return await compute_open_amounts(db, company_id)
    except Exception:
        logging.exception("contact open amounts")
        return {}


async def _flags_for(db, company_id: str, flags: Optional[dict], today: Optional[str]) -> dict:
    if flags is not None:
        return flags
    try:
        return await compute_flags(db, company_id, today=today)
    except Exception:
        logging.exception("contact list flags")
        return {}


async def list_contacts_unpaged(
    db,
    company_id: str,
    *,
    type: Optional[str] = None,
    lite: bool = False,
    include_inactive: Optional[bool] = None,
    open_amounts: Optional[dict] = None,
    clean: Optional[Callable] = None,
) -> List[dict]:
    """Sayfasız dizi. Sunucudaki eski gövde ile aynı küme ve sıra."""
    rows = await fetch_contact_rows(db, company_id, type=type, lite=lite, include_inactive=include_inactive)
    docs = _clean(rows, clean)
    if not lite:
        stamp_open_amounts(docs, await _opens_for(db, company_id, False, open_amounts))
    return docs


def _attach_flags(rows: Sequence[dict], flags: dict) -> List[dict]:
    out = []
    for row in rows or []:
        item = dict(row)
        item["flags"] = copy.deepcopy(flag_of(flags, contact_id(item)))
        out.append(item)
    return out


async def list_contacts_paged(
    db,
    company_id: str,
    *,
    type: Optional[str] = None,
    lite: bool = False,
    include_inactive: Optional[bool] = None,
    page: Any = 1,
    page_size: Any = None,
    q: str = "",
    status: str = "all",
    fin: str = "all",
    sort: str = "name",
    export: bool = False,
    open_amounts: Optional[dict] = None,
    flags: Optional[dict] = None,
    clean: Optional[Callable] = None,
    today: Optional[str] = None,
) -> dict:
    """Sayfa döner. contacts / invoices / installments yazılmaz."""
    exporting = bool(export)
    if exporting:
        size = LITE_CAP if lite else FETCH_CAP
        page_n = 1
    else:
        size = clamp_page_size(page_size)
        page_n = clamp_page(page)
    rows = await fetch_contact_rows(db, company_id, type=type, lite=lite, include_inactive=include_inactive)
    docs = _clean(rows, clean)
    if not lite:
        stamp_open_amounts(docs, await _opens_for(db, company_id, False, open_amounts))
    flag_map = await _flags_for(db, company_id, flags, today)
    view = apply_view(docs, flag_map, q=q or "", status=status, fin=fin, sort=sort)
    ordered = view["rows"]
    total = len(ordered)
    start = (page_n - 1) * size
    page_rows = ordered[start:start + size]
    items = _attach_flags(page_rows, flag_map)
    return {
        "items": items,
        "total": total,
        "page": page_n,
        "page_size": size,
        "has_more": start + len(page_rows) < total,
        "summary": view["summary"],
    }


async def list_contacts_for_user(db, user: dict, company_id: Optional[str] = None, *, paged: bool = False, **kwargs) -> Any:
    """company_id kullanıcının erişimindeki şirketle çözülür; başka şirket 403."""
    import tenant_access

    cid = tenant_access.resolve_company_id(user, company_id)
    if paged:
        return await list_contacts_paged(db, cid, **kwargs)
    return await list_contacts_unpaged(db, cid, **kwargs)
