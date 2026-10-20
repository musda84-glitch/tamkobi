"""admin-v1 tehlikeli işlemler (A5b). TestClient + bellek FakeDB. Canlı DB / port yok."""
from __future__ import annotations

import asyncio
import hashlib
import importlib.util
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pyotp
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import applog
import company_reset
import mail_service
import platform_admin_v1_danger as danger
import platform_admin_v1_write
import platform_store as store
import rbac
import saas
import superadmin_2fa
import test_platform_admin_v1 as admin_tests
import user_erase
from auth_utils import hash_password
from test_platform_admin_v1 import (
    FakeColl,
    FakeDB,
    _detail,
    _issue,
    _plant_key,
    _signed_headers,
    with_peer,
)
from test_platform_admin_v1_danger import _send

_OPS = admin_tests._OPS
_REASON = "Musteri kaydini guvenli sekilde temizlemek icin"
_OPERATOR = "ops@example.com"
_OTHER_SA = "other-sa@example.com"
_TOTP = pyotp.random_base32()
_ADMIN_ALLOW_REASON = (
    "Platform yönetim API'si; HMAC platform_admin anahtarı "
    "(kind=platform_admin, admin.* kapsamı), şirket oturumu yok"
)


def _match(doc, q) -> bool:
    if not q:
        return True
    if not isinstance(q, dict):
        return False
    for key, expected in q.items():
        if key == "$or":
            if not any(_match(doc, clause) for clause in expected):
                return False
            continue
        if key == "$and":
            if not all(_match(doc, clause) for clause in expected):
                return False
            continue
        if isinstance(expected, dict) and "$regex" in expected:
            cur = doc.get(key)
            if cur is None or re.search(str(expected["$regex"]), str(cur)) is None:
                return False
            continue
        if isinstance(expected, dict) and any(op in expected for op in _OPS):
            cur = doc.get(key)
            if "$in" in expected:
                if isinstance(cur, list):
                    if not any(item in expected["$in"] for item in cur):
                        return False
                elif cur not in expected["$in"]:
                    return False
            if "$ne" in expected and cur == expected["$ne"]:
                return False
            if "$lt" in expected and (cur is None or not cur < expected["$lt"]):
                return False
            if "$lte" in expected and (cur is None or not cur <= expected["$lte"]):
                return False
            if "$gt" in expected and (cur is None or not cur > expected["$gt"]):
                return False
            if "$gte" in expected and (cur is None or not cur >= expected["$gte"]):
                return False
            continue
        cur = doc.get(key)
        if isinstance(cur, list) and not isinstance(expected, list):
            if expected not in cur:
                return False
        elif cur != expected:
            return False
    return True


async def _update_one(self, q, upd, upsert=False):
    self.updates += 1
    doc = await self.find_one(q)
    if not doc and upsert:
        doc = {}
        if isinstance(q, dict):
            for key, value in q.items():
                if not str(key).startswith("$") and not isinstance(value, dict):
                    doc[key] = value
        if upd and "$setOnInsert" in upd:
            doc.update(upd["$setOnInsert"])
        if not doc.get("_id"):
            doc["_id"] = f"gen_{len(self.docs) + 1}"
        self.docs[doc["_id"]] = doc
    if not doc:
        return SimpleNamespace(matched_count=0, modified_count=0)
    if upd and "$set" in upd:
        doc.update(upd["$set"])
    if upd and "$inc" in upd:
        for key, value in upd["$inc"].items():
            doc[key] = int(doc.get(key) or 0) + int(value)
    if upd and "$unset" in upd:
        for key in upd["$unset"]:
            doc.pop(key, None)
    self.docs[doc["_id"]] = doc
    return SimpleNamespace(matched_count=1, modified_count=1)


async def _update_many(self, q=None, upd=None, **_kwargs):
    rows = [doc for doc in list(self.docs.values()) if _match(doc, q or {})]
    for doc in rows:
        if upd and "$set" in upd:
            doc.update(upd["$set"])
        if upd and "$unset" in upd:
            for key in upd["$unset"]:
                doc.pop(key, None)
        self.docs[doc["_id"]] = doc
    if rows:
        self.updates += 1
    return SimpleNamespace(matched_count=len(rows), modified_count=len(rows))


async def _delete_many(self, q=None):
    rows = [doc for doc in list(self.docs.values()) if _match(doc, q or {})]
    for doc in rows:
        self.docs.pop(doc.get("_id"), None)
    self.deletes += 1
    return SimpleNamespace(deleted_count=len(rows))


async def _create_index(self, *_args, **_kwargs):
    return "idx"


def _app():
    app = FastAPI()
    app.include_router(danger.router)
    app.include_router(platform_admin_v1_write.router)
    app.include_router(company_reset.router)
    app.include_router(user_erase.router)
    app.include_router(saas.router)
    app.dependency_overrides[saas.require_super_admin] = lambda: {
        "id": "sa_sys",
        "_id": "sa_sys",
        "email": "sys@example.com",
        "name": "Sistem",
        "is_super_admin": True,
    }
    return app


def _client() -> TestClient:
    return TestClient(with_peer(_app(), "203.0.113.10"), base_url="http://127.0.0.1:1")


@pytest.fixture
def mail_calls():
    return {"n": 0}


