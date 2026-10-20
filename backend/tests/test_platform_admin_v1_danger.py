"""admin-v1 kimliğe bürünme uçları. TestClient + bellek FakeDB. Canlı DB / port yok."""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone
from types import SimpleNamespace

import jwt
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import addons
import auth_handoff
import comm_service
import platform_admin_v1_danger
import platform_store as store
import saas
import saas_extras
import support_access
import tenant_idor_allowlist as allowlist
from test_platform_admin_v1 import (
    FakeColl,
    FakeDB,
    _bad_key,
    _detail,
    _issue,
    _match,
    _plant_key,
    _signed_headers,
    _walk_keys,
    with_peer,
)

_JWT = "unit-test-jwt-secret-not-for-prod-0123456789abcdef"
_ADMIN_ALLOW_REASON = (
    "Platform yönetim API'si; HMAC platform_admin anahtarı "
    "(kind=platform_admin, admin.* kapsamı), şirket oturumu yok"
)
_START = "/api/platform/admin-v1/companies/comp_a/impersonate"
_REASON = "Musteri destek talebi nedeniyle giris"
_OPERATOR = "ops@example.com"


def _end(session_id: str) -> str:
    return f"/api/platform/admin-v1/impersonation/{session_id}/end"


class _Cursor:
    def __init__(self, rows):
        self.rows = rows
        self.rowcount = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def execute(self, sql, params=None):
        text = " ".join(str(sql).split()).lower()
        if text.startswith("insert") and params:
            code, token, purpose, exp, created = params
            self.rows.append({
                "code": code,
                "token": token,
                "purpose": purpose,
                "expires_at": exp,
                "created_at": created,
            })
            self.rowcount = 1
        else:
            self.rowcount = 0

    async def fetchone(self):
        return None


class _Conn:
    def __init__(self, rows):
        self.rows = rows

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    def cursor(self):
        return _Cursor(self.rows)


class _Pool:
    def __init__(self, rows):
        self.rows = rows

    def acquire(self):
        return _Conn(self.rows)


class _Bearer:
    def __init__(self, token: str):
        self.headers = {"Authorization": f"Bearer {token}"}
        self.cookies = {}


def _app():
    app = FastAPI()
    app.include_router(platform_admin_v1_danger.router)
    app.include_router(saas_extras.router)
    app.dependency_overrides[saas.require_super_admin] = lambda: {
        "id": "sa1",
        "_id": "sa1",
        "email": "sa@example.com",
        "name": "Sistem",
        "is_super_admin": True,
    }
    return app


def _client(ip: str = "127.0.0.1") -> TestClient:
    return TestClient(with_peer(_app(), ip), base_url="http://127.0.0.1:1")


@pytest.fixture
def db(monkeypatch):
    async def create_index(self, *_args, **_kwargs):
        return "idempo"

    async def update_many(self, q=None, upd=None, **_kwargs):
        rows = [doc for doc in list(self.docs.values()) if _match(doc, q or {})]
        for doc in rows:
            if upd and "$set" in upd:
                doc.update(upd["$set"])
        if rows:
            self.updates += 1
        return SimpleNamespace(matched_count=len(rows), modified_count=len(rows))

    monkeypatch.setattr(FakeColl, "create_index", create_index, raising=False)
    monkeypatch.setattr(FakeColl, "update_many", update_many, raising=False)
    monkeypatch.setattr(comm_service, "encrypt", lambda v: "enc:" + (v or ""))
    monkeypatch.setattr(comm_service, "decrypt", lambda v: (v or "").removeprefix("enc:"))
    monkeypatch.setenv("JWT_SECRET", _JWT)
    auth_handoff.reset_table_ready_for_tests()
    fake = FakeDB()
    fake.handoffs = []
    fake._pool = _Pool(fake.handoffs)

    async def _ensure():
        return None

    fake._ensure = _ensure
    prev = (
        store._db,
        saas._db,
        saas._current_user,
        saas_extras._db,
        dict(saas_extras._deps),
        support_access._db,
        support_access._get_user,
        addons._db,
    )
    store.init(fake)
    saas.init(fake, None)
    saas.invalidate()
    addons.init(fake)
    saas_extras.init(fake, {})
    support_access.init(fake, None)
    yield fake
    store.init(prev[0])
    saas.init(prev[1], prev[2])
    saas_extras._db = prev[3]
    saas_extras._deps.clear()
    saas_extras._deps.update(prev[4])
    support_access._db = prev[5]
    support_access._get_user = prev[6]
    addons.init(prev[7])
    auth_handoff.reset_table_ready_for_tests()
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
    response = client.request(method, path, content=raw, headers=headers)
    return response, headers, nonce_used


