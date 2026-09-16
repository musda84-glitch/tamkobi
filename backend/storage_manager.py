"""Hesap bazlı depolama alan yöneticisi (OvoCRM tarzı klasör ağacı).

Her şirket için yüklenebilir alanlar `storage_folders` koleksiyonunda tutulur.
Blob yolu: `{APP_NAME}/accounts/{company_id}/{area}/...`
"""
from __future__ import annotations

import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from storage_service import APP_NAME

router = APIRouter(prefix="/api", tags=["storage"])

_db = None

STORAGE_AREAS = (
    {"key": "products", "label": "Ürün görselleri", "entity": "products", "icon": "package"},
    {"key": "company", "label": "Firma (logo / belgeler)", "entity": "company", "icon": "building"},
    {"key": "expenses", "label": "Gider fişleri", "entity": "expense", "icon": "receipt"},
    {"key": "employees", "label": "Personel belgeleri", "entity": "employee", "icon": "users"},
    {"key": "support", "label": "Destek ekleri", "entity": "support_ticket", "icon": "headset"},
    {"key": "quotes", "label": "Teklif ekleri", "entity": "quote", "icon": "file"},
    {"key": "projects", "label": "Proje ekleri", "entity": "project", "icon": "briefcase"},
    {"key": "surveys", "label": "Keşif ekleri", "entity": "survey", "icon": "ruler"},
    {"key": "purchase_invoices", "label": "Alış fatura PDF", "entity": "purchase_invoice", "icon": "file-text"},
    {"key": "sales_invoices", "label": "Satış fatura PDF/XML", "entity": "sales_invoice", "icon": "file-text"},
    {"key": "edocs", "label": "e-Belge arşivi", "entity": "edoc", "icon": "archive"},
    {"key": "misc", "label": "Diğer", "entity": "misc", "icon": "folder"},
)

_AREA_BY_KEY = {a["key"]: a for a in STORAGE_AREAS}
# entity / legacy alias → area_key (ürün yüklemeleri "product", alan anahtarı "products")
_AREA_BY_ENTITY: Dict[str, str] = {}
for _a in STORAGE_AREAS:
    _AREA_BY_ENTITY[_a["entity"]] = _a["key"]
    _AREA_BY_ENTITY[_a["key"]] = _a["key"]
_AREA_BY_ENTITY.update({
    "product": "products",
    "products": "products",
    "expense": "expenses",
    "employee": "employees",
    "support": "support",
    "support_ticket": "support",
    "quote": "quotes",
    "project": "projects",
    "survey": "surveys",
    "purchase_invoice": "purchase_invoices",
    "sales_invoice": "sales_invoices",
    "edoc": "edocs",
    "e_invoice": "edocs",
    "einvoice": "edocs",
})
_ENTITY_ALIASES: Dict[str, List[str]] = {}
for _ent, _key in _AREA_BY_ENTITY.items():
    _ENTITY_ALIASES.setdefault(_key, [])
    if _ent not in _ENTITY_ALIASES[_key]:
        _ENTITY_ALIASES[_key].append(_ent)

_ROUTES_BOUND = False


def init(db, get_current_user_dep, require_super_admin_dep):
    global _db
    _db = db
    _bind_routes(get_current_user_dep, require_super_admin_dep)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _slug(text: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9_-]+", "-", (text or "").strip().lower()).strip("-")
    return (s or "klasor")[:48]


def area_for_entity(entity: str) -> str:
    return _AREA_BY_ENTITY.get((entity or "misc").strip(), "misc")


def object_path(company_id: str, entity: str, filename_ext: str) -> str:
    area = area_for_entity(entity)
    ext = (filename_ext or "bin").lstrip(".")
    return f"{APP_NAME}/accounts/{company_id}/{area}/{uuid.uuid4().hex}.{ext}"


def folder_path(company_id: str, area_key: str) -> str:
    return f"{APP_NAME}/accounts/{company_id}/{area_key}"


async def ensure_account_folders(company_id: str, *, created_by: Optional[str] = None) -> List[dict]:
    if not company_id:
        raise HTTPException(status_code=400, detail="company_id gerekli.")
    out: List[dict] = []
    for area in STORAGE_AREAS:
        doc_id = f"sf_{company_id}_{area['key']}"
        existing = await _db.storage_folders.find_one({"_id": doc_id})
        if existing:
            out.append(existing)
            continue
        doc = {
            "_id": doc_id,
            "company_id": company_id,
            "area_key": area["key"],
            "label": area["label"],
            "entity": area["entity"],
            "icon": area["icon"],
            "path": folder_path(company_id, area["key"]),
            "is_system": True,
            "is_active": True,
            "created_by": created_by,
            "created_at": _now(),
            "updated_at": _now(),
        }
        await _db.storage_folders.update_one({"_id": doc_id}, {"$setOnInsert": doc}, upsert=True)
        out.append(await _db.storage_folders.find_one({"_id": doc_id}))
    return out


