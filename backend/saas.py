"""Platform (SaaS) yönetimi: modül kataloğu, paketler, şirket lisansları (modül aç/kapat, deneme, askıya alma), süper admin paneli, yükseltme talepleri."""
import os
import time
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

import rbac
import user_numbers
import applog
import perfmon
from auth_utils import get_user_from_token, hash_password, session_token, verify_password

router = APIRouter(prefix="/api")
_db = None
_current_user = None
_cache: Dict[str, Any] = {}
CACHE_TTL = 15

CORE_MODULES = {"/", "/settings", "/trash"}
# Etiketler frontend/src/navGroups.js NAV_GROUPS ile aynı kalmalı (ERP menü, paket editörü, web vitrin).
# Sidebar pages that used to inherit a parent license key (LICENSE_KEY aliases).
PANEL_MODULE_FROM = {
    "/edoc-inbox": "/invoices",
    "/dis-ticaret": "/invoices",
    "/b2b-yonetim": "/contacts",
    "/saha": "/orders",
}
CATEGORIES = {
    "/invoices": "Muhasebe", "/edoc-inbox": "Muhasebe", "/dis-ticaret": "Muhasebe", "/dispatches": "Muhasebe",
    "/contacts": "Muhasebe", "/installments": "Muhasebe",
    "/banking": "Finans", "/expenses": "Finans", "/loans": "Finans", "/cheques": "Finans",
    "/reports": "Raporlama", "/accountant": "Raporlama",
    "/stock": "Stok & Depo", "/sayim": "Stok & Depo", "/sevk": "Stok & Depo", "/warehouses": "Stok & Depo",
    "/production": "Üretim", "/atolye": "Üretim",
    "/quotes": "Satış", "/projects": "Satış", "/surveys": "Satış", "/orders": "Satış", "/hizli-satis": "Satış", "/b2b-yonetim": "Satış", "/saha": "Satış",
    "/ecommerce": "E-Ticaret", "/cargo": "E-Ticaret",
    "/personnel": "İK", "/mesai": "İK",
    "/communication": "İletişim",
    "/ai-advisor": "Yapay Zeka",
}
DESCRIPTIONS = {
    "/invoices": "Satış/alış faturaları, e-Fatura, e-Arşiv",
    "/edoc-inbox": "GİB gelen e-Fatura / e-İrsaliye kutusu, onay ve aktarım",
    "/dis-ticaret": "İthalat/ihracat dosyası, GTIP, rejim, DAB, ticari fatura",
    "/dispatches": "e-İrsaliye oluşturma ve takip",
    "/contacts": "Müşteri/tedarikçi kartları, ekstre ve bakiye",
    "/b2b-yonetim": "Bayi B2B portalı, fiyat listesi ve sipariş onayları",
    "/installments": "Taksitli satış ve ödeme planları",
    "/banking": "Banka, kasa, POS, virman, canlı banka eşleme",
    "/expenses": "Masraf ve bütçe yönetimi",
    "/loans": "Kredi ve kredi kartı takibi",
    "/cheques": "Alınan/verilen çek ve senet girişi, tahsil, ciro, karşılıksız",
    "/reports": "Satış, alış, stok, nakit akışı, KDV, kârlılık raporları",
    "/accountant": "Mali müşavir paneli ve beyanname özetleri",
    "/stock": "Stok kartları, varyant, barkod ve etiket tasarımı",
    "/sayim": "Tablet stok sayımı, barkod tarama ve fark raporu",
    "/warehouses": "Çoklu depo ve transfer",
    "/sevk": "Depo sevkiyat kiosk, sipariş toplama",
    "/production": "Reçete (BOM) ve üretim emirleri",
    "/atolye": "Tablet atölye ekranı ve iş emirleri",
    "/quotes": "Satış teklifi, müşteri onayı ve faturaya çevirme",
    "/projects": "İş / saha projesi, bütçe ve teklif bağlantısı",
    "/surveys": "Keşif, ölçü ve teklife dönüştürme",
    "/orders": "Sipariş yönetimi, toplu kargo, fiyat merkezi",
    "/hizli-satis": "Perakende hızlı satış (POS), tartı ve termal fiş",
    "/saha": "Tablet saha sipariş ve müşteri ziyareti",
    "/ecommerce": "Trendyol, ShopPHP ve 60+ pazaryeri entegrasyonu",
    "/cargo": "Geliver ve kargo firmaları entegrasyonu",
    "/personnel": "Personel, bordro, vardiya, izin",
    "/mesai": "Personel puantaj, giriş-çıkış, fazla mesai",
    "/communication": "SMS, e-posta, WhatsApp Business",
    "/ai-advisor": "AI finans danışmanı, PDF/Excel akıllı aktarım",
}

