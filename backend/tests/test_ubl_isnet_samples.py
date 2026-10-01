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
