"""admin-v1 veritabanı yönetimi: /api/platform/admin-v1/storage-move/*.

Ölçüm, eşik, deneme ve iptal storage_admin fonksiyonlarını çağırır.
Uygula, geri al, kurtar ve dedicated hazırlık danger prepare/confirm
akışındadır (storage_move.apply / rollback / recover / prepare_dedicated).
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Query, Request

import saas
import storage_admin
import platform_store as store
from platform_admin_v1 import _auth, _item, _redact
from platform_admin_v1_write import _reject_unknown, _write

router = APIRouter(prefix="/api", tags=["platform-admin-v1-storage-move"])

_THRESHOLD_FIELDS = ("records", "data_mb", "users", "growth_pct")
_DRY_FIELDS = ("to_mode",)


def _db():
    db = storage_admin._db if storage_admin._db is not None else saas._db
    if db is None:
        raise HTTPException(status_code=500, detail="Veritabanı yönetimi hazır değil.")
    return db


def _key_actor(key_doc: dict) -> dict:
    return storage_admin._actor({
        "_id": key_doc.get("_id"),
        "name": str(key_doc.get("name") or "api")[:80],
    })


def _thresholds_body(payload: Dict[str, Any]) -> None:
    _reject_unknown(payload, _THRESHOLD_FIELDS)
    for field in _THRESHOLD_FIELDS:
        if field not in payload:
            raise HTTPException(status_code=400, detail=f"{field} zorunlu.")
        value = payload[field]
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise HTTPException(status_code=400, detail="Eşik değerleri sayı olmalı.")


@router.get("/platform/admin-v1/storage-move")
async def admin_v1_storage_move_overview(request: Request):
    """Firma metrikleri, öneri, eşik, bakım penceresi ve taşıma geçmişi."""
    await _auth(request, store.SCOPE_ADMIN_STORAGE_MOVE_READ)
    return _item(await storage_admin._run(storage_admin.overview, _db()))


@router.get("/platform/admin-v1/storage-move/companies/{company_id}")
async def admin_v1_storage_move_company(company_id: str, request: Request):
    await _auth(request, store.SCOPE_ADMIN_STORAGE_MOVE_READ)
    return _item(await storage_admin._run(storage_admin.company_metrics, _db(), company_id))


@router.get("/platform/admin-v1/storage-move/history")
async def admin_v1_storage_move_history(
    request: Request,
    company_id: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    await _auth(request, store.SCOPE_ADMIN_STORAGE_MOVE_READ)
    page = await storage_admin._run(
        storage_admin.move_history,
        _db(),
        company_id=(company_id or "").strip(),
        limit=limit,
        offset=offset,
    )
    return _redact(page)


@router.get("/platform/admin-v1/storage-move/jobs/{job_id}")
async def admin_v1_storage_move_job(job_id: str, request: Request):
    """İlerleme yoklaması. DSN ve kimlik dönmez."""
    await _auth(request, store.SCOPE_ADMIN_STORAGE_MOVE_READ)
    return _item(await storage_admin._run(storage_admin.job_status, _db(), job_id))


@router.get("/platform/admin-v1/storage-move/moves/{move_id}")
async def admin_v1_storage_move_move(move_id: str, request: Request):
    await _auth(request, store.SCOPE_ADMIN_STORAGE_MOVE_READ)
    return _item(await storage_admin._run(storage_admin.move_status, _db(), move_id))


@router.get("/platform/admin-v1/storage-move/thresholds")
async def admin_v1_storage_move_thresholds_read(request: Request):
    await _auth(request, store.SCOPE_ADMIN_STORAGE_MOVE_READ)
    return _item(await storage_admin._run(storage_admin.load_thresholds, _db()))


@router.put("/platform/admin-v1/storage-move/thresholds")
async def admin_v1_storage_move_thresholds_write(request: Request):
    async def prepare(payload: Dict[str, Any]):
        _thresholds_body(payload)
        return list(_THRESHOLD_FIELDS)

    async def apply(payload: Dict[str, Any], key_doc: dict):
        saved = await storage_admin._run(
            storage_admin.save_thresholds, _db(), payload, _key_actor(key_doc),
        )
        return _item(saved)

    return await _write(
        request,
        store.SCOPE_ADMIN_STORAGE_MOVE_WRITE,
        "storage_move",
        "thresholds",
        apply,
        op="storage_move.thresholds",
        prepare=prepare,
    )


@router.post("/platform/admin-v1/storage-move/thresholds/reset")
async def admin_v1_storage_move_thresholds_reset(request: Request):
    async def prepare(payload: Dict[str, Any]):
        _reject_unknown(payload, ())
        return ["reset"]

    async def apply(payload: Dict[str, Any], key_doc: dict):
        saved = await storage_admin._run(
            storage_admin.reset_thresholds, _db(), _key_actor(key_doc),
        )
        return _item(saved)

    return await _write(
        request,
        store.SCOPE_ADMIN_STORAGE_MOVE_WRITE,
        "storage_move",
        "thresholds",
        apply,
        op="storage_move.thresholds.reset",
        prepare=prepare,
    )


@router.post("/platform/admin-v1/storage-move/companies/{company_id}/dry-run")
async def admin_v1_storage_move_dry_run(company_id: str, request: Request):
    async def prepare(payload: Dict[str, Any]):
        _reject_unknown(payload, _DRY_FIELDS)
        mode = payload.get("to_mode")
        if not isinstance(mode, str) or not mode.strip():
            raise HTTPException(status_code=400, detail="to_mode zorunlu.")
        return ["to_mode"]

    async def apply(payload: Dict[str, Any], key_doc: dict):
        queued = await storage_admin._run(
            storage_admin.enqueue,
            _db(),
            kind="dry_run",
            company_id=company_id,
            actor=_key_actor(key_doc),
            to_mode=payload.get("to_mode") or "",
        )
        return _item(queued)

    return await _write(
        request,
        store.SCOPE_ADMIN_STORAGE_MOVE_WRITE,
        "company",
        company_id,
        apply,
        op="storage_move.dry_run",
        prepare=prepare,
    )


@router.post("/platform/admin-v1/storage-move/jobs/{job_id}/cancel")
async def admin_v1_storage_move_cancel(job_id: str, request: Request):
    async def prepare(payload: Dict[str, Any]):
        _reject_unknown(payload, ())
        return ["cancel"]

    async def apply(payload: Dict[str, Any], key_doc: dict):
        cancelled = await storage_admin._run(
            storage_admin.cancel_job, _db(), job_id, _key_actor(key_doc),
        )
        return _item(cancelled)

    return await _write(
        request,
        store.SCOPE_ADMIN_STORAGE_MOVE_WRITE,
        "storage_move_job",
        job_id,
        apply,
        op="storage_move.cancel",
        prepare=prepare,
    )
