"""İşNet Net-e Fatura entegrasyon birim testleri."""
from __future__ import annotations

import asyncio
import xml.etree.ElementTree as ET
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
    # Resmi SendInvoiceXml örneği: Invoices → InvoiceXml (Invoice yapısal SendInvoice içindir)
    assert "<ein:InvoiceXml>" in xml
    assert "<ein:Invoice>" not in xml
    assert "ReceiverTag" in xml
    archive_xml = isnet._serialize_ein(
        {
            "CompanyTaxCode": "1234567890",
            "ArchiveInvoices": [{"ArchiveInvoiceContent": "QQ=="}],
        }
    )
    assert "<ein:ArchiveInvoiceXml>" in archive_xml
    assert "<ein:ArchiveInvoice>" not in archive_xml
    assert "ArchiveInvoiceContent" in archive_xml


def test_address_book_url_follows_mode():
    assert "AddressBookService" in isnet.address_book_url({"mode": "test"})
    assert isnet.address_book_url({"mode": "live"}) == isnet.LIVE_ADDRESS_BOOK


def test_send_archive_invoice_xml_requires_ettn():
    """Yanlış dizi sarmalayıcı / boş cevap → ETTN yoksa sent sayılmamalı."""
    settings = {"company_tax_id": "4810173324", "alias": "urn:mail:pk@x.com", "mode": "test"}

    empty = ET.fromstring(
        "<Body xmlns:ein='http://schemas.datacontract.org/2004/07/EInvoice.Service.Model'>"
        "<ein:IsSucceded>true</ein:IsSucceded><ein:Message>OK</ein:Message></Body>"
    )
    with patch("isnet._soap_call", AsyncMock(return_value=empty)):
        with pytest.raises(HTTPException) as e:
            asyncio.get_event_loop().run_until_complete(
                isnet.send_invoice_xml(settings, ubl_xml="<Invoice/>", is_earchive=True)
            )
    assert e.value.status_code == 502
    assert "ETTN" in e.value.detail


def test_send_archive_rejects_non_uuid_ettn():
    """Fatura no / rastgele metin ETTN sayılmaz — NetteFatura kaydı yok."""
    settings = {"company_tax_id": "4810173324", "alias": "urn:mail:pk@x.com", "mode": "test"}
    body = ET.fromstring(
        "<Body xmlns:ein='http://schemas.datacontract.org/2004/07/EInvoice.Service.Model'>"
        "<ein:IsSucceded>true</ein:IsSucceded>"
        "<ein:ArchiveInvoiceResult>"
        "<ein:ETTN>TA202600000095</ein:ETTN>"
        "<ein:IsSucceded>true</ein:IsSucceded>"
        "</ein:ArchiveInvoiceResult></Body>"
    )
    with patch("isnet._soap_call", AsyncMock(return_value=body)):
        with pytest.raises(HTTPException) as e:
            asyncio.get_event_loop().run_until_complete(
                isnet.send_invoice_xml(settings, ubl_xml="<Invoice/>", is_earchive=True)
            )
    assert e.value.status_code == 502
    assert "UUID" in e.value.detail or "ETTN" in e.value.detail


