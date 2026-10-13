"""Sunucudan sunucuya Platform API: /api/platform/v1/* (HMAC imza, JWT/CORS yok)."""
from __future__ import annotations

import json
import time
from typing import Any, Dict, Tuple

from fastapi import APIRouter, HTTPException, Request

import platform_store as store

router = APIRouter(prefix="/api/platform/v1", tags=["platform-v1"])

MAX_SKEW_SEC = 300

SCOPE_VERIFY = "license:verify"
SCOPE_HEARTBEAT = "heartbeat"
SCOPE_USAGE = "usage:write"
SCOPE_HELP = "help:read"


async def _authenticate(request: Request, *, required_scope: str) -> Tuple[dict, Dict[str, Any]]:
    """Sıra: başlıklar → timestamp → anahtar → IP limiti → İMZA → scope → nonce → anahtar kotası."""
    key_id = (request.headers.get("X-Platform-Key") or "").strip()
    ts = (request.headers.get("X-Platform-Timestamp") or "").strip()
    nonce = (request.headers.get("X-Platform-Nonce") or "").strip()
    sig = (request.headers.get("X-Platform-Signature") or "").strip()
    if not key_id or not ts or not nonce or not sig:
        raise HTTPException(status_code=401, detail="Eksik imza başlıkları")

    try:
        ts_i = int(ts)
    except ValueError:
        raise HTTPException(status_code=401, detail="Geçersiz timestamp")
    if abs(int(time.time()) - ts_i) > MAX_SKEW_SEC:
        raise HTTPException(status_code=401, detail="Timestamp kayması çok büyük")

    doc, secret = await store.resolve_key_for_auth(key_id)
    if not doc or not secret:
        raise HTTPException(status_code=401, detail="Geçersiz veya süresi dolmuş anahtar")

    ip = (request.client.host if request.client else "") or ""
    if not await store.check_ip_rate_limit(ip):
        raise HTTPException(status_code=429, detail="IP dakika limiti aşıldı")

    body = await request.body()
    path = request.url.path
    method = request.method
    if not store.verify_signature(secret, ts, nonce, method, path, body, sig):
        raise HTTPException(status_code=401, detail="İmza doğrulanamadı")

    scopes = doc.get("scopes") or []
    if required_scope not in scopes:
        if not (required_scope == SCOPE_HELP and store.SCOPE_PLATFORM_ALL in scopes):
            raise HTTPException(status_code=403, detail="Kapsam yetersiz")

    if not await store.check_and_store_nonce(key_id, nonce):
        raise HTTPException(status_code=401, detail="Tekrarlanan nonce")

    if not await store.check_rate_limit(key_id):
        raise HTTPException(status_code=429, detail="Dakika limiti aşıldı")

    await store.touch_last_used(key_id, ip)
    await store.write_audit(
        actor_type="api_key",
        actor_id=key_id,
        ip=ip,
        action=f"v1.{required_scope}",
        target_type="api_key",
        target_id=key_id,
        details={"path": path},
    )
    try:
        payload = json.loads(body.decode("utf-8") or "{}") if body else {}
    except Exception:
        payload = {}
    if not isinstance(payload, dict):
        payload = {}
    return doc, payload


@router.post("/licenses/verify")
async def v1_verify(request: Request):
    key_doc, payload = await _authenticate(request, required_scope=SCOPE_VERIFY)
    try:
        return await store.verify_license(
            key_doc=key_doc,
            instance_ref=payload.get("instance_ref"),
            company_id=payload.get("company_id"),
        )
    except store.KeyScopeError as e:
        raise HTTPException(status_code=403, detail=str(e) or "Anahtar bu hedef için yetkili değil")


@router.post("/heartbeat")
async def v1_heartbeat(request: Request):
    key_doc, payload = await _authenticate(request, required_scope=SCOPE_HEARTBEAT)
    ref = (payload.get("instance_ref") or "").strip()
    if not ref:
        raise HTTPException(status_code=400, detail="instance_ref gerekli")
    try:
        return await store.record_heartbeat(
            key_doc=key_doc,
            instance_ref=ref,
            version=str(payload.get("version") or ""),
            meta=payload.get("meta") if isinstance(payload.get("meta"), dict) else {},
        )
    except store.KeyScopeError as e:
        raise HTTPException(status_code=403, detail=str(e) or "Anahtar bu hedef için yetkili değil")


@router.post("/usage")
async def v1_usage(request: Request):
    key_doc, payload = await _authenticate(request, required_scope=SCOPE_USAGE)
    ref = (payload.get("instance_ref") or "").strip()
    if not ref:
        raise HTTPException(status_code=400, detail="instance_ref gerekli")
    metrics = payload.get("metrics") if isinstance(payload.get("metrics"), dict) else {}
    try:
        return await store.record_usage(
            key_doc=key_doc,
            instance_ref=ref,
            metrics=metrics,
            period=str(payload.get("period") or ""),
        )
    except store.KeyScopeError as e:
        raise HTTPException(status_code=403, detail=str(e) or "Anahtar bu hedef için yetkili değil")


@router.get("/help/articles")
async def v1_help_list(request: Request):
    """TamEticaret / diğer ürünler: yayınlanmış yardım içerikleri (HMAC, help:read)."""
    import help_center

    await _authenticate(request, required_scope=SCOPE_HELP)
    qp = request.query_params
    product = (qp.get("product") or help_center.PRODUCT_TAMKOBI).strip()
    rows = await help_center.fetch_published(
        product=product,
        q=qp.get("q") or "",
        page_key=qp.get("page_key") or "",
        content_type=qp.get("content_type") or "",
        locale=qp.get("locale") or "",
        limit=int(qp.get("limit") or 50),
    )
    return {
        "product": product,
        "count": len(rows),
        "articles": [help_center.public_article(r, include_body=False) for r in rows],
    }


@router.get("/help/articles/{slug}")
async def v1_help_get(slug: str, request: Request):
    import help_center

    await _authenticate(request, required_scope=SCOPE_HELP)
    product = (request.query_params.get("product") or help_center.PRODUCT_TAMKOBI).strip()
    doc = await help_center.fetch_by_slug(slug, product=product)
    return help_center.public_article(doc, include_body=True)


@router.post("/help/search")
async def v1_help_search(request: Request):
    import help_center

    _key, payload = await _authenticate(request, required_scope=SCOPE_HELP)
    product = str(payload.get("product") or help_center.PRODUCT_TAMKOBI).strip()
    rows = await help_center.fetch_published(
        product=product,
        q=str(payload.get("q") or ""),
        page_key=str(payload.get("page_key") or ""),
        content_type=str(payload.get("content_type") or ""),
        locale=str(payload.get("locale") or ""),
        limit=int(payload.get("limit") or 50),
    )
    return {
        "product": product,
        "count": len(rows),
        "articles": [help_center.public_article(r, include_body=False) for r in rows],
    }


def init(db):
    store.init(db)
