"""admin-v1 ynt eşliği. TestClient + bellek FakeDB. Canlı DB / port yok.

Her yazma: imza, IP, kapsam, Idempotency-Key, şirket izolasyonu.
Silmeler danger prepare/confirm iki adımıdır. Okuma uçlarında Idempotency-Key yoktur.
"""
from __future__ import annotations

import asyncio
import json

import pyotp
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import addons
import comm_service
import demo
import einvoice_assign
import event_notify
import mail_service
import notify
import platform_admin_v1
import platform_admin_v1_danger as danger
import platform_admin_v1_ops
import platform_sms
import platform_store as store
import rbac
import saas
import superadmin_2fa
import support_tickets
import tenant_idor_allowlist as allowlist
from test_platform_admin_v1 import (
    FakeDB,
    _assert_no_extra_writes,
    _detail,
    _issue,
    _plant_key,
    _signed_headers,
    _walk_keys,
    _write_counts,
    with_peer,
)

_ADMIN_ALLOW_REASON = (
    "Platform yönetim API'si; HMAC platform_admin anahtarı "
    "(kind=platform_admin, admin.* kapsamı), şirket oturumu yok"
)
_OPERATOR = "ops@example.com"
_REASON = "Musteri kaydini guvenli sekilde temizlemek icin"
_TOTP = pyotp.random_base32()
_PASSWORD = "sifre-99"
_LEAK_PASS = "LEAK-EI-PASS"
_LEAK_USER = "gizli-kullanici"
_MAIL_A = "ada@example.com"
_MAIL_B = "beta-secret@example.com"
_PHONE_A = "5551112233"

_ALLOW = (
    ("POST", "/platform/admin-v1/companies/{company_id}/companies"),
    ("PUT", "/platform/admin-v1/companies/{company_id}/parent"),
    ("PUT", "/platform/admin-v1/companies/{company_id}/einvoice"),
    ("GET", "/platform/admin-v1/companies/{company_id}/notify-prefs"),
    ("PUT", "/platform/admin-v1/companies/{company_id}/notify-prefs"),
    ("GET", "/platform/admin-v1/companies/{company_id}/notify-mail-log"),
    ("POST", "/platform/admin-v1/companies/{company_id}/addons/{addon_key}"),
    ("PUT", "/platform/admin-v1/plans/{plan_id}"),
    ("POST", "/platform/admin-v1/support/tickets/{ticket_id}/messages"),
    ("POST", "/platform/admin-v1/support/tickets/{ticket_id}/status"),
)


def _company_body(email="yeni@example.com"):
    return {
        "name": "Yeni Firma",
        "admin_email": email,
        "admin_password": _PASSWORD,
        "plan_id": "plan_pro",
    }


def _cases():
    return (
        ("company", "POST", "/api/platform/admin-v1/companies", store.SCOPE_ADMIN_LICENSES_WRITE, store.SCOPE_ADMIN_LICENSES_READ, store.SCOPE_ADMIN_INTEGRATORS_WRITE, _company_body()),
        ("child", "POST", "/api/platform/admin-v1/companies/comp_a/companies", store.SCOPE_ADMIN_LICENSES_WRITE, store.SCOPE_ADMIN_LICENSES_READ, store.SCOPE_ADMIN_SUPPORT_WRITE, {"name": "Alt Ada", "admin_email": "alt@example.com", "admin_password": _PASSWORD}),
        ("parent", "PUT", "/api/platform/admin-v1/companies/comp_c/parent", store.SCOPE_ADMIN_LICENSES_WRITE, store.SCOPE_ADMIN_LICENSES_READ, store.SCOPE_ADMIN_NOTIFICATIONS_WRITE, {"parent_company_id": "comp_b"}),
        ("einvoice", "PUT", "/api/platform/admin-v1/companies/comp_a/einvoice", store.SCOPE_ADMIN_INTEGRATORS_WRITE, store.SCOPE_ADMIN_INTEGRATORS_READ, store.SCOPE_ADMIN_LICENSES_WRITE, {"provider": "isnet"}),
        ("prefs", "PUT", "/api/platform/admin-v1/companies/comp_a/notify-prefs", store.SCOPE_ADMIN_NOTIFICATIONS_WRITE, store.SCOPE_ADMIN_NOTIFICATIONS_READ, store.SCOPE_ADMIN_LICENSES_WRITE, {"extra_emails": [_MAIL_A], "email_from": "platform"}),
        ("addon", "POST", "/api/platform/admin-v1/companies/comp_a/addons/ai.advisor", store.SCOPE_ADMIN_LICENSES_WRITE, store.SCOPE_ADMIN_LICENSES_READ, store.SCOPE_ADMIN_INTEGRATORS_WRITE, {"enabled": False}),
        ("plan", "POST", "/api/platform/admin-v1/plans", store.SCOPE_ADMIN_LICENSES_WRITE, store.SCOPE_ADMIN_LICENSES_READ, store.SCOPE_ADMIN_REQUESTS_WRITE, {"name": "Deneme Paket", "code": "deneme", "price_monthly": 10, "modules": ["/invoices"], "is_public": True}),
        ("plan_put", "PUT", "/api/platform/admin-v1/plans/plan_spare", store.SCOPE_ADMIN_LICENSES_WRITE, store.SCOPE_ADMIN_LICENSES_READ, store.SCOPE_ADMIN_INTEGRATORS_WRITE, {"name": "Yedek 2"}),
        ("prices", "PUT", "/api/platform/admin-v1/modules/prices", store.SCOPE_ADMIN_LICENSES_WRITE, store.SCOPE_ADMIN_LICENSES_READ, store.SCOPE_ADMIN_INTEGRATORS_WRITE, {"prices": {"/invoices": 42}}),
        ("reply", "POST", "/api/platform/admin-v1/support/tickets/stk_a/messages", store.SCOPE_ADMIN_SUPPORT_WRITE, store.SCOPE_ADMIN_SUPPORT_READ, store.SCOPE_ADMIN_LICENSES_WRITE, {"body": "Yanıt metni burada", "operator_email": _OPERATOR}),
        ("status", "POST", "/api/platform/admin-v1/support/tickets/stk_a/status", store.SCOPE_ADMIN_SUPPORT_WRITE, store.SCOPE_ADMIN_SUPPORT_READ, store.SCOPE_ADMIN_NOTIFICATIONS_WRITE, {"status": "resolved", "operator_email": _OPERATOR}),
        ("product", "POST", "/api/platform/admin-v1/integrators/products", store.SCOPE_ADMIN_INTEGRATORS_WRITE, store.SCOPE_ADMIN_INTEGRATORS_READ, store.SCOPE_ADMIN_LICENSES_WRITE, {"code": "pazaryeri", "name": "Pazar", "kind": "ecommerce", "base_url": "https://pazar.example"}),
    )


