"""İnsan okur şirket numarası (Şirket ID).

Birincil anahtar `comp_…` değişmez. `company_no` 100001'den başlayan
benzersiz tamsayıdır. Eksikler açılışta `created_at`, sonra `id` sırasıyla
doldurulur (`user_numbers.backfill_missing_user_numbers` ile aynı an).

Yeni numara sayaç belgesinde karşılaştır-ve-yaz ile alınır. `update_one_atomic`
satır kilidi altında `seq` eşleşmesini kontrol eder; iki kayıt aynı anda
aynı numarayı alamaz. Koleksiyonda atomik güncelleme yoksa (test çiftleri)
`find_one_and_update` `$inc` yolu kullanılır.
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from mysql_store import DuplicateKeyError

START = 100001
KEY = "COMPANY_NO"
_ATTEMPTS = 64

_MISSING = {
    "$or": [
        {"company_no": {"$exists": False}},
        {"company_no": None},
    ]
}


def as_int(value: Any) -> Optional[int]:
    """Pozitif tamsayı. Bool ve kesirli sayı numara değildir."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value if value >= 1 else None
    if isinstance(value, float) and value.is_integer():
        n = int(value)
        return n if n >= 1 else None
    if isinstance(value, str):
        text = value.strip()
        if text.isdigit():
            n = int(text)
            return n if n >= 1 else None
    return None


def matches_exact(value: Any, needle: str) -> bool:
    """`needle` company_no'nun tam yazımıysa eşleşir (`10000` ≠ `100001`)."""
    n = as_int(value)
    if n is None:
        return False
    return (needle or "") == str(n)


async def _to_list(cursor, limit: Optional[int]) -> list:
    if cursor is None:
        return []
    if hasattr(cursor, "to_list"):
        return list(await cursor.to_list(limit) or [])
    rows = []
    async for row in cursor:
        rows.append(row)
        if limit is not None and len(rows) >= limit:
            break
    return rows


async def _max_company_no(db) -> int:
    """Kayıtlı en büyük company_no, yoksa START - 1."""
    best = START - 1
    cursor = db.companies.find({}, {"_id": 1, "company_no": 1})
    for row in await _to_list(cursor, None):
        n = as_int((row or {}).get("company_no"))
        if n is not None and n > best:
            best = n
    return best


async def _ensure_counter(db) -> None:
    existing = await db.counters.find_one({"_id": KEY})
    if existing is not None and existing.get("seq") is not None:
        return
    seed = await _max_company_no(db)
    try:
        await db.counters.update_one(
            {"_id": KEY},
            {"$setOnInsert": {"seq": int(seed)}},
            upsert=True,
        )
    except DuplicateKeyError:
        return


async def next_company_no(db) -> int:
    """Sonraki Şirket ID. Eşzamanlı çağrılar farklı numara alır."""
    await _ensure_counter(db)
    atomic = getattr(db.counters, "update_one_atomic", None)
    if callable(atomic):
        for _ in range(_ATTEMPTS):
            doc = await db.counters.find_one({"_id": KEY})
            cur = as_int((doc or {}).get("seq"))
            if cur is None:
                await _ensure_counter(db)
                continue
            nxt = cur + 1
            res = await atomic({"_id": KEY, "seq": cur}, {"$set": {"seq": nxt}})
            if int(getattr(res, "matched_count", 0) or 0) == 1:
                return nxt
        raise RuntimeError("company_no sayacı atanamadı")
    c = await db.counters.find_one_and_update(
        {"_id": KEY},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=True,
    )
    seq = as_int((c or {}).get("seq"))
    if seq is None or seq < START:
        raise RuntimeError("company_no sayacı atanamadı")
    return seq


async def ensure_company_no(db, company: Optional[Dict[str, Any]]) -> Optional[int]:
    """Şirkette company_no yoksa atar; varsa aynı değeri döner."""
    if not company:
        return None
    existing = as_int(company.get("company_no"))
    if existing is not None:
        company["company_no"] = existing
        return existing
    cid = company.get("_id") or company.get("id")
    if not cid:
        return None
    fresh = await db.companies.find_one({"_id": cid}, {"company_no": 1})
    held = as_int((fresh or {}).get("company_no"))
    if held is not None:
        company["company_no"] = held
        return held
    num = await next_company_no(db)
    res = await db.companies.find_one_and_update(
        {"_id": cid, **_MISSING},
        {"$set": {"company_no": num}},
        return_document=True,
    )
    got = as_int((res or {}).get("company_no"))
    if got is None:
        again = await db.companies.find_one({"_id": cid}, {"company_no": 1})
        got = as_int((again or {}).get("company_no"))
    if got is None:
        await db.companies.update_one({"_id": cid}, {"$set": {"company_no": num}})
        got = num
    company["company_no"] = got
    return got


def _backfill_key(row: dict) -> tuple:
    return (str(row.get("created_at") or ""), str(row.get("_id") or row.get("id") or ""))


async def backfill_missing_company_numbers(db, limit: int = 5000) -> int:
    """Eksik company_no değerlerini created_at, sonra id sırasıyla doldurur.

    Numarası olan kayıt değişmez. İkinci çağrı yeni numara yazmaz.
    """
    cursor = db.companies.find(
        _MISSING,
        {"_id": 1, "id": 1, "created_at": 1, "company_no": 1},
    )
    if hasattr(cursor, "sort"):
        cursor = cursor.sort([("created_at", 1), ("_id", 1)])
    rows = await _to_list(cursor, None)
    pending = [row for row in rows if as_int((row or {}).get("company_no")) is None]
    pending.sort(key=_backfill_key)
    cap = max(0, int(limit))
    n = 0
    for row in pending[:cap]:
        before = as_int(row.get("company_no"))
        assigned = await ensure_company_no(db, row)
        if assigned is not None and before != assigned:
            n += 1
    return n
