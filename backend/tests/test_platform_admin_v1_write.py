"""admin-v1 yazma uçları. TestClient + bellek FakeDB. Canlı DB / port yok."""
from __future__ import annotations

import asyncio
import json
import logging
import os
from datetime import datetime, timedelta, timezone

os.environ["MONGO_URL"] = ""
os.environ["MYSQL_URL"] = ""
os.environ["MYSQL_HOST"] = ""
os.environ["MYSQL_USER"] = ""
os.environ["MYSQL_PASSWORD"] = ""
os.environ["MYSQL_DATABASE"] = ""

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import addons
import comm_service
import mail_service
import platform_admin
import platform_admin_v1_write
import platform_sms
import platform_store as store
import saas
import tenant_idor_allowlist as allowlist
from test_platform_admin_v1 import (
    FakeColl,
    FakeDB,
    _bad_key,
    _detail,
    _issue,
    _plant_key,
    _signed_headers,
    _walk_keys,
    with_peer,
)

_TARGETS = (
    "company_licenses",
    "upgrade_requests",
    "platform_products",
    "notifications",
    "idempotency_keys",
)
_WRITE_SCOPES = (
    store.SCOPE_ADMIN_LICENSES_WRITE,
    store.SCOPE_ADMIN_REQUESTS_WRITE,
    store.SCOPE_ADMIN_INTEGRATORS_WRITE,
)
_ADMIN_ALLOW_REASON = (
    "Platform yönetim API'si; HMAC platform_admin anahtarı "
    "(kind=platform_admin, admin.* kapsamı), şirket oturumu yok"
)


class WriteDB(FakeDB):
    def __init__(self):
        super().__init__()
        self.idempotency_keys = FakeColl()
        self.upgrade_requests = FakeColl()
        self.notifications = FakeColl()


def _target_counts(db):
    return {
        name: (getattr(db, name).inserts, getattr(db, name).updates, getattr(db, name).deletes)
        for name in _TARGETS
    }


def _write_audits(db):
    return [
        row for row in db.platform_audit_log.docs.values()
        if str(row.get("action") or "").startswith("admin_v1.write.")
    ]


def _app():
    app = FastAPI()
    app.include_router(platform_admin_v1_write.router)
    app.include_router(saas.router)
    app.include_router(platform_admin.router)
    app.dependency_overrides[saas.require_super_admin] = lambda: {
        "id": "sa1",
        "is_super_admin": True,
    }
    return app


def _client(ip: str = "127.0.0.1") -> TestClient:
    return TestClient(with_peer(_app(), ip), base_url="http://127.0.0.1:1")


def _forbid_channel(name):
    async def inner(*_args, **_kwargs):
        raise AssertionError(name)

    inner._channel = name
    return inner


@pytest.fixture
def db(monkeypatch):
    async def create_index(self, *_args, **_kwargs):
        return "idempo"

    monkeypatch.setattr(FakeColl, "create_index", create_index, raising=False)
    fake = WriteDB()
    prev = (store._db, saas._db, saas._current_user, addons._db)
    store.init(fake)
    saas.init(fake, None)
    saas.invalidate()
    addons.init(fake)
    monkeypatch.setattr(comm_service, "encrypt", lambda v: "enc:" + (v or ""))
    monkeypatch.setattr(comm_service, "decrypt", lambda v: (v or "").removeprefix("enc:"))
    monkeypatch.setattr(mail_service, "send_mail", _forbid_channel("send_mail"))
    monkeypatch.setattr(platform_sms, "send_platform_sms", _forbid_channel("send_platform_sms"))
    monkeypatch.setattr(comm_service, "sms_send", _forbid_channel("sms_send"))
    yield fake
    store.init(prev[0])
    saas.init(prev[1], prev[2])
    addons.init(prev[3])
    saas.invalidate()


def _send(
    client,
    secret,
    key_id,
    method,
    path,
    payload=None,
    *,
    raw=None,
    idem="idem-1",
    nonce=None,
    real_ip="203.0.113.10",
    headers_extra=None,
):
    if raw is None:
        raw = (
            b""
            if payload is None
            else json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        )
    headers, _, nonce_used = _signed_headers(secret, key_id, method, path, raw, nonce=nonce)
    if idem is not None:
        headers["Idempotency-Key"] = idem
    if real_ip is not None:
        headers["X-Real-IP"] = real_ip
    if headers_extra:
        headers.update(headers_extra)
    response = client.request(method, path, content=raw, headers=headers)
    return response, headers, nonce_used


