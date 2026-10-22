"""Fiyat Merkezi (maliyet + hedef kâr → pazaryeri fiyatı) ve Sabah Özeti (günlük e-posta/WhatsApp raporu)."""
import asyncio
import logging
import math
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

import comm_service
import morning_summary_email
import stock_critical
import tenant_access

router = APIRouter(prefix="/api")
_db = None
_current_user = None
_deps: Dict[str, Any] = {}
logger = logging.getLogger("TamKobiERP")
TR_TZ = timezone(timedelta(hours=3))
_REAL_DATETIME = datetime
EMAIL_QUEUE_RETRY_LIMIT = 10

DEFAULT_RULE = {"margin_pct": 30.0, "margin_base": "cost", "include_cargo": True, "include_service_fee": True, "rounding": "0.90", "min_price": 0.0, "max_price": 0.0, "list_price_markup_pct": 0.0}


def init(db, deps: Dict[str, Any], current_user_dep=None):
    global _db, _current_user
    _db = db
    _deps.update(deps)
    if current_user_dep is not None:
        _current_user = current_user_dep


async def _user_dep(request: Request) -> dict:
    if _current_user is None:
        raise HTTPException(status_code=500, detail="Fiyat kuralları kimliği bağlanmadı.")
    return await _current_user(request)


def _round_price(p: float, mode: str) -> float:
    if p <= 0:
        return 0.0
    if mode in ("0.90", "0.99"):
        end = 0.9 if mode == "0.90" else 0.99
        base = math.floor(p)
        return round(base + end if p - base <= end + 1e-9 else base + 1 + end, 2)
    if mode == "1":
        return float(math.ceil(p))
    if mode == "5":
        return float(math.ceil(p / 5) * 5)
    if mode == "10":
        return float(math.ceil(p / 10) * 10)
    return round(p, 2)


def suggest_price(cost: float, fees: dict, rule: dict) -> Dict[str, float]:
    """price = (cost·(1+m) + sabit bedeller) / (1 − komisyon·(1+komisyonKDV))  → net kâr = cost·m"""
    comm = float(fees.get("commission_rate") or 0) / 100 * (1 + float(fees.get("commission_vat_rate") or 0) / 100)
    fixed = (float(fees.get("service_fee") or 0) if rule.get("include_service_fee", True) else 0) + (float(fees.get("cargo_fee") or 0) if rule.get("include_cargo", True) else 0)
    m = float(rule.get("margin_pct") or 0) / 100
    raw = (cost * (1 + m) + fixed) / max(0.05, 1 - comm) if rule.get("margin_base", "cost") == "cost" else (cost + fixed) / max(0.05, 1 - comm - m)
    price = _round_price(raw, rule.get("rounding") or "0.90")
    if rule.get("min_price"):
        price = max(price, float(rule["min_price"]))
    if rule.get("max_price"):
        price = min(price, float(rule["max_price"]))
    net = price * (1 - comm) - fixed - cost
    return {"raw": round(raw, 2), "price": round(price, 2), "net_profit": round(net, 2), "margin_pct": round(net / cost * 100, 1) if cost else 0.0, "list_price": round(price * (1 + float(rule.get("list_price_markup_pct") or 0) / 100), 2)}


async def _rules_payload(company_id: str):
    docs = await _db.pricing_rules.find({"company_id": company_id}).to_list(50)
    return {d["channel"]: {**DEFAULT_RULE, **{k: v for k, v in d.items() if k in DEFAULT_RULE}} for d in docs}


@router.get("/pricing/rules")
async def get_rules(company_id: Optional[str] = None, user: dict = Depends(_user_dep)):
    cid = tenant_access.resolve_company_id(user, company_id)
    return await _rules_payload(cid)


@router.put("/pricing/rules/{channel}")
async def put_rule(channel: str, req: Dict[str, Any], user: dict = Depends(_user_dep)):
    company_id = tenant_access.resolve_company_id(user, req.get("company_id"))
    rule = {k: req.get(k, DEFAULT_RULE[k]) for k in DEFAULT_RULE}
    for k in ("margin_pct", "min_price", "max_price", "list_price_markup_pct"):
        rule[k] = float(rule[k] or 0)
    await _db.pricing_rules.update_one({"company_id": company_id, "channel": channel}, {"$set": {**rule, "updated_at": datetime.now(timezone.utc).isoformat()}, "$setOnInsert": {"_id": str(uuid.uuid4()), "company_id": company_id, "channel": channel}}, upsert=True)
    return {"status": "success", "channel": channel, "rule": rule}


