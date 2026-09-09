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
DEFAULT_MODULE_PRICES = {
    "/invoices": 249, "/dispatches": 99, "/contacts": 129, "/installments": 79, "/reports": 99,
    "/banking": 129, "/expenses": 79, "/loans": 79, "/stock": 129, "/projects": 129,
    "/ecommerce": 249, "/cargo": 129, "/orders": 129, "/warehouses": 99, "/production": 199,
    "/atolye": 99, "/personnel": 159, "/communication": 99, "/ai-advisor": 129, "/accountant": 99,
}
CUSTOM_PLAN_ID = "plan_custom"
DEFAULT_PLANS = [
    {"_id": "plan_starter", "code": "starter", "name": "Başlangıç", "tagline": "Tek kişilik işletmeler için ön muhasebe", "price_monthly": 499, "price_yearly": 4990, "user_limit": 2, "company_limit": 1, "modules": _STARTER, "color": "slate", "sort": 1, "is_public": True},
    {"_id": "plan_standard", "code": "standard", "name": "Standart", "tagline": "Satış ekibi olan KOBİ'ler için", "price_monthly": 899, "price_yearly": 8990, "user_limit": 5, "company_limit": 2, "modules": _STANDARD, "color": "emerald", "sort": 2, "is_public": True, "is_popular": True},
    {"_id": "plan_pro", "code": "pro", "name": "Profesyonel", "tagline": "E-ticaret ve personel yöneten firmalar", "price_monthly": 1499, "price_yearly": 14990, "user_limit": 10, "company_limit": 5, "modules": _PRO, "color": "indigo", "sort": 3, "is_public": True},
    {"_id": "plan_enterprise", "code": "enterprise", "name": "Kurumsal", "tagline": "Tüm modüller, sınırsız kullanıcı, üretim & atölye", "price_monthly": 2499, "price_yearly": 24990, "user_limit": 0, "company_limit": 0, "modules": _ALL, "color": "amber", "sort": 4, "is_public": True},
    {"_id": CUSTOM_PLAN_ID, "code": "custom", "name": "Özel Paket", "tagline": "Siteden seçtiğiniz modüller", "price_monthly": 0, "price_yearly": 0, "user_limit": 5, "company_limit": 1, "modules": [], "color": "emerald", "sort": 90, "is_public": False},
]
STATUSES = ("trial", "active", "suspended", "expired", "cancelled")
STATUS_LABELS = {"trial": "Deneme", "active": "Aktif", "suspended": "Askıda", "expired": "Süresi Doldu", "cancelled": "İptal"}
PROTECTED_COMPANY_IDS = frozenset({"comp_nexus_main_01", "comp_nexus_b2b_02"})
_SKIP_ON_COMPANY_DELETE = frozenset({
    "saas_plans", "platform_settings", "users", "companies", "company_licenses", "login_attempts",
})
PROTECTED_USER_EMAILS = frozenset({"admin@nexus.com"})


def init(db, current_user_dep):
    global _db, _current_user
    _db, _current_user = db, current_user_dep


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(d: dict) -> dict:
    d = dict(d); d["id"] = d.pop("_id"); return d


def catalog():
    return [{"key": k, "label": l, "category": CATEGORIES.get(k, "Genel"), "description": DESCRIPTIONS.get(k, ""), "is_core": k in CORE_MODULES} for k, l in rbac.MODULES]


def _yearly_of(monthly) -> float:
    return round(float(monthly or 0) * 10, 2)


async def module_prices() -> Dict[str, float]:
    st = await _db.platform_settings.find_one({"_id": "platform"}) or {}
    saved = st.get("module_prices") or {}
    out = {k: float(v) for k, v in DEFAULT_MODULE_PRICES.items()}
    for k, v in saved.items():
        if k in _ALL:
            try:
                out[k] = float(v)
            except (TypeError, ValueError):
                pass
    return out


