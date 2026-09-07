import asyncio
from dotenv import load_dotenv
load_dotenv()

import os
import uuid
import re
import secrets
import logging
from datetime import datetime, timezone, timedelta, date
from calendar import monthrange
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, APIRouter, Depends, HTTPException, Request, Response, status, UploadFile, File, Query, Form
from starlette.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from mysql_store import MySQLClient
import partner_pay

from models import (
    User, UserResponse, Company, Contact, Product, ProductVariant,
    Warehouse, WarehouseTransfer, Invoice, InvoiceItem, BankAccount,
    BankTransaction, IntegrationConfig, CargoConfig, CargoShipment,
    Order, OrderItem, Recipe, ProductionOrder, Employee, Payroll, ChatMessage,
    Partner, PartnerTransaction, BankConnection,
    SmsSettings, SmsLog, MailAccount, MailLog
)
from auth_utils import (
    hash_password, verify_password, create_access_token,
    create_refresh_token, get_user_from_token
)
from seed_data import seed_all_data, seed_partners, seed_shopfloor_pins
from ai_service import get_financial_ai_advice, extract_invoice_from_text, extract_orders_from_text as ai_service_extract_orders, extract_products_from_text as ai_service_extract_products
from storage_service import init_storage, put_object, get_object, APP_NAME
import bank_providers
import bank_guard
import cash_approval
import marketplace_providers
from zoneinfo import ZoneInfo
import httpx
from urllib.parse import quote
import comm_service
import cargo_providers
import rbac
import expenses
import finance
import cheques
import attendance
import trash
import migration
import pricing
import edocs
import saas
import saas_billing
import saas_extras
import saas_docs
import gib_credits

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("NexusERP")

# MySQL connection (JSON document store; Motor-compatible API)
from mysql_store import mysql_settings_from_env
_mysql_cfg = mysql_settings_from_env()
DB_NAME = _mysql_cfg["db"]
client = MySQLClient()
db = client[DB_NAME]

app = FastAPI(title="NexusHesap Cloud ERP & CRM & Muhasebe API")

# Setup CORS
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=[o.strip() for o in os.environ.get('CORS_ORIGINS', '').split(',') if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)

api_router = APIRouter(prefix="/api")
app.add_middleware(rbac.PermissionAndAuditMiddleware)

def clean_doc(doc: dict) -> dict:
    if not doc:
        return doc
    if "_id" in doc:
        doc["id"] = str(doc.pop("_id"))
    if "b2b_password_hash" in doc:
        doc["has_b2b_password"] = bool(doc.pop("b2b_password_hash"))
    if "shopfloor_pin_hash" in doc:
        doc["has_shopfloor_pin"] = bool(doc.pop("shopfloor_pin_hash"))
    doc.pop("password_hash", None)
    return doc

def clean_docs(docs: list) -> list:
    return [clean_doc(d) for d in docs]

# Startup event
@app.on_event("startup")
async def startup_event():
    asyncio.get_event_loop().create_task(pricing.scheduler_loop())
    try:
        await db._ensure()
        logger.info("MySQL connected %s:%s/%s", _mysql_cfg["host"], _mysql_cfg["port"], DB_NAME)
        await seed_all_data(db)
        await seed_partners(db)
        await seed_shopfloor_pins(db)
        await saas.seed()
        await db.users.create_index("email", unique=True)
        await db.products.create_index("sku")
        await db.products.create_index("barcode")
        await db.contacts.create_index("tax_number_or_id")
        await db.invoices.create_index("invoice_number")
        await db.orders.create_index("order_number")
        await db.login_attempts.create_index("identifier")
        logger.info("NexusHesap backend startup complete. Seed & indexes ready.")
    except Exception as e:
        logger.error(f"Startup error: {e}")
    try:
        init_storage()
        logger.info("Object storage initialized")
    except Exception as e:
        logger.error(f"Storage init failed: {e}")
    attendance.init_notify(_mail_account, comm_service.smtp_send)
    import asyncio as _asyncio
    _asyncio.get_event_loop().create_task(attendance.watcher_loop())
    _asyncio.get_event_loop().create_task(_marketplace_auto_sync_loop())
    _asyncio.get_event_loop().create_task(saas_billing.reminder_loop())

# Helper Auth Dependency
async def get_current_user(request: Request) -> dict:
    auth_header = request.headers.get("Authorization", "")
    token = None
    if auth_header.startswith("Bearer "):
        token = auth_header[7:]
    elif "access_token" in request.cookies:
        token = request.cookies.get("access_token")

    if not token:
        # Check if demo admin is in DB
        admin = await db.users.find_one({"email": "admin@nexus.com"})
        if admin:
            return clean_doc(admin)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Giriş yapmanız gerekiyor.")

    return await get_user_from_token(token, db)

# ----------------- AUTH ENDPOINTS -----------------
class LoginRequest(BaseModel):
    email: str
    password: str

class RegisterRequest(BaseModel):
    name: str
    email: str
    password: str
    company_name: Optional[str] = "Yeni Şirketim A.Ş."
    tax_number: Optional[str] = "1234567890"

@api_router.post("/auth/login")
async def login(req: LoginRequest, request: Request, response: Response):
    email = req.email.strip().lower()
    fwd = request.headers.get("x-forwarded-for", "")
    client_ip = fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "unknown")
    identifier = f"{client_ip}:{email}"

    # Check brute force lockout
    attempt = await db.login_attempts.find_one({"identifier": identifier})
    if attempt and attempt.get("count", 0) >= 5:
        last_attempt = attempt.get("last_attempt", datetime.now(timezone.utc))
        if isinstance(last_attempt, str):
            last_attempt = datetime.fromisoformat(last_attempt)
        if datetime.now(timezone.utc) - last_attempt < timedelta(minutes=15):
            raise HTTPException(status_code=429, detail="Çok fazla hatalı giriş denemesi. Lütfen 15 dakika sonra tekrar deneyin.")

    user = await db.users.find_one({"email": email})
    if not user or not verify_password(req.password, user.get("password_hash", "")):
        # Increment failed login attempt
        await db.login_attempts.update_one(
            {"identifier": identifier},
            {"$inc": {"count": 1}, "$set": {"last_attempt": datetime.now(timezone.utc).isoformat()}},
            upsert=True
        )
        raise HTTPException(status_code=401, detail="E-posta adresi veya şifre hatalı.")

    if user.get("is_active") is False:
        raise HTTPException(status_code=403, detail="Hesabınız pasif durumda. Yöneticinizle iletişime geçin.")
    # Reset failed attempts on success
    await db.login_attempts.delete_one({"identifier": identifier})
    await db.users.update_one({"_id": user["_id"]}, {"$set": {"last_login_at": datetime.now(timezone.utc).isoformat()}})
    role_doc = await rbac.role_for(user)

    user_id = str(user.get("_id", user.get("id")))
    token = create_access_token(user_id, email, user.get("role", "admin"))
    refresh_tok = create_refresh_token(user_id)

    response.set_cookie(key="access_token", value=token, httponly=True, max_age=86400*7, path="/")
    response.set_cookie(key="refresh_token", value=refresh_tok, httponly=True, max_age=86400*30, path="/")

    companies = await db.companies.find({"_id": {"$in": user.get("company_ids", []) or []}}).to_list(100)

    return {
        "token": token,
        "user": {
            "id": user_id,
            "email": user["email"],
            "name": user["name"],
            "role": user.get("role", "admin"),
            "company_ids": user.get("company_ids", []),
            "active_company_id": user.get("active_company_id", "comp_nexus_main_01"),
            "preferences": user.get("preferences", {}),
            "role_name": role_doc.get("name"), "permissions": role_doc.get("permissions", {}), "features": rbac.role_features(role_doc),
            "is_super_admin": bool(user.get("is_super_admin")),
        },
        "companies": clean_docs(companies),
        "license": await saas.effective(user.get("active_company_id", "comp_nexus_main_01")),
    }

@api_router.put("/auth/me/preferences")
async def update_preferences(req: Dict[str, Any], user: dict = Depends(get_current_user)):
    allowed = {k: v for k, v in req.items() if k in {"module_order", "hidden_modules", "theme"}}
    await db.users.update_one({"_id": user.get("_id", user.get("id"))}, {"$set": {f"preferences.{k}": v for k, v in allowed.items()}})
    u = await db.users.find_one({"_id": user.get("_id", user.get("id"))})
    return (u or {}).get("preferences", {})

# ----------------- FİRMA AYARLARI -----------------
@api_router.get("/companies/{company_id}")
async def get_company(company_id: str):
    c = await db.companies.find_one({"_id": company_id})
    if not c:
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    return clean_doc(c)

@api_router.put("/companies/{company_id}")
async def update_company(company_id: str, req: Dict[str, Any]):
    allowed = {k: v for k, v in req.items() if k in {"name", "tax_number", "tax_office", "address", "city", "phone", "email", "currency", "logo_url", "e_invoice_alias", "website", "iban", "bank_name", "mersis", "trade_registry"}}
    await db.companies.update_one({"_id": company_id}, {"$set": allowed})
    return clean_doc(await db.companies.find_one({"_id": company_id}))

B2B_DEFAULTS = {"enabled": True, "login_method": "both", "allow_ai_cart": True, "default_discount": 0.0, "show_stock": True, "show_prices": True, "allow_orders": True, "show_statement": True, "show_installments": True, "min_order_amount": 0.0, "welcome_note": ""}

@api_router.get("/companies/{company_id}/b2b-settings")
async def get_b2b_settings(company_id: str):
    c = await db.companies.find_one({"_id": company_id}) or {}
    settings = {**B2B_DEFAULTS, **(c.get("b2b_settings") or {})}
    customers = [{"id": x["_id"], "name": x.get("name"), "b2b_enabled": x.get("b2b_enabled", False), "b2b_discount": x.get("b2b_discount", 0), "b2b_token": x.get("b2b_token"), "email": x.get("email"), "phone": x.get("phone"), "tax_number_or_id": x.get("tax_number_or_id"), "b2b_login_email": x.get("b2b_login_email"), "has_password": bool(x.get("b2b_password_hash")), "b2b_last_login": x.get("b2b_last_login")} for x in await db.contacts.find({"company_id": company_id, "type": {"$in": ["customer", "both"]}}).sort("name", 1).to_list(2000)]
    return {"settings": settings, "customers": customers, "active_count": sum(1 for x in customers if x["b2b_enabled"])}

@api_router.put("/companies/{company_id}/b2b-settings")
async def put_b2b_settings(company_id: str, req: Dict[str, Any]):
    allowed = {k: req[k] for k in B2B_DEFAULTS if k in req}
    await db.companies.update_one({"_id": company_id}, {"$set": {"b2b_settings": {**B2B_DEFAULTS, **allowed}}})
    if req.get("apply_discount_to_all") and "default_discount" in allowed:
        await db.contacts.update_many({"company_id": company_id, "b2b_enabled": True}, {"$set": {"b2b_discount": float(allowed["default_discount"])}})
    return {"status": "success", "settings": {**B2B_DEFAULTS, **allowed}}

EINVOICE_PROVIDERS = {
    "foriba": {"name": "Foriba (Sovos)", "fields": ["username", "password"], "docs": "https://www.sovos.com/tr/"},
    "elogo": {"name": "Logo e-Fatura / eLogo", "fields": ["username", "password"], "docs": "https://www.elogo.com.tr/"},
    "uyumsoft": {"name": "Uyumsoft", "fields": ["username", "password"], "docs": "https://www.uyumsoft.com/"},
    "izibiz": {"name": "İzibiz", "fields": ["username", "password"], "docs": "https://www.izibiz.com.tr/"},
    "other": {"name": "Diğer Entegratör", "fields": ["api_url", "username", "password", "api_key"], "docs": ""},
}

@api_router.get("/einvoice/providers")
async def einvoice_providers():
    return [{"code": k, **v} for k, v in EINVOICE_PROVIDERS.items()]

@api_router.get("/einvoice/settings")
async def get_einvoice_settings(company_id: Optional[str] = "comp_nexus_main_01"):
    s = await db.einvoice_settings.find_one({"company_id": company_id})
    if not s:
        return {"company_id": company_id, "provider": "", "mode": "test", "username": "", "has_password": False, "status": "simulated", "alias": ""}
    return {"id": str(s["_id"]), "company_id": company_id, "provider": s.get("provider", ""), "mode": s.get("mode", "test"), "username": s.get("username", ""),
            "api_url": s.get("api_url", ""), "alias": s.get("alias", ""), "has_password": bool(s.get("password_enc")), "status": s.get("status", "simulated"), "updated_at": s.get("updated_at")}

@api_router.put("/einvoice/settings")
async def save_einvoice_settings(req: Dict[str, Any]):
    company_id = req.get("company_id", "comp_nexus_main_01")
    provider = req.get("provider", "")
    if provider and provider not in EINVOICE_PROVIDERS:
        raise HTTPException(status_code=400, detail="Desteklenmeyen entegratör.")
    update = {"provider": provider, "mode": req.get("mode", "test"), "username": (req.get("username") or "").strip(), "api_url": req.get("api_url", ""), "alias": req.get("alias", ""),
              "updated_at": datetime.now(timezone.utc).isoformat()}
    if req.get("password"):
        update["password_enc"] = comm_service.encrypt(req["password"])
    existing = await db.einvoice_settings.find_one({"company_id": company_id})
    has_creds = bool(update["username"] and (update.get("password_enc") or (existing or {}).get("password_enc")))
    update["status"] = "configured" if provider and has_creds else "simulated"
    await db.einvoice_settings.update_one({"company_id": company_id}, {"$set": update, "$setOnInsert": {"_id": str(uuid.uuid4()), "company_id": company_id}}, upsert=True)
    return await get_einvoice_settings(company_id)

DEFAULT_PRINT_TEMPLATE = {"show_logo": True, "primary_color": "#059669", "header_note": "", "footer_note": "Bizi tercih ettiğiniz için teşekkür ederiz.", "show_bank_info": True,
                          "show_tax_info": True, "show_signature": True, "show_barcode": True, "show_images": True, "font_size": "sm", "paper": "A4", "title_override": "", "layout": "classic", "hide_line_prices": False, "hide_vat": False, "hide_all_prices": False, "show_item_notes": True, "show_order_notes": True}

@api_router.get("/companies/{company_id}/print-templates")
async def get_print_templates(company_id: str):
    c = await db.companies.find_one({"_id": company_id})
    if not c:
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    templates = c.get("print_templates", {})
    return {doc: {**DEFAULT_PRINT_TEMPLATE, **templates.get(doc, {})} for doc in ("invoice", "order", "quote", "dispatch")}

@api_router.put("/companies/{company_id}/print-templates/{doc_type}")
async def save_print_template(company_id: str, doc_type: str, req: Dict[str, Any]):
    if doc_type not in ("invoice", "order", "quote", "dispatch"):
        raise HTTPException(status_code=400, detail="Geçersiz belge türü.")
    allowed = {k: v for k, v in req.items() if k in DEFAULT_PRINT_TEMPLATE}
    await db.companies.update_one({"_id": company_id}, {"$set": {f"print_templates.{doc_type}": allowed}})
    return {**DEFAULT_PRINT_TEMPLATE, **allowed}

@api_router.post("/files/upload")
async def upload_generic_file(file: UploadFile = File(...), entity: str = Query("misc"), entity_id: str = Query(""), company_id: str = Query("comp_nexus_main_01")):
    if file.content_type not in ALLOWED_IMAGE_TYPES and file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Sadece JPG, PNG, WEBP, GIF veya PDF yükleyebilirsiniz.")
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Dosya boyutu en fazla 10 MB olabilir.")
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else "bin"
    path = f"{APP_NAME}/{entity}/{company_id}/{uuid.uuid4()}.{ext}"
    try:
        result = put_object(path, data, file.content_type)
    except Exception as e:
        logger.error(f"Upload failed: {e}")
        raise HTTPException(status_code=502, detail="Dosya depolama servisine yüklenemedi.")
    await db.files.insert_one({"_id": str(uuid.uuid4()), "storage_path": result["path"], "original_filename": file.filename, "content_type": file.content_type, "size": len(data),
                               "entity": entity, "entity_id": entity_id, "is_deleted": False, "created_at": datetime.now(timezone.utc).isoformat()})
    url = f"/api/files/{result['path']}"
    if entity in ("quote", "project", "survey", "company") and entity_id:
        coll = {"quote": db.quotes, "project": db.projects, "survey": db.surveys, "company": db.companies}[entity]
        if entity == "company":
            await coll.update_one({"_id": entity_id}, {"$set": {"logo_url": url}})
        else:
            await coll.update_one({"_id": entity_id}, {"$push": {"images": url}})
    return {"url": url, "filename": file.filename, "content_type": file.content_type, "size": len(data)}

# ----------------- TEKLİF / PROJE / KEŞİF -----------------
async def _next_number(prefix: str, coll=None, company_id: Optional[str] = None) -> str:
    year = datetime.now(timezone.utc).year
    key = f"{prefix}-{year}" + (f"-{company_id}" if company_id else "")
    c = await db.counters.find_one_and_update({"_id": key}, {"$inc": {"seq": 1}}, upsert=True, return_document=True)
    return f"{prefix}-{year}-{c['seq']:04d}"

async def _next_order_number(company_id: str, prefix: str) -> str:
    """Atomik sayaç; mevcut en büyük numaradan devam eder (mükerrer sipariş no engeli)."""
    year = datetime.now(timezone.utc).year
    key = f"{prefix}-{year}-{company_id}"
    if not await db.counters.find_one({"_id": key}):
        last = await db.orders.find({"company_id": company_id, "order_number": {"$regex": f"^{prefix}-{year}-"}}).sort("order_number", -1).limit(1).to_list(1)
        seed = 0
        if last:
            try:
                seed = int(last[0]["order_number"].rsplit("-", 1)[1])
            except (ValueError, IndexError):
                seed = await db.orders.count_documents({"company_id": company_id})
        await db.counters.update_one({"_id": key}, {"$setOnInsert": {"seq": seed}}, upsert=True)
    return await _next_number(prefix, None, company_id)

def _calc_items(items: List[Dict[str, Any]]):
    subtotal = vat_total = 0.0
    for it in items:
        qty, price, vat = float(it.get("quantity", 0)), float(it.get("unit_price", 0)), float(it.get("vat_rate", 20))
        disc = float(it.get("discount_rate", 0))
        line = qty * price * (1 - disc / 100)
        it["total"] = round(line, 2)
        it["vat_amount"] = round(line * vat / 100, 2)
        subtotal += line
        vat_total += line * vat / 100
    return round(subtotal, 2), round(vat_total, 2), round(subtotal + vat_total, 2)

@api_router.get("/quotes")
async def list_quotes(company_id: Optional[str] = "comp_nexus_main_01", contact_id: Optional[str] = None, status: Optional[str] = None):
    q = {"company_id": company_id}
    if contact_id:
        q["contact_id"] = contact_id
    if status:
        q["status"] = status
    return clean_docs(await db.quotes.find(q).sort("created_at", -1).to_list(500))

@api_router.post("/quotes")
async def create_quote(req: Dict[str, Any]):
    company_id = req.get("company_id", "comp_nexus_main_01")
    items = req.get("items") or []
    if not items:
        raise HTTPException(status_code=400, detail="En az bir kalem ekleyin.")
    subtotal, vat_total, grand_total = _calc_items(items)
    doc = {"_id": str(uuid.uuid4()), "company_id": company_id, "quote_number": await _next_number("TKF", db.quotes), "contact_id": req.get("contact_id"), "contact_name": req.get("contact_name"),
           "title": req.get("title") or "Fiyat Teklifi", "items": items, "subtotal": subtotal, "vat_total": vat_total, "grand_total": grand_total, "currency": "TRY",
           "status": "draft", "valid_until": req.get("valid_until"), "notes": req.get("notes", ""), "terms": req.get("terms", ""), "images": [], "project_id": req.get("project_id"),
           "survey_id": req.get("survey_id"), "invoice_id": None, "issue_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "created_at": datetime.now(timezone.utc).isoformat()}
    await db.quotes.insert_one(doc)
    return clean_doc(doc)

@api_router.post("/quotes/{quote_id}/send-approval")
async def send_quote_approval(quote_id: str, req: Dict[str, Any]):
    q = await db.quotes.find_one({"_id": quote_id})
    if not q:
        raise HTTPException(status_code=404, detail="Teklif bulunamadı.")
    channels = [c for c in (req.get("channels") or []) if c in ("sms", "email", "whatsapp")]
    if not channels:
        raise HTTPException(status_code=400, detail="En az bir kanal seçin (SMS / E-posta / WhatsApp).")
    contact = await db.contacts.find_one({"_id": q.get("contact_id")}) if q.get("contact_id") else None
    company = await db.companies.find_one({"_id": q["company_id"]}) or {}
    phone = req.get("phone") or (contact or {}).get("phone")
    email = req.get("email") or (contact or {}).get("email")
    approval = q.get("approval") or {}
    token = approval.get("token") or uuid.uuid4().hex
    base = (req.get("base_url") or "").rstrip("/")
    link = f"{base}/teklif/{token}"
    total = f"{q.get('grand_total', 0):,.2f}".replace(",", "X").replace(".", ",").replace("X", ".")
    message = (req.get("message") or f"Sayın {q.get('contact_name')}, {company.get('name', 'firmamız')} olarak hazırladığımız {q.get('quote_number')} numaralı {total} ₺ tutarındaki teklifimizi incelemek ve onaylamak için: {link}").strip()
    if link not in message:
        message = f"{message}\n{link}"
    results: Dict[str, Any] = {}
    if "sms" in channels:
        if not phone:
            results["sms"] = {"status": "failed", "detail": "Carinin telefon numarası yok."}
        else:
            try:
                r = await _send_sms_to(q["company_id"], [{"phone": phone, "contact_id": q.get("contact_id"), "contact_name": q.get("contact_name")}], message, "quote_approval", quote_id)
                results["sms"] = {"status": "sent" if not r.get("simulated") else "simulated", "detail": r.get("message")}
            except HTTPException as e:
                results["sms"] = {"status": "failed", "detail": e.detail}
    if "email" in channels:
        if not email:
            results["email"] = {"status": "failed", "detail": "Carinin e-posta adresi yok."}
        else:
            try:
                a = await _mail_account(q["company_id"])
                subject = f"{q.get('quote_number')} - {q.get('title') or 'Fiyat Teklifi'} onayınızı bekliyor"
                html = f"<p>{message.replace(chr(10), '<br>')}</p><p><a href='{link}' style='background:#059669;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold'>Teklifi Görüntüle & Onayla</a></p>"
                await comm_service.smtp_send(a, [email], subject, message, html=html)
                await db.mail_logs.insert_one(MailLog(company_id=q["company_id"], from_email=a["email"], to=[email], subject=subject, body=message, contact_id=q.get("contact_id"), contact_name=q.get("contact_name"), context="quote_approval", ref_id=quote_id).to_mongo())
                results["email"] = {"status": "sent", "detail": f"{email} adresine gönderildi."}
            except HTTPException as e:
                results["email"] = {"status": "failed", "detail": e.detail}
            except Exception as e:
                results["email"] = {"status": "failed", "detail": f"SMTP hatası: {_err_text(e)}"}
    if "whatsapp" in channels:
        if not phone:
            results["whatsapp"] = {"status": "failed", "detail": "Carinin telefon numarası yok."}
        else:
            try:
                r = await wa_send({"company_id": q["company_id"], "phone": phone, "message": message, "contact_id": q.get("contact_id"), "contact_name": q.get("contact_name")})
                results["whatsapp"] = {"status": r.get("status"), "detail": r.get("message_info"), "wa_link": r.get("wa_link")}
            except HTTPException as e:
                results["whatsapp"] = {"status": "failed", "detail": e.detail}
    now = datetime.now(timezone.utc).isoformat()
    approval.update({"token": token, "link": link, "status": approval.get("status") if approval.get("status") in ("accepted", "rejected") else "pending", "sent_at": now, "channels": channels, "results": results, "sent_count": approval.get("sent_count", 0) + 1})
    upd = {"approval": approval}
    if q.get("status") == "draft":
        upd["status"] = "sent"
    await db.quotes.update_one({"_id": quote_id}, {"$set": upd})
    any_ok = any(v.get("status") in ("sent", "simulated") for v in results.values())
    return {"status": "success" if any_ok else "failed", "link": link, "results": results, "message": "Onay linki gönderildi." if any_ok else "Hiçbir kanaldan gönderilemedi."}

def _public_quote_view(q: Dict[str, Any], company: Dict[str, Any]) -> Dict[str, Any]:
    ap = q.get("approval") or {}
    return {"quote_number": q.get("quote_number"), "title": q.get("title"), "contact_name": q.get("contact_name"), "issue_date": q.get("issue_date"), "valid_until": q.get("valid_until"),
            "items": q.get("items", []), "subtotal": q.get("subtotal"), "vat_total": q.get("vat_total"), "grand_total": q.get("grand_total"), "notes": q.get("notes"), "terms": q.get("terms"),
            "payment_plan": q.get("payment_plan"), "images": q.get("images", []), "status": q.get("status"),
            "approval": {"status": ap.get("status", "pending"), "responded_at": ap.get("responded_at"), "responder_name": ap.get("responder_name"), "note": ap.get("note")},
            "company": {"name": company.get("name"), "phone": company.get("phone"), "email": company.get("email"), "address": company.get("address"), "city": company.get("city"), "logo_url": company.get("logo_url"), "tax_number": company.get("tax_number")},
            "is_expired": bool(q.get("valid_until")) and q.get("valid_until") < datetime.now(timezone.utc).strftime("%Y-%m-%d")}

@api_router.get("/public/quotes/{token}")
async def public_quote(token: str):
    q = await db.quotes.find_one({"approval.token": token})
    if not q:
        raise HTTPException(status_code=404, detail="Teklif bulunamadı veya link geçersiz.")
    company = await db.companies.find_one({"_id": q["company_id"]}) or {}
    await db.quotes.update_one({"_id": q["_id"]}, {"$set": {"approval.last_viewed_at": datetime.now(timezone.utc).isoformat()}, "$inc": {"approval.view_count": 1}})
    return _public_quote_view(q, company)

@api_router.post("/public/quotes/{token}/respond")
async def public_quote_respond(token: str, req: Dict[str, Any], request: Request):
    q = await db.quotes.find_one({"approval.token": token})
    if not q:
        raise HTTPException(status_code=404, detail="Teklif bulunamadı veya link geçersiz.")
    ap = q.get("approval") or {}
    if ap.get("status") in ("accepted", "rejected"):
        raise HTTPException(status_code=400, detail="Bu teklif için karar zaten verilmiş.")
    decision = req.get("decision")
    if decision not in ("accepted", "rejected"):
        raise HTTPException(status_code=400, detail="Karar 'accepted' veya 'rejected' olmalı.")
    name = (req.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Ad soyad zorunludur.")
    now = datetime.now(timezone.utc).isoformat()
    fwd = request.headers.get("x-forwarded-for", "")
    ip = fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else None)
    ap.update({"status": decision, "responded_at": now, "responder_name": name, "note": (req.get("note") or "").strip(), "ip": ip, "user_agent": request.headers.get("user-agent", "")[:200]})
    await db.quotes.update_one({"_id": q["_id"]}, {"$set": {"approval": ap, "status": decision}})
    await db.notifications.insert_one({"_id": str(uuid.uuid4()), "company_id": q["company_id"], "type": "quote_response", "title": f"{q.get('quote_number')} {'ONAYLANDI' if decision == 'accepted' else 'REDDEDİLDİ'}",
                                       "message": f"{q.get('contact_name')} ({name}) teklifi {'onayladı' if decision == 'accepted' else 'reddetti'}." + (f" Not: {ap['note']}" if ap.get("note") else ""),
                                       "ref_type": "quote", "ref_id": q["_id"], "is_read": False, "created_at": now})
    company = await db.companies.find_one({"_id": q["company_id"]}) or {}
    return {"status": "success", "message": "Teşekkürler, teklifi onayladınız. Firmamız en kısa sürede sizinle iletişime geçecek." if decision == "accepted" else "Geri bildiriminiz için teşekkürler. Teklif reddedildi olarak kaydedildi.", "quote": _public_quote_view({**q, "approval": ap, "status": decision}, company)}

@api_router.get("/notifications")
async def list_notifications(company_id: Optional[str] = "comp_nexus_main_01", unread_only: bool = False):
    query: Dict[str, Any] = {"company_id": company_id}
    if unread_only:
        query["is_read"] = False
    return clean_docs(await db.notifications.find(query).sort("created_at", -1).to_list(50))

@api_router.post("/notifications/{notif_id}/read")
async def read_notification(notif_id: str):
    await db.notifications.update_one({"_id": notif_id}, {"$set": {"is_read": True}})
    return {"status": "success"}

@api_router.get("/quotes/{quote_id}")
async def get_quote(quote_id: str):
    q = await db.quotes.find_one({"_id": quote_id})
    if not q:
        raise HTTPException(status_code=404, detail="Teklif bulunamadı.")
    return clean_doc(q)

@api_router.put("/quotes/{quote_id}")
async def update_quote(quote_id: str, req: Dict[str, Any]):
    q = await db.quotes.find_one({"_id": quote_id})
    if not q:
        raise HTTPException(status_code=404, detail="Teklif bulunamadı.")
    allowed = {k: v for k, v in req.items() if k in {"title", "items", "valid_until", "notes", "terms", "status", "contact_id", "contact_name", "images", "project_id"}}
    if "items" in allowed:
        allowed["subtotal"], allowed["vat_total"], allowed["grand_total"] = _calc_items(allowed["items"])
    await db.quotes.update_one({"_id": quote_id}, {"$set": allowed})
    return clean_doc(await db.quotes.find_one({"_id": quote_id}))

@api_router.delete("/quotes/{quote_id}")
async def delete_quote(quote_id: str):
    q = await db.quotes.find_one({"_id": quote_id})
    if not q:
        raise HTTPException(status_code=404, detail="Teklif bulunamadı.")
    await trash.soft_delete("quotes", q, "quote", f"{q.get('quote_number')} · {q.get('contact_name') or q.get('title')}")
    return {"status": "success", "message": "Teklif çöp kutusuna taşındı."}

@api_router.post("/quotes/{quote_id}/convert-to-invoice")
async def convert_quote_to_invoice(quote_id: str, req: Dict[str, Any] = None):
    q = await db.quotes.find_one({"_id": quote_id})
    if not q:
        raise HTTPException(status_code=404, detail="Teklif bulunamadı.")
    if q.get("invoice_id"):
        raise HTTPException(status_code=400, detail="Bu teklif zaten faturaya dönüştürülmüş.")
    req = req or {}
    inv_count = await db.invoices.count_documents({})
    items = [{"product_id": it.get("product_id"), "name": it.get("name"), "quantity": it.get("quantity"), "unit": it.get("unit", "Adet"), "unit_price": it.get("unit_price"),
              "vat_rate": it.get("vat_rate", 20), "discount_rate": it.get("discount_rate", 0), "total": it.get("total")} for it in q.get("items", [])]
    inv = {"_id": str(uuid.uuid4()), "company_id": q["company_id"], "invoice_number": f"NX{datetime.now(timezone.utc).year}{str(inv_count + 1).zfill(8)}", "contact_id": q.get("contact_id"),
           "contact_name": q.get("contact_name"), "invoice_type": "sales", "e_type": req.get("e_type", "e_archive"), "items": items, "subtotal": q["subtotal"], "vat_total": q["vat_total"],
           "grand_total": q["grand_total"], "currency": "TRY", "status": "draft", "gib_status": None, "payment_status": "unpaid", "paid_amount": 0,
           "issue_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "due_date": req.get("due_date"), "notes": f"{q['quote_number']} numaralı tekliften oluşturuldu.",
           "quote_id": quote_id, "created_at": datetime.now(timezone.utc).isoformat()}
    await db.invoices.insert_one(inv)
    if q.get("payment_plan"):
        await _create_invoice_installments(inv, q["payment_plan"].get("config", {}))
    if q.get("contact_id"):
        await db.contacts.update_one({"_id": q["contact_id"]}, {"$inc": {"balance": q["grand_total"]}})
    await db.quotes.update_one({"_id": quote_id}, {"$set": {"status": "accepted", "invoice_id": inv["_id"], "invoice_number": inv["invoice_number"]}})
    return {"status": "success", "invoice": clean_doc(inv), "message": f"{q['quote_number']} → {inv['invoice_number']} taslak fatura oluşturuldu."}

@api_router.get("/projects")
async def list_projects(company_id: Optional[str] = "comp_nexus_main_01"):
    projects = await db.projects.find({"company_id": company_id}).sort("created_at", -1).to_list(500)
    out = []
    for p in projects:
        quotes = await db.quotes.find({"project_id": p["_id"]}).to_list(100)
        p["quote_count"] = len(quotes)
        p["quoted_total"] = sum(q.get("grand_total", 0) for q in quotes)
        p["invoiced_total"] = sum(q.get("grand_total", 0) for q in quotes if q.get("invoice_id"))
        out.append(clean_doc(p))
    return out

@api_router.post("/projects")
async def create_project(req: Dict[str, Any]):
    doc = {"_id": str(uuid.uuid4()), "company_id": req.get("company_id", "comp_nexus_main_01"), "project_number": await _next_number("PRJ", db.projects), "name": req.get("name"),
           "contact_id": req.get("contact_id"), "contact_name": req.get("contact_name"), "status": req.get("status", "planning"), "budget": float(req.get("budget", 0) or 0),
           "start_date": req.get("start_date"), "end_date": req.get("end_date"), "description": req.get("description", ""), "address": req.get("address", ""),
           "latitude": req.get("latitude"), "longitude": req.get("longitude"), "location_url": req.get("location_url"),
           "images": [], "tasks": req.get("tasks", []), "created_at": datetime.now(timezone.utc).isoformat()}
    if not doc["name"]:
        raise HTTPException(status_code=400, detail="Proje adı gerekli.")
    await db.projects.insert_one(doc)
    return clean_doc(doc)

@api_router.put("/projects/{project_id}")
async def update_project(project_id: str, req: Dict[str, Any]):
    allowed = {k: v for k, v in req.items() if k in {"name", "contact_id", "contact_name", "status", "budget", "start_date", "end_date", "description", "address", "images", "tasks", "latitude", "longitude", "location_url"}}
    await db.projects.update_one({"_id": project_id}, {"$set": allowed})
    p = await db.projects.find_one({"_id": project_id})
    if not p:
        raise HTTPException(status_code=404, detail="Proje bulunamadı.")
    return clean_doc(p)

@api_router.delete("/projects/{project_id}")
async def delete_project(project_id: str):
    p = await db.projects.find_one({"_id": project_id})
    if not p:
        raise HTTPException(status_code=404, detail="Proje bulunamadı.")
    await trash.soft_delete("projects", p, "project", f"{p.get('project_number')} · {p.get('name')}")
    return {"status": "success", "message": "Proje çöp kutusuna taşındı."}

@api_router.get("/surveys")
async def list_surveys(company_id: Optional[str] = "comp_nexus_main_01"):
    return clean_docs(await db.surveys.find({"company_id": company_id}).sort("created_at", -1).to_list(500))

@api_router.post("/surveys")
async def create_survey(req: Dict[str, Any]):
    doc = {"_id": str(uuid.uuid4()), "company_id": req.get("company_id", "comp_nexus_main_01"), "survey_number": await _next_number("KSF", db.surveys), "contact_id": req.get("contact_id"),
           "contact_name": req.get("contact_name"), "address": req.get("address", ""), "survey_date": req.get("survey_date") or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
           "assigned_to": req.get("assigned_to", ""), "status": "planned", "notes": req.get("notes", ""), "measurements": req.get("measurements", []), "images": [],
           "latitude": req.get("latitude"), "longitude": req.get("longitude"), "location_url": req.get("location_url"),
           "project_id": req.get("project_id"), "quote_id": None, "created_at": datetime.now(timezone.utc).isoformat()}
    await db.surveys.insert_one(doc)
    return clean_doc(doc)

@api_router.put("/surveys/{survey_id}")
async def update_survey(survey_id: str, req: Dict[str, Any]):
    allowed = {k: v for k, v in req.items() if k in {"contact_id", "contact_name", "address", "survey_date", "assigned_to", "status", "notes", "measurements", "images", "project_id", "latitude", "longitude", "location_url"}}
    await db.surveys.update_one({"_id": survey_id}, {"$set": allowed})
    s = await db.surveys.find_one({"_id": survey_id})
    if not s:
        raise HTTPException(status_code=404, detail="Keşif bulunamadı.")
    return clean_doc(s)

@api_router.delete("/surveys/{survey_id}")
async def delete_survey(survey_id: str):
    s = await db.surveys.find_one({"_id": survey_id})
    if not s:
        raise HTTPException(status_code=404, detail="Keşif bulunamadı.")
    await trash.soft_delete("surveys", s, "survey", f"{s.get('survey_number')} · {s.get('contact_name') or s.get('address')}")
    return {"status": "success", "message": "Keşif çöp kutusuna taşındı."}

@api_router.post("/surveys/{survey_id}/convert-to-quote")
async def convert_survey_to_quote(survey_id: str):
    s = await db.surveys.find_one({"_id": survey_id})
    if not s:
        raise HTTPException(status_code=404, detail="Keşif bulunamadı.")
    items = [{"name": m.get("name") or "Kalem", "quantity": float(m.get("quantity", 1) or 1), "unit": m.get("unit", "Adet"), "unit_price": float(m.get("unit_price", 0) or 0), "vat_rate": 20, "discount_rate": 0}
             for m in s.get("measurements", [])] or [{"name": "Keşif sonrası işçilik/malzeme", "quantity": 1, "unit": "Adet", "unit_price": 0, "vat_rate": 20, "discount_rate": 0}]
    quote = await create_quote({"company_id": s["company_id"], "contact_id": s.get("contact_id"), "contact_name": s.get("contact_name"), "title": f"{s['survey_number']} keşfine dayalı teklif",
                                "items": items, "notes": s.get("notes", ""), "project_id": s.get("project_id"), "survey_id": survey_id})
    await db.quotes.update_one({"_id": quote["id"]}, {"$set": {"images": s.get("images", [])}})
    await db.surveys.update_one({"_id": survey_id}, {"$set": {"status": "quoted", "quote_id": quote["id"]}})
    return {"status": "success", "quote": quote, "message": f"{s['survey_number']} → {quote['quote_number']} teklif oluşturuldu."}

@api_router.post("/auth/register")
async def register(req: RegisterRequest, response: Response):
    email = req.email.strip().lower()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Bu e-posta adresi ile kayıtlı bir hesap zaten var.")

    company_id = f"comp_{uuid.uuid4().hex[:8]}"
    new_company = Company(
        id=company_id,
        name=req.company_name or "Yeni Şirketim",
        tax_number=req.tax_number or "1122334455",
        tax_office="Kadıköy V.D.",
        address="İstanbul, Türkiye",
        city="İstanbul",
        phone="0850 000 00 00",
        email=email
    )
    mongo = new_company.to_mongo()
    mongo["license_id"] = company_id
    await db.companies.insert_one(mongo)

    user_id = f"usr_{uuid.uuid4().hex[:8]}"
    new_user = User(
        id=user_id,
        email=email,
        password_hash=hash_password(req.password),
        name=req.name,
        role="admin",
        company_ids=[company_id],
        active_company_id=company_id
    )
    await db.users.insert_one(new_user.to_mongo())
    await saas.start_trial(company_id)

    token = create_access_token(user_id, email, "admin")
    return {
        "token": token,
        "user": {
            "id": user_id,
            "email": email,
            "name": req.name,
            "role": "admin",
            "company_ids": [company_id],
            "active_company_id": company_id
        }
    }

@api_router.get("/auth/me")
async def get_me(request: Request, user: dict = Depends(get_current_user)):
    user_id = str(user.get("_id", user.get("id")))
    authenticated = bool(request.cookies.get("access_token") or request.headers.get("Authorization", "").startswith("Bearer "))
    companies = await db.companies.find({"_id": {"$in": user.get("company_ids", []) or []}}).to_list(100)
    role_doc = await rbac.role_for(user)
    return {
        "user": {
            "id": user_id,
            "email": user["email"],
            "name": user["name"],
            "role": user.get("role", "admin"),
            "active_company_id": user.get("active_company_id", "comp_nexus_main_01"),
            "preferences": user.get("preferences", {}),
            "role_name": role_doc.get("name"), "permissions": role_doc.get("permissions", {}), "features": rbac.role_features(role_doc),
            "is_super_admin": bool(user.get("is_super_admin")),
        },
        "authenticated": authenticated,
        "impersonation": saas_extras.impersonation_info(request),
        "companies": clean_docs(companies),
        "license": await saas.effective(user.get("active_company_id", "comp_nexus_main_01")),
    }

@api_router.post("/auth/switch-company")
async def switch_company(req: Dict[str, str], user: dict = Depends(get_current_user)):
    new_comp_id = req.get("company_id")
    if not new_comp_id:
        raise HTTPException(status_code=400, detail="Şirket ID gereklidir.")
    if new_comp_id not in (user.get("company_ids") or []):
        raise HTTPException(status_code=403, detail="Bu şirket hesabına erişiminiz yok.")
    await db.users.update_one({"email": user["email"]}, {"$set": {"active_company_id": new_comp_id}})
    return {"status": "success", "active_company_id": new_comp_id}

@api_router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token")
    response.delete_cookie("refresh_token")
    return {"status": "success", "message": "Çıkış yapıldı."}

class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str

async def require_token_user(request: Request) -> dict:
    """Authenticated user only — no demo-admin fallback."""
    auth_header = request.headers.get("Authorization", "")
    token = auth_header[7:] if auth_header.startswith("Bearer ") else request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Giriş yapmanız gerekiyor.")
    return await get_user_from_token(token, db)

@api_router.post("/auth/change-password")
async def change_password(req: ChangePasswordRequest, request: Request):
    user = await require_token_user(request)
    uid = user.get("_id") or user.get("id")
    raw = await db.users.find_one({"_id": uid}) or await db.users.find_one({"email": user.get("email")})
    if not raw:
        raise HTTPException(status_code=401, detail="Kullanıcı bulunamadı.")
    if not verify_password(req.current_password, raw.get("password_hash", "")):
        raise HTTPException(status_code=400, detail="Mevcut şifre hatalı.")
    new_pw = (req.new_password or "").strip()
    if len(new_pw) < 6:
        raise HTTPException(status_code=400, detail="Yeni şifre en az 6 karakter olmalı.")
    if verify_password(new_pw, raw.get("password_hash", "")):
        raise HTTPException(status_code=400, detail="Yeni şifre mevcut şifreyle aynı olamaz.")
    await db.users.update_one(
        {"_id": raw["_id"]},
        {"$set": {"password_hash": hash_password(new_pw), "password_changed_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"status": "success", "message": "Şifreniz güncellendi."}

# ----------------- DASHBOARD & KPIS -----------------
@api_router.get("/dashboard/overview")
async def dashboard_overview(company_id: str = "comp_nexus_main_01"):
    now = datetime.now(timezone.utc)
    today = now.strftime("%Y-%m-%d"); month = now.strftime("%Y-%m")
    week_start = (now - timedelta(days=now.weekday())).strftime("%Y-%m-%d")
    invs = await db.invoices.find({"company_id": company_id, "invoice_type": {"$in": ["sales", "purchase"]}}, {"invoice_type": 1, "status": 1, "payment_status": 1, "grand_total": 1, "paid_amount": 1, "due_date": 1, "issue_date": 1, "vat_total": 1, "created_at": 1}).to_list(20000)
    def bucket(t):
        tot = over = notdue = 0.0
        for i in invs:
            if i.get("invoice_type") != t or i.get("status") == "draft" or i.get("payment_status") == "paid":
                continue
            open_amt = float(i.get("grand_total", 0)) - float(i.get("paid_amount", 0) or 0)
            if open_amt <= 0:
                continue
            tot += open_amt
            if i.get("due_date") and i["due_date"] < today:
                over += open_amt
            else:
                notdue += open_amt
        return {"total": round(tot, 2), "overdue": round(over, 2), "not_due": round(notdue, 2)}
    def counts(t):
        rows = [i for i in invs if i.get("invoice_type") == t and i.get("status") != "draft"]
        return {"month": sum(1 for i in rows if (i.get("issue_date") or "") >= f"{month}-01"), "week": sum(1 for i in rows if (i.get("issue_date") or "") >= week_start), "today": sum(1 for i in rows if i.get("issue_date") == today)}
    drafts = [i for i in invs if i.get("status") == "draft"]
    sales_vat = round(sum(float(i.get("vat_total", 0)) for i in invs if i.get("invoice_type") == "sales" and i.get("status") != "draft" and (i.get("issue_date") or "").startswith(month)), 2)
    purch_vat = round(sum(float(i.get("vat_total", 0)) for i in invs if i.get("invoice_type") == "purchase" and i.get("status") != "draft" and (i.get("issue_date") or "").startswith(month)), 2)
    exp_vat = round(sum([e.get("vat_amount", 0) async for e in db.expenses.find({"company_id": company_id, "date": {"$regex": f"^{month}"}}, {"vat_amount": 1})]), 2)
    nxt = (now.replace(day=1) + timedelta(days=32)).replace(day=26)
    inst_today = await db.installments.count_documents({"company_id": company_id, "status": {"$ne": "paid"}, "due_date": today})
    inst_overdue = await db.installments.count_documents({"company_id": company_id, "status": {"$ne": "paid"}, "due_date": {"$lt": today}})
    tasks = [
        {"key": "pending_orders", "label": "Onay bekleyen sipariş", "count": await db.orders.count_documents({"company_id": company_id, "order_status": "pending"}), "path": "/orders"},
        {"key": "due_today", "label": "Bugün vadesi gelen fatura", "count": sum(1 for i in invs if i.get("due_date") == today and i.get("payment_status") != "paid" and i.get("status") != "draft"), "path": "/invoices"},
        {"key": "overdue", "label": "Vadesi geçmiş tahsilat", "count": sum(1 for i in invs if i.get("invoice_type") == "sales" and (i.get("due_date") or "9") < today and i.get("payment_status") != "paid" and i.get("status") != "draft"), "path": "/invoices"},
        {"key": "installments", "label": "Bugün vadeli taksit", "count": inst_today, "extra": f"{inst_overdue} gecikmiş" if inst_overdue else None, "path": "/installments"},
        {"key": "cheques", "label": "Vadesi gelen çek/senet", "count": await db.cheques.count_documents({"company_id": company_id, "status": "open", "due_date": {"$lte": today}}), "path": "/cheques"},
        {"key": "drafts", "label": "Taslak fatura", "count": len(drafts), "path": "/invoices"},
        {"key": "quotes", "label": "Onay bekleyen teklif", "count": await db.quotes.count_documents({"company_id": company_id, "status": {"$in": ["sent", "pending", "draft"]}}), "path": "/quotes"},
        {"key": "critical_stock", "label": "Kritik stok", "count": len([p for p in await db.products.find({"company_id": company_id, "track_stock": {"$ne": False}}, {"stock_quantity": 1, "min_stock_alert": 1}).to_list(5000) if (p.get("stock_quantity") or 0) <= (p.get("min_stock_alert") or 0)]), "path": "/stock"},
        {"key": "leaves", "label": "Bekleyen izin talebi", "count": await db.leave_requests.count_documents({"company_id": company_id, "status": "pending"}), "path": "/personnel"},
    ]
    budgets = await expenses.get_budgets(company_id)
    return {"date": today, "tasks": [t for t in tasks if t["count"]], "collections": bucket("sales"), "payments": bucket("purchase"),
            "drafts": {"count": len(drafts), "total": round(sum(float(i.get("grand_total", 0)) for i in drafts), 2)},
            "invoices": {"incoming": counts("purchase"), "outgoing": counts("sales")},
            "vat": {"month": month, "calculated": sales_vat, "deductible": round(purch_vat + exp_vat, 2), "payable": round(sales_vat - purch_vat - exp_vat, 2), "declaration_date": nxt.strftime("%Y-%m-%d"), "days_left": (nxt.date() - now.date()).days},
            "budget_warnings": budgets["warnings"]}

@api_router.get("/dashboard/stats")
async def get_dashboard_stats(company_id: Optional[str] = "comp_nexus_main_01"):
    bank_accs = await db.bank_accounts.find({"company_id": company_id}).to_list(100)
    total_bank_balance = sum(acc.get("current_balance", 0) for acc in bank_accs)

    contacts = await db.contacts.find({"company_id": company_id}).to_list(500)
    total_receivables = sum(c.get("balance", 0) for c in contacts if c.get("balance", 0) > 0)
    total_payables = abs(sum(c.get("balance", 0) for c in contacts if c.get("balance", 0) < 0))

    invoices = await db.invoices.find({"company_id": company_id}).to_list(500)
    sales_total = sum(inv.get("grand_total", 0) for inv in invoices if inv.get("invoice_type") == "sales")
    purchase_total = sum(inv.get("grand_total", 0) for inv in invoices if inv.get("invoice_type") == "purchase")

    orders = await db.orders.find({"company_id": company_id}).to_list(500)
    pending_orders = [o for o in orders if o.get("order_status") in ["pending", "approved", "preparing"]]

    products = await db.products.find({"company_id": company_id}).to_list(500)
    low_stock = [p for p in products if p.get("stock_quantity", 0) <= p.get("min_stock_alert", 5)]
    total_stock_value = sum(p.get("stock_quantity", 0) * p.get("purchase_price", 0) for p in products)

    chart_data = [
        {"month": "Oca", "gelir": 142000, "gider": 89000, "net": 53000},
        {"month": "Şub", "gelir": 168000, "gider": 94000, "net": 74000},
        {"month": "Mar", "gelir": 195000, "gider": 110000, "net": 85000},
        {"month": "Nis", "gelir": 230000, "gider": 125000, "net": 105000},
        {"month": "May", "gelir": 284000, "gider": 142000, "net": 142000},
        {"month": "Haz (Güncel)", "gelir": sales_total or 310000, "gider": purchase_total or 158000, "net": (sales_total or 310000) - (purchase_total or 158000)}
    ]

    channels_breakdown = [
        {"name": "Trendyol", "value": 42, "color": "#f97316"},
        {"name": "Hepsiburada", "value": 26, "color": "#ea580c"},
        {"name": "B2B Bayi Portalı", "value": 20, "color": "#3b82f6"},
        {"name": "Shopify / Doğrudan", "value": 12, "color": "#10b981"}
    ]

    return {
        "total_bank_balance": total_bank_balance,
        "total_receivables": total_receivables,
        "total_payables": total_payables,
        "monthly_sales": sales_total,
        "monthly_expenses": purchase_total,
        "net_profit": sales_total - purchase_total,
        "pending_orders_count": len(pending_orders),
        "low_stock_count": len(low_stock),
        "total_stock_value": total_stock_value,
        "chart_data": chart_data,
        "channels_breakdown": channels_breakdown,
        "recent_invoices": clean_docs(invoices[-5:]),
        "recent_orders": clean_docs(orders[-5:]),
        "low_stock_products": clean_docs(low_stock[:5])
    }

# ----------------- CARİLER (MÜŞTERİ & TEDARİKÇİ) -----------------
@api_router.get("/contacts")
async def list_contacts(company_id: Optional[str] = "comp_nexus_main_01", type: Optional[str] = None):
    query = {"company_id": company_id}
    if type and type != "all":
        query["type"] = type
    contacts = await db.contacts.find(query).to_list(10000)
    return clean_docs(contacts)

@api_router.post("/contacts")
async def create_contact(contact: Contact):
    doc = contact.to_mongo()
    await db.contacts.insert_one(doc)
    return clean_doc(doc)

@api_router.get("/search")
async def global_search(q: str, company_id: str = "comp_nexus_main_01"):
    q = (q or "").strip()
    if len(q) < 2:
        return {"contacts": [], "products": [], "orders": [], "invoices": []}
    rx = {"$regex": re.escape(q), "$options": "i"}
    contacts = await db.contacts.find({"company_id": company_id, "$or": [{"name": rx}, {"tax_number_or_id": rx}, {"phone": rx}, {"email": rx}]}, {"name": 1, "tax_number_or_id": 1, "balance": 1, "type": 1}).limit(6).to_list(6)
    products = await db.products.find({"company_id": company_id, "$or": [{"name": rx}, {"sku": rx}, {"barcode": rx}]}, {"name": 1, "sku": 1, "stock_quantity": 1, "sale_price": 1}).limit(6).to_list(6)
    orders = await db.orders.find({"company_id": company_id, "$or": [{"order_number": rx}, {"customer_name": rx}, {"cargo_tracking_number": rx}]}, {"order_number": 1, "customer_name": 1, "total_amount": 1, "order_status": 1}).sort("order_date", -1).limit(6).to_list(6)
    invoices = await db.invoices.find({"company_id": company_id, "$or": [{"invoice_number": rx}, {"contact_name": rx}]}, {"invoice_number": 1, "contact_name": 1, "grand_total": 1, "invoice_type": 1}).sort("issue_date", -1).limit(6).to_list(6)
    return {"contacts": clean_docs(contacts), "products": clean_docs(products), "orders": clean_docs(orders), "invoices": clean_docs(invoices)}

@api_router.put("/contacts/{contact_id}")
async def update_contact(contact_id: str, updated: Dict[str, Any]):
    updated = {k: v for k, v in updated.items() if k not in ("id", "_id", "company_id", "balance", "b2b_token", "b2b_password_hash", "created_at")}
    if updated.get("b2b_password"):
        updated["b2b_password_hash"] = hash_password(str(updated.pop("b2b_password")))
    else:
        updated.pop("b2b_password", None)
    await db.contacts.update_one({"_id": contact_id}, {"$set": updated})
    res = await db.contacts.find_one({"_id": contact_id})
    return clean_doc(res)

@api_router.delete("/contacts/{contact_id}")
async def delete_contact(contact_id: str):
    c = await db.contacts.find_one({"_id": contact_id})
    if not c:
        raise HTTPException(status_code=404, detail="Cari hesap bulunamadı.")
    await trash.soft_delete("contacts", c, "contact", c.get("name"), note=f"Bakiye: {float(c.get('balance') or 0):,.2f} ₺")
    return {"status": "success", "message": "Cari çöp kutusuna taşındı."}

@api_router.get("/contacts/{contact_id}/statement")
async def get_contact_statement(contact_id: str):
    contact = await db.contacts.find_one({"_id": contact_id})
    if not contact:
        raise HTTPException(status_code=404, detail="Cari hesap bulunamadı.")
    
    invoices = await db.invoices.find({"contact_id": contact_id}).to_list(100)
    payments = await db.bank_transactions.find({"contact_id": contact_id}).to_list(100)
    
    return {
        "contact": clean_doc(contact),
        "invoices": clean_docs(invoices),
        "payments": clean_docs(payments)
    }

# ---- B2B Müşteri Portalı
PUBLIC_TRACKING_URLS = {
    "yurtici": "https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code={n}", "aras": "https://kargotakip.araskargo.com.tr/mainpage.aspx?code={n}",
    "mng": "https://kargotakip.mngkargo.com.tr/?takipNo={n}", "ptt": "https://gonderitakip.ptt.gov.tr/Track/Verify?q={n}", "surat": "https://suratkargo.com.tr/KargoTakip/?kargotakipno={n}",
    "hepsijet": "https://www.hepsijet.com/gonderi-takibi/{n}", "trendyolexpress": "https://www.trendyolexpress.com/kargo-takip?trackingNumber={n}", "ups": "https://www.ups.com/track?loc=tr_TR&tracknum={n}",
}
SHIPMENT_STEPS = ["created", "picked_up", "in_transit", "out_for_delivery", "delivered"]

def _b2b_tracking(o: dict, sh: Optional[dict]) -> Optional[dict]:
    """Portal için canlı kargo bilgisi: takip linki, durum adımı ve tahmini teslim."""
    num = (sh or {}).get("tracking_number") or o.get("cargo_tracking_number")
    if not num and o.get("order_status") not in ("shipped", "delivered"):
        return None
    carrier = (sh or {}).get("carrier_code") or o.get("cargo_carrier") or ""
    url = (sh or {}).get("tracking_url") or o.get("cargo_tracking_url") or (PUBLIC_TRACKING_URLS.get(carrier, "").format(n=num) if num else None)
    status = (sh or {}).get("status") or ("delivered" if o.get("order_status") == "delivered" else "in_transit" if num else "created")
    eta = (sh or {}).get("estimated_delivery")
    shipped_at = ((sh or {}).get("created_at") or o.get("updated_at") or o.get("order_date") or "")[:10]
    if not eta and status != "delivered" and shipped_at:
        try:
            eta = (datetime.strptime(shipped_at, "%Y-%m-%d") + timedelta(days=3)).strftime("%Y-%m-%d")
        except ValueError:
            eta = None
    today = datetime.now(timezone.utc).astimezone(ZoneInfo("Europe/Istanbul")).strftime("%Y-%m-%d")
    return {"carrier": (sh or {}).get("carrier_name") or carrier or None, "tracking_number": num, "tracking_url": url, "status": status,
            "step": SHIPMENT_STEPS.index(status) if status in SHIPMENT_STEPS else (0 if status != "returned" else -1), "steps": SHIPMENT_STEPS,
            "estimated_delivery": eta, "delivered_at": (sh or {}).get("delivered_at"), "shipped_at": shipped_at or None,
            "is_late": bool(eta and status != "delivered" and eta < today), "events": ((sh or {}).get("events") or [])[-5:]}

@api_router.post("/contacts/{contact_id}/b2b-access")
async def contact_b2b_access(contact_id: str, req: Dict[str, Any]):
    c = await db.contacts.find_one({"_id": contact_id})
    if not c:
        raise HTTPException(status_code=404, detail="Cari hesap bulunamadı.")
    token = c.get("b2b_token") or uuid.uuid4().hex
    upd = {"b2b_token": token, "b2b_enabled": bool(req.get("enabled", True)), "b2b_discount": float(req.get("discount", c.get("b2b_discount", 0)) or 0)}
    if req.get("regenerate"):
        upd["b2b_token"] = token = uuid.uuid4().hex
    if req.get("password"):
        if len(str(req["password"])) < 6:
            raise HTTPException(status_code=400, detail="B2B şifresi en az 6 karakter olmalı.")
        upd["b2b_password_hash"] = hash_password(str(req["password"]))
    if req.get("login_email"):
        upd["b2b_login_email"] = str(req["login_email"]).strip().lower()
    await db.contacts.update_one({"_id": contact_id}, {"$set": upd})
    base = (req.get("base_url") or "").rstrip("/")
    return {**{k: v for k, v in upd.items() if k != "b2b_password_hash"}, "has_password": bool(upd.get("b2b_password_hash") or c.get("b2b_password_hash")), "link": f"{base}/portal/{token}", "login_url": f"{base}/b2b/giris"}


async def _b2b_find_contact(ident: str) -> Optional[dict]:
    ident = (ident or "").strip().lower()
    if not ident:
        return None
    return await db.contacts.find_one({"b2b_enabled": True, "$or": [{"b2b_login_email": ident}, {"email": {"$regex": f"^{re.escape(ident)}$", "$options": "i"}}, {"tax_number_or_id": ident}]})


async def _public_base_url(request: Request, explicit: str = "") -> str:
    base = (explicit or "").rstrip("/")
    if base:
        return base
    st = await db.platform_settings.find_one({"_id": "platform"}) or {}
    base = (st.get("public_url") or os.environ.get("PUBLIC_APP_URL") or "").rstrip("/")
    if not base:
        base = str(request.headers.get("origin") or "").rstrip("/")
    return base


@api_router.post("/public/b2b/login")
async def b2b_login(req: Dict[str, Any]):
    ident = (req.get("email") or "").strip().lower(); pwd = req.get("password") or ""
    if not ident or not pwd:
        raise HTTPException(status_code=400, detail="E-posta / VKN ve şifre gerekli.")
    c = await _b2b_find_contact(ident)
    if not c or not c.get("b2b_password_hash") or not verify_password(pwd, c["b2b_password_hash"]):
        raise HTTPException(status_code=401, detail="Bilgiler hatalı ya da B2B erişiminiz tanımlı değil. Tedarikçinizle iletişime geçin.")
    if not c.get("b2b_token"):
        await db.contacts.update_one({"_id": c["_id"]}, {"$set": {"b2b_token": uuid.uuid4().hex}})
        c = await db.contacts.find_one({"_id": c["_id"]})
    await db.contacts.update_one({"_id": c["_id"]}, {"$set": {"b2b_last_login": datetime.now(timezone.utc).isoformat()}})
    return {"token": c["b2b_token"], "name": c.get("name"), "redirect": f"/portal/{c['b2b_token']}"}


FORGOT_MSG = "Eşleşen bir B2B hesabı varsa şifre sıfırlama bağlantısı e-posta adresine gönderildi."


@api_router.post("/public/b2b/forgot-password")
async def b2b_forgot_password(req: Dict[str, Any], request: Request):
    ident = (req.get("email") or "").strip()
    out = {"status": "ok", "message": FORGOT_MSG, "mail_status": "skipped"}
    c = await _b2b_find_contact(ident)
    if not c or not c.get("b2b_password_hash"):
        return out
    to = (c.get("b2b_login_email") or c.get("email") or "").strip().lower()
    if not to or "@" not in to:
        out["mail_status"] = "skipped"
        out["detail"] = "Bu hesapta e-posta yok; tedarikçinizden şifre isteyin."
        return out
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    await db.b2b_password_resets.update_many({"contact_id": c["_id"], "used_at": None}, {"$set": {"used_at": now.isoformat(), "revoked": True}})
    await db.b2b_password_resets.insert_one({
        "_id": token, "contact_id": c["_id"], "company_id": c["company_id"], "email": to,
        "expires_at": (now + timedelta(hours=1)).isoformat(), "used_at": None, "created_at": now.isoformat(),
    })
    base = await _public_base_url(request, req.get("base_url") or "")
    link = f"{base}/b2b/sifre/{token}" if base else f"/b2b/sifre/{token}"
    company = await db.companies.find_one({"_id": c["company_id"]}) or {}
    mail_status, mail_detail = "skipped", "E-posta hesabı tanımlı değil."
    try:
        a = await _mail_account(c["company_id"])
        subject = f"{company.get('name') or 'Tedarikçiniz'} B2B şifre sıfırlama"
        body = f"Merhaba {c.get('name') or ''},\nB2B portal şifrenizi sıfırlamak için bu bağlantıyı 1 saat içinde kullanın:\n{link}\nBu isteği siz yapmadıysanız bu e-postayı yok sayın."
        html = f"<p>Merhaba {c.get('name') or ''},</p><p>B2B portal şifrenizi sıfırlamak için aşağıdaki düğmeye tıklayın. Bağlantı 1 saat geçerlidir.</p><p><a href='{link}' style='background:#059669;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:bold'>Şifreyi Sıfırla</a></p>"
        await comm_service.smtp_send(a, [to], subject, body, html=html)
        mail_status, mail_detail = "sent", f"{to} adresine gönderildi."
    except HTTPException as e:
        mail_status, mail_detail = "skipped", str(e.detail)
    except Exception as e:
        mail_status, mail_detail = "failed", str(e)[:140]
    out["mail_status"] = mail_status
    out["detail"] = mail_detail
    if mail_status != "sent":
        out["reset_url"] = link
        out["reset_token"] = token
    return out


@api_router.get("/public/b2b/reset/{token}")
async def b2b_reset_get(token: str):
    row = await _b2b_reset_doc(token)
    c = await db.contacts.find_one({"_id": row["contact_id"]}) or {}
    email = row.get("email") or c.get("b2b_login_email") or c.get("email") or ""
    masked = (email[:2] + "•••@" + email.split("@", 1)[-1]) if "@" in email else ""
    return {"valid": True, "name": c.get("name"), "email_masked": masked}


@api_router.post("/public/b2b/reset/{token}")
async def b2b_reset_post(token: str, req: Dict[str, Any]):
    row = await _b2b_reset_doc(token)
    pwd = str(req.get("password") or "")
    if len(pwd) < 6:
        raise HTTPException(status_code=400, detail="Şifre en az 6 karakter olmalı.")
    c = await db.contacts.find_one({"_id": row["contact_id"]})
    if not c or not c.get("b2b_enabled"):
        raise HTTPException(status_code=404, detail="B2B erişimi bulunamadı veya kapatılmış.")
    if not c.get("b2b_token"):
        await db.contacts.update_one({"_id": c["_id"]}, {"$set": {"b2b_token": uuid.uuid4().hex}})
        c = await db.contacts.find_one({"_id": c["_id"]})
    await db.contacts.update_one({"_id": c["_id"]}, {"$set": {"b2b_password_hash": hash_password(pwd)}})
    await db.b2b_password_resets.update_one({"_id": token}, {"$set": {"used_at": datetime.now(timezone.utc).isoformat()}})
    return {"status": "success", "message": "Şifreniz güncellendi.", "redirect": f"/portal/{c['b2b_token']}", "token": c["b2b_token"], "name": c.get("name")}


async def _b2b_reset_doc(token: str) -> dict:
    row = await db.b2b_password_resets.find_one({"_id": token})
    if not row:
        raise HTTPException(status_code=404, detail="Sıfırlama bağlantısı geçersiz.")
    if row.get("used_at"):
        raise HTTPException(status_code=400, detail="Bu bağlantı zaten kullanılmış. Yeni istek oluşturun.")
    exp = row.get("expires_at") or ""
    try:
        exp_dt = datetime.fromisoformat(exp.replace("Z", "+00:00"))
        if exp_dt.tzinfo is None:
            exp_dt = exp_dt.replace(tzinfo=timezone.utc)
        if exp_dt < datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="Sıfırlama bağlantısının süresi doldu.")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="Sıfırlama bağlantısı geçersiz.")
    return row


def _alias_key(s: str) -> str:
    t = (s or "").strip().lower().replace("ı", "i").replace("İ", "i")
    t = t.replace("ş", "s").replace("ğ", "g").replace("ü", "u").replace("ö", "o").replace("ç", "c")
    t = re.sub(r"[^a-z0-9]+", " ", t)
    return re.sub(r"\s+", " ", t).strip()


async def _b2b_match_cart_items(company_id: str, lines: list) -> tuple:
    import difflib
    prods = await db.products.find({"company_id": company_id, "show_in_b2b": {"$ne": False}, "type": {"$ne": "raw_material"}}, {"name": 1, "sku": 1, "barcode": 1}).to_list(5000)
    idx = {str(k).lower(): p for p in prods for k in (p.get("sku"), p.get("barcode")) if k}
    names = {p["name"].lower(): p for p in prods if p.get("name")}
    by_id = {p["_id"]: p for p in prods}
    aliases = {r["alias"]: r["product_id"] for r in await db.b2b_product_aliases.find({"company_id": company_id}).to_list(5000) if r.get("alias") and r.get("product_id")}
    items, unmatched = [], []
    used_aliases = []
    for it in lines or []:
        qty = max(1, int(float(it.get("quantity") or 1)))
        requested = it.get("product_name") or it.get("sku") or it.get("barcode") or "?"
        p = idx.get(str(it.get("barcode") or "").lower()) or idx.get(str(it.get("sku") or "").lower())
        conf, learned = (1.0, False) if p else (0.0, False)
        if not p:
            ak = _alias_key(requested)
            pid = aliases.get(ak)
            if pid and pid in by_id:
                p = by_id[pid]
                conf, learned = 0.99, True
                used_aliases.append(ak)
        if not p and it.get("product_name"):
            q = it["product_name"].lower()
            p = names.get(q)
            if p:
                conf = 0.95
            else:
                best = difflib.get_close_matches(q, list(names.keys()), n=1, cutoff=0.55)
                if best:
                    p = names[best[0]]
                    conf = round(difflib.SequenceMatcher(None, q, best[0]).ratio(), 2)
        row = {"requested": requested, "quantity": qty, "product_id": p["_id"] if p else None, "matched_name": p.get("name") if p else None, "confidence": conf, "learned": learned}
        (items if p else unmatched).append(row)
    if used_aliases:
        await db.b2b_product_aliases.update_many({"company_id": company_id, "alias": {"$in": used_aliases}}, {"$inc": {"hits": 1}})
    return items, unmatched


@api_router.post("/public/b2b/{token}/ai-cart")
async def b2b_ai_cart(token: str, file: UploadFile = File(...)):
    c = await _b2b_contact(token)
    b2b_st = {**B2B_DEFAULTS, **((await db.companies.find_one({"_id": c["company_id"]}, {"b2b_settings": 1}) or {}).get("b2b_settings") or {})}
    if b2b_st.get("allow_ai_cart") is False:
        raise HTTPException(status_code=403, detail="AI sepet özelliği bu portalda kapalı.")
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Dosya en fazla 10 MB olabilir.")
    text = await _file_to_text(file, data)
    if len(text.strip()) < 10:
        raise HTTPException(status_code=400, detail="Dosyada okunabilir metin bulunamadı (taranmış PDF olabilir).")
    try:
        parsed = await ai_service_extract_orders(text)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"AI çıkarımı başarısız: {str(e)[:140]}")
    parsed_items = [it for o in (parsed.get("orders") or []) for it in (o.get("items") or [])]
    items, unmatched = await _b2b_match_cart_items(c["company_id"], parsed_items)
    return {"filename": file.filename, "items": items, "unmatched": unmatched, "total_lines": len(items) + len(unmatched)}


@api_router.post("/public/b2b/{token}/ai-cart/match")
async def b2b_ai_cart_match(token: str, req: Dict[str, Any]):
    c = await _b2b_contact(token)
    items, unmatched = await _b2b_match_cart_items(c["company_id"], req.get("items") or [])
    return {"items": items, "unmatched": unmatched, "total_lines": len(items) + len(unmatched)}


@api_router.post("/public/b2b/{token}/ai-cart/learn")
async def b2b_ai_cart_learn(token: str, req: Dict[str, Any]):
    c = await _b2b_contact(token)
    now = datetime.now(timezone.utc).isoformat()
    saved = []
    for m in (req.get("mappings") or []):
        alias = _alias_key(m.get("alias") or m.get("requested") or "")
        pid = m.get("product_id")
        if not alias or not pid:
            continue
        p = await db.products.find_one({"_id": pid, "company_id": c["company_id"]})
        if not p:
            continue
        await db.b2b_product_aliases.update_one(
            {"company_id": c["company_id"], "alias": alias},
            {"$set": {"product_id": pid, "product_name": p.get("name"), "alias_raw": m.get("alias") or m.get("requested"), "contact_id": c["_id"], "updated_at": now},
             "$setOnInsert": {"_id": f"als_{uuid.uuid4().hex[:12]}", "company_id": c["company_id"], "alias": alias, "created_at": now, "hits": 0}},
            upsert=True,
        )
        saved.append({"alias": alias, "product_id": pid, "product_name": p.get("name")})
    return {"saved": saved, "count": len(saved)}

def _b2b_gross(amount, vat_rate, includes_vat) -> float:
    n = round(float(amount or 0), 2)
    if includes_vat:
        return n
    return round(n * (1 + float(vat_rate or 0) / 100), 2)


def _b2b_catalog_product(p: Dict[str, Any], disc: float) -> Dict[str, Any]:
    sale = round(float(p.get("sale_price", 0) or 0), 2)
    price = round(sale * (1 - float(disc or 0) / 100), 2)
    vat = p.get("vat_rate", 20)
    includes = bool(p.get("price_includes_vat"))
    track = p.get("track_stock", True)
    qty = float(p.get("stock_quantity", 0) or 0)
    return {
        "id": p["_id"],
        "name": p.get("name"),
        "sku": p.get("sku"),
        "category": p.get("category"),
        "unit": p.get("unit"),
        "image_url": p.get("image_url"),
        "list_price": sale,
        "price": price,
        "list_price_gross": _b2b_gross(sale, vat, includes),
        "price_gross": _b2b_gross(price, vat, includes),
        "price_includes_vat": includes,
        "vat_rate": vat,
        "in_stock": (qty > 0) if track else True,
        "stock_quantity": qty if track else None,
    }


async def _b2b_contact(token: str) -> Dict[str, Any]:
    c = await db.contacts.find_one({"b2b_token": token})
    if not c or not c.get("b2b_enabled", False):
        raise HTTPException(status_code=404, detail="B2B erişimi bulunamadı veya kapatılmış.")
    return c

async def _b2b_build_items(contact: Dict[str, Any], raw_items: list) -> List[OrderItem]:
    disc = float(contact.get("b2b_discount", 0) or 0)
    items: List[OrderItem] = []
    for it in raw_items or []:
        p = await db.products.find_one({"_id": it.get("product_id"), "company_id": contact["company_id"]})
        q = float(it.get("quantity", 0) or 0)
        if not p or q <= 0:
            continue
        price = round(float(p.get("sale_price", 0)) * (1 - disc / 100), 2)
        vat_rate = float(p.get("vat_rate", 20) or 0)
        includes = bool(p.get("price_includes_vat"))
        line_note = str(it.get("note") or it.get("line_note") or "").strip()[:500]
        items.append(OrderItem(
            product_id=p["_id"], product_name=p.get("name"), sku=p.get("sku", ""),
            quantity=int(q), unit_price=price, total=round(price * q, 2),
            vat_rate=vat_rate, note=line_note or None, price_includes_vat=includes,
        ))
    return items

async def _b2b_owned_order(token: str, order_id: str) -> tuple:
    c = await _b2b_contact(token)
    o = await db.orders.find_one({"_id": order_id, "company_id": c["company_id"]})
    if not o:
        raise HTTPException(status_code=404, detail="Sipariş bulunamadı.")
    if o.get("contact_id") != c["_id"] and o.get("customer_name") != c.get("name"):
        raise HTTPException(status_code=404, detail="Sipariş bulunamadı.")
    return c, o

async def _notify_company(company_id: str, typ: str, title: str, message: str, ref_id: str):
    await db.notifications.insert_one({
        "_id": str(uuid.uuid4()), "company_id": company_id, "type": typ, "title": title, "message": message,
        "ref_type": "order", "ref_id": ref_id, "is_read": False, "created_at": datetime.now(timezone.utc).isoformat(),
    })

@api_router.get("/public/b2b/{token}")
async def b2b_portal(token: str):
    c = await _b2b_contact(token)
    company = await db.companies.find_one({"_id": c["company_id"]}) or {}
    bs = {**B2B_DEFAULTS, **(company.get("b2b_settings") or {})}
    if not bs.get("enabled", True):
        raise HTTPException(status_code=404, detail="B2B portalı şu an kapalı.")
    disc = float(c.get("b2b_discount", 0) or bs.get("default_discount", 0) or 0)
    prods = await db.products.find({"company_id": c["company_id"], "show_in_b2b": {"$ne": False}, "type": {"$ne": "raw_material"}}).to_list(5000)
    products = [_b2b_catalog_product(p, disc) for p in prods]
    if not bs.get("show_prices", True):
        products = [{**p, "price": None, "list_price": None, "price_gross": None, "list_price_gross": None} for p in products]
    orders = clean_docs(await db.orders.find({"company_id": c["company_id"], "$or": [{"contact_id": c["_id"]}, {"customer_name": c.get("name")}]}).sort("order_date", -1).to_list(200))
    shipments = {sh["order_id"]: sh for sh in await db.cargo_shipments.find({"order_id": {"$in": [o["id"] for o in orders]}}).sort("created_at", 1).to_list(500)}
    for o in orders:
        o["tracking"] = _b2b_tracking(o, shipments.get(o["id"]))
    invoices = [{"invoice_number": i.get("invoice_number"), "issue_date": i.get("issue_date"), "due_date": i.get("due_date"), "grand_total": i.get("grand_total"), "paid_amount": i.get("paid_amount", 0), "payment_status": i.get("payment_status"), "e_type": i.get("e_type")} for i in await db.invoices.find({"contact_id": c["_id"], "status": {"$nin": ["cancelled", "draft"]}}).sort("issue_date", -1).to_list(100)]
    insts = [_decorate_installment(x) for x in await db.installments.find({"contact_id": c["_id"], "status": {"$ne": "paid"}}).sort("due_date", 1).to_list(100)]
    return {"contact": {"name": c.get("name"), "balance": c.get("balance", 0), "discount": disc, "phone": c.get("phone"), "email": c.get("email"), "address": c.get("address"), "city": c.get("city"), "has_password": bool(c.get("b2b_password_hash"))},
            "company": {"name": company.get("name"), "phone": company.get("phone"), "email": company.get("email"), "logo_url": company.get("logo_url"), "iban": company.get("iban"), "bank_name": company.get("bank_name")},
            "products": products, "orders": orders, "invoices": invoices if bs.get("show_statement", True) else [], "installments": insts if bs.get("show_installments", True) else [],
            "settings": {k: bs.get(k) for k in ("show_stock", "show_prices", "allow_orders", "allow_ai_cart", "show_statement", "show_installments", "min_order_amount", "welcome_note")}}

@api_router.post("/public/b2b/{token}/change-password")
async def b2b_change_password(token: str, req: Dict[str, Any]):
    c = await _b2b_contact(token)
    current = str(req.get("current_password") or "")
    new_pw = str(req.get("new_password") or "").strip()
    if len(new_pw) < 6:
        raise HTTPException(status_code=400, detail="Yeni şifre en az 6 karakter olmalı.")
    stored = c.get("b2b_password_hash") or ""
    if stored:
        if not current or not verify_password(current, stored):
            raise HTTPException(status_code=400, detail="Mevcut şifre hatalı.")
        if verify_password(new_pw, stored):
            raise HTTPException(status_code=400, detail="Yeni şifre mevcut şifreyle aynı olamaz.")
    await db.contacts.update_one(
        {"_id": c["_id"]},
        {"$set": {"b2b_password_hash": hash_password(new_pw), "b2b_password_changed_at": datetime.now(timezone.utc).isoformat()}},
    )
    return {"status": "success", "message": "Şifreniz güncellendi."}

@api_router.post("/public/b2b/{token}/orders")
async def b2b_create_order(token: str, req: Dict[str, Any]):
    c = await _b2b_contact(token)
    items = await _b2b_build_items(c, req.get("items", []))
    if not items:
        raise HTTPException(status_code=400, detail="Sepet boş.")
    total = round(sum(i.total for i in items), 2)
    grand_total = round(sum(_b2b_gross(i.total, i.vat_rate, i.price_includes_vat) for i in items), 2)
    _co = await db.companies.find_one({"_id": c["company_id"]}) or {}
    _bs = {**B2B_DEFAULTS, **(_co.get("b2b_settings") or {})}
    if not _bs.get("allow_orders", True):
        raise HTTPException(status_code=400, detail="Portaldan sipariş alımı kapalı.")
    if float(_bs.get("min_order_amount", 0) or 0) > total:
        raise HTTPException(status_code=400, detail=f"Minimum sipariş tutarı {float(_bs['min_order_amount']):,.2f} ₺.")
    order = Order(company_id=c["company_id"], order_number=await _next_order_number(c["company_id"], "B2B"), channel="b2b", customer_name=c.get("name"), customer_email=c.get("email"), customer_phone=c.get("phone"), shipping_address=req.get("shipping_address") or c.get("address") or "-", city=req.get("city") or c.get("city") or "-", items=items, total_amount=total, order_status="pending")
    doc = order.to_mongo()
    doc["contact_id"] = c["_id"]
    doc["notes"] = req.get("note", "")
    doc["source"] = "b2b_portal"
    doc["grand_total"] = grand_total
    doc["vat_total"] = round(grand_total - sum(
        (i.total / (1 + float(i.vat_rate or 0) / 100) if i.price_includes_vat and i.vat_rate else i.total)
        for i in items
    ), 2)
    await db.orders.insert_one(doc)
    await _notify_company(c["company_id"], "b2b_order", f"Yeni B2B siparişi {doc['order_number']}", f"{c.get('name')} portaldan {len(items)} kalem, {total:,.2f} ₺ sipariş verdi.", doc["_id"])
    return {"status": "success", "order": clean_doc(doc), "message": f"Siparişiniz alındı: {doc['order_number']}"}

@api_router.put("/public/b2b/{token}/orders/{order_id}")
async def b2b_edit_order(token: str, order_id: str, req: Dict[str, Any]):
    c, o = await _b2b_owned_order(token, order_id)
    if o.get("order_status") not in ("pending", "new"):
        raise HTTPException(status_code=400, detail="Yalnızca beklemedeki siparişler düzenlenebilir.")
    if o.get("is_invoiced") or o.get("invoice_id"):
        raise HTTPException(status_code=400, detail="Faturalanmış sipariş düzenlenemez.")
    items = await _b2b_build_items(c, req.get("items", []))
    if not items:
        raise HTTPException(status_code=400, detail="Siparişte en az bir ürün olmalı.")
    total = round(sum(i.total for i in items), 2)
    grand_total = round(sum(_b2b_gross(i.total, i.vat_rate, i.price_includes_vat) for i in items), 2)
    vat_total = round(grand_total - sum(
        (i.total / (1 + float(i.vat_rate or 0) / 100) if i.price_includes_vat and i.vat_rate else i.total)
        for i in items
    ), 2)
    _co = await db.companies.find_one({"_id": c["company_id"]}) or {}
    _bs = {**B2B_DEFAULTS, **(_co.get("b2b_settings") or {})}
    if float(_bs.get("min_order_amount", 0) or 0) > total:
        raise HTTPException(status_code=400, detail=f"Minimum sipariş tutarı {float(_bs['min_order_amount']):,.2f} ₺.")
    update: Dict[str, Any] = {"items": [it.model_dump() for it in items], "total_amount": total, "grand_total": grand_total, "vat_total": vat_total, "updated_at": datetime.now(timezone.utc).isoformat()}
    if "note" in req:
        update["notes"] = req.get("note") or ""
    await db.orders.update_one({"_id": order_id}, {"$set": update})
    updated = await db.orders.find_one({"_id": order_id})
    await _notify_company(c["company_id"], "b2b_order_edit", f"B2B sipariş güncellendi {updated.get('order_number')}", f"{c.get('name')} beklemedeki siparişi {len(items)} kalem, {total:,.2f} ₺ olacak şekilde düzenledi.", order_id)
    return {"status": "success", "order": clean_doc(updated), "message": f"{updated.get('order_number')} güncellendi."}

@api_router.delete("/public/b2b/{token}/orders/{order_id}")
async def b2b_delete_order(token: str, order_id: str):
    c, o = await _b2b_owned_order(token, order_id)
    if o.get("order_status") not in ("pending", "new"):
        raise HTTPException(status_code=400, detail="Yalnızca beklemedeki siparişler silinebilir.")
    if o.get("is_invoiced") or o.get("invoice_id"):
        raise HTTPException(status_code=400, detail="Faturalanmış sipariş silinemez.")
    await trash.soft_delete("orders", o, "order", f"{o.get('order_number')} · {o.get('customer_name')}", note=f"B2B portal · {float(o.get('total_amount') or 0):,.2f} ₺")
    await _notify_company(c["company_id"], "b2b_order_delete", f"B2B sipariş silindi {o.get('order_number')}", f"{c.get('name')} beklemedeki siparişi iptal edip sildi.", order_id)
    return {"status": "success", "message": f"{o.get('order_number')} silindi."}

@api_router.post("/public/b2b/{token}/orders/{order_id}/cancel-request")
async def b2b_cancel_request(token: str, order_id: str, req: Dict[str, Any] = None):
    c, o = await _b2b_owned_order(token, order_id)
    if o.get("order_status") not in ("approved", "preparing"):
        raise HTTPException(status_code=400, detail="İptal talebi yalnızca onaylanmış siparişler için gönderilebilir. Beklemedeki siparişi silebilirsiniz.")
    existing = o.get("cancel_request") or {}
    if existing.get("status") == "pending":
        return {"status": "exists", "order": clean_doc(o), "message": "İptal talebiniz zaten iletildi."}
    req = req or {}
    cr = {"status": "pending", "reason": (req.get("reason") or "").strip(), "at": datetime.now(timezone.utc).isoformat()}
    await db.orders.update_one({"_id": order_id}, {"$set": {"cancel_request": cr}})
    updated = await db.orders.find_one({"_id": order_id})
    why = f" Gerekçe: {cr['reason']}" if cr["reason"] else ""
    await _notify_company(c["company_id"], "b2b_cancel_request", f"İptal talebi {updated.get('order_number')}", f"{c.get('name')} onaylı sipariş için iptal talebi gönderdi.{why}", order_id)
    return {"status": "success", "order": clean_doc(updated), "message": "İptal talebiniz iletildi."}

@api_router.get("/contacts/flags")
async def contact_flags(company_id: Optional[str] = "comp_nexus_main_01", days: int = 7):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    horizon = (datetime.now(timezone.utc) + timedelta(days=days)).strftime("%Y-%m-%d")
    flags: Dict[str, Dict[str, Any]] = {}
    def f(cid):
        return flags.setdefault(cid, {"overdue_amount": 0.0, "overdue_count": 0, "installment_due_amount": 0.0, "installment_due_count": 0, "installment_overdue_count": 0})
    async for i in db.invoices.find({"company_id": company_id, "payment_status": {"$ne": "paid"}, "status": {"$nin": ["cancelled", "draft"]}}, {"contact_id": 1, "grand_total": 1, "paid_amount": 1, "due_date": 1, "issue_date": 1}):
        due = i.get("due_date") or i.get("issue_date")
        if i.get("contact_id") and due and due < today:
            x = f(i["contact_id"]); x["overdue_amount"] = round(x["overdue_amount"] + i.get("grand_total", 0) - i.get("paid_amount", 0), 2); x["overdue_count"] += 1
    async for it in db.installments.find({"company_id": company_id, "status": {"$ne": "paid"}}, {"contact_id": 1, "amount": 1, "paid_amount": 1, "due_date": 1}):
        if not it.get("contact_id"):
            continue
        x = f(it["contact_id"])
        if it.get("due_date", "") <= horizon:
            x["installment_due_amount"] = round(x["installment_due_amount"] + it.get("amount", 0) - it.get("paid_amount", 0), 2); x["installment_due_count"] += 1
        if it.get("due_date", "") < today:
            x["installment_overdue_count"] += 1
    return flags

@api_router.get("/contacts/{contact_id}/aging")
async def contact_aging(contact_id: str):
    c = await db.contacts.find_one({"_id": contact_id})
    if not c:
        raise HTTPException(status_code=404, detail="Cari hesap bulunamadı.")
    today = date.fromisoformat(datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    rate = float(c.get("late_fee_rate", 0) or 0)
    rows = []
    for i in await db.invoices.find({"contact_id": contact_id, "payment_status": {"$ne": "paid"}, "status": {"$ne": "cancelled"}}).sort("issue_date", 1).to_list(500):
        remaining = round(i.get("grand_total", 0) - i.get("paid_amount", 0), 2)
        due = i.get("due_date") or i.get("issue_date")
        overdue = (today - date.fromisoformat(due)).days if due else 0
        fee = round(remaining * rate / 100 / 30 * overdue, 2) if overdue > 0 and rate else 0.0
        rows.append({"invoice_id": i["_id"], "invoice_number": i.get("invoice_number"), "invoice_type": i.get("invoice_type"), "issue_date": i.get("issue_date"), "due_date": due, "remaining": remaining, "overdue_days": max(0, overdue), "late_fee": fee})
    return {"payment_term_days": c.get("payment_term_days", 0), "late_fee_rate": rate, "rows": rows,
            "total_remaining": round(sum(r["remaining"] for r in rows), 2), "total_overdue": round(sum(r["remaining"] for r in rows if r["overdue_days"] > 0), 2), "total_late_fee": round(sum(r["late_fee"] for r in rows), 2)}

@api_router.post("/contacts/{contact_id}/apply-terms")
async def apply_contact_terms(contact_id: str, req: Dict[str, Any]):
    c = await db.contacts.find_one({"_id": contact_id})
    if not c:
        raise HTTPException(status_code=404, detail="Cari hesap bulunamadı.")
    days = int(req.get("payment_term_days", 0) or 0)
    rate = float(req.get("late_fee_rate", 0) or 0)
    await db.contacts.update_one({"_id": contact_id}, {"$set": {"payment_term_days": days, "late_fee_rate": rate}})
    updated = 0
    if req.get("apply_to_open_invoices"):
        for i in await db.invoices.find({"contact_id": contact_id, "payment_status": {"$ne": "paid"}}).to_list(500):
            new_due = (date.fromisoformat(i.get("issue_date")) + timedelta(days=days)).isoformat()
            await db.invoices.update_one({"_id": i["_id"]}, {"$set": {"due_date": new_due}})
            updated += 1
    return {"status": "success", "updated_invoices": updated, "message": f"Vade {days} gün olarak kaydedildi" + (f", {updated} açık faturanın vadesi güncellendi." if updated else ".")}

@api_router.get("/contacts/{contact_id}/installments")
async def list_contact_balance_installments(contact_id: str):
    rows = await db.installments.find({"contact_id": contact_id, "invoice_id": None}).sort("no", 1).to_list(200)
    return [_decorate_installment(r) for r in rows]

@api_router.post("/contacts/{contact_id}/installments")
async def create_contact_balance_installments(contact_id: str, req: Dict[str, Any]):
    c = await db.contacts.find_one({"_id": contact_id})
    if not c:
        raise HTTPException(status_code=404, detail="Cari hesap bulunamadı.")
    if await db.installments.count_documents({"contact_id": contact_id, "invoice_id": None, "status": {"$ne": "pending"}}) > 0:
        raise HTTPException(status_code=400, detail="Ödemesi başlamış bakiye taksit planı yeniden oluşturulamaz.")
    total = float(req.get("total") or abs(c.get("balance", 0)))
    if total <= 0:
        raise HTTPException(status_code=400, detail="Taksitlendirilecek bakiye yok.")
    await db.installments.delete_many({"contact_id": contact_id, "invoice_id": None})
    rows = _build_plan(total, req)
    now = datetime.now(timezone.utc).isoformat()
    direction = "receivable" if c.get("balance", 0) >= 0 else "payable"
    docs = [{"_id": str(uuid.uuid4()), "company_id": c["company_id"], "invoice_id": None, "invoice_number": "AÇIK BAKİYE", "invoice_type": "balance", "direction": direction,
             "contact_id": contact_id, "contact_name": c.get("name"), "no": r["no"], "label": r["label"], "total_count": len(rows), "due_date": r["due_date"], "amount": r["amount"], "paid_amount": 0, "status": "pending", "created_at": now} for r in rows]
    await db.installments.insert_many(docs)
    return [_decorate_installment(d) for d in docs]

@api_router.delete("/contacts/{contact_id}/installments")
async def delete_contact_balance_installments(contact_id: str):
    if await db.installments.count_documents({"contact_id": contact_id, "invoice_id": None, "status": {"$ne": "pending"}}) > 0:
        raise HTTPException(status_code=400, detail="Ödenmiş taksiti olan plan silinemez.")
    await db.installments.delete_many({"contact_id": contact_id, "invoice_id": None})
    return {"status": "success"}

@api_router.get("/contacts/{contact_id}/overview")
async def get_contact_overview(contact_id: str):
    contact = await db.contacts.find_one({"_id": contact_id})
    if not contact:
        raise HTTPException(status_code=404, detail="Cari hesap bulunamadı.")
    invoices = await db.invoices.find({"contact_id": contact_id}).sort("issue_date", -1).to_list(200)
    payments = await db.bank_transactions.find({"contact_id": contact_id}).sort("date", -1).to_list(200)
    for ptx in await db.partner_transactions.find({"contact_id": contact_id}).to_list(200):
        payments.append({
            **ptx,
            "type": "inflow" if ptx.get("type") == "withdrawal" else "outflow",
            "category": "Cari Tahsilat" if ptx.get("type") == "withdrawal" else "Cari Ödeme",
            "account_name": ptx.get("account_name") or "Ortaklar Hesabı",
            "source": "partner",
        })
    payments.sort(key=lambda x: x.get("date") or x.get("created_at") or "", reverse=True)
    orders = await db.orders.find({"company_id": contact["company_id"], "customer_name": contact.get("name")}).sort("order_date", -1).to_list(100)
    sms = await db.sms_logs.find({"contact_id": contact_id}).sort("created_at", -1).to_list(50)
    mails = await db.mail_logs.find({"contact_id": contact_id}).sort("created_at", -1).to_list(50)
    wa = await db.whatsapp_logs.find({"contact_id": contact_id}).sort("created_at", -1).to_list(100)
    quotes = await db.quotes.find({"contact_id": contact_id}).sort("created_at", -1).to_list(100)
    surveys = await db.surveys.find({"contact_id": contact_id}).sort("created_at", -1).to_list(100)
    cheques_rows = [cheques._annotate(x, datetime.now(timezone.utc).strftime("%Y-%m-%d")) for x in await db.cheques.find({"contact_id": contact_id}).sort("due_date", 1).to_list(200)]
    comm = sorted([{**clean_doc(s), "channel": "sms"} for s in sms] + [{**clean_doc(m), "channel": "email"} for m in mails] + [{**clean_doc(w), "channel": "whatsapp"} for w in wa], key=lambda x: x.get("created_at", ""), reverse=True)
    sales = [i for i in invoices if i.get("invoice_type") == "sales" and i.get("status") not in ("draft", "cancelled")]
    total_invoiced = sum(i.get("grand_total", 0) or 0 for i in sales)
    total_paid = sum(i.get("paid_amount", 0) or 0 for i in sales)
    return {
        "contact": clean_doc(contact),
        "summary": {"invoice_count": len(invoices), "draft_count": sum(1 for i in invoices if i.get("status") == "draft"), "total_invoiced": total_invoiced,
                    "total_paid": total_paid, "open_amount": total_invoiced - total_paid, "order_count": len(orders), "overdue_count": sum(1 for i in invoices if i.get("payment_status") != "paid" and i.get("invoice_type") == "sales")},
        "invoices": clean_docs(invoices), "payments": clean_docs(payments), "orders": clean_docs(orders), "communications": comm,
        "quotes": clean_docs(quotes), "surveys": clean_docs(surveys), "cheques": clean_docs(cheques_rows)
    }

@api_router.post("/contacts/{contact_id}/record-payment")
async def record_contact_payment(contact_id: str, req: Dict[str, Any]):
    contact = await db.contacts.find_one({"_id": contact_id})
    if not contact:
        raise HTTPException(status_code=404, detail="Cari hesap bulunamadı.")
    amount = float(req.get("amount") or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Tutar sıfırdan büyük olmalıdır.")
    if not req.get("partner_id"):
        raise HTTPException(status_code=400, detail="Ortak hesabı seçin.")
    tx_type = req.get("type") or "inflow"
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    description = req.get("description") or ("Cari tahsilat" if tx_type == "inflow" else "Cari ödeme")
    ptype = "withdrawal" if tx_type == "inflow" else "capital_in"
    name = await partner_pay.move(db, contact["company_id"], req["partner_id"], amount, ptype, f"{contact.get('name')}: {description}", today, extra={"contact_id": contact_id})
    await db.contacts.update_one({"_id": contact_id}, {"$inc": {"balance": -amount if tx_type == "inflow" else amount}})
    return {"status": "success", "via": "partner", "account_name": name}

# ----------------- STOK, ÜRÜNLER & BARKOD -----------------
DEFAULT_UNITS = ["Adet", "Kg", "Gr", "Lt", "Ml", "Mt", "Cm", "M2", "M3", "Paket", "Koli", "Kutu", "Çift", "Takım", "Saat", "Gün", "Ton"]

@api_router.get("/products/units")
async def list_units(company_id: Optional[str] = "comp_nexus_main_01"):
    saved = [u["name"] for u in await db.units.find({"company_id": company_id}).sort("name", 1).to_list(200)]
    if not saved:
        await db.units.insert_many([{"_id": str(uuid.uuid4()), "company_id": company_id, "name": u} for u in DEFAULT_UNITS])
        saved = DEFAULT_UNITS
    used = {u: await db.products.count_documents({"company_id": company_id, "unit": u}) for u in saved}
    return [{"name": u, "count": used.get(u, 0)} for u in saved]

@api_router.post("/products/units")
async def add_unit(req: Dict[str, Any]):
    name = (req.get("name") or "").strip()
    company_id = req.get("company_id", "comp_nexus_main_01")
    if not name:
        raise HTTPException(status_code=400, detail="Birim adı boş olamaz.")
    await db.units.update_one({"company_id": company_id, "name": name}, {"$setOnInsert": {"_id": str(uuid.uuid4()), "company_id": company_id, "name": name}}, upsert=True)
    return {"status": "success", "name": name}

@api_router.put("/products/units/{name}")
async def rename_unit(name: str, req: Dict[str, Any], company_id: Optional[str] = "comp_nexus_main_01"):
    new = (req.get("name") or "").strip()
    if not new:
        raise HTTPException(status_code=400, detail="Yeni birim adı boş olamaz.")
    await db.units.update_one({"company_id": company_id, "name": name}, {"$set": {"name": new}})
    r = await db.products.update_many({"company_id": company_id, "unit": name}, {"$set": {"unit": new}})
    return {"status": "success", "updated_products": r.modified_count}

@api_router.delete("/products/units/{name}")
async def delete_unit(name: str, company_id: Optional[str] = "comp_nexus_main_01"):
    if await db.products.count_documents({"company_id": company_id, "unit": name}):
        raise HTTPException(status_code=400, detail="Bu birimi kullanan ürünler var; önce birimi değiştirin veya yeniden adlandırın.")
    await db.units.delete_one({"company_id": company_id, "name": name})
    return {"status": "success"}

@api_router.get("/products/categories")
async def list_product_categories(company_id: Optional[str] = "comp_nexus_main_01"):
    used = [c for c in await db.products.distinct("category", {"company_id": company_id}) if c]
    saved = [c["name"] for c in await db.product_categories.find({"company_id": company_id}).to_list(500)]
    counts = {c: await db.products.count_documents({"company_id": company_id, "category": c}) for c in set(used + saved)}
    return sorted([{"name": c, "count": counts.get(c, 0)} for c in counts], key=lambda x: (-x["count"], x["name"]))

@api_router.post("/products/categories")
async def add_product_category(req: Dict[str, Any]):
    name = (req.get("name") or "").strip()
    company_id = req.get("company_id", "comp_nexus_main_01")
    if not name:
        raise HTTPException(status_code=400, detail="Kategori adı boş olamaz.")
    await db.product_categories.update_one({"company_id": company_id, "name": name}, {"$setOnInsert": {"_id": str(uuid.uuid4()), "company_id": company_id, "name": name, "created_at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
    return {"status": "success", "name": name}

@api_router.delete("/products/categories/{name}")
async def delete_product_category(name: str, company_id: Optional[str] = "comp_nexus_main_01"):
    if await db.products.count_documents({"company_id": company_id, "category": name}):
        raise HTTPException(status_code=400, detail="Bu kategoride ürün var; önce ürünlerin kategorisini değiştirin.")
    await db.product_categories.delete_one({"company_id": company_id, "name": name})
    return {"status": "success"}

async def _remember_category(company_id: str, name: Optional[str]):
    if name and name.strip():
        await db.product_categories.update_one({"company_id": company_id, "name": name.strip()}, {"$setOnInsert": {"_id": str(uuid.uuid4()), "company_id": company_id, "name": name.strip(), "created_at": datetime.now(timezone.utc).isoformat()}}, upsert=True)

@api_router.get("/products")
async def list_products(company_id: Optional[str] = "comp_nexus_main_01", category: Optional[str] = None, type: Optional[str] = None, b2b_only: bool = False):
    query = {"company_id": company_id}
    if b2b_only:
        query["show_in_b2b"] = {"$ne": False}
        query["is_active"] = {"$ne": False}
        query["type"] = {"$nin": ["raw_material", "service"]}
        query["sale_price"] = {"$gt": 0}
    if category and category != "all":
        query["category"] = category
    if type and type != "all":
        query["type"] = type
    products = await db.products.find(query).to_list(10000)
    return clean_docs(products)

@api_router.post("/products")
async def create_product(product: Product):
    if not product.barcode:
        product.barcode = f"868{str(uuid.uuid4().int)[:10]}"
    doc = product.to_mongo()
    await db.products.insert_one(doc)
    await _remember_category(product.company_id, product.category)
    return clean_doc(doc)

@api_router.put("/products/{product_id}")
async def update_product(product_id: str, updated: Dict[str, Any]):
    await db.products.update_one({"_id": product_id}, {"$set": updated})
    if updated.get("category"):
        cur = await db.products.find_one({"_id": product_id}, {"company_id": 1})
        await _remember_category((cur or {}).get("company_id", "comp_nexus_main_01"), updated["category"])
    res = await db.products.find_one({"_id": product_id})
    return clean_doc(res)

async def _product_usage_labels(product_id: str) -> List[str]:
    """Fatura / sipariş / teklifte geçen stok kartları cari bakiyesini etkilemeden silinemez."""
    labels = []
    if await db.invoices.find_one({"items.product_id": product_id}, {"_id": 1}):
        labels.append("fatura/irsaliye")
    if await db.orders.find_one({"items.product_id": product_id}, {"_id": 1}):
        labels.append("sipariş")
    if await db.quotes.find_one({"items.product_id": product_id}, {"_id": 1}):
        labels.append("teklif")
    return labels


@api_router.delete("/products/{product_id}")
async def delete_product(product_id: str):
    p = await db.products.find_one({"_id": product_id})
    if not p:
        raise HTTPException(status_code=404, detail="Ürün bulunamadı.")
    used = await _product_usage_labels(product_id)
    if used:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Bu stok kartı işlem görmüş ({', '.join(used)}). "
                "Cari bakiyelerinin etkilenmemesi için silinemez. Kartı düzenleyin veya B2B'den gizleyin."
            ),
        )
    await trash.soft_delete("products", p, "product", f"{p.get('name')}" + (f" ({p.get('sku')})" if p.get("sku") else ""), note=f"Stok: {p.get('stock_quantity', 0)}")
    return {"status": "success", "message": "Ürün çöp kutusuna taşındı."}

@api_router.get("/products/barcode/{barcode}")
async def get_product_by_barcode(barcode: str, company_id: Optional[str] = "comp_nexus_main_01"):
    product = await db.products.find_one({"barcode": barcode, "company_id": company_id})
    matched_variant = None
    if not product:
        product = await db.products.find_one({"variants.barcode": barcode, "company_id": company_id})
        if product:
            matched_variant = next((v for v in product.get("variants", []) if v.get("barcode") == barcode), None)
    if not product:
        raise HTTPException(status_code=404, detail="Barkod ile eşleşen ürün bulunamadı.")
    result = clean_doc(product)
    result["matched_variant"] = matched_variant
    return result

@api_router.get("/products/{product_id}")
async def get_product(product_id: str):
    product = await db.products.find_one({"_id": product_id})
    if not product:
        raise HTTPException(status_code=404, detail="Ürün bulunamadı.")
    return clean_doc(product)

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_IMAGE_BYTES = 5 * 1024 * 1024

@api_router.post("/products/{product_id}/image")
async def upload_product_image(product_id: str, file: UploadFile = File(...), variant_id: Optional[str] = Query(None)):
    product = await db.products.find_one({"_id": product_id})
    if not product:
        raise HTTPException(status_code=404, detail="Ürün bulunamadı.")
    if file.content_type not in ALLOWED_IMAGE_TYPES:
        raise HTTPException(status_code=400, detail="Sadece JPG, PNG, WEBP veya GIF yükleyebilirsiniz.")
    data = await file.read()
    if len(data) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail="Görsel boyutu en fazla 5 MB olabilir.")
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else "jpg"
    path = f"{APP_NAME}/products/{product.get('company_id')}/{uuid.uuid4()}.{ext}"
    try:
        result = put_object(path, data, file.content_type)
    except Exception as e:
        logger.error(f"Image upload failed: {e}")
        raise HTTPException(status_code=502, detail="Görsel depolama servisine yüklenemedi.")
    await db.files.insert_one({
        "_id": str(uuid.uuid4()),
        "storage_path": result["path"],
        "original_filename": file.filename,
        "content_type": file.content_type,
        "size": result.get("size", len(data)),
        "entity": "product",
        "entity_id": product_id,
        "is_deleted": False,
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    image_url = f"/api/files/{result['path']}"
    if variant_id:
        await db.products.update_one(
            {"_id": product_id, "variants.variant_id": variant_id},
            {"$set": {"variants.$.image_url": image_url}}
        )
    else:
        update = {"$push": {"images": image_url}}
        if not product.get("image_url"):
            update["$set"] = {"image_url": image_url}
        await db.products.update_one({"_id": product_id}, update)
    updated = await db.products.find_one({"_id": product_id})
    return {"image_url": image_url, "product": clean_doc(updated)}

@api_router.put("/products/{product_id}/images")
async def update_product_images(product_id: str, req: Dict[str, Any]):
    images = req.get("images", [])
    image_url = req.get("image_url") or (images[0] if images else None)
    await db.products.update_one({"_id": product_id}, {"$set": {"images": images, "image_url": image_url}})
    updated = await db.products.find_one({"_id": product_id})
    if not updated:
        raise HTTPException(status_code=404, detail="Ürün bulunamadı.")
    return clean_doc(updated)

@api_router.get("/files/{path:path}")
async def serve_file(path: str):
    record = await db.files.find_one({"storage_path": path, "is_deleted": False})
    if not record:
        raise HTTPException(status_code=404, detail="Dosya bulunamadı.")
    try:
        data, content_type = get_object(path)
    except Exception as e:
        logger.error(f"File fetch failed: {e}")
        raise HTTPException(status_code=502, detail="Dosya alınamadı.")
    return Response(content=data, media_type=record.get("content_type", content_type), headers={"Cache-Control": "public, max-age=86400"})

class VariantsUpdateRequest(BaseModel):
    variant_options: List[Dict[str, Any]] = []
    variants: List[ProductVariant] = []

@api_router.put("/products/{product_id}/variants")
async def update_product_variants(product_id: str, req: VariantsUpdateRequest):
    product = await db.products.find_one({"_id": product_id})
    if not product:
        raise HTTPException(status_code=404, detail="Ürün bulunamadı.")
    variants = []
    seen_skus = set()
    for idx, v in enumerate(req.variants):
        if not v.sku:
            v.sku = f"{product.get('sku')}-{idx + 1:02d}"
        if v.sku in seen_skus:
            raise HTTPException(status_code=400, detail=f"Tekrarlayan varyant SKU: {v.sku}")
        seen_skus.add(v.sku)
        if not v.barcode:
            v.barcode = f"869{str(uuid.uuid4().int)[:10]}"
        if not v.name and v.attributes:
            v.name = " / ".join(v.attributes.values())
        variants.append(v.model_dump())
    has_variants = len(variants) > 0
    update = {
        "has_variants": has_variants,
        "variant_options": req.variant_options,
        "variants": variants,
    }
    if has_variants:
        update["stock_quantity"] = sum(v.get("stock", 0) for v in variants)
    await db.products.update_one({"_id": product_id}, {"$set": update})
    updated = await db.products.find_one({"_id": product_id})
    return clean_doc(updated)

@api_router.post("/products/quick-stock-adjust")
async def quick_stock_adjust(req: Dict[str, Any]):
    product_id = req.get("product_id")
    variant_id = req.get("variant_id")
    quantity_change = req.get("quantity_change", 0)
    reason = req.get("reason", "Hızlı Sayım / Düzeltme")

    product = await db.products.find_one({"_id": product_id})
    if not product:
        raise HTTPException(status_code=404, detail="Ürün bulunamadı.")
    if product.get("track_stock") is False:
        raise HTTPException(status_code=400, detail="Bu ürün için stok takibi kapalı.")

    variant_name = None
    if variant_id and product.get("variants"):
        variants = product.get("variants", [])
        target = next((v for v in variants if v.get("variant_id") == variant_id), None)
        if not target:
            raise HTTPException(status_code=404, detail="Varyant bulunamadı.")
        target["stock"] = max(0, target.get("stock", 0) + quantity_change)
        variant_name = target.get("name")
        new_qty = sum(v.get("stock", 0) for v in variants)
        await db.products.update_one({"_id": product_id}, {"$set": {"variants": variants, "stock_quantity": new_qty}})
        new_variant_stock = target["stock"]
    else:
        new_qty = max(0, product.get("stock_quantity", 0) + quantity_change)
        await db.products.update_one({"_id": product_id}, {"$set": {"stock_quantity": new_qty}})
        new_variant_stock = None

    await db.stock_movements.insert_one({
        "_id": str(uuid.uuid4()),
        "product_id": product_id,
        "product_name": product.get("name"),
        "variant_id": variant_id,
        "variant_name": variant_name,
        "change": quantity_change,
        "new_stock": new_qty,
        "reason": reason,
        "date": datetime.now(timezone.utc).isoformat()
    })

    return {"status": "success", "new_stock": new_qty, "new_variant_stock": new_variant_stock}

# ----------------- FATURALAR & E-FATURA / E-ARŞİV -----------------
@api_router.get("/invoices")
async def list_invoices(company_id: Optional[str] = "comp_nexus_main_01", type: Optional[str] = None):
    query = {"company_id": company_id}
    if type and type != "all":
        query["invoice_type"] = type
    else:
        query["invoice_type"] = {"$ne": "dispatch"}
    invoices = await db.invoices.find(query).sort("created_at", -1).to_list(1000)
    return clean_docs(invoices)

@api_router.post("/invoices/{invoice_id}/create-dispatch")
async def create_dispatch_from_invoice(invoice_id: str):
    inv = await db.invoices.find_one({"_id": invoice_id})
    if not inv:
        raise HTTPException(status_code=404, detail="Fatura bulunamadı.")
    if inv.get("invoice_type") == "dispatch":
        raise HTTPException(status_code=400, detail="Bu belge zaten bir irsaliye.")
    if inv.get("dispatch_id"):
        d = await db.invoices.find_one({"_id": inv["dispatch_id"]})
        if d:
            return {"status": "exists", "dispatch": clean_doc(d), "message": f"Bu faturanın irsaliyesi zaten var: {d['invoice_number']}"}
    number = await _next_number("IRS", db.invoices)
    contact = await db.contacts.find_one({"_id": inv.get("contact_id")}) if inv.get("contact_id") else None
    doc = {"_id": str(uuid.uuid4()), "company_id": inv["company_id"], "invoice_number": number, "invoice_type": "dispatch", "e_type": "e_dispatch", "contact_id": inv.get("contact_id"), "contact_name": inv.get("contact_name"),
           "contact_tax_id": inv.get("contact_tax_id"), "shipping_address": (contact or {}).get("address"), "city": (contact or {}).get("city"), "items": [{**it, "vat_rate": 0} for it in inv.get("items", [])],
           "subtotal": inv.get("subtotal", 0), "vat_total": 0, "grand_total": inv.get("subtotal", 0), "currency": inv.get("currency", "TRY"), "status": "draft", "gib_status": "Taslak (e-İrsaliye)", "payment_status": "n/a",
           "invoice_id": invoice_id, "invoice_ref_number": inv.get("invoice_number"), "source_channel": inv.get("source_channel", "manual"), "dispatch_status": "draft",
           "issue_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "created_at": datetime.now(timezone.utc).isoformat()}
    await db.invoices.insert_one(doc)
    await db.invoices.update_one({"_id": invoice_id}, {"$set": {"dispatch_id": doc["_id"], "dispatch_number": number}})
    return {"status": "success", "dispatch": clean_doc(doc), "message": f"{number} irsaliyesi oluşturuldu."}

@api_router.post("/invoices/{dispatch_id}/convert-to-invoice")
async def convert_dispatch_to_invoice(dispatch_id: str, req: Optional[Dict[str, Any]] = None):
    d = await db.invoices.find_one({"_id": dispatch_id})
    if not d or d.get("invoice_type") != "dispatch":
        raise HTTPException(status_code=404, detail="İrsaliye bulunamadı.")
    if d.get("converted_invoice_id"):
        ex = await db.invoices.find_one({"_id": d["converted_invoice_id"]})
        if ex:
            return {"status": "exists", "invoice": clean_doc(ex), "message": f"Bu irsaliye zaten faturalandı: {ex['invoice_number']}"}
    req = req or {}
    products = {p["_id"]: p for p in await db.products.find({"company_id": d["company_id"]}, {"vat_rate": 1}).to_list(3000)}
    items = []
    for it in d.get("items", []):
        vat = int(it.get("vat_rate") or 0) or int((products.get(it.get("product_id")) or {}).get("vat_rate") or 20)
        items.append(InvoiceItem(product_id=it.get("product_id"), name=it.get("name") or "Kalem", quantity=float(it.get("quantity") or 1), unit=it.get("unit") or "Adet", unit_price=float(it.get("unit_price") or 0), vat_rate=vat, discount_rate=float(it.get("discount_rate") or 0), total=float(it.get("total") or 0)))
    if not items:
        raise HTTPException(status_code=400, detail="İrsaliyede kalem yok.")
    if not d.get("contact_id"):
        raise HTTPException(status_code=400, detail="İrsaliyede cari bağlı değil; önce cari seçin.")
    inv = Invoice(company_id=d["company_id"], invoice_type="sales", e_type=req.get("e_type") or "e_archive", contact_id=d["contact_id"], contact_name=d.get("contact_name") or "", contact_tax_id=d.get("contact_tax_id") or "",
                  issue_date=datetime.now(timezone.utc).strftime("%Y-%m-%d"), items=items, currency=d.get("currency") or "TRY", status="draft", notes=f"İrsaliye: {d['invoice_number']}" + (f" · Sipariş: {d['order_number']}" if d.get("order_number") else ""),
                  source_channel=d.get("source_channel") or "manual")
    created = await create_invoice(inv)
    await db.invoices.update_one({"_id": created["id"]}, {"$set": {"dispatch_id": dispatch_id, "dispatch_number": d["invoice_number"], "order_id": d.get("order_id"), "order_number": d.get("order_number")}})
    await db.invoices.update_one({"_id": dispatch_id}, {"$set": {"converted_invoice_id": created["id"], "converted_invoice_number": created["invoice_number"], "dispatch_status": "invoiced"}})
    if d.get("order_id"):
        await db.orders.update_one({"_id": d["order_id"], "invoice_id": None}, {"$set": {"invoice_id": created["id"], "invoice_number": created["invoice_number"]}})
    return {"status": "success", "invoice": clean_doc(await db.invoices.find_one({"_id": created["id"]})), "message": f"{d['invoice_number']} → {created['invoice_number']} satış faturası oluşturuldu."}

@api_router.post("/invoices")
async def create_invoice(invoice: Invoice):
    if not invoice.invoice_number:
        if invoice.invoice_type == "dispatch":
            invoice.invoice_number = await _next_number("IRS", db.invoices)
        else:
            prefix = "NX" if invoice.invoice_type == "sales" else "AL"
            year = datetime.now().strftime("%Y")
            count = await db.invoices.count_documents({"company_id": invoice.company_id}) + 1
            invoice.invoice_number = f"{prefix}{year}{str(count).zfill(8)}"
    if invoice.invoice_type == "dispatch":
        invoice.e_type = "e_dispatch"
        invoice.status = "draft"
        invoice.gib_status = "Taslak (e-İrsaliye)"
        invoice.payment_status = "n/a"
        for it in invoice.items:
            it.vat_rate = 0

    if not invoice.due_date and invoice.contact_id:
        _c = await db.contacts.find_one({"_id": invoice.contact_id})
        if _c and _c.get("payment_term_days"):
            invoice.due_date = (date.fromisoformat(invoice.issue_date) + timedelta(days=int(_c["payment_term_days"]))).isoformat()
    items_sum = sum(item.total for item in invoice.items)
    gd = invoice.general_discount_amount or (items_sum * invoice.general_discount_rate / 100)
    gd = round(min(max(gd, 0), items_sum), 2)
    factor = (items_sum - gd) / items_sum if items_sum else 1
    invoice.discount_total = gd
    invoice.general_discount_amount = gd
    invoice.subtotal = round(items_sum - gd, 2)
    invoice.vat_total = round(sum(item.total * factor * (item.vat_rate / 100) for item in invoice.items), 2)
    invoice.withholding_amount = round(invoice.vat_total * float(invoice.withholding_rate or 0), 2)
    invoice.grand_total = round(invoice.subtotal + invoice.vat_total - invoice.withholding_amount, 2)

    doc = invoice.to_mongo()
    if invoice.status in ["approved", "sent_to_gib"]:
        await _apply_invoice_effects(doc)
        doc["effects_applied"] = True
    await db.invoices.insert_one(doc)
    return clean_doc(doc)


async def _apply_invoice_effects(inv: dict):
    """Onaylanan fatura: cari bakiyesi + (satışta) stok düşümü. Taslaklar için çağrılmaz."""
    if inv.get("contact_id"):
        change = float(inv.get("grand_total", 0)) if inv.get("invoice_type") == "sales" else -float(inv.get("grand_total", 0))
        await db.contacts.update_one({"_id": inv["contact_id"]}, {"$inc": {"balance": change}})
    if inv.get("invoice_type") == "sales":
        for item in inv.get("items", []):
            pid = item.get("product_id") if isinstance(item, dict) else item.product_id
            qty = item.get("quantity") if isinstance(item, dict) else item.quantity
            if pid:
                await db.products.update_one({"_id": pid}, {"$inc": {"stock_quantity": -float(qty or 0)}})


@api_router.post("/invoices/{invoice_id}/approve")
async def approve_invoice(invoice_id: str):
    inv = await db.invoices.find_one({"_id": invoice_id})
    if not inv:
        raise HTTPException(status_code=404, detail="Fatura bulunamadı.")
    if inv.get("status") != "draft":
        return {"status": "success", "message": "Fatura zaten onaylı."}
    await _apply_invoice_effects(inv)
    await db.invoices.update_one({"_id": invoice_id}, {"$set": {"status": "approved", "effects_applied": True, "gib_status": inv.get("gib_status") if inv.get("gib_status") not in (None, "Taslak") else ("Kağıt Fatura (Matbu)" if inv.get("e_type") == "paper" else "Onaylandı"), "approved_at": datetime.now(timezone.utc).isoformat()}})
    return {"status": "success", "message": "Fatura onaylandı; cari bakiyesi ve stok işlendi."}

@api_router.get("/gib/lookup")
async def gib_lookup(tax_id: str, company_id: Optional[str] = "comp_nexus_main_01"):
    tid = "".join(ch for ch in tax_id if ch.isdigit())
    if len(tid) not in (10, 11):
        raise HTTPException(status_code=400, detail="VKN 10 veya TCKN 11 haneli olmalıdır.")
    local = await db.contacts.find_one({"company_id": company_id, "tax_number_or_id": tid})
    settings = await db.einvoice_settings.find_one({"company_id": company_id}) or {}
    live = settings.get("status") == "configured"
    # Gerçek entegratör bağlı değilse GİB mükellef sorgusu SİMÜLE edilir (VKN'ler mükellef kabul edilir)
    is_efatura = local.get("is_e_invoice_user") if local else len(tid) == 10
    return {"tax_id": tid, "kind": "VKN" if len(tid) == 10 else "TCKN", "is_e_invoice_user": bool(is_efatura), "suggested_e_type": "e_invoice" if is_efatura else "e_archive",
            "alias": f"urn:mail:defaultpk@{tid}.com.tr" if is_efatura else None, "source": settings.get("provider") if live else "simulated",
            "local_contact": clean_doc(local) if local else None,
            "message": ("Cari kayıtlarınızda bulundu." if local else "GİB e-Fatura mükellef listesinde " + ("kayıtlı (e-Fatura kesilmeli)." if is_efatura else "kayıtlı değil (e-Arşiv kesilmeli).")) + ("" if live else " [SİMÜLE — entegratör bağlanınca gerçek sorgu yapılır]")}

@api_router.put("/invoices/{invoice_id}")
async def update_invoice(invoice_id: str, req: Dict[str, Any]):
    inv = await db.invoices.find_one({"_id": invoice_id})
    if not inv:
        raise HTTPException(status_code=404, detail="Fatura bulunamadı.")
    if inv.get("status") != "draft":
        allowed = {k: v for k, v in req.items() if k in {"due_date", "notes"}}
        if not allowed or set(req.keys()) - {"due_date", "notes"}:
            raise HTTPException(status_code=400, detail="Kesilmiş faturada sadece vade ve not düzenlenebilir.")
        await db.invoices.update_one({"_id": invoice_id}, {"$set": allowed})
        return clean_doc(await db.invoices.find_one({"_id": invoice_id}))
    allowed = {k: v for k, v in req.items() if k in {"items", "e_type", "due_date", "issue_date", "notes", "contact_id", "contact_name", "withholding_rate", "withholding_code", "price_mode", "invoice_type", "general_discount_rate", "general_discount_amount"}}
    if "items" in allowed or "general_discount_rate" in allowed or "general_discount_amount" in allowed:
        items = allowed.get("items", inv.get("items", []))
        items_sum = sum(float(i.get("total", 0)) for i in items)
        gd_rate = float(allowed.get("general_discount_rate", inv.get("general_discount_rate", 0)) or 0)
        gd_amt = float(allowed.get("general_discount_amount", inv.get("general_discount_amount", 0)) or 0) if "general_discount_rate" not in allowed else 0
        gd = round(min(max(gd_amt or items_sum * gd_rate / 100, 0), items_sum), 2)
        factor = (items_sum - gd) / items_sum if items_sum else 1
        subtotal = items_sum - gd
        vat_total = sum(float(i.get("total", 0)) * factor * float(i.get("vat_rate", 20)) / 100 for i in items)
        allowed.update({"discount_total": gd, "general_discount_amount": gd, "subtotal": round(subtotal, 2), "vat_total": round(vat_total, 2), "withholding_amount": round(vat_total * float(allowed.get("withholding_rate", inv.get("withholding_rate", 0)) or 0), 2), "grand_total": round(subtotal + vat_total - vat_total * float(allowed.get("withholding_rate", inv.get("withholding_rate", 0)) or 0), 2)})
        if inv.get("effects_applied") and inv.get("contact_id") and inv.get("invoice_type") == "sales":
            await db.contacts.update_one({"_id": inv["contact_id"]}, {"$inc": {"balance": allowed["grand_total"] - inv.get("grand_total", 0)}})
    await db.invoices.update_one({"_id": invoice_id}, {"$set": allowed})
    return clean_doc(await db.invoices.find_one({"_id": invoice_id}))

@api_router.delete("/invoices/{invoice_id}")
async def delete_invoice(invoice_id: str):
    inv = await db.invoices.find_one({"_id": invoice_id})
    if not inv:
        raise HTTPException(status_code=404, detail="Fatura bulunamadı.")
    if inv.get("status") != "draft":
        raise HTTPException(status_code=400, detail="Kesilmiş/onaylı fatura silinemez. Muhasebe bütünlüğü için iptal ya da iade faturası düzenleyin.")
    tid = await trash.soft_delete("invoices", inv, "invoice", f"{inv.get('invoice_number')} · {inv.get('contact_name', '')} · {inv.get('grand_total', 0):,.2f} ₺", note="Taslak fatura")
    return {"status": "success", "trash_id": tid, "message": "Taslak fatura çöp kutusuna taşındı (30 gün içinde geri alınabilir)."}

@api_router.post("/invoices/{invoice_id}/send-to-gib")
async def send_invoice_to_gib(invoice_id: str, req: Dict[str, Any] = None):
    req = req or {}
    if req.get("e_type"):
        await db.invoices.update_one({"_id": invoice_id}, {"$set": {"e_type": req["e_type"]}})
    inv = await db.invoices.find_one({"_id": invoice_id})
    if not inv:
        raise HTTPException(status_code=404, detail="Fatura bulunamadı.")
    if inv.get("status") == "draft" and not inv.get("effects_applied"):
        await _apply_invoice_effects(inv)
        await db.invoices.update_one({"_id": invoice_id}, {"$set": {"effects_applied": True}})

    if inv.get("e_type") == "paper":
        await db.invoices.update_one({"_id": invoice_id}, {"$set": {"status": "approved", "gib_status": "Kağıt Fatura (Matbu)", "gib_tracking_id": None}})
        return {"status": "success", "message": "Kağıt fatura olarak kesildi. Matbu belgeyi yazdırabilirsiniz.", "tracking_id": None}
    remaining = await gib_credits.consume(inv.get("company_id"), 1, invoice_id=invoice_id, note=inv.get("invoice_number") or invoice_id)
    tracking_id = f"GIB-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}"
    await db.invoices.update_one(
        {"_id": invoice_id},
        {"$set": {
            "status": "approved",
            "gib_status": "Başarıyla İletildi (GİB Onaylı)",
            "gib_tracking_id": tracking_id
        }}
    )
    return {
        "status": "success",
        "message": f"Fatura GİB sistemine başarıyla iletildi ve imzalandı. ETTN/Takip No: {tracking_id}",
        "tracking_id": tracking_id,
        "gib_credits_left": remaining,
    }

@api_router.post("/invoices/{invoice_id}/record-payment")
async def record_invoice_payment(invoice_id: str, req: Dict[str, Any]):
    amount = float(req.get("amount", 0))
    account_id = req.get("account_id")
    inv = await db.invoices.find_one({"_id": invoice_id})
    if not inv:
        raise HTTPException(status_code=404, detail="Fatura bulunamadı.")

    new_paid = inv.get("paid_amount", 0) + amount
    grand_total = inv.get("grand_total", 0)
    payment_status = "paid" if new_paid >= grand_total - 0.01 else "partially_paid"

    await db.invoices.update_one(
        {"_id": invoice_id},
        {"$set": {"paid_amount": new_paid, "payment_status": payment_status}}
    )

    if req.get("partner_id"):
        partner = await db.partners.find_one({"_id": req["partner_id"]})
        if not partner:
            raise HTTPException(status_code=404, detail="Ortak bulunamadı.")
        is_sales = inv.get("invoice_type") == "sales"
        tx_type = "withdrawal" if is_sales else "capital_in"
        inc = {"balance": -amount, "total_withdrawn": amount} if is_sales else {"balance": amount, "total_capital_in": amount}
        await db.partners.update_one({"_id": partner["_id"]}, {"$inc": inc})
        description = f"{inv.get('invoice_number')} nolu fatura {'tahsilatı ortak tarafından alındı' if is_sales else 'ödemesi ortak tarafından yapıldı'} / {inv.get('contact_name')}"
        ptx = PartnerTransaction(company_id=inv.get("company_id"), partner_id=partner["_id"], partner_name=partner["name"], type=tx_type, amount=amount,
                                 account_id=None, account_name="Ortaklar Hesabı", description=description, date=datetime.now(timezone.utc).strftime("%Y-%m-%d"))
        await db.partner_transactions.insert_one(ptx.to_mongo())
        await db.contacts.update_one({"_id": inv.get("contact_id")}, {"$inc": {"balance": -amount if is_sales else amount}})
        return {"status": "success", "paid_amount": new_paid, "payment_status": payment_status, "via": "partner"}

    if account_id:
        acc = await db.bank_accounts.find_one({"_id": account_id})
        acc_name = acc.get("account_name", "Banka") if acc else "Banka"
        await bank_guard.assert_manual_allowed(db, account_id)
        is_sales = inv.get("invoice_type") == "sales"
        
        await db.bank_accounts.update_one(
            {"_id": account_id},
            {"$inc": {"current_balance": amount if is_sales else -amount}}
        )

        await db.bank_transactions.insert_one({
            "_id": str(uuid.uuid4()),
            "company_id": inv.get("company_id"),
            "account_id": account_id,
            "account_name": acc_name,
            "type": "inflow" if is_sales else "outflow",
            "category": "Fatura Tahsilatı" if is_sales else "Fatura Ödemesi",
            "amount": amount,
            "currency": inv.get("currency", "TRY"),
            "description": f"{inv.get('invoice_number')} nolu fatura ödemesi / {inv.get('contact_name')}",
            "contact_id": inv.get("contact_id"),
            "contact_name": inv.get("contact_name"),
            "related_invoice_id": invoice_id,
            "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
            "created_at": datetime.now(timezone.utc).isoformat()
        })

        balance_change = -amount if is_sales else amount
        await db.contacts.update_one({"_id": inv.get("contact_id")}, {"$inc": {"balance": balance_change}})

    return {"status": "success", "paid_amount": new_paid, "payment_status": payment_status}

# ----------------- TAKSİT MODÜLÜ -----------------
def _add_interval(d: date, interval: str, n: int, interval_days: int = 30) -> date:
    if interval == "week":
        return d + timedelta(weeks=n)
    if interval == "days":
        return d + timedelta(days=interval_days * n)
    m = d.month - 1 + n
    y, m = d.year + m // 12, m % 12 + 1
    return date(y, m, min(d.day, monthrange(y, m)[1]))

def _build_plan(total: float, cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    count = max(1, int(cfg.get("count", 1)))
    down = round(float(cfg.get("down_payment", 0) or 0), 2)
    interval = cfg.get("interval", "month")
    interval_days = int(cfg.get("interval_days", 30) or 30)
    first = date.fromisoformat(cfg.get("first_due_date") or datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    remaining = round(total - down, 2)
    if remaining < 0:
        raise HTTPException(status_code=400, detail="Peşinat toplam tutardan büyük olamaz.")
    rows = []
    if down > 0:
        rows.append({"no": 0, "label": "Peşinat", "due_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "amount": down})
    per = round(remaining / count, 2) if count else 0
    for i in range(count):
        amt = per if i < count - 1 else round(remaining - per * (count - 1), 2)
        rows.append({"no": i + 1, "label": f"{i + 1}. Taksit", "due_date": _add_interval(first, interval, i, interval_days).isoformat(), "amount": amt})
    return rows

def _decorate_installment(d: Dict[str, Any]) -> Dict[str, Any]:
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    d = clean_doc(d)
    d["is_overdue"] = d.get("status") != "paid" and d.get("due_date", "") < today
    d["days_left"] = (date.fromisoformat(d["due_date"]) - date.fromisoformat(today)).days if d.get("due_date") else None
    return d

async def _create_invoice_installments(inv: Dict[str, Any], cfg: Dict[str, Any]) -> List[Dict[str, Any]]:
    rows = _build_plan(inv.get("grand_total", 0) - inv.get("paid_amount", 0), cfg)
    now = datetime.now(timezone.utc).isoformat()
    docs = [{"_id": str(uuid.uuid4()), "company_id": inv["company_id"], "invoice_id": inv["_id"], "invoice_number": inv.get("invoice_number"), "invoice_type": inv.get("invoice_type"),
             "direction": "receivable" if inv.get("invoice_type") == "sales" else "payable", "contact_id": inv.get("contact_id"), "contact_name": inv.get("contact_name"),
             "no": r["no"], "label": r["label"], "total_count": len(rows), "due_date": r["due_date"], "amount": r["amount"], "paid_amount": 0, "status": "pending", "created_at": now} for r in rows]
    if docs:
        await db.installments.insert_many(docs)
    await db.invoices.update_one({"_id": inv["_id"]}, {"$set": {"installment_plan": {"count": len(rows), "paid_count": 0, "config": cfg, "created_at": now}}})
    return [_decorate_installment(d) for d in docs]

@api_router.post("/installments/preview")
async def preview_installments(req: Dict[str, Any]):
    return _build_plan(float(req.get("total", 0)), req)

@api_router.get("/invoices/{invoice_id}/installments")
async def list_invoice_installments(invoice_id: str):
    rows = await db.installments.find({"invoice_id": invoice_id}).sort("no", 1).to_list(200)
    return [_decorate_installment(r) for r in rows]

@api_router.post("/invoices/{invoice_id}/installments")
async def create_invoice_installments(invoice_id: str, req: Dict[str, Any]):
    inv = await db.invoices.find_one({"_id": invoice_id})
    if not inv:
        raise HTTPException(status_code=404, detail="Fatura bulunamadı.")
    if await db.installments.count_documents({"invoice_id": invoice_id, "status": "paid"}) > 0:
        raise HTTPException(status_code=400, detail="Ödenmiş taksiti olan plan yeniden oluşturulamaz.")
    await db.installments.delete_many({"invoice_id": invoice_id})
    return await _create_invoice_installments(inv, req)

@api_router.delete("/invoices/{invoice_id}/installments")
async def delete_invoice_installments(invoice_id: str):
    if await db.installments.count_documents({"invoice_id": invoice_id, "status": "paid"}) > 0:
        raise HTTPException(status_code=400, detail="Ödenmiş taksiti olan plan silinemez.")
    await db.installments.delete_many({"invoice_id": invoice_id})
    await db.invoices.update_one({"_id": invoice_id}, {"$unset": {"installment_plan": ""}})
    return {"status": "success"}

@api_router.get("/installments")
async def list_installments(company_id: Optional[str] = "comp_nexus_main_01", status: Optional[str] = None, contact_id: Optional[str] = None, direction: Optional[str] = None):
    query: Dict[str, Any] = {"company_id": company_id}
    if contact_id:
        query["contact_id"] = contact_id
    if direction:
        query["direction"] = direction
    rows = [_decorate_installment(r) for r in await db.installments.find(query).sort("due_date", 1).to_list(2000)]
    if status == "paid":
        rows = [r for r in rows if r["status"] == "paid"]
    elif status == "overdue":
        rows = [r for r in rows if r["is_overdue"]]
    elif status == "pending":
        rows = [r for r in rows if r["status"] != "paid"]
    return rows

@api_router.get("/installments/summary")
async def installments_summary(company_id: Optional[str] = "comp_nexus_main_01"):
    rows = [_decorate_installment(r) for r in await db.installments.find({"company_id": company_id}).to_list(5000)]
    today = datetime.now(timezone.utc)
    month = today.strftime("%Y-%m")
    def s(f): return round(sum(r["amount"] - r.get("paid_amount", 0) for r in rows if f(r)), 2)
    return {"total_count": len(rows),
            "overdue": {"count": sum(1 for r in rows if r["is_overdue"]), "amount": s(lambda r: r["is_overdue"])},
            "this_month": {"count": sum(1 for r in rows if r["status"] != "paid" and r["due_date"].startswith(month)), "amount": s(lambda r: r["status"] != "paid" and r["due_date"].startswith(month))},
            "pending_receivable": s(lambda r: r["status"] != "paid" and r["direction"] == "receivable"),
            "pending_payable": s(lambda r: r["status"] != "paid" and r["direction"] == "payable"),
            "paid_total": round(sum(r.get("paid_amount", 0) for r in rows), 2)}

@api_router.post("/installments/{inst_id}/pay")
async def pay_installment(inst_id: str, req: Dict[str, Any]):
    inst = await db.installments.find_one({"_id": inst_id})
    if not inst:
        raise HTTPException(status_code=404, detail="Taksit bulunamadı.")
    if inst.get("status") == "paid":
        raise HTTPException(status_code=400, detail="Bu taksit zaten ödenmiş.")
    remaining = round(inst["amount"] - inst.get("paid_amount", 0), 2)
    amount = round(float(req.get("amount") or remaining), 2)
    if amount <= 0 or amount > remaining + 0.01:
        raise HTTPException(status_code=400, detail=f"Tutar 0 ile {remaining} arasında olmalı.")
    if inst.get("invoice_id"):
        result = await record_invoice_payment(inst["invoice_id"], {"amount": amount, "account_id": req.get("account_id"), "partner_id": req.get("partner_id")})
    else:
        is_recv = inst.get("direction") == "receivable"
        if req.get("partner_id"):
            partner = await db.partners.find_one({"_id": req["partner_id"]})
            if not partner:
                raise HTTPException(status_code=404, detail="Ortak bulunamadı.")
            inc = {"balance": -amount, "total_withdrawn": amount} if is_recv else {"balance": amount, "total_capital_in": amount}
            await db.partners.update_one({"_id": partner["_id"]}, {"$inc": inc})
            ptx = PartnerTransaction(company_id=inst["company_id"], partner_id=partner["_id"], partner_name=partner["name"], type="withdrawal" if is_recv else "capital_in", amount=amount, account_id=None, account_name="Ortaklar Hesabı",
                                     description=f"{inst.get('contact_name')} bakiye {inst['label']} ortak tarafından {'tahsil edildi' if is_recv else 'ödendi'}", date=datetime.now(timezone.utc).strftime("%Y-%m-%d"))
            await db.partner_transactions.insert_one(ptx.to_mongo())
        else:
            acc = await db.bank_accounts.find_one({"_id": req.get("account_id")})
            if not acc:
                raise HTTPException(status_code=404, detail="Hesap bulunamadı.")
            await bank_guard.assert_manual_allowed(db, acc["_id"])
            tx = BankTransaction(company_id=inst["company_id"], account_id=acc["_id"], account_name=acc.get("account_name", "Banka"), type="inflow" if is_recv else "outflow", category="Taksit Tahsilatı" if is_recv else "Taksit Ödemesi",
                                 amount=amount, description=f"{inst.get('contact_name')} • Açık bakiye {inst['label']}", contact_id=inst["contact_id"], contact_name=inst.get("contact_name"))
            await db.bank_transactions.insert_one(tx.to_mongo())
            await db.bank_accounts.update_one({"_id": acc["_id"]}, {"$inc": {"current_balance": amount if is_recv else -amount}})
        await db.contacts.update_one({"_id": inst["contact_id"]}, {"$inc": {"balance": -amount if is_recv else amount}})
        result = {"status": "success", "kind": "balance"}
    new_paid = round(inst.get("paid_amount", 0) + amount, 2)
    status = "paid" if new_paid >= inst["amount"] - 0.01 else "partial"
    await db.installments.update_one({"_id": inst_id}, {"$set": {"paid_amount": new_paid, "status": status, "paid_at": datetime.now(timezone.utc).isoformat() if status == "paid" else None, "account_id": req.get("account_id")}})
    if inst.get("invoice_id"):
        paid_count = await db.installments.count_documents({"invoice_id": inst["invoice_id"], "status": "paid"})
        await db.invoices.update_one({"_id": inst["invoice_id"]}, {"$set": {"installment_plan.paid_count": paid_count}})
    return {"status": "success", "installment_status": status, "invoice_payment": result, "message": f"{inst['label']} için {amount:,.2f} ₺ {'tahsil edildi' if inst.get('direction') == 'receivable' else 'ödendi'}."}

@api_router.post("/quotes/{quote_id}/payment-plan")
async def set_quote_payment_plan(quote_id: str, req: Dict[str, Any]):
    q = await db.quotes.find_one({"_id": quote_id})
    if not q:
        raise HTTPException(status_code=404, detail="Teklif bulunamadı.")
    if req.get("remove"):
        await db.quotes.update_one({"_id": quote_id}, {"$unset": {"payment_plan": ""}})
        return {"status": "success", "payment_plan": None}
    rows = _build_plan(q.get("grand_total", 0), req)
    plan = {"config": {k: req.get(k) for k in ("count", "down_payment", "interval", "interval_days", "first_due_date")}, "rows": rows}
    await db.quotes.update_one({"_id": quote_id}, {"$set": {"payment_plan": plan}})
    return {"status": "success", "payment_plan": plan}

# ----------------- RAPORLAR -----------------
def _in_range(d: Optional[str], f: Optional[str], t: Optional[str]) -> bool:
    return bool(d) and (not f or d >= f) and (not t or d <= t)

@api_router.get("/reports/{kind}")
async def get_report(kind: str, company_id: Optional[str] = "comp_nexus_main_01", date_from: Optional[str] = None, date_to: Optional[str] = None, group: Optional[str] = "contact"):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    invs = [i for i in await db.invoices.find({"company_id": company_id, "status": {"$ne": "cancelled"}}).to_list(20000) if _in_range(i.get("issue_date"), date_from, date_to)]
    R = lambda v: round(float(v or 0), 2)
    if kind in ("sales", "purchases"):
        t = "sales" if kind == "sales" else "purchase"
        sel = [i for i in invs if i.get("invoice_type") == t]
        buckets: Dict[str, Dict[str, Any]] = {}
        for i in sel:
            if group == "month":
                key = (i.get("issue_date") or "")[:7]
            elif group == "product":
                for it in i.get("items", []):
                    k = it.get("name") or it.get("product_name") or "-"
                    x = buckets.setdefault(k, {"name": k, "count": 0, "quantity": 0.0, "net": 0.0, "vat": 0.0, "gross": 0.0})
                    x["count"] += 1; x["quantity"] += float(it.get("quantity", 0)); x["net"] += float(it.get("total", 0)); vat = float(it.get("total", 0)) * float(it.get("vat_rate", 20)) / 100; x["vat"] += vat; x["gross"] += float(it.get("total", 0)) + vat
                continue
            else:
                key = i.get("contact_name") or "-"
            x = buckets.setdefault(key, {"name": key, "count": 0, "quantity": 0.0, "net": 0.0, "vat": 0.0, "gross": 0.0, "paid": 0.0})
            x["count"] += 1; x["quantity"] += sum(float(it.get("quantity", 0)) for it in i.get("items", [])); x["net"] += float(i.get("subtotal", 0)); x["vat"] += float(i.get("vat_total", 0)); x["gross"] += float(i.get("grand_total", 0)); x["paid"] += float(i.get("paid_amount", 0))
        rows = sorted([{k: (R(v) if isinstance(v, float) else v) for k, v in b.items()} for b in buckets.values()], key=lambda r: -r["gross"])
        tot = {"count": sum(r["count"] for r in rows), "net": R(sum(r["net"] for r in rows)), "vat": R(sum(r["vat"] for r in rows)), "gross": R(sum(r["gross"] for r in rows)), "paid": R(sum(r.get("paid", 0) for r in rows))}
        return {"kind": kind, "group": group, "rows": rows, "totals": {**tot, "open": R(tot["gross"] - tot["paid"])}}
    if kind == "aging":
        contacts = {c["_id"]: c for c in await db.contacts.find({"company_id": company_id}).to_list(5000)}
        rows: Dict[str, Dict[str, Any]] = {}
        for i in await db.invoices.find({"company_id": company_id, "payment_status": {"$ne": "paid"}, "status": {"$nin": ["cancelled", "draft"]}}).to_list(20000):
            rem = float(i.get("grand_total", 0)) - float(i.get("paid_amount", 0))
            if rem <= 0.01:
                continue
            due = i.get("due_date") or i.get("issue_date") or today
            days = (date.fromisoformat(today) - date.fromisoformat(due)).days
            b = "not_due" if days <= 0 else "d1_30" if days <= 30 else "d31_60" if days <= 60 else "d61_90" if days <= 90 else "d90p"
            x = rows.setdefault(i.get("contact_id") or "-", {"name": i.get("contact_name") or "-", "type": "receivable" if i.get("invoice_type") == "sales" else "payable", "not_due": 0.0, "d1_30": 0.0, "d31_60": 0.0, "d61_90": 0.0, "d90p": 0.0, "total": 0.0, "invoices": 0, "phone": contacts.get(i.get("contact_id"), {}).get("phone")})
            x[b] += rem; x["total"] += rem; x["invoices"] += 1
        out = sorted([{k: (R(v) if isinstance(v, float) else v) for k, v in r.items()} for r in rows.values()], key=lambda r: -r["total"])
        keys = ["not_due", "d1_30", "d31_60", "d61_90", "d90p", "total"]
        return {"kind": kind, "rows": out, "totals": {k: R(sum(r[k] for r in out if r["type"] == "receivable")) for k in keys}, "totals_payable": {k: R(sum(r[k] for r in out if r["type"] == "payable")) for k in keys}}
    if kind == "stock":
        prods = await db.products.find({"company_id": company_id, "type": {"$ne": "service"}}).to_list(20000)
        rows = [{"name": p.get("name"), "sku": p.get("sku"), "category": p.get("category"), "unit": p.get("unit"), "quantity": R(p.get("stock_quantity", 0)), "min": R(p.get("min_stock_alert", 0)), "cost": R(p.get("purchase_price", 0)), "price": R(p.get("sale_price", 0)), "cost_value": R(float(p.get("stock_quantity", 0)) * float(p.get("purchase_price", 0))), "sale_value": R(float(p.get("stock_quantity", 0)) * float(p.get("sale_price", 0))), "status": "critical" if float(p.get("stock_quantity", 0)) <= 0 else "low" if float(p.get("stock_quantity", 0)) <= float(p.get("min_stock_alert", 0) or 0) else "ok"} for p in prods]
        rows.sort(key=lambda r: -r["cost_value"])
        return {"kind": kind, "rows": rows, "totals": {"count": len(rows), "cost_value": R(sum(r["cost_value"] for r in rows)), "sale_value": R(sum(r["sale_value"] for r in rows)), "critical": sum(1 for r in rows if r["status"] == "critical"), "low": sum(1 for r in rows if r["status"] == "low")}}
    if kind == "cashflow":
        txs = [t for t in await db.bank_transactions.find({"company_id": company_id}).to_list(50000) if _in_range(t.get("date"), date_from, date_to) and t.get("type") != "transfer"]
        months: Dict[str, Dict[str, Any]] = {}
        cats: Dict[str, Dict[str, Any]] = {}
        for t in txs:
            m = months.setdefault(t["date"][:7], {"name": t["date"][:7], "inflow": 0.0, "outflow": 0.0, "net": 0.0})
            c = cats.setdefault(t.get("category") or "Diğer", {"name": t.get("category") or "Diğer", "inflow": 0.0, "outflow": 0.0, "net": 0.0})
            for x in (m, c):
                x["inflow" if t["type"] == "inflow" else "outflow"] += float(t.get("amount", 0)); x["net"] = x["inflow"] - x["outflow"]
        accounts = await db.bank_accounts.find({"company_id": company_id}).to_list(200)
        upcoming = [i for i in await db.invoices.find({"company_id": company_id, "payment_status": {"$ne": "paid"}, "status": {"$nin": ["cancelled", "draft"]}}).to_list(20000)]
        rec = R(sum(float(i.get("grand_total", 0)) - float(i.get("paid_amount", 0)) for i in upcoming if i.get("invoice_type") == "sales"))
        pay = R(sum(float(i.get("grand_total", 0)) - float(i.get("paid_amount", 0)) for i in upcoming if i.get("invoice_type") != "sales"))
        fin = lambda d: sorted([{k: (R(v) if isinstance(v, float) else v) for k, v in x.items()} for x in d.values()], key=lambda r: r["name"])
        return {"kind": kind, "rows": fin(months), "categories": sorted(fin(cats), key=lambda r: r["net"]), "totals": {"inflow": R(sum(x["inflow"] for x in months.values())), "outflow": R(sum(x["outflow"] for x in months.values())), "net": R(sum(x["net"] for x in months.values())), "cash_now": R(sum(float(a.get("current_balance", 0)) for a in accounts)), "expected_in": rec, "expected_out": pay, "projected": R(sum(float(a.get("current_balance", 0)) for a in accounts) + rec - pay)}}
    if kind == "vat":
        by: Dict[str, Dict[str, Any]] = {}
        for i in invs:
            if i.get("status") == "draft":
                continue
            key = (i.get("issue_date") or "")[:7]
            x = by.setdefault(key, {"name": key, "sales_net": 0.0, "sales_vat": 0.0, "purchase_net": 0.0, "purchase_vat": 0.0, "payable_vat": 0.0})
            if i.get("invoice_type") == "sales":
                x["sales_net"] += float(i.get("subtotal", 0)); x["sales_vat"] += float(i.get("vat_total", 0))
            else:
                x["purchase_net"] += float(i.get("subtotal", 0)); x["purchase_vat"] += float(i.get("vat_total", 0))
            x["payable_vat"] = x["sales_vat"] - x["purchase_vat"]
        rows = sorted([{k: (R(v) if isinstance(v, float) else v) for k, v in x.items()} for x in by.values()], key=lambda r: r["name"])
        rates: Dict[str, Dict[str, Any]] = {}
        for i in invs:
            for it in i.get("items", []):
                r = f"%{int(float(it.get('vat_rate', 20)))}"
                x = rates.setdefault(r, {"name": r, "sales_net": 0.0, "sales_vat": 0.0, "purchase_net": 0.0, "purchase_vat": 0.0})
                k = "sales" if i.get("invoice_type") == "sales" else "purchase"
                x[f"{k}_net"] += float(it.get("total", 0)); x[f"{k}_vat"] += float(it.get("total", 0)) * float(it.get("vat_rate", 20)) / 100
        return {"kind": kind, "rows": rows, "by_rate": [{k: (R(v) if isinstance(v, float) else v) for k, v in x.items()} for x in rates.values()], "totals": {k: R(sum(r[k] for r in rows)) for k in ("sales_net", "sales_vat", "purchase_net", "purchase_vat", "payable_vat")}}
    if kind == "profit":
        prods = {p["_id"]: p for p in await db.products.find({"company_id": company_id}).to_list(20000)}
        by: Dict[str, Dict[str, Any]] = {}
        for i in invs:
            if i.get("invoice_type") != "sales" or i.get("status") == "draft":
                continue
            for it in i.get("items", []):
                key = it.get("name") or it.get("product_name") or "-" if group == "product" else (i.get("contact_name") or "-") if group == "contact" else (i.get("issue_date") or "")[:7]
                cost_unit = float(it.get("cost_price") or prods.get(it.get("product_id"), {}).get("purchase_price", 0) or 0)
                x = by.setdefault(key, {"name": key, "quantity": 0.0, "revenue": 0.0, "cost": 0.0, "profit": 0.0, "margin": 0.0})
                x["quantity"] += float(it.get("quantity", 0)); x["revenue"] += float(it.get("total", 0)); x["cost"] += cost_unit * float(it.get("quantity", 0))
                x["profit"] = x["revenue"] - x["cost"]; x["margin"] = (x["profit"] / x["revenue"] * 100) if x["revenue"] else 0
        rows = sorted([{k: (R(v) if isinstance(v, float) else v) for k, v in x.items()} for x in by.values()], key=lambda r: -r["profit"])
        rev, cost = R(sum(r["revenue"] for r in rows)), R(sum(r["cost"] for r in rows))
        eq: Dict[str, Any] = {"company_id": company_id}
        if date_from or date_to:
            eq["date"] = {k: v for k, v in (("$gte", date_from), ("$lte", date_to)) if v}
        expenses_total = R(sum(e.get("amount", 0) for e in await db.expenses.find(eq, {"amount": 1}).to_list(10000)))
        net = R(rev - cost - expenses_total)
        return {"kind": kind, "group": group, "rows": rows, "totals": {"revenue": rev, "cost": cost, "profit": R(rev - cost), "margin": R((rev - cost) / rev * 100) if rev else 0, "expenses": expenses_total, "net_profit": net, "net_margin": R(net / rev * 100) if rev else 0}}
    raise HTTPException(status_code=404, detail="Rapor türü bulunamadı.")

# ----------------- BANKA, KASA, POS & VİRMAN -----------------
@api_router.get("/banking/accounts")
async def list_bank_accounts(company_id: Optional[str] = "comp_nexus_main_01"):
    accounts = await db.bank_accounts.find({"company_id": company_id}).to_list(100)
    conns = {c["linked_account_id"]: c for c in await db.bank_connections.find({"company_id": company_id}).to_list(100)}
    out = []
    for a in clean_docs(accounts):
        conn = conns.get(a["id"])
        out.append({**a, "is_integrated": bool(conn), "integration_provider": conn.get("provider_name") if conn else None, "connection_id": conn["_id"] if conn else None})
    return out

@api_router.post("/banking/accounts")
async def create_bank_account(account: BankAccount):
    doc = account.to_mongo()
    await db.bank_accounts.insert_one(doc)
    return clean_doc(doc)

@api_router.put("/banking/accounts/{account_id}")
async def update_bank_account(account_id: str, req: Dict[str, Any]):
    acc = await db.bank_accounts.find_one({"_id": account_id})
    if not acc:
        raise HTTPException(status_code=404, detail="Hesap bulunamadı.")
    allowed_keys = ("bank_name", "account_name", "account_number", "iban", "currency", "type", "pos_commission_rate", "card_limit")
    allowed = {k: v for k, v in req.items() if k in allowed_keys and v is not None}
    if "type" in allowed and allowed["type"] not in ("bank", "cash_box", "pos", "credit_card"):
        raise HTTPException(status_code=400, detail="Geçersiz hesap türü.")
    if "current_balance" in req:
        if await db.bank_transactions.count_documents({"$or": [{"account_id": account_id}, {"target_account_id": account_id}]}):
            raise HTTPException(status_code=400, detail="Hareketi olan hesabın bakiyesi buradan değiştirilemez.")
        allowed["current_balance"] = float(req["current_balance"] or 0)
    if not allowed:
        return clean_doc(acc)
    await db.bank_accounts.update_one({"_id": account_id}, {"$set": allowed})
    return clean_doc(await db.bank_accounts.find_one({"_id": account_id}))

@api_router.get("/banking/transactions")
async def list_bank_transactions(company_id: Optional[str] = "comp_nexus_main_01", account_id: Optional[str] = None):
    query = {"company_id": company_id}
    if account_id:
        query["account_id"] = account_id
    txs = await db.bank_transactions.find(query).sort("date", -1).to_list(500)
    return clean_docs(txs)

@api_router.post("/banking/transactions")
async def create_bank_transaction(tx: BankTransaction):
    await bank_guard.assert_manual_allowed(db, tx.account_id)
    doc = tx.to_mongo()
    await db.bank_transactions.insert_one(doc)

    change = tx.amount if tx.type == "inflow" else -tx.amount
    await db.bank_accounts.update_one({"_id": tx.account_id}, {"$inc": {"current_balance": change}})

    if tx.contact_id:
        c_change = -tx.amount if tx.type == "inflow" else tx.amount
        await db.contacts.update_one({"_id": tx.contact_id}, {"$inc": {"balance": c_change}})

    return clean_doc(doc)

async def _reverse_tx_effects(tx: Dict[str, Any], sign: int = -1):
    """sign=-1 geri alır, sign=+1 uygular."""
    amt = float(tx.get("amount", 0)) * sign
    if tx.get("type") == "transfer":
        await db.bank_accounts.update_one({"_id": tx["account_id"]}, {"$inc": {"current_balance": -amt}})
        if tx.get("target_account_id"):
            await db.bank_accounts.update_one({"_id": tx["target_account_id"]}, {"$inc": {"current_balance": amt}})
        return
    change = amt if tx.get("type") == "inflow" else -amt
    await db.bank_accounts.update_one({"_id": tx["account_id"]}, {"$inc": {"current_balance": change}})
    if tx.get("contact_id"):
        await db.contacts.update_one({"_id": tx["contact_id"]}, {"$inc": {"balance": -change}})
    if tx.get("related_invoice_id"):
        inv = await db.invoices.find_one({"_id": tx["related_invoice_id"]})
        if inv:
            new_paid = round(max(0.0, inv.get("paid_amount", 0) + amt), 2)
            ps = "paid" if new_paid >= inv.get("grand_total", 0) - 0.01 else "partially_paid" if new_paid > 0 else "unpaid"
            await db.invoices.update_one({"_id": inv["_id"]}, {"$set": {"paid_amount": new_paid, "payment_status": ps}})

def _assert_editable_tx(tx: Dict[str, Any]):
    if not tx:
        raise HTTPException(status_code=404, detail="Hareket bulunamadı.")
    if tx.get("source") in ("bank_sync", "partner", "bank_match"):
        raise HTTPException(status_code=400, detail="Banka entegrasyonundan / ortaklar hesabından gelen hareketler düzenlenemez veya silinemez. Banka eşleşmesini geri almak için Eşleşenler listesini kullanın.")

@api_router.put("/banking/transactions/{tx_id}")
async def update_bank_transaction(tx_id: str, req: Dict[str, Any]):
    tx = await db.bank_transactions.find_one({"_id": tx_id})
    _assert_editable_tx(tx)
    allowed = {k: v for k, v in req.items() if k in {"amount", "date", "description", "category", "account_id", "type"}}
    if "amount" in allowed:
        allowed["amount"] = float(allowed["amount"])
        if allowed["amount"] <= 0:
            raise HTTPException(status_code=400, detail="Tutar sıfırdan büyük olmalı.")
    if "account_id" in allowed and allowed["account_id"] != tx.get("account_id"):
        acc = await db.bank_accounts.find_one({"_id": allowed["account_id"]})
        if not acc:
            raise HTTPException(status_code=404, detail="Hesap bulunamadı.")
        allowed["account_name"] = acc.get("account_name")
    await _reverse_tx_effects(tx, -1)
    new_tx = {**tx, **allowed}
    await _reverse_tx_effects(new_tx, +1)
    await db.bank_transactions.update_one({"_id": tx_id}, {"$set": allowed})
    return clean_doc(await db.bank_transactions.find_one({"_id": tx_id}))

@api_router.delete("/banking/transactions/{tx_id}")
async def delete_bank_transaction(tx_id: str):
    tx = await db.bank_transactions.find_one({"_id": tx_id})
    _assert_editable_tx(tx)
    await _reverse_tx_effects(tx, -1)
    await trash.soft_delete("bank_transactions", tx, "bank_transaction", f"{tx.get('description')} · {float(tx.get('amount') or 0):,.2f} ₺", note=f"{tx.get('account_name')} · {tx.get('date')}")
    return {"status": "success", "message": "Hareket çöp kutusuna taşındı, bakiyeler geri alındı."}

async def _execute_virman(req: Dict[str, Any]):
    source_id = req.get("source_account_id")
    target_id = req.get("target_account_id")
    amount = float(req.get("amount", 0))
    description = req.get("description", "Hesaplar Arası Virman Transferi")
    company_id = req.get("company_id", "comp_nexus_main_01")

    source_acc = await db.bank_accounts.find_one({"_id": source_id})
    target_acc = await db.bank_accounts.find_one({"_id": target_id})

    if not source_acc or not target_acc:
        raise HTTPException(status_code=404, detail="Kaynak veya hedef hesap bulunamadı.")
    await bank_guard.assert_manual_allowed(db, source_id)
    await bank_guard.assert_manual_allowed(db, target_id)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Tutar sıfırdan büyük olmalıdır.")

    await db.bank_accounts.update_one({"_id": source_id}, {"$inc": {"current_balance": -amount}})
    await db.bank_accounts.update_one({"_id": target_id}, {"$inc": {"current_balance": amount}})

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    await db.bank_transactions.insert_one({
        "_id": str(uuid.uuid4()),
        "company_id": company_id,
        "account_id": source_id,
        "account_name": source_acc.get("account_name"),
        "type": "transfer",
        "category": "Virman Çıkışı",
        "amount": amount,
        "currency": source_acc.get("currency", "TRY"),
        "description": f"Virman -> {target_acc.get('account_name')}: {description}",
        "target_account_id": target_id,
        "target_account_name": target_acc.get("account_name"),
        "date": today,
        "created_at": datetime.now(timezone.utc).isoformat()
    })

    return {"status": "success", "message": f"{amount:,.2f} TL tutarındaki virman işlemi tamamlandı."}


@api_router.post("/banking/virman")
async def perform_virman(req: Dict[str, Any], request: Request):
    company_id = req.get("company_id", "comp_nexus_main_01")
    if float(req.get("amount") or 0) <= 0:
        raise HTTPException(status_code=400, detail="Tutar sıfırdan büyük olmalıdır.")
    user = await get_current_user(request)
    pending = await cash_approval.maybe_queue(
        db, company_id=company_id, kind="virman", payload=req,
        account_ids=[req.get("source_account_id"), req.get("target_account_id")],
        summary=f"Virman {float(req.get('amount') or 0):,.2f} ₺",
        user=user,
    )
    if pending:
        return pending
    return await _execute_virman(req)

# ----------------- ORTAKLAR HESABI -----------------
@api_router.get("/banking/partners")
async def list_partners(company_id: Optional[str] = "comp_nexus_main_01"):
    partners = await db.partners.find({"company_id": company_id}).sort("created_at", 1).to_list(100)
    return clean_docs(partners)

@api_router.get("/banking/partners/summary")
async def partners_summary(company_id: Optional[str] = "comp_nexus_main_01"):
    partners = await db.partners.find({"company_id": company_id}).to_list(100)
    return {
        "partner_count": len(partners),
        "total_share_percent": sum(p.get("share_percent", 0) for p in partners),
        "total_balance": sum(p.get("balance", 0) for p in partners),
        "total_capital_in": sum(p.get("total_capital_in", 0) for p in partners),
        "total_withdrawn": sum(p.get("total_withdrawn", 0) for p in partners),
        "total_profit_share": sum(p.get("total_profit_share", 0) for p in partners),
    }

@api_router.post("/banking/partners")
async def create_partner(partner: Partner):
    existing = await db.partners.find({"company_id": partner.company_id}).to_list(100)
    if sum(p.get("share_percent", 0) for p in existing) + partner.share_percent > 100.01:
        raise HTTPException(status_code=400, detail="Toplam ortaklık payı %100'ü aşamaz.")
    doc = partner.to_mongo()
    await db.partners.insert_one(doc)
    return clean_doc(doc)

@api_router.put("/banking/partners/{partner_id}")
async def update_partner(partner_id: str, updated: Dict[str, Any]):
    allowed = {k: v for k, v in updated.items() if k in {"name", "share_percent", "phone", "email", "is_active"}}
    await db.partners.update_one({"_id": partner_id}, {"$set": allowed})
    res = await db.partners.find_one({"_id": partner_id})
    if not res:
        raise HTTPException(status_code=404, detail="Ortak bulunamadı.")
    return clean_doc(res)

@api_router.delete("/banking/partners/{partner_id}")
async def delete_partner(partner_id: str):
    p = await db.partners.find_one({"_id": partner_id})
    if not p:
        raise HTTPException(status_code=404, detail="Ortak bulunamadı.")
    if abs(p.get("balance", 0)) > 0.01:
        raise HTTPException(status_code=400, detail="Bakiyesi sıfır olmayan ortak silinemez.")
    await trash.soft_delete("partners", p, "partner", p.get("name"))
    return {"status": "success", "message": "Ortak çöp kutusuna taşındı."}

@api_router.get("/banking/partners/transactions")
async def list_partner_transactions(company_id: Optional[str] = "comp_nexus_main_01", partner_id: Optional[str] = None):
    query = {"company_id": company_id}
    if partner_id:
        query["partner_id"] = partner_id
    txs = await db.partner_transactions.find(query).sort("created_at", -1).to_list(500)
    return clean_docs(txs)

PARTNER_TX_LABELS = {"capital_in": "Ortak Sermaye Girişi", "withdrawal": "Ortak Para Çekişi", "profit_share": "Ortak Kâr Payı Ödemesi"}

async def _post_partner_cash_movement(company_id: str, account_id: str, tx_type: str, amount: float, partner_name: str, description: str, date: str, partner_tx_id: Optional[str] = None):
    acc = await db.bank_accounts.find_one({"_id": account_id})
    if not acc:
        raise HTTPException(status_code=404, detail="Kasa/Banka hesabı bulunamadı.")
    await bank_guard.assert_manual_allowed(db, account_id)
    inflow = tx_type == "capital_in"
    await db.bank_accounts.update_one({"_id": account_id}, {"$inc": {"current_balance": amount if inflow else -amount}})
    await db.bank_transactions.insert_one({
        "_id": str(uuid.uuid4()),
        "company_id": company_id,
        "account_id": account_id,
        "account_name": acc.get("account_name"),
        "type": "inflow" if inflow else "outflow",
        "category": PARTNER_TX_LABELS[tx_type],
        "amount": amount,
        "currency": acc.get("currency", "TRY"),
        "description": f"{partner_name}: {description}",
        "source": "partner",
        "partner_tx_id": partner_tx_id,
        "date": date,
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    return acc.get("account_name")

async def _reverse_partner_tx(tx: dict):
    """Undo balance + bank movement effects of a capital_in / withdrawal partner transaction."""
    amount = float(tx.get("amount", 0))
    if tx["type"] == "capital_in":
        await db.partners.update_one({"_id": tx["partner_id"]}, {"$inc": {"balance": -amount, "total_capital_in": -amount}})
    elif tx["type"] == "withdrawal":
        await db.partners.update_one({"_id": tx["partner_id"]}, {"$inc": {"balance": amount, "total_withdrawn": -amount}})
    elif tx["type"] == "profit_share":
        await db.partners.update_one({"_id": tx["partner_id"]}, {"$inc": {"total_profit_share": -amount, **({"balance": amount} if tx.get("is_paid") else {})}})
    if tx.get("account_id") and (tx["type"] != "profit_share" or tx.get("is_paid")):
        bt = await db.bank_transactions.find_one({"partner_tx_id": tx["_id"]}) or await db.bank_transactions.find_one({"source": "partner", "account_id": tx["account_id"], "amount": amount, "date": tx.get("date"), "description": {"$regex": f"^{re.escape(tx.get('partner_name', ''))}"}})
        if bt:
            inflow = bt.get("type") == "inflow"
            await db.bank_accounts.update_one({"_id": bt["account_id"]}, {"$inc": {"current_balance": -amount if inflow else amount}})
            await db.bank_transactions.delete_one({"_id": bt["_id"]})

@api_router.put("/banking/partners/transactions/{tx_id}")
async def update_partner_transaction(tx_id: str, req: Dict[str, Any]):
    tx = await db.partner_transactions.find_one({"_id": tx_id})
    if not tx:
        raise HTTPException(status_code=404, detail="Hareket bulunamadı.")
    if tx["type"] == "profit_share":
        raise HTTPException(status_code=400, detail="Kâr payı kayıtları düzenlenemez; silip yeniden dağıtın.")
    amount = float(req.get("amount", tx["amount"]))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Tutar sıfırdan büyük olmalıdır.")
    date = req.get("date") or tx.get("date")
    description = req.get("description") if req.get("description") is not None else tx.get("description")
    account_id = req.get("account_id") or tx.get("account_id")
    await _reverse_partner_tx(tx)
    account_name = await _post_partner_cash_movement(tx["company_id"], account_id, tx["type"], amount, tx["partner_name"], description, date, partner_tx_id=tx_id)
    inc = {"balance": amount, "total_capital_in": amount} if tx["type"] == "capital_in" else {"balance": -amount, "total_withdrawn": amount}
    await db.partners.update_one({"_id": tx["partner_id"]}, {"$inc": inc})
    await db.partner_transactions.update_one({"_id": tx_id}, {"$set": {"amount": amount, "date": date, "description": description, "account_id": account_id, "account_name": account_name, "updated_at": datetime.now(timezone.utc).isoformat()}})
    return clean_doc(await db.partner_transactions.find_one({"_id": tx_id}))

@api_router.delete("/banking/partners/transactions/{tx_id}")
async def delete_partner_transaction(tx_id: str):
    tx = await db.partner_transactions.find_one({"_id": tx_id})
    if not tx:
        raise HTTPException(status_code=404, detail="Hareket bulunamadı.")
    await _reverse_partner_tx(tx)
    await trash.soft_delete("partner_transactions", tx, "partner_transaction", f"{tx.get('partner_name')} · {PARTNER_TX_LABELS.get(tx.get('type'), tx.get('type'))} · {float(tx.get('amount') or 0):,.2f} ₺", note=tx.get("date") or "")
    return {"status": "success", "message": "Hareket çöp kutusuna taşındı; ortak ve hesap bakiyeleri geri alındı."}

async def _execute_partner_tx(req: Dict[str, Any]):
    partner = await db.partners.find_one({"_id": req.get("partner_id")})
    if not partner:
        raise HTTPException(status_code=404, detail="Ortak bulunamadı.")
    tx_type = req.get("type")
    if tx_type not in ("capital_in", "withdrawal"):
        raise HTTPException(status_code=400, detail="Geçersiz işlem türü.")
    amount = float(req.get("amount", 0))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Tutar sıfırdan büyük olmalıdır.")
    date = req.get("date") or datetime.now(timezone.utc).strftime("%Y-%m-%d")
    description = req.get("description") or PARTNER_TX_LABELS[tx_type]
    tx = PartnerTransaction(company_id=partner["company_id"], partner_id=partner["_id"], partner_name=partner["name"], type=tx_type,
                            amount=amount, account_id=req.get("account_id"), description=description, date=date)
    doc = tx.to_mongo()
    account_name = await _post_partner_cash_movement(partner["company_id"], req.get("account_id"), tx_type, amount, partner["name"], description, date, partner_tx_id=doc["_id"])
    doc["account_name"] = account_name

    inc = {"balance": amount, "total_capital_in": amount} if tx_type == "capital_in" else {"balance": -amount, "total_withdrawn": amount}
    await db.partners.update_one({"_id": partner["_id"]}, {"$inc": inc})
    await db.partner_transactions.insert_one(doc)
    return clean_doc(doc)


@api_router.post("/banking/partners/transactions")
async def create_partner_transaction(req: Dict[str, Any], request: Request):
    partner = await db.partners.find_one({"_id": req.get("partner_id")})
    if not partner:
        raise HTTPException(status_code=404, detail="Ortak bulunamadı.")
    if req.get("type") not in ("capital_in", "withdrawal"):
        raise HTTPException(status_code=400, detail="Geçersiz işlem türü.")
    if float(req.get("amount") or 0) <= 0:
        raise HTTPException(status_code=400, detail="Tutar sıfırdan büyük olmalıdır.")
    user = await get_current_user(request)
    label = PARTNER_TX_LABELS.get(req.get("type"), req.get("type") or "İşlem")
    pending = await cash_approval.maybe_queue(
        db, company_id=partner["company_id"], kind="partner_tx", payload=req,
        account_ids=[req.get("account_id")],
        summary=f"{partner.get('name')}: {label} {float(req.get('amount') or 0):,.2f} ₺",
        user=user,
    )
    if pending:
        return pending
    return await _execute_partner_tx(req)


async def _execute_distribute_profit(req: Dict[str, Any]):
    company_id = req.get("company_id", "comp_nexus_main_01")
    total_profit = float(req.get("total_profit", 0))
    if total_profit <= 0:
        raise HTTPException(status_code=400, detail="Dağıtılacak kâr sıfırdan büyük olmalıdır.")
    pay_now = bool(req.get("pay_now", False))
    account_id = req.get("account_id")
    if pay_now and not account_id:
        raise HTTPException(status_code=400, detail="Hemen ödeme için kaynak hesap seçin.")
    partners = await db.partners.find({"company_id": company_id, "is_active": True}).to_list(100)
    if not partners:
        raise HTTPException(status_code=400, detail="Aktif ortak bulunamadı.")
    total_share = sum(p.get("share_percent", 0) for p in partners)
    if total_share <= 0:
        raise HTTPException(status_code=400, detail="Ortaklık payları tanımlı değil.")
    period = req.get("period") or datetime.now(timezone.utc).strftime("%Y-%m")
    date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if pay_now:
        acc = await db.bank_accounts.find_one({"_id": account_id})
        if not acc:
            raise HTTPException(status_code=404, detail="Kaynak hesap bulunamadı.")
        await bank_guard.assert_manual_allowed(db, account_id)
        if acc.get("current_balance", 0) < total_profit:
            raise HTTPException(status_code=400, detail="Kaynak hesap bakiyesi yetersiz.")

    results = []
    for p in partners:
        share = round(total_profit * p.get("share_percent", 0) / total_share, 2)
        description = f"{period} dönemi kâr payı (%{p.get('share_percent')})"
        account_name = None
        if pay_now:
            account_name = await _post_partner_cash_movement(company_id, account_id, "profit_share", share, p["name"], description, date)
            await db.partners.update_one({"_id": p["_id"]}, {"$inc": {"total_profit_share": share}})
        else:
            await db.partners.update_one({"_id": p["_id"]}, {"$inc": {"balance": share, "total_profit_share": share}})
        tx = PartnerTransaction(company_id=company_id, partner_id=p["_id"], partner_name=p["name"], type="profit_share", amount=share,
                                account_id=account_id if pay_now else None, account_name=account_name, is_paid=pay_now, description=description, date=date)
        doc = tx.to_mongo()
        await db.partner_transactions.insert_one(doc)
        results.append({"partner_name": p["name"], "share_percent": p.get("share_percent"), "amount": share})
    return {"status": "success", "period": period, "total_profit": total_profit, "pay_now": pay_now, "distribution": results,
            "message": f"{total_profit:,.2f} ₺ kâr {len(partners)} ortağa {'ödendi' if pay_now else 'tahakkuk ettirildi'}."}


@api_router.post("/banking/partners/distribute-profit")
async def distribute_profit(req: Dict[str, Any], request: Request):
    company_id = req.get("company_id", "comp_nexus_main_01")
    pay_now = bool(req.get("pay_now", False))
    if float(req.get("total_profit") or 0) <= 0:
        raise HTTPException(status_code=400, detail="Dağıtılacak kâr sıfırdan büyük olmalıdır.")
    user = await get_current_user(request)
    if pay_now:
        pending = await cash_approval.maybe_queue(
            db, company_id=company_id, kind="distribute_profit", payload=req,
            account_ids=[req.get("account_id")],
            summary=f"Kâr payı dağıtımı {float(req.get('total_profit') or 0):,.2f} ₺ (hemen öde)",
            user=user,
        )
        if pending:
            return pending
    return await _execute_distribute_profit(req)


CASH_APPROVAL_EXECUTORS = {
    "virman": _execute_virman,
    "partner_tx": _execute_partner_tx,
    "distribute_profit": _execute_distribute_profit,
}


@api_router.get("/banking/cash-approvals")
async def list_cash_approvals(request: Request, company_id: Optional[str] = "comp_nexus_main_01", status: Optional[str] = "pending"):
    user = await get_current_user(request)
    query: Dict[str, Any] = {"company_id": company_id}
    if status:
        query["status"] = status
    rows = await db.cash_approval_requests.find(query).sort("created_at", -1).to_list(100)
    allowed = await cash_approval.can_approve(db, user, company_id)
    actor = cash_approval.uid(user)
    out = []
    for r in rows:
        row = cash_approval.public_row(r, user)
        row["can_approve"] = bool(allowed and r.get("status") == "pending" and r.get("requested_by") != actor)
        out.append(row)
    return out


@api_router.post("/banking/cash-approvals/{req_id}/approve")
async def approve_cash_request(req_id: str, request: Request):
    user = await get_current_user(request)
    doc = await db.cash_approval_requests.find_one({"_id": req_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Onay talebi bulunamadı.")
    if doc.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Bu talep zaten sonuçlanmış.")
    if not await cash_approval.can_approve(db, user, doc["company_id"]):
        raise HTTPException(status_code=403, detail="Bu işlemi onaylama yetkiniz yok.")
    if cash_approval.uid(user) == doc.get("requested_by"):
        raise HTTPException(status_code=400, detail="Kendi işleminizi onaylayamazsınız; diğer yöneticinin onayı gerekir.")
    executor = CASH_APPROVAL_EXECUTORS.get(doc.get("kind"))
    if not executor:
        raise HTTPException(status_code=400, detail="Bilinmeyen işlem türü.")
    claimed = await db.cash_approval_requests.update_one(
        {"_id": req_id, "status": "pending"},
        {"$set": {"status": "approved", "approved_by": cash_approval.uid(user), "approved_by_name": user.get("name"), "approved_at": datetime.now(timezone.utc).isoformat()}},
    )
    if not claimed.modified_count:
        raise HTTPException(status_code=400, detail="Bu talep zaten sonuçlanmış.")
    try:
        result = await executor(doc.get("payload") or {})
    except Exception:
        await db.cash_approval_requests.update_one({"_id": req_id}, {"$set": {"status": "pending", "approved_by": None, "approved_by_name": None, "approved_at": None}})
        raise
    await db.notifications.insert_one({
        "_id": str(uuid.uuid4()),
        "company_id": doc["company_id"],
        "type": "cash_approval",
        "title": "Kasa/banka işlemi onaylandı",
        "message": f"{user.get('name')}: {doc.get('summary')} uygulandı.",
        "ref_type": "cash_approval",
        "ref_id": req_id,
        "link": "/banking?tab=partners" if doc.get("kind") != "virman" else "/banking",
        "is_read": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"status": "success", "message": "İşlem onaylandı ve uygulandı.", "result": result}


@api_router.post("/banking/cash-approvals/{req_id}/reject")
async def reject_cash_request(req_id: str, request: Request):
    user = await get_current_user(request)
    doc = await db.cash_approval_requests.find_one({"_id": req_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Onay talebi bulunamadı.")
    if doc.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Bu talep zaten sonuçlanmış.")
    if not await cash_approval.can_approve(db, user, doc["company_id"]):
        raise HTTPException(status_code=403, detail="Bu işlemi reddetme yetkiniz yok.")
    if cash_approval.uid(user) == doc.get("requested_by"):
        raise HTTPException(status_code=400, detail="Kendi işleminizi reddedemezsiniz; diğer yöneticinin kararı gerekir.")
    claimed = await db.cash_approval_requests.update_one(
        {"_id": req_id, "status": "pending"},
        {"$set": {"status": "rejected", "rejected_by": cash_approval.uid(user), "rejected_by_name": user.get("name"), "rejected_at": datetime.now(timezone.utc).isoformat()}},
    )
    if not claimed.modified_count:
        raise HTTPException(status_code=400, detail="Bu talep zaten sonuçlanmış.")
    await db.notifications.insert_one({
        "_id": str(uuid.uuid4()),
        "company_id": doc["company_id"],
        "type": "cash_approval",
        "title": "Kasa/banka işlemi reddedildi",
        "message": f"{user.get('name')}: {doc.get('summary')} reddedildi.",
        "ref_type": "cash_approval",
        "ref_id": req_id,
        "link": "/banking?tab=partners" if doc.get("kind") != "virman" else "/banking",
        "is_read": False,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    return {"status": "success", "message": "Talep reddedildi; para hareket etmedi."}


# ----------------- BANKA CANLI VERİ BAĞLANTILARI -----------------
def _mask_connection(doc: dict) -> dict:
    doc = clean_doc(doc)
    for key in ("client_secret", "api_key"):
        if doc.get(key):
            doc[key] = "••••" + doc[key][-4:]
    return doc

@api_router.get("/banking/providers")
async def list_bank_providers():
    return [{"code": k, **{kk: vv for kk, vv in v.items() if kk != "token_path"}} for k, v in bank_providers.PROVIDERS.items()]

@api_router.get("/banking/connections")
async def list_bank_connections(company_id: Optional[str] = "comp_nexus_main_01"):
    conns = await db.bank_connections.find({"company_id": company_id}).sort("created_at", -1).to_list(100)
    return [_mask_connection(c) for c in conns]

@api_router.post("/banking/connections")
async def create_bank_connection(conn: BankConnection):
    if conn.provider not in bank_providers.PROVIDERS:
        raise HTTPException(status_code=400, detail="Desteklenmeyen banka sağlayıcısı.")
    acc = await db.bank_accounts.find_one({"_id": conn.linked_account_id})
    if not acc:
        raise HTTPException(status_code=404, detail="Bağlanacak banka hesabı bulunamadı.")
    conn.provider_name = bank_providers.PROVIDERS[conn.provider]["name"]
    conn.linked_account_name = acc.get("account_name")
    doc = conn.to_mongo()
    test = await bank_providers.test_connection(doc)
    doc["status"] = "simulated" if test.get("simulated") else ("connected" if test["ok"] else "error")
    doc["last_error"] = None if test["ok"] else test["message"]
    await db.bank_connections.insert_one(doc)
    return {**_mask_connection(doc), "test_result": test}

@api_router.put("/banking/connections/{conn_id}")
async def update_bank_connection(conn_id: str, updated: Dict[str, Any]):
    allowed = {k: v for k, v in updated.items() if k in {"client_id", "client_secret", "api_key", "customer_number", "bank_account_number", "base_url", "mode", "auto_sync", "auto_match", "linked_account_id"}}
    if allowed.get("client_secret", None) and allowed["client_secret"].startswith("••••"):
        allowed.pop("client_secret")
    if allowed.get("api_key", None) and allowed["api_key"].startswith("••••"):
        allowed.pop("api_key")
    if "linked_account_id" in allowed:
        acc = await db.bank_accounts.find_one({"_id": allowed["linked_account_id"]})
        if not acc:
            raise HTTPException(status_code=404, detail="Banka hesabı bulunamadı.")
        allowed["linked_account_name"] = acc.get("account_name")
    await db.bank_connections.update_one({"_id": conn_id}, {"$set": allowed})
    doc = await db.bank_connections.find_one({"_id": conn_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Bağlantı bulunamadı.")
    return _mask_connection(doc)

@api_router.delete("/banking/connections/{conn_id}")
async def delete_bank_connection(conn_id: str):
    await db.bank_connections.delete_one({"_id": conn_id})
    return {"status": "success"}

@api_router.post("/banking/connections/{conn_id}/test")
async def test_bank_connection(conn_id: str):
    doc = await db.bank_connections.find_one({"_id": conn_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Bağlantı bulunamadı.")
    test = await bank_providers.test_connection(doc)
    status_val = "simulated" if test.get("simulated") else ("connected" if test["ok"] else "error")
    await db.bank_connections.update_one({"_id": conn_id}, {"$set": {"status": status_val, "last_error": None if test["ok"] else test["message"]}})
    return {**test, "status": status_val}

async def _suggest_contact(company_id: str, counterparty: str, description: str):
    rule = await _find_rule(company_id, f"{counterparty} {description}")
    if rule and rule.get("contact_id"):
        c = await db.contacts.find_one({"_id": rule["contact_id"]})
        if c:
            return c
    if not counterparty and not description:
        return None
    contacts = await db.contacts.find({"company_id": company_id}).to_list(10000)
    hay = f"{counterparty} {description}".lower()
    for c in contacts:
        tokens = [t for t in (c.get("name") or "").lower().split() if len(t) > 3]
        if tokens and all(t in hay for t in tokens[:2]):
            return c
    return None

@api_router.post("/banking/connections/{conn_id}/sync")
async def sync_bank_connection(conn_id: str, days: int = 7):
    doc = await db.bank_connections.find_one({"_id": conn_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Bağlantı bulunamadı.")
    acc = await db.bank_accounts.find_one({"_id": doc.get("linked_account_id")})
    if not acc:
        raise HTTPException(status_code=404, detail="Bağlı banka hesabı bulunamadı.")
    since = datetime.now(timezone.utc) - timedelta(days=days)
    try:
        result = await bank_providers.fetch_transactions(doc, since)
    except Exception as e:
        msg = f"Senkronizasyon hatası: {str(e)[:160]}"
        await db.bank_connections.update_one({"_id": conn_id}, {"$set": {"status": "error", "last_error": msg}})
        raise HTTPException(status_code=502, detail=msg)

    inserted, skipped, balance_delta = 0, 0, 0.0
    new_txs = []
    for t in result["transactions"]:
        exists = await db.bank_transactions.find_one({"account_id": acc["_id"], "external_id": t["external_id"]})
        if exists:
            skipped += 1
            continue
        suggestion = await _suggest_contact(doc["company_id"], t.get("counterparty", ""), t.get("description", ""))
        is_credit = t["direction"] == "credit"
        balance_delta += t["amount"] if is_credit else -t["amount"]
        tx = BankTransaction(
            company_id=doc["company_id"], account_id=acc["_id"], account_name=acc.get("account_name"),
            type="inflow" if is_credit else "outflow",
            category="Banka Gelen Havale/EFT" if is_credit else "Banka Giden Ödeme",
            amount=t["amount"], currency=t.get("currency", "TRY"),
            description=t["description"], external_id=t["external_id"], source="bank_sync",
            is_simulated=t.get("is_simulated", False), match_status="unmatched",
            suggested_contact_id=suggestion["_id"] if suggestion else None,
            suggested_contact_name=suggestion.get("name") if suggestion else None,
            date=t["date"],
        )
        tx_doc = tx.to_mongo()
        await db.bank_transactions.insert_one(tx_doc)
        new_txs.append(tx_doc)
        inserted += 1
    if balance_delta:
        await db.bank_accounts.update_one({"_id": acc["_id"]}, {"$inc": {"current_balance": balance_delta}})
    auto_matched = 0
    if doc.get("auto_match") and new_txs:
        auto_matched, _ = await _auto_match_by_rules(doc["company_id"], new_txs, via="auto")
    now = datetime.now(timezone.utc).isoformat()
    await db.bank_connections.update_one({"_id": conn_id}, {
        "$set": {"status": "simulated" if result["simulated"] else "connected", "last_synced_at": now, "last_error": None},
        "$inc": {"synced_count": inserted, "auto_matched_count": auto_matched}
    })
    return {"status": "success", "simulated": result["simulated"], "inserted": inserted, "skipped": skipped, "auto_matched": auto_matched, "balance_delta": balance_delta,
            "message": f"{inserted} yeni hareket çekildi ({skipped} zaten kayıtlı)." + (f" {auto_matched} hareket öğrenilen kurallarla otomatik işlendi." if auto_matched else "") + (" [SİMÜLE VERİ]" if result["simulated"] else "")}

@api_router.post("/banking/sync-all")
async def sync_all_connections(company_id: Optional[str] = "comp_nexus_main_01"):
    conns = await db.bank_connections.find({"company_id": company_id, "auto_sync": True}).to_list(100)
    results = []
    for c in conns:
        try:
            r = await sync_bank_connection(c["_id"])
            results.append({"connection_id": c["_id"], "provider_name": c.get("provider_name"), **r})
        except HTTPException as e:
            results.append({"connection_id": c["_id"], "provider_name": c.get("provider_name"), "status": "error", "message": e.detail})
    return {"results": results}

@api_router.get("/banking/transactions/unmatched")
async def list_unmatched_transactions(company_id: Optional[str] = "comp_nexus_main_01"):
    txs = await db.bank_transactions.find({"company_id": company_id, "source": "bank_sync", "match_status": "unmatched"}).sort("date", -1).to_list(500)
    return clean_docs(txs)

def _match_pattern(text: str) -> str:
    import re as _re
    t = _re.sub(r"[\d\.,:/\-]+", " ", (text or "").lower())
    tokens = [w for w in t.split() if len(w) > 2 and w not in {"eft", "havale", "ödeme", "odeme", "fatura", "tahsilat", "gelen", "giden", "ltd", "şti", "sti", "a.ş", "tl", "try"}]
    return " ".join(tokens[:4])

async def _find_rule(company_id: str, description: str):
    pattern = _match_pattern(description)
    if not pattern:
        return None
    rules = await db.bank_match_rules.find({"company_id": company_id}).sort("hits", -1).to_list(500)
    hay = (description or "").lower()
    for r in rules:
        words = r["pattern"].split()
        if words and all(w in hay for w in words):
            return r
    return None

async def _learn_rule(company_id: str, description: str, contact_id: Optional[str], contact_name: Optional[str], category: Optional[str], target_account_id: Optional[str] = None, target_account_name: Optional[str] = None):
    pattern = _match_pattern(description)
    if not pattern or not (contact_id or category or target_account_id):
        return
    await db.bank_match_rules.update_one(
        {"company_id": company_id, "pattern": pattern},
        {"$set": {"contact_id": contact_id, "contact_name": contact_name, "category": category, "target_account_id": target_account_id, "target_account_name": target_account_name, "updated_at": datetime.now(timezone.utc).isoformat()},
         "$inc": {"hits": 1},
         "$setOnInsert": {"_id": str(uuid.uuid4()), "company_id": company_id, "pattern": pattern, "created_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True)

async def _apply_match(tx: dict, contact_id: Optional[str], invoice_id: Optional[str], category: Optional[str], learn: bool = True, target_account_id: Optional[str] = None, via: str = "manual") -> dict:
    update = {"match_status": "matched", "matched_via": via, "matched_at": datetime.now(timezone.utc).isoformat()}
    if category:
        update["category"] = category
    amount = tx.get("amount", 0)
    is_inflow = tx.get("type") == "inflow"
    if invoice_id:
        inv = await db.invoices.find_one({"_id": invoice_id})
        if not inv:
            raise HTTPException(status_code=404, detail="Fatura bulunamadı.")
        new_paid = inv.get("paid_amount", 0) + amount
        payment_status = "paid" if new_paid >= inv.get("grand_total", 0) - 0.01 else "partially_paid"
        await db.invoices.update_one({"_id": invoice_id}, {"$set": {"paid_amount": new_paid, "payment_status": payment_status}})
        update["related_invoice_id"] = invoice_id
        update["related_invoice_number"] = inv.get("invoice_number")
        contact_id = contact_id or inv.get("contact_id")
    contact_name = None
    if contact_id:
        contact = await db.contacts.find_one({"_id": contact_id})
        if not contact:
            raise HTTPException(status_code=404, detail="Cari bulunamadı.")
        await db.contacts.update_one({"_id": contact_id}, {"$inc": {"balance": -amount if is_inflow else amount}})
        contact_name = contact.get("name")
        update["contact_id"] = contact_id
        update["contact_name"] = contact_name
    target_name = None
    if target_account_id:
        if target_account_id == tx.get("account_id"):
            raise HTTPException(status_code=400, detail="Hedef hesap, hareketin kendi hesabı olamaz.")
        tacc = await db.bank_accounts.find_one({"_id": target_account_id})
        if not tacc:
            raise HTTPException(status_code=404, detail="Hedef kasa/hesap bulunamadı.")
        if await bank_guard.get_connection_for_account(db, target_account_id):
            raise HTTPException(status_code=400, detail="Hedef hesap da banka entegrasyonuna bağlı; karşı hareket o bankadan otomatik gelir. Bu hareketi yalnızca 'Virman' kategorisiyle eşleştirin.")
        target_name = tacc.get("account_name")
        counter_amount = amount if not is_inflow else -amount
        await db.bank_accounts.update_one({"_id": target_account_id}, {"$inc": {"current_balance": counter_amount}})
        await db.bank_transactions.insert_one({
            "_id": str(uuid.uuid4()), "company_id": tx["company_id"], "account_id": target_account_id, "account_name": target_name,
            "type": "inflow" if not is_inflow else "outflow", "category": category or "Hesaplar Arası Virman", "amount": amount, "currency": tx.get("currency", "TRY"),
            "description": f"{tx.get('account_name')} {'→' if not is_inflow else '←'} {target_name}: {tx.get('description')}", "source": "bank_match",
            "related_bank_tx_id": tx["_id"], "date": tx.get("date"), "created_at": datetime.now(timezone.utc).isoformat()})
        update["target_account_id"] = target_account_id
        update["target_account_name"] = target_name
        if not category:
            update["category"] = "Hesaplar Arası Virman"
    await db.bank_transactions.update_one({"_id": tx["_id"]}, {"$set": update})
    if learn:
        await _learn_rule(tx["company_id"], tx.get("description", ""), contact_id, contact_name, category, target_account_id, target_name)
    return clean_doc(await db.bank_transactions.find_one({"_id": tx["_id"]}))

async def _unmatch(tx: dict) -> dict:
    amount = tx.get("amount", 0)
    is_inflow = tx.get("type") == "inflow"
    if tx.get("contact_id"):
        await db.contacts.update_one({"_id": tx["contact_id"]}, {"$inc": {"balance": amount if is_inflow else -amount}})
    if tx.get("related_invoice_id"):
        inv = await db.invoices.find_one({"_id": tx["related_invoice_id"]})
        if inv:
            new_paid = round(max(0.0, inv.get("paid_amount", 0) - amount), 2)
            ps = "paid" if new_paid >= inv.get("grand_total", 0) - 0.01 else "partially_paid" if new_paid > 0 else "unpaid"
            await db.invoices.update_one({"_id": inv["_id"]}, {"$set": {"paid_amount": new_paid, "payment_status": ps}})
    if tx.get("target_account_id"):
        counter = await db.bank_transactions.find_one({"related_bank_tx_id": tx["_id"], "source": "bank_match"})
        if counter:
            await db.bank_accounts.update_one({"_id": counter["account_id"]}, {"$inc": {"current_balance": -amount if counter.get("type") == "inflow" else amount}})
            await db.bank_transactions.delete_one({"_id": counter["_id"]})
    await db.bank_transactions.update_one({"_id": tx["_id"]}, {
        "$set": {"match_status": "unmatched", "category": "Banka Gelen Havale/EFT" if is_inflow else "Banka Giden Ödeme"},
        "$unset": {"contact_id": "", "contact_name": "", "related_invoice_id": "", "related_invoice_number": "", "target_account_id": "", "target_account_name": "", "matched_via": "", "matched_at": ""}})
    return clean_doc(await db.bank_transactions.find_one({"_id": tx["_id"]}))

async def _auto_match_by_rules(company_id: str, txs: list, via: str = "rule"):
    matched, details = 0, []
    for tx in txs:
        rule = await _find_rule(company_id, tx.get("description", ""))
        if not rule:
            continue
        try:
            await _apply_match(tx, rule.get("contact_id"), None, rule.get("category"), learn=False, target_account_id=rule.get("target_account_id"), via=via)
        except HTTPException:
            continue
        await db.bank_match_rules.update_one({"_id": rule["_id"]}, {"$inc": {"hits": 1}})
        matched += 1
        details.append({"tx_id": tx["_id"], "description": tx.get("description"), "contact_name": rule.get("contact_name"), "target_account_name": rule.get("target_account_name"), "via": via})
    return matched, details

@api_router.post("/banking/transactions/{tx_id}/match")
async def match_bank_transaction(tx_id: str, req: Dict[str, Any]):
    tx = await db.bank_transactions.find_one({"_id": tx_id})
    if not tx:
        raise HTTPException(status_code=404, detail="Hareket bulunamadı.")
    if tx.get("match_status") == "matched":
        raise HTTPException(status_code=400, detail="Bu hareket zaten eşleştirilmiş.")
    return await _apply_match(tx, req.get("contact_id") or None, req.get("invoice_id") or None, req.get("category") or None, learn=bool(req.get("learn", True)), target_account_id=req.get("target_account_id") or None)

@api_router.post("/banking/transactions/{tx_id}/unmatch")
async def unmatch_bank_transaction(tx_id: str):
    tx = await db.bank_transactions.find_one({"_id": tx_id})
    if not tx or tx.get("source") != "bank_sync":
        raise HTTPException(status_code=404, detail="Banka hareketi bulunamadı.")
    if tx.get("match_status") != "matched":
        raise HTTPException(status_code=400, detail="Bu hareket eşleştirilmemiş.")
    return await _unmatch(tx)

@api_router.get("/banking/transactions/matched")
async def list_matched_transactions(company_id: Optional[str] = "comp_nexus_main_01", limit: int = 100):
    txs = await db.bank_transactions.find({"company_id": company_id, "source": "bank_sync", "match_status": "matched"}).sort("matched_at", -1).to_list(limit)
    return clean_docs(txs)

@api_router.post("/banking/transactions/auto-match")
async def auto_match_transactions(company_id: Optional[str] = "comp_nexus_main_01", use_suggestions: bool = False, account_id: Optional[str] = None):
    q = {"company_id": company_id, "source": "bank_sync", "match_status": "unmatched"}
    if account_id:
        q["account_id"] = account_id
    txs = await db.bank_transactions.find(q).to_list(1000)
    matched, details = await _auto_match_by_rules(company_id, txs)
    done = {d["tx_id"] for d in details}
    skipped = 0
    for tx in txs:
        if tx["_id"] in done:
            continue
        if use_suggestions and tx.get("suggested_contact_id"):
            await _apply_match(tx, tx["suggested_contact_id"], None, None, learn=True, via="suggestion")
            matched += 1
            details.append({"tx_id": tx["_id"], "description": tx.get("description"), "contact_name": tx.get("suggested_contact_name"), "via": "suggestion"})
        else:
            skipped += 1
    return {"status": "success", "matched": matched, "skipped": skipped, "details": details,
            "message": f"{matched} hareket önceki eşleşmelere göre otomatik işlendi, {skipped} hareket manuel bekliyor."}

@api_router.get("/banking/match-rules")
async def list_match_rules(company_id: Optional[str] = "comp_nexus_main_01"):
    rules = await db.bank_match_rules.find({"company_id": company_id}).sort("hits", -1).to_list(500)
    return clean_docs(rules)

@api_router.get("/banking/match-rule-suggestions")
async def match_rule_suggestions(company_id: Optional[str] = "comp_nexus_main_01", min_count: int = 2):
    txs = await db.bank_transactions.find({"company_id": company_id, "source": "bank_sync", "match_status": "matched"}).to_list(3000)
    rules = {r["pattern"] for r in await db.bank_match_rules.find({"company_id": company_id}).to_list(1000)}
    groups: Dict[str, dict] = {}
    for t in txs:
        p = _match_pattern(t.get("description", ""))
        if not p or p in rules:
            continue
        key = (t.get("contact_id") or "", t.get("target_account_id") or "", t.get("category") or "")
        g = groups.setdefault(p, {"pattern": p, "count": 0, "targets": {}, "sample": t.get("description"), "total": 0.0})
        g["count"] += 1
        g["total"] += t.get("amount", 0)
        g["targets"][key] = g["targets"].get(key, 0) + 1
    out = []
    for p, g in groups.items():
        if g["count"] < min_count:
            continue
        (cid, tid, cat), n = max(g["targets"].items(), key=lambda kv: kv[1])
        if not (cid or tid or cat):
            continue
        sample = next(t for t in txs if _match_pattern(t.get("description", "")) == p and (t.get("contact_id") or "") == cid and (t.get("target_account_id") or "") == tid)
        out.append({"pattern": p, "count": g["count"], "consistent": n == g["count"], "sample_description": g["sample"], "total_amount": round(g["total"], 2),
                    "contact_id": cid or None, "contact_name": sample.get("contact_name"), "target_account_id": tid or None, "target_account_name": sample.get("target_account_name"), "category": cat or None})
    out.sort(key=lambda x: -x["count"])
    return out

@api_router.post("/banking/match-rule-suggestions/accept")
async def accept_rule_suggestion(req: Dict[str, Any]):
    company_id = req.get("company_id", "comp_nexus_main_01")
    created = await create_match_rule({"company_id": company_id, "pattern": req.get("pattern"), "contact_id": req.get("contact_id"), "target_account_id": req.get("target_account_id"), "category": req.get("category")})
    applied = 0
    if req.get("apply_now", True):
        txs = await db.bank_transactions.find({"company_id": company_id, "source": "bank_sync", "match_status": "unmatched"}).to_list(1000)
        pattern = created.get("pattern")
        applied, _ = await _auto_match_by_rules(company_id, [t for t in txs if _match_pattern(t.get("description", "")) == pattern])
    return {"status": "success", "rule": created, "applied": applied, "message": f"Kural oluşturuldu." + (f" Bekleyen {applied} hareket otomatik işlendi." if applied else "")}

@api_router.post("/banking/match-rules")
async def create_match_rule(req: Dict[str, Any]):
    company_id = req.get("company_id", "comp_nexus_main_01")
    pattern = _match_pattern(req.get("pattern", "")) or (req.get("pattern") or "").lower().strip()
    if not pattern:
        raise HTTPException(status_code=400, detail="Anahtar kelime gerekli.")
    contact_name = None
    if req.get("contact_id"):
        c = await db.contacts.find_one({"_id": req["contact_id"]})
        contact_name = c.get("name") if c else None
    target_name = None
    if req.get("target_account_id"):
        a = await db.bank_accounts.find_one({"_id": req["target_account_id"]})
        target_name = a.get("account_name") if a else None
    doc = {"pattern": pattern, "contact_id": req.get("contact_id") or None, "contact_name": contact_name, "category": req.get("category") or None,
           "target_account_id": req.get("target_account_id") or None, "target_account_name": target_name,
           "updated_at": datetime.now(timezone.utc).isoformat()}
    await db.bank_match_rules.update_one(
        {"company_id": company_id, "pattern": pattern},
        {"$set": doc, "$setOnInsert": {"_id": str(uuid.uuid4()), "company_id": company_id, "hits": 0, "created_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True)
    saved = await db.bank_match_rules.find_one({"company_id": company_id, "pattern": pattern})
    return clean_doc(saved)

@api_router.delete("/banking/match-rules/{rule_id}")
async def delete_match_rule(rule_id: str):
    await db.bank_match_rules.delete_one({"_id": rule_id})
    return {"status": "success"}

# ----------------- İLETİŞİM: SMS (NETGSM) -----------------
@api_router.get("/comm/sms/settings")
async def get_sms_settings(company_id: Optional[str] = "comp_nexus_main_01"):
    s = await db.sms_settings.find_one({"company_id": company_id})
    if not s:
        return {"company_id": company_id, "usercode": "", "msgheader": "", "is_active": False, "has_password": False}
    return {"id": str(s["_id"]), "company_id": company_id, "usercode": s.get("usercode", ""), "msgheader": s.get("msgheader", ""),
            "is_active": s.get("is_active", False), "has_password": bool(s.get("password_enc"))}

@api_router.put("/comm/sms/settings")
async def save_sms_settings(req: Dict[str, Any]):
    company_id = req.get("company_id", "comp_nexus_main_01")
    update = {"usercode": (req.get("usercode") or "").strip(), "msgheader": (req.get("msgheader") or "").strip(),
              "is_active": bool(req.get("is_active", True)), "updated_at": datetime.now(timezone.utc).isoformat()}
    if req.get("password"):
        update["password_enc"] = comm_service.encrypt(req["password"])
    await db.sms_settings.update_one({"company_id": company_id}, {"$set": update, "$setOnInsert": {"_id": str(uuid.uuid4()), "company_id": company_id}}, upsert=True)
    return await get_sms_settings(company_id)

async def _sms_creds(company_id: str) -> Optional[dict]:
    s = await db.sms_settings.find_one({"company_id": company_id})
    if not s or not s.get("is_active") or not s.get("usercode") or not s.get("password_enc"):
        return None
    return {"usercode": s["usercode"], "password": comm_service.decrypt(s["password_enc"]), "msgheader": s.get("msgheader", "")}

@api_router.get("/comm/sms/balance")
async def sms_balance(company_id: Optional[str] = "comp_nexus_main_01"):
    creds = await _sms_creds(company_id)
    if not creds:
        return {"ok": False, "simulated": True, "message": "Netgsm bilgileri girilmedi — SİMÜLE mod."}
    try:
        res = await comm_service.netgsm_balance(creds)
        return {**res, "simulated": False}
    except Exception as e:
        return {"ok": False, "simulated": False, "message": f"Netgsm'e erişilemedi: {str(e)[:120]}"}

async def _send_sms_to(company_id: str, recipients: List[Dict[str, Any]], message: str, context: str, ref_id: Optional[str]) -> Dict[str, Any]:
    creds = await _sms_creds(company_id)
    valid, invalid = [], []
    for r in recipients:
        num = comm_service.normalize_phone(r.get("phone", ""))
        (valid if num else invalid).append({**r, "no": num})
    logs, sent, failed = [], 0, 0
    if valid:
        if creds:
            try:
                res = await comm_service.netgsm_send(creds, [{"no": v["no"], "msg": v.get("message") or message} for v in valid])
                status_val = "sent" if res["ok"] else "failed"
                jobid, error = res.get("jobid"), res.get("error")
            except Exception as e:
                status_val, jobid, error = "failed", None, f"Netgsm'e erişilemedi: {str(e)[:120]}"
        else:
            status_val, jobid, error = "simulated", f"SIM-{uuid.uuid4().hex[:8].upper()}", None
        for v in valid:
            log = SmsLog(company_id=company_id, to=v["no"], message=v.get("message") or message, status=status_val, jobid=jobid, error=error,
                         contact_id=v.get("contact_id"), contact_name=v.get("contact_name"), context=context, ref_id=ref_id)
            logs.append(log.to_mongo())
            sent += status_val != "failed"
            failed += status_val == "failed"
    for r in invalid:
        log = SmsLog(company_id=company_id, to=r.get("phone") or "-", message=r.get("message") or message, status="failed", error="Geçersiz GSM numarası",
                     contact_id=r.get("contact_id"), contact_name=r.get("contact_name"), context=context, ref_id=ref_id)
        logs.append(log.to_mongo())
        failed += 1
    if logs:
        await db.sms_logs.insert_many(logs)
    simulated = creds is None
    return {"status": "success" if failed == 0 else "partial", "sent": sent, "failed": failed, "simulated": simulated,
            "message": f"{sent} SMS gönderildi{', ' + str(failed) + ' başarısız' if failed else ''}." + (" [SİMÜLE — Netgsm bilgisi girilmedi]" if simulated else "")}

@api_router.post("/comm/sms/send")
async def send_sms(req: Dict[str, Any]):
    company_id = req.get("company_id", "comp_nexus_main_01")
    message = (req.get("message") or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Mesaj boş olamaz.")
    recipients = req.get("recipients") or []
    if req.get("phone"):
        recipients.append({"phone": req["phone"], "contact_id": req.get("contact_id"), "contact_name": req.get("contact_name")})
    if not recipients:
        raise HTTPException(status_code=400, detail="Alıcı belirtilmedi.")
    return await _send_sms_to(company_id, recipients, message, req.get("context", "manual"), req.get("ref_id"))

@api_router.post("/comm/sms/campaign")
async def sms_campaign(req: Dict[str, Any]):
    company_id = req.get("company_id", "comp_nexus_main_01")
    contact_ids = req.get("contact_ids") or []
    message = (req.get("message") or "").strip()
    if not message or not contact_ids:
        raise HTTPException(status_code=400, detail="Mesaj ve en az bir cari seçilmelidir.")
    contacts = await db.contacts.find({"_id": {"$in": contact_ids}}).to_list(1000)
    recipients = []
    for c in contacts:
        personalized = message.replace("{ad}", c.get("name", "")).replace("{bakiye}", f"{c.get('balance', 0):,.2f} ₺")
        recipients.append({"phone": c.get("phone") or "", "contact_id": c["_id"], "contact_name": c.get("name"), "message": personalized})
    return await _send_sms_to(company_id, recipients, message, "campaign", None)

@api_router.get("/comm/sms/logs")
async def sms_logs(company_id: Optional[str] = "comp_nexus_main_01", limit: int = 200):
    logs = await db.sms_logs.find({"company_id": company_id}).sort("created_at", -1).to_list(limit)
    return clean_docs(logs)

# ----------------- İLETİŞİM: E-POSTA (IMAP/SMTP) -----------------
@api_router.get("/comm/mail/presets")
async def mail_presets():
    return [{"code": k, **v} for k, v in comm_service.MAIL_PRESETS.items()]

def _err_text(e: Exception) -> str:
    args = getattr(e, "args", None)
    raw = args[0] if args else str(e)
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", "replace")
    return str(raw)[:160]

def _mask_mail_account(a: dict) -> dict:
    a = clean_doc(dict(a))
    a["has_password"] = bool(a.pop("password_enc", ""))
    return a

async def _mail_account(company_id: str, user_id: Optional[str] = None) -> dict:
    query = {"company_id": company_id}
    if user_id:
        query["user_id"] = user_id
    a = await db.mail_accounts.find_one(query)
    if not a:
        raise HTTPException(status_code=404, detail="E-posta hesabı tanımlı değil. Önce hesabınızı bağlayın.")
    a["password"] = comm_service.decrypt(a["password_enc"])
    return a

@api_router.get("/comm/mail/account")
async def get_mail_account(company_id: Optional[str] = "comp_nexus_main_01"):
    a = await db.mail_accounts.find_one({"company_id": company_id})
    return _mask_mail_account(a) if a else None

@api_router.put("/comm/mail/account")
async def save_mail_account(req: Dict[str, Any], request: Request):
    user = await get_current_user(request)
    company_id = req.get("company_id", "comp_nexus_main_01")
    preset = comm_service.MAIL_PRESETS.get(req.get("provider", "custom"), comm_service.MAIL_PRESETS["custom"])
    existing = await db.mail_accounts.find_one({"company_id": company_id})
    if not req.get("password") and not existing:
        raise HTTPException(status_code=400, detail="Uygulama şifresi gerekli.")
    data = {
        "company_id": company_id, "user_id": user.get("id") or user.get("_id"), "email": (req.get("email") or "").strip(),
        "display_name": req.get("display_name") or "", "provider": req.get("provider", "custom"),
        "imap_host": req.get("imap_host") or preset["imap_host"], "imap_port": int(req.get("imap_port") or preset["imap_port"]),
        "smtp_host": req.get("smtp_host") or preset["smtp_host"], "smtp_port": int(req.get("smtp_port") or preset["smtp_port"]),
        "signature": req.get("signature") or "",
    }
    if not data["email"] or not data["imap_host"] or not data["smtp_host"]:
        raise HTTPException(status_code=400, detail="E-posta, IMAP ve SMTP sunucu bilgileri zorunludur.")
    if req.get("password"):
        data["password_enc"] = comm_service.encrypt(req["password"])
    if existing:
        await db.mail_accounts.update_one({"_id": existing["_id"]}, {"$set": data})
    else:
        acc = MailAccount(**data)
        await db.mail_accounts.insert_one(acc.to_mongo())
    a = await _mail_account(company_id)
    try:
        await comm_service.run_blocking(comm_service.imap_test, a)
        await db.mail_accounts.update_one({"_id": a["_id"]}, {"$set": {"status": "connected", "last_error": None}})
        test = {"ok": True, "message": "IMAP bağlantısı doğrulandı."}
    except Exception as e:
        err = f"IMAP bağlantı hatası: {_err_text(e)}"
        await db.mail_accounts.update_one({"_id": a["_id"]}, {"$set": {"status": "error", "last_error": err}})
        test = {"ok": False, "message": err}
    saved = await db.mail_accounts.find_one({"_id": a["_id"]})
    return {**_mask_mail_account(saved), "test_result": test}

@api_router.delete("/comm/mail/account")
async def delete_mail_account(company_id: Optional[str] = "comp_nexus_main_01"):
    await db.mail_accounts.delete_one({"company_id": company_id})
    return {"status": "success"}

@api_router.post("/comm/mail/account/test")
async def test_mail_account(company_id: Optional[str] = "comp_nexus_main_01"):
    a = await _mail_account(company_id)
    try:
        res = await comm_service.run_blocking(comm_service.imap_test, a)
        await db.mail_accounts.update_one({"_id": a["_id"]}, {"$set": {"status": "connected", "last_error": None}})
        return {"ok": True, "message": f"Bağlantı başarılı. {res.get('folders', 0)} klasör bulundu."}
    except Exception as e:
        err = f"IMAP bağlantı hatası: {_err_text(e)}"
        await db.mail_accounts.update_one({"_id": a["_id"]}, {"$set": {"status": "error", "last_error": err}})
        return {"ok": False, "message": err}

def _err_text(e: Exception) -> str:
    args = getattr(e, "args", None)
    raw = args[0] if args else str(e)
    if isinstance(raw, bytes):
        raw = raw.decode("utf-8", "replace")
    return str(raw)[:160]

def _mail_error(e: Exception) -> HTTPException:
    return HTTPException(status_code=424, detail=f"Posta sunucusu hatası: {_err_text(e)}")

@api_router.get("/comm/mail/folders")
async def mail_folders(company_id: Optional[str] = "comp_nexus_main_01"):
    a = await _mail_account(company_id)
    try:
        return await comm_service.run_blocking(comm_service.imap_folders, a)
    except Exception as e:
        raise _mail_error(e)

@api_router.get("/comm/mail/messages")
async def mail_messages(company_id: Optional[str] = "comp_nexus_main_01", folder: str = "INBOX", limit: int = 30, unread_only: bool = False):
    a = await _mail_account(company_id)
    try:
        return await comm_service.run_blocking(comm_service.imap_list, a, folder, min(max(limit, 1), 100), unread_only)
    except Exception as e:
        raise _mail_error(e)

@api_router.get("/comm/mail/messages/{uid}")
async def mail_message(uid: str, company_id: Optional[str] = "comp_nexus_main_01", folder: str = "INBOX"):
    a = await _mail_account(company_id)
    try:
        return await comm_service.run_blocking(comm_service.imap_fetch, a, folder, uid)
    except KeyError:
        raise HTTPException(status_code=404, detail="Mesaj bulunamadı.")
    except Exception as e:
        raise _mail_error(e)

@api_router.post("/comm/mail/messages/{uid}/flag")
async def mail_flag(uid: str, req: Dict[str, Any]):
    a = await _mail_account(req.get("company_id", "comp_nexus_main_01"))
    flag_map = {"read": "\\Seen", "flagged": "\\Flagged", "deleted": "\\Deleted"}
    flag = flag_map.get(req.get("flag", "read"))
    if not flag:
        raise HTTPException(status_code=400, detail="Geçersiz bayrak.")
    try:
        await comm_service.run_blocking(comm_service.imap_set_flag, a, req.get("folder", "INBOX"), uid, flag, bool(req.get("add", True)))
        return {"status": "success"}
    except Exception as e:
        raise _mail_error(e)

@api_router.post("/comm/mail/send")
async def mail_send(request: Request, company_id: str = Form("comp_nexus_main_01"), to: str = Form(...), cc: str = Form(""),
                    subject: str = Form(""), body: str = Form(""), context: str = Form("manual"), ref_id: str = Form(""),
                    contact_id: str = Form(""), contact_name: str = Form(""), files: List[UploadFile] = File(default=[])):
    a = await _mail_account(company_id)
    to_list = [x.strip() for x in to.split(",") if x.strip()]
    cc_list = [x.strip() for x in cc.split(",") if x.strip()]
    if not to_list:
        raise HTTPException(status_code=400, detail="Alıcı e-posta adresi gerekli.")
    attachments, total = [], 0
    for f in files:
        data = await f.read()
        total += len(data)
        if total > 25 * 1024 * 1024:
            raise HTTPException(status_code=413, detail="Ekler toplam 25 MB'ı aşamaz.")
        attachments.append({"filename": f.filename, "content_type": f.content_type, "data": data})
    full_body = body + (f"\n\n--\n{a.get('signature')}" if a.get("signature") else "")
    log = MailLog(company_id=company_id, from_email=a["email"], to=to_list, cc=cc_list, subject=subject, body=body,
                  attachments=[x["filename"] for x in attachments], contact_id=contact_id or None, contact_name=contact_name or None,
                  context=context, ref_id=ref_id or None)
    try:
        await comm_service.smtp_send(a, to_list, subject, full_body, cc=cc_list, attachments=attachments)
    except Exception as e:
        log.status, log.error = "failed", f"SMTP hatası: {_err_text(e)}"
        await db.mail_logs.insert_one(log.to_mongo())
        raise HTTPException(status_code=424, detail=log.error)
    await db.mail_logs.insert_one(log.to_mongo())
    return {"status": "success", "message": f"E-posta {', '.join(to_list)} adresine gönderildi."}

@api_router.get("/comm/mail/logs")
async def mail_logs(company_id: Optional[str] = "comp_nexus_main_01", limit: int = 200):
    logs = await db.mail_logs.find({"company_id": company_id}).sort("created_at", -1).to_list(limit)
    return clean_docs(logs)

@api_router.get("/comm/whatsapp/logs")
async def whatsapp_logs(company_id: Optional[str] = "comp_nexus_main_01", contact_id: Optional[str] = None):
    q = {"company_id": company_id}
    if contact_id:
        q["contact_id"] = contact_id
    return clean_docs(await db.whatsapp_logs.find(q).sort("created_at", -1).to_list(300))

@api_router.post("/comm/whatsapp/logs")
async def whatsapp_log(req: Dict[str, Any]):
    phone = comm_service.normalize_phone(req.get("phone", ""))
    if not phone:
        raise HTTPException(status_code=400, detail="Geçerli bir GSM numarası gerekli.")
    message = (req.get("message") or "").strip()
    if not message:
        raise HTTPException(status_code=400, detail="Mesaj boş olamaz.")
    doc = {"_id": str(uuid.uuid4()), "company_id": req.get("company_id", "comp_nexus_main_01"), "contact_id": req.get("contact_id"), "contact_name": req.get("contact_name"),
           "to": phone, "phone": phone, "message": message, "direction": req.get("direction", "outbound"), "status": "logged", "context": req.get("context", "manual"),
           "wa_link": f"https://wa.me/90{phone}?text={quote(message)}", "created_at": datetime.now(timezone.utc).isoformat()}
    await db.whatsapp_logs.insert_one(doc)
    return clean_doc(doc)

@api_router.get("/comm/history")
async def comm_history(company_id: Optional[str] = "comp_nexus_main_01", contact_id: Optional[str] = None, ref_id: Optional[str] = None):
    q = {"company_id": company_id}
    if contact_id:
        q["contact_id"] = contact_id
    if ref_id:
        q["ref_id"] = ref_id
    sms = await db.sms_logs.find(q).sort("created_at", -1).to_list(100)
    mails = await db.mail_logs.find(q).sort("created_at", -1).to_list(100)
    items = [{**clean_doc(s), "channel": "sms"} for s in sms] + [{**clean_doc(m), "channel": "email"} for m in mails]
    return sorted(items, key=lambda x: x.get("created_at", ""), reverse=True)

# ----------------- BARKODLU STOK SAYIMI -----------------
@api_router.get("/warehouses/stock-counts")
async def list_stock_counts(company_id: Optional[str] = "comp_nexus_main_01"):
    counts = await db.stock_counts.find({"company_id": company_id}).sort("created_at", -1).to_list(100)
    return clean_docs(counts)

@api_router.post("/warehouses/stock-counts")
async def create_stock_count(req: Dict[str, Any]):
    company_id = req.get("company_id", "comp_nexus_main_01")
    wh = await db.warehouses.find_one({"_id": req.get("warehouse_id")}) if req.get("warehouse_id") else None
    doc = {"_id": str(uuid.uuid4()), "company_id": company_id, "name": req.get("name") or f"Sayım {datetime.now(timezone.utc).strftime('%d.%m.%Y %H:%M')}",
           "warehouse_id": req.get("warehouse_id"), "warehouse_name": wh.get("name") if wh else "Tüm Depolar", "status": "open", "items": [],
           "created_at": datetime.now(timezone.utc).isoformat(), "completed_at": None}
    if req.get("preload_all"):
        products = await db.products.find({"company_id": company_id, "type": {"$ne": "service"}}).to_list(1000)
        for p in products:
            if p.get("variants"):
                for v in p["variants"]:
                    doc["items"].append({"product_id": p["_id"], "variant_id": v.get("variant_id"), "product_name": f"{p['name']} - {v.get('name')}", "sku": v.get("sku"), "barcode": v.get("barcode"), "expected": v.get("stock", 0), "counted": 0, "scanned": False})
            else:
                doc["items"].append({"product_id": p["_id"], "variant_id": None, "product_name": p["name"], "sku": p.get("sku"), "barcode": p.get("barcode"), "expected": p.get("stock_quantity", 0), "counted": 0, "scanned": False})
    await db.stock_counts.insert_one(doc)
    return clean_doc(doc)

@api_router.get("/warehouses/stock-counts/{count_id}")
async def get_stock_count(count_id: str):
    doc = await db.stock_counts.find_one({"_id": count_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Sayım bulunamadı.")
    return clean_doc(doc)

@api_router.post("/warehouses/stock-counts/{count_id}/scan")
async def scan_stock_count(count_id: str, req: Dict[str, Any]):
    doc = await db.stock_counts.find_one({"_id": count_id})
    if not doc or doc.get("status") != "open":
        raise HTTPException(status_code=400, detail="Açık sayım bulunamadı.")
    barcode = (req.get("barcode") or "").strip()
    qty = float(req.get("quantity", 1))
    product = await db.products.find_one({"barcode": barcode, "company_id": doc["company_id"]})
    variant = None
    if not product:
        product = await db.products.find_one({"variants.barcode": barcode, "company_id": doc["company_id"]})
        if product:
            variant = next((v for v in product.get("variants", []) if v.get("barcode") == barcode), None)
    if not product:
        raise HTTPException(status_code=404, detail=f"Barkod bulunamadı: {barcode}")
    items = doc.get("items", [])
    vid = variant.get("variant_id") if variant else None
    item = next((i for i in items if i["product_id"] == product["_id"] and i.get("variant_id") == vid), None)
    if not item:
        item = {"product_id": product["_id"], "variant_id": vid, "product_name": f"{product['name']}{' - ' + variant['name'] if variant else ''}",
                "sku": variant.get("sku") if variant else product.get("sku"), "barcode": barcode,
                "expected": variant.get("stock", 0) if variant else product.get("stock_quantity", 0), "counted": 0, "scanned": False}
        items.append(item)
    item["counted"] = max(0, item.get("counted", 0) + qty)
    item["scanned"] = True
    await db.stock_counts.update_one({"_id": count_id}, {"$set": {"items": items}})
    return {"status": "success", "item": item, "message": f"{item['product_name']} → sayılan: {item['counted']}"}

@api_router.put("/warehouses/stock-counts/{count_id}/items")
async def set_stock_count_item(count_id: str, req: Dict[str, Any]):
    doc = await db.stock_counts.find_one({"_id": count_id})
    if not doc or doc.get("status") != "open":
        raise HTTPException(status_code=400, detail="Açık sayım bulunamadı.")
    items = doc.get("items", [])
    for i in items:
        if i["product_id"] == req.get("product_id") and i.get("variant_id") == req.get("variant_id"):
            i["counted"] = max(0, float(req.get("counted", 0)))
            i["scanned"] = True
    await db.stock_counts.update_one({"_id": count_id}, {"$set": {"items": items}})
    return clean_doc(await db.stock_counts.find_one({"_id": count_id}))

@api_router.post("/warehouses/stock-counts/{count_id}/complete")
async def complete_stock_count(count_id: str, req: Dict[str, Any]):
    doc = await db.stock_counts.find_one({"_id": count_id})
    if not doc or doc.get("status") != "open":
        raise HTTPException(status_code=400, detail="Açık sayım bulunamadı.")
    apply = bool(req.get("apply", True))
    only_scanned = bool(req.get("only_scanned", True))
    adjusted = 0
    for i in doc.get("items", []):
        if only_scanned and not i.get("scanned"):
            continue
        diff = i["counted"] - i["expected"]
        if apply and abs(diff) > 0.0001:
            if i.get("variant_id"):
                p = await db.products.find_one({"_id": i["product_id"]})
                variants = p.get("variants", [])
                for v in variants:
                    if v.get("variant_id") == i["variant_id"]:
                        v["stock"] = i["counted"]
                await db.products.update_one({"_id": i["product_id"]}, {"$set": {"variants": variants, "stock_quantity": sum(v.get("stock", 0) for v in variants)}})
            else:
                await db.products.update_one({"_id": i["product_id"]}, {"$set": {"stock_quantity": i["counted"]}})
            await db.stock_movements.insert_one({"_id": str(uuid.uuid4()), "product_id": i["product_id"], "product_name": i["product_name"], "variant_id": i.get("variant_id"),
                                                 "change": diff, "new_stock": i["counted"], "reason": f"Stok Sayımı: {doc['name']}", "date": datetime.now(timezone.utc).isoformat()})
            adjusted += 1
    await db.stock_counts.update_one({"_id": count_id}, {"$set": {"status": "completed", "applied": apply, "completed_at": datetime.now(timezone.utc).isoformat(), "adjusted_count": adjusted}})
    return {"status": "success", "adjusted": adjusted, "message": f"Sayım tamamlandı. {adjusted} kalemde stok güncellendi." if apply else "Sayım kaydedildi (stok değiştirilmedi)."}

@api_router.delete("/warehouses/stock-counts/{count_id}")
async def delete_stock_count(count_id: str):
    sc = await db.stock_counts.find_one({"_id": count_id})
    if not sc:
        raise HTTPException(status_code=404, detail="Sayım bulunamadı.")
    await trash.soft_delete("stock_counts", sc, "stock_count", sc.get("name") or sc.get("title") or count_id, note=sc.get("status") or "")
    return {"status": "success", "message": "Sayım çöp kutusuna taşındı."}

# ----------------- PERSONEL: İZİN, MAAŞ HESABI, PRİM -----------------
@api_router.get("/personnel/leaves")
async def list_leaves(company_id: Optional[str] = "comp_nexus_main_01", employee_id: Optional[str] = None):
    q = {"company_id": company_id}
    if employee_id:
        q["employee_id"] = employee_id
    return clean_docs(await db.leave_requests.find(q).sort("created_at", -1).to_list(500))

@api_router.post("/personnel/leaves")
async def create_leave(req: Dict[str, Any]):
    emp = await db.employees.find_one({"_id": req.get("employee_id")})
    if not emp:
        raise HTTPException(status_code=404, detail="Çalışan bulunamadı.")
    start = datetime.strptime(req["start_date"], "%Y-%m-%d")
    end = datetime.strptime(req["end_date"], "%Y-%m-%d")
    if end < start:
        raise HTTPException(status_code=400, detail="Bitiş tarihi başlangıçtan önce olamaz.")
    days = float(req.get("days") or ((end - start).days + 1))
    leave_type = req.get("type", "annual")
    remaining = emp.get("annual_leave_days", 14) - emp.get("used_leave_days", 0)
    if leave_type == "annual" and days > remaining:
        raise HTTPException(status_code=400, detail=f"Yetersiz yıllık izin bakiyesi. Kalan: {remaining} gün.")
    doc = {"_id": str(uuid.uuid4()), "company_id": emp["company_id"], "employee_id": emp["_id"], "employee_name": emp["full_name"], "type": leave_type,
           "start_date": req["start_date"], "end_date": req["end_date"], "days": days, "reason": req.get("reason", ""), "status": "pending",
           "decided_at": None, "created_at": datetime.now(timezone.utc).isoformat()}
    await db.leave_requests.insert_one(doc)
    return clean_doc(doc)

@api_router.post("/personnel/leaves/{leave_id}/decide")
async def decide_leave(leave_id: str, req: Dict[str, Any]):
    leave = await db.leave_requests.find_one({"_id": leave_id})
    if not leave or leave.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Bekleyen izin talebi bulunamadı.")
    status_val = req.get("status")
    if status_val not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="Geçersiz karar.")
    if status_val == "approved" and leave.get("type") == "annual":
        await db.employees.update_one({"_id": leave["employee_id"]}, {"$inc": {"used_leave_days": leave["days"]}})
    await db.leave_requests.update_one({"_id": leave_id}, {"$set": {"status": status_val, "decided_at": datetime.now(timezone.utc).isoformat(), "decision_note": req.get("note", "")}})
    return clean_doc(await db.leave_requests.find_one({"_id": leave_id}))

@api_router.delete("/personnel/leaves/{leave_id}")
async def delete_leave(leave_id: str):
    leave = await db.leave_requests.find_one({"_id": leave_id})
    if not leave:
        raise HTTPException(status_code=404, detail="İzin bulunamadı.")
    if leave.get("status") == "approved" and leave.get("type") == "annual":
        await db.employees.update_one({"_id": leave["employee_id"]}, {"$inc": {"used_leave_days": -leave["days"]}})
    await trash.soft_delete("leave_requests", leave, "leave", f"{leave.get('employee_name')} · {leave.get('start_date')} → {leave.get('end_date')}", note=f"{leave.get('days')} gün · {leave.get('status')}")
    return {"status": "success", "message": "İzin çöp kutusuna taşındı."}

@api_router.get("/orders/{order_id}")
async def get_order(order_id: str):
    o = await db.orders.find_one({"_id": order_id})
    if not o:
        raise HTTPException(status_code=404, detail="Sipariş bulunamadı.")
    return clean_doc(o)

# 2026 yaklaşık parametreler (kullanıcı ayarlardan değiştirebilir)
SALARY_PARAMS = {"sgk_employee": 0.14, "unemployment_employee": 0.01, "stamp_tax": 0.00759, "sgk_employer": 0.155, "unemployment_employer": 0.02,
                 "min_wage_gross": 26005.50, "tax_brackets": [(158000, 0.15), (330000, 0.20), (1200000, 0.27), (4300000, 0.35), (float("inf"), 0.40)]}

def _income_tax(monthly_base: float, cumulative_before: float) -> float:
    tax, remaining, lower, cum = 0.0, monthly_base, 0.0, cumulative_before
    for upper, rate in SALARY_PARAMS["tax_brackets"]:
        if remaining <= 0:
            break
        room = max(0.0, upper - max(cum, lower))
        portion = min(remaining, room)
        tax += portion * rate
        remaining -= portion
        cum += portion
        lower = upper
    return tax

def _calc_from_gross(gross: float, cumulative_base: float = 0.0) -> Dict[str, float]:
    sgk = gross * SALARY_PARAMS["sgk_employee"]
    unemp = gross * SALARY_PARAMS["unemployment_employee"]
    tax_base = gross - sgk - unemp
    min_base = SALARY_PARAMS["min_wage_gross"] * (1 - SALARY_PARAMS["sgk_employee"] - SALARY_PARAMS["unemployment_employee"])
    income_tax = max(0.0, _income_tax(tax_base, cumulative_base) - _income_tax(min(min_base, tax_base), cumulative_base))
    stamp = max(0.0, (gross - SALARY_PARAMS["min_wage_gross"]) * SALARY_PARAMS["stamp_tax"])
    net = gross - sgk - unemp - income_tax - stamp
    employer_sgk = gross * SALARY_PARAMS["sgk_employer"]
    employer_unemp = gross * SALARY_PARAMS["unemployment_employer"]
    return {"gross": round(gross, 2), "sgk_employee": round(sgk, 2), "unemployment_employee": round(unemp, 2), "income_tax": round(income_tax, 2),
            "stamp_tax": round(stamp, 2), "net": round(net, 2), "employer_sgk": round(employer_sgk, 2), "employer_unemployment": round(employer_unemp, 2),
            "total_employer_cost": round(gross + employer_sgk + employer_unemp, 2)}

@api_router.post("/personnel/salary-calc")
async def salary_calc(req: Dict[str, Any]):
    mode = req.get("mode", "gross")
    amount = float(req.get("amount", 0))
    cumulative = float(req.get("cumulative_tax_base", 0))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Tutar sıfırdan büyük olmalıdır.")
    if mode == "gross":
        result = _calc_from_gross(amount, cumulative)
    else:
        lo, hi = amount, amount * 2.5
        for _ in range(60):
            mid = (lo + hi) / 2
            if _calc_from_gross(mid, cumulative)["net"] < amount:
                lo = mid
            else:
                hi = mid
        result = _calc_from_gross(hi, cumulative)
    return {**result, "mode": mode, "params": {k: v for k, v in SALARY_PARAMS.items() if k != "tax_brackets"}, "note": "2026 yaklaşık oranlar; asgari ücret istisnası uygulanmıştır. Resmi bordro için mali müşavirinizle doğrulayın."}

@api_router.get("/personnel/bonuses")
async def list_bonuses(company_id: Optional[str] = "comp_nexus_main_01", period: Optional[str] = None):
    q = {"company_id": company_id}
    if period:
        q["period"] = period
    return clean_docs(await db.bonus_payments.find(q).sort("created_at", -1).to_list(500))

@api_router.post("/personnel/bonuses")
async def create_bonus(req: Dict[str, Any]):
    emp = await db.employees.find_one({"_id": req.get("employee_id")})
    if not emp:
        raise HTTPException(status_code=404, detail="Çalışan bulunamadı.")
    amount = float(req.get("amount", 0))
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Tutar sıfırdan büyük olmalıdır.")
    b_type = req.get("type", "bonus")  # bonus, second_salary, advance, expense
    labels = {"bonus": "Prim", "second_salary": "İkinci Maaş", "advance": "Avans", "expense": "Masraf Ödemesi"}
    if b_type not in labels:
        raise HTTPException(status_code=400, detail="Geçersiz ödeme türü.")
    period = req.get("period") or datetime.now(timezone.utc).strftime("%Y-%m")
    account_id = req.get("account_id") or None
    partner_id = req.get("partner_id") or None
    if account_id and partner_id:
        raise HTTPException(status_code=400, detail="Kasa/banka ve ortak hesabı aynı anda seçilemez.")
    account_name, status_val = None, "pending"
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    bonus_id = str(uuid.uuid4())
    if partner_id:
        pname = await partner_pay.withdraw(db, emp["company_id"], partner_id, amount, f"{emp['full_name']} - {period} {labels[b_type]}", today, extra={"bonus_id": bonus_id})
        account_name, status_val = f"{pname} (Ortak)", "paid"
    elif account_id:
        acc = await db.bank_accounts.find_one({"_id": account_id})
        if not acc:
            raise HTTPException(status_code=404, detail="Kasa/Banka hesabı bulunamadı.")
        await bank_guard.assert_manual_allowed(db, account_id)
        await db.bank_accounts.update_one({"_id": account_id}, {"$inc": {"current_balance": -amount}})
        await db.bank_transactions.insert_one({"_id": str(uuid.uuid4()), "company_id": emp["company_id"], "account_id": account_id, "account_name": acc.get("account_name"),
                                               "type": "outflow", "category": f"Personel {labels[b_type]} (Gayri Resmi)", "amount": amount, "currency": "TRY",
                                               "description": f"{emp['full_name']} - {period} {labels[b_type]}", "source": "manual",
                                               "date": today, "created_at": datetime.now(timezone.utc).isoformat()})
        account_name, status_val = acc.get("account_name"), "paid"
    doc = {"_id": bonus_id, "company_id": emp["company_id"], "employee_id": emp["_id"], "employee_name": emp["full_name"], "type": b_type, "type_label": labels[b_type],
           "period": period, "amount": amount, "note": req.get("note", ""), "is_official": False, "account_id": account_id, "partner_id": partner_id, "account_name": account_name,
           "status": status_val, "created_at": datetime.now(timezone.utc).isoformat()}
    await db.bonus_payments.insert_one(doc)
    return clean_doc(doc)

@api_router.delete("/personnel/bonuses/{bonus_id}")
async def delete_bonus(bonus_id: str):
    b = await db.bonus_payments.find_one({"_id": bonus_id})
    if not b:
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı.")
    if b.get("status") == "paid":
        if b.get("partner_id"):
            await partner_pay.reverse_one(db, {"bonus_id": bonus_id})
        elif b.get("account_id"):
            await db.bank_accounts.update_one({"_id": b["account_id"]}, {"$inc": {"current_balance": b["amount"]}})
    await trash.soft_delete("bonus_payments", b, "bonus", f"{b.get('employee_name')} · {b.get('type')} · {float(b.get('amount') or 0):,.2f} ₺", note=b.get("status") or "")
    return {"status": "success", "message": "Kayıt çöp kutusuna taşındı."}


# ----------------- E-TİCARET DETAYLARI: EŞLEŞTİRME, İADE, KARGO SEÇİMİ -----------------
@api_router.get("/integrations/ecommerce/mappings")
async def list_mappings(company_id: Optional[str] = "comp_nexus_main_01"):
    return clean_docs(await db.marketplace_mappings.find({"company_id": company_id}).sort("created_at", -1).to_list(1000))

@api_router.post("/integrations/ecommerce/mappings")
async def create_mapping(req: Dict[str, Any]):
    product = await db.products.find_one({"_id": req.get("product_id")})
    if not product:
        raise HTTPException(status_code=404, detail="Stok kartı bulunamadı.")
    channel = (req.get("channel") or "").lower()
    ext_sku = (req.get("marketplace_sku") or "").strip()
    if not channel or not ext_sku:
        raise HTTPException(status_code=400, detail="Pazaryeri ve pazaryeri SKU/barkod zorunludur.")
    doc = {"company_id": req.get("company_id", "comp_nexus_main_01"), "channel": channel, "marketplace_sku": ext_sku, "marketplace_product_id": req.get("marketplace_product_id", ""),
           "product_id": product["_id"], "product_name": product["name"], "sku": product.get("sku"), "variant_id": req.get("variant_id"), "sync_stock": bool(req.get("sync_stock", True)),
           "sync_price": bool(req.get("sync_price", True)), "updated_at": datetime.now(timezone.utc).isoformat()}
    await db.marketplace_mappings.update_one({"company_id": doc["company_id"], "channel": channel, "marketplace_sku": ext_sku},
                                             {"$set": doc, "$setOnInsert": {"_id": str(uuid.uuid4()), "created_at": datetime.now(timezone.utc).isoformat()}}, upsert=True)
    return clean_doc(await db.marketplace_mappings.find_one({"company_id": doc["company_id"], "channel": channel, "marketplace_sku": ext_sku}))

@api_router.delete("/integrations/ecommerce/mappings/{mapping_id}")
async def delete_mapping(mapping_id: str):
    await db.marketplace_mappings.delete_one({"_id": mapping_id})
    return {"status": "success"}

@api_router.get("/integrations/ecommerce/unmapped")
async def unmapped_items(company_id: Optional[str] = "comp_nexus_main_01"):
    orders = await db.orders.find({"company_id": company_id, "channel": {"$nin": ["b2b", None]}}).to_list(1000)
    maps = await db.marketplace_mappings.find({"company_id": company_id}).to_list(1000)
    mapped = {(m["channel"], m["marketplace_sku"]) for m in maps}
    products = {p["_id"] for p in await db.products.find({"company_id": company_id}, {"_id": 1}).to_list(5000)}
    seen, out = set(), []
    for o in orders:
        for it in o.get("items", []):
            key = (o.get("channel"), it.get("sku") or it.get("product_name"))
            if key in mapped or key in seen or (it.get("product_id") in products and key in mapped):
                continue
            seen.add(key)
            out.append({"channel": o.get("channel"), "marketplace_sku": it.get("sku") or "", "product_name": it.get("product_name"), "has_local_product": it.get("product_id") in products})
    return out

@api_router.delete("/orders/{order_id}")
async def delete_order(order_id: str):
    o = await db.orders.find_one({"_id": order_id})
    if not o:
        raise HTTPException(status_code=404, detail="Sipariş bulunamadı.")
    if o.get("is_invoiced") or o.get("invoice_id"):
        raise HTTPException(status_code=400, detail="Faturalanmış sipariş silinemez.")
    await trash.soft_delete("orders", o, "order", f"{o.get('order_number')} · {o.get('customer_name')}", note=f"{(o.get('channel') or 'manuel').title()} · {float(o.get('total_amount') or 0):,.2f} ₺")
    return {"status": "success", "message": "Sipariş çöp kutusuna taşındı."}

@api_router.post("/orders/{order_id}/resolve-cancel-request")
async def resolve_cancel_request(order_id: str, req: Dict[str, Any] = None):
    o = await db.orders.find_one({"_id": order_id})
    if not o:
        raise HTTPException(status_code=404, detail="Sipariş bulunamadı.")
    cr = o.get("cancel_request") or {}
    if cr.get("status") != "pending":
        raise HTTPException(status_code=400, detail="Bekleyen iptal talebi yok.")
    req = req or {}
    action = (req.get("action") or "").strip().lower()
    now = datetime.now(timezone.utc).isoformat()
    if action == "accept":
        if o.get("is_invoiced") or o.get("invoice_id"):
            raise HTTPException(status_code=400, detail="Faturalanmış sipariş iptal edilemez.")
        cr.update({"status": "accepted", "resolved_at": now, "resolve_note": req.get("note") or ""})
        await db.orders.update_one({"_id": order_id}, {"$set": {"order_status": "cancelled", "cancelled_at": now, "cancel_request": cr}})
        return {"status": "success", "message": f"{o.get('order_number')} iptal edildi.", "order_status": "cancelled"}
    if action == "reject":
        cr.update({"status": "rejected", "resolved_at": now, "resolve_note": req.get("note") or ""})
        await db.orders.update_one({"_id": order_id}, {"$set": {"cancel_request": cr}})
        return {"status": "success", "message": "İptal talebi reddedildi."}
    raise HTTPException(status_code=400, detail="action accept veya reject olmalı.")

@api_router.post("/orders/{order_id}/approve")
async def approve_order(order_id: str, req: Dict[str, Any] = None):
    o = await db.orders.find_one({"_id": order_id})
    if not o:
        raise HTTPException(status_code=404, detail="Sipariş bulunamadı.")
    req = req or {}
    update = {"order_status": "approved", "approved_at": datetime.now(timezone.utc).isoformat()}
    if req.get("cargo_carrier"):
        update["cargo_carrier"] = req["cargo_carrier"]
    await db.orders.update_one({"_id": order_id}, {"$set": update})
    updated = await db.orders.find_one({"_id": order_id})
    await _push_order_to_shopphp(updated, reason="approve")
    return clean_doc(updated)

@api_router.post("/orders/{order_id}/return")
async def return_order(order_id: str, req: Dict[str, Any]):
    o = await db.orders.find_one({"_id": order_id})
    if not o:
        raise HTTPException(status_code=404, detail="Sipariş bulunamadı.")
    if o.get("order_status") in ("returned", "İade Edildi"):
        raise HTTPException(status_code=400, detail="Sipariş zaten iade edilmiş.")
    items = req.get("items") or o.get("items", [])
    restock = bool(req.get("restock", True))
    total = 0.0
    for it in items:
        qty = float(it.get("quantity", 0))
        total += qty * float(it.get("unit_price", 0))
        if restock and it.get("product_id"):
            await db.products.update_one({"_id": it["product_id"]}, {"$inc": {"stock_quantity": qty}})
            await db.stock_movements.insert_one({"_id": str(uuid.uuid4()), "product_id": it["product_id"], "product_name": it.get("product_name"), "change": qty, "reason": f"İade: {o['order_number']}", "date": datetime.now(timezone.utc).isoformat()})
    doc = {"_id": str(uuid.uuid4()), "company_id": o["company_id"], "order_id": order_id, "order_number": o["order_number"], "channel": o.get("channel"), "customer_name": o.get("customer_name"),
           "items": items, "reason": req.get("reason", ""), "refund_amount": round(total, 2), "restocked": restock, "status": "completed", "created_at": datetime.now(timezone.utc).isoformat()}
    await db.returns.insert_one(doc)
    partial = len(items) < len(o.get("items", []))
    await db.orders.update_one({"_id": order_id}, {"$set": {"order_status": "partially_returned" if partial else "returned", "return_id": doc["_id"]}})
    return {"status": "success", "return": clean_doc(doc), "message": f"{o['order_number']} için {total:,.2f} ₺ iade kaydedildi{' ve stok geri alındı' if restock else ''}."}

@api_router.get("/returns")
async def list_returns(company_id: Optional[str] = "comp_nexus_main_01"):
    return clean_docs(await db.returns.find({"company_id": company_id}).sort("created_at", -1).to_list(500))

@api_router.post("/orders/{order_id}/create-dispatch")
async def create_dispatch(order_id: str):
    o = await db.orders.find_one({"_id": order_id})
    if not o:
        raise HTTPException(status_code=404, detail="Sipariş bulunamadı.")
    if o.get("dispatch_id"):
        d = await db.invoices.find_one({"_id": o["dispatch_id"]})
        return {"status": "exists", "dispatch": clean_doc(d), "message": "Bu sipariş için irsaliye zaten mevcut."}
    number = await _next_number("IRS", db.invoices)
    contact = await db.contacts.find_one({"name": o.get("customer_name"), "company_id": o["company_id"]})
    doc = {"_id": str(uuid.uuid4()), "company_id": o["company_id"], "invoice_number": number, "invoice_type": "dispatch", "e_type": "e_dispatch", "contact_id": contact["_id"] if contact else None,
           "contact_name": o.get("customer_name"), "customer_phone": o.get("customer_phone"), "shipping_address": o.get("shipping_address"), "city": o.get("city"),
           "items": [{"product_id": it.get("product_id"), "name": it.get("product_name"), "quantity": it.get("quantity"), "unit": "Adet", "unit_price": it.get("unit_price"), "vat_rate": 0, "total": it.get("total")} for it in o.get("items", [])],
           "subtotal": o.get("total_amount", 0), "vat_total": 0, "grand_total": o.get("total_amount", 0), "currency": "TRY", "status": "draft", "gib_status": "Taslak (e-İrsaliye)", "payment_status": "n/a",
           "order_id": order_id, "order_number": o["order_number"], "cargo_carrier": o.get("cargo_carrier"), "cargo_tracking_number": o.get("cargo_tracking_number"), "source_channel": o.get("channel", "b2b"),
           "issue_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "created_at": datetime.now(timezone.utc).isoformat()}
    await db.invoices.insert_one(doc)
    await db.orders.update_one({"_id": order_id}, {"$set": {"dispatch_id": doc["_id"], "dispatch_number": number}})
    return {"status": "success", "dispatch": clean_doc(doc), "message": f"{number} e-İrsaliye taslağı oluşturuldu."}

# ----------------- PERSONEL PUANTAJ -----------------
@api_router.get("/personnel/attendance")
async def list_attendance(company_id: Optional[str] = "comp_nexus_main_01", month: Optional[str] = None):
    month = month or datetime.now(timezone.utc).strftime("%Y-%m")
    rows = await db.attendance.find({"company_id": company_id, "date": {"$regex": f"^{month}"}}).sort("date", -1).to_list(3000)
    emps = await db.employees.find({"company_id": company_id}).to_list(200)
    company = await db.companies.find_one({"_id": company_id}) or {}
    today_s = attendance._today(attendance.merge_schedule(company))
    summary = []
    for e in emps:
        mine = [r for r in rows if r["employee_id"] == e["_id"]]
        ot = await attendance.overtime_pay_for_period(company, e, month)
        summary.append({"employee_id": e["_id"], "employee_name": e["full_name"], **attendance.summarize(mine),
                        "overtime_pay": ot["amount"], "overtime_rate": ot["weekday_rate"], "overtime_method": ot["method"],
                        "schedule": attendance.merge_schedule(company, e), "has_override": bool(e.get("work_schedule")),
                        "today": clean_doc(next((r for r in mine if r["date"] == today_s), None) or {}) or None})
    return {"month": month, "records": clean_docs(rows), "summary": summary, "schedule": attendance.merge_schedule(company)}

@api_router.get("/geocode")
async def geocode(q: str):
    if len(q.strip()) < 3:
        raise HTTPException(status_code=400, detail="En az 3 karakter girin.")
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            r = await client.get("https://nominatim.openstreetmap.org/search", params={"q": q, "format": "json", "limit": 5, "countrycodes": "tr", "addressdetails": 0}, headers={"User-Agent": "NexusHesap/1.0 (erp)"})
        r.raise_for_status()
        return [{"label": x.get("display_name"), "latitude": float(x["lat"]), "longitude": float(x["lon"])} for x in r.json()]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Adres servisi yanıt vermedi: {str(e)[:80]}")

@api_router.delete("/banking/accounts/{account_id}")
async def delete_bank_account(account_id: str):
    acc = await db.bank_accounts.find_one({"_id": account_id})
    if not acc:
        raise HTTPException(status_code=404, detail="Hesap bulunamadı.")
    if await db.bank_connections.find_one({"linked_account_id": account_id}):
        raise HTTPException(status_code=400, detail="Entegre hesap silinemez; önce banka bağlantısını kaldırın.")
    if await db.bank_transactions.count_documents({"$or": [{"account_id": account_id}, {"target_account_id": account_id}]}):
        raise HTTPException(status_code=400, detail="Hareketi olan hesap silinemez; önce hareketleri kontrol edin.")
    await trash.soft_delete("bank_accounts", acc, "bank_account", acc.get("account_name"), note=f"Bakiye: {float(acc.get('current_balance') or 0):,.2f} ₺")
    return {"status": "success", "message": "Hesap çöp kutusuna taşındı."}

@api_router.put("/companies/{company_id}/location")
async def set_company_location(company_id: str, req: Dict[str, Any]):
    try:
        lat, lng = float(req["latitude"]), float(req["longitude"])
    except (KeyError, TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Geçerli enlem/boylam gerekli.")
    radius = int(req.get("radius_m") or 300)
    await db.companies.update_one({"_id": company_id}, {"$set": {"location": {"latitude": lat, "longitude": lng, "radius_m": radius, "label": req.get("label") or "Firma", "updated_at": datetime.now(timezone.utc).isoformat()}}})
    return {"status": "success", "location": {"latitude": lat, "longitude": lng, "radius_m": radius}}

@api_router.get("/personnel/attendance/geo-status")
async def geo_status(company_id: str = "comp_nexus_main_01", user: dict = Depends(get_current_user)):
    company = await db.companies.find_one({"_id": company_id}) or {}
    emp = await db.employees.find_one({"$or": [{"_id": user.get("employee_id") or "-"}, {"user_id": str(user.get("_id", user.get("id")))}]})
    today = attendance._today(attendance.merge_schedule(company, emp))
    rec = await db.attendance.find_one({"employee_id": emp["_id"], "date": today}) if emp else None
    return {"location": company.get("location"), "employee": {"id": emp["_id"], "full_name": emp["full_name"]} if emp else None, "today": clean_doc(rec) if rec else None}

@api_router.post("/personnel/attendance/geo")
async def geo_attendance(req: Dict[str, Any], request: Request):
    """Eski konumlu giriş/çıkış rotası — self-servis puantaj endpoint'ine delege eder."""
    res = await attendance.self_attendance(req, request)
    return {**res, "distance_m": (res["record"].get(f"geo_{req.get('action')}") or {}).get("distance_m")}

@api_router.post("/personnel/attendance")
async def upsert_attendance(req: Dict[str, Any]):
    emp = await db.employees.find_one({"_id": req.get("employee_id")})
    if not emp:
        raise HTTPException(status_code=404, detail="Çalışan bulunamadı.")
    sched = attendance.merge_schedule(await db.companies.find_one({"_id": emp["company_id"]}) or {}, emp)
    date = req.get("date") or attendance._today(sched)
    action = req.get("action")
    now_hm = attendance.now_hm(sched)
    patch: Dict[str, Any] = {}
    for k in ("status", "check_in", "check_out", "note"):
        if req.get(k) is not None:
            patch[k] = req[k]
    if action in ("check_in", "check_out"):
        patch["status"] = "present"
        patch[action] = now_hm
    return await attendance.apply_day(emp, date, patch, source=req.get("source") or "manager", confirmed=False if action or patch else None)

# ----------------- MALİ MÜŞAVİR PANELİ -----------------
@api_router.get("/accountant/summary")
async def accountant_summary(company_id: Optional[str] = "comp_nexus_main_01", month: Optional[str] = None):
    month = month or datetime.now(timezone.utc).strftime("%Y-%m")
    invs = await db.invoices.find({"company_id": company_id, "issue_date": {"$regex": f"^{month}"}}).to_list(5000)
    sales = [i for i in invs if i.get("invoice_type") == "sales"]
    purchases = [i for i in invs if i.get("invoice_type") == "purchase"]
    by_vat = {}
    for i in sales + purchases:
        for it in i.get("items", []):
            r = str(it.get("vat_rate", 20)); base = float(it.get("total", 0)); vat = base * float(it.get("vat_rate", 20)) / 100
            k = ("sales" if i.get("invoice_type") == "sales" else "purchase")
            by_vat.setdefault(r, {"rate": r, "sales_base": 0, "sales_vat": 0, "purchase_base": 0, "purchase_vat": 0})
            by_vat[r][f"{k}_base"] += base; by_vat[r][f"{k}_vat"] += vat
    txs = await db.bank_transactions.find({"company_id": company_id, "date": {"$regex": f"^{month}"}}).to_list(5000)
    payrolls = await db.payrolls.find({"company_id": company_id, "period": month}).to_list(500)
    calc_vat = sum(i.get("vat_total", 0) for i in sales); ded_vat = sum(i.get("vat_total", 0) for i in purchases)
    return {"month": month,
            "sales": {"count": len(sales), "subtotal": sum(i.get("subtotal", 0) for i in sales), "vat": calc_vat, "total": sum(i.get("grand_total", 0) for i in sales), "unpaid": sum(i.get("grand_total", 0) - i.get("paid_amount", 0) for i in sales if i.get("payment_status") != "paid")},
            "purchases": {"count": len(purchases), "subtotal": sum(i.get("subtotal", 0) for i in purchases), "vat": ded_vat, "total": sum(i.get("grand_total", 0) for i in purchases)},
            "vat": {"calculated": calc_vat, "deductible": ded_vat, "payable": max(0.0, calc_vat - ded_vat), "carryover": max(0.0, ded_vat - calc_vat), "by_rate": sorted(by_vat.values(), key=lambda x: -float(x["rate"]))},
            "cash": {"inflow": sum(t.get("amount", 0) for t in txs if t.get("type") == "inflow"), "outflow": sum(t.get("amount", 0) for t in txs if t.get("type") == "outflow"), "count": len(txs)},
            "payroll": {"count": len(payrolls), "gross": sum(p.get("gross_salary", 0) for p in payrolls), "net": sum(p.get("net_salary", 0) for p in payrolls), "employer_cost": sum(p.get("total_employer_cost", p.get("gross_salary", 0)) for p in payrolls)},
            "e_docs": {"gib_sent": sum(1 for i in invs if i.get("status") == "sent"), "draft": sum(1 for i in invs if i.get("status") == "draft"), "dispatch": sum(1 for i in invs if i.get("invoice_type") == "dispatch")},
            "invoices": clean_docs(sorted(invs, key=lambda x: x.get("issue_date", ""), reverse=True))}

@api_router.get("/accountant/export")
async def accountant_export(company_id: Optional[str] = "comp_nexus_main_01", month: Optional[str] = None, kind: str = "invoices"):
    import csv, io
    month = month or datetime.now(timezone.utc).strftime("%Y-%m")
    buf = io.StringIO(); w = csv.writer(buf, delimiter=";")
    if kind == "invoices":
        w.writerow(["Belge No", "Tarih", "Tür", "E-Belge", "Cari", "VKN", "Matrah", "KDV", "Toplam", "Ödeme", "GİB"])
        for i in await db.invoices.find({"company_id": company_id, "issue_date": {"$regex": f"^{month}"}}).sort("issue_date", 1).to_list(5000):
            c = await db.contacts.find_one({"_id": i.get("contact_id")}) if i.get("contact_id") else None
            w.writerow([i.get("invoice_number"), i.get("issue_date"), i.get("invoice_type"), i.get("e_type"), i.get("contact_name"), (c or {}).get("tax_number_or_id", ""), f"{i.get('subtotal', 0):.2f}", f"{i.get('vat_total', 0):.2f}", f"{i.get('grand_total', 0):.2f}", i.get("payment_status"), i.get("gib_status") or ""])
    else:
        w.writerow(["Tarih", "Hesap", "Tür", "Kategori", "Açıklama", "Tutar"])
        for t in await db.bank_transactions.find({"company_id": company_id, "date": {"$regex": f"^{month}"}}).sort("date", 1).to_list(5000):
            w.writerow([t.get("date"), t.get("account_name"), "Giriş" if t.get("type") == "inflow" else "Çıkış", t.get("category"), t.get("description"), f"{t.get('amount', 0):.2f}"])
    return Response(content="\ufeff" + buf.getvalue(), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f"attachment; filename={kind}_{month}.csv"})

# ----------------- WHATSAPP BUSINESS (CLOUD API) -----------------
@api_router.get("/comm/whatsapp/settings")
async def get_wa_settings(company_id: Optional[str] = "comp_nexus_main_01"):
    s = await db.whatsapp_settings.find_one({"company_id": company_id}) or {}
    return {"company_id": company_id, "phone_number_id": s.get("phone_number_id", ""), "verify_token": s.get("verify_token", ""), "has_token": bool(s.get("access_token_enc")),
            "status": "connected" if s.get("access_token_enc") and s.get("phone_number_id") else "simulated", "webhook_url": "/api/comm/whatsapp/webhook"}

@api_router.put("/comm/whatsapp/settings")
async def save_wa_settings(req: Dict[str, Any]):
    company_id = req.get("company_id", "comp_nexus_main_01")
    update = {"phone_number_id": (req.get("phone_number_id") or "").strip(), "verify_token": (req.get("verify_token") or "").strip(), "updated_at": datetime.now(timezone.utc).isoformat()}
    if req.get("access_token"):
        update["access_token_enc"] = comm_service.encrypt(req["access_token"])
    if not update["phone_number_id"]:
        update["access_token_enc"] = ""
    await db.whatsapp_settings.update_one({"company_id": company_id}, {"$set": update, "$setOnInsert": {"_id": str(uuid.uuid4()), "company_id": company_id}}, upsert=True)
    return await get_wa_settings(company_id)

@api_router.get("/comm/whatsapp/webhook")
async def wa_webhook_verify(request: Request):
    q = request.query_params
    s = await db.whatsapp_settings.find_one({"verify_token": q.get("hub.verify_token")}) if q.get("hub.verify_token") else None
    if q.get("hub.mode") == "subscribe" and s:
        return Response(content=q.get("hub.challenge", ""), media_type="text/plain")
    raise HTTPException(status_code=403, detail="Doğrulama başarısız.")

@api_router.post("/comm/whatsapp/webhook")
async def wa_webhook(payload: Dict[str, Any]):
    saved = 0
    for entry in payload.get("entry", []):
        for ch in entry.get("changes", []):
            v = ch.get("value", {})
            pn_id = (v.get("metadata") or {}).get("phone_number_id")
            s = await db.whatsapp_settings.find_one({"phone_number_id": pn_id}) if pn_id else None
            company_id = (s or {}).get("company_id", "comp_nexus_main_01")
            names = {c.get("wa_id"): (c.get("profile") or {}).get("name") for c in v.get("contacts", [])}
            for m in v.get("messages", []):
                phone = comm_service.normalize_phone(m.get("from", ""))
                text = (m.get("text") or {}).get("body") or f"[{m.get('type')} mesajı]"
                contact = None
                if phone:
                    pattern = r"\D*".join(list(phone[-7:]))
                    contact = await db.contacts.find_one({"company_id": company_id, "phone": {"$regex": pattern + r"\D*$"}})
                await db.whatsapp_logs.insert_one({"_id": str(uuid.uuid4()), "company_id": company_id, "contact_id": contact["_id"] if contact else None, "contact_name": (contact or {}).get("name") or names.get(m.get("from")),
                                                   "to": phone or m.get("from"), "phone": phone or m.get("from"), "message": text, "direction": "inbound", "status": "received", "context": "whatsapp_api",
                                                   "wa_message_id": m.get("id"), "created_at": datetime.now(timezone.utc).isoformat()})
                saved += 1
    return {"status": "ok", "saved": saved}

@api_router.post("/comm/whatsapp/send")
async def wa_send(req: Dict[str, Any]):
    company_id = req.get("company_id", "comp_nexus_main_01")
    s = await db.whatsapp_settings.find_one({"company_id": company_id}) or {}
    phone = comm_service.normalize_phone(req.get("phone", ""))
    if not phone or not (req.get("message") or "").strip():
        raise HTTPException(status_code=400, detail="Numara ve mesaj zorunludur.")
    status_val, err = "simulated", None
    if s.get("access_token_enc") and s.get("phone_number_id"):
        try:
            async with httpx.AsyncClient(timeout=20) as client:
                r = await client.post(f"https://graph.facebook.com/v21.0/{s['phone_number_id']}/messages", headers={"Authorization": f"Bearer {comm_service.decrypt(s['access_token_enc'])}"},
                                      json={"messaging_product": "whatsapp", "to": f"90{phone}", "type": "text", "text": {"body": req["message"]}})
            status_val = "sent" if r.status_code < 400 else "failed"
            err = None if r.status_code < 400 else r.text[:200]
        except Exception as e:
            status_val, err = "failed", str(e)[:160]
    doc = {"_id": str(uuid.uuid4()), "company_id": company_id, "contact_id": req.get("contact_id"), "contact_name": req.get("contact_name"), "to": phone, "phone": phone, "message": req["message"].strip(),
           "direction": "outbound", "status": status_val, "error": err, "context": "whatsapp_api", "wa_link": f"https://wa.me/90{phone}?text={quote(req['message'])}", "created_at": datetime.now(timezone.utc).isoformat()}
    await db.whatsapp_logs.insert_one(doc)
    return {**clean_doc(doc), "message_info": "Gönderildi." if status_val == "sent" else ("SİMÜLE — Cloud API anahtarı girilmedi; wa.me linki kullanılabilir." if status_val == "simulated" else f"Hata: {err}")}

# ----------------- E-TİCARET ENTEGRASYONLARI -----------------
@api_router.get("/integrations/ecommerce")
async def list_ecommerce_integrations(company_id: Optional[str] = "comp_nexus_main_01"):
    configs = await db.integration_configs.find({"company_id": company_id}).to_list(100)
    for c in configs:
        c["rest_configured"] = bool(c.get("rest_email") and c.pop("rest_password_enc", None))
    return clean_docs(configs)

@api_router.put("/integrations/ecommerce/{channel_id}")
async def update_ecommerce_integration(channel_id: str, data: Dict[str, Any]):
    await db.integration_configs.update_one({"_id": channel_id}, {"$set": data})
    res = await db.integration_configs.find_one({"_id": channel_id})
    return clean_doc(res)

async def _upsert_marketplace_orders(company_id: str, docs: list) -> dict:
    inserted = updated = 0
    for d in docs:
        key = {"company_id": company_id, "channel": d["channel"], "order_number": d["order_number"]}
        existing = await db.orders.find_one(key)
        d["updated_at"] = datetime.now(timezone.utc).isoformat()
        if existing:
            keep = {k: existing[k] for k in ("invoice_id", "is_invoiced", "contact_id", "contact_name", "internal_note", "label_printed_at") if existing.get(k) is not None}
            await db.orders.update_one({"_id": existing["_id"]}, {"$set": {**d, **keep}})
            if not existing.get("contact_id"):
                await _ensure_order_contact({**existing, **d})
            updated += 1
        else:
            d["_id"] = f"ord_mp_{uuid.uuid4().hex[:8]}"
            d["created_at"] = d["updated_at"]
            await db.orders.insert_one(d)
            await _ensure_order_contact(d)
            inserted += 1
    return {"inserted": inserted, "updated": updated}

CHANNEL_CUSTOMER_CATEGORY = {"trendyol": "Trendyol Müşterisi", "hepsiburada": "Hepsiburada Müşterisi", "amazon": "Amazon Müşterisi", "n11": "n11 Müşterisi", "shopify": "Shopify Müşterisi",
                             "woocommerce": "WooCommerce Müşterisi", "ciceksepeti": "Çiçeksepeti Müşterisi", "shopphp": "ShopPHP Müşterisi", "b2b": "B2B Bayi", "manual": "Genel"}

async def _ensure_order_contact(o: dict) -> Optional[dict]:
    """Sipariş için cari bul (ad / telefon / e-posta / VKN) yoksa otomatik müşteri carisi aç ve siparişe bağla."""
    if o.get("contact_id"):
        c = await db.contacts.find_one({"_id": o["contact_id"]})
        if c:
            return c
    name = (o.get("customer_name") or "").strip()
    if not name:
        return None
    cid = o.get("company_id")
    ors: List[Dict[str, Any]] = [{"name": name}]
    digits = re.sub(r"\D", "", o.get("customer_phone") or "")[-10:]
    if len(digits) == 10:
        ors.append({"phone": {"$regex": f"{digits}$"}})
    if o.get("customer_email"):
        ors.append({"email": o["customer_email"].strip().lower()})
    if o.get("customer_tax_id"):
        ors.append({"tax_number_or_id": o["customer_tax_id"]})
    c = await db.contacts.find_one({"company_id": cid, "$or": ors})
    created = False
    if not c:
        c = {"_id": f"cnt_{uuid.uuid4().hex[:8]}", "company_id": cid, "type": "customer", "name": name, "company_title": o.get("customer_company") or None, "tax_number_or_id": o.get("customer_tax_id") or "11111111111",
             "tax_office": o.get("customer_tax_office") or None, "email": (o.get("customer_email") or "").strip().lower() or None, "phone": o.get("customer_phone") or None, "address": o.get("shipping_address") or None, "city": o.get("city") or None,
             "balance": 0.0, "credit_limit": 0.0, "category": CHANNEL_CUSTOMER_CATEGORY.get((o.get("channel") or "").lower(), "Pazaryeri Müşterisi"), "is_e_invoice_user": False, "payment_term_days": 0, "late_fee_rate": 0.0,
             "b2b_enabled": False, "b2b_discount": 0.0, "source": f"order:{o.get('channel') or 'manual'}", "auto_created": True, "created_at": datetime.now(timezone.utc).isoformat()}
        await db.contacts.insert_one(c)
        created = True
    await db.orders.update_one({"_id": o["_id"]}, {"$set": {"contact_id": c["_id"], "contact_name": c.get("name")}})
    o["contact_id"], o["contact_name"] = c["_id"], c.get("name")
    c["_created"] = created
    return c

@api_router.post("/orders/auto-contacts")
async def backfill_order_contacts(req: Dict[str, Any]):
    """Carisi olmayan tüm siparişler için cari bul/oluştur."""
    company_id = req.get("company_id", "comp_nexus_main_01")
    linked = created = skipped = 0
    async for o in db.orders.find({"company_id": company_id, "$or": [{"contact_id": None}, {"contact_id": {"$exists": False}}, {"contact_id": ""}]}):
        c = await _ensure_order_contact(o)
        if not c:
            skipped += 1
            continue
        linked += 1
        created += 1 if c.get("_created") else 0
    return {"status": "success", "linked": linked, "created": created, "skipped": skipped, "message": f"{linked} sipariş cariye bağlandı ({created} yeni cari açıldı)." + (f" {skipped} siparişte müşteri adı yok." if skipped else "")}

SHOPPHP_STATUS_CODES = {"approved": 2, "preparing": 3, "shipped": 51, "completed": 81, "cancelled": 90}
CARGO_NAME_TR = {"yurtici": "Yurtiçi Kargo", "aras": "Aras Kargo", "mng": "MNG Kargo", "ptt": "PTT Kargo", "surat": "Sürat Kargo", "ups": "UPS", "dhl": "DHL", "hepsijet": "HepsiJet", "sendeo": "Sendeo", "kolaygelsin": "Kolay Gelsin", "trendyol_express": "Trendyol Express", "geliver": "Geliver"}

@api_router.put("/integrations/ecommerce/{channel_id}/rest-credentials")
async def set_shopphp_rest_credentials(channel_id: str, req: Dict[str, Any]):
    cfg = await db.integration_configs.find_one({"_id": channel_id})
    if not cfg or cfg.get("channel") != "shopphp":
        raise HTTPException(status_code=404, detail="ShopPHP kanalı bulunamadı.")
    upd: Dict[str, Any] = {"rest_email": (req.get("rest_email") or "").strip(), "rest_auto_push": bool(req.get("rest_auto_push", True))}
    if req.get("rest_password"):
        upd["rest_password_enc"] = comm_service.encrypt(req["rest_password"])
    await db.integration_configs.update_one({"_id": channel_id}, {"$set": upd})
    return {"status": "success", "rest_email": upd["rest_email"], "rest_configured": bool(upd["rest_email"] and (upd.get("rest_password_enc") or cfg.get("rest_password_enc"))), "rest_auto_push": upd["rest_auto_push"]}

def _shopphp_rest_client(cfg: dict) -> Optional["marketplace_providers.ShopPHPClient"]:
    if not (cfg.get("rest_email") and cfg.get("rest_password_enc")):
        return None
    r = marketplace_providers.shopphp_resolve(cfg)
    return marketplace_providers.ShopPHPClient({"store_url": r["store_url"] or cfg.get("store_url"), "api_key": cfg["rest_email"], "api_secret": comm_service.decrypt(cfg["rest_password_enc"])})

async def _push_order_to_shopphp(order: dict, reason: str = "manual", raise_errors: bool = False) -> Optional[dict]:
    """Onay durumu + kargo firması/takip no + fatura no bilgisini ShopPHP mağazasına REST ile yazar."""
    if (order.get("channel") or "") != "shopphp":
        return None
    cfg = await db.integration_configs.find_one({"company_id": order["company_id"], "channel": "shopphp"})
    if not cfg or (reason != "manual" and not cfg.get("rest_auto_push", True)):
        return None
    client = _shopphp_rest_client(cfg)
    if not client:
        if raise_errors:
            raise HTTPException(status_code=400, detail="ShopPHP REST API kullanıcı bilgileri girilmemiş (E-Ticaret → ShopPHP → Ayarlar → Mağazaya Geri Bildirim).")
        return None
    inv_no = None
    if order.get("invoice_id"):
        inv = await db.invoices.find_one({"_id": order["invoice_id"]}, {"invoice_number": 1})
        inv_no = (inv or {}).get("invoice_number")
    carrier = order.get("cargo_carrier_name") or CARGO_NAME_TR.get(str(order.get("cargo_carrier") or "").lower(), order.get("cargo_carrier"))
    status = SHOPPHP_STATUS_CODES.get(order.get("order_status") or "")
    log = {"_id": str(uuid.uuid4()), "company_id": order["company_id"], "order_id": order["_id"], "order_number": order.get("order_number"), "reason": reason, "sent": {"sdurum": status, "kargoFirma": carrier, "kargoSeriNo": order.get("cargo_tracking_number"), "faturaNo": inv_no}, "created_at": datetime.now(timezone.utc).isoformat()}
    try:
        res = await client.update_order(order.get("external_id") or order.get("order_number"), status=status, cargo_firm=carrier, tracking=order.get("cargo_tracking_number"), invoice_no=inv_no)
        log.update({"ok": True, "response": res if isinstance(res, (dict, list, str)) else str(res)})
    except HTTPException as e:
        log.update({"ok": False, "error": e.detail})
    finally:
        await client.close()
    await db.shopphp_push_logs.insert_one(log)
    await db.orders.update_one({"_id": order["_id"]}, {"$set": {"shopphp_push": {"at": log["created_at"], "ok": log["ok"], "error": log.get("error"), "sent": log["sent"]}}})
    if not log["ok"] and raise_errors:
        raise HTTPException(status_code=502, detail=log["error"])
    return log

@api_router.post("/orders/{order_id}/push-shopphp")
async def push_order_to_shopphp(order_id: str):
    o = await db.orders.find_one({"_id": order_id})
    if not o:
        raise HTTPException(status_code=404, detail="Sipariş bulunamadı.")
    if o.get("channel") != "shopphp":
        raise HTTPException(status_code=400, detail="Yalnızca ShopPHP siparişleri mağazaya bildirilebilir.")
    log = await _push_order_to_shopphp(o, reason="manual", raise_errors=True)
    s = log["sent"]
    return {"status": "success", "message": f"ShopPHP'ye bildirildi: durum {s.get('sdurum') or '-'}" + (f", kargo {s['kargoFirma']} {s['kargoSeriNo']}" if s.get("kargoSeriNo") else "") + (f", fatura {s['faturaNo']}" if s.get("faturaNo") else "") + ".", "sent": s}

@api_router.post("/integrations/ecommerce/{channel_id}/rest-test")
async def test_shopphp_rest(channel_id: str):
    cfg = await db.integration_configs.find_one({"_id": channel_id})
    client = _shopphp_rest_client(cfg or {})
    if not client:
        raise HTTPException(status_code=400, detail="REST kullanıcı e-postası ve parolası girilmemiş.")
    try:
        res = await client._call("GET", "orders/date/" + datetime.now(timezone.utc).strftime("%Y-%m-%d") + "_" + datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    finally:
        await client.close()
    return {"status": "success", "message": "ShopPHP REST API bağlantısı başarılı; sipariş güncellemeleri (onay, kargo, fatura no) mağazaya iletilebilir.", "sample_type": type(res).__name__}

@api_router.put("/integrations/ecommerce/{channel_id}/settlement-account")
async def set_channel_settlement_account(channel_id: str, req: Dict[str, Any]):
    cfg = await db.integration_configs.find_one({"_id": channel_id})
    if not cfg:
        raise HTTPException(status_code=404, detail="Kanal bulunamadı.")
    account_id = req.get("account_id") or None
    name = None
    if account_id:
        acc = await db.bank_accounts.find_one({"_id": account_id, "company_id": cfg["company_id"]})
        if not acc:
            raise HTTPException(status_code=404, detail="Kasa/Banka hesabı bulunamadı.")
        if await bank_guard.get_connection_for_account(db, account_id):
            raise HTTPException(status_code=400, detail="Entegre (API bağlı) hesaba otomatik hakediş yazılamaz; ödemeler banka senkronuyla gelir. Manuel bir kasa/banka hesabı seçin.")
        name = acc.get("account_name")
    await db.integration_configs.update_one({"_id": channel_id}, {"$set": {"settlement_account_id": account_id, "settlement_account_name": name}})
    return {"status": "success", "settlement_account_id": account_id, "settlement_account_name": name, "message": f"Hakediş hesabı: {name}" if name else "Hakediş hesabı kaldırıldı; faturalar yalnızca 'ödendi' işaretlenir."}

async def _post_marketplace_settlement(order: dict, invoice: dict, contact: dict) -> Optional[dict]:
    """Kanal için hakediş hesabı seçiliyse: net tutar (ciro − komisyon − hizmet/kargo) hesaba tahsilat, kesintiler 'Pazaryeri Komisyonu' masrafı."""
    channel = (order.get("channel") or "").lower()
    if channel in ("", "b2b", "manual"):
        return None
    cfg = await db.integration_configs.find_one({"company_id": order["company_id"], "channel": channel})
    if not cfg or not cfg.get("settlement_account_id"):
        return None
    acc = await db.bank_accounts.find_one({"_id": cfg["settlement_account_id"]})
    if not acc:
        return None
    p = _order_profit(order, _channel_fees(cfg, channel), {})
    deductions = round(p["commission"] + p["commission_vat"] + p["service_fee"] + p["cargo_fee"], 2)
    net = round(p["revenue"] - deductions, 2)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    now = datetime.now(timezone.utc).isoformat()
    tx = {"_id": str(uuid.uuid4()), "company_id": order["company_id"], "account_id": acc["_id"], "account_name": acc.get("account_name"), "type": "inflow", "category": "Pazaryeri Hakedişi",
          "amount": net, "currency": acc.get("currency", "TRY"), "description": f"{channel.title()} {order.get('order_number')} hakediş (brüt {p['revenue']:,.2f} − kesinti {deductions:,.2f})", "contact_id": None,
          "contact_name": contact.get("name"), "related_invoice_id": invoice["_id"], "order_id": order["_id"], "channel": channel, "source": "marketplace_settlement", "is_simulated": False, "date": today, "created_at": now}
    await db.bank_transactions.insert_one(tx)
    await db.bank_accounts.update_one({"_id": acc["_id"]}, {"$inc": {"current_balance": net}})
    exp = None
    if deductions > 0:
        exp = {"_id": str(uuid.uuid4()), "company_id": order["company_id"], "expense_number": await expenses._next_number(order["company_id"]), "date": today, "category": "Pazaryeri Komisyonu",
               "description": f"{channel.title()} {order.get('order_number')} komisyon + hizmet/kargo bedeli", "amount": round(deductions - p["commission_vat"], 2), "vat_rate": float(_channel_fees(cfg, channel).get("commission_vat_rate") or 0),
               "vat_amount": p["commission_vat"], "total": deductions, "currency": "TRY", "payment_status": "paid", "account_id": acc["_id"], "account_name": acc.get("account_name"), "paid_date": today,
               "order_id": order["_id"], "invoice_id": invoice["_id"], "channel": channel, "netted_in_settlement": True, "notes": "Hakedişten mahsup edildi (ayrı kasa çıkışı yok).", "is_recurring": False, "created_at": now}
        await db.expenses.insert_one(exp)
    await db.orders.update_one({"_id": order["_id"]}, {"$set": {"settlement": {"account_id": acc["_id"], "account_name": acc.get("account_name"), "gross": p["revenue"], "deductions": deductions, "net": net, "tx_id": tx["_id"], "expense_id": exp["_id"] if exp else None, "date": today}}})
    return {"account_name": acc.get("account_name"), "gross": p["revenue"], "deductions": deductions, "net": net}

async def _upsert_by_external(coll, company_id: str, docs: list) -> int:
    n = 0
    for d in docs:
        d["updated_at"] = datetime.now(timezone.utc).isoformat()
        r = await coll.update_one({"company_id": company_id, "channel": d["channel"], "external_id": d["external_id"]}, {"$set": d, "$setOnInsert": {"_id": str(uuid.uuid4()), "created_at": d["updated_at"]}}, upsert=True)
        n += 1 if r.upserted_id else 0
    return n

@api_router.post("/integrations/ecommerce/{channel_id}/test-connection")
async def test_ecommerce_connection(channel_id: str):
    config = await db.integration_configs.find_one({"_id": channel_id})
    if not config:
        raise HTTPException(status_code=404, detail="Entegrasyon yapılandırması bulunamadı.")
    if config.get("channel") == "shopphp":
        if not marketplace_providers.has_shopphp_credentials(config):
            return {"status": "error", "message": "Mağaza adresi ve Sipariş XML kodu (xml.php?c=siparisler&xmlc=…) gerekli. Kodu ya da tam XML adresini yapıştırabilirsiniz."}
        r = marketplace_providers.shopphp_resolve(config)
        try:
            orders = await marketplace_providers.shopphp_orders_xml(config)
            prod_note = ""
            if r["products"]:
                prods = await marketplace_providers.shopphp_products_xml(config)
                prod_note = f", ürün XML: {len(prods)} ürün/varyasyon"
            else:
                prod_note = ", ürün XML kodu (c=shopphp) yok → Ürünler & Fiyat sekmesi çalışmaz"
        except HTTPException as e:
            await db.integration_configs.update_one({"_id": channel_id}, {"$set": {"status": "error", "last_error": e.detail}})
            return {"status": "error", "message": e.detail}
        await db.integration_configs.update_one({"_id": channel_id}, {"$set": {"status": "connected", "live": True, "last_error": None, "xml_resolved": {k: bool(v) for k, v in r.items()}}})
        return {"status": "success", "live": True, "message": f"ShopPHP XML bağlantısı başarılı: sipariş XML'inde {len(orders)} sipariş{prod_note}." + (" RSS beslemesi (c=rss) fiyat/stok içermediği için kullanılmaz." if r.get("rss") else "")}
    if not marketplace_providers.has_live_credentials(config):
        return {"status": "error", "message": "API Key, API Secret ve Satıcı ID (supplier/seller ID) eksiksiz doldurulmalı."}
    if config.get("channel") == "trendyol":
        client = marketplace_providers.TrendyolClient(config)
        try:
            pkgs = await client.orders(days=1, size=1)
        except HTTPException as e:
            await db.integration_configs.update_one({"_id": channel_id}, {"$set": {"status": "error", "last_error": e.detail}})
            return {"status": "error", "message": e.detail}
        finally:
            await client.close()
        await db.integration_configs.update_one({"_id": channel_id}, {"$set": {"status": "connected", "is_active": True, "last_error": None, "live": True}})
        return {"status": "success", "live": True, "message": f"Trendyol Seller API bağlantısı doğrulandı (satıcı {config['supplier_id']}). Son 24 saatte {len(pkgs)} paket görüldü."}
    await db.integration_configs.update_one({"_id": channel_id}, {"$set": {"status": "connected", "is_active": True, "live": False}})
    return {"status": "success", "live": False, "message": f"{config.get('channel_name')} için canlı API henüz bağlı değil; bilgiler kaydedildi (SİMÜLE mod)."}

CHANNEL_CATALOG = {
    "Pazaryerleri": [("trendyol", "Trendyol"), ("hepsiburada", "Hepsiburada"), ("amazon", "Amazon"), ("n11", "n11"), ("ciceksepeti", "Çiçeksepeti"), ("pttavm", "PttAVM"), ("akakce", "Akakçe"), ("flo", "FLO"), ("pazarama", "Pazarama"), ("beymen", "Beymen"), ("teknosa", "Teknosa"),
                     ("koctas", "Koçtaş"), ("idefix", "idefix"), ("lcw", "LC Waikiki"), ("modanisa", "Modanisa"), ("turkcell_pasaj", "Turkcell Pasaj"), ("azall", "Azall"), ("allesgo", "Allesgo"), ("banayeni", "Banayeni"), ("trendyol_market", "Trendyol Go Market"), ("trendyol_yemek", "Trendyol Go Yemek"),
                     ("getir_carsi", "Getir Çarşı"), ("boyner", "Boyner"), ("azkarbon", "Azkarbon"), ("toptantr", "ToptanTR")],
    "e-Ticaret Altyapıları": [("shopphp", "ShopPHP"), ("wix", "Wix"), ("opencart", "OpenCart"), ("tsoft", "T-Soft"), ("woocommerce", "WooCommerce"), ("ikas", "ikas"), ("shopify", "Shopify"), ("ideasoft", "İdeasoft"), ("imagaza", "iMağaza"), ("prestashop", "PrestaShop"), ("proticaret", "ProTicaret"),
                              ("ticimax", "Ticimax"), ("omnieticaret", "Omni e-Ticaret"), ("platinmarket", "PlatinMarket"), ("whmcs", "WHMCS"), ("ganipara", "Ganipara"), ("softtr", "SoftTR"), ("eticaretkur", "e-TicaretKur"), ("faprika", "Faprika"), ("akilliticaret", "Akıllı Ticaret"), ("kolaysiparis", "Kolay Sipariş"),
                              ("bilgikurumsal", "Bilgi Kurumsal"), ("qukasoft", "Qukasoft"), ("hipotenus", "Hipotenüs"), ("rgsyazilim", "RGS Yazılım"), ("dokuzyazilim", "Dokuz Yazılım"), ("shopier", "Shopier"), ("wisecp", "WISECP"), ("jetteknoloji", "Jet Teknoloji")],
    "e-İhracat": [("amazon_global", "Amazon Global"), ("ozon", "Ozon"), ("aliexpress", "AliExpress"), ("hepsiglobal", "HepsiGlobal"), ("etsy", "Etsy"), ("joom", "Joom"), ("wish", "Wish")],
    "e-Ticaret Entegratörleri": [("entegra", "Entegra"), ("prapazar", "PraPazar"), ("sopyo", "Sopyo"), ("stockmount", "StockMount"), ("pixasoftware", "Pixa Software"), ("sentos", "Sentos"), ("dopigo", "Dopigo"), ("platin360", "Platin360")],
}
LIVE_API_CHANNELS = {"trendyol": "Canlı API (sipariş, iade, soru, fiyat/stok)", "shopphp": "Canlı XML servisi (sipariş çekme, ürün/varyasyon/stok/fiyat okuma)"}

@api_router.get("/integrations/ecommerce/catalog")
async def ecommerce_channel_catalog(company_id: Optional[str] = "comp_nexus_main_01"):
    existing = {c["channel"] for c in await db.integration_configs.find({"company_id": company_id}, {"channel": 1}).to_list(500)}
    return {"groups": [{"group": g, "channels": [{"code": c, "name": n, "added": c in existing, "live_api": LIVE_API_CHANNELS.get(c)} for c, n in chs]} for g, chs in CHANNEL_CATALOG.items()]}

@api_router.post("/integrations/ecommerce/add-channel")
async def add_ecommerce_channel(req: Dict[str, Any]):
    company_id = req.get("company_id", "comp_nexus_main_01"); code = (req.get("channel") or "").strip().lower()
    name = next((n for chs in CHANNEL_CATALOG.values() for c, n in chs if c == code), None)
    if not name:
        raise HTTPException(status_code=400, detail="Katalogda olmayan kanal.")
    if await db.integration_configs.find_one({"company_id": company_id, "channel": code}):
        raise HTTPException(status_code=400, detail=f"{name} zaten ekli.")
    doc = {"_id": f"ecom_{code}_{uuid.uuid4().hex[:4]}" if code != "shopphp" else "ecom_shopphp", "company_id": company_id, "channel": code, "channel_name": name, "is_active": False, "api_key": "", "api_secret": "", "supplier_id": "", "store_url": "",
           "status": "not_configured", "live": False, "synced_orders": 0, "auto_invoice": False, "stock_sync": True, "created_at": datetime.now(timezone.utc).isoformat(), "live_api": LIVE_API_CHANNELS.get(code)}
    if await db.integration_configs.find_one({"_id": doc["_id"]}):
        doc["_id"] = f"ecom_{code}_{uuid.uuid4().hex[:4]}"
    await db.integration_configs.insert_one(doc)
    return {"status": "success", "channel": clean_doc(doc), "message": f"{name} kanalı eklendi." + (" API bilgilerini girerek bağlantıyı kurun." if code in LIVE_API_CHANNELS else " Bu kanal için henüz canlı API bağlantısı yok; siparişleri Excel/AI ile yükleyebilir, fiyat/komisyon ayarlarını kullanabilirsiniz.")}

@api_router.delete("/integrations/ecommerce/{channel_id}")
async def remove_ecommerce_channel(channel_id: str):
    cfg = await db.integration_configs.find_one({"_id": channel_id})
    if not cfg:
        raise HTTPException(status_code=404, detail="Kanal bulunamadı.")
    if await db.orders.count_documents({"company_id": cfg["company_id"], "channel": cfg["channel"]}):
        raise HTTPException(status_code=400, detail="Bu kanala ait siparişler var; kanal silinemez, pasife alın.")
    await db.integration_configs.delete_one({"_id": channel_id})
    return {"status": "success", "message": f"{cfg.get('channel_name')} kanalı kaldırıldı."}

@api_router.post("/integrations/ecommerce/{channel_id}/sync-now")
async def sync_ecommerce_channel(channel_id: str, days: int = 14):
    config = await db.integration_configs.find_one({"_id": channel_id})
    if not config:
        raise HTTPException(status_code=404, detail="Entegrasyon bulunamadı.")
    company_id = config.get("company_id", "comp_nexus_main_01")
    channel = config.get("channel", "trendyol")
    now = datetime.now(timezone.utc).isoformat()
    if channel == "shopphp" and marketplace_providers.has_shopphp_credentials(config):
        try:
            raw_orders = await marketplace_providers.shopphp_orders_xml(config)
        except HTTPException as e:
            await db.integration_configs.update_one({"_id": channel_id}, {"$set": {"status": "error", "last_error": e.detail, "last_sync_attempt_at": now}})
            raise
        res = await _upsert_marketplace_orders(company_id, [marketplace_providers.map_shopphp_xml_order(o, company_id, channel) for o in raw_orders])
        await db.integration_configs.update_one({"_id": channel_id}, {"$set": {"status": "connected", "live": True, "last_error": None, "last_synced_at": now, "last_sync_attempt_at": now}, "$inc": {"synced_orders": res["inserted"]}})
        return {"status": "success", "live": True, "channel": channel, **res, "message": f"ShopPHP: {len(raw_orders)} sipariş okundu → {res['inserted']} yeni, {res['updated']} güncellendi."}
    if channel == "trendyol" and marketplace_providers.has_live_credentials(config):
        client = marketplace_providers.TrendyolClient(config)
        try:
            pkgs = await client.orders(days=days)
            claims = await client.claims(days=max(days, 30))
            questions = await client.questions("WAITING_FOR_ANSWER") + await client.questions("ANSWERED")
        except HTTPException as e:
            await db.integration_configs.update_one({"_id": channel_id}, {"$set": {"status": "error", "last_error": e.detail, "last_sync_attempt_at": now}})
            raise
        finally:
            await client.close()
        res = await _upsert_marketplace_orders(company_id, [marketplace_providers.map_trendyol_order(p, company_id, channel) for p in pkgs])
        new_claims = await _upsert_by_external(db.marketplace_claims, company_id, [marketplace_providers.map_trendyol_claim(c, company_id, channel) for c in claims])
        new_q = await _upsert_by_external(db.marketplace_questions, company_id, [marketplace_providers.map_trendyol_question(q, company_id, channel) for q in questions])
        await db.integration_configs.update_one({"_id": channel_id}, {"$set": {"status": "connected", "live": True, "last_error": None, "last_synced_at": now, "last_sync_attempt_at": now}, "$inc": {"synced_orders": res["inserted"]}})
        cancelled = sum(1 for p in pkgs if (p.get("shipmentPackageStatus") or p.get("status")) == "Cancelled")
        return {"status": "success", "live": True, **res, "claims": len(claims), "new_claims": new_claims, "questions": len(questions), "new_questions": new_q, "cancelled": cancelled,
                "message": f"Trendyol canlı senkron: {len(pkgs)} paket ({res['inserted']} yeni, {res['updated']} güncellendi, {cancelled} iptal), {len(claims)} iade talebi, {len(questions)} müşteri sorusu çekildi."}
    docs = marketplace_providers.simulated_orders(company_id, channel)
    res = await _upsert_marketplace_orders(company_id, docs)
    await db.integration_configs.update_one({"_id": channel_id}, {"$set": {"last_synced_at": now, "live": False}})
    return {"status": "success", "live": False, **res, "message": f"[SİMÜLE] {config.get('channel_name')} için API bilgisi eksik; {res['inserted']} örnek sipariş oluşturuldu. Gerçek siparişler için API Key/Secret ve Satıcı ID girin."}

async def _marketplace_auto_sync_loop(interval_s: int = 600):
    """Canlı kimlik bilgisi olan pazaryeri kanallarını 10 dakikada bir otomatik senkronize eder."""
    import asyncio as _a
    await _a.sleep(20)
    while True:
        try:
            for cfg in await db.integration_configs.find({"is_active": True, "channel": "trendyol"}).to_list(50):
                if marketplace_providers.has_live_credentials(cfg) and cfg.get("auto_sync", True):
                    try:
                        await sync_ecommerce_channel(cfg["_id"], days=3)
                    except HTTPException:
                        pass
        except Exception:
            pass
        await _a.sleep(interval_s)

DEFAULT_CHANNEL_FEES = {"trendyol": {"commission_rate": 21.5, "service_fee": 12.99, "cargo_fee": 0.0}, "hepsiburada": {"commission_rate": 18.0, "service_fee": 9.90, "cargo_fee": 0.0},
                        "amazon": {"commission_rate": 15.0, "service_fee": 0.0, "cargo_fee": 0.0}, "n11": {"commission_rate": 16.0, "service_fee": 7.99, "cargo_fee": 0.0}, "ciceksepeti": {"commission_rate": 20.0, "service_fee": 0.0, "cargo_fee": 0.0}}

def _channel_fees(cfg: Optional[dict], channel: str) -> dict:
    base = {"commission_rate": 0.0, "service_fee": 0.0, "cargo_fee": 0.0, "commission_vat_rate": 20.0, **DEFAULT_CHANNEL_FEES.get(channel, {})}
    return {**base, **((cfg or {}).get("fees") or {})}

@api_router.put("/integrations/ecommerce/{channel_id}/fees")
async def set_channel_fees(channel_id: str, req: Dict[str, Any]):
    cfg = await db.integration_configs.find_one({"_id": channel_id})
    if not cfg:
        raise HTTPException(status_code=404, detail="Kanal bulunamadı.")
    fees = {}
    for k in ("commission_rate", "service_fee", "cargo_fee", "commission_vat_rate"):
        if req.get(k) not in (None, ""):
            v = float(req[k])
            if v < 0 or (k.endswith("_rate") and v > 100):
                raise HTTPException(status_code=400, detail=f"{k} geçersiz.")
            fees[k] = v
    await db.integration_configs.update_one({"_id": channel_id}, {"$set": {"fees": {**_channel_fees(cfg, cfg.get("channel", "")), **fees}}})
    return {"status": "success", "fees": _channel_fees(await db.integration_configs.find_one({"_id": channel_id}), cfg.get("channel", ""))}

def _order_profit(o: dict, fees: dict, cost_lookup: Dict[str, float]) -> dict:
    revenue = float(o.get("total_amount") or 0)
    commission = round(revenue * float(fees.get("commission_rate") or 0) / 100, 2)
    commission_vat = round(commission * float(fees.get("commission_vat_rate") or 0) / 100, 2)
    service = float(fees.get("service_fee") or 0)
    cargo = float(o.get("cargo_cost") or fees.get("cargo_fee") or 0)
    cost, missing = 0.0, 0
    for it in o.get("items") or []:
        c = cost_lookup.get(it.get("barcode") or "") or cost_lookup.get(it.get("sku") or "") or cost_lookup.get(it.get("product_id") or "")
        if c is None:
            missing += 1
        cost += float(c or 0) * int(it.get("quantity") or 1)
    vat_on_sale = round(revenue - revenue / 1.20, 2)
    net = round(revenue - vat_on_sale - commission - commission_vat - service - cargo - cost, 2)
    return {"revenue": revenue, "sale_vat": vat_on_sale, "commission": commission, "commission_vat": commission_vat, "service_fee": service, "cargo_fee": cargo, "product_cost": round(cost, 2),
            "net_profit": net, "margin_pct": round(net / revenue * 100, 1) if revenue else 0.0, "cost_missing_items": missing}

@api_router.get("/marketplace/profitability")
async def marketplace_profitability(company_id: Optional[str] = "comp_nexus_main_01", days: int = 30, channel: Optional[str] = None):
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    q: Dict[str, Any] = {"company_id": company_id, "order_date": {"$gte": since}, "order_status": {"$nin": ["cancelled", "returned"]}, "channel": {"$nin": ["b2b", "manual", None]}}
    if channel:
        q["channel"] = channel
    orders = await db.orders.find(q).sort("order_date", -1).to_list(2000)
    cfgs = {c["channel"]: c for c in await db.integration_configs.find({"company_id": company_id}).to_list(50)}
    products = await db.products.find({"company_id": company_id}).to_list(5000)
    lookup: Dict[str, float] = {}
    for p in products:
        for key in (p.get("barcode"), p.get("sku"), p["_id"]):
            if key:
                lookup[key] = float(p.get("purchase_price") or 0)
        for v in p.get("variants") or []:
            if v.get("barcode"):
                lookup[v["barcode"]] = float(v.get("purchase_price") or p.get("purchase_price") or 0)
    rows, by_channel, by_product = [], {}, {}
    for o in orders:
        fees = _channel_fees(cfgs.get(o.get("channel")), o.get("channel") or "")
        pr = _order_profit(o, fees, lookup)
        rows.append({"id": o["_id"], "order_number": o.get("order_number"), "channel": o.get("channel"), "order_date": o.get("order_date"), "customer_name": o.get("customer_name"), "status": o.get("order_status"), **pr})
        ch = by_channel.setdefault(o.get("channel"), {"channel": o.get("channel"), "orders": 0, "revenue": 0.0, "commission": 0.0, "fees": 0.0, "product_cost": 0.0, "net_profit": 0.0, "fee_settings": fees, "channel_id": (cfgs.get(o.get("channel")) or {}).get("_id")})
        ch["orders"] += 1; ch["revenue"] += pr["revenue"]; ch["commission"] += pr["commission"] + pr["commission_vat"]; ch["fees"] += pr["service_fee"] + pr["cargo_fee"]; ch["product_cost"] += pr["product_cost"]; ch["net_profit"] += pr["net_profit"]
        for it in o.get("items") or []:
            key = it.get("product_name") or it.get("sku")
            bp = by_product.setdefault(key, {"product_name": key, "qty": 0, "revenue": 0.0, "cost": 0.0})
            bp["qty"] += int(it.get("quantity") or 1); bp["revenue"] += float(it.get("total") or (float(it.get("unit_price") or 0) * int(it.get("quantity") or 1))); bp["cost"] += float(lookup.get(it.get("barcode") or "") or lookup.get(it.get("sku") or "") or 0) * int(it.get("quantity") or 1)
    for ch in by_channel.values():
        for k in ("revenue", "commission", "fees", "product_cost", "net_profit"):
            ch[k] = round(ch[k], 2)
        ch["margin_pct"] = round(ch["net_profit"] / ch["revenue"] * 100, 1) if ch["revenue"] else 0.0
    for c in cfgs.values():
        if c["channel"] not in by_channel and c["channel"] not in ("b2b",):
            by_channel[c["channel"]] = {"channel": c["channel"], "orders": 0, "revenue": 0.0, "commission": 0.0, "fees": 0.0, "product_cost": 0.0, "net_profit": 0.0, "margin_pct": 0.0, "fee_settings": _channel_fees(c, c["channel"]), "channel_id": c["_id"]}
    for ch in by_channel.values():
        cfg = cfgs.get(ch["channel"]) or {}
        ch["settlement_account_id"] = cfg.get("settlement_account_id")
        ch["settlement_account_name"] = cfg.get("settlement_account_name")
    settled = await db.orders.find({"company_id": company_id, "settlement.date": {"$gte": since[:10]}}, {"settlement": 1}).to_list(5000)
    settlement_total = {"count": len(settled), "gross": round(sum(float(o["settlement"].get("gross") or 0) for o in settled), 2), "deductions": round(sum(float(o["settlement"].get("deductions") or 0) for o in settled), 2), "net": round(sum(float(o["settlement"].get("net") or 0) for o in settled), 2)}
    total = {"orders": len(rows), "revenue": round(sum(r["revenue"] for r in rows), 2), "net_profit": round(sum(r["net_profit"] for r in rows), 2), "commission": round(sum(r["commission"] + r["commission_vat"] for r in rows), 2)}
    total["margin_pct"] = round(total["net_profit"] / total["revenue"] * 100, 1) if total["revenue"] else 0.0
    top = sorted(by_product.values(), key=lambda x: -(x["revenue"] - x["cost"]))
    return {"days": days, "total": total, "settlement": settlement_total, "channels": sorted(by_channel.values(), key=lambda x: -x["revenue"]), "orders": rows[:300], "top_products": [{**t, "gross_profit": round(t["revenue"] - t["cost"], 2)} for t in top[:10]],
            "low_margin": [r for r in rows if r["margin_pct"] < 10][:20]}

@api_router.get("/label-templates")
async def list_label_templates(company_id: Optional[str] = "comp_nexus_main_01"):
    return clean_docs(await db.label_templates.find({"company_id": company_id}).sort("created_at", 1).to_list(200))

@api_router.post("/label-templates")
async def create_label_template(req: Dict[str, Any]):
    company_id = req.get("company_id", "comp_nexus_main_01")
    doc = {"_id": str(uuid.uuid4()), "company_id": company_id, "name": (req.get("name") or "Yeni Etiket").strip(), "width_mm": float(req.get("width_mm") or 100), "height_mm": float(req.get("height_mm") or 30), "elements": req.get("elements") or [],
           "page": req.get("page") or {"mode": "thermal", "cols": 1, "rows": 1, "gap_mm": 2}, "is_default": bool(req.get("is_default")), "created_at": datetime.now(timezone.utc).isoformat()}
    if doc["is_default"]:
        await db.label_templates.update_many({"company_id": company_id}, {"$set": {"is_default": False}})
    await db.label_templates.insert_one(doc)
    return clean_doc(doc)

@api_router.put("/label-templates/{tpl_id}")
async def update_label_template(tpl_id: str, req: Dict[str, Any]):
    t = await db.label_templates.find_one({"_id": tpl_id})
    if not t:
        raise HTTPException(status_code=404, detail="Şablon bulunamadı.")
    allowed = {k: v for k, v in req.items() if k in {"name", "width_mm", "height_mm", "elements", "page", "is_default"}}
    if allowed.get("is_default"):
        await db.label_templates.update_many({"company_id": t["company_id"]}, {"$set": {"is_default": False}})
    await db.label_templates.update_one({"_id": tpl_id}, {"$set": {**allowed, "updated_at": datetime.now(timezone.utc).isoformat()}})
    return clean_doc(await db.label_templates.find_one({"_id": tpl_id}))

@api_router.delete("/label-templates/{tpl_id}")
async def delete_label_template(tpl_id: str):
    r = await db.label_templates.delete_one({"_id": tpl_id})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Şablon bulunamadı.")
    return {"status": "success"}

@api_router.get("/marketplace/product-profitability")
async def product_profitability(company_id: Optional[str] = "comp_nexus_main_01", days: int = 90):
    """Ürün bazında pazaryeri satış/komisyon/maliyet/kâr + eşleşmeyen pazaryeri kalemleri."""
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    orders = await db.orders.find({"company_id": company_id, "order_date": {"$gte": since}, "order_status": {"$nin": ["cancelled", "returned"]}, "channel": {"$nin": ["b2b", "manual", None]}}).to_list(3000)
    cfgs = {c["channel"]: c for c in await db.integration_configs.find({"company_id": company_id}).to_list(50)}
    products = await db.products.find({"company_id": company_id}).to_list(5000)
    idx: Dict[str, dict] = {}
    for p in products:
        for key in [p.get("barcode"), p.get("sku"), p["_id"], *(p.get("marketplace_aliases") or [])] + [v.get("barcode") for v in (p.get("variants") or []) if v.get("barcode")]:
            if key:
                idx[str(key).strip().lower()] = p
    stats: Dict[str, dict] = {}
    unmatched: Dict[str, dict] = {}
    for o in orders:
        fees = _channel_fees(cfgs.get(o.get("channel")), o.get("channel") or "")
        order_total = float(o.get("total_amount") or 0) or 1.0
        for it in o.get("items") or []:
            keys = [it.get("barcode"), it.get("sku"), it.get("product_id")]
            p = next((idx[str(k).strip().lower()] for k in keys if k and str(k).strip().lower() in idx), None)
            line_rev = float(it.get("total") or (float(it.get("unit_price") or 0) * int(it.get("quantity") or 1)))
            qty = int(it.get("quantity") or 1)
            if not p:
                uk = str(it.get("barcode") or it.get("sku") or it.get("product_name")).strip().lower()
                u = unmatched.setdefault(uk, {"key": uk, "product_name": it.get("product_name"), "barcode": it.get("barcode"), "sku": it.get("sku"), "channels": set(), "qty": 0, "revenue": 0.0})
                u["qty"] += qty; u["revenue"] += line_rev; u["channels"].add(o.get("channel"))
                continue
            st = stats.setdefault(p["_id"], {"product_id": p["_id"], "product_name": p.get("name"), "sku": p.get("sku"), "barcode": p.get("barcode"), "purchase_price": float(p.get("purchase_price") or 0), "sale_price": float(p.get("sale_price") or 0), "qty": 0, "revenue": 0.0, "commission": 0.0, "fees": 0.0, "cost": 0.0, "channels": {}})
            comm = round(line_rev * float(fees.get("commission_rate") or 0) / 100 * (1 + float(fees.get("commission_vat_rate") or 0) / 100), 2)
            fee_share = round((float(fees.get("service_fee") or 0) + float(fees.get("cargo_fee") or 0)) * line_rev / order_total, 2)
            cost = float(p.get("purchase_price") or 0) * qty
            st["qty"] += qty; st["revenue"] += line_rev; st["commission"] += comm; st["fees"] += fee_share; st["cost"] += cost
            ch = st["channels"].setdefault(o.get("channel"), {"channel": o.get("channel"), "qty": 0, "revenue": 0.0, "net": 0.0})
            ch["qty"] += qty; ch["revenue"] += line_rev; ch["net"] += line_rev - (line_rev - line_rev / 1.2) - comm - fee_share - cost
    rows = []
    for st in stats.values():
        vat = st["revenue"] - st["revenue"] / 1.2
        net = round(st["revenue"] - vat - st["commission"] - st["fees"] - st["cost"], 2)
        rows.append({**st, "revenue": round(st["revenue"], 2), "commission": round(st["commission"], 2), "fees": round(st["fees"], 2), "cost": round(st["cost"], 2), "sale_vat": round(vat, 2), "net_profit": net,
                     "margin_pct": round(net / st["revenue"] * 100, 1) if st["revenue"] else 0.0, "avg_price": round(st["revenue"] / st["qty"], 2) if st["qty"] else 0.0, "unit_profit": round(net / st["qty"], 2) if st["qty"] else 0.0,
                     "channels": [{**c, "revenue": round(c["revenue"], 2), "net": round(c["net"], 2)} for c in st["channels"].values()]})
    rows.sort(key=lambda r: -r["net_profit"])
    return {"days": days, "rows": rows, "unmatched": [{**u, "channels": sorted(c for c in u["channels"] if c), "revenue": round(u["revenue"], 2)} for u in unmatched.values()],
            "products": [{"id": p["_id"], "name": p.get("name"), "sku": p.get("sku")} for p in products]}

@api_router.get("/marketplace/products")
async def marketplace_products(company_id: Optional[str] = "comp_nexus_main_01", channel: str = "trendyol", refresh: bool = False):
    """Pazaryeri ürün listesi (canlı API varsa çekilir, önbelleğe yazılır) + stok kartı eşleşmesi ve fiyat karşılaştırması."""
    cfg = await db.integration_configs.find_one({"company_id": company_id, "channel": channel})
    cache = await db.marketplace_product_cache.find_one({"company_id": company_id, "channel": channel})
    live = bool(cfg and ((channel == "trendyol" and marketplace_providers.has_live_credentials(cfg)) or (channel == "shopphp" and marketplace_providers.has_shopphp_credentials(cfg) and cfg.get("api_secret"))))
    items = (cache or {}).get("items") or []
    fetched_at = (cache or {}).get("fetched_at")
    if live and channel == "shopphp" and (refresh or not cache):
        items = await marketplace_providers.shopphp_products_xml(cfg)
        fetched_at = datetime.now(timezone.utc).isoformat()
        await db.marketplace_product_cache.update_one({"company_id": company_id, "channel": channel}, {"$set": {"items": items, "fetched_at": fetched_at}, "$setOnInsert": {"_id": str(uuid.uuid4()), "company_id": company_id, "channel": channel}}, upsert=True)
    elif live and (refresh or not cache):
        client = marketplace_providers.TrendyolClient(cfg)
        try:
            raw = await client.products()
        finally:
            await client.close()
        items = [{"barcode": str(p.get("barcode") or ""), "title": p.get("title"), "stock_code": p.get("stockCode"), "product_main_id": p.get("productMainId"), "sale_price": float(p.get("salePrice") or 0), "list_price": float(p.get("listPrice") or 0),
                  "quantity": int(p.get("quantity") or 0), "approved": bool(p.get("approved")), "on_sale": bool(p.get("onSale", True)), "brand": p.get("brand"), "category": p.get("categoryName"), "image": ((p.get("images") or [{}])[0] or {}).get("url"), "vat_rate": p.get("vatRate")} for p in raw]
        fetched_at = datetime.now(timezone.utc).isoformat()
        await db.marketplace_product_cache.update_one({"company_id": company_id, "channel": channel}, {"$set": {"items": items, "fetched_at": fetched_at}, "$setOnInsert": {"_id": str(uuid.uuid4()), "company_id": company_id, "channel": channel}}, upsert=True)
    products = await db.products.find({"company_id": company_id}).to_list(5000)
    idx: Dict[str, dict] = {}
    for p in products:
        for key in [p.get("barcode"), p.get("sku"), *(p.get("marketplace_aliases") or [])] + [v.get("barcode") for v in (p.get("variants") or []) if v.get("barcode")]:
            if key:
                idx[str(key).strip().lower()] = p
    rows = []
    for it in items:
        p = idx.get(it["barcode"].lower()) or (idx.get(str(it.get("stock_code") or "").lower()) if it.get("stock_code") else None)
        local_price = float(p.get("sale_price") or 0) if p else None
        local_stock = float(p.get("stock_quantity") or 0) if p else None
        rows.append({**it, "product_id": p["_id"] if p else None, "product_name": p.get("name") if p else None, "product_sku": p.get("sku") if p else None, "local_price": local_price, "local_stock": local_stock, "purchase_price": float(p.get("purchase_price") or 0) if p else None,
                     "price_diff": round(it["sale_price"] - local_price, 2) if p and local_price else None, "stock_diff": round(it["quantity"] - local_stock, 2) if p else None})
    return {"channel": channel, "live": live, "push_supported": channel == "trendyol", "fetched_at": fetched_at, "count": len(rows), "matched": sum(1 for r in rows if r["product_id"]), "rows": rows,
            "products": [{"id": p["_id"], "name": p.get("name"), "sku": p.get("sku"), "sale_price": p.get("sale_price"), "stock_quantity": p.get("stock_quantity")} for p in products]}

@api_router.post("/marketplace/products/push")
async def marketplace_push_price_stock(req: Dict[str, Any]):
    """Seçili ürünlerin fiyat / stok bilgisini pazaryerine gönder. items: [{barcode, sale_price?, list_price?, quantity?}] veya from_stock=true → eşleşen stok kartından."""
    company_id = req.get("company_id", "comp_nexus_main_01"); channel = req.get("channel", "trendyol")
    cfg = await db.integration_configs.find_one({"company_id": company_id, "channel": channel})
    if not cfg or channel != "trendyol" or not marketplace_providers.has_live_credentials(cfg):
        raise HTTPException(status_code=400, detail="Bu kanal için canlı API bağlantısı yok; E-Ticaret Entegrasyon ekranından API bilgilerini girin.")
    items = []
    for it in req.get("items") or []:
        row: Dict[str, Any] = {"barcode": str(it.get("barcode") or "").strip()}
        if not row["barcode"]:
            continue
        if req.get("from_stock"):
            p = await db.products.find_one({"company_id": company_id, "$or": [{"barcode": row["barcode"]}, {"marketplace_aliases": row["barcode"]}, {"variants.barcode": row["barcode"]}]})
            if not p:
                continue
            row["salePrice"] = float(p.get("sale_price") or 0); row["listPrice"] = float(p.get("sale_price") or 0); row["quantity"] = int(max(0, float(p.get("stock_quantity") or 0)))
        else:
            if it.get("sale_price") not in (None, ""):
                row["salePrice"] = float(it["sale_price"]); row["listPrice"] = float(it.get("list_price") or it["sale_price"])
            if it.get("quantity") not in (None, ""):
                row["quantity"] = int(it["quantity"])
        if len(row) > 1:
            items.append(row)
    if not items:
        raise HTTPException(status_code=400, detail="Gönderilecek fiyat/stok verisi yok.")
    client = marketplace_providers.TrendyolClient(cfg)
    try:
        res = await client.update_price_inventory(items)
    finally:
        await client.close()
    # önbelleği güncelle
    cache = await db.marketplace_product_cache.find_one({"company_id": company_id, "channel": channel})
    if cache:
        by_bc = {i["barcode"]: i for i in items}
        for c in cache.get("items") or []:
            u = by_bc.get(c["barcode"])
            if u:
                c.update({k2: u[k1] for k1, k2 in (("salePrice", "sale_price"), ("listPrice", "list_price"), ("quantity", "quantity")) if k1 in u})
        await db.marketplace_product_cache.update_one({"_id": cache["_id"]}, {"$set": {"items": cache["items"]}})
    await db.marketplace_push_logs.insert_one({"_id": str(uuid.uuid4()), "company_id": company_id, "channel": channel, "items": items, "batch_request_id": (res or {}).get("batchRequestId"), "created_at": datetime.now(timezone.utc).isoformat()})
    return {"status": "success", "sent": len(items), "batch_request_id": (res or {}).get("batchRequestId"), "message": f"{len(items)} ürünün fiyat/stok bilgisi Trendyol'a gönderildi (toplu işlem no: {(res or {}).get('batchRequestId') or '-'}). Yansıması birkaç dakika sürebilir."}

@api_router.get("/marketplace/push-logs")
async def marketplace_push_logs(company_id: Optional[str] = "comp_nexus_main_01", channel: str = "trendyol", check: bool = False):
    """Fiyat/stok gönderim geçmişi; check=true ise Trendyol'dan toplu işlem durumunu sorgular."""
    logs = await db.marketplace_push_logs.find({"company_id": company_id, "channel": channel}).sort("created_at", -1).to_list(30)
    if check and logs:
        cfg = await db.integration_configs.find_one({"company_id": company_id, "channel": channel})
        if cfg and marketplace_providers.has_live_credentials(cfg):
            client = marketplace_providers.TrendyolClient(cfg)
            try:
                for lg in logs[:10]:
                    if lg.get("batch_request_id") and lg.get("status") not in ("COMPLETED", "FAILED"):
                        try:
                            st = await client.batch_status(lg["batch_request_id"]) or {}
                        except Exception as e:
                            st = {"status": "UNKNOWN", "error": str(e)[:120]}
                        items = st.get("items") or []
                        fails = [{"barcode": (i.get("requestItem") or {}).get("barcode"), "reasons": i.get("failureReasons") or []} for i in items if i.get("status") == "FAILED"]
                        upd = {"status": st.get("status") or ("COMPLETED" if items and not fails else "PROCESSING"), "item_count": st.get("itemCount"), "failed_items": fails, "checked_at": datetime.now(timezone.utc).isoformat()}
                        await db.marketplace_push_logs.update_one({"_id": lg["_id"]}, {"$set": upd}); lg.update(upd)
            finally:
                await client.close()
    return [{"id": l["_id"], "created_at": l["created_at"], "batch_request_id": l.get("batch_request_id"), "sent": len(l.get("items") or []), "items": l.get("items"), "status": l.get("status") or "SENT", "failed_items": l.get("failed_items") or [], "checked_at": l.get("checked_at")} for l in logs]

@api_router.post("/marketplace/product-create")
async def create_product_from_marketplace(req: Dict[str, Any]):
    """Eşleşmeyen pazaryeri ürününden stok kartı oluştur (barkod/SKU otomatik eşlenir)."""
    company_id = req.get("company_id", "comp_nexus_main_01")
    name = (req.get("product_name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Ürün adı gerekli.")
    barcode = (req.get("barcode") or "").strip()
    sku = (req.get("sku") or "").strip() or (barcode or f"MP-{uuid.uuid4().hex[:6].upper()}")
    if barcode and await db.products.find_one({"company_id": company_id, "$or": [{"barcode": barcode}, {"variants.barcode": barcode}]}):
        raise HTTPException(status_code=400, detail="Bu barkodla bir stok kartı zaten var; 'Eşleştir' ile bağlayın.")
    if await db.products.find_one({"company_id": company_id, "sku": sku}):
        sku = f"{sku}-{uuid.uuid4().hex[:4].upper()}"
    aliases = [a for a in {barcode, (req.get("sku") or "").strip(), name.lower()} if a]
    p = Product(company_id=company_id, name=name, sku=sku, barcode=barcode or f"868{str(uuid.uuid4().int)[:10]}", category=req.get("category") or "Pazaryeri", sale_price=float(req.get("sale_price") or 0),
                purchase_price=float(req.get("purchase_price") or 0), stock_quantity=float(req.get("stock_quantity") or 0), vat_rate=int(req.get("vat_rate") or 20))
    doc = p.to_mongo()
    doc["marketplace_aliases"] = aliases
    doc["source"] = f"marketplace:{req.get('channel') or ''}"
    await db.products.insert_one(doc)
    await _remember_category(company_id, doc["category"])
    return {"status": "success", "product": clean_doc(doc), "message": f"'{name}' stok kartı oluşturuldu ve pazaryeri ürünüyle eşleştirildi. Alış fiyatını girmeyi unutmayın."}

@api_router.post("/marketplace/product-match")
async def match_marketplace_product(req: Dict[str, Any]):
    alias = str(req.get("alias") or "").strip()
    p = await db.products.find_one({"_id": req.get("product_id")})
    if not p or not alias:
        raise HTTPException(status_code=400, detail="Ürün ve pazaryeri barkod/SKU gerekli.")
    await db.products.update_one({"_id": p["_id"]}, {"$addToSet": {"marketplace_aliases": alias}})
    return {"status": "success", "message": f"'{alias}' → {p.get('name')} eşleştirildi. Kârlılık ve stok düşümü bu ürün üzerinden hesaplanır."}

@api_router.get("/marketplace/claims")
async def list_marketplace_claims(company_id: Optional[str] = "comp_nexus_main_01", status: Optional[str] = None):
    q: Dict[str, Any] = {"company_id": company_id}
    if status:
        q["status"] = status
    return clean_docs(await db.marketplace_claims.find(q).sort("claim_date", -1).to_list(500))

@api_router.post("/marketplace/claims/{claim_id}/approve")
async def approve_marketplace_claim(claim_id: str, req: Dict[str, Any] = None):
    c = await db.marketplace_claims.find_one({"_id": claim_id})
    if not c:
        raise HTTPException(status_code=404, detail="İade talebi bulunamadı.")
    cfg = await db.integration_configs.find_one({"company_id": c["company_id"], "channel": c["channel"]})
    line_ids = (req or {}).get("claim_item_ids") or [i["claim_item_id"] for i in c.get("items", []) if i.get("claim_item_id")]
    if c["channel"] == "trendyol" and cfg and marketplace_providers.has_live_credentials(cfg) and c.get("external_id"):
        client = marketplace_providers.TrendyolClient(cfg)
        try:
            await client.approve_claim(c["external_id"], line_ids)
        finally:
            await client.close()
    await db.marketplace_claims.update_one({"_id": claim_id}, {"$set": {"status": "Accepted", "decided_at": datetime.now(timezone.utc).isoformat(), "decision_note": (req or {}).get("note", "")}})
    if (req or {}).get("restock"):
        for it in c.get("items", []):
            if it.get("barcode"):
                await db.products.update_one({"company_id": c["company_id"], "barcode": it["barcode"]}, {"$inc": {"stock_quantity": 1}})
    return clean_doc(await db.marketplace_claims.find_one({"_id": claim_id}))

@api_router.get("/marketplace/questions")
async def list_marketplace_questions(company_id: Optional[str] = "comp_nexus_main_01", status: Optional[str] = None):
    q: Dict[str, Any] = {"company_id": company_id}
    if status:
        q["status"] = status
    return clean_docs(await db.marketplace_questions.find(q).sort("asked_at", -1).to_list(500))

@api_router.post("/marketplace/questions/{question_id}/answer")
async def answer_marketplace_question(question_id: str, req: Dict[str, Any]):
    text = (req.get("text") or "").strip()
    if len(text) < 10 or len(text) > 2000:
        raise HTTPException(status_code=400, detail="Cevap 10–2000 karakter olmalı.")
    qd = await db.marketplace_questions.find_one({"_id": question_id})
    if not qd:
        raise HTTPException(status_code=404, detail="Soru bulunamadı.")
    if qd.get("status") != "WAITING_FOR_ANSWER":
        raise HTTPException(status_code=400, detail="Yalnızca cevap bekleyen sorular yanıtlanabilir.")
    cfg = await db.integration_configs.find_one({"company_id": qd["company_id"], "channel": qd["channel"]})
    sent_live = False
    if qd["channel"] == "trendyol" and cfg and marketplace_providers.has_live_credentials(cfg) and qd.get("external_id"):
        client = marketplace_providers.TrendyolClient(cfg)
        try:
            await client.answer(qd["external_id"], text)
            sent_live = True
        finally:
            await client.close()
    now = datetime.now(timezone.utc).isoformat()
    await db.marketplace_questions.update_one({"_id": question_id}, {"$set": {"status": "ANSWERED", "answer": text, "answered_at": now, "answered_live": sent_live}})
    return {**clean_doc(await db.marketplace_questions.find_one({"_id": question_id})), "message": "Cevap Trendyol'a gönderildi." if sent_live else "Cevap kaydedildi (canlı API bağlı değil)."}

@api_router.post("/orders/bulk-delete")
async def bulk_delete_orders(req: Dict[str, Any]):
    ids = req.get("ids") or []
    if not ids:
        raise HTTPException(status_code=400, detail="Silinecek sipariş seçilmedi.")
    deleted = 0
    for oid in ids:
        try:
            await delete_order(oid)
            deleted += 1
        except HTTPException:
            continue
    return {"status": "success", "deleted": deleted, "message": f"{deleted} sipariş silindi."}

@api_router.post("/orders/mark-labels-printed")
async def mark_labels_printed(req: Dict[str, Any]):
    ids = req.get("ids") or []
    now = datetime.now(timezone.utc).isoformat()
    await db.orders.update_many({"_id": {"$in": ids}}, {"$set": {"label_printed_at": now}})
    return {"status": "success", "count": len(ids)}

# ----------------- KARGO ENTEGRASYONLARI -----------------
CARGO_CATALOG = [
    {"carrier_code": "navlungo", "carrier_name": "Navlungo (Kargo Pazaryeri)", "kind": "marketplace", "desc": "Tüm kargo firmalarını tek panelden karşılaştır, indirimli gönder", "fields": ["api_key"]},
    {"carrier_code": "geliver", "carrier_name": "Geliver (Kargo Pazaryeri)", "kind": "marketplace", "desc": "Anlaşmalı fiyatlarla çoklu kargo, otomatik etiket — CANLI API (api.geliver.io)", "fields": ["api_key", "sender_address_id"], "live": True},
    {"carrier_code": "kolaykargo", "carrier_name": "Kolay Kargo (Pazaryeri)", "kind": "marketplace", "desc": "Sözleşmesiz indirimli kargo, Trendyol/Hepsiburada uyumlu", "fields": ["api_key"]},
    {"carrier_code": "basitkargo", "carrier_name": "BasitKargo (Pazaryeri)", "kind": "marketplace", "desc": "Toplu gönderi, kapıdan alım", "fields": ["api_key", "api_secret"]},
    {"carrier_code": "kargomsende", "carrier_name": "Kargom Sende (Pazaryeri)", "kind": "marketplace", "desc": "Çoklu kargo karşılaştırma", "fields": ["api_key"]},
    {"carrier_code": "yurtici", "carrier_name": "Yurtiçi Kargo API", "kind": "carrier", "fields": ["customer_number", "api_username", "api_password"]},
    {"carrier_code": "aras", "carrier_name": "Aras Kargo API", "kind": "carrier", "fields": ["customer_number", "api_username", "api_password"]},
    {"carrier_code": "mng", "carrier_name": "MNG Kargo API", "kind": "carrier", "fields": ["customer_number", "api_username", "api_password"]},
    {"carrier_code": "ptt", "carrier_name": "PTT Kargo API", "kind": "carrier", "fields": ["customer_number", "api_username", "api_password"]},
    {"carrier_code": "surat", "carrier_name": "Sürat Kargo API", "kind": "carrier", "fields": ["customer_number", "api_username", "api_password"]},
    {"carrier_code": "hepsijet", "carrier_name": "HepsiJET API", "kind": "carrier", "fields": ["api_key"]},
    {"carrier_code": "trendyolexpress", "carrier_name": "Trendyol Express API", "kind": "carrier", "fields": ["api_key", "api_secret"]},
    {"carrier_code": "ups", "carrier_name": "UPS Türkiye API", "kind": "carrier", "fields": ["customer_number", "api_key"]},
    {"carrier_code": "dhl", "carrier_name": "DHL Express API", "kind": "carrier", "fields": ["api_key"]},
]

@api_router.get("/integrations/cargo/catalog")
async def cargo_catalog(company_id: Optional[str] = "comp_nexus_main_01"):
    existing = {c["carrier_code"] for c in await db.cargo_configs.find({"company_id": company_id}, {"carrier_code": 1}).to_list(100)}
    return [{**c, "installed": c["carrier_code"] in existing} for c in CARGO_CATALOG]

@api_router.post("/integrations/cargo")
async def add_cargo_integration(req: Dict[str, Any]):
    company_id = req.get("company_id", "comp_nexus_main_01")
    cat = next((c for c in CARGO_CATALOG if c["carrier_code"] == req.get("carrier_code")), None)
    if not cat:
        raise HTTPException(status_code=400, detail="Bilinmeyen kargo sağlayıcısı.")
    if await db.cargo_configs.find_one({"company_id": company_id, "carrier_code": cat["carrier_code"]}):
        raise HTTPException(status_code=400, detail="Bu sağlayıcı zaten ekli.")
    creds = {k: req.get(k) for k in cat["fields"]}
    has_key = any(creds.values())
    doc = {"_id": f"cargo_{cat['carrier_code']}_{uuid.uuid4().hex[:4]}", "company_id": company_id, "carrier_code": cat["carrier_code"], "carrier_name": cat["carrier_name"], "kind": cat["kind"], "is_active": True,
           "auto_create_barcode": True, "test_mode": bool(req.get("test_mode", True)), "status": "connected" if has_key else "not_configured", "created_at": datetime.now(timezone.utc).isoformat(), **{k: (comm_service.encrypt(v) if v and k in ("api_password", "api_secret", "api_key") and hasattr(comm_service, "encrypt") else v) for k, v in creds.items()}}
    await db.cargo_configs.insert_one(doc)
    out = clean_doc(doc)
    for k in ("api_password", "api_secret", "api_key"):
        if out.get(k):
            out[k] = "••••••••"
    return {**out, "message": f"{cat['carrier_name']} eklendi" + ("." if has_key else " — API anahtarı girilene kadar gönderiler SİMÜLE çalışır.")}

@api_router.post("/integrations/cargo/{carrier_id}/test")
async def test_cargo_integration(carrier_id: str):
    cfg = await db.cargo_configs.find_one({"_id": carrier_id})
    if not cfg:
        raise HTTPException(status_code=404, detail="Kargo entegrasyonu bulunamadı.")
    if cfg.get("carrier_code") != "geliver":
        return {"ok": True, "simulated": True, "message": f"{cfg.get('carrier_name')} için canlı API bağlantısı henüz yok; gönderiler SİMÜLE oluşturulur."}
    r = await cargo_providers.geliver_test(cfg)
    await db.cargo_configs.update_one({"_id": carrier_id}, {"$set": {"status": "connected", "is_active": True, "last_test_at": datetime.now(timezone.utc).isoformat(), "sender_addresses": r["addresses"]}})
    return {**r, "simulated": False}

@api_router.post("/cargo/shipments/{shipment_id}/refresh")
async def refresh_cargo_shipment(shipment_id: str):
    sh = await db.cargo_shipments.find_one({"_id": shipment_id})
    if not sh:
        raise HTTPException(status_code=404, detail="Gönderi bulunamadı.")
    if not sh.get("provider_shipment_id"):
        raise HTTPException(status_code=400, detail="Bu gönderi simüle; sağlayıcıdan güncellenemez.")
    cfg = await db.cargo_configs.find_one({"company_id": sh["company_id"], "carrier_code": sh["carrier_code"]})
    if not cfg:
        raise HTTPException(status_code=400, detail="Kargo entegrasyonu kaldırılmış.")
    info = await cargo_providers.geliver_get_shipment(cfg, sh["provider_shipment_id"])
    upd = {k: v for k, v in {"tracking_number": info.get("tracking_number"), "barcode": info.get("barcode"), "label_url": info.get("label_url"), "tracking_url": info.get("tracking_url"), "provider_status": info.get("status")}.items() if v}
    upd["last_refreshed_at"] = datetime.now(timezone.utc).isoformat()
    await db.cargo_shipments.update_one({"_id": shipment_id}, {"$set": upd})
    if sh.get("order_id") and upd.get("tracking_number"):
        await db.orders.update_one({"_id": sh["order_id"]}, {"$set": {"cargo_tracking_number": upd["tracking_number"], "cargo_label_url": upd.get("label_url"), "cargo_tracking_url": upd.get("tracking_url")}})
        await _push_order_to_shopphp(await db.orders.find_one({"_id": sh["order_id"]}), reason="cargo_tracking")
    return clean_doc(await db.cargo_shipments.find_one({"_id": shipment_id}))

@api_router.delete("/integrations/cargo/{carrier_id}")
async def delete_cargo_integration(carrier_id: str):
    r = await db.cargo_configs.delete_one({"_id": carrier_id})
    if not r.deleted_count:
        raise HTTPException(status_code=404, detail="Kargo entegrasyonu bulunamadı.")
    return {"status": "success"}

# ---- Atölye performans
@api_router.get("/production/work-orders/performance")
async def work_order_performance(company_id: Optional[str] = "comp_nexus_main_01", date_from: Optional[str] = None, date_to: Optional[str] = None):
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    df, dt = date_from or today, date_to or today
    rows = await db.work_orders.find({"company_id": company_id, "status": "done", "finished_at": {"$gte": df, "$lte": dt + "T23:59:59"}}).to_list(5000)
    per: Dict[str, Dict[str, Any]] = {}
    per_station: Dict[str, Dict[str, Any]] = {}
    for w in rows:
        mins = None
        if w.get("started_at") and w.get("finished_at"):
            mins = (datetime.fromisoformat(w["finished_at"]) - datetime.fromisoformat(w["started_at"])).total_seconds() / 60 - w.get("paused_seconds", 0) / 60
        for key, bucket in ((w.get("operator_name") or "Atanmamış", per), (w.get("station") or "Genel", per_station)):
            x = bucket.setdefault(key, {"name": key, "done": 0, "produced": 0.0, "scrap": 0.0, "minutes": 0.0, "timed": 0, "over_target": 0})
            x["done"] += 1; x["produced"] += float(w.get("produced_qty", 0)); x["scrap"] += float(w.get("scrap_qty", 0))
            if mins is not None:
                x["minutes"] += mins; x["timed"] += 1
                if w.get("duration_min") and mins > float(w["duration_min"]):
                    x["over_target"] += 1
    def fin(b):
        out = []
        for x in b.values():
            tot = x["produced"] + x["scrap"]
            out.append({**x, "avg_min": round(x["minutes"] / x["timed"], 1) if x["timed"] else None, "scrap_rate": round(x["scrap"] / tot * 100, 1) if tot else 0.0, "minutes": round(x["minutes"], 1)})
        return sorted(out, key=lambda r: -r["produced"])
    return {"date_from": df, "date_to": dt, "operators": fin(per), "stations": fin(per_station), "total_done": len(rows)}

@api_router.get("/integrations/cargo")
async def list_cargo_integrations(company_id: Optional[str] = "comp_nexus_main_01"):
    configs = await db.cargo_configs.find({"company_id": company_id}).to_list(100)
    return [cargo_providers.mask_config(c) for c in clean_docs(configs)]

@api_router.put("/integrations/cargo/{carrier_id}")
async def update_cargo_integration(carrier_id: str, data: Dict[str, Any]):
    allowed = {k: v for k, v in data.items() if k in {"api_key", "api_secret", "api_password", "api_username", "customer_number", "sender_address_id", "test_mode", "is_active", "status", "auto_create_barcode", "default_weight", "default_length", "default_width", "default_height"}}
    upd = cargo_providers.encrypt_secrets(allowed)
    cur = await db.cargo_configs.find_one({"_id": carrier_id})
    if not cur:
        raise HTTPException(status_code=404, detail="Kargo entegrasyonu bulunamadı.")
    merged = {**cur, **upd}
    upd["status"] = "connected" if any(merged.get(k) for k in cargo_providers.SECRET_FIELDS) else "not_configured"
    upd["updated_at"] = datetime.now(timezone.utc).isoformat()
    await db.cargo_configs.update_one({"_id": carrier_id}, {"$set": upd})
    return cargo_providers.mask_config(clean_doc(await db.cargo_configs.find_one({"_id": carrier_id})))

@api_router.post("/cargo/auto-ship")
async def cargo_auto_ship(req: Dict[str, Any]):
    """Onaylı/hazırlanıyor durumundaki kargosuz siparişleri seçili taşıyıcıda (Geliver vb.) toplu kargola. dry_run=true → yalnızca aday liste."""
    company_id = req.get("company_id", "comp_nexus_main_01")
    carrier_code = req.get("carrier_code", "geliver")
    channels = [c.lower() for c in (req.get("channels") or ["shopphp", "trendyol"])]
    statuses = req.get("statuses") or ["approved", "preparing"]
    q = {"company_id": company_id, "channel": {"$in": channels}, "order_status": {"$in": statuses}, "$or": [{"cargo_tracking_number": None}, {"cargo_tracking_number": ""}, {"cargo_tracking_number": {"$exists": False}}]}
    candidates = await db.orders.find(q).sort("order_date", 1).to_list(500)
    cfg = await db.cargo_configs.find_one({"company_id": company_id, "carrier_code": carrier_code})
    live = bool(cfg) and carrier_code == "geliver" and cargo_providers.has_live_credentials(cfg)
    if not live and not req.get("dry_run") and not req.get("allow_simulated"):
        raise HTTPException(status_code=400, detail="Bu taşıyıcı için canlı API bağlantısı yok; gerçek siparişlere simülasyon takip numarası yazılmaz. Kargo → Geliver ayarlarını yapın ya da 'Simülasyona izin ver' seçin.")
    summary = {"carrier_code": carrier_code, "live": live, "candidates": len(candidates), "created": 0, "failed": 0, "skipped": 0, "results": []}
    for o in candidates:
        row = {"order_id": o["_id"], "order_number": o.get("order_number"), "channel": o.get("channel"), "customer_name": o.get("customer_name"), "city": o.get("city"), "total_amount": o.get("total_amount")}
        if not (o.get("shipping_address") and o.get("shipping_address") != "-" and o.get("customer_name")):
            row.update({"status": "skipped", "reason": "Adres/alıcı eksik"}); summary["skipped"] += 1; summary["results"].append(row); continue
        if req.get("dry_run"):
            row["status"] = "ready"; summary["results"].append(row); continue
        try:
            r = await create_cargo_shipment({"company_id": company_id, "carrier_code": carrier_code, "order_id": o["_id"], "customer_name": o["customer_name"], "address": o["shipping_address"], "city": o.get("city") or "İstanbul", "customer_phone": o.get("customer_phone"),
                                             "desi": float(req.get("default_desi") or sum(float(i.get("desi") or 0) for i in o.get("items") or []) or 1), "payment_type": "sender_pays", "cod_amount": (o.get("total_amount") if str(o.get("payment_method") or "").lower().startswith("kapıda") else 0)})
            row.update({"status": "created", "tracking_number": r.get("tracking_number") or (r.get("shipment") or {}).get("tracking_number"), "label_url": (r.get("shipment") or {}).get("label_url") or r.get("label_url")}); summary["created"] += 1
        except HTTPException as e:
            row.update({"status": "failed", "reason": e.detail}); summary["failed"] += 1
        except Exception as e:  # noqa: BLE001 — bir siparişin hatası toplu işi durdurmasın
            row.update({"status": "failed", "reason": str(e)[:160]}); summary["failed"] += 1
        summary["results"].append(row)
    if not req.get("dry_run"):
        await db.cargo_auto_runs.insert_one({"_id": str(uuid.uuid4()), "company_id": company_id, **{k: v for k, v in summary.items() if k != "results"}, "results": summary["results"], "created_at": datetime.now(timezone.utc).isoformat()})
    summary["message"] = (f"{summary['candidates']} kargolanabilir sipariş bulundu." if req.get("dry_run") else f"{summary['created']} kargo oluşturuldu, {summary['failed']} hata, {summary['skipped']} atlandı.") + ("" if live else " (Geliver canlı bağlantısı yok → simülasyon takip no üretildi.)" if carrier_code == "geliver" else "")
    return summary

@api_router.get("/cargo/auto-ship/runs")
async def cargo_auto_runs(company_id: Optional[str] = "comp_nexus_main_01"):
    return clean_docs(await db.cargo_auto_runs.find({"company_id": company_id}).sort("created_at", -1).to_list(20))

@api_router.post("/cargo/create-shipment")
async def create_cargo_shipment(req: Dict[str, Any]):
    carrier_code = req.get("carrier_code", "yurtici")
    order_id = req.get("order_id")
    customer_name = req.get("customer_name", "Müşteri")
    address = req.get("address", "Adres")
    city = req.get("city", "İstanbul")
    company_id = req.get("company_id", "comp_nexus_main_01")

    order = await db.orders.find_one({"_id": order_id}) if order_id else None
    if order and order.get("cargo_tracking_number") and not req.get("force"):
        raise HTTPException(status_code=400, detail=f"Bu sipariş için zaten kargo kaydı var: {order['cargo_tracking_number']}")
    cfg = await db.cargo_configs.find_one({"company_id": company_id, "carrier_code": carrier_code})
    cat = next((c for c in CARGO_CATALOG if c["carrier_code"] == carrier_code), {})
    live = bool(cfg) and carrier_code == "geliver" and cargo_providers.has_live_credentials(cfg)
    extra: Dict[str, Any] = {}
    if live:
        src = {**(order or {}), "customer_name": customer_name, "shipping_address": address, "city": city, "customer_phone": req.get("customer_phone") or (order or {}).get("customer_phone"), "order_number": (order or {}).get("order_number") or req.get("order_number", ""), "total_amount": (order or {}).get("total_amount") or req.get("total_amount", 0), "items": (order or {}).get("items", [])}
        g = await cargo_providers.geliver_create_shipment(cfg, src, req)
        tracking_num = g.get("tracking_number") or f"GLV-{(g.get('geliver_id') or uuid.uuid4().hex)[:10].upper()}"
        barcode = g.get("barcode") or tracking_num
        extra = {"is_live": True, "test_mode": g.get("test"), "provider_shipment_id": g.get("geliver_id"), "label_url": g.get("label_url"), "tracking_url": g.get("tracking_url"), "offer_accepted": g.get("accepted"), "provider_service": g.get("provider"), "price": g.get("price"), "provider_status": (g.get("raw") or {}).get("status")}
        status_ = "created"
    else:
        tracking_num = f"{carrier_code.upper()[:2]}-{str(uuid.uuid4().int)[:10]}"
        barcode = f"869{str(uuid.uuid4().int)[:10]}"
        extra = {"is_live": False}
        status_ = "in_transit"

    shipment = CargoShipment(id=f"shp_{uuid.uuid4().hex[:8]}", company_id=company_id, carrier_code=carrier_code, carrier_name=(cfg or {}).get("carrier_name") or cat.get("carrier_name", "Kargo"), tracking_number=tracking_num, barcode=barcode,
                             order_id=order_id, customer_name=customer_name, customer_phone=req.get("customer_phone") or (order or {}).get("customer_phone"), address=address, city=city, status=status_,
                             estimated_delivery=(datetime.now(timezone.utc) + timedelta(days=2)).strftime("%Y-%m-%d"))
    doc = {**shipment.to_mongo(), **extra}
    await db.cargo_shipments.insert_one(doc)
    if order_id:
        await db.orders.update_one({"_id": order_id}, {"$set": {"order_status": "shipped", "cargo_carrier": carrier_code, "cargo_tracking_number": tracking_num, "cargo_barcode": barcode, "cargo_label_url": extra.get("label_url"), "cargo_tracking_url": extra.get("tracking_url"), "cargo_shipment_id": doc["_id"]}})
        await _push_order_to_shopphp(await db.orders.find_one({"_id": order_id}), reason="cargo")
    return {**clean_doc(doc), "message": ("Geliver üzerinden gönderi oluşturuldu" + (" (TEST modu)" if extra.get("test_mode") else "") + (f" — teklif kabul edildi, takip: {tracking_num}" if extra.get("offer_accepted") else " — teklif henüz hazır değil, 'Güncelle' ile takip numarasını çekin.")) if live else "Kargo kaydı oluşturuldu (SİMÜLE)."}

@api_router.get("/cargo/shipments")
async def list_cargo_shipments(company_id: Optional[str] = "comp_nexus_main_01"):
    shipments = await db.cargo_shipments.find({"company_id": company_id}).sort("shipment_date", -1).to_list(100)
    return clean_docs(shipments)

# ----------------- SİPARİŞLER & B2B PORTALI -----------------
@api_router.get("/orders")
async def list_orders(company_id: Optional[str] = "comp_nexus_main_01", status: Optional[str] = None):
    query = {"company_id": company_id}
    if status and status != "all":
        query["order_status"] = status
    orders = await db.orders.find(query).sort("order_date", -1).to_list(500)
    return clean_docs(orders)

@api_router.post("/orders")
async def create_order(order: Order):
    if not order.order_number:
        order.order_number = await _next_order_number(order.company_id, "B2B" if order.channel == "b2b" else "ORD")

    doc = order.to_mongo()
    await db.orders.insert_one(doc)
    await _ensure_order_contact(doc)
    return clean_doc(doc)

@api_router.put("/orders/{order_id}/status")
async def update_order_status(order_id: str, req: Dict[str, str]):
    new_status = req.get("status", "approved")
    await db.orders.update_one({"_id": order_id}, {"$set": {"order_status": new_status}})
    await _push_order_to_shopphp(await db.orders.find_one({"_id": order_id}), reason="status")
    return {"status": "success", "order_status": new_status}

@api_router.post("/orders/{order_id}/convert-to-invoice")
async def convert_order_to_invoice(order_id: str, req: Dict[str, Any] = None):
    req = req or {}
    order = await db.orders.find_one({"_id": order_id})
    if not order:
        raise HTTPException(status_code=404, detail="Sipariş bulunamadı.")

    if order.get("is_invoiced") or order.get("invoice_id"):
        return {"status": "info", "message": "Bu sipariş için zaten fatura oluşturulmuş.", "invoice_id": order.get("invoice_id")}
    _oc = await _ensure_order_contact(order)
    if not _oc:
        _oc = {"_id": str(uuid.uuid4()), "company_id": order.get("company_id"), "type": "customer", "name": order.get("customer_name") or "Pazaryeri Müşterisi", "tax_number_or_id": "11111111111", "phone": order.get("customer_phone"), "email": order.get("customer_email"), "address": order.get("shipping_address"), "city": order.get("city"), "balance": 0.0, "is_e_invoice_user": False, "created_at": datetime.now(timezone.utc).isoformat()}
        await db.contacts.insert_one(_oc)

    inv_items = []
    for itm in order.get("items", []):
        inv_items.append({
            "product_id": itm.get("product_id"),
            "name": itm.get("product_name"),
            "quantity": itm.get("quantity", 1),
            "unit": "Adet",
            "unit_price": itm.get("unit_price", 0),
            "vat_rate": 20,
            "discount_percent": 0.0,
            "total": itm.get("total", 0)
        })

    subtotal = sum(i["total"] for i in inv_items) / 1.20
    vat_total = sum(i["total"] for i in inv_items) - subtotal

    inv_id = f"inv_{uuid.uuid4().hex[:8]}"
    invoice_number = f"NX{datetime.now().strftime('%Y')}{str(uuid.uuid4().int)[:8]}"

    new_invoice = {
        "_id": inv_id,
        "company_id": order.get("company_id"),
        "invoice_type": "sales",
        "invoice_number": invoice_number,
        "contact_id": _oc["_id"],
        "contact_name": _oc.get("name") or order.get("customer_name"),
        "contact_tax_id": _oc.get("tax_number_or_id") or "11111111111",
        "e_type": req.get("e_type") if req.get("e_type") in ("e_invoice", "e_archive", "paper") else ("e_invoice" if _oc.get("is_e_invoice_user") else "e_archive"),
        "issue_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "due_date": (datetime.now(timezone.utc) + timedelta(days=14)).strftime("%Y-%m-%d"),
        "items": inv_items,
        "subtotal": subtotal,
        "vat_total": vat_total,
        "discount_total": 0.0,
        "grand_total": order.get("total_amount"),
        "currency": "TRY",
        "status": "approved",
        "gib_status": "GİB'e Gönderildi",
        "gib_tracking_id": f"EAR-{uuid.uuid4().hex[:8].upper()}",
        "payment_status": "paid",
        "paid_amount": order.get("total_amount"),
        "notes": f"Sipariş No: {order.get('order_number')} üzerinden otomatik faturaya dönüştürüldü.",
        "source_channel": order.get("channel", "b2b"),
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.invoices.insert_one(new_invoice)

    await db.orders.update_one(
        {"_id": order_id},
        {"$set": {"is_invoiced": True, "invoice_id": inv_id}}
    )
    settlement = await _post_marketplace_settlement(order, new_invoice, _oc)
    await _push_order_to_shopphp(await db.orders.find_one({"_id": order_id}), reason="invoice")

    return {
        "status": "success",
        "message": f"Sipariş başarıyla faturalandırıldı. Fatura No: {invoice_number}" + (f" · {settlement['net']:,.2f} ₺ net hakediş {settlement['account_name']} hesabına işlendi." if settlement else ""),
        "invoice_id": inv_id, "settlement": settlement
    }

# ----------------- DEPO & TRANSFERLER -----------------
@api_router.get("/warehouses")
async def list_warehouses(company_id: Optional[str] = "comp_nexus_main_01"):
    warehouses = await db.warehouses.find({"company_id": company_id}).to_list(100)
    return clean_docs(warehouses)

@api_router.post("/warehouses")
async def create_warehouse(wh: Warehouse):
    doc = wh.to_mongo()
    await db.warehouses.insert_one(doc)
    return clean_doc(doc)

@api_router.get("/warehouses/transfers")
async def list_warehouse_transfers(company_id: Optional[str] = "comp_nexus_main_01"):
    transfers = await db.warehouse_transfers.find({"company_id": company_id}).sort("transfer_date", -1).to_list(100)
    return clean_docs(transfers)

@api_router.post("/warehouses/transfer")
async def create_warehouse_transfer(transfer: WarehouseTransfer):
    if not transfer.transfer_number:
        transfer.transfer_number = f"TRF-{datetime.now().strftime('%Y%m')}-{str(uuid.uuid4().int)[:6]}"
    doc = transfer.to_mongo()
    await db.warehouse_transfers.insert_one(doc)

    await db.products.update_one(
        {"_id": transfer.product_id},
        {"$set": {"warehouse_id": transfer.target_warehouse_id}}
    )

    return clean_doc(doc)

# ----------------- ÜRETİM & REÇETE (BOM) -----------------
def _recipe_costs(recipe: Dict[str, Any]) -> Dict[str, Any]:
    mat = sum(float(m.get("cost_per_unit", 0)) * float(m.get("quantity", 0)) * (1 + float(m.get("wastage_percent", 0)) / 100) for m in recipe.get("materials", []))
    total = round(mat + float(recipe.get("labor_cost", 0)) + float(recipe.get("overhead_cost", 0)), 2)
    tq = float(recipe.get("target_quantity", 1) or 1)
    return {"material_cost": round(mat, 2), "total_estimated_cost": total, "unit_cost": round(total / tq, 2)}

async def _fill_material_costs(materials: List[Dict[str, Any]]):
    for m in materials:
        if not m.get("cost_per_unit"):
            p = await db.products.find_one({"_id": m.get("product_id")})
            if p:
                m["cost_per_unit"] = float(p.get("purchase_price", 0) or 0)
                m.setdefault("unit", p.get("unit", "Adet"))
                m.setdefault("product_name", p.get("name"))

async def _requirements(recipe: Dict[str, Any], quantity: float) -> List[Dict[str, Any]]:
    rows = []
    factor = quantity / float(recipe.get("target_quantity", 1) or 1)
    for m in recipe.get("materials", []):
        p = await db.products.find_one({"_id": m.get("product_id")}) or {}
        needed = round(float(m.get("quantity", 0)) * factor * (1 + float(m.get("wastage_percent", 0)) / 100), 3)
        stock = float(p.get("stock_quantity", 0) or 0)
        rows.append({"product_id": m.get("product_id"), "product_name": m.get("product_name") or p.get("name"), "unit": m.get("unit") or p.get("unit"), "needed": needed, "in_stock": stock, "shortage": round(max(0.0, needed - stock), 3), "cost": round(needed * float(m.get("cost_per_unit", 0)), 2)})
    return rows

@api_router.get("/production/recipes")
async def list_recipes(company_id: Optional[str] = "comp_nexus_main_01", product_id: Optional[str] = None):
    q: Dict[str, Any] = {"company_id": company_id}
    if product_id:
        q["finished_product_id"] = product_id
    out = []
    for r in await db.recipes.find(q).sort("created_at", -1).to_list(300):
        r.update(_recipe_costs(r))
        out.append(clean_doc(r))
    return out

@api_router.post("/production/recipes")
async def create_recipe(recipe: Recipe):
    if not recipe.code:
        recipe.code = f"BOM-{str(uuid.uuid4().int)[:6]}"
    doc = recipe.to_mongo()
    await _fill_material_costs(doc["materials"])
    doc.update(_recipe_costs(doc))
    await db.recipes.insert_one(doc)
    await db.products.update_one({"_id": recipe.finished_product_id}, {"$set": {"has_recipe": True}})
    return clean_doc(doc)

@api_router.put("/production/recipes/{recipe_id}")
async def update_recipe(recipe_id: str, req: Dict[str, Any]):
    r = await db.recipes.find_one({"_id": recipe_id})
    if not r:
        raise HTTPException(status_code=404, detail="Reçete bulunamadı.")
    allowed = {k: v for k, v in req.items() if k in {"name", "code", "finished_product_id", "finished_product_name", "target_quantity", "unit", "materials", "steps", "labor_cost", "overhead_cost", "notes", "is_active"}}
    merged = {**r, **allowed}
    await _fill_material_costs(merged.get("materials", []))
    merged.update(_recipe_costs(merged))
    merged.pop("_id", None)
    await db.recipes.update_one({"_id": recipe_id}, {"$set": merged})
    return clean_doc(await db.recipes.find_one({"_id": recipe_id}))

@api_router.delete("/production/recipes/{recipe_id}")
async def delete_recipe(recipe_id: str):
    r = await db.recipes.find_one({"_id": recipe_id})
    if not r:
        raise HTTPException(status_code=404, detail="Reçete bulunamadı.")
    await trash.soft_delete("recipes", r, "recipe", r.get("name") or r.get("finished_product_name") or recipe_id)
    if not await db.recipes.count_documents({"finished_product_id": r.get("finished_product_id")}):
        await db.products.update_one({"_id": r.get("finished_product_id")}, {"$set": {"has_recipe": False}})
    return {"status": "success", "message": "Reçete çöp kutusuna taşındı."}

@api_router.get("/production/requirements")
async def production_requirements(recipe_id: str, quantity: float = 1):
    r = await db.recipes.find_one({"_id": recipe_id})
    if not r:
        raise HTTPException(status_code=404, detail="Reçete bulunamadı.")
    rows = await _requirements(r, quantity)
    costs = _recipe_costs(r)
    return {"rows": rows, "total_material_cost": round(sum(x["cost"] for x in rows), 2), "estimated_total_cost": round(costs["unit_cost"] * quantity, 2), "has_shortage": any(x["shortage"] > 0 for x in rows), "unit_cost": costs["unit_cost"]}

@api_router.get("/production/orders")
async def list_production_orders(company_id: Optional[str] = "comp_nexus_main_01", status: Optional[str] = None, product_id: Optional[str] = None):
    q: Dict[str, Any] = {"company_id": company_id}
    if status:
        q["status"] = status
    if product_id:
        q["finished_product_id"] = product_id
    return clean_docs(await db.production_orders.find(q).sort("created_at", -1).to_list(300))

@api_router.post("/production/orders")
async def create_production_order(req: Dict[str, Any]):
    company_id = req.get("company_id", "comp_nexus_main_01")
    recipe = None
    if req.get("recipe_id"):
        recipe = await db.recipes.find_one({"_id": req["recipe_id"]})
    elif req.get("finished_product_id") or req.get("product_id"):
        recipe = await db.recipes.find_one({"company_id": company_id, "finished_product_id": req.get("finished_product_id") or req.get("product_id"), "is_active": {"$ne": False}})
    if not recipe:
        raise HTTPException(status_code=400, detail="Bu ürün için reçete bulunamadı. Önce Üretim → Reçeteler bölümünden reçete oluşturun.")
    qty = float(req.get("planned_quantity") or 1)
    if qty <= 0:
        raise HTTPException(status_code=400, detail="Miktar sıfırdan büyük olmalı.")
    rows = await _requirements(recipe, qty)
    shortages = [x for x in rows if x["shortage"] > 0]
    if shortages and req.get("strict"):
        raise HTTPException(status_code=400, detail="Yetersiz hammadde: " + ", ".join(f"{x['product_name']} ({x['shortage']} {x['unit']})" for x in shortages))
    costs = _recipe_costs(recipe)
    order = ProductionOrder(company_id=company_id, order_code=f"URT-{datetime.now().strftime('%Y')}-{str(uuid.uuid4().int)[:5]}", recipe_id=recipe["_id"], recipe_name=recipe.get("name"),
                            finished_product_id=recipe["finished_product_id"], finished_product_name=recipe.get("finished_product_name"), planned_quantity=qty,
                            target_warehouse_id=req.get("target_warehouse_id", "main_warehouse"), status="planned", total_cost=round(costs["unit_cost"] * qty, 2),
                            planned_date=req.get("planned_date"), source=req.get("source", "manual"), notes=req.get("notes"), shortages=shortages)
    doc = order.to_mongo()
    await db.production_orders.insert_one(doc)
    await _generate_work_orders(doc, recipe)
    return {**clean_doc(doc), "requirements": rows, "message": f"{order.order_code} üretim emri oluşturuldu." + (f" ⚠ {len(shortages)} hammaddede eksik var." if shortages else "")}

# ---- İş Emirleri (atölye / tablet ekranı)
async def _generate_work_orders(order: Dict[str, Any], recipe: Dict[str, Any]):
    if await db.work_orders.count_documents({"order_id": order["_id"]}):
        return
    steps = recipe.get("steps") or [{"no": 1, "name": "Üretim", "station": "Genel", "duration_min": 0}]
    now = datetime.now(timezone.utc).isoformat()
    docs = []
    for idx, st in enumerate(sorted(steps, key=lambda x: x.get("no", 0))):
        docs.append({"_id": str(uuid.uuid4()), "company_id": order["company_id"], "order_id": order["_id"], "order_code": order.get("order_code"), "product_name": order.get("finished_product_name"),
                     "planned_quantity": order.get("planned_quantity"), "unit": recipe.get("unit", "Adet"), "planned_date": order.get("planned_date"), "notes": order.get("notes"),
                     "step_no": idx + 1, "step_count": len(steps), "step_name": st.get("name", f"Adım {idx + 1}"), "station": st.get("station") or "Genel", "duration_min": st.get("duration_min", 0),
                     "status": "ready" if idx == 0 else "waiting", "assigned_to": None, "assigned_name": None, "operator_name": None, "started_at": None, "finished_at": None, "paused_seconds": 0,
                     "produced_qty": 0, "scrap_qty": 0, "logs": [], "created_at": now})
    await db.work_orders.insert_many(docs)

@api_router.get("/production/work-orders")
async def list_work_orders(company_id: Optional[str] = "comp_nexus_main_01", status: Optional[str] = None, station: Optional[str] = None, assigned_to: Optional[str] = None, order_id: Optional[str] = None):
    q: Dict[str, Any] = {"company_id": company_id}
    if status:
        q["status"] = {"$in": status.split(",")}
    if station:
        q["station"] = station
    if assigned_to:
        q["assigned_to"] = assigned_to
    if order_id:
        q["order_id"] = order_id
    rows = clean_docs(await db.work_orders.find(q).sort([("planned_date", 1), ("order_code", 1), ("step_no", 1)]).to_list(1000))
    now = datetime.now(timezone.utc)
    for r in rows:
        if r.get("started_at") and r["status"] in ("in_progress", "paused"):
            r["elapsed_min"] = round(((datetime.fromisoformat(r["started_at"]) if r["status"] == "in_progress" else datetime.fromisoformat(r.get("paused_at") or r["started_at"])) - datetime.fromisoformat(r["started_at"])).total_seconds() / 60 - r.get("paused_seconds", 0) / 60, 1)
            if r["status"] == "in_progress":
                r["elapsed_min"] = round((now - datetime.fromisoformat(r["started_at"])).total_seconds() / 60 - r.get("paused_seconds", 0) / 60, 1)
    return rows

@api_router.get("/production/work-orders/stations")
async def list_stations(company_id: Optional[str] = "comp_nexus_main_01"):
    return sorted([s for s in await db.work_orders.distinct("station", {"company_id": company_id}) if s])

@api_router.post("/production/work-orders/shopfloor-unlock")
async def shopfloor_unlock(req: Dict[str, Any]):
    """Tablet atölye: operatör seçmeden önce personel şifresi / bağlı kullanıcı şifresi doğrulanır."""
    company_id = req.get("company_id") or "comp_nexus_main_01"
    emp_id = (req.get("employee_id") or "").strip()
    password = str(req.get("password") or "")
    if not emp_id or not password:
        raise HTTPException(status_code=400, detail="Personel ve şifre gerekli.")
    emp = await db.employees.find_one({"_id": emp_id, "company_id": company_id})
    if not emp:
        raise HTTPException(status_code=404, detail="Personel bulunamadı.")
    pin_hash = emp.get("shopfloor_pin_hash") or ""
    user = await db.users.find_one({"$or": [{"employee_id": emp_id}, {"_id": emp.get("user_id") or "-"}]})
    user_hash = (user or {}).get("password_hash") or ""
    if pin_hash and verify_password(password, pin_hash):
        return {"status": "success", "employee_id": emp["_id"], "operator_name": emp["full_name"]}
    if user and user.get("is_active", True) and user_hash and verify_password(password, user_hash):
        return {"status": "success", "employee_id": emp["_id"], "operator_name": emp["full_name"]}
    if not pin_hash and not user_hash:
        raise HTTPException(status_code=400, detail="Bu personel için atölye şifresi tanımlı değil. Personel kartından şifre belirleyin.")
    raise HTTPException(status_code=401, detail="Şifre hatalı.")

@api_router.post("/production/orders/{order_id}/generate-work-orders")
async def generate_work_orders_for_order(order_id: str):
    o = await db.production_orders.find_one({"_id": order_id})
    if not o:
        raise HTTPException(status_code=404, detail="Üretim emri bulunamadı.")
    recipe = await db.recipes.find_one({"_id": o.get("recipe_id")}) or {}
    await _generate_work_orders(o, recipe)
    return {"status": "success", "count": await db.work_orders.count_documents({"order_id": order_id})}

async def _wo(wo_id: str) -> Dict[str, Any]:
    w = await db.work_orders.find_one({"_id": wo_id})
    if not w:
        raise HTTPException(status_code=404, detail="İş emri bulunamadı.")
    return w

def _log(w: Dict[str, Any], action: str, who: Optional[str], extra: str = "") -> Dict[str, Any]:
    return {"at": datetime.now(timezone.utc).isoformat(), "action": action, "by": who or w.get("operator_name"), "note": extra}

@api_router.put("/production/work-orders/{wo_id}/assign")
async def assign_work_order(wo_id: str, req: Dict[str, Any]):
    w = await _wo(wo_id)
    await db.work_orders.update_one({"_id": wo_id}, {"$set": {"assigned_to": req.get("assigned_to"), "assigned_name": req.get("assigned_name")}, "$push": {"logs": _log(w, "assigned", req.get("assigned_name"))}})
    return {"status": "success"}

@api_router.post("/production/work-orders/{wo_id}/start")
async def start_work_order(wo_id: str, req: Dict[str, Any] = None):
    req = req or {}
    w = await _wo(wo_id)
    if w["status"] not in ("ready", "paused"):
        raise HTTPException(status_code=400, detail="Bu adım başlatılamaz (önceki adım bitmemiş veya adım kapanmış).")
    who = req.get("operator_name") or w.get("assigned_name")
    upd: Dict[str, Any] = {"status": "in_progress", "operator_name": who}
    if w["status"] == "ready":
        upd["started_at"] = datetime.now(timezone.utc).isoformat()
    else:
        upd["paused_seconds"] = w.get("paused_seconds", 0) + (datetime.now(timezone.utc) - datetime.fromisoformat(w["paused_at"])).total_seconds()
        upd["paused_at"] = None
    await db.work_orders.update_one({"_id": wo_id}, {"$set": upd, "$push": {"logs": _log(w, "start" if w["status"] == "ready" else "resume", who)}})
    await db.production_orders.update_one({"_id": w["order_id"], "status": "planned"}, {"$set": {"status": "in_production", "start_date": datetime.now(timezone.utc).strftime("%Y-%m-%d")}})
    return {"status": "success", "message": f"{w['step_name']} başlatıldı."}

@api_router.post("/production/work-orders/{wo_id}/pause")
async def pause_work_order(wo_id: str, req: Dict[str, Any] = None):
    req = req or {}
    w = await _wo(wo_id)
    if w["status"] != "in_progress":
        raise HTTPException(status_code=400, detail="Sadece devam eden adım duraklatılabilir.")
    await db.work_orders.update_one({"_id": wo_id}, {"$set": {"status": "paused", "paused_at": datetime.now(timezone.utc).isoformat()}, "$push": {"logs": _log(w, "pause", req.get("operator_name"), req.get("reason", ""))}})
    return {"status": "success", "message": "Adım duraklatıldı."}

@api_router.post("/production/work-orders/{wo_id}/finish")
async def finish_work_order(wo_id: str, req: Dict[str, Any] = None):
    req = req or {}
    w = await _wo(wo_id)
    if w["status"] not in ("in_progress", "paused"):
        raise HTTPException(status_code=400, detail="Sadece başlatılmış adım bitirilebilir.")
    produced = float(req.get("produced_qty") if req.get("produced_qty") is not None else w.get("planned_quantity", 0))
    scrap = float(req.get("scrap_qty") or 0)
    if produced < 0 or scrap < 0:
        raise HTTPException(status_code=400, detail="Miktar negatif olamaz.")
    planned_q = float(w.get("planned_quantity", 0) or 0)
    if planned_q and produced + scrap > planned_q + 1e-9:
        raise HTTPException(status_code=400, detail=f"Üretilen + fire ({produced + scrap:g}) planlanan miktarı ({planned_q:g}) aşamaz.")
    now = datetime.now(timezone.utc).isoformat()
    await db.work_orders.update_one({"_id": wo_id}, {"$set": {"status": "done", "finished_at": now, "produced_qty": produced, "scrap_qty": scrap, "finish_note": req.get("notes", "")}, "$push": {"logs": _log(w, "finish", req.get("operator_name"), f"{produced:g} üretildi, {scrap:g} fire")}})
    nxt = await db.work_orders.find_one({"order_id": w["order_id"], "step_no": w["step_no"] + 1})
    result: Dict[str, Any] = {"status": "success", "message": f"{w['step_name']} tamamlandı."}
    if nxt:
        await db.work_orders.update_one({"_id": nxt["_id"]}, {"$set": {"status": "ready"}})
        result["message"] += f" Sıradaki adım: {nxt['step_name']} ({nxt['station']})."
    else:
        o = await db.production_orders.find_one({"_id": w["order_id"]})
        if o and o.get("status") == "in_production" and produced > 0:
            remaining = float(o.get("planned_quantity", 0)) - float(o.get("completed_quantity", 0))
            try:
                r = await complete_production_order(w["order_id"], {"quantity": min(produced, remaining), "scrap_qty": scrap, "update_cost": bool(req.get("update_cost", False))})
                result["message"] += " " + r["message"]
                result["order_completed"] = r["finished"]
            except HTTPException as e:
                result["message"] += f" (Stok işlenemedi: {e.detail})"
    return result

@api_router.delete("/production/orders/{order_id}")
async def delete_production_order(order_id: str):
    o = await db.production_orders.find_one({"_id": order_id})
    if not o:
        raise HTTPException(status_code=404, detail="Üretim emri bulunamadı.")
    if o.get("status") == "completed" or float(o.get("completed_quantity", 0) or 0) > 0:
        raise HTTPException(status_code=400, detail="Üretimi yapılmış (stok işlenmiş) emir silinemez; iptal edin.")
    wos = await db.work_orders.find({"order_id": order_id}).to_list(500)
    await trash.soft_delete("production_orders", o, "production_order", f"{o.get('order_number') or order_id} · {o.get('product_name') or ''}", related=[{"collection": "work_orders", "docs": wos}], note=f"{len(wos)} iş emri")
    return {"status": "success", "message": "Üretim emri ve iş emirleri çöp kutusuna taşındı."}

@api_router.post("/production/orders/{order_id}/start")
async def start_production_order(order_id: str):
    o = await db.production_orders.find_one({"_id": order_id})
    if not o:
        raise HTTPException(status_code=404, detail="Üretim emri bulunamadı.")
    if o.get("status") != "planned":
        raise HTTPException(status_code=400, detail="Sadece planlanan emirler başlatılabilir.")
    await db.production_orders.update_one({"_id": order_id}, {"$set": {"status": "in_production", "start_date": datetime.now(timezone.utc).strftime("%Y-%m-%d")}})
    return {"status": "success", "message": "Üretim başlatıldı."}

@api_router.post("/production/orders/{order_id}/cancel")
async def cancel_production_order(order_id: str):
    o = await db.production_orders.find_one({"_id": order_id})
    if not o:
        raise HTTPException(status_code=404, detail="Üretim emri bulunamadı.")
    if o.get("status") == "completed":
        raise HTTPException(status_code=400, detail="Tamamlanmış emir iptal edilemez.")
    await db.production_orders.update_one({"_id": order_id}, {"$set": {"status": "cancelled"}})
    return {"status": "success", "message": "Üretim emri iptal edildi."}

@api_router.post("/production/orders/{order_id}/complete")
async def complete_production_order(order_id: str, req: Dict[str, Any] = None):
    req = req or {}
    p_order = await db.production_orders.find_one({"_id": order_id})
    if not p_order:
        raise HTTPException(status_code=404, detail="Üretim emri bulunamadı.")
    if p_order.get("status") in ("completed", "cancelled"):
        raise HTTPException(status_code=400, detail="Bu üretim emri zaten kapanmış.")
    if p_order.get("status") != "in_production":
        raise HTTPException(status_code=400, detail="Önce üretimi başlatın (Başlat).")
    planned = float(p_order.get("planned_quantity", 1.0))
    done_before = float(p_order.get("completed_quantity", 0))
    qty = float(req.get("quantity") or (planned - done_before))
    if qty <= 0 or qty > planned - done_before + 1e-9:
        raise HTTPException(status_code=400, detail=f"Miktar 0 ile {planned - done_before} arasında olmalı.")
    recipe = await db.recipes.find_one({"_id": p_order.get("recipe_id")})
    consumed = []
    consume_qty = qty + float(req.get("scrap_qty") or 0)
    if recipe:
        for row in await _requirements(recipe, consume_qty):
            await db.products.update_one({"_id": row["product_id"]}, {"$inc": {"stock_quantity": -row["needed"]}})
            consumed.append({"product_name": row["product_name"], "quantity": row["needed"], "unit": row["unit"]})
        unit_cost = _recipe_costs(recipe)["unit_cost"]
        if unit_cost and req.get("update_cost", False):
            await db.products.update_one({"_id": p_order.get("finished_product_id")}, {"$set": {"purchase_price": unit_cost}})
    await db.products.update_one({"_id": p_order.get("finished_product_id")}, {"$inc": {"stock_quantity": qty}})
    new_done = round(done_before + qty, 3)
    finished = new_done >= planned - 1e-9
    await db.production_orders.update_one({"_id": order_id}, {"$set": {"status": "completed" if finished else "in_production", "completed_quantity": new_done, "end_date": datetime.now(timezone.utc).strftime("%Y-%m-%d") if finished else None, "shortages": []}})
    return {"status": "success", "finished": finished, "consumed": consumed, "message": f"{qty:g} {recipe.get('unit', 'Adet') if recipe else 'Adet'} '{p_order.get('finished_product_name')}' üretildi; hammaddeler düşüldü, mamul stoğa eklendi." + ("" if finished else f" Kalan: {planned - new_done:g}")}

# ----------------- PERSONEL & BORDRO -----------------
@api_router.get("/personnel/employees")
async def list_employees(company_id: Optional[str] = "comp_nexus_main_01"):
    employees = await db.employees.find({"company_id": company_id}).to_list(100)
    return clean_docs(employees)

@api_router.post("/personnel/employees")
async def create_employee(emp: Employee):
    doc = emp.to_mongo()
    await db.employees.insert_one(doc)
    return clean_doc(doc)

EMPLOYEE_UPDATABLE = {"full_name", "tc_kimlik", "department", "position", "phone", "email", "salary", "start_date", "status", "annual_leave_days", "used_leave_days",
                      "payroll_salary", "second_salary", "overtime_method", "overtime_hourly_rate", "work_schedule", "photo_url", "notes", "iban", "birth_date", "address", "emergency_contact"}
EMPLOYEE_NUMERIC = {"salary", "payroll_salary", "second_salary", "overtime_hourly_rate"}

@api_router.put("/personnel/employees/{emp_id}")
async def update_employee(emp_id: str, data: Dict[str, Any]):
    if not await db.employees.find_one({"_id": emp_id}):
        raise HTTPException(status_code=404, detail="Çalışan bulunamadı.")
    upd: Dict[str, Any] = {}
    for k, v in data.items():
        if k not in EMPLOYEE_UPDATABLE:
            continue
        if k in EMPLOYEE_NUMERIC:
            if v in (None, ""):
                upd[k] = None if k != "salary" else 0.0
                continue
            try:
                v = float(v)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail=f"{k} sayısal olmalı.")
            if v < 0:
                raise HTTPException(status_code=400, detail=f"{k} negatif olamaz.")
        if k == "overtime_method" and v not in (None, "", "legal", "fixed"):
            raise HTTPException(status_code=400, detail="overtime_method 'legal' veya 'fixed' olmalı.")
        if k == "overtime_method" and v == "":
            v = None
        if k in ("annual_leave_days", "used_leave_days") and v is not None:
            v = int(v)
        if k == "work_schedule" and v is not None:
            if not isinstance(v, dict):
                raise HTTPException(status_code=400, detail="work_schedule nesne olmalı.")
            ws: Dict[str, Any] = {}
            for kk in ("start", "end"):
                if v.get(kk):
                    ws[kk] = attendance._valid_time(v[kk])
            for kk in ("break_minutes", "late_tolerance_minutes", "overtime_tolerance_minutes"):
                if v.get(kk) not in (None, ""):
                    ws[kk] = max(0, int(v[kk]))
            if isinstance(v.get("work_days"), list) and v["work_days"]:
                ws["work_days"] = sorted({int(d) for d in v["work_days"] if 0 <= int(d) <= 6})
            if v.get("days"):
                ws["days"] = attendance.clean_days(v["days"])
            if ws.get("start") and ws.get("end") and attendance._hm(ws["end"]) <= attendance._hm(ws["start"]):
                raise HTTPException(status_code=400, detail="Mesai bitişi başlangıçtan sonra olmalı.")
            v = ws or None
        upd[k] = v
    if upd:
        upd["updated_at"] = datetime.now(timezone.utc).isoformat()
        await db.employees.update_one({"_id": emp_id}, {"$set": upd})
    res = await db.employees.find_one({"_id": emp_id})
    return clean_doc(res)

@api_router.get("/personnel/employees/{emp_id}/card")
async def employee_card(emp_id: str):
    emp = await db.employees.find_one({"_id": emp_id})
    if not emp:
        raise HTTPException(status_code=404, detail="Çalışan bulunamadı.")
    month = datetime.now(timezone.utc).strftime("%Y-%m")
    payrolls = clean_docs(await db.payrolls.find({"employee_id": emp_id}).sort("period", -1).to_list(60))
    leaves = clean_docs(await db.leave_requests.find({"employee_id": emp_id}).sort("start_date", -1).to_list(200))
    bonuses = clean_docs(await db.bonus_payments.find({"employee_id": emp_id}).sort("created_at", -1).to_list(200))
    att = await db.attendance.find({"employee_id": emp_id, "date": {"$regex": f"^{month}"}}).to_list(100)
    docs = clean_docs(await db.files.find({"entity": "employee", "entity_id": emp_id, "is_deleted": False}).sort("created_at", -1).to_list(200))
    user = await db.users.find_one({"$or": [{"employee_id": emp_id}, {"_id": emp.get("user_id") or "-"}]})
    invite = await db.user_invites.find_one({"employee_id": emp_id, "accepted_at": None})
    used = sum(l.get("days", 0) for l in leaves if l.get("type") == "annual" and l.get("status") == "approved")
    return {"employee": clean_doc(emp), "payrolls": payrolls, "leaves": leaves, "bonuses": bonuses,
            "leave_balance": {"annual": emp.get("annual_leave_days", 14), "used": used or emp.get("used_leave_days", 0), "remaining": emp.get("annual_leave_days", 14) - (used or emp.get("used_leave_days", 0)), "pending": sum(1 for l in leaves if l.get("status") == "pending")},
            "attendance": {"month": month, "days_present": sum(1 for r in att if r.get("status") == "present"), "days_absent": sum(1 for r in att if r.get("status") == "absent"), "days_leave": sum(1 for r in att if r.get("status") == "leave"), "total_hours": round(sum(r.get("hours", 0) for r in att), 1), "overtime_hours": round(sum(r.get("overtime_hours", 0) for r in att), 1)},
            "documents": [{**d, "url": f"/api/files/{d['storage_path']}"} for d in docs],
            "user": {"id": user["_id"], "email": user.get("email"), "role": user.get("role"), "is_active": user.get("is_active", True), "last_login_at": user.get("last_login_at")} if user else None,
            "pending_invite": clean_doc(invite) if invite else None,
            "totals": {"paid_salary": round(sum(p.get("net_salary", 0) for p in payrolls if p.get("status") == "paid"), 2), "bonus_total": round(sum(b.get("amount", 0) for b in bonuses), 2)}}

@api_router.delete("/files/{file_id}")
async def delete_file_record(file_id: str):
    r = await db.files.update_one({"_id": file_id}, {"$set": {"is_deleted": True}})
    if not r.matched_count:
        raise HTTPException(status_code=404, detail="Dosya bulunamadı.")
    return {"status": "success"}

@api_router.post("/personnel/employees/{emp_id}/create-user")
async def employee_create_user(emp_id: str, req: Dict[str, Any], request: Request):
    emp = await db.employees.find_one({"_id": emp_id})
    if not emp:
        raise HTTPException(status_code=404, detail="Çalışan bulunamadı.")
    email = (req.get("email") or emp.get("email") or "").strip().lower()
    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Personelin geçerli bir e-posta adresi olmalı.")
    if await db.users.find_one({"$or": [{"employee_id": emp_id}, {"_id": emp.get("user_id") or "-"}]}):
        raise HTTPException(status_code=400, detail="Bu personelin zaten bir sistem kullanıcısı var.")
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Bu e-posta ile kullanıcı zaten var.")
    role = req.get("role") or "sales"
    await rbac.ensure_roles(emp["company_id"])
    if not await db.roles.find_one({"company_id": emp["company_id"], "code": role}):
        raise HTTPException(status_code=400, detail="Geçersiz rol.")
    if req.get("password"):
        if len(req["password"]) < 6:
            raise HTTPException(status_code=400, detail="Şifre en az 6 karakter olmalı.")
        user_id = f"usr_{uuid.uuid4().hex[:8]}"
        await db.users.insert_one({"_id": user_id, "email": email, "password_hash": hash_password(req["password"]), "name": emp["full_name"], "role": role, "company_ids": [emp["company_id"]], "active_company_id": emp["company_id"],
                                   "is_active": True, "employee_id": emp_id, "phone": emp.get("phone"), "preferences": {}, "created_at": datetime.now(timezone.utc).isoformat()})
        await db.employees.update_one({"_id": emp_id}, {"$set": {"user_id": user_id, "email": email}})
        return {"status": "success", "mode": "password", "user_id": user_id, "message": f"{emp['full_name']} için sistem kullanıcısı oluşturuldu ({email})."}
    inv = await rbac.invite_user({"company_id": emp["company_id"], "email": email, "name": emp["full_name"], "role": role, "employee_id": emp_id, "base_url": req.get("base_url"), "invited_by": req.get("invited_by")}, request)
    await db.employees.update_one({"_id": emp_id}, {"$set": {"email": email}})
    return {"status": "success", "mode": "invite", "invite": inv, "message": inv["mail"]["detail"]}

@api_router.post("/personnel/employees/{emp_id}/shopfloor-pin")
async def set_shopfloor_pin(emp_id: str, req: Dict[str, Any]):
    emp = await db.employees.find_one({"_id": emp_id})
    if not emp:
        raise HTTPException(status_code=404, detail="Çalışan bulunamadı.")
    pin = str(req.get("password") or req.get("pin") or "").strip()
    if len(pin) < 4:
        raise HTTPException(status_code=400, detail="Atölye şifresi en az 4 karakter olmalı.")
    await db.employees.update_one({"_id": emp_id}, {"$set": {"shopfloor_pin_hash": hash_password(pin), "updated_at": datetime.now(timezone.utc).isoformat()}})
    return {"status": "success", "has_shopfloor_pin": True, "message": "Atölye şifresi kaydedildi."}

@api_router.get("/personnel/payrolls")
async def list_payrolls(company_id: Optional[str] = "comp_nexus_main_01", period: Optional[str] = None):
    query = {"company_id": company_id}
    if period:
        query["period"] = period
    payrolls = await db.payrolls.find(query).sort("period", -1).to_list(100)
    return clean_docs(payrolls)

@api_router.post("/personnel/generate-payroll")
async def generate_payroll(req: Dict[str, Any]):
    company_id = req.get("company_id", "comp_nexus_main_01")
    period = req.get("period", datetime.now().strftime("%Y-%m"))
    employees = await db.employees.find({"company_id": company_id, "status": "active"}).to_list(100)
    company = await db.companies.find_one({"_id": company_id}) or {}

    generated = []
    for emp in employees:
        net = float(emp.get("salary", 30000.0) or 0)
        gross = float(emp.get("payroll_salary") or 0) or round(net * 1.40, 2)
        second = float(emp.get("second_salary") or 0)
        ot = await attendance.overtime_pay_for_period(company, emp, period)
        existing = await db.payrolls.find_one({"company_id": company_id, "employee_id": str(emp["_id"]), "period": period})
        if existing and existing.get("status") == "paid":
            continue
        bonus = float((existing or {}).get("bonus") or 0)
        deduction = float((existing or {}).get("deduction") or 0)
        advance = float((existing or {}).get("advance_payment") or 0)
        payroll_doc = {
            "_id": existing["_id"] if existing else f"pay_{uuid.uuid4().hex[:8]}",
            "company_id": company_id,
            "employee_id": str(emp.get("_id", emp.get("id"))),
            "employee_name": emp.get("full_name"),
            "period": period,
            "net_salary": net,
            "gross_salary": gross,
            "second_salary": second,
            "overtime_hours": ot["overtime_hours"],
            "overtime_weekday_hours": ot["weekday_hours"],
            "overtime_holiday_hours": ot["holiday_hours"],
            "overtime_pay": ot["amount"],
            "overtime_rate": {**{k: ot[k] for k in ("method", "hourly_base", "weekday_rate", "holiday_rate", "multiplier", "holiday_multiplier")}, "divisor": attendance.merge_schedule(company, emp).get("monthly_hours_divisor", 225)},
            "bonus": bonus,
            "deduction": deduction,
            "advance_payment": advance,
            "final_payable": round(net + ot["amount"] + second + bonus - deduction - advance, 2),
            "status": "pending",
            "created_at": (existing or {}).get("created_at") or datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        await db.payrolls.replace_one({"_id": payroll_doc["_id"]}, payroll_doc, upsert=True)
        generated.append(clean_doc(payroll_doc))

    total_ot = round(sum(g["overtime_pay"] for g in generated), 2)
    return {"status": "success", "message": f"{period} dönemi için {len(generated)} personelin bordrosu hesaplandı." + (f" Toplam {total_ot:,.2f} ₺ fazla mesai ücreti eklendi." if total_ot else ""), "payrolls": generated}

@api_router.post("/personnel/payrolls/{payroll_id}/pay")
async def pay_payroll(payroll_id: str, req: Dict[str, Any]):
    account_id = req.get("account_id") or req.get("bank_account_id")
    partner_id = req.get("partner_id")
    payroll = await db.payrolls.find_one({"_id": payroll_id})
    if not payroll:
        raise HTTPException(status_code=404, detail="Bordro kaydı bulunamadı.")
    if account_id and partner_id:
        raise HTTPException(status_code=400, detail="Kasa/banka ve ortak hesabı aynı anda seçilemez.")

    amount = payroll.get("final_payable", 0.0)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    paid_from = None

    if partner_id:
        pname = await partner_pay.withdraw(db, payroll.get("company_id"), partner_id, amount, f"{payroll.get('employee_name')} - {payroll.get('period')} Maaş Ödemesi", today, extra={"payroll_id": payroll_id})
        paid_from = f"{pname} (Ortak)"
    elif account_id:
        acc = await db.bank_accounts.find_one({"_id": account_id})
        acc_name = acc.get("account_name", "Banka") if acc else "Banka"
        await bank_guard.assert_manual_allowed(db, account_id)
        await db.bank_accounts.update_one({"_id": account_id}, {"$inc": {"current_balance": -amount}})
        await db.bank_transactions.insert_one({
            "_id": str(uuid.uuid4()),
            "company_id": payroll.get("company_id"),
            "account_id": account_id,
            "account_name": acc_name,
            "type": "outflow",
            "category": "Personel Maaş Ödemesi",
            "amount": amount,
            "currency": "TRY",
            "description": f"{payroll.get('employee_name')} - {payroll.get('period')} Maaş Ödemesi",
            "date": today,
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        paid_from = acc_name

    await db.payrolls.update_one(
        {"_id": payroll_id},
        {"$set": {"status": "paid", "paid_date": today, "account_id": account_id, "partner_id": partner_id, "account_name": paid_from}}
    )

    return {"status": "success", "message": f"{payroll.get('employee_name')} için maaş ödemesi gerçekleştirildi."}

# ----------------- AI FİNANSAL DANIŞMAN -----------------
class AIChatRequest(BaseModel):
    message: str
    company_id: Optional[str] = "comp_nexus_main_01"

async def _file_to_text(file: UploadFile, data: bytes) -> str:
    """PDF / Excel / CSV / metin → düz metin (AI ayrıştırma için)."""
    name = (file.filename or "").lower()
    if name.endswith(".pdf") or file.content_type == "application/pdf":
        from pypdf import PdfReader
        import io
        try:
            reader = PdfReader(io.BytesIO(data))
            return "\n".join((p.extract_text() or "") for p in reader.pages[:15])
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"PDF okunamadı: {str(e)[:100]}")
    if name.endswith((".xlsx", ".xlsm", ".csv", ".txt")):
        header, body = migration._read_table(file.filename, data)
        lines = [" | ".join(header)] + [" | ".join("" if c is None else str(c) for c in r) for r in body[:400]]
        return "\n".join(lines)
    return data.decode("utf-8", "ignore")

@api_router.post("/ai/order-extract")
async def ai_order_extract(file: UploadFile = File(...), company_id: str = Query("comp_nexus_main_01")):
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Dosya en fazla 10 MB olabilir.")
    text = await _file_to_text(file, data)
    if len(text.strip()) < 20:
        raise HTTPException(status_code=400, detail="Dosyada okunabilir metin bulunamadı (taranmış PDF olabilir).")
    try:
        parsed = await ai_service_extract_orders(text)
    except Exception as e:
        logger.error(f"AI order extract failed: {e}")
        raise HTTPException(status_code=502, detail=f"AI çıkarımı başarısız: {str(e)[:140]}")
    products = await db.products.find({"company_id": company_id}, {"name": 1, "sku": 1, "barcode": 1, "sale_price": 1}).to_list(5000)
    pidx = {str(k).lower(): p for p in products for k in (p.get("sku"), p.get("barcode")) if k}
    for o in parsed["orders"]:
        c = None
        if o.get("customer_name"):
            c = await db.contacts.find_one({"company_id": company_id, "name": {"$regex": f"^{re.escape(o['customer_name'][:40])}", "$options": "i"}})
        o["contact_id"] = c["_id"] if c else None
        o["contact_match"] = c.get("name") if c else None
        for it in o["items"]:
            p = pidx.get(str(it.get("barcode") or "").lower()) or pidx.get(str(it.get("sku") or "").lower()) or next((x for x in products if it.get("product_name") and x.get("name", "").lower() == it["product_name"].lower()), None)
            it["product_id"] = p["_id"] if p else None
            it["product_match"] = p.get("name") if p else None
    return {"filename": file.filename, "orders": parsed["orders"], "count": len(parsed["orders"])}

@api_router.post("/ai/order-extract/confirm")
async def ai_order_confirm(req: Dict[str, Any]):
    company_id = req.get("company_id", "comp_nexus_main_01")
    created = []
    for o in req.get("orders") or []:
        items = [OrderItem(product_id=it.get("product_id") or "", product_name=it.get("product_name") or "Kalem", sku=it.get("sku") or "", quantity=int(it.get("quantity") or 1), unit_price=float(it.get("unit_price") or 0), total=round(float(it.get("total") or float(it.get("unit_price") or 0) * int(it.get("quantity") or 1)), 2)) for it in o.get("items") or []]
        if not items or not o.get("customer_name"):
            continue
        channel = (o.get("channel") or "manual").lower()
        num = (o.get("order_number") or "").strip()
        if not num or await db.orders.find_one({"company_id": company_id, "order_number": num}):
            num = await _next_order_number(company_id, "ORD")
        order = Order(company_id=company_id, order_number=num, channel=channel, customer_name=o["customer_name"], customer_email=o.get("customer_email"), customer_phone=o.get("customer_phone"),
                      shipping_address=o.get("shipping_address") or "-", city=o.get("city") or "-", items=items, total_amount=round(sum(i.total for i in items), 2), order_status="pending")
        doc = order.to_mongo()
        doc.update({"notes": o.get("notes") or "", "source": "ai_import", "order_date": (o.get("order_date") + "T00:00:00+00:00") if o.get("order_date") else doc.get("order_date"), "contact_id": o.get("contact_id")})
        await db.orders.insert_one(doc)
        await _ensure_order_contact(doc)
        created.append(clean_doc(doc))
    return {"status": "success", "created": len(created), "orders": created, "message": f"{len(created)} sipariş oluşturuldu."}


def _normalize_extracted_product(raw: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    name = str(raw.get("name") or "").strip()
    if not name:
        return None
    vat = raw.get("vat_rate")
    try:
        vat = int(vat) if vat is not None else 20
    except (TypeError, ValueError):
        vat = 20
    ptype = str(raw.get("type") or "product").lower()
    if ptype not in ("product", "service", "raw_material", "finished_good"):
        ptype = "product"
    sku = str(raw.get("sku") or "").strip() or None
    barcode = str(raw.get("barcode") or "").strip() or None
    return {
        "name": name[:200],
        "sku": sku,
        "barcode": barcode,
        "category": str(raw.get("category") or "").strip() or "Genel",
        "unit": raw.get("unit") or "Adet",
        "vat_rate": vat,
        "purchase_price": float(raw.get("purchase_price") or 0),
        "sale_price": float(raw.get("sale_price") or 0),
        "stock_quantity": float(raw.get("stock_quantity") or 0),
        "min_stock_alert": float(raw["min_stock_alert"]) if raw.get("min_stock_alert") not in (None, "") else 5.0,
        "type": ptype,
    }


async def _annotate_extracted_products(company_id: str, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    existing = await db.products.find({"company_id": company_id}, {"name": 1, "sku": 1, "barcode": 1, "stock_quantity": 1, "sale_price": 1, "purchase_price": 1}).to_list(20000)
    by_sku = {str(p.get("sku") or "").strip().lower(): p for p in existing if p.get("sku")}
    by_bc = {str(p.get("barcode") or "").strip().lower(): p for p in existing if p.get("barcode")}
    by_name = {str(p.get("name") or "").strip().lower(): p for p in existing if p.get("name")}
    out = []
    for it in items:
        rec = _normalize_extracted_product(it)
        if not rec:
            continue
        match = None
        if rec.get("sku"):
            match = by_sku.get(rec["sku"].lower())
        if not match and rec.get("barcode"):
            match = by_bc.get(rec["barcode"].lower())
        if not match:
            match = by_name.get(rec["name"].lower())
        rec["match_id"] = match["_id"] if match else None
        rec["match_name"] = match.get("name") if match else None
        rec["match_stock"] = match.get("stock_quantity") if match else None
        rec["status"] = "güncelle" if match else "yeni"
        out.append(rec)
    return out


@api_router.post("/ai/product-extract")
async def ai_product_extract(file: UploadFile = File(...), company_id: str = Query("comp_nexus_main_01")):
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Dosya en fazla 10 MB olabilir.")
    name = (file.filename or "").lower()
    items: List[Dict[str, Any]] = []
    source = "table"
    if name.endswith((".xlsx", ".xlsm", ".csv", ".txt")):
        items = migration.products_from_table_bytes(file.filename, data)
    if not items:
        text = await _file_to_text(file, data)
        if len(text.strip()) < 20:
            raise HTTPException(status_code=400, detail="Dosyada okunabilir ürün satırı bulunamadı (taranmış PDF olabilir).")
        source = "ai"
        try:
            parsed = await ai_service_extract_products(text)
        except Exception as e:
            logger.error(f"AI product extract failed: {e}")
            raise HTTPException(status_code=502, detail=f"AI çıkarımı başarısız: {str(e)[:140]}")
        items = parsed.get("products") or []
    products = await _annotate_extracted_products(company_id, items)
    if not products:
        raise HTTPException(status_code=400, detail="Dosyada ürün adı bulunan satır bulunamadı.")
    return {"filename": file.filename, "source": source, "products": products, "count": len(products),
            "new_count": sum(1 for p in products if not p.get("match_id")), "existing_count": sum(1 for p in products if p.get("match_id"))}


@api_router.post("/ai/product-extract/confirm")
async def ai_product_confirm(req: Dict[str, Any]):
    company_id = req.get("company_id", "comp_nexus_main_01")
    update_existing = req.get("update_existing") is not False
    update_stock = req.get("update_stock") is not False
    inserted, updated, skipped = 0, 0, 0
    for raw in req.get("products") or []:
        rec = _normalize_extracted_product(raw)
        if not rec:
            skipped += 1
            continue
        match_id = raw.get("match_id")
        existing = await db.products.find_one({"_id": match_id}) if match_id else None
        if existing:
            if not update_existing:
                skipped += 1
                continue
            upd = {k: rec[k] for k in ("name", "category", "unit", "vat_rate", "purchase_price", "sale_price", "min_stock_alert", "type") if rec.get(k) not in (None, "")}
            if rec.get("barcode"):
                upd["barcode"] = rec["barcode"]
            if rec.get("sku"):
                upd["sku"] = rec["sku"]
            if update_stock:
                upd["stock_quantity"] = rec["stock_quantity"]
            await db.products.update_one({"_id": existing["_id"]}, {"$set": upd})
            await _remember_category(company_id, rec.get("category"))
            updated += 1
            continue
        sku = rec.get("sku") or f"AI-{uuid.uuid4().hex[:6].upper()}"
        if await db.products.find_one({"company_id": company_id, "sku": sku}):
            sku = f"{sku}-{uuid.uuid4().hex[:4].upper()}"
        prod = Product(
            company_id=company_id, name=rec["name"], sku=sku,
            barcode=rec.get("barcode") or f"868{str(uuid.uuid4().int)[:10]}",
            type=rec["type"], category=rec.get("category") or "Genel", unit=rec.get("unit") or "Adet",
            vat_rate=rec.get("vat_rate") or 20, purchase_price=rec.get("purchase_price") or 0,
            sale_price=rec.get("sale_price") or 0, stock_quantity=rec.get("stock_quantity") or 0,
            min_stock_alert=rec.get("min_stock_alert") if rec.get("min_stock_alert") is not None else 5,
        )
        doc = prod.to_mongo()
        doc["source"] = "ai_import"
        await db.products.insert_one(doc)
        await _remember_category(company_id, doc.get("category"))
        inserted += 1
    return {"status": "success", "inserted": inserted, "updated": updated, "skipped": skipped,
            "message": f"{inserted} yeni stok kartı, {updated} güncellendi" + (f", {skipped} atlandı" if skipped else "") + "."}


@api_router.post("/ai/invoice-extract")
async def ai_invoice_extract(file: UploadFile = File(...), company_id: str = Query("comp_nexus_main_01")):
    if file.content_type not in ("application/pdf", "text/plain"):
        raise HTTPException(status_code=400, detail="Sadece PDF (veya düz metin) yükleyebilirsiniz.")
    data = await file.read()
    if len(data) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Dosya en fazla 10 MB olabilir.")
    if file.content_type == "application/pdf":
        from pypdf import PdfReader
        import io
        try:
            reader = PdfReader(io.BytesIO(data))
            text = "\n".join((p.extract_text() or "") for p in reader.pages[:10])
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"PDF okunamadı: {str(e)[:100]}")
    else:
        text = data.decode("utf-8", "ignore")
    if len(text.strip()) < 30:
        raise HTTPException(status_code=400, detail="PDF'de okunabilir metin bulunamadı (taranmış görüntü olabilir). Metin tabanlı e-Arşiv/e-Fatura PDF'i yükleyin.")
    try:
        parsed = await extract_invoice_from_text(text)
    except Exception as e:
        logger.error(f"AI invoice extract failed: {e}")
        raise HTTPException(status_code=502, detail=f"AI çıkarımı başarısız: {str(e)[:140]}")
    sup = parsed.get("supplier") or {}
    match = None
    if sup.get("tax_number"):
        match = await db.contacts.find_one({"company_id": company_id, "tax_number_or_id": str(sup["tax_number"]).strip()})
    if not match and sup.get("name"):
        import re as _re
        match = await db.contacts.find_one({"company_id": company_id, "name": {"$regex": _re.escape(sup["name"][:25]), "$options": "i"}})
    file_url = None
    try:
        path = f"{APP_NAME}/purchase_invoice/{company_id}/{uuid.uuid4()}.pdf"
        r = put_object(path, data, "application/pdf")
        file_url = f"/api/files/{r['path']}"
        await db.files.insert_one({"_id": str(uuid.uuid4()), "storage_path": r["path"], "original_filename": file.filename, "content_type": file.content_type, "size": len(data), "entity": "purchase_invoice", "entity_id": "", "is_deleted": False, "created_at": datetime.now(timezone.utc).isoformat()})
    except Exception as e:
        logger.error(f"PDF store failed: {e}")
    products = {p.get("name", "").lower(): p for p in await db.products.find({"company_id": company_id}, {"name": 1, "sku": 1, "unit": 1}).to_list(2000)}
    for it in parsed["items"]:
        hit = products.get((it.get("name") or "").lower())
        if hit:
            it["product_id"] = hit["_id"]; it["matched_product"] = hit.get("name")
    return {"draft": parsed, "matched_contact": clean_doc(match) if match else None, "file_url": file_url, "text_preview": text[:1200], "filename": file.filename}

@api_router.post("/ai/invoice-extract/confirm")
async def ai_invoice_confirm(req: Dict[str, Any]):
    company_id = req.get("company_id", "comp_nexus_main_01")
    d = req.get("draft") or {}
    sup = d.get("supplier") or {}
    contact_id = req.get("contact_id")
    if not contact_id:
        if not sup.get("name"):
            raise HTTPException(status_code=400, detail="Tedarikçi adı gerekli.")
        c = Contact(company_id=company_id, name=sup["name"], type="supplier", tax_number_or_id=str(sup.get("tax_number") or ""), tax_office=sup.get("tax_office") or "", email=sup.get("email") or "", phone=sup.get("phone") or "", address=sup.get("address") or "", city=req.get("city") or "İstanbul", district="", credit_limit=0, category="Tedarikçi", is_e_invoice_user=True, notes="AI PDF aktarımından oluşturuldu")
        cd = c.to_mongo(); await db.contacts.insert_one(cd); contact_id = cd["_id"]; contact_name = c.name
    else:
        cc = await db.contacts.find_one({"_id": contact_id})
        if not cc:
            raise HTTPException(status_code=404, detail="Cari bulunamadı.")
        contact_name = cc["name"]
    items = [InvoiceItem(product_id=it.get("product_id"), name=it["name"], quantity=float(it["quantity"]), unit=it.get("unit") or "Adet", unit_price=float(it["unit_price"]), vat_rate=int(it.get("vat_rate", 20)), discount_rate=float(it.get("discount_rate") or 0), total=float(it["total"])) for it in d.get("items", []) if it.get("name")]
    if not items:
        raise HTTPException(status_code=400, detail="En az bir fatura kalemi gerekli.")
    inv = Invoice(company_id=company_id, invoice_type="purchase", e_type="paper", contact_id=contact_id, contact_name=contact_name, contact_tax_id=str(sup.get("tax_number") or ""), issue_date=d.get("issue_date") or datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                  due_date=d.get("due_date"), items=items, currency=d.get("currency") or "TRY", status="draft", notes=(f"Tedarikçi fatura no: {d.get('invoice_number')}. " if d.get("invoice_number") else "") + "AI PDF aktarımı ile oluşturuldu." + (f" Belge: {req.get('file_url')}" if req.get("file_url") else ""), source_channel="ai_pdf")
    created = await create_invoice(inv)
    if req.get("file_url"):
        await db.invoices.update_one({"_id": created["id"]}, {"$set": {"attachment_url": req["file_url"], "supplier_invoice_number": d.get("invoice_number")}})
    return {"status": "success", "invoice": created, "contact_id": contact_id, "message": f"Taslak alış faturası oluşturuldu: {created['invoice_number']}"}

@api_router.post("/ai/financial-advisor")
async def ask_financial_ai(req: AIChatRequest):
    company = await db.companies.find_one({"_id": req.company_id})
    bank_accs = await db.bank_accounts.find({"company_id": req.company_id}).to_list(100)
    total_bank = sum(a.get("current_balance", 0) for a in bank_accs)
    contacts = await db.contacts.find({"company_id": req.company_id}).to_list(500)
    total_rec = sum(c.get("balance", 0) for c in contacts if c.get("balance", 0) > 0)
    total_pay = abs(sum(c.get("balance", 0) for c in contacts if c.get("balance", 0) < 0))
    invoices = await db.invoices.find({"company_id": req.company_id}).to_list(500)
    sales = sum(i.get("grand_total", 0) for i in invoices if i.get("invoice_type") == "sales")
    expenses = sum(i.get("grand_total", 0) for i in invoices if i.get("invoice_type") == "purchase")
    orders = await db.orders.find({"company_id": req.company_id, "order_status": "pending"}).to_list(100)
    products = await db.products.find({"company_id": req.company_id}).to_list(500)
    low_stock = [p for p in products if p.get("stock_quantity", 0) <= p.get("min_stock_alert", 5)]

    context = {
        "company_id": req.company_id,
        "company_name": company.get("name", "Nexus Teknoloji") if company else "Nexus Teknoloji",
        "total_bank_balance": total_bank,
        "total_receivables": total_rec,
        "total_payables": total_pay,
        "monthly_sales": sales,
        "monthly_expenses": expenses,
        "pending_orders_count": len(orders),
        "low_stock_count": len(low_stock)
    }

    advice = await get_financial_ai_advice(context, req.message)
    return {"advice": advice, "metrics": context}

@api_router.get("/ai/cashflow-forecast")
async def get_ai_cashflow_forecast(company_id: Optional[str] = "comp_nexus_main_01"):
    bank_accs = await db.bank_accounts.find({"company_id": company_id}).to_list(100)
    current_cash = sum(a.get("current_balance", 0) for a in bank_accs) or 500000.0

    forecast = []
    running_balance = current_cash
    today = datetime.now()

    for day in range(1, 31):
        d = today + timedelta(days=day)
        date_str = d.strftime("%d %b")
        daily_inflow = 15000 + (day % 7) * 4500
        daily_outflow = 8000 + (day % 5) * 3200
        if day in [1, 15, 30]:
            daily_outflow += 40000
        running_balance += (daily_inflow - daily_outflow)

        forecast.append({
            "day": date_str,
            "projected_cash": round(running_balance, 2),
            "inflow": round(daily_inflow, 2),
            "outflow": round(daily_outflow, 2),
            "confidence": 92 - (day * 0.5)
        })

    return {
        "current_cash": current_cash,
        "projected_30d_cash": round(running_balance, 2),
        "net_growth_percent": round(((running_balance - current_cash) / current_cash) * 100, 1),
        "forecast_chart": forecast,
        "ai_summary": "Önümüzdeki 30 günde nakit akışınız pozitif trendde seyrediyor. Ay ortasındaki hammadde ödemeleri sonrası net nakit fazlasının %18 artması öngörülüyor."
    }

# Include router
rbac.init(db, _mail_account, get_current_user)
saas.init(db, get_current_user)
saas_billing.init(db, {"mail_account": _mail_account, "smtp_send": comm_service.smtp_send, "wa_send": wa_send})
gib_credits.init(db)
saas_extras.init(db, {"mail_account": _mail_account, "smtp_send": comm_service.smtp_send})
saas_docs.init(db)
rbac.set_license_guard(saas.guard)
expenses.init(db)
finance.init(db)
cheques.init(db)
attendance.init(db, get_current_user)
trash.init(db)
migration.init(db)
edocs.init(db, {"pdf_text": _file_to_text, "ai_invoice": extract_invoice_from_text, "create_product": create_product_from_marketplace})
pricing.init(db, {"channel_fees": _channel_fees, "marketplace_products": marketplace_products, "mail_account": _mail_account, "wa_send": wa_send})

async def _restore_bank_tx(doc, _related):
    await _reverse_tx_effects(doc, +1)

async def _restore_partner_tx(doc, _related):
    amount = float(doc.get("amount") or 0)
    inc = {"capital_in": {"balance": amount, "total_capital_in": amount}, "withdrawal": {"balance": -amount, "total_withdrawn": amount},
           "profit_share": {"total_profit_share": amount, **({"balance": -amount} if doc.get("is_paid") else {})}}.get(doc.get("type"), {})
    if inc:
        await db.partners.update_one({"_id": doc["partner_id"]}, {"$inc": inc})
    if doc.get("account_id") and (doc.get("type") != "profit_share" or doc.get("is_paid")):
        await _post_partner_cash_movement(doc["company_id"], doc["account_id"], doc["type"], amount, doc.get("partner_name", ""), doc.get("description", ""), doc.get("date"), partner_tx_id=doc["_id"])

async def _restore_leave(doc, _related):
    if doc.get("status") == "approved" and doc.get("type") == "annual":
        await db.employees.update_one({"_id": doc["employee_id"]}, {"$inc": {"used_leave_days": float(doc.get("days") or 0)}})

async def _restore_bonus(doc, _related):
    if doc.get("status") != "paid":
        return
    amount = float(doc.get("amount") or 0)
    if doc.get("partner_id"):
        await partner_pay.withdraw(db, doc.get("company_id"), doc["partner_id"], amount, f"{doc.get('employee_name')} - {doc.get('period')} {doc.get('type_label') or 'Prim'}", extra={"bonus_id": doc["_id"]})
    elif doc.get("account_id"):
        await db.bank_accounts.update_one({"_id": doc["account_id"]}, {"$inc": {"current_balance": -amount}})

async def _restore_expense(doc, _related):
    if doc.get("payment_status") == "paid" and not doc.get("netted_in_settlement") and (doc.get("account_id") or doc.get("partner_id")):
        await expenses._post_payment(doc, doc.get("account_id"), doc.get("paid_date") or datetime.now(timezone.utc).strftime("%Y-%m-%d"), partner_id=doc.get("partner_id"))

async def _restore_recipe(doc, _related):
    await db.products.update_one({"_id": doc.get("finished_product_id")}, {"$set": {"has_recipe": True}})

for _t, _fn in (("bank_transaction", _restore_bank_tx), ("partner_transaction", _restore_partner_tx), ("leave", _restore_leave), ("bonus", _restore_bonus), ("expense", _restore_expense), ("recipe", _restore_recipe), ("cheque", cheques.restore_cheque)):
    trash.register_hook(_t, _fn)

app.include_router(api_router)
app.include_router(rbac.router)
app.include_router(expenses.router)
app.include_router(finance.router)
app.include_router(cheques.router)
app.include_router(attendance.router)
app.include_router(trash.router)
app.include_router(migration.router)
app.include_router(pricing.router)
app.include_router(edocs.router)
app.include_router(saas.router)
app.include_router(saas_billing.router)
app.include_router(gib_credits.router)
app.include_router(saas_extras.router)
app.include_router(saas_docs.router)

@app.get("/")
async def root():
    return {"status": "healthy", "service": "NexusERP API", "version": "2.0.0"}

@app.on_event("shutdown")
async def shutdown_db_client():
    await client.close_async()
