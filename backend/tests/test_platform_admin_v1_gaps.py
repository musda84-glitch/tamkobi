"""admin-v1 A6: eski /sistem uçları tam FastAPI uygulamasından (middleware dahil).

Bellek FakeDB. Canlı veritabanı, SMTP, SMS ve PayTR yok.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

import pyotp
import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-admin-v1-gaps-jwt-secret-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import addons  # noqa: E402
import comm_service  # noqa: E402
import db_relocate  # noqa: E402
import einvoice_designs  # noqa: E402
import gib_credits  # noqa: E402
import help_center  # noqa: E402
import isnet  # noqa: E402
import platform_mail  # noqa: E402
import platform_notices  # noqa: E402
import platform_sms  # noqa: E402
import platform_store as store  # noqa: E402
import public_sites  # noqa: E402
import saas  # noqa: E402
import saas_billing  # noqa: E402
import saas_extras  # noqa: E402
import storage_manager  # noqa: E402
import superadmin_2fa  # noqa: E402
import storage_service  # noqa: E402
import support_tickets  # noqa: E402
from test_platform_admin_v1 import FakeDB, _detail, _issue, _signed_headers  # noqa: E402

_OPERATOR = "ops@example.com"
_TOTP = pyotp.random_base32()
_REASON = "Musteri kaydini guvenli sekilde temizlemek icin"
_MISSING_SIG = "Eksik imza başlıkları"
_NEW_SCOPES = (
    "admin.quotas:write",
    "admin.settings:read",
    "admin.settings:write",
    "admin.secrets:write",
    "admin.cms:read",
    "admin.cms:write",
    "admin.maintenance:read",
    "admin.maintenance:write",
    "admin.users:write",
    "admin.keys:write",
    "admin.storage:read",
    "admin.storage:write",
    "admin.ai:read",
    "admin.ai:write",
    "admin.sms:write",
    "admin.einvoice:read",
    "admin.einvoice:write",
    "admin.db:read",
)


def _send(client, secret, key_id, method, path, payload=None, *, idem="idem-1"):
    raw = b"" if payload is None else json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    headers, _, nonce = _signed_headers(secret, key_id, method, path, raw)
    if idem is not None and method != "GET":
        headers["Idempotency-Key"] = idem
    response = client.request(method, path, content=raw, headers=headers)
    return response, nonce


def _audits(db, action):
    return [row for row in db.platform_audit_log.docs.values() if row.get("action") == action]


@pytest.fixture
def gap(monkeypatch):
    import server

    fake = FakeDB()
    prev = {
        "store": store._db,
        "saas": (saas._db, saas._current_user),
        "addons": addons._db,
        "mail": platform_mail._db,
        "sms": platform_sms._db,
        "billing": saas_billing._db,
        "billing_deps": dict(saas_billing._deps),
        "extras": saas_extras._db,
        "notices": platform_notices._db,
        "help": help_center._db,
        "sites": public_sites._db,
        "storage": storage_manager._db,
        "gib": gib_credits._db,
        "designs": einvoice_designs._db,
        "tickets": support_tickets._db,
        "server": server.db,
    }
    store.init(fake)
    saas.init(fake, None)
    saas.invalidate()
    addons.init(fake)
    platform_mail.init(fake)
    platform_sms.init(fake)
    saas_billing.init(fake, {})
    saas_extras.init(fake, {})
    platform_notices.init(fake)
    help_center.init(fake, None)
    public_sites.init(fake)
    storage_manager.init(fake, None, None)
    gib_credits.init(fake, None)
    einvoice_designs.init(fake, None)
    support_tickets.init(fake, None)
    server.db = fake
    monkeypatch.setattr(comm_service, "encrypt", lambda value: "enc:" + (value or ""))
    monkeypatch.setattr(comm_service, "decrypt", lambda value: (value or "").removeprefix("enc:"))
    monkeypatch.setattr(superadmin_2fa, "decrypt", lambda value: (value or "").removeprefix("enc:"))
    monkeypatch.setattr(superadmin_2fa, "encrypt", lambda value: "enc:" + (value or ""))

    async def seed():
        await fake.saas_plans.insert_one({
            "_id": "plan_std",
            "code": "std",
            "name": "Standart",
            "is_public": False,
            "modules": [],
            "user_limit": 5,
            "company_limit": 1,
            "product_limit": 10,
            "contact_limit": 10,
            "storage_limit_mb": 100,
        })
        await fake.companies.insert_one({
            "_id": "comp_parent",
            "name": "Ust Firma",
            "license_id": "comp_parent",
        })
        await fake.companies.insert_one({
            "_id": "comp_child",
            "name": "Alt Firma",
            "license_id": "comp_parent",
            "parent_company_id": "comp_parent",
        })
        await fake.company_licenses.insert_one({
            "_id": "comp_parent",
            "plan_id": "plan_std",
            "status": "active",
            "user_limit": None,
        })
        await fake.users.insert_one({
            "_id": "usr_ops",
            "name": "Operator",
            "email": _OPERATOR,
            "role": "admin",
            "company_ids": [],
            "is_super_admin": True,
            "is_active": True,
            "totp_enabled": True,
            "totp_secret": "enc:" + _TOTP,
        })
        await fake.users.insert_one({
            "_id": "usr_other",
            "name": "Diger",
            "email": "other-sa@example.com",
            "role": "admin",
            "company_ids": [],
            "is_super_admin": True,
            "is_active": True,
        })
        await fake.einvoice_settings.insert_one({
            "_id": "ei1",
            "company_id": "comp_parent",
            "provider": "isnet",
            "username": "NXUSER9911",
            "mode": "test",
            "alias": "urn:mail:defaultpk",
            "company_tax_id": "1234567890",
        })
        await fake.support_tickets.insert_one({
            "_id": "t1",
            "company_id": "comp_parent",
            "messages": [{
                "id": "m1",
                "attachments": [{
                    "url": "/api/files/support/t1/a.pdf",
                    "filename": "a.pdf",
                    "content_type": "application/pdf",
                }],
            }],
        })
        await fake.files.insert_one({
            "_id": "file_t1",
            "company_id": "comp_parent",
            "storage_path": "support/t1/a.pdf",
            "is_deleted": False,
            "content_type": "application/pdf",
        })

    asyncio.run(seed())
    router = server.app.router
    saved_up = list(router.on_startup)
    saved_down = list(router.on_shutdown)
    router.on_startup.clear()
    router.on_shutdown.clear()
    client = TestClient(server.app)
    client.__enter__()
    try:
        yield client, fake
    finally:
        client.__exit__(None, None, None)
        store.init(prev["store"])
        saas.init(prev["saas"][0], prev["saas"][1])
        addons.init(prev["addons"])
        platform_mail.init(prev["mail"])
        platform_sms.init(prev["sms"])
        saas_billing._db = prev["billing"]
        saas_billing._deps.clear()
        saas_billing._deps.update(prev["billing_deps"])
        saas_extras.init(prev["extras"], {})
        platform_notices.init(prev["notices"])
        help_center.init(prev["help"], None)
        public_sites.init(prev["sites"])
        storage_manager.init(prev["storage"], None, None)
        gib_credits.init(prev["gib"], None)
        einvoice_designs.init(prev["designs"], None)
        support_tickets.init(prev["tickets"], None)
        server.db = prev["server"]
        saas.invalidate()


def _full_key(db, name="all"):
    return _issue(db, list(store.ADMIN_SCOPES), name=name)


def _otp():
    return pyotp.TOTP(_TOTP).now()


def test_new_scopes_are_registered():
    for scope in _NEW_SCOPES:
        assert scope in store.ADMIN_SCOPES


def test_unsigned_quota_write_is_signature_error(gap):
    client, _db = gap
    response = client.put(
        "/api/platform/admin-v1/companies/comp_parent/quotas",
        json={"user_limit": 3},
    )
    assert response.status_code == 401, response.text
    assert _detail(response) == _MISSING_SIG
    assert _detail(response) != "Giriş yapmanız gerekiyor."


def test_quota_write_idempotent_and_scoped(gap):
    client, db = gap
    pub, secret = _full_key(db)
    path = "/api/platform/admin-v1/companies/comp_parent/quotas"
    body = {"user_limit": 7, "storage_limit_mb": None}
    first, _ = _send(client, secret, pub["id"], "PUT", path, body, idem="quota-1")
    assert first.status_code == 200, first.text
    assert first.json()["item"]["quota_overrides"]["user_limit"] == 7
    second, _ = _send(client, secret, pub["id"], "PUT", path, body, idem="quota-1")
    assert second.status_code == 200, second.text
    assert second.json()["item"]["quota_overrides"]["user_limit"] == 7
    assert len(_audits(db, "admin_v1.write.quota.update")) == 1
    narrow, narrow_secret = _issue(db, [store.SCOPE_ADMIN_QUOTAS_READ], name="read-only")
    denied, _ = _send(client, narrow_secret, narrow["id"], "PUT", path, {"user_limit": 1}, idem="quota-2")
    assert denied.status_code == 403
    assert db.company_licenses.docs["comp_parent"]["user_limit"] == 7


def test_addon_defaults_round_trip(gap):
    client, db = gap
    pub, secret = _full_key(db, name="addons")
    saved, _ = _send(
        client, secret, pub["id"], "PUT", "/api/platform/admin-v1/addons",
        {"defaults": {"ai.production": False}}, idem="addon-1",
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["item"]["defaults"]["ai.production"] is False
    read, _ = _send(client, secret, pub["id"], "GET", "/api/platform/admin-v1/addons", idem=None)
    assert read.status_code == 200, read.text
    assert read.json()["defaults"]["ai.production"] is False
    assert _audits(db, "admin_v1.write.addon.defaults")


def test_sms_password_is_write_only(gap):
    client, db = gap
    path = "/api/platform/admin-v1/sms/settings"
    body = {"provider": "netgsm", "usercode": "u1", "msgheader": "TAMKOBI", "is_active": True, "password": "sms-pass-99"}
    plain, plain_secret = _issue(db, [store.SCOPE_ADMIN_SMS_WRITE], name="sms")
    denied, _ = _send(client, plain_secret, plain["id"], "PUT", path, body, idem="sms-deny")
    assert denied.status_code == 403
    assert "platform_sms" not in db.platform_settings.docs
    pub, secret = _full_key(db, name="sms-full")
    saved, _ = _send(client, secret, pub["id"], "PUT", path, body, idem="sms-ok")
    assert saved.status_code == 200, saved.text
    text = saved.text
    assert "sms-pass-99" not in text
    assert saved.json()["item"]["has_password"] is True
    stored = db.platform_settings.docs["platform_sms"]["password_enc"]
    assert stored == "enc:sms-pass-99"
    assert _audits(db, "admin_v1.write.sms.save")
    fields = _audits(db, "admin_v1.write.sms.save")[0]["details"]["fields"]
    assert "password" not in fields


def test_settings_iban_and_paytr_and_ai_are_masked(gap, monkeypatch):
    client, db = gap
    pub, secret = _full_key(db, name="settings")
    iban = "TR330006100519786457841326"
    saved, _ = _send(
        client, secret, pub["id"], "PUT", "/api/platform/admin-v1/settings",
        {"legal_iban": iban, "brand_name": "TamKobi"}, idem="set-1",
    )
    assert saved.status_code == 200, saved.text
    item = saved.json()["item"]
    assert iban not in saved.text
    assert item["legal_iban_configured"] is True
    assert item["legal_iban_hint"].startswith("TR")
    assert "ai" not in item and "paytr" not in item
    denied_key, denied_secret = _issue(db, [store.SCOPE_ADMIN_SETTINGS_WRITE], name="no-secret")
    denied, _ = _send(
        client, denied_secret, denied_key["id"], "PUT", "/api/platform/admin-v1/paytr",
        {"merchant_id": "1", "merchant_key": "paytr-key-SECRET", "merchant_salt": "salt-SECRET"},
        idem="paytr-deny",
    )
    assert denied.status_code == 403
    paytr, _ = _send(
        client, secret, pub["id"], "PUT", "/api/platform/admin-v1/paytr",
        {"enabled": False, "merchant_id": "9", "merchant_key": "paytr-key-SECRET", "merchant_salt": "salt-SECRET", "test_mode": True},
        idem="paytr-ok",
    )
    assert paytr.status_code == 200, paytr.text
    assert "paytr-key-SECRET" not in paytr.text
    assert paytr.json()["item"]["has_key"] is True
    assert paytr.json()["item"]["has_salt"] is True
    ai, _ = _send(
        client, secret, pub["id"], "PUT", "/api/platform/admin-v1/ai",
        {"enabled": False, "provider": "openai", "api_key": "sk-live-SECRET99"},
        idem="ai-ok",
    )
    assert ai.status_code == 200, ai.text
    assert "sk-live-SECRET99" not in ai.text
    assert ai.json()["item"]["has_key"] is True
    read, _ = _send(client, secret, pub["id"], "GET", "/api/platform/admin-v1/ai", idem=None)
    assert read.status_code == 200, read.text
    assert "sk-live-SECRET99" not in read.text


def test_mail_server_password_not_returned(gap):
    client, db = gap
    pub, secret = _full_key(db, name="mail")
    created, _ = _send(
        client, secret, pub["id"], "POST", "/api/platform/admin-v1/mail/servers",
        {"name": "Ana", "smtp_host": "smtp.example.com", "smtp_user": "posta@example.com", "password": "smtp-secret"},
        idem="mail-1",
    )
    assert created.status_code == 200, created.text
    assert "smtp-secret" not in created.text
    assert created.json()["item"]["has_password"] is True
    overview, _ = _send(client, secret, pub["id"], "GET", "/api/platform/admin-v1/mail", idem=None)
    assert overview.status_code == 200, overview.text
    assert "smtp-secret" not in overview.text
    assert overview.json()["servers"][0]["has_password"] is True


def test_einvoice_credentials_are_masked(gap):
    client, db = gap
    pub, secret = _full_key(db, name="ei")
    path = "/api/platform/admin-v1/companies/comp_parent/einvoice"
    read, _ = _send(client, secret, pub["id"], "GET", path, idem=None)
    assert read.status_code == 200, read.text
    body = read.json()
    assert body["username_hint"]
    assert "NXUSER9911" not in read.text
    assert "username" not in body
    write = "/api/platform/admin-v1/companies/comp_parent/einvoice/credentials"
    narrow, narrow_secret = _issue(db, [store.SCOPE_ADMIN_EINVOICE_WRITE], name="ei-nosecret")
    denied, _ = _send(
        client, narrow_secret, narrow["id"], "PUT", write,
        {"mode": "live", "password": "ei-secret", "api_key": "ei-key"},
        idem="ei-deny",
    )
    assert denied.status_code == 403
    saved, _ = _send(
        client, secret, pub["id"], "PUT", write,
        {"mode": "live", "password": "ei-secret", "api_key": "ei-key", "despatch_defaults": {"note": "depo"}},
        idem="ei-ok",
    )
    assert saved.status_code == 200, saved.text
    assert "ei-secret" not in saved.text and "ei-key" not in saved.text
    item = saved.json()["item"]
    assert item["has_password"] is True
    assert item["has_api_key"] is True
    assert item["mode"] == "live"
    stored = db.einvoice_settings.docs["ei1"]
    assert stored["password_enc"] == "enc:ei-secret"
    assert stored["api_key_enc"] == "enc:ei-key"


def test_api_key_credential_once_then_revoke(gap):
    client, db = gap
    pub, secret = _full_key(db, name="keys")
    product_id = pub["product_id"]
    created, _ = _send(
        client, secret, pub["id"], "POST", "/api/platform/admin-v1/api-keys",
        {
            "product_id": product_id,
            "name": "Magaza",
            "kind": "product",
            "instance_id": "comp_parent",
            "scopes": ["license:verify"],
        },
        idem="key-create",
    )
    assert created.status_code == 200, created.text
    credential = created.json()["credential"]
    assert credential
    key_id = created.json()["item"]["id"]
    replay, _ = _send(
        client, secret, pub["id"], "POST", "/api/platform/admin-v1/api-keys",
        {
            "product_id": product_id,
            "name": "Magaza",
            "kind": "product",
            "instance_id": "comp_parent",
            "scopes": ["license:verify"],
        },
        idem="key-create",
    )
    assert replay.json()["credential"] == credential
    listed, _ = _send(client, secret, pub["id"], "GET", "/api/platform/admin-v1/api-keys", idem=None)
    assert listed.status_code == 200, listed.text
    assert credential not in listed.text
    scoped, _ = _send(
        client, secret, pub["id"], "PUT", f"/api/platform/admin-v1/api-keys/{key_id}/scopes",
        {"scopes": ["license:verify", "heartbeat"]}, idem="key-scopes",
    )
    assert scoped.status_code == 200, scoped.text
    assert "credential" not in scoped.json()
    self_revoke, _ = _send(
        client, secret, pub["id"], "POST", "/api/platform/admin-v1/danger/key.revoke/prepare",
        {"target_id": pub["id"], "reason": _REASON, "operator_email": _OPERATOR},
        idem="self-revoke",
    )
    assert self_revoke.status_code == 400
    prepared, _ = _send(
        client, secret, pub["id"], "POST", "/api/platform/admin-v1/danger/key.revoke/prepare",
        {"target_id": key_id, "reason": _REASON, "operator_email": _OPERATOR},
        idem="revoke-prep",
    )
    assert prepared.status_code == 200, prepared.text
    token = prepared.json()["confirmation_token"]
    confirmed, _ = _send(
        client, secret, pub["id"], "POST", "/api/platform/admin-v1/danger/key.revoke/confirm",
        {"confirmation_token": token, "confirm_text": "Magaza", "operator_otp": _otp()},
        idem="revoke-ok",
    )
    assert confirmed.status_code == 200, confirmed.text
    assert db.platform_api_keys.docs[key_id].get("revoked_at")


def test_platform_user_password_not_returned(gap):
    client, db = gap
    pub, secret = _full_key(db, name="users")
    created, _ = _send(
        client, secret, pub["id"], "POST", "/api/platform/admin-v1/platform-users",
        {"name": "Yeni Admin", "email": "yeni@example.com", "password": "sifre-123"},
        idem="user-1",
    )
    assert created.status_code == 200, created.text
    assert "sifre-123" not in created.text
    assert created.json()["item"]["is_super_admin"] is True
    assert _audits(db, "admin_v1.write.platform_user.create")


def test_detach_subsidiary_via_danger(gap):
    client, db = gap
    pub, secret = _full_key(db, name="detach")
    prepared, _ = _send(
        client, secret, pub["id"], "POST", "/api/platform/admin-v1/danger/company.detach/prepare",
        {"target_id": "comp_child", "reason": _REASON, "operator_email": _OPERATOR},
        idem="detach-prep",
    )
    assert prepared.status_code == 200, prepared.text
    confirmed, _ = _send(
        client, secret, pub["id"], "POST", "/api/platform/admin-v1/danger/company.detach/confirm",
        {
            "confirmation_token": prepared.json()["confirmation_token"],
            "confirm_text": "Alt Firma",
            "operator_otp": _otp(),
        },
        idem="detach-ok",
    )
    assert confirmed.status_code == 200, confirmed.text
    child = db.companies.docs["comp_child"]
    assert not child.get("parent_company_id")
    assert child["license_id"] == "comp_child"
    assert "comp_child" in db.company_licenses.docs
    assert "comp_parent" in db.company_licenses.docs


def test_maintenance_on_requires_danger_and_gift_threshold(gap):
    client, db = gap
    pub, secret = _full_key(db, name="maint")
    direct, _ = _send(
        client, secret, pub["id"], "PUT", "/api/platform/admin-v1/maintenance",
        {"enabled": True, "title": "Gece bakimi"}, idem="maint-on",
    )
    assert direct.status_code == 400
    assert "danger" in _detail(direct)
    assert not (db.platform_settings.docs.get("platform") or {}).get("maintenance", {}).get("enabled")
    small, _ = _send(
        client, secret, pub["id"], "POST",
        "/api/platform/admin-v1/companies/comp_parent/gib-credits/gift",
        {"credits": 10, "note": "deneme"}, idem="gift-small",
    )
    assert small.status_code == 200, small.text
    assert small.json()["item"]["balance"] == gib_credits.WELCOME_CREDITS + 10
    big, _ = _send(
        client, secret, pub["id"], "POST",
        "/api/platform/admin-v1/companies/comp_parent/gib-credits/gift",
        {"credits": 1001}, idem="gift-big",
    )
    assert big.status_code == 400
    prepared, _ = _send(
        client, secret, pub["id"], "POST", "/api/platform/admin-v1/danger/maintenance.enable/prepare",
        {
            "target_id": "platform",
            "reason": _REASON,
            "operator_email": _OPERATOR,
            "title": "Gece bakimi",
            "notify_popup": False,
            "notify_sms": False,
        },
        idem="maint-prep",
    )
    assert prepared.status_code == 200, prepared.text
    confirmed, _ = _send(
        client, secret, pub["id"], "POST", "/api/platform/admin-v1/danger/maintenance.enable/confirm",
        {
            "confirmation_token": prepared.json()["confirmation_token"],
            "confirm_text": "Gece bakimi",
            "confirm_phrase": "BAKIMI AÇ",
            "operator_otp": _otp(),
        },
        idem="maint-ok",
    )
    assert confirmed.status_code == 200, confirmed.text
    assert db.platform_settings.docs["platform"]["maintenance"]["enabled"] is True
    db.users.docs["usr_ops"]["totp_last_counter"] = None
    gift_prep, _ = _send(
        client, secret, pub["id"], "POST", "/api/platform/admin-v1/danger/gib.gift/prepare",
        {
            "target_id": "comp_parent",
            "reason": _REASON,
            "operator_email": _OPERATOR,
            "credits": 1001,
            "note": "buyuk",
        },
        idem="gift-prep",
    )
    assert gift_prep.status_code == 200, gift_prep.text
    gift_ok, _ = _send(
        client, secret, pub["id"], "POST", "/api/platform/admin-v1/danger/gib.gift/confirm",
        {
            "confirmation_token": gift_prep.json()["confirmation_token"],
            "confirm_text": "Ust Firma",
            "confirm_phrase": "KONTÖR YÜKLE",
            "operator_otp": _otp(),
        },
        idem="gift-ok",
    )
    assert gift_ok.status_code == 200, gift_ok.text
    assert gift_ok.json()["item"]["balance"] == gib_credits.WELCOME_CREDITS + 10 + 1001


def test_database_is_read_only(gap, monkeypatch):
    client, db = gap
    monkeypatch.setattr(db_relocate, "current_settings", lambda: {
        "host": "db.internal",
        "port": 3306,
        "db": "tamkobi",
        "user": "root",
        "password": "s3cret-db",
        "ssl_mode": "REQUIRED",
        "ssl_ca": "/tmp/ca.pem",
    })
    monkeypatch.setattr(db_relocate, "whitelisted_table_counts", lambda cfg: {
        "docs": 4, "meta_indexes": 1, "system_logs": 2, "users": 99,
    })
    pub, secret = _full_key(db, name="db")
    read, _ = _send(client, secret, pub["id"], "GET", "/api/platform/admin-v1/database", idem=None)
    assert read.status_code == 200, read.text
    body = read.json()
    assert body["has_password"] is True
    assert body["tables"] == {"docs": 4, "meta_indexes": 1, "system_logs": 2}
    assert "s3cret-db" not in read.text
    assert "root" not in read.text
    assert "ssl_ca" not in body
    assert "user" not in body
    for path in ("/api/platform/admin-v1/database/move", "/api/platform/admin-v1/database/test"):
        missing = client.post(path, json={"sql": "DROP TABLE docs"})
        assert missing.status_code == 404, path


def test_plan_is_public_still_updates(gap):
    client, db = gap
    pub, secret = _full_key(db, name="plan")
    saved, _ = _send(
        client, secret, pub["id"], "PUT", "/api/platform/admin-v1/plans/plan_std",
        {"is_public": True}, idem="plan-1",
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["item"]["is_public"] is True
    assert db.saas_plans.docs["plan_std"]["is_public"] is True


def test_storage_help_announcement_embed_and_attachment(gap, monkeypatch):
    client, db = gap
    monkeypatch.setattr(storage_service, "get_object", lambda path: (b"%PDF-1", "application/pdf"))
    pub, secret = _full_key(db, name="rest")
    ensured, _ = _send(
        client, secret, pub["id"], "POST",
        "/api/platform/admin-v1/companies/comp_parent/storage/ensure",
        {}, idem="st-1",
    )
    assert ensured.status_code == 200, ensured.text
    assert ensured.json()["item"]["folder_count"] > 0
    article, _ = _send(
        client, secret, pub["id"], "POST", "/api/platform/admin-v1/help/articles",
        {"title": "Kota nasil artar"}, idem="help-1",
    )
    assert article.status_code == 200, article.text
    note, _ = _send(
        client, secret, pub["id"], "POST", "/api/platform/admin-v1/announcements",
        {"title": "Duyuru", "body": "Metin", "notify_sms": False}, idem="ann-1",
    )
    assert note.status_code == 200, note.text
    embed, _ = _send(
        client, secret, pub["id"], "PUT", "/api/platform/admin-v1/einvoice-designs/settings/embed",
        {"xslt_embed": "gzip_base64"}, idem="xslt-1",
    )
    assert embed.status_code == 200, embed.text
    assert embed.json()["item"]["xslt_embed"] == "gzip_base64"
    attachment = client.get(
        "/api/platform/admin-v1/support/tickets/t1/attachments/m1/0",
        headers=_signed_headers(
            secret, pub["id"], "GET",
            "/api/platform/admin-v1/support/tickets/t1/attachments/m1/0", b"",
        )[0],
    )
    assert attachment.status_code == 200, attachment.text
    assert attachment.content.startswith(b"%PDF")
    disposition = attachment.headers.get("content-disposition") or ""
    assert disposition.startswith("attachment;")
    assert "inline" not in disposition.lower()
    assert attachment.headers.get("x-content-type-options") == "nosniff"
