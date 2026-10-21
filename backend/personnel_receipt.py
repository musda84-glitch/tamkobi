"""Personel ödeme makbuzu PDF."""

from __future__ import annotations

import io
import re
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

# DejaVu Sans U+20BA (₺) glifini taşır; Liberation Sans taşımaz.
# Bundled kopya sistem fontu yokken de makbuzda kutuya düşmesin diye önde.
_FONT_DIR = Path(__file__).resolve().parent / "fonts"
_FONT_PAIRS = (
    (_FONT_DIR / "DejaVuSans.ttf", _FONT_DIR / "DejaVuSans-Bold.ttf"),
    (
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ),
    (_FONT_DIR / "LiberationSans-Regular.ttf", _FONT_DIR / "LiberationSans-Bold.ttf"),
    (
        Path("/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"),
        Path("/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"),
    ),
)
_FONTS: Optional[Tuple[str, str]] = None

_MONTHS = (
    "",
    "Ocak",
    "Şubat",
    "Mart",
    "Nisan",
    "Mayıs",
    "Haziran",
    "Temmuz",
    "Ağustos",
    "Eylül",
    "Ekim",
    "Kasım",
    "Aralık",
)

SLATE = colors.HexColor("#0f172a")
MUTED = colors.HexColor("#64748b")
LINE = colors.HexColor("#e2e8f0")
INFO_BG = colors.HexColor("#f8fafc")
HEAD_BG = colors.HexColor("#f1f5f9")
TOTAL_BG = colors.HexColor("#ecfdf5")
TOTAL_FG = colors.HexColor("#047857")
WARN_BG = colors.HexColor("#fffbeb")
WARN_BD = colors.HexColor("#fde68a")
WARN_FG = colors.HexColor("#92400e")
RULE = colors.HexColor("#94a3b8")


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


def receipt_display_no(receipt: Dict[str, Any]) -> str:
    """Okunur numara yoksa eski makbuzlarda rcpt_ kimliği."""
    no = str((receipt or {}).get("receipt_no") or "").strip()
    if no:
        return no
    return str((receipt or {}).get("_id") or (receipt or {}).get("id") or "").strip()


def _period_label(period: Any) -> str:
    raw = str(period or "").strip()
    match = re.match(r"^(\d{4})-(\d{2})", raw)
    if not match:
        return raw
    year, month = int(match.group(1)), int(match.group(2))
    if 1 <= month <= 12:
        return f"{_MONTHS[month]} {year}"
    return raw


def _date_label(value: Any) -> str:
    raw = str(value or "").strip()
    match = re.match(r"^(\d{4})-(\d{2})-(\d{2})", raw)
    if match:
        return f"{match.group(3)}.{match.group(2)}.{match.group(1)}"
    return raw


def _wrap_words(text: str, font: str, size: float, width: float) -> list:
    words = [part for part in text.split() if part]
    if not words:
        return []
    lines = []
    current = words[0]
    for word in words[1:]:
        trial = f"{current} {word}"
        if stringWidth(trial, font, size) <= width:
            current = trial
        else:
            lines.append(current)
            current = word
    lines.append(current)
    return lines


def _break_wide(line: str, font: str, size: float, width: float) -> list:
    if stringWidth(line, font, size) <= width:
        return [line]
    parts = []
    buf = ""
    for ch in line:
        trial = buf + ch
        if buf and stringWidth(trial, font, size) > width:
            parts.append(buf)
            buf = ch
        else:
            buf = trial
    if buf:
        parts.append(buf)
    return parts or [line]


def _centered_baseline(
    font_name: str, size: float, box_bottom: float, box_h: float
) -> float:
    face = pdfmetrics.getFont(font_name).face
    ascent = float(getattr(face, "ascent", 800) or 800)
    descent = abs(float(getattr(face, "descent", -200) or -200))
    em = ascent + descent
    if em < 100:
        em = 1000.0
    ascent_pt = ascent * size / em
    descent_pt = descent * size / em
    return box_bottom + (box_h - ascent_pt - descent_pt) / 2.0 + descent_pt


def _company_lines(name: str, font: str, width: float):
    """Şirket adını kesmeden bir veya iki satıra sığdırır; sığmazsa punto küçülür."""
    raw = _text(name).strip()
    if not raw or width <= 0:
        return [raw], 16
    for size in (16, 14, 13, 12, 11, 10):
        lines = _wrap_words(raw, font, size, width)
        if (
            lines
            and len(lines) <= 2
            and all(stringWidth(line, font, size) <= width + 0.2 for line in lines)
        ):
            return lines, float(size)
    size = 9.0
    fitted = []
    for line in _wrap_words(raw, font, size, width):
        fitted.extend(_break_wide(line, font, size, width))
    return fitted or [raw], size


