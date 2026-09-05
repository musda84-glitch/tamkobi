"""Abonelik e-Arşiv fatura PDF'i (reportlab) ve tek tıkla yenileme linki."""
import io
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional

import jwt
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

import saas
import saas_billing
from auth_utils import get_jwt_secret, JWT_ALGORITHM

router = APIRouter(prefix="/api")
_db = None
FONT_DIR = "/usr/share/fonts/truetype/liberation/"
pdfmetrics.registerFont(TTFont("Lib", FONT_DIR + "LiberationSans-Regular.ttf"))
pdfmetrics.registerFont(TTFont("LibB", FONT_DIR + "LiberationSans-Bold.ttf"))


def init(db):
    global _db
    _db = db


def _tl(n: float) -> str:
    return f"{n:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".") + " ₺"


def build_invoice_pdf(inv: Dict[str, Any], seller: Dict[str, Any], buyer: Dict[str, Any]) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    w, h = A4
    c.setFillColor(colors.HexColor("#0f172a")); c.rect(0, h - 38 * mm, w, 38 * mm, fill=1, stroke=0)
    c.setFillColor(colors.white); c.setFont("LibB", 20); c.drawString(18 * mm, h - 18 * mm, "e-ARŞİV FATURA")
    c.setFont("Lib", 9); c.drawString(18 * mm, h - 25 * mm, f"Fatura No: {inv['invoice_number']}    Tarih: {inv['issue_date']}    Senaryo: e-Arşiv / Satış")
    c.drawString(18 * mm, h - 30 * mm, f"ETTN / Takip: {inv.get('gib_tracking_id', '')}")
    c.setFillColor(colors.HexColor("#fbbf24")); c.setFont("LibB", 10); c.drawRightString(w - 18 * mm, h - 18 * mm, seller.get("name", ""))
    c.setFillColor(colors.white); c.setFont("Lib", 8)
    for i, line in enumerate([f"VKN: {seller.get('tax_number', '')}  {seller.get('tax_office', '')}", (seller.get("address") or "")[:80], f"{seller.get('city', '')}  {seller.get('phone', '')}  {seller.get('email', '')}"]):
        c.drawRightString(w - 18 * mm, h - (23 + i * 4) * mm, line)
    y = h - 52 * mm
    c.setFillColor(colors.HexColor("#0f172a")); c.setFont("LibB", 9); c.drawString(18 * mm, y, "ALICI")
    c.setFont("Lib", 9)
    for i, line in enumerate([buyer.get("name", ""), f"VKN/TCKN: {buyer.get('tax_number_or_id') or '-'}", f"{buyer.get('city') or ''}  {buyer.get('email') or ''}", buyer.get("phone") or ""]):
        c.drawString(18 * mm, y - (5 + i * 4.5) * mm, str(line))
    y -= 32 * mm
    c.setFillColor(colors.HexColor("#f1f5f9")); c.rect(18 * mm, y - 2 * mm, w - 36 * mm, 8 * mm, fill=1, stroke=0)
    c.setFillColor(colors.HexColor("#334155")); c.setFont("LibB", 8)
    cols = [(20 * mm, "Açıklama"), (118 * mm, "Miktar"), (138 * mm, "Birim Fiyat"), (160 * mm, "KDV"), (w - 20 * mm, "Tutar")]
    for x, t in cols:
        (c.drawRightString if t == "Tutar" else c.drawString)(x, y, t)
    y -= 8 * mm; c.setFont("Lib", 9); c.setFillColor(colors.black)
    for it in inv["items"]:
        c.drawString(20 * mm, y, str(it["name"])[:70]); c.drawString(118 * mm, y, f"{it['quantity']} {it.get('unit', '')}"); c.drawString(138 * mm, y, _tl(it["unit_price"])); c.drawString(160 * mm, y, f"%{it['vat_rate']}"); c.drawRightString(w - 20 * mm, y, _tl(it["total"]))
        y -= 7 * mm
    y -= 4 * mm; c.setStrokeColor(colors.HexColor("#e2e8f0")); c.line(120 * mm, y + 3 * mm, w - 18 * mm, y + 3 * mm)
    for label, val, bold in [("Ara Toplam", inv["subtotal"], False), ("Hesaplanan KDV (%20)", inv["vat_total"], False), ("Genel Toplam", inv["grand_total"], True), ("Ödenen", inv.get("paid_amount", inv["grand_total"]), False)]:
        c.setFont("LibB" if bold else "Lib", 10 if bold else 9); c.drawString(120 * mm, y, label); c.drawRightString(w - 20 * mm, y, _tl(val)); y -= 6 * mm
    c.setFont("Lib", 8); c.setFillColor(colors.HexColor("#64748b"))
    c.drawString(18 * mm, 30 * mm, "Bu fatura online abonelik ödemesi karşılığında elektronik ortamda düzenlenmiştir; ödeme alınmıştır.")
    c.drawString(18 * mm, 25 * mm, (inv.get("notes") or "")[:120])
    c.drawString(18 * mm, 18 * mm, "e-Arşiv Fatura – GİB e-Arşiv uygulaması kapsamında oluşturulmuştur. İrsaliye yerine geçmez.")
    c.showPage(); c.save()
    return buf.getvalue()