async def catalog_with_prices():
    prices = await module_prices()
    rows = []
    for row in catalog():
        if row["is_core"]:
            rows.append({**row, "price_monthly": 0, "price_yearly": 0})
        else:
            monthly = prices.get(row["key"], 0)
            rows.append({**row, "price_monthly": monthly, "price_yearly": _yearly_of(monthly)})
    return rows


def normalize_module_keys(raw) -> list:
    keys = []
    for item in raw or []:
        k = str(item or "").strip()
        if not k:
            continue
        if not k.startswith("/"):
            k = "/" + k
        if k in _ALL:
            keys.append(k)
    return list(dict.fromkeys(keys))


def quote_modules(keys, prices: Dict[str, float]) -> Dict[str, float]:
    monthly = round(sum(float(prices.get(k, 0) or 0) for k in keys if k in _ALL), 2)
    return {"price_monthly": monthly, "price_yearly": _yearly_of(monthly)}


def overrides_for(keys) -> Dict[str, bool]:
    wanted = set(keys or [])
    return {k: (k in wanted) for k in _ALL}


async def ensure_custom_plan() -> dict:
    p = await _db.saas_plans.find_one({"_id": CUSTOM_PLAN_ID})
    if p:
        return p
    doc = next(x for x in DEFAULT_PLANS if x["_id"] == CUSTOM_PLAN_ID)
    await _db.saas_plans.insert_one({**doc, "created_at": _now()})
    return await _db.saas_plans.find_one({"_id": CUSTOM_PLAN_ID})


async def license_id_of(company_id: str) -> str:
    c = await _db.companies.find_one({"_id": company_id}, {"license_id": 1})
    return (c or {}).get("license_id") or company_id


async def companies_on_license(license_id: str) -> list:
    rows = await _db.companies.find({"$or": [{"license_id": license_id}, {"_id": license_id}]}).to_list(200)
    seen, out = set(), []
    for r in rows:
        rid = r["_id"]
        if rid in seen:
            continue
        seen.add(rid)
        out.append(r)
    return out


def user_company_ids(user: Optional[dict]) -> list:
    return [c for c in ((user or {}).get("company_ids") or []) if c]


def user_may_access_company(user: Optional[dict], company_id: str) -> bool:
    """Tenant isolation: a signed-in non-platform user may only touch assigned companies."""
    if not user or user.get("is_super_admin"):
        return True
    return company_id in user_company_ids(user)


async def seed():
    for p in DEFAULT_PLANS:
        await _db.saas_plans.update_one({"_id": p["_id"]}, {"$setOnInsert": {**p, "created_at": _now()}}, upsert=True)
        cur = await _db.saas_plans.find_one({"_id": p["_id"]})
        if cur is not None and cur.get("company_limit") is None:
            await _db.saas_plans.update_one({"_id": p["_id"]}, {"$set": {"company_limit": p.get("company_limit", 1)}})
    async for c in _db.companies.find({}, {"_id": 1, "license_id": 1}):
        if not c.get("license_id"):
            await _db.companies.update_one({"_id": c["_id"]}, {"$set": {"license_id": c["_id"]}})
        lid = c.get("license_id") or c["_id"]
        if lid != c["_id"]:
            continue
        await _db.company_licenses.update_one({"_id": c["_id"]}, {"$setOnInsert": {"plan_id": "plan_enterprise", "status": "active", "started_at": _now(), "expires_at": None, "trial_ends_at": None, "module_overrides": {}, "user_limit": None, "company_limit": None, "notes": "Mevcut müşteri (otomatik)", "created_at": _now()}}, upsert=True)
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
    st = await _db.platform_settings.find_one({"_id": "platform"}) or {}
    site = {"brand_name": "TamKobi", "public_url": "https://tamkobi.com"}
    if not st:
        await _db.platform_settings.insert_one({"_id": "platform", "reminder_days": [7, 1], "email_enabled": True, "whatsapp_enabled": True, "sender_company_id": "comp_nexus_main_01", "trial_days": 14, "trial_plan_id": "plan_pro", "support_email": "", "support_phone": "", "currency": "try", **site, "created_at": _now()})
    else:
        patch = {}
        url = (st.get("public_url") or "").strip()
        if not url or "takibi.com" in url.lower():
            patch["public_url"] = site["public_url"]
        if (st.get("brand_name") or "") in ("", "NexusHesap", "Takibi"):
            patch["brand_name"] = "TamKobi"
        if patch:
            await _db.platform_settings.update_one({"_id": "platform"}, {"$set": patch})


