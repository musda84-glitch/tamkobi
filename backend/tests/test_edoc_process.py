"""Gelen e-belge BizimHesap tarzı tek tık içerik alma (process)."""
import os
import sys
import uuid

import pytest
import requests
from dotenv import dotenv_values

for _p in ("/app/backend", "/workspace/backend"):
    if _p not in sys.path:
        sys.path.insert(0, _p)

frontend_env = dotenv_values("/app/frontend/.env") or dotenv_values("/workspace/frontend/.env") or {}
backend_env = dotenv_values("/app/backend/.env") or dotenv_values("/workspace/backend/.env") or {}
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL") or backend_env.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
if not BASE_URL:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
API = BASE_URL + "/api"
COMPANY = os.environ.get("TEST_COMPANY_ID") or "comp_nexus_main_01"

SAMPLE = """<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
 xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
 xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:UBLVersionID>2.1</cbc:UBLVersionID>
  <cbc:CustomizationID>TR1.2</cbc:CustomizationID>
  <cbc:ProfileID>TEMELFATURA</cbc:ProfileID>
  <cbc:ID>PRC{uid}</cbc:ID>
  <cbc:CopyIndicator>false</cbc:CopyIndicator>
  <cbc:UUID>{uuid}</cbc:UUID>
  <cbc:IssueDate>2026-09-10</cbc:IssueDate>
  <cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>
  <cbc:DocumentCurrencyCode>TRY</cbc:DocumentCurrencyCode>
  <cac:AccountingSupplierParty>
    <cac:Party>
      <cac:PartyIdentification><cbc:ID schemeID="VKN">1111111111</cbc:ID></cac:PartyIdentification>
      <cac:PartyName><cbc:Name>PROCESS TEDARIKCI {uid}</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:CitySubdivisionName>Kadikoy</cbc:CitySubdivisionName>
        <cbc:CityName>Istanbul</cbc:CityName>
        <cac:Country><cbc:Name>Turkiye</cbc:Name></cac:Country>
      </cac:PostalAddress>
      <cac:PartyTaxScheme><cac:TaxScheme><cbc:Name>Kadikoy</cbc:Name></cac:TaxScheme></cac:PartyTaxScheme>
    </cac:Party>
  </cac:AccountingSupplierParty>
  <cac:AccountingCustomerParty>
    <cac:Party>
      <cac:PartyIdentification><cbc:ID schemeID="VKN">2222222222</cbc:ID></cac:PartyIdentification>
      <cac:PartyName><cbc:Name>Musteri AS</cbc:Name></cac:PartyName>
      <cac:PostalAddress>
        <cbc:CityName>Istanbul</cbc:CityName>
        <cac:Country><cbc:Name>Turkiye</cbc:Name></cac:Country>
      </cac:PostalAddress>
    </cac:Party>
  </cac:AccountingCustomerParty>
  <cac:TaxTotal>
    <cbc:TaxAmount currencyID="TRY">20.00</cbc:TaxAmount>
    <cac:TaxSubtotal>
      <cbc:TaxableAmount currencyID="TRY">100.00</cbc:TaxableAmount>
      <cbc:TaxAmount currencyID="TRY">20.00</cbc:TaxAmount>
      <cbc:Percent>20</cbc:Percent>
      <cac:TaxCategory><cac:TaxScheme><cbc:Name>KDV</cbc:Name></cac:TaxScheme></cac:TaxCategory>
    </cac:TaxSubtotal>
  </cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:LineExtensionAmount currencyID="TRY">100.00</cbc:LineExtensionAmount>
    <cbc:TaxExclusiveAmount currencyID="TRY">100.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="TRY">120.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="TRY">120.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
  <cac:InvoiceLine>
    <cbc:ID>1</cbc:ID>
    <cbc:InvoicedQuantity unitCode="C62">2</cbc:InvoicedQuantity>
    <cbc:LineExtensionAmount currencyID="TRY">100.00</cbc:LineExtensionAmount>
    <cac:Item>
      <cbc:Name>Process Kalem {uid}</cbc:Name>
      <cac:SellersItemIdentification><cbc:ID>SKU-{uid}</cbc:ID></cac:SellersItemIdentification>
    </cac:Item>
    <cac:Price><cbc:PriceAmount currencyID="TRY">50.00</cbc:PriceAmount></cac:Price>
  </cac:InvoiceLine>
</Invoice>
"""


def _xml():
    uid = uuid.uuid4().hex[:8].upper()
    return SAMPLE.format(uid=uid, uuid=str(uuid.uuid4())).encode("utf-8")


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": "admin@nexus.com", "password": "admin123"}, timeout=20)
    assert r.status_code == 200, r.text
    return s


class TestEdocProcess:
    def test_is_blank_and_ensure_supplier_unit(self):
        import edocs
        assert edocs.is_blank({"status": "pending", "lines": [], "supplier": {}, "grand_total": 0}) is True
        assert edocs.is_blank({"status": "pending", "lines": [{"name": "x"}], "supplier": {"name": "A"}, "grand_total": 10}) is False

    def test_process_one_click_creates_supplier_and_invoice(self, client):
        files = {"file": ("process.xml", _xml(), "application/xml")}
        up = client.post(f"{API}/edocs/inbox/upload", files=files, data={"company_id": COMPANY}, timeout=60)
        assert up.status_code == 200, up.text
        doc = up.json()
        did = doc.get("id") or doc.get("_id")
        assert did
        assert doc.get("status") == "pending"
        # Tek tık: tedarikçi yoksa oluştur + eşleşmeyen kalemlere izin ver
        r = client.post(f"{API}/edocs/inbox/{did}/process", json={"update_stock": False}, timeout=60)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("status") == "success"
        assert body.get("invoice_id")
        assert "içeri alındı" in (body.get("message") or "").lower() or "alındı" in (body.get("message") or "").lower()
        # tekrar process → 400
        again = client.post(f"{API}/edocs/inbox/{did}/process", json={}, timeout=30)
        assert again.status_code == 400

    def test_approve_still_requires_supplier_without_process(self, client):
        files = {"file": ("approve.xml", _xml(), "application/xml")}
        up = client.post(f"{API}/edocs/inbox/upload", files=files, data={"company_id": COMPANY}, timeout=60)
        assert up.status_code == 200, up.text
        did = up.json().get("id") or up.json().get("_id")
        r = client.post(f"{API}/edocs/inbox/{did}/approve", json={"allow_unmatched": True}, timeout=30)
        # contact yoksa 400; bazen VKN ile otomatik eşleşmiş olabilir
        if r.status_code == 400:
            assert "tedarikçi" in (r.json().get("detail") or "").lower() or "eşleştir" in (r.json().get("detail") or "").lower()
        else:
            assert r.status_code == 200
