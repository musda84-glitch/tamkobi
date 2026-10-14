"""GİB karekod alanları — oran bazlı kdvmatrah / hesaplanankdv."""
from __future__ import annotations

import os
import sys
import xml.etree.ElementTree as ET

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import ubl_export  # noqa: E402

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
