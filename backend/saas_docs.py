"""Abonelik e-Arşiv fatura PDF'i (reportlab) ve tek tıkla yenileme linki."""
import io
import re
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional

import jwt
from fastapi import APIRouter, HTTPException, Query, Request
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
try:
    pdfmetrics.registerFont(TTFont("Lib", FONT_DIR + "LiberationSans-Regular.ttf"))
    pdfmetrics.registerFont(TTFont("LibB", FONT_DIR + "LiberationSans-Bold.ttf"))
    PDF_FONT, PDF_FONT_B = "Lib", "LibB"
except Exception:
    PDF_FONT, PDF_FONT_B = "Helvetica", "Helvetica-Bold"


def init(db):
    global _db
    _db = db


def _tl(n: float) -> str:
    return f"{n:,.2f}".replace(",", "X").replace(".", ",").replace("X", ".") + " ₺"


_PDF_TITLES = {"e_invoice": "e-FATURA", "e_archive": "e-ARŞİV FATURA", "paper": "FATURA", "e_dispatch": "e-İRSALİYE"}
_PDF_SCENARIO = {"e_invoice": "e-Fatura / Satış", "e_archive": "e-Arşiv / Satış", "paper": "Kağıt / Satış", "e_dispatch": "e-İrsaliye"}
_PDF_FOOTER = {
    "e_invoice": "e-Fatura – GİB e-Fatura uygulaması kapsamında oluşturulmuştur. İrsaliye yerine geçmez.",
    "e_archive": "e-Arşiv Fatura – GİB e-Arşiv uygulaması kapsamında oluşturulmuştur. İrsaliye yerine geçmez.",
    "paper": "Bu belge kağıt faturanın elektronik kopyasıdır.",
    "e_dispatch": "e-İrsaliye – sevk belgesi kopyası.",
}


def _pdf_filename(inv: Dict[str, Any]) -> str:
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", str(inv.get("invoice_number") or "fatura")).strip("._") or "fatura"
    return f"{name}.pdf"