def _seed(db):
    async def run():
        await store.ensure_seeded()
        await db.saas_plans.insert_one({
            "_id": "plan_pro",
            "name": "Profesyonel",
            "code": "pro",
            "modules": ["/invoices"],
            "price_monthly": 100,
            "price_yearly": 1000,
            "user_limit": 10,
            "company_limit": 1,
            "product_limit": 0,
            "contact_limit": 0,
            "storage_limit_mb": 0,
            "sort": 1,
        })
        await db.saas_plans.insert_one({
            "_id": "plan_std",
            "name": "Standart",
            "code": "std",
            "modules": ["/invoices"],
            "price_monthly": 50,
            "price_yearly": 500,
            "user_limit": 5,
            "company_limit": 1,
            "product_limit": 0,
            "contact_limit": 0,
            "storage_limit_mb": 0,
            "sort": 2,
        })
        for cid, trial in (("comp_a", "2099-01-01T00:00:00+00:00"), ("comp_b", None)):
            await db.companies.insert_one({
                "_id": cid,
                "name": cid,
                "created_at": "2026-01-01T00:00:00+00:00",
            })
            lic = {
                "_id": cid,
                "company_id": cid,
                "plan_id": "plan_pro",
                "status": "active",
                "billing_period": "monthly",
                "module_overrides": {"/invoices": True},
                "notes": "",
            }
            if trial:
                lic["trial_ends_at"] = trial
            await db.company_licenses.insert_one(lic)
        await db.upgrade_requests.insert_one({
            "_id": "ur_1",
            "company_id": "comp_a",
            "plan_id": "plan_std",
            "plan_name": "Standart",
            "status": "pending",
            "created_at": "2026-04-01T00:00:00+00:00",
        })
        await db.platform_products.insert_one({
            "_id": "pp_shop",
            "code": "shop",
            "name": "Shop",
            "kind": "ecommerce",
            "status": "active",
            "base_url": "https://shop.example",
            "created_at": "2026-01-01T00:00:00+00:00",
        })

    asyncio.run(run())


_CASES = (
    ("license", "PUT", "/api/platform/admin-v1/companies/comp_a/license", store.SCOPE_ADMIN_LICENSES_WRITE, store.SCOPE_ADMIN_LICENSES_READ, store.SCOPE_ADMIN_INTEGRATORS_WRITE, {"notes": "a"}),
    ("module", "POST", "/api/platform/admin-v1/companies/comp_a/modules/ai-advisor", store.SCOPE_ADMIN_LICENSES_WRITE, store.SCOPE_ADMIN_LICENSES_READ, store.SCOPE_ADMIN_REQUESTS_WRITE, {"enabled": True}),
    ("activation", "POST", "/api/platform/admin-v1/companies/comp_a/activation", store.SCOPE_ADMIN_LICENSES_WRITE, store.SCOPE_ADMIN_LICENSES_READ, store.SCOPE_ADMIN_INTEGRATORS_WRITE, {"active": False}),
    ("upgrade", "PUT", "/api/platform/admin-v1/upgrade-requests/ur_1", store.SCOPE_ADMIN_REQUESTS_WRITE, store.SCOPE_ADMIN_REQUESTS_READ, store.SCOPE_ADMIN_LICENSES_WRITE, {"status": "rejected", "apply": False}),
    ("product", "PUT", "/api/platform/admin-v1/integrators/products/pp_shop", store.SCOPE_ADMIN_INTEGRATORS_WRITE, store.SCOPE_ADMIN_INTEGRATORS_READ, store.SCOPE_ADMIN_LICENSES_WRITE, {"name": "Shop 2"}),
)


def test_allowlist_entries():
    pairs = (
        ("PUT", "/platform/admin-v1/companies/{company_id}/license"),
        ("POST", "/platform/admin-v1/companies/{company_id}/modules/{module_key:path}"),
        ("POST", "/platform/admin-v1/companies/{company_id}/activation"),
        ("PUT", "/platform/admin-v1/upgrade-requests/{req_id}"),
        ("PUT", "/platform/admin-v1/integrators/products/{product_id}"),
    )
    for pair in pairs:
        assert pair in allowlist.TENANT_IDOR_ALLOWLIST
        assert allowlist.ALLOWLIST_REASONS[pair] == _ADMIN_ALLOW_REASON


