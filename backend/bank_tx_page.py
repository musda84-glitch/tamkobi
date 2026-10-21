"""Hesap hareketleri sayfası. Salt okunur; bakiye alanlarına yazmaz.

Eski ``GET /banking/transactions`` ve ``/sync`` aynı kalır. Bu modül tek hesabın
listesini sayfalar. Üyelik iki (havuz işareti için üç) ayrı eşitlik sorgusudur;
tek ``$or`` yoktur. Sıra, paneldeki ``sortBankTransactions`` ile aynıdır
(tarih azalan, created_at/matched_at azalan, id azalan). Dönem giriş/çıkış
``account_balance.tx_signed_amount`` ile filtrelenmiş tüm küme üzerinden hesaplanır.
"""
from __future__ import annotations

import re
from datetime import datetime, time, timezone
from typing import Any, Dict, List, Optional, Sequence
from zoneinfo import ZoneInfo

from fastapi import HTTPException

import account_balance
import tenant_access
from order_list_filter import (
    fold_tr,
    istanbul_day_end_exclusive,
    istanbul_day_start,
    parse_order_instant,
)

IST = ZoneInfo("Europe/Istanbul")

PAGE_SIZE_DEFAULT = 50
PAGE_SIZE_MAX = 200
# account_balance.COMPANY_TX_LIMIT ile aynı tavan. Sorgu company_id taşır.
FETCH_CAP = 20000
# #1270: find().sort().to_list() tam itilebilen eşitlikte ORDER BY/LIMIT kullanır.
TX_SORT = [("date", -1), ("created_at", -1)]
# Panel matchesAccount: hesap, virman hedefi, müşteri kartı işareti. Her biri ayrı sorgu.
MEMBER_FIELDS = ("account_id", "target_account_id", "customer_card_account_id")

_ISO_DAY = re.compile(r"^(\d{4})-(\d{2})-(\d{2})")
_DMY = re.compile(r"^(\d{1,2})[./](\d{1,2})[./](\d{4})$")
_TX_TYPES = frozenset({"inflow", "outflow", "transfer"})
_MATCHED = frozenset({"all", "yes", "no"})


def clamp_page(page: Any) -> int:
    try:
        n = int(page)
    except (TypeError, ValueError):
        return 1
    return n if n >= 1 else 1


def clamp_page_size(page_size: Any) -> int:
    try:
        n = int(page_size)
    except (TypeError, ValueError):
        return PAGE_SIZE_DEFAULT
    if n < 1:
        return PAGE_SIZE_DEFAULT
    return n if n <= PAGE_SIZE_MAX else PAGE_SIZE_MAX


def date_sort_key(value: Any) -> str:
    """frontend/src/utils/dateFormat.js dateSortKey ile aynı anahtar."""
    raw = str(value or "").strip()
    if not raw:
        return ""
    iso = _ISO_DAY.match(raw)
    if iso:
        return f"{iso.group(1)}-{iso.group(2)}-{iso.group(3)}"
    dmy = _DMY.match(raw)
    if dmy:
        return f"{dmy.group(3)}-{int(dmy.group(2)):02d}-{int(dmy.group(1)):02d}"
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return raw[:10]
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d")


def _tx_instant(value: Any):
    """Hareket tarihini Europe/Istanbul anına çevirir.

    Yalnızca YYYY-MM-DD ve gg.aa.yyyy İstanbul günü 00:00'dır.
    Saat dilimi olmayan ISO zaman UTC kabul edilir (21:30Z ertesi İstanbul günü).
    """
    raw = str(value or "").strip()
    if not raw:
        return None
    dmy = _DMY.match(raw)
    if dmy:
        ymd = f"{dmy.group(3)}-{int(dmy.group(2)):02d}-{int(dmy.group(1)):02d}"
        day = datetime.strptime(ymd, "%Y-%m-%d").date()
        return datetime.combine(day, time.min, tzinfo=IST)
    return parse_order_instant(raw)


def tx_in_istanbul_range(tx: dict, date_from: str = "", date_to: str = "") -> bool:
    start = istanbul_day_start(date_from) if date_from else None
    end = istanbul_day_end_exclusive(date_to) if date_to else None
    if start is None and end is None:
        return True
    instant = _tx_instant((tx or {}).get("date"))
    if instant is None:
        return False
    if start is not None and instant < start:
        return False
    if end is not None and instant >= end:
        return False
    return True


def _tx_id(tx: dict) -> str:
    return str((tx or {}).get("id") or (tx or {}).get("_id") or "")


def sort_bank_txs(rows: Sequence[dict]) -> List[dict]:
    """date desc, created_at|matched_at desc, id desc (#1111 / sortBankTransactions)."""
    def key(tx: dict):
        created = str(tx.get("created_at") or tx.get("matched_at") or "")
        return (date_sort_key(tx.get("date")), created, _tx_id(tx))

    return sorted(list(rows or []), key=key, reverse=True)


def tx_search_blob(tx: dict) -> str:
    parts = [
        tx.get("description"),
        tx.get("contact_name"),
        tx.get("category"),
        tx.get("account_name"),
        tx.get("target_account_name"),
        tx.get("customer_card_name"),
    ]
    return fold_tr(" ".join(str(p) for p in parts if p))


