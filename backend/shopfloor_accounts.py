"""Atölye hesap tipi.

users.account_type ("atolye" | yok/"standard") ve users.shopfloor_stations
yalnız şirket admini tarafından atanır. Saf kararlar burada durur; rbac.py
kullanıcı oluşturma/düzenleme beyaz listesinde bu alanlar zaten yoktur.
"""
from __future__ import annotations

from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

import applog
import tenant_access
from shopfloor_operators import station_key

router = APIRouter(prefix="/api")
_db = None
_current_user = None

ACCOUNT_ATOLYE = "atolye"
ACCOUNT_STANDARD = "standard"
_ALLOWED_TYPES = frozenset({ACCOUNT_ATOLYE, ACCOUNT_STANDARD})

PATH_DENIED = "Bu hesap yalnızca atölye ekranına erişebilir."
STATION_DENIED = "Bu istasyon için yetkiniz yok."
ACTION_DENIED = "Bu işlem atölye hesabına kapalı."


def init(db, get_current_user) -> None:
    global _db, _current_user
    _db, _current_user = db, get_current_user


async def _user_dep(request: Request) -> dict:
    if _current_user is None:
        raise HTTPException(status_code=500, detail="Atölye hesap yetkisi bağlanmadı.")
    return await _current_user(request)


def is_atolye_user(user: Any) -> bool:
    if not isinstance(user, dict):
        return False
    return str(user.get("account_type") or "").strip().casefold() == ACCOUNT_ATOLYE


def public_account_type(user: Any) -> str:
    return ACCOUNT_ATOLYE if is_atolye_user(user) else ACCOUNT_STANDARD


def public_stations(user: Any) -> list:
    if not isinstance(user, dict):
        return []
    raw = user.get("shopfloor_stations")
    if not isinstance(raw, list):
        return []
    out = []
    for item in raw:
        name = str(item or "").strip()
        if name:
            out.append(name)
    return out


def _norm_path(path: str) -> str:
    return (path or "").split("?", 1)[0].rstrip("/") or "/"


def _admin_work_order_denied(method: str, path: str) -> bool:
    """Atölye hesabının kullanamayacağı yönetici iş emri uçları."""
    if method != "POST":
        return False
    if path in (
        "/api/production/work-orders/shopfloor-settings",
        "/api/production/work-orders/trash-completed",
    ):
        return True
    parts = path.strip("/").split("/")
    if (
        len(parts) == 5
        and parts[0] == "api"
        and parts[1] == "production"
        and parts[2] == "work-orders"
        and parts[4] == "admin-trash"
        and parts[3]
    ):
        return True
    if (
        len(parts) == 6
        and parts[:4] == ["api", "production", "work-orders", "trash-requests"]
        and parts[5] == "decide"
        and parts[4]
    ):
        return True
    return False


def atolye_path_allowed(method: str, path: str) -> bool:
    """Atölye hesabının girebildiği /api yolları.

    /api/auth/*, GET /api/personnel/employees ve /api/production/work-orders/*
    (yönetici ayarı, çöp tamamlama, karar ve admin-trash hariç).
    """
    method_u = str(method or "GET").upper()
    p = _norm_path(path)
    if p == "/api/auth" or p.startswith("/api/auth/"):
        return True
    if method_u in ("GET", "HEAD") and p == "/api/personnel/employees":
        return True
    if p == "/api/production/work-orders" or p.startswith("/api/production/work-orders/"):
        return not _admin_work_order_denied(method_u, p)
    return False


def station_allowed(user: Any, station: Any) -> bool:
    """Atölye değilse her istasyon serbest. Karşılaştırma station_key (casefold)."""
    if not is_atolye_user(user):
        return True
    key = station_key(station)
    if not key:
        return False
    for name in public_stations(user):
        if station_key(name) == key:
            return True
    return False


def filter_work_orders_for_user(user: Any, rows: Any) -> list:
    items = list(rows or [])
    if not is_atolye_user(user):
        return items
    return [
        row for row in items
        if isinstance(row, dict) and station_allowed(user, row.get("station"))
    ]


def filter_station_names(user: Any, names: Any) -> list:
    items = list(names or [])
    if not is_atolye_user(user):
        return items
    return [name for name in items if station_allowed(user, name)]


def station_query_values(user: Any, station: Any = None) -> list:
    """İş emri sorgusundaki kanonik istasyon adları.

    Atamada katalog yazımı saklanır. station boşsa listenin tamamı,
    doluysa yalnız o adın station_key ile eşleşen yazımı.
    """
    names = public_stations(user)
    if station is None or not str(station).strip():
        return names
    want = station_key(station)
    if not want:
        return []
    return [name for name in names if station_key(name) == want]


