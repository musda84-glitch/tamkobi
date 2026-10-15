"""Platform gelen kutusu: IMAP mock, 403, HTML temizleme, şifre sızmaz."""
import asyncio
import json
import logging

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import platform_mail
import platform_mail_inbox
import platform_store
import saas
import superadmin_2fa

PASSWORD = "s3cr3t-box-password"
ENC = "enc-box-secret-value"
ADMIN = {"id": "admin1", "email": "admin@nexus.com", "is_super_admin": True}


def _decrypt(value):
    if value != ENC:
        raise ValueError("unexpected ciphertext")
    return PASSWORD


def _headers(ids):
    out = []
    for uid in ids:
        seen = uid != 60
        attachment = uid == 60
        subject = "See the attachment note" if uid == 59 else f"Konu {uid}"
        header = (
            f"From: Ada {uid} <ada{uid}@ex.com>\r\n"
            f"Subject: {subject}\r\n"
            "Date: Thu, 15 Oct 2026 09:00:00 +0000\r\n\r\n"
        ).encode()
        if attachment:
            struct = b' BODYSTRUCTURE (("TEXT" "PLAIN")("APPLICATION" "PDF" ("ATTACHMENT" ("FILENAME" "a.pdf"))))'
        else:
            struct = b' BODYSTRUCTURE (("TEXT" "PLAIN" ("CHARSET" "UTF-8") NIL NIL "7BIT" 10 1))'
        flags = b"(\\Seen)" if seen else b"()"
        meta = b"%d (UID %d FLAGS %s BODY[HEADER.FIELDS (FROM SUBJECT DATE)] {%d}" % (uid, uid, flags, len(header))
        out.append((meta, header))
        out.append(struct + b")")
    return out


def _full(uid):
    raw = (
        "From: Ada <ada@ex.com>\r\n"
        "Subject: Merhaba\r\n"
        "Date: Thu, 15 Oct 2026 09:00:00 +0000\r\n"
        "MIME-Version: 1.0\r\n"
        "Content-Type: multipart/alternative; boundary=bnd\r\n"
        "\r\n"
        "--bnd\r\n"
        "Content-Type: text/plain; charset=utf-8\r\n"
        "\r\n"
        "Duz metin merhaba\r\n"
        "--bnd\r\n"
        "Content-Type: text/html; charset=utf-8\r\n"
        "\r\n"
        "<p>Merhaba</p><script>alert(1)</script>"
        "<iframe src=\"https://evil.example/frame\"></iframe>"
        "<form action=\"https://evil.example/post\"><input type=\"password\" name=\"p\" value=\"pw-leak-value\"></form>"
        "<img src=\"https://tracking.example/pixel.png\" alt=\"px\">"
        "<a href=\"javascript:alert(1)\">tik</a>"
        "<p onclick=\"alert(1)\">Govde</p>\r\n"
        "--bnd--\r\n"
    ).encode()
    flags = b"()"
    meta = b"%d (UID %d FLAGS %s BODY[] {%d}" % (uid, uid, flags, len(raw))
    return [(meta, raw), b")"]


class FakeIMAP:
    created = []
    mode = "ok"

    def __init__(self, host="", port=993, *, ssl_context=None, timeout=None):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.login_args = None
        self.select_args = None
        self.uid_calls = []
        self.logged_out = False
        FakeIMAP.created.append(self)

    def login(self, user, password):
        self.login_args = (user, password)
        if FakeIMAP.mode == "badlogin":
            raise __import__("imaplib").IMAP4.error(f"NO LOGIN {password}")
        return "OK", [b"ok"]

    def select(self, mailbox="INBOX", readonly=False):
        self.select_args = (mailbox, readonly)
        return "OK", [b"60"]

    def uid(self, command, *args):
        cmd = str(command).upper()
        self.uid_calls.append((cmd, args))
        if cmd == "SEARCH":
            return "OK", [b" ".join(str(i).encode() for i in range(1, 61))]
        if cmd == "FETCH":
            spec = args[1] if len(args) > 1 else b""
            spec_b = spec.encode() if isinstance(spec, str) else spec
            uidset = args[0].encode() if isinstance(args[0], str) else args[0]
            ids = [int(part) for part in uidset.split(b",") if part]
            if FakeIMAP.mode == "missing":
                return "OK", [None]
            if b"BODY.PEEK[]" in spec_b:
                return "OK", _full(ids[0])
            return "OK", _headers(ids)
        if cmd == "STORE":
            return "OK", [b"ok"]
        raise AssertionError(cmd)

    def logout(self):
        self.logged_out = True
        return "BYE", [b"out"]