def _seed(db, *, addon=True, privacy=True, with_user=True, company=True):
    async def run():
        if company:
            doc = {
                "_id": "comp_a",
                "name": "Ada",
                "created_at": "2026-01-01T00:00:00+00:00",
            }
            if not privacy:
                doc["allow_platform_access"] = False
            await db.companies.insert_one(doc)
            await db.company_licenses.insert_one({
                "_id": "comp_a",
                "company_id": "comp_a",
                "plan_id": "plan_pro",
                "status": "active",
                "addon_overrides": {} if addon else {"support.impersonate": False},
            })
        if with_user:
            await db.users.insert_one({
                "_id": "usr_ada",
                "name": "Ada",
                "email": "ada@example.com",
                "role": "admin",
                "company_ids": ["comp_a"],
                "is_super_admin": False,
                "is_active": True,
                "password_hash": "hash-ada",
            })
        await db.users.insert_one({
            "_id": "usr_ops",
            "name": "Operatör",
            "email": _OPERATOR,
            "role": "admin",
            "company_ids": [],
            "is_super_admin": True,
            "is_active": True,
            "password_hash": "hash-ops",
        })

    asyncio.run(run())


def _body(**extra):
    payload = {
        "reason": _REASON,
        "operator_email": _OPERATOR,
        "ttl_minutes": 15,
    }
    payload.update(extra)
    return payload


def _danger_audits(db):
    return [
        row for row in db.platform_audit_log.docs.values()
        if str(row.get("action") or "").startswith("admin_v1.danger.")
    ]


def _enter_audits(db):
    return [
        row for row in db.platform_audit_log.docs.values()
        if row.get("action") == "impersonate.enter"
    ]


def _business_quiet(db, before):
    assert db.support_sessions.inserts == before["sessions"]
    assert db.activity_logs.inserts == before["logs"]
    assert db.users.updates == before["users"]
    assert len(db.handoffs) == before["handoffs"]
    assert len(_danger_audits(db)) == before["danger"]
    assert len(_enter_audits(db)) == before["enter"]
    assert db.idempotency_keys.inserts == before["idem"]


def _quiet_before(db):
    return {
        "sessions": db.support_sessions.inserts,
        "logs": db.activity_logs.inserts,
        "users": db.users.updates,
        "handoffs": len(db.handoffs),
        "danger": len(_danger_audits(db)),
        "enter": len(_enter_audits(db)),
        "idem": db.idempotency_keys.inserts,
    }


def _blob_tokens(db):
    tokens = []
    for row in db.handoffs:
        blob = json.loads(row["token"])
        tokens.append(blob["access_token"])
        assert blob["sa_return"] == "" or isinstance(blob["sa_return"], str)
    return tokens


def _decode(token: str) -> dict:
    return jwt.decode(token, _JWT, algorithms=["HS256"], audience="app")


def test_allowlist_and_scope_constant():
    pairs = (
        ("POST", "/platform/admin-v1/companies/{company_id}/impersonate"),
        ("POST", "/platform/admin-v1/impersonation/{session_id}/end"),
    )
    for pair in pairs:
        assert pair in allowlist.TENANT_IDOR_ALLOWLIST
        assert allowlist.ALLOWLIST_REASONS[pair] == _ADMIN_ALLOW_REASON
    assert store.SCOPE_ADMIN_IMPERSONATE == "admin.impersonate"
    assert store.SCOPE_ADMIN_IMPERSONATE in store.ADMIN_SCOPES
    assert not hasattr(store, "SCOPE_ADMIN_DANGEROUS")
    assert "admin.dangerous" not in store.ADMIN_SCOPES
    assert auth_handoff._TTL_S == 60
    covered = [
        scope for scope in store.ADMIN_SCOPES
        if scope != store.SCOPE_ADMIN_IMPERSONATE and scope.endswith((":read", ":write"))
    ]
    assert store.SCOPE_ADMIN_IMPERSONATE not in covered


