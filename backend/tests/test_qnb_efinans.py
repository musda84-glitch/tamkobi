"""QNB eFinans iskeleti. Canlı QNB'ye istek yok; httpx / _post mock, WSDL fixture."""
from __future__ import annotations

import asyncio
import base64
import os
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import e_invoice  # noqa: E402
import qnb_efinans  # noqa: E402

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "qnb"
SECRET = "QnbSecret!42"
NS = {"xs": "http://www.w3.org/2001/XMLSchema"}


def _run(coro):
    try:
        loop = asyncio.get_event_loop()
        if loop.is_closed():
            raise RuntimeError
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    return loop.run_until_complete(coro)


@pytest.fixture
def _restore_einvoice_db():
    prev_db = e_invoice._db
    prev_deps = dict(e_invoice._deps)
    yield
    e_invoice._db = prev_db
    e_invoice._deps.clear()
    e_invoice._deps.update(prev_deps)


def _settings(**extra):
    base = {
        "provider": "qnb_efinans",
        "mode": "test",
        "username": "qnb-user",
        "company_tax_id": "1234567890",
        "erp_code": "ERP1",
        "alias": "urn:mail:defaultpk@firma.com.tr",
        "status": "configured",
    }
    base.update(extra)
    return base


def _invoice():
    return {
        "id": "inv_qnb",
        "invoice_number": "QNB2026000000001",
        "invoice_type": "sales",
        "e_type": "e_invoice",
        "gib_scenario": "TEMELFATURA",
        "issue_date": "2026-10-02",
        "items": [{"name": "Kalem", "quantity": 1, "unit_price": 10, "vat_rate": 20, "total": 10}],
        "subtotal": 10,
        "vat_total": 2,
        "grand_total": 12,
        "company_id": "c1",
    }


def _company():
    return {"_id": "c1", "name": "Demo", "tax_number": "1234567890", "city": "İstanbul", "address": "Cadde 1"}


def _contact():
    return {"name": "Alıcı A.Ş.", "tax_number_or_id": "6320984412", "city": "İstanbul", "e_invoice_alias": "urn:mail:pk@alici.com"}


def _xsd_fields(type_name: str) -> set:
    root = ET.parse(FIXTURE / "connectorService.xsd").getroot()
    for el in list(root):
        if el.tag.endswith("complexType") and el.attrib.get("name") == type_name:
            return {child.attrib.get("name") for child in el.iter() if child.tag.endswith("element") and child.attrib.get("name")}
    raise AssertionError(type_name)


def test_wsdl_fixture_has_contract_fields():
    assert (FIXTURE / "connectorService.wsdl").is_file()
    assert (FIXTURE / "userService.wsdl").is_file()
    params = _xsd_fields("gidenBelgeParametreleri")
    for name in ("belgeNo", "veri", "mimeType", "belgeVersiyon", "erpKodu", "alanEtiket", "belgeHash", "belgeTuru", "vergiTcKimlikNo"):
        assert name in params
    durum = _xsd_fields("gidenBelgeDurumParametreleri")
    for name in ("belgeNo", "belgeNoTipi", "belgeTuru", "donusTipiVersiyon"):
        assert name in durum
    assert "belgeOid" in _xsd_fields("belgeGonderExtResponse")
    assert "vergiTcKimlikNo" in _xsd_fields("efaturaKullaniciBilgisi")
    download = _xsd_fields("gidenBelgeleriIndir")
    for name in ("vergiTcKimlikNo", "belgeOidListesi", "belgeTuru", "belgeFormati"):
        assert name in download
    wrapper = (FIXTURE / "connectorService.wsdl").read_text(encoding="utf-8")
    assert "belgeGonderExt" in wrapper
    assert "gidenBelgeDurumSorgulaExt" in wrapper
    assert "gidenBelgeleriIndir" in wrapper
    assert "efaturaKullaniciBilgisi" in wrapper