@router.post("/pricing/compute")
async def compute_prices(req: Dict[str, Any], user: Any = Depends(_user_dep)):
    """Kanal önbelleğindeki eşleşmiş pazaryeri ürünleri için önerilen fiyatları hesapla."""
    if isinstance(user, dict):
        company_id = tenant_access.resolve_company_id(user, req.get("company_id"))
    else:
        company_id = str(req.get("company_id") or "").strip()
        if not company_id:
            raise HTTPException(status_code=400, detail="Şirket seçilmedi.")
    channel = req.get("channel", "trendyol")
    rule = {**DEFAULT_RULE, **(req.get("rule") or {})} if req.get("rule") else (await _rules_payload(company_id)).get(channel, DEFAULT_RULE)
    cfg = await _db.integration_configs.find_one({"company_id": company_id, "channel": channel}) or {}
    fees = _deps["channel_fees"](cfg, channel)
    mp = await _deps["marketplace_products"](cid=company_id, channel=channel, refresh=False)
    rows = []
    commission_rate = float(fees.get("commission_rate") or 0)
    commission_vat_rate = float(fees.get("commission_vat_rate") or 0)
    eff_comm = commission_rate / 100 * (1 + commission_vat_rate / 100)
    fixed_fees = float(fees.get("service_fee") or 0) + float(fees.get("cargo_fee") or 0)
    for r in mp["rows"]:
        if not r.get("product_id"):
            continue
        cost = float(r.get("purchase_price") or 0)
        cur = float(r.get("sale_price") or 0)
        local_price = r.get("local_price")
        local_price = float(local_price) if local_price not in (None, "") else None
        base = {
            k: r.get(k) for k in ("barcode", "title", "product_name", "product_sku", "sale_price", "quantity", "image")
        }
        base.update({
            "marketplace_price": cur,
            "local_price": local_price,
            "commission_rate": commission_rate,
            "commission_vat_rate": commission_vat_rate,
            "effective_commission_rate": round(commission_rate * (1 + commission_vat_rate / 100), 2),
        })
        if cost <= 0:
            rows.append({**base, "cost": 0, "suggested": None, "reason": "Alış fiyatı yok", "current_net": None})
            continue
        s = suggest_price(cost, fees, rule)
        rows.append({
            **base,
            "cost": cost,
            "suggested": s["price"],
            "list_price": s["list_price"],
            "net_profit": s["net_profit"],
            "margin_pct": s["margin_pct"],
            "diff": round(s["price"] - cur, 2),
            "diff_pct": round((s["price"] - cur) / cur * 100, 1) if cur else None,
            "current_net": round(cur * (1 - eff_comm) - fixed_fees - cost, 2),
        })
    rows.sort(key=lambda x: -(abs(x.get("diff") or 0)))
    return {
        "channel": channel,
        "rule": rule,
        "fees": fees,
        "push_supported": mp.get("push_supported", channel == "trendyol"),
        "rows": rows,
        "count": len(rows),
        "priced": sum(1 for x in rows if x.get("suggested")),
        "no_cost": sum(1 for x in rows if not x.get("suggested")),
    }


# ---------------- Sabah Özeti ----------------
DEFAULT_SUMMARY = {"enabled": False, "time": "08:00", "emails": [], "whatsapp_numbers": [], "include": {"orders": True, "low_stock": True, "shipments": True, "receivables": True}}


