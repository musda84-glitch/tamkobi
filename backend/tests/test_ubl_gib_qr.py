"""GİB karekod alanları — oran bazlı kdvmatrah / hesaplanankdv.

İşNet görseli UBL ekine gömmez; karekod XSLT içindeki qrCodeImageString ile gider.
"""
from __future__ import annotations

import base64
import os
import sys
import xml.etree.ElementTree as ET

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import ubl_export  # noqa: E402
from einvoice_classic_xslt import classic_isnet_xslt  # noqa: E402

CAC = "{urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2}"
CBC = "{urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2}"

_EXISTING = (
    "vkntckn",
    "avkntckn",
    "senaryo",
    "tip",
    "tarih",
    "no",
    "ettn",
    "parabirimi",
    "malhizmettoplam",
    "hesaplanankdv",
    "vergidahil",
    "odenecek",
)


def _inv(**extra):
    base = {
        "_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        "invoice_number": "GIB2022000000001",
        "invoice_type": "sales",
        "invoice_type_code": "SATIS",
        "e_type": "e_invoice",
        "gib_scenario": "TEMELFATURA",
        "issue_date": "2022-08-17",
        "currency": "TRY",
        "items": [
            {"name": "A", "quantity": 1, "unit": "Adet", "unit_price": 1000, "vat_rate": 8, "total": 1000},
        ],
        "subtotal": 1000,
        "vat_total": 80,
        "grand_total": 1080,
    }
    base.update(extra)
    return base


def _seller():
    return {"name": "Satıcı A.Ş.", "tax_number": "1111111111"}


def _buyer():
    return {"name": "Alıcı Ltd.", "tax_number_or_id": "2222222222"}


def _fields(inv):
    return ubl_export.gib_qr_fields(
        inv, _seller(), _buyer(),
        profile=inv.get("gib_scenario") or "TEMELFATURA",
        currency=inv.get("currency") or "TRY",
        subtotal=float(inv.get("subtotal") or 0),
        vat_total=float(inv.get("vat_total") or 0),
        grand=float(inv.get("grand_total") or 0),
        issue_date=inv.get("issue_date") or "2022-08-17",
        tip=inv.get("invoice_type_code") or "SATIS",
    )


def test_gib_qr_fields_keep_existing_and_add_rate_keys():
    fields = _fields(_inv())
    for key in _EXISTING:
        assert key in fields, key
    assert fields["vkntckn"] == "1111111111"
    assert fields["avkntckn"] == "2222222222"
    assert fields["senaryo"] == "TEMELFATURA"
    assert fields["tip"] == "SATIS"
    assert fields["tarih"] == "2022-08-17"
    assert fields["no"] == "GIB2022000000001"
    assert fields["ettn"] == "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    assert fields["parabirimi"] == "TRY"
    assert fields["malhizmettoplam"] == "1000.00"
    assert fields["hesaplanankdv"] == "80.00"
    assert fields["vergidahil"] == "1080.00"
    assert fields["odenecek"] == "1080.00"
    assert fields["kdvmatrah(8)"] == "1000.00"
    assert fields["hesaplanankdv(8)"] == "80.00"


def test_gib_qr_fields_sum_tax_subtotals_per_rate():
    inv = _inv(
        items=[
            {"name": "A20", "quantity": 1, "unit_price": 100, "vat_rate": 20, "total": 100},
            {"name": "B20", "quantity": 1, "unit_price": 50, "vat_rate": 20, "total": 50},
            {"name": "C10", "quantity": 2, "unit_price": 100, "vat_rate": 10, "total": 200},
            {"name": "D1", "quantity": 1, "unit_price": 100, "vat_rate": 1, "total": 100},
        ],
        subtotal=450,
        vat_total=51,
        grand_total=501,
    )
    fields = _fields(inv)
    assert fields["kdvmatrah(20)"] == "150.00"
    assert fields["hesaplanankdv(20)"] == "30.00"
    assert fields["kdvmatrah(10)"] == "200.00"
    assert fields["hesaplanankdv(10)"] == "20.00"
    assert fields["kdvmatrah(1)"] == "100.00"
    assert fields["hesaplanankdv(1)"] == "1.00"
    assert "kdvmatrah(8)" not in fields
    for key in _EXISTING:
        assert key in fields


