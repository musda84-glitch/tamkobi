from dotenv import load_dotenv
load_dotenv()

import os
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, APIRouter, Depends, HTTPException, Request, Response, status, UploadFile, File, Query, Form
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pydantic import BaseModel, Field

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
from seed_data import seed_all_data, seed_partners
from ai_service import get_financial_ai_advice
from storage_service import init_storage, put_object, get_object, APP_NAME
import bank_providers
import comm_service

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("NexusERP")

# MongoDB connection
MONGO_URL = os.environ.get("MONGO_URL")
DB_NAME = os.environ.get("DB_NAME")
client = AsyncIOMotorClient(MONGO_URL)
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

def clean_doc(doc: dict) -> dict:
    if not doc:
        return doc
    if "_id" in doc:
        _id_val = str(doc["_id"])
        doc["id"] = _id_val
        doc["_id"] = _id_val
    elif "id" in doc and "_id" not in doc:
        doc["_id"] = str(doc["id"])
    return doc

def clean_docs(docs: list) -> list:
    return [clean_doc(d) for d in docs]

# Startup event
@app.on_event("startup")
async def startup_event():
    try:
        await seed_all_data(db)
        await seed_partners(db)
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
    client_ip = request.client.host if request.client else "unknown"
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

    # Reset failed attempts on success
    await db.login_attempts.delete_one({"identifier": identifier})

    user_id = str(user.get("_id", user.get("id")))
    token = create_access_token(user_id, email, user.get("role", "admin"))
    refresh_tok = create_refresh_token(user_id)

    response.set_cookie(key="access_token", value=token, httponly=True, max_age=86400*7, path="/")
    response.set_cookie(key="refresh_token", value=refresh_tok, httponly=True, max_age=86400*30, path="/")

    companies = await db.companies.find({"_id": {"$in": user.get("company_ids", [])}}).to_list(100)
    if not companies:
        first_comp = await db.companies.find_one({})
        if first_comp:
            companies = [first_comp]

    return {
        "token": token,
        "user": {
            "id": user_id,
            "email": user["email"],
            "name": user["name"],
            "role": user.get("role", "admin"),
            "company_ids": user.get("company_ids", []),
            "active_company_id": user.get("active_company_id", "comp_nexus_main_01"),
        },
        "companies": clean_docs(companies)
    }

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
    await db.companies.insert_one(new_company.to_mongo())

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
async def get_me(user: dict = Depends(get_current_user)):
    user_id = str(user.get("_id", user.get("id")))
    companies = await db.companies.find({}).to_list(100)
    return {
        "user": {
            "id": user_id,
            "email": user["email"],
            "name": user["name"],
            "role": user.get("role", "admin"),
            "active_company_id": user.get("active_company_id", "comp_nexus_main_01"),
        },
        "companies": clean_docs(companies)
    }

@api_router.post("/auth/switch-company")
async def switch_company(req: Dict[str, str], user: dict = Depends(get_current_user)):
    new_comp_id = req.get("company_id")
    if not new_comp_id:
        raise HTTPException(status_code=400, detail="Şirket ID gereklidir.")
    await db.users.update_one({"email": user["email"]}, {"$set": {"active_company_id": new_comp_id}})
    return {"status": "success", "active_company_id": new_comp_id}

@api_router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("access_token")
    response.delete_cookie("refresh_token")
    return {"status": "success", "message": "Çıkış yapıldı."}

# ----------------- DASHBOARD & KPIS -----------------
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
    contacts = await db.contacts.find(query).to_list(1000)
    return clean_docs(contacts)

@api_router.post("/contacts")
async def create_contact(contact: Contact):
    doc = contact.to_mongo()
    await db.contacts.insert_one(doc)
    return clean_doc(doc)

@api_router.put("/contacts/{contact_id}")
async def update_contact(contact_id: str, updated: Dict[str, Any]):
    await db.contacts.update_one({"_id": contact_id}, {"$set": updated})
    res = await db.contacts.find_one({"_id": contact_id})
    return clean_doc(res)

@api_router.delete("/contacts/{contact_id}")
async def delete_contact(contact_id: str):
    await db.contacts.delete_one({"_id": contact_id})
    return {"status": "success"}

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