def _danger_cases():
    body = {"target_id": "plan_spare", "reason": _REASON, "operator_email": _OPERATOR}
    product = {"target_id": "pp_shop", "reason": _REASON, "operator_email": _OPERATOR}
    return (
        ("plan.delete", "POST", "/api/platform/admin-v1/danger/plan.delete/prepare", body),
        ("product.delete", "POST", "/api/platform/admin-v1/danger/product.delete/prepare", product),
    )


def _app():
    app = FastAPI()
    app.include_router(platform_admin_v1.router)
    app.include_router(platform_admin_v1_ops.router)
    app.include_router(danger.router)
    return app


def _client() -> TestClient:
    return TestClient(with_peer(_app(), "127.0.0.1"), base_url="http://127.0.0.1:1")


def _send(client, secret, key_id, method, path, payload=None, *, raw=None, idem="idem-1", nonce=None, real_ip="203.0.113.10"):
    if raw is None:
        raw = b"" if payload is None else json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    headers, _, nonce_used = _signed_headers(secret, key_id, method, path, raw, nonce=nonce)
    if idem is not None:
        headers["Idempotency-Key"] = idem
    if real_ip is not None:
        headers["X-Real-IP"] = real_ip
    response = client.request(method, path, content=raw, headers=headers)
    return response, headers, nonce_used


def _get(client, secret, key_id, path, *, real_ip="203.0.113.10", nonce=None, params=None):
    headers, _, nonce_used = _signed_headers(secret, key_id, "GET", path, b"", nonce=nonce)
    if real_ip is not None:
        headers["X-Real-IP"] = real_ip
    return client.get(path, params=params, headers=headers), headers, nonce_used


def _write_audits(db):
    return [
        row for row in db.platform_audit_log.docs.values()
        if str(row.get("action") or "").startswith("admin_v1.write.")
        or str(row.get("action") or "").startswith("admin_v1.danger.")
    ]


def _blob(db, coll, key):
    doc = getattr(db, coll).docs.get(key)
    return json.dumps(doc, sort_keys=True, default=str)


@pytest.fixture
def db(monkeypatch):
    async def _noop(*_args, **_kwargs):
        return None

    monkeypatch.setattr(demo, "seed_for_new_company", _noop)
    monkeypatch.setattr(notify, "dispatch_push", _noop)
    monkeypatch.setattr(comm_service, "encrypt", lambda value: "enc:" + (value or ""))
    monkeypatch.setattr(comm_service, "decrypt", lambda value: (value or "").removeprefix("enc:"))
    monkeypatch.setattr(superadmin_2fa, "encrypt", lambda value: "enc:" + (value or ""))
    monkeypatch.setattr(superadmin_2fa, "decrypt", lambda value: (value or "").removeprefix("enc:"))
    monkeypatch.setattr(mail_service, "send_mail", _noop)
    monkeypatch.setattr(platform_sms, "send_platform_sms", _noop)

    fake = FakeDB()
    prev = (
        store._db, saas._db, saas._current_user, addons._db, event_notify._db,
        support_tickets._db, support_tickets._current_user, rbac._db,
        dict(einvoice_assign.KNOWN_PROVIDERS),
    )
    store.init(fake)
    saas.init(fake, None)
    saas.invalidate()
    addons.init(fake)
    event_notify.init(fake)
    support_tickets.init(fake, None)
    rbac._db = fake
    einvoice_assign.register_providers({"isnet": {"name": "İşNet"}, "n11faturam": {"name": "n11"}})
    yield fake
    store.init(prev[0])
    saas.init(prev[1], prev[2])
    addons.init(prev[3])
    event_notify.init(prev[4])
    support_tickets.init(prev[5], prev[6])
    rbac._db = prev[7]
    einvoice_assign.register_providers(prev[8])
    saas.invalidate()


