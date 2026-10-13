"""Klasik ve tasarım modülünün ürettiği XSLT ile örnek UBL → HTML/PDF."""
import base64
import gzip
import io
import os
import re
import subprocess
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from lxml import etree

from einvoice_classic_xslt import classic_isnet_xslt
import einvoice_designs as ed
import ubl_export

_PNG = (
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
_JS = os.path.join(os.path.dirname(__file__), "js")


def _apply_isnet_placeholders(xslt: str) -> str:
    """İşNet, render anında bu dizeleri gerçek görsellerle değiştirir."""
    return (
        xslt.replace("IsLogoExistsValue", "true")
        .replace("IsEimzaLogoExistsValue", "true")
        .replace("firmaLogoImageString", _PNG)
        .replace("firmaImzaImageString", _PNG)
        .replace("qrCodeImageString", _PNG)
    )


def _invoice_xml(*, unit_code: str = "C62") -> bytes:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>TR1.2</cbc:CustomizationID>
  <cbc:ProfileID>TICARIFATURA</cbc:ProfileID>
  <cbc:ID>GIB2026000000001</cbc:ID>
  <cbc:UUID>aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee</cbc:UUID>
  <cbc:IssueDate>2026-10-13</cbc:IssueDate>
  <cbc:IssueTime>14:30:00</cbc:IssueTime>
  <cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>
  <cbc:Note>Teslim notu: depo kapısı</cbc:Note>
  <cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification><cbc:ID schemeID="VKN">1234567890</cbc:ID></cac:PartyIdentification>
      <cac:PartyName><cbc:Name>Satıcı A.Ş.</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>Atatürk Cad. No:1 Kadıköy / İstanbul</cbc:StreetName>
        <cbc:BuildingNumber>1</cbc:BuildingNumber>
        <cbc:CitySubdivisionName>Kadıköy</cbc:CitySubdivisionName>
        <cbc:CityName>İstanbul</cbc:CityName>
        <cac:Country><cbc:Name>Türkiye</cbc:Name></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme><cac:TaxScheme><cbc:Name>Kadıköy</cbc:Name></cac:TaxScheme></cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification><cbc:ID schemeID="TCKN">11111111111</cbc:ID></cac:PartyIdentification>
      <cac:PartyName><cbc:Name>Alıcı Ltd.</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>İnönü Bulvarı</cbc:StreetName>
        <cbc:BuildingNumber>2</cbc:BuildingNumber>
        <cbc:CitySubdivisionName>Çankaya</cbc:CitySubdivisionName>
        <cbc:CityName>Ankara</cbc:CityName>
        <cac:Country><cbc:Name>Türkiye</cbc:Name></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme><cac:TaxScheme><cbc:Name>Çankaya</cbc:Name></cac:TaxScheme></cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:PaymentMeans>
    <cbc:PaymentMeansCode>42</cbc:PaymentMeansCode>
    <cac:PayeeFinancialAccount>
      <cbc:ID>TR330006100519786457841326</cbc:ID>
      <cbc:CurrencyCode>TRY</cbc:CurrencyCode>
      <cac:FinancialInstitutionBranch><cbc:Name>İş Bankası</cbc:Name></cac:FinancialInstitutionBranch>
    </cac:PayeeFinancialAccount>
  </cac:PaymentMeans>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="TRY">2000.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="TRY">10000.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="TRY">2000.00</cbc:TaxAmount>
      <cbc:Percent>20</cbc:Percent>
      <cac:TaxCategory><cac:TaxScheme><cbc:Name>KDV</cbc:Name><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="TRY">10000.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="TRY">10000.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="TRY">12000.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="TRY">12000.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="{unit_code}">2</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="TRY">10000.00</cbc:LineExtensionAmount>
    <cac:TaxTotal>
      <cbc:TaxAmount currencyID="TRY">2000.00</cbc:TaxAmount>
      <cac:TaxSubtotal>
        <cbc:TaxableAmount currencyID="TRY">10000.00</cbc:TaxableAmount>
        <cbc:TaxAmount currencyID="TRY">2000.00</cbc:TaxAmount>
        <cbc:Percent>20</cbc:Percent>
        <cac:TaxCategory><cac:TaxScheme><cbc:Name>KDV</cbc:Name><cbc:TaxTypeCode>0015</cbc:TaxTypeCode></cac:TaxScheme></cac:TaxCategory>
      </cac:TaxSubtotal>
    </cac:TaxTotal>
    <cac:Item>
      <cbc:Name>Yazlık Ürün</cbc:Name>
      <cac:SellersItemIdentification><cbc:ID>YZL-001</cbc:ID></cac:SellersItemIdentification>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="TRY">5000.00</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
</Invoice>
""".encode()


def _despatch_xml() -> bytes:
    return """<?xml version="1.0" encoding="UTF-8"?>
<DespatchAdvice xmlns="urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>TR1.2.1</cbc:CustomizationID>
  <cbc:ProfileID>TEMELIRSALIYE</cbc:ProfileID>
  <cbc:ID>IRS2026000000001</cbc:ID>
  <cbc:UUID>bbbbbbbb-cccc-dddd-eeee-ffffffffffff</cbc:UUID>
  <cbc:IssueDate>2026-10-13</cbc:IssueDate>
  <cac:DespatchSupplierParty>
    <cac:Party>
      <cac:PartyIdentification><cbc:ID schemeID="VKN">1234567890</cbc:ID></cac:PartyIdentification>
      <cac:PartyName><cbc:Name>Sevkiyat A.Ş.</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>Liman Yolu 4</cbc:StreetName>
        <cbc:CityName>İzmir</cbc:CityName>
        <cac:Country><cbc:Name>Türkiye</cbc:Name></cac:Country>
      </cac:PostalAddress>
    </cac:Party>
  </cac:DespatchSupplierParty>
  <cac:DeliveryCustomerParty>
    <cac:Party>
      <cac:PartyIdentification><cbc:ID schemeID="VKN">0987654321</cbc:ID></cac:PartyIdentification>
      <cac:PartyName><cbc:Name>Depo Ltd.</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:StreetName>Organize Sanayi</cbc:StreetName>
        <cbc:CityName>Bursa</cbc:CityName>
        <cac:Country><cbc:Name>Türkiye</cbc:Name></cac:Country>
      </cac:PostalAddress>
    </cac:Party>
  </cac:DeliveryCustomerParty>
  <cac:DespatchLine>
    <cbc:ID>1</cbc:ID>
    <cbc:DeliveredQuantity unitCode="NIU">3</cbc:DeliveredQuantity>
    <cac:Item>
      <cbc:Name>Palet</cbc:Name>
      <cac:SellersItemIdentification><cbc:ID>PLT-9</cbc:ID></cac:SellersItemIdentification>
    </cac:Item>
  </cac:DespatchLine>
</DespatchAdvice>
""".encode()


def _designer_xslt(kind: str) -> str:
    proc = subprocess.run(
        [
            "node",
            "--import",
            os.path.join(_JS, "register.mjs"),
            os.path.join(_JS, "dump-classic-xslt.mjs"),
            kind,
        ],
        cwd=_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    text = proc.stdout
    assert text.lstrip().startswith("<?xml")
    assert "TAMKOBI_LAYOUT" in text
    assert text.index("<?xml") < text.index("TAMKOBI_LAYOUT")
    return text


def _transform(xslt: str, xml: bytes) -> str:
    rendered = _apply_isnet_placeholders(xslt)
    ed.validate_xslt(rendered)
    parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False)
    doc = etree.fromstring(rendered.encode("utf-8"), parser)
    transform = etree.XSLT(doc, access_control=etree.XSLTAccessControl.DENY_ALL)
    result = transform(etree.fromstring(xml, parser))
    html = str(result)
    assert html.strip()
    assert "XSLT derlenemedi" not in html
    return html


def _html_to_pdf(html: str) -> bytes:
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.pdfgen import canvas

    text = re.sub(r"<style[\s\S]*?</style>", " ", html, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    font = "DejaVu"
    pdfmetrics.registerFont(TTFont(font, "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
    buf = io.BytesIO()
    c = canvas.Canvas(buf, pagesize=A4, pageCompression=0)
    c.setTitle("e-Fatura onizleme")
    c.setFont(font, 8)
    y = 820
    for chunk in (text[i : i + 95] for i in range(0, min(len(text), 6000), 95)):
        c.drawString(36, y, chunk)
        y -= 11
        if y < 40:
            c.showPage()
            c.setFont(font, 8)
            y = 820
    # Standart font, HTML'den çıkan ASCII alanları içerik akışına düz yazar.
    c.showPage()
    c.setFont("Helvetica", 10)
    y = 800
    for token in ("GIB2026000000001", "YZL-001", "TR330006100519786457841326", "2.000,00"):
        if token in text:
            c.drawString(36, y, token)
            y -= 16
    c.save()
    return buf.getvalue()


def _assert_invoice(html: str):
    assert "qrCodeImageString" not in html
    assert "firmaLogoImageString" not in html
    assert "firmaImzaImageString" not in html
    assert "IsLogoExistsValue" not in html
    assert "IsEimzaLogoExistsValue" not in html
    assert html.count(_PNG) >= 2
    assert "Satıcı A.Ş." in html
    assert "Alıcı Ltd." in html
    assert "GIB2026000000001" in html
    assert "YZL-001" in html
    assert "Yazlık Ürün" in html
    assert "AÇIKLAMALAR" in html
    assert "Teslim notu: depo kapısı" in html
    assert "BANKA HESAP BİLGİLERİMİZ" in html
    assert "TR330006100519786457841326" in html
    assert "Stok Kodu" in html
    assert "KDV Tutarı" in html
    assert "white-space:nowrap" in html
    assert ">Adet<" in html
    assert "Adet(Unit)" not in html
    assert "(Unit)" not in html
    assert "Açıklama" not in html
    assert "2.000,00" in html
    kdv = html.split("KDV Tutarı", 1)[1][:400]
    assert "2.000,00" in kdv.replace("\n", "")
    assert html.count("Atatürk Cad. No:1 Kadıköy / İstanbul") == 1
    assert "No:1 No:" not in html
    assert "Kadıköy / İstanbul Kadıköy" not in html
    assert html.count("İnönü Bulvarı No:2 Çankaya / Ankara") == 1


@pytest.mark.parametrize("kind", ["e_invoice", "e_archive"])
@pytest.mark.parametrize("source", ["classic", "designer"])
def test_invoice_html_placeholders_fields_and_address(kind, source):
    xslt = classic_isnet_xslt(kind) if source == "classic" else _designer_xslt(kind)
    assert "qrCodeImageString" in xslt
    assert "firmaLogoImageString" in xslt
    assert "firmaImzaImageString" in xslt
    assert "IsLogoExistsValue" in xslt
    assert "IsEimzaLogoExistsValue" in xslt
    html = _transform(xslt, _invoice_xml())
    _assert_invoice(html)
    if source == "classic" and kind == "e_archive":
        assert "e-ARŞİV" in html


def test_unit_parenthetical_code_prints_turkish_only():
    for source in (classic_isnet_xslt("e_invoice"), _designer_xslt("e_invoice")):
        html = _transform(source, _invoice_xml(unit_code="Adet(Unit)"))
        assert ">Adet<" in html
        assert "Adet(Unit)" not in html


def test_description_column_appears_only_when_a_line_has_text():
    noted = _invoice_xml().replace(
        b"<cac:Item>",
        b"<cbc:Note>Renk: lacivert</cbc:Note><cac:Item>",
        1,
    )
    for source in (classic_isnet_xslt("e_invoice"), _designer_xslt("e_invoice")):
        hidden = _transform(source, _invoice_xml())
        shown = _transform(source, noted)
        assert "Açıklama" not in hidden
        assert "Açıklama" in shown
        assert "Renk: lacivert" in shown


@pytest.mark.parametrize("source", ["classic", "designer"])
def test_despatch_html_uses_delivered_quantity_and_placeholders(source):
    xslt = classic_isnet_xslt("e_dispatch") if source == "classic" else _designer_xslt("e_dispatch")
    html = _transform(xslt, _despatch_xml())
    assert "Sevkiyat A.Ş." in html
    assert "Depo Ltd." in html
    assert "IRS2026000000001" in html
    assert "PLT-9" in html
    assert "Palet" in html
    assert ">Adet<" in html
    assert _PNG in html
    assert html.count("Liman Yolu 4") == 1
    assert "Açıklama" not in html


def test_rendered_html_becomes_pdf_with_key_fields():
    html = _transform(classic_isnet_xslt("e_invoice"), _invoice_xml())
    designer = _transform(_designer_xslt("e_invoice"), _invoice_xml())
    for doc in (html, designer):
        pdf = _html_to_pdf(doc)
        assert pdf.startswith(b"%PDF")
        assert len(pdf) > 800
        for token in ("GIB2026000000001", "YZL-001", "TR330006100519786457841326"):
            assert token.encode("ascii") in pdf


def test_attach_uses_plain_base64_and_rejects_oversize(monkeypatch):
    xslt = classic_isnet_xslt("e_invoice")
    inv = {
        "_id": "inv_xslt_plain",
        "invoice_number": "TAS2026000001",
        "invoice_type": "sales",
        "e_type": "e_invoice",
        "issue_date": "2026-10-13",
        "items": [{"name": "Kalem", "quantity": 1, "unit_price": 10, "vat_rate": 20, "total": 10}],
        "subtotal": 10,
        "vat_total": 2,
        "grand_total": 12,
    }
    seller = {"name": "Satıcı", "tax_number": "1234567801", "city": "İstanbul", "address": "Cad 1"}
    buyer = {"name": "Alıcı", "tax_number_or_id": "6320984412", "city": "Ankara"}
    xml = ubl_export.build_invoice_ubl(inv, seller, buyer, xslt=xslt)
    root = etree.fromstring(xml)
    ns = {"cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2"}
    blob = root.findtext(".//cbc:EmbeddedDocumentBinaryObject", namespaces=ns)
    raw = base64.b64decode(blob)
    with pytest.raises(gzip.BadGzipFile):
        gzip.decompress(raw)
    assert b"qrCodeImageString" in raw
    assert b"partyAddress" in raw

    monkeypatch.setattr(ed, "MAX_XSLT_BYTES", 40)
    with pytest.raises(ValueError, match="sınır"):
        ed.plain_xslt_b64(xslt)
    bare = ubl_export.build_invoice_ubl(inv, seller, buyer)
    with pytest.raises(ValueError, match="sınır"):
        ubl_export.attach_xslt_stylesheet(
            ubl_export.ET.fromstring(bare),
            xslt,
            "2026-10-13",
        )