def test_gib_qr_rate_fields_match_ubl_line_tax_subtotals():
    inv = _inv(
        items=[
            {"name": "A20", "quantity": 1, "unit_price": 100, "vat_rate": 20, "total": 100},
            {"name": "B20", "quantity": 1, "unit_price": 50, "vat_rate": 20, "total": 50},
            {"name": "C10", "quantity": 1, "unit_price": 200, "vat_rate": 10, "total": 200},
        ],
        subtotal=350,
        vat_total=50,
        grand_total=400,
    )
    xml = ubl_export.build_invoice_ubl(inv, _seller(), _buyer())
    root = ET.fromstring(xml)
    line_subs = root.findall(f".//{CAC}InvoiceLine/{CAC}TaxTotal/{CAC}TaxSubtotal")
    assert len(line_subs) == 3
    summed: dict[str, tuple[float, float]] = {}
    for sub in line_subs:
        rate = ubl_export._qr_rate_key(float((sub.find(f"{CBC}Percent").text or "0")))
        matrah = float((sub.find(f"{CBC}TaxableAmount").text or "0"))
        kdv = float((sub.find(f"{CBC}TaxAmount").text or "0"))
        prev = summed.get(rate, (0.0, 0.0))
        summed[rate] = (round(prev[0] + matrah, 2), round(prev[1] + kdv, 2))
    fields = _fields(inv)
    assert fields["kdvmatrah(20)"] == f"{summed['20'][0]:.2f}"
    assert fields["hesaplanankdv(20)"] == f"{summed['20'][1]:.2f}"
    assert fields["kdvmatrah(10)"] == f"{summed['10'][0]:.2f}"
    assert fields["hesaplanankdv(10)"] == f"{summed['10'][1]:.2f}"
    assert fields["kdvmatrah(20)"] == "150.00"
    assert fields["hesaplanankdv(20)"] == "30.00"
    assert fields["malhizmettoplam"] == "350.00"


def test_gib_qr_rate_key_integer_format():
    assert ubl_export._qr_rate_key(20.0) == "20"
    assert ubl_export._qr_rate_key(8) == "8"
    assert ubl_export._qr_rate_key(10.5) == "10.5"


_NS = {
    "cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
    "cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
}
_VISUAL = {"QRCODE", "KAREKOD", "LOGO", "IMZA"}
_XSLT = (
    '<?xml version="1.0" encoding="UTF-8"?>'
    '<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">'
    '<xsl:template match="/"><html><img alt="QrCode" src="data:image/jpeg;base64,qrCodeImageString"/>'
    '<img alt="Firma Logo" src="data:image/jpeg;base64,firmaLogoImageString"/>'
    '<img alt="E-Imza Logo" src="data:image/jpeg;base64,firmaImzaImageString"/>'
    "</html></xsl:template></xsl:stylesheet>"
)


def _fold(value: str) -> str:
    return "".join((value or "").strip().upper().replace("İ", "I").split())


def _assert_xslt_only(xml: bytes, filename: str) -> None:
    root = ET.fromstring(xml)
    blobs = []
    for adr in root.findall("cac:AdditionalDocumentReference", _NS):
        for tag in ("DocumentType", "DocumentTypeCode", "ID"):
            token = _fold(adr.findtext(f"cbc:{tag}", default="", namespaces=_NS) or "")
            assert token not in _VISUAL, token
        blob = adr.find("cac:Attachment/cbc:EmbeddedDocumentBinaryObject", _NS)
        if blob is None:
            continue
        blobs.append(blob)
        mime = (blob.get("mimeCode") or "").lower()
        assert not mime.startswith("image/"), mime
        assert mime == "application/xml"
        assert (blob.get("filename") or "").lower().endswith(".xslt")
    assert len(blobs) == 1
    assert blobs[0].get("filename") == filename
    raw = base64.b64decode(blobs[0].text or "")
    assert b"qrCodeImageString" in raw
    assert b"firmaLogoImageString" in raw
    assert b"firmaImzaImageString" in raw
    assert b"<xsl:stylesheet" in raw


def _sales(**extra):
    inv = _inv()
    inv.update(extra)
    return inv


@pytest.mark.parametrize(
    "e_type,profile,filename",
    [
        ("e_invoice", "TICARIFATURA", "efatura.xslt"),
        ("e_archive", "EARSIVFATURA", "earsiv.xslt"),
    ],
)
def test_send_ready_ubl_embeds_xslt_not_images(e_type, profile, filename):
    xml = ubl_export.build_invoice_ubl(
        _sales(e_type=e_type, gib_scenario=profile),
        _seller(),
        _buyer(),
        send_ready=True,
        xslt=_XSLT,
    )
    text = xml.decode("utf-8")
    assert "QRCODE" not in text
    assert "qr.png" not in text
    assert 'mimeCode="image/' not in text
    _assert_xslt_only(xml, filename)
    ubl_export.assert_send_ready_has_no_visuals(ET.fromstring(xml))


def test_send_ready_invoice_without_xslt_has_no_embedded_object():
    xml = ubl_export.build_invoice_ubl(_sales(), _seller(), _buyer(), send_ready=True)
    root = ET.fromstring(xml)
    assert root.findall(".//cbc:EmbeddedDocumentBinaryObject", _NS) == []
    assert "QRCODE" not in xml.decode("utf-8")
    ubl_export.assert_send_ready_has_no_visuals(root)


