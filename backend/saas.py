"""Platform (SaaS) yönetimi: modül kataloğu, paketler, şirket lisansları (modül aç/kapat, deneme, askıya alma), süper admin paneli, yükseltme talepleri."""
import os
import time
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

import rbac
from auth_utils import hash_password, verify_password

router = APIRouter(prefix="/api")
_db = None
_current_user = None
_cache: Dict[str, Any] = {}
CACHE_TTL = 15

CORE_MODULES = {"/", "/settings", "/trash"}
CATEGORIES = {"/invoices": "Muhasebe", "/dispatches": "Muhasebe", "/contacts": "Muhasebe", "/installments": "Muhasebe", "/banking": "Finans", "/expenses": "Finans", "/loans": "Finans", "/reports": "Raporlama", "/accountant": "Raporlama",
              "/stock": "Stok & Depo", "/warehouses": "Stok & Depo", "/production": "Üretim", "/atolye": "Üretim", "/projects": "Satış", "/orders": "Satış", "/ecommerce": "E-Ticaret", "/cargo": "E-Ticaret", "/personnel": "İK", "/communication": "İletişim", "/ai-advisor": "Yapay Zeka"}
DESCRIPTIONS = {"/invoices": "Satış/alış faturaları, e-Fatura, e-Arşiv, gelen e-belge kutusu", "/dispatches": "e-İrsaliye oluşturma ve takip", "/contacts": "Müşteri/tedarikçi kartları, ekstre, bakiye, B2B portal", "/installments": "Taksitli satış ve ödeme planları",
                "/banking": "Banka, kasa, POS, virman, canlı banka eşleme", "/expenses": "Masraf ve bütçe yönetimi", "/loans": "Kredi ve kredi kartı takibi", "/reports": "Satış, alış, stok, nakit akışı, KDV, kârlılık raporları", "/accountant": "Mali müşavir paneli ve beyanname özetleri",
                "/stock": "Stok kartları, varyant, barkod ve etiket tasarımı", "/warehouses": "Çoklu depo, transfer, stok sayımı", "/production": "Reçete (BOM) ve üretim emirleri", "/atolye": "Tablet atölye ekranı ve iş emirleri", "/projects": "Teklif, proje ve keşif yönetimi",
                "/orders": "Sipariş yönetimi, toplu kargo, fiyat merkezi", "/ecommerce": "Trendyol, ShopPHP ve 60+ pazaryeri entegrasyonu", "/cargo": "Geliver ve kargo firmaları entegrasyonu", "/personnel": "Personel, bordro, puantaj, vardiya, izin", "/communication": "SMS, e-posta, WhatsApp Business", "/ai-advisor": "AI finans danışmanı, PDF/Excel akıllı aktarım"}

_STARTER = ["/invoices", "/dispatches", "/contacts", "/banking", "/expenses", "/stock", "/reports"]
_STANDARD = _STARTER + ["/installments", "/loans", "/projects", "/orders", "/communication", "/accountant"]
_PRO = _STANDARD + ["/ecommerce", "/cargo", "/warehouses", "/personnel", "/ai-advisor"]
_ALL = [k for k, _ in rbac.MODULES if k not in CORE_MODULES]
DEFAULT_PLANS = [
    {"_id": "plan_starter", "code": "starter", "name": "Başlangıç", "tagline": "Tek kişilik işletmeler için ön muhasebe", "price_monthly": 499, "price_yearly": 4990, "user_limit": 2, "modules": _STARTER, "color": "slate", "sort": 1, "is_public": True},
    {"_id": "plan_standard", "code": "standard", "name": "Standart", "tagline": "Satış ekibi olan KOBİ'ler için", "price_monthly": 899, "price_yearly": 8990, "user_limit": 5, "modules": _STANDARD, "color": "emerald", "sort": 2, "is_public": True, "is_popular": True},
    {"_id": "plan_pro", "code": "pro", "name": "Profesyonel", "tagline": "E-ticaret ve personel yöneten firmalar", "price_monthly": 1499, "price_yearly": 14990, "user_limit": 10, "modules": _PRO, "color": "indigo", "sort": 3, "is_public": True},
    {"_id": "plan_enterprise", "code": "enterprise", "name": "Kurumsal", "tagline": "Tüm modüller, sınırsız kullanıcı, üretim & atölye", "price_monthly": 2499, "price_yearly": 24990, "user_limit": 0, "modules": _ALL, "color": "amber", "sort": 4, "is_public": True},
]
STATUSES = ("trial", "active", "suspended", "expired", "cancelled")
STATUS_LABELS = {"trial": "Deneme", "active": "Aktif", "suspended": "Askıda", "expired": "Süresi Doldu", "cancelled": "İptal"}


