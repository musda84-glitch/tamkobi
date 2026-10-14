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
      <cac:AdditionalItemIdentification><cbc:ID>8680001234567</cbc:ID></cac:AdditionalItemIdentification>
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
      <cac:AdditionalItemIdentification><cbc:ID>8680009876543</cbc:ID></cac:AdditionalItemIdentification>
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
    assert "Barkod" in html
    assert "8680001234567" in html
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


def test_preview_renders_without_qr_attachment():
    """Önizleme, UBL'de QRCODE eki olmadan İşNet yer tutucusundan karekod basar."""
    xml = _invoice_xml()
    assert b"QRCODE" not in xml
    assert b"EmbeddedDocumentBinaryObject" not in xml
    sources = [
        classic_isnet_xslt("e_invoice"),
        classic_isnet_xslt("e_archive"),
        classic_isnet_xslt("e_dispatch"),
        _designer_xslt("e_invoice"),
        _designer_xslt("e_archive"),
        _designer_xslt("e_dispatch"),
        _designer_xslt("render"),
    ]
    for xslt in sources:
        assert "qrCodeImageString" in xslt
        assert "firmaLogoImageString" in xslt
        assert "firmaImzaImageString" in xslt
        assert "DocumentType='QRCODE'" not in xslt
        assert "DocumentTypeCode='QRCODE'" not in xslt
    html = _transform(classic_isnet_xslt("e_invoice"), xml)
    designer = _transform(_designer_xslt("render"), xml)
    for doc in (html, designer):
        assert doc.strip()
        assert "XSLT derlenemedi" not in doc
        assert _PNG in doc
        assert "qrCodeImageString" not in doc


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
    assert "Barkod" in html
    assert "8680009876543" in html
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


_TICARI = os.path.join(
    os.path.dirname(__file__),
    "fixtures",
    "ubl",
    "isnet_satis_ticari_UUU2026999464749.xml",
)
_UBL = {
    "cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    "cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
}


def _q(prefix: str, tag: str) -> str:
    return f"{{{_UBL[prefix]}}}{tag}"


def _ticari_root():
    parser = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False)
    return etree.fromstring(open(_TICARI, "rb").read(), parser)


def _sub(parent, prefix, tag, text=None, **attrib):
    el = etree.SubElement(parent, _q(prefix, tag), attrib)
    if text is not None:
        el.text = text
    return el


def test_ticari_ubl_renders_percent_payable_and_skips_empty_iban_balance():
    """Gerçek TICARIFATURA örneği: satır KDV TaxSubtotal/Percent, ödenecek tutar; IBAN ve bakiye yok."""
    xslt = _designer_xslt("render")
    assert re.search(r'<xsl:stylesheet\s+version="1\.0"', xslt)
    assert 'version="2.0"' not in xslt.split("<xsl:template", 1)[0]
    html = _transform(xslt, open(_TICARI, "rb").read())
    assert "e-Fatura" in html
    assert "e-Arşiv Fatura" not in html
    assert "%20" in html
    assert "Ödenecek Tutar" in html
    assert "1,20" in html
    assert "BANKA HESAP BİLGİLERİMİZ" not in html
    assert "Güncel bakiye" not in html
    assert ".inv-balance { border:1px solid" not in xslt
    doc = etree.HTML(html)
    assert not doc.xpath("//*[contains(@class, 'inv-foot')]")
    assert "UI-3 RESMİ RED TESTİ (hakedis)" in html
    assert "1.00" not in html