def test_send_ready_despatch_embeds_xslt_not_images():
    inv = _sales(
        invoice_number="IRS2026000000001",
        e_type="e_dispatch",
        despatch_plate="34ABC123",
    )
    xml = ubl_export.build_despatch_ubl(
        inv, _seller(), _buyer(), send_ready=True, xslt=classic_isnet_xslt("e_dispatch"),
    )
    _assert_xslt_only(xml, "eirsaliye.xslt")
    text = xml.decode("utf-8")
    assert "QRCODE" not in text
    assert 'mimeCode="image/' not in text
    ubl_export.assert_send_ready_has_no_visuals(ET.fromstring(xml))


def _adr(root, *, doc_type="", doc_code="", doc_id="EK-1", mime=None, filename=None):
    adr = ET.SubElement(root, f"{{{_NS['cac']}}}AdditionalDocumentReference")
    ET.SubElement(adr, f"{{{_NS['cbc']}}}ID").text = doc_id
    if doc_type:
        ET.SubElement(adr, f"{{{_NS['cbc']}}}DocumentType").text = doc_type
    if doc_code:
        ET.SubElement(adr, f"{{{_NS['cbc']}}}DocumentTypeCode").text = doc_code
    if mime is not None:
        att = ET.SubElement(adr, f"{{{_NS['cac']}}}Attachment")
        blob = ET.SubElement(att, f"{{{_NS['cbc']}}}EmbeddedDocumentBinaryObject")
        blob.set("mimeCode", mime)
        if filename:
            blob.set("filename", filename)
        blob.text = "AAAA"
    return adr


def test_send_ready_guard_rejects_visual_references():
    cases = [
        dict(doc_type="QRCODE", mime="image/png", filename="qr.png"),
        dict(doc_type="KAREKOD"),
        dict(doc_type="Logo"),
        dict(doc_type="İmza"),
        dict(doc_code="QRCODE", doc_id="ek"),
        dict(doc_id="QRCODE", doc_type="EK"),
        dict(doc_type="EK", mime="image/jpeg", filename="logo.jpg"),
        dict(doc_type="EK", mime="application/pdf", filename="ek.pdf"),
        dict(doc_type="XSLT", mime="application/xml", filename="stil.xml"),
        dict(doc_type="XSLT", mime="text/xml", filename="efatura.xslt"),
        dict(doc_type="EK", mime="application/xml", filename="efatura.xslt"),
    ]
    for case in cases:
        root = ET.Element("Invoice")
        _adr(root, **case)
        with pytest.raises(ValueError, match="XSLT şablonu"):
            ubl_export.assert_send_ready_has_no_visuals(root)


def test_send_ready_guard_allows_xslt_and_plain_references():
    root = ET.Element("Invoice")
    _adr(root, doc_type="GONDERIMSEKLI", doc_id="11111111-1111-1111-1111-111111111111")
    _adr(root, doc_type="İrsaliye", doc_code="IRSALIYE", doc_id="IRS1")
    _adr(
        root,
        doc_type="XSLT",
        doc_id="22222222-2222-2222-2222-222222222222",
        mime="application/xml",
        filename="efatura.xslt",
    )
    ubl_export.assert_send_ready_has_no_visuals(root)


def test_build_invoice_ubl_send_ready_blocks_injected_qr(monkeypatch):
    real = ubl_export.attach_xslt_stylesheet

    def wrapped(root, xslt, issue_date, filename="efatura.xslt"):
        real(root, xslt, issue_date, filename=filename)
        adr = ubl_export._cac(root, "AdditionalDocumentReference")
        ubl_export._cbc(adr, "ID", "QRCODE")
        ubl_export._cbc(adr, "DocumentTypeCode", "QRCODE")
        ubl_export._cbc(adr, "DocumentType", "QRCODE")
        att = ubl_export._cac(adr, "Attachment")
        ubl_export._cbc(
            att, "EmbeddedDocumentBinaryObject", "AAAA",
            mimeCode="image/png", filename="qr.png",
        )

    monkeypatch.setattr(ubl_export, "attach_xslt_stylesheet", wrapped)
    with pytest.raises(ValueError, match="görsel"):
        ubl_export.build_invoice_ubl(
            _sales(), _seller(), _buyer(), send_ready=True, xslt=_XSLT,
        )


def test_build_despatch_ubl_send_ready_blocks_injected_logo(monkeypatch):
    real = ubl_export.attach_xslt_stylesheet

    def wrapped(root, xslt, issue_date, filename="efatura.xslt"):
        real(root, xslt, issue_date, filename=filename)
        adr = ubl_export._cac(root, "AdditionalDocumentReference")
        ubl_export._cbc(adr, "DocumentType", "LOGO")
        att = ubl_export._cac(adr, "Attachment")
        ubl_export._cbc(
            att, "EmbeddedDocumentBinaryObject", "AAAA",
            mimeCode="image/jpeg", filename="logo.jpg",
        )

    monkeypatch.setattr(ubl_export, "attach_xslt_stylesheet", wrapped)
    inv = _sales(invoice_number="IRS2026000000002", despatch_plate="06XYZ789")
    with pytest.raises(ValueError, match="XSLT"):
        ubl_export.build_despatch_ubl(
            inv, _seller(), _buyer(), send_ready=True, xslt=_XSLT,
        )
