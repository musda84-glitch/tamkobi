"""admin-v1 anahtar kapsamı ve boş şifre: tam FastAPI uygulaması.

Bellek FakeDB. Canlı veritabanı yok. platform_admin anahtarı doğrudan
oluşmaz; danger/key.admin_create ve danger/key.admin_scopes çağıranın
kendi kapsamının dışına çıkamaz. Şifre alanı boş olsa da secrets:write ister.
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

os.environ.setdefault("JWT_SECRET", "test-admin-v1-accounts-security-jwt-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import comm_service  # noqa: E402
import platform_admin_v1_write  # noqa: E402
import platform_store as store  # noqa: E402
import saas  # noqa: E402
import superadmin_2fa  # noqa: E402
from test_platform_admin_v1 import _detail, _issue, _signed_headers  # noqa: E402
from test_platform_admin_v1 import FakeDB  # noqa: E402

_OPERATOR = "ops@example.com"
_TOTP = pyotp.random_base32()
_REASON = "Musteri kaydini guvenli sekilde temizlemek icin"
_USER = "usr_panel"
_OLD_HASH = "hash-before-security"
_COMPANY = "comp_security"


def _send(client, secret, key_id, method, path, payload=None, *, idem="idem-1"):
    raw = b"" if payload is None else json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    headers, _, _nonce = _signed_headers(secret, key_id, method, path, raw)
    if idem is not None and method != "GET":
        headers["Idempotency-Key"] = idem
    return client.request(method, path, content=raw, headers=headers)


@pytest.fixture
def sec(monkeypatch):
    import server

    fake = FakeDB()
    prev = {
        "store": store._db,
        "saas": (saas._db, saas._current_user),
        "server": server.db,
    }
    store.init(fake)
    saas.init(fake, None)
    saas.invalidate()
    server.db = fake
    monkeypatch.setattr(comm_service, "encrypt", lambda value: "enc:" + (value or ""))
    monkeypatch.setattr(comm_service, "decrypt", lambda value: (value or "").removeprefix("enc:"))
    monkeypatch.setattr(superadmin_2fa, "decrypt", lambda value: (value or "").removeprefix("enc:"))
    monkeypatch.setattr(superadmin_2fa, "encrypt", lambda value: "enc:" + (value or ""))

    async def seed():
        await fake.companies.insert_one({"_id": _COMPANY, "name": "Guvenlik", "license_id": _COMPANY})
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
            "_id": _USER,
            "name": "Panel",
            "email": "panel@example.com",
            "role": "admin",
            "company_ids": [],
            "is_super_admin": True,
            "is_active": True,
            "password_hash": _OLD_HASH,
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
        server.db = prev["server"]
        saas.invalidate()


def _product_id(db, key_id):
    return db.platform_api_keys.docs[key_id]["product_id"]


def _ids(db):
    return set(db.platform_api_keys.docs)


def _confirmations(db):
    return set(db.platform_danger_confirmations.docs)


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


def test_secret_field_presence_requires_scope():
    assert platform_admin_v1_write.body_has_secret({"password": "      "}) is True
    assert platform_admin_v1_write.body_has_secret({"password": ""}) is True
    assert platform_admin_v1_write.body_has_secret({"password": None}) is True
    assert platform_admin_v1_write.body_has_secret({"api_key": ""}) is True
    assert platform_admin_v1_write.body_has_secret({"merchant_key": " "}) is True
    assert platform_admin_v1_write.body_has_secret({"merchant_salt": ""}) is True
    assert platform_admin_v1_write.body_has_secret({"legal_iban": "   "}) is True
    assert platform_admin_v1_write.body_has_secret({"clear_key": True}) is True
    assert platform_admin_v1_write.body_has_secret({"clear_key": False}) is False
    assert platform_admin_v1_write.body_has_secret({"name": "Ada"}) is False


def test_direct_platform_admin_create_is_rejected(sec):
    client, db = sec
    pub, secret = _issue(db, [store.SCOPE_ADMIN_KEYS_WRITE, store.SCOPE_ADMIN_DANGEROUS], name="caller")
    before = _ids(db)
    response = _send(client, secret, pub["id"], "POST", "/api/platform/admin-v1/api-keys", {
        "product_id": _product_id(db, pub["id"]),
        "name": "Yukseltme",
        "kind": "platform_admin",
        "scopes": [store.SCOPE_ADMIN_DANGEROUS, store.SCOPE_ADMIN_SECRETS_WRITE],
    }, idem="direct-create")
    assert response.status_code == 400
    assert "key.admin_create" in _detail(response)
    assert _ids(db) == before
    assert "credential" not in response.text


def test_direct_platform_admin_rescope_is_rejected(sec):
    client, db = sec
    pub, secret = _issue(
        db,
        [store.SCOPE_ADMIN_KEYS_WRITE, store.SCOPE_ADMIN_DANGEROUS, store.SCOPE_ADMIN_USERS_WRITE],
        name="caller",
    )
    target, _target_secret = _issue(db, [store.SCOPE_ADMIN_KEYS_READ], name="Hedef", kind="platform_admin")
    response = _send(
        client, secret, pub["id"], "PUT",
        f"/api/platform/admin-v1/api-keys/{target['id']}/scopes",
        {"scopes": [store.SCOPE_ADMIN_USERS_WRITE, store.SCOPE_ADMIN_DANGEROUS]},
        idem="direct-scopes",
    )
    assert response.status_code == 400
    assert "key.admin_scopes" in _detail(response)
    assert db.platform_api_keys.docs[target["id"]]["scopes"] == [store.SCOPE_ADMIN_KEYS_READ]


def test_rotate_platform_admin_rejects_scope_outside_caller(sec):
    client, db = sec
    pub, secret = _issue(db, [store.SCOPE_ADMIN_KEYS_WRITE], name="caller")
    target, _target_secret = _issue(
        db,
        [store.SCOPE_ADMIN_KEYS_WRITE, store.SCOPE_ADMIN_DANGEROUS, store.SCOPE_ADMIN_SECRETS_WRITE],
        name="genis",
    )
    before = _ids(db)
    response = _send(
        client, secret, pub["id"], "POST",
        f"/api/platform/admin-v1/api-keys/{target['id']}/rotate",
        {},
        idem="rotate-escalate",
    )
    assert response.status_code == 403
    assert _detail(response) == "İstenen kapsam çağıran anahtarın kapsamının dışında."
    assert _ids(db) == before
    assert db.platform_api_keys.docs[target["id"]].get("grace_until") in (None, "")
    assert db.platform_api_keys.docs[target["id"]].get("revoked_at") in (None, "")
    assert "credential" not in response.text


def test_rotate_platform_admin_allowed_when_subset(sec):
    client, db = sec
    scopes = [store.SCOPE_ADMIN_KEYS_WRITE, store.SCOPE_ADMIN_USERS_WRITE]
    pub, secret = _issue(db, scopes, name="caller")
    target, _target_secret = _issue(db, [store.SCOPE_ADMIN_USERS_WRITE], name="dar")
    response = _send(
        client, secret, pub["id"], "POST",
        f"/api/platform/admin-v1/api-keys/{target['id']}/rotate",
        {},
        idem="rotate-subset",
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["credential"]
    assert body["item"]["scopes"] == [store.SCOPE_ADMIN_USERS_WRITE]
    assert body["item"]["kind"] == "platform_admin"
    assert body["item"]["id"] != target["id"]
    assert store.SCOPE_ADMIN_DANGEROUS not in body["item"]["scopes"]
    assert "secret" not in body["item"]


def test_product_key_create_and_rotate_stay_on_keys_write(sec):
    client, db = sec
    pub, secret = _issue(db, [store.SCOPE_ADMIN_KEYS_WRITE], name="caller")
    created = _send(client, secret, pub["id"], "POST", "/api/platform/admin-v1/api-keys", {
        "product_id": _product_id(db, pub["id"]),
        "name": "Sirket",
        "kind": "product",
        "instance_id": _COMPANY,
        "scopes": ["license:verify"],
    }, idem="product-create")
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["credential"]
    assert body["item"]["kind"] == "product"
    assert body["item"]["scopes"] == ["license:verify"]
    assert body["item"]["instance_id"] == _COMPANY
    rotated = _send(
        client, secret, pub["id"], "POST",
        f"/api/platform/admin-v1/api-keys/{body['item']['id']}/rotate",
        {},
        idem="product-rotate",
    )
    assert rotated.status_code == 200, rotated.text
    assert rotated.json()["item"]["scopes"] == ["license:verify"]
    assert rotated.json()["credential"]


def test_danger_create_returns_credential_only_inside_caller_scopes(sec):
    client, db = sec
    scopes = [store.SCOPE_ADMIN_DANGEROUS, store.SCOPE_ADMIN_KEYS_WRITE, store.SCOPE_ADMIN_USERS_WRITE]
    pub, secret = _issue(db, scopes, name="caller")
    _prepared, confirmed = _danger(
        client, secret, pub["id"], "key.admin_create",
        {
            "target_id": "platform",
            "reason": _REASON,
            "operator_email": _OPERATOR,
            "name": "Yeni Admin",
            "product_id": _product_id(db, pub["id"]),
            "scopes": [store.SCOPE_ADMIN_USERS_WRITE],
        },
        "Yeni Admin",
        db,
        prep_idem="create-prep",
        conf_idem="create-conf",
    )
    assert confirmed.status_code == 200, confirmed.text
    item = confirmed.json()["item"]
    assert item["credential"]
    assert item["kind"] == "platform_admin"
    assert item["scopes"] == [store.SCOPE_ADMIN_USERS_WRITE]
    assert store.SCOPE_ADMIN_DANGEROUS not in item["scopes"]
    assert store.SCOPE_ADMIN_SECRETS_WRITE not in item["scopes"]
    stored = db.platform_api_keys.docs[item["id"]]
    assert stored["scopes"] == [store.SCOPE_ADMIN_USERS_WRITE]
    assert stored["kind"] == "platform_admin"
    assert "credential" not in stored
    assert "secret_enc" not in item
    assert "secret_hash" not in item
    assert stored["secret_enc"] == "enc:" + item["credential"]


def test_danger_create_rejects_scope_the_caller_lacks(sec):
    client, db = sec
    pub, secret = _issue(db, [store.SCOPE_ADMIN_DANGEROUS, store.SCOPE_ADMIN_KEYS_WRITE], name="caller")
    before = _ids(db)
    tokens = _confirmations(db)
    response = _send(
        client, secret, pub["id"], "POST",
        "/api/platform/admin-v1/danger/key.admin_create/prepare",
        {
            "target_id": "platform",
            "reason": _REASON,
            "operator_email": _OPERATOR,
            "name": "Genis",
            "product_id": _product_id(db, pub["id"]),
            "scopes": [store.SCOPE_ADMIN_SECRETS_WRITE],
        },
        idem="create-outside",
    )
    assert response.status_code == 403
    assert _detail(response) == "İstenen kapsam çağıran anahtarın kapsamının dışında."
    assert _ids(db) == before
    assert _confirmations(db) == tokens


def test_danger_create_requires_keys_write(sec):
    client, db = sec
    pub, secret = _issue(db, [store.SCOPE_ADMIN_DANGEROUS], name="caller")
    before = _ids(db)
    tokens = _confirmations(db)
    response = _send(
        client, secret, pub["id"], "POST",
        "/api/platform/admin-v1/danger/key.admin_create/prepare",
        {
            "target_id": "platform",
            "reason": _REASON,
            "operator_email": _OPERATOR,
            "name": "Yetkisiz",
            "product_id": _product_id(db, pub["id"]),
            "scopes": [store.SCOPE_ADMIN_DANGEROUS],
        },
        idem="create-no-keys",
    )
    assert response.status_code == 403
    assert _detail(response) == "Kapsam yetersiz"
    assert _ids(db) == before
    assert _confirmations(db) == tokens


def test_danger_rescope_and_fingerprint(sec):
    client, db = sec
    scopes = [
        store.SCOPE_ADMIN_DANGEROUS,
        store.SCOPE_ADMIN_KEYS_WRITE,
        store.SCOPE_ADMIN_USERS_WRITE,
        store.SCOPE_ADMIN_STORAGE_READ,
    ]
    pub, secret = _issue(db, scopes, name="caller")
    target, _target_secret = _issue(db, [store.SCOPE_ADMIN_KEYS_READ], name="Hedef Anahtar")
    prepared = _send(
        client, secret, pub["id"], "POST",
        "/api/platform/admin-v1/danger/key.admin_scopes/prepare",
        {
            "target_id": target["id"],
            "reason": _REASON,
            "operator_email": _OPERATOR,
            "scopes": [store.SCOPE_ADMIN_USERS_WRITE],
        },
        idem="scopes-prep",
    )
    assert prepared.status_code == 200, prepared.text
    db.platform_api_keys.docs[target["id"]]["scopes"] = [store.SCOPE_ADMIN_STORAGE_READ]
    db.users.docs["usr_ops"]["totp_last_counter"] = None
    changed = _send(
        client, secret, pub["id"], "POST",
        "/api/platform/admin-v1/danger/key.admin_scopes/confirm",
        {
            "confirmation_token": prepared.json()["confirmation_token"],
            "confirm_text": "Hedef Anahtar",
            "operator_otp": _otp(),
        },
        idem="scopes-stale",
    )
    assert changed.status_code == 409
    assert _detail(changed) == "Hedef değişti, yeniden hazırlayın."
    assert db.platform_api_keys.docs[target["id"]]["scopes"] == [store.SCOPE_ADMIN_STORAGE_READ]

    _prepared, confirmed = _danger(
        client, secret, pub["id"], "key.admin_scopes",
        {
            "target_id": target["id"],
            "reason": _REASON,
            "operator_email": _OPERATOR,
            "scopes": [store.SCOPE_ADMIN_STORAGE_READ, store.SCOPE_ADMIN_USERS_WRITE],
        },
        "Hedef Anahtar",
        db,
        prep_idem="scopes-prep-2",
        conf_idem="scopes-conf-2",
    )
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["item"]["scopes"] == [
        store.SCOPE_ADMIN_STORAGE_READ,
        store.SCOPE_ADMIN_USERS_WRITE,
    ]
    assert "credential" not in confirmed.json()["item"]
    assert db.platform_api_keys.docs[target["id"]]["scopes"] == [
        store.SCOPE_ADMIN_STORAGE_READ,
        store.SCOPE_ADMIN_USERS_WRITE,
    ]


def test_whitespace_password_requires_secret_scope_and_is_rejected(sec):
    client, db = sec
    writer, writer_secret = _issue(db, [store.SCOPE_ADMIN_USERS_WRITE], name="users")
    path = f"/api/platform/admin-v1/platform-users/{_USER}"
    missing = _send(
        client, writer_secret, writer["id"], "PUT", path,
        {"password": "      ", "name": "Degismemeli"},
        idem="pw-blank-no-scope",
    )
    assert missing.status_code == 403
    assert _detail(missing) == "Kapsam yetersiz"
    assert db.users.docs[_USER]["password_hash"] == _OLD_HASH
    assert db.users.docs[_USER]["name"] == "Panel"

    empty = _send(
        client, writer_secret, writer["id"], "PUT", path,
        {"password": ""},
        idem="pw-empty-no-scope",
    )
    assert empty.status_code == 403
    assert db.users.docs[_USER]["password_hash"] == _OLD_HASH

    both, both_secret = _issue(
        db,
        [store.SCOPE_ADMIN_USERS_WRITE, store.SCOPE_ADMIN_SECRETS_WRITE],
        name="both",
    )
    blank = _send(
        client, both_secret, both["id"], "PUT", path,
        {"password": "      ", "name": "Yine Degismemeli"},
        idem="pw-blank-scope",
    )
    assert blank.status_code == 400
    assert _detail(blank) == "Şifre boş olamaz."
    assert db.users.docs[_USER]["password_hash"] == _OLD_HASH
    assert db.users.docs[_USER]["name"] == "Panel"

    real = _send(
        client, both_secret, both["id"], "PUT", path,
        {"password": "gercek-sifre"},
        idem="pw-real",
    )
    assert real.status_code == 403
    assert _detail(real) == "Şifre danger/platform_user.password ile değişir."
    assert "gercek-sifre" not in real.text
    assert "password_hash" not in real.text
    assert db.users.docs[_USER]["password_hash"] == _OLD_HASH

    created = _send(
        client, both_secret, both["id"], "POST",
        "/api/platform/admin-v1/platform-users",
        {"name": "Bos", "email": "bos@example.com", "password": "      "},
        idem="pw-create-blank",
    )
    assert created.status_code == 400
    assert _detail(created) == "Şifre boş olamaz."
    assert "bos@example.com" not in {row.get("email") for row in db.users.docs.values()}


def _audit_blob(db) -> str:
    parts = []
    for coll_name in ("platform_audit_log", "activity_logs"):
        coll = getattr(db, coll_name, None)
        if coll is None:
            continue
        parts.append(json.dumps(list(coll.docs.values()), ensure_ascii=False))
    return "\n".join(parts)


def test_super_admin_create_and_secret_changes_require_danger(sec):
    from auth_utils import verify_password

    client, db = sec
    both, both_secret = _issue(
        db,
        [store.SCOPE_ADMIN_USERS_WRITE, store.SCOPE_ADMIN_SECRETS_WRITE, store.SCOPE_ADMIN_DANGEROUS],
        name="both",
    )
    before = {row.get("_id") for row in db.users.docs.values()}
    created = _send(
        client, both_secret, both["id"], "POST",
        "/api/platform/admin-v1/platform-users",
        {"name": "Yeni", "email": "yeni@example.com", "password": "guclu-sifre"},
        idem="create-direct",
    )
    assert created.status_code == 403
    assert _detail(created) == "Panel yöneticisi danger/platform_user.create ile oluşturulur."
    assert "guclu-sifre" not in created.text
    assert {row.get("_id") for row in db.users.docs.values()} == before

    emailed = _send(
        client, both_secret, both["id"], "PUT",
        f"/api/platform/admin-v1/platform-users/{_USER}",
        {"email": "baska@example.com"},
        idem="email-direct",
    )
    assert emailed.status_code == 403
    assert _detail(emailed) == "E-posta danger/platform_user.email ile değişir."
    assert db.users.docs[_USER]["email"] == "panel@example.com"

    renamed = _send(
        client, both_secret, both["id"], "PUT",
        f"/api/platform/admin-v1/platform-users/{_USER}",
        {"name": "Panel Yeni"},
        idem="name-ok",
    )
    assert renamed.status_code == 200, renamed.text
    assert db.users.docs[_USER]["name"] == "Panel Yeni"
    assert "password_hash" not in renamed.text

    _prepared, confirmed = _danger(
        client, both_secret, both["id"], "platform_user.create",
        {
            "target_id": "platform",
            "reason": _REASON,
            "operator_email": _OPERATOR,
            "name": "Yeni",
            "email": "yeni@example.com",
            "password": "guclu-sifre",
        },
        "yeni@example.com",
        db,
        prep_idem="user-create-prep",
        conf_idem="user-create-conf",
    )
    assert confirmed.status_code == 200, confirmed.text
    item = confirmed.json()["item"]
    assert item["email"] == "yeni@example.com"
    assert "guclu-sifre" not in confirmed.text
    assert "password" not in item
    created_id = item["id"]
    stored = db.users.docs[created_id]
    assert stored["is_super_admin"] is True
    assert stored["password_hash"] != "guclu-sifre"
    assert verify_password("guclu-sifre", stored["password_hash"])
    assert "guclu-sifre" not in _audit_blob(db)

    _prepared, password_ok = _danger(
        client, both_secret, both["id"], "platform_user.password",
        {
            "target_id": _USER,
            "reason": _REASON,
            "operator_email": _OPERATOR,
            "password": "yeni-sifre-1",
        },
        "panel@example.com",
        db,
        prep_idem="user-pw-prep",
        conf_idem="user-pw-conf",
    )
    assert password_ok.status_code == 200, password_ok.text
    assert "yeni-sifre-1" not in password_ok.text
    assert verify_password("yeni-sifre-1", db.users.docs[_USER]["password_hash"])
    assert "yeni-sifre-1" not in _audit_blob(db)

    _prepared, email_ok = _danger(
        client, both_secret, both["id"], "platform_user.email",
        {
            "target_id": _USER,
            "reason": _REASON,
            "operator_email": _OPERATOR,
            "email": "panel2@example.com",
        },
        "panel@example.com",
        db,
        prep_idem="user-mail-prep",
        conf_idem="user-mail-conf",
    )
    assert email_ok.status_code == 200, email_ok.text
    assert db.users.docs[_USER]["email"] == "panel2@example.com"


def test_product_key_cannot_receive_scope_caller_lacks(sec):
    client, db = sec
    pub, secret = _issue(db, [store.SCOPE_ADMIN_KEYS_WRITE], name="caller")
    before = _ids(db)
    denied = _send(client, secret, pub["id"], "POST", "/api/platform/admin-v1/api-keys", {
        "product_id": _product_id(db, pub["id"]),
        "name": "Fazla",
        "kind": "product",
        "instance_id": _COMPANY,
        "scopes": ["help:read"],
    }, idem="product-outside")
    assert denied.status_code == 403
    assert _detail(denied) == "İstenen kapsam çağıran anahtarın kapsamının dışında."
    assert _ids(db) == before
    assert "credential" not in denied.text

    write = _send(client, secret, pub["id"], "POST", "/api/platform/admin-v1/api-keys", {
        "product_id": _product_id(db, pub["id"]),
        "name": "Yazma",
        "kind": "product",
        "instance_id": _COMPANY,
        "scopes": ["usage:write"],
    }, idem="product-write")
    assert write.status_code == 403
    assert _detail(write) == "Yazma kapsamı danger/key.product_create ile verilir."
    assert _ids(db) == before

    created = _send(client, secret, pub["id"], "POST", "/api/platform/admin-v1/api-keys", {
        "product_id": _product_id(db, pub["id"]),
        "name": "Okuma",
        "kind": "product",
        "instance_id": _COMPANY,
        "scopes": ["license:verify"],
    }, idem="product-read")
    assert created.status_code == 200, created.text
    key_id = created.json()["item"]["id"]
    rescope = _send(
        client, secret, pub["id"], "PUT",
        f"/api/platform/admin-v1/api-keys/{key_id}/scopes",
        {"scopes": ["usage:write", "license:verify"]},
        idem="product-rescope",
    )
    assert rescope.status_code == 403
    assert _detail(rescope) == "Yazma kapsamı danger/key.product_scopes ile verilir."
    assert db.platform_api_keys.docs[key_id]["scopes"] == ["license:verify"]

    danger_key, danger_secret = _issue(
        db,
        [store.SCOPE_ADMIN_KEYS_WRITE, store.SCOPE_ADMIN_DANGEROUS],
        name="danger-keys",
    )
    outside = _send(
        client, danger_secret, danger_key["id"], "POST",
        "/api/platform/admin-v1/danger/key.product_create/prepare",
        {
            "target_id": "platform",
            "reason": _REASON,
            "operator_email": _OPERATOR,
            "name": "Yabanci",
            "product_id": _product_id(db, pub["id"]),
            "instance_id": _COMPANY,
            "scopes": ["help:read"],
        },
        idem="product-danger-outside",
    )
    assert outside.status_code == 403
    assert _detail(outside) == "İstenen kapsam çağıran anahtarın kapsamının dışında."

    _prepared, confirmed = _danger(
        client, danger_secret, danger_key["id"], "key.product_create",
        {
            "target_id": "platform",
            "reason": _REASON,
            "operator_email": _OPERATOR,
            "name": "Yazma Anahtari",
            "product_id": _product_id(db, pub["id"]),
            "instance_id": _COMPANY,
            "scopes": ["usage:write"],
        },
        "Yazma Anahtari",
        db,
        prep_idem="product-danger-prep",
        conf_idem="product-danger-conf",
    )
    assert confirmed.status_code == 200, confirmed.text
    body = confirmed.json()["item"]
    assert body["credential"]
    assert body["scopes"] == ["usage:write"]
    assert body["kind"] == "product"
    assert "credential" not in _audit_blob(db)
    assert body["credential"] not in _audit_blob(db)