# ---------------- Effective license ----------------
async def effective(company_id: str) -> Dict[str, Any]:
    lid = await license_id_of(company_id)
    hit = _cache.get(lid)
    if hit and hit[0] > time.time():
        res = dict(hit[1])
        res["company_id"] = company_id
        return res
    lic = await _db.company_licenses.find_one({"_id": lid}) or await _db.company_licenses.find_one({"_id": company_id})
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
    siblings = await companies_on_license(lid)
    plan_company_limit = int((plan or {}).get("company_limit") or 0)
    lic_company_limit = (lic or {}).get("company_limit")
    company_limit = int(lic_company_limit) if lic_company_limit is not None else plan_company_limit
    res = {"company_id": company_id, "license_id": lid, "plan_id": plan["_id"] if plan else None, "plan_name": plan["name"] if plan else "Sınırsız", "plan_color": (plan or {}).get("color", "slate"), "status": status, "status_label": STATUS_LABELS.get(status, status), "locked": locked, "modules": mods,
           "enabled_count": sum(1 for k, v in mods.items() if v and k not in CORE_MODULES), "total_count": len(_ALL), "user_limit": (lic or {}).get("user_limit") if (lic or {}).get("user_limit") is not None else (plan or {}).get("user_limit", 0),
           "company_limit": company_limit, "company_count": len(siblings),
           "trial_ends_at": (lic or {}).get("trial_ends_at"), "expires_at": (lic or {}).get("expires_at"),
           "days_left": days_left, "module_overrides": (lic or {}).get("module_overrides", {}), "notes": (lic or {}).get("notes", ""), "billing_period": (lic or {}).get("billing_period", "monthly"),
           "custom_price_monthly": (lic or {}).get("custom_price_monthly"), "custom_price_yearly": (lic or {}).get("custom_price_yearly")}
    _cache[lid] = (time.time() + CACHE_TTL, dict(res))
    return res


def invalidate(company_id: Optional[str] = None):
    if company_id:
        _cache.pop(company_id, None)
        # siblings share the license cache key
        _cache.clear()
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


def tenant_user_query(company_id: str) -> dict:
    """Company staff only — platform (super) admins are not tenant seats."""
    return {"company_ids": company_id, "is_super_admin": {"$ne": True}}


async def check_user_limit(company_id: str):
    lic = await effective(company_id)
    limit = int(lic.get("user_limit") or 0)
    if limit and await _db.users.count_documents(tenant_user_query(company_id)) >= limit:
        raise HTTPException(status_code=403, detail=f"Kullanıcı limitine ulaşıldı ({limit}). Paketinizi yükseltin ({lic['plan_name']}).")


async def check_company_limit(company_id: str):
    lic = await effective(company_id)
    limit = int(lic.get("company_limit") or 0)
    if limit and int(lic.get("company_count") or 0) >= limit:
        raise HTTPException(status_code=403, detail=f"Şirket limitine ulaşıldı ({limit}). Paketiniz ({lic['plan_name']}) bu kadar yasal şirket açmaya izin veriyor. Yükseltin veya mevcut şirketi kullanın.")


