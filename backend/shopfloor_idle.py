"""Operatör oturumunda kayan boşta kilit.

Mutlak üst sınır shopfloor_pin.TOKEN_MAX (12 saat) olarak kalır.
Son aktivite token'ın kendisinde değil, şirketli oturum satırındadır.
Token ve PIN yazılmaz.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import HTTPException

import shopfloor_pin
import shopfloor_settings

IDLE_CODE = "shopfloor_idle_locked"
IDLE_MESSAGE = "Oturum boşta kaldığı için kilitlendi. PIN ile tekrar açın."


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _iat(payload: dict) -> Optional[datetime]:
    raw = (payload or {}).get("iat")
    if raw is None or raw == "":
        return None
    if isinstance(raw, datetime):
        return _aware(raw)
    try:
        return datetime.fromtimestamp(float(raw), tz=timezone.utc)
    except (TypeError, ValueError, OSError):
        return None


def session_id(company_id: str, aid: str, oid: str, iat: datetime) -> str:
    raw = f"{company_id}|{aid}|{oid}|{int(_aware(iat).timestamp())}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def idle_state(
    *,
    iat: datetime,
    last_activity: datetime,
    now: datetime,
    idle_minutes: int,
) -> str:
    """ok | absolute | idle. Saf karar; veritabanı yok."""
    now = _aware(now)
    iat = _aware(iat)
    last_activity = _aware(last_activity)
    if now > iat + shopfloor_pin.TOKEN_MAX:
        return "absolute"
    limit = max(shopfloor_settings.IDLE_MIN, min(shopfloor_settings.IDLE_MAX, int(idle_minutes)))
    if now - last_activity > timedelta(minutes=limit):
        return "idle"
    return "ok"


async def enforce(db, payload: dict, company_id: str) -> None:
    """Yetkili shopfloor isteği. Süre dolduysa 401; değilse son aktiviteyi kaydırır."""
    cid = str(company_id or "").strip()
    issued = _iat(payload or {})
    if not cid or issued is None:
        raise HTTPException(status_code=401, detail=shopfloor_pin.TOKEN_DETAIL)
    now = _aware(utcnow())
    company = await shopfloor_settings.load_company(db, cid)
    minutes = shopfloor_settings.idle_minutes(company)
    aid = str((payload or {}).get("aid") or "")
    oid = str((payload or {}).get("oid") or "")
    sid = session_id(cid, aid, oid, issued)
    row = await db.shopfloor_operator_sessions.find_one({"_id": sid, "company_id": cid})
    last = issued
    if isinstance(row, dict):
        parsed = shopfloor_pin._parse_dt(row.get("last_activity"))
        if parsed is not None:
            last = parsed
    state = idle_state(iat=issued, last_activity=last, now=now, idle_minutes=minutes)
    if state == "absolute":
        raise HTTPException(status_code=401, detail=shopfloor_pin.TOKEN_DETAIL)
    if state == "idle":
        raise HTTPException(
            status_code=401,
            detail={"code": IDLE_CODE, "message": IDLE_MESSAGE},
        )
    stamp = now.isoformat()
    if isinstance(row, dict):
        await db.shopfloor_operator_sessions.update_one(
            {"_id": sid, "company_id": cid},
            {"$set": {"last_activity": stamp, "company_id": cid}},
        )
        return
    await db.shopfloor_operator_sessions.insert_one({
        "_id": sid,
        "company_id": cid,
        "aid": aid,
        "oid": oid,
        "last_activity": stamp,
        "created_at": stamp,
    })
