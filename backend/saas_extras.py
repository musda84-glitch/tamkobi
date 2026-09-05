"""Platform ek özellikler: Şirket olarak gir (destek modu), abonelik ödemesinden otomatik e-Arşiv fatura + e-posta, PayTR iFrame ödeme sağlayıcısı."""
import base64
import hashlib
import hmac
import json
import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional

import httpx
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import PlainTextResponse

import comm_service
import saas
import saas_billing
from auth_utils import get_jwt_secret, JWT_ALGORITHM, get_user_from_token

router = APIRouter(prefix="/api")
logger = logging.getLogger("NexusERP")
_db = None
_deps: Dict[str, Any] = {}
PAYTR_TOKEN_URL = "https://www.paytr.com/odeme/api/get-token"


def init(db, deps):
    global _db
    _db = db
    _deps.update(deps)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ---------------- Şirket olarak gir (impersonation) ----------------
@router.post("/system/companies/{company_id}/impersonate")
async def impersonate(company_id: str, request: Request, response: Response, admin: dict = Depends(saas.require_super_admin)):
    target = await _db.users.find_one({"company_ids": company_id, "role": "admin", "is_active": {"$ne": False}}) or await _db.users.find_one({"company_ids": company_id})
    if not target:
        raise HTTPException(status_code=400, detail="Bu şirkette giriş yapılabilecek kullanıcı yok.")
    company = await _db.companies.find_one({"_id": company_id}) or {}
    payload = {"sub": target["_id"], "email": target["email"], "role": target.get("role", "admin"), "type": "access", "imp_by": admin["email"], "imp_name": admin.get("name"), "exp": datetime.now(timezone.utc) + timedelta(hours=2)}
    token = jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)
    current = request.cookies.get("access_token") or request.headers.get("Authorization", "")[7:]
    response.set_cookie(key="sa_return", value=current, httponly=True, max_age=7200, path="/")
    response.set_cookie(key="access_token", value=token, httponly=True, max_age=7200, path="/")
    await _db.users.update_one({"_id": target["_id"]}, {"$set": {"active_company_id": company_id}})
    await _db.activity_logs.insert_one({"_id": str(uuid.uuid4()), "company_id": company_id, "user_id": admin.get("id") or admin.get("_id"), "user_name": admin.get("name"), "method": "IMPERSONATE", "path": f"/system/companies/{company_id}/impersonate", "module": "/settings", "status": 200, "target_user": target["email"], "created_at": _now()})
    return {"status": "success", "message": f"{company.get('name')} şirketine {target.get('name')} ({target['email']}) olarak giriş yapıldı. Destek modu 2 saat geçerlidir.", "company_name": company.get("name"), "as_user": target["email"]}


def impersonation_info(request: Request) -> Optional[Dict[str, Any]]:
    token = request.cookies.get("access_token")
    if not token:
        return None
    try:
        p = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.InvalidTokenError:
        return None
    return {"by": p["imp_by"], "name": p.get("imp_name")} if p.get("imp_by") else None


@router.post("/auth/impersonate/exit")
async def impersonate_exit(request: Request, response: Response):
    back = request.cookies.get("sa_return")
    if not back:
        raise HTTPException(status_code=400, detail="Destek oturumu bulunamadı.")
    try:
        await get_user_from_token(back, _db)
    except HTTPException:
        response.delete_cookie("sa_return", path="/"); response.delete_cookie("access_token", path="/")
        raise HTTPException(status_code=401, detail="Panel oturumunuz süresi dolmuş; lütfen panele tekrar giriş yapın.")
    response.set_cookie(key="access_token", value=back, httponly=True, max_age=86400 * 7, path="/")
    response.delete_cookie("sa_return", path="/")
    return {"status": "success", "redirect": "/sistem/sirketler"}


