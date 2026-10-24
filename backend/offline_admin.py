"""ynt paneli: firma bazında çevrimdışı ayarı. Yalnız süper admin yazar, değişiklik denetlenir."""
from __future__ import annotations

from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

import offline_sync
from client_ip import request_ip

router = APIRouter(prefix="/api")
_db = None


def init(db) -> None:
    global _db
    _db = db


async def require_platform_admin(request: Request) -> dict:
    """Yalnız süper admin. saas.require_super_admin ile aynı kapı."""
    import saas

    user = await saas.require_super_admin(request)
    _only_super(user)
    return user


def _only_super(admin: Optional[dict]) -> None:
    if not isinstance(admin, dict) or not admin.get("is_super_admin"):
        raise HTTPException(status_code=403, detail="Bu alan yalnızca platform (sistem) yöneticisine açıktır.")


def _database():
    if _db is None:
        raise HTTPException(status_code=500, detail="Çevrimdışı yönetimi bağlanmadı.")
    return _db


def public_company_row(company: dict, pending: int, conflicts: int) -> dict:
    policy = offline_sync.company_offline_policy(company)
    return {
        "id": str(company.get("_id") or company.get("id") or ""),
        "name": company.get("name") or "—",
        "offline_enabled": policy["offline_enabled"],
        "offline_max_minutes": policy["offline_max_minutes"],
        "offline_modules": policy["offline_modules"],
        "idempotency_ttl_hours": policy["idempotency_ttl_hours"],
        "pending": int(pending or 0),
        "conflicts": int(conflicts or 0),
    }


async def list_overview(db) -> dict:
    cursor = db.companies.find({})
    rows = await offline_sync._maybe_await(cursor.to_list(2000))
    companies = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        cid = str(row.get("_id") or "").strip()
        if not cid:
            continue
        companies.append(public_company_row(
            row,
            await offline_sync.pending_total(db, cid),
            await offline_sync.conflict_total(db, cid),
        ))
    companies.sort(key=lambda item: (item.get("name") or "").casefold())
    return {
        "companies": companies,
        "totals": {
            "companies": len(companies),
            "enabled": sum(1 for item in companies if item["offline_enabled"]),
            "pending": sum(item["pending"] for item in companies),
            "conflicts": sum(item["conflicts"] for item in companies),
        },
    }


async def _write_audit(**kwargs) -> None:
    import platform_store

    await platform_store.write_audit(**kwargs)


async def update_company_offline(db, company_id: str, body: Optional[dict], admin: dict, ip: str = "") -> dict:
    _only_super(admin)
    cid = str(company_id or "").strip()
    company = await db.companies.find_one({"_id": cid})
    if not isinstance(company, dict):
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    before = offline_sync.company_offline_policy(company)
    after = offline_sync.merge_offline_settings(company, body or {})
    changed = offline_sync.settings_changed(before, after)
    if changed:
        await db.companies.update_one({"_id": cid}, {"$set": {
            "offline_enabled": after["offline_enabled"],
            "offline_max_minutes": after["offline_max_minutes"],
            "offline_modules": after["offline_modules"],
            "idempotency_ttl_hours": after["idempotency_ttl_hours"],
        }})
        await _write_audit(
            actor_type="superadmin",
            actor_id=str(admin.get("_id") or admin.get("id") or ""),
            action="offline_settings_update",
            target_type="company",
            target_id=cid,
            ip=ip or "",
            details={"changed": changed},
        )
        company = await db.companies.find_one({"_id": cid}) or {**company, **after, "_id": cid}
    return public_company_row(
        company,
        await offline_sync.pending_total(db, cid),
        await offline_sync.conflict_total(db, cid),
    )


@router.get("/system/offline-admin")
async def offline_admin_overview(admin: dict = Depends(require_platform_admin)):
    _only_super(admin)
    return await list_overview(_database())


@router.put("/system/offline-admin/companies/{company_id}")
async def offline_admin_update(
    company_id: str,
    body: Dict[str, Any],
    request: Request,
    admin: dict = Depends(require_platform_admin),
):
    _only_super(admin)
    return await update_company_offline(_database(), company_id, body, admin, request_ip(request))