async def build_summary(company_id: str, source=None) -> Dict[str, Any]:
    db = source or _db
    now = datetime.now(TR_TZ); since = (now - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).isoformat()
    orders = await db.orders.find({"company_id": company_id, "$or": [{"created_at": {"$gte": since}}, {"order_date": {"$gte": since}}]}).to_list(2000)
    by_ch: Dict[str, Dict[str, float]] = {}
    for o in orders:
        c = by_ch.setdefault(o.get("channel") or "manual", {"count": 0, "total": 0.0})
        c["count"] += 1; c["total"] += float(o.get("total_amount") or 0)
    pending_ship = await db.orders.count_documents({"company_id": company_id, "order_status": {"$in": ["approved", "preparing"]}, "$or": [{"cargo_tracking_number": None}, {"cargo_tracking_number": ""}, {"cargo_tracking_number": {"$exists": False}}]})
    low_query = stock_critical.critical_stock_query(company_id)
    low_fields = {"name": 1, "sku": 1, "stock_quantity": 1, "min_stock_alert": 1}
    low_docs = [p async for p in db.products.find(low_query, low_fields).limit(morning_summary_email.LOW_STOCK_FETCH)]
    low_docs.sort(key=morning_summary_email.stock_sort_key)
    low = low_docs[:morning_summary_email.LOW_STOCK_KEEP]
    low_count = await db.products.count_documents(low_query)
    today = now.strftime("%Y-%m-%d")
    overdue = await db.invoices.find({"company_id": company_id, "invoice_type": "sales", "payment_status": {"$in": ["unpaid", "partially_paid"]}, "due_date": {"$lt": today}, "status": {"$ne": "cancelled"}}, {"grand_total": 1, "paid_amount": 1, "contact_name": 1}).to_list(500)
    overdue_total = sum(float(i.get("grand_total") or 0) - float(i.get("paid_amount") or 0) for i in overdue)
    claims = await db.marketplace_claims.count_documents({"company_id": company_id, "status": {"$nin": ["resolved", "closed", "Accepted", "Rejected"]}}) if "marketplace_claims" in await db.list_collection_names() else 0
    return {"date": now.strftime("%d.%m.%Y"), "orders_total": len(orders), "orders_amount": round(sum(c["total"] for c in by_ch.values()), 2), "orders_by_channel": by_ch, "pending_shipments": pending_ship, "low_stock_count": low_count,
            "low_stock": [{"name": p["name"], "sku": p.get("sku"), "qty": p.get("stock_quantity"), "min": p.get("min_stock_alert")} for p in low], "overdue_count": len(overdue), "overdue_total": round(overdue_total, 2), "open_claims": claims}


def render_text(s: Dict[str, Any], company_name: str) -> str:
    fmt_int = morning_summary_email.fmt_int
    fmt_try = morning_summary_email.fmt_try
    fmt_min = morning_summary_email.fmt_min
    lines = [f"☀️ {company_name} — Sabah Özeti {s['date']}", "", f"🛒 Yeni siparişler (son 24s+): {fmt_int(s['orders_total'])} adet · {fmt_try(s['orders_amount'])}"]
    for ch, c in sorted(s["orders_by_channel"].items(), key=lambda x: -x[1]["total"]):
        lines.append(f"   • {ch}: {fmt_int(c['count'])} sipariş · {fmt_try(c['total'])}")
    lines += [f"📦 Kargo bekleyen sipariş: {fmt_int(s['pending_shipments'])}", f"⚠️ Kritik stok: {fmt_int(s['low_stock_count'])} ürün"]
    for p in s["low_stock"][:8]:
        lines.append(f"   • {p['name']} ({p.get('sku') or '-'}): {fmt_int(p.get('qty'))} / min {fmt_min(p.get('min'))}")
    lines += [f"💸 Vadesi geçen alacak: {fmt_int(s['overdue_count'])} fatura · {fmt_try(s['overdue_total'])}"]
    if s.get("open_claims"):
        lines.append(f"↩️ Açık iade/talep: {fmt_int(s['open_claims'])}")
    return "\n".join(lines)


async def summary_settings_payload(company_id: str, source=None):
    db = source or _db
    d = await db.morning_summary_settings.find_one({"company_id": company_id}) or {}
    return {**DEFAULT_SUMMARY, **{k: d[k] for k in DEFAULT_SUMMARY if k in d}, "last_sent": d.get("last_sent"), "last_result": d.get("last_result")}


async def summary_preview_payload(company_id: str):
    s = await build_summary(company_id)
    comp = await _db.companies.find_one({"_id": company_id}) or {}
    return {"summary": s, "text": render_text(s, comp.get("name") or "TamKobi")}


@router.get("/reports/morning-summary/settings")
async def get_summary_settings(company_id: Optional[str] = None, user: dict = Depends(_user_dep)):
    cid = tenant_access.resolve_company_id(user, company_id)
    return await summary_settings_payload(cid)


