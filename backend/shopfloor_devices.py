"""Atölye kiosk cihaz eşleştirme.

Eşleştirme kodu ve cihaz token'ı düz metin saklanmaz. Token üretimi
attendance_security.new_device_token / hash_device_token ile yapılır.
Cihaz oturumu, shopfloor_accounts'ın anladığı atolye_device principal'idir.
"""
from __future__ import annotations

import re
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

import attendance_security
import shopfloor_accounts
import shopfloor_pin
import tenant_access
from attendance_security import clean_device_token, device_token_matches, hash_device_token, new_device_token

router = APIRouter(prefix="/api")
_current_user = None

ACCOUNT_TYPE = "atolye_device"
STATION_MODES = frozenset({"one", "many", "all"})
CODE_TTL = timedelta(minutes=10)
CODE_RATE_MAX = 10
CODE_RATE_WINDOW = timedelta(minutes=10)
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_RE = re.compile(rf"^[{CODE_ALPHABET}]{{6}}$")
PAIR_DETAIL = "Eşleştirme kodu geçersiz veya süresi dolmuş."
DEVICE_NOT_FOUND = "Cihaz bulunamadı."
LABEL_MAX = 80


class _LiveDB:
    """Sorgular güncel server.db'yi kullanır (testler server.db'yi değiştirir)."""

    def __getattr__(self, name):
        import server
        return getattr(server.db, name)

    def __getitem__(self, name):
        import server
        return server.db[name]


_db = _LiveDB()


def init(db, get_current_user) -> None:
    """db argümanı shopfloor_accounts.init ile aynı imza içindir."""
    global _current_user
    _current_user = get_current_user
    if db is None:
        return


async def ensure_indexes(db) -> None:
    await db.shopfloor_devices.create_index([("company_id", 1), ("status", 1)])
    await db.shopfloor_devices.create_index("token_hash", unique=True)
    await db.shopfloor_device_codes.create_index("code_hash", unique=True)
    await db.shopfloor_device_codes.create_index([("company_id", 1), ("created_at", 1)])


async def _user_dep(request: Request) -> dict:
    if _current_user is None:
        raise HTTPException(status_code=500, detail="Atölye cihaz yetkisi bağlanmadı.")
    return await _current_user(request)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(now: Optional[datetime]) -> datetime:
    if now is None:
        return utcnow()
    if now.tzinfo is None:
        return now.replace(tzinfo=timezone.utc)
    return now.astimezone(timezone.utc)


def _iso(now: datetime) -> str:
    return _aware(now).isoformat()


def looks_like_device_token(token: str) -> bool:
    """JWT iki nokta taşır. Cihaz token'ı şirket öneki ve tek nokta taşır."""
    text = clean_device_token(token)
    if not text:
        return False
    return text.count(".") != 2


def _new_code() -> str:
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))


def _clean_code(raw: Any) -> str:
    text = str(raw or "").strip().upper()
    if CODE_RE.fullmatch(text) is None:
        return ""
    return text


def _clean_label(raw: Any) -> str:
    return str(raw or "").strip()[:LABEL_MAX]


def _code_subject(company_id: str) -> str:
    return f"devcode:{company_id}"


def _rate_blocked(state: Optional[dict], now: datetime) -> bool:
    if not state:
        return False
    now = _aware(now)
    start = shopfloor_pin._parse_dt(state.get("window_start"))
    if start is None or now - start > CODE_RATE_WINDOW:
        return False
    return int(state.get("fails") or 0) >= CODE_RATE_MAX


def _rate_mark(state: Optional[dict], now: datetime) -> dict:
    now = _aware(now)
    state = state or {}
    start = shopfloor_pin._parse_dt(state.get("window_start"))
    fails = int(state.get("fails") or 0)
    if start is None or now - start > CODE_RATE_WINDOW:
        return {"fails": 1, "window_start": now.isoformat(), "locked_until": None}
    return {
        "fails": fails + 1,
        "window_start": start.isoformat(),
        "locked_until": None,
    }


