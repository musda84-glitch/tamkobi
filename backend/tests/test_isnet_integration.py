"""İşNet Net-e Fatura entegrasyon birim testleri."""
from __future__ import annotations

import asyncio
import os
import xml.etree.ElementTree as ET
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi import HTTPException

import isnet


def test_resolve_gib_transmission_status_prefers_detail_1300():
    out = isnet.resolve_gib_transmission_status(
        detail_status="Basariyla_Tamamlandi",
        process_status="Imza_Bekliyor",
    )
    assert out["status"] == "Başarıyla Tamamlandı"
    assert out["status_code"] == "1300"
    assert out["source"] == "detail"


def test_resolve_gib_transmission_falls_back_to_imza_when_not_enveloped():
    out = isnet.resolve_gib_transmission_status(
        detail_status="Zarflanmadi",
        process_status="Imza_Bekliyor",
    )
    assert out["status"] == "İmza bekliyor"
    assert out["source"] == "process"


def test_resolve_gib_schematron_error():
    out = isnet.resolve_gib_transmission_status(
        detail_status="Schematron_Kontrol_Sonucu_Hatali",
        process_status="Gib_Tarafinda_Hata_Olustu",
    )
    assert out["status_code"] == "1150"
    assert "Schematron" in out["status"]


def test_search_row_reads_detail_status():
    xml = """
    <Invoice xmlns="http://schemas.datacontract.org/2004/07/EInvoice.Service.Model">
      <ETTN>aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee</ETTN>
      <InvoiceNumber>U052026000000099</InvoiceNumber>
      <Status>Imza_Bekliyor</Status>
      <DetailStatus>Basariyla_Tamamlandi</DetailStatus>
      <EnvelopeId>env-1</EnvelopeId>
    </Invoice>
    """
    el = ET.fromstring(xml)
    row = isnet._search_row_from_el(el)
    assert row["invoice_id"] == "U052026000000099"
    assert row["status"] == "Başarıyla Tamamlandı"
    assert row["status_code"] == "1300"
    assert row["detail_status"] == "Basariyla_Tamamlandi"
    assert row["process_status"] == "Imza_Bekliyor"


def test_search_row_nested_detail_status_beats_ziplendi():
    """WCF iç içe DetailStatus/Code=1300 — süreç Status=Ziplendi ezilmesin."""
    xml = """
    <Invoice xmlns="http://schemas.datacontract.org/2004/07/EInvoice.Service.Model">
      <ETTN>bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee</ETTN>
      <InvoiceNumber>U052026000000067</InvoiceNumber>
      <Status>Ziplendi</Status>
      <DetailStatus>
        <Code>1300</Code>
        <Description>Basariyla_Tamamlandi</Description>
      </DetailStatus>
    </Invoice>
    """
    row = isnet._search_row_from_el(ET.fromstring(xml))
    assert row["process_status"] == "Ziplendi"
    assert row["status_code"] == "1300"
    assert row["status"] == "Başarıyla Tamamlandı"


def test_search_row_detail_enum_beats_ziplendi():
    xml = """
    <Invoice xmlns="http://schemas.datacontract.org/2004/07/EInvoice.Service.Model">
      <InvoiceNumber>U052026000000066</InvoiceNumber>
      <Status>Ziplendi</Status>
      <DetailStatus>Basariyla_Tamamlandi</DetailStatus>
    </Invoice>
    """
    row = isnet._search_row_from_el(ET.fromstring(xml))
    assert row["status"] == "Başarıyla Tamamlandı"
    assert row["status_code"] == "1300"


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


def test_connection_ignores_portal_password_failure():
    """SOAP OK iken portal şifre hatası mesaja karışmasın."""
    settings = {
        "company_tax_id": "6131659091",
        "alias": "urn:mail:389265defaultgb@isnet.com",
        "mode": "test",
        "username": "6131659091",
    }

    async def _fake_health(_s):
        return "true"

    async def _fake_balance(_s, tax_code=None):
        return {"balance": "1997570", "remaining_credit": "1997570", "message": "OK"}

    async def _portal_fail(_s, password):
        raise HTTPException(status_code=400, detail="İşNet kullanıcı adı veya şifre hatalı.")

    with patch("isnet.soap_health_check", side_effect=_fake_health), patch(
        "isnet.get_company_balance", side_effect=_fake_balance
    ), patch("isnet.login", side_effect=_portal_fail):
        info = asyncio.get_event_loop().run_until_complete(isnet.test_connection(settings, "wrong-pass"))
    assert info["ok"] is True
    assert info["soap_ok"] is True
    assert "1997570" in (info.get("message") or "")
    assert "şifre" not in (info.get("message") or "").lower()
    assert "Portal:" not in (info.get("message") or "")


def test_healthcheck_envelope_has_no_request_wrapper():
    xml = isnet.soap_envelope_xml("HealthCheck", None)
    assert "<tem:HealthCheck>" in xml
    assert "<tem:request>" not in xml
    assert isnet.soap_action_header("IInvoiceService", "HealthCheck") == '"http://tempuri.org/IInvoiceService/HealthCheck"'


def test_soap_unreachable_hint_timeout():
    assert "zaman aşımı" in isnet._soap_unreachable_hint(httpx.ConnectTimeout("x"))


def test_live_connection_failure_includes_egress_ip():
    settings = {
        "company_tax_id": "6131659091",
        "alias": "urn:mail:389265defaultgb@isnet.com",
        "mode": "live",
    }

    async def _fail(_s):
        raise HTTPException(status_code=502, detail="İşNet SOAP'a ulaşılamadı (HealthCheck): bağlantı zaman aşımı")

    async def _ips():
        return ["203.0.113.10"]

    async def _rest_ok(_s):
        return True

    async def _diag():
        return {
            "soap": {"host": "einvoiceservice.isnet.net.tr", "tcp_ok": True, "tls_ok": False, "ips": ["213.143.252.122"]},
            "rest": {"host": "einvoiceapi.isnet.net.tr", "tcp_ok": True, "tls_ok": True, "ips": ["213.143.252.136"]},
            "soap_tls_blackhole": True,
            "rest_ok": True,
        }

    with patch("isnet.soap_health_check", side_effect=_fail), patch(
        "isnet.detect_egress_ips", side_effect=_ips
    ), patch("isnet.resolve_host_ipv4", return_value=["85.95.240.136"]), patch(
        "isnet.public_app_host", return_value="tamkobi.com"
    ), patch("isnet.health_check", side_effect=_rest_ok), patch(
        "isnet.diagnose_live_soap_path", side_effect=_diag
    ):
        with pytest.raises(HTTPException) as e:
            asyncio.get_event_loop().run_until_complete(isnet.test_connection(settings, ""))
    assert e.value.status_code == 502
    detail = str(e.value.detail)
    assert "203.0.113.10" in detail
    assert "6131659091" in detail
    assert "TLS ServerHello yok" in detail
    assert "einvoiceservice.isnet.net.tr" in detail
    assert "InvoiceService" in detail
    assert isnet.SUPPORT_EMAIL in detail


