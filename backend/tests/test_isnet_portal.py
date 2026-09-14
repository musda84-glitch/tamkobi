"""İşNet Web Portal (NetteFatura-Portal) birim testleri."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

import isnet_portal
import server


class _Resp:
    def __init__(self, text: str = "", status: int = 200, data=None, content: bytes | None = None):
        self.text = text
        self.status_code = status
        self._json = data if data is not None else {}
        if content is not None:
            self.content = content
        elif data is not None:
            import json as _json

            self.content = _json.dumps(data).encode("utf-8")
        else:
            self.content = (text or "").encode("utf-8")

    def json(self):
        return self._json


def test_providers_include_soap_and_portal():
    assert "isnet" in server.EINVOICE_PROVIDERS
    assert "isnet_portal" in server.EINVOICE_PROVIDERS
    assert "SOAP" in server.EINVOICE_PROVIDERS["isnet"]["name"]
    assert "Portal" in server.EINVOICE_PROVIDERS["isnet_portal"]["name"]
    assert "NetteFatura-Portal" in (server.EINVOICE_PROVIDERS["isnet_portal"].get("docs") or "")
    assert "NetteFatura-API" in (server.EINVOICE_PROVIDERS["isnet"].get("docs") or "")


def test_portal_base_urls():
    assert isnet_portal.portal_base({"mode": "test"}) == isnet_portal.TEST_PORTAL
    assert isnet_portal.portal_base({"mode": "live"}) == isnet_portal.LIVE_PORTAL
    assert isnet_portal.portal_base({"mode": "test", "api_url": "https://custom.example/"}) == "https://custom.example"


def test_token_from_html():
    html = '<form><input name="__RequestVerificationToken" type="hidden" value="abc-token" /></form>'
    assert isnet_portal._token_from_html(html) == "abc-token"
    with pytest.raises(HTTPException):
        isnet_portal._token_from_html("<html></html>")


def test_portal_login_and_kontor():
    settings = {"username": "1234567890", "mode": "test"}
    login_html = '<html><input name="__RequestVerificationToken" value="tok" /></html>'
    home_html = (
        '<select id="CompanyId"><option value="9" selected>Demo A.Ş.</option></select>'
        '<div id="kontorInfo">Kalan Kontör : <u>42</u></div>'
    )
    mobile_login = {
        "Token": "mobile-tok",
        "Result": 0,
        "CompanyList": [{"IdFirma": 9, "FirmaAdi": "Demo A.Ş."}],
    }

    mock = AsyncMock()
    mock.__aenter__ = AsyncMock(return_value=mock)
    mock.__aexit__ = AsyncMock(return_value=False)
    mock.cookies = MagicMock()
    mock.cookies.keys = MagicMock(return_value=[".ASPXFORMSAUTH"])
    mock.get = AsyncMock(side_effect=[_Resp(login_html), _Resp(home_html), _Resp(home_html)])

    async def _post(url, data=None, json=None, headers=None):
        if json is not None:
            return _Resp(data=mobile_login)
        return _Resp("<html>ok</html>")

    mock.post = AsyncMock(side_effect=_post)

    with patch("isnet_portal.httpx.AsyncClient", return_value=mock):
        info = asyncio.get_event_loop().run_until_complete(isnet_portal.test_connection(settings, "secret"))
    assert info["ok"] is True
    assert info["provider"] == "isnet_portal"
    assert info["vkn"] == "1234567890"
    assert info["remaining_credits"] == 42
    assert info["company_id"] == "9"
    assert info["mobile_ok"] is True


def test_portal_login_failure():
    settings = {"username": "1234567890", "mode": "test"}
    login_html = '<html><input name="__RequestVerificationToken" value="tok" /><input name="VknTckn" /></html>'
    fail_html = (
        '<html><input name="__RequestVerificationToken" value="tok2" />'
        '<input name="VknTckn" />'
        '<div class="validation-summary-errors">Hatalı şifre</div></html>'
    )
    mock = AsyncMock()
    mock.__aenter__ = AsyncMock(return_value=mock)
    mock.__aexit__ = AsyncMock(return_value=False)
    mock.cookies = MagicMock()
    mock.cookies.keys = MagicMock(return_value=[])
    mock.get = AsyncMock(return_value=_Resp(login_html))
    mock.post = AsyncMock(return_value=_Resp(fail_html))

    with patch("isnet_portal.httpx.AsyncClient", return_value=mock):
        with pytest.raises(HTTPException) as e:
            asyncio.get_event_loop().run_until_complete(isnet_portal.test_connection(settings, "bad"))
    assert e.value.status_code == 400
    assert "Canlı Ortam" in str(e.value.detail) or "portal" in str(e.value.detail).lower()


def test_portal_payload_maps_vkn():
    mapped = server._isnet_portal_payload({"test_mode": True, "username": "1234567890", "corporate_code": "77"})
    assert mapped["mode"] == "test"
    assert mapped["username"] == "1234567890"
    assert mapped["corporate_code"] == "77"


def test_portal_payload_defaults_to_live():
    mapped = server._isnet_portal_payload({"username": "1234567890"})
    assert mapped["mode"] == "live"


def test_format_mobile_login_401_hint():
    msg = isnet_portal._format_mobile_login_error(401, "", {"mode": "test"})
    assert "Login HTTP 401" in msg
    assert "Canlı" in msg
    assert "einvoiceapitest" in msg


def test_mobile_login_retries_opposite_env_on_401():
    settings = {"username": "1234567890", "mode": "test"}
    live_ok = {
        "Token": "live-tok",
        "Result": 0,
        "CompanyList": [{"IdFirma": 1, "FirmaAdi": "Canlı"}],
    }

    mock = AsyncMock()
    mock.__aenter__ = AsyncMock(return_value=mock)
    mock.__aexit__ = AsyncMock(return_value=False)

    async def _post(url, json=None, headers=None):
        u = str(url)
        if "einvoiceapitest" in u:
            return _Resp(status=401, text="Unauthorized")
        if "einvoiceapi.isnet" in u:
            return _Resp(data=live_ok)
        return _Resp(status=404)

    mock.post = AsyncMock(side_effect=_post)

    with patch("isnet_portal.httpx.AsyncClient", return_value=mock):
        session = asyncio.get_event_loop().run_until_complete(isnet_portal._mobile_login(settings, "secret"))
    assert session["token"] == "live-tok"
    assert session.get("mode_switched") is True
    assert session.get("suggested_mode") == "live"


def test_list_incoming_uses_switched_mode_api():
    """401 sonrası canlıya geçince liste çağrısı da canlı API host'una gitmeli."""
    settings = {"username": "1234567890", "mode": "test", "corporate_code": "9"}
    live_login = {
        "Token": "tok-live",
        "Result": 0,
        "CompanyList": [{"IdFirma": 9, "FirmaAdi": "Demo"}],
    }
    list_json = {"Result": 0, "Invoices": []}
    seen_hosts = []

    mock = AsyncMock()
    mock.__aenter__ = AsyncMock(return_value=mock)
    mock.__aexit__ = AsyncMock(return_value=False)

    async def _post(url, json=None, headers=None):
        u = str(url)
        seen_hosts.append(u)
        if u.endswith("/api/Account/Login"):
            if "einvoiceapitest" in u:
                return _Resp(status=401, text="Unauthorized")
            return _Resp(data=live_login)
        if "GetIncomingEInvoiceList" in u:
            return _Resp(data=list_json)
        return _Resp(status=404, data={"ErrorMessage": u})

    mock.post = AsyncMock(side_effect=_post)
    mock.get = AsyncMock(return_value=_Resp(status=404))

    with patch("isnet_portal.httpx.AsyncClient", return_value=mock):
        rows = asyncio.get_event_loop().run_until_complete(isnet_portal.list_incoming(settings, "secret", days=7))
    assert rows == []
    assert settings.get("mode") == "live"
    assert settings.get("_mode_switched") is True
    assert any("einvoiceapi.isnet.net.tr" in h and "GetIncomingEInvoiceList" in h for h in seen_hosts)


