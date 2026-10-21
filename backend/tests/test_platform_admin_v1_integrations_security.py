"""admin-v1 AI testi ve boş sır alanları: tam FastAPI uygulaması.

Kayıtlı AI anahtarı çağıranın seçtiği sağlayıcıya veya uç noktaya gitmez.
E-fatura, PayTR ve IBAN alanları boş veya yalnızca boşluk olsa da
admin.secrets:write olmadan yazılmaz.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-admin-v1-integrations-security-jwt-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import ai_service  # noqa: E402
import comm_service  # noqa: E402
import platform_store as store  # noqa: E402
import saas  # noqa: E402
import saas_billing  # noqa: E402
import saas_extras  # noqa: E402
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
        "server": server.db,
    }
    store.init(fake)
    saas.init(fake, None)
    saas.invalidate()
    saas_billing.init(fake, {})
    saas_extras.init(fake, {})
    server.db = fake
    monkeypatch.setattr(comm_service, "encrypt", lambda value: "enc:" + (value or ""))
    monkeypatch.setattr(comm_service, "decrypt", lambda value: (value or "").removeprefix("enc:"))
    monkeypatch.setattr(ai_service, "make_chat", _make_chat)

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