def test_live_soap_tls_blackhole_hint_mentions_rest_vs_soap():
    h = isnet.live_soap_tls_blackhole_hint("6131659091", "85.95.240.136", True)
    assert "213.143.252.136" in h
    assert "InvoiceService" in h
    assert "6131659091" in h
    assert "85.95.240.136" in h


def test_public_app_host_falls_back_from_localhost():
    with patch.dict(os.environ, {"PUBLIC_APP_URL": "http://127.0.0.1"}, clear=False):
        assert isnet.public_app_host() == "tamkobi.com"


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
    """server.EINVOICE_PROVIDERS['isnet'] alanları (tam import ortam bağımlılığı olmadan)."""
    from pathlib import Path

    src = Path(__file__).resolve().parents[1] / "server.py"
    text = src.read_text(encoding="utf-8")
    assert '"isnet"' in text
    assert "company_tax_id" in text
    assert "NetteFatura-API" in text
    # Kullanıcı ayarlarında SOAP/portal test ipuçları gösterilmez
    assert "einvoiceservicetest.isnet.net.tr" not in text
    assert "efaturadestek@nettefatura.com.tr" not in text


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
    ), patch(
        "isnet.search_archive_invoice",
        AsyncMock(return_value=[]),
    ):
        info = asyncio.get_event_loop().run_until_complete(
            isnet.try_verify_outgoing_in_portal(
                settings, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", e_type="e_archive", retries=1
            )
        )
    assert info["ok"] is True
    assert info["via"] == "viewer"
    assert info.get("invoice_id") == ""
    assert "view.example" in info["document_url"]


def test_verify_viewer_plus_search_returns_invoice_number():
    """Viewer URL gelse de ETTN araması ile resmi fatura no alınır (TKB kalmasın)."""
    settings = {"company_tax_id": "4810173324", "mode": "test"}
    ettn = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    with patch(
        "isnet.get_document_viewer_link",
        AsyncMock(return_value={"url": "https://view.example/doc?key=abc"}),
    ), patch(
        "isnet.search_archive_invoice",
        AsyncMock(return_value=[{"ettn": ettn, "invoice_id": "UUU2026999464749", "status": "Onaylandı"}]),
    ):
        info = asyncio.get_event_loop().run_until_complete(
            isnet.try_verify_outgoing_in_portal(settings, ettn, e_type="e_archive", retries=1)
        )
    assert info["ok"] is True
    assert info["invoice_id"] == "UUU2026999464749"
    assert info["via"] in ("search", "viewer")


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
            isnet.try_verify_outgoing_in_portal(
                settings, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", e_type="e_archive", retries=1
            )
        )
    assert info["ok"] is True
    assert info["via"] == "search"


def test_soft_verify_returns_false_when_not_in_portal():
    """NetteFatura-API: portal anında boş olsa da soft verify hata fırlatmaz."""
    settings = {"company_tax_id": "4810173324", "mode": "test"}
    with patch(
        "isnet.get_document_viewer_link",
        AsyncMock(side_effect=HTTPException(status_code=404, detail="link yok")),
    ), patch(
        "isnet.search_archive_invoice",
        AsyncMock(return_value=[]),
    ):
        info = asyncio.get_event_loop().run_until_complete(
            isnet.try_verify_outgoing_in_portal(
                settings, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", e_type="e_archive", retries=1
            )
        )
    assert info["ok"] is False


def test_wait_for_gib_keeps_polling_past_ziplendi_until_1300():
    """Ziplenmiş ara durum — wait_for_gib ile DetailStatus 1300 gelene kadar poll."""
    settings = {"company_tax_id": "4810173324", "mode": "test"}
    ettn = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    zip_row = {
        "ettn": ettn,
        "invoice_id": "U052026000000073",
        "status": "Ziplenmiş",
        "status_code": "",
        "detail_status": "",
        "process_status": "Ziplendi",
        "status_source": "process",
    }
    done_row = {
        "ettn": ettn,
        "invoice_id": "U052026000000073",
        "status": "Başarıyla Tamamlandı",
        "status_code": "1300",
        "detail_status": "Basariyla_Tamamlandi",
        "process_status": "Ziplendi",
        "status_source": "detail",
    }
    search = AsyncMock(side_effect=[[zip_row], [zip_row], [done_row]])
    with patch(
        "isnet.get_document_viewer_link",
        AsyncMock(side_effect=HTTPException(status_code=404, detail="link yok")),
    ), patch(
        "isnet.search_outgoing_invoice",
        search,
    ), patch(
        "isnet.asyncio.sleep",
        AsyncMock(),
    ):
        info = asyncio.get_event_loop().run_until_complete(
            isnet.try_verify_outgoing_in_portal(
                settings, ettn, e_type="e_invoice", wait_for_gib=True
            )
        )
    assert info["ok"] is True
    assert info["status_code"] == "1300"
    assert info["invoice_id"] == "U052026000000073"
    assert search.await_count >= 3


def test_is_pending_process_status_ziplendi():
    assert isnet._is_pending_process_status("Ziplendi", "Ziplenmiş", "") is True
    assert isnet._is_pending_process_status("Imza_Bekliyor", "", "") is True
    assert isnet._is_pending_process_status("Onay_Bekliyor", "Onay bekliyor", "") is True
    assert isnet._is_pending_process_status("Gibe_Iletildi", "GİB'e iletildi", "1") is True
    assert isnet._is_pending_process_status("Gonderildi", "Başarıyla Tamamlandı", "1300") is False
    assert isnet._is_pending_process_status("Gonderildi", "Gönderildi", "") is False


def test_search_invoice_filters_wsdl_field_names():
    f = isnet._search_invoice_filters(
        ettn="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        invoice_number="U052026000000073",
    )
    assert f["Ettn"] == "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    assert f["MinInvoiceNumber"] == "U052026000000073"
    assert f["MaxInvoiceNumber"] == "U052026000000073"
    assert "ETTN" not in f
    assert "InvoiceNumber" not in f


def test_is_outbound_gib_pending():
    assert isnet.is_outbound_gib_pending(gib_status="Test · İmza bekliyor", gib_status_code="") is True
    assert isnet.is_outbound_gib_pending(gib_status="Test · Ziplenmiş — GİB iletimi bekleniyor") is True
    assert isnet.is_outbound_gib_pending(gib_status="Test · Başarıyla Tamamlandı", gib_status_code="1300") is False