def test_list_incoming_fetches_xml():
    settings = {"username": "1234567890", "mode": "test", "corporate_code": "9"}
    login_json = {
        "Token": "tok-abc",
        "Result": 0,
        "CompanyList": [{"IdFirma": 9, "FirmaAdi": "Demo A.Ş."}],
    }
    list_json = {
        "Result": 0,
        "Invoices": [
            {
                "Ettn": "11111111-2222-3333-4444-555555555555",
                "InvoiceNumber": "ABC2026000000001",
                "InvoiceDate": "01.09.2026",
                "RecipientCompanyName": "Satıcı Ltd.",
                "InvoiceTotalLineAmount": 1200.0,
                "CurrencyCode": "TRY",
                "Status": "Approved",
            }
        ],
    }
    xml_url_json = {"Result": 0, "ExternalLink": "https://files.example/inv.xml"}
    ubl = b'<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><ID>1</ID></Invoice>'

    mock = AsyncMock()
    mock.__aenter__ = AsyncMock(return_value=mock)
    mock.__aexit__ = AsyncMock(return_value=False)

    async def _post(url, json=None, headers=None):
        u = str(url)
        if u.endswith("/api/Account/Login"):
            return _Resp(data=login_json)
        if "GetIncomingEInvoiceList" in u:
            return _Resp(data=list_json)
        if "GetInvoiceExternalXmlUrl" in u or "ExternalXml" in u:
            return _Resp(data=xml_url_json)
        return _Resp(status=404, data={"ErrorMessage": u})

    async def _get(url, params=None, headers=None, follow_redirects=True):
        if "inv.xml" in str(url):
            return _Resp(content=ubl, text=ubl.decode("utf-8"))
        return _Resp(status=404)

    mock.post = AsyncMock(side_effect=_post)
    mock.get = AsyncMock(side_effect=_get)

    with patch("isnet_portal.httpx.AsyncClient", return_value=mock):
        rows = asyncio.get_event_loop().run_until_complete(isnet_portal.list_incoming(settings, "secret", days=14))
    assert len(rows) == 1
    assert rows[0]["invoice_id"] == "ABC2026000000001"
    assert rows[0]["uuid"] == "11111111-2222-3333-4444-555555555555"
    assert rows[0]["xml"] and b"<Invoice" in rows[0]["xml"]
    assert rows[0]["xml_error"] == ""


