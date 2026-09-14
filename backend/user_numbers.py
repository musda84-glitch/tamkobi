"""Human-readable kullanıcı numarası (U-000123)."""
from __future__ import annotations

from typing import Any, Dict, Optional


async def next_user_number(db) -> str:
    """Global artan kullanıcı no. İlk çağrıda mevcut kullanıcı sayısından tohumlanır."""
    key = "USER_NO"
    if not await db.counters.find_one({"_id": key}):
        seed = await db.users.count_documents({})
        await db.counters.update_one({"_id": key}, {"$setOnInsert": {"seq": int(seed)}}, upsert=True)
    c = await db.counters.find_one_and_update(
        {"_id": key},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    seq = int((c or {}).get("seq") or 1)
    return f"U-{seq:06d}"


async def ensure_user_number(db, user: Optional[Dict[str, Any]]) -> Optional[str]:
    """Kullanıcıda user_number yoksa atar; varsa döner."""
    if not user:
        return None
    existing = (user.get("user_number") or "").strip()
    if existing:
        return existing
    uid = user.get("_id") or user.get("id")
    if not uid:
        return None
    num = await next_user_number(db)
    res = await db.users.find_one_and_update(
        {
            "_id": uid,
            "$or": [
                {"user_number": {"$exists": False}},
                {"user_number": None},
                {"user_number": ""},
            ],
        },
        {"$set": {"user_number": num}},
        return_document=True,
    )
    if res and res.get("user_number"):
        user["user_number"] = res["user_number"]
        return res["user_number"]
    again = await db.users.find_one({"_id": uid})
    num2 = (again or {}).get("user_number") or num
    user["user_number"] = num2
    return num2


async def backfill_missing_user_numbers(db, limit: int = 5000) -> int:
    """Eksik numaralı kullanıcıları doldurur (startup / bakım)."""
    n = 0
    async for u in db.users.find(
        {"$or": [{"user_number": {"$exists": False}}, {"user_number": None}, {"user_number": ""}]},
        {"_id": 1},
    ).limit(limit):
        await ensure_user_number(db, u)
        n += 1
    return n