def _folder_match_ors(company_id: str, area_key: str) -> List[Dict[str, Any]]:
    path_re = f"/accounts/{re.escape(company_id)}/{re.escape(area_key)}/"
    # Eski düz yollar: tamkobi/products/{cid}/… veya tamkobi/purchase_invoice/{cid}/…
    legacy_ents = _ENTITY_ALIASES.get(area_key) or [area_key]
    ors: List[Dict[str, Any]] = [
        {"area_key": area_key},
        {"storage_path": {"$regex": path_re}},
    ]
    if not str(area_key).startswith("custom_"):
        for ent in legacy_ents:
            ors.append({"entity": ent})
            ors.append({"storage_path": {"$regex": f"/{re.escape(ent)}/{re.escape(company_id)}/"}})
    return ors


async def _folder_usage(company_id: str, area_key: str) -> Dict[str, int]:
    q: Dict[str, Any] = {
        "company_id": company_id,
        "is_deleted": {"$ne": True},
        "$or": _folder_match_ors(company_id, area_key),
    }
    files = await _db.files.find(q, {"size": 1}).to_list(20000)
    return {"file_count": len(files), "bytes": sum(int(f.get("size") or 0) for f in files)}


async def account_storage_summary(company_id: str) -> Dict[str, Any]:
    await ensure_account_folders(company_id)
    folders = await _db.storage_folders.find(
        {"company_id": company_id, "is_active": {"$ne": False}}
    ).sort("label", 1).to_list(100)
    rows = []
    total_bytes = total_files = 0
    for f in folders:
        usage = await _folder_usage(company_id, f.get("area_key") or "")
        total_bytes += usage["bytes"]
        total_files += usage["file_count"]
        rows.append({
            "id": f["_id"],
            "area_key": f.get("area_key"),
            "label": f.get("label"),
            "entity": f.get("entity"),
            "icon": f.get("icon"),
            "path": f.get("path"),
            "is_system": bool(f.get("is_system")),
            "file_count": usage["file_count"],
            "bytes": usage["bytes"],
        })
    return {
        "company_id": company_id,
        "folders": rows,
        "total_files": total_files,
        "total_bytes": total_bytes,
        "areas": [{"key": a["key"], "label": a["label"], "entity": a["entity"]} for a in STORAGE_AREAS],
    }


async def list_accounts_storage() -> List[Dict[str, Any]]:
    import saas

    rows = []
    companies = await _db.companies.find({}, {"name": 1, "license_id": 1, "tax_number": 1}).sort("name", 1).to_list(2000)
    for c in companies:
        cid = c["_id"]
        try:
            used = await saas.quota_usage(cid)
            lic = await saas.effective(cid)
        except Exception:
            used = {"storage_bytes": 0}
            lic = {"storage_limit_mb": 0, "plan_name": "—", "status": "—"}
        folder_n = await _db.storage_folders.count_documents({"company_id": cid, "is_active": {"$ne": False}})
        rows.append({
            "id": cid,
            "name": c.get("name") or cid,
            "tax_number": c.get("tax_number") or "",
            "plan_name": lic.get("plan_name"),
            "status": lic.get("status"),
            "storage_bytes": used.get("storage_bytes") or 0,
            "storage_limit_mb": lic.get("storage_limit_mb") or 0,
            "folder_count": folder_n,
        })
    return rows


async def create_custom_folder(company_id: str, label: str, *, created_by: Optional[str] = None) -> dict:
    await ensure_account_folders(company_id)
    label = (label or "").strip()
    if len(label) < 2:
        raise HTTPException(status_code=400, detail="Klasör adı en az 2 karakter olmalı.")
    key = f"custom_{_slug(label)}_{uuid.uuid4().hex[:4]}"
    doc_id = f"sf_{company_id}_{key}"
    doc = {
        "_id": doc_id,
        "company_id": company_id,
        "area_key": key,
        "label": label,
        "entity": "misc",
        "icon": "folder",
        "path": folder_path(company_id, key),
        "is_system": False,
        "is_active": True,
        "created_by": created_by,
        "created_at": _now(),
        "updated_at": _now(),
    }
    await _db.storage_folders.insert_one(doc)
    return doc


async def list_folder_files(company_id: str, area_key: str, limit: int = 200) -> List[dict]:
    q: Dict[str, Any] = {
        "company_id": company_id,
        "is_deleted": {"$ne": True},
        "$or": _folder_match_ors(company_id, area_key),
    }
    docs = await _db.files.find(q).sort("created_at", -1).to_list(limit)
    out = []
    for d in docs:
        path = d.get("storage_path") or ""
        out.append({
            "id": d.get("_id"),
            "filename": d.get("original_filename") or d.get("filename") or (path.split("/")[-1] if path else "dosya"),
            "content_type": d.get("content_type"),
            "size": int(d.get("size") or 0),
            "entity": d.get("entity"),
            "entity_id": d.get("entity_id"),
            "url": f"/api/files/{path}" if path else None,
            "created_at": d.get("created_at"),
        })
    return out


