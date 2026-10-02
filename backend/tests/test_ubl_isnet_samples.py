"""İşNet'ten başarılı GİB UBL örnekleri (SATIS + IADE) — yapı regresyonu."""
from __future__ import annotations

import os
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import ubl_export  # noqa: E402

FIX = Path(__file__).resolve().parent / "fixtures" / "ubl"
CBC = "{urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2}"
CAC = "{urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2}"


def _txt(root, tag):
    el = root.find(f"{CBC}{tag}")
    return (el.text or "").strip() if el is not None and el.text else ""


def test_fixture_satis_ticari_profile():
    root = ET.fromstring((FIX / "isnet_satis_ticari_UUU2026999464749.xml").read_bytes())
    assert _txt(root, "ProfileID") == "TICARIFATURA"
    assert _txt(root, "ID") == "UUU2026999464749"
    assert _txt(root, "InvoiceTypeCode") == "SATIS"
    assert _txt(root, "CustomizationID") == "TR1.2"
    assert _txt(root, "IssueTime")


def test_fixture_iade_temel_billing_reference():
    root = ET.fromstring((FIX / "isnet_iade_temel_UUU2026999464754.xml").read_bytes())
    assert _txt(root, "ProfileID") == "TEMELFATURA"
    assert _txt(root, "ID") == "UUU2026999464754"
    assert _txt(root, "InvoiceTypeCode") == "IADE"
    br = root.find(f"{CAC}BillingReference/{CAC}InvoiceDocumentReference")
    assert br is not None
    assert (br.find(f"{CBC}ID").text or "") == "GHJ2026000002586"
    assert (br.find(f"{CBC}IssueDate").text or "") == "2026-09-29"
    assert (br.find(f"{CBC}DocumentTypeCode").text or "") == "İADE"


def test_builder_matches_satis_shape():
    inv = {
        "_id": "inv_s",
        "invoice_number": "UUU2026999464749",
        "invoice_type": "sales",
        "e_type": "e_invoice",
        "gib_scenario": "TICARIFATURA",
        "issue_date": "2026-09-30",
        "issue_time": "20:45:56",
        "items": [{"name": "UI-3", "quantity": 1, "unit": "Adet", "unit_price": 1, "vat_rate": 20, "total": 1}],
        "subtotal": 1,
        "vat_total": 0.2,
        "grand_total": 1.2,
    }
    seller = {"name": "isnet test", "tax_number": "4810173324", "tax_office": "TUZLA"}
    buyer = {"name": "İş Net", "tax_number_or_id": "4810173324"}
    root = ET.fromstring(ubl_export.build_invoice_ubl(inv, seller, buyer))
    assert _txt(root, "ProfileID") == "TICARIFATURA"
    assert _txt(root, "InvoiceTypeCode") == "SATIS"
    assert _txt(root, "ID") == "UUU2026999464749"
    assert _txt(root, "IssueTime") == "20:45:56"


def test_builder_iade_billing_reference_from_fields():
    inv = {
        "_id": "inv_r",
        "invoice_number": "UUU2026999464754",
        "invoice_type": "sales_return",
        "e_type": "e_invoice",
        "gib_scenario": "TEMELFATURA",
        "issue_date": "2026-10-01",
        "issue_time": "10:54:02",
        "original_invoice_number": "GHJ2026000002586",
        "original_issue_date": "2026-09-29",
        "billing_reference_type": "SFGDFG",
        "notes": "29.09.2026 tarihli GHJ2026000002586 numaralı faturaya istinaden düzenlenen iade faturasıdır.",
        "items": [{"name": "DENEME", "quantity": 1, "unit": "NIU", "unit_price": 3434, "vat_rate": 20, "total": 3434}],
        "subtotal": 3434,
        "vat_total": 686.8,
        "grand_total": 4120.8,
    }
    seller = {"name": "İŞNET", "tax_number": "4810173324"}
    buyer = {"name": "İş Net", "tax_number_or_id": "4810173324"}
    root = ET.fromstring(ubl_export.build_invoice_ubl(inv, seller, buyer))
    assert _txt(root, "ProfileID") == "TEMELFATURA"
    assert _txt(root, "InvoiceTypeCode") == "IADE"
    br = root.find(f"{CAC}BillingReference/{CAC}InvoiceDocumentReference")
    assert br is not None
    assert br.find(f"{CBC}ID").text == "GHJ2026000002586"
    assert br.find(f"{CBC}IssueDate").text == "2026-09-29"
    assert br.find(f"{CBC}DocumentTypeCode").text == "İADE"