@router.get("/invoices/{invoice_id}/pdf")
async def invoice_pdf(invoice_id: str):
    inv = await _db.invoices.find_one({"_id": invoice_id})
    if not inv:
        raise HTTPException(status_code=404, detail="Fatura bulunamadı.")
    seller = await _db.companies.find_one({"_id": inv["company_id"]}) or {}
    buyer = await _db.contacts.find_one({"_id": inv.get("contact_id")}) or {"name": inv.get("contact_name")}
    return Response(build_invoice_pdf(inv, seller, buyer), media_type="application/pdf", headers={"Content-Disposition": f'inline; filename="{inv["invoice_number"]}.pdf"'})


# ---------------- Yenileme linki ----------------
def make_renew_token(company_id: str, plan_id: Optional[str], days: int = 30) -> str:
    return jwt.encode({"cid": company_id, "pid": plan_id, "type": "renew", "exp": datetime.now(timezone.utc) + timedelta(days=days)}, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def _decode(token: str) -> Dict[str, Any]:
    try:
        p = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=400, detail="Yenileme bağlantısının süresi dolmuş. Uygulamaya giriş yapıp Paketim & Modüller'den yenileyebilirsiniz.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=400, detail="Geçersiz yenileme bağlantısı.")
    if p.get("type") != "renew":
        raise HTTPException(status_code=400, detail="Geçersiz yenileme bağlantısı.")
    return p


@router.get("/public/renew/{token}")
async def renew_info(token: str):
    p = _decode(token)
    company = await _db.companies.find_one({"_id": p["cid"]})
    if not company:
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    lic = await saas.effective(p["cid"])
    plan = await _db.saas_plans.find_one({"_id": p.get("pid") or lic.get("plan_id")}) or await _db.saas_plans.find_one({"_id": "plan_standard"})
    plans = [saas._clean(x) for x in await _db.saas_plans.find({"is_public": True}).sort("sort", 1).to_list(20)]
    providers = {"stripe": True, "paytr": False}
    try:
        import saas_extras
        providers = await saas_extras.payment_providers()
    except Exception:  # noqa: BLE001
        pass
    return {"company": {"id": company["_id"], "name": company.get("name")}, "license": lic, "plan": saas._clean(plan) if plan else None, "plans": plans, "providers": providers, "catalog": saas.catalog()}


@router.post("/public/renew/{token}/checkout")
async def renew_checkout(token: str, req: Dict[str, Any], request: Request):
    p = _decode(token)
    body = {"company_id": p["cid"], "plan_id": req.get("plan_id") or p.get("pid"), "period": req.get("period", "monthly"), "origin_url": req.get("origin_url")}
    if req.get("provider") == "paytr":
        import saas_extras
        return await saas_extras.paytr_session(body, request)
    return await saas_billing.create_checkout(body, request)