def test_search_outgoing_passes_ettnto_soap_request():
    """SearchInvoice — Ettn (ETTN değil) SOAP gövdesine yazılmalı."""
    settings = {"company_tax_id": "4810173324", "mode": "test"}
    ettn = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    captured = {}

    async def fake_soap(*_a, **kw):
        captured.update(kw.get("request") or {})
        xml = """
        <Invoice xmlns="http://schemas.datacontract.org/2004/07/EInvoice.Service.Model">
          <ETTN>aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee</ETTN>
          <InvoiceNumber>U052026000000073</InvoiceNumber>
          <Status>Gonderildi</Status>
          <DetailStatus>Basariyla_Tamamlandi</DetailStatus>
        </Invoice>
        """
        return ET.fromstring(f"<Body>{xml}</Body>")

    with patch("isnet._soap_call", side_effect=fake_soap):
        rows = asyncio.get_event_loop().run_until_complete(
            isnet.search_outgoing_invoice(settings, ettn=ettn)
        )
    assert captured.get("Ettn") == ettn
    assert "ETTN" not in captured
    assert rows[0]["status_code"] == "1300"


def test_send_document_accepts_soap_success_without_immediate_portal():
    """UBL Xml Success+ETTN → iletildi; portal soft; SOAP no resmiyse alınır."""
    settings = {"company_tax_id": "4810173324", "alias": "urn:mail:pk@x.com", "mode": "test"}
    invoice = {
        "e_type": "e_archive",
        "invoice_number": "TA202600000095",
        "items": [{"name": "Hizmet", "quantity": 1, "unit_price": 100, "vat_rate": 20}],
    }
    company = {"tax_number": "4810173324"}
    contact = {"name": "Alıcı", "tax_number_or_id": "11111111111"}

    with patch(
        "isnet.build_ubl",
        return_value=("<Invoice/>", "local-uuid", "TKB2026000000095"),
    ), patch(
        "isnet.send_invoice_xml",
        AsyncMock(return_value={
            "ettn": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "invoice_id": "UUU2026999000001",
            "message": "OK",
            "document_url": "",
            "action": "SendArchiveInvoiceXmlWithoutInvoiceNumber",
        }),
    ), patch(
        "isnet.try_verify_outgoing_in_portal",
        AsyncMock(return_value={"ok": False, "document_url": "", "via": "", "invoice_id": ""}),
    ), patch(
        "isnet.resolve_invoice_number_from_xml",
        AsyncMock(return_value=""),
    ):
        sent = asyncio.get_event_loop().run_until_complete(
            isnet.send_document(settings, "", invoice, contact, company)
        )
    assert sent["ettn"].startswith("aaaaaaaa")
    assert sent["verified"] is False
    assert sent["official_invoice_id"] == "UUU2026999000001"
    assert sent["number_source"] == "soap"
    assert sent["send_mode"] == "SendArchiveInvoiceXmlWithoutInvoiceNumber"
    assert sent["seller_tax"] == "4810173324"


def test_send_document_prefers_portal_number_over_ubl_tkb():
    """İşNet/portal UUU…; yerel TKB resmi sayılmaz."""
    settings = {"company_tax_id": "4810173324", "alias": "urn:mail:pk@x.com", "mode": "test"}
    invoice = {
        "e_type": "e_invoice",
        "invoice_number": "TA2026000000130",
        "gib_scenario": "TICARIFATURA",
        "items": [{"name": "Ürün", "quantity": 1, "unit_price": 1000, "vat_rate": 20}],
    }
    company = {"tax_number": "4810173324"}
    contact = {
        "name": "Alıcı",
        "tax_number_or_id": "1234567890",
        "e_invoice_alias": "urn:mail:pk@alici.com",
    }

    with patch(
        "isnet.build_ubl",
        return_value=("<Invoice/>", "local-uuid", "TKB2026000000130"),
    ), patch(
        "isnet.send_invoice_xml",
        AsyncMock(return_value={
            "ettn": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "invoice_id": "TKB2026000000130",
            "message": "OK",
            "document_url": "https://view.example/x",
            "action": "SendInvoiceXmlWithoutInvoiceNumber",
        }),
    ), patch(
        "isnet.try_verify_outgoing_in_portal",
        AsyncMock(return_value={
            "ok": True,
            "document_url": "https://view.example/x",
            "via": "search",
            "invoice_id": "UUU2026999464749",
            "status": "İmza Bekliyor",
        }),
    ):
        sent = asyncio.get_event_loop().run_until_complete(
            isnet.send_document(settings, "", invoice, contact, company)
        )
    assert sent["official_invoice_id"] == "UUU2026999464749"
    assert sent["invoice_id"] == "UUU2026999464749"
    assert sent["number_source"] == "portal"
    assert sent["ubl_id"] == "TKB2026000000130"


def test_send_document_xml_fallback_when_search_has_no_number():
    settings = {"company_tax_id": "4810173324", "mode": "test"}
    invoice = {
        "e_type": "e_archive",
        "invoice_number": "NX1",
        "items": [{"name": "X", "quantity": 1, "unit_price": 10, "vat_rate": 20}],
    }
    company = {"tax_number": "4810173324"}
    contact = {"name": "Alıcı", "tax_number_or_id": "11111111111"}

    with patch(
        "isnet.build_ubl",
        return_value=("<Invoice/>", "u", "TKB2026000000001"),
    ), patch(
        "isnet.send_invoice_xml",
        AsyncMock(return_value={
            "ettn": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "invoice_id": "",
            "message": "OK",
            "document_url": "https://view.example/x",
            "action": "SendArchiveInvoiceXmlWithoutInvoiceNumber",
        }),
    ), patch(
        "isnet.try_verify_outgoing_in_portal",
        AsyncMock(return_value={
            "ok": True,
            "document_url": "https://view.example/x",
            "via": "viewer",
            "invoice_id": "",
        }),
    ), patch(
        "isnet.resolve_invoice_number_from_xml",
        AsyncMock(return_value="UUU2026999464754"),
    ):
        sent = asyncio.get_event_loop().run_until_complete(
            isnet.send_document(settings, "", invoice, contact, company)
        )
    assert sent["official_invoice_id"] == "UUU2026999464754"
    assert sent["number_source"] == "xml"


def test_build_structured_invoice_omits_invoice_number():
    inv = {
        "invoice_number": "TA2026000000130",
        "issue_date": "2026-10-01",
        "items": [{"name": "Kalem", "quantity": 2, "unit_price": 50, "vat_rate": 20}],
        "subtotal": 100,
        "vat_total": 20,
        "grand_total": 120,
        "gib_scenario": "TICARIFATURA",
    }
    payload = isnet.build_structured_invoice(
        inv,
        {"tax_number": "4810173324"},
        {"name": "Alıcı", "tax_number_or_id": "1234567890"},
        is_earchive=False,
        receiver_alias="urn:mail:pk@x.com",
    )
    assert "InvoiceNumber" not in payload
    assert payload["ScenarioType"] == "TICARIFATURA"
    assert payload["InvoiceType"] == "SATIS"
    assert payload["ReceiverInboxTag"] == "urn:mail:pk@x.com"
    assert payload["ExternalInvoiceCode"]
    assert len(payload["InvoiceDetails"]) == 1
    assert isnet.is_ettn_uuid(payload["ETTN"])