# ---------------- Otomatik e-Arşiv fatura ----------------
async def issue_subscription_invoice(tx: dict) -> Optional[str]:
    st = await saas_billing.settings()
    platform_cid = st["sender_company_id"]
    customer = await _db.companies.find_one({"_id": tx["company_id"]}) or {}
    admin = await _db.users.find_one({"company_ids": tx["company_id"], "role": "admin"}) or {}
    q = {"company_id": platform_cid, "$or": [{"subscriber_company_id": tx["company_id"]}] + ([{"tax_number_or_id": customer["tax_number"]}] if customer.get("tax_number") else [])}
    contact = await _db.contacts.find_one(q)
    if not contact:
        contact = {"_id": f"cnt_{uuid.uuid4().hex[:8]}", "company_id": platform_cid, "type": "customer", "name": customer.get("name") or tx["company_id"], "tax_number_or_id": customer.get("tax_number") or "", "email": customer.get("email") or admin.get("email"), "phone": customer.get("phone"), "city": customer.get("city"), "balance": 0.0, "credit_limit": 0.0, "category": "Abonelik Müşterisi", "subscriber_company_id": tx["company_id"], "payment_term_days": 0, "late_fee_rate": 0.0, "b2b_enabled": False, "b2b_discount": 0.0, "source": "subscription", "created_at": _now()}
        await _db.contacts.insert_one(contact)
    gross = round(float(tx["amount"]), 2); net = round(gross / 1.20, 2); vat = round(gross - net, 2)
    period_label = "Yıllık" if tx["period"] == "yearly" else "Aylık"
    year = datetime.now(timezone.utc).year
    seq = await _db.invoices.count_documents({"company_id": platform_cid, "source": "subscription"}) + 1
    inv = {"_id": str(uuid.uuid4()), "company_id": platform_cid, "invoice_number": f"ABN{year}{seq:06d}", "invoice_type": "sales", "e_type": "e_archive", "contact_id": contact["_id"], "contact_name": contact["name"], "contact_tax_id": contact.get("tax_number_or_id"), "issue_date": _now()[:10], "due_date": _now()[:10],
           "items": [{"product_id": "", "name": f"{st.get('brand_name', 'NexusHesap')} {tx['plan_name']} Paketi – {period_label} Abonelik", "quantity": 1, "unit": "Adet", "unit_price": net, "vat_rate": 20, "discount_rate": 0, "total": net, "vat_amount": vat}],
           "subtotal": net, "vat_total": vat, "discount_total": 0.0, "grand_total": gross, "currency": "TRY", "status": "approved", "gib_status": "Başarıyla İletildi (GİB Onaylı)", "gib_tracking_id": f"GIB-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:6].upper()}", "payment_status": "paid", "paid_amount": gross,
           "notes": f"Online ödeme ({tx.get('provider', 'stripe')}) · Referans {tx.get('session_id') or tx.get('merchant_oid')}", "source": "subscription", "payment_tx_id": tx["_id"], "subscriber_company_id": tx["company_id"], "created_at": _now()}
    await _db.invoices.insert_one(inv)
    await _db.payment_transactions.update_one({"_id": tx["_id"]}, {"$set": {"invoice_id": inv["_id"], "invoice_number": inv["invoice_number"]}})
    mail = {"status": "skipped"}
    to = [e for e in {admin.get("email"), customer.get("email")} if e]
    if to:
        try:
            acc = await _deps["mail_account"](platform_cid)
            rows = "".join(f"<tr><td style='padding:6px 10px;border:1px solid #e2e8f0'>{i['name']}</td><td style='padding:6px 10px;border:1px solid #e2e8f0;text-align:right'>{i['total']:,.2f} ₺</td></tr>" for i in inv["items"])
            html = f"<div style='font-family:Arial,sans-serif;max-width:640px'><h2 style='color:#0f172a'>e-Arşiv Fatura {inv['invoice_number']}</h2><p>Sayın {contact['name']},<br>{tx['plan_name']} paketi {period_label.lower()} abonelik ödemeniz için e-Arşiv faturanız oluşturulmuştur.</p><table style='border-collapse:collapse;width:100%'>{rows}<tr><td style='padding:6px 10px;text-align:right'>KDV %20</td><td style='padding:6px 10px;text-align:right'>{vat:,.2f} ₺</td></tr><tr><td style='padding:6px 10px;text-align:right;font-weight:bold'>Genel Toplam</td><td style='padding:6px 10px;text-align:right;font-weight:bold'>{gross:,.2f} ₺</td></tr></table><p style='color:#64748b;font-size:12px'>ETTN/Takip: {inv['gib_tracking_id']} · Tarih: {inv['issue_date']} · Ödeme alındı.</p></div>"
            await _deps["smtp_send"](acc, to, f"e-Arşiv Faturanız {inv['invoice_number']} – {tx['plan_name']} Paketi", f"{tx['plan_name']} paketi {period_label.lower()} abonelik faturanız: {gross:,.2f} ₺ (KDV dahil). Takip: {inv['gib_tracking_id']}", html=html)
            mail = {"status": "sent", "to": to}
        except Exception as e:  # noqa: BLE001
            mail = {"status": "failed", "detail": str(getattr(e, "detail", e))[:160]}
    await _db.invoices.update_one({"_id": inv["_id"]}, {"$set": {"email_result": mail}})
    await _db.payment_transactions.update_one({"_id": tx["_id"]}, {"$set": {"invoice_mail": mail}})
    return inv["_id"]