def test_envelope_has_username_token_and_password_not_logged(caplog):
    caplog.set_level("DEBUG")
    xml = qnb_efinans._soap_envelope("efaturaKullaniciBilgisi", "<vergiTcKimlikNo>1234567890</vergiTcKimlikNo>", "qnb-user", SECRET)
    assert "UsernameToken" in xml
    assert "wsse:Username" in xml
    assert SECRET in xml
    assert SECRET not in caplog.text

    fault = (
        '<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">'
        "<soapenv:Body><soapenv:Fault>"
        f"<faultstring>password={SECRET}</faultstring>"
        f"<wsse:Password>{SECRET}</wsse:Password>"
        "</soapenv:Fault></soapenv:Body></soapenv:Envelope>"
    ).encode()

    class _Resp:
        status_code = 500
        content = fault
        text = fault.decode()

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def post(self, *args, **kwargs):
            return _Resp()

    with patch("qnb_efinans.httpx.AsyncClient", return_value=_Client()):
        with pytest.raises(HTTPException) as exc:
            _run(qnb_efinans._post("https://example.test/connector", "efaturaKullaniciBilgisi", xml))
    assert exc.value.status_code == 502
    assert SECRET not in str(exc.value.detail)
    assert SECRET not in caplog.text


def test_send_document_stores_oid_and_processing_status():
    captured = {}

    async def fake_post(url, action, xml):
        captured["action"] = action
        captured["xml"] = xml
        return (
            '<?xml version="1.0"?><S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/">'
            '<S:Body><ns2:belgeGonderExtResponse xmlns:ns2="http://service.connector.uut.cs.com.tr/">'
            "<belgeOid>OID-123</belgeOid>"
            "</ns2:belgeGonderExtResponse></S:Body></S:Envelope>"
        ).encode()

    with patch.object(qnb_efinans, "_post", side_effect=fake_post):
        result = _run(qnb_efinans.send_document(_settings(), SECRET, _invoice(), _contact(), _company()))
    assert captured["action"] == "belgeGonderExt"
    assert "UsernameToken" in captured["xml"]
    assert SECRET not in str(result)
    assert result["belge_oid"] == "OID-123"
    assert result["qnb_belge_oid"] == "OID-123"
    assert result["einvoice_state"] == "pending"
    assert result["gib_status"] == "Gönderildi (işleniyor)"
    assert result["integrator"] == "qnb_efinans"
    assert result["gib_uuid"] == result["ettn"]
    root = ET.fromstring(captured["xml"])
    veri = ""
    for el in root.iter():
        if el.tag.endswith("veri") and (el.text or "").strip():
            veri = el.text.strip()
    ubl = base64.b64decode(veri).decode("utf-8")
    assert result["invoice_id"] in ubl
    assert result["ettn"] in ubl
    assert "FATURA_UBL" in captured["xml"]
    assert "application/xml" in captured["xml"]
    assert "ERP1" in captured["xml"]


def _status_xml(durum: str, aciklama: str = "") -> bytes:
    return (
        '<?xml version="1.0"?><S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/">'
        "<S:Body><ns2:gidenBelgeDurumSorgulaExtResponse "
        'xmlns:ns2="http://service.connector.uut.cs.com.tr/">'
        f"<return><durum>{durum}</durum><aciklama>{aciklama}</aciklama>"
        "<ettn>25ADF33C-C065-4AB9-A0F2-30A72419C607</ettn>"
        "<belgeNo>QNB2026000000001</belgeNo></return>"
        "</ns2:gidenBelgeDurumSorgulaExtResponse></S:Body></S:Envelope>"
    ).encode()