def test_auth_matrix_does_not_write(db):
    _seed(db)
    others = [scope for scope in store.ADMIN_SCOPES if scope != store.SCOPE_ADMIN_IMPERSONATE]
    _plant_key(
        db, key_id="pk_product_i", secret="product-secret", kind="product",
        scopes=[store.SCOPE_ADMIN_IMPERSONATE],
    )
    _plant_key(
        db, key_id="pk_bound_i", secret="bound-secret", kind="platform_admin",
        scopes=[store.SCOPE_ADMIN_IMPERSONATE], instance_id="comp_bound",
    )
    wide, wide_secret = _issue(db, others, name="wide-no-imp")
    reader, reader_secret = _issue(db, [store.SCOPE_ADMIN_LICENSES_READ], name="read-only")
    writer, writer_secret = _issue(db, [store.SCOPE_ADMIN_LICENSES_WRITE], name="write-only")
    ok_pub, ok_secret = _issue(db, [store.SCOPE_ADMIN_IMPERSONATE], name="imp")
    client = _client()
    body = _body()
    paths = (
        ("POST", _START, body),
        ("POST", _end("ss_missing"), {"reason": _REASON}),
    )
    for method, path, payload in paths:
        raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        before = _quiet_before(db)

        missing = client.request(method, path, content=raw)
        assert missing.status_code == 401
        assert _detail(missing) == "Eksik imza başlıkları"
        _business_quiet(db, before)

        headers, _, _ = _signed_headers(ok_secret, ok_pub["id"], method, path, raw)
        headers["X-Platform-Signature"] = "ab" * 32
        bad = client.request(method, path, content=raw, headers=headers)
        assert bad.status_code == 401
        assert _detail(bad) == "İmza doğrulanamadı"
        _business_quiet(db, before)

        first, replay_headers, _ = _send(
            client, ok_secret, ok_pub["id"], method, path, raw=b"{}", idem=f"replay-{path}",
        )
        assert first.status_code == 400
        again = client.request(method, path, content=b"{}", headers=replay_headers)
        assert again.status_code == 401
        assert _detail(again) == "Tekrarlanan nonce"
        _business_quiet(db, before)

        for secret, pub in (
            (reader_secret, reader),
            (writer_secret, writer),
            (wide_secret, wide),
            ("product-secret", {"id": "pk_product_i"}),
            ("bound-secret", {"id": "pk_bound_i"}),
        ):
            denied, _, _ = _send(
                client, secret, pub["id"], method, path, payload, idem=f"deny-{pub['id']}-{path}",
            )
            assert denied.status_code == 403, denied.text
            assert _detail(denied) == "Kapsam yetersiz"
        _business_quiet(db, before)


def test_ip_allowlist_does_not_write(db):
    _seed(db)
    pub, secret = _issue(
        db, [store.SCOPE_ADMIN_IMPERSONATE], ip_allowlist=["203.0.113.7"], name="ip-imp",
    )
    client = _client()
    before = _quiet_before(db)
    denied, _, _ = _send(
        client, secret, pub["id"], "POST", _START, _body(),
        idem="ip-no", real_ip="198.51.100.9",
    )
    assert denied.status_code == 403
    assert _detail(denied) == "IP adresi bu anahtar için izinli değil"
    _business_quiet(db, before)
    rows = [row for row in db.platform_audit_log.docs.values() if row["action"] == "admin_v1.auth.ip_denied"]
    assert rows
    assert secret not in json.dumps(rows[-1])