def test_build_structured_invoice_return_is_iade():
    """TamKobi İade (invoice_type=return) → İşNet InvoiceType IADE (SATIS değil)."""
    inv = {
        "invoice_number": "U052026000000066",
        "invoice_type": "return",
        "issue_date": "2026-10-02",
        "items": [{"name": "Kalem", "quantity": 1, "unit_price": 5.9, "vat_rate": 20}],
        "subtotal": 5.9,
        "vat_total": 1.18,
        "grand_total": 7.08,
        "gib_scenario": "TEMELFATURA",
        "original_invoice_number": "U052026000000065",
        "original_issue_date": "2026-10-01",
    }
    payload = isnet.build_structured_invoice(
        inv,
        {"tax_number": "4810173324"},
        {"name": "Alıcı", "tax_number_or_id": "1234567890"},
        is_earchive=False,
        receiver_alias="urn:mail:pk@x.com",
    )
    assert payload["InvoiceType"] == "IADE"
    assert payload["ScenarioType"] == "TEMELFATURA"

    sales_return = isnet.build_structured_invoice(
        {**inv, "invoice_type": "sales_return"},
        {"tax_number": "4810173324"},
        {"name": "Alıcı", "tax_number_or_id": "1234567890"},
        is_earchive=False,
    )
    assert sales_return["InvoiceType"] == "IADE"


def test_build_structured_invoice_withholding_is_tevkifat():
    """Tevkifat seçili satış → İşNet InvoiceType TEVKIFAT."""
    inv = {
        "invoice_number": "U052026000000067",
        "invoice_type": "sales",
        "issue_date": "2026-10-02",
        "withholding_rate": 0.5,
        "withholding_code": "603",
        "withholding_amount": 0.54,
        "items": [{"name": "Bakım", "quantity": 1, "unit_price": 5.41, "vat_rate": 20}],
        "subtotal": 5.41,
        "vat_total": 1.08,
        "grand_total": 5.95,
        "gib_scenario": "TEMELFATURA",
    }
    payload = isnet.build_structured_invoice(
        inv,
        {"tax_number": "4810173324"},
        {"name": "Alıcı", "tax_number_or_id": "1234567890"},
        is_earchive=False,
    )
    assert payload["InvoiceType"] == "TEVKIFAT"


def test_isnet_build_ubl_withholding_tevkifat():
    """İşNet UBL yolu (ubl_export): tevkifat → TEVKIFAT + WithholdingTaxTotal; n11 değil."""
    inv = {
        "invoice_number": "U052026000000067",
        "invoice_type": "sales",
        "e_type": "e_invoice",
        "gib_scenario": "TEMELFATURA",
        "issue_date": "2026-10-02",
        "withholding_rate": 0.5,
        "withholding_code": "603",
        "withholding_amount": 0.54,
        "items": [{"name": "Bakım", "quantity": 1, "unit_price": 5.41, "vat_rate": 20, "total": 5.41}],
        "subtotal": 5.41,
        "vat_total": 1.08,
        "grand_total": 5.95,
    }
    company = {"name": "Demo", "tax_number": "4810173324", "city": "İstanbul", "address": "Cadde 1"}
    contact = {"name": "İş Net", "tax_number_or_id": "4810173324", "city": "İstanbul"}
    xml, ettn, inv_id = isnet.build_ubl(inv, company, contact)
    assert inv_id == "U052026000000067"
    assert ettn
    assert "<cbc:InvoiceTypeCode>TEVKIFAT</cbc:InvoiceTypeCode>" in xml
    assert "<cbc:InvoiceTypeCode>SATIS</cbc:InvoiceTypeCode>" not in xml
    assert "<cac:WithholdingTaxTotal>" in xml
    assert "<cbc:TaxTypeCode>603</cbc:TaxTypeCode>" in xml
    assert "<ext:UBLExtensions>" in xml
    assert "<cac:Signature>" in xml


def test_serialize_structured_uses_invoice_element():
    xml = isnet._serialize_ein(
        {
            "CompanyTaxCode": "4810173324",
            "Invoices": [{
                "CurrencyCode": "TRY",
                "ETTN": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                "InvoiceDate": "2026-10-01",
                "InvoiceType": "SATIS",
                "ScenarioType": "TICARIFATURA",
                "TotalLineExtensionAmount": 100,
                "TotalVATAmount": 20,
                "TotalTaxInclusiveAmount": 120,
                "TotalPayableAmount": 120,
                "Receiver": {"ReceiverName": "A", "ReceiverTaxCode": "1234567890"},
                "InvoiceDetails": [{
                    "Quantity": 1,
                    "LineExtensionAmount": 100,
                    "VATRate": 20,
                    "VATAmount": 20,
                    "Product": {"ProductName": "X", "UnitPrice": 100, "MeasureUnit": "NIU"},
                }],
            }],
        },
        array_map=isnet._ARRAY_ITEM_STRUCTURED_INVOICE,
    )
    assert "<ein:Invoice>" in xml
    assert "<ein:InvoiceXml>" not in xml
    assert "<ein:InvoiceDetail>" in xml
    assert "InvoiceNumber" not in xml


def test_send_document_ubl_seller_uses_isnet_company_tax_id():
    """Firma kartı VKN boş/farklı olsa bile UBL satıcı = İşNet CompanyTaxCode."""
    settings = {"company_tax_id": "4810173324", "mode": "test"}
    invoice = {
        "e_type": "e_archive",
        "invoice_number": "TA1",
        "items": [{"name": "X", "quantity": 1, "unit_price": 1, "vat_rate": 20}],
    }
    company = {"name": "Firma", "tax_number": ""}
    contact = {"name": "Alıcı", "tax_number_or_id": "11111111111"}
    built = {}

    def _capture_ubl(inv, co, ct, ettn=None):
        built["seller"] = co.get("tax_number")
        return ("<Invoice/>", "u", "TKB2026000000001")

    with patch("isnet.build_ubl", side_effect=_capture_ubl), patch(
        "isnet.send_invoice_xml",
        AsyncMock(return_value={
            "ettn": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "invoice_id": "UUU1",
            "message": "OK",
            "document_url": "",
            "action": "SendArchiveInvoiceXmlWithoutInvoiceNumber",
        }),
    ), patch(
        "isnet.try_verify_outgoing_in_portal",
        AsyncMock(return_value={"ok": True, "document_url": "https://x", "via": "viewer", "invoice_id": "UUU1"}),
    ):
        asyncio.get_event_loop().run_until_complete(
            isnet.send_document(settings, "", invoice, contact, company)
        )
    assert built["seller"] == "4810173324"


