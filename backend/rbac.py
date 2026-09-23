"""Users, roles (module permissions), e-mail invitations and activity log."""
import secrets
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional, Callable, Awaitable

import user_numbers
from fastapi import APIRouter, HTTPException, Request, Response, Depends
from starlette.middleware.base import BaseHTTPMiddleware

import comm_service
from auth_utils import hash_password, create_access_token, create_refresh_token, get_user_from_token
from client_ip import request_ip

router = APIRouter(prefix="/api")
_db = None
_mail_account: Optional[Callable[..., Awaitable[dict]]] = None
_current_user = None

MODULES = [("/", "Genel Bakış"), ("/invoices", "Faturalar"), ("/edoc-inbox", "Gelen e-Belgeler"), ("/dis-ticaret", "İthalat / İhracat"), ("/dispatches", "İrsaliyeler"), ("/contacts", "Cari Hesaplar"), ("/b2b-yonetim", "B2B Portal Yönetimi"), ("/installments", "Taksitler"), ("/reports", "Raporlar"), ("/banking", "Banka & Kasa"), ("/expenses", "Masraflar"), ("/loans", "Krediler"), ("/cheques", "Çek / Senet"),
           ("/stock", "Stoklar & Ürünler"), ("/purchase-orders", "Verilen Siparişler"), ("/sayim", "Stok Sayımı"), ("/quotes", "Teklifler"), ("/projects", "Projeler"), ("/surveys", "Keşifler"), ("/ecommerce", "E-Ticaret"), ("/cargo", "Kargo"), ("/orders", "Siparişler"), ("/hizli-satis", "Hızlı Satış"), ("/saha", "Saha Sipariş"), ("/sevk", "Depo Sevkiyatı"), ("/warehouses", "Depo"),
           ("/production", "Üretim & Reçete"), ("/atolye", "Atölye Ekranı"), ("/personnel", "Personel & Bordro"), ("/mesai", "Mesaim"), ("/communication", "İletişim"), ("/support", "Destek Talepleri"), ("/ai-advisor", "AI Danışman"),
           ("/accountant", "Mali Müşavir Paneli"), ("/settings", "Firma Ayarları"), ("/trash", "Çöp Kutusu")]
LEVELS = ("none", "view", "edit")
FEATURES = [("view_prices", "Fiyat ve tutarları görebilir", "Kapalıysa tüm API yanıtlarında fiyat/tutar/bakiye alanları maskelenir (0 gösterilir); ürün, sipariş, fatura, kârlılık tutarları gizlenir."),
            ("header_barcode", "Üst bar: Hızlı barkod tarama", ""), ("header_virman", "Üst bar: Hızlı virman", ""), ("header_invoice", "Üst bar: Hızlı fatura oluştur", ""), ("header_ai", "Üst bar: AI asistan", "")]
MONEY_KEYS = {"sale_price", "purchase_price", "unit_price", "price", "list_price", "local_price", "local_total", "fx_rate", "total", "grand_total", "subtotal", "vat_total", "total_amount", "amount", "paid_amount", "balance", "current_balance", "revenue", "net_profit", "gross_profit",
              "commission", "commission_vat", "service_fee", "cargo_fee", "product_cost", "cost", "fees", "deductions", "net", "gross", "salary", "payroll_salary", "net_salary", "gross_salary", "second_salary", "credit_limit", "discount_total", "vat_amount", "price_diff",
              "cost_price", "last_purchase_price", "avg_purchase_price", "card_purchase_price", "margin_pct", "profit", "monthly_payment", "principal", "remaining", "line_total", "opening_balance", "budget", "spent", "overtime_pay", "hourly_rate", "total_revenue", "total_expense", "net_cash", "receivables", "payables", "sale_price_incl_vat", "total_bank_balance", "total_receivables", "total_payables", "total_stock_value", "monthly_sales", "monthly_expenses", "gelir", "gider",
              "cost_price", "last_purchase_price", "avg_purchase_price", "card_purchase_price", "margin_pct", "profit", "monthly_payment", "principal", "remaining", "line_total", "opening_balance", "budget", "spent", "overtime_pay", "hourly_rate", "total_revenue", "total_expense", "net_cash", "receivables", "payables", "sale_price_incl_vat", "total_bank_balance", "total_receivables", "total_payables", "total_stock_value", "monthly_sales", "monthly_expenses", "gelir", "gider", "cheque_bond_balance", "portfolio", "issued_open", "due_this_week", "overdue_received", "overdue_issued", "meal_allowance", "transport_allowance", "unpaid_payroll", "unpaid_expenses", "meal_due", "transport_due", "bonus_pending", "advances",
              "cost_price", "margin_pct", "profit", "monthly_payment", "principal", "remaining", "line_total", "opening_balance", "budget", "spent", "overtime_pay", "hourly_rate", "total_revenue", "total_expense", "net_cash", "receivables", "payables", "sale_price_incl_vat", "total_bank_balance", "total_receivables", "total_payables", "total_stock_value", "monthly_sales", "monthly_expenses", "gelir", "gider", "meal_allowance", "transport_allowance", "unpaid_payroll", "unpaid_expenses", "meal_due", "transport_due", "bonus_pending", "advances",
              "value", "incoming", "outgoing", "collections", "payments", "not_due", "overdue", "payable", "receivable", "deductible", "calculated", "vat", "week", "today", "month_total", "yearly", "cash", "bank", "pos", "kdv", "ciro", "kar", "profit_amount", "spent_amount", "limit", "avg_order", "average"}