def test_ticari_ubl_discount_payment_balance_archive_qr():
    root = _ticari_root()
    root.find("cbc:ProfileID", _UBL).text = "EARSIVFATURA"
    line = root.find("cac:InvoiceLine", _UBL)
    ac = etree.Element(_q("cac", "AllowanceCharge"))
    _sub(ac, "cbc", "ChargeIndicator", "false")
    _sub(ac, "cbc", "MultiplierFactorNumeric", "0.125")
    _sub(ac, "cbc", "Amount", "0.13", currencyID="TRY")
    line.find("cac:TaxTotal", _UBL).addprevious(ac)

    pm = etree.Element(_q("cac", "PaymentMeans"))
    _sub(pm, "cbc", "PaymentMeansCode", "42")
    acc = _sub(pm, "cac", "PayeeFinancialAccount")
    _sub(acc, "cbc", "ID", "TR330006100519786457841326")
    _sub(acc, "cbc", "Name", "İş Bankası")
    root.find("cac:TaxTotal", _UBL).addprevious(pm)

    bal = etree.Element(_q("cac", "AdditionalDocumentReference"))
    _sub(bal, "cbc", "ID", "4.567,89 TL")
    _sub(bal, "cbc", "IssueDate", "2026-09-30")
    _sub(bal, "cbc", "DocumentTypeCode", "BAKIYE")
    _sub(bal, "cbc", "DocumentType", "BAKIYE")
    root.find("cac:AccountingSupplierParty", _UBL).addprevious(bal)

    xslt = _designer_xslt("render")
    assert "td.inv-foot" in xslt
    assert ".inv-balance { border:1px solid" not in xslt
    assert "qrCodeImageString" in xslt
    assert "firmaLogoImageString" in xslt
    assert "firmaImzaImageString" in xslt
    assert "DocumentType='QRCODE'" not in xslt
    assert "DocumentTypeCode='QRCODE'" not in xslt
    assert b"QRCODE" not in etree.tostring(root)
    html = _transform(xslt, etree.tostring(root))
    assert "e-Arşiv Fatura" in html
    assert "%12,5" in html
    assert "BANKA HESAP BİLGİLERİMİZ" in html
    assert "TR330006100519786457841326" in html
    assert "İş Bankası" in html
    assert "Güncel bakiye" in html
    assert "4.567,89 TL" in html
    doc = etree.HTML(html)
    rows = doc.xpath("//tr[contains(., 'BANKA HESAP') and contains(., 'Güncel bakiye')]")
    assert rows, html
    cells = rows[0].xpath("./td[contains(@class, 'inv-foot')]")
    assert len(cells) == 2
    assert _PNG in html
    assert "qrCodeImageString" not in html


def test_payment_means_without_payee_account_hides_iban_heading():
    root = _ticari_root()
    pm = etree.Element(_q("cac", "PaymentMeans"))
    _sub(pm, "cbc", "PaymentMeansCode", "1")
    root.find("cac:TaxTotal", _UBL).addprevious(pm)
    html = _transform(_designer_xslt("render"), etree.tostring(root))
    assert "BANKA HESAP BİLGİLERİMİZ" not in html


def test_issued_ubl_drops_draft_marker_without_embedded_qr():
    note = "Sipariş No: ORD-100 onayında oluşturuldu (taslak)."
    assert ubl_export.strip_issued_invoice_note(note) == "Sipariş No: ORD-100 onayında oluşturuldu."
    assert "(taslak)" in ubl_export.strip_issued_invoice_note("Müşteri notu (taslak) kalsın")
    inv = {
        "_id": "inv_qr_note",
        "invoice_number": "UUU2026999464749",
        "invoice_type": "sales",
        "e_type": "e_invoice",
        "gib_scenario": "TICARIFATURA",
        "issue_date": "2026-09-30",
        "notes": note,
        "items": [{"name": "UI-3", "quantity": 1.5, "unit": "Adet", "unit_price": 1, "vat_rate": 20, "total": 1}],
        "subtotal": 1,
        "vat_total": 0.2,
        "grand_total": 1.2,
    }
    seller = {"name": "isnet test", "tax_number": "4810173324"}
    buyer = {"name": "İş Net", "tax_number_or_id": "6320984412"}
    xml = ubl_export.build_invoice_ubl(inv, seller, buyer)
    text = xml.decode("utf-8")
    assert "(taslak)" not in text
    assert "oluşturuldu" in text
    assert "QRCODE" not in text
    assert 'filename="qr.png"' not in text
    assert "image/" not in text
    fields = ubl_export.gib_qr_fields(
        inv, seller, buyer,
        profile="TICARIFATURA", currency="TRY", subtotal=1, vat_total=0.2,
        grand=1.2, issue_date="2026-09-30", tip="SATIS",
    )
    assert fields["vkntckn"] == "4810173324"
    assert fields["avkntckn"] == "6320984412"
    assert fields["ettn"]
    assert fields["tarih"] == "2026-09-30"
    assert fields["odenecek"] == "1.20"
    assert fields["senaryo"] == "TICARIFATURA"