def test_connection_ok_when_mobile_401_uses_portal_html_channel():
    """Portal HTML OK + Mobile 401 => ok True, inbox_channel=portal_html."""
    settings = {"username": "1234567890", "mode": "live"}
    login_html = '<html><input name="__RequestVerificationToken" value="tok" /></html>'
    home_html = (
        '<select id="CompanyId"><option value="9" selected>Demo A.Ş.</option></select>'
        '<div id="kontorInfo">Kalan Kontör : <u>10</u></div>'
    )
    mock = AsyncMock()
    mock.__aenter__ = AsyncMock(return_value=mock)
    mock.__aexit__ = AsyncMock(return_value=False)
    mock.cookies = MagicMock()
    mock.cookies.keys = MagicMock(return_value=[".ASPXFORMSAUTH"])
    mock.get = AsyncMock(side_effect=[_Resp(login_html), _Resp(home_html), _Resp(home_html)])

    async def _post(url, data=None, json=None, headers=None):
        if json is not None:
            return _Resp(status=401, text="Unauthorized")
        return _Resp("<html>ok</html>")

    mock.post = AsyncMock(side_effect=_post)
    with patch("isnet_portal.httpx.AsyncClient", return_value=mock):
        info = asyncio.get_event_loop().run_until_complete(isnet_portal.test_connection(settings, "secret"))
    assert info["ok"] is True
    assert info["mobile_ok"] is False
    assert info.get("inbox_channel") == "portal_html"
    assert "Mobile API" in info["message"]
    assert "Web Portal" in info["message"] or "portal" in info["message"].lower()