async def add_licensed_company(parent_company_id: str, req: Dict[str, Any], attach_user: Optional[dict] = None) -> dict:
    """Open another isolated legal entity under the same subscription/license."""
    parent = await _db.companies.find_one({"_id": parent_company_id})
    if not parent:
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    await check_company_limit(parent_company_id)
    name = (req.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Şirket ünvanı gerekli.")
    lid = await license_id_of(parent_company_id)
    cid = f"comp_{uuid.uuid4().hex[:8]}"
    await _db.companies.insert_one({
        "_id": cid, "name": name, "tax_number": req.get("tax_number") or "", "tax_office": req.get("tax_office") or "",
        "address": req.get("address") or "", "city": req.get("city") or "", "phone": req.get("phone") or "",
        "email": req.get("email") or parent.get("email") or "", "currency": parent.get("currency") or "TRY",
        "license_id": lid, "created_at": _now(),
    })
    await rbac.ensure_roles(cid)
    admins = await _db.users.find({"company_ids": parent_company_id, "role": "admin", "is_super_admin": {"$ne": True}}).to_list(50)
    ids = {u["_id"] for u in admins}
    if attach_user and (attach_user.get("_id") or attach_user.get("id")):
        ids.add(attach_user.get("_id") or attach_user.get("id"))
    for uid in ids:
        await _db.users.update_one({"_id": uid}, {"$addToSet": {"company_ids": cid}})
    invalidate(lid)
    return await _db.companies.find_one({"_id": cid})


async def start_trial(company_id: str, plan_id: str = "plan_pro", days: int = 14, module_overrides: Optional[dict] = None, extra: Optional[dict] = None):
    doc = {"plan_id": plan_id, "status": "trial", "started_at": _now(), "trial_ends_at": (datetime.now(timezone.utc) + timedelta(days=days)).isoformat(), "expires_at": None, "module_overrides": module_overrides or {}, "user_limit": None, "notes": f"{days} gün deneme", "created_at": _now()}
    if extra:
        doc.update(extra)
    # $set (not $setOnInsert): a new company must actually receive the trial even if
    # seed() already inserted a stub license, and the MySQL upsert must keep _id=company_id.
    await _db.company_licenses.update_one({"_id": company_id}, {"$set": {**doc, "_id": company_id}}, upsert=True)
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
    return {"users": await _db.users.count_documents(tenant_user_query(company_id)), "invoices": await _db.invoices.count_documents({"company_id": company_id}), "contacts": await _db.contacts.count_documents({"company_id": company_id}),
            "products": await _db.products.count_documents({"company_id": company_id}), "orders": await _db.orders.count_documents({"company_id": company_id}), "last_activity": (last or {}).get("created_at")}


async def _company_row(c: dict) -> Dict[str, Any]:
    lic = await effective(c["_id"])
    admin = await _db.users.find_one({**tenant_user_query(c["_id"]), "role": "admin"}, {"email": 1, "name": 1, "last_login_at": 1}) or await _db.users.find_one({"company_ids": c["_id"], "role": "admin"}, {"email": 1, "name": 1, "last_login_at": 1})
    lid = lic.get("license_id") or c["_id"]
    siblings = [{"id": s["_id"], "name": s.get("name"), "tax_number": s.get("tax_number"), "city": s.get("city"), "primary": s["_id"] == lid} for s in await companies_on_license(lid)]
    return {"id": c["_id"], "name": c.get("name"), "tax_number": c.get("tax_number"), "city": c.get("city"), "phone": c.get("phone"), "email": c.get("email"), "created_at": c.get("created_at"), "license_id": lid, "license_companies": siblings, "protected": c["_id"] in PROTECTED_COMPANY_IDS, "admin": {"email": admin.get("email"), "name": admin.get("name"), "last_login_at": admin.get("last_login_at")} if admin else None, "license": lic, "usage": await _usage(c["_id"])}


def _restore_active_status(lic: Optional[dict]) -> str:
    """Pasiften çıkınca deneme süresi duruyorsa trial, aksi halde active."""
    lic = lic or {}
    end = lic.get("trial_ends_at")
    if end:
        try:
            if datetime.fromisoformat(end) > datetime.now(timezone.utc):
                return "trial"
        except (TypeError, ValueError):
            pass
    return "active"


async def _detach_company_users(company_id: str) -> Dict[str, int]:
    deleted = detached = 0
    users = await _db.users.find({"company_ids": company_id}).to_list(2000)
    for u in users:
        remaining = [x for x in (u.get("company_ids") or []) if x != company_id]
        protect = bool(u.get("is_super_admin")) or (u.get("email") or "").strip().lower() in PROTECTED_USER_EMAILS
        if not remaining and not protect:
            await _db.users.delete_one({"_id": u["_id"]})
            deleted += 1
            continue
        upd: Dict[str, Any] = {"company_ids": remaining, "updated_at": _now()}
        if u.get("active_company_id") == company_id:
            upd["active_company_id"] = remaining[0] if remaining else None
        await _db.users.update_one({"_id": u["_id"]}, {"$set": upd})
        detached += 1
    return {"deleted": deleted, "detached": detached}


# ---------------- System endpoints ----------------
@router.get("/system/overview")
async def overview(_: dict = Depends(require_super_admin)):
    rows = [await _company_row(c) for c in await _db.companies.find({}).to_list(500)]
    plans = {p["_id"]: p for p in await _db.saas_plans.find({}).to_list(50)}
    by_status: Dict[str, int] = {}
    by_plan: Dict[str, int] = {}
    mrr = 0.0
    billed = set()
    for r in rows:
        l = r["license"]; by_status[l["status"]] = by_status.get(l["status"], 0) + 1
        by_plan[l["plan_name"]] = by_plan.get(l["plan_name"], 0) + 1
        lid = l.get("license_id") or r["id"]
        if l["status"] == "active" and l["plan_id"] in plans and lid not in billed:
            billed.add(lid)
            p = plans[l["plan_id"]]; mrr += float(p.get("price_yearly", 0)) / 12 if l.get("billing_period") == "yearly" else float(p.get("price_monthly", 0))
    module_usage = {k: sum(1 for r in rows if r["license"]["modules"].get(k)) for k in _ALL}
    expiring = sorted([r for r in rows if r["license"]["days_left"] is not None and r["license"]["days_left"] <= 7], key=lambda r: r["license"]["days_left"])
    pending = await _db.upgrade_requests.count_documents({"status": "pending"})
    return {"companies": len(rows), "users": await _db.users.count_documents({"is_super_admin": {"$ne": True}}), "platform_admins": await _db.users.count_documents({"is_super_admin": True}), "by_status": by_status, "by_plan": by_plan, "mrr": round(mrr, 2), "module_usage": module_usage, "expiring": expiring[:10], "pending_requests": pending, "recent": sorted(rows, key=lambda r: r.get("created_at") or "", reverse=True)[:5]}


@router.get("/system/modules")
async def system_modules(_: dict = Depends(require_super_admin)):
    return await catalog_with_prices()


@router.put("/system/modules/prices")
async def save_module_prices(req: Dict[str, Any], _: dict = Depends(require_super_admin)):
    raw = req.get("prices") or req
    prices = {}
    for k, v in (raw or {}).items():
        key = k if str(k).startswith("/") else "/" + str(k).lstrip("/")
        if key not in _ALL:
            continue
        try:
            prices[key] = max(0, float(v))
        except (TypeError, ValueError):
            continue
    await _db.platform_settings.update_one({"_id": "platform"}, {"$set": {"module_prices": prices, "updated_at": _now()}}, upsert=True)
    return await catalog_with_prices()


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
            "user_limit": int(req.get("user_limit", b.get("user_limit", 0)) or 0), "company_limit": int(req.get("company_limit", b.get("company_limit", 1)) or 0), "modules": mods, "color": req.get("color", b.get("color", "slate")), "sort": int(req.get("sort", b.get("sort", 99)) or 99), "is_public": bool(req.get("is_public", b.get("is_public", True))), "is_popular": bool(req.get("is_popular", b.get("is_popular", False)))}


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
    payload = _plan_payload(req, p)
    if plan_id == CUSTOM_PLAN_ID:
        payload["is_public"] = False
        payload["modules"] = []
    await _db.saas_plans.update_one({"_id": plan_id}, {"$set": {**payload, "updated_at": _now()}})
    invalidate()
    return _clean(await _db.saas_plans.find_one({"_id": plan_id}))