def _seed(db):
    async def run():
        await store.ensure_seeded()
        for pid, name, code in (
            ("plan_pro", "Profesyonel", "pro"),
            ("plan_custom", "Özel Paket", "custom"),
            ("plan_spare", "Yedek Paket", "spare"),
        ):
            await db.saas_plans.insert_one({
                "_id": pid,
                "name": name,
                "code": code,
                "modules": ["/invoices"] if pid == "plan_pro" else [],
                "price_monthly": 100,
                "price_yearly": 1000,
                "user_limit": 10,
                "company_limit": 0,
                "product_limit": 0,
                "contact_limit": 0,
                "storage_limit_mb": 0,
                "sort": 1,
                "is_public": pid != "plan_custom",
                "is_popular": False,
            })
        for cid, name, email in (
            ("comp_a", "Ada Ticaret", _MAIL_A),
            ("comp_b", "Beta Ltd", _MAIL_B),
            ("comp_c", "Ceviz AŞ", "ceviz@example.com"),
        ):
            await db.companies.insert_one({
                "_id": cid,
                "name": name,
                "email": email,
                "license_id": cid,
                "created_at": "2026-01-01T00:00:00+00:00",
                "allow_platform_access": False,
            })
            await db.company_licenses.insert_one({
                "_id": cid,
                "company_id": cid,
                "plan_id": "plan_pro",
                "status": "active",
                "billing_period": "monthly",
                "module_overrides": {},
                "addon_overrides": {},
                "notes": "",
            })
        await db.users.insert_one({
            "_id": "usr_ops",
            "name": "Operatör",
            "email": _OPERATOR,
            "role": "admin",
            "company_ids": [],
            "is_super_admin": True,
            "is_active": True,
            "totp_enabled": True,
            "totp_secret": "enc:" + _TOTP,
            "totp_last_counter": None,
        })
        for tid, cid, number in (("stk_a", "comp_a", "T-1"), ("stk_b", "comp_b", "T-2")):
            await db.support_tickets.insert_one({
                "_id": tid,
                "company_id": cid,
                "number": number,
                "status": "open",
                "subject": "Yazıcı",
                "messages": [],
                "created_at": "2026-05-01T00:00:00+00:00",
            })
        await db.mail_logs.insert_one({
            "_id": "nl_a",
            "company_id": "comp_a",
            "context": "event_notify",
            "to": [_MAIL_A, _PHONE_A],
            "subject": "Sipariş",
            "status": "sent",
            "created_at": "2026-05-04T00:00:00+00:00",
        })
        await db.mail_logs.insert_one({
            "_id": "nl_b",
            "company_id": "comp_b",
            "context": "event_notify",
            "to": [_MAIL_B],
            "subject": "Gizli",
            "status": "sent",
            "created_at": "2026-05-04T01:00:00+00:00",
        })
        await db.einvoice_settings.insert_one({
            "_id": "ei_a",
            "company_id": "comp_a",
            "provider": "",
            "username": _LEAK_USER,
            "password_enc": _LEAK_PASS,
            "status": "live",
        })
        await db.platform_products.insert_one({
            "_id": "pp_shop",
            "code": "shop",
            "name": "Shop Extra",
            "kind": "ecommerce",
            "status": "active",
            "base_url": "https://shop.example",
            "created_at": "2026-01-01T00:00:00+00:00",
        })

    asyncio.run(run())


def _otp() -> str:
    return pyotp.TOTP(_TOTP).now()


def _bad_otp() -> str:
    current = _otp()
    for candidate in ("000000", "111111", "222222", "333333", "444444"):
        if candidate != current:
            return candidate
    return "555555"


def test_allowlist_entries():
    for pair in _ALLOW:
        assert pair in allowlist.TENANT_IDOR_ALLOWLIST
        assert allowlist.ALLOWLIST_REASONS[pair] == _ADMIN_ALLOW_REASON
    assert store.SCOPE_ADMIN_NOTIFICATIONS_READ in store.ADMIN_SCOPES
    assert store.SCOPE_ADMIN_NOTIFICATIONS_WRITE in store.ADMIN_SCOPES
    assert store.SCOPE_ADMIN_SUPPORT_WRITE in store.ADMIN_SCOPES