class _Col:
    def __init__(self, rows=None):
        self.rows = {r["_id"]: dict(r) for r in (rows or [])}
        self.inserts = []

    async def find_one(self, query, projection=None):
        for row in self.rows.values():
            if all(row.get(k) == v for k, v in (query or {}).items()):
                return dict(row)
        return None

    async def insert_one(self, doc):
        self.inserts.append(dict(doc))
        self.rows[doc["_id"]] = dict(doc)

    async def update_one(self, *args, **kwargs):
        raise AssertionError("gelen kutusu kutuyu veya iletiyi veritabanına yazmamalı")


class _DB:
    def __init__(self):
        self.platform_mailboxes = _Col([
            {
                "_id": "pmb_in",
                "email": "destek@tamkobi.com",
                "display_name": "Destek",
                "smtp_user": "ses-smtp-user",
                "password_enc": ENC,
                "is_active": True,
                "allow_all_admins": True,
                "allowed_user_ids": ["someone-else"],
            },
            {
                "_id": "pmb_acl",
                "email": "gizli@tamkobi.com",
                "password_enc": ENC,
                "is_active": True,
                "allow_all_admins": False,
                "allowed_user_ids": ["other-admin"],
            },
            {
                "_id": "pmb_off",
                "email": "off@tamkobi.com",
                "password_enc": ENC,
                "is_active": False,
                "allow_all_admins": True,
                "allowed_user_ids": [],
            },
            {
                "_id": "pmb_nopw",
                "email": "bos@tamkobi.com",
                "is_active": True,
                "allow_all_admins": True,
                "allowed_user_ids": [],
            },
        ])
        self.platform_audit_log = _Col([])

    def __getattr__(self, name):
        raise AssertionError(f"beklenmeyen koleksiyon {name}")


def _no_secret(payload):
    blob = payload if isinstance(payload, str) else json.dumps(payload)
    assert PASSWORD not in blob
    assert ENC not in blob
    assert "password" not in blob.lower()


@pytest.fixture
def inbox(monkeypatch):
    prev_mail = platform_mail._db
    prev_store = platform_store._db
    database = _DB()
    platform_mail.init(database)
    platform_store.init(database)
    FakeIMAP.created = []
    FakeIMAP.mode = "ok"
    monkeypatch.setattr(platform_mail_inbox.imaplib, "IMAP4_SSL", FakeIMAP)
    monkeypatch.setattr(platform_mail_inbox.comm_service, "decrypt", _decrypt)

    real_thread = asyncio.to_thread
    real_wait = asyncio.wait_for
    threads = []
    timeouts = []

    async def spy_thread(fn, *args, **kwargs):
        threads.append(getattr(fn, "__name__", ""))
        return await real_thread(fn, *args, **kwargs)

    async def spy_wait(awaitable, timeout):
        timeouts.append(timeout)
        return await real_wait(awaitable, timeout)

    monkeypatch.setattr(platform_mail_inbox.asyncio, "to_thread", spy_thread)
    monkeypatch.setattr(platform_mail_inbox.asyncio, "wait_for", spy_wait)

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
    yield {"db": database, "client": client, "threads": threads, "timeouts": timeouts}
    platform_mail._db = prev_mail
    platform_store._db = prev_store


def _auth(client, method, path, **kwargs):
    kwargs["cookies"] = {"access_token": "tok"}
    return getattr(client, method)(path, **kwargs)


def test_routes_require_super_admin():
    wanted = {
        ("/api/system/mail/mailboxes/{box_id}/messages", "GET"),
        ("/api/system/mail/mailboxes/{box_id}/messages/{uid}", "GET"),
        ("/api/system/mail/mailboxes/{box_id}/messages/{uid}/seen", "POST"),
    }
    seen = set()
    for route in platform_mail.router.routes:
        methods = getattr(route, "methods", None) or set()
        for method in methods:
            seen.add((route.path, method))
            if (route.path, method) not in wanted:
                continue
            calls = []

            def walk(dep):
                calls.append(dep.call)
                for sub in getattr(dep, "dependencies", []) or []:
                    walk(sub)

            for dep in route.dependant.dependencies:
                walk(dep)
            assert saas.require_super_admin in calls
    assert wanted <= seen


def test_sanitize_strips_script_iframe_form_and_remote_images():
    html = (
        "<p>Merhaba</p><script>alert(1)</script>"
        "<iframe src=\"https://evil.example/frame\"></iframe>"
        "<form><input type=\"password\" value=\"pw-leak-value\"></form>"
        "<img src=\"https://tracking.example/pixel.png\" alt=\"px\">"
        "<a href=\"javascript:alert(1)\">tik</a>"
        "<p onclick=\"alert(1)\">Govde</p>"
    )
    clean, blocked = platform_mail_inbox.sanitize_mail_html(html, allow_remote_images=False)
    assert "<script" not in clean.lower()
    assert "alert(1)" not in clean
    assert "<iframe" not in clean.lower()
    assert "<form" not in clean.lower()
    assert "pw-leak-value" not in clean
    assert "tracking.example" not in clean
    assert "javascript:" not in clean.lower()
    assert "Merhaba" in clean and "Govde" in clean
    assert blocked is True
    shown, blocked_on = platform_mail_inbox.sanitize_mail_html(html, allow_remote_images=True)
    assert "tracking.example/pixel.png" in shown
    assert "alert(1)" not in shown
    assert "<script" not in shown.lower()
    assert blocked_on is False