def test_validation_does_not_write(db):
    _seed(db)
    pub, secret = _issue(db, [store.SCOPE_ADMIN_IMPERSONATE], name="val")
    client = _client()
    short = "kisa"
    long_reason = "a" * 501
    cases = [
        (_START, {}, 400, "reason zorunlu."),
        (_START, {"reason": 12, "operator_email": _OPERATOR}, 400, "reason metin olmalı."),
        (_START, {"reason": short, "operator_email": _OPERATOR}, 400, "reason 10 ile 500 karakter arasında olmalı."),
        (_START, {"reason": "  " + short, "operator_email": _OPERATOR}, 400, "reason 10 ile 500 karakter arasında olmalı."),
        (_START, {"reason": long_reason, "operator_email": _OPERATOR}, 400, "reason 10 ile 500 karakter arasında olmalı."),
        (_START, {"reason": _REASON}, 400, "operator_email zorunlu."),
        (_START, {"reason": _REASON, "operator_email": "  "}, 400, "operator_email zorunlu."),
        (_START, {"reason": _REASON, "operator_email": "ada@example.com"}, 403, "Operatör yetkili değil."),
        (_START, {"reason": _REASON, "operator_email": "yok@example.com"}, 403, "Operatör yetkili değil."),
        (_START, {"reason": _REASON, "operator_email": _OPERATOR, "ttl_minutes": 4}, 400, "ttl_minutes 5 ile 60 arasında bir tamsayı olmalı."),
        (_START, {"reason": _REASON, "operator_email": _OPERATOR, "ttl_minutes": 61}, 400, "ttl_minutes 5 ile 60 arasında bir tamsayı olmalı."),
        (_START, {"reason": _REASON, "operator_email": _OPERATOR, "ttl_minutes": True}, 400, "ttl_minutes 5 ile 60 arasında bir tamsayı olmalı."),
        (_START, {"reason": _REASON, "operator_email": _OPERATOR, "ttl_minutes": "15"}, 400, "ttl_minutes 5 ile 60 arasında bir tamsayı olmalı."),
        (_START, {"reason": _REASON, "operator_email": _OPERATOR, "note": "x"}, 400, "Desteklenmeyen alan: note"),
        (_end("ss_yok"), {}, 400, "reason zorunlu."),
        (_end("ss_yok"), {"reason": short}, 400, "reason 10 ile 500 karakter arasında olmalı."),
        (_end("ss_yok"), {"reason": _REASON, "note": "x"}, 400, "Desteklenmeyen alan: note"),
        (_end("ss_yok"), {"reason": _REASON}, 404, "Oturum bulunamadı."),
    ]
    for index, (path, payload, status, detail) in enumerate(cases):
        before = _quiet_before(db)
        response, _, _ = _send(client, secret, pub["id"], "POST", path, payload, idem=f"bad-{index}")
        assert response.status_code == status, f"{path} {payload} {response.text}"
        assert _detail(response) == detail
        _business_quiet(db, before)

    before = _quiet_before(db)
    missing_key, _, _ = _send(
        client, secret, pub["id"], "POST", _START, _body(), idem=None,
    )
    assert missing_key.status_code == 400
    assert _detail(missing_key) == "Idempotency-Key gerekli"
    _business_quiet(db, before)


def test_gate_failures_do_not_write(db):
    pub, secret = _issue(db, [store.SCOPE_ADMIN_IMPERSONATE], name="gate")
    client = _client()

    _seed(db, addon=False)
    before = _quiet_before(db)
    addon, _, _ = _send(client, secret, pub["id"], "POST", _START, _body(), idem="addon")
    assert addon.status_code == 403
    assert _detail(addon) == "Bu müşteri için 'şirket olarak gir' destek aracı kapalı."
    _business_quiet(db, before)

    db.company_licenses.docs["comp_a"]["addon_overrides"] = {}
    db.companies.docs["comp_a"]["allow_platform_access"] = False
    before = _quiet_before(db)
    privacy, _, _ = _send(client, secret, pub["id"], "POST", _START, _body(), idem="privacy")
    assert privacy.status_code == 403
    assert _detail(privacy) == "Bu şirket gizlilik ayarından yönetim paneli erişimini kapatmış. Destek girişi yapılamaz."
    _business_quiet(db, before)

    db.companies.docs["comp_a"]["allow_platform_access"] = True
    db.users.docs.pop("usr_ada")
    before = _quiet_before(db)
    nobody, _, _ = _send(client, secret, pub["id"], "POST", _START, _body(), idem="nobody")
    assert nobody.status_code == 400
    assert _detail(nobody) == "Bu şirkette giriş yapılabilecek kullanıcı yok."
    _business_quiet(db, before)