def test_auth_matrix_does_not_write(db):
    _seed(db)
    _plant_key(db, key_id="pk_product_p", secret="product-secret", kind="product", scopes=[store.SCOPE_ADMIN_LICENSES_WRITE])
    _plant_key(
        db, key_id="pk_bound_p", secret="bound-secret", kind="platform_admin",
        scopes=list(store.ADMIN_SCOPES), instance_id="comp_bound",
    )
    readers = {}
    writers = {}
    client = _client()
    for name, method, path, scope, read_scope, wrong_scope, _body in _cases():
        if scope not in writers:
            writers[scope] = _issue(db, [scope], name=f"w-{scope}")
        if read_scope not in readers:
            readers[read_scope] = _issue(db, [read_scope], name=f"r-{read_scope}")
        if wrong_scope not in writers:
            writers[wrong_scope] = _issue(db, [wrong_scope], name=f"w-{wrong_scope}")
        pub, secret = writers[scope]
        read_pub, read_secret = readers[read_scope]
        wrong_pub, wrong_secret = writers[wrong_scope]
        before = _write_counts(db)
        missing = client.request(method, path, content=b"{}")
        assert missing.status_code == 401, name
        assert _detail(missing) == "Eksik imza başlıkları"
        headers, _, _ = _signed_headers(secret, pub["id"], method, path, b"{}")
        headers["X-Platform-Signature"] = "ab" * 32
        bad = client.request(method, path, content=b"{}", headers=headers)
        assert bad.status_code == 401, name
        assert _detail(bad) == "İmza doğrulanamadı"
        first, signed, _ = _send(client, secret, pub["id"], method, path, raw=b"{}", idem=f"replay-{name}")
        assert first.status_code == 400, first.text
        again = client.request(method, path, content=b"{}", headers=signed)
        assert again.status_code == 401, name
        assert _detail(again) == "Tekrarlanan nonce"
        read_resp, _, _ = _send(client, read_secret, read_pub["id"], method, path, raw=b"{}", idem=f"read-{name}")
        assert read_resp.status_code == 403, name
        assert _detail(read_resp) == "Kapsam yetersiz"
        wrong, _, _ = _send(client, wrong_secret, wrong_pub["id"], method, path, raw=b"{}", idem=f"wrong-{name}")
        assert wrong.status_code == 403, name
        product, _, _ = _send(client, "product-secret", "pk_product_p", method, path, raw=b"{}", idem=f"kind-{name}")
        assert product.status_code == 403, name
        bound, _, _ = _send(client, "bound-secret", "pk_bound_p", method, path, raw=b"{}", idem=f"bound-{name}")
        assert bound.status_code == 403, name
        _assert_no_extra_writes(before, _write_counts(db))
        assert not [row for row in _write_audits(db) if str(row.get("action") or "").startswith("admin_v1.write.")]


def test_ip_allowlist_then_success(db):
    _seed(db)
    needed = sorted({scope for _n, _m, _p, scope, _r, _w, _b in _cases()})
    pub, secret = _issue(db, needed, ip_allowlist=["203.0.113.7"], name="ip-parity")
    client = _client()
    for name, method, path, _scope, _read, _wrong, body in _cases():
        before = _write_counts(db)
        denied, _, _ = _send(client, secret, pub["id"], method, path, body, idem=f"ip-no-{name}", real_ip="198.51.100.9")
        assert denied.status_code == 403, denied.text
        assert _detail(denied) == "IP adresi bu anahtar için izinli değil"
        _assert_no_extra_writes(before, _write_counts(db))
        allowed, _, _ = _send(client, secret, pub["id"], method, path, body, idem=f"ip-yes-{name}", real_ip="203.0.113.7")
        assert allowed.status_code == 200, f"{name} {allowed.text}"
        raw = allowed.text
        assert _PASSWORD not in raw
        assert _LEAK_PASS not in raw
        assert "password_hash" not in raw


def test_idempotency_and_secrets(db):
    _seed(db)
    lic, lic_secret = _issue(db, [store.SCOPE_ADMIN_LICENSES_WRITE], name="lic")
    client = _client()
    path = "/api/platform/admin-v1/companies"
    body = _company_body("idem@example.com")
    missing, _, _ = _send(client, lic_secret, lic["id"], "POST", path, body, idem=None)
    assert missing.status_code == 400
    assert _detail(missing) == "Idempotency-Key gerekli"
    assert "idem@example.com" not in json.dumps({k: v.docs for k, v in (("u", db.users),)})
    first, _, _ = _send(client, lic_secret, lic["id"], "POST", path, body, idem="idem-co")
    assert first.status_code == 200, first.text
    created = first.json()["item"]["id"]
    companies_after = len(db.companies.docs)
    audits = [row for row in db.platform_audit_log.docs.values() if row.get("action") == "admin_v1.write.company.create"]
    assert len(audits) == 1
    assert audits[0]["target_id"] == created
    assert "admin_password" not in audits[0]["details"]["fields"]
    assert _PASSWORD not in json.dumps(audits[0])
    replay, _, _ = _send(client, lic_secret, lic["id"], "POST", path, body, idem="idem-co")
    assert replay.status_code == 200, replay.text
    assert replay.json()["item"]["id"] == created
    assert len(db.companies.docs) == companies_after
    assert len([row for row in db.platform_audit_log.docs.values() if row.get("action") == "admin_v1.write.company.create"]) == 1
    other = _company_body("baska@example.com")
    clash, _, _ = _send(client, lic_secret, lic["id"], "POST", path, other, idem="idem-co")
    assert clash.status_code == 409
    assert _detail(clash) == "Idempotency-Key farklı istekle kullanıldı"
    stored = json.dumps([row.get("response") for row in db.idempotency_keys.docs.values()], default=str)
    assert _PASSWORD not in stored
    assert _PASSWORD not in first.text


