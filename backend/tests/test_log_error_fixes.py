"""Sistem loglarındaki dört tekrarlayan hata: SMS dilimi, puantaj _id, mail şifresi, fatura PDF."""
from __future__ import annotations

import asyncio
import logging
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

import attendance
import comm_service
import e_invoice
import isnet
import mail_accounts
import platform_sms
import saas_docs


def _run(coro):
    return asyncio.run(coro)


class _Cur:
    def __init__(self, rows):
        self.rows = list(rows)

    def sort(self, *a, **k):
        return self

    async def to_list(self, n):
        return self.rows[:n]


class _DictText:
    """Sağlayıcı gövdesi sözlük; [:300] KeyError('slice(None, 300, None)') üretir."""

    def __init__(self, payload, status_code=406):
        self.text = payload
        self.status_code = status_code
        self.content = b""
        self.headers = {}

    def json(self):
        raise ValueError("body is not a JSON string")


def test_dict_slice_is_the_logged_keyerror():
    with pytest.raises(KeyError) as ei:
        _DictText({"code": "40"}) .text[:300]
    assert "slice" in str(ei.value)


def test_clip_any_stringifies_dict_and_response():
    dumped = comm_service.clip_any({"code": "40", "description": "reddedildi"})
    assert isinstance(dumped, str)
    assert "40" in dumped
    resp = _DictText({"message": "gönderici başlığı onaylı değil"})
    text = comm_service.clip_any(resp, 300)
    assert "başlığı" in text
    assert not text.startswith("slice(")


def test_im_parse_dict_text_does_not_raise():
    data = comm_service._im_parse(_DictText({"response": {"status": {"code": 401, "message": "başlık hatalı"}}}))
    assert data["response"]["status"]["message"] == "başlık hatalı"


def test_netgsm_send_dict_body_returns_provider_error(monkeypatch):
    payload = {"code": "40", "description": "header rejected"}

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **k):
            return _DictText(payload, status_code=406)

    monkeypatch.setattr(comm_service.httpx, "AsyncClient", _Client)
    res = _run(comm_service.netgsm_send(
        {"usercode": "u", "password": "p", "msgheader": "TAMKOBI"},
        [{"no": "5321234567", "msg": "Merhaba"}],
    ))
    assert res["ok"] is False
    err = res.get("error") or ""
    assert isinstance(err, str)
    assert "slice" not in err
    assert "başlık" in err.lower() or "Gönderici" in err


def test_send_test_dict_response_is_clear_message(monkeypatch):
    payload = {"code": "30", "description": "invalid auth"}

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **k):
            return _DictText(payload, status_code=406)

    platform_sms._db = MagicMock()
    platform_sms._db.sms_logs.insert_one = AsyncMock()
    platform_sms._db.platform_settings.update_one = AsyncMock()
    platform_sms._db.platform_settings.find_one = AsyncMock(return_value={
        "_id": "platform_sms",
        "is_active": True,
        "provider": "netgsm",
        "usercode": "u",
        "password_enc": comm_service.encrypt("secret"),
        "msgheader": "TAMKOBI",
    })
    monkeypatch.setattr(comm_service.httpx, "AsyncClient", _Client)

    out = _run(platform_sms.platform_sms_send_test({"phone": "05321234567", "message": "deneme"}, _={}))
    assert out["ok"] is False
    msg = out.get("message") or ""
    assert "başarısız" in msg.lower()
    assert "slice" not in msg
    assert "şifre" in msg.lower() or "API" in msg or "30" in msg


def test_clean_attendance_row_without_id():
    row = attendance._clean({"date": "2026-10-13", "check_in": "09:00", "status": "present"})
    assert row["date"] == "2026-10-13"
    assert row["id"] is None
    assert "_id" not in row


