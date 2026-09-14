"""Fiyat Merkezi (maliyet + hedef kâr → pazaryeri fiyatı) ve Sabah Özeti (günlük e-posta/WhatsApp raporu)."""
import asyncio
import logging
import math
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException

import comm_service

router = APIRouter(prefix="/api")
_db = None
_deps: Dict[str, Any] = {}
logger = logging.getLogger("TamKobiERP")
TR_TZ = timezone(timedelta(hours=3))

DEFAULT_RULE = {"margin_pct": 30.0, "margin_base": "cost", "include_cargo": True, "include_service_fee": True, "rounding": "0.90", "min_price": 0.0, "max_price": 0.0, "list_price_markup_pct": 0.0}


def init(db, deps: Dict[str, Any]):
    global _db
    _db = db
    _deps.update(deps)


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


@router.get("/pricing/rules")
async def get_rules(company_id: str = "comp_nexus_main_01"):
    docs = await _db.pricing_rules.find({"company_id": company_id}).to_list(50)
    return {d["channel"]: {**DEFAULT_RULE, **{k: v for k, v in d.items() if k in DEFAULT_RULE}} for d in docs}


@router.put("/pricing/rules/{channel}")
async def put_rule(channel: str, req: Dict[str, Any]):
    company_id = req.get("company_id", "comp_nexus_main_01")
    rule = {k: req.get(k, DEFAULT_RULE[k]) for k in DEFAULT_RULE}
    for k in ("margin_pct", "min_price", "max_price", "list_price_markup_pct"):
        rule[k] = float(rule[k] or 0)
    await _db.pricing_rules.update_one({"company_id": company_id, "channel": channel}, {"$set": {**rule, "updated_at": datetime.now(timezone.utc).isoformat()}, "$setOnInsert": {"_id": str(uuid.uuid4()), "company_id": company_id, "channel": channel}}, upsert=True)
    return {"status": "success", "channel": channel, "rule": rule}


@router.post("/pricing/compute")
async def compute_prices(req: Dict[str, Any]):
    """Kanal önbelleğindeki eşleşmiş pazaryeri ürünleri için önerilen fiyatları hesapla."""
    company_id = req.get("company_id", "comp_nexus_main_01"); channel = req.get("channel", "trendyol")
    rule = {**DEFAULT_RULE, **(req.get("rule") or {})} if req.get("rule") else (await get_rules(company_id)).get(channel, DEFAULT_RULE)
    cfg = await _db.integration_configs.find_one({"company_id": company_id, "channel": channel}) or {}
    fees = _deps["channel_fees"](cfg, channel)
    mp = await _deps["marketplace_products"](company_id=company_id, channel=channel, refresh=False)
    rows = []
    for r in mp["rows"]:
        if not r.get("product_id"):
            continue
        cost = float(r.get("purchase_price") or 0)
        if cost <= 0:
            rows.append({**{k: r.get(k) for k in ("barcode", "title", "product_name", "product_sku", "sale_price", "quantity", "image")}, "cost": 0, "suggested": None, "reason": "Alış fiyatı yok"}); continue
        s = suggest_price(cost, fees, rule)
        cur = float(r.get("sale_price") or 0)
        rows.append({**{k: r.get(k) for k in ("barcode", "title", "product_name", "product_sku", "sale_price", "quantity", "image")}, "cost": cost, "suggested": s["price"], "list_price": s["list_price"], "net_profit": s["net_profit"], "margin_pct": s["margin_pct"],
                     "diff": round(s["price"] - cur, 2), "diff_pct": round((s["price"] - cur) / cur * 100, 1) if cur else None, "current_net": round(cur * (1 - float(fees.get("commission_rate") or 0) / 100 * (1 + float(fees.get("commission_vat_rate") or 0) / 100)) - float(fees.get("service_fee") or 0) - float(fees.get("cargo_fee") or 0) - cost, 2)})
    rows.sort(key=lambda x: -(abs(x.get("diff") or 0)))
    return {"channel": channel, "rule": rule, "fees": fees, "push_supported": mp.get("push_supported", channel == "trendyol"), "rows": rows, "count": len(rows), "priced": sum(1 for x in rows if x.get("suggested")), "no_cost": sum(1 for x in rows if not x.get("suggested"))}


