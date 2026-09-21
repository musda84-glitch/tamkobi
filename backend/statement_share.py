"""Cari ekstre satırları, herkese açık paylaşım gövdesi ve PDF."""
from __future__ import annotations

import io
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from urllib.parse import quote

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from saas_docs import PDF_FONT, PDF_FONT_B, _tl


def _num(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def _date(value: Any) -> str:
    return str(value or "")[:10]


def statement_rows(invoices: Optional[List[dict]], payments: Optional[List[dict]]) -> List[dict]:
    """Personel ekstresiyle aynı borç/alacak sırası (iptal fatura ve virman hariç)."""
    rows: List[dict] = []
    for inv in invoices or []:
        if not isinstance(inv, dict) or inv.get("status") == "cancelled":
            continue
        sales = inv.get("invoice_type") == "sales"
        total = _num(inv.get("grand_total"))
        kind = "Satış Faturası" if sales else "Alış Faturası"
        rows.append({
            "date": _date(inv.get("issue_date")),
            "doc": f"{inv.get('invoice_number') or 'Fatura'} • {kind}",
            "debit": total if sales else 0.0,
            "credit": 0.0 if sales else total,
            "kind": "invoice",
        })
    for pay in payments or []:
        if not isinstance(pay, dict) or pay.get("type") == "transfer":
            continue
        inflow = pay.get("type") == "inflow"
        amount = _num(pay.get("amount"))
        account = pay.get("account_name") or ""
        desc = pay.get("description") or ""
        label = "Tahsilat" if inflow else "Ödeme"
        doc = f"{label} • {account}".strip()
        if desc:
            doc = f"{doc} • {desc}"
        rows.append({
            "date": _date(pay.get("date")),
            "doc": doc.strip(" •"),
            "debit": 0.0 if inflow else amount,
            "credit": amount if inflow else 0.0,
            "kind": "payment",
        })
    rows.sort(key=lambda r: r.get("date") or "")
    bal = 0.0
    out = []
    for row in rows:
        bal = round(bal + row["debit"] - row["credit"], 2)
        out.append({**row, "debit": round(row["debit"], 2), "credit": round(row["credit"], 2), "balance": bal})
    return out


def public_statement_view(contact: dict, company: dict, rows: List[dict]) -> Dict[str, Any]:
    """Müşteri linkinde yalnızca ekstre alanları; kimlik ve iç id yok."""
    bal = rows[-1]["balance"] if rows else round(_num((contact or {}).get("balance")), 2)
    c = contact or {}
    co = company or {}
    return {
        "contact": {
            "name": c.get("name") or "",
            "tax_number_or_id": c.get("tax_number_or_id") or "",
            "tax_office": c.get("tax_office") or "",
            "address": c.get("address") or "",
            "city": c.get("city") or "",
        },
        "company": {
            "name": co.get("name") or "",
            "phone": co.get("phone") or "",
            "email": co.get("email") or "",
            "address": co.get("address") or "",
            "city": co.get("city") or "",
            "tax_office": co.get("tax_office") or "",
            "tax_number": co.get("tax_number") or "",
            "logo_url": co.get("logo_url") or "",
        },
        "rows": rows,
        "balance": bal,
        "issued_at": datetime.now(timezone.utc).astimezone().strftime("%d.%m.%Y %H:%M"),
    }


def _fit(c: canvas.Canvas, text: str, font: str, size: float, max_w: float) -> str:
    value = " ".join(str(text or "").split())
    if c.stringWidth(value, font, size) <= max_w:
        return value
    while value and c.stringWidth(value + "…", font, size) > max_w:
        value = value[:-1]
    return (value or "") + "…"


def statement_pdf_bytes(view: Dict[str, Any]) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4)
    width, height = A4
    contact = view.get("contact") or {}
    company = view.get("company") or {}
    rows = view.get("rows") or []
    left = 14 * mm
    right = width - 14 * mm

    def header(page: int) -> float:
        y = height - 16 * mm
        c.setFont(PDF_FONT_B, 13)
        c.drawString(left, y, _fit(c, company.get("name") or "Firmamız", PDF_FONT_B, 13, 110 * mm))
        c.setFont(PDF_FONT_B, 12)
        c.drawRightString(right, y, "CARİ HESAP EKSTRESİ")
        y -= 5 * mm
        c.setFont(PDF_FONT, 8)
        c.setFillColorRGB(0.35, 0.4, 0.45)
        meta = " • ".join(p for p in [company.get("phone"), company.get("email"), company.get("city")] if p)
        c.drawString(left, y, _fit(c, meta, PDF_FONT, 8, 120 * mm))
        c.drawRightString(right, y, f"Tarih: {view.get('issued_at') or ''}")
        y -= 4 * mm
        tax = " • ".join(p for p in [
            f"VD: {company.get('tax_office')}" if company.get("tax_office") else "",
            f"VKN: {company.get('tax_number')}" if company.get("tax_number") else "",
        ] if p)
        if tax:
            c.drawString(left, y, _fit(c, tax, PDF_FONT, 8, 160 * mm))
            y -= 4 * mm
        c.setFillColorRGB(0, 0, 0)
        c.setStrokeColorRGB(0.1, 0.12, 0.16)
        c.setLineWidth(1.2)
        c.line(left, y, right, y)
        y -= 8 * mm
        c.setFont(PDF_FONT, 7)
        c.setFillColorRGB(0.45, 0.5, 0.55)
        c.drawString(left, y, "SAYIN")
        c.setFillColorRGB(0, 0, 0)
        y -= 4.5 * mm
        c.setFont(PDF_FONT_B, 11)
        c.drawString(left, y, _fit(c, contact.get("name") or "Müşterimiz", PDF_FONT_B, 11, 160 * mm))
        y -= 4 * mm
        c.setFont(PDF_FONT, 8)
        c.setFillColorRGB(0.3, 0.35, 0.4)
        who = " ".join(p for p in [
            f"VKN/TCKN: {contact.get('tax_number_or_id')}" if contact.get("tax_number_or_id") else "",
            contact.get("tax_office") or "",
        ] if p)
        if who:
            c.drawString(left, y, _fit(c, who, PDF_FONT, 8, 170 * mm))
            y -= 4 * mm
        addr = " ".join(p for p in [contact.get("address"), contact.get("city")] if p)
        if addr:
            c.drawString(left, y, _fit(c, addr, PDF_FONT, 8, 170 * mm))
            y -= 4 * mm
        c.setFillColorRGB(0, 0, 0)
        y -= 3 * mm
        _table_head(y)
        c.setFont(PDF_FONT, 7)
        c.drawRightString(right, 10 * mm, str(page))
        return y - 6 * mm

    def _table_head(y: float) -> None:
        c.setFillColorRGB(0.06, 0.09, 0.16)
        c.rect(left, y - 1.5 * mm, right - left, 6 * mm, fill=1, stroke=0)
        c.setFillColorRGB(1, 1, 1)
        c.setFont(PDF_FONT_B, 8)
        c.drawString(left + 2 * mm, y, "Tarih")
        c.drawString(left + 28 * mm, y, "Belge / Açıklama")
        c.drawRightString(right - 52 * mm, y, "Borç")
        c.drawRightString(right - 26 * mm, y, "Alacak")
        c.drawRightString(right - 2 * mm, y, "Bakiye")
        c.setFillColorRGB(0, 0, 0)

    page = 1
    y = header(page)
    tot_d = tot_c = 0.0
    for i, row in enumerate(rows):
        if y < 22 * mm:
            c.showPage()
            page += 1
            y = header(page)
        if i % 2:
            c.setFillColorRGB(0.96, 0.97, 0.98)
            c.rect(left, y - 1.4 * mm, right - left, 5.2 * mm, fill=1, stroke=0)
            c.setFillColorRGB(0, 0, 0)
        c.setFont(PDF_FONT, 8)
        c.drawString(left + 2 * mm, y, _fit(c, row.get("date") or "", PDF_FONT, 8, 24 * mm))
        c.drawString(left + 28 * mm, y, _fit(c, row.get("doc") or "", PDF_FONT, 8, 78 * mm))
        debit = _num(row.get("debit"))
        credit = _num(row.get("credit"))
        tot_d += debit
        tot_c += credit
        if debit:
            c.drawRightString(right - 52 * mm, y, _tl(debit))
        if credit:
            c.drawRightString(right - 26 * mm, y, _tl(credit))
        c.setFont(PDF_FONT_B, 8)
        c.drawRightString(right - 2 * mm, y, _tl(_num(row.get("balance"))))
        y -= 5.4 * mm
    if y < 32 * mm:
        c.showPage()
        page += 1
        y = header(page)
    y -= 2 * mm
    c.setStrokeColorRGB(0.1, 0.12, 0.16)
    c.setLineWidth(1)
    c.line(left, y + 4 * mm, right, y + 4 * mm)
    c.setFont(PDF_FONT_B, 8)
    c.drawString(left + 2 * mm, y, "TOPLAM")
    c.drawRightString(right - 52 * mm, y, _tl(tot_d))
    c.drawRightString(right - 26 * mm, y, _tl(tot_c))
    bal = _num(view.get("balance"))
    c.drawRightString(right - 2 * mm, y, _tl(bal))
    y -= 10 * mm
    c.setFont(PDF_FONT, 8)
    c.setFillColorRGB(0.35, 0.4, 0.45)
    side = "Borçlu" if bal > 0 else "Alacaklı" if bal < 0 else ""
    c.setFont(PDF_FONT_B, 11)
    c.setFillColorRGB(0.7, 0.15, 0.2) if bal > 0 else c.setFillColorRGB(0.05, 0.45, 0.3)
    c.drawRightString(right, y, f"Güncel bakiye: {_tl(abs(bal))} {side}".strip())
    y -= 8 * mm
    c.setFillColorRGB(0.45, 0.5, 0.55)
    c.setFont(PDF_FONT, 7)
    note = f"Bu ekstre {company.get('name') or 'firmamız'} tarafından {view.get('issued_at') or ''} tarihinde oluşturulmuştur."
    c.drawString(left, y, _fit(c, note, PDF_FONT, 7, right - left))
    c.showPage()
    c.save()
    return buf.getvalue()


def pdf_filename(contact_name: str) -> str:
    raw = "".join(ch if ch.isalnum() or ch in "-_ " else "" for ch in (contact_name or "cari"))
    raw = "-".join(raw.split())[:40] or "cari"
    return f"ekstre-{raw}.pdf"


def pdf_disposition(filename: str) -> str:
    ascii_name = filename.encode("ascii", "ignore").decode() or "ekstre.pdf"
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}"