def test_missing_company_is_404_without_write(db):
    async def ghost_user():
        await db.users.insert_one({
            "_id": "usr_ghost",
            "name": "Hayalet",
            "email": "ghost@example.com",
            "role": "admin",
            "company_ids": ["comp_yok"],
            "is_super_admin": False,
            "is_active": True,
            "password_hash": "hash-ghost",
        })

    _seed(db, company=False)
    asyncio.run(ghost_user())
    pub, secret = _issue(db, [store.SCOPE_ADMIN_IMPERSONATE], name="missing-co")
    client = _client()
    before = _quiet_before(db)
    response, _, _ = _send(
        client, secret, pub["id"], "POST",
        "/api/platform/admin-v1/companies/comp_yok/impersonate",
        _body(), idem="missing-co",
    )
    assert response.status_code == 404
    assert _detail(response) == "Şirket bulunamadı."
    _business_quiet(db, before)


def test_success_session_jwt_and_audits(db, caplog):
    _seed(db)
    caplog.set_level(logging.DEBUG)
    pub, secret = _issue(db, [store.SCOPE_ADMIN_IMPERSONATE], name="ok")
    client = _client()
    body = _body()
    response, headers, nonce = _send(
        client, secret, pub["id"], "POST", _START, body, idem="LEAK-IDEM", real_ip="203.0.113.10",
    )
    assert response.status_code == 200, response.text
    item = response.json()["item"]
    assert set(item) == {
        "company_name", "as_user", "session_id", "started_at", "expires_at", "redirect", "code",
    }
    assert item["company_name"] == "Ada"
    assert item["as_user"] == "ada@example.com"
    assert item["code"]
    assert item["code"] in item["redirect"]
    found = []
    _walk_keys(response.json(), found)
    assert "access_token" not in found
    assert "token" not in found
    assert "sa_return" not in found
    assert not any(_bad_key(key) for key in found), found

    session = db.support_sessions.docs[item["session_id"]]
    assert session["status"] == "active"
    assert session["by_email"] == _OPERATOR
    assert session["target_user_email"] == "ada@example.com"
    started = datetime.fromisoformat(session["started_at"])
    expires = datetime.fromisoformat(session["expires_at"])
    assert abs((expires - started).total_seconds() - 15 * 60) < 2
    assert db.users.docs["usr_ada"]["active_company_id"] == "comp_a"
    assert len(db.activity_logs.docs) == 1
    assert len(db.handoffs) == 1
    blob = json.loads(db.handoffs[0]["token"])
    assert blob["sa_return"] == ""
    assert db.handoffs[0]["code"] == item["code"]
    claims = _decode(blob["access_token"])
    assert claims["aud"] == "app"
    assert claims["imp_via"] == "api"
    assert claims["imp_by"] == _OPERATOR
    assert claims["imp_session"] == item["session_id"]
    assert claims["sub"] == "usr_ada"
    exp = datetime.fromtimestamp(claims["exp"], tz=timezone.utc)
    assert abs((exp - started).total_seconds() - 15 * 60) < 5
    assert blob["access_token"] not in response.text

    enters = _enter_audits(db)
    starts = [row for row in _danger_audits(db) if row["action"] == "admin_v1.danger.impersonate.start"]
    assert len(enters) == 1
    assert len(starts) == 1
    assert enters[0]["actor_type"] == "api_key"
    assert enters[0]["actor_id"] == pub["id"]
    assert enters[0]["details"] == {"as_user": "ada@example.com", "session_id": item["session_id"]}
    row = starts[0]
    assert row["actor_type"] == "api_key"
    assert row["actor_id"] == pub["id"]
    assert row["ip"] == "203.0.113.10"
    assert row["target_type"] == "company"
    assert row["target_id"] == "comp_a"
    assert row["details"] == {
        "operator": _OPERATOR,
        "reason": _REASON,
        "session_id": item["session_id"],
        "ttl_minutes": 15,
        "as_user": "ada@example.com",
    }

    info = asyncio.run(saas_extras.impersonation_info(_Bearer(blob["access_token"])))
    assert info is None or info.get("session_id") == item["session_id"]
    leaked = "\n".join((
        json.dumps(list(db.platform_audit_log.docs.values()), ensure_ascii=False, default=str),
        json.dumps(list(db.activity_logs.docs.values()), ensure_ascii=False, default=str),
        caplog.text,
    ))
    for banned in (
        secret,
        headers["X-Platform-Signature"],
        nonce,
        "LEAK-IDEM",
        blob["access_token"],
        item["code"],
        _JWT,
    ):
        assert banned not in leaked
    assert "sa_return" not in leaked