# ---------------- Sabah Özeti ----------------
DEFAULT_SUMMARY = {"enabled": False, "time": "08:00", "emails": [], "whatsapp_numbers": [], "include": {"orders": True, "low_stock": True, "shipments": True, "receivables": True}}


async def build_summary(company_id: str) -> Dict[str, Any]:
    now = datetime.now(TR_TZ); since = (now - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc).isoformat()
    orders = await _db.orders.find({"company_id": company_id, "$or": [{"created_at": {"$gte": since}}, {"order_date": {"$gte": since}}]}).to_list(2000)
    by_ch: Dict[str, Dict[str, float]] = {}
    for o in orders:
        c = by_ch.setdefault(o.get("channel") or "manual", {"count": 0, "total": 0.0})
        c["count"] += 1; c["total"] += float(o.get("total_amount") or 0)
    pending_ship = await _db.orders.count_documents({"company_id": company_id, "order_status": {"$in": ["approved", "preparing"]}, "$or": [{"cargo_tracking_number": None}, {"cargo_tracking_number": ""}, {"cargo_tracking_number": {"$exists": False}}]})
    low = [p async for p in _db.products.find({"company_id": company_id, "track_stock": {"$ne": False}, "$expr": {"$lte": ["$stock_quantity", {"$ifNull": ["$min_stock_alert", 5]}]}}, {"name": 1, "sku": 1, "stock_quantity": 1, "min_stock_alert": 1}).limit(15)]
    low_count = await _db.products.count_documents({"company_id": company_id, "track_stock": {"$ne": False}, "$expr": {"$lte": ["$stock_quantity", {"$ifNull": ["$min_stock_alert", 5]}]}})
    today = now.strftime("%Y-%m-%d")
    overdue = await _db.invoices.find({"company_id": company_id, "invoice_type": "sales", "payment_status": {"$in": ["unpaid", "partially_paid"]}, "due_date": {"$lt": today}, "status": {"$ne": "cancelled"}}, {"grand_total": 1, "paid_amount": 1, "contact_name": 1}).to_list(500)
    overdue_total = sum(float(i.get("grand_total") or 0) - float(i.get("paid_amount") or 0) for i in overdue)
    claims = await _db.marketplace_claims.count_documents({"company_id": company_id, "status": {"$nin": ["resolved", "closed", "Accepted", "Rejected"]}}) if "marketplace_claims" in await _db.list_collection_names() else 0
    return {"date": now.strftime("%d.%m.%Y"), "orders_total": len(orders), "orders_amount": round(sum(c["total"] for c in by_ch.values()), 2), "orders_by_channel": by_ch, "pending_shipments": pending_ship, "low_stock_count": low_count,
            "low_stock": [{"name": p["name"], "sku": p.get("sku"), "qty": p.get("stock_quantity"), "min": p.get("min_stock_alert")} for p in low], "overdue_count": len(overdue), "overdue_total": round(overdue_total, 2), "open_claims": claims}


def render_text(s: Dict[str, Any], company_name: str) -> str:
    lines = [f"☀️ {company_name} — Sabah Özeti {s['date']}", "", f"🛒 Yeni siparişler (son 24s+): {s['orders_total']} adet · {s['orders_amount']:,.2f} ₺"]
    for ch, c in sorted(s["orders_by_channel"].items(), key=lambda x: -x[1]["total"]):
        lines.append(f"   • {ch}: {c['count']} sipariş · {c['total']:,.2f} ₺")
    lines += [f"📦 Kargo bekleyen sipariş: {s['pending_shipments']}", f"⚠️ Kritik stok: {s['low_stock_count']} ürün"]
    for p in s["low_stock"][:8]:
        lines.append(f"   • {p['name']} ({p.get('sku') or '-'}): {p['qty']} / min {p.get('min')}")
    lines += [f"💸 Vadesi geçen alacak: {s['overdue_count']} fatura · {s['overdue_total']:,.2f} ₺"]
    if s.get("open_claims"):
        lines.append(f"↩️ Açık iade/talep: {s['open_claims']}")
    return "\n".join(lines)


