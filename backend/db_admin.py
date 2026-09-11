"""Platform admin: move the TamKobi database to the customer's own MySQL server."""
from __future__ import annotations

import asyncio
import functools
import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

import db_relocate
import db_ssl
import saas

router = APIRouter(prefix="/api")
logger = logging.getLogger("NexusERP")

_move_lock = asyncio.Lock()


class DbTarget(BaseModel):
    db_host: str = Field(..., min_length=1, max_length=253)
    db_port: int = Field(3306, ge=1, le=65535)
    db_name: str = Field(..., min_length=1, max_length=64)
    db_user: str = Field(..., min_length=1, max_length=128)
    db_password: str = ""
    ssl_mode: Optional[str] = None
    ssl_ca: str = ""


class MoveRequest(DbTarget):
    overwrite: bool = False
    repoint: bool = True


def _settings(req: DbTarget) -> Dict[str, Any]:
    env_mode, env_ca = db_ssl.for_target(req.db_host)
    # A target on another host is verified unless the admin picks otherwise.
    mode = (req.ssl_mode or "").strip() or env_mode
    ca = (req.ssl_ca or "").strip() or env_ca
    try:
        # An admin typing a CA path should hear about a typo now, not mid-copy.
        db_ssl.context(mode, ca)
        return db_relocate.store_settings(
            {
                "host": req.db_host,
                "port": req.db_port,
                "user": req.db_user,
                "password": req.db_password,
                "db": req.db_name,
                "ssl_mode": mode,
                "ssl_ca": ca,
            }
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/system/database")
async def system_database(_: dict = Depends(saas.require_super_admin)):
    current = db_relocate.current_settings()
    try:
        tables = await asyncio.to_thread(db_relocate.table_counts, current)
        reachable, error = True, None
    except Exception as exc:
        tables, reachable, error = {}, False, str(exc)
    return {
        "current": db_relocate.public_view(current),
        "settings_source": db_relocate.settings_source(),
        "reachable": reachable,
        "error": error,
        "tables": tables,
        "documents": int(tables.get("docs") or 0),
    }


@router.post("/system/database/test")
async def system_database_test(req: DbTarget, _: dict = Depends(saas.require_super_admin)):
    target = _settings(req)
    try:
        return await asyncio.to_thread(db_relocate.inspect_target, target)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except RuntimeError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/system/database/move")
async def system_database_move(req: MoveRequest, admin: dict = Depends(saas.require_super_admin)):
    target = _settings(req)
    if _move_lock.locked():
        raise HTTPException(status_code=409, detail="Bir taşıma işlemi hâlâ sürüyor.")
    async with _move_lock:
        try:
            result = await asyncio.to_thread(
                functools.partial(
                    db_relocate.copy_database,
                    target,
                    overwrite=req.overwrite,
                    repoint=req.repoint,
                    backup_dir=db_relocate.backup_dir(),
                )
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except RuntimeError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except Exception as exc:  # pragma: no cover - surfaced to the admin UI
            logger.exception("database move failed")
            raise HTTPException(status_code=500, detail=f"Taşıma başarısız: {exc}") from exc
        result["rebound"] = None
        result["rebind_error"] = None
        if result.get("repointed"):
            import setup_install

            # The data is copied and the settings are stored; a failed rebind only
            # means this process still holds the old pool until it restarts.
            try:
                await setup_install.rebind_runtime(db_relocate.store_settings(target))
                result["rebound"] = True
            except Exception as exc:
                logger.exception("database rebind failed after move")
                result["rebound"] = False
                result["rebind_error"] = (
                    f"Veriler taşındı ve ayar kaydedildi, ancak çalışan API yeni veritabanına "
                    f"bağlanamadı: {exc}. Backend'i yeniden başlatın."
                )
        logger.warning(
            "database moved to %s by %s", result["target"], admin.get("email") or admin.get("id")
        )
        return result