@router.delete("/system/plans/{plan_id}")
async def delete_plan(plan_id: str, _: dict = Depends(require_super_admin)):
    n = await _db.company_licenses.count_documents({"plan_id": plan_id})
    if n:
        raise HTTPException(status_code=400, detail=f"Bu paketi kullanan {n} şirket var; önce paketlerini değiştirin.")
    if plan_id == CUSTOM_PLAN_ID:
        raise HTTPException(status_code=400, detail="Özel paket silinemez.")
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
    row["users"] = [{"id": u["_id"], "name": u.get("name"), "email": u.get("email"), "role": u.get("role"), "is_active": u.get("is_active", True), "last_login_at": u.get("last_login_at")} for u in await _db.users.find(tenant_user_query(company_id), {"password_hash": 0}).to_list(200)]
    row["requests"] = [_clean(r) for r in await _db.upgrade_requests.find({"company_id": company_id}).sort("created_at", -1).to_list(20)]
    return row


@router.post("/system/companies/{company_id}/companies")
async def system_add_licensed_company(company_id: str, req: Dict[str, Any], _: dict = Depends(require_super_admin)):
    doc = await add_licensed_company(company_id, req)
    return await _company_row(doc)


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
    await _db.companies.insert_one({"_id": cid, "name": name, "tax_number": req.get("tax_number") or "", "tax_office": req.get("tax_office") or "", "address": req.get("address") or "", "city": req.get("city") or "", "phone": req.get("phone") or "", "email": email, "currency": "TRY", "license_id": cid, "created_at": _now()})
    uid = f"usr_{uuid.uuid4().hex[:8]}"
    await _db.users.insert_one({"_id": uid, "email": email, "password_hash": hash_password(pwd), "name": (req.get("admin_name") or name).strip(), "role": "admin", "company_ids": [cid], "active_company_id": cid, "is_active": True, "preferences": {}, "created_at": _now()})
    trial_days = int(req.get("trial_days") or 0)
    lic = {"plan_id": plan_id, "status": "trial" if trial_days else "active", "started_at": _now(), "trial_ends_at": (datetime.now(timezone.utc) + timedelta(days=trial_days)).isoformat() if trial_days else None, "expires_at": req.get("expires_at") or None, "module_overrides": {}, "user_limit": None, "billing_period": req.get("billing_period", "monthly"), "notes": req.get("notes") or "", "created_at": _now()}
    await _db.company_licenses.insert_one({"_id": cid, **lic})
    await rbac.ensure_roles(cid)
    invalidate(cid)
    return await _company_row(await _db.companies.find_one({"_id": cid}))