@router.get("/reports/morning-summary/settings")
async def get_summary_settings(company_id: str = "comp_nexus_main_01"):
    d = await _db.morning_summary_settings.find_one({"company_id": company_id}) or {}
    return {**DEFAULT_SUMMARY, **{k: d[k] for k in DEFAULT_SUMMARY if k in d}, "last_sent": d.get("last_sent"), "last_result": d.get("last_result")}


@router.put("/reports/morning-summary/settings")
async def put_summary_settings(req: Dict[str, Any]):
    company_id = req.get("company_id", "comp_nexus_main_01")
    upd = {k: req.get(k, DEFAULT_SUMMARY[k]) for k in DEFAULT_SUMMARY}
    upd["emails"] = [e.strip().lower() for e in (upd["emails"] or []) if e and "@" in e]
    upd["whatsapp_numbers"] = [n for n in (comm_service.normalize_phone(x) for x in (upd["whatsapp_numbers"] or [])) if n]
    await _db.morning_summary_settings.update_one({"company_id": company_id}, {"$set": upd, "$setOnInsert": {"_id": str(uuid.uuid4()), "company_id": company_id}}, upsert=True)
    return await get_summary_settings(company_id)


@router.get("/reports/morning-summary/preview")
async def preview_summary(company_id: str = "comp_nexus_main_01"):
    s = await build_summary(company_id)
    comp = await _db.companies.find_one({"_id": company_id}) or {}
    return {"summary": s, "text": render_text(s, comp.get("name") or "TamKobi")}


async def send_summary(company_id: str, manual: bool = False) -> Dict[str, Any]:
    st = await get_summary_settings(company_id)
    s = await build_summary(company_id)
    comp = await _db.companies.find_one({"_id": company_id}) or {}
    text = render_text(s, comp.get("name") or "TamKobi")
    result: Dict[str, Any] = {"at": datetime.now(timezone.utc).isoformat(), "email": None, "whatsapp": None}
    if st["emails"]:
        try:
            acc = await _deps["mail_account"](company_id)
            html = "<pre style='font-family:Arial,sans-serif;font-size:14px;white-space:pre-wrap'>" + text.replace("<", "&lt;") + "</pre>"
            await comm_service.smtp_send(acc, st["emails"], f"Sabah Özeti {s['date']} — {comp.get('name') or 'TamKobi'}", text, html)
            result["email"] = {"ok": True, "to": st["emails"]}
        except HTTPException as e:
            result["email"] = {"ok": False, "error": e.detail}
        except Exception as e:  # noqa: BLE001
            result["email"] = {"ok": False, "error": str(e)[:160]}
    if st["whatsapp_numbers"]:
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
    if not st["emails"] and not st["whatsapp_numbers"]:
        result["error"] = "Alıcı tanımlı değil (e-posta veya WhatsApp numarası ekleyin)."
    await _db.morning_summary_settings.update_one({"company_id": company_id}, {"$set": {"last_sent": result["at"], "last_result": result, "last_sent_day": datetime.now(TR_TZ).strftime("%Y-%m-%d")}}, upsert=True)
    await _db.morning_summary_logs.insert_one({"_id": str(uuid.uuid4()), "company_id": company_id, "manual": manual, "text": text, **result})
    return {"status": "success" if not result.get("error") else "error", "message": result.get("error") or "Sabah özeti gönderildi.", "result": result, "text": text}


@router.post("/reports/morning-summary/send")
async def send_summary_now(req: Dict[str, Any]):
    return await send_summary(req.get("company_id", "comp_nexus_main_01"), manual=True)


async def scheduler_loop():
    """Her dakika: etkin şirketlerde saat geldiyse ve bugün gönderilmediyse özeti gönder."""
    await asyncio.sleep(20)
    while True:
        try:
            now = datetime.now(TR_TZ)
            async for st in _db.morning_summary_settings.find({"enabled": True}):
                if st.get("time", "08:00") <= now.strftime("%H:%M") and st.get("last_sent_day") != now.strftime("%Y-%m-%d"):
                    await send_summary(st["company_id"])
        except Exception as e:  # noqa: BLE001
            logger.warning(f"morning summary scheduler: {e}")
        await asyncio.sleep(60)