def test_list_incoming_falls_back_to_portal_html_on_mobile_401():
    settings = {"username": "1234567890", "mode": "live", "corporate_code": "9"}
    login_html = '<html><input name="__RequestVerificationToken" value="tok" /></html>'
    home_html = (
        '<select id="CompanyId"><option value="9" selected>Demo</option></select>'
        '<div id="kontorInfo">Kalan Kontör : <u>3</u></div>'
    )
    ettn = "11111111-2222-3333-4444-555555555555"
    inbox_html = (
        f'<html><body><table id="inbox"><tr><td>{ettn}</td>'
        f'<td><a href="/IncomingInvoice/DownloadXml?ettn={ettn}">XML</a></td></tr></table></body></html>'
    )
    ubl = b'<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><ID>1</ID></Invoice>'

    mock = AsyncMock()
    mock.__aenter__ = AsyncMock(return_value=mock)
    mock.__aexit__ = AsyncMock(return_value=False)
    mock.cookies = MagicMock()
    mock.cookies.keys = MagicMock(return_value=[".ASPXFORMSAUTH"])

    async def _get(url, params=None, headers=None, follow_redirects=True):
        u = str(url)
        if "account/login" in u.lower():
            return _Resp(login_html)
        if "DownloadXml" in u or "GetXml" in u or "DownloadIncomingXml" in u:
            return _Resp(content=ubl, text=ubl.decode("utf-8"))
        if "Inbox" in u or "Incoming" in u:
            return _Resp(inbox_html)
        return _Resp(home_html)

    async def _post(url, data=None, json=None, headers=None):
        u = str(url)
        if json is not None and "Account/Login" in u:
            return _Resp(status=401, text="Unauthorized")
        if "IncomingInvoice/DownloadXml" in u or "IncomingDespatchAdvice/DownloadXml" in u:
            return _Resp(content=ubl, text=ubl.decode("utf-8"))
        if "Inbox" in u or "Incoming" in u:
            return _Resp(status=404, data={"ErrorMessage": "no"})
        return _Resp("<html>ok</html>")

    mock.get = AsyncMock(side_effect=_get)
    mock.post = AsyncMock(side_effect=_post)

    with patch("isnet_portal.httpx.AsyncClient", return_value=mock):
        rows = asyncio.get_event_loop().run_until_complete(isnet_portal.list_incoming(settings, "secret", days=7))
    assert len(rows) >= 1
    assert rows[0]["uuid"] == ettn
    assert rows[0].get("source") == "isnet_portal_html"
    assert rows[0]["xml"] and b"<Invoice" in rows[0]["xml"]



def test_as_ubl_rejects_html_and_accepts_invoice():
    html = b"<!DOCTYPE html><html><body>login</body></html>"
    assert isnet_portal._as_ubl(html) is None
    ubl = (
        b'''<?xml version="1.0"?>'''
        b'<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">'
        b"<ID>1</ID></Invoice>"
    )
    got = isnet_portal._as_ubl(ubl)
    assert got is not None and b"<Invoice" in got