@router.delete("/system/companies/{company_id}")
async def delete_company(company_id: str, _: dict = Depends(require_super_admin)):
    c = await _db.companies.find_one({"_id": company_id})
    if not c:
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    if company_id in PROTECTED_COMPANY_IDS:
        raise HTTPException(status_code=400, detail="Platform demo şirketleri silinemez.")
    st = await _db.platform_settings.find_one({"_id": "platform"}) or {}
    if st.get("sender_company_id") == company_id:
        raise HTTPException(status_code=400, detail="Platform gönderici şirketi silinemez. Önce ayarlardan başka bir gönderici seçin.")
    users = await _detach_company_users(company_id)
    collections = 0
    names = await _db.list_collection_names()
    for name in names:
        if name in _SKIP_ON_COMPANY_DELETE:
            continue
        collections += int((await _db[name].delete_many({"company_id": company_id})).deleted_count or 0)
    await _db.company_licenses.delete_one({"_id": company_id})
    await _db.companies.delete_one({"_id": company_id})
    invalidate(company_id)
    return {"status": "success", "id": company_id, "name": c.get("name"), "users": users, "deleted_docs": collections}


@router.post("/system/companies/{company_id}/activation")
async def set_company_activation(company_id: str, req: Dict[str, Any], _: dict = Depends(require_super_admin)):
    if not await _db.companies.find_one({"_id": company_id}):
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    lic = await _db.company_licenses.find_one({"_id": company_id}) or {}
    status = _restore_active_status(lic) if bool(req.get("active", True)) else "suspended"
    await _db.company_licenses.update_one({"_id": company_id}, {"$set": {"status": status, "updated_at": _now()}, "$setOnInsert": {"created_at": _now(), "started_at": _now()}}, upsert=True)
    invalidate(company_id)
    return await effective(company_id)


