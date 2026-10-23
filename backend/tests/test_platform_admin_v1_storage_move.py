"""admin-v1 veritabanı taşıma sözleşmesi. Bellek FakeDB. Taşıma çalıştırılmaz."""
from __future__ import annotations

import asyncio
import json
import os

import pyotp
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-admin-v1-storage-move-jwt-secret")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")
os.environ["STORAGE_ADMIN_AUTO_KICK"] = "0"

import comm_service  # noqa: E402
import platform_admin_v1_danger as danger  # noqa: E402
import platform_admin_v1_storage_move as storage_api  # noqa: E402
import platform_store as store  # noqa: E402
import saas  # noqa: E402
import scripts.storage_move as storage_move  # noqa: E402
import storage_admin  # noqa: E402
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
_TOTP = pyotp.random_base32()
_REASON = "Firma verisini bakim penceresinde guvenli tasimak icin"
_SECRET = "S3cret-Value"
_DSN = "mysql://app:S3cret-Value@10.1.1.1/tk_comp"
_DBA = "mysql://dba:S3cret-Value@127.0.0.1:9/mysql"
_IBAN = "TR330006100519786457841326"
_VKN = "1234567890"
_SEALED = "sealed-DSN-SECRET"
_ADMIN_ALLOW_REASON = (
    "Platform yönetim API'si; HMAC platform_admin anahtarı "
    "(kind=platform_admin, admin.* kapsamı), şirket oturumu yok"
)
_FORBIDDEN = (_SECRET, _DSN, _DBA, _IBAN, _VKN, _SEALED, "mysql://app", "mysql://dba")
_SECRET_KEYS = {
    "password", "password_hash", "dsn", "dedicated_dsn_ref", "app_dsn", "admin_dsn",
    "iban", "iban_no", "vkn", "tax_number", "tax_id", "tckn", "secret", "token",
    "db_password",
}


def _otp() -> str:
    return pyotp.TOTP(_TOTP).now()


def _app():
    app = FastAPI()
    app.include_router(storage_api.router)
    app.include_router(danger.router)
    return app


def _client() -> TestClient:
    return TestClient(with_peer(_app(), "198.51.100.20"))


def _send(client, secret, key_id, method, path, payload=None, *, params=None, idem="auto"):
    raw = b"" if payload is None else json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    headers, _, nonce = _signed_headers(secret, key_id, method, path, raw)
    if idem == "auto":
        idem = None if method == "GET" else "idem-1"
    if idem is not None:
        headers["Idempotency-Key"] = idem
    response = client.request(method, path, content=raw, params=params, headers=headers)
    return response, nonce


def _audits(db, action=None):
    rows = list(db.platform_audit_log.docs.values())
    if action is None:
        return rows
    return [row for row in rows if row.get("action") == action]


def _jobs(db):
    return list(db.storage_admin_jobs.docs.values())


def _assert_clean(payload):
    blob = json.dumps(payload, ensure_ascii=False)
    for item in _FORBIDDEN:
        assert item not in blob, item
    found = []

    def walk(obj):
        if isinstance(obj, dict):
            for key, value in obj.items():
                found.append(str(key).lower())
                walk(value)
        elif isinstance(obj, list):
            for value in obj:
                walk(value)

    walk(payload)
    assert not _SECRET_KEYS.intersection(found), found


def _block_moves(monkeypatch):
    calls = []

    async def blocked(*args, **kwargs):
        calls.append(("async", args, kwargs))
        raise AssertionError("taşıma çalıştırılmamalı")

    def blocked_sync(*args, **kwargs):
        calls.append(("sync", args, kwargs))
        raise AssertionError("dedicated hazırlık çalıştırılmamalı")

    monkeypatch.setattr(storage_move, "plan_move", blocked)
    monkeypatch.setattr(storage_move, "apply_move", blocked)
    monkeypatch.setattr(storage_move, "rollback_move", blocked)
    monkeypatch.setattr(storage_move, "recover_move", blocked)
    monkeypatch.setattr(storage_admin, "provision_dedicated_database", blocked_sync)
    return calls