def test_validation_does_not_write(db):
    _seed(db)
    lic, lic_secret = _issue(db, [store.SCOPE_ADMIN_LICENSES_WRITE], name="lic-v")
    integ, integ_secret = _issue(db, [store.SCOPE_ADMIN_INTEGRATORS_WRITE], name="int-v")
    note, note_secret = _issue(db, [store.SCOPE_ADMIN_NOTIFICATIONS_WRITE], name="note-v")
    sup, sup_secret = _issue(db, [store.SCOPE_ADMIN_SUPPORT_WRITE], name="sup-v")
    client = _client()
    cases = [
        (lic, lic_secret, "POST", "/api/platform/admin-v1/companies", {**_company_body(), "evil": 1}, "Desteklenmeyen alan: evil"),
        (lic, lic_secret, "POST", "/api/platform/admin-v1/companies/missing/companies", {"name": "Yok"}, "Şirket bulunamadı."),
        (lic, lic_secret, "PUT", "/api/platform/admin-v1/companies/comp_a/parent", {"parent_company_id": "comp_a"}, "Şirket kendisine bağlanamaz."),
        (integ, integ_secret, "PUT", "/api/platform/admin-v1/companies/comp_a/einvoice", {"provider": "yok"}, "Desteklenmeyen entegratör."),
        (note, note_secret, "PUT", "/api/platform/admin-v1/companies/comp_a/notify-prefs", {"company_id": "comp_b"}, "Desteklenmeyen alan: company_id"),
        (lic, lic_secret, "POST", "/api/platform/admin-v1/companies/comp_a/addons/yok", {"enabled": True}, "Bilinmeyen araç."),
        (lic, lic_secret, "POST", "/api/platform/admin-v1/plans", {"name": "X", "modules": ["/yok"]}, "Bilinmeyen modül."),
        (lic, lic_secret, "PUT", "/api/platform/admin-v1/modules/prices", {"prices": {"/yok": 1}}, "Bilinmeyen modül."),
        (sup, sup_secret, "POST", "/api/platform/admin-v1/support/tickets/stk_a/messages", {"body": "kısa"}, "operator_email zorunlu."),
        (sup, sup_secret, "POST", "/api/platform/admin-v1/support/tickets/missing/status", {"status": "closed", "operator_email": _OPERATOR}, "Destek talebi bulunamadı."),
        (integ, integ_secret, "POST", "/api/platform/admin-v1/integrators/products", {"code": "shop", "name": "Kopya"}, "Bu ürün kodu zaten var"),
    ]
    for key, secret, method, path, body, detail in cases:
        before = _write_counts(db)
        resp, _, _ = _send(client, secret, key["id"], method, path, body, idem=f"bad-{path}-{detail[:12]}")
        assert resp.status_code in (400, 404), resp.text
        assert _detail(resp) == detail, resp.text
        _assert_no_extra_writes(before, _write_counts(db))
        assert not db.idempotency_keys.docs