def test_auth_matrix_does_not_write(db):
    _seed(db)
    _plant_key(
        db, key_id="pk_product_w", secret="product-secret", kind="product", scopes=list(_WRITE_SCOPES),
    )
    _plant_key(
        db, key_id="pk_bound_w", secret="bound-secret", kind="platform_admin",
        scopes=list(_WRITE_SCOPES), instance_id="comp_bound",
    )
    readers = {
        scope: _issue(db, [scope], name=f"read-{scope}")
        for scope in (
            store.SCOPE_ADMIN_LICENSES_READ,
            store.SCOPE_ADMIN_REQUESTS_READ,
            store.SCOPE_ADMIN_INTEGRATORS_READ,
        )
    }
    writers = {scope: _issue(db, [scope], name=f"write-{scope}") for scope in _WRITE_SCOPES}
    client = _client()
    for name, method, path, scope, read_scope, wrong_scope, _ok in _CASES:
        pub, secret = writers[scope]
        read_pub, read_secret = readers[read_scope]
        wrong_pub, wrong_secret = writers[wrong_scope]

        before = _target_counts(db)
        missing = client.request(method, path, content=b"{}")
        assert missing.status_code == 401, name
        assert _detail(missing) == "Eksik imza başlıkları"
        assert _target_counts(db) == before
        assert not _write_audits(db)

        before = _target_counts(db)
        headers, _, _ = _signed_headers(secret, pub["id"], method, path, b"{}")
        headers["X-Platform-Signature"] = "ab" * 32
        bad = client.request(method, path, content=b"{}", headers=headers)
        assert bad.status_code == 401, name
        assert _detail(bad) == "İmza doğrulanamadı"
        assert _target_counts(db) == before

        before = _target_counts(db)
        first, headers, _ = _send(client, secret, pub["id"], method, path, raw=b"{}", idem=f"replay-{name}")
        assert first.status_code == 400, first.text
        again = client.request(method, path, content=b"{}", headers=headers)
        assert again.status_code == 401, name
        assert _detail(again) == "Tekrarlanan nonce"
        assert _target_counts(db) == before
        assert not _write_audits(db)

        before = _target_counts(db)
        read_resp, _, _ = _send(client, read_secret, read_pub["id"], method, path, raw=b"{}", idem=f"read-{name}")
        assert read_resp.status_code == 403, name
        assert _detail(read_resp) == "Kapsam yetersiz"
        wrong, _, _ = _send(client, wrong_secret, wrong_pub["id"], method, path, raw=b"{}", idem=f"wrong-{name}")
        assert wrong.status_code == 403, name
        assert _detail(wrong) == "Kapsam yetersiz"
        product, _, _ = _send(client, "product-secret", "pk_product_w", method, path, raw=b"{}", idem=f"kind-{name}")
        assert product.status_code == 403, name
        assert _detail(product) == "Kapsam yetersiz"
        bound, _, _ = _send(client, "bound-secret", "pk_bound_w", method, path, raw=b"{}", idem=f"bound-{name}")
        assert bound.status_code == 403, name
        assert _detail(bound) == "Kapsam yetersiz"
        assert _target_counts(db) == before
        assert not _write_audits(db)


def test_ip_allowlist(db):
    _seed(db)
    pub, secret = _issue(
        db, list(_WRITE_SCOPES), ip_allowlist=["203.0.113.7"], name="ip-write",
    )
    client = _client()
    for name, method, path, _scope, _read, _wrong, body in _CASES:
        before = _target_counts(db)
        writes = len(_write_audits(db))
        denied, _, _ = _send(
            client, secret, pub["id"], method, path, body,
            idem=f"ip-no-{name}", real_ip="198.51.100.9",
        )
        assert denied.status_code == 403, denied.text
        assert _detail(denied) == "IP adresi bu anahtar için izinli değil"
        assert _target_counts(db) == before
        assert len(_write_audits(db)) == writes
        rows = [row for row in db.platform_audit_log.docs.values() if row["action"] == "admin_v1.auth.ip_denied"]
        assert rows
        assert rows[-1]["details"]["path"] == path
        assert secret not in json.dumps(rows[-1])
        assert "198.51.100.9" not in json.dumps(rows[-1]["details"])

        allowed, _, _ = _send(
            client, secret, pub["id"], method, path, body,
            idem=f"ip-yes-{name}", real_ip="203.0.113.7",
        )
        assert allowed.status_code == 200, f"{name} {allowed.text}"


