"""Banka hareketini güvenli yeniden eşleştirme ve hesap listesi ay özeti.

Yeni eşleştirme yazılmaz. replace=true: hedef doğrulanır, koşullu kilit alınır,
mevcut _unmatch çağrılır, hareket yeniden okunur, mevcut _apply_match çağrılır.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Awaitable, Callable, List, Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException

import bank_guard

logger = logging.getLogger("TamKobiERP")

IST = ZoneInfo("Europe/Istanbul")

_TRUE = {"1", "true", "yes", "on", "evet"}

# (gövde alanı, koleksiyon, geçersiz hedef mesajı)
_SAME_COMPANY = (
    ("contact_id", "contacts", "Cari bulunamadı."),
    ("invoice_id", "invoices", "Fatura bulunamadı."),
    ("employee_id", "employees", "Personel bulunamadı."),
    ("expense_id", "expenses", "Masraf bulunamadı."),
)


def replace_requested(body: Optional[dict]) -> bool:
    """replace yoksa veya false ise bugünkü eşleştirme. "false" metni true sayılmaz."""
    if not isinstance(body, dict) or "replace" not in body:
        return False
    value = body.get("replace")
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return value != 0
    if isinstance(value, str):
        return value.strip().lower() in _TRUE
    return False


def istanbul_month_bounds(now: Optional[datetime] = None) -> tuple:
    """Europe/Istanbul (UTC+3) ay başı ve sonraki ay başı, YYYY-MM-DD."""
    moment = now or datetime.now(IST)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=IST)
    else:
        moment = moment.astimezone(IST)
    start = moment.date().replace(day=1)
    if start.month == 12:
        end = start.replace(year=start.year + 1, month=1)
    else:
        end = start.replace(month=start.month + 1)
    return start.isoformat(), end.isoformat()


def _clean_id(value: Any) -> str:
    if value is None or isinstance(value, bool):
        return ""
    return str(value).strip()


async def _require_same_company(db, collection: str, doc_id: str, company_id: Any, detail: str) -> dict:
    doc = await db[collection].find_one({"_id": doc_id, "company_id": company_id})
    if not doc:
        raise HTTPException(status_code=400, detail=detail)
    return doc


async def validate_replace_target(db, company_id: Any, body: dict) -> None:
    """Yeni cari, fatura, hedef hesap, personel ve masraf var ve aynı şirkette.

    _unmatch çağrılmadan önce. Geçersiz hedef 400; eski eşleşme bozulmaz.
    """
    for field, collection, detail in _SAME_COMPANY:
        doc_id = _clean_id((body or {}).get(field))
        if not doc_id:
            continue
        await _require_same_company(db, collection, doc_id, company_id, detail)
    target = _clean_id((body or {}).get("target_account_id"))
    if not target:
        return
    kind, eid = bank_guard.parse_payment_target(target)
    if not eid:
        raise HTTPException(status_code=400, detail="Hedef hesap bulunamadı.")
    if kind == "partner":
        await _require_same_company(db, "partners", eid, company_id, "Hedef hesap bulunamadı.")
    elif kind == "contact":
        await _require_same_company(db, "contacts", eid, company_id, "Hedef hesap bulunamadı.")
    else:
        await _require_same_company(db, "bank_accounts", eid, company_id, "Hedef hesap bulunamadı.")


def _apply_kwargs(body: dict, actor: Optional[dict]) -> dict:
    """match ucundaki gövde ile aynı alanlar. Eşleşme metni _apply_match içinden gelir."""
    body = body or {}
    return {
        "contact_id": body.get("contact_id") or None,
        "invoice_id": body.get("invoice_id") or None,
        "category": body.get("category") or None,
        "learn": bool(body.get("learn", True)),
        "target_account_id": body.get("target_account_id") or None,
        "actor": actor,
        "as_expense": bool(body.get("as_expense")),
        "employee_id": body.get("employee_id") or None,
        "personnel_pay_kind": body.get("personnel_pay_kind") or None,
        "link_existing_id": body.get("link_existing_id") or body.get("existing_tx_id") or None,
        "expense_id": body.get("expense_id") or None,
    }


async def _clear_rematching(db, tx_id: str) -> None:
    """Kilit, _apply_match bitmeden düşerse hareket rematching'de kalmasın."""
    try:
        await db.bank_transactions.update_one(
            {"_id": tx_id, "match_status": "rematching"},
            {"$set": {"match_status": "unmatched"}},
        )
    except Exception:
        logger.exception("bank rematch lock clear failed tx=%s", tx_id)