@router.put("/system/companies/{company_id}/license")
async def update_license(company_id: str, req: Dict[str, Any], _: dict = Depends(require_super_admin)):
    if not await _db.companies.find_one({"_id": company_id}):
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    lid = await license_id_of(company_id)
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
    if "company_limit" in req:
        upd["company_limit"] = int(req["company_limit"]) if req["company_limit"] not in (None, "") else None
    if "module_overrides" in req:
        upd["module_overrides"] = {k: bool(v) for k, v in (req["module_overrides"] or {}).items() if k in _ALL and v is not None}
    if "extend_days" in req:
        lic = await _db.company_licenses.find_one({"_id": lid}) or {}
        key = "trial_ends_at" if (upd.get("status") or lic.get("status")) == "trial" else "expires_at"
        cur = lic.get(key)
        start = max(datetime.now(timezone.utc), datetime.fromisoformat(cur)) if cur else datetime.now(timezone.utc)
        upd[key] = (start + timedelta(days=int(req["extend_days"]))).isoformat()
    await _db.company_licenses.update_one({"_id": lid}, {"$set": {**upd, "updated_at": _now()}, "$setOnInsert": {"created_at": _now(), "started_at": _now()}}, upsert=True)
    invalidate(lid)
    return await effective(company_id)


@router.post("/system/companies/{company_id}/modules/{module_key:path}")
async def toggle_module(company_id: str, module_key: str, req: Dict[str, Any], _: dict = Depends(require_super_admin)):
    key = "/" + module_key.lstrip("/")
    if key not in _ALL:
        raise HTTPException(status_code=400, detail="Bilinmeyen ya da çekirdek modül.")
    lid = await license_id_of(company_id)
    lic = await _db.company_licenses.find_one({"_id": lid}) or {}
    plan = await _db.saas_plans.find_one({"_id": lic.get("plan_id")}) or {"modules": _ALL}
    ov = dict(lic.get("module_overrides") or {})
    enabled = bool(req.get("enabled"))
    if enabled == (key in plan["modules"]):
        ov.pop(key, None)
    else:
        ov[key] = enabled
    await _db.company_licenses.update_one({"_id": lid}, {"$set": {"module_overrides": ov, "updated_at": _now()}, "$setOnInsert": {"plan_id": "plan_enterprise", "status": "active", "created_at": _now()}}, upsert=True)
    invalidate(lid)
    return await effective(company_id)


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
    rows = [_user_row(u, comps) for u in await _db.users.find({"is_super_admin": True}).sort("name", 1).to_list(2000)]
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
    comps = await _companies_map()
    uid = f"usr_{uuid.uuid4().hex[:8]}"
    doc = {
        "_id": uid,
        "email": email,
        "password_hash": hash_password(pwd),
        "name": name,
        "role": "admin",
        "company_ids": [],
        "active_company_id": None,
        "is_active": req.get("is_active", True) is not False,
        "is_super_admin": True,
        "preferences": {},
        "created_at": _now(),
    }
    await _db.users.insert_one(doc)
    return _user_row(doc, comps)


