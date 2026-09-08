"""Starter demo pack for new companies — tagged is_demo so it can be wiped without touching real data."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List

from fastapi import APIRouter, HTTPException, Query

router = APIRouter(prefix="/api")
_db = None

COLLECTIONS = (
    "warehouses", "contacts", "products", "bank_accounts", "bank_transactions",
    "invoices", "expenses", "orders", "partners", "partner_transactions",
    "employees", "payrolls", "recipes", "integration_configs", "cargo_configs",
)

LEGACY_IDS = [
    "wh_main", "wh_ankara", "wh_raw",
    "cnt_01", "cnt_02", "cnt_03", "cnt_04",
    "prod_01", "prod_02", "prod_03", "prod_raw_01", "prod_raw_02", "prod_raw_03",
    "rec_01", "bank_01", "bank_02", "bank_03", "bank_04",
    "inv_01", "inv_02", "inv_03",
    "ecom_trendyol", "ecom_hepsiburada", "ecom_amazon", "ecom_shopify", "ecom_n11", "ecom_woocommerce",
    "cargo_yurtici", "cargo_aras", "cargo_mng", "cargo_ptt",
    "ord_01", "ord_02", "ord_03",
    "emp_01", "emp_02", "emp_03", "pay_01", "pay_02",
    "partner_01", "partner_02",
]


def init(db):
    global _db
    _db = db


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _id(company_id: str, key: str) -> str:
    return f"demo_{company_id}_{key}"


def _stamp(company_id: str, extra: Dict[str, Any]) -> Dict[str, Any]:
    return {"company_id": company_id, "is_demo": True, "created_at": _now(), **extra}


async def demo_counts(company_id: str) -> Dict[str, int]:
    out: Dict[str, int] = {}
    total = 0
    for name in COLLECTIONS:
        n = int(await _db[name].count_documents({"company_id": company_id, "is_demo": True}) or 0)
        if n:
            out[name] = n
            total += n
    return {"by_collection": out, "total": total, "loaded": total > 0}


async def clear_demo(company_id: str) -> int:
    deleted = 0
    for name in COLLECTIONS:
        deleted += int((await _db[name].delete_many({"company_id": company_id, "is_demo": True})).deleted_count or 0)
    await _db.companies.update_one({"_id": company_id}, {"$set": {"has_demo": False, "demo_cleared_at": _now()}})
    return deleted


async def load_demo(company_id: str) -> Dict[str, Any]:
    company = await _db.companies.find_one({"_id": company_id})
    if not company:
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    await clear_demo(company_id)
    today = _today()
    due = (datetime.now(timezone.utc) + timedelta(days=14)).strftime("%Y-%m-%d")
    year = datetime.now(timezone.utc).strftime("%Y")
    wh = _id(company_id, "wh")
    cust = _id(company_id, "cust")
    supp = _id(company_id, "supp")
    p1 = _id(company_id, "p1")
    p2 = _id(company_id, "p2")
    p3 = _id(company_id, "p3")
    bank = _id(company_id, "bank")
    cash = _id(company_id, "cash")
    inv_s = _id(company_id, "invs")
    inv_p = _id(company_id, "invp")
    docs: List[tuple] = []

    docs.append(("warehouses", {"_id": wh, **_stamp(company_id, {
        "name": "Merkez Depo", "code": "DEP-01", "location": company.get("city") or "İstanbul",
        "manager_name": "", "is_default": True,
    })}))
    docs.append(("contacts", {"_id": cust, **_stamp(company_id, {
        "type": "customer", "name": "Örnek Perakende A.Ş.", "company_title": "Örnek Perakende A.Ş.",
        "tax_number_or_id": "1111111111", "tax_office": "Kadıköy V.D.", "email": "fatura@ornekperakende.com",
        "phone": "0216 000 00 01", "address": "Bağdat Cad. No:100", "city": "İstanbul", "district": "Kadıköy",
        "balance": 14400.0, "credit_limit": 50000.0, "category": "Kurumsal Müşteri", "is_e_invoice_user": True,
        "notes": "Demo cari — 14 gün vade.",
    })}))
    docs.append(("contacts", {"_id": supp, **_stamp(company_id, {
        "type": "supplier", "name": "Anadolu Tedarik Ltd. Şti.", "company_title": "Anadolu Tedarik Ltd. Şti.",
        "tax_number_or_id": "2222222222", "tax_office": "Şişli V.D.", "email": "siparis@anadolutedarik.com",
        "phone": "0212 000 00 02", "address": "Halaskargazi Cad. No:45", "city": "İstanbul", "district": "Şişli",
        "balance": -7200.0, "credit_limit": 80000.0, "category": "Tedarikçi", "is_e_invoice_user": True,
        "notes": "Demo tedarikçi.",
    })}))
    docs.append(("products", {"_id": p1, **_stamp(company_id, {
        "name": "Ofis Koltuğu Ergonomik", "sku": "DEMO-KLT-01", "barcode": "8680001000001",
        "type": "product", "category": "Mobilya", "unit": "Adet", "vat_rate": 20,
        "purchase_price": 2100.0, "sale_price": 3890.0, "currency": "TRY",
        "stock_quantity": 24.0, "min_stock_alert": 5.0, "warehouse_id": wh,
        "has_variants": False, "variants": [], "is_active": True, "track_stock": True,
    })}))
    docs.append(("products", {"_id": p2, **_stamp(company_id, {
        "name": "Ahşap Çalışma Masası 140 cm", "sku": "DEMO-MSA-01", "barcode": "8680001000002",
        "type": "product", "category": "Mobilya", "unit": "Adet", "vat_rate": 20,
        "purchase_price": 1450.0, "sale_price": 2790.0, "currency": "TRY",
        "stock_quantity": 12.0, "min_stock_alert": 4.0, "warehouse_id": wh,
        "has_variants": False, "variants": [], "is_active": True, "track_stock": True,
    })}))
    docs.append(("products", {"_id": p3, **_stamp(company_id, {
        "name": "LED Masa Lambası", "sku": "DEMO-LMB-01", "barcode": "8680001000003",
        "type": "product", "category": "Aydınlatma", "unit": "Adet", "vat_rate": 20,
        "purchase_price": 180.0, "sale_price": 449.0, "currency": "TRY",
        "stock_quantity": 3.0, "min_stock_alert": 8.0, "warehouse_id": wh,
        "has_variants": False, "variants": [], "is_active": True, "track_stock": True,
    })}))
    docs.append(("bank_accounts", {"_id": bank, **_stamp(company_id, {
        "type": "bank", "bank_name": "Garanti BBVA", "account_name": "Ticari Vadesiz TL",
        "account_number": "DEMO-1001", "iban": "TR00 0000 0000 0000 0000 0000 01",
        "currency": "TRY", "current_balance": 48500.0, "pos_commission_rate": 0.0,
    })}))
    docs.append(("bank_accounts", {"_id": cash, **_stamp(company_id, {
        "type": "cash_box", "bank_name": "Kasa", "account_name": "Merkez Kasa",
        "account_number": "KASA-01", "iban": "", "currency": "TRY", "current_balance": 7900.0, "pos_commission_rate": 0.0,
    })}))
    docs.append(("invoices", {"_id": inv_s, **_stamp(company_id, {
        "invoice_type": "sales", "e_type": "e_archive", "invoice_number": f"DEMO-{year}-0001",
        "contact_id": cust, "contact_name": "Örnek Perakende A.Ş.", "contact_tax_id": "1111111111",
        "issue_date": today, "due_date": due,
        "items": [{"product_id": p1, "name": "Ofis Koltuğu Ergonomik", "quantity": 2, "unit": "Adet", "unit_price": 3890.0, "vat_rate": 20, "discount_percent": 0.0, "total": 7780.0},
                  {"product_id": p3, "name": "LED Masa Lambası", "quantity": 4, "unit": "Adet", "unit_price": 449.0, "vat_rate": 20, "discount_percent": 0.0, "total": 1796.0}],
        "subtotal": 9576.0, "vat_total": 1915.2, "discount_total": 0.0, "grand_total": 11491.2,
        "currency": "TRY", "status": "approved", "gib_status": "Taslak (demo)", "payment_status": "unpaid",
        "paid_amount": 0.0, "notes": "Demo satış faturası.", "source_channel": "manual",
    })}))
    docs.append(("invoices", {"_id": inv_p, **_stamp(company_id, {
        "invoice_type": "purchase", "e_type": "paper", "invoice_number": f"DEMO-ALS-{year}-0001",
        "contact_id": supp, "contact_name": "Anadolu Tedarik Ltd. Şti.", "contact_tax_id": "2222222222",
        "issue_date": today, "due_date": due,
        "items": [{"product_id": p2, "name": "Ahşap Çalışma Masası 140 cm", "quantity": 2, "unit": "Adet", "unit_price": 1450.0, "vat_rate": 20, "discount_percent": 0.0, "total": 2900.0}],
        "subtotal": 2900.0, "vat_total": 580.0, "discount_total": 0.0, "grand_total": 3480.0,
        "currency": "TRY", "status": "approved", "gib_status": "Kağıt (demo)", "payment_status": "unpaid",
        "paid_amount": 0.0, "notes": "Demo alış faturası.", "source_channel": "manual",
    })}))
    docs.append(("expenses", {"_id": _id(company_id, "exp"), **_stamp(company_id, {
        "expense_number": f"MSR-{year}-D001", "date": today, "category": "Ofis Malzemesi",
        "description": "Demo kırtasiye alımı", "amount": 500.0, "vat_rate": 20, "vat_amount": 100.0, "total": 600.0,
        "currency": "TRY", "payment_status": "paid", "account_id": cash, "account_name": "Merkez Kasa",
        "paid_date": today, "notes": "Demo masraf.", "is_recurring": False,
    })}))
    docs.append(("bank_transactions", {"_id": _id(company_id, "tx"), **_stamp(company_id, {
        "account_id": cash, "account_name": "Merkez Kasa", "type": "outflow", "category": "Masraf: Ofis Malzemesi",
        "amount": 600.0, "currency": "TRY", "description": f"MSR-{year}-D001 Demo kırtasiye alımı",
        "source": "expense", "date": today,
    })}))
    docs.append(("orders", {"_id": _id(company_id, "ord"), **_stamp(company_id, {
        "order_number": f"B2B-{year}-D001", "channel": "manual", "customer_name": "Örnek Perakende A.Ş.",
        "customer_email": "siparis@ornekperakende.com", "customer_phone": "0216 000 00 01",
        "shipping_address": "Bağdat Cad. No:100 Kadıköy", "city": "İstanbul",
        "items": [{"product_id": p1, "product_name": "Ofis Koltuğu Ergonomik", "sku": "DEMO-KLT-01", "quantity": 1, "unit_price": 3890.0, "total": 3890.0}],
        "total_amount": 3890.0, "currency": "TRY", "order_status": "pending", "is_invoiced": False,
        "order_date": _now(), "contact_id": cust,
    })}))

    for coll, doc in docs:
        await _db[coll].insert_one(doc)
    await _db.companies.update_one({"_id": company_id}, {"$set": {"has_demo": True, "demo_loaded_at": _now()}, "$unset": {"demo_cleared_at": ""}})
    return await demo_counts(company_id)


async def seed_for_new_company(company_id: str) -> None:
    try:
        await load_demo(company_id)
    except Exception:
        # Signup / şirket oluşturma demo yüzünden düşmesin.
        pass


async def tag_legacy_seed() -> int:
    """Mark the original Nexus seed rows so the overview delete button can remove them."""
    tagged = 0
    for name in COLLECTIONS:
        r = await _db[name].update_many({"_id": {"$in": LEGACY_IDS}, "is_demo": {"$ne": True}}, {"$set": {"is_demo": True}})
        tagged += int(r.modified_count or 0)
    r2 = await _db.partner_transactions.update_many({"partner_id": {"$in": ["partner_01", "partner_02"]}, "is_demo": {"$ne": True}}, {"$set": {"is_demo": True}})
    tagged += int(r2.modified_count or 0)
    if tagged:
        await _db.companies.update_many({"_id": {"$in": ["comp_nexus_main_01", "comp_nexus_b2b_02"]}}, {"$set": {"has_demo": True}})
    return tagged


@router.get("/demo/status")
async def demo_status(company_id: str = Query(...)):
    return await demo_counts(company_id)


@router.post("/demo/load")
async def demo_load(company_id: str = Query(...)):
    counts = await load_demo(company_id)
    return {"status": "success", "message": "Demo içerik yüklendi. Genel bakış, cariler, stok, fatura ve siparişlerde örnek kayıtlar göreceksiniz.", **counts}


@router.post("/demo/clear")
async def demo_clear(company_id: str = Query(...)):
    deleted = await clear_demo(company_id)
    return {"status": "success", "deleted": deleted, "message": f"{deleted} demo kayıt silindi. Kendi girdiğiniz veriler duruyor."}
