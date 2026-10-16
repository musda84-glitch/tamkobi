"""Ortak hareketleri sayfası. Salt okunur; bakiye alanlarına yazmaz.

Eski ``GET /banking/partners``, ``/summary`` ve ``/transactions`` aynı kalır.
Tek ortak sorgusu ``company_id`` + ``partner_id`` eşitliğidir. Ortak seçilmezse
sorgu yalnız ``company_id`` eşitliğidir; silinmiş ortağın satırı eski tam liste
gibi düşer. Sıra, paneldeki ``sortBankTransactions`` ile aynıdır (tarih
azalan, created_at azalan, id azalan). Dönem giriş/çıkış ve defter,
``partner_pay.partner_ledger_breakdown`` ile filtrelenmiş tüm küme üzerinden
hesaplanır.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

from fastapi import HTTPException

import bank_tx_page
import partner_pay
import tenant_access
from order_list_filter import fold_tr

PAGE_SIZE_DEFAULT = 50
PAGE_SIZE_MAX = 200
# Ortak listesiyle aynı tavan. Sorgu company_id taşır.
FETCH_CAP = 20000
TX_SORT = [("date", -1), ("created_at", -1)]
_TX_TYPES = frozenset(partner_pay.TX_LABELS)


def clamp_page(page: Any) -> int:
    return bank_tx_page.clamp_page(page)


def clamp_page_size(page_size: Any) -> int:
    return bank_tx_page.clamp_page_size(page_size)


def _tx_id(tx: dict) -> str:
    return str((tx or {}).get("id") or (tx or {}).get("_id") or "")


def sort_partner_txs(rows: Sequence[dict]) -> List[dict]:
    """date desc, created_at|matched_at desc, id desc (sortBankTransactions)."""
    def key(tx: dict):
        created = str(tx.get("created_at") or tx.get("matched_at") or "")
        return (bank_tx_page.date_sort_key(tx.get("date")), created, _tx_id(tx))

    return sorted(list(rows or []), key=key, reverse=True)


def tx_search_blob(tx: dict) -> str:
    parts = [
        tx.get("description"),
        tx.get("partner_name"),
        tx.get("account_name"),
        tx.get("contact_name"),
    ]
    return fold_tr(" ".join(str(p) for p in parts if p))


def _normalize_type(tx_type: str) -> str:
    kind = str(tx_type or "").strip().lower()
    if kind in ("", "all"):
        return ""
    if kind not in _TX_TYPES:
        raise HTTPException(status_code=400, detail="Geçersiz işlem türü.")
    return kind


def tx_matches_filters(
    tx: dict,
    *,
    date_from: str = "",
    date_to: str = "",
    q: str = "",
    tx_type: str = "",
) -> bool:
    if not bank_tx_page.tx_in_istanbul_range(tx, date_from, date_to):
        return False
    if tx_type and str(tx.get("type") or "") != tx_type:
        return False
    needle = fold_tr(q).strip()
    if needle and needle not in tx_search_blob(tx):
        return False
    return True


def _public_row(tx: dict) -> dict:
    row = partner_pay.annotate_partner_tx(dict(tx or {}))
    if "_id" in row:
        row["id"] = str(row.pop("_id"))
    elif row.get("id") is not None:
        row["id"] = str(row["id"])
    return row


async def _load_partner_txs(db, company_id: str, partner_id: Optional[str] = None) -> List[dict]:
    """``partner_id`` yoksa sorgu yalnız company_id eşitliğidir."""
    cid = str(company_id or "")
    if partner_id is None:
        query: Dict[str, Any] = {"company_id": cid}
        cursor = db.partner_transactions.find(query)
        cursor = cursor.sort(list(TX_SORT))
        rows = await cursor.to_list(FETCH_CAP)
        return [
            tx for tx in (rows or [])
            if isinstance(tx, dict) and str(tx.get("company_id") or "") == cid
        ]
    query = {"company_id": cid, "partner_id": str(partner_id)}
    cursor = db.partner_transactions.find(query)
    cursor = cursor.sort(list(TX_SORT))
    rows = await cursor.to_list(FETCH_CAP)
    pid = query["partner_id"]
    return [
        tx for tx in (rows or [])
        if isinstance(tx, dict)
        and str(tx.get("company_id") or "") == cid
        and str(tx.get("partner_id") or "") == pid
    ]


async def _live_partner_ids(db, company_id: str) -> set:
    """Eski tam liste ile aynı tavan: silinmiş ortağın satırı listeye girmez."""
    found = await db.partners.find({"company_id": company_id}, {"_id": 1}).to_list(100)
    return {str(p.get("_id") or "") for p in found or [] if p.get("_id")}


async def list_partner_transactions(
    db,
    partner: dict,
    *,
    page: Any = 1,
    page_size: Any = PAGE_SIZE_DEFAULT,
    date_from: str = "",
    date_to: str = "",
    q: str = "",
    tx_type: str = "",
) -> dict:
    """Sayfa döner. partners / partner_transactions yazılmaz."""
    kind = _normalize_type(tx_type)
    cid = str((partner or {}).get("company_id") or "")
    pid = str((partner or {}).get("_id") or (partner or {}).get("id") or "")
    if not cid or not pid:
        raise HTTPException(status_code=404, detail="Ortak bulunamadı.")
    size = clamp_page_size(page_size)
    page_n = clamp_page(page)
    rows = await _load_partner_txs(db, cid, pid)
    filtered = [
        tx for tx in rows
        if tx_matches_filters(tx, date_from=date_from or "", date_to=date_to or "", q=q or "", tx_type=kind)
    ]
    ordered = sort_partner_txs(filtered)
    breakdown = partner_pay.partner_ledger_breakdown(ordered, (partner or {}).get("balance"))
    total = len(ordered)
    start = (page_n - 1) * size
    page_rows = ordered[start:start + size]
    return {
        "items": [_public_row(tx) for tx in page_rows],
        "total": total,
        "page": page_n,
        "page_size": size,
        "has_more": start + len(page_rows) < total,
        "period_in": breakdown["girisDisplay"],
        "period_out": breakdown["cikisDisplay"],
        "ledger": breakdown,
    }


async def list_company_partner_transactions(
    db,
    company_id: str,
    *,
    page: Any = 1,
    page_size: Any = PAGE_SIZE_DEFAULT,
    date_from: str = "",
    date_to: str = "",
    q: str = "",
    tx_type: str = "",
) -> dict:
    """Şirketteki tüm canlı ortaklar. Tek ortak sayfasıyla aynı şekil. Yazmaz."""
    kind = _normalize_type(tx_type)
    cid = str(company_id or "")
    if not cid:
        raise HTTPException(status_code=400, detail="Şirket seçilmedi.")
    size = clamp_page_size(page_size)
    page_n = clamp_page(page)
    live = await _live_partner_ids(db, cid)
    rows = await _load_partner_txs(db, cid, None)
    rows = [tx for tx in rows if str(tx.get("partner_id") or "") in live]
    filtered = [
        tx for tx in rows
        if tx_matches_filters(tx, date_from=date_from or "", date_to=date_to or "", q=q or "", tx_type=kind)
    ]
    ordered = sort_partner_txs(filtered)
    breakdown = partner_pay.partner_ledger_breakdown(ordered, 0)
    total = len(ordered)
    start = (page_n - 1) * size
    page_rows = ordered[start:start + size]
    return {
        "items": [_public_row(tx) for tx in page_rows],
        "total": total,
        "page": page_n,
        "page_size": size,
        "has_more": start + len(page_rows) < total,
        "period_in": breakdown["girisDisplay"],
        "period_out": breakdown["cikisDisplay"],
        "ledger": breakdown,
    }


async def list_partner_transactions_for_user(db, user: dict, partner_id: Optional[str] = None, **kwargs) -> dict:
    """``partner_id`` yoksa şirketteki tüm ortaklar. Tek ortak yolu aynı kalır."""
    company_id = kwargs.pop("company_id", None)
    if partner_id is not None:
        partner = await tenant_access.get_tenant_doc(
            db, "partners", partner_id, user, not_found="Ortak bulunamadı.",
        )
        return await list_partner_transactions(db, partner, **kwargs)
    cid = tenant_access.resolve_company_id(user, company_id)
    return await list_company_partner_transactions(db, cid, **kwargs)


async def list_company_ledgers(db, company_id: str) -> Dict[str, Any]:
    """Her ortak için defter. Hareketler load_company_partner_view içinde bir kez okunur."""
    view = await partner_pay.load_company_partner_view(db, company_id)
    grouped: Dict[str, List[dict]] = {}
    for tx in view.get("txs") or []:
        if not isinstance(tx, dict):
            continue
        key = str(tx.get("partner_id") or "")
        if key:
            grouped.setdefault(key, []).append(tx)
    out: Dict[str, Any] = {}
    for partner in view.get("partners") or []:
        pid = str(partner.get("_id") or partner.get("id") or "")
        if not pid:
            continue
        out[pid] = partner_pay.partner_ledger_breakdown(grouped.get(pid, []), partner.get("balance"))
    return out


async def list_company_ledgers_for_user(db, user: dict, company_id: Optional[str] = None) -> Dict[str, Any]:
    cid = tenant_access.resolve_company_id(user, company_id)
    return await list_company_ledgers(db, cid)