@router.put("/system/users/{user_id}")
async def system_update_user(user_id: str, req: Dict[str, Any], admin: dict = Depends(require_super_admin)):
    u = await _db.users.find_one({"_id": user_id})
    if not u or not u.get("is_super_admin"):
        raise HTTPException(status_code=404, detail="Panel yöneticisi bulunamadı.")
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
    if "is_active" in req:
        active = bool(req["is_active"])
        if not active and u.get("email") == "admin@nexus.com":
            raise HTTPException(status_code=400, detail="Ana yönetici pasifleştirilemez.")
        if not active and await _super_admin_count() <= 1:
            raise HTTPException(status_code=400, detail="Son platform yöneticisi pasifleştirilemez.")
        upd["is_active"] = active
    if "is_super_admin" in req and not bool(req["is_super_admin"]):
        raise HTTPException(status_code=400, detail="Panel yöneticisinin yetkisi bu ekrandan alınamaz. Şirket kullanıcıları Firma Ayarları’ndan yönetilir.")
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
    if not u or not u.get("is_super_admin"):
        raise HTTPException(status_code=404, detail="Panel yöneticisi bulunamadı.")
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
async def _request_user(request: Request) -> dict:
    try:
        return await _current_user(request)
    except HTTPException:
        return {}


def _require_company_access(user: dict, company_id: str):
    if not user_may_access_company(user, company_id):
        raise HTTPException(status_code=403, detail="Bu şirket hesabına erişiminiz yok.")


@router.get("/license/me")
async def my_license(request: Request, company_id: str = "comp_nexus_main_01"):
    _require_company_access(await _request_user(request), company_id)
    lic = await effective(company_id)
    plans = [{**_clean(p), "modules": p["modules"]} for p in await _db.saas_plans.find({"is_public": True}).sort("sort", 1).to_list(20)]
    pending = await _db.upgrade_requests.find_one({"company_id": company_id, "status": "pending"})
    sibs = [{"id": c["_id"], "name": c.get("name"), "tax_number": c.get("tax_number"), "city": c.get("city")} for c in await companies_on_license(lic.get("license_id") or company_id)]
    return {**lic, "catalog": catalog(), "plans": plans, "users": await _db.users.count_documents(tenant_user_query(company_id)), "companies": sibs, "pending_request": _clean(pending) if pending else None}


@router.get("/license/companies")
async def license_companies(request: Request, company_id: str = "comp_nexus_main_01"):
    _require_company_access(await _request_user(request), company_id)
    lic = await effective(company_id)
    return {"license_id": lic.get("license_id"), "company_limit": lic.get("company_limit") or 0, "company_count": lic.get("company_count") or 0, "companies": [{"id": c["_id"], "name": c.get("name"), "tax_number": c.get("tax_number"), "city": c.get("city")} for c in await companies_on_license(lic.get("license_id") or company_id)]}


@router.post("/license/companies")
async def create_license_company(req: Dict[str, Any], request: Request):
    parent = req.get("company_id") or "comp_nexus_main_01"
    user = {}
    try:
        user = await _current_user(request)
    except HTTPException:
        user = {}
    if not user_may_access_company(user, parent):
        raise HTTPException(status_code=403, detail="Bu lisans altında şirket açma yetkiniz yok.")
    if user and user.get("role") not in (None, "admin") and not user.get("is_super_admin"):
        raise HTTPException(status_code=403, detail="Yeni şirket yalnızca şirket yöneticisi açabilir.")
    doc = await add_licensed_company(parent, req, attach_user=user)
    if user and (user.get("_id") or user.get("id")):
        await _db.users.update_one({"_id": user.get("_id") or user.get("id")}, {"$set": {"active_company_id": doc["_id"]}})
    return {"id": doc["_id"], "name": doc.get("name"), "license_id": doc.get("license_id"), "license": await effective(doc["_id"])}


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