@router.put("/reports/morning-summary/settings")
async def put_summary_settings(req: Dict[str, Any], user: dict = Depends(_user_dep)):
    cid = tenant_access.resolve_company_id(user, req.get("company_id"))
    upd = {k: req.get(k, DEFAULT_SUMMARY[k]) for k in DEFAULT_SUMMARY}
    upd["emails"] = [e.strip().lower() for e in (upd["emails"] or []) if e and "@" in e]
    upd["whatsapp_numbers"] = [n for n in (comm_service.normalize_phone(x) for x in (upd["whatsapp_numbers"] or [])) if n]
    await _db.morning_summary_settings.update_one({"company_id": cid}, {"$set": upd, "$setOnInsert": {"_id": str(uuid.uuid4()), "company_id": cid}}, upsert=True)
    return await summary_settings_payload(cid)


@router.get("/reports/morning-summary/preview")
async def preview_summary(company_id: Optional[str] = None, user: dict = Depends(_user_dep)):
    cid = tenant_access.resolve_company_id(user, company_id)
    return await summary_preview_payload(cid)


def _scheduled_email_retries(stored: dict, today: str) -> int:
    """Bugünkü başarısız zamanlanmış e-posta denemesi. Gün değişince sıfırlanır."""
    last = stored.get("last_sent") if isinstance(stored, dict) else None
    if not last:
        return 0
    try:
        ts = _REAL_DATETIME.fromisoformat(str(last).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return 0
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    if ts.astimezone(TR_TZ).strftime("%Y-%m-%d") != today:
        return 0
    try:
        return max(0, int(stored.get("email_retry_count") or 0))
    except (TypeError, ValueError):
        return 0


async def send_summary(company_id: str, manual: bool = False, source=None) -> Dict[str, Any]:
    db = source or _db
    st = await summary_settings_payload(company_id, source=db)
    stored = await db.morning_summary_settings.find_one({"company_id": company_id}) or {}
    today = datetime.now(TR_TZ).strftime("%Y-%m-%d")
    prior_retries = 0 if manual else _scheduled_email_retries(stored, today)
    if not manual and prior_retries >= EMAIL_QUEUE_RETRY_LIMIT:
        return {
            "status": "success",
            "message": "Sabah özeti gönderildi.",
            "result": {
                "at": datetime.now(timezone.utc).isoformat(),
                "email": {"ok": False, "error": "Sabah özeti kuyruğa yazılamadı."},
                "whatsapp": {"skipped": "already_sent_today"},
            },
            "text": "",
        }
    s = await build_summary(company_id, source=db)
    comp = await _db.companies.find_one({"_id": company_id}) or {}
    text = render_text(s, comp.get("name") or "TamKobi")
    result: Dict[str, Any] = {"at": datetime.now(timezone.utc).isoformat(), "email": None, "whatsapp": None}
    queue_failed = False
    outcome = None
    if st["emails"]:
        try:
            import event_notify
            name = comp.get("name") or "TamKobi"
            stock_link = await event_notify.app_link("/stock")
            logo = ""
            raw_logo = str(comp.get("logo_url") or "").strip()
            if raw_logo:
                logo = await event_notify._company_logo_abs(raw_logo)
            html_body = morning_summary_email.render_summary_html(s, name, stock_link, logo_url_abs=logo)
            email_text = morning_summary_email.render_summary_text(s, name, stock_link)
            outcome = await event_notify.enqueue_morning_summary_email(
                company_id,
                emails=st["emails"],
                subject=f"Sabah Özeti {s['date']} — {name}",
                html=html_body,
                text=email_text,
                day=datetime.now(TR_TZ).strftime("%Y-%m-%d"),
                manual=manual,
            )
            if outcome == "disabled":
                result["email"] = {
                    "ok": False,
                    "disabled": True,
                    "error": "Sabah özeti e-postası yönetim panelinde (ynt) kapalı.",
                }
            elif outcome in ("queued", "exists"):
                result["email"] = {"ok": True, "queued": True, "to": list(st["emails"])}
            else:
                outcome = "failed"
                queue_failed = not manual
                raise RuntimeError("Sabah özeti kuyruğa yazılamadı.")
        except HTTPException as e:
            if getattr(e, "status_code", None) == 409:
                logger.warning("mail needs_reauth company=%s context=morning_summary: %s", company_id, e.detail)
            result["email"] = {"ok": False, "error": e.detail}
        except Exception as e:  # noqa: BLE001
            result["email"] = {"ok": False, "error": str(e)[:160]}
    sent_whatsapp = False
    if st["whatsapp_numbers"]:
        if not manual and str(stored.get("whatsapp_sent_day") or "") == today:
            result["whatsapp"] = {"skipped": "already_sent_today"}
        else:
            wa = []
            for n in st["whatsapp_numbers"]:
                try:
                    r = await _deps["wa_send"]({"company_id": company_id, "to": n, "message": text})
                    wa.append({"to": n, "ok": True, "simulated": r.get("simulated") if isinstance(r, dict) else None})
                except HTTPException as e:
                    wa.append({"to": n, "ok": False, "error": e.detail})
                except Exception as e:  # noqa: BLE001
                    wa.append({"to": n, "ok": False, "error": str(e)[:160]})
            result["whatsapp"] = wa
            sent_whatsapp = not manual
    if not st["emails"] and not st["whatsapp_numbers"]:
        result["error"] = "Alıcı tanımlı değil (e-posta veya WhatsApp numarası ekleyin)."
    sent_fields = {"last_sent": result["at"], "last_result": result}
    if sent_whatsapp:
        sent_fields["whatsapp_sent_day"] = today
    if outcome in ("queued", "exists", "disabled"):
        sent_fields["email_retry_count"] = 0
    if queue_failed:
        retry_count = prior_retries + 1
        sent_fields["email_retry_count"] = retry_count
        if retry_count >= EMAIL_QUEUE_RETRY_LIMIT:
            sent_fields["last_sent_day"] = today
            logger.warning(
                "Sabah özeti e-postası kuyruğa yazılamadı company=%s day=%s deneme=%s",
                company_id,
                today,
                retry_count,
            )
    else:
        sent_fields["last_sent_day"] = today
    await db.morning_summary_settings.update_one({"company_id": company_id}, {"$set": sent_fields}, upsert=True)
    day_closed = (not queue_failed) or sent_fields.get("email_retry_count", 0) >= EMAIL_QUEUE_RETRY_LIMIT
    if manual or prior_retries == 0 or day_closed:
        await db.morning_summary_logs.insert_one({"_id": str(uuid.uuid4()), "company_id": company_id, "manual": manual, "text": text, **result})
    return {"status": "success" if not result.get("error") else "error", "message": result.get("error") or "Sabah özeti gönderildi.", "result": result, "text": text}


@router.post("/reports/morning-summary/send")
async def send_summary_now(req: Dict[str, Any], user: dict = Depends(_user_dep)):
    cid = tenant_access.resolve_company_id(user, req.get("company_id"))
    return await send_summary(cid, manual=True)


async def _morning_routed() -> None:
    """Bayrak açık: sabah özeti ayarı her şirketin kendi deposunda."""
    import storage_router

    now = datetime.now(TR_TZ)
    async for cid, store in storage_router.iter_company_stores(_db):
        try:
            st = await store.morning_summary_settings.find_one({"company_id": cid, "enabled": True})
            if not st:
                continue
            if st.get("time", "08:00") <= now.strftime("%H:%M") and st.get("last_sent_day") != now.strftime("%Y-%m-%d"):
                await send_summary(cid, source=store)
        except Exception as exc:
            storage_router.log_store_failure(cid, exc)


async def scheduler_loop():
    """Her dakika: etkin şirketlerde saat geldiyse ve bugün gönderilmediyse özeti gönder."""
    import storage_router

    await asyncio.sleep(20)
    while True:
        try:
            if storage_router.enabled():
                await _morning_routed()
            else:
                now = datetime.now(TR_TZ)
                async for st in _db.morning_summary_settings.find({"enabled": True}):
                    if st.get("time", "08:00") <= now.strftime("%H:%M") and st.get("last_sent_day") != now.strftime("%Y-%m-%d"):
                        await send_summary(st["company_id"])
        except Exception as e:  # noqa: BLE001
            logger.warning(f"morning summary scheduler: {e}")
        await asyncio.sleep(60)