_STARTER = ["/invoices", "/edoc-inbox", "/dis-ticaret", "/dispatches", "/contacts", "/b2b-yonetim", "/banking", "/expenses", "/stock", "/sayim", "/reports"]
_STANDARD = _STARTER + ["/installments", "/loans", "/cheques", "/quotes", "/projects", "/surveys", "/orders", "/hizli-satis", "/saha", "/sevk", "/communication", "/accountant"]
_PRO = _STANDARD + ["/ecommerce", "/cargo", "/warehouses", "/personnel", "/mesai", "/ai-advisor"]
_ALL = [k for k, _ in rbac.MODULES if k not in CORE_MODULES]
DEFAULT_MODULE_PRICES = {
    "/invoices": 249, "/dispatches": 99, "/contacts": 129, "/installments": 79, "/reports": 99,
    "/banking": 129, "/expenses": 79, "/loans": 79, "/stock": 129, "/projects": 129,
    "/ecommerce": 249, "/cargo": 129, "/orders": 129, "/hizli-satis": 99, "/warehouses": 99, "/production": 199,
    "/atolye": 99, "/personnel": 159, "/communication": 99, "/ai-advisor": 129, "/accountant": 99,
}
CUSTOM_PLAN_ID = "plan_custom"
# 0 = unlimited. product/contact counts and storage are license-wide (sibling companies share the pool).
QUOTA_KEYS = ("user_limit", "company_limit", "product_limit", "contact_limit", "storage_limit_mb")
DEFAULT_PLANS = [
    {"_id": "plan_starter", "code": "starter", "name": "Başlangıç", "tagline": "Tek kişilik işletmeler için ön muhasebe", "price_monthly": 499, "price_yearly": 4990, "user_limit": 2, "company_limit": 1, "product_limit": 250, "contact_limit": 150, "storage_limit_mb": 512, "modules": _STARTER, "color": "slate", "sort": 1, "is_public": True},
    {"_id": "plan_standard", "code": "standard", "name": "Standart", "tagline": "Satış ekibi olan KOBİ'ler için", "price_monthly": 899, "price_yearly": 8990, "user_limit": 5, "company_limit": 2, "product_limit": 1500, "contact_limit": 800, "storage_limit_mb": 2048, "modules": _STANDARD, "color": "emerald", "sort": 2, "is_public": True, "is_popular": True},
    {"_id": "plan_pro", "code": "pro", "name": "Profesyonel", "tagline": "E-ticaret ve personel yöneten firmalar", "price_monthly": 1499, "price_yearly": 14990, "user_limit": 10, "company_limit": 5, "product_limit": 8000, "contact_limit": 3000, "storage_limit_mb": 10240, "modules": _PRO, "color": "indigo", "sort": 3, "is_public": True},
    {"_id": "plan_enterprise", "code": "enterprise", "name": "Kurumsal", "tagline": "Tüm modüller, sınırsız kullanıcı, üretim & atölye", "price_monthly": 2499, "price_yearly": 24990, "user_limit": 0, "company_limit": 0, "product_limit": 0, "contact_limit": 0, "storage_limit_mb": 0, "modules": _ALL, "color": "amber", "sort": 4, "is_public": True},
    {"_id": CUSTOM_PLAN_ID, "code": "custom", "name": "Özel Paket", "tagline": "Siteden seçtiğiniz modüller", "price_monthly": 0, "price_yearly": 0, "user_limit": 5, "company_limit": 1, "product_limit": 1500, "contact_limit": 800, "storage_limit_mb": 2048, "modules": [], "color": "emerald", "sort": 90, "is_public": False},
]
STATUSES = ("trial", "active", "suspended", "expired", "cancelled")
STATUS_LABELS = {"trial": "Deneme", "active": "Aktif", "suspended": "Askıda", "expired": "Süresi Doldu", "cancelled": "İptal"}
PROTECTED_COMPANY_IDS = frozenset({"comp_nexus_main_01", "comp_nexus_b2b_02"})
_SKIP_ON_COMPANY_DELETE = frozenset({
    "saas_plans", "platform_settings", "users", "companies", "company_licenses", "login_attempts",
    "platform_mail_servers", "platform_mailboxes", "platform_mail_logs",
})
PROTECTED_USER_EMAILS = frozenset({"admin@nexus.com"})