@pytest.fixture
def db(monkeypatch):
    fake = FakeDB()
    prev = (store._db, saas._db, saas._current_user, storage_admin._db)
    monkeypatch.setenv("STORAGE_ADMIN_AUTO_KICK", "0")
    monkeypatch.delenv("STORAGE_DBA_DSN", raising=False)
    monkeypatch.delenv("STORAGE_ROUTER_ENABLED", raising=False)
    monkeypatch.setattr(comm_service, "encrypt", lambda value: "enc:" + (value or ""))
    monkeypatch.setattr(comm_service, "decrypt", lambda value: (value or "").removeprefix("enc:"))
    monkeypatch.setattr(superadmin_2fa, "encrypt", lambda value: "enc:" + (value or ""))
    monkeypatch.setattr(superadmin_2fa, "decrypt", lambda value: (value or "").removeprefix("enc:"))
    store.init(fake)
    saas.init(fake, None)
    saas.invalidate()
    storage_admin.init(fake)
    storage_admin._worker_guard = False
    yield fake
    store.init(prev[0])
    saas.init(prev[1], prev[2])
    storage_admin.init(prev[3])
    storage_admin._worker_guard = False
    saas.invalidate()


def _reset_otp(db):
    async def run():
        await db.users.update_one({"_id": "usr_ops"}, {"$set": {"totp_last_counter": None}})

    asyncio.run(run())


