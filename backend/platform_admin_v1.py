"""Yönetim paneli salt okunur API: /api/platform/admin-v1/* (HMAC, platform_admin).

Yazma, mail/SMS gönderimi ve SMTP/IMAP bağlantısı yok. authenticate'in
audit / nonce / last_used kayıtları dışında yan etki yoktur.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, HTTPException, Query, Request

from build_stamp import read_stamp
import platform_auth
import platform_mail
import platform_store as store
import saas

router = APIRouter(prefix="/api/platform/admin-v1", tags=["platform-admin-v1"])

# Uzun parçalar alt dizgi. "pan" kart numarasıdır; "plan" / "company" düşmesin.
_DROP_SUBSTR = (
    "password",
    "password_hash",
    "_enc",
    "secret",
    "totp",
    "recovery",
    "token",
    "api_key",
    "card",
    "cvv",
    "iban_enc",
    "smtp_pass",
)
_PAN_PART = re.compile(r"[^a-z0-9]+")


def _drop_key(name: str, value: Any) -> bool:
    kl = str(name).lower()
    if kl == "has_password" or (kl.startswith("has_") and isinstance(value, bool)):
        return False
    if any(part in kl for part in _DROP_SUBSTR):
        return True
    return "pan" in _PAN_PART.split(kl)


def _redact(obj: Any) -> Any:
    """Son katman: sır alanlarını özyinelemeli düşür. Girdiyi değiştirmez."""
    if isinstance(obj, dict):
        out = {}
        for key, value in obj.items():
            if _drop_key(key, value):
                continue
            out[key] = _redact(value)
        return out
    if isinstance(obj, list):
        return [_redact(item) for item in obj]
    return obj


def _page(items: List[Any], limit: int, offset: int, total: int) -> dict:
    return _redact({"items": items, "limit": limit, "offset": offset, "total": total})


def _item(item: Any) -> dict:
    return _redact({"item": item})


async def _auth(request: Request, scope: str) -> Tuple[dict, Dict[str, Any]]:
    """platform_v1._authenticate ile aynı devir; audit öneki admin_v1.

    Kapsam doğru olsa bile kind platform_admin değilse 403 (plan D).
    """
    key_doc, payload = await platform_auth.authenticate(
        request,
        required_scope=scope,
        audit_prefix="admin_v1",
    )
    if key_doc.get("kind") != store.KEY_KIND_PLATFORM_ADMIN:
        raise HTTPException(status_code=403, detail="Kapsam yetersiz")
    return key_doc, payload


def _window(rows: List[Any], limit: int, offset: int) -> Tuple[List[Any], int]:
    total = len(rows)
    if offset >= total:
        return [], total
    return rows[offset:offset + limit], total


@router.get("/companies")
async def admin_v1_companies(
    request: Request,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    q: Optional[str] = Query(None),
):
    await _auth(request, store.SCOPE_ADMIN_COMPANIES_READ)
    rows = await saas._db.companies.find({}).sort("created_at", -1).to_list(5000)
    needle = (q or "").strip().casefold()
    if needle:
        rows = [c for c in rows if needle in str(c.get("name") or "").casefold()]
    page, total = _window(rows, limit, offset)
    items = [await saas._company_row(c) for c in page]
    return _page(items, limit, offset, total)


@router.get("/companies/{company_id}")
async def admin_v1_company(company_id: str, request: Request):
    await _auth(request, store.SCOPE_ADMIN_COMPANIES_READ)
    row = await saas.company_detail(company_id, include_users=False)
    if row is None:
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    return _item(row)


@router.get("/companies/{company_id}/users")
async def admin_v1_company_users(
    company_id: str,
    request: Request,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    await _auth(request, store.SCOPE_ADMIN_USERS_READ)
    if not await saas._db.companies.find_one({"_id": company_id}):
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    members = await saas.company_staff(company_id)
    page, total = _window(members, limit, offset)
    return _page(page, limit, offset, total)


@router.get("/plans")
async def admin_v1_plans(request: Request):
    await _auth(request, store.SCOPE_ADMIN_LICENSES_READ)
    plans = await saas.list_plans({})
    catalog = await saas.catalog_with_prices()
    return _item({"plans": plans, "catalog": catalog})


@router.get("/api-keys")
async def admin_v1_api_keys(
    request: Request,
    product_id: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    await _auth(request, store.SCOPE_ADMIN_KEYS_READ)
    pid = (product_id or "").strip() or None
    rows = await store.list_api_keys(product_id=pid)
    page, total = _window(rows, limit, offset)
    return _page(page, limit, offset, total)


@router.get("/integrators")
async def admin_v1_integrators(
    request: Request,
    include_instances: bool = Query(False),
    product_id: Optional[str] = Query(None),
):
    await _auth(request, store.SCOPE_ADMIN_INTEGRATORS_READ)
    item: Dict[str, Any] = {"products": await store.list_products()}
    if include_instances:
        pid = (product_id or "").strip() or None
        item["instances"] = await store.list_instances(product_id=pid)
    return _item(item)


@router.get("/audit")
async def admin_v1_audit(
    request: Request,
    action: Optional[str] = Query(None),
    actor_id: Optional[str] = Query(None),
    target_type: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    before: Optional[str] = Query(None),
):
    await _auth(request, store.SCOPE_ADMIN_AUDIT_READ)
    rows = await store.list_audit(
        action=(action or "").strip() or None,
        actor_id=(actor_id or "").strip() or None,
        target_type=(target_type or "").strip() or None,
        limit=limit + 1,
        before=(before or "").strip() or None,
    )
    has_more = len(rows) > limit
    items = rows[:limit]
    next_cursor = items[-1].get("at") if has_more and items else None
    return _redact({"items": items, "limit": limit, "next_cursor": next_cursor})


@router.get("/mail/status")
async def admin_v1_mail_status(request: Request):
    """Posta özeti. SMTP/IMAP açılmaz, mektup gönderilmez."""
    await _auth(request, store.SCOPE_ADMIN_MAIL_READ)
    db = platform_mail._db if platform_mail._db is not None else saas._db
    servers = [
        platform_mail._public_server(row)
        for row in await db.platform_mail_servers.find({}).sort("created_at", 1).to_list(100)
    ]
    boxes = [
        platform_mail._public_box(row)
        for row in await db.platform_mailboxes.find({}).sort("created_at", 1).to_list(200)
    ]
    default_from = next(
        (box["email"] for box in boxes if box.get("is_default") and box.get("is_active", True)),
        None,
    ) or next((box["email"] for box in boxes if box.get("is_active", True)), None)
    return _item({"servers": servers, "mailboxes": boxes, "default_from": default_from})


@router.get("/system/health")
async def admin_v1_system_health(request: Request):
    """Sürüm damgası. Veritabanı sorgusu yok."""
    await _auth(request, store.SCOPE_ADMIN_SYSTEM_READ)
    stamp = read_stamp()
    return _item({
        "status": "healthy",
        "version": stamp.get("version"),
        "git_sha": stamp.get("git_sha"),
    })
