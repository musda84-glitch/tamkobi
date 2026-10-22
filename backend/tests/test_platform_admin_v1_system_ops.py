"""admin-v1: İşNet testi, destek paketi, gelen kutu, test postası, sistem logu.

Bellek FakeDB. Canlı İşNet, IMAP, SMTP ve MySQL yok.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

import pyotp
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-admin-v1-system-ops-jwt-secret")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")
_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import comm_service  # noqa: E402
import isnet  # noqa: E402
import platform_admin_v1  # noqa: E402
import platform_admin_v1_danger as danger  # noqa: E402
import platform_admin_v1_integrations as integrations  # noqa: E402
import platform_mail  # noqa: E402
import platform_mail_inbox as inbox  # noqa: E402
import platform_store as store  # noqa: E402
import saas  # noqa: E402
import superadmin_2fa  # noqa: E402
import tenant_idor_allowlist as allowlist  # noqa: E402
from test_platform_admin_v1 import (  # noqa: E402
    FakeDB,
    _detail,
    _issue,
    _plant_key,
    _signed_headers,
    with_peer,
)

_OPERATOR = "ops@example.com"
_OTHER = "ada@example.com"
_TOTP = pyotp.random_base32()
_REASON = "Log dosyalarini guvenli bicimde dondurmek icin"
_PLAIN = "PLAINTEXT-PORTAL-SECRET"
_SMTP = "smtp-secret-value"
_ADMIN_ALLOW_REASON = (
    "Platform yönetim API'si; HMAC platform_admin anahtarı "
    "(kind=platform_admin, admin.* kapsamı), şirket oturumu yok"
)


def _otp() -> str:
    return pyotp.TOTP(_TOTP).now()


def _app():
    app = FastAPI()
    app.include_router(platform_admin_v1.router)
    app.include_router(integrations.router)
    app.include_router(danger.router)
    return app


def _client(ip: str = "198.51.100.20") -> TestClient:
    return TestClient(with_peer(_app(), ip))


def _send(client, secret, key_id, method, path, payload=None, *, params=None, idem="idem-1"):
    raw = b"" if payload is None else json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    headers, _, nonce = _signed_headers(secret, key_id, method, path, raw)
    if idem is not None and method != "GET":
        headers["Idempotency-Key"] = idem
    response = client.request(method, path, content=raw, params=params, headers=headers)
    return response, nonce


def _audits(db, action=None):
    rows = list(db.platform_audit_log.docs.values())
    if action is None:
        return rows
    return [row for row in rows if row.get("action") == action]


@pytest.fixture
def db(monkeypatch):
    import server

    fake = FakeDB()
    prev = (store._db, saas._db, saas._current_user, platform_mail._db, server.db)
    monkeypatch.setattr(comm_service, "encrypt", lambda value: "enc:" + (value or ""))
    monkeypatch.setattr(comm_service, "decrypt", lambda value: (value or "").removeprefix("enc:"))
    monkeypatch.setattr(superadmin_2fa, "encrypt", lambda value: "enc:" + (value or ""))
    monkeypatch.setattr(superadmin_2fa, "decrypt", lambda value: (value or "").removeprefix("enc:"))
    monkeypatch.setenv("LOG_DB_PERSIST", "0")
    store.init(fake)
    saas.init(fake, None)
    saas.invalidate()
    platform_mail.init(fake)
    server.db = fake
    yield fake
    store.init(prev[0])
    saas.init(prev[1], prev[2])
    platform_mail.init(prev[3])
    server.db = prev[4]
    saas.invalidate()


def _seed(db, *, mailbox_password=True, allow_all=True):
    async def run():
        await db.companies.insert_one({"_id": "comp_a", "name": "Ada Ticaret"})
        await db.einvoice_settings.insert_one({
            "_id": "ei_a",
            "company_id": "comp_a",
            "provider": "isnet",
            "mode": "live",
            "alias": "urn:mail:defaultpk@example.com",
            "company_tax_id": "1234567890",
            "username": "1234567890",
            "password_enc": "enc:" + _PLAIN,
        })
        await db.users.insert_one({
            "_id": "usr_ops",
            "name": "Operatör",
            "email": _OPERATOR,
            "is_super_admin": True,
            "is_active": True,
            "totp_enabled": True,
            "totp_secret": "enc:" + _TOTP,
            "totp_last_counter": None,
        })
        await db.users.insert_one({
            "_id": "usr_ada",
            "name": "Ada",
            "email": _OTHER,
            "is_super_admin": False,
            "is_active": True,
            "company_ids": ["comp_a"],
        })
        await db.platform_mail_servers.insert_one({
            "_id": "pms_1",
            "name": "Ana",
            "smtp_host": "smtp.example.com",
            "smtp_port": 587,
            "smtp_user": "posta@example.com",
            "email": "posta@example.com",
            "password_enc": "enc:" + _SMTP,
            "is_active": True,
        })
        box = {
            "_id": "pmb_1",
            "email": "destek@example.com",
            "display_name": "Destek",
            "server_id": "pms_1",
            "allow_all_admins": allow_all,
            "allowed_user_ids": [] if allow_all else ["usr_ada"],
            "is_active": True,
            "is_default": True,
        }
        if mailbox_password:
            box["password_enc"] = "enc:" + _SMTP
        await db.platform_mailboxes.insert_one(box)

    asyncio.run(run())


def test_allowlist_covers_new_path_ids():
    pairs = (
        ("POST", "/platform/admin-v1/companies/{company_id}/isnet/test"),
        ("GET", "/platform/admin-v1/companies/{company_id}/isnet/support-pack"),
        ("GET", "/platform/admin-v1/mail/mailboxes/{box_id}/messages"),
        ("GET", "/platform/admin-v1/mail/mailboxes/{box_id}/messages/{uid}"),
    )
    for pair in pairs:
        assert pair in allowlist.TENANT_IDOR_ALLOWLIST
        assert allowlist.ALLOWLIST_REASONS[pair] == _ADMIN_ALLOW_REASON
    assert danger._LOG_LABEL == "sistem logları"
    assert danger._LOG_PHRASE == "LOGLARI DÖNDÜR"
    assert "logs.rotate" in danger._ACTIONS
    assert "logs.rotate" in danger._PHRASE_ACTIONS


def test_isnet_test_reuses_connection_and_egress_without_secrets(db, monkeypatch):
    _seed(db)
    seen = {}

    async def fake_test(settings, password=""):
        seen["settings"] = dict(settings)
        seen["password"] = password
        seen["calls"] = seen.get("calls", 0) + 1
        return {
            "ok": True,
            "auth": "ip-vkn",
            "message": "İşNet SOAP OK",
            "company_tax_id": "1234567890",
            "test_portal": {"user": "demo", "password": _PLAIN, "url": "https://portal.example"},
        }

    async def fake_info():
        return {
            "egress_ips": ["203.0.113.8"],
            "production_host": "tamkobi.com",
            "production_ips": ["203.0.113.9"],
            "same_as_production": False,
            "support_email": "efaturadestek@nettefatura.com.tr",
        }

    monkeypatch.setattr(isnet, "test_connection", fake_test)
    monkeypatch.setattr(isnet, "isnet_ip_registration_info", fake_info)
    pub, secret = _issue(db, [store.SCOPE_ADMIN_EINVOICE_WRITE], name="ei-write")
    reader, reader_secret = _issue(db, [store.SCOPE_ADMIN_EINVOICE_READ], name="ei-read")
    client = _client()
    path = "/api/platform/admin-v1/companies/comp_a/isnet/test"
    missing = client.post(path, content=b"{}")
    assert missing.status_code == 401
    assert _detail(missing) == "Eksik imza başlıkları"

    denied, _ = _send(
        client, reader_secret, reader["id"], "POST", path,
        {"operator_email": _OPERATOR}, idem="read-no",
    )
    assert denied.status_code == 403
    assert _detail(denied) == "Kapsam yetersiz"
    assert "calls" not in seen

    leaked, _ = _send(
        client, secret, pub["id"], "POST", path,
        {"operator_email": _OPERATOR, "password": _PLAIN}, idem="has-secret",
    )
    assert leaked.status_code == 400
    assert _detail(leaked) == "Desteklenmeyen alan: password"
    assert "calls" not in seen

    outsider, _ = _send(
        client, secret, pub["id"], "POST", path,
        {"operator_email": _OTHER, "mode": "live"}, idem="not-op",
    )
    assert outsider.status_code == 403
    assert _detail(outsider) == "Operatör yetkili değil."

    ok, _ = _send(
        client, secret, pub["id"], "POST", path,
        {"operator_email": _OPERATOR, "mode": "live"}, idem="test-1",
    )
    assert ok.status_code == 200, ok.text
    body = ok.json()
    dumped = json.dumps(body)
    assert body["item"]["ok"] is True
    assert body["item"]["egress"]["egress_ips"] == ["203.0.113.8"]
    assert body["item"]["egress"]["production_ips"] == ["203.0.113.9"]
    assert body["item"]["egress"]["production_host"] == "tamkobi.com"
    assert "message" in body["item"]["egress"]
    assert "password" not in dumped
    assert _PLAIN not in dumped
    assert seen["password"] == ""
    assert seen["settings"]["provider"] == "isnet"
    assert seen["settings"]["mode"] == "live"
    assert seen["calls"] == 1
    again, _ = _send(
        client, secret, pub["id"], "POST", path,
        {"operator_email": _OPERATOR, "mode": "live"}, idem="test-1",
    )
    assert again.status_code == 200
    assert seen["calls"] == 1
    assert _audits(db, "admin_v1.write.isnet.test")
    audit_dump = json.dumps(_audits(db, "admin_v1.write.isnet.test"))
    assert _PLAIN not in audit_dump
    assert "password" not in audit_dump

    missing_company, _ = _send(
        client, secret, pub["id"], "POST",
        "/api/platform/admin-v1/companies/missing/isnet/test",
        {"operator_email": _OPERATOR}, idem="missing-co",
    )
    assert missing_company.status_code == 404
    assert _detail(missing_company) == "Şirket bulunamadı."


def test_isnet_test_failure_still_returns_scrubbed_egress(db, monkeypatch):
    _seed(db)

    async def fake_test(settings, password=""):
        raise HTTPException(
            status_code=400,
            detail=f"İşNet SOAP testi başarısız. portal: {isnet.TEST_PORTAL_USER} / {isnet.TEST_PORTAL_PASSWORD} · {_PLAIN}",
        )

    async def fake_info():
        return {
            "egress_ips": ["203.0.113.8"],
            "production_host": "tamkobi.com",
            "production_ips": ["198.51.100.9"],
            "same_as_production": False,
            "support_email": "efaturadestek@nettefatura.com.tr",
        }

    monkeypatch.setattr(isnet, "test_connection", fake_test)
    monkeypatch.setattr(isnet, "isnet_ip_registration_info", fake_info)
    pub, secret = _issue(db, [store.SCOPE_ADMIN_EINVOICE_WRITE], name="ei-fail")
    client = _client()
    response, _ = _send(
        client, secret, pub["id"], "POST",
        "/api/platform/admin-v1/companies/comp_a/isnet/test",
        {"operator_email": _OPERATOR}, idem="fail-1",
    )
    assert response.status_code == 400, response.text
    detail = response.json()["detail"]
    dumped = json.dumps(detail)
    assert detail["egress"]["egress_ips"] == ["203.0.113.8"]
    assert detail["egress"]["message"]
    assert _PLAIN not in dumped
    assert isnet.TEST_PORTAL_PASSWORD not in dumped
    assert f"{isnet.TEST_PORTAL_USER} / {isnet.TEST_PORTAL_PASSWORD}" not in dumped
    assert "•••" in detail["message"]


def test_support_pack_strips_secrets_and_reuses_builder(db, monkeypatch):
    _seed(db)
    seen = {}

    async def fake_pack(settings=None):
        seen["settings"] = dict(settings or {})
        secret = (settings or {}).get("password_enc") or ""
        return {
            "request_xml": f"<HealthCheck/>{secret}",
            "request_headers": {
                "Content-Type": "text/xml; charset=utf-8",
                "SOAPAction": '"health"',
                "Authorization": "Bearer SUPER",
            },
            "endpoint": "https://einvoiceservice.isnet.net.tr/InvoiceService",
            "response_txt": f"vkn=1234567890 stored={secret} plain={_PLAIN}",
            "egress_ips": ["203.0.113.8"],
            "live_path": {"soap": {"tcp_ok": False}, "password": _PLAIN},
            "http_status": None,
            "error": "",
            "elapsed_ms": 4,
            "support_email": "efaturadestek@nettefatura.com.tr",
            "password": _PLAIN,
            "password_enc": secret,
        }

    monkeypatch.setattr(isnet, "build_isnet_support_pack", fake_pack)
    pub, secret = _issue(db, [store.SCOPE_ADMIN_EINVOICE_READ], name="pack-read")
    writer, writer_secret = _issue(db, [store.SCOPE_ADMIN_EINVOICE_WRITE], name="pack-write")
    client = _client()
    path = "/api/platform/admin-v1/companies/comp_a/isnet/support-pack"
    denied, _ = _send(client, writer_secret, writer["id"], "GET", path, idem=None)
    assert denied.status_code == 403
    ok, _ = _send(client, secret, pub["id"], "GET", path, idem=None)
    assert ok.status_code == 200, ok.text
    body = ok.json()
    dumped = json.dumps(body)
    assert body["request_xml"].startswith("<HealthCheck/>")
    assert _PLAIN not in dumped
    assert "enc:" + _PLAIN not in dumped
    assert "Authorization" not in body["request_headers"]
    assert body["request_headers"]["SOAPAction"] == '"health"'
    assert "password" not in body
    assert "password" not in body["live_path"]
    assert seen["settings"]["mode"] == "live"
    assert seen["settings"]["company_tax_id"] == "1234567890"
    assert _audits(db, "admin_v1.admin.einvoice:read")
    missing, _ = _send(
        client, secret, pub["id"], "GET",
        "/api/platform/admin-v1/companies/missing/isnet/support-pack", idem=None,
    )
    assert missing.status_code == 404


def test_inbox_is_read_only_and_checks_operator(db, monkeypatch):
    _seed(db)
    calls = {"list": [], "read": [], "seen": 0}

    def fake_list(user, password, page):
        calls["list"].append((user, password, page))
        return {
            "page": page,
            "page_size": 50,
            "total": 1,
            "messages": [{
                "uid": "15",
                "from": "Ada <ada@example.com>",
                "subject": "Merhaba",
                "date": "2026-10-01T00:00:00+00:00",
                "seen": False,
                "has_attachments": False,
                "password": _SMTP,
            }],
        }

    def fake_read(user, password, uid, images):
        calls["read"].append((user, password, uid, images))
        return {
            "uid": uid,
            "from": "Ada <ada@example.com>",
            "subject": "Merhaba",
            "date": "2026-10-01T00:00:00+00:00",
            "seen": False,
            "has_attachments": False,
            "text": "govde",
            "html": "<p>govde</p>",
            "images_blocked": not images,
            "password": _SMTP,
        }

    def fake_seen(*_args, **_kwargs):
        calls["seen"] += 1
        raise AssertionError("okundu işareti yazılmamalı")

    monkeypatch.setattr(inbox, "imap_list_inbox", fake_list)
    monkeypatch.setattr(inbox, "imap_read_inbox", fake_read)
    monkeypatch.setattr(inbox, "imap_set_seen", fake_seen)
    reader, reader_secret = _issue(db, [store.SCOPE_ADMIN_MAIL_READ], name="mail-read")
    writer, writer_secret = _issue(db, [store.SCOPE_ADMIN_SETTINGS_WRITE], name="mail-write")
    client = _client()
    list_path = "/api/platform/admin-v1/mail/mailboxes/pmb_1/messages"
    denied, _ = _send(client, writer_secret, writer["id"], "GET", list_path, params={"page": 1, "operator_email": _OPERATOR}, idem=None)
    assert denied.status_code == 403
    missing_op, _ = _send(client, reader_secret, reader["id"], "GET", list_path, params={"page": 1}, idem=None)
    assert missing_op.status_code == 400
    assert _detail(missing_op) == "operator_email zorunlu."
    staff, _ = _send(
        client, reader_secret, reader["id"], "GET", list_path,
        params={"page": 1, "operator_email": _OTHER}, idem=None,
    )
    assert staff.status_code == 403
    assert _detail(staff) == "Operatör yetkili değil."
    listed, _ = _send(
        client, reader_secret, reader["id"], "GET", list_path,
        params={"page": 2, "operator_email": _OPERATOR}, idem=None,
    )
    assert listed.status_code == 200, listed.text
    body = listed.json()
    dumped = json.dumps(body)
    assert body["page"] == 2
    assert body["total"] == 1
    assert body["messages"][0]["uid"] == "15"
    assert body["messages"][0]["subject"] == "Merhaba"
    assert "password" not in dumped
    assert _SMTP not in dumped
    assert calls["list"] == [("destek@example.com", _SMTP, 2)]
    assert calls["seen"] == 0

    bad_uid, _ = _send(
        client, reader_secret, reader["id"], "GET",
        "/api/platform/admin-v1/mail/mailboxes/pmb_1/messages/abc",
        params={"operator_email": _OPERATOR}, idem=None,
    )
    assert bad_uid.status_code == 400
    assert _detail(bad_uid) == "Geçersiz ileti numarası."

    opened, _ = _send(
        client, reader_secret, reader["id"], "GET",
        "/api/platform/admin-v1/mail/mailboxes/pmb_1/messages/15",
        params={"operator_email": _OPERATOR, "images": "true"}, idem=None,
    )
    assert opened.status_code == 200, opened.text
    message = opened.json()
    assert message["text"] == "govde"
    assert message["images_blocked"] is False
    assert _SMTP not in json.dumps(message)
    assert calls["read"] == [("destek@example.com", _SMTP, "15", True)]
    assert calls["seen"] == 0
    opened_audit = _audits(db, "platform_mail.inbox.open")
    assert opened_audit
    assert opened_audit[0]["details"]["uid"] == "15"
    assert _SMTP not in json.dumps(opened_audit)


def test_inbox_imap_error_hides_password(db, monkeypatch):
    _seed(db)

    def fake_list(user, password, page):
        raise inbox.InboxImapError(f"login failed {password}")

    monkeypatch.setattr(inbox, "imap_list_inbox", fake_list)
    pub, secret = _issue(db, [store.SCOPE_ADMIN_MAIL_READ], name="mail-err")
    client = _client()
    response, _ = _send(
        client, secret, pub["id"], "GET",
        "/api/platform/admin-v1/mail/mailboxes/pmb_1/messages",
        params={"operator_email": _OPERATOR}, idem=None,
    )
    assert response.status_code == 502
    assert _detail(response) == "IMAP bağlantısı kurulamadı."
    assert _SMTP not in response.text


def test_inbox_restricted_mailbox_denies_other_operator(db, monkeypatch):
    _seed(db, allow_all=False)
    monkeypatch.setattr(inbox, "imap_list_inbox", lambda *_a, **_k: {"page": 1, "page_size": 50, "total": 0, "messages": []})
    pub, secret = _issue(db, [store.SCOPE_ADMIN_MAIL_READ], name="mail-acl")
    client = _client()
    response, _ = _send(
        client, secret, pub["id"], "GET",
        "/api/platform/admin-v1/mail/mailboxes/pmb_1/messages",
        params={"operator_email": _OPERATOR}, idem=None,
    )
    assert response.status_code == 403
    assert _detail(response) == "Bu kutuyu kullanma yetkiniz yok."


def test_send_test_uses_mailbox_and_hides_smtp_secret(db, monkeypatch):
    _seed(db)
    sent = {}

    async def fake_smtp(acc, recipients, subject, body, html=None):
        sent["acc"] = dict(acc)
        sent["recipients"] = list(recipients)
        sent["subject"] = subject
        sent["calls"] = sent.get("calls", 0) + 1

    monkeypatch.setattr(comm_service, "smtp_send", fake_smtp)
    pub, secret = _issue(db, [store.SCOPE_ADMIN_SETTINGS_WRITE], name="smtp")
    reader, reader_secret = _issue(db, [store.SCOPE_ADMIN_MAIL_READ], name="no-send")
    _plant_key(db, key_id="pk_product_mail", secret="product-secret", kind="product", scopes=[store.SCOPE_ADMIN_SETTINGS_WRITE])
    client = _client()
    path = "/api/platform/admin-v1/mail/send-test"
    body = {"operator_email": _OPERATOR, "mailbox_id": "pmb_1", "to": "hedef@example.com", "subject": "Deneme"}
    denied, _ = _send(client, reader_secret, reader["id"], "POST", path, body, idem="no-scope")
    assert denied.status_code == 403
    product, _ = _send(client, "product-secret", "pk_product_mail", "POST", path, body, idem="kind")
    assert product.status_code == 403
    no_key = client.post(path, content=json.dumps(body).encode("utf-8"), headers=_signed_headers(secret, pub["id"], "POST", path, json.dumps(body).encode("utf-8"))[0])
    assert no_key.status_code == 400
    assert _detail(no_key) == "Idempotency-Key gerekli"
    ok, _ = _send(client, secret, pub["id"], "POST", path, body, idem="send-1")
    assert ok.status_code == 200, ok.text
    item = ok.json()["item"]
    dumped = json.dumps(ok.json())
    assert item["ok"] is True
    assert item["from"] == "destek@example.com"
    assert item["to"] == "hedef@example.com"
    assert _SMTP not in dumped
    assert sent["acc"]["password"] == _SMTP
    assert sent["recipients"] == ["hedef@example.com"]
    assert sent["subject"] == "Deneme"
    assert sent["calls"] == 1
    again, _ = _send(client, secret, pub["id"], "POST", path, body, idem="send-1")
    assert again.status_code == 200
    assert sent["calls"] == 1
    audit = _audits(db, "admin_v1.write.mail.send_test")
    assert audit
    assert audit[-1]["details"]["mailbox_id"] == "pmb_1"
    assert audit[-1]["details"]["to"] == "hedef@example.com"
    assert _SMTP not in json.dumps(audit)


def test_system_logs_page_filters_and_redacts(db, monkeypatch):
    _seed(db)
    seen = {}

    def fake_page(**kwargs):
        seen.update(kwargs)
        return {
            "items": [{
                "id": 90,
                "level": "ERROR",
                "category": "error",
                "event": "panel_error",
                "message": "disk full",
                "password": "LOG-SECRET",
                "details": {"token": "LEAK-TOKEN", "stack": "x"},
            }],
            "total": 4,
        }

    monkeypatch.setattr("applog.query_log_page", fake_page)
    # Endpoint imports applog directly.
    import applog
    monkeypatch.setattr(applog, "query_log_page", fake_page)
    pub, secret = _issue(db, [store.SCOPE_ADMIN_SYSTEM_READ], name="logs")
    other, other_secret = _issue(db, [store.SCOPE_ADMIN_MAIL_READ], name="not-logs")
    client = _client()
    path = "/api/platform/admin-v1/system/logs"
    denied, _ = _send(client, other_secret, other["id"], "GET", path, idem=None)
    assert denied.status_code == 403
    ok, _ = _send(
        client, secret, pub["id"], "GET", path,
        params={"level": "ERROR", "q": "disk", "offset": 0, "limit": 1, "before_id": 100, "category": "error"},
        idem=None,
    )
    assert ok.status_code == 200, ok.text
    body = ok.json()
    dumped = json.dumps(body)
    assert body["total"] == 4
    assert body["limit"] == 1
    assert body["offset"] == 0
    assert body["before_id"] == 100
    assert body["next_before_id"] == 90
    assert body["items"][0]["message"] == "disk full"
    assert "password" not in dumped
    assert "LOG-SECRET" not in dumped
    assert "token" not in dumped
    assert "LEAK-TOKEN" not in dumped
    assert seen["level"] == "ERROR"
    assert seen["q"] == "disk"
    assert seen["before_id"] == 100
    assert seen["limit"] == 1
    assert seen["category"] == "error"
    long, _ = _send(client, secret, pub["id"], "GET", path, params={"q": "x" * 201}, idem=None)
    assert long.status_code == 400
    assert _audits(db, "admin_v1.admin.system:read")


def test_log_rotation_is_danger_action(db, monkeypatch):
    _seed(db)
    calls = []

    def fake_rotate():
        calls.append("rotate")
        return {
            "log_dir": "/var/log/tamkobi",
            "rotated": ["/var/log/tamkobi/app.log.1.gz"],
            "deleted": [],
            "purged_rows": 3,
            "max_bytes": 100,
            "retention_days": 14,
        }

    monkeypatch.setattr("applog.rotate_files", fake_rotate)
    import applog
    monkeypatch.setattr(applog, "rotate_files", fake_rotate)
    pub, secret = _issue(db, [store.SCOPE_ADMIN_DANGEROUS], name="danger")
    reader, reader_secret = _issue(db, [store.SCOPE_ADMIN_SYSTEM_READ], name="read-only")
    client = _client()
    prepare_path = "/api/platform/admin-v1/danger/logs.rotate/prepare"
    confirm_path = "/api/platform/admin-v1/danger/logs.rotate/confirm"
    payload = {"target_id": "platform", "reason": _REASON, "operator_email": _OPERATOR}
    denied, _ = _send(client, reader_secret, reader["id"], "POST", prepare_path, payload, idem="no-danger")
    assert denied.status_code == 403
    assert calls == []
    bad_target, _ = _send(
        client, secret, pub["id"], "POST", prepare_path,
        {**payload, "target_id": "comp_a"}, idem="bad-target",
    )
    assert bad_target.status_code == 400
    assert _detail(bad_target) == "target_id platform olmalı."
    assert calls == []
    prepared, _ = _send(client, secret, pub["id"], "POST", prepare_path, payload, idem="prep-logs")
    assert prepared.status_code == 200, prepared.text
    prep = prepared.json()
    assert prep["target_label"] == "sistem logları"
    assert prep["confirm_phrase"] == "LOGLARI DÖNDÜR"
    assert prep["confirm_text_hint"] == danger._LOG_HINT
    assert prep["preview"]["retention_days"] == applog.LOG_RETENTION_DAYS
    assert calls == []
    token = prep["confirmation_token"]
    assert token not in json.dumps(_audits(db, "admin_v1.danger.logs.rotate.prepare"))

    wrong, _ = _send(
        client, secret, pub["id"], "POST", confirm_path,
        {
            "confirmation_token": token,
            "confirm_text": "sistem logları",
            "confirm_phrase": "YANLIS",
            "operator_otp": _otp(),
        },
        idem="wrong-phrase",
    )
    assert wrong.status_code == 400
    assert "LOGLARI DÖNDÜR" in _detail(wrong)
    assert calls == []

    bad_otp, _ = _send(
        client, secret, pub["id"], "POST", confirm_path,
        {
            "confirmation_token": token,
            "confirm_text": "sistem logları",
            "confirm_phrase": "LOGLARI DÖNDÜR",
            "operator_otp": "000000" if _otp() != "000000" else "111111",
        },
        idem="bad-otp",
    )
    assert bad_otp.status_code == 403
    assert calls == []

    ok, _ = _send(
        client, secret, pub["id"], "POST", confirm_path,
        {
            "confirmation_token": token,
            "confirm_text": "sistem logları",
            "confirm_phrase": "LOGLARI DÖNDÜR",
            "operator_otp": _otp(),
        },
        idem="confirm-logs",
    )
    assert ok.status_code == 200, ok.text
    item = ok.json()["item"]
    assert item["purged_rows"] == 3
    assert item["rotated"] == ["/var/log/tamkobi/app.log.1.gz"]
    assert calls == ["rotate"]
    confirm_audit = _audits(db, "admin_v1.danger.logs.rotate.confirm")
    assert confirm_audit
    assert confirm_audit[-1]["details"]["result"]["rotated"] == 1
    assert confirm_audit[-1]["details"]["result"]["purged_rows"] == 3
    again, _ = _send(
        client, secret, pub["id"], "POST", confirm_path,
        {
            "confirmation_token": token,
            "confirm_text": "sistem logları",
            "confirm_phrase": "LOGLARI DÖNDÜR",
            "operator_otp": _otp(),
        },
        idem="confirm-logs",
    )
    assert again.status_code == 200
    assert calls == ["rotate"]