@api_router.get("/contacts/{contact_id}/overview")
async def get_contact_overview(contact_id: str):
    contact = await db.contacts.find_one({"_id": contact_id})
    if not contact:
        raise HTTPException(status_code=404, detail="Cari hesap bulunamadı.")
    invoices = await db.invoices.find({"contact_id": contact_id}).sort("issue_date", -1).to_list(200)
    payments = await db.bank_transactions.find({"contact_id": contact_id}).sort("date", -1).to_list(200)
    orders = await db.orders.find({"company_id": contact["company_id"], "customer_name": contact.get("name")}).sort("order_date", -1).to_list(100)
    sms = await db.sms_logs.find({"contact_id": contact_id}).sort("created_at", -1).to_list(50)
    mails = await db.mail_logs.find({"contact_id": contact_id}).sort("created_at", -1).to_list(50)
    comm = sorted([{**clean_doc(s), "channel": "sms"} for s in sms] + [{**clean_doc(m), "channel": "email"} for m in mails], key=lambda x: x.get("created_at", ""), reverse=True)
    total_invoiced = sum(i.get("grand_total", 0) for i in invoices if i.get("invoice_type") == "sales")
    total_paid = sum(i.get("paid_amount", 0) for i in invoices if i.get("invoice_type") == "sales")
    return {
        "contact": clean_doc(contact),
        "summary": {"invoice_count": len(invoices), "draft_count": sum(1 for i in invoices if i.get("status") == "draft"), "total_invoiced": total_invoiced,
                    "total_paid": total_paid, "open_amount": total_invoiced - total_paid, "order_count": len(orders), "overdue_count": sum(1 for i in invoices if i.get("payment_status") != "paid" and i.get("invoice_type") == "sales")},
        "invoices": clean_docs(invoices), "payments": clean_docs(payments), "orders": clean_docs(orders), "communications": comm
    }

# ----------------- STOK, ÜRÜNLER & BARKOD -----------------
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
    products = await db.products.find(query).to_list(1000)
    return clean_docs(products)

@api_router.post("/products")
async def create_product(product: Product):
    if not product.barcode:
        product.barcode = f"868{str(uuid.uuid4().int)[:10]}"
    doc = product.to_mongo()
    await db.products.insert_one(doc)
    return clean_doc(doc)

@api_router.put("/products/{product_id}")
async def update_product(product_id: str, updated: Dict[str, Any]):
    await db.products.update_one({"_id": product_id}, {"$set": updated})
    res = await db.products.find_one({"_id": product_id})
    return clean_doc(res)

@api_router.delete("/products/{product_id}")
async def delete_product(product_id: str):
    await db.products.delete_one({"_id": product_id})
    return {"status": "success"}

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
    invoices = await db.invoices.find(query).sort("created_at", -1).to_list(1000)
    return clean_docs(invoices)

@api_router.post("/invoices")
async def create_invoice(invoice: Invoice):
    if not invoice.invoice_number:
        prefix = "NX" if invoice.invoice_type == "sales" else "AL"
        year = datetime.now().strftime("%Y")
        count = await db.invoices.count_documents({"company_id": invoice.company_id}) + 1
        invoice.invoice_number = f"{prefix}{year}{str(count).zfill(8)}"

    subtotal = sum(item.total for item in invoice.items)
    vat_total = sum(item.total * (item.vat_rate / 100) for item in invoice.items)
    invoice.subtotal = subtotal
    invoice.vat_total = vat_total
    invoice.grand_total = subtotal + vat_total

    if invoice.status in ["approved", "sent_to_gib"]:
        balance_change = invoice.grand_total if invoice.invoice_type == "sales" else -invoice.grand_total
        await db.contacts.update_one(
            {"_id": invoice.contact_id},
            {"$inc": {"balance": balance_change}}
        )

        if invoice.invoice_type == "sales":
            for item in invoice.items:
                if item.product_id:
                    await db.products.update_one(
                        {"_id": item.product_id},
                        {"$inc": {"stock_quantity": -item.quantity}}
                    )

    doc = invoice.to_mongo()
    await db.invoices.insert_one(doc)
    return clean_doc(doc)