def test_list_reads_live_imap_newest_first_without_password(inbox):
    client = inbox["client"]
    r = _auth(client, "get", "/api/system/mail/mailboxes/pmb_in/messages", params={"page": 1})
    assert r.status_code == 200, r.text
    body = r.json()
    _no_secret(body)
    assert body["page"] == 1
    assert body["page_size"] == 50
    assert body["total"] == 60
    assert len(body["messages"]) == 50
    assert [m["uid"] for m in body["messages"][:2]] == ["60", "59"]
    assert body["messages"][-1]["uid"] == "11"
    first, second = body["messages"][0], body["messages"][1]
    assert set(first) == {"uid", "from", "subject", "date", "seen", "has_attachments"}
    assert first["seen"] is False
    assert first["has_attachments"] is True
    assert first["from"] == "Ada 60 <ada60@ex.com>"
    assert first["subject"] == "Konu 60"
    assert first["date"].startswith("2026-10-15")
    assert second["subject"] == "See the attachment note"
    assert second["has_attachments"] is False
    assert second["seen"] is True
    inst = FakeIMAP.created[-1]
    assert inst.host == "mail.tamkobi.com"
    assert inst.port == 993
    assert inst.timeout == 15
    assert inst.login_args == ("destek@tamkobi.com", PASSWORD)
    assert inst.select_args == ("INBOX", True)
    assert inst.logged_out is True
    fetch = next(call for call in inst.uid_calls if call[0] == "FETCH")
    assert "PEEK" in fetch[1][1]
    assert "RFC822" not in fetch[1][1]
    assert inbox["threads"] == ["imap_list_inbox"]
    assert inbox["timeouts"] == [15]
    assert inbox["db"].platform_audit_log.inserts == []
    assert inbox["db"].platform_mailboxes.rows["pmb_in"]["password_enc"] == ENC
    assert inbox["db"].platform_mailboxes.inserts == []

    page2 = _auth(client, "get", "/api/system/mail/mailboxes/pmb_in/messages", params={"page": 2})
    assert page2.status_code == 200, page2.text
    assert [m["uid"] for m in page2.json()["messages"]] == [str(i) for i in range(10, 0, -1)]
    _no_secret(page2.json())


def test_read_sanitizes_html_audits_and_hides_password(inbox):
    client = inbox["client"]
    r = _auth(client, "get", "/api/system/mail/mailboxes/pmb_in/messages/60")
    assert r.status_code == 200, r.text
    body = r.json()
    _no_secret(body)
    assert set(body) == {"uid", "from", "subject", "date", "seen", "has_attachments", "text", "html", "images_blocked"}
    assert body["uid"] == "60"
    assert body["text"].strip() == "Duz metin merhaba"
    assert "Merhaba" in body["html"] and "Govde" in body["html"]
    assert "<script" not in body["html"].lower()
    assert "alert(1)" not in body["html"]
    assert "<iframe" not in body["html"].lower()
    assert "<form" not in body["html"].lower()
    assert "pw-leak-value" not in body["html"]
    assert "tracking.example" not in body["html"]
    assert body["images_blocked"] is True
    assert body["seen"] is False
    inst = FakeIMAP.created[-1]
    assert inst.select_args == ("INBOX", True)
    fetch = next(call for call in inst.uid_calls if call[0] == "FETCH")
    assert "BODY.PEEK[]" in fetch[1][1]
    assert "imap_read_inbox" in inbox["threads"]
    audits = inbox["db"].platform_audit_log.inserts
    assert len(audits) == 1
    audit = audits[0]
    assert audit["actor_type"] == "super_admin"
    assert audit["actor_id"] == "admin1"
    assert audit["action"] == "platform_mail.inbox.open"
    assert audit["target_type"] == "platform_mailbox"
    assert audit["target_id"] == "pmb_in"
    assert audit["details"]["mailbox_id"] == "pmb_in"
    assert audit["details"]["uid"] == "60"
    assert audit["details"]["email"] == "destek@tamkobi.com"
    assert audit["at"]
    _no_secret(audit)
    assert inbox["db"].platform_mailboxes.rows["pmb_in"]["password_enc"] == ENC

    shown = _auth(client, "get", "/api/system/mail/mailboxes/pmb_in/messages/60", params={"images": "1"})
    assert shown.status_code == 200, shown.text
    assert "tracking.example/pixel.png" in shown.json()["html"]
    assert shown.json()["images_blocked"] is False
    assert "alert(1)" not in shown.json()["html"]
    _no_secret(shown.json())
    assert len(inbox["db"].platform_audit_log.inserts) == 2