def test_company_isolation(db):
    _seed(db)
    scopes = [
        store.SCOPE_ADMIN_LICENSES_WRITE,
        store.SCOPE_ADMIN_INTEGRATORS_WRITE,
        store.SCOPE_ADMIN_NOTIFICATIONS_WRITE,
        store.SCOPE_ADMIN_SUPPORT_WRITE,
    ]
    pub, secret = _issue(db, scopes, name="iso")
    client = _client()
    snap_b = _blob(db, "companies", "comp_b")
    snap_b_lic = _blob(db, "company_licenses", "comp_b")
    snap_c = _blob(db, "companies", "comp_c")
    child, _, _ = _send(
        client, secret, pub["id"], "POST", "/api/platform/admin-v1/companies/comp_a/companies",
        {"name": "Alt Ada", "admin_email": "alt@example.com", "admin_password": _PASSWORD},
        idem="iso-child",
    )
    assert child.status_code == 200, child.text
    assert child.json()["item"]["parent_company_id"] == "comp_a"
    assert _blob(db, "companies", "comp_b") == snap_b
    parent, _, _ = _send(
        client, secret, pub["id"], "PUT", "/api/platform/admin-v1/companies/comp_c/parent",
        {"parent_company_id": "comp_b"}, idem="iso-parent",
    )
    assert parent.status_code == 200, parent.text
    assert db.companies.docs["comp_c"]["parent_company_id"] == "comp_b"
    assert _blob(db, "companies", "comp_b") == snap_b
    assert db.companies.docs["comp_a"]["name"] == "Ada Ticaret"
    addon, _, _ = _send(
        client, secret, pub["id"], "POST", "/api/platform/admin-v1/companies/comp_a/addons/ai.advisor",
        {"enabled": False}, idem="iso-addon",
    )
    assert addon.status_code == 200, addon.text
    assert _blob(db, "company_licenses", "comp_b") == snap_b_lic
    assert db.company_licenses.docs["comp_a"]["addon_overrides"]["ai.advisor"] is False
    invoice, _, _ = _send(
        client, secret, pub["id"], "PUT", "/api/platform/admin-v1/companies/comp_a/einvoice",
        {"provider": "isnet"}, idem="iso-ei",
    )
    assert invoice.status_code == 200, invoice.text
    item = invoice.json()["item"]
    assert item["provider"] == "isnet"
    assert "username" not in item
    assert _LEAK_USER not in invoice.text
    assert _LEAK_PASS not in invoice.text
    assert "password_enc" not in invoice.text
    assert db.einvoice_settings.docs.get("ei_b") is None
    prefs, _, _ = _send(
        client, secret, pub["id"], "PUT", "/api/platform/admin-v1/companies/comp_a/notify-prefs",
        {"extra_emails": [_MAIL_A]}, idem="iso-prefs",
    )
    assert prefs.status_code == 200, prefs.text
    assert _MAIL_A in prefs.json()["item"]["extra_emails"]
    assert not any(row.get("company_id") == "comp_b" for row in db.company_notify_prefs.docs.values())
    reply, _, _ = _send(
        client, secret, pub["id"], "POST", "/api/platform/admin-v1/support/tickets/stk_a/messages",
        {"body": "Yanıt metni burada", "operator_email": _OPERATOR}, idem="iso-reply",
    )
    assert reply.status_code == 200, reply.text
    assert db.support_tickets.docs["stk_b"]["status"] == "open"
    notes = [row for row in db.notifications.docs.values() if row.get("company_id") == "comp_b"]
    assert notes == []
    assert any(row.get("company_id") == "comp_a" for row in db.notifications.docs.values())
    assert _blob(db, "companies", "comp_c") != snap_c
    assert _PASSWORD not in reply.text
    for row in _write_audits(db):
        assert _PASSWORD not in json.dumps(row, default=str)


def test_reads_scope_ip_mask_and_isolation(db):
    _seed(db)
    _plant_key(db, key_id="pk_product_r", secret="product-secret", kind="product", scopes=[store.SCOPE_ADMIN_NOTIFICATIONS_READ])
    _plant_key(
        db, key_id="pk_bound_r", secret="bound-secret", kind="platform_admin",
        scopes=[store.SCOPE_ADMIN_NOTIFICATIONS_READ], instance_id="comp_bound",
    )
    reader, reader_secret = _issue(db, [store.SCOPE_ADMIN_NOTIFICATIONS_READ], name="nread")
    writer, writer_secret = _issue(db, [store.SCOPE_ADMIN_NOTIFICATIONS_WRITE], name="nwrite")
    other, other_secret = _issue(db, [store.SCOPE_ADMIN_LICENSES_READ], name="lread")
    locked, locked_secret = _issue(db, [store.SCOPE_ADMIN_NOTIFICATIONS_READ], ip_allowlist=["203.0.113.7"], name="nip")
    client = _client()
    prefs = "/api/platform/admin-v1/companies/comp_a/notify-prefs"
    log = "/api/platform/admin-v1/companies/comp_a/notify-mail-log"
    for path in (prefs, log):
        before = _write_counts(db)
        missing = client.get(path)
        assert missing.status_code == 401
        assert _detail(missing) == "Eksik imza başlıkları"
        headers, _, _ = _signed_headers(reader_secret, reader["id"], "GET", path, b"")
        headers["X-Platform-Signature"] = "ab" * 32
        bad = client.get(path, headers=headers)
        assert bad.status_code == 401
        assert _detail(bad) == "İmza doğrulanamadı"
        first, signed, _ = _get(client, reader_secret, reader["id"], path)
        assert first.status_code == 200, first.text
        replay = client.get(path, headers=signed)
        assert replay.status_code == 401
        assert _detail(replay) == "Tekrarlanan nonce"
        denied_scope, _, _ = _get(client, writer_secret, writer["id"], path)
        assert denied_scope.status_code == 403
        assert _detail(denied_scope) == "Kapsam yetersiz"
        wrong, _, _ = _get(client, other_secret, other["id"], path)
        assert wrong.status_code == 403
        kind, _, _ = _get(client, "product-secret", "pk_product_r", path)
        assert kind.status_code == 403
        bound, _, _ = _get(client, "bound-secret", "pk_bound_r", path)
        assert bound.status_code == 403
        ip_no, _, _ = _get(client, locked_secret, locked["id"], path, real_ip="198.51.100.9")
        assert ip_no.status_code == 403
        assert _detail(ip_no) == "IP adresi bu anahtar için izinli değil"
        ip_yes, _, _ = _get(client, locked_secret, locked["id"], path, real_ip="203.0.113.7")
        assert ip_yes.status_code == 200, ip_yes.text
        _assert_no_extra_writes(before, _write_counts(db))
        assert not db.idempotency_keys.docs
    missing_co, _, _ = _get(client, reader_secret, reader["id"], "/api/platform/admin-v1/companies/missing/notify-prefs")
    assert missing_co.status_code == 404
    body = _get(client, reader_secret, reader["id"], log)[0].json()
    raw = json.dumps(body)
    assert _MAIL_A not in raw
    assert _MAIL_B not in raw
    assert _PHONE_A not in raw
    assert "ad•••@example.com" in raw
    assert "•••2233" in raw
    assert body["sent"]
    assert all("beta" not in json.dumps(row) for row in body["sent"])
    prefs_body = _get(client, reader_secret, reader["id"], prefs)[0].json()["item"]
    assert "extra_emails" in prefs_body
    found = []
    _walk_keys(body, found)
    for key in found:
        assert "password" not in key
        assert "secret" not in key


