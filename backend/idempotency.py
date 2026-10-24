"""HTTP Idempotency-Key: company_id + anahtar. Saklama süresi firma ayarı, varsayılan 24 saat."""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable, Dict, Optional, Tuple, Type

from fastapi import HTTPException, Request

from mysql_store import DuplicateKeyError as MysqlDuplicateKeyError

try:
    from pymongo.errors import DuplicateKeyError as PyMongoDuplicateKeyError
except ImportError:  # pragma: no cover
    PyMongoDuplicateKeyError = None  # type: ignore

# Her iki store da duplicate anahtarı bu tuple ile yakalanır
_DUP_ERRORS: Tuple[Type[BaseException], ...] = (MysqlDuplicateKeyError,)
if PyMongoDuplicateKeyError is not None:
    _DUP_ERRORS = (MysqlDuplicateKeyError, PyMongoDuplicateKeyError)

# Geriye uyumluluk: testler `from idempotency import DuplicateKeyError` kullanır
DuplicateKeyError = MysqlDuplicateKeyError

logger = logging.getLogger("idempotency")

TTL_HOURS = 24
MAX_TTL_HOURS = 168
CLEANUP_EVERY_S = 3600
_INDEXED = False


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = str(value).strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def header_key(request: Optional[Request]) -> str:
    if request is None:
        return ""
    raw = (
        request.headers.get("Idempotency-Key")
        or request.headers.get("idempotency-key")
        or ""
    )
    return str(raw).strip()[:200]


def company_id_of(company_id: str) -> str:
    return str(company_id or "").strip() or "_"


def _doc_id(company_id: str, key: str) -> str:
    return f"{company_id_of(company_id)}:{key}"


def _is_pay_endpoint(endpoint: str) -> bool:
    return str(endpoint or "").rstrip("/").endswith("/pay")


def _reset_indexed_for_tests() -> None:
    global _INDEXED
    _INDEXED = False


async def ensure_indexes(db) -> None:
    global _INDEXED
    if _INDEXED:
        return
    try:
        await db.idempotency_keys.create_index(
            [("company_id", 1), ("key", 1)], unique=True, name="idempo_company_key"
        )
        drop = getattr(db.idempotency_keys, "drop_index", None)
        if callable(drop):
            try:
                dropped = drop("idempo_ttl")
                if hasattr(dropped, "__await__"):
                    await dropped
            except Exception:
                pass
        await db.idempotency_keys.create_index(
            "created_at", expireAfterSeconds=MAX_TTL_HOURS * 3600, name="idempo_ttl"
        )
        _INDEXED = True
    except Exception:
        logger.exception("idempotency_keys index oluşturulamadı")


async def _try_insert(db, doc: dict) -> bool:
    """True = eklendi; False = duplicate."""
    stored = {**doc, "company_id": str((doc or {}).get("company_id") or "").strip()}
    try:
        await db.idempotency_keys.insert_one(stored)
        return True
    except _DUP_ERRORS:
        return False