def build_invoice_pdf(inv: Dict[str, Any], seller: Dict[str, Any], buyer: Dict[str, Any]) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    w, h = A4
    e_type = inv.get("e_type") or "e_archive"
    title = _PDF_TITLES.get(e_type, "e-ARŞİV FATURA")
    scenario = _PDF_SCENARIO.get(e_type, "e-Arşiv / Satış")
    c.setFillColor(colors.HexColor("#0f172a")); c.rect(0, h - 38 * mm, w, 38 * mm, fill=1, stroke=0)
    c.setFillColor(colors.white); c.setFont(PDF_FONT_B, 20); c.drawString(18 * mm, h - 18 * mm, title)
    c.setFont(PDF_FONT, 9); c.drawString(18 * mm, h - 25 * mm, f"Fatura No: {inv.get('invoice_number', '')}    Tarih: {inv.get('issue_date', '')}    Senaryo: {scenario}")
    c.drawString(18 * mm, h - 30 * mm, f"ETTN / Takip: {inv.get('gib_tracking_id', '')}")
    c.setFillColor(colors.HexColor("#fbbf24")); c.setFont(PDF_FONT_B, 10); c.drawRightString(w - 18 * mm, h - 18 * mm, seller.get("name", ""))
    c.setFillColor(colors.white); c.setFont(PDF_FONT, 8)
    for i, line in enumerate([f"VKN: {seller.get('tax_number', '')}  {seller.get('tax_office', '')}", (seller.get("address") or "")[:80], f"{seller.get('city', '')}  {seller.get('phone', '')}  {seller.get('email', '')}"]):
        c.drawRightString(w - 18 * mm, h - (23 + i * 4) * mm, line)
    y = h - 52 * mm
    c.setFillColor(colors.HexColor("#0f172a")); c.setFont(PDF_FONT_B, 9); c.drawString(18 * mm, y, "ALICI")
    c.setFont(PDF_FONT, 9)
    buyer_tax = buyer.get("tax_number_or_id") or buyer.get("tax_number") or inv.get("contact_tax_id") or "-"
    buyer_name = buyer.get("name") or inv.get("contact_name") or ""
    for i, line in enumerate([buyer_name, f"VKN/TCKN: {buyer_tax}", f"{buyer.get('city') or ''}  {buyer.get('email') or ''}", buyer.get("phone") or ""]):
        c.drawString(18 * mm, y - (5 + i * 4.5) * mm, str(line))
    y -= 32 * mm
    c.setFillColor(colors.HexColor("#f1f5f9")); c.rect(18 * mm, y - 2 * mm, w - 36 * mm, 8 * mm, fill=1, stroke=0)
    c.setFillColor(colors.HexColor("#334155")); c.setFont(PDF_FONT_B, 8)
    cols = [(20 * mm, "Açıklama"), (118 * mm, "Miktar"), (138 * mm, "Birim Fiyat"), (160 * mm, "KDV"), (w - 20 * mm, "Tutar")]
    for x, t in cols:
        (c.drawRightString if t == "Tutar" else c.drawString)(x, y, t)
    y -= 8 * mm; c.setFont(PDF_FONT, 9); c.setFillColor(colors.black)
    items = list(inv.get("items") or [])
    vat_rates = {float(it.get("vat_rate") or 0) for it in items}
    vat_label = f"Hesaplanan KDV (%{int(next(iter(vat_rates)))})" if len(vat_rates) == 1 else "Hesaplanan KDV"
    if not vat_rates:
        vat_label = "Hesaplanan KDV (%20)"
    for it in items:
        c.drawString(20 * mm, y, str(it.get("name") or "Kalem")[:70]); c.drawString(118 * mm, y, f"{it.get('quantity', 0)} {it.get('unit', '')}"); c.drawString(138 * mm, y, _tl(float(it.get("unit_price") or 0))); c.drawString(160 * mm, y, f"%{it.get('vat_rate', 0)}"); c.drawRightString(w - 20 * mm, y, _tl(float(it.get("total") or 0)))
        y -= 7 * mm
    y -= 4 * mm; c.setStrokeColor(colors.HexColor("#e2e8f0")); c.line(120 * mm, y + 3 * mm, w - 18 * mm, y + 3 * mm)
    paid = inv["paid_amount"] if inv.get("paid_amount") is not None else inv.get("grand_total") or 0
    for label, val, bold in [("Ara Toplam", float(inv.get("subtotal") or 0), False), (vat_label, float(inv.get("vat_total") or 0), False), ("Genel Toplam", float(inv.get("grand_total") or 0), True), ("Ödenen", float(paid or 0), False)]:
        c.setFont(PDF_FONT_B if bold else PDF_FONT, 10 if bold else 9); c.drawString(120 * mm, y, label); c.drawRightString(w - 20 * mm, y, _tl(val)); y -= 6 * mm
    c.setFont(PDF_FONT, 8); c.setFillColor(colors.HexColor("#64748b"))
    if inv.get("source") == "subscription":
        c.drawString(18 * mm, 30 * mm, "Bu fatura online abonelik ödemesi karşılığında elektronik ortamda düzenlenmiştir; ödeme alınmıştır.")
    else:
        c.drawString(18 * mm, 30 * mm, "Bu belge elektronik ortamda oluşturulmuştur.")
    c.drawString(18 * mm, 25 * mm, (inv.get("notes") or "")[:120])
    c.drawString(18 * mm, 18 * mm, _PDF_FOOTER.get(e_type, _PDF_FOOTER["e_archive"]))
    c.showPage(); c.save()
    return buf.getvalue()


@router.get("/invoices/{invoice_id}/pdf")
async def invoice_pdf(invoice_id: str, download: bool = Query(False)):
    inv = await _db.invoices.find_one({"_id": invoice_id})
    if not inv:
        raise HTTPException(status_code=404, detail="Fatura bulunamadı.")
    seller = await _db.companies.find_one({"_id": inv["company_id"]}) or {}
    contact = await _db.contacts.find_one({"_id": inv.get("contact_id")}) if inv.get("contact_id") else None
    buyer = contact or {"name": inv.get("contact_name"), "tax_number_or_id": inv.get("contact_tax_id")}
    disp = "attachment" if download else "inline"
    return Response(build_invoice_pdf(inv, seller, buyer), media_type="application/pdf", headers={"Content-Disposition": f'{disp}; filename="{_pdf_filename(inv)}"'})


def _quote_pdf_filename(q: Dict[str, Any]) -> str:
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", str(q.get("quote_number") or "teklif")).strip("._") or "teklif"
    return f"{name}.pdf"