def test_validation_does_not_write(db):
    _seed(db)
    licenses, lic_secret = _issue(db, [store.SCOPE_ADMIN_LICENSES_WRITE], name="lic-w")
    requests_key, req_secret = _issue(db, [store.SCOPE_ADMIN_REQUESTS_WRITE], name="req-w")
    products, prod_secret = _issue(db, [store.SCOPE_ADMIN_INTEGRATORS_WRITE], name="prod-w")
    client = _client()
    long_note = "n" * 2001
    long_name = "a" * 201
    cases = [
        ("PUT", "/api/platform/admin-v1/companies/comp_a/license", licenses, lic_secret, None, b"", 400, "Gövde boş olamaz."),
        ("PUT", "/api/platform/admin-v1/companies/comp_a/license", licenses, lic_secret, {}, None, 400, "Gövde boş olamaz."),
        ("PUT", "/api/platform/admin-v1/companies/comp_a/license", licenses, lic_secret, {"user_limit": 3}, None, 400, "Desteklenmeyen alan: user_limit"),
        ("PUT", "/api/platform/admin-v1/companies/comp_a/license", licenses, lic_secret, {"module_overrides": {"/invoices": False}}, None, 400, "Desteklenmeyen alan: module_overrides"),
        ("PUT", "/api/platform/admin-v1/companies/comp_a/license", licenses, lic_secret, {"password": "x"}, None, 400, "Desteklenmeyen alan: password"),
        ("PUT", "/api/platform/admin-v1/companies/comp_a/license", licenses, lic_secret, {"is_super_admin": True}, None, 400, "Desteklenmeyen alan: is_super_admin"),
        ("PUT", "/api/platform/admin-v1/companies/comp_a/license", licenses, lic_secret, {"status": "foo"}, None, 400, "Geçersiz durum."),
        ("PUT", "/api/platform/admin-v1/companies/comp_a/license", licenses, lic_secret, {"plan_id": "plan_yok"}, None, 400, "Geçersiz paket."),
        ("PUT", "/api/platform/admin-v1/companies/comp_a/license", licenses, lic_secret, {"extend_days": 0}, None, 400, "extend_days 1 ile 3650 arasında bir tamsayı olmalı."),
        ("PUT", "/api/platform/admin-v1/companies/comp_a/license", licenses, lic_secret, {"extend_days": "abc"}, None, 400, "extend_days 1 ile 3650 arasında bir tamsayı olmalı."),
        ("PUT", "/api/platform/admin-v1/companies/comp_a/license", licenses, lic_secret, {"extend_days": 9999}, None, 400, "extend_days 1 ile 3650 arasında bir tamsayı olmalı."),
        ("PUT", "/api/platform/admin-v1/companies/comp_a/license", licenses, lic_secret, {"extend_days": True}, None, 400, "extend_days 1 ile 3650 arasında bir tamsayı olmalı."),
        ("PUT", "/api/platform/admin-v1/companies/comp_a/license", licenses, lic_secret, {"extend_days": 1.5}, None, 400, "extend_days 1 ile 3650 arasında bir tamsayı olmalı."),
        ("PUT", "/api/platform/admin-v1/companies/comp_a/license", licenses, lic_secret, {"trial_ends_at": "yarin"}, None, 400, "trial_ends_at geçerli bir ISO tarih ya da null olmalı."),
        ("PUT", "/api/platform/admin-v1/companies/comp_a/license", licenses, lic_secret, {"expires_at": ""}, None, 400, "expires_at geçerli bir ISO tarih ya da null olmalı."),
        ("PUT", "/api/platform/admin-v1/companies/comp_a/license", licenses, lic_secret, {"billing_period": "weekly"}, None, 400, "billing_period monthly veya yearly olmalı."),
        ("PUT", "/api/platform/admin-v1/companies/comp_a/license", licenses, lic_secret, {"notes": long_note}, None, 400, "notes en çok 2000 karakter olabilir."),
        ("PUT", "/api/platform/admin-v1/companies/comp_missing/license", licenses, lic_secret, {"notes": "yok"}, None, 404, "Şirket bulunamadı."),
        ("POST", "/api/platform/admin-v1/companies/comp_a/modules/ai-advisor", licenses, lic_secret, {"enabled": "true"}, None, 400, "enabled boolean olmalı."),
        ("POST", "/api/platform/admin-v1/companies/comp_a/modules/ai-advisor", licenses, lic_secret, {}, None, 400, "enabled zorunlu."),
        ("POST", "/api/platform/admin-v1/companies/comp_a/modules/settings", licenses, lic_secret, {"enabled": True}, None, 400, "Bilinmeyen ya da çekirdek modül."),
        ("POST", "/api/platform/admin-v1/companies/comp_a/modules/no-such", licenses, lic_secret, {"enabled": True}, None, 400, "Bilinmeyen ya da çekirdek modül."),
        ("POST", "/api/platform/admin-v1/companies/comp_missing/modules/ai-advisor", licenses, lic_secret, {"enabled": True}, None, 404, "Şirket bulunamadı."),
        ("POST", "/api/platform/admin-v1/companies/comp_a/activation", licenses, lic_secret, {}, None, 400, "active zorunlu."),
        ("POST", "/api/platform/admin-v1/companies/comp_a/activation", licenses, lic_secret, {"active": "true"}, None, 400, "active boolean olmalı."),
        ("POST", "/api/platform/admin-v1/companies/comp_missing/activation", licenses, lic_secret, {"active": False}, None, 404, "Şirket bulunamadı."),
        ("PUT", "/api/platform/admin-v1/upgrade-requests/ur_1", requests_key, req_secret, {}, None, 400, "status zorunlu."),
        ("PUT", "/api/platform/admin-v1/upgrade-requests/ur_1", requests_key, req_secret, {"note": "x"}, None, 400, "status zorunlu."),
        ("PUT", "/api/platform/admin-v1/upgrade-requests/ur_1", requests_key, req_secret, {"status": "foo"}, None, 400, "Geçersiz durum."),
        ("PUT", "/api/platform/admin-v1/upgrade-requests/ur_missing", requests_key, req_secret, {"status": "approved"}, None, 404, "Talep bulunamadı."),
        ("PUT", "/api/platform/admin-v1/integrators/products/pp_shop", products, prod_secret, {}, None, 400, "Gövde boş olamaz."),
        ("PUT", "/api/platform/admin-v1/integrators/products/pp_shop", products, prod_secret, {"code": "shop2"}, None, 400, "Desteklenmeyen alan: code"),
        ("PUT", "/api/platform/admin-v1/integrators/products/pp_shop", products, prod_secret, {"kind": "erp"}, None, 400, "Desteklenmeyen alan: kind"),
        ("PUT", "/api/platform/admin-v1/integrators/products/pp_shop", products, prod_secret, {"password": "x"}, None, 400, "Desteklenmeyen alan: password"),
        ("PUT", "/api/platform/admin-v1/integrators/products/pp_shop", products, prod_secret, {"is_super_admin": True}, None, 400, "Desteklenmeyen alan: is_super_admin"),
        ("PUT", "/api/platform/admin-v1/integrators/products/pp_shop", products, prod_secret, {"base_url": "ftp://x"}, None, 400, "base_url http veya https adresi olmalı."),
        ("PUT", "/api/platform/admin-v1/integrators/products/pp_shop", products, prod_secret, {"name": ""}, None, 400, "name boş olamaz."),
        ("PUT", "/api/platform/admin-v1/integrators/products/pp_shop", products, prod_secret, {"name": long_name}, None, 400, "name en çok 200 karakter olabilir."),
        ("PUT", "/api/platform/admin-v1/integrators/products/pp_missing", products, prod_secret, {"name": "Yok"}, None, 404, "Ürün bulunamadı"),
    ]
    for index, (method, path, pub, secret, payload, raw, status, detail) in enumerate(cases):
        before = _target_counts(db)
        audits = len(_write_audits(db))
        response, _, _ = _send(
            client, secret, pub["id"], method, path, payload, raw=raw, idem=f"bad-{index}",
        )
        assert response.status_code == status, f"{path} {payload} {response.text}"
        assert _detail(response) == detail
        assert _target_counts(db) == before
        assert len(_write_audits(db)) == audits

    missing_key, _, _ = _send(
        client, lic_secret, licenses["id"], "PUT",
        "/api/platform/admin-v1/companies/comp_a/license",
        {"notes": "x"}, idem=None,
    )
    assert missing_key.status_code == 400
    assert _detail(missing_key) == "Idempotency-Key gerekli"


