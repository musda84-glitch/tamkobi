"""AI sales invoice upload: UBL XML → draft, sales confirm path."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import edocs


UBL_SALES = b"""<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
         xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
         xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>SAT2026000000099</cbc:ID>
  <cbc:UUID>aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee</cbc:UUID>
  <cbc:IssueDate>2026-09-10</cbc:IssueDate>
  <cbc:ProfileID>TICARIFATURA</cbc:ProfileID>
  <cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyIdentification><cbc:ID schemeID="VKN">1111111111</cbc:ID></cac:PartyIdentification>
    <cac:PartyName><cbc:Name>Bizim Firma A.S.</cbc:Name></cac:PartyName>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty><cac:Party>
    <cac:PartyIdentification><cbc:ID schemeID="VKN">2222222222</cbc:ID></cac:PartyIdentification>
    <cac:PartyName><cbc:Name>Musteri Ticaret Ltd.</cbc:Name></cac:PartyName>
    <cac:PostalAddress><cbc:StreetName>Is Cad. 1</cbc:StreetName><cbc:CityName>Istanbul</cbc:CityName></cac:PostalAddress>
    <cac:PartyTaxScheme><cac:TaxScheme><cbc:Name>Kadikoy</cbc:Name></cac:TaxScheme></cac:PartyTaxScheme>
  </cac:Party></cac:AccountingCustomerParty>
  <cac:TaxTotal><cbc:TaxAmount currencyID="TRY">200.00</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="TRY">1000.00</cbc:LineExtensionAmount>
    <cbc:PayableAmount currencyID="TRY">1200.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">2</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="TRY">1000.00</cbc:LineExtensionAmount>
    <cac:TaxTotal><cac:TaxSubtotal><cbc:Percent>20</cbc:Percent></cac:TaxSubtotal></cac:TaxTotal>
    <cac:Item><cbc:Name>Demo Urun</cbc:Name>
      <cac:SellersItemIdentification><cbc:ID>SKU-9</cbc:ID></cac:SellersItemIdentification>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="TRY">500.00</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
</Invoice>"""


def test_parse_ubl_includes_customer_party():
    p = edocs.parse_ubl(UBL_SALES)
    assert p["supplier"]["name"] == "Bizim Firma A.S."
    assert p["customer"]["name"] == "Musteri Ticaret Ltd."
    assert p["customer"]["tax_id"] == "2222222222"
    assert p["currency"] == "TRY"


def test_ubl_to_ai_draft_sales_uses_customer():
    p = edocs.parse_ubl(UBL_SALES)
    d = edocs.ubl_to_ai_draft(p, "sales")
    assert "customer" in d and "supplier" not in d
    assert d["customer"]["name"] == "Musteri Ticaret Ltd."
    assert d["customer"]["tax_number"] == "2222222222"
    assert d["invoice_number"] == "SAT2026000000099"
    assert len(d["items"]) == 1
    assert d["items"][0]["name"] == "Demo Urun"
    assert d["items"][0]["unit"] == "Adet"
    assert abs(d["grand_total"] - 1200) < 0.01
    assert d["source"] == "ubl_xml"
    assert d["confidence"] >= 0.9


def test_ubl_to_ai_draft_purchase_uses_supplier():
    p = edocs.parse_ubl(UBL_SALES)
    d = edocs.ubl_to_ai_draft(p, "purchase")
    assert d["supplier"]["name"] == "Bizim Firma A.S."
    assert "customer" not in d