async def replace_matched_transaction(
    db,
    tx: dict,
    body: dict,
    actor: Optional[dict],
    *,
    unmatch: Callable[..., Awaitable[dict]],
    apply_match: Callable[..., Awaitable[dict]],
) -> dict:
    """Eşleşmiş bank_sync hareketini yeni hedefe al.

    Eski eşleşme, hedef geçersizse hiç bozulmaz. Kilit {_id, match_status:matched}
    → rematching; modified_count==0 ise 409. _apply_match hata verirse eski eşleşme
    geri kurulmaz; hareket unmatched kalır ve match_status rematching bırakılmaz.
    """
    if (tx or {}).get("source") != "bank_sync":
        raise HTTPException(status_code=400, detail="Yalnız banka senkron hareketi yeniden eşleştirilebilir.")
    status = str((tx or {}).get("match_status") or "")
    if status not in ("matched", "rematching"):
        raise HTTPException(status_code=400, detail="Yalnız eşleşmiş hareket yeniden eşleştirilebilir.")
    company_id = tx.get("company_id")
    if not company_id:
        raise HTTPException(status_code=400, detail="Hareketin şirketi yok.")
    await validate_replace_target(db, company_id, body or {})
    locked = await db.bank_transactions.update_one(
        {"_id": tx["_id"], "match_status": "matched"},
        {"$set": {"match_status": "rematching"}},
    )
    if int(getattr(locked, "modified_count", 0) or 0) == 0:
        raise HTTPException(status_code=409, detail="Bu hareket yeniden eşleştiriliyor.")
    try:
        await unmatch(tx, actor)
        fresh = await db.bank_transactions.find_one({"_id": tx["_id"]})
        if not fresh:
            raise HTTPException(status_code=404, detail="Hareket bulunamadı.")
        kwargs = _apply_kwargs(body, actor)
        return await apply_match(
            fresh,
            kwargs["contact_id"],
            kwargs["invoice_id"],
            kwargs["category"],
            learn=kwargs["learn"],
            target_account_id=kwargs["target_account_id"],
            actor=kwargs["actor"],
            as_expense=kwargs["as_expense"],
            employee_id=kwargs["employee_id"],
            personnel_pay_kind=kwargs["personnel_pay_kind"],
            link_existing_id=kwargs["link_existing_id"],
            expense_id=kwargs["expense_id"],
        )
    except Exception as exc:
        # Eski eşleşme geri kurulmaz. Hareket unmatched kalır; rematching'de bırakılmaz.
        await _clear_rematching(db, tx["_id"])
        if isinstance(exc, HTTPException):
            raise
        logger.exception("bank rematch apply failed tx=%s", tx.get("_id"))
        raise HTTPException(
            status_code=400,
            detail=f"Yeniden eşleştirme tamamlanamadı: {exc}",
        ) from exc


def _month_pipeline(company_id: str, account_ids: List[str], start: str, end: str) -> List[dict]:
    """Tek aggregate: company_id + UTC+3 ay aralığı + account_id."""
    return [
        {"$match": {
            "company_id": company_id,
            "account_id": {"$in": account_ids},
            "$and": [
                {"date": {"$gte": start}},
                {"date": {"$lt": end}},
            ],
        }},
        {"$group": {
            "_id": "$account_id",
            "month_in": {"$sum": {"$cond": [
                {"$eq": ["$type", "inflow"]},
                {"$ifNull": ["$amount", 0]},
                0,
            ]}},
            "month_out": {"$sum": {"$cond": [
                {"$eq": ["$type", "outflow"]},
                {"$ifNull": ["$amount", 0]},
                0,
            ]}},
            "unmatched_count": {"$sum": {"$cond": [
                {"$eq": ["$match_status", "unmatched"]},
                1,
                0,
            ]}},
        }},
    ]


async def attach_month_totals(db, company_id: str, rows: List[dict]) -> None:
    """Her hesaba bu ayın giriş, çıkış ve eşleşmemiş sayısını yazar. Tek aggregate."""
    ids: List[str] = []
    for row in rows or []:
        aid = str((row or {}).get("id") or (row or {}).get("_id") or "")
        if aid:
            ids.append(aid)
    totals = {aid: {"month_in": 0.0, "month_out": 0.0, "unmatched_count": 0} for aid in ids}
    if company_id and ids:
        start, end = istanbul_month_bounds()
        grouped = await db.bank_transactions.aggregate(
            _month_pipeline(company_id, ids, start, end),
        ).to_list(None)
        for bucket in grouped or []:
            aid = str(bucket.get("_id") or "")
            if aid not in totals:
                continue
            totals[aid] = {
                "month_in": round(float(bucket.get("month_in") or 0), 2),
                "month_out": round(float(bucket.get("month_out") or 0), 2),
                "unmatched_count": int(round(float(bucket.get("unmatched_count") or 0))),
            }
    for row in rows or []:
        aid = str((row or {}).get("id") or (row or {}).get("_id") or "")
        row.update(totals.get(aid, {"month_in": 0.0, "month_out": 0.0, "unmatched_count": 0}))
