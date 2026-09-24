"""AI and support tools independent of ERP license modules.

Platform defaults apply to every customer; a company override wins.
These flags are not tied to paket modülleri (/invoices, /ecommerce, …).
"""
from typing import Any, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse

router = APIRouter(prefix="/api")
_db = None

ADDONS: List[Dict[str, Any]] = [
    {"key": "ai.advisor", "group": "ai", "label": "AI finans danışmanı", "description": "Nakit tahmini, sohbet ve üst çubuk AI kısayolu", "default": True, "plan_module": "/ai-advisor"},
    {"key": "ai.invoice", "group": "ai", "label": "AI fatura aktarımı", "description": "PDF'den alış faturası oluşturma", "default": True},
    {"key": "ai.orders", "group": "ai", "label": "AI sipariş aktarımı", "description": "PDF/Excel sipariş yükleme", "default": True},
    {"key": "ai.stock", "group": "ai", "label": "AI stok aktarımı", "description": "Excel/PDF ürün içe aktarma", "default": True},
    {"key": "ai.b2b_cart", "group": "ai", "label": "B2B AI sepet", "description": "Bayi portalında sipariş listesini AI ile eşleme", "default": True},
    {"key": "ai.finance_docs", "group": "ai", "label": "AI ekstre ve kredi", "description": "Kredi ödeme planı ve kart ekstresi aktarımı", "default": True},
    {"key": "ai.migration", "group": "ai", "label": "AI veri eşleme", "description": "Excel aktarımında sütun başlıklarını AI ile eşleme", "default": True},
    {"key": "support.impersonate", "group": "support", "label": "Destek: şirket olarak gir", "description": "Platform yöneticisi müşteri paneline destek modunda girebilir", "default": True, "lock_safe": True},
    {"key": "support.contact", "group": "support", "label": "Destek iletişim", "description": "ERP içinde destek e-posta/telefon ve talep bağlantısı", "default": True, "lock_safe": True},
    {"key": "support.tickets", "group": "support", "label": "Destek talepleri", "description": "Müşteri destek kaydı ve durum takibi", "default": True, "lock_safe": True},
]
ADDON_KEYS = {a["key"] for a in ADDONS}
ADDON_BY_KEY = {a["key"]: a for a in ADDONS}
GROUPS = (("ai", "Yapay zeka"), ("support", "Destek araçları"))

# Longest prefix wins. Public B2B paths are skipped by RBAC; they check in the handler.
ADDON_PATHS: Tuple[Tuple[str, str], ...] = (
    ("/api/ai/invoice-extract", "ai.invoice"),
    ("/api/ai/cheque-extract", "ai.finance_docs"),
    ("/api/ai/expense-extract", "ai.finance_docs"),
    ("/api/ai/receipt-extract", "ai.finance_docs"),
    ("/api/ai/order-extract", "ai.orders"),
    ("/api/ai/product-extract", "ai.stock"),
    ("/api/ai/financial-advisor", "ai.advisor"),
    ("/api/ai/cashflow-forecast", "ai.advisor"),
    ("/api/loans/extract", "ai.finance_docs"),
    ("/api/migration/ai-map", "ai.migration"),
    ("/api/support", "support.tickets"),
)


def init(db):
    global _db
    _db = db


def catalog() -> List[dict]:
    return [dict(a) for a in ADDONS]


def addon_for_path(path: str) -> Optional[str]:
    if "import-statement" in (path or ""):
        return "ai.finance_docs"
    best = None
    for prefix, key in ADDON_PATHS:
        if path.startswith(prefix) and (best is None or len(prefix) > len(best[0])):
            best = (prefix, key)
    return best[1] if best else None


def resolve_map(
    *,
    plan_modules: Optional[set] = None,
    platform_defaults: Optional[dict] = None,
    company_overrides: Optional[dict] = None,
    locked: bool = False,
) -> Dict[str, dict]:
    """Pure resolution used by unit tests and effective()."""
    plan_modules = plan_modules or set()
    platform_defaults = platform_defaults or {}
    company_overrides = company_overrides or {}
    out = {}
    for a in ADDONS:
        key = a["key"]
        if key in company_overrides and company_overrides[key] is not None:
            enabled, source = bool(company_overrides[key]), "company"
        elif key in platform_defaults and platform_defaults[key] is not None:
            enabled, source = bool(platform_defaults[key]), "platform"
        elif a.get("plan_module"):
            enabled, source = a["plan_module"] in plan_modules, "plan"
        else:
            enabled, source = bool(a.get("default", True)), "default"
        if locked and not a.get("lock_safe"):
            enabled = False
            if source != "company":
                source = "locked"
        out[key] = {"enabled": bool(enabled), "source": source, "group": a["group"], "label": a["label"]}
    return out


def enabled_map(resolved: dict) -> Dict[str, bool]:
    return {k: bool(v.get("enabled")) for k, v in (resolved or {}).items()}


async def _platform_defaults() -> dict:
    st = await _db.platform_settings.find_one({"_id": "platform"}) or {}
    raw = st.get("addon_defaults") or {}
    return {k: bool(v) for k, v in raw.items() if k in ADDON_KEYS and v is not None}