def test_idempotency_and_upgrade_noop(db):
    _seed(db)
    pub, secret = _issue(db, [store.SCOPE_ADMIN_LICENSES_WRITE], name="idem-lic")
    req_pub, req_secret = _issue(db, [store.SCOPE_ADMIN_REQUESTS_WRITE], name="idem-req")
    client = _client()
    path = "/api/platform/admin-v1/companies/comp_a/license"
    body = {"notes": "ilk", "billing_period": "yearly"}
    before_updates = db.company_licenses.updates
    first, _, _ = _send(client, secret, pub["id"], "PUT", path, body, idem="same-body")
    second, _, _ = _send(client, secret, pub["id"], "PUT", path, body, idem="same-body")
    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert first.json() == second.json()
    assert db.company_licenses.updates == before_updates + 1
    assert len(_write_audits(db)) == 1
    assert len(db.idempotency_keys.docs) == 1

    clash, _, _ = _send(
        client, secret, pub["id"], "PUT", path, {"notes": "baska"}, idem="same-body",
    )
    assert clash.status_code == 409
    assert _detail(clash) == "Idempotency-Key farklı istekle kullanıldı"
    assert db.company_licenses.updates == before_updates + 1
    assert len(_write_audits(db)) == 1

    up_path = "/api/platform/admin-v1/upgrade-requests/ur_1"
    approved = {"status": "approved", "apply": True, "note": "ok"}
    notes_before = len(db.notifications.docs)
    lic_before = db.company_licenses.updates
    done, _, _ = _send(client, req_secret, req_pub["id"], "PUT", up_path, approved, idem="up-1")
    assert done.status_code == 200, done.text
    assert len(db.notifications.docs) == notes_before + 1
    again, _, _ = _send(
        client, req_secret, req_pub["id"], "PUT", up_path,
        {"status": "approved", "apply": True, "note": "ikinci"},
        idem="up-2",
    )
    assert again.status_code == 200, again.text
    assert again.json()["item"]["status"] == "approved"
    assert db.upgrade_requests.docs["ur_1"]["admin_note"] == "ok"
    assert len(db.notifications.docs) == notes_before + 1
    assert db.company_licenses.updates == lic_before + 1