def test_builder_iade_billing_reference_from_note():
    inv = {
        "_id": "inv_r2",
        "invoice_number": "UUU1",
        "invoice_type": "return",
        "e_type": "e_invoice",
        "gib_scenario": "TEMELFATURA",
        "issue_date": "2026-10-01",
        "notes": "29.09.2026 tarihli GHJ2026000002586 numaralı faturaya istinaden düzenlenen iade faturasıdır.",
        "items": [{"name": "X", "quantity": 1, "unit_price": 10, "vat_rate": 20, "total": 10}],
        "subtotal": 10,
        "vat_total": 2,
        "grand_total": 12,
    }
    root = ET.fromstring(
        ubl_export.build_invoice_ubl(inv, {"name": "S", "tax_number": "4810173324"}, {"name": "B", "tax_number_or_id": "4810173324"})
    )
    br = root.find(f"{CAC}BillingReference/{CAC}InvoiceDocumentReference")
    assert br is not None
    assert br.find(f"{CBC}ID").text == "GHJ2026000002586"
    assert br.find(f"{CBC}IssueDate").text == "2026-09-29"


def test_outgoing_edoc_includes_return():
    assert ubl_export.is_outgoing_edoc({"invoice_type": "sales_return", "e_type": "e_invoice"}) is True
    assert ubl_export.is_outgoing_edoc({"invoice_type": "return", "e_type": "e_archive"}) is True
    assert ubl_export.is_outgoing_edoc({"invoice_type": "purchase", "e_type": "e_invoice"}) is False


def test_gib_invoice_type_code_from_tamkobi_types():
    assert ubl_export.gib_invoice_type_code({"invoice_type": "sales"}) == "SATIS"
    assert ubl_export.gib_invoice_type_code({"invoice_type": "return"}) == "IADE"
    assert ubl_export.gib_invoice_type_code({"invoice_type": "sales_return"}) == "IADE"
    assert ubl_export.gib_invoice_type_code({"invoice_type": "iade"}) == "IADE"
    assert ubl_export.gib_invoice_type_code({"invoice_type": "İade"}) == "IADE"
    assert ubl_export.gib_invoice_type_code({"gib_invoice_type": "TEVKIFAT"}) == "TEVKIFAT"
    assert ubl_export.gib_invoice_type_code({"invoice_type": "return", "invoice_type_code": "SATIS"}) == "SATIS"
    # Tevkifat seçimi (5/10 – Makine/teçhizat bakım 603) → TEVKIFAT
    assert ubl_export.gib_invoice_type_code({
        "invoice_type": "sales",
        "withholding_rate": 0.5,
        "withholding_code": "603",
    }) == "TEVKIFAT"
    assert ubl_export.gib_invoice_type_code({
        "invoice_type": "return",
        "withholding_rate": 0.5,
        "withholding_code": "603",
    }) == "TEVKIFATIADE"