def test_send_document_efatura_requires_receiver_or_lookup():
    """E-Fatura ReceiverTag yoksa GetTaxPayer alias dener; yoksa net 400."""
    settings = {"company_tax_id": "4810173324", "mode": "test"}
    invoice = {
        "e_type": "e_invoice",
        "invoice_number": "EF1",
        "contact_tax_id": "1234567805",
        "items": [{"name": "X", "quantity": 1, "unit_price": 1, "vat_rate": 20}],
    }
    company = {"tax_number": "4810173324"}
    contact = {"name": "Test Firma 05", "tax_number_or_id": "1234567805"}

    with patch("isnet.build_ubl", return_value=("<Invoice/>", "u", "EF1")), patch(
        "isnet.lookup_user",
        AsyncMock(return_value={"alias": "", "is_e_invoice_user": True}),
    ):
        with pytest.raises(HTTPException) as e:
            asyncio.get_event_loop().run_until_complete(
                isnet.send_document(settings, "", invoice, contact, company)
            )
    assert e.value.status_code == 400
    assert "posta kutusu" in e.value.detail.lower() or "alias" in e.value.detail.lower()

    called = {}

    async def _cap_send(*_a, **kw):
        called["receiver"] = kw.get("receiver_alias")
        return {
            "ettn": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "invoice_id": "UUU2",
            "message": "OK",
            "document_url": "",
            "action": "SendInvoiceXmlWithoutInvoiceNumber",
        }

    with patch("isnet.build_ubl", return_value=("<Invoice/>", "u", "EF1")), patch(
        "isnet.lookup_user",
        AsyncMock(return_value={"alias": "urn:mail:test05defaultpk@isnet.com"}),
    ), patch("isnet.send_invoice_xml", side_effect=_cap_send), patch(
        "isnet.try_verify_outgoing_in_portal",
        AsyncMock(return_value={"ok": True, "document_url": "", "via": "viewer", "invoice_id": "UUU2"}),
    ):
        sent = asyncio.get_event_loop().run_until_complete(
            isnet.send_document(settings, "", invoice, contact, company)
        )
    assert sent["ettn"].startswith("aaaaaaaa")
    assert called["receiver"] == "urn:mail:test05defaultpk@isnet.com"


def test_send_document_requires_company_tax():
    settings = {"mode": "test"}
    with pytest.raises(HTTPException) as e:
        asyncio.get_event_loop().run_until_complete(
            isnet.send_document(settings, "", {"e_type": "e_archive"}, {}, {})
        )
    assert e.value.status_code == 400
    assert "VKN" in e.value.detail


def test_humanize_object_reference_nre():
    msg = isnet._humanize_isnet_error(
        "Object reference not set to an instance of an object."
    )
    assert "Object reference" not in msg
    assert "UBL" in msg or "TaxCategory" in msg


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


def test_send_invoice_xml_falls_back_when_without_number_action_missing():
    settings = {"company_tax_id": "4810173324", "mode": "test"}
    body = ET.fromstring(
        "<Body xmlns:ein='http://schemas.datacontract.org/2004/07/EInvoice.Service.Model'>"
        "<ein:IsSucceded>true</ein:IsSucceded>"
        "<ein:ArchiveInvoiceResult>"
        "<ein:ETTN>aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee</ein:ETTN>"
        "<ein:ArchiveInvoiceNumber>UUU2026999000001</ein:ArchiveInvoiceNumber>"
        "<ein:IsSucceded>true</ein:IsSucceded>"
        "</ein:ArchiveInvoiceResult></Body>"
    )
    calls = []

    async def _soap(*_a, **kw):
        calls.append(kw.get("action"))
        if kw.get("action") == "SendArchiveInvoiceXmlWithoutInvoiceNumber":
            raise HTTPException(status_code=502, detail="İşNet SOAP Fault (SendArchiveInvoiceXmlWithoutInvoiceNumber): unknown")
        return body

    with patch("isnet._soap_call", side_effect=_soap):
        info = asyncio.get_event_loop().run_until_complete(
            isnet.send_invoice_xml(settings, ubl_xml="<Invoice/>", is_earchive=True)
        )
    assert calls == [
        "SendArchiveInvoiceXmlWithoutInvoiceNumber",
        "SendArchiveInvoiceXml",
    ]
    assert info["invoice_id"] == "UUU2026999000001"
    assert info["action"] == "SendArchiveInvoiceXml"


def test_is_provisional_invoice_number():
    assert isnet.is_provisional_invoice_number("TKB2026000000130")
    assert isnet.is_provisional_invoice_number("TKB2026000000130", "TKB2026000000130")
    assert isnet.is_provisional_invoice_number("ABC", "ABC")
    assert not isnet.is_provisional_invoice_number("UUU2026999464749", "TKB2026000000130")


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
    assert kwargs["action"] == "SendArchiveInvoiceXmlWithoutInvoiceNumber"
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
    req = mock_call.await_args.kwargs["request"]
    assert req.get("InvoiceDirection") == "Outgoing"


def test_get_document_viewer_link_incoming_direction():
    """Gelen e-Fatura PDF/XML için InvoiceDirection=Incoming."""
    settings = {"company_tax_id": "4810173324", "mode": "test"}
    body = ET.fromstring(
        "<Body xmlns:ein='http://schemas.datacontract.org/2004/07/EInvoice.Service.Model'>"
        "<ein:IsSucceded>true</ein:IsSucceded>"
        "<ein:HtmlUrl>https://view.example/in?key=in123</ein:HtmlUrl>"
        "</Body>"
    )
    with patch("isnet._soap_call", AsyncMock(return_value=body)) as mock_call:
        asyncio.get_event_loop().run_until_complete(
            isnet.get_document_viewer_link(
                settings,
                "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                e_type="e_invoice",
                direction="Incoming",
            )
        )
    req = mock_call.await_args.kwargs["request"]
    assert req.get("InvoiceDirection") == "Incoming"
    assert req.get("InvoiceDocumentType") == "EInvoice"


def test_download_invoice_pdf_passes_incoming_direction():
    settings = {"company_tax_id": "4810173324", "mode": "test"}
    pdf_bytes = b"%PDF-1.4 incoming"

    class _Resp:
        status_code = 200
        content = pdf_bytes
        text = ""
        headers = {"content-type": "application/pdf"}

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=_Resp())
    link = AsyncMock(return_value={"url": "https://portal/x?key=inTok", "html_url": "", "pdf_url": ""})

    with patch("isnet.get_document_viewer_link", link), patch("isnet.httpx.AsyncClient", return_value=mock_client):
        data = asyncio.get_event_loop().run_until_complete(
            isnet.download_invoice_pdf(
                settings,
                "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                e_type="e_invoice",
                direction="Incoming",
            )
        )
    assert data.startswith(b"%PDF")
    assert link.await_args.kwargs.get("direction") == "Incoming"


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