async def begin(db, company_id: str, key: str, endpoint: str) -> Optional[Dict[str, Any]]:
    """None → anahtar yok. hit=True → cached response. hit=False → devam et."""
    key = (key or "").strip()
    if not key:
        return None
    cid = company_id_of(company_id)
    await ensure_indexes(db)
    now = _now()
    doc = {
        "_id": _doc_id(cid, key),
        "company_id": cid,
        "key": key,
        "endpoint": endpoint,
        "status": "in_progress",
        "created_at": now.isoformat(),
        "updated_at": now.isoformat(),
    }
    if await _try_insert(db, doc):
        return {"hit": False, "key": key, "company_id": cid}

    existing = await db.idempotency_keys.find_one({"_id": _doc_id(cid, key), "company_id": cid})
    if not existing:
        raise HTTPException(status_code=409, detail="Idempotency çakışması.")

    created = _as_utc(existing.get("created_at")) or now
    age_s = (now - created).total_seconds()
    ttl_hours = TTL_HOURS
    try:
        import offline_sync

        ttl_hours = await offline_sync.ttl_hours_for(db, cid)
    except Exception:
        ttl_hours = TTL_HOURS
    if age_s > ttl_hours * 3600:
        await db.idempotency_keys.delete_one({"_id": existing["_id"], "company_id": cid})
        if await _try_insert(db, doc):
            return {"hit": False, "key": key, "company_id": cid}
        # Silme ile yeniden insert arasında yarış — mevcut kaydı oku
        existing = await db.idempotency_keys.find_one({"_id": _doc_id(cid, key), "company_id": cid})
        if not existing:
            raise HTTPException(status_code=409, detail="Idempotency çakışması.")

    if existing.get("payment_applied"):
        await _finalize_applied(db, existing)
        resp = existing.get("response")
        if resp is None:
            resp = (existing.get("payment") or {}).get("response") or {
                "status": "success",
                "already_paid": True,
            }
        return {"hit": True, "response": resp, "key": key, "company_id": cid}
    if existing.get("status") == "completed" and existing.get("response") is not None:
        return {"hit": True, "response": existing["response"], "key": key, "company_id": cid}
    if existing.get("status") == "in_progress":
        touched = _as_utc(existing.get("updated_at") or existing.get("created_at")) or now
        age_s = (now - touched).total_seconds()
        # Yalnız ödeme uçları: süreç düşünce aynı anahtar bayat kilidi devralabilsin.
        if _is_pay_endpoint(existing.get("endpoint") or endpoint) and age_s >= _pay_claim_stale_seconds():
            if await _reclaim_stale_in_progress(db, existing, now):
                return {"hit": False, "key": key, "company_id": cid, "reclaimed": True}
        raise HTTPException(
            status_code=409,
            detail="Aynı Idempotency-Key ile işlem devam ediyor.",
        )
    raise HTTPException(status_code=409, detail="Idempotency-Key daha önce kullanıldı.")


def _pay_claim_stale_seconds() -> float:
    import pay_claim

    return float(pay_claim.STALE_AFTER.total_seconds())


async def _finalize_applied(db, existing: dict) -> None:
    try:
        import pay_claim

        await pay_claim.finalize_from_idempotency_doc(db, existing)
    except Exception:
        logger.exception("uygulanmış ödeme kaydı toparlanamadı")


async def _reclaim_stale_in_progress(db, existing: dict, now: datetime) -> bool:
    """Bayat in_progress anahtarını tek istek devralsın (SELECT FOR UPDATE)."""
    q: Dict[str, Any] = {
        "_id": existing["_id"],
        "company_id": str(existing.get("company_id") or ""),
        "status": "in_progress",
        "payment_applied": {"$ne": True},
    }
    stamp = existing.get("updated_at")
    if stamp is not None:
        q["updated_at"] = stamp
    else:
        created = existing.get("created_at")
        if created is not None:
            q["created_at"] = created
        q["updated_at"] = {"$exists": False}
    upd = {"$set": {
        "status": "in_progress",
        "created_at": now.isoformat(),
        "updated_at": now.isoformat(),
        "payment_applied": False,
    }}
    coll = db.idempotency_keys
    atomic = getattr(coll, "update_one_atomic", None)
    if atomic is not None:
        res = await atomic(q, upd)
    else:
        res = await coll.update_one(q, upd)
    return int(getattr(res, "matched_count", 0) or 0) == 1


async def complete(db, company_id: str, key: str, response: Any) -> None:
    if not key:
        return
    cid = company_id_of(company_id)
    await db.idempotency_keys.update_one(
        {"_id": _doc_id(cid, key), "company_id": cid},
        {"$set": {"status": "completed", "response": response, "updated_at": _now().isoformat()}},
    )


async def mark_payment_applied(db, company_id: str, key: str, payment: Dict[str, Any]) -> None:
    """Para hareketi yazıldı. Çökme sonrası aynı ödeme tekrar kesilmesin."""
    if not key:
        return
    cid = company_id_of(company_id)
    await db.idempotency_keys.update_one(
        {"_id": _doc_id(cid, key), "company_id": cid},
        {"$set": {
            "payment_applied": True,
            "payment": payment,
            "updated_at": _now().isoformat(),
        }},
    )


async def clear_payment_applied(db, company_id: str, key: str) -> None:
    """Yumuşak hata geri alındığında 'yazıldı' işaretini kaldır."""
    if not key:
        return
    cid = company_id_of(company_id)
    await db.idempotency_keys.update_one(
        {"_id": _doc_id(cid, key), "company_id": cid},
        {"$set": {"payment_applied": False, "updated_at": _now().isoformat()}, "$unset": {"payment": ""}},
    )