def init(db, current_user_dep):
    global _db, _current_user
    _db, _current_user = db, current_user_dep


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(d: dict) -> dict:
    d = dict(d); d["id"] = d.pop("_id"); return d


def catalog():
    return [{"key": k, "label": l, "category": CATEGORIES.get(k, "Genel"), "description": DESCRIPTIONS.get(k, ""), "is_core": k in CORE_MODULES} for k, l in rbac.MODULES]


async def seed():
    for p in DEFAULT_PLANS:
        await _db.saas_plans.update_one({"_id": p["_id"]}, {"$setOnInsert": {**p, "created_at": _now()}}, upsert=True)
    async for c in _db.companies.find({}, {"_id": 1}):
        await _db.company_licenses.update_one({"_id": c["_id"]}, {"$setOnInsert": {"plan_id": "plan_enterprise", "status": "active", "started_at": _now(), "expires_at": None, "trial_ends_at": None, "module_overrides": {}, "user_limit": None, "notes": "Mevcut müşteri (otomatik)", "created_at": _now()}}, upsert=True)
    for email, name in ((os.environ.get("SUPER_ADMIN_EMAIL", "").strip().lower(), "Platform Yöneticisi"), ("admin@nexus.com", None)):
        if not email:
            continue
        u = await _db.users.find_one({"email": email})
        pwd = os.environ.get("SUPER_ADMIN_PASSWORD")
        if u:
            upd = {"is_super_admin": True}
            if pwd and name and not verify_password(pwd, u.get("password_hash", "")):
                upd["password_hash"] = hash_password(pwd)
            await _db.users.update_one({"_id": u["_id"]}, {"$set": upd})
        elif pwd:
            await _db.users.insert_one({"_id": f"usr_{uuid.uuid4().hex[:8]}", "email": email, "password_hash": hash_password(pwd), "name": name, "role": "admin", "is_super_admin": True, "company_ids": ["comp_nexus_main_01"], "active_company_id": "comp_nexus_main_01", "is_active": True, "preferences": {}, "created_at": _now()})
    await _db.login_attempts.delete_many({"identifier": {"$regex": f":{os.environ.get('SUPER_ADMIN_EMAIL', 'x@x').strip().lower()}$"}})