def test_audit_and_behavior(db, monkeypatch):
    _seed(db)
    calls = []
    original = saas.invalidate

    def _spy(company_id=None):
        calls.append(company_id)
        return original(company_id)

    monkeypatch.setattr(saas, "invalidate", _spy)
    lic_pub, lic_secret = _issue(db, [store.SCOPE_ADMIN_LICENSES_WRITE], name="beh-lic")
    req_pub, req_secret = _issue(db, [store.SCOPE_ADMIN_REQUESTS_WRITE], name="beh-req")
    prod_pub, prod_secret = _issue(db, [store.SCOPE_ADMIN_INTEGRATORS_WRITE], name="beh-prod")
    client = _client()
    ip = "203.0.113.10"

    body = {
        "plan_id": "plan_std",
        "status": "active",
        "billing_period": "yearly",
        "notes": "yenileme",
        "extend_days": 30,
    }
    lic, _, _ = _send(
        client, lic_secret, lic_pub["id"], "PUT",
        "/api/platform/admin-v1/companies/comp_a/license", body, idem="beh-lic", real_ip=ip,
    )
    assert lic.status_code == 200, lic.text
    item = lic.json()["item"]
    assert item["plan_id"] == "plan_std"
    assert item["status"] == "active"
    assert item["billing_period"] == "yearly"
    assert item["notes"] == "yenileme"
    stored = db.company_licenses.docs["comp_a"]
    assert stored["plan_id"] == "plan_std"
    assert stored["status"] == "active"
    assert stored["billing_period"] == "yearly"
    assert stored["notes"] == "yenileme"
    assert stored["module_overrides"] == {}
    expires = datetime.fromisoformat(stored["expires_at"])
    assert timedelta(days=29) < expires - datetime.now(timezone.utc) < timedelta(days=31)
    assert "comp_a" in calls

    mod, _, _ = _send(
        client, lic_secret, lic_pub["id"], "POST",
        "/api/platform/admin-v1/companies/comp_a/modules/ai-advisor",
        {"enabled": True}, idem="beh-mod", real_ip=ip,
    )
    assert mod.status_code == 200, mod.text
    assert db.company_licenses.docs["comp_a"]["addon_overrides"]["ai.advisor"] is True
    assert db.company_licenses.docs["comp_a"]["module_overrides"]["/ai-advisor"] is True
    assert mod.json()["item"]["addon_overrides"]["ai.advisor"] is True

    off, _, _ = _send(
        client, lic_secret, lic_pub["id"], "POST",
        "/api/platform/admin-v1/companies/comp_b/activation",
        {"active": False}, idem="beh-off", real_ip=ip,
    )
    assert off.status_code == 200, off.text
    assert db.company_licenses.docs["comp_b"]["status"] == "suspended"
    on, _, _ = _send(
        client, lic_secret, lic_pub["id"], "POST",
        "/api/platform/admin-v1/companies/comp_b/activation",
        {"active": True}, idem="beh-on", real_ip=ip,
    )
    assert on.status_code == 200, on.text
    assert db.company_licenses.docs["comp_b"]["status"] == "active"

    trial_off, _, _ = _send(
        client, lic_secret, lic_pub["id"], "POST",
        "/api/platform/admin-v1/companies/comp_a/activation",
        {"active": False}, idem="beh-trial-off", real_ip=ip,
    )
    assert trial_off.status_code == 200, trial_off.text
    assert db.company_licenses.docs["comp_a"]["status"] == "suspended"
    trial_on, _, _ = _send(
        client, lic_secret, lic_pub["id"], "POST",
        "/api/platform/admin-v1/companies/comp_a/activation",
        {"active": True}, idem="beh-trial-on", real_ip=ip,
    )
    assert trial_on.status_code == 200, trial_on.text
    assert db.company_licenses.docs["comp_a"]["status"] == "trial"

    up, _, _ = _send(
        client, req_secret, req_pub["id"], "PUT",
        "/api/platform/admin-v1/upgrade-requests/ur_1",
        {"status": "approved", "apply": True, "note": "uygula"},
        idem="beh-up", real_ip=ip,
    )
    assert up.status_code == 200, up.text
    assert db.upgrade_requests.docs["ur_1"]["status"] == "approved"
    assert db.company_licenses.docs["comp_a"]["plan_id"] == "plan_std"
    assert db.company_licenses.docs["comp_a"]["status"] == "active"
    assert len(db.notifications.docs) == 1
    note = next(iter(db.notifications.docs.values()))
    assert note["company_id"] == "comp_a"
    assert note["type"] == "license"
    assert "onaylandı" in note["title"]

    prod, _, _ = _send(
        client, prod_secret, prod_pub["id"], "PUT",
        "/api/platform/admin-v1/integrators/products/pp_shop",
        {"name": "Yeni Magaza", "status": "paused", "base_url": "https://shop.example/v2"},
        idem="beh-prod", real_ip=ip,
    )
    assert prod.status_code == 200, prod.text
    product = db.platform_products.docs["pp_shop"]
    assert product["name"] == "Yeni Magaza"
    assert product["status"] == "paused"
    assert product["base_url"] == "https://shop.example/v2"
    assert product["code"] == "shop"
    assert product["kind"] == "ecommerce"

    expected = {
        "admin_v1.write.license.update": ("company", "comp_a", ["billing_period", "extend_days", "notes", "plan_id", "status"]),
        "admin_v1.write.module.toggle": ("company", "comp_a", ["enabled"]),
        "admin_v1.write.company.activation": ("company", "comp_b", ["active"]),
        "admin_v1.write.upgrade_request.resolve": ("upgrade_request", "ur_1", ["apply", "note", "status"]),
        "admin_v1.write.product.update": ("product", "pp_shop", ["base_url", "name", "status"]),
    }
    found = {}
    for row in _write_audits(db):
        found.setdefault(row["action"], row)
    assert set(expected) <= set(found)
    access = {row["action"] for row in db.platform_audit_log.docs.values()}
    assert "admin_v1.admin.licenses:write" in access
    assert "admin_v1.admin.requests:write" in access
    assert "admin_v1.admin.integrators:write" in access
    for action, (target_type, target_id, fields) in expected.items():
        row = found[action]
        assert row["actor_type"] == "api_key"
        assert row["actor_id"] in {lic_pub["id"], req_pub["id"], prod_pub["id"]}
        assert row["ip"] == ip
        assert row["target_type"] == target_type
        assert row["target_id"] == target_id
        assert row["details"]["fields"] == fields
        assert row["details"]["idempotency"] is True
        assert set(row["details"]) == {"fields", "idempotency"}
        if action == "admin_v1.write.license.update":
            assert row["actor_id"] == lic_pub["id"]
        if action == "admin_v1.write.product.update":
            assert row["actor_id"] == prod_pub["id"]
        if action == "admin_v1.write.upgrade_request.resolve":
            assert row["actor_id"] == req_pub["id"]