def test_query_status_processed_and_error(caplog):
    caplog.set_level("DEBUG")
    inv = {**_invoice(), "qnb_belge_oid": "OID-123"}

    async def ok_post(url, action, xml):
        assert action == "gidenBelgeDurumSorgulaExt"
        assert "OID-123" in xml
        assert "belgeNoTipi" in xml
        assert ">OID<" in xml
        assert SECRET not in caplog.text
        return _status_xml("İşlendi")

    with patch.object(qnb_efinans, "_post", side_effect=ok_post):
        ok = _run(qnb_efinans.query_status(_settings(), SECRET, inv))
    assert ok["ok"] is True
    assert ok["einvoice_state"] == "sent"
    assert ok["gib_status"] == "İşlendi"
    assert SECRET not in str(ok)

    async def err_post(url, action, xml):
        return _status_xml("İşleme Hatası", "Şema hatası")

    with patch.object(qnb_efinans, "_post", side_effect=err_post):
        bad = _run(qnb_efinans.query_status(_settings(), SECRET, inv))
    assert bad["ok"] is False
    assert bad["einvoice_state"] == "error"
    assert "Şema hatası" in bad["message"]
    assert "Şema hatası" in bad["gib_status"]

    async def code_post(url, action, xml):
        return _status_xml("3")

    with patch.object(qnb_efinans, "_post", side_effect=code_post):
        coded = _run(qnb_efinans.query_status(_settings(), SECRET, inv))
    assert coded["ok"] is True

    async def fault_post(url, action, xml):
        raise HTTPException(status_code=502, detail="QNB eFinans SOAP hatası.")

    with patch.object(qnb_efinans, "_post", side_effect=fault_post):
        with pytest.raises(HTTPException) as exc:
            _run(qnb_efinans.query_status(_settings(), SECRET, inv))
    assert exc.value.status_code == 502
    assert SECRET not in str(exc.value.detail)


def test_numeric_error_code_uses_aciklama():
    inv = {**_invoice(), "qnb_belge_oid": "OID-9"}

    async def err_post(url, action, xml):
        return _status_xml("2", "Alıcı etiketi yok")

    with patch.object(qnb_efinans, "_post", side_effect=err_post):
        bad = _run(qnb_efinans.query_status(_settings(), SECRET, inv))
    assert bad["einvoice_state"] == "error"
    assert bad["message"] == "Alıcı etiketi yok"


def test_send_rejects_archive_and_dispatch():
    for e_type in ("e_archive", "e_dispatch"):
        with pytest.raises(HTTPException) as exc:
            _run(qnb_efinans.send_document(_settings(), SECRET, {**_invoice(), "e_type": e_type}, _contact(), _company()))
        assert exc.value.status_code == 400
        assert exc.value.detail == qnb_efinans.UNSUPPORTED_DETAIL


def test_live_url_must_be_https():
    with pytest.raises(HTTPException) as exc:
        qnb_efinans.validate_endpoint_url("http://insecure.example/efatura", "e-Fatura", required=True)
    assert exc.value.status_code == 400
    with pytest.raises(HTTPException):
        qnb_efinans.connector_url({"mode": "live", "efatura_url": ""})
    assert qnb_efinans.connector_url({"mode": "test"}) == qnb_efinans.TEST_CONNECTOR_URL
    assert qnb_efinans.connector_url({"mode": "live", "efatura_url": "https://live.example/efatura"}) == "https://live.example/efatura"


def _issue_db(*, inv, contact, company, settings):
    fake_db = MagicMock()
    fake_db.invoices.find_one = AsyncMock(return_value=inv)
    fake_db.invoices.update_one = AsyncMock()
    fake_db.contacts.find_one = AsyncMock(return_value=contact)
    fake_db.contacts.update_one = AsyncMock()
    fake_db.companies.find_one = AsyncMock(return_value=company)
    fake_db.einvoice_settings.find_one = AsyncMock(return_value=settings)
    fake_db.outgoing_einvoice_xml.update_one = AsyncMock()
    return fake_db