def init(db, current_user_dep):
    global _db, _current_user
    _db, _current_user = db, current_user_dep


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _as_dt(value) -> Optional[datetime]:
    """Parse stored license dates (ISO string, Zulu, or naive datetime)."""
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        s = str(value).strip().replace("Z", "+00:00")
        try:
            dt = datetime.fromisoformat(s)
        except ValueError:
            return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _as_iso(value) -> Optional[str]:
    dt = _as_dt(value)
    return dt.isoformat() if dt else None


def _clean(d: dict) -> dict:
    d = dict(d); d["id"] = d.pop("_id"); return d


def resolve_quota_limit(plan: Optional[dict], lic: Optional[dict], key: str) -> int:
    """License override wins; missing/blank inherits the plan. 0 = unlimited."""
    lic = lic or {}
    plan = plan or {}
    raw = lic.get(key)
    if raw not in (None, ""):
        try:
            return max(0, int(raw))
        except (TypeError, ValueError):
            pass
    try:
        return max(0, int(plan.get(key) or 0))
    except (TypeError, ValueError):
        return 0


def _parse_override(val):
    if val in (None, ""):
        return None
    try:
        return max(0, int(val))
    except (TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Limit sayısal olmalıdır (boş = paketten al, 0 = sınırsız).")


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


def _sync_plan_modules(mods: list) -> list:
    """Add panel modules that used to piggy-back on a parent key."""
    out = list(mods or [])
    seen = set(out)
    for child, parent in PANEL_MODULE_FROM.items():
        if parent in seen and child not in seen:
            out.append(child)
            seen.add(child)
    return out


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
        if cur is None:
            continue
        patch = {}
        for k in ("company_limit", "product_limit", "contact_limit", "storage_limit_mb"):
            if cur.get(k) is None and k in p:
                patch[k] = p[k]
        if patch:
            await _db.saas_plans.update_one({"_id": p["_id"]}, {"$set": patch})
        cur = await _db.saas_plans.find_one({"_id": p["_id"]})
        if cur and "/loans" in (cur.get("modules") or []) and "/cheques" not in (cur.get("modules") or []):
            await _db.saas_plans.update_one({"_id": p["_id"]}, {"$push": {"modules": "/cheques"}})
        if cur is not None and cur.get("company_limit") is None:
            await _db.saas_plans.update_one({"_id": p["_id"]}, {"$set": {"company_limit": p.get("company_limit", 1)}})
        cur = await _db.saas_plans.find_one({"_id": p["_id"]})
        mods = list((cur or {}).get("modules") or [])
        if "/projects" in mods:
            extra = [m for m in ("/quotes", "/surveys") if m not in mods]
            if extra:
                mods = mods + extra
        synced = _sync_plan_modules(mods)
        if p.get("code") == "enterprise":
            extra_all = [k for k in _ALL if k not in synced]
            synced = synced + extra_all
        if synced != list((cur or {}).get("modules") or []):
            await _db.saas_plans.update_one({"_id": p["_id"]}, {"$set": {"modules": synced}})
    async for lic in _db.company_licenses.find({}):
        ov = dict(lic.get("module_overrides") or {})
        changed = False
        if "/projects" in ov:
            for k in ("/quotes", "/surveys"):
                if k not in ov:
                    ov[k] = ov["/projects"]
                    changed = True
        for child, parent in PANEL_MODULE_FROM.items():
            if parent in ov and child not in ov:
                ov[child] = ov[parent]
                changed = True
        if changed:
            await _db.company_licenses.update_one({"_id": lic["_id"]}, {"$set": {"module_overrides": ov}})
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
            await _db.users.insert_one({"_id": f"usr_{uuid.uuid4().hex[:8]}", "email": email, "password_hash": hash_password(pwd), "name": name, "role": "admin", "is_super_admin": True, "company_ids": ["comp_nexus_main_01"], "active_company_id": "comp_nexus_main_01", "is_active": True, "preferences": {}, "user_number": await user_numbers.next_user_number(_db), "created_at": _now()})
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
    now_dt = datetime.now(timezone.utc)
    status = (lic or {}).get("status", "active")
    trial_end = _as_dt((lic or {}).get("trial_ends_at"))
    expires = _as_dt((lic or {}).get("expires_at"))
    if status == "trial" and trial_end and trial_end < now_dt:
        status = "expired"
    if status == "active" and expires and expires < now_dt:
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
    end_dt = trial_end if status == "trial" else expires
    days_left = None
    if end_dt:
        days_left = max(0, -(-int((end_dt - now_dt).total_seconds()) // 86400))
    siblings = await companies_on_license(lid)
    import addons as _addons
    addon_details = await _addons.resolve(company_id, lic=lic, plan=plan, locked=locked)
    addon_on = {k: bool(v.get("enabled")) for k, v in addon_details.items()}
    if not locked:
        mods["/ai-advisor"] = bool(addon_on.get("ai.advisor", mods.get("/ai-advisor")))
    else:
        mods["/ai-advisor"] = False
    support = None
    if addon_on.get("support.contact"):
        st = await _db.platform_settings.find_one({"_id": "platform"}, {"support_email": 1, "support_phone": 1}) or {}
        support = {"email": (st.get("support_email") or "").strip(), "phone": (st.get("support_phone") or "").strip()}
    plat = await _db.platform_settings.find_one({"_id": "platform"}, {"gib_credits_sales": 1}) or {}
    res = {"company_id": company_id, "license_id": lid, "plan_id": plan["_id"] if plan else None, "plan_name": plan["name"] if plan else "Sınırsız", "plan_color": (plan or {}).get("color", "slate"), "status": status, "status_label": STATUS_LABELS.get(status, status), "locked": locked, "modules": mods,
           "addons": addon_on, "addon_details": addon_details, "addon_overrides": (lic or {}).get("addon_overrides") or {},
           "support": support,
           "enabled_count": sum(1 for k, v in mods.items() if v and k not in CORE_MODULES), "total_count": len(_ALL),
           "user_limit": resolve_quota_limit(plan, lic, "user_limit"),
           "company_limit": resolve_quota_limit(plan, lic, "company_limit"),
           "product_limit": resolve_quota_limit(plan, lic, "product_limit"),
           "contact_limit": resolve_quota_limit(plan, lic, "contact_limit"),
           "storage_limit_mb": resolve_quota_limit(plan, lic, "storage_limit_mb"),
           "company_count": len(siblings),
           "plan_defaults": {k: int((plan or {}).get(k) or 0) for k in QUOTA_KEYS},
           "quota_overrides": {k: (lic or {}).get(k) for k in QUOTA_KEYS},
           "trial_ends_at": (lic or {}).get("trial_ends_at"), "expires_at": (lic or {}).get("expires_at"),
           "days_left": days_left, "module_overrides": (lic or {}).get("module_overrides", {}), "notes": (lic or {}).get("notes", ""), "billing_period": (lic or {}).get("billing_period", "monthly"),
           "custom_price_monthly": (lic or {}).get("custom_price_monthly"), "custom_price_yearly": (lic or {}).get("custom_price_yearly"),
           "gib_credits_sales": bool(plat.get("gib_credits_sales"))}
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


async def quota_usage(company_id: str) -> Dict[str, Any]:
    """Live license-wide usage (not cached — checks must see the latest counts)."""
    lid = await license_id_of(company_id)
    ids = [c["_id"] for c in await companies_on_license(lid)] or [company_id]
    q = {"company_id": {"$in": ids}}
    products = await _db.products.count_documents(q)
    contacts = await _db.contacts.count_documents(q)
    files = await _db.files.find({"$or": [{"company_id": {"$in": ids}}, {"entity_id": {"$in": ids}}]}).to_list(50000)
    storage = 0
    seen = set()
    for f in files:
        fid = f.get("_id")
        if fid in seen or f.get("is_deleted"):
            continue
        seen.add(fid)
        storage += int(f.get("size") or 0)
    return {"product_count": products, "contact_count": contacts, "storage_bytes": storage, "company_ids": ids}


async def check_product_limit(company_id: str, extra: int = 1):
    lic = await effective(company_id)
    limit = int(lic.get("product_limit") or 0)
    if not limit:
        return
    used = (await quota_usage(company_id))["product_count"]
    if used + extra > limit:
        raise HTTPException(status_code=403, detail=f"Stok kartı limitine ulaşıldı ({used}/{limit}). Paketinizi yükseltin ({lic['plan_name']}).")


async def check_contact_limit(company_id: str, extra: int = 1):
    lic = await effective(company_id)
    limit = int(lic.get("contact_limit") or 0)
    if not limit:
        return
    used = (await quota_usage(company_id))["contact_count"]
    if used + extra > limit:
        raise HTTPException(status_code=403, detail=f"Cari kart limitine ulaşıldı ({used}/{limit}). Paketinizi yükseltin ({lic['plan_name']}).")


async def check_storage_limit(company_id: str, extra_bytes: int = 0):
    lic = await effective(company_id)
    limit_mb = int(lic.get("storage_limit_mb") or 0)
    if not limit_mb:
        return
    used = (await quota_usage(company_id))["storage_bytes"]
    cap = limit_mb * 1024 * 1024
    if used + max(0, int(extra_bytes or 0)) > cap:
        raise HTTPException(status_code=403, detail=f"Resim depolama kotası doldu ({round(used / (1024 * 1024), 1)}/{limit_mb} MB). Paketinizi yükseltin ({lic['plan_name']}).")


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
    import demo as demo_pack
    await demo_pack.seed_for_new_company(cid)
    try:
        import storage_manager
        await storage_manager.ensure_account_folders(cid)
    except Exception:
        pass
    return await _db.companies.find_one({"_id": cid})


async def start_trial(company_id: str, plan_id: str = "plan_pro", days: int = 14, module_overrides: Optional[dict] = None, extra: Optional[dict] = None):
    """
    Ortak ana lisans üzerinde denemeyi başlatır veya tazeler; ödenmiş aktif planın
    üzerine yazmaz.

    module_overrides ve extra özel paketle kaydolanlar için: seçilen modüller ve
    anlaşılan fiyat deneme süresince de geçerli olmalı.
    """
    lid = await license_id_of(company_id)
    existing = await _db.company_licenses.find_one({"_id": lid}) or {}
    paid_until = _as_dt(existing.get("expires_at"))
    if existing.get("status") == "active" and existing.get("plan_id") and (
        existing.get("last_payment_at") or (paid_until and paid_until > datetime.now(timezone.utc))
    ):
        invalidate(lid)
        return
    trial_end = (datetime.now(timezone.utc) + timedelta(days=days)).isoformat()
    changes = {
        "plan_id": plan_id,
        "status": "trial",
        "trial_ends_at": trial_end,
        "expires_at": None,
        "notes": f"{days} gün deneme",
        "updated_at": _now(),
    }
    if module_overrides:
        changes["module_overrides"] = module_overrides
    if extra:
        changes.update(extra)
    on_insert = {
        "started_at": _now(),
        "created_at": _now(),
        "module_overrides": {},
        "user_limit": None,
        "company_id": lid,
    }
    # Aynı alan hem $set hem $setOnInsert içinde olamaz.
    on_insert = {k: v for k, v in on_insert.items() if k not in changes}
    await _db.company_licenses.update_one(
        {"_id": lid},
        {"$set": changes, "$setOnInsert": on_insert},
        upsert=True,
    )
    invalidate(lid)


# ---------------- Super admin dependency ----------------
async def require_super_admin(request: Request) -> dict:
    """Sistem paneli: dolu tokendan kullanıcı, demo yöneticiye düşülmez.

    Boş `Authorization: Bearer ` eskiden oturum sayılıp `get_current_user`'a
    gidiyordu; o da boş Bearer'ı yok sayıp tohum `admin@nexus.com`'a düşüyordu.
    """
    token = session_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Sistem paneli için giriş yapmanız gerekiyor.")
    user = await get_user_from_token(token, _db)
    if not user.get("is_super_admin"):
        raise HTTPException(status_code=403, detail="Bu alan yalnızca platform (sistem) yöneticisine açıktır.")
    return user


async def _usage(company_id: str) -> Dict[str, Any]:
    last = await _db.activity_logs.find_one({"company_id": company_id}, sort=[("created_at", -1)])
    q = {"company_id": company_id}
    files = await _db.files.find({"$or": [{"company_id": company_id}, {"entity_id": company_id}]}).to_list(20000)
    storage = sum(int(f.get("size") or 0) for f in files if not f.get("is_deleted"))
    return {"users": await _db.users.count_documents(tenant_user_query(company_id)), "invoices": await _db.invoices.count_documents(q), "contacts": await _db.contacts.count_documents(q),
            "products": await _db.products.count_documents(q), "orders": await _db.orders.count_documents(q), "storage_bytes": storage, "last_activity": (last or {}).get("created_at")}


async def _company_row(c: dict) -> Dict[str, Any]:
    lic = await effective(c["_id"])
    admin = await _db.users.find_one({**tenant_user_query(c["_id"]), "role": "admin"}, {"email": 1, "name": 1, "last_login_at": 1}) or await _db.users.find_one({"company_ids": c["_id"], "role": "admin"}, {"email": 1, "name": 1, "last_login_at": 1})
    lid = lic.get("license_id") or c["_id"]
    siblings = [{"id": s["_id"], "name": s.get("name"), "tax_number": s.get("tax_number"), "city": s.get("city"), "primary": s["_id"] == lid} for s in await companies_on_license(lid)]
    ei = await _db.einvoice_settings.find_one({"company_id": c["_id"]}) or {}
    einvoice = {"provider": ei.get("provider") or "", "status": ei.get("status") or "simulated", "mode": ei.get("mode") or "test", "username": ei.get("username") or "", "has_password": bool(ei.get("password_enc"))}
    return {"id": c["_id"], "name": c.get("name"), "tax_number": c.get("tax_number"), "city": c.get("city"), "phone": c.get("phone"), "email": c.get("email"), "created_at": c.get("created_at"), "license_id": lid, "license_companies": siblings, "protected": c["_id"] in PROTECTED_COMPANY_IDS, "allow_platform_access": c.get("allow_platform_access", True) is not False, "admin": {"email": admin.get("email"), "name": admin.get("name"), "last_login_at": admin.get("last_login_at")} if admin else None, "license": lic, "usage": await _usage(c["_id"]), "einvoice": einvoice}


def _restore_active_status(lic: Optional[dict]) -> str:
    """Pasiften çıkınca deneme süresi duruyorsa trial, aksi halde active."""
    lic = lic or {}
    end = _as_dt(lic.get("trial_ends_at"))
    if end and end > datetime.now(timezone.utc):
        return "trial"
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
@router.get("/system/logs")
async def system_logs(category: Optional[str] = None, event: Optional[str] = None, email: Optional[str] = None, limit: int = 100, _: dict = Depends(require_super_admin)):
    return applog.query_logs(category=category, event=event, user_email=email, limit=limit)


@router.post("/system/logs/rotate")
async def rotate_system_logs(_: dict = Depends(require_super_admin)):
    return applog.rotate_files()


@router.get("/system/perf")
async def system_perf(_: dict = Depends(require_super_admin)):
    snap = perfmon.collect()
    perfmon.persist_snapshot(snap)
    snap["recommendations"] = perfmon.recommendations(snap)
    return snap


@router.post("/system/perf/report")
async def system_perf_report(_: dict = Depends(require_super_admin)):
    snap = perfmon.collect()
    path = perfmon.write_report(snap)
    return {"status": "ok", "path": str(path), "alerts": snap.get("alerts") or [], "ok": snap.get("ok")}


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
    open_tickets = await _db.support_tickets.count_documents({"status": {"$in": ["open", "in_progress", "waiting_customer"]}})
    return {"companies": len(rows), "users": await _db.users.count_documents({"is_super_admin": {"$ne": True}}), "platform_admins": await _db.users.count_documents({"is_super_admin": True}), "by_status": by_status, "by_plan": by_plan, "mrr": round(mrr, 2), "module_usage": module_usage, "expiring": expiring[:10], "pending_requests": pending, "open_tickets": open_tickets, "recent": sorted(rows, key=lambda r: r.get("created_at") or "", reverse=True)[:5]}


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
            "user_limit": int(req.get("user_limit", b.get("user_limit", 0)) or 0), "company_limit": int(req.get("company_limit", b.get("company_limit", 1)) or 0),
            "product_limit": int(req.get("product_limit", b.get("product_limit", 0)) or 0), "contact_limit": int(req.get("contact_limit", b.get("contact_limit", 0)) or 0),
            "storage_limit_mb": int(req.get("storage_limit_mb", b.get("storage_limit_mb", 0)) or 0),
            "modules": mods, "color": req.get("color", b.get("color", "slate")), "sort": int(req.get("sort", b.get("sort", 99)) or 99), "is_public": bool(req.get("is_public", b.get("is_public", True))), "is_popular": bool(req.get("is_popular", b.get("is_popular", False)))}


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
    row["quota_usage"] = await quota_usage(company_id)
    return row


@router.get("/system/quotas")
async def list_quotas(_: dict = Depends(require_super_admin)):
    """One row per license (primary company) with live resource usage vs limits."""
    plans = {p["_id"]: p for p in await _db.saas_plans.find({}).to_list(50)}
    rows = []
    for lic in await _db.company_licenses.find({}).to_list(500):
        lid = lic["_id"]
        c = await _db.companies.find_one({"_id": lid})
        if not c:
            continue
        eff = await effective(lid)
        used = await quota_usage(lid)
        users = await _db.users.count_documents(tenant_user_query(lid))
        rows.append({
            "id": lid,
            "name": c.get("name"),
            "plan_id": eff.get("plan_id"),
            "plan_name": eff.get("plan_name"),
            "plan_color": eff.get("plan_color"),
            "status": eff.get("status"),
            "status_label": eff.get("status_label"),
            "user_limit": eff.get("user_limit") or 0,
            "company_limit": eff.get("company_limit") or 0,
            "product_limit": eff.get("product_limit") or 0,
            "contact_limit": eff.get("contact_limit") or 0,
            "storage_limit_mb": eff.get("storage_limit_mb") or 0,
            "user_count": users,
            "company_count": eff.get("company_count") or 0,
            "product_count": used["product_count"],
            "contact_count": used["contact_count"],
            "storage_bytes": used["storage_bytes"],
            "plan_defaults": eff.get("plan_defaults") or {},
            "overrides": {k: lic.get(k) for k in QUOTA_KEYS},
        })
    rows.sort(key=lambda r: (r.get("name") or "").lower())
    return {"quotas": rows, "plans": [{"id": p["_id"], "name": p.get("name"), **{k: int(p.get(k) or 0) for k in QUOTA_KEYS}} for p in plans.values()]}


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
    await _db.users.insert_one({"_id": uid, "email": email, "password_hash": hash_password(pwd), "name": (req.get("admin_name") or name).strip(), "role": "admin", "company_ids": [cid], "active_company_id": cid, "is_active": True, "preferences": {}, "user_number": await user_numbers.next_user_number(_db), "created_at": _now()})
    trial_days = int(req.get("trial_days") or 0)
    lic = {"plan_id": plan_id, "status": "trial" if trial_days else "active", "started_at": _now(), "trial_ends_at": (datetime.now(timezone.utc) + timedelta(days=trial_days)).isoformat() if trial_days else None, "expires_at": req.get("expires_at") or None, "module_overrides": {}, "user_limit": None, "billing_period": req.get("billing_period", "monthly"), "notes": req.get("notes") or "", "created_at": _now()}
    await _db.company_licenses.insert_one({"_id": cid, **lic})
    await rbac.ensure_roles(cid)
    import demo as demo_pack
    await demo_pack.seed_for_new_company(cid)
    try:
        import storage_manager
        await storage_manager.ensure_account_folders(cid)
    except Exception:
        pass
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
    lid = await license_id_of(company_id)
    lic = await _db.company_licenses.find_one({"_id": lid}) or {}
    status = _restore_active_status(lic) if bool(req.get("active", True)) else "suspended"
    await _db.company_licenses.update_one({"_id": lid}, {"$set": {"status": status, "updated_at": _now()}, "$setOnInsert": {"created_at": _now(), "started_at": _now(), "company_id": lid}}, upsert=True)
    invalidate(lid)
    return await effective(company_id)


@router.put("/system/companies/{company_id}/license")
async def update_license(company_id: str, req: Dict[str, Any], _: dict = Depends(require_super_admin)):
    if not await _db.companies.find_one({"_id": company_id}):
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    lid = await license_id_of(company_id)
    existing = await _db.company_licenses.find_one({"_id": lid}) or {}
    upd: Dict[str, Any] = {}
    if "plan_id" in req:
        if not await _db.saas_plans.find_one({"_id": req["plan_id"]}):
            raise HTTPException(status_code=400, detail="Geçersiz paket.")
        upd["plan_id"] = req["plan_id"]
        if req["plan_id"] != existing.get("plan_id") and "module_overrides" not in req:
            upd["module_overrides"] = {}
    if "status" in req:
        if req["status"] not in STATUSES:
            raise HTTPException(status_code=400, detail="Geçersiz durum.")
        upd["status"] = req["status"]
    for k in ("trial_ends_at", "expires_at"):
        if k in req:
            upd[k] = _as_iso(req[k]) if req[k] else None
    if "billing_period" in req:
        upd["billing_period"] = req["billing_period"] or "monthly"
    if "notes" in req:
        upd["notes"] = req["notes"] or ""
    if "user_limit" in req:
        upd["user_limit"] = _parse_override(req["user_limit"])
    if "company_limit" in req:
        upd["company_limit"] = _parse_override(req["company_limit"])
    if "product_limit" in req:
        upd["product_limit"] = _parse_override(req["product_limit"])
    if "contact_limit" in req:
        upd["contact_limit"] = _parse_override(req["contact_limit"])
    if "storage_limit_mb" in req:
        upd["storage_limit_mb"] = _parse_override(req["storage_limit_mb"])
    if "module_overrides" in req:
        upd["module_overrides"] = {k: bool(v) for k, v in (req["module_overrides"] or {}).items() if k in _ALL and v is not None}
    if "extend_days" in req:
        key = "trial_ends_at" if (upd.get("status") or existing.get("status")) == "trial" else "expires_at"
        cur = _as_dt(existing.get(key))
        now_dt = datetime.now(timezone.utc)
        start = max(now_dt, cur) if cur else now_dt
        upd[key] = (start + timedelta(days=int(req["extend_days"]))).isoformat()
    await _db.company_licenses.update_one({"_id": lid}, {"$set": {**upd, "updated_at": _now()}, "$setOnInsert": {"created_at": _now(), "started_at": _now(), "company_id": lid}}, upsert=True)
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
    patch: Dict[str, Any] = {"module_overrides": ov, "updated_at": _now()}
    if key == "/ai-advisor":
        aov = dict(lic.get("addon_overrides") or {})
        aov["ai.advisor"] = enabled
        patch["addon_overrides"] = aov
    await _db.company_licenses.update_one({"_id": lid}, {"$set": patch, "$setOnInsert": {"plan_id": "plan_enterprise", "status": "active", "created_at": _now()}}, upsert=True)
    invalidate(lid)
    return await effective(company_id)


def _user_row(u: dict, companies_by_id: Dict[str, dict]) -> Dict[str, Any]:
    cids = list(u.get("company_ids") or [])
    return {
        "id": u.get("_id") or u.get("id"),
        "name": u.get("name"),
        "email": u.get("email"),
        "user_number": u.get("user_number"),
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
    raw = await _db.users.find({"is_super_admin": True}).sort("name", 1).to_list(2000)
    for u in raw:
        await user_numbers.ensure_user_number(_db, u)
    rows = [_user_row(u, comps) for u in raw]
    if q:
        ql = q.strip().lower()
        rows = [u for u in rows if ql in (u.get("name") or "").lower() or ql in (u.get("email") or "").lower() or ql in (u.get("user_number") or "").lower()]
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
        "user_number": await user_numbers.next_user_number(_db),
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
        lid = await license_id_of(r["company_id"])
        await _db.company_licenses.update_one({"_id": lid}, {"$set": {"plan_id": r["plan_id"], "status": "active", "module_overrides": {}, "updated_at": _now()}, "$setOnInsert": {"created_at": _now(), "started_at": _now(), "company_id": lid}}, upsert=True)
        invalidate(lid)
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
    used = await quota_usage(company_id)
    return {**lic, "catalog": catalog(), "plans": plans, "users": await _db.users.count_documents(tenant_user_query(company_id)), "companies": sibs, "pending_request": _clean(pending) if pending else None, **used}


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
