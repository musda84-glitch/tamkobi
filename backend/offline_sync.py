"""Çevrimdışı çalışma: şirket ayarı, delta senkron ve sunucu tarafı çakışma kararı.

İstemci IndexedDB'sine gidecek projeksiyonlarda parola, PIN, token, VKN ve IBAN yoktur.
Bu modül GİB / İşNet çağrısı yapmaz ve bu alanları loglamaz.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

import tenant_access

DEFAULT_OFFLINE_MAX_MINUTES = 10
MIN_OFFLINE_MAX_MINUTES = 1
MAX_OFFLINE_MAX_MINUTES = 720
DELTA_LIMIT = 2000

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
    products = await _rows(db.products, cid, updated_since, limit)
    contacts = await _rows(db.contacts, cid, updated_since, limit)
    return {
        "company_id": cid,
        "server_time": _now_iso(),
        "offline_max_minutes": offline_max_minutes(company),
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
    return {
        "code": "document_conflict",
        "message": "Belge numarası bu şirkette kayıtlı. Sunucu ikinci kaydı açmadı.",
        "order_number": number,
        "existing_id": str(existing.get("_id") or existing.get("id") or ""),
        "decision": "rejected",
    }


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
        raise HTTPException(status_code=409, detail={
            "code": "stock_conflict",
            "message": "Stok yetersiz. Sunucu satışı kaydetmedi.",
            "conflicts": conflicts,
        })


@router.get("/offline/sync")
async def offline_sync_get(
    company_id: Optional[str] = None,
    updated_since: Optional[str] = None,
    user: dict = Depends(_user_dep),
):
    cid = tenant_access.resolve_company_id(user, company_id)
    if _db is None:
        raise HTTPException(status_code=500, detail="Offline sync bağlanmadı.")
    return await build_delta(_db, cid, updated_since)