async def _load_rate(company_id: str) -> Optional[dict]:
    return await _db.shopfloor_pin_attempts.find_one({
        "company_id": str(company_id),
        "subject": _code_subject(company_id),
    })


async def _save_rate(company_id: str, state: dict) -> None:
    subject = _code_subject(company_id)
    await _db.shopfloor_pin_attempts.update_one(
        {"company_id": str(company_id), "subject": subject},
        {"$set": {
            "company_id": str(company_id),
            "subject": subject,
            "fails": int(state.get("fails") or 0),
            "window_start": state.get("window_start"),
            "locked_until": state.get("locked_until"),
        }},
        upsert=True,
    )


async def _require_device_admin(user: dict, company_id: str) -> None:
    if shopfloor_accounts.is_atolye_user(user) or shopfloor_accounts.is_device_user(user):
        shopfloor_accounts.log_denied(user)
        raise HTTPException(status_code=403, detail=shopfloor_accounts.ACTION_DENIED)
    await tenant_access.require_company_admin(user, company_id)


def _actor(user: dict) -> str:
    return str((user or {}).get("_id") or (user or {}).get("id") or "")


async def _assignment(company_id: str, mode_raw: Any, stations_raw: Any) -> tuple:
    mode = str(mode_raw or "").strip().casefold()
    if mode not in STATION_MODES:
        raise HTTPException(status_code=400, detail="station_mode one, many veya all olmalı.")
    if stations_raw is None:
        stations_raw = []
    if not isinstance(stations_raw, list):
        raise HTTPException(status_code=400, detail="stations liste olmalı.")
    if mode == "all":
        return "all", []
    catalog = await shopfloor_accounts.company_station_catalog(_db, company_id)
    canonical, unknown = shopfloor_accounts.resolve_station_names(stations_raw, catalog)
    if unknown:
        raise HTTPException(status_code=400, detail=f"Bilinmeyen istasyon: {unknown[0]}")
    if mode == "one" and len(canonical) != 1:
        raise HTTPException(status_code=400, detail="Tek istasyon modunda tam bir istasyon gerekli.")
    if mode == "many" and not canonical:
        raise HTTPException(status_code=400, detail="Çoklu istasyon modunda en az bir istasyon gerekli.")
    return mode, canonical


def _public_device(row: dict) -> dict:
    return {
        "id": row.get("_id"),
        "company_id": row.get("company_id"),
        "label": row.get("label") or "",
        "station_mode": row.get("station_mode"),
        "stations": list(row.get("stations") or []),
        "status": row.get("status"),
        "created_by": row.get("created_by") or "",
        "created_at": row.get("created_at"),
        "last_seen": row.get("last_seen"),
    }


async def _device_in_company(device_id: str, company_id: str) -> Optional[dict]:
    if not str(device_id or "").strip():
        return None
    return await _db.shopfloor_devices.find_one({
        "_id": str(device_id),
        "company_id": str(company_id),
    })


def _split_device_token(token: str) -> tuple:
    presented = clean_device_token(token)
    if not presented:
        return "", ""
    company_id, sep, secret = presented.rpartition(".")
    if not sep or not company_id or not secret:
        return "", ""
    return company_id, presented


async def _stations_for(db, row: dict) -> list:
    mode = str(row.get("station_mode") or "")
    company_id = str(row.get("company_id") or "")
    if mode == "all":
        return await shopfloor_accounts.company_station_catalog(db, company_id)
    names = []
    for item in row.get("stations") or []:
        text = str(item or "").strip()
        if text:
            names.append(text)
    return names