def build_quote_pdf(q: Dict[str, Any], company: Dict[str, Any]) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    w, h = A4
    c.setFillColor(colors.HexColor("#0f172a"))
    c.rect(0, h - 36 * mm, w, 36 * mm, fill=1, stroke=0)
    c.setFillColor(colors.white)
    c.setFont(PDF_FONT_B, 18)
    c.drawString(18 * mm, h - 16 * mm, "FİYAT TEKLİFİ")
    c.setFont(PDF_FONT, 9)
    c.drawString(18 * mm, h - 23 * mm, f"{q.get('quote_number') or ''}    {q.get('issue_date') or ''}")
    if q.get("valid_until"):
        c.drawString(18 * mm, h - 28 * mm, f"Geçerlilik: {q.get('valid_until')}")
    c.setFillColor(colors.HexColor("#34d399"))
    c.setFont(PDF_FONT_B, 10)
    c.drawRightString(w - 18 * mm, h - 16 * mm, company.get("name") or "")
    c.setFillColor(colors.white)
    c.setFont(PDF_FONT, 8)
    for i, line in enumerate([
        (company.get("address") or "")[:80],
        f"{company.get('city') or ''}  {company.get('phone') or ''}  {company.get('email') or ''}",
    ]):
        c.drawRightString(w - 18 * mm, h - (23 + i * 4) * mm, str(line))
    y = h - 48 * mm
    c.setFillColor(colors.HexColor("#0f172a"))
    c.setFont(PDF_FONT_B, 9)
    c.drawString(18 * mm, y, "MÜŞTERİ")
    c.setFont(PDF_FONT, 9)
    c.drawString(18 * mm, y - 6 * mm, str(q.get("contact_name") or "—"))
    if q.get("title"):
        c.setFillColor(colors.HexColor("#64748b"))
        c.drawString(18 * mm, y - 12 * mm, str(q.get("title"))[:90])
    y -= 24 * mm
    c.setFillColor(colors.HexColor("#f1f5f9"))
    c.rect(18 * mm, y - 2 * mm, w - 36 * mm, 8 * mm, fill=1, stroke=0)
    c.setFillColor(colors.HexColor("#334155"))
    c.setFont(PDF_FONT_B, 8)
    c.drawString(20 * mm, y, "Kalem")
    c.drawString(118 * mm, y, "Miktar")
    c.drawString(138 * mm, y, "Birim")
    c.drawString(160 * mm, y, "KDV")
    c.drawRightString(w - 20 * mm, y, "Tutar")
    y -= 8 * mm
    c.setFont(PDF_FONT, 9)
    c.setFillColor(colors.black)
    for it in list(q.get("items") or []):
        if y < 40 * mm:
            c.showPage()
            y = h - 20 * mm
            c.setFont(PDF_FONT, 9)
        qty = float(it.get("quantity") or 0)
        price = float(it.get("unit_price") or 0)
        vat = float(it.get("vat_rate") or 0)
        line_total = float(it.get("total") or qty * price * (1 + vat / 100))
        c.drawString(20 * mm, y, str(it.get("name") or "Kalem")[:70])
        c.drawString(118 * mm, y, f"{qty:g} {it.get('unit') or ''}")
        c.drawString(138 * mm, y, _tl(price))
        c.drawString(160 * mm, y, f"%{int(vat) if vat == int(vat) else vat}")
        c.drawRightString(w - 20 * mm, y, _tl(line_total))
        y -= 7 * mm
    y -= 4 * mm
    c.setStrokeColor(colors.HexColor("#e2e8f0"))
    c.line(120 * mm, y + 3 * mm, w - 18 * mm, y + 3 * mm)
    for label, val, bold in [
        ("Ara Toplam", float(q.get("subtotal") or 0), False),
        ("KDV", float(q.get("vat_total") or 0), False),
        ("Genel Toplam", float(q.get("grand_total") or 0), True),
    ]:
        c.setFont(PDF_FONT_B if bold else PDF_FONT, 10 if bold else 9)
        c.drawString(120 * mm, y, label)
        c.drawRightString(w - 20 * mm, y, _tl(val))
        y -= 6 * mm
    c.setFont(PDF_FONT, 8)
    c.setFillColor(colors.HexColor("#64748b"))
    notes = (q.get("notes") or "")[:160]
    if notes:
        c.drawString(18 * mm, 28 * mm, f"Not: {notes}")
    terms = (q.get("terms") or "")[:160]
    if terms:
        c.drawString(18 * mm, 23 * mm, f"Şartlar: {terms}")
    c.drawString(18 * mm, 16 * mm, "Bu belge fiyat teklifidir; fatura yerine geçmez.")
    c.showPage()
    c.save()
    return buf.getvalue()


@router.get("/quotes/{quote_id}/pdf")
async def quote_pdf(quote_id: str, download: bool = Query(False)):
    q = await _db.quotes.find_one({"_id": quote_id})
    if not q:
        raise HTTPException(status_code=404, detail="Teklif bulunamadı.")
    company = await _db.companies.find_one({"_id": q["company_id"]}) or {}
    disp = "attachment" if download else "inline"
    return Response(
        build_quote_pdf(q, company),
        media_type="application/pdf",
        headers={"Content-Disposition": f'{disp}; filename="{_quote_pdf_filename(q)}"'},
    )


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
