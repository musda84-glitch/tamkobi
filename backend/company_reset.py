"""Sistem paneli: şirket iş verilerini seçmeli veya toplu sıfırlama.

Kapsamlar: invoices, orders, stock, quotes (+ all = tüm iş verisi).
Şirket kaydı, lisans ve kullanıcılar korunur.
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Set, Tuple

from fastapi import APIRouter, Depends, HTTPException, Request

import applog
import saas
from auth_utils import verify_password

logger = logging.getLogger("company_reset")

router = APIRouter(prefix="/api")
_db = None

RESET_CONFIRM_PHRASE = "VERİLERİ SIFIRLA"
ALL_SCOPE = "all"

_SKIP_ON_RESET = frozenset(set(saas._SKIP_ON_COMPANY_DELETE) | {"roles", "sync_tombstones"})
_NON_BUSINESS = frozenset({"sync_tombstones", "storage_folders", "activity_logs"})

RESET_SCOPES: Dict[str, Dict[str, Any]] = {
    "invoices": {
        "label": "Faturalar",
        "description": "Satış/alış faturaları, e-belge arşivi, taksit ve iade bağları",
        "collections": (
            "invoices",
            "incoming_edocs",
            "outgoing_einvoice_xml",
            "e_invoices",
            "installments",
            "returns",
        ),
    },
    "orders": {
        "label": "Siparişler",
        "description": "Satış siparişleri ve depo toplama oturumları",
        "collections": ("orders", "order_pick_sessions"),
    },
    "stock": {
        "label": "Stoklar",
        "description": "Ürünler, stok hareketleri, lot, sayım, depo, reçete/üretim",
        "collections": (
            "products",
            "product_categories",
            "units",
            "stock_movements",
            "stock_lots",
            "stock_counts",
            "warehouse_transfers",
            "warehouses",
            "recipes",
            "production_orders",
            "work_orders",
            "label_templates",
        ),
    },
    "quotes": {
        "label": "Teklifler",
        "description": "Teklif kayıtları (keşif/proje silinmez)",
        "collections": ("quotes",),
    },
}

SCOPE_KEYS = tuple(RESET_SCOPES.keys())

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
    ("warehouses", "Depolar"),
    ("recipes", "Reçeteler"),
    ("production_orders", "Üretim emirleri"),
)


def init(db):
    global _db
    _db = db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _uid(user: dict) -> str:
    return str(user.get("_id") or user.get("id") or "")


def _normalize_scopes(raw: Optional[Sequence[Any]]) -> List[str]:
    if raw is None:
        return [ALL_SCOPE]
    if isinstance(raw, str):
        raw = [raw]
    items = [str(x).strip().lower() for x in raw if str(x).strip()]
    if not items or ALL_SCOPE in items or "hepsi" in items or "*" in items:
        return [ALL_SCOPE]
    unknown = [x for x in items if x not in RESET_SCOPES]
    if unknown:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Geçersiz kapsam: {', '.join(unknown)}. "
                f"Geçerli: {', '.join(SCOPE_KEYS)} veya all"
            ),
        )
    return [key for key in SCOPE_KEYS if key in items]


def _collections_for_scopes(scopes: Sequence[str]) -> Set[str]:
    """Boş set = tüm iş koleksiyonları (all)."""
    if ALL_SCOPE in scopes:
        return set()
    cols: Set[str] = set()
    for key in scopes:
        cols.update(RESET_SCOPES[key]["collections"])
    return cols


def _wants_stock_movements(scopes: Sequence[str]) -> bool:
    return ALL_SCOPE in scopes or "stock" in scopes


def _wants_files(scopes: Sequence[str]) -> bool:
    return ALL_SCOPE in scopes


def _wants_counters(scopes: Sequence[str]) -> bool:
    return ALL_SCOPE in scopes


def _wants_gib_wallet(scopes: Sequence[str]) -> bool:
    return ALL_SCOPE in scopes


def _scope_labels(scopes: Sequence[str]) -> str:
    if ALL_SCOPE in scopes:
        return "tüm iş verileri"
    return ", ".join(RESET_SCOPES[s]["label"] for s in scopes)


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
    return int(await _db.counters.count_documents({"_id": {"$regex": re.escape(company_id)}}) or 0)


async def preview_counts(company_id: str, scopes: Optional[Sequence[str]] = None) -> Dict[str, Any]:
    scopes_n = _normalize_scopes(scopes)
    names = await _db.list_collection_names()
    by_collection: Dict[str, int] = {}
    total = 0
    pids = await _product_ids(company_id)
    allowed = _collections_for_scopes(scopes_n)

    for name in names:
        if name in _SKIP_ON_RESET or name in _NON_BUSINESS:
            continue
        if name in ("stock_movements", "counters", "gib_wallets"):
            continue
        if allowed and name not in allowed:
            continue
        n = int(await _db[name].count_documents({"company_id": company_id}) or 0)
        if n:
            by_collection[name] = n
            total += n

    if _wants_stock_movements(scopes_n):
        sm = await _count_stock_movements(company_id, pids)
        if sm:
            by_collection["stock_movements"] = sm
            total += sm

    if _wants_counters(scopes_n):
        ctr = await _count_counters(company_id)
        if ctr:
            by_collection["counters"] = ctr
            total += ctr

    wallet_action = "keep"
    if _wants_gib_wallet(scopes_n):
        lid = await saas.license_id_of(company_id)
        siblings = await saas.companies_on_license(lid)
        wallet = await _db.gib_wallets.find_one({"_id": lid}) or await _db.gib_wallets.find_one({"_id": company_id})
        if wallet and len(siblings) <= 1:
            wallet_action = "reset"
            by_collection["gib_wallets"] = 1
            total += 1

    highlight = [
        {"key": key, "label": label, "count": int(by_collection.get(key) or 0)}
        for key, label in HIGHLIGHT_COLLECTIONS
        if (not allowed) or key in allowed or key in by_collection
    ]

    scope_cards = []
    for key in SCOPE_KEYS:
        meta = RESET_SCOPES[key]
        count = 0
        for col in meta["collections"]:
            if col == "stock_movements":
                count += await _count_stock_movements(company_id, pids)
            else:
                count += int(await _db[col].count_documents({"company_id": company_id}) or 0)
        scope_cards.append({
            "key": key,
            "label": meta["label"],
            "description": meta["description"],
            "count": count,
            "collections": list(meta["collections"]),
        })

    users = int(await _db.users.count_documents(saas.tenant_user_query(company_id)) or 0)
    roles = int(await _db.roles.count_documents({"company_id": company_id}) or 0)

    return {
        "company_id": company_id,
        "scopes": scopes_n,
        "available_scopes": scope_cards,
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


async def wipe_company_business_data(
    company_id: str,
    scopes: Optional[Sequence[str]] = None,
) -> Dict[str, int]:
    scopes_n = _normalize_scopes(scopes)
    deleted: Dict[str, int] = {}
    names = await _db.list_collection_names()
    pids = await _product_ids(company_id)
    allowed = _collections_for_scopes(scopes_n)

    if _wants_stock_movements(scopes_n):
        n = 0
        if pids:
            n += int(
                (await _db.stock_movements.delete_many({"product_id": {"$in": pids}})).deleted_count or 0
            )
        n += int((await _db.stock_movements.delete_many({"company_id": company_id})).deleted_count or 0)
        if n:
            deleted["stock_movements"] = n

    if _wants_files(scopes_n):
        n_files = await _delete_files_blobs(company_id)
        if n_files:
            deleted["files"] = n_files

    for name in names:
        if name in _SKIP_ON_RESET:
            continue
        if name in ("stock_movements", "files", "counters", "gib_wallets", "sync_tombstones"):
            continue
        if allowed and name not in allowed:
            continue
        n = int((await _db[name].delete_many({"company_id": company_id})).deleted_count or 0)
        if n:
            deleted[name] = deleted.get(name, 0) + n

    if _wants_counters(scopes_n):
        n_ctr = int(
            (await _db.counters.delete_many({"_id": {"$regex": re.escape(company_id)}})).deleted_count or 0
        )
        if n_ctr:
            deleted["counters"] = n_ctr

    if _wants_gib_wallet(scopes_n):
        lid = await saas.license_id_of(company_id)
        siblings = await saas.companies_on_license(lid)
        if len(siblings) <= 1:
            for wid in {lid, company_id}:
                n = int((await _db.gib_wallets.delete_one({"_id": wid})).deleted_count or 0)
                if n:
                    deleted["gib_wallets"] = deleted.get("gib_wallets", 0) + n

    update_doc: Dict[str, Any] = {
        "$set": {
            "data_reset_at": _now(),
            "data_reset_scopes": list(scopes_n),
            "updated_at": _now(),
        }
    }
    if ALL_SCOPE in scopes_n:
        update_doc["$set"]["has_demo"] = False
        update_doc["$unset"] = {"demo_loaded_at": "", "demo_cleared_at": ""}
    await _db.companies.update_one({"_id": company_id}, update_doc)

    if ALL_SCOPE in scopes_n or "stock" in scopes_n:
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
async def reset_preview(
    company_id: str,
    scopes: Optional[str] = None,
    _: dict = Depends(saas.require_super_admin),
):
    c = await _load_company(company_id)
    scope_list = [s.strip() for s in (scopes or "").split(",") if s.strip()] or None
    counts = await preview_counts(company_id, scope_list)
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

    if "scopes" in req:
        scopes_n = _normalize_scopes(req.get("scopes"))
    else:
        scopes_n = [ALL_SCOPE]

    before = await preview_counts(company_id, scopes_n)
    deleted = await wipe_company_business_data(company_id, scopes_n)
    after = await preview_counts(company_id, scopes_n)

    total_deleted = sum(deleted.values())
    applog.log_event(
        "company_data_reset",
        f"{c.get('name')} ({company_id}) scopes={scopes_n} by {admin.get('email')}",
        company_id=company_id,
        admin_id=_uid(admin),
        admin_email=admin.get("email"),
        ip=getattr(request.client, "host", None) if request.client else None,
        scopes=scopes_n,
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
        "detail": f"company_data_reset:{','.join(scopes_n)}:{total_deleted}",
        "created_at": _now(),
    })

    return {
        "status": "success",
        "id": company_id,
        "name": c.get("name"),
        "scopes": scopes_n,
        "deleted": deleted,
        "total_deleted": total_deleted,
        "before_total": before.get("total_docs") or 0,
        "after_total": after.get("total_docs") or 0,
        "kept": before.get("kept") or {},
        "message": (
            f"{c.get('name')} — {_scope_labels(scopes_n)} sıfırlandı "
            f"({total_deleted} kayıt). Kullanıcılar ve lisans korundu."
        ),
    }
