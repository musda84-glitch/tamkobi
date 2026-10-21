"""Personel makbuz PDF: ₺ glifi, dönem/tarih ve eski rcpt_ yedeği."""

import io
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import personnel_receipt  # noqa: E402
from pypdf import PdfReader  # noqa: E402
from reportlab.pdfbase import pdfmetrics  # noqa: E402


def _text(pdf: bytes) -> str:
    reader = PdfReader(io.BytesIO(pdf))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def _embedded_lira(pdf: bytes) -> bool:
    """Gömülü TrueType fontun ToUnicode eşlemesi U+20BA içeriyor mu."""
    needle = b"20BA"
    reader = PdfReader(io.BytesIO(pdf))
    for page in reader.pages:
        fonts = (page.get("/Resources") or {}).get("/Font") or {}
        for ref in fonts.values():
            font = ref.get_object()
            if str(font.get("/Subtype") or "") != "/TrueType":
                continue
            base = str(font.get("/BaseFont") or "")
            if "DejaVu" not in base:
                continue
            touni = font.get("/ToUnicode")
            if touni is not None and needle in touni.get_data():
                return True
    return False


def test_total_line_is_vertically_centered():
    pdf = personnel_receipt.render_pdf(
        {
            "_id": "rcpt_center",
            "receipt_no": "PM-2026-0008",
            "employee_name": "Ali",
            "period": "2026-10",
            "date": "2026-10-21",
            "lines": [{"kind_label": "Maaş", "account_name": "Banka", "amount": 10}],
            "total": 10,
            "overpaid": False,
        },
        {"name": "Tamkobi"},
    )
    reader = PdfReader(io.BytesIO(pdf))
    hits = []

    def visitor(text, cm, tm, fontDict, fontSize):
        label = " ".join(text.split())
        if label in ("Toplam ödenen", "10,00 ₺"):
            hits.append((label, tm[5]))

    reader.pages[0].extract_text(visitor_text=visitor)
    label_y = next(y for label, y in hits if label == "Toplam ödenen")
    amount_y = min(
        (y for label, y in hits if label == "10,00 ₺"), key=lambda y: abs(y - label_y)
    )
    assert abs(label_y - amount_y) < 0.6


def test_receipt_pdf_embeds_lira_and_matches_layout():
    personnel_receipt._fonts()
    face = pdfmetrics.getFont("PersRec").face
    assert "DejaVuSans" in str(face.filename)
    assert face.charToGlyph.get(0x20BA)

    pdf = personnel_receipt.render_pdf(
        {
            "_id": "rcpt_a1b2c3d4e5",
            "receipt_no": "PM-2026-0042",
            "employee_name": "Ayşe Yılmaz",
            "period": "2026-10",
            "date": "2026-10-21",
            "lines": [
                {
                    "kind_label": "Maaş",
                    "account_name": "Ziraat Bankası",
                    "amount": 28000,
                },
                {
                    "kind_label": "Prim",
                    "account_name": "Ziraat Bankası",
                    "amount": 1700,
                    "description": "Ekim primi",
                },
            ],
            "total": 29700,
            "remaining_after": -2000,
            "overpaid": True,
        },
        {"name": "Tamkobi"},
    )
    assert pdf.startswith(b"%PDF")
    assert _embedded_lira(pdf)
    text = _text(pdf)
    for needle in (
        "Tamkobi",
        "Personel Ödeme Makbuzu",
        "Ayşe Yılmaz",
        "PM-2026-0042",
        "Ekim 2026",
        "21.10.2026",
        "Tür",
        "Ödeme hesabı",
        "Tutar",
        "28.000,00 ₺",
        "Toplam ödenen",
        "29.700,00 ₺",
        "Fazla ödeme 2.000,00 ₺ — sonraki maaştan düşülecek",
        "Ödeyen",
        "Teslim alan",
        "rcpt_a1b2c3d4e5",
    ):
        assert needle in text, needle
    assert text.count("PM-2026-0042") == 1


def test_receipt_without_number_shows_rcpt_id():
    pdf = personnel_receipt.render_pdf(
        {
            "_id": "rcpt_legacy01",
            "employee_name": "Ali Veli",
            "period": "2026-10",
            "date": "2026-10-13",
            "lines": [{"kind_label": "Maaş", "account_name": "Banka", "amount": 10000}],
            "total": 10000,
            "remaining_after": 4000,
            "overpaid": False,
        },
        {"name": "Tamkobi"},
    )
    text = _text(pdf)
    assert "rcpt_legacy01" in text
    assert "PM-" not in text
    assert "13.10.2026" in text
    assert "Ekim 2026" in text
    assert "Fazla ödeme" not in text
    assert "Ödeme sonrası kalan 4.000,00 ₺" in text
    assert "10.000,00 ₺" in text
    assert _embedded_lira(pdf)


def test_long_company_name_is_not_clipped():
    name = "MATEK DEKORASYON MOBİLYA SAN.TİC.LTD.ŞTİ."
    pdf = personnel_receipt.render_pdf(
        {
            "_id": "rcpt_longname",
            "receipt_no": "PM-2026-0003",
            "employee_name": "Ayşe Yılmaz",
            "period": "2026-10",
            "date": "2026-10-21",
            "lines": [{"kind_label": "Maaş", "account_name": "Kasa", "amount": 100}],
            "total": 100,
            "remaining_after": None,
            "overpaid": False,
        },
        {"name": name},
    )
    text = _text(pdf)
    assert name in " ".join(text.split())
    assert "…" not in text
    assert "Ödeme sonrası kalan" not in text