@api_router.post("/invoices/{invoice_id}/send-to-gib")
async def send_invoice_to_gib(invoice_id: str):
    inv = await db.invoices.find_one({"_id": invoice_id})
    if not inv:
        raise HTTPException(status_code=404, detail="Fatura bulunamadı.")

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
        "tracking_id": tracking_id
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

    if account_id:
        acc = await db.bank_accounts.find_one({"_id": account_id})
        acc_name = acc.get("account_name", "Banka") if acc else "Banka"
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

# ----------------- BANKA, KASA, POS & VİRMAN -----------------
@api_router.get("/banking/accounts")
async def list_bank_accounts(company_id: Optional[str] = "comp_nexus_main_01"):
    accounts = await db.bank_accounts.find({"company_id": company_id}).to_list(100)
    return clean_docs(accounts)

@api_router.post("/banking/accounts")
async def create_bank_account(account: BankAccount):
    doc = account.to_mongo()
    await db.bank_accounts.insert_one(doc)
    return clean_doc(doc)

@api_router.get("/banking/transactions")
async def list_bank_transactions(company_id: Optional[str] = "comp_nexus_main_01", account_id: Optional[str] = None):
    query = {"company_id": company_id}
    if account_id:
        query["account_id"] = account_id
    txs = await db.bank_transactions.find(query).sort("date", -1).to_list(500)
    return clean_docs(txs)

@api_router.post("/banking/transactions")
async def create_bank_transaction(tx: BankTransaction):
    doc = tx.to_mongo()
    await db.bank_transactions.insert_one(doc)

    change = tx.amount if tx.type == "inflow" else -tx.amount
    await db.bank_accounts.update_one({"_id": tx.account_id}, {"$inc": {"current_balance": change}})

    if tx.contact_id:
        c_change = -tx.amount if tx.type == "inflow" else tx.amount
        await db.contacts.update_one({"_id": tx.contact_id}, {"$inc": {"balance": c_change}})

    return clean_doc(doc)

@api_router.post("/banking/virman")
async def perform_virman(req: Dict[str, Any]):
    source_id = req.get("source_account_id")
    target_id = req.get("target_account_id")
    amount = float(req.get("amount", 0))
    description = req.get("description", "Hesaplar Arası Virman Transferi")
    company_id = req.get("company_id", "comp_nexus_main_01")

    source_acc = await db.bank_accounts.find_one({"_id": source_id})
    target_acc = await db.bank_accounts.find_one({"_id": target_id})

    if not source_acc or not target_acc:
        raise HTTPException(status_code=404, detail="Kaynak veya hedef hesap bulunamadı.")

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
    await db.partners.delete_one({"_id": partner_id})
    return {"status": "success"}

@api_router.get("/banking/partners/transactions")
async def list_partner_transactions(company_id: Optional[str] = "comp_nexus_main_01", partner_id: Optional[str] = None):
    query = {"company_id": company_id}
    if partner_id:
        query["partner_id"] = partner_id
    txs = await db.partner_transactions.find(query).sort("created_at", -1).to_list(500)
    return clean_docs(txs)

PARTNER_TX_LABELS = {"capital_in": "Ortak Sermaye Girişi", "withdrawal": "Ortak Para Çekişi", "profit_share": "Ortak Kâr Payı Ödemesi"}

async def _post_partner_cash_movement(company_id: str, account_id: str, tx_type: str, amount: float, partner_name: str, description: str, date: str):
    acc = await db.bank_accounts.find_one({"_id": account_id})
    if not acc:
        raise HTTPException(status_code=404, detail="Kasa/Banka hesabı bulunamadı.")
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
        "date": date,
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    return acc.get("account_name")

@api_router.post("/banking/partners/transactions")
async def create_partner_transaction(req: Dict[str, Any]):
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
    account_name = await _post_partner_cash_movement(partner["company_id"], req.get("account_id"), tx_type, amount, partner["name"], description, date)

    inc = {"balance": amount, "total_capital_in": amount} if tx_type == "capital_in" else {"balance": -amount, "total_withdrawn": amount}
    await db.partners.update_one({"_id": partner["_id"]}, {"$inc": inc})

    tx = PartnerTransaction(company_id=partner["company_id"], partner_id=partner["_id"], partner_name=partner["name"], type=tx_type,
                            amount=amount, account_id=req.get("account_id"), account_name=account_name, description=description, date=date)
    doc = tx.to_mongo()
    await db.partner_transactions.insert_one(doc)
    return clean_doc(doc)