def _principal(row: dict, stations: list) -> dict:
    device_id = str(row.get("_id") or "")
    company_id = str(row.get("company_id") or "")
    label = str(row.get("label") or "").strip() or "Atölye cihazı"
    return {
        "_id": device_id,
        "id": device_id,
        "account_type": ACCOUNT_TYPE,
        "company_id": company_id,
        "company_ids": [company_id] if company_id else [],
        "active_company_id": company_id,
        "shopfloor_stations": list(stations),
        "station_mode": row.get("station_mode"),
        "role": "admin",
        "name": label,
        "email": "",
        "is_active": True,
        "is_super_admin": False,
        "user_number": f"DEV-{device_id}",
        "preferences": {},
    }


async def principal_from_token(token: str, db) -> Optional[dict]:
    """Geçerli cihaz token'ını atolye principal'ine çevirir. Düz metin yazılmaz."""
    company_id, presented = _split_device_token(token)
    if not company_id or not presented:
        return None
    digest = hash_device_token(presented)
    row = await db.shopfloor_devices.find_one({
        "company_id": company_id,
        "token_hash": digest,
    })
    if not row or str(row.get("status") or "") != "active":
        return None
    if not device_token_matches(presented, row.get("token_hash")):
        return None
    stations = await _stations_for(db, row)
    await db.shopfloor_devices.update_one(
        {"_id": row["_id"], "company_id": company_id, "status": "active"},
        {"$set": {"last_seen": _iso(utcnow())}},
    )
    return _principal(row, stations)


def _bearer(company_id: str) -> tuple:
    secret = new_device_token()
    token = f"{company_id}.{secret}"
    return token, hash_device_token(token)


@router.post("/shopfloor/devices/pairing-codes")
async def create_pairing_code(req: Optional[dict] = None, user: dict = Depends(_user_dep)):
    """Şirket admini tek kullanımlık eşleştirme kodu üretir. Kod yalnız yanıtta döner."""
    body = req or {}
    cid = tenant_access.resolve_company_id(user, body.get("company_id"))
    await _require_device_admin(user, cid)
    mode, stations = await _assignment(
        cid,
        body.get("station_mode") or "all",
        body.get("stations") if "stations" in body else [],
    )
    label = _clean_label(body.get("label"))
    now = utcnow()
    state = await _load_rate(cid)
    if _rate_blocked(state, now):
        raise HTTPException(status_code=429, detail=shopfloor_pin.RATE_DETAIL)
    await _save_rate(cid, _rate_mark(state, now))
    code = _new_code()
    code_hash = hash_device_token(code)
    expires = now + CODE_TTL
    await _db.shopfloor_device_codes.insert_one({
        "_id": str(uuid.uuid4()),
        "company_id": cid,
        "code_hash": code_hash,
        "expires_at": _iso(expires),
        "consumed_at": None,
        "device_id": "",
        "label": label,
        "station_mode": mode,
        "stations": stations,
        "created_by": _actor(user),
        "created_at": _iso(now),
    })
    await shopfloor_pin._audit(cid, "create_code", actor_user_id=_actor(user))
    return {
        "status": "success",
        "code": code,
        "expires_at": _iso(expires),
        "label": label,
        "station_mode": mode,
        "stations": stations,
    }


@router.get("/shopfloor/devices")
async def list_devices(company_id: Optional[str] = None, user: dict = Depends(_user_dep)):
    cid = tenant_access.resolve_company_id(user, company_id)
    await _require_device_admin(user, cid)
    rows = await _db.shopfloor_devices.find({"company_id": cid}).to_list(500)
    return [_public_device(row) for row in rows]