# ---------------- Effective license ----------------
async def effective(company_id: str) -> Dict[str, Any]:
    hit = _cache.get(company_id)
    if hit and hit[0] > time.time():
        return hit[1]
    lic = await _db.company_licenses.find_one({"_id": company_id})
    plan = await _db.saas_plans.find_one({"_id": (lic or {}).get("plan_id")}) if lic else None
    now = _now()
    status = (lic or {}).get("status", "active")
    if status == "trial" and lic.get("trial_ends_at") and lic["trial_ends_at"] < now:
        status = "expired"
    if status == "active" and lic and lic.get("expires_at") and lic["expires_at"] < now:
        status = "expired"
    locked = status in ("suspended", "expired", "cancelled")
    base = set(plan["modules"]) if plan else set(_ALL)
    mods = {}
    for k, _ in rbac.MODULES:
        on = k in CORE_MODULES or (not locked and (k in base))
        ov = (lic or {}).get("module_overrides", {}).get(k)
        if ov is not None and k not in CORE_MODULES and not locked:
            on = bool(ov)
        mods[k] = on
    end = (lic or {}).get("trial_ends_at") if status == "trial" else (lic or {}).get("expires_at")
    days_left = None
    if end:
        days_left = max(0, -(-int((datetime.fromisoformat(end) - datetime.now(timezone.utc)).total_seconds()) // 86400))
    res = {"company_id": company_id, "plan_id": plan["_id"] if plan else None, "plan_name": plan["name"] if plan else "Sınırsız", "plan_color": (plan or {}).get("color", "slate"), "status": status, "status_label": STATUS_LABELS.get(status, status), "locked": locked, "modules": mods,
           "enabled_count": sum(1 for k, v in mods.items() if v and k not in CORE_MODULES), "total_count": len(_ALL), "user_limit": (lic or {}).get("user_limit") if (lic or {}).get("user_limit") is not None else (plan or {}).get("user_limit", 0), "trial_ends_at": (lic or {}).get("trial_ends_at"), "expires_at": (lic or {}).get("expires_at"),
           "days_left": days_left, "module_overrides": (lic or {}).get("module_overrides", {}), "notes": (lic or {}).get("notes", ""), "billing_period": (lic or {}).get("billing_period", "monthly")}
    _cache[company_id] = (time.time() + CACHE_TTL, res)
    return res


def invalidate(company_id: Optional[str] = None):
    if company_id:
        _cache.pop(company_id, None)
    else:
        _cache.clear()


async def guard(request: Request, user: Optional[dict], module: Optional[str]):
    """Middleware hook: modül şirket lisansında kapalıysa 403."""
    if not module or module in CORE_MODULES:
        return None
    cid = request.query_params.get("company_id") or (user or {}).get("active_company_id") or "comp_nexus_main_01"
    lic = await effective(cid)
    if lic["modules"].get(module, True):
        return None
    label = dict(rbac.MODULES).get(module, module)
    msg = f"Paketiniz ({lic['plan_name']}) {lic['status_label'].lower()} durumda; modüller kilitli." if lic["locked"] else f"'{label}' modülü paketinizde ({lic['plan_name']}) aktif değil. Yükseltme için sistem yöneticinizle iletişime geçin."
    return JSONResponse({"detail": msg, "code": "module_disabled", "module": module, "plan": lic["plan_name"], "status": lic["status"]}, status_code=403)


async def check_user_limit(company_id: str):
    lic = await effective(company_id)
    limit = int(lic.get("user_limit") or 0)
    if limit and await _db.users.count_documents({"company_ids": company_id}) >= limit:
        raise HTTPException(status_code=403, detail=f"Kullanıcı limitine ulaşıldı ({limit}). Paketinizi yükseltin ({lic['plan_name']}).")


async def start_trial(company_id: str, plan_id: str = "plan_pro", days: int = 14):
    await _db.company_licenses.update_one({"_id": company_id}, {"$setOnInsert": {"plan_id": plan_id, "status": "trial", "started_at": _now(), "trial_ends_at": (datetime.now(timezone.utc) + timedelta(days=days)).isoformat(), "expires_at": None, "module_overrides": {}, "user_limit": None, "notes": f"{days} gün deneme", "created_at": _now()}}, upsert=True)
    invalidate(company_id)


# ---------------- Super admin dependency ----------------
async def require_super_admin(request: Request) -> dict:
    if not (request.cookies.get("access_token") or request.headers.get("Authorization", "").startswith("Bearer ")):
        raise HTTPException(status_code=401, detail="Sistem paneli için giriş yapmanız gerekiyor.")
    user = await _current_user(request)
    if not user.get("is_super_admin"):
        raise HTTPException(status_code=403, detail="Bu alan yalnızca platform (sistem) yöneticisine açıktır.")
    return user


async def _usage(company_id: str) -> Dict[str, Any]:
    last = await _db.activity_logs.find_one({"company_id": company_id}, sort=[("created_at", -1)])
    return {"users": await _db.users.count_documents({"company_ids": company_id}), "invoices": await _db.invoices.count_documents({"company_id": company_id}), "contacts": await _db.contacts.count_documents({"company_id": company_id}),
            "products": await _db.products.count_documents({"company_id": company_id}), "orders": await _db.orders.count_documents({"company_id": company_id}), "last_activity": (last or {}).get("created_at")}


async def _company_row(c: dict) -> Dict[str, Any]:
    lic = await effective(c["_id"])
    admin = await _db.users.find_one({"company_ids": c["_id"], "role": "admin"}, {"email": 1, "name": 1, "last_login_at": 1})
    return {"id": c["_id"], "name": c.get("name"), "tax_number": c.get("tax_number"), "city": c.get("city"), "phone": c.get("phone"), "email": c.get("email"), "created_at": c.get("created_at"), "admin": {"email": admin.get("email"), "name": admin.get("name"), "last_login_at": admin.get("last_login_at")} if admin else None, "license": lic, "usage": await _usage(c["_id"])}


# ---------------- System endpoints ----------------
@router.get("/system/overview")
async def overview(_: dict = Depends(require_super_admin)):
    rows = [await _company_row(c) for c in await _db.companies.find({}).to_list(500)]
    plans = {p["_id"]: p for p in await _db.saas_plans.find({}).to_list(50)}
    by_status: Dict[str, int] = {}
    by_plan: Dict[str, int] = {}
    mrr = 0.0
    for r in rows:
        l = r["license"]; by_status[l["status"]] = by_status.get(l["status"], 0) + 1
        by_plan[l["plan_name"]] = by_plan.get(l["plan_name"], 0) + 1
        if l["status"] == "active" and l["plan_id"] in plans:
            p = plans[l["plan_id"]]; mrr += float(p.get("price_yearly", 0)) / 12 if l.get("billing_period") == "yearly" else float(p.get("price_monthly", 0))
    module_usage = {k: sum(1 for r in rows if r["license"]["modules"].get(k)) for k in _ALL}
    expiring = sorted([r for r in rows if r["license"]["days_left"] is not None and r["license"]["days_left"] <= 7], key=lambda r: r["license"]["days_left"])
    pending = await _db.upgrade_requests.count_documents({"status": "pending"})
    return {"companies": len(rows), "users": await _db.users.count_documents({}), "by_status": by_status, "by_plan": by_plan, "mrr": round(mrr, 2), "module_usage": module_usage, "expiring": expiring[:10], "pending_requests": pending, "recent": sorted(rows, key=lambda r: r.get("created_at") or "", reverse=True)[:5]}


@router.get("/system/modules")
async def system_modules(_: dict = Depends(require_super_admin)):
    return catalog()


@router.get("/system/plans")
async def list_plans(_: dict = Depends(require_super_admin)):
    plans = [_clean(p) for p in await _db.saas_plans.find({}).sort("sort", 1).to_list(50)]
    for p in plans:
        p["company_count"] = await _db.company_licenses.count_documents({"plan_id": p["id"]})
    return plans


def _plan_payload(req: Dict[str, Any], base: Optional[dict] = None) -> Dict[str, Any]:
    b = base or {}
    mods = [m for m in (req.get("modules") if "modules" in req else b.get("modules", [])) if m in _ALL]
    name = (req.get("name") if "name" in req else b.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Paket adı gerekli.")
    return {"name": name, "tagline": (req.get("tagline") if "tagline" in req else b.get("tagline", "")) or "", "price_monthly": float(req.get("price_monthly", b.get("price_monthly", 0)) or 0), "price_yearly": float(req.get("price_yearly", b.get("price_yearly", 0)) or 0),
            "user_limit": int(req.get("user_limit", b.get("user_limit", 0)) or 0), "modules": mods, "color": req.get("color", b.get("color", "slate")), "sort": int(req.get("sort", b.get("sort", 99)) or 99), "is_public": bool(req.get("is_public", b.get("is_public", True))), "is_popular": bool(req.get("is_popular", b.get("is_popular", False)))}


@router.post("/system/plans")
async def create_plan(req: Dict[str, Any], _: dict = Depends(require_super_admin)):
    doc = {"_id": f"plan_{uuid.uuid4().hex[:6]}", "code": (req.get("code") or uuid.uuid4().hex[:6]).lower(), **_plan_payload(req), "created_at": _now()}
    await _db.saas_plans.insert_one(doc)
    return _clean(doc)


@router.put("/system/plans/{plan_id}")
async def update_plan(plan_id: str, req: Dict[str, Any], _: dict = Depends(require_super_admin)):
    p = await _db.saas_plans.find_one({"_id": plan_id})
    if not p:
        raise HTTPException(status_code=404, detail="Paket bulunamadı.")
    await _db.saas_plans.update_one({"_id": plan_id}, {"$set": {**_plan_payload(req, p), "updated_at": _now()}})
    invalidate()
    return _clean(await _db.saas_plans.find_one({"_id": plan_id}))


@router.delete("/system/plans/{plan_id}")
async def delete_plan(plan_id: str, _: dict = Depends(require_super_admin)):
    n = await _db.company_licenses.count_documents({"plan_id": plan_id})
    if n:
        raise HTTPException(status_code=400, detail=f"Bu paketi kullanan {n} şirket var; önce paketlerini değiştirin.")
    if not (await _db.saas_plans.delete_one({"_id": plan_id})).deleted_count:
        raise HTTPException(status_code=404, detail="Paket bulunamadı.")
    return {"status": "success"}


@router.get("/system/companies")
async def list_companies(_: dict = Depends(require_super_admin)):
    return [await _company_row(c) for c in await _db.companies.find({}).sort("created_at", -1).to_list(500)]


@router.get("/system/companies/{company_id}")
async def get_company(company_id: str, _: dict = Depends(require_super_admin)):
    c = await _db.companies.find_one({"_id": company_id})
    if not c:
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    row = await _company_row(c)
    row["users"] = [{"id": u["_id"], "name": u.get("name"), "email": u.get("email"), "role": u.get("role"), "is_active": u.get("is_active", True), "last_login_at": u.get("last_login_at")} for u in await _db.users.find({"company_ids": company_id}, {"password_hash": 0}).to_list(200)]
    row["requests"] = [_clean(r) for r in await _db.upgrade_requests.find({"company_id": company_id}).sort("created_at", -1).to_list(20)]
    return row


@router.post("/system/companies")
async def create_company(req: Dict[str, Any], _: dict = Depends(require_super_admin)):
    name = (req.get("name") or "").strip(); email = (req.get("admin_email") or "").strip().lower(); pwd = req.get("admin_password") or ""
    if not name or "@" not in email:
        raise HTTPException(status_code=400, detail="Şirket adı ve yönetici e-postası gerekli.")
    if len(pwd) < 6:
        raise HTTPException(status_code=400, detail="Yönetici şifresi en az 6 karakter olmalı.")
    if await _db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Bu e-posta ile kullanıcı zaten var.")
    plan_id = req.get("plan_id") or "plan_standard"
    if not await _db.saas_plans.find_one({"_id": plan_id}):
        raise HTTPException(status_code=400, detail="Geçersiz paket.")
    cid = f"comp_{uuid.uuid4().hex[:8]}"
    await _db.companies.insert_one({"_id": cid, "name": name, "tax_number": req.get("tax_number") or "", "tax_office": req.get("tax_office") or "", "address": req.get("address") or "", "city": req.get("city") or "", "phone": req.get("phone") or "", "email": email, "currency": "TRY", "created_at": _now()})
    uid = f"usr_{uuid.uuid4().hex[:8]}"
    await _db.users.insert_one({"_id": uid, "email": email, "password_hash": hash_password(pwd), "name": (req.get("admin_name") or name).strip(), "role": "admin", "company_ids": [cid], "active_company_id": cid, "is_active": True, "preferences": {}, "created_at": _now()})
    trial_days = int(req.get("trial_days") or 0)
    lic = {"plan_id": plan_id, "status": "trial" if trial_days else "active", "started_at": _now(), "trial_ends_at": (datetime.now(timezone.utc) + timedelta(days=trial_days)).isoformat() if trial_days else None, "expires_at": req.get("expires_at") or None, "module_overrides": {}, "user_limit": None, "billing_period": req.get("billing_period", "monthly"), "notes": req.get("notes") or "", "created_at": _now()}
    await _db.company_licenses.insert_one({"_id": cid, **lic})
    await rbac.ensure_roles(cid)
    invalidate(cid)
    return await _company_row(await _db.companies.find_one({"_id": cid}))


@router.put("/system/companies/{company_id}/license")
async def update_license(company_id: str, req: Dict[str, Any], _: dict = Depends(require_super_admin)):
    if not await _db.companies.find_one({"_id": company_id}):
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    upd: Dict[str, Any] = {}
    if "plan_id" in req:
        if not await _db.saas_plans.find_one({"_id": req["plan_id"]}):
            raise HTTPException(status_code=400, detail="Geçersiz paket.")
        upd["plan_id"] = req["plan_id"]
    if "status" in req:
        if req["status"] not in STATUSES:
            raise HTTPException(status_code=400, detail="Geçersiz durum.")
        upd["status"] = req["status"]
    for k in ("trial_ends_at", "expires_at", "billing_period"):
        if k in req:
            upd[k] = req[k] or None
    if "notes" in req:
        upd["notes"] = req["notes"] or ""
    if "user_limit" in req:
        upd["user_limit"] = int(req["user_limit"]) if req["user_limit"] not in (None, "") else None
    if "module_overrides" in req:
        upd["module_overrides"] = {k: bool(v) for k, v in (req["module_overrides"] or {}).items() if k in _ALL and v is not None}
    if "extend_days" in req:
        lic = await _db.company_licenses.find_one({"_id": company_id}) or {}
        key = "trial_ends_at" if (upd.get("status") or lic.get("status")) == "trial" else "expires_at"
        cur = lic.get(key)
        start = max(datetime.now(timezone.utc), datetime.fromisoformat(cur)) if cur else datetime.now(timezone.utc)
        upd[key] = (start + timedelta(days=int(req["extend_days"]))).isoformat()
    await _db.company_licenses.update_one({"_id": company_id}, {"$set": {**upd, "updated_at": _now()}, "$setOnInsert": {"created_at": _now(), "started_at": _now()}}, upsert=True)
    invalidate(company_id)
    return await effective(company_id)


@router.post("/system/companies/{company_id}/modules/{module_key:path}")
async def toggle_module(company_id: str, module_key: str, req: Dict[str, Any], _: dict = Depends(require_super_admin)):
    key = "/" + module_key.lstrip("/")
    if key not in _ALL:
        raise HTTPException(status_code=400, detail="Bilinmeyen ya da çekirdek modül.")
    lic = await _db.company_licenses.find_one({"_id": company_id}) or {}
    plan = await _db.saas_plans.find_one({"_id": lic.get("plan_id")}) or {"modules": _ALL}
    ov = dict(lic.get("module_overrides") or {})
    enabled = bool(req.get("enabled"))
    if enabled == (key in plan["modules"]):
        ov.pop(key, None)
    else:
        ov[key] = enabled
    await _db.company_licenses.update_one({"_id": company_id}, {"$set": {"module_overrides": ov, "updated_at": _now()}, "$setOnInsert": {"plan_id": "plan_enterprise", "status": "active", "created_at": _now()}}, upsert=True)
    invalidate(company_id)
    return await effective(company_id)


ROLE_CODES = [r["code"] for r in rbac.DEFAULT_ROLES]


def _user_row(u: dict, companies_by_id: Dict[str, dict]) -> Dict[str, Any]:
    cids = list(u.get("company_ids") or [])
    return {
        "id": u.get("_id") or u.get("id"),
        "name": u.get("name"),
        "email": u.get("email"),
        "role": u.get("role") or "admin",
        "is_super_admin": bool(u.get("is_super_admin")),
        "is_active": u.get("is_active", True),
        "company_ids": cids,
        "companies": [{"id": cid, "name": (companies_by_id.get(cid) or {}).get("name") or cid} for cid in cids],
        "active_company_id": u.get("active_company_id"),
        "last_login_at": u.get("last_login_at"),
        "created_at": u.get("created_at"),
    }


async def _companies_map() -> Dict[str, dict]:
    return {c["_id"]: c for c in await _db.companies.find({}).to_list(2000)}


async def _super_admin_count() -> int:
    return await _db.users.count_documents({"is_super_admin": True})


@router.get("/system/users")
async def system_list_users(q: Optional[str] = None, _: dict = Depends(require_super_admin)):
    comps = await _companies_map()
    rows = [_user_row(u, comps) for u in await _db.users.find({}).sort("name", 1).to_list(2000)]
    if q:
        ql = q.strip().lower()
        rows = [u for u in rows if ql in (u.get("name") or "").lower() or ql in (u.get("email") or "").lower()]
    return {"users": rows, "companies": [{"id": cid, "name": c.get("name")} for cid, c in comps.items()], "roles": [{"code": r["code"], "name": r["name"]} for r in rbac.DEFAULT_ROLES]}


@router.post("/system/users")
async def system_create_user(req: Dict[str, Any], _: dict = Depends(require_super_admin)):
    name = (req.get("name") or "").strip()
    email = (req.get("email") or "").strip().lower()
    pwd = (req.get("password") or "").strip()
    if not name or "@" not in email:
        raise HTTPException(status_code=400, detail="Ad ve geçerli e-posta gerekli.")
    if len(pwd) < 6:
        raise HTTPException(status_code=400, detail="Şifre en az 6 karakter olmalı.")
    if await _db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Bu e-posta ile kullanıcı zaten var.")
    role = req.get("role") or "admin"
    if role not in ROLE_CODES:
        raise HTTPException(status_code=400, detail="Geçersiz rol.")
    comps = await _companies_map()
    company_ids = [cid for cid in (req.get("company_ids") or []) if cid in comps]
    is_super = bool(req.get("is_super_admin"))
    if not company_ids and not is_super:
        raise HTTPException(status_code=400, detail="En az bir şirket seçin (veya platform yöneticisi işaretleyin).")
    for cid in company_ids:
        await rbac.ensure_roles(cid)
        if not is_super:
            await check_user_limit(cid)
    uid = f"usr_{uuid.uuid4().hex[:8]}"
    doc = {
        "_id": uid,
        "email": email,
        "password_hash": hash_password(pwd),
        "name": name,
        "role": role,
        "company_ids": company_ids,
        "active_company_id": company_ids[0] if company_ids else None,
        "is_active": req.get("is_active", True) is not False,
        "is_super_admin": is_super,
        "preferences": {},
        "created_at": _now(),
    }
    await _db.users.insert_one(doc)
    return _user_row(doc, comps)


@router.put("/system/users/{user_id}")
async def system_update_user(user_id: str, req: Dict[str, Any], admin: dict = Depends(require_super_admin)):
    u = await _db.users.find_one({"_id": user_id})
    if not u:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı.")
    comps = await _companies_map()
    upd: Dict[str, Any] = {}
    if "name" in req:
        name = (req.get("name") or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Ad boş olamaz.")
        upd["name"] = name
    if "email" in req:
        email = (req.get("email") or "").strip().lower()
        if "@" not in email:
            raise HTTPException(status_code=400, detail="Geçerli e-posta girin.")
        other = await _db.users.find_one({"email": email})
        if other and other["_id"] != user_id:
            raise HTTPException(status_code=400, detail="Bu e-posta başka bir kullanıcıya ait.")
        upd["email"] = email
    if "role" in req:
        if req["role"] not in ROLE_CODES:
            raise HTTPException(status_code=400, detail="Geçersiz rol.")
        if u.get("email") == "admin@nexus.com" and req["role"] != "admin":
            raise HTTPException(status_code=400, detail="Ana yönetici hesabının rolü değiştirilemez.")
        upd["role"] = req["role"]
    if "is_active" in req:
        active = bool(req["is_active"])
        if not active and u.get("is_super_admin") and await _super_admin_count() <= 1:
            raise HTTPException(status_code=400, detail="Son platform yöneticisi pasifleştirilemez.")
        upd["is_active"] = active
    if "is_super_admin" in req:
        flag = bool(req["is_super_admin"])
        if not flag and u.get("is_super_admin") and await _super_admin_count() <= 1:
            raise HTTPException(status_code=400, detail="Son platform yöneticisinin yetkisi alınamaz.")
        upd["is_super_admin"] = flag
    if "company_ids" in req:
        company_ids = [cid for cid in (req.get("company_ids") or []) if cid in comps]
        will_super = upd.get("is_super_admin", u.get("is_super_admin"))
        if not company_ids and not will_super:
            raise HTTPException(status_code=400, detail="En az bir şirket seçin (veya platform yöneticisi işaretleyin).")
        for cid in company_ids:
            await rbac.ensure_roles(cid)
            if cid not in (u.get("company_ids") or []) and not will_super:
                await check_user_limit(cid)
        upd["company_ids"] = company_ids
        active = req.get("active_company_id") or u.get("active_company_id")
        upd["active_company_id"] = active if active in company_ids else (company_ids[0] if company_ids else None)
    elif req.get("active_company_id"):
        if req["active_company_id"] not in (u.get("company_ids") or []):
            raise HTTPException(status_code=400, detail="Aktif şirket, kullanıcının şirketlerinden biri olmalı.")
        upd["active_company_id"] = req["active_company_id"]
    if req.get("password"):
        if len(str(req["password"])) < 6:
            raise HTTPException(status_code=400, detail="Şifre en az 6 karakter olmalı.")
        upd["password_hash"] = hash_password(str(req["password"]))
    if not upd:
        return _user_row(u, comps)
    await _db.users.update_one({"_id": user_id}, {"$set": {**upd, "updated_at": _now()}})
    return _user_row(await _db.users.find_one({"_id": user_id}), comps)


@router.delete("/system/users/{user_id}")
async def system_delete_user(user_id: str, admin: dict = Depends(require_super_admin)):
    u = await _db.users.find_one({"_id": user_id})
    if not u:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı.")
    if u.get("email") == "admin@nexus.com":
        raise HTTPException(status_code=400, detail="Ana yönetici silinemez.")
    if (admin.get("_id") or admin.get("id")) == user_id:
        raise HTTPException(status_code=400, detail="Kendi hesabınızı silemezsiniz.")
    if u.get("is_super_admin") and await _super_admin_count() <= 1:
        raise HTTPException(status_code=400, detail="Son platform yöneticisi silinemez.")
    await _db.users.delete_one({"_id": user_id})
    return {"status": "success"}


@router.get("/system/upgrade-requests")
async def list_requests(status: Optional[str] = None, _: dict = Depends(require_super_admin)):
    q = {"status": status} if status else {}
    return [_clean(r) for r in await _db.upgrade_requests.find(q).sort("created_at", -1).to_list(200)]


@router.put("/system/upgrade-requests/{req_id}")
async def resolve_request(req_id: str, req: Dict[str, Any], _: dict = Depends(require_super_admin)):
    r = await _db.upgrade_requests.find_one({"_id": req_id})
    if not r:
        raise HTTPException(status_code=404, detail="Talep bulunamadı.")
    status = req.get("status", "approved")
    if status not in ("approved", "rejected", "pending"):
        raise HTTPException(status_code=400, detail="Geçersiz durum.")
    await _db.upgrade_requests.update_one({"_id": req_id}, {"$set": {"status": status, "admin_note": req.get("note") or "", "resolved_at": _now()}})
    if status == "approved" and r.get("plan_id") and req.get("apply", True):
        await _db.company_licenses.update_one({"_id": r["company_id"]}, {"$set": {"plan_id": r["plan_id"], "status": "active", "updated_at": _now()}}, upsert=True)
        invalidate(r["company_id"])
    await _db.notifications.insert_one({"_id": str(uuid.uuid4()), "company_id": r["company_id"], "type": "license", "title": f"Paket talebiniz {'onaylandı' if status == 'approved' else 'reddedildi'}", "message": f"{r.get('plan_name')} paketi talebiniz {'onaylandı ve aktif edildi' if status == 'approved' else 'reddedildi'}. {req.get('note') or ''}".strip(), "ref_type": "license", "ref_id": req_id, "is_read": False, "created_at": _now()})
    return _clean(await _db.upgrade_requests.find_one({"_id": req_id}))


# ---------------- Customer-facing ----------------
@router.get("/license/me")
async def my_license(company_id: str = "comp_nexus_main_01"):
    lic = await effective(company_id)
    plans = [{**_clean(p), "modules": p["modules"]} for p in await _db.saas_plans.find({"is_public": True}).sort("sort", 1).to_list(20)]
    pending = await _db.upgrade_requests.find_one({"company_id": company_id, "status": "pending"})
    return {**lic, "catalog": catalog(), "plans": plans, "users": await _db.users.count_documents({"company_ids": company_id}), "pending_request": _clean(pending) if pending else None}


@router.post("/license/upgrade-request")
async def upgrade_request(req: Dict[str, Any], request: Request):
    cid = req.get("company_id") or "comp_nexus_main_01"
    plan = await _db.saas_plans.find_one({"_id": req.get("plan_id")})
    if not plan:
        raise HTTPException(status_code=400, detail="Paket seçin.")
    if await _db.upgrade_requests.find_one({"company_id": cid, "status": "pending"}):
        raise HTTPException(status_code=400, detail="Bekleyen bir talebiniz zaten var.")
    c = await _db.companies.find_one({"_id": cid}) or {}
    try:
        user = await _current_user(request)
    except HTTPException:
        user = {}
    doc = {"_id": str(uuid.uuid4()), "company_id": cid, "company_name": c.get("name"), "plan_id": plan["_id"], "plan_name": plan["name"], "modules": [m for m in (req.get("modules") or []) if m in _ALL], "message": (req.get("message") or "")[:500], "requested_by": user.get("email"), "status": "pending", "created_at": _now()}
    await _db.upgrade_requests.insert_one(doc)
    return {"status": "success", "message": f"{plan['name']} paketi için yükseltme talebiniz alındı; sistem yöneticisi onayladığında modüller açılır.", "request": _clean(doc)}