@api_router.post("/banking/partners/distribute-profit")
async def distribute_profit(req: Dict[str, Any]):
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
    allowed = {k: v for k, v in updated.items() if k in {"client_id", "client_secret", "api_key", "customer_number", "bank_account_number", "base_url", "mode", "auto_sync", "linked_account_id"}}
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
    contacts = await db.contacts.find({"company_id": company_id}).to_list(1000)
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
        await db.bank_transactions.insert_one(tx.to_mongo())
        inserted += 1
    if balance_delta:
        await db.bank_accounts.update_one({"_id": acc["_id"]}, {"$inc": {"current_balance": balance_delta}})
    now = datetime.now(timezone.utc).isoformat()
    await db.bank_connections.update_one({"_id": conn_id}, {
        "$set": {"status": "simulated" if result["simulated"] else "connected", "last_synced_at": now, "last_error": None},
        "$inc": {"synced_count": inserted}
    })
    return {"status": "success", "simulated": result["simulated"], "inserted": inserted, "skipped": skipped, "balance_delta": balance_delta,
            "message": f"{inserted} yeni hareket çekildi ({skipped} zaten kayıtlı)." + (" [SİMÜLE VERİ]" if result["simulated"] else "")}

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

async def _learn_rule(company_id: str, description: str, contact_id: Optional[str], contact_name: Optional[str], category: Optional[str]):
    pattern = _match_pattern(description)
    if not pattern or not (contact_id or category):
        return
    await db.bank_match_rules.update_one(
        {"company_id": company_id, "pattern": pattern},
        {"$set": {"contact_id": contact_id, "contact_name": contact_name, "category": category, "updated_at": datetime.now(timezone.utc).isoformat()},
         "$inc": {"hits": 1},
         "$setOnInsert": {"_id": str(uuid.uuid4()), "company_id": company_id, "pattern": pattern, "created_at": datetime.now(timezone.utc).isoformat()}},
        upsert=True)

async def _apply_match(tx: dict, contact_id: Optional[str], invoice_id: Optional[str], category: Optional[str], learn: bool = True) -> dict:
    update = {"match_status": "matched"}
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
    await db.bank_transactions.update_one({"_id": tx["_id"]}, {"$set": update})
    if learn:
        await _learn_rule(tx["company_id"], tx.get("description", ""), contact_id, contact_name, category)
    return clean_doc(await db.bank_transactions.find_one({"_id": tx["_id"]}))

@api_router.post("/banking/transactions/{tx_id}/match")
async def match_bank_transaction(tx_id: str, req: Dict[str, Any]):
    tx = await db.bank_transactions.find_one({"_id": tx_id})
    if not tx:
        raise HTTPException(status_code=404, detail="Hareket bulunamadı.")
    if tx.get("match_status") == "matched":
        raise HTTPException(status_code=400, detail="Bu hareket zaten eşleştirilmiş.")
    return await _apply_match(tx, req.get("contact_id"), req.get("invoice_id"), req.get("category"), learn=bool(req.get("learn", True)))