def _clip(value: Any, font: str, size: float, width: float) -> str:
    raw = _text(value)
    if width <= 0:
        return ""
    if stringWidth(raw, font, size) <= width:
        return raw
    ell = "…"
    while raw and stringWidth(raw + ell, font, size) > width:
        raw = raw[:-1]
    return (raw + ell) if raw else ""


def render_pdf(receipt: Dict[str, Any], company: Optional[dict] = None) -> bytes:
    company = company or {}
    receipt = receipt or {}
    regular, bold = _fonts()
    buf = io.BytesIO()
    pdf = canvas.Canvas(buf, pagesize=A4)
    width, height = A4
    left = 16 * mm
    right = width - 16 * mm
    content_w = right - left
    bottom_guard = 24 * mm

    number = receipt_display_no(receipt)
    ref = str(receipt.get("_id") or receipt.get("id") or "").strip()

    def footer() -> None:
        if not ref:
            return
        pdf.setFillColor(RULE)
        pdf.setFont(regular, 8)
        pdf.drawCentredString(width / 2, 12 * mm, _text(ref))

    state = {"y": height - 16 * mm}

    def ensure(need: float) -> None:
        if state["y"] - need >= bottom_guard:
            return
        footer()
        pdf.showPage()
        state["y"] = height - 16 * mm

    y = state["y"]
    company_name = str(company.get("name") or "").strip()
    pdf.setFillColor(SLATE)
    if company_name:
        name_lines, name_size = _company_lines(company_name, bold, content_w)
        pdf.setFont(bold, name_size)
        for line in name_lines:
            pdf.drawString(left, y, line)
            y -= name_size + 3
        y -= 1 * mm
        pdf.setFillColor(MUTED)
        pdf.setFont(regular, 10)
        pdf.drawString(left, y, _text("Personel Ödeme Makbuzu"))
    else:
        pdf.setFont(bold, 15)
        pdf.drawString(left, y, _text("Personel Ödeme Makbuzu"))
    y -= 6 * mm
    pdf.setStrokeColor(LINE)
    pdf.setLineWidth(0.8)
    pdf.line(left, y, right, y)
    y -= 5 * mm

    box_h = 34 * mm
    box_bottom = y - box_h
    pdf.setFillColor(INFO_BG)
    pdf.setStrokeColor(LINE)
    pdf.setLineWidth(0.6)
    pdf.roundRect(left, box_bottom, content_w, box_h, 3 * mm, fill=1, stroke=1)
    mid = left + content_w / 2
    pdf.setStrokeColor(LINE)
    pdf.line(mid, box_bottom + 4 * mm, mid, y - 4 * mm)
    col_l = left + 5 * mm
    col_r = mid + 5 * mm
    value_w = content_w / 2 - 12 * mm

    def field(x: float, top: float, label: str, value: Any) -> None:
        pdf.setFillColor(MUTED)
        pdf.setFont(regular, 7)
        pdf.drawString(x, top, _text(label))
        pdf.setFillColor(SLATE)
        pdf.setFont(bold, 11)
        pdf.drawString(x, top - 5 * mm, _clip(value, bold, 11, value_w))

    field(col_l, y - 7 * mm, "PERSONEL", receipt.get("employee_name") or "")
    field(col_r, y - 7 * mm, "MAKBUZ NO", number)
    field(col_l, y - 20 * mm, "DÖNEM", _period_label(receipt.get("period")))
    field(col_r, y - 20 * mm, "TARİH", _date_label(receipt.get("date")))
    y = box_bottom - 8 * mm
    state["y"] = y

    def table_header() -> None:
        top = state["y"]
        pdf.setFillColor(HEAD_BG)
        pdf.roundRect(
            left, top - 5.5 * mm, content_w, 8 * mm, 1.5 * mm, fill=1, stroke=0
        )
        pdf.setFillColor(MUTED)
        pdf.setFont(bold, 8)
        pdf.drawString(left + 3 * mm, top - 2.2 * mm, _text("Tür"))
        pdf.drawString(left + 48 * mm, top - 2.2 * mm, _text("Ödeme hesabı"))
        pdf.drawRightString(right - 3 * mm, top - 2.2 * mm, _text("Tutar"))
        state["y"] = top - 10 * mm

    table_header()
    kind_w = 42 * mm
    amount_w = 36 * mm
    account_x = left + 48 * mm
    account_w = right - 3 * mm - amount_w - account_x

    for ln in receipt.get("lines") or []:
        note = str((ln or {}).get("description") or "").strip()
        row_need = 12 * mm + (5 * mm if note else 0)
        if state["y"] - row_need < bottom_guard:
            footer()
            pdf.showPage()
            state["y"] = height - 16 * mm
            table_header()
        y = state["y"]
        pdf.setFillColor(SLATE)
        pdf.setFont(regular, 10)
        pdf.drawString(
            left + 3 * mm,
            y,
            _clip(
                (ln or {}).get("kind_label") or (ln or {}).get("kind") or "",
                regular,
                10,
                kind_w,
            ),
        )
        pdf.drawString(
            account_x,
            y,
            _clip((ln or {}).get("account_name") or "", regular, 10, account_w),
        )
        pdf.setFont(bold, 10)
        pdf.drawRightString(right - 3 * mm, y, _text(_money((ln or {}).get("amount"))))
        y -= 3 * mm
        pdf.setStrokeColor(LINE)
        pdf.setLineWidth(0.4)
        pdf.line(left, y, right, y)
        y -= 5 * mm
        if note:
            pdf.setFillColor(MUTED)
            pdf.setFont(regular, 8)
            pdf.drawString(
                left + 3 * mm, y, _clip(note, regular, 8, content_w - 6 * mm)
            )
            y -= 5 * mm
        state["y"] = y

    ensure(22 * mm)
    y = state["y"] - 2 * mm
    total_h = 16 * mm
    box_bottom = y - total_h
    pdf.setFillColor(TOTAL_BG)
    pdf.roundRect(left, box_bottom, content_w, total_h, 2.5 * mm, fill=1, stroke=0)
    amount_size = 16
    baseline = _centered_baseline(bold, amount_size, box_bottom, total_h)
    pdf.setFillColor(TOTAL_FG)
    pdf.setFont(bold, 12)
    pdf.drawString(left + 4 * mm, baseline, _text("Toplam ödenen"))
    pdf.setFont(bold, amount_size)
    pdf.drawRightString(right - 4 * mm, baseline, _text(_money(receipt.get("total"))))
    state["y"] = box_bottom - 3 * mm

    if receipt.get("overpaid"):
        ensure(18 * mm)
        try:
            excess = abs(float(receipt.get("remaining_after") or 0))
        except (TypeError, ValueError):
            excess = 0.0
        msg = f"Fazla ödeme {_money(excess)} — sonraki maaştan düşülecek"
        y = state["y"] - 2 * mm
        warn_h = 12 * mm
        pdf.setFillColor(WARN_BG)
        pdf.setStrokeColor(WARN_BD)
        pdf.setLineWidth(0.8)
        pdf.roundRect(
            left, y - warn_h + 3.5 * mm, content_w, warn_h, 2 * mm, fill=1, stroke=1
        )
        pdf.setFillColor(WARN_FG)
        pdf.setFont(regular, 9)
        pdf.drawString(
            left + 4 * mm, y - 1 * mm, _clip(msg, regular, 9, content_w - 8 * mm)
        )
        state["y"] = y - warn_h - 2 * mm
    else:
        after = receipt.get("remaining_after")
        if after not in (None, ""):
            ensure(12 * mm)
            y = state["y"] - 1 * mm
            pdf.setFillColor(SLATE)
            pdf.setFont(regular, 10)
            pdf.drawString(left, y, _text(f"Ödeme sonrası kalan {_money(after)}"))
            state["y"] = y - 6 * mm

    state["y"] -= 16 * mm
    if state["y"] < 40 * mm:
        footer()
        pdf.showPage()
        state["y"] = height - 48 * mm
    y = state["y"]
    sig_x = left + content_w / 2 + 6 * mm
    line_w = 58 * mm
    pdf.setFillColor(MUTED)
    pdf.setFont(regular, 9)
    pdf.drawString(left, y, _text("Ödeyen"))
    pdf.drawString(sig_x, y, _text("Teslim alan"))
    y -= 12 * mm
    pdf.setStrokeColor(RULE)
    pdf.setLineWidth(0.7)
    pdf.line(left, y, left + line_w, y)
    pdf.line(sig_x, y, sig_x + line_w, y)
    footer()
    pdf.save()
    return buf.getvalue()