def test_secrets_do_not_leak(db, caplog):
    _seed(db)
    caplog.set_level(logging.DEBUG)
    pub, secret = _issue(db, [store.SCOPE_ADMIN_LICENSES_WRITE, store.SCOPE_ADMIN_INTEGRATORS_WRITE], name="leak")
    client = _client()
    lic, headers, nonce = _send(
        client, secret, pub["id"], "PUT",
        "/api/platform/admin-v1/companies/comp_a/license",
        {"notes": "LEAK-NOTE", "billing_period": "monthly"},
        idem="LEAK-IDEM",
    )
    assert lic.status_code == 200, lic.text
    prod, prod_headers, prod_nonce = _send(
        client, secret, pub["id"], "PUT",
        "/api/platform/admin-v1/integrators/products/pp_shop",
        {"base_url": "https://LEAK-URL.example", "name": "Gizli"},
        idem="other-idem",
    )
    assert prod.status_code == 200, prod.text
    blob = json.dumps(list(db.platform_audit_log.docs.values()), ensure_ascii=False, default=str)
    text = blob + "\n" + caplog.text
    for banned in (
        secret,
        headers["X-Platform-Signature"],
        nonce,
        prod_headers["X-Platform-Signature"],
        prod_nonce,
        "LEAK-NOTE",
        "LEAK-URL",
        "LEAK-IDEM",
        "enc:",
    ):
        assert banned not in text
    for response in (lic, prod):
        found = []
        _walk_keys(response.json(), found)
        assert not any(_bad_key(key) for key in found), found