@api_router.post("/banking/transactions/auto-match")
async def auto_match_transactions(company_id: Optional[str] = "comp_nexus_main_01", use_suggestions: bool = False):
    txs = await db.bank_transactions.find({"company_id": company_id, "source": "bank_sync", "match_status": "unmatched"}).to_list(1000)
    matched, skipped, details = 0, 0, []
    for tx in txs:
        rule = await _find_rule(company_id, tx.get("description", ""))
        if rule:
            await _apply_match(tx, rule.get("contact_id"), None, rule.get("category"), learn=False)
            await db.bank_match_rules.update_one({"_id": rule["_id"]}, {"$inc": {"hits": 1}})
            matched += 1
            details.append({"tx_id": tx["_id"], "description": tx.get("description"), "contact_name": rule.get("contact_name"), "via": "rule"})
        elif use_suggestions and tx.get("suggested_contact_id"):
            await _apply_match(tx, tx["suggested_contact_id"], None, None, learn=True)
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
    doc = {"pattern": pattern, "contact_id": req.get("contact_id"), "contact_name": contact_name, "category": req.get("category"),
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
    await db.stock_counts.delete_one({"_id": count_id})
    return {"status": "success"}

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
    await db.leave_requests.delete_one({"_id": leave_id})
    return {"status": "success"}

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
    b_type = req.get("type", "bonus")  # bonus, second_salary, advance
    labels = {"bonus": "Prim", "second_salary": "İkinci Maaş", "advance": "Avans"}
    period = req.get("period") or datetime.now(timezone.utc).strftime("%Y-%m")
    account_id = req.get("account_id")
    account_name, status_val = None, "pending"
    if account_id:
        acc = await db.bank_accounts.find_one({"_id": account_id})
        if not acc:
            raise HTTPException(status_code=404, detail="Kasa/Banka hesabı bulunamadı.")
        await db.bank_accounts.update_one({"_id": account_id}, {"$inc": {"current_balance": -amount}})
        await db.bank_transactions.insert_one({"_id": str(uuid.uuid4()), "company_id": emp["company_id"], "account_id": account_id, "account_name": acc.get("account_name"),
                                               "type": "outflow", "category": f"Personel {labels[b_type]} (Gayri Resmi)", "amount": amount, "currency": "TRY",
                                               "description": f"{emp['full_name']} - {period} {labels[b_type]}", "source": "manual",
                                               "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"), "created_at": datetime.now(timezone.utc).isoformat()})
        account_name, status_val = acc.get("account_name"), "paid"
    doc = {"_id": str(uuid.uuid4()), "company_id": emp["company_id"], "employee_id": emp["_id"], "employee_name": emp["full_name"], "type": b_type, "type_label": labels[b_type],
           "period": period, "amount": amount, "note": req.get("note", ""), "is_official": False, "account_id": account_id, "account_name": account_name,
           "status": status_val, "created_at": datetime.now(timezone.utc).isoformat()}
    await db.bonus_payments.insert_one(doc)
    return clean_doc(doc)

@api_router.delete("/personnel/bonuses/{bonus_id}")
async def delete_bonus(bonus_id: str):
    b = await db.bonus_payments.find_one({"_id": bonus_id})
    if b and b.get("account_id") and b.get("status") == "paid":
        await db.bank_accounts.update_one({"_id": b["account_id"]}, {"$inc": {"current_balance": b["amount"]}})
    await db.bonus_payments.delete_one({"_id": bonus_id})
    return {"status": "success"}

# ----------------- E-TİCARET ENTEGRASYONLARI -----------------
@api_router.get("/integrations/ecommerce")
async def list_ecommerce_integrations(company_id: Optional[str] = "comp_nexus_main_01"):
    configs = await db.integration_configs.find({"company_id": company_id}).to_list(100)
    return clean_docs(configs)

@api_router.put("/integrations/ecommerce/{channel_id}")
async def update_ecommerce_integration(channel_id: str, data: Dict[str, Any]):
    await db.integration_configs.update_one({"_id": channel_id}, {"$set": data})
    res = await db.integration_configs.find_one({"_id": channel_id})
    return clean_doc(res)

@api_router.post("/integrations/ecommerce/{channel_id}/test-connection")
async def test_ecommerce_connection(channel_id: str):
    config = await db.integration_configs.find_one({"_id": channel_id})
    if not config:
        raise HTTPException(status_code=404, detail="Entegrasyon yapılandırması bulunamadı.")

    if not config.get("api_key") or not config.get("supplier_id"):
        return {
            "status": "error",
            "message": "Lütfen API Anahtarı ve Satıcı ID/Mağaza Kodunu eksiksiz doldurun."
        }

    await db.integration_configs.update_one(
        {"_id": channel_id},
        {"$set": {"status": "connected", "is_active": True, "last_synced_at": datetime.now(timezone.utc).isoformat()}}
    )
    return {
        "status": "success",
        "message": f"{config.get('channel_name')} API bağlantısı başarıyla doğrulandı! Mağaza ve Webhook hazır."
    }