def test_download_invoice_pdf_url_encodes_key_plus_and_slash():
    """NetteFatura-API encodeURIComponent: + query'de boşluk sayılmasın."""
    settings = {"company_tax_id": "4810173324", "mode": "test"}
    pdf_bytes = b"%PDF-1.4 enc"
    raw_key = "abc+def/ghi="

    class _Resp:
        status_code = 200
        content = pdf_bytes
        text = ""
        headers = {"content-type": "application/pdf"}

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=_Resp())

    with patch("isnet.httpx.AsyncClient", return_value=mock_client):
        data = asyncio.get_event_loop().run_until_complete(
            isnet.download_invoice_pdf(
                settings,
                "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                viewer_url="https://efatura.isnet.net.tr/DocumentViewer/DocumentViewerLink?key=abc%2Bdef%2Fghi%3D",
            )
        )
    assert data.startswith(b"%PDF")
    called_url = mock_client.get.await_args.args[0]
    assert "GetInvoicePdf" in called_url
    assert "abc%2Bdef%2Fghi%3D" in called_url
    # Ham + query'de boşluk sayılır — encode edilmeden gitmemeli
    from urllib.parse import urlparse, parse_qs

    qs = parse_qs(urlparse(called_url).query)
    assert qs.get("key") == [raw_key]


def test_download_invoice_pdf_retries_fresh_link_when_stored_fails():
    """Stale gib_document_url başarısızsa taze GetDocumentViewerLink denenir."""
    settings = {"company_tax_id": "4810173324", "mode": "test"}
    pdf_bytes = b"%PDF-1.4 fresh"

    class _Bad:
        status_code = 200
        content = b"<html>Fatura bilgilerinin alinmasi sirasinda hata olustu!</html>"
        text = "Fatura bilgilerinin alınması sırasında hata oluştu!"
        headers = {"content-type": "text/html"}

    class _Good:
        status_code = 200
        content = pdf_bytes
        text = ""
        headers = {"content-type": "application/pdf"}

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(side_effect=[_Bad(), _Good()])
    link = AsyncMock(
        return_value={
            "url": "https://portal/x?key=freshKey",
            "html_url": "https://portal/x?key=freshKey",
            "pdf_url": "https://portal/pdf?key=freshKey",
        }
    )

    with patch("isnet.get_document_viewer_link", link), patch(
        "isnet.httpx.AsyncClient", return_value=mock_client
    ):
        data = asyncio.get_event_loop().run_until_complete(
            isnet.download_invoice_pdf(
                settings,
                "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                e_type="e_invoice",
                invoice_number="TA202600000108",
                viewer_url="https://portal/old?key=staleKey",
            )
        )
    assert data.startswith(b"%PDF")
    assert mock_client.get.await_count >= 2
    assert link.await_count >= 1


def test_infer_vendor_from_u05_series():
    assert isnet.infer_vendor_from_invoice_number("U052026000000080") == "05"
    assert isnet.infer_vendor_from_invoice_number("u052026000000001") == "05"
    assert isnet.infer_vendor_from_invoice_number("TA202600000108") == ""
    assert isnet.infer_vendor_from_invoice_number("") == ""
    settings = {"company_tax_id": "1234567805"}
    merged = isnet.with_inferred_vendor(settings, "U052026000000080")
    assert merged["company_vendor_number"] == "05"
    # Ayarda varsa üzerine yazma
    kept = isnet.with_inferred_vendor(
        {"company_tax_id": "1234567805", "company_vendor_number": "99"},
        "U052026000000080",
    )
    assert kept["company_vendor_number"] == "99"
    req = isnet._company_request(merged)
    assert req["CompanyVendorNumber"] == "05"


def test_search_row_extracts_invoice_html_pdf():
    import base64

    html = "<!DOCTYPE html><html><body>U05 e-Fatura</body></html>"
    html_b64 = base64.b64encode(html.encode()).decode()
    pdf_b64 = base64.b64encode(b"%PDF-1.4 demo").decode()
    body = ET.fromstring(
        "<Invoice xmlns:ein='http://schemas.datacontract.org/2004/07/EInvoice.Service.Model'>"
        "<ein:ETTN>9df33099-aaaa-bbbb-cccc-dddddddddddd</ein:ETTN>"
        "<ein:InvoiceNumber>U052026000000080</ein:InvoiceNumber>"
        "<ein:Status>Zarflanmadi</ein:Status>"
        f"<ein:InvoiceHtml>{html_b64}</ein:InvoiceHtml>"
        f"<ein:InvoicePdf>{pdf_b64}</ein:InvoicePdf>"
        "</Invoice>"
    )
    row = isnet._search_row_from_el(body)
    assert row["invoice_id"] == "U052026000000080"
    assert row["invoice_html"] == html_b64
    assert row["invoice_pdf"] == pdf_b64
    decoded_pdf = isnet._decode_maybe_b64(row["invoice_pdf"], prefer_pdf=True)
    assert decoded_pdf.startswith(b"%PDF")
    decoded_html = isnet._decode_maybe_b64(row["invoice_html"])
    assert b"U05 e-Fatura" in decoded_html


def test_download_invoice_pdf_falls_back_to_search_invoice_pdf():
    """Viewer boşken Search InvoicePdf (base64) kullanılır — U05 / Zarflanmadı."""
    settings = {"company_tax_id": "1234567805", "mode": "test"}
    pdf_bytes = b"%PDF-1.4 from-search"
    import base64

    pdf_b64 = base64.b64encode(pdf_bytes).decode()
    search = AsyncMock(
        return_value=[
            {
                "ettn": "9df33099-aaaa-bbbb-cccc-dddddddddddd",
                "invoice_id": "U052026000000080",
                "invoice_html": "",
                "invoice_pdf": pdf_b64,
            }
        ]
    )
    with patch(
        "isnet.get_document_viewer_link",
        AsyncMock(side_effect=HTTPException(status_code=404, detail="viewer yok")),
    ), patch("isnet.search_outgoing_invoice", search):
        data = asyncio.get_event_loop().run_until_complete(
            isnet.download_invoice_pdf(
                settings,
                "9df33099-aaaa-bbbb-cccc-dddddddddddd",
                e_type="e_invoice",
                invoice_number="U052026000000080",
            )
        )
    assert data == pdf_bytes
    # Vendor U05 → 05 ile Search çağrıldı
    assert search.await_args.kwargs.get("include_documents") is True
    called_settings = search.await_args.args[0] if search.await_args.args else search.await_args.kwargs.get("settings")
    # settings positional
    assert search.await_args.args[0].get("company_vendor_number") == "05"