def test_mark_seen_and_unseen(inbox):
    client = inbox["client"]
    on = _auth(client, "post", "/api/system/mail/mailboxes/pmb_in/messages/60/seen", json={"seen": True})
    assert on.status_code == 200, on.text
    assert on.json() == {"uid": "60", "seen": True}
    _no_secret(on.json())
    inst = FakeIMAP.created[-1]
    assert inst.select_args == ("INBOX", False)
    assert inst.login_args == ("destek@tamkobi.com", PASSWORD)
    store = next(call for call in inst.uid_calls if call[0] == "STORE")
    assert store[1][0] == b"60"
    assert store[1][1] == "+FLAGS"
    assert store[1][2] == "(\\Seen)"
    assert "imap_set_seen" in inbox["threads"]
    assert inbox["timeouts"] == [15]

    off = _auth(client, "post", "/api/system/mail/mailboxes/pmb_in/messages/60/seen", json={"seen": False})
    assert off.status_code == 200, off.text
    assert off.json()["seen"] is False
    store_off = next(call for call in FakeIMAP.created[-1].uid_calls if call[0] == "STORE")
    assert store_off[1][1] == "-FLAGS"
    assert inbox["db"].platform_audit_log.inserts == []
    assert inbox["db"].platform_mailboxes.rows["pmb_in"]["password_enc"] == ENC


def test_non_super_admin_is_403(monkeypatch):
    async def from_token(token, db, request=None, path=None, **kwargs):
        return {"is_super_admin": False, "id": "u-tenant", "email": "user@firma.com"}

    monkeypatch.setattr(saas, "get_user_from_token", from_token)
    FakeIMAP.created = []
    monkeypatch.setattr(platform_mail_inbox.imaplib, "IMAP4_SSL", FakeIMAP)
    app = FastAPI()
    app.include_router(platform_mail.router)
    client = TestClient(app)
    paths = [
        ("get", "/api/system/mail/mailboxes/pmb_in/messages", {}),
        ("get", "/api/system/mail/mailboxes/pmb_in/messages/60", {}),
        ("post", "/api/system/mail/mailboxes/pmb_in/messages/60/seen", {"json": {"seen": True}}),
    ]
    for method, path, extra in paths:
        response = _auth(client, method, path, **extra)
        assert response.status_code == 403, response.text
        assert PASSWORD not in response.text
    assert FakeIMAP.created == []


def test_super_admin_without_2fa_is_403_when_required(monkeypatch):
    async def from_token(token, db, request=None, path=None, **kwargs):
        return {"is_super_admin": True, "id": "admin1", "email": "admin@nexus.com", "totp_enabled": False}

    async def required(_db):
        return True

    monkeypatch.setattr(saas, "get_user_from_token", from_token)
    monkeypatch.setattr(superadmin_2fa, "platform_requires_2fa", required)
    FakeIMAP.created = []
    monkeypatch.setattr(platform_mail_inbox.imaplib, "IMAP4_SSL", FakeIMAP)
    app = FastAPI()
    app.include_router(platform_mail.router)
    client = TestClient(app)
    response = _auth(client, "get", "/api/system/mail/mailboxes/pmb_in/messages")
    assert response.status_code == 403
    assert FakeIMAP.created == []
    assert PASSWORD not in response.text


def test_mailbox_acl_and_missing_password(inbox):
    client = inbox["client"]
    denied = _auth(client, "get", "/api/system/mail/mailboxes/pmb_acl/messages")
    assert denied.status_code == 403, denied.text
    assert PASSWORD not in denied.text
    inactive = _auth(client, "get", "/api/system/mail/mailboxes/pmb_off/messages")
    assert inactive.status_code == 403, inactive.text
    missing = _auth(client, "get", "/api/system/mail/mailboxes/pmb_nopw/messages")
    assert missing.status_code == 400, missing.text
    assert PASSWORD not in missing.text
    assert ENC not in missing.text
    assert FakeIMAP.created == []


def test_imap_error_does_not_log_password(inbox, caplog):
    FakeIMAP.mode = "badlogin"
    with caplog.at_level(logging.WARNING, logger="platform_mail.inbox"):
        response = _auth(inbox["client"], "get", "/api/system/mail/mailboxes/pmb_in/messages")
    assert response.status_code == 502, response.text
    assert PASSWORD not in response.text
    assert ENC not in response.text
    assert PASSWORD not in caplog.text
    assert "NO LOGIN ***" in caplog.text
    assert inbox["db"].platform_audit_log.inserts == []
