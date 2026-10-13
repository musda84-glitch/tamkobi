"""HTTP Idempotency-Key: company_id + anahtar, 24 saat TTL."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, Optional

from fastapi import HTTPException, Request

try:
    from pymongo.errors import DuplicateKeyError
except ImportError:  # pragma: no cover
    class DuplicateKeyError(Exception):
        """pymongo yoksa yer tutucu."""

logger = logging.getLogger("idempotency")

TTL_HOURS = 24
_INDEXED = False


def _now() -> datetime:
    return datetime.now(timezone.utc)


def header_key(request: Optional[Request]) -> str:
    if request is None:
        return ""
    raw = (
        request.headers.get("Idempotency-Key")
        or request.headers.get("idempotency-key")
        or ""
    )
    return str(raw).strip()[:200]


def _doc_id(company_id: str, key: str) -> str:
    return f"{company_id}:{key}"


async def ensure_indexes(db) -> None:
    global _INDEXED
    if _INDEXED:
        return
    try:
        await db.idempotency_keys.create_index(
            [("company_id", 1), ("key", 1)], unique=True, name="idempo_company_key"
        )
        await db.idempotency_keys.create_index(
            "created_at", expireAfterSeconds=TTL_HOURS * 3600, name="idempo_ttl"
        )
        _INDEXED = True
    except Exception:
        logger.exception("idempotency_keys index oluşturulamadı")


async def begin(db, company_id: str, key: str, endpoint: str) -> Optional[Dict[str, Any]]:
    """None → anahtar yok (normal akış). hit=True → cached response. hit=False → devam et."""
    key = (key or "").strip()
    if not key:
        return None
    cid = str(company_id or "").strip() or "_"
    await ensure_indexes(db)
    now = _now()
    doc = {
        "_id": _doc_id(cid, key),
        "company_id": cid,
        "key": key,
        "endpoint": endpoint,
        "status": "in_progress",
        "created_at": now,
        "updated_at": now,
    }
    try:
        await db.idempotency_keys.insert_one(doc)
        return {"hit": False, "key": key, "company_id": cid}
    except DuplicateKeyError:
        existing = await db.idempotency_keys.find_one({"_id": _doc_id(cid, key)})
        if not existing:
            raise HTTPException(status_code=409, detail="Idempotency çakışması.")
        age = now - (existing.get("created_at") or now)
        if getattr(age, "total_seconds", lambda: 0)() > TTL_HOURS * 3600:
            await db.idempotency_keys.delete_one({"_id": existing["_id"]})
            await db.idempotency_keys.insert_one(doc)
            return {"hit": False, "key": key, "company_id": cid}
        if existing.get("status") == "completed" and existing.get("response") is not None:
            return {"hit": True, "response": existing["response"], "key": key, "company_id": cid}
        if existing.get("status") == "in_progress":
            raise HTTPException(
                status_code=409,
                detail="Aynı Idempotency-Key ile işlem devam ediyor.",
            )
        raise HTTPException(status_code=409, detail="Idempotency-Key daha önce kullanıldı.")


async def complete(db, company_id: str, key: str, response: Any) -> None:
    if not key:
        return
    await db.idempotency_keys.update_one(
        {"_id": _doc_id(str(company_id or "_"), key)},
        {"$set": {"status": "completed", "response": response, "updated_at": _now()}},
    )


async def abandon(db, company_id: str, key: str) -> None:
    """Hata sonrası anahtarı bırak — yeniden denenebilsin."""
    if not key:
        return
    try:
        await db.idempotency_keys.delete_one({"_id": _doc_id(str(company_id or "_"), key)})
    except Exception:
        logger.exception("Idempotency anahtarı silinemedi: %s", key)


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
