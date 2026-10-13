"""Ödeme kilidi (_pay_claimed_at).

Süreç çökerse kilit belgede kalır. Belirli süreden eski kilit bayattır;
yeni istek onu update_one_atomic (SELECT … FOR UPDATE) ile devralır.
Devralmadan önce idempotency anahtarına bakılır: ödeme yazılmışsa tekrar kesilmez.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

import linked_moves

logger = logging.getLogger("pay_claim")

STALE_AFTER = timedelta(minutes=5)
PAY_COLLECTIONS = (
    ("installments", "installment"),
    ("payrolls", "payroll"),
)


def _now(now: Optional[datetime] = None) -> datetime:
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return current.astimezone(timezone.utc)


def parse_claimed_at(value: Any) -> Optional[datetime]:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).strip().replace("Z", "+00:00")
    if not text:
        return None
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def is_stale_claim(value: Any, *, now: Optional[datetime] = None, stale_after: timedelta = STALE_AFTER) -> bool:
    """Kilit yoksa bayat değildir. Okunamayan veya süresi dolmuş kilit bayattır."""
    if value is None or value == "":
        return False
    claimed = parse_claimed_at(value)
    if claimed is None:
        return True
    return _now(now) - claimed >= stale_after


def claim_query(doc_id: str, *, now: Optional[datetime] = None, stale_after: timedelta = STALE_AFTER) -> dict:
    """Kilit yok ya da bayat, ve kayıt henüz ödenmemiş."""
    cutoff = (_now(now) - stale_after).isoformat()
    return {
        "_id": doc_id,
        "status": {"$ne": "paid"},
        "$or": [
            {"_pay_claimed_at": {"$exists": False}},
            {"_pay_claimed_at": None},
            {"_pay_claimed_at": ""},
            {"_pay_claimed_at": {"$lt": cutoff}},
        ],
    }


def _database(db):
    """MySQLClient veritabanı istemcisidir; koleksiyonlar varsayılan veritabanındadır.

    server.py `client[DB_NAME]` verir. clear_stale_pay_claims.py MySQLClient verir.
    """
    from mysql_store import MySQLClient, mysql_settings_from_env

    if isinstance(db, MySQLClient):
        db_name = str(mysql_settings_from_env().get("db") or "tamkobi")
        return db[db_name]
    return db


def _collection(db, name: str):
    """Koleksiyon. Diğer modüllerle aynı: db[name] (tenant_access, company_reset, …)."""
    return _database(db)[name]


async def find_recorded_payment(
    db,
    doc: dict,
    *,
    source_type: str,
    source_id: str,
    company_id: str = "",
) -> Optional[dict]:
    """Ödeme yazıldıysa {response, finalize, via}; yazılmadıysa None.

    Önce belgedeki idempotency anahtarı (payment_applied / completed),
    yoksa bağlı kasa/ortak hareketi.
    """
    import idempotency

    db = _database(db)
    key = str(doc.get("_pay_idempotency_key") or "").strip()
    idem_company = doc.get("_pay_idempotency_company") or company_id
    if key:
        row = await _collection(db, "idempotency_keys").find_one({"_id": idempotency._doc_id(idem_company, key)})
        if row and (row.get("payment_applied") or row.get("status") == "completed"):
            payment = row.get("payment") or {}
            response = row.get("response")
            if response is None:
                response = payment.get("response") or {"status": "success", "already_paid": True}
            finalize = dict(payment.get("finalize") or {})
            return {"via": "idempotency", "response": response, "finalize": finalize, "row": row}

    cid = str(doc.get("company_id") or company_id or "").strip() or None
    try:
        linked = await linked_moves.find_linked(db, source_type, source_id, cid if cid and cid != "_" else None)
    except Exception:
        logger.exception("bağlı ödeme hareketi okunamadı %s %s", source_type, source_id)
        return None
    txs = list(linked.get("bank_transactions") or []) + list(linked.get("partner_transactions") or [])
    if not txs:
        return None
    amount = round(sum(float(t.get("amount") or 0) for t in txs), 2)
    return {
        "via": "linked_moves",
        "response": {"status": "success", "already_paid": True, "amount": amount},
        "finalize": _finalize_from_amount(doc, source_type, amount),
    }


def _finalize_from_amount(doc: dict, source_type: str, amount: float) -> dict:
    if source_type == "payroll":
        return {"status": "paid"}
    total = float(doc.get("amount") or 0)
    already = float(doc.get("paid_amount") or 0)
    paid = round(max(already, amount), 2)
    status = "paid" if total <= 0 or paid >= total - 0.01 else "partial"
    out: Dict[str, Any] = {"paid_amount": paid, "status": status}
    if status == "paid":
        out["paid_at"] = _now().isoformat()
    return out


async def _finalize_doc(db, collection: str, doc: dict, recorded: dict) -> dict:
    coll = _collection(db, collection)
    finalize = dict(recorded.get("finalize") or {})
    if "status" not in finalize:
        finalize["status"] = "paid"
    claimed_at = doc.get("_pay_claimed_at")
    query: Dict[str, Any] = {"_id": doc["_id"], "status": {"$ne": "paid"}}
    if claimed_at not in (None, ""):
        query["_pay_claimed_at"] = claimed_at
    await coll.update_one_atomic(
        query,
        {
            "$set": finalize,
            "$unset": {
                "_pay_claimed_at": "",
                "_pay_idempotency_key": "",
                "_pay_idempotency_company": "",
            },
        },
    )
    fresh = await coll.find_one({"_id": doc["_id"]}) or doc
    response = dict(recorded.get("response") or {"status": "success", "already_paid": True})
    response["already_paid"] = True
    response.setdefault("status", fresh.get("status") or "paid")
    return response


async def finalize_from_idempotency_doc(db, idem_doc: dict) -> None:
    payment = idem_doc.get("payment") or {}
    collection = payment.get("collection")
    doc_id = payment.get("doc_id")
    if not collection or not doc_id:
        return
    coll = _collection(db, collection)
    doc = await coll.find_one({"_id": doc_id})
    if not doc or str(doc.get("status")) == "paid":
        if doc and doc.get("_pay_claimed_at"):
            await coll.update_one_atomic(
                {"_id": doc_id, "_pay_claimed_at": doc.get("_pay_claimed_at")},
                {"$unset": {
                    "_pay_claimed_at": "",
                    "_pay_idempotency_key": "",
                    "_pay_idempotency_company": "",
                }},
            )
        return
    await _finalize_doc(db, collection, doc, {
        "response": idem_doc.get("response") or payment.get("response"),
        "finalize": payment.get("finalize") or {"status": "paid"},
    })


async def acquire_pay_claim(
    db,
    collection: str,
    doc_id: str,
    *,
    company_id: str,
    idempotency_key: str,
    source_type: str,
    paid_detail: str = "Bu kayıt zaten ödenmiş.",
    busy_detail: str = "Bu ödeme işlemi sürüyor.",
    now: Optional[datetime] = None,
) -> dict:
    """Kilidi al ya da yazılmış ödemeyi devralmadan kapat.

    Dönüş: {action: "proceed", claimed_at} | {action: "already_paid", response}
    """
    import idempotency

    coll = _collection(db, collection)
    doc = await coll.find_one({"_id": doc_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı.")
    if str(doc.get("status")) == "paid":
        raise HTTPException(status_code=409, detail=paid_detail)

    current = _now(now)
    claimed = doc.get("_pay_claimed_at")
    if claimed not in (None, "") and not is_stale_claim(claimed, now=current):
        raise HTTPException(status_code=409, detail=busy_detail)

    if is_stale_claim(claimed, now=current):
        recorded = await find_recorded_payment(
            db, doc, source_type=source_type, source_id=doc_id, company_id=company_id,
        )
        if recorded:
            response = await _finalize_doc(db, collection, doc, recorded)
            return {"action": "already_paid", "response": response}

    claimed_at = current.isoformat()
    key = str(idempotency_key or "").strip()
    claim = await coll.update_one_atomic(
        claim_query(doc_id, now=current),
        {"$set": {
            "_pay_claimed_at": claimed_at,
            "_pay_idempotency_key": key,
            "_pay_idempotency_company": idempotency.company_id_of(company_id),
        }},
    )
    if int(getattr(claim, "matched_count", 0) or 0) == 0:
        fresh = await coll.find_one({"_id": doc_id}) or {}
        if str(fresh.get("status")) == "paid":
            raise HTTPException(status_code=409, detail=paid_detail)
        recorded = await find_recorded_payment(
            db, fresh or doc, source_type=source_type, source_id=doc_id, company_id=company_id,
        )
        if recorded:
            response = await _finalize_doc(db, collection, fresh or doc, recorded)
            return {"action": "already_paid", "response": response}
        if fresh.get("_pay_claimed_at") and not is_stale_claim(fresh.get("_pay_claimed_at"), now=current):
            raise HTTPException(status_code=409, detail=busy_detail)
        raise HTTPException(status_code=409, detail=paid_detail)
    return {"action": "proceed", "claimed_at": claimed_at}


async def finish_pay_claim(db, collection: str, doc_id: str, claimed_at: str, set_fields: dict) -> str:
    """Kendi kilidimiz duruyorsa ödemeyi kapat. Başkası bitirdiyse already_paid."""
    coll = _collection(db, collection)
    upd = await coll.update_one_atomic(
        {"_id": doc_id, "status": {"$ne": "paid"}, "_pay_claimed_at": claimed_at},
        {
            "$set": set_fields,
            "$unset": {
                "_pay_claimed_at": "",
                "_pay_idempotency_key": "",
                "_pay_idempotency_company": "",
            },
        },
    )
    if int(getattr(upd, "matched_count", 0) or 0):
        return "finished"
    fresh = await coll.find_one({"_id": doc_id}) or {}
    if str(fresh.get("status")) == "paid":
        return "already_paid"
    raise HTTPException(status_code=409, detail="Bu kayıt zaten ödenmiş.")


async def release_pay_claim(db, collection: str, doc_id: str, claimed_at: Optional[str] = None) -> None:
    """Yalnızca bu isteğin kilidini bırak. Başkasının devraldığı kilide dokunma."""
    query: Dict[str, Any] = {"_id": doc_id}
    if claimed_at:
        query["_pay_claimed_at"] = claimed_at
    try:
        await _collection(db, collection).update_one_atomic(
            query,
            {"$unset": {
                "_pay_claimed_at": "",
                "_pay_idempotency_key": "",
                "_pay_idempotency_company": "",
            }},
        )
    except Exception:
        logger.exception("ödeme kilidi bırakılamadı %s %s", collection, doc_id)


async def list_stale_claims(
    db,
    *,
    now: Optional[datetime] = None,
    stale_after: timedelta = STALE_AFTER,
    company_id: str = "",
) -> List[dict]:
    current = _now(now)
    company = str(company_id or "").strip()
    rows: List[dict] = []
    for collection, source_type in PAY_COLLECTIONS:
        query: Dict[str, Any] = {"_pay_claimed_at": {"$exists": True}}
        if company:
            query["company_id"] = company
        docs = await _collection(db, collection).find(query).to_list(5000)
        for doc in docs:
            claimed = doc.get("_pay_claimed_at")
            if not is_stale_claim(claimed, now=current, stale_after=stale_after):
                continue
            recorded = await find_recorded_payment(
                db,
                doc,
                source_type=source_type,
                source_id=str(doc.get("_id")),
                company_id=doc.get("_pay_idempotency_company") or doc.get("company_id") or "",
            )
            rows.append({
                "collection": collection,
                "id": doc.get("_id"),
                "company_id": doc.get("company_id"),
                "status": doc.get("status"),
                "claimed_at": claimed,
                "idempotency_key": doc.get("_pay_idempotency_key") or "",
                "payment_written": bool(recorded),
                "via": (recorded or {}).get("via") or "",
                "action": "finalize" if recorded else "release",
            })
    return rows


async def clear_stale_claims(
    db,
    *,
    dry_run: bool = True,
    now: Optional[datetime] = None,
    stale_after: timedelta = STALE_AFTER,
    company_id: str = "",
) -> dict:
    """Bayat kilitleri listele. dry_run=False ise bırak ya da yazılmış ödemeyi kapat."""
    items = await list_stale_claims(db, now=now, stale_after=stale_after, company_id=company_id)
    if dry_run:
        return {"dry_run": True, "count": len(items), "released": 0, "finalized": 0, "items": items}

    released = 0
    finalized = 0
    current = _now(now)
    for item in items:
        collection = item["collection"]
        source_type = "payroll" if collection == "payrolls" else "installment"
        coll = _collection(db, collection)
        doc = await coll.find_one({"_id": item["id"]})
        if not doc or not is_stale_claim(doc.get("_pay_claimed_at"), now=current, stale_after=stale_after):
            item["result"] = "skipped"
            continue
        recorded = await find_recorded_payment(
            db,
            doc,
            source_type=source_type,
            source_id=str(doc.get("_id")),
            company_id=doc.get("_pay_idempotency_company") or doc.get("company_id") or "",
        )
        if recorded:
            await _finalize_doc(db, collection, doc, recorded)
            finalized += 1
            item["result"] = "finalized"
            continue
        res = await coll.update_one_atomic(
            {"_id": doc["_id"], "_pay_claimed_at": doc.get("_pay_claimed_at")},
            {"$unset": {
                "_pay_claimed_at": "",
                "_pay_idempotency_key": "",
                "_pay_idempotency_company": "",
            }},
        )
        if int(getattr(res, "matched_count", 0) or 0):
            released += 1
            item["result"] = "released"
        else:
            item["result"] = "skipped"
    return {
        "dry_run": False,
        "count": len(items),
        "released": released,
        "finalized": finalized,
        "items": items,
    }
