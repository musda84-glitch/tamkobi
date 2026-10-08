"""Yerel fatura PDF ALICI bloğunda adres satırları çizilir."""
from unittest.mock import patch

from saas_docs import build_invoice_pdf


def test_build_invoice_pdf_draws_buyer_address():
    drawn = []

    def capture_draw(self, x, y, text):
        drawn.append(str(text))
        return None

    with patch("reportlab.pdfgen.canvas.Canvas.drawString", capture_draw), patch(
        "reportlab.pdfgen.canvas.Canvas.drawRightString", capture_draw
    ):
        pdf = build_invoice_pdf(
            {
                "invoice_number": "F-1",
                "issue_date": "2026-10-08",
                "items": [
                    {
                        "name": "Kalem",
                        "quantity": 1,
                        "unit": "Adet",
                        "unit_price": 10,
                        "vat_rate": 20,
                        "total": 10,
                    }
                ],
                "subtotal": 10,
                "vat_total": 2,
                "grand_total": 12,
            },
            {"name": "Satıcı", "tax_number": "1", "address": "X", "city": "Y"},
            {
                "name": "Alıcı A.Ş.",
                "tax_number_or_id": "1111111111",
                "address": "Cadde No:5",
                "city": "Ankara",
                "phone": "02121234567",
                "email": "a@b.com",
            },
        )
    assert pdf[:4] == b"%PDF"
    assert any("Cadde No:5" in t for t in drawn)
    assert any("Ankara" in t for t in drawn)
    assert any("02121234567" in t for t in drawn)


def test_build_invoice_pdf_falls_back_to_invoice_shipping_address():
    drawn = []

    def capture_draw(self, x, y, text):
        drawn.append(str(text))
        return None

    with patch("reportlab.pdfgen.canvas.Canvas.drawString", capture_draw), patch(
        "reportlab.pdfgen.canvas.Canvas.drawRightString", capture_draw
    ):
        build_invoice_pdf(
            {
                "invoice_number": "F-2",
                "issue_date": "2026-10-08",
                "items": [],
                "subtotal": 0,
                "vat_total": 0,
                "grand_total": 0,
                "shipping_address": "Siparis Adresi 9",
                "city": "İzmir",
                "customer_phone": "05320001122",
                "contact_name": "Misafir",
            },
            {"name": "Satıcı"},
            {"name": "Misafir"},  # no address on contact
        )
    assert any("Siparis Adresi 9" in t for t in drawn)
    assert any("05320001122" in t for t in drawn)