@pytest.fixture
def db(monkeypatch, mail_calls):
    monkeypatch.setenv("LOG_DB_PERSIST", "0")
    applog.setup_logging()
    logging.getLogger("tamkobi.app").propagate = True
    monkeypatch.setattr(admin_tests, "_match", _match)
    monkeypatch.setattr(FakeColl, "update_one", _update_one)
    monkeypatch.setattr(FakeColl, "update_many", _update_many, raising=False)
    monkeypatch.setattr(FakeColl, "delete_many", _delete_many, raising=False)
    monkeypatch.setattr(FakeColl, "create_index", _create_index, raising=False)
    monkeypatch.setattr(FakeDB, "__getitem__", lambda self, name: getattr(self, name), raising=False)

    async def _noop(*_args, **_kwargs):
        return None

    monkeypatch.setattr(rbac, "ensure_roles", _noop)

    async def _sent(*_args, **_kwargs):
        mail_calls["n"] += 1
        return {"status": "sent"}

    monkeypatch.setattr(mail_service, "send_mail", _sent)
    import comm_service
    monkeypatch.setattr(comm_service, "encrypt", lambda value: "enc:" + (value or ""))
    monkeypatch.setattr(comm_service, "decrypt", lambda value: (value or "").removeprefix("enc:"))
    monkeypatch.setattr(superadmin_2fa, "encrypt", lambda value: "enc:" + (value or ""))
    monkeypatch.setattr(superadmin_2fa, "decrypt", lambda value: (value or "").removeprefix("enc:"))

    fake = FakeDB()

    async def list_collection_names():
        static = [
            "platform_products", "platform_instances", "platform_api_keys",
            "platform_audit_log", "platform_nonces", "platform_rate",
            "companies", "company_licenses", "saas_plans", "platform_settings",
        ]
        return list(dict.fromkeys(static + list(fake._extra.keys())))

    fake.list_collection_names = list_collection_names
    prev = (store._db, saas._db, saas._current_user, company_reset._db, user_erase._db)
    store.init(fake)
    saas.init(fake, None)
    saas.invalidate()
    company_reset.init(fake)
    user_erase.init(fake)
    yield fake
    store.init(prev[0])
    saas.init(prev[1], prev[2])
    company_reset._db = prev[3]
    user_erase._db = prev[4]
    saas.invalidate()


def _otp() -> str:
    return pyotp.TOTP(_TOTP).now()


def _fresh_counter(db):
    db.users.docs["usr_ops"]["totp_last_counter"] = None


def _bad_otp() -> str:
    current = _otp()
    for candidate in ("000000", "111111", "222222", "333333", "444444"):
        if candidate != current:
            return candidate
    return "555555"