def test_my_attendance_404_when_personnel_not_linked():
    db = MagicMock()
    db.employees.find_one = AsyncMock(return_value=None)
    attendance.init(db, AsyncMock(return_value={"_id": "user-1"}))
    with pytest.raises(HTTPException) as ei:
        _run(attendance.my_attendance(MagicMock()))
    assert ei.value.status_code == 404
    assert "personel" in ei.value.detail.lower()


def test_my_attendance_404_when_employee_has_no_id():
    db = MagicMock()
    db.employees.find_one = AsyncMock(return_value={"full_name": "Adsız", "company_id": "c1"})
    attendance.init(db, AsyncMock(return_value={"_id": "user-1"}))
    with pytest.raises(HTTPException) as ei:
        _run(attendance.my_attendance(MagicMock()))
    assert ei.value.status_code == 404


def test_my_attendance_record_without_id_does_not_crash(monkeypatch):
    row = {"employee_id": "e1", "date": "2026-10-13", "status": "present", "company_id": "c1"}
    db = MagicMock()
    db.employees.find_one = AsyncMock(return_value={
        "_id": "e1", "company_id": "c1", "full_name": "Ali Veli",
    })
    db.companies.find_one = AsyncMock(return_value={"_id": "c1", "name": "Firma"})
    db.attendance.find_one = AsyncMock(return_value=dict(row))
    db.attendance.find = MagicMock(return_value=_Cur([dict(row)]))
    db.shift_plans.find = MagicMock(return_value=_Cur([]))
    attendance.init(db, AsyncMock(return_value={"_id": "user-1", "employee_id": "e1"}))
    monkeypatch.setattr(attendance, "workplace_for_employee", AsyncMock(return_value=None))

    out = _run(attendance.my_attendance(MagicMock()))
    assert out["employee"]["id"] == "e1"
    assert out["employee"]["full_name"] == "Ali Veli"
    assert any(r.get("date") == "2026-10-13" and r.get("id") is None for r in out["records"])


class _Mail:
    def __init__(self, doc):
        self.doc = dict(doc)

    async def find_one(self, q):
        if not self.doc:
            return None
        if q.get("company_id") and self.doc.get("company_id") != q.get("company_id"):
            return None
        if q.get("_id") and self.doc.get("_id") != q.get("_id"):
            return None
        return dict(self.doc)

    async def update_one(self, filt, upd):
        if self.doc and (not filt.get("_id") or self.doc.get("_id") == filt.get("_id")):
            self.doc.update(upd.get("$set") or {})
        return MagicMock(modified_count=1)


def _bad_mail_doc(**extra):
    good = comm_service.encrypt("secret-a")
    doc = {
        "_id": "ma1",
        "company_id": "c1",
        "email": "a@firma.com",
        "password_enc": good[:20] + "XXXX" + good[24:],
        "imap_host": "imap.example.com",
        "smtp_host": "smtp.example.com",
        "status": "connected",
    }
    doc.update(extra)
    return doc


def _mail_db(doc):
    coll = _Mail(doc)
    db = MagicMock()
    db.mail_accounts = coll
    db.mail_logs = MagicMock()
    mail_accounts.init(db, get_current_user=AsyncMock(return_value={
        "_id": "u1", "company_ids": ["c1"], "active_company_id": "c1", "role": "admin",
    }))
    return db


def _user():
    return {"_id": "u1", "company_ids": ["c1"], "active_company_id": "c1", "role": "admin"}


def _req():
    req = MagicMock()
    req.query_params = {}
    return req