@router.put("/shopfloor/devices/{device_id}")
async def update_device(device_id: str, req: Optional[dict] = None, user: dict = Depends(_user_dep)):
    body = req or {}
    cid = tenant_access.resolve_company_id(user, body.get("company_id"))
    await _require_device_admin(user, cid)
    row = await _device_in_company(device_id, cid)
    if not row or str(row.get("status") or "") == "revoked":
        raise HTTPException(status_code=404, detail=DEVICE_NOT_FOUND)
    mode_raw = body.get("station_mode") if "station_mode" in body else row.get("station_mode")
    if "stations" in body:
        stations_raw = body.get("stations")
    else:
        stations_raw = list(row.get("stations") or [])
    mode, stations = await _assignment(cid, mode_raw, stations_raw)
    label = _clean_label(body.get("label")) if "label" in body else str(row.get("label") or "")
    await _db.shopfloor_devices.update_one(
        {"_id": row["_id"], "company_id": cid},
        {"$set": {
            "label": label,
            "station_mode": mode,
            "stations": stations,
        }},
    )
    await shopfloor_pin._audit(
        cid, "update", actor_user_id=_actor(user), operator_id=str(row["_id"]),
    )
    fresh = await _device_in_company(row["_id"], cid)
    return {"status": "success", "device": _public_device(fresh or row)}


@router.post("/shopfloor/devices/{device_id}/revoke")
async def revoke_device(
    device_id: str,
    company_id: Optional[str] = None,
    user: dict = Depends(_user_dep),
):
    cid = tenant_access.resolve_company_id(user, company_id)
    await _require_device_admin(user, cid)
    row = await _device_in_company(device_id, cid)
    if not row:
        raise HTTPException(status_code=404, detail=DEVICE_NOT_FOUND)
    if str(row.get("status") or "") != "revoked":
        await _db.shopfloor_devices.update_one(
            {"_id": row["_id"], "company_id": cid},
            {"$set": {"status": "revoked"}},
        )
        await shopfloor_pin._audit(
            cid, "revoke", actor_user_id=_actor(user), operator_id=str(row["_id"]),
        )
    return {"status": "success", "device_status": "revoked", "id": row["_id"]}


@router.post("/shopfloor/devices/pair")
async def pair_device(req: Optional[dict] = None):
    """Herkese açık eşleştirme. Geçerli kodu uzun ömürlü cihaz token'ına çevirir.

    İstekteki company_id yok sayılır; cihaz kodun şirketine yazılır.
    """
    body = req or {}
    code = _clean_code(body.get("code"))
    if not code:
        raise HTTPException(status_code=400, detail=PAIR_DETAIL)
    now = utcnow()
    now_iso = _iso(now)
    digest = hash_device_token(code)
    device_id = str(uuid.uuid4())
    # tenant-ok: eşleştirme kodu hash'i tek kullanımlık anahtardır; şirket kod belgesinden çözülür, cihaz yalnız o şirkete yazılır
    consumed = await _db.shopfloor_device_codes.find_one_and_update(
        {
            "code_hash": digest,
            "consumed_at": None,
            "expires_at": {"$gt": now_iso},
        },
        {"$set": {"consumed_at": now_iso, "device_id": device_id}},
    )
    if not consumed:
        raise HTTPException(status_code=400, detail=PAIR_DETAIL)
    cid = str(consumed.get("company_id") or "").strip()
    if not cid:
        raise HTTPException(status_code=400, detail=PAIR_DETAIL)
    token, token_hash = _bearer(cid)
    if not device_token_matches(token, token_hash):
        raise HTTPException(status_code=500, detail="Cihaz jetonu üretilemedi.")
    await _db.shopfloor_devices.insert_one({
        "_id": device_id,
        "company_id": cid,
        "label": consumed.get("label") or "",
        "station_mode": consumed.get("station_mode") or "all",
        "stations": list(consumed.get("stations") or []),
        "status": "active",
        "token_hash": token_hash,
        "created_by": consumed.get("created_by") or "",
        "created_at": now_iso,
        "last_seen": None,
    })
    await shopfloor_pin._audit(
        cid, "pair", atolye_user_id=device_id, operator_id=device_id,
    )
    return {
        "status": "success",
        "token": token,
        "device_id": device_id,
        "label": consumed.get("label") or "",
        "station_mode": consumed.get("station_mode") or "all",
        "stations": list(consumed.get("stations") or []),
    }
