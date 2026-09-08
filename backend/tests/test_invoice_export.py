"""Giden e-Fatura / e-Arşiv XML ve PDF indirme."""
import os
import sys
import uuid
import xml.etree.ElementTree as ET

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


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": "admin@nexus.com", "password": "admin123"}, timeout=20)
    assert r.status_code == 200, r.text
    return s


def _mk(client, **extra):
    payload = {
        "company_id": COMPANY,
        "invoice_type": "sales",
        "e_type": "e_archive",
        "invoice_number": f"EXP-{uuid.uuid4().hex[:10].upper()}",
        "contact_id": "cnt_01",
        "contact_name": "TEST Export Cari",
        "contact_tax_id": "1234567890",
        "status": "draft",
        "issue_date": "2026-09-08",
        "items": [{"name": "TEST Export Kalem", "quantity": 2, "unit": "Adet", "unit_price": 100, "vat_rate": 20, "total": 200}],
    }
    payload.update(extra)
    r = client.post(f"{API}/invoices", json=payload, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


def _cleanup(client, inv_id):
    client.delete(f"{API}/invoices/{inv_id}", timeout=20)


class TestUblBuilder:
    def test_build_and_parse_roundtrip(self):
        import ubl_export
        import edocs
        inv = {
            "_id": str(uuid.uuid4()),
            "invoice_number": "NX202600009999",
            "invoice_type": "sales",
            "e_type": "e_invoice",
            "issue_date": "2026-09-08",
            "contact_name": "Alıcı A.Ş.",
            "contact_tax_id": "6320984412",
            "items": [{"name": "Kalem A", "quantity": 3, "unit": "Adet", "unit_price": 50, "vat_rate": 20, "total": 150}],
            "subtotal": 150, "vat_total": 30, "grand_total": 180,
            "notes": "TEST ubl",
        }
        seller = {"name": "Satıcı Ltd.", "tax_number": "1234567801", "tax_office": "Kadıköy", "city": "İstanbul", "address": "Test Cad. 1", "email": "s@test.com"}
        buyer = {"name": "Alıcı A.Ş.", "tax_number_or_id": "6320984412", "city": "Ankara"}
        xml = ubl_export.build_invoice_ubl(inv, seller, buyer)
        assert xml.startswith(b"<?xml")
        text = xml.decode("utf-8")
        assert "TICARIFATURA" in text
        assert "NX202600009999" in text
        assert "Kalem A" in text
        parsed = edocs.parse_ubl(xml)
        assert parsed["number"] == "NX202600009999"
        assert parsed["profile"] == "TICARIFATURA"
        assert parsed["kind"] == "invoice"
        assert any(l["name"] == "Kalem A" for l in parsed["lines"])
        ET.fromstring(xml)

    def test_earsiv_profile_and_missing_items(self):
        import ubl_export
        inv = {"_id": str(uuid.uuid4()), "invoice_number": "EA-1", "invoice_type": "sales", "e_type": "e_archive",
               "issue_date": "2026-09-01", "subtotal": 10, "vat_total": 2, "grand_total": 12}
        xml = ubl_export.build_invoice_ubl(inv, {"name": "S"}, {"name": "A"}).decode()
        assert "EARSIVFATURA" in xml
        assert ubl_export.is_outgoing_edoc({**inv, "e_type": "paper"}) is False


class TestInvoiceXmlApi:
    def test_e_archive_xml(self, client):
        inv = _mk(client, e_type="e_archive")
        try:
            r = client.get(f"{API}/invoices/{inv['id']}/xml", timeout=20)
            assert r.status_code == 200, r.text
            assert "xml" in (r.headers.get("content-type") or "")
            disp = r.headers.get("content-disposition") or ""
            assert "attachment" in disp
            assert inv["invoice_number"] in r.text or inv["invoice_number"].encode() in r.content
            assert b"Invoice" in r.content
            assert b"EARSIVFATURA" in r.content
        finally:
            _cleanup(client, inv["id"])

    def test_e_invoice_xml(self, client):
        inv = _mk(client, e_type="e_invoice")
        try:
            r = client.get(f"{API}/invoices/{inv['id']}/xml", timeout=20)
            assert r.status_code == 200, r.text
            assert b"TICARIFATURA" in r.content
            assert inv["invoice_number"].encode() in r.content
        finally:
            _cleanup(client, inv["id"])

    def test_paper_xml_rejected(self, client):
        inv = _mk(client, e_type="paper")
        try:
            r = client.get(f"{API}/invoices/{inv['id']}/xml", timeout=20)
            assert r.status_code == 400
            assert "XML" in r.json().get("detail", "")
        finally:
            _cleanup(client, inv["id"])

    def test_purchase_xml_rejected(self, client):
        inv = _mk(client, invoice_type="purchase", e_type="e_invoice")
        try:
            r = client.get(f"{API}/invoices/{inv['id']}/xml", timeout=20)
            assert r.status_code == 400
        finally:
            _cleanup(client, inv["id"])

    def test_xml_not_found(self, client):
        r = client.get(f"{API}/invoices/nonexistent_xxxxx/xml", timeout=20)
        assert r.status_code == 404


class TestInvoicePdfDownload:
    def test_pdf_download_attachment(self, client):
        inv = _mk(client, e_type="e_invoice")
        try:
            inline = client.get(f"{API}/invoices/{inv['id']}/pdf", timeout=20)
            assert inline.status_code == 200
            assert inline.headers.get("content-type", "").startswith("application/pdf")
            assert "inline" in (inline.headers.get("content-disposition") or "")
            assert inline.content[:4] == b"%PDF"
            assert len(inline.content) > 1000
            dl = client.get(f"{API}/invoices/{inv['id']}/pdf", params={"download": 1}, timeout=20)
            assert dl.status_code == 200
            assert "attachment" in (dl.headers.get("content-disposition") or "")
            assert dl.content[:4] == b"%PDF"
        finally:
            _cleanup(client, inv["id"])

    def test_pdf_not_found(self, client):
        r = client.get(f"{API}/invoices/nonexistent_xxxxx/pdf", timeout=20)
        assert r.status_code == 404
