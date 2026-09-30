"""İşNet Net-e Fatura entegrasyon birim testleri."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

import isnet


def test_api_base_test_vs_live():
    assert isnet.api_base({"mode": "test"}) == isnet.TEST_API
    assert isnet.api_base({"mode": "live"}) == isnet.LIVE_API
    assert isnet.api_base({"mode": "test", "api_url": "https://custom.example/"}) == "https://custom.example"


def test_soap_url_follows_mode():
    assert isnet.soap_url({"mode": "test"}) == isnet.TEST_SOAP
    assert isnet.soap_url({"mode": "live"}) == isnet.LIVE_SOAP


def test_connection_requires_vkn_and_alias():
    with pytest.raises(HTTPException) as e:
        asyncio.get_event_loop().run_until_complete(
            isnet.test_connection({"mode": "test", "alias": "urn:mail:pk@x.com"}, "")
        )
    assert e.value.status_code == 400
    assert "vkn" in e.value.detail.lower() or "tckn" in e.value.detail.lower() or "tax" in e.value.detail.lower()

    with pytest.raises(HTTPException) as e2:
        asyncio.get_event_loop().run_until_complete(
            isnet.test_connection({"mode": "test", "company_tax_id": "4810173324"}, "")
        )
    assert e2.value.status_code == 400
    assert "alias" in e2.value.detail.lower() or "etiket" in e2.value.detail.lower()


def test_connection_soap_ip_vkn_without_password():
    """Resmi SOAP: kullanıcı/şifre yok — HealthCheck + GetCompanyBalance yeterli."""
    settings = {
        "company_tax_id": "4810173324",
        "alias": "urn:mail:defaultpk@demo.com",
        "mode": "test",
    }

    async def _fake_health(_s):
        return "OK"

    async def _fake_balance(_s, tax_code=None):
        return {"balance": "100", "remaining_credit": "100", "message": "OK"}

    with patch("isnet.soap_health_check", side_effect=_fake_health), patch(
        "isnet.get_company_balance", side_effect=_fake_balance
    ):
        info = asyncio.get_event_loop().run_until_complete(isnet.test_connection(settings, ""))
    assert info["ok"] is True
    assert info["auth"] == "ip-vkn"
    assert info["soap_ok"] is True
    assert info["company_tax_id"] == "4810173324"
    assert info["support_email"] == isnet.SUPPORT_EMAIL
    assert info["test_portal"]["user"] == isnet.TEST_PORTAL_USER
    assert "password" not in (info.get("message") or "").lower() or "SOAP" in info["message"]


def test_login_401_raises():
    class _Resp:
        status_code = 401
        content = b""
        text = ""

        def json(self):
            return {}

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = AsyncMock(return_value=_Resp())

    with patch("isnet.httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(HTTPException) as e:
            asyncio.get_event_loop().run_until_complete(
                isnet.login({"username": "bad", "mode": "test"}, "bad")
            )
    assert e.value.status_code == 400


def test_isnet_payload_fields_documented_in_server_source():
    """server.EINVOICE_PROVIDERS['isnet'] IP–VKN alanları (tam import ortam bağımlılığı olmadan)."""
    from pathlib import Path

    src = Path(__file__).resolve().parents[1] / "server.py"
    text = src.read_text(encoding="utf-8")
    assert '"isnet"' in text
    assert "company_tax_id" in text
    assert "efaturadestek@nettefatura.com.tr" in text
    assert "IP–VKN" in text or "IP-VKN" in text


def test_company_tax_code_and_soap_serialize():
    assert isnet.company_tax_code({"company_tax_id": "1234567890"}) == "1234567890"
    assert isnet.company_tax_code({}, {"tax_number": "11111111111"}) == "11111111111"
    assert isnet.company_vendor_number({"company_vendor_number": "42"}) == "42"
    req = isnet._company_request({"company_tax_id": "1234567890", "company_vendor_number": "42"})
    assert req == {"CompanyTaxCode": "1234567890", "CompanyVendorNumber": "42"}
    xml = isnet._serialize_ein(
        {
            "CompanyTaxCode": "1234567890",
            "CompanyVendorNumber": "42",
            "Invoices": [{"InvoiceContent": "QQ==", "ReceiverTag": "urn:mail:pk@x.com"}],
        }
    )
    assert "<ein:CompanyTaxCode>1234567890</ein:CompanyTaxCode>" in xml
    assert "<ein:CompanyVendorNumber>42</ein:CompanyVendorNumber>" in xml
    assert "<ein:Invoice>" in xml  # NetteFatura-API ARRAY_ITEM_NAME_MAP: Invoices -> Invoice
    assert "InvoiceXml" not in xml
    assert "ReceiverTag" in xml


def test_address_book_url_follows_mode():
    assert "AddressBookService" in isnet.address_book_url({"mode": "test"})
    assert isnet.address_book_url({"mode": "live"}) == isnet.LIVE_ADDRESS_BOOK


def test_endpoints_match_official_isnet_docs():
    """İşNet resmi test/canlı SOAP URL’leri (destek e-postası ekindeki döküman)."""
    assert isnet.TEST_SOAP == "https://einvoiceservicetest.isnet.net.tr/InvoiceService/ServiceContract/InvoiceService.svc"
    assert isnet.LIVE_SOAP == "https://einvoiceservice.isnet.net.tr/InvoiceService/ServiceContract/InvoiceService.svc"
    assert isnet.TEST_ADDRESS_BOOK == (
        "https://einvoiceservicetest.isnet.net.tr/AddressBookService/ServiceContract/AddressBookService.svc"
    )
    assert "AddressBookService" in isnet.LIVE_ADDRESS_BOOK
    assert isnet.TEST_API == "https://einvoiceapitest.isnet.net.tr"
    assert isnet.LIVE_API == "https://einvoiceapi.isnet.net.tr"
    assert isnet.TEST_PORTAL == "https://efatura.isnet.net.tr"
    assert isnet.LIVE_PORTAL == "https://nettefatura.isnet.net.tr"
    assert isnet.TEST_PORTAL_USER == "12345678901"
    assert isnet.TEST_FIRM_VKNS == ("4810173324", "1234567805")
