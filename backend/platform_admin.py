"""Süper admin Platform Yönetimi API: /api/platform/admin/*"""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from client_ip import request_ip
import platform_store as store
import saas

router = APIRouter(prefix="/api", tags=["platform-admin"])


def _ip(request: Request) -> str:
    return request_ip(request)


def _actor(admin: dict) -> str:
    return str(admin.get("id") or admin.get("_id") or admin.get("email") or "")


@router.get("/platform/admin/products")
async def admin_list_products(_: dict = Depends(saas.require_super_admin)):
    return {"products": await store.list_products()}


@router.post("/platform/admin/products")
async def admin_create_product(
    req: Dict[str, Any],
    request: Request,
    admin: dict = Depends(saas.require_super_admin),
):
    try:
        doc = await store.create_product(req, actor_id=_actor(admin), ip=_ip(request))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"product": doc}


@router.put("/platform/admin/products/{product_id}")
async def admin_update_product(
    product_id: str,
    req: Dict[str, Any],
    request: Request,
    admin: dict = Depends(saas.require_super_admin),
):
    try:
        doc = await store.update_product(product_id, req, actor_id=_actor(admin), ip=_ip(request))
    except LookupError:
        raise HTTPException(status_code=404, detail="Ürün bulunamadı")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"product": doc}


@router.delete("/platform/admin/products/{product_id}")
async def admin_delete_product(
    product_id: str,
    request: Request,
    admin: dict = Depends(saas.require_super_admin),
):
    try:
        await store.delete_product(product_id, actor_id=_actor(admin), ip=_ip(request))
    except LookupError:
        raise HTTPException(status_code=404, detail="Ürün bulunamadı")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "success"}


@router.get("/platform/admin/instances")
async def admin_list_instances(
    product_id: Optional[str] = Query(None),
    _: dict = Depends(saas.require_super_admin),
):
    return {"instances": await store.list_instances(product_id=product_id)}


@router.post("/platform/admin/instances")
async def admin_upsert_instance(
    req: Dict[str, Any],
    request: Request,
    admin: dict = Depends(saas.require_super_admin),
):
    try:
        doc = await store.upsert_instance(req, actor_id=_actor(admin), ip=_ip(request))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"instance": doc}


@router.get("/platform/admin/api-keys")
async def admin_list_keys(
    product_id: Optional[str] = Query(None),
    _: dict = Depends(saas.require_super_admin),
):
    return {"keys": await store.list_api_keys(product_id=product_id)}


@router.post("/platform/admin/api-keys")
async def admin_create_key(
    req: Dict[str, Any],
    request: Request,
    admin: dict = Depends(saas.require_super_admin),
):
    try:
        pub, secret = await store.create_api_key(
            product_id=req.get("product_id") or "",
            name=req.get("name") or "",
            scopes=req.get("scopes"),
            instance_id=req.get("instance_id"),
            expires_at=req.get("expires_at"),
            actor_id=_actor(admin),
            ip=_ip(request),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"key": pub, "secret": secret}


@router.post("/platform/admin/api-keys/{key_id}/rotate")
async def admin_rotate_key(
    key_id: str,
    request: Request,
    admin: dict = Depends(saas.require_super_admin),
):
    try:
        pub, secret = await store.rotate_api_key(key_id, actor_id=_actor(admin), ip=_ip(request))
    except LookupError:
        raise HTTPException(status_code=404, detail="Anahtar bulunamadı")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"key": pub, "secret": secret}


@router.post("/platform/admin/api-keys/{key_id}/revoke")
async def admin_revoke_key(
    key_id: str,
    request: Request,
    admin: dict = Depends(saas.require_super_admin),
):
    try:
        pub = await store.revoke_api_key(key_id, actor_id=_actor(admin), ip=_ip(request))
    except LookupError:
        raise HTTPException(status_code=404, detail="Anahtar bulunamadı")
    return {"key": pub}


@router.get("/platform/admin/audit")
async def admin_list_audit(
    action: Optional[str] = Query(None),
    actor_id: Optional[str] = Query(None),
    target_type: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    _: dict = Depends(saas.require_super_admin),
):
    return {
        "entries": await store.list_audit(
            action=action, actor_id=actor_id, target_type=target_type, limit=limit,
        )
    }


def init(db):
    store.init(db)