def test_issue_archive_and_dispatch_are_400_and_unassigned_stays_simulated(_restore_einvoice_db):
    contact = {"_id": "cnt1", "company_id": "c1", "name": "Alıcı", "tax_number_or_id": "6320984412"}
    company = {"_id": "c1", "name": "Demo", "tax_number": "1234567890"}
    qnb_settings = _settings()

    async def _reject(e_type, invoice_type):
        inv = {
            "_id": "inv_q",
            "company_id": "c1",
            "invoice_type": invoice_type,
            "e_type": e_type,
            "status": "draft",
            "contact_id": "cnt1",
            "contact_name": "Alıcı",
            "contact_tax_id": "6320984412",
            "invoice_number": "QNB1",
            "items": [{"name": "Kalem", "quantity": 1, "unit_price": 10, "vat_rate": 20}],
        }
        e_invoice.init(_issue_db(inv=inv, contact=contact, company=company, settings=qnb_settings), {"password_fn": lambda s: SECRET})
        with patch.object(e_invoice, "resolve_buyer_mukellef", AsyncMock(return_value={"suggested_e_type": e_type, "is_e_invoice_user": e_type == "e_invoice", "alias": None})):
            with pytest.raises(HTTPException) as exc:
                await e_invoice.issue_invoice("inv_q", company_id="c1", e_type=e_type)
        assert exc.value.status_code == 400
        assert exc.value.detail == qnb_efinans.UNSUPPORTED_DETAIL

    _run(_reject("e_archive", "sales"))
    _run(_reject("e_dispatch", "dispatch"))

    inv = {
        "_id": "inv_sim",
        "company_id": "c1",
        "invoice_type": "sales",
        "e_type": "e_invoice",
        "status": "draft",
        "contact_id": "cnt1",
        "contact_name": "Alıcı",
        "contact_tax_id": "6320984412",
        "invoice_number": "SIM1",
        "items": [{"name": "Kalem", "quantity": 1, "unit_price": 10, "vat_rate": 20}],
    }
    e_invoice.init(
        _issue_db(inv=inv, contact=contact, company=company, settings={"provider": "", "status": "simulated", "mode": "test"}),
        {"password_fn": lambda s: "", "consume_credits": AsyncMock(return_value=3)},
    )
    with patch.object(e_invoice, "resolve_buyer_mukellef", AsyncMock(return_value={"suggested_e_type": "e_invoice", "is_e_invoice_user": True, "alias": "urn:mail:pk@x"})), patch.object(
        e_invoice, "build_and_store_xml", AsyncMock(return_value=b"<Invoice/>")
    ), patch.object(qnb_efinans, "send_document", AsyncMock()) as qnb_send:
        out = _run(e_invoice.issue_invoice("inv_sim", company_id="c1", e_type="e_invoice", scenario="TEMEL"))
    qnb_send.assert_not_called()
    assert str(out.get("tracking_id") or "").startswith("GIB-")
    assert out.get("einvoice_state") == "sent"


