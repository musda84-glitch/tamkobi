"""GİB mükellef sorgusu: üç durum, belge VKN önceliği, önbellek, auth."""
from __future__ import annotations

import asyncio
import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch
from xml.etree import ElementTree as ET

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import e_invoice
import isnet
import isnet_portal
from buyer_tax import buyer_tax_choice


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _body(xml: str) -> ET.Element:
    return ET.fromstring(xml)


SOAP_TAXPAYER = """
<Body xmlns:ein="http://schemas.datacontract.org/2004/07/EInvoice.Service.Model">
  <ein:TaxPayer>
    <ein:TaxPayerName>ERSAY HOME</ein:TaxPayerName>
    <ein:InboxTagList>
      <ein:string>urn:mail:pk@ersay.home</ein:string>
    </ein:InboxTagList>
    <ein:OutboxTagList>
      <ein:string>urn:mail:gb@ersay.home</ein:string>
    </ein:OutboxTagList>
  </ein:TaxPayer>
</Body>
"""

SOAP_EMPTY = "<Body><Result>Success</Result></Body>"

SOAP_NOT_REGISTERED = """
<Body>
  <Message>GİB e-Fatura listesinde kayıtlı değil</Message>
</Body>
"""

SOAP_NOT_FOUND = """
<Body>
  <Message>Kayıt bulunamadı</Message>
</Body>
"""


def test_buyer_tax_choice_doc_before_contact():
    choice = buyer_tax_choice(
        {"contact_tax_id": "3680486408"},
        {"tax_number_or_id": "12345678901"},
    )
    assert choice["tax"] == "3680486408"
    assert choice["mismatch"] is True
    fallback = buyer_tax_choice({"contact_tax_id": ""}, {"tax_id": "6320984412"})
    assert fallback["tax"] == "6320984412"
    assert fallback["mismatch"] is False


def test_soap_taxpayer_present_uses_inbox_alias_not_default():
    settings = {"company_tax_id": "4810173324", "mode": "test"}
    with patch("isnet._soap_call", AsyncMock(return_value=_body(SOAP_TAXPAYER))):
        info = _run(isnet.lookup_user(settings, "", "3680486408"))
    assert info["lookup_status"] == "mukellef"
    assert info["is_e_invoice_user"] is True
    assert info["name"] == "ERSAY HOME"
    assert info["alias"] == "urn:mail:pk@ersay.home"
    assert "urn:mail:gb@ersay.home" in info["aliases"]
    assert info["alias"] != "urn:mail:defaultpk@3680486408.com.tr"


SOAP_NAME_ONLY = """
<Body>
  <TaxPayer>
    <TaxPayerName>ERSAY HOME</TaxPayerName>
  </TaxPayer>
</Body>
"""


def test_soap_name_without_alias_is_mukellef():
    settings = {"company_tax_id": "4810173324", "mode": "test"}
    with patch("isnet._soap_call", AsyncMock(return_value=_body(SOAP_NAME_ONLY))):
        info = _run(isnet.lookup_user(settings, "", "3680486408"))
    assert info["lookup_status"] == "mukellef"
    assert info["is_e_invoice_user"] is True
    assert info["name"] == "ERSAY HOME"
    assert info["alias"] == ""
    assert info["aliases"] == []


def test_soap_taxpayer_missing_is_unknown_not_false():
    settings = {"company_tax_id": "4810173324", "mode": "test"}
    with patch("isnet._soap_call", AsyncMock(return_value=_body(SOAP_EMPTY))):
        with pytest.raises(HTTPException) as exc:
            _run(isnet.lookup_user(settings, "", "3680486408"))
    assert exc.value.status_code == 422
    assert "mükellef değil" not in str(exc.value.detail).lower()
    assert "TaxPayer" in str(exc.value.detail)


def test_soap_explicit_not_registered():
    settings = {"company_tax_id": "4810173324", "mode": "test"}
    with patch("isnet._soap_call", AsyncMock(return_value=_body(SOAP_NOT_REGISTERED))):
        info = _run(isnet.lookup_user(settings, "", "12345678901"))
    assert info["lookup_status"] == "not_mukellef"
    assert info["is_e_invoice_user"] is False


def test_soap_not_found_is_unknown():
    settings = {"company_tax_id": "4810173324", "mode": "test"}
    with patch("isnet._soap_call", AsyncMock(return_value=_body(SOAP_NOT_FOUND))):
        with pytest.raises(HTTPException) as exc:
            _run(isnet.lookup_user(settings, "", "3680486408"))
    assert exc.value.status_code == 422
    assert "bulunamadı" in str(exc.value.detail).lower() or "doğrulanamadı" in str(exc.value.detail)


def test_portal_login_html_and_http_500_are_unknown():
    html = "<html><form>__RequestVerificationToken<input name='VknTckn'><input name='Password' value='s3cret-token'></form></html>"
    with pytest.raises(HTTPException) as login_exc:
        isnet_portal.classify_portal_gib_response(200, html, "https://nettefatura.isnet.net.tr/account/login", "3680486408")
    assert login_exc.value.status_code == 502
    assert "s3cret" not in str(login_exc.value.detail)
    assert "Password" not in str(login_exc.value.detail)
    with pytest.raises(HTTPException) as err_exc:
        isnet_portal.classify_portal_gib_response(500, "internal", "", "3680486408")
    assert err_exc.value.status_code == 502
    assert "internal" not in str(err_exc.value.detail)


