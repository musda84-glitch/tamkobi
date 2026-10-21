"""admin-v1 AI testi ve boş sır alanları: tam FastAPI uygulaması.

Kayıtlı AI anahtarı çağıranın seçtiği sağlayıcıya veya uç noktaya gitmez.
E-fatura, PayTR ve IBAN alanları boş veya yalnızca boşluk olsa da
admin.secrets:write olmadan yazılmaz. Sırın bağlı olduğu uç veya kullanıcı
(AI, SMTP kapı dahil, IMAP, e-fatura adresi ve kullanıcı, SMS sağlayıcı)
değişince de aynı kapsam gerekir; yeni sır yoksa kayıtlı sır düşer.
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
from unittest.mock import AsyncMock

os.environ.setdefault("JWT_SECRET", "test-admin-v1-integrations-security-jwt-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import ai_service  # noqa: E402
import comm_service  # noqa: E402
import gib_credits  # noqa: E402
import platform_mail  # noqa: E402
import platform_sms  # noqa: E402
import public_sites  # noqa: E402
import platform_store as store  # noqa: E402
import saas  # noqa: E402
import saas_billing  # noqa: E402
import saas_extras  # noqa: E402
import superadmin_2fa  # noqa: E402
from test_platform_admin_v1 import FakeDB, _detail, _issue, _signed_headers  # noqa: E402

_COMPANY = "comp_security"
_STORED_AI = "stored-ai-key-value"
_STORED_URL = "https://stored.example/v1"
_EVIL_URL = "https://evil.example/v1"
_CALLER_KEY = "caller-supplied-ai-key"
_IBAN = "TR330006100519786457841326"
_EI_PASS = "enc:stored-ei-pass"
_EI_KEY = "enc:stored-ei-key"
_PAYTR_KEY = "enc:stored-merchant-key"
_PAYTR_SALT = "enc:stored-merchant-salt"
_OPERATOR = "ops@example.com"
_TOTP = pyotp.random_base32()
_REASON = "Canli adresi ve 2FA zorunlulugunu onayli degistir"
_SMTP_SECRET = "stored-smtp-secret"
_BOX_SECRET = "stored-box-secret"
_SMS_SECRET = "stored-sms-secret"
_NEW_URL = "https://app.example.test"


def _send(client, secret, key_id, method, path, payload=None, *, idem="idem-1"):
    raw = b"" if payload is None else json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    headers, _, _nonce = _signed_headers(secret, key_id, method, path, raw)
    if idem is not None and method != "GET":
        headers["Idempotency-Key"] = idem
    return client.request(method, path, content=raw, headers=headers)


class _Chat:
    async def send_message(self, message):
        return "OK"


@pytest.fixture
def sec(monkeypatch):
    import server

    fake = FakeDB()
    calls = []

    async def _make_chat(*_args, **kwargs):
        calls.append(kwargs)
        return _Chat()

    prev = {
        "store": store._db,
        "saas": (saas._db, saas._current_user),
        "billing": saas_billing._db,
        "billing_deps": dict(saas_billing._deps),
        "extras": saas_extras._db,
        "mail": platform_mail._db,
        "sms": platform_sms._db,
        "credits": gib_credits._db,
        "server": server.db,
    }
    store.init(fake)
    saas.init(fake, None)
    saas.invalidate()
    saas_billing.init(fake, {})
    saas_extras.init(fake, {})
    platform_mail.init(fake)
    platform_sms.init(fake)
    gib_credits.init(fake)
    server.db = fake
    monkeypatch.setattr(comm_service, "encrypt", lambda value: "enc:" + (value or ""))
    monkeypatch.setattr(comm_service, "decrypt", lambda value: (value or "").removeprefix("enc:"))
    monkeypatch.setattr(superadmin_2fa, "decrypt", lambda value: (value or "").removeprefix("enc:"))
    monkeypatch.setattr(superadmin_2fa, "encrypt", lambda value: "enc:" + (value or ""))
    monkeypatch.setattr(ai_service, "make_chat", _make_chat)
    monkeypatch.setattr(public_sites, "sync_tamkobi_from_settings", AsyncMock())

    async def seed():
        await fake.companies.insert_one({"_id": _COMPANY, "name": "Guvenlik", "license_id": _COMPANY})
        await fake.einvoice_settings.insert_one({
            "_id": "ei1",
            "company_id": _COMPANY,
            "provider": "isnet",
            "username": "nx-user",
            "mode": "test",
            "password_enc": _EI_PASS,
            "api_key_enc": _EI_KEY,
        })
        await fake.platform_settings.insert_one({
            "_id": "platform",
            "legal_name": "TamKobi",
            "legal_iban": _IBAN,
            "paytr": {
                "merchant_id": "111",
                "merchant_key_enc": _PAYTR_KEY,
                "merchant_salt_enc": _PAYTR_SALT,
                "enabled": False,
                "test_mode": True,
            },
            "ai": {
                "enabled": True,
                "provider": "custom",
                "advisor_model": "gpt-4o-mini",
                "extract_model": "gpt-4o-mini",
                "base_url": _STORED_URL,
                "api_key_enc": "enc:" + _STORED_AI,
            },
            "public_url": "https://tamkobi.com",
            "require_superadmin_2fa": False,
            "brand_name": "TamKobi",
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
        await fake.platform_mail_servers.insert_one({
            "_id": "pms_sec",
            "name": "Posta",
            "provider": "custom",
            "smtp_host": "smtp.stored.example",
            "smtp_port": 587,
            "smtp_user": "ada@stored.example",
            "password_enc": "enc:" + _SMTP_SECRET,
            "is_active": True,
        })
        await fake.platform_mail_servers.insert_one({
            "_id": "pms_other",
            "name": "Diger",
            "provider": "custom",
            "smtp_host": "smtp.other.example",
            "smtp_port": 587,
            "smtp_user": "other@stored.example",
            "password_enc": "enc:other-smtp",
            "is_active": True,
        })
        await fake.platform_mailboxes.insert_one({
            "_id": "pmb_sec",
            "email": "box@stored.example",
            "display_name": "Kutu",
            "server_id": "pms_sec",
            "smtp_user": "ada@stored.example",
            "password_enc": "enc:" + _BOX_SECRET,
            "is_active": True,
            "purposes": ["general"],
        })
        await fake.platform_settings.insert_one({
            "_id": "platform_sms",
            "provider": "netgsm",
            "usercode": "850000",
            "msgheader": "TAMKOBI",
            "is_active": True,
            "password_enc": "enc:" + _SMS_SECRET,
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
        yield client, fake, calls
    finally:
        client.__exit__(None, None, None)
        store.init(prev["store"])
        saas.init(prev["saas"][0], prev["saas"][1])
        saas_billing._db = prev["billing"]
        saas_billing._deps.clear()
        saas_billing._deps.update(prev["billing_deps"])
        saas_extras.init(prev["extras"], {})
        platform_mail.init(prev["mail"])
        platform_sms.init(prev["sms"])
        gib_credits.init(prev["credits"])
        server.db = prev["server"]
        saas.invalidate()


def _settings(db):
    return db.platform_settings.docs["platform"]


def test_stored_ai_key_is_not_sent_to_a_caller_host(sec):
    client, db, calls = sec
    pub, secret = _issue(db, [store.SCOPE_ADMIN_AI_WRITE], name="ai")
    evil_base = _send(
        client, secret, pub["id"], "POST", "/api/platform/admin-v1/ai/test",
        {"base_url": _EVIL_URL},
        idem="ai-evil-base",
    )
    assert evil_base.status_code == 400
    assert "api_key" in _detail(evil_base)
    assert calls == []
    assert _STORED_AI not in evil_base.text

    evil_provider = _send(
        client, secret, pub["id"], "POST", "/api/platform/admin-v1/ai/test",
        {"provider": "openai"},
        idem="ai-evil-provider",
    )
    assert evil_provider.status_code == 400
    assert calls == []
    assert _STORED_AI not in evil_provider.text
    assert "last_test" not in _settings(db).get("ai", {})

    blank_key = _send(
        client, secret, pub["id"], "POST", "/api/platform/admin-v1/ai/test",
        {"provider": "openai", "base_url": _EVIL_URL, "api_key": "   "},
        idem="ai-blank-key",
    )
    assert blank_key.status_code == 403
    assert _detail(blank_key) == "Kapsam yetersiz"
    assert calls == []


def test_stored_ai_key_stays_on_the_stored_configuration(sec):
    client, db, calls = sec
    pub, secret = _issue(db, [store.SCOPE_ADMIN_AI_WRITE], name="ai")
    same = _send(
        client, secret, pub["id"], "POST", "/api/platform/admin-v1/ai/test",
        {"provider": "custom", "base_url": _STORED_URL, "advisor_model": "başka-model"},
        idem="ai-same-host",
    )
    assert same.status_code == 200, same.text
    assert len(calls) == 1
    assert calls[0].get("api_key") in (None, "")
    assert calls[0].get("provider") == "custom"
    assert str(calls[0].get("base_url") or "").rstrip("/") == _STORED_URL
    assert _EVIL_URL not in json.dumps(calls)
    assert same.json()["item"]["ok"] is True


def test_custom_host_uses_only_the_caller_key(sec):
    client, _db, calls = sec
    pub, secret = _issue(
        _db,
        [store.SCOPE_ADMIN_AI_WRITE, store.SCOPE_ADMIN_SECRETS_WRITE],
        name="ai-secret",
    )
    response = _send(
        client, secret, pub["id"], "POST", "/api/platform/admin-v1/ai/test",
        {"provider": "openai", "base_url": _EVIL_URL, "api_key": _CALLER_KEY},
        idem="ai-caller-key",
    )
    assert response.status_code == 200, response.text
    assert len(calls) == 1
    assert calls[0].get("api_key") == _CALLER_KEY
    assert calls[0].get("provider") == "openai"
    blob = json.dumps(calls)
    assert _STORED_AI not in blob
    assert _CALLER_KEY in blob


def test_blank_secret_fields_require_secrets_write(sec):
    client, db, calls = sec
    pub, secret = _issue(
        db,
        [store.SCOPE_ADMIN_EINVOICE_WRITE, store.SCOPE_ADMIN_SETTINGS_WRITE],
        name="writer",
    )
    einvoice = _send(
        client, secret, pub["id"], "PUT",
        f"/api/platform/admin-v1/companies/{_COMPANY}/einvoice/credentials",
        {"password": "   ", "api_key": "", "username": "hacked"},
        idem="ei-blank",
    )
    assert einvoice.status_code == 403
    assert _detail(einvoice) == "Kapsam yetersiz"
    doc = db.einvoice_settings.docs["ei1"]
    assert doc["password_enc"] == _EI_PASS
    assert doc["api_key_enc"] == _EI_KEY
    assert doc["username"] == "nx-user"

    paytr = _send(
        client, secret, pub["id"], "PUT", "/api/platform/admin-v1/paytr",
        {"merchant_key": " ", "merchant_salt": "", "merchant_id": "999"},
        idem="paytr-blank",
    )
    assert paytr.status_code == 403
    assert _detail(paytr) == "Kapsam yetersiz"
    stored_paytr = _settings(db)["paytr"]
    assert stored_paytr["merchant_key_enc"] == _PAYTR_KEY
    assert stored_paytr["merchant_salt_enc"] == _PAYTR_SALT
    assert stored_paytr["merchant_id"] == "111"

    iban = _send(
        client, secret, pub["id"], "PUT", "/api/platform/admin-v1/settings",
        {"legal_iban": "   ", "legal_name": "Baska Unvan"},
        idem="iban-blank",
    )
    assert iban.status_code == 403
    assert _detail(iban) == "Kapsam yetersiz"
    assert _settings(db)["legal_iban"] == _IBAN
    assert _settings(db)["legal_name"] == "TamKobi"
    assert calls == []


def _otp():
    return pyotp.TOTP(_TOTP).now()


def _danger(client, secret, key_id, action, body, confirm_text, db, *, prep_idem, conf_idem):
    prepared = _send(
        client, secret, key_id, "POST",
        f"/api/platform/admin-v1/danger/{action}/prepare",
        body,
        idem=prep_idem,
    )
    assert prepared.status_code == 200, prepared.text
    db.users.docs["usr_ops"]["totp_last_counter"] = None
    confirmed = _send(
        client, secret, key_id, "POST",
        f"/api/platform/admin-v1/danger/{action}/confirm",
        {
            "confirmation_token": prepared.json()["confirmation_token"],
            "confirm_text": confirm_text,
            "operator_otp": _otp(),
        },
        idem=conf_idem,
    )
    return prepared, confirmed


def test_endpoint_change_without_secret_drops_the_stored_secret(sec, monkeypatch):
    client, db, calls = sec
    writer, writer_secret = _issue(
        db,
        [store.SCOPE_ADMIN_EINVOICE_WRITE, store.SCOPE_ADMIN_AI_WRITE, store.SCOPE_ADMIN_SETTINGS_WRITE],
        name="endpoint-writer",
    )
    einvoice_denied = _send(
        client, writer_secret, writer["id"], "PUT",
        f"/api/platform/admin-v1/companies/{_COMPANY}/einvoice/credentials",
        {"api_url": "https://evil.example/einvoice"},
        idem="ei-url-denied",
    )
    assert einvoice_denied.status_code == 403
    assert _detail(einvoice_denied) == "Kapsam yetersiz"
    kept = db.einvoice_settings.docs["ei1"]
    assert kept["password_enc"] == _EI_PASS
    assert kept["api_key_enc"] == _EI_KEY
    assert kept.get("api_url") in (None, "")

    ai_denied = _send(
        client, writer_secret, writer["id"], "PUT", "/api/platform/admin-v1/ai",
        {"base_url": _EVIL_URL},
        idem="ai-url-denied",
    )
    assert ai_denied.status_code == 403
    assert _detail(ai_denied) == "Kapsam yetersiz"
    assert _settings(db)["ai"]["api_key_enc"] == "enc:" + _STORED_AI
    assert _settings(db)["ai"]["base_url"] == _STORED_URL
    assert _STORED_AI not in ai_denied.text

    provider_denied = _send(
        client, writer_secret, writer["id"], "PUT", "/api/platform/admin-v1/ai",
        {"provider": "openai"},
        idem="ai-provider-denied",
    )
    assert provider_denied.status_code == 403
    assert _settings(db)["ai"]["provider"] == "custom"
    assert _settings(db)["ai"]["api_key_enc"] == "enc:" + _STORED_AI

    mail_denied = _send(
        client, writer_secret, writer["id"], "PUT", "/api/platform/admin-v1/mail/servers/pms_sec",
        {"smtp_host": "smtp.evil.example"},
        idem="smtp-host-denied",
    )
    assert mail_denied.status_code == 403
    assert _detail(mail_denied) == "Kapsam yetersiz"
    assert db.platform_mail_servers.docs["pms_sec"]["password_enc"] == "enc:" + _SMTP_SECRET
    assert db.platform_mail_servers.docs["pms_sec"]["smtp_host"] == "smtp.stored.example"

    user_denied = _send(
        client, writer_secret, writer["id"], "PUT", "/api/platform/admin-v1/mail/servers/pms_sec",
        {"smtp_user": "eve@evil.example"},
        idem="smtp-user-denied",
    )
    assert user_denied.status_code == 403
    assert db.platform_mail_servers.docs["pms_sec"]["smtp_user"] == "ada@stored.example"

    holder, holder_secret = _issue(
        db,
        [
            store.SCOPE_ADMIN_EINVOICE_WRITE,
            store.SCOPE_ADMIN_AI_WRITE,
            store.SCOPE_ADMIN_SETTINGS_WRITE,
            store.SCOPE_ADMIN_SECRETS_WRITE,
        ],
        name="endpoint-secrets",
    )
    cleared = _send(
        client, holder_secret, holder["id"], "PUT",
        f"/api/platform/admin-v1/companies/{_COMPANY}/einvoice/credentials",
        {"api_url": "https://evil.example/einvoice", "efatura_url": "https://evil.example/efatura"},
        idem="ei-url-clear",
    )
    assert cleared.status_code == 200, cleared.text
    doc = db.einvoice_settings.docs["ei1"]
    assert doc.get("api_url") == "https://evil.example/einvoice"
    assert "password_enc" not in doc
    assert "api_key_enc" not in doc
    assert _EI_PASS not in cleared.text
    assert "stored-ei-pass" not in cleared.text

    import isnet
    import server
    probed = []

    async def _probe(settings, password):
        probed.append({"api_url": settings.get("api_url"), "password": password, "api_key": settings.get("api_key")})
        return {"ok": True}

    monkeypatch.setattr(isnet, "test_connection", _probe)
    asyncio.run(server.test_einvoice_connection(_COMPANY, {"is_super_admin": True, "company_ids": [_COMPANY]}))
    assert probed
    assert probed[0]["api_url"] == "https://evil.example/einvoice"
    assert probed[0]["password"] == ""
    assert "stored-ei-pass" not in json.dumps(probed)
    assert _EI_KEY not in json.dumps(probed)

    replaced = _send(
        client, holder_secret, holder["id"], "PUT",
        f"/api/platform/admin-v1/companies/{_COMPANY}/einvoice/credentials",
        {"api_url": "https://next.example/einvoice", "password": "yeni-ei-sifre"},
        idem="ei-url-replace",
    )
    assert replaced.status_code == 200, replaced.text
    doc = db.einvoice_settings.docs["ei1"]
    assert doc["password_enc"] == "enc:yeni-ei-sifre"
    assert "api_key_enc" not in doc
    assert "yeni-ei-sifre" not in replaced.text

    seen = []

    async def _make_chat(*_args, **kwargs):
        cfg = await ai_service.load_ai_settings()
        seen.append({
            "api_key": kwargs.get("api_key"),
            "base_url": kwargs.get("base_url"),
            "loaded_key": cfg.get("api_key"),
            "loaded_url": cfg.get("base_url"),
        })
        return _Chat()

    monkeypatch.setattr(ai_service, "make_chat", _make_chat)
    ai_cleared = _send(
        client, holder_secret, holder["id"], "PUT", "/api/platform/admin-v1/ai",
        {"base_url": _EVIL_URL},
        idem="ai-url-clear",
    )
    assert ai_cleared.status_code == 200, ai_cleared.text
    stored_ai = _settings(db)["ai"]
    assert "api_key_enc" not in stored_ai
    assert _EVIL_URL in str(stored_ai.get("base_url") or "")
    assert _STORED_AI not in ai_cleared.text
    dial = _send(
        client, holder_secret, holder["id"], "POST", "/api/platform/admin-v1/ai/test",
        {},
        idem="ai-dial-after-clear",
    )
    assert dial.status_code == 200, dial.text
    blob = json.dumps(seen)
    assert _STORED_AI not in blob
    assert _EVIL_URL.split("://", 1)[1].split("/", 1)[0] in blob
    assert "stored.example" not in blob

    smtp = AsyncMock(return_value={"ok": True, "message": "ok"})
    monkeypatch.setattr(comm_service, "smtp_login_test", smtp)
    host_cleared = _send(
        client, holder_secret, holder["id"], "PUT", "/api/platform/admin-v1/mail/servers/pms_sec",
        {"smtp_host": "smtp.evil.example"},
        idem="smtp-host-clear",
    )
    assert host_cleared.status_code == 200, host_cleared.text
    assert "password_enc" not in db.platform_mail_servers.docs["pms_sec"]
    assert db.platform_mail_servers.docs["pms_sec"]["smtp_host"] == "smtp.evil.example"
    assert _SMTP_SECRET not in host_cleared.text
    probed_mail = _send(
        client, holder_secret, holder["id"], "POST",
        "/api/platform/admin-v1/mail/servers/pms_sec/test",
        {},
        idem="smtp-dial",
    )
    assert probed_mail.status_code == 400
    assert smtp.await_count == 0
    assert _SMTP_SECRET not in probed_mail.text

    asyncio.run(db.platform_mail_servers.update_one(
        {"_id": "pms_sec"},
        {"$set": {"password_enc": "enc:" + _SMTP_SECRET, "smtp_host": "smtp.kept.example"}},
    ))
    user_cleared = _send(
        client, holder_secret, holder["id"], "PUT", "/api/platform/admin-v1/mail/servers/pms_sec",
        {"smtp_user": "eve@evil.example"},
        idem="smtp-user-clear",
    )
    assert user_cleared.status_code == 200, user_cleared.text
    assert db.platform_mail_servers.docs["pms_sec"]["smtp_user"] == "eve@evil.example"
    assert "password_enc" not in db.platform_mail_servers.docs["pms_sec"]
    assert _SMTP_SECRET not in user_cleared.text


def test_settings_flags_require_danger(sec):
    client, db, _calls = sec
    writer, writer_secret = _issue(db, [store.SCOPE_ADMIN_SETTINGS_WRITE], name="settings-writer")
    blocked_url = _send(
        client, writer_secret, writer["id"], "PUT", "/api/platform/admin-v1/settings",
        {"public_url": "https://evil.example", "brand_name": "Baska"},
        idem="url-direct",
    )
    assert blocked_url.status_code == 403
    assert _detail(blocked_url) == "public_url danger/settings.public_url ile değişir."
    assert _settings(db).get("public_url") == "https://tamkobi.com"
    assert _settings(db).get("brand_name") == "TamKobi"

    blocked_2fa = _send(
        client, writer_secret, writer["id"], "PUT", "/api/platform/admin-v1/settings",
        {"require_superadmin_2fa": True},
        idem="2fa-direct",
    )
    assert blocked_2fa.status_code == 403
    assert "danger/settings.require_superadmin_2fa" in _detail(blocked_2fa)
    assert _settings(db).get("require_superadmin_2fa") is False

    renamed = _send(
        client, writer_secret, writer["id"], "PUT", "/api/platform/admin-v1/settings",
        {"brand_name": "Yeni Marka"},
        idem="brand-ok",
    )
    assert renamed.status_code == 200, renamed.text
    assert _settings(db).get("brand_name") == "Yeni Marka"
    assert _settings(db).get("public_url") == "https://tamkobi.com"

    both, both_secret = _issue(
        db,
        [store.SCOPE_ADMIN_SETTINGS_WRITE, store.SCOPE_ADMIN_DANGEROUS],
        name="settings-danger",
    )
    _prepared, url_ok = _danger(
        client, both_secret, both["id"], "settings.public_url",
        {
            "target_id": "platform",
            "reason": _REASON,
            "operator_email": _OPERATOR,
            "public_url": _NEW_URL,
        },
        _NEW_URL,
        db,
        prep_idem="url-prep",
        conf_idem="url-conf",
    )
    assert url_ok.status_code == 200, url_ok.text
    assert _settings(db).get("public_url") == _NEW_URL
    assert url_ok.json()["item"]["public_url"] == _NEW_URL

    _prepared, flag_ok = _danger(
        client, both_secret, both["id"], "settings.require_superadmin_2fa",
        {
            "target_id": "platform",
            "reason": _REASON,
            "operator_email": _OPERATOR,
            "require_superadmin_2fa": True,
        },
        "true",
        db,
        prep_idem="2fa-prep",
        conf_idem="2fa-conf",
    )
    assert flag_ok.status_code == 200, flag_ok.text
    assert _settings(db).get("require_superadmin_2fa") is True
    assert flag_ok.json()["item"]["require_superadmin_2fa"] is True


def test_bound_user_and_port_changes_require_secrets_write(sec):
    client, db, _calls = sec
    writer, writer_secret = _issue(
        db,
        [
            store.SCOPE_ADMIN_EINVOICE_WRITE,
            store.SCOPE_ADMIN_SETTINGS_WRITE,
            store.SCOPE_ADMIN_SMS_WRITE,
        ],
        name="binding-writer",
    )
    port_denied = _send(
        client, writer_secret, writer["id"], "PUT",
        "/api/platform/admin-v1/mail/servers/pms_sec",
        {"smtp_port": 2525},
        idem="smtp-port-denied",
    )
    assert port_denied.status_code == 403
    assert _detail(port_denied) == "Kapsam yetersiz"
    assert db.platform_mail_servers.docs["pms_sec"]["smtp_port"] == 587
    assert db.platform_mail_servers.docs["pms_sec"]["password_enc"] == "enc:" + _SMTP_SECRET

    for idem, body in (
        ("box-server-denied", {"server_id": "pms_other"}),
        ("box-user-denied", {"smtp_user": "eve@evil.example"}),
        ("box-email-denied", {"email": "eve@evil.example"}),
    ):
        denied = _send(
            client, writer_secret, writer["id"], "PUT",
            "/api/platform/admin-v1/mail/mailboxes/pmb_sec",
            body,
            idem=idem,
        )
        assert denied.status_code == 403, body
        assert _detail(denied) == "Kapsam yetersiz"
    box = db.platform_mailboxes.docs["pmb_sec"]
    assert box["server_id"] == "pms_sec"
    assert box["smtp_user"] == "ada@stored.example"
    assert box["email"] == "box@stored.example"
    assert box["password_enc"] == "enc:" + _BOX_SECRET

    label = _send(
        client, writer_secret, writer["id"], "PUT",
        "/api/platform/admin-v1/mail/mailboxes/pmb_sec",
        {"display_name": "Vitrin", "email": "BOX@stored.example"},
        idem="box-label",
    )
    assert label.status_code == 200, label.text
    assert db.platform_mailboxes.docs["pmb_sec"]["password_enc"] == "enc:" + _BOX_SECRET
    assert db.platform_mailboxes.docs["pmb_sec"]["email"] == "box@stored.example"
    assert db.platform_mailboxes.docs["pmb_sec"]["display_name"] == "Vitrin"

    user_denied = _send(
        client, writer_secret, writer["id"], "PUT",
        f"/api/platform/admin-v1/companies/{_COMPANY}/einvoice/credentials",
        {"username": "attacker"},
        idem="ei-user-denied",
    )
    assert user_denied.status_code == 403
    assert db.einvoice_settings.docs["ei1"]["username"] == "nx-user"
    assert db.einvoice_settings.docs["ei1"]["password_enc"] == _EI_PASS
    urls_denied = _send(
        client, writer_secret, writer["id"], "PUT",
        f"/api/platform/admin-v1/companies/{_COMPANY}/einvoice/credentials",
        {"efatura_url": "https://evil.example/efatura", "earsiv_url": "https://evil.example/earsiv"},
        idem="ei-qnb-urls-denied",
    )
    assert urls_denied.status_code == 403
    assert "efatura_url" not in db.einvoice_settings.docs["ei1"]
    assert db.einvoice_settings.docs["ei1"]["password_enc"] == _EI_PASS

    for idem, body in (
        ("sms-provider-denied", {"provider": "verimor"}),
        ("sms-user-denied", {"usercode": "attacker"}),
    ):
        denied = _send(
            client, writer_secret, writer["id"], "PUT",
            "/api/platform/admin-v1/sms/settings",
            body,
            idem=idem,
        )
        assert denied.status_code == 403, body
    sms = db.platform_settings.docs["platform_sms"]
    assert sms["provider"] == "netgsm"
    assert sms["usercode"] == "850000"
    assert sms["password_enc"] == "enc:" + _SMS_SECRET

    header = _send(
        client, writer_secret, writer["id"], "PUT",
        "/api/platform/admin-v1/sms/settings",
        {"msgheader": "TAMKOBI2", "provider": "netgsm"},
        idem="sms-header",
    )
    assert header.status_code == 200, header.text
    assert db.platform_settings.docs["platform_sms"]["msgheader"] == "TAMKOBI2"
    assert db.platform_settings.docs["platform_sms"]["password_enc"] == "enc:" + _SMS_SECRET

    paytr = _send(
        client, writer_secret, writer["id"], "PUT", "/api/platform/admin-v1/paytr",
        {"merchant_id": "222"},
        idem="paytr-id",
    )
    assert paytr.status_code == 200, paytr.text
    assert _settings(db)["paytr"]["merchant_id"] == "222"
    assert _settings(db)["paytr"]["merchant_key_enc"] == _PAYTR_KEY

    holder, holder_secret = _issue(
        db,
        [
            store.SCOPE_ADMIN_EINVOICE_WRITE,
            store.SCOPE_ADMIN_SETTINGS_WRITE,
            store.SCOPE_ADMIN_SMS_WRITE,
            store.SCOPE_ADMIN_SECRETS_WRITE,
        ],
        name="binding-secrets",
    )
    port_cleared = _send(
        client, holder_secret, holder["id"], "PUT",
        "/api/platform/admin-v1/mail/servers/pms_sec",
        {"smtp_port": 2525},
        idem="smtp-port-clear",
    )
    assert port_cleared.status_code == 200, port_cleared.text
    assert db.platform_mail_servers.docs["pms_sec"]["smtp_port"] == 2525
    assert "password_enc" not in db.platform_mail_servers.docs["pms_sec"]
    assert _SMTP_SECRET not in port_cleared.text

    box_cleared = _send(
        client, holder_secret, holder["id"], "PUT",
        "/api/platform/admin-v1/mail/mailboxes/pmb_sec",
        {"server_id": "pms_other"},
        idem="box-server-clear",
    )
    assert box_cleared.status_code == 200, box_cleared.text
    assert db.platform_mailboxes.docs["pmb_sec"]["server_id"] == "pms_other"
    assert "password_enc" not in db.platform_mailboxes.docs["pmb_sec"]
    assert _BOX_SECRET not in box_cleared.text

    user_cleared = _send(
        client, holder_secret, holder["id"], "PUT",
        f"/api/platform/admin-v1/companies/{_COMPANY}/einvoice/credentials",
        {"username": "yeni-kullanici"},
        idem="ei-user-clear",
    )
    assert user_cleared.status_code == 200, user_cleared.text
    assert db.einvoice_settings.docs["ei1"]["username"] == "yeni-kullanici"
    assert "password_enc" not in db.einvoice_settings.docs["ei1"]
    assert "api_key_enc" not in db.einvoice_settings.docs["ei1"]

    sms_cleared = _send(
        client, holder_secret, holder["id"], "PUT",
        "/api/platform/admin-v1/sms/settings",
        {"provider": "verimor"},
        idem="sms-provider-clear",
    )
    assert sms_cleared.status_code == 200, sms_cleared.text
    saved = db.platform_settings.docs["platform_sms"]
    assert saved["provider"] == "verimor"
    assert saved["is_active"] is False
    assert "password_enc" not in saved
    assert _SMS_SECRET not in sms_cleared.text