def test_download_invoice_pdf_falls_back_to_invoice_html():
    """InvoicePdf yoksa InvoiceHtml → Chrome PDF."""
    settings = {"company_tax_id": "1234567805", "company_vendor_number": "05", "mode": "test"}
    html = "<!DOCTYPE html><html><body>resmi</body></html>"
    search = AsyncMock(
        return_value=[
            {
                "ettn": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                "invoice_id": "U052026000000080",
                "invoice_html": html,
                "invoice_pdf": "",
            }
        ]
    )
    with patch(
        "isnet.get_document_viewer_link",
        AsyncMock(side_effect=HTTPException(status_code=404, detail="viewer yok")),
    ), patch("isnet.search_outgoing_invoice", search), patch(
        "isnet.html_to_pdf_bytes", return_value=b"%PDF-1.4 from-html"
    ):
        data = asyncio.get_event_loop().run_until_complete(
            isnet.download_invoice_pdf(
                settings,
                "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
                e_type="e_invoice",
                invoice_number="U052026000000080",
            )
        )
    assert data.startswith(b"%PDF-1.4 from-html")


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


def test_list_incoming_despatch_search_despatch_advice():
    """Dolibarr syncDespatch: SearchDespatchAdvice + DespatchAdviceDirection=Incoming."""
    import base64

    settings = {"company_tax_id": "4810173324", "mode": "test"}
    ubl = b'<DespatchAdvice xmlns="urn:oasis:names:specification:ubl:schema:xsd:DespatchAdvice-2"><ID>IRS2026000000001</ID></DespatchAdvice>'
    b64 = base64.b64encode(ubl).decode("ascii")
    body = ET.fromstring(
        "<Body xmlns:ein='http://schemas.datacontract.org/2004/07/EInvoice.Service.Model'>"
        "<ein:DespatchAdvice>"
        "<ein:ETTN>aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee</ein:ETTN>"
        "<ein:DespatchAdviceNumber>IRS2026000000001</ein:DespatchAdviceNumber>"
        f"<ein:DespatchAdviceXML>{b64}</ein:DespatchAdviceXML>"
        "<ein:Status>Basariyla_Tamamlandi</ein:Status>"
        "</ein:DespatchAdvice>"
        "</Body>"
    )
    with patch("isnet._soap_call", AsyncMock(return_value=body)) as mock_call:
        rows = asyncio.run(isnet.list_incoming_despatch(settings, password=""))
    assert mock_call.await_args.kwargs["action"] == "SearchDespatchAdvice"
    req = mock_call.await_args.kwargs["request"]
    assert req.get("DespatchAdviceDirection") == "Incoming"
    assert req["ResultSet"].get("IsXMLIncluded") is True
    assert len(rows) == 1
    assert rows[0]["kind"] == "dispatch"
    assert rows[0]["invoice_id"] == "IRS2026000000001"
    assert rows[0]["xml"] and b"DespatchAdvice" in rows[0]["xml"]


def test_list_incoming_does_not_duplicate_nested_ubl_invoice():
    """SearchInvoice InvoiceInfo + gömülü UBL Invoice aynı belgeyi iki satır yapmasın."""
    settings = {"company_tax_id": "4810173324", "mode": "test"}
    ubl = (
        '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">'
        "<ID>ALE2026000007781</ID>"
        "<UUID>11111111-2222-3333-4444-555555555555</UUID>"
        "</Invoice>"
    )
    body = ET.fromstring(
        "<Body xmlns:ein='http://schemas.datacontract.org/2004/07/EInvoice.Service.Model'>"
        "<ein:InvoiceInfo>"
        "<ein:ETTN>11111111-2222-3333-4444-555555555555</ein:ETTN>"
        "<ein:InvoiceNumber>ALE2026000007781</ein:InvoiceNumber>"
        f"<ein:InvoiceXML>{ubl}</ein:InvoiceXML>"
        "</ein:InvoiceInfo>"
        "</Body>"
    )
    with patch("isnet._soap_call", AsyncMock(return_value=body)):
        rows = asyncio.run(isnet.list_incoming(settings, password=""))
    assert len(rows) == 1
    assert rows[0]["invoice_id"] == "ALE2026000007781"


def test_list_incoming_all_merges_invoice_and_despatch():
    settings = {"company_tax_id": "4810173324", "mode": "test"}
    inv = [{"uuid": "i1", "invoice_id": "FAT1", "kind": "invoice", "xml": b"<Invoice/>"}]
    disp = [{"uuid": "d1", "invoice_id": "IRS1", "kind": "dispatch", "xml": b"<DespatchAdvice/>"}]
    with patch("isnet.list_incoming", AsyncMock(return_value=inv)), patch(
        "isnet.list_incoming_despatch", AsyncMock(return_value=disp)
    ):
        rows = asyncio.get_event_loop().run_until_complete(
            isnet.list_incoming_all(settings, password="")
        )
    assert len(rows) == 2
    assert {r["kind"] for r in rows} == {"invoice", "dispatch"}


def test_send_despatch_xml_payload_shape():
    """SendDespatchAdviceXml — DespatchAdvices / DespatchAdviceContent base64."""
    settings = {"company_tax_id": "4810173324", "mode": "test"}
    ubl = "<DespatchAdvice><ID>IRS1</ID></DespatchAdvice>"
    captured = {}

    async def fake_soap(*_a, **kw):
        captured.update(kw)
        xml = """
        <Body xmlns:ein="http://schemas.datacontract.org/2004/07/EInvoice.Service.Model">
          <ein:InvoiceResult>
            <ein:IsSucceded>true</ein:IsSucceded>
            <ein:ETTN>aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee</ein:ETTN>
            <ein:DespatchAdviceNumber>IRS2026000000099</ein:DespatchAdviceNumber>
          </ein:InvoiceResult>
        </Body>
        """
        return ET.fromstring(xml)

    with patch("isnet._soap_call", side_effect=fake_soap):
        out = asyncio.get_event_loop().run_until_complete(
            isnet.send_despatch_xml(settings, ubl_xml=ubl, receiver_alias="urn:mail:x@isnet.net.tr")
        )
    assert captured["action"] == "SendDespatchAdviceXml"
    req = captured["request"]
    assert req["CompanyTaxCode"] == "4810173324"
    assert len(req["DespatchAdvices"]) == 1
    assert "DespatchAdviceContent" in req["DespatchAdvices"][0]
    assert req["DespatchAdvices"][0]["ReceiverTag"] == "urn:mail:x@isnet.net.tr"
    assert out["ettn"] == "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    assert captured.get("array_map") is None or captured["array_map"].get("DespatchAdvices") in (
        "DespatchAdviceXml",
        "DespatchAdvice",
        None,
    )


