"""Atölye kiosk cihaz eşleştirme.

Eşleştirme kodu ve cihaz token'ı düz metin saklanmaz. Token üretimi
attendance_security.new_device_token / hash_device_token ile yapılır.
Cihaz oturumu, shopfloor_accounts'ın anladığı atolye_device principal'idir.
"""
from __future__ import annotations

import hashlib
import hmac
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
from auth_utils import get_jwt_secret
from client_ip import request_ip

router = APIRouter(prefix="/api")
_current_user = None

ACCOUNT_TYPE = "atolye_device"
STATION_MODES = frozenset({"one", "many", "all"})
CODE_TTL = timedelta(minutes=10)
CODE_RATE_MAX = 10
CODE_RATE_WINDOW = timedelta(minutes=10)
PAIR_IP_MAX = 30
PAIR_GLOBAL_MAX = 300
PAIR_FAIL_MAX = 15
PAIR_RATE_WINDOW = timedelta(minutes=10)
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


def hash_pairing_code(code: str) -> str:
    """Eşleştirme kodu HMAC-SHA256. Anahtar JWT_SECRET; düz kod ve sır loglanmaz."""
    key = get_jwt_secret().encode("utf-8")
    return hmac.new(key, str(code or "").encode("utf-8"), hashlib.sha256).hexdigest()


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
        "role": ACCOUNT_TYPE,
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
    code_hash = hash_pairing_code(code)
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


def _pair_ip(request: Request) -> str:
    try:
        ip = request_ip(request)
    except Exception:
        ip = ""
    return str(ip or "").strip() or "unknown"


def _counter_id(kind: str, ip: str = "") -> str:
    if kind == "global":
        return "shopfloor_pair:global"
    if kind == "fail":
        return f"shopfloor_pair:fail:{ip}"
    return f"shopfloor_pair:ip:{ip}"


def _counter_fresh(state: Optional[dict], now: datetime) -> bool:
    if not state:
        return False
    start = shopfloor_pin._parse_dt(state.get("window_start"))
    if start is None:
        return False
    return _aware(now) - start <= PAIR_RATE_WINDOW


def _counter_value(state: Optional[dict], now: datetime, field: str) -> int:
    if not _counter_fresh(state, now):
        return 0
    return int((state or {}).get(field) or 0)


async def _load_pair_counter(identifier: str) -> Optional[dict]:
    return await _db.login_attempts.find_one({"identifier": identifier})


async def _bump_pair_counter(identifier: str, now: datetime, field: str) -> None:
    state = await _load_pair_counter(identifier)
    now = _aware(now)
    if _counter_fresh(state, now):
        count = int((state or {}).get("count") or 0)
        fails = int((state or {}).get("fails") or 0)
        start = shopfloor_pin._parse_dt((state or {}).get("window_start")) or now
    else:
        count = 0
        fails = 0
        start = now
    if field == "fails":
        fails += 1
    else:
        count += 1
    await _db.login_attempts.update_one(
        {"identifier": identifier},
        {"$set": {
            "identifier": identifier,
            "count": count,
            "fails": fails,
            "window_start": _iso(start),
            "last_attempt": _iso(now),
        }},
        upsert=True,
    )


async def _pair_limited(ip: str, now: datetime) -> bool:
    ip_state = await _load_pair_counter(_counter_id("ip", ip))
    global_state = await _load_pair_counter(_counter_id("global"))
    fail_state = await _load_pair_counter(_counter_id("fail", ip))
    if _counter_value(ip_state, now, "count") >= PAIR_IP_MAX:
        return True
    if _counter_value(global_state, now, "count") >= PAIR_GLOBAL_MAX:
        return True
    return _counter_value(fail_state, now, "fails") >= PAIR_FAIL_MAX


async def _note_pair_attempt(ip: str, now: datetime) -> None:
    await _bump_pair_counter(_counter_id("ip", ip), now, "count")
    await _bump_pair_counter(_counter_id("global"), now, "count")


async def _note_pair_failure(ip: str, now: datetime) -> None:
    await _bump_pair_counter(_counter_id("fail", ip), now, "fails")


async def _claim_pairing_code(digest: str, now_iso: str) -> Optional[dict]:
    """Kodu koşullu yazmayla tüket. modified_count 1 değilse cihaz üretilmez.

    Cihaz kimliği kod belgesinin _id'sidir; ikinci kazanan aynı kimliği yazamaz.
    """
    coll = _db.shopfloor_device_codes
    # tenant-ok: eşleştirme kodu hash'i şirket taşımaz; şirket tüketilen belgeden okunur
    row = await coll.find_one({
        "code_hash": digest,
        "consumed_at": None,
        "expires_at": {"$gt": now_iso},
    })
    if not row or not row.get("_id"):
        return None
    code_id = row["_id"]
    device_id = str(code_id)
    query = {
        "_id": code_id,
        "consumed_at": None,
        "expires_at": {"$gt": now_iso},
    }
    update = {"$set": {"consumed_at": now_iso, "device_id": device_id}}
    atomic = getattr(coll, "update_one_atomic", None)
    if callable(atomic):
        # tenant-ok: koşullu tüketim kod _id kilidiyle yapılır; company_id kod belgesindedir
        result = await atomic(query, update)
    else:
        # tenant-ok: koşullu update consumed_at boş filtresiyle; modified_count 1 şart
        result = await coll.update_one(query, update)
    if int(getattr(result, "modified_count", 0) or 0) != 1:
        return None
    # tenant-ok: tüketilen kodun şirketi bu _id ile okunur, istemciden alınmaz
    fresh = await coll.find_one({"_id": code_id})
    if not fresh:
        return None
    fresh["device_id"] = device_id
    return fresh


@router.post("/shopfloor/devices/pair")
async def pair_device(request: Request, req: Optional[dict] = None):
    """Herkese açık eşleştirme. Geçerli kodu uzun ömürlü cihaz token'ına çevirir.

    İstekteki company_id yok sayılır; cihaz kodun şirketine yazılır.
    """
    ip = _pair_ip(request)
    now = utcnow()
    if await _pair_limited(ip, now):
        raise HTTPException(status_code=429, detail=shopfloor_pin.RATE_DETAIL)
    await _note_pair_attempt(ip, now)
    body = req or {}
    code = _clean_code(body.get("code"))
    if not code:
        await _note_pair_failure(ip, now)
        raise HTTPException(status_code=400, detail=PAIR_DETAIL)
    now_iso = _iso(now)
    digest = hash_pairing_code(code)
    consumed = await _claim_pairing_code(digest, now_iso)
    if not consumed:
        await _note_pair_failure(ip, now)
        raise HTTPException(status_code=400, detail=PAIR_DETAIL)
    cid = str(consumed.get("company_id") or "").strip()
    device_id = str(consumed.get("device_id") or consumed.get("_id") or "").strip()
    if not cid or not device_id:
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