def test_issue_qnb_einvoice_keeps_processing_and_oid(_restore_einvoice_db):
    contact = {"_id": "cnt1", "company_id": "c1", "name": "Alıcı", "tax_number_or_id": "6320984412", "is_e_invoice_user": True}
    company = {"_id": "c1", "name": "Demo", "tax_number": "1234567890"}
    inv = {
        "_id": "inv_live",
        "company_id": "c1",
        "invoice_type": "sales",
        "e_type": "e_invoice",
        "status": "draft",
        "contact_id": "cnt1",
        "contact_name": "Alıcı",
        "contact_tax_id": "6320984412",
        "invoice_number": "QNB2026000000001",
        "items": [{"name": "Kalem", "quantity": 1, "unit_price": 10, "vat_rate": 20}],
    }
    sent = {
        "ettn": "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
        "gib_uuid": "AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
        "invoice_id": "QNB2026000000001",
        "belge_oid": "OID-777",
        "einvoice_state": "pending",
        "integrator": "qnb_efinans",
        "gib_status": "Gönderildi (işleniyor)",
        "verified": False,
        "mode": "test",
        "document_url": "",
    }
    fake = _issue_db(inv=inv, contact=contact, company=company, settings=_settings())
    e_invoice.init(fake, {"password_fn": lambda s: SECRET, "consume_credits": AsyncMock(return_value=1)})
    with patch.object(e_invoice, "resolve_buyer_mukellef", AsyncMock(return_value={"suggested_e_type": "e_invoice", "is_e_invoice_user": True, "alias": "urn:mail:pk@x"})), patch.object(
        e_invoice, "build_and_store_xml", AsyncMock(return_value=b"<Invoice/>")
    ), patch.object(e_invoice, "store_outgoing_xml", AsyncMock()), patch.object(
        qnb_efinans, "send_document", AsyncMock(return_value=sent)
    ) as qnb_send, patch.object(
        e_invoice.isnet, "build_ubl", return_value=("<Invoice/>", sent["ettn"], sent["invoice_id"])
    ), patch.object(e_invoice.n11faturam, "send_document", AsyncMock()) as n11_send:
        out = _run(e_invoice.issue_invoice("inv_live", company_id="c1", e_type="e_invoice", scenario="TEMEL"))
    qnb_send.assert_awaited()
    n11_send.assert_not_called()
    assert out["einvoice_state"] == "pending"
    assert out["gib_status"] == "Gönderildi (işleniyor)"
    assert out["gib_uuid"] == sent["ettn"]
    sets = [c.args[1]["$set"] for c in fake.invoices.update_one.await_args_list if c.args and "$set" in c.args[1]]
    final = [row for row in sets if row.get("qnb_belge_oid")]
    assert final
    assert final[-1]["qnb_belge_oid"] == "OID-777"
    assert final[-1]["integrator"] == "qnb_efinans"
    assert final[-1]["einvoice_state"] == "pending"


class _Coll:
    def __init__(self, doc=None):
        self.doc = doc

    async def find_one(self, query):
        if self.doc and self.doc.get("company_id") == query.get("company_id"):
            return dict(self.doc)
        return None

    async def update_one(self, query, ops, upsert=False):
        base = dict(self.doc or {})
        if upsert and not self.doc:
            base.update(ops.get("$setOnInsert") or {})
        for key in ops.get("$unset") or {}:
            base.pop(key, None)
        base.update(ops.get("$set") or {})
        base["company_id"] = query.get("company_id") or base.get("company_id")
        self.doc = base


def test_settings_has_creds_hides_password(monkeypatch):
    import server

    coll = _Coll({"_id": "s1", "company_id": "c-qnb", "provider": "qnb_efinans", "mode": "test"})
    monkeypatch.setattr(server.db, "einvoice_settings", coll, raising=False)
    saved = _run(server.save_einvoice_settings({
        "company_id": "c-qnb",
        "username": "qnb-user",
        "password": SECRET,
        "company_tax_id": "1234567890",
        "erp_code": "ERP9",
        "alias": "urn:mail:pk@firma.com",
        "mode": "test",
    }))
    assert saved["status"] == "configured"
    assert saved["has_password"] is True
    assert saved["erp_code"] == "ERP9"
    assert saved["provider"] == "qnb_efinans"
    blob = str(saved)
    assert SECRET not in blob
    assert "password" not in saved
    assert coll.doc.get("password_enc")
    assert SECRET not in coll.doc["password_enc"]

    partial = _run(server.save_einvoice_settings({
        "company_id": "c-qnb",
        "username": "qnb-user",
        "company_tax_id": "",
        "mode": "test",
    }))
    assert partial["status"] == "simulated"

    with pytest.raises(HTTPException) as exc:
        _run(server.save_einvoice_settings({
            "company_id": "c-qnb",
            "username": "qnb-user",
            "company_tax_id": "1234567890",
            "mode": "live",
            "efatura_url": "http://bad.example/efatura",
            "earsiv_url": "https://ok.example/earsiv",
        }))
    assert exc.value.status_code == 400

    meta = server.EINVOICE_PROVIDERS["qnb_efinans"]
    assert meta["name"] == "QNB eFinans (eSolutions)"
    assert meta["fields"] == ["username", "password", "erp_code", "company_tax_id", "alias"]
    assert "api-docs-tr-final" in meta["docs"]
    assert "erpKodu" in meta["hint"]
