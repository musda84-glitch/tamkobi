"""Personel ödeme makbuzu PDF."""
from __future__ import annotations

import io
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

_FONT_PAIRS = (
    (Path(__file__).resolve().parent / "fonts" / "LiberationSans-Regular.ttf",
     Path(__file__).resolve().parent / "fonts" / "LiberationSans-Bold.ttf"),
    (Path("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"),
     Path("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf")),
    (Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
     Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")),
)
_FONTS: Optional[Tuple[str, str]] = None


def _fonts() -> Tuple[str, str]:
    global _FONTS
    if _FONTS:
        return _FONTS
    for regular, bold in _FONT_PAIRS:
        if regular.is_file() and bold.is_file():
            try:
                pdfmetrics.registerFont(TTFont("PersRec", str(regular)))
                pdfmetrics.registerFont(TTFont("PersRec-Bold", str(bold)))
                _FONTS = ("PersRec", "PersRec-Bold")
                return _FONTS
            except Exception:
                continue
    _FONTS = ("Helvetica", "Helvetica-Bold")
    return _FONTS


def _text(value: Any) -> str:
    raw = str(value or "")
    if _fonts()[0] == "Helvetica":
        return raw.translate(str.maketrans("çğıöşüÇĞİÖŞÜ", "cgiosuCGIOSU"))
    return raw


def _money(n: Any) -> str:
    try:
        v = float(n or 0)
    except (TypeError, ValueError):
        v = 0.0
    sign = "-" if v < 0 else ""
    whole, frac = f"{abs(v):,.2f}".split(".")
    return f"{sign}{whole.replace(',', '.')} ,{frac} ₺".replace(" ,", ",")


def render_pdf(receipt: Dict[str, Any], company: Optional[dict] = None) -> bytes:
    company = company or {}
    regular, bold = _fonts()
    buf = io.BytesIO()
    pdf = canvas.Canvas(buf, pagesize=A4)
    width, height = A4
    y = height - 18 * mm
    pdf.setFont(bold, 16)
    pdf.drawString(18 * mm, y, _text(company.get("name") or "Personel ödeme makbuzu"))
    y -= 8 * mm
    pdf.setFont(regular, 11)
    pdf.drawString(18 * mm, y, _text("Ödeme makbuzu"))
    y -= 10 * mm
    pdf.setFont(regular, 10)
    rows = [
        ("Personel", receipt.get("employee_name") or ""),
        ("Dönem", receipt.get("period") or ""),
        ("Tarih", receipt.get("date") or ""),
        ("Makbuz", receipt.get("_id") or receipt.get("id") or ""),
    ]
    for label, value in rows:
        pdf.drawString(18 * mm, y, _text(f"{label}: {value}"))
        y -= 6 * mm
    y -= 4 * mm
    pdf.setFont(bold, 10)
    pdf.drawString(18 * mm, y, _text("Tür"))
    pdf.drawString(70 * mm, y, _text("Hesap"))
    pdf.drawRightString(width - 18 * mm, y, _text("Tutar"))
    y -= 2 * mm
    pdf.line(18 * mm, y, width - 18 * mm, y)
    y -= 6 * mm
    pdf.setFont(regular, 10)
    for ln in receipt.get("lines") or []:
        pdf.drawString(18 * mm, y, _text(ln.get("kind_label") or ln.get("kind") or ""))
        pdf.drawString(70 * mm, y, _text((ln.get("account_name") or "")[:32]))
        pdf.drawRightString(width - 18 * mm, y, _text(_money(ln.get("amount"))))
        y -= 6 * mm
        note = (ln.get("description") or "").strip()
        if note:
            pdf.setFont(regular, 8)
            pdf.drawString(18 * mm, y, _text(note[:90]))
            pdf.setFont(regular, 10)
            y -= 5 * mm
        if y < 30 * mm:
            pdf.showPage()
            y = height - 18 * mm
            pdf.setFont(regular, 10)
    y -= 2 * mm
    pdf.line(18 * mm, y, width - 18 * mm, y)
    y -= 8 * mm
    pdf.setFont(bold, 12)
    pdf.drawString(18 * mm, y, _text("Toplam"))
    pdf.drawRightString(width - 18 * mm, y, _text(_money(receipt.get("total"))))
    y -= 8 * mm
    pdf.setFont(regular, 10)
    after = receipt.get("remaining_after")
    if receipt.get("overpaid"):
        pdf.drawString(18 * mm, y, _text(f"Fazla ödeme {_money(abs(float(after or 0)))} — sonraki maaştan düşülecek"))
    else:
        pdf.drawString(18 * mm, y, _text(f"Ödeme sonrası kalan {_money(after)}"))
    pdf.showPage()
    pdf.save()
    return buf.getvalue()
