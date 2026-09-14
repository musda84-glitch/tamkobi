"""İşNet Web Portal (NetteFatura-Portal) birim testleri."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

import isnet_portal
import server


class _Resp:
    def __init__(self, text: str, status: int = 200, data=None):
        self.text = text
        self.status_code = status
        self._json = data if data is not None else {}

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

    mock = AsyncMock()
    mock.__aenter__ = AsyncMock(return_value=mock)
    mock.__aexit__ = AsyncMock(return_value=False)
    mock.cookies = MagicMock()
    mock.cookies.keys = MagicMock(return_value=[".ASPXFORMSAUTH"])
    mock.get = AsyncMock(side_effect=[_Resp(login_html), _Resp(home_html), _Resp(home_html)])
    mock.post = AsyncMock(return_value=_Resp("<html>ok</html>"))

    with patch("isnet_portal.httpx.AsyncClient", return_value=mock):
        info = asyncio.get_event_loop().run_until_complete(isnet_portal.test_connection(settings, "secret"))
    assert info["ok"] is True
    assert info["provider"] == "isnet_portal"
    assert info["vkn"] == "1234567890"
    assert info["remaining_credits"] == 42
    assert info["company_id"] == "9"


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


def test_portal_payload_maps_vkn():
    mapped = server._isnet_portal_payload({"test_mode": True, "username": "1234567890", "corporate_code": "77"})
    assert mapped["mode"] == "test"
    assert mapped["username"] == "1234567890"
    assert mapped["corporate_code"] == "77"
