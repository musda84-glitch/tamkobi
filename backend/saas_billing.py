"""Platform faturalama & yaşam döngüsü: Stripe abonelik ödemesi (paket aktivasyonu), lisans hatırlatmaları (e-posta/WhatsApp/bildirim), herkese açık paketler & kayıt, platform ayarları."""
import asyncio
import logging
import os
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from emergentintegrations.payments.stripe.checkout import StripeCheckout, CheckoutSessionRequest

import rbac
import saas
from auth_utils import hash_password, create_access_token, create_refresh_token

router = APIRouter(prefix="/api")
logger = logging.getLogger("NexusERP")
_db = None
_deps: Dict[str, Any] = {}
PERIOD_DAYS = {"monthly": 30, "yearly": 365}
DEFAULT_SETTINGS = {"_id": "platform", "reminder_days": [7, 1], "email_enabled": True, "whatsapp_enabled": True, "sender_company_id": "comp_nexus_main_01", "trial_days": 14, "trial_plan_id": "plan_pro", "support_email": "", "support_phone": "", "brand_name": "Takibi", "currency": "try", "public_url": "https://takibi.com"}


def init(db, deps):
    global _db
    _db = db
    _deps.update(deps)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(d: dict) -> dict:
    d = dict(d); d["id"] = d.pop("_id"); return d


async def settings() -> Dict[str, Any]:
    s = await _db.platform_settings.find_one({"_id": "platform"}) or {}
    return {**DEFAULT_SETTINGS, **s}


def _checkout(request: Request) -> StripeCheckout:
    return StripeCheckout(api_key=os.environ["STRIPE_API_KEY"], webhook_url=f"{str(request.base_url).rstrip('/')}/api/webhook/stripe")


# ---------------- Payments ----------------
@router.post("/payments/checkout")
async def create_checkout(req: Dict[str, Any], request: Request):
    cid = req.get("company_id") or "comp_nexus_main_01"
    period = req.get("period") if req.get("period") in PERIOD_DAYS else "monthly"
    plan = await _db.saas_plans.find_one({"_id": req.get("plan_id")})
    if not plan:
        raise HTTPException(status_code=400, detail="Paket bulunamadı.")
    if not await _db.companies.find_one({"_id": cid}):
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    amount = float(plan.get("price_yearly" if period == "yearly" else "price_monthly") or 0)
    if amount <= 0:
        raise HTTPException(status_code=400, detail="Bu paket için fiyat tanımlı değil.")
    origin = (req.get("origin_url") or str(request.headers.get("origin") or "")).rstrip("/")
    st = await settings()
    sc = _checkout(request)
    session = await sc.create_checkout_session(CheckoutSessionRequest(amount=amount, currency=st.get("currency", "try"), success_url=f"{origin}/odeme/basarili?session_id={{CHECKOUT_SESSION_ID}}", cancel_url=f"{origin}/odeme/iptal", metadata={"company_id": cid, "plan_id": plan["_id"], "period": period}))
    await _db.payment_transactions.insert_one({"_id": str(uuid.uuid4()), "session_id": session.session_id, "company_id": cid, "plan_id": plan["_id"], "plan_name": plan["name"], "period": period, "amount": amount, "currency": st.get("currency", "try"), "status": "initiated", "payment_status": "pending", "applied": False, "created_at": _now(), "updated_at": _now()})
    return {"checkout_url": session.url, "session_id": session.session_id}


async def _apply_payment(tx: dict):
    """Ödeme onaylandı → lisansı aktive et (idempotent)."""
    r = await _db.payment_transactions.update_one({"_id": tx["_id"], "applied": {"$ne": True}}, {"$set": {"applied": True, "applied_at": _now()}})
    if not r.modified_count:
        return
    lic = await _db.company_licenses.find_one({"_id": tx["company_id"]}) or {}
    cur = lic.get("expires_at")
    start = datetime.now(timezone.utc)
    if lic.get("status") == "active" and lic.get("plan_id") == tx["plan_id"] and cur and datetime.fromisoformat(cur) > start:
        start = datetime.fromisoformat(cur)
    ends = (start + timedelta(days=PERIOD_DAYS[tx["period"]])).isoformat()
    await _db.company_licenses.update_one({"_id": tx["company_id"]}, {"$set": {"plan_id": tx["plan_id"], "status": "active", "billing_period": tx["period"], "expires_at": ends, "trial_ends_at": None, "last_payment_at": _now(), "updated_at": _now()}, "$setOnInsert": {"created_at": _now(), "started_at": _now(), "module_overrides": {}}}, upsert=True)
    await _db.upgrade_requests.update_many({"company_id": tx["company_id"], "status": "pending"}, {"$set": {"status": "approved", "admin_note": "Online ödeme ile aktif edildi", "resolved_at": _now()}})
    saas.invalidate(tx["company_id"])
    try:
        import saas_extras
        await saas_extras.issue_subscription_invoice(tx)
    except Exception as e:  # noqa: BLE001
        logger.warning(f"subscription invoice: {e}")
    await _db.notifications.insert_one({"_id": str(uuid.uuid4()), "company_id": tx["company_id"], "type": "license", "title": f"{tx['plan_name']} paketi aktif", "message": f"Ödemeniz alındı ({tx['amount']:,.0f} {tx['currency'].upper()}). Paketiniz {ends[:10]} tarihine kadar aktif.", "ref_type": "license", "ref_id": tx["_id"], "is_read": False, "created_at": _now()})