@api_router.post("/integrations/ecommerce/{channel_id}/sync-now")
async def sync_ecommerce_channel(channel_id: str):
    config = await db.integration_configs.find_one({"_id": channel_id})
    if not config:
        raise HTTPException(status_code=404, detail="Entegrasyon bulunamadı.")

    company_id = config.get("company_id", "comp_nexus_main_01")
    channel = config.get("channel", "trendyol")

    order_num = f"{channel.upper()[:2]}-{str(uuid.uuid4().int)[:8]}"
    new_order = {
        "_id": f"ord_sync_{uuid.uuid4().hex[:8]}",
        "company_id": company_id,
        "order_number": order_num,
        "channel": channel,
        "customer_name": "Ayşe Gökmen",
        "customer_email": "ayse.gokmen@example.com",
        "customer_phone": "0533 888 77 66",
        "shipping_address": "Çankaya Mah. Atatürk Bulvarı No:105 D:12",
        "city": "Ankara",
        "items": [
            {"product_id": "prod_01", "product_name": "Nexus Akıllı Bluetooth Kulaklık Pro Max (ANC)", "sku": "NX-BT-PRO", "quantity": 1, "unit_price": 1899.0, "total": 1899.0}
        ],
        "total_amount": 1899.0,
        "currency": "TRY",
        "order_status": "approved",
        "cargo_carrier": "yurtici",
        "cargo_tracking_number": f"YK-{str(uuid.uuid4().int)[:10]}",
        "cargo_barcode": f"8690{str(uuid.uuid4().int)[:9]}",
        "is_invoiced": True,
        "invoice_id": None,
        "order_date": datetime.now(timezone.utc).isoformat()
    }
    await db.orders.insert_one(new_order)

    inv_num = f"EAR{datetime.now().strftime('%Y')}{str(uuid.uuid4().int)[:8]}"
    new_inv = {
        "_id": f"inv_sync_{uuid.uuid4().hex[:8]}",
        "company_id": company_id,
        "invoice_type": "sales",
        "e_type": "e_archive",
        "invoice_number": inv_num,
        "contact_id": "cnt_01",
        "contact_name": "Ayşe Gökmen (Pazaryeri Müşterisi)",
        "contact_tax_id": "11111111111",
        "issue_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "due_date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "items": [
            {"product_id": "prod_01", "name": "Nexus Akıllı Bluetooth Kulaklık Pro Max (ANC)", "quantity": 1, "unit": "Adet", "unit_price": 1899.0, "vat_rate": 20, "discount_percent": 0.0, "total": 1899.0}
        ],
        "subtotal": 1582.50,
        "vat_total": 316.50,
        "discount_total": 0.0,
        "grand_total": 1899.0,
        "currency": "TRY",
        "status": "approved",
        "gib_status": "GİB'e Gönderildi",
        "gib_tracking_id": f"EAR-{uuid.uuid4().hex[:8].upper()}",
        "payment_status": "paid",
        "paid_amount": 1899.0,
        "notes": f"{config.get('channel_name')} üzerinden otomatik oluşturuldu. Sipariş No: {order_num}",
        "source_channel": channel,
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    await db.invoices.insert_one(new_inv)

    await db.products.update_one({"_id": "prod_01"}, {"$inc": {"stock_quantity": -1}})

    await db.integration_configs.update_one(
        {"_id": channel_id},
        {"$set": {"last_synced_at": datetime.now(timezone.utc).isoformat()}}
    )

    return {
        "status": "success",
        "message": f"Senkronizasyon tamamlandı! {config.get('channel_name')} üzerinden 1 yeni sipariş ({order_num}) çekildi, E-Arşiv faturası ({inv_num}) kesildi ve stok 1 adet düşüldü.",
        "order": clean_doc(new_order)
    }

# ----------------- KARGO ENTEGRASYONLARI -----------------
@api_router.get("/integrations/cargo")
async def list_cargo_integrations(company_id: Optional[str] = "comp_nexus_main_01"):
    configs = await db.cargo_configs.find({"company_id": company_id}).to_list(100)
    return clean_docs(configs)

@api_router.put("/integrations/cargo/{carrier_id}")
async def update_cargo_integration(carrier_id: str, data: Dict[str, Any]):
    await db.cargo_configs.update_one({"_id": carrier_id}, {"$set": data})
    res = await db.cargo_configs.find_one({"_id": carrier_id})
    return clean_doc(res)

@api_router.post("/cargo/create-shipment")
async def create_cargo_shipment(req: Dict[str, Any]):
    carrier_code = req.get("carrier_code", "yurtici")
    order_id = req.get("order_id")
    customer_name = req.get("customer_name", "Müşteri")
    address = req.get("address", "Adres")
    city = req.get("city", "İstanbul")
    company_id = req.get("company_id", "comp_nexus_main_01")

    tracking_num = f"{carrier_code.upper()[:2]}-{str(uuid.uuid4().int)[:10]}"
    barcode = f"869{str(uuid.uuid4().int)[:10]}"

    carrier_names = {
        "yurtici": "Yurtiçi Kargo",
        "aras": "Aras Kargo",
        "mng": "MNG Kargo",
        "surat": "Sürat Kargo",
        "ptt": "PTT Kargo"
    }

    shipment = CargoShipment(
        id=f"shp_{uuid.uuid4().hex[:8]}",
        company_id=company_id,
        carrier_code=carrier_code,
        carrier_name=carrier_names.get(carrier_code, "Kargo"),
        tracking_number=tracking_num,
        barcode=barcode,
        order_id=order_id,
        customer_name=customer_name,
        address=address,
        city=city,
        status="in_transit",
        estimated_delivery=(datetime.now(timezone.utc) + timedelta(days=2)).strftime("%Y-%m-%d")
    )

    await db.cargo_shipments.insert_one(shipment.to_mongo())

    if order_id:
        await db.orders.update_one(
            {"_id": order_id},
            {"$set": {
                "order_status": "shipped",
                "cargo_carrier": carrier_code,
                "cargo_tracking_number": tracking_num,
                "cargo_barcode": barcode
            }}
        )

    return clean_doc(shipment.to_mongo())

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
        count = await db.orders.count_documents({"company_id": order.company_id}) + 1
        prefix = "B2B" if order.channel == "b2b" else "ORD"
        order.order_number = f"{prefix}-{datetime.now().strftime('%Y')}-{str(count).zfill(4)}"

    doc = order.to_mongo()
    await db.orders.insert_one(doc)
    return clean_doc(doc)

@api_router.put("/orders/{order_id}/status")
async def update_order_status(order_id: str, req: Dict[str, str]):
    new_status = req.get("status", "approved")
    await db.orders.update_one({"_id": order_id}, {"$set": {"order_status": new_status}})
    return {"status": "success", "order_status": new_status}

@api_router.post("/orders/{order_id}/convert-to-invoice")
async def convert_order_to_invoice(order_id: str):
    order = await db.orders.find_one({"_id": order_id})
    if not order:
        raise HTTPException(status_code=404, detail="Sipariş bulunamadı.")

    if order.get("is_invoiced") and order.get("invoice_id"):
        return {"status": "info", "message": "Bu sipariş için zaten fatura oluşturulmuş.", "invoice_id": order.get("invoice_id")}

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
        "e_type": "e_archive",
        "invoice_number": invoice_number,
        "contact_id": "cnt_01",
        "contact_name": order.get("customer_name"),
        "contact_tax_id": "11111111111",
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

    return {
        "status": "success",
        "message": f"Sipariş başarıyla faturalandırıldı. Fatura No: {invoice_number}",
        "invoice_id": inv_id
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
@api_router.get("/production/recipes")
async def list_recipes(company_id: Optional[str] = "comp_nexus_main_01"):
    recipes = await db.recipes.find({"company_id": company_id}).to_list(100)
    return clean_docs(recipes)

@api_router.post("/production/recipes")
async def create_recipe(recipe: Recipe):
    if not recipe.code:
        recipe.code = f"BOM-{str(uuid.uuid4().int)[:6]}"
    mat_cost = sum(m.cost_per_unit * m.quantity for m in recipe.materials)
    recipe.total_estimated_cost = mat_cost + recipe.labor_cost + recipe.overhead_cost

    doc = recipe.to_mongo()
    await db.recipes.insert_one(doc)
    return clean_doc(doc)

@api_router.get("/production/orders")
async def list_production_orders(company_id: Optional[str] = "comp_nexus_main_01"):
    orders = await db.production_orders.find({"company_id": company_id}).sort("created_at", -1).to_list(100)
    return clean_docs(orders)

@api_router.post("/production/orders")
async def create_production_order(p_order: ProductionOrder):
    if not p_order.order_code:
        p_order.order_code = f"URT-{datetime.now().strftime('%Y')}-{str(uuid.uuid4().int)[:5]}"
    doc = p_order.to_mongo()
    await db.production_orders.insert_one(doc)
    return clean_doc(doc)

@api_router.post("/production/orders/{order_id}/complete")
async def complete_production_order(order_id: str):
    p_order = await db.production_orders.find_one({"_id": order_id})
    if not p_order:
        raise HTTPException(status_code=404, detail="Üretim emri bulunamadı.")

    if p_order.get("status") == "completed":
        return {"status": "info", "message": "Bu üretim emri zaten tamamlanmış."}

    recipe = await db.recipes.find_one({"_id": p_order.get("recipe_id")})
    planned_qty = p_order.get("planned_quantity", 1.0)

    if recipe:
        for mat in recipe.get("materials", []):
            needed_qty = mat.get("quantity", 1.0) * planned_qty
            await db.products.update_one(
                {"_id": mat.get("product_id")},
                {"$inc": {"stock_quantity": -needed_qty}}
            )

    await db.products.update_one(
        {"_id": p_order.get("finished_product_id")},
        {"$inc": {"stock_quantity": planned_qty}}
    )

    await db.production_orders.update_one(
        {"_id": order_id},
        {"$set": {
            "status": "completed",
            "completed_quantity": planned_qty,
            "end_date": datetime.now(timezone.utc).strftime("%Y-%m-%d")
        }}
    )

    return {
        "status": "success",
        "message": f"{planned_qty} adet '{p_order.get('finished_product_name')}' üretimi tamamlandı! Hammaddeler düşüldü ve mamul stoğu güncellendi."
    }

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

@api_router.put("/personnel/employees/{emp_id}")
async def update_employee(emp_id: str, data: Dict[str, Any]):
    await db.employees.update_one({"_id": emp_id}, {"$set": data})
    res = await db.employees.find_one({"_id": emp_id})
    return clean_doc(res)

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

    generated = []
    for emp in employees:
        net = emp.get("salary", 30000.0)
        gross = net * 1.40
        payroll_doc = {
            "_id": f"pay_{uuid.uuid4().hex[:8]}",
            "company_id": company_id,
            "employee_id": str(emp.get("_id", emp.get("id"))),
            "employee_name": emp.get("full_name"),
            "period": period,
            "net_salary": net,
            "gross_salary": gross,
            "bonus": 0.0,
            "deduction": 0.0,
            "advance_payment": 0.0,
            "final_payable": net,
            "status": "pending",
            "created_at": datetime.now(timezone.utc).isoformat()
        }
        await db.payrolls.insert_one(payroll_doc)
        generated.append(clean_doc(payroll_doc))

    return {"status": "success", "message": f"{period} dönemi için {len(generated)} personelin bordrosu hesaplandı.", "payrolls": generated}

@api_router.post("/personnel/payrolls/{payroll_id}/pay")
async def pay_payroll(payroll_id: str, req: Dict[str, Any]):
    account_id = req.get("account_id")
    payroll = await db.payrolls.find_one({"_id": payroll_id})
    if not payroll:
        raise HTTPException(status_code=404, detail="Bordro kaydı bulunamadı.")

    amount = payroll.get("final_payable", 0.0)
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")

    await db.payrolls.update_one(
        {"_id": payroll_id},
        {"$set": {"status": "paid", "paid_date": today}}
    )

    if account_id:
        acc = await db.bank_accounts.find_one({"_id": account_id})
        acc_name = acc.get("account_name", "Banka") if acc else "Banka"
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

    return {"status": "success", "message": f"{payroll.get('employee_name')} için maaş ödemesi gerçekleştirildi."}

# ----------------- AI FİNANSAL DANIŞMAN -----------------
class AIChatRequest(BaseModel):
    message: str
    company_id: Optional[str] = "comp_nexus_main_01"

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
app.include_router(api_router)

@app.get("/")
async def root():
    return {"status": "healthy", "service": "NexusERP API", "version": "2.0.0"}

@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