async def abandon(db, company_id: str, key: str) -> None:
    """Hata sonrası anahtarı bırak — yeniden denenebilsin."""
    if not key:
        return
    try:
        cid = company_id_of(company_id)
        await db.idempotency_keys.delete_one({"_id": _doc_id(cid, key), "company_id": cid})
    except Exception:
        logger.exception("Idempotency anahtarı silinemedi: %s", key)


async def _company_ttl_map(db) -> Dict[str, int]:
    try:
        import offline_sync

        mapped = await offline_sync.ttl_hours_map(db)
        if isinstance(mapped, dict):
            return mapped
    except Exception:
        logger.exception("idempotency ttl haritası okunamadı")
    return {}


def _past_ttl(doc: dict, hours: int, now: datetime) -> bool:
    created = _as_utc((doc or {}).get("created_at"))
    if created is None:
        return False
    return (now - created).total_seconds() > max(1, int(hours or TTL_HOURS)) * 3600


async def _purge_expired_routed(db) -> int:
    """Bayrak açık: süresi dolmuş anahtar her şirketin kendi deposunda silinir."""
    import storage_router

    hours_map = await _company_ttl_map(db)
    now = _now()
    deleted = 0
    async for cid, store in storage_router.iter_company_stores(db):
        hours = int(hours_map.get(cid) or TTL_HOURS)
        cutoff = (now - timedelta(hours=hours)).isoformat()
        try:
            stale = await store.idempotency_keys.find(
                {"company_id": cid, "created_at": {"$lt": cutoff}},
            ).to_list(5000)
            for doc in stale:
                try:
                    await store.idempotency_keys.delete_one({"_id": doc["_id"], "company_id": cid})
                    deleted += 1
                except Exception:
                    logger.exception("idempotency purge silinemedi: %s", doc.get("_id"))
        except Exception as exc:
            storage_router.log_store_failure(cid, exc)
    if deleted:
        logger.info("idempotency purge: %s anahtar silindi", deleted)
    return deleted


async def purge_expired(db) -> int:
    """Firma saklama süresini aşmış idempotency anahtarlarını sil. Silinen sayısı."""
    import storage_router

    if storage_router.enabled():
        return await _purge_expired_routed(db)
    now = _now()
    hours_map = await _company_ttl_map(db)
    # En kısa süre 1 saat. Daha yeni anahtarlar taranmaz; şirket süresi dolmayanlar atlanır.
    cutoff = (now - timedelta(hours=1)).isoformat()
    deleted = 0
    # tenant-ok: saatlik temizlik, süresi dolmuş anahtarları tüm şirketlerde tarar
    cursor = db.idempotency_keys.find({"created_at": {"$lt": cutoff}})
    sort = getattr(cursor, "sort", None)
    if callable(sort):
        sorted_cursor = sort("created_at", 1)
        if sorted_cursor is not None:
            cursor = sorted_cursor
    stale = await cursor.to_list(5000)
    for doc in stale:
        hours = int(hours_map.get(str(doc.get("company_id") or "")) or TTL_HOURS)
        if not _past_ttl(doc, hours, now):
            continue
        try:
            await db.idempotency_keys.delete_one({"_id": doc["_id"]})  # tenant-ok: saatlik temizlik, bulunan anahtarın _id'si
            deleted += 1
        except Exception:
            logger.exception("idempotency purge silinemedi: %s", doc.get("_id"))
    if deleted:
        logger.info("idempotency purge: %s anahtar silindi", deleted)
    return deleted


async def cleanup_loop(db) -> None:
    """Saatlik temizlik — platform_lease.run_exclusive altında çalışır."""
    while True:
        try:
            await purge_expired(db)
        except Exception:
            logger.exception("idempotency cleanup_loop hata")
        await asyncio.sleep(CLEANUP_EVERY_S)


async def run(
    db,
    company_id: str,
    request: Optional[Request],
    endpoint: str,
    fn: Callable[[], Awaitable[Any]],
) -> Any:
    key = header_key(request)
    state = await begin(db, company_id, key, endpoint)
    if state and state.get("hit"):
        return state["response"]
    try:
        result = await fn()
        if state is not None:
            await complete(db, company_id, key, result)
        return result
    except Exception:
        if state is not None:
            await abandon(db, company_id, key)
        raise