async def _mark_paid(session_id: str, payment_status: str, status: str):
    tx = await _db.payment_transactions.find_one({"session_id": session_id})
    if not tx:
        return None
    if payment_status == "paid" and tx.get("payment_status") != "paid":
        await _db.payment_transactions.update_one({"_id": tx["_id"]}, {"$set": {"payment_status": "paid", "status": "completed", "paid_at": _now(), "updated_at": _now()}})
        tx = await _db.payment_transactions.find_one({"_id": tx["_id"]})
    elif payment_status != "paid" and status in ("expired", "failed"):
        await _db.payment_transactions.update_one({"_id": tx["_id"], "payment_status": {"$ne": "paid"}}, {"$set": {"status": status, "payment_status": status, "updated_at": _now()}})
    if tx.get("payment_status") == "paid":
        await _apply_payment(tx)
    return await _db.payment_transactions.find_one({"_id": tx["_id"]})


@router.get("/payments/status/{session_id}")
async def payment_status(session_id: str, request: Request):
    tx = await _db.payment_transactions.find_one({"session_id": session_id})
    if not tx:
        raise HTTPException(status_code=404, detail="Ödeme kaydı bulunamadı.")
    if tx.get("payment_status") != "paid" and tx.get("provider", "stripe") == "stripe":
        try:
            s = await _checkout(request).get_checkout_status(session_id)
            tx = await _mark_paid(session_id, s.payment_status, s.status) or tx
        except Exception as e:  # noqa: BLE001
            logger.warning(f"stripe status: {e}")
    lic = await saas.effective(tx["company_id"]) if tx.get("applied") else None
    return {"session_id": session_id, "provider": tx.get("provider", "stripe"), "invoice_number": tx.get("invoice_number"), "invoice_id": tx.get("invoice_id"), "status": tx["status"], "payment_status": tx["payment_status"], "plan_name": tx.get("plan_name"), "period": tx.get("period"), "amount": tx.get("amount"), "currency": tx.get("currency"), "company_id": tx["company_id"], "license": lic}


@router.post("/webhook/stripe")
async def stripe_webhook(request: Request):
    body = await request.body()
    try:
        ev = await _checkout(request).handle_webhook(body, request.headers.get("Stripe-Signature"))
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"Webhook doğrulanamadı: {str(e)[:120]}")
    if ev.session_id:
        await _mark_paid(ev.session_id, ev.payment_status, "expired" if "expired" in (ev.event_type or "") else "completed")
    return {"status": "ok"}


@router.get("/system/payments")
async def list_payments(_: dict = Depends(saas.require_super_admin)):
    rows = [_clean(t) for t in await _db.payment_transactions.find({}).sort("created_at", -1).to_list(300)]
    names = {c["_id"]: c.get("name") for c in await _db.companies.find({}, {"name": 1}).to_list(1000)}
    paid = [r for r in rows if r["payment_status"] == "paid"]
    return {"items": [{**r, "company_name": names.get(r["company_id"], r["company_id"])} for r in rows], "total_paid": round(sum(float(r["amount"]) for r in paid), 2), "paid_count": len(paid)}


# ---------------- Platform settings ----------------
@router.get("/system/settings")
async def get_settings(_: dict = Depends(saas.require_super_admin)):
    s = await settings()
    sender = await _db.mail_accounts.find_one({"company_id": s["sender_company_id"]}, {"email": 1})
    wa = await _db.whatsapp_settings.find_one({"company_id": s["sender_company_id"]}, {"phone_number_id": 1})
    return {**s, "id": "platform", "sender_mail": (sender or {}).get("email"), "sender_whatsapp_ready": bool((wa or {}).get("phone_number_id")), "companies": [{"id": c["_id"], "name": c.get("name")} for c in await _db.companies.find({}, {"name": 1}).to_list(200)]}


