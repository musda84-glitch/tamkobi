"""Çevrimdışı çalışma: platform ayarı, delta senkron ve sunucu tarafı çakışma kararı.

İstemci IndexedDB'sine gidecek projeksiyonlarda parola, PIN, token, VKN ve IBAN yoktur.
Bu modül GİB / İşNet çağrısı yapmaz ve bu alanları loglamaz.
Firma ayarını ynt paneli yazar; şirket formu yazamaz.
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

import tenant_access

DEFAULT_OFFLINE_MAX_MINUTES = 10
MIN_OFFLINE_MAX_MINUTES = 1
MAX_OFFLINE_MAX_MINUTES = 720
DEFAULT_IDEMPOTENCY_TTL_HOURS = 24
MIN_IDEMPOTENCY_TTL_HOURS = 1
MAX_IDEMPOTENCY_TTL_HOURS = 168
OFFLINE_MODULES = ("pos", "pick", "order")
DELTA_LIMIT = 2000
PENDING_WINDOW_HOURS = 24
_DEVICE_ID = re.compile(r"^[A-Za-z0-9_-]{8,80}$")

_SECRET_KEYS = {
    "password", "password_hash", "b2b_password_hash", "token", "access_token",
    "refresh_token", "pin", "pin_hash", "cashier_pin_hash", "shopfloor_pin_hash",
    "punch_pin_hash", "iban", "tax_number", "tax_number_or_id", "vkn", "tckn",
    "api_key", "secret", "authorization", "credential", "credentials",
}

router = APIRouter(prefix="/api")
_db = None
_current_user = None


def init(db, get_current_user=None) -> None:
    global _db, _current_user
    _db = db
    if get_current_user is not None:
        _current_user = get_current_user


async def _user_dep(request: Request) -> dict:
    if _current_user is None:
        raise HTTPException(status_code=500, detail="Offline sync auth bağlanmadı.")
    return await _current_user(request)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def clamp_offline_max_minutes(value: Any, default: int = DEFAULT_OFFLINE_MAX_MINUTES) -> int:
    """Şirket ayarı. Boş veya bozuk değerde varsayılan 10 dakika."""
    if value is None or value == "":
        return default
    try:
        minutes = int(float(value))
    except (TypeError, ValueError):
        return default
    return max(MIN_OFFLINE_MAX_MINUTES, min(MAX_OFFLINE_MAX_MINUTES, minutes))


def offline_max_minutes(company: Optional[dict]) -> int:
    if not isinstance(company, dict):
        return DEFAULT_OFFLINE_MAX_MINUTES
    if "offline_max_minutes" not in company:
        return DEFAULT_OFFLINE_MAX_MINUTES
    return clamp_offline_max_minutes(company.get("offline_max_minutes"))


def clamp_idempotency_ttl_hours(value: Any, default: int = DEFAULT_IDEMPOTENCY_TTL_HOURS) -> int:
    """Anahtar saklama süresi. Boş değerde 24 saat, sınır 1–168."""
    if isinstance(value, bool) or value is None or value == "":
        return default
    try:
        hours = int(float(value))
    except (TypeError, ValueError):
        return default
    return max(MIN_IDEMPOTENCY_TTL_HOURS, min(MAX_IDEMPOTENCY_TTL_HOURS, hours))


def company_offline_policy(company: Optional[dict]) -> dict:
    """Eksik alanlar mevcut davranışı korur: açık, üç modül açık, 10 dk, 24 saat."""
    source = company if isinstance(company, dict) else {}
    enabled = source.get("offline_enabled")
    raw_modules = source.get("offline_modules") if isinstance(source.get("offline_modules"), dict) else {}
    modules = {}
    for key in OFFLINE_MODULES:
        if key in raw_modules:
            modules[key] = bool(raw_modules[key])
        else:
            modules[key] = True
    ttl = source.get("idempotency_ttl_hours")
    return {
        "offline_enabled": True if enabled is None else bool(enabled),
        "offline_max_minutes": offline_max_minutes(source),
        "offline_modules": modules,
        "idempotency_ttl_hours": clamp_idempotency_ttl_hours(ttl) if "idempotency_ttl_hours" in source else DEFAULT_IDEMPOTENCY_TTL_HOURS,
    }


def merge_offline_settings(company: Optional[dict], body: Optional[dict]) -> dict:
    """Gövdede olan alanları mevcut politikayla birleştirir."""
    current = company_offline_policy(company)
    patch = body if isinstance(body, dict) else {}
    modules = dict(current["offline_modules"])
    incoming = patch.get("offline_modules")
    if isinstance(incoming, dict):
        for key in OFFLINE_MODULES:
            if key in incoming:
                modules[key] = bool(incoming[key])
    return {
        "offline_enabled": bool(patch["offline_enabled"]) if "offline_enabled" in patch else current["offline_enabled"],
        "offline_max_minutes": clamp_offline_max_minutes(patch["offline_max_minutes"]) if "offline_max_minutes" in patch else current["offline_max_minutes"],
        "offline_modules": modules,
        "idempotency_ttl_hours": clamp_idempotency_ttl_hours(patch["idempotency_ttl_hours"]) if "idempotency_ttl_hours" in patch else current["idempotency_ttl_hours"],
    }


def settings_changed(before: dict, after: dict) -> dict:
    changed = {}
    for key in ("offline_enabled", "offline_max_minutes", "idempotency_ttl_hours"):
        if before.get(key) != after.get(key):
            changed[key] = {"from": before.get(key), "to": after.get(key)}
    if before.get("offline_modules") != after.get("offline_modules"):
        changed["offline_modules"] = {"from": before.get("offline_modules"), "to": after.get("offline_modules")}
    return changed


async def _maybe_await(value: Any) -> Any:
    if hasattr(value, "__await__"):
        return await value
    return value


async def ttl_hours_for(db, company_id: str) -> int:
    companies = getattr(db, "companies", None)
    find_one = getattr(companies, "find_one", None)
    if not callable(find_one):
        return DEFAULT_IDEMPOTENCY_TTL_HOURS
    try:
        row = await _maybe_await(find_one({"_id": str(company_id or "").strip()}))
    except Exception:
        return DEFAULT_IDEMPOTENCY_TTL_HOURS
    if not isinstance(row, dict):
        return DEFAULT_IDEMPOTENCY_TTL_HOURS
    if "idempotency_ttl_hours" not in row:
        return DEFAULT_IDEMPOTENCY_TTL_HOURS
    return clamp_idempotency_ttl_hours(row.get("idempotency_ttl_hours"))


async def ttl_hours_map(db) -> Dict[str, int]:
    companies = getattr(db, "companies", None)
    find = getattr(companies, "find", None)
    if not callable(find):
        return {}
    try:
        cursor = find({})
        to_list = getattr(cursor, "to_list", None)
        if not callable(to_list):
            return {}
        rows = await _maybe_await(to_list(5000))
    except Exception:
        return {}
    if not isinstance(rows, list):
        return {}
    out: Dict[str, int] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        cid = str(row.get("_id") or "").strip()
        if not cid:
            continue
        if "idempotency_ttl_hours" in row:
            out[cid] = clamp_idempotency_ttl_hours(row.get("idempotency_ttl_hours"))
        else:
            out[cid] = DEFAULT_IDEMPOTENCY_TTL_HOURS
    return out


def clean_device_id(value: Any) -> str:
    text = str(value or "").strip()
    if not _DEVICE_ID.fullmatch(text):
        return ""
    return text


async def remember_device_pending(db, company_id: str, device_id: Any, pending: Any) -> None:
    """Cihazın kuyruk derinliğini yazar. Geçersiz kimlik veya eksik sayı yok sayılır."""
    device = clean_device_id(device_id)
    cid = str(company_id or "").strip()
    if not device or not cid or pending is None:
        return
    try:
        count = int(pending)
    except (TypeError, ValueError):
        return
    count = max(0, min(100000, count))
    coll = getattr(db, "offline_device_pending", None)
    insert = getattr(coll, "insert_one", None)
    if not callable(insert):
        return
    doc_id = f"{cid}:{device}"
    doc = {"_id": doc_id, "company_id": cid, "device_id": device, "pending": count, "at": _now_iso()}
    try:
        find_one = getattr(coll, "find_one", None)
        existing = await _maybe_await(find_one({"_id": doc_id})) if callable(find_one) else None
        if isinstance(existing, dict):
            update = getattr(coll, "update_one", None)
            if callable(update):
                await _maybe_await(update({"_id": doc_id}, {"$set": doc}))
                return
        await _maybe_await(insert(doc))
    except Exception:
        return


async def pending_total(db, company_id: str, now: Optional[datetime] = None) -> int:
    coll = getattr(db, "offline_device_pending", None)
    find = getattr(coll, "find", None)
    if not callable(find):
        return 0
    try:
        cursor = find({"company_id": str(company_id or "").strip()})
        to_list = getattr(cursor, "to_list", None)
        rows = await _maybe_await(to_list(500)) if callable(to_list) else []
    except Exception:
        return 0
    if not isinstance(rows, list):
        return 0
    moment = now or datetime.now(timezone.utc)
    cutoff = (moment - timedelta(hours=PENDING_WINDOW_HOURS)).isoformat()
    total = 0
    for row in rows:
        if not isinstance(row, dict):
            continue
        if str(row.get("at") or "") < cutoff:
            continue
        try:
            total += max(0, int(row.get("pending") or 0))
        except (TypeError, ValueError):
            continue
    return total


async def note_conflict(db, company_id: str, conflict: Optional[dict]) -> None:
    """Çakışma sayacı. Parola, PIN, token, VKN ve IBAN yazılmaz."""
    if not isinstance(conflict, dict):
        return
    cid = str(company_id or "").strip()
    if not cid:
        return
    coll = getattr(db, "offline_conflicts", None)
    insert = getattr(coll, "insert_one", None)
    if not callable(insert):
        return
    try:
        await _maybe_await(insert({
            "_id": f"ocf_{uuid.uuid4().hex[:16]}",
            "company_id": cid,
            "code": str(conflict.get("code") or "conflict")[:80],
            "message": str(conflict.get("message") or "")[:240],
            "at": _now_iso(),
        }))
    except Exception:
        return


async def conflict_total(db, company_id: str) -> int:
    coll = getattr(db, "offline_conflicts", None)
    find = getattr(coll, "find", None)
    if not callable(find):
        return 0
    try:
        cursor = find({"company_id": str(company_id or "").strip()})
        to_list = getattr(cursor, "to_list", None)
        rows = await _maybe_await(to_list(5000)) if callable(to_list) else []
    except Exception:
        return 0
    if not isinstance(rows, list):
        return 0
    return len(rows)


def since_clause(updated_since: Optional[str]) -> Optional[dict]:
    text = str(updated_since or "").strip()
    if not text or len(text) > 40:
        return None
    bound = {"$gt": text}
    return {"$or": [{"updated_at": bound}, {"created_at": dict(bound)}]}


def apply_updated_since(query: dict, updated_since: Optional[str]) -> dict:
    """Mevcut filtreye delta sınırı ekler. Boş updated_since sorguyu değiştirmez."""
    clause = since_clause(updated_since)
    if not clause or not isinstance(query, dict):
        return query
    if "$or" in query:
        existing = query.pop("$or")
        query["$and"] = [*list(query.get("$and") or []), {"$or": existing}, clause]
    elif "$and" in query:
        query["$and"] = [*list(query.get("$and") or []), clause]
    else:
        query.update(clause)
    return query


def _stamp(doc: dict) -> str:
    return str(doc.get("updated_at") or doc.get("created_at") or "")


def _public_id(doc: dict) -> str:
    return str(doc.get("id") or doc.get("_id") or "")


def strip_secrets(value: Any) -> Any:
    if isinstance(value, list):
        return [strip_secrets(item) for item in value]
    if not isinstance(value, dict):
        return value
    out = {}
    for key, item in value.items():
        if str(key).strip().lower() in _SECRET_KEYS:
            continue
        out[key] = strip_secrets(item)
    return out


def public_product(doc: dict) -> dict:
    row = {
        "id": _public_id(doc),
        "company_id": str(doc.get("company_id") or ""),
        "name": doc.get("name") or "",
        "sku": doc.get("sku") or "",
        "barcode": doc.get("barcode") or "",
        "unit": doc.get("unit") or "Adet",
        "sale_price": doc.get("sale_price") or 0,
        "vat_rate": doc.get("vat_rate") if doc.get("vat_rate") is not None else 20,
        "price_includes_vat": bool(doc.get("price_includes_vat")),
        "stock_quantity": float(doc.get("stock_quantity") or 0),
        "track_stock": doc.get("track_stock", True) is not False,
        "track_lot": bool(doc.get("track_lot")),
        "track_serial": bool(doc.get("track_serial")),
        "track_expiry": bool(doc.get("track_expiry")),
        "type": doc.get("type") or "product",
        "is_active": doc.get("is_active", True) is not False,
        "category": doc.get("category") or "",
        "updated_at": _stamp(doc),
        "created_at": str(doc.get("created_at") or ""),
    }
    return strip_secrets(row)


def public_stock(doc: dict) -> dict:
    return strip_secrets({
        "id": _public_id(doc),
        "company_id": str(doc.get("company_id") or ""),
        "name": doc.get("name") or "",
        "sku": doc.get("sku") or "",
        "barcode": doc.get("barcode") or "",
        "stock_quantity": float(doc.get("stock_quantity") or 0),
        "updated_at": _stamp(doc),
    })


def public_price(doc: dict) -> dict:
    sale = doc.get("sale_price") or 0
    return strip_secrets({
        "id": _public_id(doc),
        "company_id": str(doc.get("company_id") or ""),
        "name": doc.get("name") or "",
        "sku": doc.get("sku") or "",
        "barcode": doc.get("barcode") or "",
        "sale_price": sale,
        "list_price": doc.get("list_price") if doc.get("list_price") is not None else sale,
        "vat_rate": doc.get("vat_rate") if doc.get("vat_rate") is not None else 20,
        "currency": doc.get("currency") or "TRY",
        "updated_at": _stamp(doc),
    })


def public_contact(doc: dict) -> dict:
    return strip_secrets({
        "id": _public_id(doc),
        "company_id": str(doc.get("company_id") or ""),
        "name": doc.get("name") or "",
        "type": doc.get("type") or "",
        "phone": doc.get("phone") or "",
        "email": doc.get("email") or "",
        "address": doc.get("address") or "",
        "city": doc.get("city") or "",
        "district": doc.get("district") or "",
        "balance": doc.get("balance") or 0,
        "is_active": doc.get("is_active", True) is not False,
        "company_title": doc.get("company_title") or "",
        "updated_at": _stamp(doc),
        "created_at": str(doc.get("created_at") or ""),
    })


async def _rows(coll, company_id: str, updated_since: Optional[str], limit: int) -> List[dict]:
    query: Dict[str, Any] = {"company_id": company_id}
    apply_updated_since(query, updated_since)
    cursor = coll.find(query)
    to_list = getattr(cursor, "to_list", None)
    if to_list is None:
        return []
    return await to_list(limit)


async def build_delta(db, company_id: str, updated_since: Optional[str] = None, limit: int = DELTA_LIMIT) -> dict:
    cid = str(company_id or "").strip()
    if not cid:
        raise HTTPException(status_code=400, detail="Şirket seçilmedi.")
    company = await db.companies.find_one({"_id": cid}) or {}
    policy = company_offline_policy(company)
    products = await _rows(db.products, cid, updated_since, limit)
    contacts = await _rows(db.contacts, cid, updated_since, limit)
    return {
        "company_id": cid,
        "server_time": _now_iso(),
        "offline_enabled": policy["offline_enabled"],
        "offline_max_minutes": policy["offline_max_minutes"],
        "offline_modules": policy["offline_modules"],
        "idempotency_ttl_hours": policy["idempotency_ttl_hours"],
        "updated_since": str(updated_since or "").strip(),
        "products": [public_product(row) for row in products],
        "stock": [public_stock(row) for row in products],
        "contacts": [public_contact(row) for row in contacts],
        "price_lists": [public_price(row) for row in products],
    }


def amount_decision(client_total: Any, server_total: Any) -> Optional[dict]:
    """Tutar çakışmasında sunucu kendi hesabını kullanır ve farkı bildirir."""
    if client_total is None or client_total == "":
        return None
    try:
        client = round(float(client_total), 2)
        server = round(float(server_total or 0), 2)
    except (TypeError, ValueError):
        return None
    if abs(client - server) <= 0.02:
        return None
    return {
        "code": "amount_conflict",
        "message": "Tutar sunucu hesabına göre kaydedildi.",
        "client_total": client,
        "server_total": server,
        "decision": "server",
    }


async def document_number_conflict(db, company_id: str, order_number: Any) -> Optional[dict]:
    number = str(order_number or "").strip()
    cid = str(company_id or "").strip()
    if not number or not cid:
        return None
    existing = await db.orders.find_one({"company_id": cid, "order_number": number})
    if not existing:
        return None
    detail = {
        "code": "document_conflict",
        "message": "Belge numarası bu şirkette kayıtlı. Sunucu ikinci kaydı açmadı.",
        "order_number": number,
        "existing_id": str(existing.get("_id") or existing.get("id") or ""),
        "decision": "rejected",
    }
    await note_conflict(db, cid, {"code": "document_conflict", "message": detail["message"]})
    return detail


async def assert_stock_available(db, company_id: str, lines: List[dict], expected_stock: Any) -> None:
    """İstemci stok anı gönderdiyse sunucu adedi yetersizse satışı reddeder."""
    if not isinstance(expected_stock, dict):
        return
    cid = str(company_id or "").strip()
    conflicts = []
    for line in lines or []:
        pid = str(line.get("product_id") or "").strip()
        if not pid:
            continue
        product = await db.products.find_one({"_id": pid, "company_id": cid})
        if not product or product.get("track_stock") is False:
            continue
        have = float(product.get("stock_quantity") or 0)
        need = float(line.get("quantity") or 0)
        if have + 1e-9 < need:
            conflicts.append({
                "code": "stock_conflict",
                "product_id": pid,
                "name": product.get("name") or "",
                "available": have,
                "requested": need,
                "decision": "rejected",
            })
    if conflicts:
        detail = {
            "code": "stock_conflict",
            "message": "Stok yetersiz. Sunucu satışı kaydetmedi.",
            "conflicts": conflicts,
        }
        await note_conflict(db, cid, {"code": "stock_conflict", "message": detail["message"]})
        raise HTTPException(status_code=409, detail=detail)


@router.get("/offline/sync")
async def offline_sync_get(
    company_id: Optional[str] = None,
    updated_since: Optional[str] = None,
    pending: Optional[int] = None,
    device_id: Optional[str] = None,
    user: dict = Depends(_user_dep),
):
    cid = tenant_access.resolve_company_id(user, company_id)
    if _db is None:
        raise HTTPException(status_code=500, detail="Offline sync bağlanmadı.")
    await remember_device_pending(_db, cid, device_id, pending)
    return await build_delta(_db, cid, updated_since)