def test_danger_auth_ip_and_idempotency(db):
    _seed(db)
    _plant_key(db, key_id="pk_product_d", secret="product-secret", kind="product", scopes=[store.SCOPE_ADMIN_DANGEROUS])
    _plant_key(
        db, key_id="pk_bound_d", secret="bound-secret", kind="platform_admin",
        scopes=[store.SCOPE_ADMIN_DANGEROUS], instance_id="comp_bound",
    )
    danger_key, danger_secret = _issue(db, [store.SCOPE_ADMIN_DANGEROUS], name="danger")
    other, other_secret = _issue(db, [store.SCOPE_ADMIN_LICENSES_WRITE], name="no-danger")
    locked, locked_secret = _issue(db, [store.SCOPE_ADMIN_DANGEROUS], ip_allowlist=["203.0.113.7"], name="dip")
    client = _client()
    for name, method, path, body in _danger_cases():
        before = _write_counts(db)
        missing = client.request(method, path, content=b"{}")
        assert missing.status_code == 401, name
        headers, _, _ = _signed_headers(danger_secret, danger_key["id"], method, path, b"{}")
        headers["X-Platform-Signature"] = "cd" * 32
        bad = client.request(method, path, content=b"{}", headers=headers)
        assert bad.status_code == 401, name
        first, signed, _ = _send(client, danger_secret, danger_key["id"], method, path, raw=b"{}", idem=f"d-replay-{name}")
        assert first.status_code == 400, first.text
        again = client.request(method, path, content=b"{}", headers=signed)
        assert again.status_code == 401
        assert _detail(again) == "Tekrarlanan nonce"
        wrong, _, _ = _send(client, other_secret, other["id"], method, path, body, idem=f"d-scope-{name}")
        assert wrong.status_code == 403
        assert _detail(wrong) == "Kapsam yetersiz"
        kind, _, _ = _send(client, "product-secret", "pk_product_d", method, path, body, idem=f"d-kind-{name}")
        assert kind.status_code == 403
        bound, _, _ = _send(client, "bound-secret", "pk_bound_d", method, path, body, idem=f"d-bound-{name}")
        assert bound.status_code == 403
        _assert_no_extra_writes(before, _write_counts(db))
        no_key, _, _ = _send(client, danger_secret, danger_key["id"], method, path, body, idem=None)
        assert no_key.status_code == 400
        assert _detail(no_key) == "Idempotency-Key gerekli"
        ip_no, _, _ = _send(client, locked_secret, locked["id"], method, path, body, idem=f"d-ip-no-{name}", real_ip="198.51.100.9")
        assert ip_no.status_code == 403
        assert _detail(ip_no) == "IP adresi bu anahtar için izinli değil"
        assert "plan_spare" in db.saas_plans.docs
        assert "pp_shop" in db.platform_products.docs
        prepared, _, _ = _send(client, danger_secret, danger_key["id"], method, path, body, idem=f"d-prep-{name}")
        assert prepared.status_code == 200, prepared.text
        token = prepared.json()["confirmation_token"]
        replay, _, _ = _send(client, danger_secret, danger_key["id"], method, path, body, idem=f"d-prep-{name}")
        assert replay.status_code == 200, replay.text
        assert replay.json()["confirmation_token"] == token
        clash, _, _ = _send(
            client, danger_secret, danger_key["id"], method, path,
            {**body, "reason": _REASON + " farkli"}, idem=f"d-prep-{name}",
        )
        assert clash.status_code == 409
        assert _detail(clash) == "Idempotency-Key farklı istekle kullanıldı"


def _confirm(client, secret, key_id, action, prepared, text, *, idem, otp=None):
    payload = {
        "confirmation_token": prepared["confirmation_token"],
        "confirm_text": text,
        "operator_otp": otp or _otp(),
    }
    return _send(
        client, secret, key_id, "POST",
        f"/api/platform/admin-v1/danger/{action}/confirm",
        payload, idem=idem,
    )