def _uid(user: dict) -> Optional[str]:
    return user.get("_id") or user.get("id")


def _active_company(user: dict) -> str:
    cid = user.get("active_company_id") or (user.get("company_ids") or [None])[0]
    if not cid:
        raise HTTPException(status_code=400, detail="Aktif şirket yok.")
    return cid


def _bind_routes(get_current_user, require_super_admin):
    global _ROUTES_BOUND
    if _ROUTES_BOUND:
        return
    _ROUTES_BOUND = True

    @router.get("/system/storage")
    async def system_storage_overview(admin: dict = Depends(require_super_admin)):
        accounts = await list_accounts_storage()
        return {
            "accounts": accounts,
            "total_accounts": len(accounts),
            "total_bytes": sum(a["storage_bytes"] for a in accounts),
            "areas": [{"key": a["key"], "label": a["label"]} for a in STORAGE_AREAS],
        }

    @router.get("/system/storage/{company_id}")
    async def system_storage_account(company_id: str, admin: dict = Depends(require_super_admin)):
        c = await _db.companies.find_one({"_id": company_id})
        if not c:
            raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
        import saas
        summary = await account_storage_summary(company_id)
        lic = await saas.effective(company_id)
        summary["company_name"] = c.get("name")
        summary["storage_limit_mb"] = lic.get("storage_limit_mb") or 0
        summary["plan_name"] = lic.get("plan_name")
        return summary

    @router.post("/system/storage/{company_id}/ensure")
    async def system_ensure_folders(company_id: str, admin: dict = Depends(require_super_admin)):
        folders = await ensure_account_folders(company_id, created_by=_uid(admin))
        return {
            "status": "ok",
            "folder_count": len(folders),
            "folders": [{"id": f["_id"], "area_key": f.get("area_key"), "label": f.get("label"), "path": f.get("path")} for f in folders],
        }

    @router.post("/system/storage/{company_id}/folders")
    async def system_create_folder(company_id: str, req: Dict[str, Any], admin: dict = Depends(require_super_admin)):
        doc = await create_custom_folder(company_id, req.get("label") or "", created_by=_uid(admin))
        return {"id": doc["_id"], "area_key": doc["area_key"], "label": doc["label"], "path": doc["path"]}

    @router.get("/system/storage/{company_id}/folders/{area_key}/files")
    async def system_folder_files(company_id: str, area_key: str, admin: dict = Depends(require_super_admin)):
        return {"files": await list_folder_files(company_id, area_key)}

    @router.post("/system/storage/ensure-all")
    async def system_ensure_all(admin: dict = Depends(require_super_admin)):
        n = 0
        companies = await _db.companies.find({}, {"_id": 1}).to_list(5000)
        for c in companies:
            await ensure_account_folders(c["_id"], created_by=_uid(admin))
            n += 1
        return {"status": "ok", "companies": n}

    @router.get("/storage/me")
    async def my_storage(user: dict = Depends(get_current_user)):
        cid = _active_company(user)
        import saas
        summary = await account_storage_summary(cid)
        lic = await saas.effective(cid)
        summary["storage_limit_mb"] = lic.get("storage_limit_mb") or 0
        summary["plan_name"] = lic.get("plan_name")
        return summary

    @router.post("/storage/me/ensure")
    async def my_storage_ensure(user: dict = Depends(get_current_user)):
        cid = _active_company(user)
        folders = await ensure_account_folders(cid, created_by=_uid(user))
        return {"status": "ok", "folder_count": len(folders)}

    @router.get("/storage/me/folders/{area_key}/files")
    async def my_folder_files(
        area_key: str,
        user: dict = Depends(get_current_user),
        limit: int = Query(200, ge=1, le=500),
    ):
        return {"files": await list_folder_files(_active_company(user), area_key, limit=limit)}

    @router.post("/storage/me/folders")
    async def my_create_folder(req: Dict[str, Any], user: dict = Depends(get_current_user)):
        role = (user.get("role") or "").lower()
        if role not in ("admin", "owner") and not user.get("is_super_admin"):
            raise HTTPException(status_code=403, detail="Klasör oluşturmak için yönetici yetkisi gerekir.")
        doc = await create_custom_folder(_active_company(user), req.get("label") or "", created_by=_uid(user))
        return {"id": doc["_id"], "area_key": doc["area_key"], "label": doc["label"], "path": doc["path"]}