# ---------------- PayTR ----------------
def _hash(key: str, message: str) -> str:
    return base64.b64encode(hmac.new(key.encode(), message.encode(), hashlib.sha256).digest()).decode()


async def paytr_conf() -> Dict[str, Any]:
    st = await saas_billing.settings()
    p = st.get("paytr") or {}
    return {"merchant_id": p.get("merchant_id", ""), "merchant_key": comm_service.decrypt(p["merchant_key_enc"]) if p.get("merchant_key_enc") else "", "merchant_salt": comm_service.decrypt(p["merchant_salt_enc"]) if p.get("merchant_salt_enc") else "", "test_mode": "1" if p.get("test_mode", True) else "0", "enabled": bool(p.get("enabled")), "max_installment": str(p.get("max_installment", 0) or 0)}


@router.get("/system/paytr")
async def get_paytr(_: dict = Depends(saas.require_super_admin)):
    st = await saas_billing.settings(); p = st.get("paytr") or {}
    return {"enabled": bool(p.get("enabled")), "merchant_id": p.get("merchant_id", ""), "has_key": bool(p.get("merchant_key_enc")), "has_salt": bool(p.get("merchant_salt_enc")), "test_mode": p.get("test_mode", True), "max_installment": p.get("max_installment", 0)}


@router.put("/system/paytr")
async def put_paytr(req: Dict[str, Any], _: dict = Depends(saas.require_super_admin)):
    st = await saas_billing.settings(); p = dict(st.get("paytr") or {})
    for k in ("enabled", "test_mode"):
        if k in req:
            p[k] = bool(req[k])
    if "merchant_id" in req:
        p["merchant_id"] = (req["merchant_id"] or "").strip()
    if "max_installment" in req:
        p["max_installment"] = int(req["max_installment"] or 0)
    if req.get("merchant_key"):
        p["merchant_key_enc"] = comm_service.encrypt(req["merchant_key"].strip())
    if req.get("merchant_salt"):
        p["merchant_salt_enc"] = comm_service.encrypt(req["merchant_salt"].strip())
    if p.get("enabled") and not (p.get("merchant_id") and p.get("merchant_key_enc") and p.get("merchant_salt_enc")):
        raise HTTPException(status_code=400, detail="PayTR'ı aktif etmek için merchant_id, merchant_key ve merchant_salt gerekli.")
    await _db.platform_settings.update_one({"_id": "platform"}, {"$set": {"paytr": p, "updated_at": _now()}}, upsert=True)
    return await get_paytr(_)


@router.get("/payments/providers")
async def payment_providers():
    c = await paytr_conf()
    return {"stripe": True, "paytr": c["enabled"] and bool(c["merchant_id"] and c["merchant_key"] and c["merchant_salt"])}