def test_default_ttl_is_30(db):
    _seed(db)
    pub, secret = _issue(db, [store.SCOPE_ADMIN_IMPERSONATE], name="ttl30")
    client = _client()
    body = {"reason": _REASON, "operator_email": _OPERATOR}
    response, _, _ = _send(client, secret, pub["id"], "POST", _START, body, idem="ttl30")
    assert response.status_code == 200, response.text
    session = db.support_sessions.docs[response.json()["item"]["session_id"]]
    started = datetime.fromisoformat(session["started_at"])
    expires = datetime.fromisoformat(session["expires_at"])
    assert abs((expires - started).total_seconds() - 30 * 60) < 2
    claims = _decode(json.loads(db.handoffs[0]["token"])["access_token"])
    assert "imp_via" in claims and claims["imp_via"] == "api"
    row = next(row for row in _danger_audits(db) if row["action"].endswith(".start"))
    assert row["details"]["ttl_minutes"] == 30


def test_end_revokes_jwt_and_second_end_is_noop(db):
    _seed(db)
    pub, secret = _issue(db, [store.SCOPE_ADMIN_IMPERSONATE], name="end")
    client = _client()
    started, _, _ = _send(client, secret, pub["id"], "POST", _START, _body(ttl_minutes=20), idem="start-end")
    assert started.status_code == 200, started.text
    session_id = started.json()["item"]["session_id"]
    token = json.loads(db.handoffs[0]["token"])["access_token"]
    assert db.support_sessions.docs[session_id]["status"] == "active"
    assert support_access.public_session(db.support_sessions.docs[session_id])

    ended, _, _ = _send(
        client, secret, pub["id"], "POST", _end(session_id), {"reason": _REASON}, idem="end-1",
    )
    assert ended.status_code == 200, ended.text
    assert ended.json()["item"]["status"] == "revoked"
    assert ended.json()["item"]["session_id"] == session_id
    found = []
    _walk_keys(ended.json(), found)
    assert "access_token" not in found and "token" not in found and "sa_return" not in found
    closed = db.support_sessions.docs[session_id]
    assert closed["status"] == "revoked"
    assert closed["ended_by"] == f"api_key:{pub['id']}"
    assert support_access.public_session(closed) is None
    assert asyncio.run(saas_extras.impersonation_info(_Bearer(token))) is None
    claims = _decode(token)
    assert claims["imp_session"] == session_id
    ends = [row for row in _danger_audits(db) if row["action"] == "admin_v1.danger.impersonate.end"]
    assert len(ends) == 1
    assert ends[0]["target_type"] == "session"
    assert ends[0]["target_id"] == session_id
    assert ends[0]["actor_id"] == pub["id"]
    assert ends[0]["details"]["operator"] == _OPERATOR
    assert ends[0]["details"]["reason"] == _REASON
    assert ends[0]["details"]["session_id"] == session_id
    assert ends[0]["details"]["as_user"] == "ada@example.com"
    assert ends[0]["details"]["ttl_minutes"] == 20
    updates = db.support_sessions.updates

    again, _, _ = _send(
        client, secret, pub["id"], "POST", _end(session_id), {"reason": _REASON + " tekrar"}, idem="end-2",
    )
    assert again.status_code == 200, again.text
    assert again.json()["item"]["status"] == "revoked"
    assert db.support_sessions.docs[session_id]["ended_by"] == f"api_key:{pub['id']}"
    assert db.support_sessions.updates == updates
    assert len([row for row in _danger_audits(db) if row["action"].endswith(".end")]) == 1
    assert asyncio.run(saas_extras.impersonation_info(_Bearer(token))) is None