def test_portal_missing_endpoint_falls_back_to_soap():
    settings = {"username": "4810173324", "mode": "test", "status": "configured"}

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def login(self):
            return {"ok": True}

        async def lookup_gib_registered_user(self, tax):
            return None

    soap = {
        "tax_id": "3680486408",
        "is_e_invoice_user": True,
        "alias": "urn:mail:pk@ersay.home",
        "aliases": ["urn:mail:pk@ersay.home"],
        "name": "ERSAY HOME",
        "lookup_status": "mukellef",
        "source": "isnet",
    }
    with patch.object(isnet_portal, "IsnetPortalClient", return_value=_Client()), patch(
        "isnet.lookup_user", AsyncMock(return_value=soap)
    ) as looked:
        out = _run(isnet_portal.lookup_user(settings, "pw", "3680486408"))
    looked.assert_awaited()
    assert out["lookup_status"] == "mukellef"
    assert out["source"] == "isnet"
    assert "raw" not in out


def test_unknown_is_not_cached_and_refresh_bypasses():
    e_invoice.clear_mukellef_cache()
    fake_db = MagicMock()
    fake_db.contacts.find_one = AsyncMock(return_value=None)
    fake_db.einvoice_settings.find_one = AsyncMock(return_value={"status": "configured", "provider": "isnet"})
    e_invoice.init(fake_db, {"password_fn": lambda s: "pw"})
    calls = {"n": 0}

    async def lookup(_settings, _pwd, _tax):
        calls["n"] += 1
        if calls["n"] == 1:
            raise HTTPException(status_code=422, detail="GİB yanıtında TaxPayer yok; mükellefiyet doğrulanamadı.")
        return {
            "is_e_invoice_user": True,
            "alias": "urn:mail:pk@ersay.home",
            "aliases": ["urn:mail:pk@ersay.home"],
            "name": "ERSAY HOME",
            "lookup_status": "mukellef",
            "source": "isnet",
        }

    async def _go():
        with patch.object(e_invoice.isnet, "lookup_user", AsyncMock(side_effect=lookup)):
            with pytest.raises(HTTPException):
                await e_invoice.resolve_buyer_mukellef("c-unk", "3680486408")
            assert "c-unk:3680486408:isnet" not in e_invoice._mukellef_cache
            first = await e_invoice.resolve_buyer_mukellef("c-unk", "3680486408")
            second = await e_invoice.resolve_buyer_mukellef("c-unk", "3680486408")
            assert calls["n"] == 2
            assert first["alias"] == second["alias"] == "urn:mail:pk@ersay.home"
            refreshed = await e_invoice.resolve_buyer_mukellef("c-unk", "3680486408", refresh=True)
            assert calls["n"] == 3
            assert refreshed["lookup_status"] == "mukellef"

    try:
        _run(_go())
    finally:
        e_invoice.clear_mukellef_cache()


def _issue_db(*, inv, contact, settings=None):
    company = {"_id": "c1", "name": "Firma", "tax_number": "1234567801"}
    settings = settings if settings is not None else {"status": "simulated"}
    fake_db = MagicMock()

    async def find_invoice(q):
        if q.get("_id") == inv["_id"]:
            return inv
        return settings

    fake_db.invoices.find_one = AsyncMock(side_effect=find_invoice)
    fake_db.contacts.find_one = AsyncMock(return_value=contact)
    fake_db.contacts.update_one = AsyncMock()
    fake_db.companies.find_one = AsyncMock(return_value=company)
    fake_db.einvoice_settings.find_one = AsyncMock(return_value=settings)
    fake_db.invoices.update_one = AsyncMock()
    fake_db.outgoing_einvoice_xml.update_one = AsyncMock()
    return fake_db