async def resolve(company_id: str, lic: Optional[dict] = None, plan: Optional[dict] = None, locked: Optional[bool] = None) -> dict:
    import saas
    if lic is None:
        lid = await saas.license_id_of(company_id)
        lic = await _db.company_licenses.find_one({"_id": lid}) or {}
    if plan is None and lic.get("plan_id"):
        plan = await _db.saas_plans.find_one({"_id": lic.get("plan_id")})
    if locked is None:
        status = (lic or {}).get("status", "active")
        locked = status in ("suspended", "expired", "cancelled")
    return resolve_map(
        plan_modules=set((plan or {}).get("modules") or []),
        platform_defaults=await _platform_defaults(),
        company_overrides=(lic or {}).get("addon_overrides") or {},
        locked=bool(locked),
    )


async def is_on(company_id: str, key: str) -> bool:
    if key not in ADDON_KEYS:
        return True
    return bool((await resolve(company_id)).get(key, {}).get("enabled", True))


def disabled_response(key: str) -> JSONResponse:
    a = ADDON_BY_KEY.get(key) or {"label": key, "group": "ai"}
    kind = "Yapay zeka" if a.get("group") == "ai" else "Destek"
    return JSONResponse(
        {"detail": f"{kind} aracı kapalı: {a.get('label', key)}. Platform yönetiminden açabilirsiniz.", "code": "addon_disabled", "addon": key},
        status_code=403,
    )


async def require(company_id: str, key: str) -> None:
    if not await is_on(company_id, key):
        a = ADDON_BY_KEY.get(key) or {"label": key, "group": "ai"}
        kind = "Yapay zeka" if a.get("group") == "ai" else "Destek"
        raise HTTPException(status_code=403, detail=f"{kind} aracı kapalı: {a.get('label', key)}.")


async def guard_request(request: Request, user: Optional[dict], path: str):
    key = addon_for_path(path)
    if not key:
        return None
    cid = request.query_params.get("company_id") or (user or {}).get("active_company_id") or "comp_nexus_main_01"
    if await is_on(cid, key):
        return None
    return disabled_response(key)


def _now() -> str:
    from datetime import datetime, timezone
    return datetime.now(timezone.utc).isoformat()


async def _admin(request: Request) -> dict:
    import saas
    return await saas.require_super_admin(request)


async def _list_addons():
    import saas
    defaults = await _platform_defaults()
    rows = []
    async for c in _db.companies.find({}, {"_id": 1}):
        rows.append(await saas.effective(c["_id"]))
    usage = {k: sum(1 for r in rows if (r.get("addons") or {}).get(k)) for k in ADDON_KEYS}
    shown = {a["key"]: bool(defaults[a["key"]]) if a["key"] in defaults else bool(a.get("default", True)) for a in ADDONS}
    return {
        "catalog": catalog(),
        "groups": [{"key": k, "label": l} for k, l in GROUPS],
        "defaults": shown,
        "inherited": {a["key"]: a["key"] not in defaults for a in ADDONS},
        "usage": usage,
        "company_count": len(rows),
    }


@router.get("/system/addons")
async def list_addons(_: dict = Depends(_admin)):
    return await _list_addons()


@router.put("/system/addons")
async def put_defaults(req: Dict[str, Any], _: dict = Depends(_admin)):
    raw = req.get("defaults") if isinstance(req.get("defaults"), dict) else req
    st = await _db.platform_settings.find_one({"_id": "platform"}) or {}
    cur = dict(st.get("addon_defaults") or {})
    for k, v in (raw or {}).items():
        if k not in ADDON_KEYS:
            continue
        if v is None:
            cur.pop(k, None)
        else:
            cur[k] = bool(v)
    await _db.platform_settings.update_one({"_id": "platform"}, {"$set": {"addon_defaults": cur, "updated_at": _now()}}, upsert=True)
    import saas
    saas.invalidate()
    return await _list_addons()


@router.post("/system/companies/{company_id}/addons/{addon_key}")
async def toggle_company_addon(company_id: str, addon_key: str, req: Dict[str, Any], _: dict = Depends(_admin)):
    if addon_key not in ADDON_KEYS:
        raise HTTPException(status_code=400, detail="Bilinmeyen araç.")
    import saas
    lid = await saas.license_id_of(company_id)
    lic = await _db.company_licenses.find_one({"_id": lid}) or {}
    ov = dict(lic.get("addon_overrides") or {})
    inherit = bool(req.get("inherit"))
    if inherit or req.get("enabled") is None:
        ov.pop(addon_key, None)
    else:
        ov[addon_key] = bool(req.get("enabled"))
    patch: Dict[str, Any] = {"addon_overrides": ov, "updated_at": _now()}
    plan_mod = ADDON_BY_KEY[addon_key].get("plan_module")
    if plan_mod and not inherit and req.get("enabled") is not None:
        mov = dict(lic.get("module_overrides") or {})
        plan = await _db.saas_plans.find_one({"_id": lic.get("plan_id")}) or {"modules": []}
        enabled = bool(req.get("enabled"))
        if enabled == (plan_mod in (plan.get("modules") or [])):
            mov.pop(plan_mod, None)
        else:
            mov[plan_mod] = enabled
        patch["module_overrides"] = mov
    await _db.company_licenses.update_one(
        {"_id": lid},
        {"$set": patch, "$setOnInsert": {"plan_id": "plan_enterprise", "status": "active", "created_at": _now()}},
        upsert=True,
    )
    saas.invalidate(lid)
    return await saas.effective(company_id)
