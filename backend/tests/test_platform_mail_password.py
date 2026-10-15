"""Kutu şifresi, eşleşen SMTP kullanıcısı ve eşleşmeyen adres.

Şifre düz metin olarak yanıtta veya logda yer almaz.
"""
import logging

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import platform_mail
import platform_mail_inbox
import saas
import superadmin_2fa

BOX_SECRET = "box-mail-secret-value"
SERVER_SECRET = "server-smtp-secret-value"
ADMIN = {"id": "admin1", "email": "admin@nexus.com", "is_super_admin": True}


def _run(coro):
    return __import__("asyncio").run(coro)


def _match(doc, query):
    for key, cond in (query or {}).items():
        if isinstance(cond, dict) and set(cond) == {"$ne"}:
            if doc.get(key) == cond["$ne"]:
                return False
            continue
        if doc.get(key) != cond:
            return False
    return True


class _Col:
    def __init__(self, rows):
        self.rows = {r["_id"]: dict(r) for r in rows}

    async def find_one(self, query, projection=None):
        for row in self.rows.values():
            if _match(row, query):
                return dict(row)
        return None


class _DB:
    def __init__(self, box, server):
        self.platform_mailboxes = _Col([box])
        self.platform_mail_servers = _Col([server])


class _IMAP:
    created = []

    def __init__(self, host="", port=993, *, ssl_context=None, timeout=None):
        self.login_args = None
        _IMAP.created.append(self)

    def login(self, user, password):
        self.login_args = (user, password)
        return "OK", [b"ok"]

    def select(self, mailbox="INBOX", readonly=False):
        return "OK", [b"0"]

    def uid(self, command, *args):
        if str(command).upper() == "SEARCH":
            return "OK", [b""]
        return "OK", [None]

    def logout(self):
        return "BYE", [b""]


def _server(user="destek@tamkobi.com"):
    return {
        "_id": "pms1",
        "smtp_host": "mail.tamkobi.com",
        "smtp_port": 587,
        "smtp_user": user,
        "password_enc": SERVER_SECRET,
        "is_active": True,
    }


def _box(*, email="destek@tamkobi.com", password_enc="", smtp_user=""):
    return {
        "_id": "pmb1",
        "email": email,
        "display_name": "Destek",
        "server_id": "pms1",
        "smtp_user": smtp_user,
        "password_enc": password_enc,
        "is_active": True,
        "allow_all_admins": True,
        "allowed_user_ids": [],
    }


def _no_secret(blob: str):
    assert BOX_SECRET not in blob
    assert SERVER_SECRET not in blob
    assert "password_enc" not in blob


@pytest.fixture
def mail(monkeypatch):
    _IMAP.created = []
    monkeypatch.setattr(platform_mail_inbox.imaplib, "IMAP4_SSL", _IMAP)

    async def as_admin(token, db, request=None, path=None, **kwargs):
        if token != "tok":
            raise HTTPException(status_code=401, detail="Geçersiz oturum anahtarı")
        return dict(ADMIN)

    async def no_2fa(_db):
        return False

    monkeypatch.setattr(saas, "get_user_from_token", as_admin)
    monkeypatch.setattr(superadmin_2fa, "platform_requires_2fa", no_2fa)
    app = FastAPI()
    app.include_router(platform_mail.router)
    client = TestClient(app)

    def use(box, server):
        monkeypatch.setattr(platform_mail, "_db", _DB(box, server))
        return client

    return use


def _inbox(client):
    return client.get(
        "/api/system/mail/mailboxes/pmb1/messages",
        cookies={"access_token": "tok"},
    )


def test_mailbox_password_is_used_when_present(mail, caplog):
    box = _box(password_enc=BOX_SECRET)
    server = _server(user="baska@tamkobi.com")
    client = mail(box, server)
    with caplog.at_level(logging.DEBUG):
        account = _run(platform_mail._smtp_dict(box, server))
        response = _inbox(client)
    assert account["password"] == BOX_SECRET
    assert account["smtp_user"] == "baska@tamkobi.com"
    assert response.status_code == 200, response.text
    _no_secret(response.text)
    assert _IMAP.created[-1].login_args == (box["email"], BOX_SECRET)
    _no_secret(caplog.text)


def test_server_password_used_when_mailbox_empty_and_user_matches(mail, caplog):
    box = _box(email="Destek@Tamkobi.com", password_enc="")
    server = _server(user=" destek@tamkobi.com ")
    client = mail(box, server)
    with caplog.at_level(logging.DEBUG):
        account = _run(platform_mail._smtp_dict(box, server))
        response = _inbox(client)
    assert account["password"] == SERVER_SECRET
    assert account["email"] == "Destek@Tamkobi.com"
    assert response.status_code == 200, response.text
    _no_secret(response.text)
    assert _IMAP.created[-1].login_args == ("Destek@Tamkobi.com", SERVER_SECRET)
    _no_secret(caplog.text)


def test_missing_password_keeps_error_when_user_differs(mail, caplog):
    box = _box(email="destek@tamkobi.com", password_enc="")
    server = _server(user="ses-smtp-user")
    client = mail(box, server)
    with caplog.at_level(logging.DEBUG):
        with pytest.raises(HTTPException) as raised:
            _run(platform_mail._smtp_dict(box, server))
        tried = _run(platform_mail._try_smtp(box))
        response = _inbox(client)
    assert raised.value.status_code == 400
    assert raised.value.detail == platform_mail.SMTP_PASSWORD_MISSING
    assert tried is None
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == platform_mail.MAILBOX_PASSWORD_MISSING
    _no_secret(response.text)
    _no_secret(str(raised.value.detail))
    _no_secret(caplog.text)
    assert _IMAP.created == []