def tx_matches_filters(
    tx: dict,
    *,
    date_from: str = "",
    date_to: str = "",
    q: str = "",
    tx_type: str = "",
    matched: str = "all",
) -> bool:
    if not tx_in_istanbul_range(tx, date_from, date_to):
        return False
    if tx_type and str(tx.get("type") or "") != tx_type:
        return False
    if matched == "yes" and str(tx.get("match_status") or "") != "matched":
        return False
    if matched == "no" and str(tx.get("match_status") or "") == "matched":
        return False
    needle = fold_tr(q).strip()
    if needle and needle not in tx_search_blob(tx):
        return False
    return True


def period_flows(rows: Sequence[dict], account_id: str, account: Optional[dict]) -> tuple:
    """Filtrelenmiş tüm kümenin giriş (+) ve çıkış (mutlak değer) toplamı."""
    inflow = 0.0
    outflow = 0.0
    aid = str(account_id or "")
    for tx in rows or []:
        signed = account_balance.tx_signed_amount(tx, aid, account)
        if signed > 0:
            inflow += signed
        elif signed < 0:
            outflow += -signed
    return round(inflow, 2), round(outflow, 2)


def member_queries(company_id: str, account_id: str) -> List[dict]:
    """company_id + tek alan. $or yok; virman hedefi ve kart işareti ayrı sorgu."""
    cid = str(company_id or "")
    aid = str(account_id or "")
    return [{"company_id": cid, field: aid} for field in MEMBER_FIELDS]


def _merge_unique(groups: Sequence[Sequence[dict]]) -> List[dict]:
    merged: Dict[str, dict] = {}
    order: List[str] = []
    anon = 0
    for rows in groups:
        for tx in rows or []:
            if not isinstance(tx, dict):
                continue
            key = _tx_id(tx)
            if not key:
                anon += 1
                key = f"__anon_{anon}"
            if key in merged:
                continue
            merged[key] = tx
            order.append(key)
    return [merged[key] for key in order]


async def _load_leg(db, query: dict, *, company_id: str) -> List[dict]:
    if not str(company_id or "").strip():
        return []
    cursor = db.bank_transactions.find({**query, "company_id": company_id})
    cursor = cursor.sort(list(TX_SORT))
    rows = await cursor.to_list(FETCH_CAP)
    return list(rows or [])


async def load_account_txs(db, company_id: str, account_id: str) -> List[dict]:
    groups = []
    for query in member_queries(company_id, account_id):
        groups.append(await _load_leg(db, query, company_id=company_id))
    return _merge_unique(groups)


def _public_row(tx: dict, account_id: str, account: Optional[dict]) -> dict:
    row = account_balance.annotate_bank_tx(tx, account_id, account)
    if "_id" in row:
        row["id"] = str(row.pop("_id"))
    elif row.get("id") is not None:
        row["id"] = str(row["id"])
    return row


def _normalize_filters(tx_type: str, matched: str) -> tuple:
    kind = str(tx_type or "").strip().lower()
    if kind in ("", "all"):
        kind = ""
    elif kind not in _TX_TYPES:
        raise HTTPException(status_code=400, detail="type inflow, outflow veya transfer olmalı.")
    flag = str(matched or "all").strip().lower() or "all"
    if flag not in _MATCHED:
        raise HTTPException(status_code=400, detail="matched all, yes veya no olmalı.")
    return kind, flag


async def list_account_transactions(
    db,
    account: dict,
    *,
    page: Any = 1,
    page_size: Any = PAGE_SIZE_DEFAULT,
    date_from: str = "",
    date_to: str = "",
    q: str = "",
    tx_type: str = "",
    matched: str = "all",
    focus_tx_id: str = "",
) -> dict:
    """Sayfa döner. bank_accounts / bank_transactions yazılmaz."""
    kind, flag = _normalize_filters(tx_type, matched)
    aid = str((account or {}).get("_id") or (account or {}).get("id") or "")
    cid = str((account or {}).get("company_id") or "")
    size = clamp_page_size(page_size)
    page_n = clamp_page(page)
    rows = await load_account_txs(db, cid, aid)
    filtered = [
        tx for tx in rows
        if tx_matches_filters(tx, date_from=date_from or "", date_to=date_to or "", q=q or "", tx_type=kind, matched=flag)
    ]
    ordered = sort_bank_txs(filtered)
    inflow, outflow = period_flows(ordered, aid, account)
    total = len(ordered)
    focus_page = None
    needle = str(focus_tx_id or "").strip()
    if needle:
        for index, tx in enumerate(ordered):
            if _tx_id(tx) == needle:
                focus_page = (index // size) + 1
                break
    start = (page_n - 1) * size
    page_rows = ordered[start:start + size]
    if cid and page_rows:
        import pos_settlement
        page_rows = await pos_settlement.annotate(db, cid, page_rows)
    items = [_public_row(tx, aid, account) for tx in page_rows]
    return {
        "items": items,
        "total": total,
        "page": page_n,
        "page_size": size,
        "has_more": start + len(page_rows) < total,
        "period_inflow": inflow,
        "period_outflow": outflow,
        "focus_page": focus_page,
    }


async def list_account_transactions_for_user(db, user: dict, account_id: str, **kwargs) -> dict:
    account = await tenant_access.get_tenant_doc(
        db, "bank_accounts", account_id, user, not_found="Hesap bulunamadı.",
    )
    return await list_account_transactions(db, account, **kwargs)