def test_builder_tevkifat_withholding_tax_total():
    inv = {
        "_id": "inv_t",
        "invoice_number": "U052026000000067",
        "invoice_type": "sales",
        "e_type": "e_invoice",
        "gib_scenario": "TEMELFATURA",
        "issue_date": "2026-10-02",
        "withholding_rate": 0.5,
        "withholding_code": "603",
        "withholding_amount": 0.54,
        "items": [{"name": "Bakım", "quantity": 1, "unit": "Adet", "unit_price": 5.41, "vat_rate": 20, "total": 5.41}],
        "subtotal": 5.41,
        "vat_total": 1.08,
        "grand_total": 5.95,
    }
    seller = {"name": "Demo", "tax_number": "4810173324"}
    buyer = {"name": "İş Net", "tax_number_or_id": "4810173324"}
    root = ET.fromstring(ubl_export.build_invoice_ubl(inv, seller, buyer))
    assert _txt(root, "InvoiceTypeCode") == "TEVKIFAT"
    wtt = root.find(f"{CAC}WithholdingTaxTotal")
    assert wtt is not None
    assert (wtt.find(f"{CBC}TaxAmount").text or "").startswith("0.54")
    code = wtt.find(f".//{CBC}TaxTypeCode")
    assert code is not None and code.text == "603"
    percent = wtt.find(f".//{CBC}Percent")
    assert percent is not None and percent.text in ("50", "50.0")
    line_wtt = root.find(f"{CAC}InvoiceLine/{CAC}WithholdingTaxTotal")
    assert line_wtt is not None


def test_builder_line_tax_subtotal_has_category():
    """İşNet .NET: satır TaxSubtotal.TaxCategory null → Object reference NRE."""
    inv = {
        "_id": "inv_line_tax",
        "invoice_number": "U052026000000099",
        "invoice_type": "sales",
        "e_type": "e_invoice",
        "gib_scenario": "TEMELFATURA",
        "issue_date": "2026-10-02",
        "items": [{"name": "Kalem", "quantity": 2, "unit": "Adet", "unit_price": 10, "vat_rate": 20, "total": 20}],
        "subtotal": 20,
        "vat_total": 4,
        "grand_total": 24,
    }
    root = ET.fromstring(
        ubl_export.build_invoice_ubl(
            inv,
            {"name": "S", "tax_number": "4810173324"},
            {"name": "B", "tax_number_or_id": "4810173324"},
            send_ready=True,
        )
    )
    line_sub = root.find(f"{CAC}InvoiceLine/{CAC}TaxTotal/{CAC}TaxSubtotal")
    assert line_sub is not None
    assert line_sub.find(f"{CBC}TaxableAmount") is not None
    assert line_sub.find(f"{CBC}TaxAmount") is not None
    scheme = line_sub.find(f"{CAC}TaxCategory/{CAC}TaxScheme/{CBC}TaxTypeCode")
    assert scheme is not None and scheme.text == "0015"
    # send_ready party alanları boş bırakılmaz
    buyer_addr = root.find(f"{CAC}AccountingCustomerParty/{CAC}Party/{CAC}PostalAddress")
    assert buyer_addr is not None
    assert buyer_addr.find(f"{CBC}CitySubdivisionName") is not None
    assert buyer_addr.find(f"{CBC}StreetName") is not None
    pts = root.find(
        f"{CAC}AccountingCustomerParty/{CAC}Party/{CAC}PartyTaxScheme/{CAC}TaxScheme/{CBC}Name"
    )
    assert pts is not None


def test_builder_zero_vat_still_has_tax_subtotal():
    inv = {
        "_id": "inv_zero",
        "invoice_number": "U052026000000100",
        "invoice_type": "sales",
        "e_type": "e_invoice",
        "gib_scenario": "TEMELFATURA",
        "issue_date": "2026-10-02",
        "items": [{"name": "İstisna", "quantity": 1, "unit": "Adet", "unit_price": 100, "vat_rate": 0, "total": 100}],
        "subtotal": 100,
        "vat_total": 0,
        "grand_total": 100,
    }
    root = ET.fromstring(
        ubl_export.build_invoice_ubl(
            inv, {"name": "S", "tax_number": "4810173324"}, {"name": "B", "tax_number_or_id": "1234567890"}
        )
    )
    subs = root.findall(f"{CAC}TaxTotal/{CAC}TaxSubtotal")
    assert len(subs) >= 1
    line_cat = root.find(
        f"{CAC}InvoiceLine/{CAC}TaxTotal/{CAC}TaxSubtotal/{CAC}TaxCategory/{CAC}TaxScheme/{CBC}Name"
    )
    assert line_cat is not None and line_cat.text == "KDV"