def _seed(db, *, with_invoice=True):
    async def run():
        await db.companies.insert_one({
            "_id": "comp_a",
            "name": "Ada Ticaret",
            "email": "ada@example.com",
            "license_id": "comp_a",
            "created_at": "2026-01-01T00:00:00+00:00",
        })
        await db.company_licenses.insert_one({"_id": "comp_a", "plan_id": "plan_pro", "status": "active"})
        await db.users.insert_one({
            "_id": "usr_ada",
            "name": "Ada",
            "email": "ada@example.com",
            "role": "admin",
            "company_ids": ["comp_a"],
            "active_company_id": "comp_a",
            "is_super_admin": False,
            "is_active": True,
            "password_hash": "hash-ada",
        })
        await db.users.insert_one({
            "_id": "usr_ada2",
            "name": "Ada 2",
            "email": "ada2@example.com",
            "role": "admin",
            "company_ids": ["comp_a"],
            "active_company_id": "comp_a",
            "is_super_admin": False,
            "is_active": True,
            "password_hash": "hash-ada2",
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
        await db.users.insert_one({
            "_id": "usr_other",
            "name": "Diğer Yönetici",
            "email": _OTHER_SA,
            "role": "admin",
            "company_ids": [],
            "is_super_admin": True,
            "is_active": True,
            "totp_enabled": True,
            "totp_secret": "enc:OTHERSECRET",
            "totp_last_counter": 3,
            "pending_2fa_jti": "pending",
            "totp_enabled_at": "2026-01-01T00:00:00+00:00",
        })
        await db.login_attempts.insert_one({"_id": "lock_other", "identifier": "2fa:usr_other", "count": 2})
        await db.users.insert_one({
            "_id": "sa_sys",
            "name": "Sistem",
            "email": "sys@example.com",
            "role": "admin",
            "company_ids": [],
            "is_super_admin": True,
            "is_active": True,
            "password_hash": hash_password("correct-pass"),
        })
        if with_invoice:
            await db.invoices.insert_one({"_id": "inv_1", "company_id": "comp_a", "total": 10})
        await db.support_tickets.insert_one({
            "_id": "t_1",
            "company_id": "comp_a",
            "created_by_id": "usr_ada",
            "created_by_name": "Ada",
            "created_by_email": "ada@example.com",
        })

    asyncio.run(run())


def _body(**extra):
    payload = {"target_id": "comp_a", "reason": _REASON, "operator_email": _OPERATOR}
    payload.update(extra)
    return payload


def _prepare(client, secret, key_id, action, payload, idem="prep-1"):
    return _send(
        client, secret, key_id, "POST",
        f"/api/platform/admin-v1/danger/{action}/prepare",
        payload, idem=idem,
    )


def _confirm(client, secret, key_id, action, payload, idem="conf-1"):
    return _send(
        client, secret, key_id, "POST",
        f"/api/platform/admin-v1/danger/{action}/confirm",
        payload, idem=idem,
    )


def _confirm_body(prepared, *, text, phrase=None, otp=None):
    body = prepared.json()
    payload = {
        "confirmation_token": body["confirmation_token"],
        "confirm_text": text,
        "operator_otp": otp or _otp(),
    }
    if phrase is not None:
        payload["confirm_phrase"] = phrase
    return payload


def _danger_audits(db, suffix):
    return [
        row for row in db.platform_audit_log.docs.values()
        if str(row.get("action") or "").endswith(suffix)
    ]


def _conf_docs(db):
    return list(db.platform_danger_confirmations.docs.values())


def _key(db, scopes=None, name="danger"):
    return _issue(db, scopes or [store.SCOPE_ADMIN_DANGEROUS], name=name)


def test_allowlist_and_scope():
    pairs = (
        ("POST", "/platform/admin-v1/danger/{action}/prepare"),
        ("POST", "/platform/admin-v1/danger/{action}/confirm"),
    )
    import tenant_idor_allowlist as allowlist
    for pair in pairs:
        assert pair in allowlist.TENANT_IDOR_ALLOWLIST
        assert allowlist.ALLOWLIST_REASONS[pair] == _ADMIN_ALLOW_REASON
    assert store.SCOPE_ADMIN_DANGEROUS == "admin.dangerous"
    assert store.SCOPE_ADMIN_DANGEROUS in store.ADMIN_SCOPES
    covered = [
        scope for scope in store.ADMIN_SCOPES
        if scope.endswith((":read", ":write")) or scope == store.SCOPE_ADMIN_IMPERSONATE
    ]
    assert store.SCOPE_ADMIN_DANGEROUS not in covered


def test_auth_matrix_does_not_write(db):
    _seed(db)
    others = [scope for scope in store.ADMIN_SCOPES if scope != store.SCOPE_ADMIN_DANGEROUS]
    _plant_key(db, key_id="pk_product_d", secret="product-secret", kind="product", scopes=[store.SCOPE_ADMIN_DANGEROUS])
    _plant_key(
        db, key_id="pk_bound_d", secret="bound-secret", kind="platform_admin",
        scopes=[store.SCOPE_ADMIN_DANGEROUS], instance_id="comp_bound",
    )
    wide, wide_secret = _issue(db, others, name="wide")
    imp, imp_secret = _issue(db, [store.SCOPE_ADMIN_IMPERSONATE], name="imp-only")
    ok_pub, ok_secret = _key(db)
    client = _client()
    paths = (
        ("/api/platform/admin-v1/danger/company.delete/prepare", _body()),
        ("/api/platform/admin-v1/danger/company.delete/confirm", {
            "confirmation_token": "x", "confirm_text": "Ada Ticaret", "operator_otp": "000000",
        }),
    )
    for path, payload in paths:
        raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        before = _conf_docs(db), db.users.updates, db.idempotency_keys.inserts, len(db.invoices.docs)

        missing = client.post(path, content=raw)
        assert missing.status_code == 401
        assert _detail(missing) == "Eksik imza başlıkları"

        headers, _, _ = _signed_headers(ok_secret, ok_pub["id"], "POST", path, raw)
        headers["X-Platform-Signature"] = "ab" * 32
        bad = client.post(path, content=raw, headers=headers)
        assert bad.status_code == 401
        assert _detail(bad) == "İmza doğrulanamadı"

        first, replay_headers, _ = _send(
            client, ok_secret, ok_pub["id"], "POST", path, raw=b"{}", idem=f"nonce-{path}",
        )
        assert first.status_code == 400
        again = client.post(path, content=b"{}", headers=replay_headers)
        assert again.status_code == 401
        assert _detail(again) == "Tekrarlanan nonce"

        for secret, pub in (
            (wide_secret, wide),
            (imp_secret, imp),
            ("product-secret", {"id": "pk_product_d"}),
            ("bound-secret", {"id": "pk_bound_d"}),
        ):
            denied, _, _ = _send(client, secret, pub["id"], "POST", path, payload, idem=f"deny-{pub['id']}-{path}")
            assert denied.status_code == 403, denied.text
            assert _detail(denied) == "Kapsam yetersiz"
        assert (_conf_docs(db), db.users.updates, db.idempotency_keys.inserts, len(db.invoices.docs)) == before


def test_ip_allowlist_does_not_write(db):
    _seed(db)
    pub, secret = _issue(db, [store.SCOPE_ADMIN_DANGEROUS], ip_allowlist=["203.0.113.7"], name="ip")
    client = _client()
    before = len(_conf_docs(db)), db.idempotency_keys.inserts
    denied, _, _ = _send(
        client, secret, pub["id"], "POST",
        "/api/platform/admin-v1/danger/company.delete/prepare",
        _body(), idem="ip-no", real_ip="198.51.100.9",
    )
    assert denied.status_code == 403
    assert _detail(denied) == "IP adresi bu anahtar için izinli değil"
    assert (len(_conf_docs(db)), db.idempotency_keys.inserts) == before


def test_prepare_validation_does_not_write(db, monkeypatch):
    _seed(db)
    pub, secret = _key(db)
    client = _client()
    cases = [
        ("company.delete", {}, 400, "reason zorunlu."),
        ("company.delete", {"reason": _REASON}, 400, "operator_email zorunlu."),
        ("company.delete", {"reason": _REASON, "operator_email": "yok@example.com", "target_id": "comp_a"}, 403, "Operatör yetkili değil."),
        ("company.delete", _body(note="x"), 400, "Desteklenmeyen alan: note"),
        ("no.such", _body(), 404, "İşlem bulunamadı."),
        ("company.delete", _body(target_id="missing"), 404, "Şirket bulunamadı."),
        ("company.reset_data", _body(target_id="comp_nexus_main_01"), 404, "Şirket bulunamadı."),
        ("company.delete", _body(admin_password="secret"), 400, "Desteklenmeyen alan: admin_password"),
        ("user.erase", _body(target_id="missing-user"), 404, "Kullanıcı bulunamadı."),
        ("superadmin.2fa_reset", _body(target_id="usr_ada"), 404, "Panel yöneticisi bulunamadı."),
        ("superadmin.2fa_reset", _body(target_id="usr_ops"), 400, "Kendi 2FA'nızı bu yolla sıfırlayamazsınız."),
        ("user.password_reset", _body(user_id=12), 400, "user_id metin olmalı."),
    ]
    for index, (action, payload, status, detail) in enumerate(cases):
        before = (len(_conf_docs(db)), len(db.invoices.docs), db.users.updates, db.notify_outbox.inserts)
        response, _, _ = _prepare(client, secret, pub["id"], action, payload, idem=f"val-{action}-{status}-{index}")
        assert response.status_code == status, response.text
        assert _detail(response) == detail
        assert (len(_conf_docs(db)), len(db.invoices.docs), db.users.updates, db.notify_outbox.inserts) == before

    async def _protected_company():
        await db.companies.insert_one({"_id": "comp_nexus_main_01", "name": "Nexus", "license_id": "comp_nexus_main_01"})

    asyncio.run(_protected_company())
    for action in ("company.delete", "company.reset_data"):
        response, _, _ = _prepare(
            client, secret, pub["id"], action, _body(target_id="comp_nexus_main_01"), idem=f"prot-{action}",
        )
        assert response.status_code == 400, response.text
        assert _detail(response) == "Platform demo şirketleri silinemez."
        assert db.companies.docs.get("comp_nexus_main_01")

    async def _sender():
        await db.platform_settings.insert_one({"_id": "platform", "sender_company_id": "comp_a"})

    asyncio.run(_sender())
    response, _, _ = _prepare(client, secret, pub["id"], "company.delete", _body(), idem="sender")
    assert response.status_code == 400
    assert _detail(response) == "Platform gönderici şirketi silinemez. Önce ayarlardan başka bir gönderici seçin."
    assert "inv_1" in db.invoices.docs

    monkeypatch.setattr(saas, "PROTECTED_USER_EMAILS", frozenset({"ada@example.com"}))
    response, _, _ = _prepare(client, secret, pub["id"], "user.erase", _body(target_id="usr_ada"), idem="prot-user")
    assert response.status_code == 400
    assert _detail(response) == "Korumalı hesap silinemez."
    assert "usr_ada" in db.users.docs

    async def _solo():
        await db.companies.insert_one({"_id": "comp_solo", "name": "Tek", "license_id": "comp_solo"})
        await db.users.insert_one({
            "_id": "usr_solo", "email": "solo@example.com", "role": "admin",
            "company_ids": ["comp_solo"], "is_super_admin": False, "is_active": True,
        })

    asyncio.run(_solo())
    response, _, _ = _prepare(client, secret, pub["id"], "user.erase", _body(target_id="usr_solo"), idem="last-admin")
    assert response.status_code == 400, response.text
    assert "son yöneticisi" in _detail(response)
    assert "usr_solo" in db.users.docs
    assert db.notify_outbox.inserts == 0
    assert db.password_resets.inserts == 0


def test_prepare_success_stores_only_hash_and_replays_token(db, mail_calls):
    _seed(db)
    pub, secret = _key(db)
    client = _client()
    specs = (
        ("company.reset_data", _body(scopes=["invoices"]), "Ada Ticaret", "VERİLERİ SIFIRLA", "şirket adını birebir yazın"),
        ("company.delete", _body(), "Ada Ticaret", None, "şirket adını birebir yazın"),
        ("user.erase", _body(target_id="usr_ada"), "ada@example.com", "VERİLERİ SİL", "kullanıcı e-postasını birebir yazın"),
        ("user.password_reset", _body(user_id="usr_ada"), "ada@example.com", None, "kullanıcı e-postasını birebir yazın"),
        ("superadmin.2fa_reset", _body(target_id="usr_other"), _OTHER_SA, None, "kullanıcı e-postasını birebir yazın"),
    )
    for action, payload, label, phrase, hint in specs:
        response, _, _ = _prepare(client, secret, pub["id"], action, payload, idem=f"ok-{action}")
        assert response.status_code == 200, response.text
        body = response.json()
        token = body["confirmation_token"]
        digest = hashlib.sha256(token.encode("utf-8")).hexdigest()
        assert body["target_label"] == label
        assert body["confirm_phrase"] == phrase
        assert body["confirm_text_hint"] == hint
        assert body["action"] == action
        doc = db.platform_danger_confirmations.docs[digest]
        assert token not in json.dumps(doc)
        assert doc["used_at"] is None
        assert doc["operator_email"] == _OPERATOR
        again, _, _ = _prepare(client, secret, pub["id"], action, payload, idem=f"ok-{action}")
        assert again.status_code == 200
        assert again.json()["confirmation_token"] == token
        assert sum(1 for row in _conf_docs(db) if row["action"] == action) == 1
    assert "inv_1" in db.invoices.docs
    assert db.users.docs["usr_other"]["totp_secret"] == "enc:OTHERSECRET"
    assert db.users.docs["usr_ada"]["email"] == "ada@example.com"
    assert mail_calls["n"] == 0
    assert db.notify_outbox.inserts == 0
    assert db.password_resets.inserts == 0
    reset_body = _prepare(client, secret, pub["id"], "company.reset_data", _body(), idem="all-scope").__getitem__(0).json()
    assert reset_body["preview"]["scopes"] == ["all"]


def test_confirm_each_action(db, mail_calls):
    _seed(db)
    pub, secret = _key(db)
    client = _client()

    _fresh_counter(db)
    prepared, _, _ = _prepare(client, secret, pub["id"], "company.reset_data", _body(), idem="p-reset")
    assert prepared.status_code == 200, prepared.text
    response, _, _ = _confirm(
        client, secret, pub["id"], "company.reset_data",
        _confirm_body(prepared, text="Ada Ticaret", phrase="VERİLERİ SIFIRLA"),
        idem="c-reset",
    )
    assert response.status_code == 200, response.text
    item = response.json()["item"]
    assert item["status"] == "success"
    assert "inv_1" not in db.invoices.docs
    assert "usr_ada" in db.users.docs
    assert "comp_a" in db.company_licenses.docs
    assert db.companies.docs["comp_a"]["name"] == "Ada Ticaret"
    assert any(row.get("via") == "api" and row.get("operator_email") == _OPERATOR for row in db.activity_logs.docs.values())

    async def _put_invoice():
        await db.invoices.insert_one({"_id": "inv_2", "company_id": "comp_a", "total": 3})

    asyncio.run(_put_invoice())
    _fresh_counter(db)
    prepared, _, _ = _prepare(client, secret, pub["id"], "company.delete", _body(), idem="p-del")
    response, _, _ = _confirm(
        client, secret, pub["id"], "company.delete",
        _confirm_body(prepared, text="Ada Ticaret"),
        idem="c-del",
    )
    assert response.status_code == 200, response.text
    assert "comp_a" not in db.companies.docs
    assert "inv_2" not in db.invoices.docs
    assert "comp_a" not in db.company_licenses.docs

    async def _company_again():
        await db.companies.insert_one({
            "_id": "comp_b", "name": "Bora", "email": "bora@example.com", "license_id": "comp_b",
        })
        await db.users.insert_one({
            "_id": "usr_bora", "email": "bora@example.com", "name": "Bora", "role": "admin",
            "company_ids": ["comp_b"], "active_company_id": "comp_b",
            "is_super_admin": False, "is_active": True, "password_hash": "x",
        })
        await db.users.insert_one({
            "_id": "usr_bora2", "email": "bora2@example.com", "role": "admin",
            "company_ids": ["comp_b"], "is_super_admin": False, "is_active": True, "password_hash": "x",
        })
        await db.support_tickets.insert_one({
            "_id": "t_b", "created_by_id": "usr_bora", "created_by_name": "Bora", "created_by_email": "bora@example.com",
        })

    asyncio.run(_company_again())
    _fresh_counter(db)
    prepared, _, _ = _prepare(
        client, secret, pub["id"], "user.erase", _body(target_id="usr_bora"), idem="p-erase",
    )
    response, _, _ = _confirm(
        client, secret, pub["id"], "user.erase",
        _confirm_body(prepared, text="bora@example.com", phrase="VERİLERİ SİL"),
        idem="c-erase",
    )
    assert response.status_code == 200, response.text
    assert "usr_bora" not in db.users.docs
    ticket = db.support_tickets.docs["t_b"]
    assert ticket["created_by_name"] == "[silindi]"
    assert ticket["created_by_id"] is None

    _fresh_counter(db)
    prepared, _, _ = _prepare(
        client, secret, pub["id"], "user.password_reset",
        _body(target_id="comp_b", email="bora2@example.com"), idem="p-pass",
    )
    assert prepared.json()["preview"] == {"email": "bora2@example.com"}
    response, _, _ = _confirm(
        client, secret, pub["id"], "user.password_reset",
        _confirm_body(prepared, text="bora2@example.com"),
        idem="c-pass",
    )
    assert response.status_code == 200, response.text
    assert response.json()["item"]["email"] == "bora2@example.com"
    assert len(db.password_resets.docs) == 1
    assert db.notify_outbox.inserts == 1
    assert mail_calls["n"] == 0

    _fresh_counter(db)
    prepared, _, _ = _prepare(
        client, secret, pub["id"], "superadmin.2fa_reset", _body(target_id="usr_other"), idem="p-2fa",
    )
    assert prepared.json()["preview"] == {"email": _OTHER_SA}
    response, _, _ = _confirm(
        client, secret, pub["id"], "superadmin.2fa_reset",
        _confirm_body(prepared, text=_OTHER_SA),
        idem="c-2fa",
    )
    assert response.status_code == 200, response.text
    other = db.users.docs["usr_other"]
    assert other["totp_enabled"] is False
    assert other["totp_secret"] == ""
    assert other["totp_reset_at"]
    assert "totp_enabled_at" not in other
    assert "2fa:usr_other" not in {row.get("identifier") for row in db.login_attempts.docs.values()}


def test_confirm_token_errors_do_not_run(db):
    _seed(db)
    pub, secret = _key(db)
    other, other_secret = _key(db, name="other-key")
    client = _client()
    prepared, _, _ = _prepare(client, secret, pub["id"], "company.reset_data", _body(), idem="p-tok")
    token = prepared.json()["confirmation_token"]
    good = _confirm_body(prepared, text="Ada Ticaret", phrase="VERİLERİ SIFIRLA")

    bad, _, _ = _confirm(
        client, secret, pub["id"], "company.reset_data",
        {**good, "confirmation_token": "not-a-real-token"}, idem="bad-token",
    )
    assert bad.status_code == 400
    assert _detail(bad) == "Onay kodu geçersiz veya süresi dolmuş."
    assert "inv_1" in db.invoices.docs

    wrong_key, _, _ = _confirm(client, other_secret, other["id"], "company.reset_data", good, idem="other-key")
    assert wrong_key.status_code == 400
    assert _detail(wrong_key) == "Onay kodu geçersiz veya süresi dolmuş."

    wrong_action, _, _ = _confirm(client, secret, pub["id"], "company.delete", {
        "confirmation_token": token, "confirm_text": "Ada Ticaret", "operator_otp": _otp(),
    }, idem="other-action")
    assert wrong_action.status_code == 400
    assert _detail(wrong_action) == "Onay kodu geçersiz veya süresi dolmuş."
    assert db.platform_danger_confirmations.docs[hashlib.sha256(token.encode()).hexdigest()]["used_at"] is None

    wrong_text, _, _ = _confirm(
        client, secret, pub["id"], "company.reset_data",
        {**good, "confirm_text": "Yanlis"}, idem="bad-text",
    )
    assert wrong_text.status_code == 400
    assert _detail(wrong_text) == "Onay için şirket adını birebir yazın."
    assert db.platform_danger_confirmations.docs[hashlib.sha256(token.encode()).hexdigest()]["used_at"] is None

    wrong_phrase, _, _ = _confirm(
        client, secret, pub["id"], "company.reset_data",
        {**good, "confirm_phrase": "HAYIR"}, idem="bad-phrase",
    )
    assert wrong_phrase.status_code == 400
    assert 'VERİLERİ SIFIRLA' in _detail(wrong_phrase)
    assert db.platform_danger_confirmations.docs[hashlib.sha256(token.encode()).hexdigest()]["used_at"] is None

    ok, _, _ = _confirm(client, secret, pub["id"], "company.reset_data", good, idem="after-bad")
    assert ok.status_code == 200, ok.text
    assert "inv_1" not in db.invoices.docs

    again, _, _ = _confirm(client, secret, pub["id"], "company.reset_data", good, idem="reuse")
    assert again.status_code == 400
    assert _detail(again) == "Onay kodu geçersiz veya süresi dolmuş."


def test_confirm_expired_token(db, monkeypatch):
    _seed(db)
    start = datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)
    clock = {"at": start}
    monkeypatch.setattr(danger, "_now", lambda: clock["at"])
    pub, secret = _key(db)
    client = _client()
    prepared, _, _ = _prepare(client, secret, pub["id"], "company.delete", _body(), idem="p-exp")
    clock["at"] = start + timedelta(minutes=5, seconds=1)
    response, _, _ = _confirm(
        client, secret, pub["id"], "company.delete",
        _confirm_body(prepared, text="Ada Ticaret", otp="000000"),
        idem="c-exp",
    )
    assert response.status_code == 400
    assert _detail(response) == "Onay kodu geçersiz veya süresi dolmuş."
    assert "comp_a" in db.companies.docs
    token = prepared.json()["confirmation_token"]
    assert db.platform_danger_confirmations.docs[hashlib.sha256(token.encode()).hexdigest()]["used_at"] is None


def test_operator_otp_and_lock(db):
    _seed(db)
    pub, secret = _key(db)
    client = _client()
    prepared, _, _ = _prepare(client, secret, pub["id"], "superadmin.2fa_reset", _body(target_id="usr_other"), idem="p-otp")
    token = prepared.json()["confirmation_token"]
    base = {"confirmation_token": token, "confirm_text": _OTHER_SA}

    async def _clear_totp():
        db.users.docs["usr_ops"]["totp_enabled"] = False
        db.users.docs["usr_ops"]["totp_secret"] = ""

    asyncio.run(_clear_totp())
    missing, _, _ = _confirm(client, secret, pub["id"], "superadmin.2fa_reset", {**base, "operator_otp": _otp()}, idem="no-2fa")
    assert missing.status_code == 403
    assert _detail(missing) == "Operatör 2FA kurulu değil."
    assert db.users.docs["usr_other"]["totp_secret"] == "enc:OTHERSECRET"

    async def _restore():
        db.users.docs["usr_ops"]["totp_enabled"] = True
        db.users.docs["usr_ops"]["totp_secret"] = "enc:" + _TOTP

    asyncio.run(_restore())
    bad_code = _bad_otp()
    wrong, _, _ = _confirm(
        client, secret, pub["id"], "superadmin.2fa_reset",
        {**base, "operator_otp": bad_code}, idem="bad-otp",
    )
    assert wrong.status_code == 403
    assert _detail(wrong) == "Doğrulama kodu hatalı."
    assert db.platform_danger_confirmations.docs[hashlib.sha256(token.encode()).hexdigest()]["used_at"] is None

    for index in range(4):
        response, _, _ = _confirm(
            client, secret, pub["id"], "superadmin.2fa_reset",
            {**base, "operator_otp": bad_code}, idem=f"lock-{index}",
        )
        assert response.status_code == 403
    locked, _, _ = _confirm(
        client, secret, pub["id"], "superadmin.2fa_reset",
        {**base, "operator_otp": _otp()}, idem="locked",
    )
    assert locked.status_code == 429
    assert db.users.docs["usr_other"]["totp_enabled"] is True

    async def _unlock():
        for row in list(db.login_attempts.docs.values()):
            if row.get("identifier") == "2fa:usr_ops":
                db.login_attempts.docs.pop(row["_id"], None)

    asyncio.run(_unlock())
    code = _otp()
    ok, _, _ = _confirm(
        client, secret, pub["id"], "superadmin.2fa_reset",
        {**base, "operator_otp": code}, idem="otp-ok",
    )
    assert ok.status_code == 200, ok.text
    async def _arm_again():
        db.users.docs["usr_other"]["totp_enabled"] = True
        db.users.docs["usr_other"]["totp_secret"] = "enc:OTHERSECRET"

    asyncio.run(_arm_again())
    prepared2, _, _ = _prepare(client, secret, pub["id"], "superadmin.2fa_reset", _body(target_id="usr_other"), idem="p-replay-otp")
    reused, _, _ = _confirm(
        client, secret, pub["id"], "superadmin.2fa_reset",
        _confirm_body(prepared2, text=_OTHER_SA, otp=code),
        idem="reused-otp",
    )
    assert reused.status_code == 403
    assert _detail(reused) == "Doğrulama kodu hatalı."
    assert db.users.docs["usr_other"]["totp_secret"] == "enc:OTHERSECRET"


def test_target_changed_consumes_token(db):
    _seed(db)
    pub, secret = _key(db)
    client = _client()
    prepared, _, _ = _prepare(client, secret, pub["id"], "user.erase", _body(target_id="usr_ada"), idem="p-change")
    token = prepared.json()["confirmation_token"]

    async def _drop_other_admin():
        db.users.docs.pop("usr_ada2", None)

    asyncio.run(_drop_other_admin())
    response, _, _ = _confirm(
        client, secret, pub["id"], "user.erase",
        _confirm_body(prepared, text="ada@example.com", phrase="VERİLERİ SİL"),
        idem="c-change",
    )
    assert response.status_code == 409
    assert _detail(response) == "Hedef değişti, yeniden hazırlayın."
    assert "usr_ada" in db.users.docs
    assert db.platform_danger_confirmations.docs[hashlib.sha256(token.encode()).hexdigest()]["used_at"]


def test_idempotency(db):
    _seed(db)
    pub, secret = _key(db)
    client = _client()
    missing, _, _ = _prepare(client, secret, pub["id"], "company.delete", _body(), idem=None)
    assert missing.status_code == 400
    assert _detail(missing) == "Idempotency-Key gerekli"

    prepared, _, _ = _prepare(
        client, secret, pub["id"], "user.password_reset", _body(email="ada@example.com"), idem="p-idem",
    )
    payload = _confirm_body(prepared, text="ada@example.com")
    payload["operator_otp"] = _otp()
    first, _, _ = _confirm(client, secret, pub["id"], "user.password_reset", payload, idem="LEAK-IDEM")
    assert first.status_code == 200, first.text
    audits = len(_danger_audits(db, "user.password_reset.confirm"))
    outbox = db.notify_outbox.inserts
    second, _, _ = _confirm(client, secret, pub["id"], "user.password_reset", payload, idem="LEAK-IDEM")
    assert second.status_code == 200
    assert second.json() == first.json()
    assert db.notify_outbox.inserts == outbox
    assert len(_danger_audits(db, "user.password_reset.confirm")) == audits == 1

    changed = dict(payload)
    changed["confirm_text"] = "baska@example.com"
    conflict, _, _ = _confirm(client, secret, pub["id"], "user.password_reset", changed, idem="LEAK-IDEM")
    assert conflict.status_code == 409
    assert _detail(conflict) == "Idempotency-Key farklı istekle kullanıldı"
    assert db.notify_outbox.inserts == outbox


def test_secrets_do_not_leak(db, caplog):
    _seed(db)
    caplog.set_level(logging.DEBUG)
    pub, secret = _key(db)
    client = _client()
    prepared, headers, nonce = _prepare(
        client, secret, pub["id"], "user.password_reset", _body(email="ada@example.com"), idem="p-leak",
    )
    token = prepared.json()["confirmation_token"]
    digest = hashlib.sha256(token.encode()).hexdigest()
    payload = _confirm_body(prepared, text="ada@example.com")
    otp = payload["operator_otp"]
    response, conf_headers, conf_nonce = _confirm(
        client, secret, pub["id"], "user.password_reset", payload, idem="LEAK-IDEM",
    )
    assert response.status_code == 200, response.text
    reset_token = next(iter(db.password_resets.docs))
    blob = json.dumps({
        "audit": list(db.platform_audit_log.docs.values()),
        "activity": list(db.activity_logs.docs.values()),
        "logs": [
            {"message": rec.getMessage(), "data": getattr(rec, "event_data", None)}
            for rec in caplog.records
        ],
    }, ensure_ascii=False, default=str)
    for secret_value in (
        token, digest, otp, _TOTP, reset_token, "LEAK-IDEM",
        headers["X-Platform-Signature"], nonce,
        conf_headers["X-Platform-Signature"], conf_nonce,
    ):
        assert secret_value not in blob
    assert "/sifre/" not in blob
    assert any(row.get("operator_email") == _OPERATOR and row.get("via") == "api" for row in db.activity_logs.docs.values())


def test_phrase_rejected_on_other_actions(db):
    _seed(db)
    pub, secret = _key(db)
    client = _client()
    prepared, _, _ = _prepare(client, secret, pub["id"], "company.delete", _body(), idem="p-phrase")
    response, _, _ = _confirm(
        client, secret, pub["id"], "company.delete",
        {**_confirm_body(prepared, text="Ada Ticaret"), "confirm_phrase": "VERİLERİ SİL"},
        idem="c-phrase",
    )
    assert response.status_code == 400
    assert _detail(response) == "Desteklenmeyen alan: confirm_phrase"
    token = prepared.json()["confirmation_token"]
    assert db.platform_danger_confirmations.docs[hashlib.sha256(token.encode()).hexdigest()]["used_at"] is None
    assert "comp_a" in db.companies.docs


def test_dangerous_scope_does_not_grant_other_routes(db):
    _seed(db)
    pub, secret = _key(db)
    client = _client()
    write, _, _ = _send(
        client, secret, pub["id"], "PUT",
        "/api/platform/admin-v1/companies/comp_a/license",
        {"status": "active"}, idem="no-license",
    )
    assert write.status_code == 403
    start, _, _ = _send(
        client, secret, pub["id"], "POST",
        "/api/platform/admin-v1/companies/comp_a/impersonate",
        {"reason": _REASON, "operator_email": _OPERATOR}, idem="no-imp",
    )
    assert start.status_code == 403


def test_system_reset_and_delete_still_use_password(db):
    _seed(db)
    client = _client()
    bad = client.post(
        "/api/system/companies/comp_a/reset-data",
        json={"confirm_name": "Ada Ticaret", "confirm_phrase": "YANLIS", "admin_password": "correct-pass"},
    )
    assert bad.status_code == 400
    assert "inv_1" in db.invoices.docs
    ok = client.post(
        "/api/system/companies/comp_a/reset-data",
        json={"confirm_name": "Ada Ticaret", "confirm_phrase": "VERİLERİ SIFIRLA", "admin_password": "correct-pass"},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["status"] == "success"
    assert "inv_1" not in db.invoices.docs
    assert "usr_ada" in db.users.docs
    assert not any(row.get("via") == "api" for row in db.activity_logs.docs.values())

    async def _invoice():
        await db.invoices.insert_one({"_id": "inv_sys", "company_id": "comp_a", "total": 1})
        await db.companies.insert_one({"_id": "comp_nexus_main_01", "name": "Nexus"})

    asyncio.run(_invoice())
    protected = client.delete("/api/system/companies/comp_nexus_main_01")
    assert protected.status_code == 400
    assert _detail(protected) == "Platform demo şirketleri silinemez."
    deleted = client.delete("/api/system/companies/comp_a")
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["status"] == "success"
    assert "comp_a" not in db.companies.docs
    assert "inv_sys" not in db.invoices.docs


def test_system_erase_and_password_reset(db, mail_calls):
    _seed(db)
    client = _client()
    bad = client.post(
        "/api/system/users/usr_ada/erase",
        json={"confirm_email": "ada@example.com", "confirm_phrase": "YANLIS", "admin_password": "correct-pass"},
    )
    assert bad.status_code == 400
    assert "usr_ada" in db.users.docs
    ok = client.post(
        "/api/system/users/usr_ada/erase",
        json={"confirm_email": "ada@example.com", "confirm_phrase": "VERİLERİ SİL", "admin_password": "correct-pass"},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["deleted"]["user"] == 1
    assert "usr_ada" not in db.users.docs

    missing = client.post("/api/system/companies/missing/send-password-reset", json={})
    assert missing.status_code == 404
    assert _detail(missing) == "Şirket bulunamadı."
    before = mail_calls["n"]
    sent = client.post(
        "/api/system/companies/comp_a/send-password-reset",
        json={"email": "ada2@example.com"},
    )
    assert sent.status_code == 200, sent.text
    assert sent.json()["mail_status"] == "sent"
    assert sent.json()["email"] == "ada2@example.com"
    assert mail_calls["n"] == before + 1
    assert len(db.password_resets.docs) == 1
    assert next(iter(db.password_resets.docs.values()))["requested_by"] == "system_panel"


def _load_script():
    path = __import__("pathlib").Path(__file__).resolve().parents[1] / "scripts" / "reset_superadmin_2fa.py"
    spec = importlib.util.spec_from_file_location("reset_superadmin_2fa_script", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_reset_script_confirm_and_helper(monkeypatch, capsys):
    module = _load_script()
    monkeypatch.delenv("CONFIRM", raising=False)
    assert asyncio.run(module._run()) == 2
    assert "REDDEDİLDİ" in capsys.readouterr().out

    called = []

    async def _fake_reset(db, user_id):
        called.append((user_id, db))
        return {"id": user_id, "email": "sa@example.com"}

    monkeypatch.setattr(superadmin_2fa, "reset_user_totp", _fake_reset)
    monkeypatch.setenv("CONFIRM", "yes")
    monkeypatch.setenv("SUPERADMIN_EMAIL", "SA@Example.com")

    class _Find:
        async def to_list(self, _n):
            return [{"_id": "u1", "email": "sa@example.com", "is_super_admin": True}]

    class _Users:
        def __init__(self):
            self.queries = []

        def find(self, query):
            self.queries.append(query)
            return _Find()

    class _DB:
        def __init__(self):
            self.users = _Users()

        async def _ensure(self):
            return None

    database = _DB()

    class _Client:
        def __getitem__(self, _name):
            return database

        async def close_async(self):
            database.closed = True

        def close(self):
            database.sync_closed = True

    import mysql_store
    monkeypatch.setattr(mysql_store, "MySQLClient", lambda: _Client())
    monkeypatch.setattr(mysql_store, "mysql_settings_from_env", lambda: {"db": "tamkobi"})
    import dotenv
    monkeypatch.setattr(dotenv, "load_dotenv", lambda *_args, **_kwargs: False)
    import setup_state
    monkeypatch.setattr(setup_state, "apply_saved_secrets", lambda: None)

    assert asyncio.run(module._run()) == 0
    assert called and called[0][0] == "u1"
    assert database.users.queries[0]["email"] == "sa@example.com"
    assert database.users.queries[0]["is_super_admin"] is True
    assert database.closed is True
    assert "TAMAM:" in capsys.readouterr().out