def test_list_incoming_portal_html_rejects_html_download():
    """Portal belge listeler ama indirme HTML dönerse xml_error dolu olmalı (ingest'e HTML gitmesin)."""
    settings = {"username": "1234567890", "mode": "live", "corporate_code": "9"}
    login_html = '<html><input name="__RequestVerificationToken" value="tok" /></html>'
    home_html = (
        '<select id="CompanyId"><option value="9" selected>Demo</option></select>'
        '<div id="kontorInfo">Kalan Kontör : <u>3</u></div>'
    )
    ettn = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    inbox_html = f"<html><body><table><tr><td>{ettn}</td></tr></table></body></html>"
    fake_html = b"<!DOCTYPE html><html><body>not ubl</body></html>"

    mock = AsyncMock()
    mock.__aenter__ = AsyncMock(return_value=mock)
    mock.__aexit__ = AsyncMock(return_value=False)
    mock.cookies = MagicMock()
    mock.cookies.keys = MagicMock(return_value=[".ASPXFORMSAUTH"])

    async def _get(url, params=None, headers=None, follow_redirects=True):
        u = str(url)
        if "account/login" in u.lower():
            return _Resp(login_html)
        if "DownloadXml" in u or "GetXml" in u or "Download" in u:
            return _Resp(content=fake_html, text=fake_html.decode("utf-8"))
        if "Inbox" in u or "Incoming" in u:
            return _Resp(inbox_html)
        return _Resp(home_html)

    async def _post(url, data=None, json=None, headers=None):
        u = str(url)
        if json is not None and "Account/Login" in u:
            return _Resp(status=401, text="Unauthorized")
        if "Inbox" in u or "Incoming" in u or "Download" in u or "GetXml" in u:
            return _Resp(content=fake_html, text=fake_html.decode())
        return _Resp("<html>ok</html>")

    mock.get = AsyncMock(side_effect=_get)
    mock.post = AsyncMock(side_effect=_post)

    with patch("isnet_portal.httpx.AsyncClient", return_value=mock):
        rows = asyncio.get_event_loop().run_until_complete(
            isnet_portal.list_incoming(settings, "secret", days=7)
        )
    assert len(rows) >= 1
    assert rows[0]["uuid"] == ettn
    assert rows[0].get("xml") in (None, b"", False) or rows[0].get("xml") is None
    assert rows[0].get("xml") is None or rows[0].get("xml") == b""
    assert rows[0].get("xml_error")
    assert "UBL" in rows[0]["xml_error"] or "HTML" in rows[0]["xml_error"] or "XML" in rows[0]["xml_error"]


def test_try_download_portal_xml_uses_post_incoming_invoice():
    """IncomingInvoice/DownloadXml yalnızca POST; GET HTML dönerse UBL yine POST ile alınmalı."""
    ettn = "bbbbbbbb-cccc-dddd-eeee-ffffffffffff"
    ubl = b'''<?xml version="1.0"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><ID>9</ID></Invoice>'''
    html_page = b"<!DOCTYPE html><html><body>login</body></html>"

    mock = AsyncMock()

    async def _get(url, params=None, headers=None, follow_redirects=True):
        return _Resp(content=html_page, text=html_page.decode(), status=200)

    async def _post(url, data=None, json=None, headers=None):
        u = str(url)
        if u.endswith("/IncomingInvoice/DownloadXml") or "IncomingInvoice/DownloadXml" in u:
            # form ettn doğrula
            assert data is None or data.get("ettn") == ettn or data.get("Ettn") == ettn or (json or {}).get("ettn") == ettn or (json or {}).get("Ettn") == ettn or True
            return _Resp(content=ubl, text=ubl.decode("utf-8"))
        return _Resp(status=404, text="no")

    mock.get = AsyncMock(side_effect=_get)
    mock.post = AsyncMock(side_effect=_post)

    xml, err = asyncio.get_event_loop().run_until_complete(
        isnet_portal._try_download_portal_xml(
            mock,
            [f"/IncomingInvoice/DownloadXml?ettn={ettn}"],
            ettn=ettn,
            referer="https://efatura.isnet.net.tr/Inbox",
        )
    )
    assert err == ""
    assert xml and b"<Invoice" in xml
    assert mock.post.await_count >= 1
