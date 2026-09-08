"""n11 Faturam SOAP client + settings wiring."""
import asyncio
import base64
import os
import sys
import uuid
from pathlib import Path
from unittest.mock import patch
from xml.etree.ElementTree import fromstring

import pytest
import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import n11faturam


def _env_base():
    try:
        for line in Path("/app/frontend/.env").read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip()
    except Exception:
        pass
    return os.environ.get("REACT_APP_BACKEND_URL") or "http://127.0.0.1:8000"


BASE = _env_base().rstrip("/") + "/api"


def _ticket_xml(ticket="TICKET-ABC"):
    return f"""<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetFormsAuthenticationTicketResponse xmlns="http://tempuri.org/">
      <GetFormsAuthenticationTicketResult>{ticket}</GetFormsAuthenticationTicketResult>
    </GetFormsAuthenticationTicketResponse>
  </soap:Body>
</soap:Envelope>""".encode()


def _send_xml(uuid="AAAA-BBBB", invoice_id="TKB2026000000001"):
    return f"""<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <SendInvoiceDataResponse xmlns="http://tempuri.org/">
      <SendInvoiceDataResult>
        <ServiceResult>Successful</ServiceResult>
        <ServiceResultDescription>OK</ServiceResultDescription>
        <Invoices>
          <InvoiceStateResult>
            <ServiceResult>Successful</ServiceResult>
            <UUID>{uuid}</UUID>
            <InvoiceId>{invoice_id}</InvoiceId>
          </InvoiceStateResult>
        </Invoices>
      </SendInvoiceDataResult>
    </SendInvoiceDataResponse>
  </soap:Body>
</soap:Envelope>""".encode()


def _archive_xml(uuid="CCCC-DDDD", invoice_id="TKB2026000000002"):
    return f"""<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <SendEArchiveDataResponse xmlns="http://tempuri.org/">
      <SendEArchiveDataResult>
        <ServiceResult>Successful</ServiceResult>
        <Invoices>
          <InvoiceStateResult>
            <ServiceResult>Successful</ServiceResult>
            <UUID>{uuid}</UUID>
            <InvoiceId>{invoice_id}</InvoiceId>
          </InvoiceStateResult>
        </Invoices>
      </SendEArchiveDataResult>
    </SendEArchiveDataResponse>
  </soap:Body>
</soap:Envelope>""".encode()


def _check_xml(exist=True, name="Örnek A.Ş.", alias="urn:mail:pk@ornek.com.tr"):
    return f"""<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <CheckCustomerTaxIdResponse xmlns="http://tempuri.org/">
      <CheckCustomerTaxIdResult>
        <ServiceResult>Successful</ServiceResult>
        <CustomerInfoList>
          <EInvoiceCustomerResult>
            <TaxIdOrPersonalId>1234567801</TaxIdOrPersonalId>
            <Alias>{alias}</Alias>
            <Name>{name}</Name>
            <IsExist>{"true" if exist else "false"}</IsExist>
          </EInvoiceCustomerResult>
        </CustomerInfoList>
      </CheckCustomerTaxIdResult>
    </CheckCustomerTaxIdResponse>
  </soap:Body>
</soap:Envelope>""".encode()