@router.put("/system/settings")
async def put_settings(req: Dict[str, Any], _: dict = Depends(saas.require_super_admin)):
    upd = {k: req[k] for k in ("email_enabled", "whatsapp_enabled", "sender_company_id", "support_email", "support_phone", "brand_name", "trial_plan_id", "public_url") if k in req}
    if "reminder_days" in req:
        upd["reminder_days"] = sorted({int(x) for x in req["reminder_days"] if str(x).strip().isdigit() and 0 < int(x) <= 60}, reverse=True) or [7, 1]
    if "trial_days" in req:
        upd["trial_days"] = max(0, min(90, int(req["trial_days"] or 0)))
    await _db.platform_settings.update_one({"_id": "platform"}, {"$set": {**upd, "updated_at": _now()}}, upsert=True)
    return await settings()


# ---------------- Reminders ----------------
async def _send_reminder(company: dict, lic: dict, kind: str, st: dict) -> Dict[str, Any]:
    admins = await _db.users.find({"company_ids": company["_id"], "role": "admin"}, {"email": 1, "phone": 1, "name": 1}).to_list(20)
    end = (lic.get("trial_ends_at") if lic["status"] == "trial" else lic.get("expires_at")) or ""
    brand = st.get("brand_name", "NexusHesap")
    if kind == "expired":
        title = f"{brand} {'deneme süreniz' if lic['status'] == 'expired' and lic.get('trial_ends_at') else 'lisansınız'} sona erdi"
        body = f"Sayın {company.get('name')}, {lic['plan_name']} paketinizin süresi doldu; modüller kilitlendi. Kullanmaya devam etmek için Firma Ayarları → Paketim & Modüller ekranından ödeme yapabilir ya da bizimle iletişime geçebilirsiniz."
    else:
        title = f"{brand}: {lic['plan_name']} paketiniz {lic['days_left']} gün içinde sona eriyor"
        body = f"Sayın {company.get('name')}, {lic['plan_name']} paketinizin {'deneme süresi' if lic['status'] == 'trial' else 'lisansı'} {end[:10]} tarihinde sona erecek ({lic['days_left']} gün kaldı). Kesintisiz kullanım için Firma Ayarları → Paketim & Modüller ekranından yenileyebilirsiniz."
    if st.get("support_email") or st.get("support_phone"):
        body += f" Destek: {st.get('support_email', '')} {st.get('support_phone', '')}".rstrip()
    base = (st.get("public_url") or os.environ.get("PUBLIC_APP_URL") or "").rstrip("/")
    link = ""
    if base:
        import saas_docs
        link = f"{base}/yenile/{saas_docs.make_renew_token(company['_id'], lic.get('plan_id'))}"
        body += f" Tek tıkla yenilemek için: {link}"
    res = {"notification": True, "email": [], "whatsapp": [], "renew_link": bool(link)}
    await _db.notifications.insert_one({"_id": str(uuid.uuid4()), "company_id": company["_id"], "type": "license", "title": title, "message": body, "ref_type": "license", "ref_id": company["_id"], "is_read": False, "created_at": _now()})
    emails = [a["email"] for a in admins if a.get("email")] or ([company["email"]] if company.get("email") else [])
    if st.get("email_enabled") and emails:
        try:
            acc = await _deps["mail_account"](st["sender_company_id"])
            btn = f"<p style='margin-top:16px'><a href='{link}' style='background:#10b981;color:#0f172a;padding:12px 20px;border-radius:12px;font-weight:bold;text-decoration:none'>Şimdi Yenile →</a></p>" if link else ""
            await _deps["smtp_send"](acc, emails, title, body, html=f"<div style='font-family:Arial,sans-serif;max-width:600px'><h2 style='color:#0f172a'>{title}</h2><p>{body.replace(' Tek tıkla yenilemek için: ' + link, '') if link else body}</p>{btn}</div>")
            res["email"] = emails
        except Exception as e:  # noqa: BLE001
            res["email_error"] = str(getattr(e, "detail", e))[:160]
    phones = list({p for p in ([a.get("phone") for a in admins] + [company.get("phone")]) if p})
    if st.get("whatsapp_enabled") and phones:
        for p in phones:
            try:
                r = await _deps["wa_send"]({"company_id": st["sender_company_id"], "phone": p, "message": f"{title}\n\n{body}"})
                res["whatsapp"].append({"phone": p, "status": r.get("status") if isinstance(r, dict) else "sent"})
            except Exception as e:  # noqa: BLE001
                res["whatsapp"].append({"phone": p, "error": str(getattr(e, "detail", e))[:120]})
    return res


