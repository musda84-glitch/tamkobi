"""Quote PDF uses a Unicode TTF and the latest PrintDocument labels."""
import io
from pathlib import Path

import saas_docs


QUOTE = {
    "quote_number": "TKF-2026-0006",
    "issue_date": "2026-09-19",
    "valid_until": "2026-10-19",
    "contact_name": "AHMET AĞDEMİR",
    "title": "Fiyat Teklifi",
    "notes": "Cari ve kalemlerle",
    "terms": "Peşin teslim",
    "subtotal": 260,
    "vat_total": 26,
    "grand_total": 286,
    "items": [
        {"name": "Duvar Rafı", "quantity": 1, "unit": "Adet", "unit_price": 260, "unit_price_incl": 286, "vat_rate": 10, "total": 260, "total_incl": 286},
    ],
}

COMPANY = {
    "name": "MATEK DEKORASYON MOBİLYA SAN.TİC.LTD.ŞTİ.",
    "address": "Kayışdağı Mah.",
    "city": "İstanbul",
    "tax_office": "Kadıköy",
    "tax_number": "123456",
    "iban": "TR00",
    "bank_name": "Ziraat",
    "print_templates": {"quote": {"layout": "classic", "primary_color": "#059669", "footer_note": "Teşekkürler"}},
}


def _pdf_text(pdf: bytes) -> str:
    try:
        from pypdf import PdfReader
    except ImportError:
        return ""
    reader = PdfReader(io.BytesIO(pdf))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def test_bundled_liberation_is_registered():
    bundled = Path(__file__).resolve().parents[1] / "fonts" / "LiberationSans-Regular.ttf"
    assert bundled.is_file()
    assert saas_docs.PDF_FONT != "Helvetica"
    assert saas_docs.PDF_FONT_B != "Helvetica-Bold"


def test_quote_pdf_keeps_turkish_and_web_labels():
    pdf = saas_docs.build_quote_pdf(QUOTE, COMPANY)
    assert pdf.startswith(b"%PDF")
    text = _pdf_text(pdf)
    if not text:
        return
    for needle in ("FİYAT TEKLİFİ", "AHMET AĞDEMİR", "Duvar Rafı", "ŞTİ.", "İstanbul", "SAYIN", "KONU", "GENEL TOPLAM", "Kaşe"):
        assert needle in text


def test_quote_pdf_honors_modern_template():
    company = {**COMPANY, "print_templates": {"quote": {"layout": "modern", "title_override": "ÖZEL TEKLİF", "hide_all_prices": True}}}
    pdf = saas_docs.build_quote_pdf(QUOTE, company)
    text = _pdf_text(pdf)
    if not text:
        return
    assert "ÖZEL TEKLİF" in text
    assert "GENEL TOPLAM" not in text