def _seed(db, *, dry=True):
    async def run():
        await db.companies.insert_one({
            "_id": "comp_a",
            "name": "Ada Ltd",
            "storage_mode": "legacy",
            "tax_number": _VKN,
            "vkn": _VKN,
            "iban": _IBAN,
            "dedicated_dsn_ref": _SEALED,
            "password": _SECRET,
            "dsn": _DSN,
        })
        await db.companies.insert_one({
            "_id": "comp_b",
            "name": "Beta A.Ş.",
            "storage_mode": "legacy",
        })
        summary = {
            "_id": "comp_a",
            "company_id": "comp_a",
            "records": 12,
            "bytes": 4096,
            "users": 2,
            "growth_pct": 1,
            "files": 1,
            "file_bytes": 10,
            "password": _SECRET,
            "tax_number": _VKN,
            "dsn": _DSN,
        }
        if dry:
            summary["last_dry_run"] = {
                "ok": True,
                "to_mode": "shared_v2",
                "collections": 2,
                "bytes": 4096,
                "errors": [f"{_DSN} VKN {_VKN} {_IBAN}"],
                "dsn": _DSN,
                "iban": _IBAN,
                "password": _SECRET,
            }
        await db.storage_measure_summaries.insert_one(summary)
        await db.storage_moves.insert_one({
            "_id": "mv1",
            "company_id": "comp_a",
            "from_mode": "legacy",
            "to_mode": "shared_v2",
            "status": "completed",
            "started_at": "2026-10-01T00:00:00+00:00",
            "finished_at": "2026-10-01T00:05:00+00:00",
            "dsn": _DSN,
            "password": _SECRET,
            "error": f"{_DSN} VKN {_VKN}",
        })
        await db.storage_admin_jobs.insert_one({
            "_id": "job_done",
            "kind": "apply",
            "company_id": "comp_a",
            "from_mode": "legacy",
            "to_mode": "shared_v2",
            "move_id": "mv1",
            "status": "completed",
            "created_at": "2026-10-01T00:00:00+00:00",
            "started_at": "2026-10-01T00:00:00+00:00",
            "finished_at": "2026-10-01T00:05:00+00:00",
            "progress": {"pct": 100, "done": 2, "total": 2, "records": 12, "collection": "orders"},
            "error": f"{_DSN} VKN {_VKN} {_IBAN}",
            "password": _SECRET,
            "dsn": _DSN,
            "result": {"bytes": 4096, "duration_ms": 1000},
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

    asyncio.run(run())


def _confirm(client, secret, key_id, action, prep, *, phrase, text, idem):
    return _send(
        client, secret, key_id, "POST",
        f"/api/platform/admin-v1/danger/{action}/confirm",
        {
            "confirmation_token": prep["confirmation_token"],
            "confirm_text": text,
            "confirm_phrase": phrase,
            "operator_otp": _otp(),
        },
        idem=idem,
    )


def test_scopes_and_allowlist():
    assert store.SCOPE_ADMIN_STORAGE_MOVE_READ == "admin.storage_move:read"
    assert store.SCOPE_ADMIN_STORAGE_MOVE_WRITE == "admin.storage_move:write"
    assert store.SCOPE_ADMIN_STORAGE_MOVE_READ in store.ADMIN_SCOPES
    assert store.SCOPE_ADMIN_STORAGE_MOVE_WRITE in store.ADMIN_SCOPES
    for action in danger._STORAGE_MOVE_ACTIONS:
        assert action in danger._ACTIONS
        assert action in danger._PHRASE_ACTIONS
        assert danger._phrase_for(action)
    paths = (
        ("GET", "/platform/admin-v1/storage-move/companies/{company_id}"),
        ("GET", "/platform/admin-v1/storage-move/jobs/{job_id}"),
        ("GET", "/platform/admin-v1/storage-move/moves/{move_id}"),
        ("POST", "/platform/admin-v1/storage-move/companies/{company_id}/dry-run"),
        ("POST", "/platform/admin-v1/storage-move/jobs/{job_id}/cancel"),
    )
    for pair in paths:
        assert pair in allowlist.TENANT_IDOR_ALLOWLIST
        assert allowlist.ALLOWLIST_REASONS[pair] == _ADMIN_ALLOW_REASON
    mounted = {route.path for route in storage_api.router.routes}
    assert "/api/platform/admin-v1/storage-move/companies/{company_id}/apply" not in mounted
    assert "/api/platform/admin-v1/storage-move/companies/{company_id}/rollback" not in mounted


def test_reads_hide_secrets_and_require_scope(db, monkeypatch):
    _block_moves(monkeypatch)
    _seed(db)
    reader, secret = _issue(db, [store.SCOPE_ADMIN_STORAGE_MOVE_READ], name="reader")
    writer, writer_secret = _issue(db, [store.SCOPE_ADMIN_STORAGE_MOVE_WRITE], name="writer")
    client = _client()
    missing = client.get("/api/platform/admin-v1/storage-move")
    assert missing.status_code == 401
    assert _detail(missing) == "Eksik imza başlıkları"

    denied, _ = _send(client, writer_secret, writer["id"], "GET", "/api/platform/admin-v1/storage-move")
    assert denied.status_code == 403
    assert _detail(denied) == "Kapsam yetersiz"

    overview, _ = _send(client, secret, reader["id"], "GET", "/api/platform/admin-v1/storage-move")
    assert overview.status_code == 200, overview.text
    body = overview.json()["item"]
    _assert_clean(body)
    ada = next(row for row in body["companies"] if row["id"] == "comp_a")
    assert ada["records"] == 12
    assert ada["bytes"] == 4096
    assert ada["users"] == 2
    assert ada["recommended"] == "shared_v2"
    assert ada["has_dedicated_dsn"] is True
    assert body["thresholds"]["records"] == storage_admin.DEFAULT_THRESHOLDS["records"]
    assert body["maintenance"]["start"]
    assert body["moves"]
    assert _audits(db, "admin_v1.admin.storage_move:read")

    company, _ = _send(
        client, secret, reader["id"], "GET",
        "/api/platform/admin-v1/storage-move/companies/comp_a",
    )
    assert company.status_code == 200, company.text
    _assert_clean(company.json())
    assert company.json()["item"]["company"]["records"] == 12
    assert company.json()["item"]["thresholds"]["users"] == 5

    missing_company, _ = _send(
        client, secret, reader["id"], "GET",
        "/api/platform/admin-v1/storage-move/companies/nope",
    )
    assert missing_company.status_code == 404

    history, _ = _send(
        client, secret, reader["id"], "GET",
        "/api/platform/admin-v1/storage-move/history",
        params={"company_id": "comp_a", "limit": 10, "offset": 0},
    )
    assert history.status_code == 200, history.text
    _assert_clean(history.json())
    assert history.json()["total"] >= 1
    assert history.json()["items"][0]["company_id"] == "comp_a"

    job, _ = _send(
        client, secret, reader["id"], "GET",
        "/api/platform/admin-v1/storage-move/jobs/job_done",
    )
    assert job.status_code == 200, job.text
    _assert_clean(job.json())
    assert job.json()["item"]["status"] == "completed"
    assert job.json()["item"]["progress"]["records"] == 12

    move, _ = _send(
        client, secret, reader["id"], "GET",
        "/api/platform/admin-v1/storage-move/moves/mv1",
    )
    assert move.status_code == 200, move.text
    _assert_clean(move.json())
    assert move.json()["item"]["move_id"] == "mv1"


def test_product_and_bound_keys_cannot_read(db, monkeypatch):
    _block_moves(monkeypatch)
    _seed(db)
    _plant_key(
        db, key_id="pk_product_move", secret="product-secret", kind="product",
        scopes=[store.SCOPE_ADMIN_STORAGE_MOVE_READ],
    )
    _plant_key(
        db, key_id="pk_bound_move", secret="bound-secret", kind="platform_admin",
        scopes=[store.SCOPE_ADMIN_STORAGE_MOVE_READ], instance_id="comp_a",
    )
    client = _client()
    product, _ = _send(
        client, "product-secret", "pk_product_move", "GET",
        "/api/platform/admin-v1/storage-move",
    )
    bound, _ = _send(
        client, "bound-secret", "pk_bound_move", "GET",
        "/api/platform/admin-v1/storage-move",
    )
    assert product.status_code == 403
    assert bound.status_code == 403
    assert _detail(product) == "Kapsam yetersiz"
    assert _detail(bound) == "Kapsam yetersiz"


def test_thresholds_and_dry_run_keep_guards(db, monkeypatch):
    calls = _block_moves(monkeypatch)
    _seed(db, dry=False)
    reader, reader_secret = _issue(db, [store.SCOPE_ADMIN_STORAGE_MOVE_READ], name="reader")
    writer, secret = _issue(db, [store.SCOPE_ADMIN_STORAGE_MOVE_WRITE], name="writer")
    client = _client()
    current, _ = _send(client, reader_secret, reader["id"], "GET", "/api/platform/admin-v1/storage-move/thresholds")
    assert current.status_code == 200
    assert current.json()["item"]["records"] == 100000

    no_key, _ = _send(
        client, secret, writer["id"], "PUT",
        "/api/platform/admin-v1/storage-move/thresholds",
        {"records": 200000, "data_mb": 80, "users": 8, "growth_pct": 25},
        idem=None,
    )
    assert no_key.status_code == 400
    assert _detail(no_key) == "Idempotency-Key gerekli"

    denied, _ = _send(
        client, reader_secret, reader["id"], "PUT",
        "/api/platform/admin-v1/storage-move/thresholds",
        {"records": 200000, "data_mb": 80, "users": 8, "growth_pct": 25},
        idem="read-no",
    )
    assert denied.status_code == 403

    bad, _ = _send(
        client, secret, writer["id"], "PUT",
        "/api/platform/admin-v1/storage-move/thresholds",
        {"records": True, "data_mb": 80, "users": 8, "growth_pct": 25, "password": _SECRET},
        idem="bad-threshold",
    )
    assert bad.status_code == 400

    saved, _ = _send(
        client, secret, writer["id"], "PUT",
        "/api/platform/admin-v1/storage-move/thresholds",
        {"records": 200000, "data_mb": 80, "users": 8, "growth_pct": 25},
        idem="put-1",
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["item"]["records"] == 200000
    again, _ = _send(
        client, secret, writer["id"], "PUT",
        "/api/platform/admin-v1/storage-move/thresholds",
        {"records": 200000, "data_mb": 80, "users": 8, "growth_pct": 25},
        idem="put-1",
    )
    assert again.status_code == 200
    assert again.json()["item"]["records"] == 200000
    clash, _ = _send(
        client, secret, writer["id"], "PUT",
        "/api/platform/admin-v1/storage-move/thresholds",
        {"records": 10, "data_mb": 80, "users": 8, "growth_pct": 25},
        idem="put-1",
    )
    assert clash.status_code == 409
    reset, _ = _send(
        client, secret, writer["id"], "POST",
        "/api/platform/admin-v1/storage-move/thresholds/reset",
        {},
        idem="reset-1",
    )
    assert reset.status_code == 200, reset.text
    assert reset.json()["item"]["records"] == 100000
    assert _audits(db, "admin_v1.write.storage_move.thresholds")
    assert _audits(db, "admin_v1.write.storage_move.thresholds.reset")

    missing_mode, _ = _send(
        client, secret, writer["id"], "POST",
        "/api/platform/admin-v1/storage-move/companies/comp_a/dry-run",
        {},
        idem="dry-empty",
    )
    assert missing_mode.status_code == 400
    assert _detail(missing_mode) == "to_mode zorunlu."
    dry, _ = _send(
        client, secret, writer["id"], "POST",
        "/api/platform/admin-v1/storage-move/companies/comp_a/dry-run",
        {"to_mode": "shared_v2"},
        idem="dry-1",
    )
    assert dry.status_code == 200, dry.text
    _assert_clean(dry.json())
    assert dry.json()["item"]["status"] == "queued"
    assert len(_jobs(db)) == 2
    replay, _ = _send(
        client, secret, writer["id"], "POST",
        "/api/platform/admin-v1/storage-move/companies/comp_a/dry-run",
        {"to_mode": "shared_v2"},
        idem="dry-1",
    )
    assert replay.status_code == 200
    assert replay.json()["item"]["job_id"] == dry.json()["item"]["job_id"]
    assert len(_jobs(db)) == 2
    blocked, _ = _send(
        client, secret, writer["id"], "POST",
        "/api/platform/admin-v1/storage-move/companies/comp_a/dry-run",
        {"to_mode": "dedicated"},
        idem="dry-2",
    )
    assert blocked.status_code == 409
    assert "tek taşıma" in _detail(blocked)
    assert calls == []
    direct, _ = _send(
        client, secret, writer["id"], "POST",
        "/api/platform/admin-v1/storage-move/companies/comp_a/apply",
        {"to_mode": "shared_v2"},
        idem="no-apply",
    )
    assert direct.status_code == 404


def test_cancel_only_scheduled(db, monkeypatch):
    _block_moves(monkeypatch)
    _seed(db)

    async def extra():
        await db.storage_admin_jobs.insert_one({
            "_id": "job_plan",
            "kind": "apply",
            "company_id": "comp_a",
            "status": "scheduled",
            "scheduled_for": "2026-10-24T02:00:00+00:00",
            "to_mode": "shared_v2",
        })

    asyncio.run(extra())
    writer, secret = _issue(db, [store.SCOPE_ADMIN_STORAGE_MOVE_WRITE], name="writer")
    client = _client()
    running, _ = _send(
        client, secret, writer["id"], "POST",
        "/api/platform/admin-v1/storage-move/jobs/job_done/cancel",
        {},
        idem="cancel-done",
    )
    assert running.status_code == 409
    cancelled, _ = _send(
        client, secret, writer["id"], "POST",
        "/api/platform/admin-v1/storage-move/jobs/job_plan/cancel",
        {},
        idem="cancel-plan",
    )
    assert cancelled.status_code == 200, cancelled.text
    assert cancelled.json()["item"]["status"] == "cancelled"
    denied, _ = _send(
        client, secret, writer["id"], "GET",
        "/api/platform/admin-v1/storage-move/jobs/job_plan",
    )
    assert denied.status_code == 403
    reader, reader_secret = _issue(db, [store.SCOPE_ADMIN_STORAGE_MOVE_READ], name="reader-cancel")
    polled, _ = _send(
        client, reader_secret, reader["id"], "GET",
        "/api/platform/admin-v1/storage-move/jobs/job_plan",
    )
    assert polled.status_code == 200, polled.text
    _assert_clean(polled.json())
    assert polled.json()["item"]["status"] == "cancelled"


def test_apply_rollback_recover_and_prepare_use_danger(db, monkeypatch):
    calls = _block_moves(monkeypatch)
    _seed(db)
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    danger_only, danger_secret = _issue(db, [store.SCOPE_ADMIN_DANGEROUS], name="danger-only")
    write_only, write_secret = _issue(db, [store.SCOPE_ADMIN_STORAGE_MOVE_WRITE], name="write-only")
    both, secret = _issue(
        db,
        [store.SCOPE_ADMIN_DANGEROUS, store.SCOPE_ADMIN_STORAGE_MOVE_WRITE, store.SCOPE_ADMIN_STORAGE_MOVE_READ],
        name="both",
    )
    client = _client()
    path = "/api/platform/admin-v1/danger/storage_move.apply/prepare"
    base = {"target_id": "comp_a", "reason": _REASON, "operator_email": _OPERATOR, "to_mode": "shared_v2", "when": "now"}
    no_danger, _ = _send(client, write_secret, write_only["id"], "POST", path, base, idem="no-danger")
    assert no_danger.status_code == 403
    no_write, _ = _send(client, danger_secret, danger_only["id"], "POST", path, base, idem="no-write")
    assert no_write.status_code == 403
    assert _detail(no_write) == "Kapsam yetersiz"
    assert calls == []

    needs_dry, _ = _send(
        client, secret, both["id"], "POST", path,
        {**base, "target_id": "comp_b", "to_mode": "shared_v2"},
        idem="needs-dry",
    )
    assert needs_dry.status_code == 400
    assert "deneme" in _detail(needs_dry)

    bad_when, _ = _send(
        client, secret, both["id"], "POST", path,
        {**base, "when": "tomorrow"},
        idem="bad-when",
    )
    assert bad_when.status_code == 400
    assert "maintenance" in _detail(bad_when)

    prepared, _ = _send(client, secret, both["id"], "POST", path, base, idem="prep-apply")
    assert prepared.status_code == 200, prepared.text
    prep = prepared.json()
    _assert_clean(prep)
    assert prep["confirm_phrase"] == danger._MOVE_APPLY_PHRASE
    assert prep["target_label"] == "Ada Ltd"
    assert prep["preview"]["to_mode"] == "shared_v2"
    assert prep["preview"]["status"] == "queued"
    assert calls == []

    wrong, _ = _send(
        client, secret, both["id"], "POST",
        "/api/platform/admin-v1/danger/storage_move.apply/confirm",
        {
            "confirmation_token": prep["confirmation_token"],
            "confirm_text": "Ada Ltd",
            "confirm_phrase": "YANLIS",
            "operator_otp": _otp(),
        },
        idem="wrong-phrase",
    )
    assert wrong.status_code == 400
    assert danger._MOVE_APPLY_PHRASE in _detail(wrong)
    assert len([job for job in _jobs(db) if job.get("kind") == "apply" and job.get("status") == "queued"]) == 0

    _reset_otp(db)
    ok, _ = _confirm(
        client, secret, both["id"], "storage_move.apply", prep,
        phrase=danger._MOVE_APPLY_PHRASE, text="Ada Ltd", idem="confirm-apply",
    )
    assert ok.status_code == 200, ok.text
    _assert_clean(ok.json())
    assert ok.json()["item"]["status"] == "queued"
    assert calls == []
    assert _audits(db, "admin_v1.danger.storage_move.apply.confirm")
    queued = [job for job in _jobs(db) if job.get("_id") == ok.json()["item"]["job_id"]]
    assert queued and queued[0]["kind"] == "apply"
    replay, _ = _confirm(
        client, secret, both["id"], "storage_move.apply", prep,
        phrase=danger._MOVE_APPLY_PHRASE, text="Ada Ltd", idem="confirm-apply",
    )
    assert replay.status_code == 200
    assert replay.json()["item"]["job_id"] == ok.json()["item"]["job_id"]
    assert len([job for job in _jobs(db) if job.get("status") == "queued" and job.get("kind") == "apply"]) == 1

    busy, _ = _send(
        client, secret, both["id"], "POST", path,
        {**base, "when": "now"},
        idem="busy-apply",
    )
    assert busy.status_code == 409
    assert "tek taşıma" in _detail(busy)

    async def finish_queue():
        for job in list(db.storage_admin_jobs.docs.values()):
            if job.get("status") == "queued":
                job["status"] = "completed"

    asyncio.run(finish_queue())
    later, _ = _send(
        client, secret, both["id"], "POST", path,
        {**base, "when": "maintenance"},
        idem="prep-window",
    )
    assert later.status_code == 200, later.text
    assert later.json()["preview"]["status"] == "scheduled"
    assert later.json()["preview"]["scheduled_for"]
    _reset_otp(db)
    window, _ = _confirm(
        client, secret, both["id"], "storage_move.apply", later.json(),
        phrase=danger._MOVE_APPLY_PHRASE, text="Ada Ltd", idem="confirm-window",
    )
    assert window.status_code == 200, window.text
    assert window.json()["item"]["status"] == "scheduled"
    assert window.json()["item"]["scheduled_for"]
    assert calls == []

    back_path = "/api/platform/admin-v1/danger/storage_move.rollback/prepare"
    foreign, _ = _send(
        client, secret, both["id"], "POST", back_path,
        {"target_id": "comp_b", "reason": _REASON, "operator_email": _OPERATOR, "move_id": "mv1"},
        idem="foreign-move",
    )
    assert foreign.status_code == 404
    rolled, _ = _send(
        client, secret, both["id"], "POST", back_path,
        {"target_id": "comp_a", "reason": _REASON, "operator_email": _OPERATOR, "move_id": "mv1"},
        idem="prep-rollback",
    )
    assert rolled.status_code == 200, rolled.text
    assert rolled.json()["confirm_phrase"] == danger._MOVE_ROLLBACK_PHRASE
    _reset_otp(db)
    done_back, _ = _confirm(
        client, secret, both["id"], "storage_move.rollback", rolled.json(),
        phrase=danger._MOVE_ROLLBACK_PHRASE, text="Ada Ltd", idem="confirm-rollback",
    )
    assert done_back.status_code == 200, done_back.text
    assert done_back.json()["item"]["status"] == "queued"
    assert calls == []

    async def finish_queue_again():
        for job in list(db.storage_admin_jobs.docs.values()):
            if job.get("status") == "queued":
                job["status"] = "completed"

    asyncio.run(finish_queue_again())
    recover_path = "/api/platform/admin-v1/danger/storage_move.recover/prepare"
    recovered, _ = _send(
        client, secret, both["id"], "POST", recover_path,
        {"target_id": "comp_a", "reason": _REASON, "operator_email": _OPERATOR, "move_id": "mv1"},
        idem="prep-recover",
    )
    assert recovered.status_code == 200, recovered.text
    assert recovered.json()["confirm_phrase"] == danger._MOVE_RECOVER_PHRASE
    _reset_otp(db)
    done_recover, _ = _confirm(
        client, secret, both["id"], "storage_move.recover", recovered.json(),
        phrase=danger._MOVE_RECOVER_PHRASE, text="Ada Ltd", idem="confirm-recover",
    )
    assert done_recover.status_code == 200, done_recover.text
    assert calls == []

    ready_path = "/api/platform/admin-v1/danger/storage_move.prepare_dedicated/prepare"
    ready, _ = _send(
        client, secret, both["id"], "POST", ready_path,
        {"target_id": "comp_a", "reason": _REASON, "operator_email": _OPERATOR},
        idem="prep-ready",
    )
    assert ready.status_code == 200, ready.text
    assert ready.json()["confirm_phrase"] == danger._MOVE_PREPARE_PHRASE
    assert ready.json()["preview"]["will_create"] is False
    assert ready.json()["preview"]["has_dedicated_dsn"] is True
    _assert_clean(ready.json())
    _reset_otp(db)
    kept, _ = _confirm(
        client, secret, both["id"], "storage_move.prepare_dedicated", ready.json(),
        phrase=danger._MOVE_PREPARE_PHRASE, text="Ada Ltd", idem="confirm-ready",
    )
    assert kept.status_code == 200, kept.text
    _assert_clean(kept.json())
    assert kept.json()["item"]["created"] is False
    assert kept.json()["item"]["has_dedicated_dsn"] is True
    assert calls == []

    missing_dba, _ = _send(
        client, secret, both["id"], "POST", ready_path,
        {"target_id": "comp_b", "reason": _REASON, "operator_email": _OPERATOR},
        idem="prep-create",
    )
    assert missing_dba.status_code == 200, missing_dba.text
    assert missing_dba.json()["preview"]["will_create"] is True
    _reset_otp(db)
    failed, _ = _confirm(
        client, secret, both["id"], "storage_move.prepare_dedicated", missing_dba.json(),
        phrase=danger._MOVE_PREPARE_PHRASE, text="Beta A.Ş.", idem="confirm-create",
    )
    assert failed.status_code == 400
    assert "yetki" in _detail(failed)
    assert calls == []
    beta = asyncio.run(db.companies.find_one({"_id": "comp_b"}))
    assert not str(beta.get("dedicated_dsn_ref") or "").strip()

    monkeypatch.setenv("STORAGE_DBA_DSN", _DBA)

    def fake_provision(admin, company_id):
        calls.append(("provision", company_id))
        assert company_id == "comp_b"
        return _SEALED

    monkeypatch.setattr(storage_admin, "provision_dedicated_database", fake_provision)
    created_prep, _ = _send(
        client, secret, both["id"], "POST", ready_path,
        {"target_id": "comp_b", "reason": _REASON, "operator_email": _OPERATOR},
        idem="prep-create-2",
    )
    assert created_prep.status_code == 200, created_prep.text
    _reset_otp(db)
    created, _ = _confirm(
        client, secret, both["id"], "storage_move.prepare_dedicated", created_prep.json(),
        phrase=danger._MOVE_PREPARE_PHRASE, text="Beta A.Ş.", idem="confirm-create-2",
    )
    assert created.status_code == 200, created.text
    _assert_clean(created.json())
    assert created.json()["item"]["created"] is True
    assert calls == [("provision", "comp_b")]
    stored = asyncio.run(db.companies.find_one({"_id": "comp_b"}))
    assert stored["dedicated_dsn_ref"] == _SEALED
    activity = [
        row for row in db.activity_logs.docs.values()
        if str(row.get("action") or "").startswith("storage_admin.")
    ]
    assert activity
    _assert_clean(activity)
