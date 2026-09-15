"""Sistem paneli: şirket iş verilerini (fatura, sipariş, stok, teklif vb.) sıfırlama.

Şirket kaydı, lisans ve kullanıcılar korunur. Ek güvenlik: süper admin +
yönetici şifresi + şirket adı + onay cümlesi.
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Request

import applog
import saas
from auth_utils import verify_password

logger = logging.getLogger("company_reset")

router = APIRouter(prefix="/api")
_db = None

RESET_CONFIRM_PHRASE = "VERİLERİ SIFIRLA"

# Şirket/lisans/kullanıcı/platform koleksiyonları + roller korunur.
_SKIP_ON_RESET = frozenset(set(saas._SKIP_ON_COMPANY_DELETE) | {"roles", "sync_tombstones"})

# İş verisi toplamına dahil edilmeyen operasyonel koleksiyonlar.
_NON_BUSINESS = frozenset({"sync_tombstones", "storage_folders", "activity_logs"})

HIGHLIGHT_COLLECTIONS: Tuple[Tuple[str, str], ...] = (
    ("invoices", "Faturalar"),
    ("orders", "Siparişler"),
    ("products", "Stok / ürünler"),
    ("quotes", "Teklifler"),
    ("contacts", "Cariler"),
    ("stock_movements", "Stok hareketleri"),
    ("bank_accounts", "Banka hesapları"),
    ("bank_transactions", "Banka hareketleri"),
    ("expenses", "Giderler"),
    ("employees", "Personel"),
    ("projects", "Projeler"),
    ("surveys", "Keşifler"),
    ("edocs", "E-belgeler"),
    ("incoming_edocs", "Gelen e-belgeler"),
    ("files", "Dosyalar"),
    ("warehouses", "Depolar"),
    ("partners", "Ortaklar"),
    ("payrolls", "Bordrolar"),
    ("production_orders", "Üretim emirleri"),
    ("recipes", "Reçeteler"),
)


def init(db):
    global _db
    _db = db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uid(user: dict) -> str:
    return str(user.get("_id") or user.get("id") or "")


async def _verify_admin_password(admin: dict, password: str) -> None:
    pwd = (password or "").strip()
    if not pwd:
        raise HTTPException(status_code=400, detail="İşlem için yönetici şifrenizi girin.")
    raw = await _db.users.find_one({"_id": _uid(admin)})
    if not raw or not verify_password(pwd, raw.get("password_hash", "")):
        raise HTTPException(status_code=403, detail="Yönetici şifresi hatalı.")


async def _load_company(company_id: str) -> dict:
    c = await _db.companies.find_one({"_id": company_id})
    if not c:
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    return c


async def _product_ids(company_id: str) -> List[str]:
    rows = await _db.products.find({"company_id": company_id}, {"_id": 1}).to_list(50000)
    return [r["_id"] for r in rows if r.get("_id")]


async def _count_stock_movements(company_id: str, product_ids: Optional[List[str]] = None) -> int:
    pids = product_ids if product_ids is not None else await _product_ids(company_id)
    if not pids:
        return int(await _db.stock_movements.count_documents({"company_id": company_id}) or 0)
    return int(await _db.stock_movements.count_documents({"product_id": {"$in": pids}}) or 0)


async def _count_counters(company_id: str) -> int:
    return int(
        await _db.counters.count_documents({"_id": {"$regex": re.escape(company_id)}}) or 0
    )


async def preview_counts(company_id: str) -> Dict[str, Any]:
    names = await _db.list_collection_names()
    by_collection: Dict[str, int] = {}
    total = 0
    pids = await _product_ids(company_id)

    for name in names:
        if name in _SKIP_ON_RESET or name in _NON_BUSINESS:
            continue
        if name in ("stock_movements", "counters", "gib_wallets"):
            continue
        n = int(await _db[name].count_documents({"company_id": company_id}) or 0)
        if n:
            by_collection[name] = n
            total += n

    sm = await _count_stock_movements(company_id, pids)
    if sm:
        by_collection["stock_movements"] = sm
        total += sm

    ctr = await _count_counters(company_id)
    if ctr:
        by_collection["counters"] = ctr
        total += ctr

    lid = await saas.license_id_of(company_id)
    siblings = await saas.companies_on_license(lid)
    wallet = await _db.gib_wallets.find_one({"_id": lid}) or await _db.gib_wallets.find_one({"_id": company_id})
    wallet_action = "keep"
    if wallet and len(siblings) <= 1:
        wallet_action = "reset"
        by_collection["gib_wallets"] = 1
        total += 1

    highlight = [
        {"key": key, "label": label, "count": int(by_collection.get(key) or 0)}
        for key, label in HIGHLIGHT_COLLECTIONS
    ]

    users = int(await _db.users.count_documents(saas.tenant_user_query(company_id)) or 0)
    roles = int(await _db.roles.count_documents({"company_id": company_id}) or 0)

    return {
        "company_id": company_id,
        "by_collection": by_collection,
        "highlight": highlight,
        "total_docs": total,
        "kept": {
            "users": users,
            "roles": roles,
            "company": 1,
            "license": 1,
            "gib_wallet": wallet_action,
        },
        "confirm_phrase": RESET_CONFIRM_PHRASE,
    }


async def _delete_files_blobs(company_id: str) -> int:
    files = await _db.files.find({"company_id": company_id}).to_list(20000)
    if not files:
        return 0
    try:
        from storage_service import _safe_local_path as _local_path
    except Exception:
        _local_path = None

    for f in files:
        for key in ("storage_path", "path", "object_key", "key"):
            path = f.get(key)
            if not path or not isinstance(path, str):
                continue
            try:
                if _local_path:
                    target = _local_path(path)
                    if target.is_file():
                        target.unlink(missing_ok=True)
                    meta = target.with_suffix(target.suffix + ".meta.json")
                    if meta.is_file():
                        meta.unlink(missing_ok=True)
            except Exception:
                pass
            break

    await _db.files.delete_many({"company_id": company_id})
    return len(files)


async def wipe_company_business_data(company_id: str) -> Dict[str, int]:
    deleted: Dict[str, int] = {}
    names = await _db.list_collection_names()
    pids = await _product_ids(company_id)

    n = 0
    if pids:
        n += int(
            (await _db.stock_movements.delete_many({"product_id": {"$in": pids}})).deleted_count or 0
        )
    n += int((await _db.stock_movements.delete_many({"company_id": company_id})).deleted_count or 0)
    if n:
        deleted["stock_movements"] = n

    n_files = await _delete_files_blobs(company_id)
    if n_files:
        deleted["files"] = n_files

    for name in names:
        if name in _SKIP_ON_RESET:
            continue
        if name in ("stock_movements", "files", "counters", "gib_wallets"):
            continue
        # storage_folders silinip yeniden oluşturulur; tombstone'lara dokunulmaz
        if name == "sync_tombstones":
            continue
        n = int((await _db[name].delete_many({"company_id": company_id})).deleted_count or 0)
        if n:
            deleted[name] = deleted.get(name, 0) + n

    n_ctr = int(
        (await _db.counters.delete_many({"_id": {"$regex": re.escape(company_id)}})).deleted_count or 0
    )
    if n_ctr:
        deleted["counters"] = n_ctr

    lid = await saas.license_id_of(company_id)
    siblings = await saas.companies_on_license(lid)
    if len(siblings) <= 1:
        for wid in {lid, company_id}:
            n = int((await _db.gib_wallets.delete_one({"_id": wid})).deleted_count or 0)
            if n:
                deleted["gib_wallets"] = deleted.get("gib_wallets", 0) + n

    await _db.companies.update_one(
        {"_id": company_id},
        {
            "$set": {"has_demo": False, "data_reset_at": _now(), "updated_at": _now()},
            "$unset": {"demo_loaded_at": "", "demo_cleared_at": ""},
        },
    )

    try:
        import rbac

        await rbac.ensure_roles(company_id)
    except Exception as e:
        logger.warning("ensure_roles after reset failed: %s", e)

    try:
        import storage_manager

        await storage_manager.ensure_account_folders(company_id)
    except Exception as e:
        logger.warning("ensure_account_folders after reset failed: %s", e)

    return deleted


@router.get("/system/companies/{company_id}/reset-preview")
async def reset_preview(company_id: str, _: dict = Depends(saas.require_super_admin)):
    c = await _load_company(company_id)
    counts = await preview_counts(company_id)
    return {
        "id": company_id,
        "name": c.get("name"),
        "protected": company_id in saas.PROTECTED_COMPANY_IDS,
        **counts,
    }


@router.post("/system/companies/{company_id}/reset-data")
async def reset_company_data(
    company_id: str,
    req: Dict[str, Any],
    request: Request,
    admin: dict = Depends(saas.require_super_admin),
):
    c = await _load_company(company_id)

    confirm_name = (req.get("confirm_name") or "").strip()
    if confirm_name != (c.get("name") or "").strip():
        raise HTTPException(status_code=400, detail="Onay için şirket adını birebir yazın.")

    phrase = (req.get("confirm_phrase") or "").strip()
    if phrase != RESET_CONFIRM_PHRASE:
        raise HTTPException(status_code=400, detail=f'Onay cümlesi "{RESET_CONFIRM_PHRASE}" olmalıdır.')

    await _verify_admin_password(admin, req.get("admin_password") or "")

    before = await preview_counts(company_id)
    deleted = await wipe_company_business_data(company_id)
    after = await preview_counts(company_id)

    total_deleted = sum(deleted.values())
    applog.log_event(
        "company_data_reset",
        f"{c.get('name')} ({company_id}) reset by {admin.get('email')}",
        company_id=company_id,
        admin_id=_uid(admin),
        admin_email=admin.get("email"),
        ip=getattr(request.client, "host", None) if request.client else None,
        deleted=deleted,
        total_deleted=total_deleted,
    )
    await _db.activity_logs.insert_one({
        "_id": str(uuid.uuid4()),
        "company_id": company_id,
        "user_id": _uid(admin),
        "user_name": admin.get("name") or admin.get("email"),
        "method": "RESET",
        "path": f"/system/companies/{company_id}/reset-data",
        "module": "/sistem/veri-silme",
        "status": 200,
        "detail": f"company_data_reset:{total_deleted}",
        "created_at": _now(),
    })

    return {
        "status": "success",
        "id": company_id,
        "name": c.get("name"),
        "deleted": deleted,
        "total_deleted": total_deleted,
        "before_total": before.get("total_docs") or 0,
        "after_total": after.get("total_docs") or 0,
        "kept": before.get("kept") or {},
        "message": (
            f"{c.get('name')} iş verileri sıfırlandı "
            f"({total_deleted} kayıt). Kullanıcılar ve lisans korundu."
        ),
    }
