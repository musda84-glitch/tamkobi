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


def test_connection_requires_client_code_and_alias():
    with pytest.raises(HTTPException) as e:
        asyncio.get_event_loop().run_until_complete(
            isnet.test_connection({"username": "u", "mode": "test"}, "secret")
        )
    assert e.value.status_code == 400

    with pytest.raises(HTTPException) as e2:
        asyncio.get_event_loop().run_until_complete(
            isnet.test_connection(
                {"username": "u", "corporate_code": "C1", "mode": "test"},
                "secret",
            )
        )
    assert e2.value.status_code == 400
    assert "alias" in e2.value.detail.lower() or "etiket" in e2.value.detail.lower()


def test_login_success_parses_token():
    settings = {
        "username": "demo",
        "corporate_code": "1001",
        "alias": "urn:mail:defaultpk@demo.com",
        "mode": "test",
    }
    payload = {
        "Token": "abcdef123456",
        "Result": 0,
        "Adi": "Ali",
        "Soyadi": "Veli",
        "CompanyList": [{"IdFirma": 1, "FirmaAdi": "Demo AS", "SchemaName": "demo"}],
    }

    class _Resp:
        status_code = 200
        content = b"1"
        text = "ok"

        def json(self):
            return payload

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = AsyncMock(return_value=_Resp())
    mock_client.get = AsyncMock(return_value=MagicMock(status_code=200, text="true"))

    with patch("isnet.httpx.AsyncClient", return_value=mock_client):
        info = asyncio.get_event_loop().run_until_complete(isnet.test_connection(settings, "pw"))
    assert info["ok"] is True
    assert info["client_code"] == "1001"
    assert info["alias"].startswith("urn:")
    assert info["mode"] == "test"


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


def test_isnet_in_providers_and_payload():
    import server

    mapped = server._isnet_payload(
        {
            "test_mode": True,
            "username": "apiuser",
            "client_code": "ISN-9",
            "gib_alias": "urn:mail:pk@x.com",
        }
    )
    assert mapped["mode"] == "test"
    assert mapped["corporate_code"] == "ISN-9"
    assert mapped["alias"] == "urn:mail:pk@x.com"
    assert "isnet" in server.EINVOICE_PROVIDERS
    assert "Net-e" in server.EINVOICE_PROVIDERS["isnet"]["name"] or "IsNet" in server.EINVOICE_PROVIDERS["isnet"]["name"]


def test_company_tax_code_and_soap_serialize():
    assert isnet.company_tax_code({"company_tax_id": "1234567890"}) == "1234567890"
    assert isnet.company_tax_code({}, {"tax_number": "11111111111"}) == "11111111111"
    xml = isnet._serialize_ein(
        {
            "CompanyTaxCode": "1234567890",
            "Invoices": [{"InvoiceContent": "QQ==", "ReceiverTag": "urn:mail:pk@x.com"}],
        }
    )
    assert "<ein:CompanyTaxCode>1234567890</ein:CompanyTaxCode>" in xml
    assert "InvoiceXml" in xml
    assert "ReceiverTag" in xml


def test_address_book_url_follows_mode():
    assert "AddressBookService" in isnet.address_book_url({"mode": "test"})
    assert isnet.address_book_url({"mode": "live"}) == isnet.LIVE_ADDRESS_BOOK