def test_plan_and_product_delete_two_step(db):
    _seed(db)
    pub, secret = _issue(db, [store.SCOPE_ADMIN_DANGEROUS], name="del")
    client = _client()
    companies = set(db.companies.docs)
    in_use, _, _ = _send(
        client, secret, pub["id"], "POST", "/api/platform/admin-v1/danger/plan.delete/prepare",
        {"target_id": "plan_pro", "reason": _REASON, "operator_email": _OPERATOR}, idem="p-inuse",
    )
    assert in_use.status_code == 400, in_use.text
    assert "şirket" in _detail(in_use)
    custom, _, _ = _send(
        client, secret, pub["id"], "POST", "/api/platform/admin-v1/danger/plan.delete/prepare",
        {"target_id": "plan_custom", "reason": _REASON, "operator_email": _OPERATOR}, idem="p-custom",
    )
    assert custom.status_code == 400
    assert _detail(custom) == "Özel paket silinemez."
    missing, _, _ = _send(
        client, secret, pub["id"], "POST", "/api/platform/admin-v1/danger/plan.delete/prepare",
        {"target_id": "plan_yok", "reason": _REASON, "operator_email": _OPERATOR}, idem="p-miss",
    )
    assert missing.status_code == 404
    assert _detail(missing) == "Paket bulunamadı."
    tam, _, _ = _send(
        client, secret, pub["id"], "POST", "/api/platform/admin-v1/danger/product.delete/prepare",
        {"target_id": "tamkobi", "reason": _REASON, "operator_email": _OPERATOR}, idem="p-tam",
    )
    assert tam.status_code == 400
    assert _detail(tam) == "tamkobi ürünü silinemez"
    assert not db.platform_danger_confirmations.docs
    prepared, _, _ = _send(
        client, secret, pub["id"], "POST", "/api/platform/admin-v1/danger/plan.delete/prepare",
        {"target_id": "plan_spare", "reason": _REASON, "operator_email": _OPERATOR}, idem="p-ok",
    )
    assert prepared.status_code == 200, prepared.text
    body = prepared.json()
    assert body["confirm_text_hint"] == "paket adını birebir yazın"
    assert body["confirm_phrase"] is None
    assert body["target_label"] == "Yedek Paket"
    wrong, _, _ = _confirm(client, secret, pub["id"], "plan.delete", body, "yedek paket", idem="p-case")
    assert wrong.status_code == 400
    assert _detail(wrong) == "Onay için paket adını birebir yazın."
    assert "plan_spare" in db.saas_plans.docs
    bad_otp, _, _ = _confirm(client, secret, pub["id"], "plan.delete", body, "Yedek Paket", idem="p-otp", otp=_bad_otp())
    assert bad_otp.status_code == 403
    assert "plan_spare" in db.saas_plans.docs
    assert db.platform_danger_confirmations.docs[list(db.platform_danger_confirmations.docs)[0]].get("used_at") is None
    ok, _, _ = _confirm(client, secret, pub["id"], "plan.delete", body, "Yedek Paket", idem="p-yes")
    assert ok.status_code == 200, ok.text
    assert ok.json()["item"]["status"] == "success"
    assert "plan_spare" not in db.saas_plans.docs
    assert "plan_pro" in db.saas_plans.docs
    assert set(db.companies.docs) == companies
    deletes = db.saas_plans.deletes
    replay, _, _ = _confirm(client, secret, pub["id"], "plan.delete", body, "Yedek Paket", idem="p-yes")
    assert replay.status_code == 200, replay.text
    assert db.saas_plans.deletes == deletes
    confirms = [row for row in db.platform_audit_log.docs.values() if row.get("action") == "admin_v1.danger.plan.delete.confirm"]
    assert len(confirms) == 1
    assert confirms[0]["target_type"] == "plan"
    db.users.docs["usr_ops"]["totp_last_counter"] = None
    shop, _, _ = _send(
        client, secret, pub["id"], "POST", "/api/platform/admin-v1/danger/product.delete/prepare",
        {"target_id": "pp_shop", "reason": _REASON, "operator_email": _OPERATOR}, idem="prod-ok",
    )
    assert shop.status_code == 200, shop.text
    shop_body = shop.json()
    assert shop_body["confirm_text_hint"] == "ürün adını birebir yazın"
    mismatch, _, _ = _confirm(client, secret, pub["id"], "product.delete", shop_body, "shop extra", idem="prod-case")
    assert mismatch.status_code == 400
    assert "pp_shop" in db.platform_products.docs
    gone, _, _ = _confirm(client, secret, pub["id"], "product.delete", shop_body, "Shop Extra", idem="prod-yes")
    assert gone.status_code == 200, gone.text
    assert gone.json()["item"]["code"] == "shop"
    assert "pp_shop" not in db.platform_products.docs
    assert any(row.get("code") == "tamkobi" for row in db.platform_products.docs.values())
    assert set(db.companies.docs) == companies
    prod_audits = [row for row in db.platform_audit_log.docs.values() if row.get("action") == "admin_v1.danger.product.delete.confirm"]
    assert len(prod_audits) == 1
    assert prod_audits[0]["target_type"] == "product"
    assert _PASSWORD not in gone.text