def mask_money(obj):
    if isinstance(obj, dict):
        return {k: (0 if (k in MONEY_KEYS and isinstance(v, (int, float)) and not isinstance(v, bool)) else mask_money(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [mask_money(x) for x in obj]
    return obj


def role_features(role: dict) -> Dict[str, bool]:
    if role.get("code") == "admin":
        return {k: True for k, _, _ in FEATURES}
    f = role.get("features") or {}
    return {k: bool(f.get(k, True)) for k, _, _ in FEATURES}

def _all(level: str) -> Dict[str, str]:
    return {m: level for m, _ in MODULES}

DEFAULT_ROLES = [
    {"code": "admin", "name": "Yönetici", "is_system": True, "permissions": _all("edit")},
    {"code": "accountant", "name": "Muhasebe", "is_system": True, "permissions": {
        **_all("view"),
        "/invoices": "edit", "/edoc-inbox": "edit", "/dis-ticaret": "edit", "/dispatches": "edit",
        "/contacts": "edit", "/installments": "edit", "/banking": "edit", "/expenses": "edit",
        "/loans": "edit", "/cheques": "edit", "/purchase-orders": "edit", "/reports": "edit",
        "/accountant": "edit", "/personnel": "view", "/mesai": "view", "/support": "edit",
        "/settings": "none", "/production": "none", "/atolye": "none", "/ecommerce": "none",
        "/cargo": "none", "/saha": "none", "/sevk": "none", "/hizli-satis": "none", "/ai-advisor": "none",
    }},
    {"code": "sales", "name": "Satış", "is_system": True, "permissions": {
        **_all("none"),
        "/": "view", "/invoices": "edit", "/edoc-inbox": "edit", "/dis-ticaret": "edit", "/dispatches": "edit",
        "/contacts": "edit", "/b2b-yonetim": "edit", "/quotes": "edit", "/projects": "edit", "/surveys": "edit",
        "/orders": "edit", "/hizli-satis": "edit", "/saha": "edit", "/stock": "view", "/purchase-orders": "view",
        "/installments": "view", "/sevk": "view", "/communication": "edit", "/support": "edit",
        "/ecommerce": "view", "/cargo": "edit", "/mesai": "view",
    }},
    {"code": "warehouse", "name": "Depo", "is_system": True, "permissions": {
        **_all("none"),
        "/": "view", "/stock": "edit", "/purchase-orders": "edit", "/sayim": "edit", "/warehouses": "edit",
        "/orders": "edit", "/sevk": "edit", "/cargo": "edit", "/dispatches": "edit", "/contacts": "view",
        "/mesai": "view", "/support": "view",
    }},
    {"code": "production", "name": "Üretim", "is_system": True, "permissions": {
        **_all("none"),
        "/": "view", "/production": "edit", "/atolye": "edit", "/warehouses": "view", "/orders": "view",
        "/sevk": "view", "/mesai": "view", "/support": "view",
    }},
    {"code": "personel", "name": "Personel", "is_system": True, "permissions": {
        **_all("none"),
        "/": "view", "/mesai": "edit", "/atolye": "edit", "/communication": "view", "/support": "view",
    }},
    {"code": "advisor", "name": "Mali Müşavir", "is_system": True, "permissions": {
        **_all("none"),
        "/": "view", "/invoices": "view", "/edoc-inbox": "view", "/dis-ticaret": "view", "/dispatches": "view",
        "/contacts": "view", "/installments": "view", "/banking": "view", "/expenses": "view", "/loans": "view",
        "/cheques": "view", "/purchase-orders": "view", "/reports": "edit", "/accountant": "edit",
        "/personnel": "view", "/mesai": "view", "/support": "view", "/trash": "view",
    }},
]

# Sistem rollerinde stok kartı yalnızca depo / yönetici. Personel ve üretim giremez.
FORCE_SYSTEM_PERMISSIONS = {
    "production": {"/stock": "none"},
    "personel": {"/stock": "none", "/personnel": "none"},
}

# API path prefix -> module key (longest prefix wins)
API_MODULE_MAP = [("/api/production/work-orders", "/atolye"), ("/api/production", "/production"), ("/api/invoices", "/invoices"), ("/api/einvoice", "/invoices"), ("/api/gib", "/invoices"),
                  ("/api/contacts", "/contacts"), ("/api/installments", "/installments"), ("/api/reports", "/reports"), ("/api/banking", "/banking"), ("/api/expenses", "/expenses"), ("/api/loans", "/loans"), ("/api/cheques", "/cheques"), ("/api/products", "/stock"),
                  ("/api/purchase-orders", "/purchase-orders"), ("/api/warehouses/stock-counts", "/sayim"), ("/api/warehouses", "/warehouses"), ("/api/quotes", "/quotes"), ("/api/projects", "/projects"), ("/api/surveys", "/surveys"), ("/api/integrations/ecommerce", "/ecommerce"),
                  ("/api/integrations/cargo", "/cargo"), ("/api/cargo", "/cargo"), ("/api/order-picks", "/sevk"), ("/api/orders", "/orders"), ("/api/pos", "/hizli-satis"), ("/api/stock-lots", "/stock"), ("/api/returns", "/orders"), ("/api/personnel", "/personnel"),
                  ("/api/comm", "/communication"), ("/api/ai", "/ai-advisor"), ("/api/accountant", "/accountant"), ("/api/fx", "/settings"), ("/api/companies", "/settings"), ("/api/users", "/settings"),
                  ("/api/roles", "/settings"), ("/api/activity-logs", "/settings"), ("/api/migration", "/settings"), ("/api/demo", "/settings"), ("/api/edocs", "/edoc-inbox"), ("/api/trade-files", "/dis-ticaret"), ("/api/support", "/support"), ("/api/trash", "/trash"), ("/api/dashboard", "/"), ("/api/sync", "/")]
SKIP_PREFIXES = ("/api/auth", "/api/setup", "/api/public", "/api/files", "/api/notifications", "/api/health", "/api/version", "/api/mobile", "/api/system", "/api/license", "/api/payments", "/api/webhook", "/api/personnel/me", "/api/personnel/messages", "/api/personnel/attendance/self", "/api/personnel/attendance/me", "/api/personnel/attendance/geo", "/api/personnel/attendance/early-leave-request", "/api/personnel/attendance/intraday-leave-request", "/api/personnel/leaves/self", "/api/personnel/leaves/me", "/api/personnel/bonuses/self")
SELF_SERVICE_SUFFIXES = ("/confirm", "/dispute", "/early-leave-cancel")
_license_guard = None


def set_license_guard(fn):
    global _license_guard
    _license_guard = fn


def init(db, mail_account_fn, current_user_dep):
    global _db, _mail_account, _current_user
    _db, _mail_account, _current_user = db, mail_account_fn, current_user_dep


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(d: dict) -> dict:
    if d and "_id" in d:
        d["id"] = str(d.pop("_id"))
    d.pop("password_hash", None)
    return d


def apply_forced_system_permissions(code: Optional[str], perms: Dict[str, str]) -> Dict[str, str]:
    """Personel / üretim sistem rollerinde stok kartını kapalı tut."""
    out = dict(perms)
    for path, level in FORCE_SYSTEM_PERMISSIONS.get(code or "", {}).items():
        out[path] = level
    return out


def backfill_permissions(perms: Optional[Dict[str, str]]) -> Dict[str, str]:
    """Fill newly added module keys for legacy role docs (in-memory; does not mutate caller)."""
    p = dict(perms or {})
    p.setdefault("/dispatches", p.get("/invoices", "none"))
    p.setdefault("/trash", p.get("/settings", "none"))
    p.setdefault("/expenses", p.get("/banking", "none"))
    p.setdefault("/loans", p.get("/banking", "none"))
    p.setdefault("/cheques", p.get("/banking", "none"))
    p.setdefault("/quotes", p.get("/projects", "none"))
    p.setdefault("/surveys", p.get("/projects", "none"))
    p.setdefault("/edoc-inbox", p.get("/invoices", "none"))
    p.setdefault("/dis-ticaret", p.get("/invoices", "none"))
    p.setdefault("/b2b-yonetim", p.get("/contacts", "none"))
    p.setdefault("/sayim", "none")
    p.setdefault("/saha", p.get("/orders", "none"))
    p.setdefault("/sevk", "none")
    p.setdefault("/mesai", "none")
    p.setdefault("/support", p.get("/communication", "none"))
    p.setdefault("/purchase-orders", p.get("/stock", "none"))
    for m, _ in MODULES:
        p.setdefault(m, "none")
    return p


async def ensure_roles(company_id: str):
    if await _db.roles.count_documents({"company_id": company_id}) == 0:
        await _db.roles.insert_many([{"_id": f"role_{company_id}_{r['code']}", "company_id": company_id, **r, "created_at": _now()} for r in DEFAULT_ROLES])
        return
    existing = {r["code"]: r for r in await _db.roles.find({"company_id": company_id}).to_list(100)}
    for rdef in DEFAULT_ROLES:
        cur = existing.get(rdef["code"])
        if not cur:
            await _db.roles.insert_one({"_id": f"role_{company_id}_{rdef['code']}", "company_id": company_id, **rdef, "created_at": _now()})
            continue
        upd: Dict[str, Any] = {}
        if cur.get("is_system") and cur.get("name") != rdef["name"]:
            upd["name"] = rdef["name"]
        raw = dict(cur.get("permissions") or {})
        missing = [m for m, _ in MODULES if m not in raw]
        if cur.get("code") == "admin":
            filled = _all("edit")
        else:
            filled = backfill_permissions(raw)
            # New catalog keys on system roles: prefer DEFAULT_ROLES over inheritance heuristics
            if cur.get("is_system") and missing:
                for m in missing:
                    if m in rdef["permissions"]:
                        filled[m] = rdef["permissions"][m]
        if cur.get("is_system"):
            filled = apply_forced_system_permissions(rdef.get("code"), filled)
        if filled != raw:
            upd["permissions"] = filled
        if upd:
            await _db.roles.update_one({"_id": cur["_id"]}, {"$set": {**upd, "updated_at": _now()}})


async def role_for(user: dict, company_id: Optional[str] = None) -> Dict[str, Any]:
    code = user.get("role", "admin")
    cid = company_id or user.get("active_company_id") or "comp_nexus_main_01"
    await ensure_roles(cid)
    r = await _db.roles.find_one({"company_id": cid, "code": code}) or await _db.roles.find_one({"company_id": cid, "code": "admin"})
    if r:
        r["permissions"] = backfill_permissions(r.get("permissions"))
        if r.get("is_system"):
            r["permissions"] = apply_forced_system_permissions(r.get("code"), r["permissions"])
        if r.get("code") == "admin":
            r["permissions"] = _all("edit")
    return r or {"code": "admin", "name": "Yönetici", "permissions": _all("edit")}


def module_for_path(path: str) -> Optional[str]:
    best = None
    for prefix, mod in API_MODULE_MAP:
        if path.startswith(prefix) and (best is None or len(prefix) > len(best[0])):
            best = (prefix, mod)
    return best[1] if best else None


class PermissionAndAuditMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if not path.startswith("/api") or path.startswith(SKIP_PREFIXES) or request.method in ("OPTIONS", "HEAD"):
            return await call_next(request)
        token = request.cookies.get("access_token") or (request.headers.get("Authorization", "")[7:] if request.headers.get("Authorization", "").startswith("Bearer ") else None)
        user = None
        if token:
            try:
                user = await get_user_from_token(token, _db)
            except HTTPException:
                user = None
        if user and not user.get("is_super_admin"):
            cid = request.query_params.get("company_id")
            if not cid:
                parts = path.strip("/").split("/")
                if len(parts) >= 3 and parts[0] == "api" and parts[1] == "companies":
                    cid = parts[2]
            if not cid:
                allowed = [c for c in (user.get("company_ids") or []) if c]
                cid = user.get("active_company_id") if user.get("active_company_id") in allowed else (allowed[0] if allowed else None)
                if cid and "company_id" not in request.query_params:
                    from urllib.parse import parse_qsl, urlencode
                    q = dict(parse_qsl(request.scope.get("query_string", b"").decode(), keep_blank_values=True))
                    q["company_id"] = cid
                    request.scope["query_string"] = urlencode(q).encode()
            if cid and cid not in (user.get("company_ids") or []):
                from fastapi.responses import JSONResponse
                return JSONResponse({"detail": "Bu şirket hesabına erişiminiz yok."}, status_code=403)
        module = module_for_path(path)
        # Mesaim self-service confirm/dispute is licensed under /mesai, not /personnel
        if path.startswith("/api/personnel/attendance/") and path.endswith(SELF_SERVICE_SUFFIXES):
            module = "/mesai"
        if _license_guard and module:
            blocked = await _license_guard(request, user, module)
            if blocked is not None:
                return blocked
        try:
            import addons as _addons
            addon_block = await _addons.guard_request(request, user, path)
            if addon_block is not None:
                return addon_block
        except Exception:
            pass
        if request.method == "GET" or (path.startswith("/api/personnel/attendance/") and path.endswith(SELF_SERVICE_SUFFIXES)):
            response = await call_next(request)
            if user and user.get("role") != "admin" and "application/json" in (response.headers.get("content-type") or ""):
                role = await role_for(user)
                if not role_features(role)["view_prices"]:
                    import json as _json
                    from fastapi.responses import JSONResponse
                    body = b"".join([chunk async for chunk in response.body_iterator])
                    try:
                        data = mask_money(_json.loads(body))
                    except ValueError:
                        return JSONResponse(content=None, status_code=response.status_code)
                    return JSONResponse(content=data, status_code=response.status_code, headers={"X-Prices-Masked": "1"})
            return response
        if user and user.get("role") != "admin" and module:
            role = await role_for(user)
            perms = role.get("permissions", {})
            allowed = perms.get(module, "none") == "edit"
            # Sipariş ekranından kargolama: /orders edit yeterli (ayrı /cargo yetkisi şart değil)
            if not allowed and module == "/cargo" and (
                path.startswith("/api/cargo/create-shipment")
                or path.startswith("/api/cargo/auto-ship")
            ):
                allowed = perms.get("/orders", "none") == "edit"
            if not allowed:
                from fastapi.responses import JSONResponse
                return JSONResponse({"detail": f"Bu işlem için yetkiniz yok ({role.get('name')} rolü: {module})."}, status_code=403)
        response = await call_next(request)
        if response.status_code < 400:
            ip = request_ip(request)
            u = user or {"id": "demo", "name": "Demo Yönetici", "active_company_id": request.query_params.get("company_id", "comp_nexus_main_01")}
            await _db.activity_logs.insert_one({"_id": str(uuid.uuid4()), "company_id": u.get("active_company_id") or "comp_nexus_main_01", "user_id": u.get("id"), "user_name": u.get("name"),
                                                "method": request.method, "path": path, "module": module, "ip": ip, "status": response.status_code, "created_at": _now()})
        return response


async def _notify_role_assigned(company_id: Optional[str], emp: Dict[str, Any], role: str, user_id: Optional[str]):
    if not company_id:
        return
    import notify as _notify
    name = emp.get("full_name") or emp.get("name") or "Personel"
    label = _notify.role_label(role)
    await _notify.insert_notification(_db, _notify.notification_doc(
        company_id, "role_assigned",
        f"Rol atandı: {label}",
        f"{name} kullanıcısına {label} rolü verildi.",
        link="/personnel",
        user_id=user_id or emp.get("user_id"),
        employee_id=emp.get("_id") or emp.get("id") or emp.get("employee_id"),
        ref_type="employee",
        ref_id=emp.get("_id") or emp.get("id") or emp.get("employee_id"),
    ))


# ---------------- Roles ----------------
@router.get("/roles")
async def list_roles(company_id: str = "comp_nexus_main_01"):
    await ensure_roles(company_id)
    roles = [_clean(r) for r in await _db.roles.find({"company_id": company_id}).to_list(100)]
    counts = {}
    async for u in _db.users.find({"company_ids": company_id, "is_super_admin": {"$ne": True}}, {"role": 1}):
        counts[u.get("role", "admin")] = counts.get(u.get("role", "admin"), 0) + 1
    company = await _db.companies.find_one({"_id": company_id}) or {}
    policies = {"cash_dual_approval": bool(company.get("cash_dual_approval"))}
    return {"modules": [{"key": k, "label": l} for k, l in MODULES], "levels": list(LEVELS), "features": [{"key": k, "label": l, "help": h} for k, l, h in FEATURES], "policies": policies, "roles": [{**r, "features": role_features(r), "user_count": counts.get(r["code"], 0)} for r in roles]}


@router.put("/roles/policies")
async def update_company_policies(req: Dict[str, Any]):
    company_id = req.get("company_id", "comp_nexus_main_01")
    company = await _db.companies.find_one({"_id": company_id})
    if not company:
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    upd: Dict[str, Any] = {}
    if "cash_dual_approval" in req:
        upd["cash_dual_approval"] = bool(req["cash_dual_approval"])
    if upd:
        await _db.companies.update_one({"_id": company_id}, {"$set": {**upd, "updated_at": _now()}})
    company = await _db.companies.find_one({"_id": company_id}) or {}
    return {"status": "success", "policies": {"cash_dual_approval": bool(company.get("cash_dual_approval"))}}


@router.post("/roles")
async def create_role(req: Dict[str, Any]):
    company_id = req.get("company_id", "comp_nexus_main_01")
    name = (req.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Rol adı boş olamaz.")
    code = (req.get("code") or "").strip().lower() or "r_" + secrets.token_hex(3)
    if await _db.roles.find_one({"company_id": company_id, "code": code}):
        raise HTTPException(status_code=400, detail="Bu rol kodu zaten var.")
    perms = {k: (req.get("permissions") or {}).get(k, "none") for k, _ in MODULES}
    doc = {"_id": f"role_{company_id}_{code}", "company_id": company_id, "code": code, "name": name, "is_system": False, "permissions": perms, "features": {k: bool((req.get("features") or {}).get(k, True)) for k, _, _ in FEATURES}, "created_at": _now()}
    await _db.roles.insert_one(doc)
    return _clean(doc)


@router.put("/roles/{role_id}")
async def update_role(role_id: str, req: Dict[str, Any]):
    r = await _db.roles.find_one({"_id": role_id})
    if not r:
        raise HTTPException(status_code=404, detail="Rol bulunamadı.")
    upd: Dict[str, Any] = {}
    if req.get("name") and not r.get("is_system"):
        upd["name"] = req["name"].strip()
    if "permissions" in req:
        if r["code"] == "admin":
            raise HTTPException(status_code=400, detail="Yönetici rolünün yetkileri değiştirilemez.")
        upd["permissions"] = {k: (req["permissions"].get(k) if req["permissions"].get(k) in LEVELS else r["permissions"].get(k, "none")) for k, _ in MODULES}
    if "features" in req:
        if r["code"] == "admin":
            raise HTTPException(status_code=400, detail="Yönetici rolünün yetkileri değiştirilemez.")
        cur = role_features(r)
        upd["features"] = {k: bool(req["features"].get(k, cur[k])) for k, _, _ in FEATURES}
    if upd:
        await _db.roles.update_one({"_id": role_id}, {"$set": {**upd, "updated_at": _now()}})
    return _clean(await _db.roles.find_one({"_id": role_id}))


@router.delete("/roles/{role_id}")
async def delete_role(role_id: str):
    r = await _db.roles.find_one({"_id": role_id})
    if not r:
        raise HTTPException(status_code=404, detail="Rol bulunamadı.")
    if r.get("is_system"):
        raise HTTPException(status_code=400, detail="Sistem rolleri silinemez.")
    if await _db.users.count_documents({"role": r["code"], "company_ids": r["company_id"], "is_super_admin": {"$ne": True}}):
        raise HTTPException(status_code=400, detail="Bu role sahip kullanıcılar var; önce rollerini değiştirin.")
    await _db.roles.delete_one({"_id": role_id})
    return {"status": "success"}


# ---------------- Users ----------------
@router.get("/users")
async def list_users(company_id: str = "comp_nexus_main_01"):
    await ensure_roles(company_id)
    names = {r["code"]: r["name"] for r in await _db.roles.find({"company_id": company_id}).to_list(100)}
    raw_users = await _db.users.find({"$and": [{"$or": [{"company_ids": company_id}, {"active_company_id": company_id}]}, {"is_super_admin": {"$ne": True}}]}).sort("name", 1).to_list(500)
    for u in raw_users:
        await user_numbers.ensure_user_number(_db, u)
    users = [_clean(u) for u in raw_users]
    invites = [_clean(i) for i in await _db.user_invites.find({"company_id": company_id, "accepted_at": None}).sort("created_at", -1).to_list(100)]
    return {"users": [{**u, "role_name": names.get(u.get("role"), u.get("role")), "is_active": u.get("is_active", True)} for u in users], "invites": invites}


@router.put("/users/{user_id}")
async def update_user(user_id: str, req: Dict[str, Any]):
    u = await _db.users.find_one({"_id": user_id})
    if not u:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı.")
    if u.get("is_super_admin"):
        raise HTTPException(status_code=400, detail="Platform yöneticileri şirket kullanıcı listesinden düzenlenemez.")
    upd = {k: req[k] for k in ("name", "role", "is_active", "phone", "employee_id") if k in req}
    if "role" in upd and u.get("email") == "admin@nexus.com" and upd["role"] != "admin":
        raise HTTPException(status_code=400, detail="Ana yönetici hesabının rolü değiştirilemez.")
    if req.get("password"):
        if len(req["password"]) < 6:
            raise HTTPException(status_code=400, detail="Şifre en az 6 karakter olmalı.")
        upd["password_hash"] = hash_password(req["password"])
    await _db.users.update_one({"_id": user_id}, {"$set": {**upd, "updated_at": _now()}})
    if "role" in upd and upd["role"] != u.get("role"):
        await _notify_role_assigned(u.get("active_company_id") or (u.get("company_ids") or [None])[0], {
            "full_name": upd.get("name") or u.get("name"),
            "_id": u.get("employee_id"),
            "user_id": user_id,
        }, upd["role"], user_id)
    return _clean(await _db.users.find_one({"_id": user_id}))


@router.post("/users")
async def create_company_user(req: Dict[str, Any]):
    """Create a company user immediately with a password (no e-mail invite)."""
    company_id = req.get("company_id", "comp_nexus_main_01")
    email = (req.get("email") or "").strip().lower()
    name = (req.get("name") or "").strip() or (email.split("@")[0] if email else "")
    pwd = req.get("password") or ""
    role = req.get("role") or "sales"
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Geçerli bir e-posta girin.")
    if not name:
        raise HTTPException(status_code=400, detail="Ad soyad girin.")
    if len(pwd) < 6:
        raise HTTPException(status_code=400, detail="Şifre en az 6 karakter olmalı.")
    if await _db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Bu e-posta ile kayıtlı kullanıcı zaten var.")
    await ensure_roles(company_id)
    import saas
    await saas.check_user_limit(company_id)
    if not await _db.roles.find_one({"company_id": company_id, "code": role}):
        raise HTTPException(status_code=400, detail="Geçersiz rol.")
    user_id = f"usr_{uuid.uuid4().hex[:8]}"
    doc = {"_id": user_id, "email": email, "password_hash": hash_password(pwd), "name": name, "role": role,
           "company_ids": [company_id], "active_company_id": company_id, "is_active": True,
           "employee_id": req.get("employee_id"), "phone": req.get("phone") or "", "preferences": {},
           "user_number": await user_numbers.next_user_number(_db), "created_at": _now()}
    await _db.users.insert_one(doc)
    await _db.user_invites.delete_many({"company_id": company_id, "email": email, "accepted_at": None})
    if req.get("employee_id"):
        await _db.employees.update_one({"_id": req["employee_id"]}, {"$set": {"user_id": user_id, "email": email}})
    await _notify_role_assigned(company_id, {"full_name": name, "_id": req.get("employee_id"), "user_id": user_id}, role, user_id)
    names = {r["code"]: r["name"] for r in await _db.roles.find({"company_id": company_id}).to_list(100)}
    out = _clean(dict(doc))
    return {**out, "role_name": names.get(role, role), "is_active": True, "message": f"{name} eklendi. {email} ile giriş yapabilir."}


@router.delete("/users/{user_id}")
async def delete_user(user_id: str):
    u = await _db.users.find_one({"_id": user_id})
    if not u:
        raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı.")
    if u.get("is_super_admin") or u.get("email") == "admin@nexus.com":
        raise HTTPException(status_code=400, detail="Platform yöneticileri şirket kullanıcı listesinden silinemez.")
    await _db.users.delete_one({"_id": user_id})
    return {"status": "success"}


# ---------------- Invitations ----------------
@router.post("/users/invite")
async def invite_user(req: Dict[str, Any], request: Request):
    company_id = req.get("company_id", "comp_nexus_main_01")
    email = (req.get("email") or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Geçerli bir e-posta girin.")
    if await _db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Bu e-posta ile kayıtlı kullanıcı zaten var.")
    role = req.get("role") or "sales"
    await ensure_roles(company_id)
    import saas
    await saas.check_user_limit(company_id)
    if not await _db.roles.find_one({"company_id": company_id, "code": role}):
        raise HTTPException(status_code=400, detail="Geçersiz rol.")
    company = await _db.companies.find_one({"_id": company_id}) or {}
    token = secrets.token_urlsafe(32)
    base = (req.get("base_url") or str(request.headers.get("origin") or "")).rstrip("/")
    link = f"{base}/davet/{token}"
    doc = {"_id": token, "company_id": company_id, "company_name": company.get("name"), "email": email, "name": (req.get("name") or "").strip(), "role": role, "employee_id": req.get("employee_id"),
           "invited_by": req.get("invited_by"), "link": link, "expires_at": (datetime.now(timezone.utc) + timedelta(days=7)).isoformat(), "accepted_at": None, "created_at": _now()}
    await _db.user_invites.delete_many({"company_id": company_id, "email": email, "accepted_at": None})
    await _db.user_invites.insert_one(doc)
    mail = {"status": "skipped", "detail": "E-posta hesabı tanımlı değil; linki kopyalayıp iletin."}
    try:
        a = await _mail_account(company_id)
        subject = f"{company.get('name', 'TamKobi')} sizi davet ediyor"
        body = f"Merhaba {doc['name'] or ''},\n{company.get('name', 'Firmamız')} sizi TamKobi sistemine '{role}' rolüyle davet etti. Hesabınızı oluşturmak için: {link}\nBu link 7 gün geçerlidir."
        html = f"<p>{body.replace(chr(10), '<br>')}</p><p><a href='{link}' style='background:#059669;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold'>Daveti Kabul Et</a></p>"
        await comm_service.smtp_send(a, [email], subject, body, html=html)
        mail = {"status": "sent", "detail": f"{email} adresine davet gönderildi."}
    except HTTPException as e:
        mail = {"status": "skipped", "detail": e.detail}
    except Exception as e:
        mail = {"status": "failed", "detail": f"SMTP hatası: {str(e)[:120]}"}
    await _db.user_invites.update_one({"_id": token}, {"$set": {"mail": mail}})
    await _notify_role_assigned(company_id, {"full_name": doc.get("name") or email, "_id": req.get("employee_id")}, role, None)
    return {**_clean(doc), "mail": mail}


@router.delete("/users/invite/{token}")
async def cancel_invite(token: str):
    await _db.user_invites.delete_one({"_id": token})
    return {"status": "success"}


@router.get("/public/invites/{token}")
async def get_invite(token: str):
    inv = await _db.user_invites.find_one({"_id": token})
    if not inv:
        raise HTTPException(status_code=404, detail="Davet bulunamadı veya iptal edilmiş.")
    if inv.get("accepted_at"):
        raise HTTPException(status_code=400, detail="Bu davet zaten kullanılmış. Giriş yapabilirsiniz.")
    if inv.get("expires_at") < _now():
        raise HTTPException(status_code=400, detail="Davetin süresi dolmuş; yöneticinizden yeni davet isteyin.")
    role = await _db.roles.find_one({"company_id": inv["company_id"], "code": inv["role"]}) or {}
    return {"email": inv["email"], "name": inv.get("name"), "company_name": inv.get("company_name"), "role_name": role.get("name", inv["role"])}


@router.post("/public/invites/{token}/accept")
async def accept_invite(token: str, req: Dict[str, Any], response: Response):
    inv = await _db.user_invites.find_one({"_id": token})
    if not inv or inv.get("accepted_at") or inv.get("expires_at") < _now():
        raise HTTPException(status_code=400, detail="Davet geçersiz, kullanılmış veya süresi dolmuş.")
    pwd = req.get("password") or ""
    if len(pwd) < 6:
        raise HTTPException(status_code=400, detail="Şifre en az 6 karakter olmalı.")
    if await _db.users.find_one({"email": inv["email"]}):
        raise HTTPException(status_code=400, detail="Bu e-posta ile kullanıcı zaten var.")
    user_id = f"usr_{uuid.uuid4().hex[:8]}"
    doc = {"_id": user_id, "email": inv["email"], "password_hash": hash_password(pwd), "name": (req.get("name") or inv.get("name") or inv["email"].split("@")[0]).strip(), "role": inv["role"],
           "company_ids": [inv["company_id"]], "active_company_id": inv["company_id"], "is_active": True, "employee_id": inv.get("employee_id"), "preferences": {},
           "user_number": await user_numbers.next_user_number(_db), "created_at": _now()}
    await _db.users.insert_one(doc)
    await _db.user_invites.update_one({"_id": token}, {"$set": {"accepted_at": _now(), "user_id": user_id}})
    if inv.get("employee_id"):
        await _db.employees.update_one({"_id": inv["employee_id"]}, {"$set": {"user_id": user_id}})
    access = create_access_token(user_id, doc["email"], doc["role"])
    response.set_cookie(key="access_token", value=access, httponly=True, max_age=86400 * 7, path="/")
    response.set_cookie(key="refresh_token", value=create_refresh_token(user_id), httponly=True, max_age=86400 * 30, path="/")
    return {"status": "success", "user": _clean(dict(doc)), "message": "Hesabınız oluşturuldu, giriş yapıldı."}


# ---------------- Activity log ----------------
@router.get("/activity-logs")
async def activity_logs(company_id: str = "comp_nexus_main_01", user_id: Optional[str] = None, module: Optional[str] = None, limit: int = 100):
    q: Dict[str, Any] = {"company_id": company_id}
    if user_id:
        q["user_id"] = user_id
    if module:
        q["module"] = module
    return [_clean(x) for x in await _db.activity_logs.find(q).sort("created_at", -1).to_list(min(limit, 500))]