class TestN11FaturamUnit:
    def test_gib_invoice_id_pads_internal_numbers(self):
        assert n11faturam.gib_invoice_id("NX202600000012", "2026-09-08") == "TKB2026000000012"
        assert n11faturam.gib_invoice_id("ABC2026000000123", "2026-01-01") == "ABC2026000000123"

    def test_build_ubl_e_invoice_and_archive(self):
        inv = {
            "invoice_number": "NX20260001", "e_type": "e_invoice", "issue_date": "2026-09-08",
            "contact_name": "Örnek Perakende", "subtotal": 100, "vat_total": 20, "grand_total": 120,
            "items": [{"name": "Koltuk", "quantity": 1, "unit_price": 100, "vat_rate": 20, "total": 100, "unit": "Adet"}],
        }
        company = {"name": "TamKobi Demo", "tax_number": "1234567801", "city": "İstanbul", "address": "Cadde 1"}
        contact = {"name": "Örnek Perakende", "tax_number_or_id": "1111111111", "city": "İstanbul"}
        xml, ettn, inv_id = n11faturam.build_ubl(inv, company, contact)
        root = fromstring(xml.encode())
        assert "TICARIFATURA" in xml and ettn and inv_id.startswith("TKB2026")
        assert "1234567801" in xml and "Koltuk" in xml
        assert root is not None
        xml2, _, _ = n11faturam.build_ubl({**inv, "e_type": "e_archive", "contact_tax_id": ""}, company, {"name": "Ali Veli"})
        assert "EARSIVFATURA" in xml2 and "11111111111" in xml2

    def test_parse_ticket_and_send(self):
        assert n11faturam.parse_ticket(_ticket_xml()) == "TICKET-ABC"
        parsed = n11faturam.parse_service_result(n11faturam.parse_soap_xml(_send_xml()), "SendInvoiceDataResult")
        assert parsed["uuid"] == "AAAA-BBBB" and parsed["invoice_id"] == "TKB2026000000001"

    def test_parse_customer_exist(self):
        rows = n11faturam.parse_customer_list(_check_xml(True))
        assert rows[0]["is_exist"] is True and rows[0]["alias"].startswith("urn:")

    def test_send_document_posts_ubl(self):
        settings = {"username": "u", "corporate_code": "CORP1", "mode": "test"}
        calls = []

        async def fake_post(url, action, inner):
            calls.append(action)
            if action == "GetFormsAuthenticationTicket":
                return _ticket_xml()
            if action == "SendInvoiceData":
                assert "FileType>UBL" in inner and "InvoiceRawData" in inner
                raw = inner.split("<InvoiceRawData>")[1].split("</InvoiceRawData>")[0]
                ubl = base64.b64decode(raw).decode()
                assert "TICARIFATURA" in ubl
                return _send_xml()
            raise AssertionError(action)

        with patch.object(n11faturam, "_post", side_effect=fake_post):
            sent = asyncio.run(n11faturam.send_document(
                settings, "secret",
                {"invoice_number": "NX1", "e_type": "e_invoice", "issue_date": "2026-09-08", "items": [], "subtotal": 0, "vat_total": 0, "grand_total": 0, "id": "inv1"},
                {"name": "Alıcı", "tax_number_or_id": "2222222222"},
                {"name": "Satıcı", "tax_number": "1234567801"},
            ))
        assert calls == ["GetFormsAuthenticationTicket", "SendInvoiceData"]
        assert sent["ettn"] == "AAAA-BBBB"
        assert "n11faturam.com" in sent["document_url"]

    def test_send_earchive(self):
        async def fake_post(url, action, inner):
            if action == "GetFormsAuthenticationTicket":
                return _ticket_xml()
            assert action == "SendEArchiveData"
            return _archive_xml()

        with patch.object(n11faturam, "_post", side_effect=fake_post):
            sent = asyncio.run(n11faturam.send_document(
                {"username": "u", "corporate_code": "C", "mode": "test"}, "pw",
                {"invoice_number": "NX2", "e_type": "e_archive", "issue_date": "2026-09-08", "items": [], "id": "x"},
                {"name": "Tüketici"}, {"name": "Satıcı", "tax_number": "1234567801"},
            ))
        assert sent["invoice_id"] == "TKB2026000000002"

    def test_lookup_user(self):
        async def fake_post(url, action, inner):
            if action == "GetFormsAuthenticationTicket":
                return _ticket_xml()
            assert "1234567801" in inner
            return _check_xml(True)

        with patch.object(n11faturam, "_post", side_effect=fake_post):
            r = asyncio.run(
                n11faturam.lookup_user({"username": "u", "corporate_code": "C"}, "pw", "1234567801")
            )
        assert r["is_e_invoice_user"] is True and r["name"] == "Örnek A.Ş."


class TestN11FaturamApi:
    @pytest.fixture(scope="class")
    def client(self):
        s = requests.Session()
        r = s.post(f"{BASE}/auth/login", json={"email": "admin@nexus.com", "password": "admin123"}, timeout=30)
        if r.status_code != 200:
            pytest.skip(f"login failed {r.status_code}")
        return s

    @pytest.fixture(scope="class")
    def company_id(self, client):
        email = f"n11_{uuid.uuid4().hex[:8]}@nexus.test"
        r = client.post(f"{BASE}/system/companies", json={
            "name": "n11 Settings Test",
            "admin_email": email,
            "admin_password": "test1234",
            "plan_id": "plan_standard",
            "trial_days": 7,
        }, timeout=30)
        assert r.status_code == 200, r.text
        cid = r.json()["id"]
        yield cid
        client.delete(f"{BASE}/system/companies/{cid}", timeout=20)

    def test_provider_listed(self, client):
        r = client.get(f"{BASE}/einvoice/providers", timeout=20)
        assert r.status_code == 200
        codes = {p["code"] for p in r.json()}
        assert "n11faturam" in codes
        n11 = next(p for p in r.json() if p["code"] == "n11faturam")
        assert "corporate_code" in n11["fields"]

    def test_save_requires_corporate_code(self, client, company_id):
        a = client.put(f"{BASE}/system/companies/{company_id}/einvoice", json={"provider": "n11faturam"}, timeout=20)
        assert a.status_code == 200, a.text
        r = client.put(f"{BASE}/einvoice/settings", json={
            "company_id": company_id, "username": "u1", "password": "p1", "mode": "test",
        }, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "simulated"
        r2 = client.put(f"{BASE}/einvoice/settings", json={
            "company_id": company_id, "username": "u1", "password": "p1",
            "corporate_code": "CORP-TEST", "mode": "test",
        }, timeout=20)
        assert r2.status_code == 200, r2.text
        d = r2.json()
        assert d["status"] == "configured" and d["corporate_code"] == "CORP-TEST"
        assert d["has_password"] is True and "password" not in d
        client.put(f"{BASE}/system/companies/{company_id}/einvoice", json={"provider": ""}, timeout=20)

    def test_test_endpoint_without_n11_is_400(self, client, company_id):
        a = client.put(f"{BASE}/system/companies/{company_id}/einvoice", json={"provider": "foriba"}, timeout=20)
        assert a.status_code == 200, a.text
        client.put(f"{BASE}/einvoice/settings", json={"company_id": company_id, "username": "x", "password": "y"}, timeout=20)
        r = client.post(f"{BASE}/einvoice/test", params={"company_id": company_id}, timeout=20)
        assert r.status_code == 400
        client.put(f"{BASE}/system/companies/{company_id}/einvoice", json={"provider": ""}, timeout=20)