def test_mail_decrypt_failure_is_409_not_500(monkeypatch):
    key_before = os.environ.get("CREDENTIAL_ENCRYPTION_KEY")
    wrote = {"n": 0}

    def _boom(*a, **k):
        wrote["n"] += 1
        raise AssertionError("encryption key must not be rewritten")

    monkeypatch.setattr(comm_service, "_write_stored_key", _boom)
    db = _mail_db(_bad_mail_doc())
    user = _user()

    async def _check(coro):
        with pytest.raises(HTTPException) as ei:
            await coro
        assert ei.value.status_code == 409
        assert ei.value.detail == "Mail şifresi yeniden girilmeli"

    _run(_check(mail_accounts.get_mail_account(_req(), company_id="c1", user=user)))
    _run(_check(mail_accounts.mail_folders(_req(), company_id="c1", user=user)))
    _run(_check(mail_accounts.mail_messages(_req(), company_id="c1", user=user)))
    _run(_check(mail_accounts.send_tracked_mail(
        company_id="c1", to=["b@firma.com"], subject="konu", body="merhaba",
    )))
    assert db.mail_accounts.doc["status"] == "needs_reauth"
    assert wrote["n"] == 0
    assert os.environ.get("CREDENTIAL_ENCRYPTION_KEY") == key_before


def test_mail_decrypt_without_id_still_409(monkeypatch):
    monkeypatch.setattr(comm_service, "_write_stored_key", lambda *a, **k: (_ for _ in ()).throw(AssertionError("key")))
    doc = _bad_mail_doc()
    doc.pop("_id")
    _mail_db(doc)
    with pytest.raises(HTTPException) as ei:
        _run(mail_accounts.load_mail_account("c1"))
    assert ei.value.status_code == 409
    assert ei.value.detail == "Mail şifresi yeniden girilmeli"


def _sent_invoice():
    return {
        "_id": "inv_pdf_err",
        "company_id": "c1",
        "invoice_number": "TA202600000095",
        "e_type": "e_archive",
        "status": "approved",
        "einvoice_state": "sent",
        "gib_uuid": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        "gib_status": "İşNet SOAP API ile GİB'e iletildi",
    }


def test_fetch_integrator_pdf_reraises_provider_error(caplog):
    inv = _sent_invoice()
    settings = {"provider": "isnet", "status": "configured"}
    fake_db = MagicMock()
    fake_db.invoices.find_one = AsyncMock(return_value=inv)
    fake_db.einvoice_settings.find_one = AsyncMock(return_value=settings)
    e_invoice.init(fake_db)
    dl = AsyncMock(side_effect=HTTPException(status_code=502, detail="İşNet PDF: oturum kapalı"))
    with caplog.at_level(logging.WARNING):
        with patch("e_invoice.isnet.download_invoice_pdf", dl):
            with pytest.raises(HTTPException) as ei:
                _run(e_invoice.fetch_integrator_pdf("inv_pdf_err"))
    assert ei.value.status_code == 502
    assert "oturum kapalı" in ei.value.detail
    assert any("oturum kapalı" in r.message for r in caplog.records)


def test_invoice_pdf_shows_integrator_error_and_logs(caplog):
    inv = _sent_invoice()
    saas_docs.init(MagicMock())
    req = MagicMock()
    req.query_params = {}
    with caplog.at_level(logging.WARNING, logger="TamKobiERP"):
        with patch.object(saas_docs, "_require_invoice_doc_access", AsyncMock(return_value=(inv, None))):
            with patch("e_invoice.fetch_integrator_pdf", AsyncMock(side_effect=HTTPException(status_code=502, detail="İşNet SOAP hatası: belge yok"))):
                with pytest.raises(HTTPException) as ei:
                    _run(saas_docs.invoice_pdf("inv_pdf_err", req, require_integrator=True))
    assert ei.value.status_code == 502
    assert "belge yok" in ei.value.detail
    assert "slice" not in str(ei.value.detail)
    assert any("belge yok" in r.message for r in caplog.records)


def test_isnet_pdf_dict_body_is_http_error_not_slice():
    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, *a, **k):
            return _DictText({"ErrorMessage": "Oturum kapalı"}, status_code=500)

    with patch.object(isnet.httpx, "AsyncClient", _Client):
        with pytest.raises(HTTPException) as ei:
            _run(isnet._http_get_invoice_pdf({"api_url": "https://einvoice.example"}, "abc"))
    assert ei.value.status_code == 502
    assert "slice" not in ei.value.detail
    assert "Oturum kapalı" in ei.value.detail