def test_system_routes_keep_previous_behavior(db):
    _seed(db)
    async def extra():
        await db.companies.insert_one({
            "_id": "comp_sys",
            "name": "Sistem",
            "created_at": "2026-03-01T00:00:00+00:00",
        })
        await db.company_licenses.insert_one({
            "_id": "comp_sys",
            "company_id": "comp_sys",
            "plan_id": "plan_pro",
            "status": "active",
            "billing_period": "monthly",
            "module_overrides": {"/invoices": True},
            "notes": "",
        })
        await db.upgrade_requests.insert_one({
            "_id": "ur_sys",
            "company_id": "comp_sys",
            "plan_id": "plan_std",
            "plan_name": "Standart",
            "status": "pending",
            "created_at": "2026-04-02T00:00:00+00:00",
        })

    asyncio.run(extra())
    client = _client()
    idem_before = len(db.idempotency_keys.docs)
    write_before = len(_write_audits(db))

    bad_plan = client.put(
        "/api/system/companies/comp_sys/license",
        json={"plan_id": "plan_yok"},
    )
    assert bad_plan.status_code == 400
    assert bad_plan.json()["detail"] == "Geçersiz paket."

    lic = client.put(
        "/api/system/companies/comp_sys/license",
        json={
            "plan_id": "plan_std",
            "status": "trial",
            "user_limit": 4,
            "company_limit": 2,
            "product_limit": 9,
            "contact_limit": "",
            "storage_limit_mb": None,
            "module_overrides": {"/invoices": False, "/nope": True},
            "billing_period": "yearly",
            "notes": "sys",
            "extend_days": "12",
        },
    )
    assert lic.status_code == 200, lic.text
    body = lic.json()
    assert "item" not in body
    assert body["plan_id"] == "plan_std"
    assert body["user_limit"] == 4
    stored = db.company_licenses.docs["comp_sys"]
    assert stored["user_limit"] == 4
    assert stored["company_limit"] == 2
    assert stored["product_limit"] == 9
    assert stored["contact_limit"] is None
    assert stored["storage_limit_mb"] is None
    assert stored["module_overrides"] == {"/invoices": False}
    assert stored["billing_period"] == "yearly"
    assert stored["notes"] == "sys"
    assert stored["status"] == "trial"
    assert stored.get("trial_ends_at")

    bad_status = client.put(
        "/api/system/companies/comp_sys/license",
        json={"status": "foo"},
    )
    assert bad_status.status_code == 400
    assert bad_status.json()["detail"] == "Geçersiz durum."

    mod = client.post(
        "/api/system/companies/comp_sys/modules/ai-advisor",
        json={"enabled": "true"},
    )
    assert mod.status_code == 200, mod.text
    assert "item" not in mod.json()
    assert db.company_licenses.docs["comp_sys"]["addon_overrides"]["ai.advisor"] is True
    assert db.company_licenses.docs["comp_sys"]["module_overrides"]["/ai-advisor"] is True

    ghost = client.post(
        "/api/system/companies/comp_ghost/modules/invoices",
        json={"enabled": True},
    )
    assert ghost.status_code == 200, ghost.text
    assert "comp_ghost" in db.company_licenses.docs

    missing = client.post(
        "/api/system/companies/comp_nope/activation",
        json={"active": False},
    )
    assert missing.status_code == 404
    assert missing.json()["detail"] == "Şirket bulunamadı."

    suspended = client.post("/api/system/companies/comp_b/activation", json={"active": False})
    assert suspended.status_code == 200, suspended.text
    assert db.company_licenses.docs["comp_b"]["status"] == "suspended"
    restored = client.post("/api/system/companies/comp_b/activation", json={})
    assert restored.status_code == 200, restored.text
    assert db.company_licenses.docs["comp_b"]["status"] == "active"
    assert "item" not in restored.json()

    notes_before = len(db.notifications.docs)
    resolved = client.put("/api/system/upgrade-requests/ur_sys", json={})
    assert resolved.status_code == 200, resolved.text
    assert "item" not in resolved.json()
    assert resolved.json()["status"] == "approved"
    assert db.upgrade_requests.docs["ur_sys"]["status"] == "approved"
    assert db.company_licenses.docs["comp_sys"]["plan_id"] == "plan_std"
    assert db.company_licenses.docs["comp_sys"]["status"] == "active"
    assert len(db.notifications.docs) == notes_before + 1

    unknown = client.put("/api/system/upgrade-requests/missing", json={"status": "approved"})
    assert unknown.status_code == 404
    assert unknown.json()["detail"] == "Talep bulunamadı."

    renamed = client.put(
        "/api/platform/admin/products/pp_shop",
        json={"code": "shop2", "name": "Shop Iki"},
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["product"]["code"] == "shop2"
    assert db.platform_products.docs["pp_shop"]["code"] == "shop2"
    assert db.platform_products.docs["pp_shop"]["kind"] == "ecommerce"

    tam = next(doc for doc in db.platform_products.docs.values() if doc.get("code") == "tamkobi")
    blocked = client.put(
        f"/api/platform/admin/products/{tam['_id']}",
        json={"code": "tamkobi2"},
    )
    assert blocked.status_code == 400
    assert blocked.json()["detail"] == "tamkobi ürün kodu değiştirilemez"
    assert tam["code"] == "tamkobi"

    assert len(db.idempotency_keys.docs) == idem_before
    assert len(_write_audits(db)) == write_before