def test_is_ettn_uuid():
    assert isnet.is_ettn_uuid("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
    assert not isnet.is_ettn_uuid("TA202600000095")
    assert not isnet.is_ettn_uuid("")
    assert not isnet.is_ettn_uuid(None)


def test_verify_outgoing_ok_via_viewer():
    settings = {"company_tax_id": "4810173324", "mode": "test"}
    with patch(
        "isnet.get_document_viewer_link",
        AsyncMock(return_value={"url": "https://view.example/doc?key=abc", "html_url": "https://view.example/doc?key=abc", "pdf_url": ""}),
    ):
        info = asyncio.get_event_loop().run_until_complete(
            isnet.verify_outgoing_in_portal(
                settings, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", e_type="e_archive"
            )
        )
    assert info["ok"] is True
    assert info["via"] == "viewer"
    assert "view.example" in info["document_url"]


def test_verify_outgoing_ok_via_search_when_viewer_missing():
    settings = {"company_tax_id": "4810173324", "mode": "test"}
    with patch(
        "isnet.get_document_viewer_link",
        AsyncMock(side_effect=HTTPException(status_code=404, detail="link yok")),
    ), patch(
        "isnet.search_archive_invoice",
        AsyncMock(return_value=[{"ettn": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "invoice_id": "TA1"}]),
    ):
        info = asyncio.get_event_loop().run_until_complete(
            isnet.verify_outgoing_in_portal(
                settings, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", e_type="e_archive"
            )
        )
    assert info["ok"] is True
    assert info["via"] == "search"


def test_verify_outgoing_fails_when_not_in_portal():
    """SOAP ETTN verse bile NetteFatura'da yoksa iletildi sayılmamalı."""
    settings = {"company_tax_id": "4810173324", "mode": "test"}
    with patch(
        "isnet.get_document_viewer_link",
        AsyncMock(side_effect=HTTPException(status_code=404, detail="link yok")),
    ), patch(
        "isnet.search_archive_invoice",
        AsyncMock(return_value=[]),
    ):
        with pytest.raises(HTTPException) as e:
            asyncio.get_event_loop().run_until_complete(
                isnet.verify_outgoing_in_portal(
                    settings, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", e_type="e_archive"
                )
            )
    assert e.value.status_code == 502
    assert "bulunamadı" in e.value.detail.lower() or "NetteFatura" in e.value.detail


def test_send_document_requires_portal_verify():
    """SendArchiveInvoiceXml Success + ETTN → portal doğrulama zorunlu."""
    settings = {"company_tax_id": "4810173324", "alias": "urn:mail:pk@x.com", "mode": "test"}
    invoice = {"e_type": "e_archive", "invoice_number": "TA202600000095"}
    company = {"tax_number": "4810173324"}
    contact = {"name": "Alıcı", "tax_number_or_id": "11111111111"}

    with patch(
        "n11faturam.build_ubl",
        return_value=("<Invoice/>", "local-uuid", "TA202600000095"),
    ), patch(
        "isnet.send_invoice_xml",
        AsyncMock(return_value={
            "ettn": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "invoice_id": "TA202600000095",
            "message": "OK",
            "document_url": "",
        }),
    ), patch(
        "isnet.verify_outgoing_in_portal",
        AsyncMock(side_effect=HTTPException(
            status_code=502,
            detail="İşNet SOAP ETTN döndürdü ancak fatura NetteFatura test/canlı portalında bulunamadı.",
        )),
    ):
        with pytest.raises(HTTPException) as e:
            asyncio.get_event_loop().run_until_complete(
                isnet.send_document(settings, "", invoice, contact, company)
            )
    assert e.value.status_code == 502
    assert "NetteFatura" in e.value.detail


def test_soap_call_surfaces_result_failed():
    """İşNet Result=Failed + ErrorMessage → kullanıcıya net hata (ETTN yok mesajı değil)."""
    settings = {"mode": "test"}
    fault_xml = (
        '<?xml version="1.0"?>'
        '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">'
        "<s:Body>"
        '<SendArchiveInvoiceXmlResponse xmlns="http://tempuri.org/">'
        '<SendArchiveInvoiceXmlResult xmlns:a="http://schemas.datacontract.org/2004/07/EInvoice.Service.Model">'
        "<a:ErrorMessage>gönderim şekli geçersiz</a:ErrorMessage>"
        "<a:Result>Failed</a:Result>"
        "<a:ArchiveInvoices/>"
        "</SendArchiveInvoiceXmlResult>"
        "</SendArchiveInvoiceXmlResponse>"
        "</s:Body></s:Envelope>"
    )

    class _Resp:
        status_code = 200
        text = fault_xml

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = AsyncMock(return_value=_Resp())

    with patch("isnet.httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(HTTPException) as e:
            asyncio.get_event_loop().run_until_complete(
                isnet._soap_call(
                    settings,
                    endpoint=isnet.TEST_SOAP,
                    action="SendArchiveInvoiceXml",
                    service_interface="IInvoiceService",
                    request={"CompanyTaxCode": "4810173324"},
                )
            )
    assert e.value.status_code == 400
    assert "gönderim şekli" in e.value.detail


def test_nested_result_failed_not_masked_by_outer_success():
    """Dış Result=Success + iç ArchiveInvoiceReturn.Result=Failed → hata (sahte iletildi yok)."""
    settings = {"mode": "test"}
    xml = (
        '<?xml version="1.0"?>'
        '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">'
        "<s:Body>"
        '<SendArchiveInvoiceXmlResponse xmlns="http://tempuri.org/">'
        '<SendArchiveInvoiceXmlResult xmlns:a="http://schemas.datacontract.org/2004/07/EInvoice.Service.Model">'
        "<a:IsSucceded>true</a:IsSucceded>"
        "<a:Result>Success</a:Result>"
        "<a:ArchiveInvoices>"
        "<a:ArchiveInvoiceReturn>"
        "<a:ETTN>aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee</a:ETTN>"
        "<a:ErrorMessage>şematron: GONDERIMSEKLI eksik</a:ErrorMessage>"
        "<a:IsSucceded>false</a:IsSucceded>"
        "<a:Result>Failed</a:Result>"
        "</a:ArchiveInvoiceReturn>"
        "</a:ArchiveInvoices>"
        "</SendArchiveInvoiceXmlResult>"
        "</SendArchiveInvoiceXmlResponse>"
        "</s:Body></s:Envelope>"
    )

    class _Resp:
        status_code = 200
        text = xml

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.post = AsyncMock(return_value=_Resp())

    with patch("isnet.httpx.AsyncClient", return_value=mock_client):
        with pytest.raises(HTTPException) as e:
            asyncio.get_event_loop().run_until_complete(
                isnet._soap_call(
                    settings,
                    endpoint=isnet.TEST_SOAP,
                    action="SendArchiveInvoiceXml",
                    service_interface="IInvoiceService",
                    request={"CompanyTaxCode": "4810173324"},
                )
            )
    assert e.value.status_code == 400
    assert "GONDERIMSEKLI" in e.value.detail or "şematron" in e.value.detail.lower()


def test_send_archive_rejects_failed_return_with_ettn():
    """ArchiveInvoiceReturn IsSucceded=false + ETTN → iletildi sayılmamalı."""
    settings = {"company_tax_id": "4810173324", "alias": "urn:mail:pk@x.com", "mode": "test"}
    body = ET.fromstring(
        "<Body xmlns:ein='http://schemas.datacontract.org/2004/07/EInvoice.Service.Model'>"
        "<ein:IsSucceded>true</ein:IsSucceded>"
        "<ein:Result>Success</ein:Result>"
        "<ein:ArchiveInvoiceReturn>"
        "<ein:ETTN>aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee</ein:ETTN>"
        "<ein:ArchiveInvoiceNumber>TA202600000095</ein:ArchiveInvoiceNumber>"
        "<ein:IsSucceded>false</ein:IsSucceded>"
        "<ein:ErrorMessage>posta kutusu bulunamadı</ein:ErrorMessage>"
        "<ein:Result>Failed</ein:Result>"
        "</ein:ArchiveInvoiceReturn></Body>"
    )
    with patch("isnet._soap_call", AsyncMock(return_value=body)):
        with pytest.raises(HTTPException) as e:
            asyncio.get_event_loop().run_until_complete(
                isnet.send_invoice_xml(settings, ubl_xml="<Invoice/>", is_earchive=True)
            )
    assert e.value.status_code == 400
    assert "posta kutusu" in e.value.detail


def test_send_archive_invoice_xml_ok_with_ettn():
    settings = {"company_tax_id": "4810173324", "alias": "urn:mail:pk@x.com", "mode": "test"}
    body = ET.fromstring(
        "<Body xmlns:ein='http://schemas.datacontract.org/2004/07/EInvoice.Service.Model'>"
        "<ein:IsSucceded>true</ein:IsSucceded>"
        "<ein:ArchiveInvoiceResult>"
        "<ein:ETTN>aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee</ein:ETTN>"
        "<ein:ArchiveInvoiceNumber>TA202600000095</ein:ArchiveInvoiceNumber>"
        "<ein:IsSucceded>true</ein:IsSucceded>"
        "</ein:ArchiveInvoiceResult></Body>"
    )
    with patch("isnet._soap_call", AsyncMock(return_value=body)) as mock_call:
        info = asyncio.get_event_loop().run_until_complete(
            isnet.send_invoice_xml(settings, ubl_xml="<Invoice/>", is_earchive=True)
        )
    assert info["ettn"].startswith("aaaaaaaa")
    assert info["invoice_id"] == "TA202600000095"
    kwargs = mock_call.await_args.kwargs
    assert kwargs["action"] == "SendArchiveInvoiceXml"
    req = kwargs["request"]
    assert "ArchiveInvoices" in req
    # serialize uses ArchiveInvoiceXml wrapper
    xml = isnet._serialize_ein(req)
    assert "<ein:ArchiveInvoiceXml>" in xml


def test_send_invoice_xml_rejects_failed_row():
    settings = {"company_tax_id": "4810173324", "alias": "urn:mail:pk@x.com", "mode": "test"}
    body = ET.fromstring(
        "<Body xmlns:ein='http://schemas.datacontract.org/2004/07/EInvoice.Service.Model'>"
        "<ein:IsSucceded>true</ein:IsSucceded>"
        "<ein:InvoiceResult>"
        "<ein:IsSucceded>false</ein:IsSucceded>"
        "<ein:Message>Şema hatası</ein:Message>"
        "</ein:InvoiceResult></Body>"
    )
    with patch("isnet._soap_call", AsyncMock(return_value=body)):
        with pytest.raises(HTTPException) as e:
            asyncio.get_event_loop().run_until_complete(
                isnet.send_invoice_xml(settings, ubl_xml="<Invoice/>", is_earchive=False)
            )
    assert e.value.status_code == 400
    assert "Şema" in e.value.detail


def test_get_document_viewer_link_reads_html_url():
    settings = {"company_tax_id": "4810173324", "mode": "test"}
    body = ET.fromstring(
        "<Body xmlns:ein='http://schemas.datacontract.org/2004/07/EInvoice.Service.Model'>"
        "<ein:IsSucceded>true</ein:IsSucceded>"
        "<ein:HtmlUrl>https://view.example/doc?key=abc%2Fdef</ein:HtmlUrl>"
        "<ein:PdfUrl>https://view.example/pdf?key=abc</ein:PdfUrl>"
        "</Body>"
    )
    with patch("isnet._soap_call", AsyncMock(return_value=body)) as mock_call:
        info = asyncio.get_event_loop().run_until_complete(
            isnet.get_document_viewer_link(settings, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", e_type="e_archive")
        )
    assert info["url"].startswith("https://view.example/doc")
    assert mock_call.await_args.kwargs["action"] == "GetDocumentViewerLink"
    assert isnet.extract_viewer_key(info["url"]) == "abc/def"


def test_download_invoice_pdf_uses_get_invoice_pdf_api():
    settings = {"company_tax_id": "4810173324", "mode": "test"}
    pdf_bytes = b"%PDF-1.4 fake"

    class _Resp:
        status_code = 200
        content = pdf_bytes
        text = ""
        headers = {"content-type": "application/pdf"}

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=_Resp())

    with patch(
        "isnet.get_document_viewer_link",
        AsyncMock(return_value={"url": "https://portal/x?key=tok123", "html_url": "https://portal/x?key=tok123", "pdf_url": ""}),
    ), patch("isnet.httpx.AsyncClient", return_value=mock_client):
        data = asyncio.get_event_loop().run_until_complete(
            isnet.download_invoice_pdf(settings, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
        )
    assert data.startswith(b"%PDF")
    called_url = mock_client.get.await_args.args[0]
    assert "GetInvoicePdf" in called_url
    assert "tok123" in called_url


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