def test_issue_invoice_prefers_doc_vkn_and_missing_is_error():
    inv = {
        "_id": "inv_doc",
        "company_id": "c1",
        "invoice_type": "sales",
        "e_type": "auto",
        "status": "draft",
        "contact_id": "cnt",
        "contact_name": "ERSAY HOME",
        "contact_tax_id": "3680486408",
        "invoice_number": "TA2026000000055",
        "items": [{"name": "X", "quantity": 1, "unit_price": 10, "vat_rate": 20}],
    }
    contact = {"_id": "cnt", "name": "Eski", "tax_number_or_id": "12345678901", "is_e_invoice_user": False}
    e_invoice.init(_issue_db(inv=inv, contact=contact), {"consume_credits": AsyncMock(return_value=1)})

    async def _go():
        with patch.object(e_invoice, "build_and_store_xml", AsyncMock(return_value=b"<Invoice/>")), patch.object(
            e_invoice,
            "resolve_buyer_mukellef",
            AsyncMock(return_value={
                "suggested_e_type": "e_invoice",
                "is_e_invoice_user": True,
                "alias": "urn:mail:pk@ersay.home",
                "lookup_status": "mukellef",
            }),
        ) as looked:
            out = await e_invoice.issue_invoice("inv_doc", e_type="auto")
        looked.assert_awaited()
        assert looked.await_args.args[1] == "3680486408"
        assert out["e_type"] == "e_invoice"
        # Cari VKN farklı: kartın bayrağı bu sorgunun sonucuyla yazılmaz.
        e_invoice._db.contacts.update_one.assert_not_awaited()

        blank = {**inv, "_id": "inv_blank", "contact_tax_id": "", "contact_id": "cnt2"}
        blank_contact = {"_id": "cnt2", "name": "Bos", "tax_number_or_id": "", "is_e_invoice_user": False}
        e_invoice.init(_issue_db(inv=blank, contact=blank_contact), {"consume_credits": AsyncMock(return_value=1)})
        with patch.object(e_invoice, "build_and_store_xml", AsyncMock(return_value=b"<Invoice/>")), patch.object(
            e_invoice, "resolve_buyer_mukellef", AsyncMock()
        ) as skipped:
            blank_out = await e_invoice.issue_invoice("inv_blank", e_type="auto")
        skipped.assert_not_awaited()
        assert blank_out["e_type"] == "e_archive"

        with patch.object(e_invoice, "resolve_buyer_mukellef", AsyncMock()) as skipped_explicit:
            with pytest.raises(HTTPException) as explicit:
                await e_invoice.issue_invoice("inv_blank", e_type="e_invoice")
        skipped_explicit.assert_not_awaited()
        assert explicit.value.status_code == 409

        short = {**inv, "_id": "inv_short", "contact_tax_id": "123456789", "contact_id": "cnt3"}
        short_contact = {"_id": "cnt3", "name": "Kisa", "tax_number_or_id": "", "is_e_invoice_user": False}
        e_invoice.init(_issue_db(inv=short, contact=short_contact), {"consume_credits": AsyncMock(return_value=1)})
        with patch.object(e_invoice, "resolve_buyer_mukellef", AsyncMock()) as skipped_short:
            with pytest.raises(HTTPException) as short_exc:
                await e_invoice.issue_invoice("inv_short", e_type="auto")
        skipped_short.assert_not_awaited()
        assert short_exc.value.status_code == 422
        assert short_exc.value.detail == "VKN/TCKN 10 veya 11 haneli olmalı"

        empty_meta = await e_invoice.resolve_buyer_mukellef("c1", "")
        assert empty_meta["suggested_e_type"] == "e_archive"
        assert empty_meta["lookup_status"] == "not_mukellef"
        assert empty_meta["is_e_invoice_user"] is False
        with pytest.raises(HTTPException) as resolve_short:
            await e_invoice.resolve_buyer_mukellef("c1", "123456789")
        assert resolve_short.value.status_code == 422
        assert resolve_short.value.detail == "VKN/TCKN 10 veya 11 haneli olmalı"

    _run(_go())


def test_one_unknown_does_not_archive_the_other_vkn():
    e_invoice.clear_mukellef_cache()
    fake_db = MagicMock()
    fake_db.contacts.find_one = AsyncMock(return_value=None)
    fake_db.einvoice_settings.find_one = AsyncMock(return_value={"status": "configured", "provider": "isnet"})
    e_invoice.init(fake_db, {"password_fn": lambda s: "pw"})

    async def lookup(_settings, _pwd, tax):
        if tax == "1112223334":
            raise HTTPException(status_code=422, detail="GİB yanıtında TaxPayer yok; mükellefiyet doğrulanamadı.")
        return {
            "is_e_invoice_user": True,
            "alias": "urn:mail:pk@ersay.home",
            "aliases": ["urn:mail:pk@ersay.home"],
            "name": "ERSAY HOME",
            "lookup_status": "mukellef",
            "source": "isnet",
        }

    async def _go():
        with patch.object(e_invoice.isnet, "lookup_user", AsyncMock(side_effect=lookup)):
            with pytest.raises(HTTPException) as exc:
                await e_invoice.resolve_buyer_mukellef("c-bulk", "1112223334")
            assert exc.value.status_code == 422
            good = await e_invoice.resolve_buyer_mukellef("c-bulk", "3680486408")
        assert good["suggested_e_type"] == "e_invoice"
        assert good["is_e_invoice_user"] is True
        assert "c-bulk:1112223334:isnet" not in e_invoice._mukellef_cache

    try:
        _run(_go())
    finally:
        e_invoice.clear_mukellef_cache()


def test_gib_lookup_unauthenticated_is_401():
    os.environ.setdefault("JWT_SECRET", "test-gib-lookup-jwt-secret-not-default-value")
    from fastapi.testclient import TestClient
    from server import app

    client = TestClient(app)
    r = client.get("/api/gib/lookup", params={"tax_id": "3680486408", "company_id": "comp_nexus_main_01"})
    assert r.status_code == 401
