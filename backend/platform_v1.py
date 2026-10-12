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


async def _authenticate(request: Request, *, required_scope: str) -> Tuple[dict, Dict[str, Any]]:
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

    if required_scope not in (doc.get("scopes") or []):
        raise HTTPException(status_code=403, detail="Kapsam yetersiz")

    if not await store.check_rate_limit(key_id):
        raise HTTPException(status_code=429, detail="Dakika limiti aşıldı")

    if not await store.check_and_store_nonce(key_id, nonce):
        raise HTTPException(status_code=401, detail="Tekrarlanan nonce")

    body = await request.body()
    path = request.url.path
    method = request.method
    if not store.verify_signature(secret, ts, nonce, method, path, body, sig):
        raise HTTPException(status_code=401, detail="İmza doğrulanamadı")

    ip = (request.client.host if request.client else "") or ""
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
    _, payload = await _authenticate(request, required_scope=SCOPE_VERIFY)
    return await store.verify_license(
        instance_ref=payload.get("instance_ref"),
        company_id=payload.get("company_id"),
    )


@router.post("/heartbeat")
async def v1_heartbeat(request: Request):
    _, payload = await _authenticate(request, required_scope=SCOPE_HEARTBEAT)
    ref = (payload.get("instance_ref") or "").strip()
    if not ref:
        raise HTTPException(status_code=400, detail="instance_ref gerekli")
    return await store.record_heartbeat(
        instance_ref=ref,
        version=str(payload.get("version") or ""),
        meta=payload.get("meta") if isinstance(payload.get("meta"), dict) else {},
    )


@router.post("/usage")
async def v1_usage(request: Request):
    _, payload = await _authenticate(request, required_scope=SCOPE_USAGE)
    ref = (payload.get("instance_ref") or "").strip()
    if not ref:
        raise HTTPException(status_code=400, detail="instance_ref gerekli")
    metrics = payload.get("metrics") if isinstance(payload.get("metrics"), dict) else {}
    return await store.record_usage(
        instance_ref=ref,
        metrics=metrics,
        period=str(payload.get("period") or ""),
    )


def init(db):
    store.init(db)