def test_lookup_despatch_user_get_despatch_tax_payer():
    settings = {"company_tax_id": "4810173324", "mode": "test"}
    body = ET.fromstring(
        """
        <Body xmlns:ein="http://schemas.datacontract.org/2004/07/EInvoice.Service.Model">
          <ein:TaxPayer>
            <ein:TaxPayerName>Alıcı A.Ş.</ein:TaxPayerName>
            <ein:InboxTagList>
              <ein:string>urn:mail:defaultgk@isnet.net.tr</ein:string>
            </ein:InboxTagList>
          </ein:TaxPayer>
        </Body>
        """
    )
    with patch("isnet._soap_call", AsyncMock(return_value=body)) as mock_call:
        info = asyncio.get_event_loop().run_until_complete(
            isnet.lookup_despatch_user(settings, "", "1234567890")
        )
    assert mock_call.await_args.kwargs["action"] == "GetDespatchTaxPayer"
    assert info["is_e_dispatch_user"] is True
    assert "isnet.net.tr" in info["alias"]


def test_search_outgoing_despatch_direction():
    settings = {"company_tax_id": "4810173324", "mode": "test"}
    ettn = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    body = ET.fromstring(
        f"""
        <Body xmlns:ein="http://schemas.datacontract.org/2004/07/EInvoice.Service.Model">
          <ein:DespatchAdvice>
            <ein:ETTN>{ettn}</ein:ETTN>
            <ein:DespatchAdviceNumber>IRS2026000000001</ein:DespatchAdviceNumber>
            <ein:Status>Ziplendi</ein:Status>
            <ein:DetailStatus>Basariyla_Tamamlandi</ein:DetailStatus>
          </ein:DespatchAdvice>
        </Body>
        """
    )
    with patch("isnet._soap_call", AsyncMock(return_value=body)) as mock_call:
        rows = asyncio.get_event_loop().run_until_complete(
            isnet.search_outgoing_despatch(settings, ettn=ettn)
        )
    assert mock_call.await_args.kwargs["action"] == "SearchDespatchAdvice"
    assert mock_call.await_args.kwargs["request"]["DespatchAdviceDirection"] == "Outgoing"
    assert mock_call.await_args.kwargs["request"]["Ettn"] == ettn
    assert rows[0]["status_code"] == "1300"
    assert rows[0]["invoice_id"] == "IRS2026000000001"


def test_try_verify_uses_search_outgoing_despatch_for_e_dispatch():
    settings = {"company_tax_id": "4810173324", "mode": "test"}
    ettn = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    row = {
        "ettn": ettn,
        "invoice_id": "IRS2026000000001",
        "status": "Başarıyla Tamamlandı",
        "status_code": "1300",
        "detail_status": "Basariyla_Tamamlandi",
        "process_status": "Ziplendi",
        "status_source": "detail",
    }
    with patch(
        "isnet.get_document_viewer_link",
        AsyncMock(side_effect=HTTPException(status_code=404, detail="link yok")),
    ), patch(
        "isnet.search_outgoing_despatch",
        AsyncMock(return_value=[row]),
    ) as search, patch("isnet.asyncio.sleep", AsyncMock()):
        info = asyncio.get_event_loop().run_until_complete(
            isnet.try_verify_outgoing_in_portal(
                settings, ettn, e_type="e_dispatch", wait_for_gib=True
            )
        )
    assert info["ok"] is True
    assert info["status_code"] == "1300"
    assert search.await_count >= 1


def test_build_despatch_ubl_requires_plate_when_send_ready():
    import ubl_export

    inv = {
        "invoice_number": "IRS1",
        "items": [{"name": "X", "quantity": 1, "unit": "Adet", "unit_price": 1, "total": 1}],
    }
    seller = {"name": "F", "tax_number": "4810173324", "address": "A", "city": "İstanbul", "tax_office": "X"}
    buyer = {"name": "A", "tax_number_or_id": "1234567890", "address": "B", "city": "Ankara"}
    try:
        ubl_export.build_despatch_ubl(inv, seller, buyer, send_ready=True)
        assert False, "expected ValueError"
    except ValueError as e:
        assert "plaka" in str(e).lower()
    inv = {
        "invoice_number": "IRS1",
        "issue_date": "2026-10-05",
        "issue_time": "14:30:00",
        "despatch_plate": "34ABC123",
        "items": [{"name": "X", "quantity": 1, "unit": "Adet", "unit_price": 1, "total": 1}],
    }
    xml = ubl_export.build_despatch_ubl(inv, seller, buyer, send_ready=True)
    assert b"TEMELIRSALIYE" in xml
    ns = {
        "cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
        "cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    }
    root = ET.fromstring(xml)
    ship = root.find("cac:Shipment", ns)
    assert ship is not None
    delivery = ship.find("cac:Delivery", ns)
    assert delivery is not None
    assert delivery.find("cac:DeliveryAddress/cbc:CityName", ns).text == "Ankara"
    assert delivery.find("cac:CarrierParty/cac:PartyName/cbc:Name", ns) is not None
    despatch = delivery.find("cac:Despatch", ns)
    assert despatch is not None
    assert despatch.find("cbc:ActualDespatchDate", ns).text == "2026-10-05"
    assert despatch.find("cbc:ActualDespatchTime", ns).text == "14:30:00"
    assert despatch.find("cac:DespatchAddress/cbc:CityName", ns).text == "İstanbul"
    plate = ship.find("cac:ShipmentStage/cac:TransportMeans/cac:RoadTransport/cbc:LicensePlateID", ns)
    assert plate is not None and plate.text == "34ABC123"
    assert delivery.find("cbc:ActualDespatchDate", ns) is None


def test_build_despatch_ubl_includes_invoice_document_reference():
    import ubl_export

    inv = {
        "invoice_number": "IRS-2026-0006",
        "issue_date": "2026-10-05",
        "despatch_plate": "34ABC123",
        "invoice_ref_number": "TA202600000013",
        "invoice_ref_date": "2026-10-04",
        "items": [{"name": "X", "quantity": 1, "unit": "Adet", "unit_price": 1, "total": 1}],
    }
    seller = {"name": "F", "tax_number": "4810173324", "address": "A", "city": "İstanbul", "tax_office": "X"}
    buyer = {"name": "A", "tax_number_or_id": "1234567890", "address": "B", "city": "Ankara"}
    xml = ubl_export.build_despatch_ubl(inv, seller, buyer, send_ready=True)
    ns = {
        "cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
        "cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
    }
    root = ET.fromstring(xml)
    adr = root.find("cac:AdditionalDocumentReference", ns)
    assert adr is not None
    assert adr.find("cbc:ID", ns).text == "TA202600000013"
    assert adr.find("cbc:DocumentTypeCode", ns).text == "FATURA"