def test_idempotency_replay_and_conflict(db):
    _seed(db)
    pub, secret = _issue(db, [store.SCOPE_ADMIN_IMPERSONATE], name="idem")
    client = _client()
    body = _body()
    first, _, _ = _send(client, secret, pub["id"], "POST", _START, body, idem="same")
    second, _, _ = _send(client, secret, pub["id"], "POST", _START, body, idem="same")
    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text
    assert first.json() == second.json()
    assert db.support_sessions.inserts == 1
    assert len(db.handoffs) == 1
    assert len(_enter_audits(db)) == 1
    assert len([row for row in _danger_audits(db) if row["action"].endswith(".start")]) == 1

    clash, _, _ = _send(
        client, secret, pub["id"], "POST", _START,
        _body(reason=_REASON + " baska"), idem="same",
    )
    assert clash.status_code == 409
    assert _detail(clash) == "Idempotency-Key farklı istekle kullanıldı"
    assert db.support_sessions.inserts == 1
    assert len(_enter_audits(db)) == 1

    session_id = first.json()["item"]["session_id"]
    end_body = {"reason": _REASON}
    end_first, _, _ = _send(client, secret, pub["id"], "POST", _end(session_id), end_body, idem="end-same")
    end_second, _, _ = _send(client, secret, pub["id"], "POST", _end(session_id), end_body, idem="end-same")
    assert end_first.status_code == 200, end_first.text
    assert end_second.json() == end_first.json()
    assert len([row for row in _danger_audits(db) if row["action"].endswith(".end")]) == 1
    end_clash, _, _ = _send(
        client, secret, pub["id"], "POST", _end(session_id),
        {"reason": _REASON + " farkli"}, idem="end-same",
    )
    assert end_clash.status_code == 409


def test_inactive_operator_is_forbidden(db):
    _seed(db)

    async def plant():
        await db.users.insert_one({
            "_id": "usr_off",
            "name": "Kapalı",
            "email": "off@example.com",
            "role": "admin",
            "is_super_admin": True,
            "is_active": False,
            "password_hash": "hash-off",
        })

    asyncio.run(plant())
    pub, secret = _issue(db, [store.SCOPE_ADMIN_IMPERSONATE], name="off")
    client = _client()
    before = _quiet_before(db)
    response, _, _ = _send(
        client, secret, pub["id"], "POST", _START,
        _body(operator_email="off@example.com"), idem="off",
    )
    assert response.status_code == 403
    assert _detail(response) == "Operatör yetkili değil."
    _business_quiet(db, before)


def test_system_impersonate_and_exit_keep_behavior(db):
    _seed(db)
    client = _client()
    path = "/api/system/companies/comp_a/impersonate"
    missing = client.post(path)
    assert missing.status_code == 401
    assert missing.json()["detail"] == "Sistem paneli oturumu bulunamadı; tekrar giriş yapın."
    assert db.handoffs == []

    ok = client.post(path, cookies={"access_token": "sa-return-cookie"})
    assert ok.status_code == 200, ok.text
    body = ok.json()
    assert "item" not in body
    assert body["status"] == "success"
    assert body["message"] == "Ada şirketine Ada (ada@example.com) olarak giriş yapıldı. Destek modu 2 saat geçerlidir."
    assert body["company_name"] == "Ada"
    assert body["as_user"] == "ada@example.com"
    assert body["code"]
    session = db.support_sessions.docs[body["session_id"]]
    started = datetime.fromisoformat(session["started_at"])
    expires = datetime.fromisoformat(session["expires_at"])
    assert abs((expires - started).total_seconds() - 120 * 60) < 2
    system_blob = json.loads(next(row["token"] for row in db.handoffs if row["code"] == body["code"]))
    assert system_blob["sa_return"] == "sa-return-cookie"
    claims = _decode(system_blob["access_token"])
    assert claims["aud"] == "app"
    assert "imp_via" not in claims
    assert claims["imp_by"] == "sa@example.com"
    enter = _enter_audits(db)[-1]
    assert enter["actor_type"] == "superadmin"
    assert enter["actor_id"] == "sa1"
    assert enter["details"] == {"as_user": "ada@example.com", "session_id": body["session_id"]}

    exit_plain = client.post("/api/auth/impersonate/exit")
    assert exit_plain.status_code == 400
    assert exit_plain.json()["detail"] == "Destek oturumu bulunamadı."
    exit_cookie = client.post(
        "/api/auth/impersonate/exit",
        cookies={"access_token": "not-a-jwt"},
    )
    assert exit_cookie.status_code == 400
    assert exit_cookie.json()["detail"] == "Destek oturumu bulunamadı."
    assert db.support_sessions.docs[body["session_id"]]["status"] == "active"
