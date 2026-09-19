"""Abonelik e-Arşiv fatura PDF'i (reportlab) ve tek tıkla yenileme linki."""
import io
import re
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import jwt
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import Response
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


router = APIRouter(prefix="/api")
_db = None

# Helvetica/WinAnsi has no Ğ/İ/Ş/ı — Turkish glyphs need a bundled TTF.
_FONT_PAIRS = (
    (Path(__file__).resolve().parent / "fonts" / "LiberationSans-Regular.ttf",
     Path(__file__).resolve().parent / "fonts" / "LiberationSans-Bold.ttf"),
    (Path("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"),
     Path("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf")),
    (Path("/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf"),
     Path("/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf")),
    (Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
     Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")),
)


def _register_pdf_fonts() -> Tuple[str, str]:
    for regular, bold in _FONT_PAIRS:
        if not (regular.is_file() and bold.is_file()):
            continue
        try:
            pdfmetrics.registerFont(TTFont("TkPdf", str(regular)))
            pdfmetrics.registerFont(TTFont("TkPdfB", str(bold)))
            return "TkPdf", "TkPdfB"
        except Exception:
            continue
    return "Helvetica", "Helvetica-Bold"


PDF_FONT, PDF_FONT_B = _register_pdf_fonts()

_DEFAULT_PRINT_TPL = {
    "show_logo": True,
    "primary_color": "#059669",
    "header_note": "",
    "footer_note": "Bizi tercih ettiğiniz için teşekkür ederiz.",
    "show_bank_info": True,
    "show_tax_info": True,
    "show_signature": True,
    "title_override": "",
    "layout": "classic",
    "hide_line_prices": False,
    "hide_vat": False,
    "hide_all_prices": False,
    "show_item_notes": True,
}


def _quote_template(company: Dict[str, Any], override: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    raw = ((company or {}).get("print_templates") or {}).get("quote") or {}
    return {**_DEFAULT_PRINT_TPL, **raw, **(override or {})}


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


def _hex(value: str, fallback: str = "#059669") -> colors.Color:
    raw = str(value or fallback).strip()
    if not re.match(r"^#[0-9A-Fa-f]{6}$", raw):
        raw = fallback
    return colors.HexColor(raw)


def _fnum(value: Any, default: float = 0.0) -> float:
    try:
        if value in (None, ""):
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def build_quote_pdf(q: Dict[str, Any], company: Dict[str, Any], template: Optional[Dict[str, Any]] = None) -> bytes:
    """PrintDocument (quote) classic/modern/minimal/bold — Türkçe TTF."""
    tpl = _quote_template(company, template)
    layout = str(tpl.get("layout") or "classic")
    is_modern = layout == "modern"
    is_minimal = layout == "minimal"
    is_bold = layout == "bold"
    color = colors.HexColor("#0f172a") if is_minimal else _hex(tpl.get("primary_color"))
    hide_all = bool(tpl.get("hide_all_prices"))
    hide_line = hide_all or bool(tpl.get("hide_line_prices"))
    hide_vat = hide_all or bool(tpl.get("hide_vat"))
    title = str(tpl.get("title_override") or "FİYAT TEKLİFİ")
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    w, h = A4
    left = 16 * mm
    right = w - 16 * mm
    muted = colors.HexColor("#64748b")
    ink = colors.HexColor("#0f172a")

    if is_bold:
        c.setFillColor(color)
        c.rect(0, 0, 4 * mm, h, fill=1, stroke=0)
        left = 18 * mm

    y = h - 14 * mm
    if is_modern:
        c.setFillColor(color)
        c.rect(0, h - 38 * mm, w, 38 * mm, fill=1, stroke=0)
        c.setFillColor(colors.white)
        c.setFont(PDF_FONT_B, 12)
        c.drawString(left, h - 16 * mm, str(company.get("name") or ""))
        c.setFont(PDF_FONT, 8)
        c.drawString(left, h - 22 * mm, f"{company.get('address') or ''} {company.get('city') or ''}")
        if tpl.get("show_tax_info") and (company.get("tax_office") or company.get("tax_number")):
            c.drawString(left, h - 27 * mm, f"VD: {company.get('tax_office') or ''}  •  VKN: {company.get('tax_number') or ''}")
        c.drawString(left, h - 32 * mm, "  •  ".join(x for x in [company.get("phone"), company.get("email")] if x))
        c.setFont(PDF_FONT_B, 16)
        c.drawRightString(right, h - 16 * mm, title)
        c.setFont(PDF_FONT, 9)
        c.drawRightString(right, h - 22 * mm, str(q.get("quote_number") or ""))
        c.drawRightString(right, h - 27 * mm, f"Tarih: {q.get('issue_date') or ''}")
        if q.get("valid_until"):
            c.drawRightString(right, h - 32 * mm, f"Geçerlilik: {q.get('valid_until')}")
        y = h - 48 * mm
    else:
        c.setFillColor(color)
        c.setFont(PDF_FONT_B, 12)
        c.drawString(left, y, str(company.get("name") or ""))
        c.setFillColor(ink if is_bold else color)
        c.setFont(PDF_FONT_B, 16 if is_bold else 15)
        c.drawRightString(right, y, title)
        y -= 5 * mm
        c.setFillColor(muted)
        c.setFont(PDF_FONT, 8)
        c.drawString(left, y, f"{company.get('address') or ''} {company.get('city') or ''}")
        c.setFillColor(ink)
        c.setFont(PDF_FONT, 9)
        c.drawRightString(right, y, str(q.get("quote_number") or ""))
        y -= 4.5 * mm
        if tpl.get("show_tax_info") and (company.get("tax_office") or company.get("tax_number")):
            c.setFillColor(muted)
            c.setFont(PDF_FONT, 8)
            c.drawString(left, y, f"VD: {company.get('tax_office') or ''}  •  VKN: {company.get('tax_number') or ''}")
        c.setFillColor(muted)
        c.setFont(PDF_FONT, 8)
        c.drawRightString(right, y, f"Tarih: {q.get('issue_date') or ''}")
        y -= 4.5 * mm
        contact_line = "  •  ".join(x for x in [company.get("phone"), company.get("email")] if x)
        if contact_line:
            c.drawString(left, y, contact_line)
        if q.get("valid_until"):
            c.drawRightString(right, y, f"Geçerlilik: {q.get('valid_until')}")
        y -= 6 * mm
        c.setStrokeColor(ink if is_minimal else color)
        c.setLineWidth(1.6 if is_minimal else 2.4)
        c.line(left, y, right, y)
        y -= 8 * mm

    if tpl.get("header_note"):
        c.setFillColor(muted)
        c.setFont(PDF_FONT, 8)
        c.drawString(left, y, str(tpl.get("header_note"))[:110])
        y -= 6 * mm

    c.setFillColor(colors.HexColor("#94a3b8"))
    c.setFont(PDF_FONT_B, 7)
    c.drawString(left, y, "SAYIN")
    if q.get("title"):
        c.drawRightString(right, y, "KONU")
    y -= 5 * mm
    c.setFillColor(ink)
    c.setFont(PDF_FONT_B, 11)
    c.drawString(left, y, str(q.get("contact_name") or "—"))
    if q.get("title"):
        c.setFont(PDF_FONT, 10)
        c.drawRightString(right, y, str(q.get("title"))[:60])
    y -= 10 * mm

    heads = [("Açıklama", left, False)]
    col_x = [left + 78 * mm, left + 102 * mm, left + 126 * mm, left + 140 * mm, left + 160 * mm, right]
    if not hide_line:
        heads += [("Miktar", col_x[0], True)]
        if not hide_vat:
            heads += [("Birim", col_x[1], True), ("KDV'li", col_x[2], True), ("KDV", col_x[3], True)]
        heads += [("Hariç", col_x[4], True)]
        if not hide_vat:
            heads += [("Dahil", col_x[5], True)]
    else:
        heads += [("Miktar", right, True)]

    th_h = 8 * mm
    if is_minimal:
        c.setStrokeColor(ink)
        c.setLineWidth(1)
        c.line(left, y - 2 * mm, right, y - 2 * mm)
        c.setFillColor(ink)
    else:
        c.setFillColor(ink if is_bold else color)
        c.rect(left, y - 3 * mm, right - left, th_h, fill=1, stroke=0)
        c.setFillColor(colors.white)
    c.setFont(PDF_FONT_B, 7)
    for label, x, right_align in heads:
        (c.drawRightString if right_align else c.drawString)(x, y, label)
    y -= 10 * mm

    c.setFont(PDF_FONT, 8)
    for i, it in enumerate(list(q.get("items") or [])):
        if y < 42 * mm:
            c.showPage()
            y = h - 18 * mm
            c.setFont(PDF_FONT, 8)
        qty = _fnum(it.get("quantity"))
        vat = _fnum(it.get("vat_rate"), 20)
        price = _fnum(it.get("unit_price"))
        price_incl = _fnum(it.get("unit_price_incl"), price * (1 + vat / 100.0))
        total = _fnum(it.get("total"), qty * price)
        total_incl = _fnum(it.get("total_incl"), total * (1 + vat / 100.0))
        if is_bold and i % 2:
            c.setFillColor(colors.HexColor("#f8fafc"))
            c.rect(left, y - 2 * mm, right - left, 7 * mm, fill=1, stroke=0)
        c.setFillColor(ink)
        c.setFont(PDF_FONT_B, 8)
        c.drawString(left, y, str(it.get("name") or it.get("product_name") or "Kalem")[:48])
        c.setFont(PDF_FONT, 8)
        qty_label = f"{qty:g} {it.get('unit') or ''}".strip()
        if hide_line:
            c.drawRightString(right, y, qty_label)
        else:
            c.drawRightString(col_x[0], y, qty_label)
            if not hide_vat:
                c.drawRightString(col_x[1], y, _tl(price))
                c.drawRightString(col_x[2], y, _tl(price_incl))
                c.drawRightString(col_x[3], y, f"%{int(vat) if vat == int(vat) else vat}")
            c.drawRightString(col_x[4], y, _tl(total))
            if not hide_vat:
                c.drawRightString(col_x[5], y, _tl(total_incl))
        note = (it.get("note") or it.get("notes") or it.get("description") or "") if tpl.get("show_item_notes") is not False else ""
        y -= 5 * mm
        if note:
            c.setFillColor(muted)
            c.setFont(PDF_FONT, 7)
            c.drawString(left, y, str(note)[:90])
            y -= 4 * mm
        c.setStrokeColor(colors.HexColor("#f1f5f9"))
        c.setLineWidth(0.4)
        c.line(left, y + 1 * mm, right, y + 1 * mm)
        y -= 2 * mm

    if not hide_all:
        y -= 4 * mm
        c.setStrokeColor(color)
        c.setLineWidth(1.4)
        c.line(w - 80 * mm, y + 6 * mm, right, y + 6 * mm)
        rows = []
        if not hide_vat:
            rows.append(("Ara Toplam (KDV Hariç)", _fnum(q.get("subtotal")), False))
            rows.append(("KDV", _fnum(q.get("vat_total")), False))
        rows.append(("GENEL TOPLAM (KDV Dahil)" if not hide_vat else "TOPLAM", _fnum(q.get("grand_total")), True))
        for label, val, bold in rows:
            c.setFillColor(ink)
            c.setFont(PDF_FONT_B if bold else PDF_FONT, 10 if bold else 8)
            c.drawString(w - 80 * mm, y, label)
            if bold:
                c.setFillColor(color)
            c.drawRightString(right, y, _tl(val))
            y -= 6 * mm

    y -= 4 * mm
    c.setFillColor(muted)
    c.setFont(PDF_FONT, 8)
    if q.get("notes"):
        c.drawString(left, y, str(q.get("notes"))[:140])
        y -= 5 * mm
    if q.get("terms"):
        c.setFont(PDF_FONT_B, 8)
        c.drawString(left, y, "Şartlar:")
        c.setFont(PDF_FONT, 8)
        c.drawString(left + 16 * mm, y, str(q.get("terms"))[:120])
        y -= 5 * mm
    if tpl.get("show_bank_info") and company.get("iban"):
        c.setFillColor(colors.HexColor("#475569"))
        c.drawString(left, y, f"Banka: {company.get('bank_name') or ''}  •  IBAN: {company.get('iban')}")
        y -= 8 * mm

    c.setFillColor(colors.HexColor("#94a3b8"))
    c.setFont(PDF_FONT, 8)
    c.drawString(left, 16 * mm, str(tpl.get("footer_note") or ""))
    if tpl.get("show_signature"):
        c.setStrokeColor(colors.HexColor("#cbd5e1"))
        c.setLineWidth(0.8)
        c.line(right - 40 * mm, 22 * mm, right, 22 * mm)
        c.setFillColor(muted)
        c.drawCentredString(right - 20 * mm, 17 * mm, "Kaşe / İmza")

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
    from auth_utils import JWT_ALGORITHM, get_jwt_secret
    return jwt.encode({"cid": company_id, "pid": plan_id, "type": "renew", "exp": datetime.now(timezone.utc) + timedelta(days=days)}, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def _decode(token: str) -> Dict[str, Any]:
    from auth_utils import JWT_ALGORITHM, get_jwt_secret
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
    import saas
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
    import saas_billing
    return await saas_billing.create_checkout(body, request)