async def run_reminders() -> Dict[str, Any]:
    st = await settings()
    sent = []
    async for c in _db.companies.find({}):
        lic = await saas.effective(c["_id"])
        end = lic.get("trial_ends_at") if lic["status"] == "trial" else (lic.get("expires_at") or lic.get("trial_ends_at"))
        if lic["status"] in ("suspended", "cancelled") or not end:
            continue
        kind = None
        if lic["status"] == "expired":
            kind = "expired"
        elif lic["days_left"] in st["reminder_days"]:
            kind = f"d{lic['days_left']}"
        if not kind:
            continue
        key = f"{c['_id']}|{kind}|{end[:10]}"
        if await _db.license_reminders.find_one({"_id": key}):
            continue
        res = await _send_reminder(c, lic, kind, st)
        await _db.license_reminders.insert_one({"_id": key, "company_id": c["_id"], "company_name": c.get("name"), "kind": kind, "plan_name": lic["plan_name"], "period_end": end, "result": res, "created_at": _now()})
        sent.append({"company": c.get("name"), "kind": kind, **res})
    return {"sent": sent, "count": len(sent), "checked_at": _now()}


async def reminder_loop():
    await asyncio.sleep(30)
    while True:
        try:
            await run_reminders()
        except Exception as e:  # noqa: BLE001
            logger.warning(f"license reminders: {e}")
        await asyncio.sleep(3600)


@router.post("/system/reminders/run")
async def reminders_run(_: dict = Depends(saas.require_super_admin)):
    return await run_reminders()


@router.get("/system/reminders")
async def reminders_log(_: dict = Depends(saas.require_super_admin)):
    return [_clean(r) for r in await _db.license_reminders.find({}).sort("created_at", -1).to_list(200)]


# ---------------- Public: plans & signup ----------------
@router.get("/public/plans")
async def public_plans():
    st = await settings()
    plans = [_clean(p) for p in await _db.saas_plans.find({"is_public": True}).sort("sort", 1).to_list(20)]
    return {"plans": plans, "catalog": saas.catalog(), "trial_days": st["trial_days"], "brand_name": st["brand_name"], "currency": st.get("currency", "try"), "support_email": st.get("support_email"), "support_phone": st.get("support_phone")}


@router.post("/public/signup")
async def public_signup(req: Dict[str, Any], response: Response):
    email = (req.get("email") or "").strip().lower(); pwd = req.get("password") or ""; cname = (req.get("company_name") or "").strip(); name = (req.get("name") or "").strip()
    if not cname or not name or "@" not in email:
        raise HTTPException(status_code=400, detail="Şirket adı, ad soyad ve geçerli e-posta gerekli.")
    if len(pwd) < 6:
        raise HTTPException(status_code=400, detail="Şifre en az 6 karakter olmalı.")
    if await _db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Bu e-posta ile kayıtlı bir hesap zaten var. Giriş yapın.")
    st = await settings()
    if req.get("plan_id"):
        plan = await _db.saas_plans.find_one({"_id": req["plan_id"], "is_public": True})
        if not plan:
            raise HTTPException(status_code=400, detail="Seçilen paket bulunamadı.")
    else:
        plan = await _db.saas_plans.find_one({"_id": st["trial_plan_id"]})
    cid = f"comp_{uuid.uuid4().hex[:8]}"; uid = f"usr_{uuid.uuid4().hex[:8]}"
    await _db.companies.insert_one({"_id": cid, "name": cname, "tax_number": (req.get("tax_number") or "").strip(), "tax_office": "", "address": "", "city": (req.get("city") or "").strip(), "phone": (req.get("phone") or "").strip(), "email": email, "currency": "TRY", "source": "public_signup", "created_at": _now()})
    await _db.users.insert_one({"_id": uid, "email": email, "password_hash": hash_password(pwd), "name": name, "phone": (req.get("phone") or "").strip(), "role": "admin", "company_ids": [cid], "active_company_id": cid, "is_active": True, "preferences": {}, "created_at": _now()})
    await rbac.ensure_roles(cid)
    await saas.start_trial(cid, plan_id=plan["_id"] if plan else st["trial_plan_id"], days=st["trial_days"])
    response.set_cookie(key="access_token", value=create_access_token(uid, email, "admin"), httponly=True, max_age=86400 * 7, path="/")
    response.set_cookie(key="refresh_token", value=create_refresh_token(uid), httponly=True, max_age=86400 * 30, path="/")
    return {"status": "success", "company_id": cid, "user": {"id": uid, "email": email, "name": name, "role": "admin"}, "license": await saas.effective(cid), "message": f"Hoş geldiniz! {st['trial_days']} günlük {plan['name'] if plan else ''} denemeniz başladı."}