def resolve_station_names(requested: Any, catalog: Any) -> tuple:
    """İstenen adları katalogdaki yazıma çevir. (canonical, unknown)."""
    by_key = {}
    for name in catalog or []:
        raw = str(name or "").strip()
        key = station_key(raw)
        if key and key not in by_key:
            by_key[key] = raw
    canonical = []
    unknown = []
    seen = set()
    for item in requested or []:
        raw = str(item or "").strip()
        key = station_key(raw)
        if not key:
            continue
        if key not in by_key:
            unknown.append(raw)
            continue
        if key in seen:
            continue
        seen.add(key)
        canonical.append(by_key[key])
    return canonical, unknown


def _log_fields(user: Any, *, user_id: str = "", company_id: str = "", station_count: Optional[int] = None) -> dict:
    src = user if isinstance(user, dict) else {}
    uid = str(user_id or src.get("_id") or src.get("id") or "")
    cid = str(company_id or src.get("active_company_id") or "").strip()
    if not cid:
        for item in src.get("company_ids") or []:
            text = str(item or "").strip()
            if text:
                cid = text
                break
    if station_count is None:
        raw = src.get("shopfloor_stations")
        station_count = len(raw) if isinstance(raw, list) else 0
    return {"user_id": uid, "company_id": cid, "station_count": int(station_count)}


def log_denied(user: Any) -> None:
    fields = _log_fields(user)
    applog.log_event("shopfloor_account_denied", "shopfloor_account_denied", **fields)


def log_assigned(user_id: str, company_id: str, station_count: int) -> None:
    applog.log_event(
        "shopfloor_account_assigned",
        "shopfloor_account_assigned",
        user_id=str(user_id or ""),
        company_id=str(company_id or ""),
        station_count=int(station_count),
    )


def enforce_station(user: Any, station: Any) -> None:
    if station_allowed(user, station):
        return
    log_denied(user)
    raise HTTPException(status_code=403, detail=STATION_DENIED)


def enforce_not_atolye(user: Any) -> None:
    if not is_atolye_user(user):
        return
    log_denied(user)
    raise HTTPException(status_code=403, detail=ACTION_DENIED)


async def company_station_catalog(db: Any, company_id: str) -> list:
    import work_parks as wp

    company = await db.companies.find_one({"_id": company_id}) or {}
    distinct = await db.work_orders.distinct("station", {"company_id": company_id})
    fallback = [s for s in (distinct or []) if s]
    return wp.station_names_from_parks(company.get("work_parks"), fallback)


def _parse_account_type(raw: Any) -> str:
    text = str(raw or "").strip().casefold()
    if text not in _ALLOWED_TYPES:
        raise HTTPException(status_code=400, detail="account_type atolye veya standard olmalı.")
    return text


@router.put("/users/{user_id}/shopfloor-account")
async def put_shopfloor_account(
    user_id: str,
    req: dict,
    company_id: Optional[str] = None,
    user: dict = Depends(_user_dep),
):
    """Şirket admini atölye hesap tipi ve istasyon listesini atar."""
    body = req or {}
    cid = tenant_access.resolve_company_id(user, company_id or body.get("company_id"))
    await tenant_access.require_company_admin(user, cid)
    account_type = _parse_account_type(body.get("account_type"))
    stations_in = body.get("shopfloor_stations", [])
    if stations_in is None:
        stations_in = []
    if not isinstance(stations_in, list):
        raise HTTPException(status_code=400, detail="shopfloor_stations liste olmalı.")
    target = await _db.users.find_one({"_id": user_id, "company_ids": cid})
    if not target:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı.")
    if account_type == ACCOUNT_ATOLYE and str(target.get("employee_id") or "").strip():
        raise HTTPException(
            status_code=400,
            detail="Atölye hesabı personel kartına bağlı kullanıcıya açılamaz.",
        )
    catalog = await company_station_catalog(_db, cid)
    canonical, unknown = resolve_station_names(stations_in, catalog)
    if unknown:
        raise HTTPException(status_code=400, detail=f"Bilinmeyen istasyon: {unknown[0]}")
    if account_type == ACCOUNT_ATOLYE and not canonical:
        raise HTTPException(status_code=400, detail="Atölye hesabı için en az bir istasyon gerekli.")
    await _db.users.update_one(
        {"_id": user_id, "company_ids": cid},
        {"$set": {
            "account_type": account_type,
            "shopfloor_stations": canonical,
        }},
    )
    log_assigned(user_id, cid, len(canonical))
    return {
        "status": "success",
        "user_id": user_id,
        "account_type": account_type,
        "shopfloor_stations": canonical,
    }