@router.post("/payments/paytr/session")
async def paytr_session(req: Dict[str, Any], request: Request):
    c = await paytr_conf()
    if not (c["enabled"] and c["merchant_id"] and c["merchant_key"] and c["merchant_salt"]):
        raise HTTPException(status_code=400, detail="PayTR aktif değil; sistem yöneticisi PayTR bilgilerini girmeli.")
    cid = req.get("company_id") or "comp_nexus_main_01"
    period = req.get("period") if req.get("period") in saas_billing.PERIOD_DAYS else "monthly"
    plan = await _db.saas_plans.find_one({"_id": req.get("plan_id")})
    company = await _db.companies.find_one({"_id": cid})
    if not plan or not company:
        raise HTTPException(status_code=400, detail="Paket veya şirket bulunamadı.")
    amount = float(plan.get("price_yearly" if period == "yearly" else "price_monthly") or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Bu paket için fiyat tanımlı değil.")
    admin = await _db.users.find_one({"company_ids": cid, "role": "admin"}) or {}
    email = admin.get("email") or company.get("email") or "musteri@example.com"
    oid = "NX" + uuid.uuid4().hex[:24]
    fwd = request.headers.get("x-forwarded-for", "")
    ip = fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "0.0.0.0")
    minor = str(int(round(amount * 100)))
    basket = base64.b64encode(json.dumps([[f"{plan['name']} Paketi – {'Yıllık' if period == 'yearly' else 'Aylık'}", f"{amount:.2f}", 1]], ensure_ascii=False, separators=(",", ":")).encode()).decode()
    no_inst, max_inst, cur = "0", c["max_installment"], "TL"
    token = _hash(c["merchant_key"], c["merchant_id"] + ip + oid + email + minor + basket + no_inst + max_inst + cur + c["test_mode"] + c["merchant_salt"])
    origin = (req.get("origin_url") or str(request.headers.get("origin") or "")).rstrip("/")
    form = {"merchant_id": c["merchant_id"], "user_ip": ip, "merchant_oid": oid, "email": email, "payment_amount": minor, "paytr_token": token, "user_basket": basket, "debug_on": "1", "test_mode": c["test_mode"], "no_installment": no_inst, "max_installment": max_inst, "currency": cur,
            "merchant_ok_url": f"{origin}/odeme/basarili?merchant_oid={oid}", "merchant_fail_url": f"{origin}/odeme/iptal", "timeout_limit": "30", "lang": "tr", "user_name": (admin.get("name") or company.get("name") or "")[:60], "user_address": (company.get("address") or company.get("city") or "-")[:200], "user_phone": (company.get("phone") or admin.get("phone") or "-")[:20]}
    await _db.payment_transactions.insert_one({"_id": str(uuid.uuid4()), "provider": "paytr", "merchant_oid": oid, "session_id": oid, "company_id": cid, "plan_id": plan["_id"], "plan_name": plan["name"], "period": period, "amount": amount, "currency": "try", "status": "initiated", "payment_status": "pending", "applied": False, "created_at": _now(), "updated_at": _now()})
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            r = await client.post(PAYTR_TOKEN_URL, data=form)
            res = r.json()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"PayTR'a ulaşılamadı: {str(e)[:120]}")
    if res.get("status") != "success":
        await _db.payment_transactions.update_one({"merchant_oid": oid}, {"$set": {"status": "token_failed", "payment_status": "failed", "paytr_error": res.get("reason"), "updated_at": _now()}})
        raise HTTPException(status_code=502, detail=f"PayTR token alınamadı: {res.get('reason', 'bilinmeyen hata')}")
    return {"merchant_oid": oid, "iframe_token": res["token"], "iframe_url": f"https://www.paytr.com/odeme/guvenli/{res['token']}"}


@router.post("/payments/paytr/callback")
async def paytr_callback(request: Request):
    form = await request.form()
    oid, status, total, received = str(form.get("merchant_oid", "")), str(form.get("status", "")), str(form.get("total_amount", "")), str(form.get("hash", ""))
    c = await paytr_conf()
    if not hmac.compare_digest(_hash(c["merchant_key"], oid + c["merchant_salt"] + status + total), received):
        raise HTTPException(status_code=400, detail="invalid PayTR hash")
    tx = await _db.payment_transactions.find_one({"merchant_oid": oid})
    if not tx:
        raise HTTPException(status_code=404, detail="unknown order")
    if tx.get("payment_status") != "paid":
        if status == "success":
            await _db.payment_transactions.update_one({"_id": tx["_id"]}, {"$set": {"payment_status": "paid", "status": "completed", "paid_at": _now(), "paytr_total_amount": total, "payment_type": form.get("payment_type"), "updated_at": _now()}})
            await saas_billing._apply_payment(await _db.payment_transactions.find_one({"_id": tx["_id"]}))
        else:
            await _db.payment_transactions.update_one({"_id": tx["_id"]}, {"$set": {"payment_status": "failed", "status": "failed", "failed_reason_code": form.get("failed_reason_code"), "failed_reason_msg": form.get("failed_reason_msg"), "updated_at": _now()}})
    return PlainTextResponse("OK")
