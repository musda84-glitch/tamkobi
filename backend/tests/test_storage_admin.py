"""Veritabanı yönetimi. Canlı veritabanına ve 8021 portuna bağlanmaz."""
from __future__ import annotations

import asyncio
import logging
import os
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(Path(__file__).resolve().parent))

os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")
os.environ["STORAGE_ADMIN_AUTO_KICK"] = "0"

from dashboard_memdb import MemDB  # noqa: E402

import saas  # noqa: E402
import scripts.storage_move as storage_move  # noqa: E402
import storage_admin  # noqa: E402
import storage_router  # noqa: E402


@pytest.fixture(autouse=True)
def _quiet(monkeypatch):
    monkeypatch.setenv("STORAGE_ADMIN_AUTO_KICK", "0")
    monkeypatch.delenv("STORAGE_DBA_DSN", raising=False)
    monkeypatch.delenv("STORAGE_ROUTER_ENABLED", raising=False)
    storage_admin._worker_guard = False
    yield
    storage_admin._worker_guard = False


def _run(coro):
    return asyncio.run(coro)


def _company(cid="comp_a", name="Ada", mode="legacy", **extra):
    body = {"_id": cid, "name": name, "storage_mode": mode}
    body.update(extra)
    return body


def _order(cid, oid, name="Kalem"):
    return {"_id": oid, "company_id": cid, "name": name}


async def _seed(db):
    await db.companies.insert_one(_company())
    await db.companies.insert_one(_company("comp_b", "Örnek Firma", "legacy", is_demo=True))
    for index in range(3):
        await db.orders.insert_one(_order("comp_a", f"o{index}"))
    await db.orders.insert_one(_order("comp_b", "ob"))
    await db.files.insert_one({"_id": "f1", "company_id": "comp_a", "size": 100, "storage_path": "a"})
    await db.files.insert_one({"_id": "f2", "company_id": "comp_a", "size": 300, "storage_path": "b"})
    await db.files.insert_one({"_id": "f3", "company_id": "comp_a", "size": 9, "is_deleted": True})
    await db.users.insert_one({
        "_id": "u1", "name": "Ali", "company_ids": ["comp_a"], "is_active": True,
        "last_login_at": "2026-10-01T08:00:00+00:00",
    })
    await db.users.insert_one({
        "_id": "u2", "name": "Veli", "company_ids": ["comp_a"], "is_active": True,
        "last_login_at": "2026-10-23T09:12:00+00:00",
    })
    await db.users.insert_one({
        "_id": "u3", "name": "Pasif", "company_ids": ["comp_a"], "is_active": False,
        "last_login_at": "2026-10-24T09:12:00+00:00",
    })
    await db.users.insert_one({
        "_id": "u4", "name": "Süper", "company_ids": ["comp_a"], "is_super_admin": True, "is_active": True,
    })


def test_recommend_follows_thresholds():
    thresholds = dict(storage_admin.DEFAULT_THRESHOLDS)
    under = storage_admin.recommend("legacy", 10, 1, 1, 0, thresholds)
    assert under["mode"] == "shared_v2"
    assert under["suitable"] is True
    assert "Legacy" in under["reason"]
    assert storage_admin.recommend("shared_v2", 10, 1, 1, None, thresholds)["mode"] == "shared_v2"
    assert storage_admin.recommend("shared_v2", 100_001, 1, 1, None, thresholds)["mode"] == "dedicated"
    assert storage_admin.recommend("shared_v2", 10, 51, 1, None, thresholds)["mode"] == "dedicated"
    assert storage_admin.recommend("shared_v2", 10, 1, 6, None, thresholds)["mode"] == "dedicated"
    growth = storage_admin.recommend("shared_v2", 10, 1, 1, 21, thresholds)
    assert growth["mode"] == "dedicated"
    assert growth["suitable"] is False
    assert storage_admin.recommend("shared_v2", 10, 1, 1, 20, thresholds)["mode"] == "shared_v2"
    assert storage_admin.recommend("dedicated", 10, 1, 1, None, thresholds)["suitable"] is True


def test_measure_counts_and_recommendation():
    async def _case():
        db = MemDB()
        await _seed(db)
        await storage_admin.save_thresholds(db, {
            "records": 2, "data_mb": 50, "users": 5, "growth_pct": 20,
        }, {"id": "sa", "name": "Ada"})
        day = "2026-10-23"
        await db[storage_admin.SNAPSHOTS].insert_one({
            "_id": "comp_a:2026-09-01", "company_id": "comp_a", "day": "2026-09-01", "bytes": 1,
        })
        result = await storage_admin.measure_all(db, today=day)
        assert result["companies"] == 2
        summary = await db[storage_admin.SUMMARIES].find_one({"_id": "comp_a"})
        assert summary["records"] == 3
        assert summary["files"] == 2
        assert summary["file_bytes"] == 400
        assert summary["users"] == 2
        assert summary["last_login_at"] == "2026-10-23T09:12:00+00:00"
        assert summary["bytes"] > 0
        assert summary["recommended"] == "dedicated"
        other = await db[storage_admin.SUMMARIES].find_one({"_id": "comp_b"})
        assert other["records"] == 1
        assert other["recommended"] == "shared_v2"
        assert other["users"] == 0
        view = await storage_admin.overview(db)
        assert view["totals"]["real"] == 1
        assert view["totals"]["test"] == 1
        assert view["measured_at"]
        blob = str(view)
        assert "dedicated_dsn_ref" not in blob
        assert "mysql://" not in blob
        assert "password" not in blob

    _run(_case())


def test_actions_call_storage_move_and_write_audit(monkeypatch):
    calls = []

    async def plan(db, company_id, to_mode):
        calls.append(("plan", company_id, to_mode))
        return storage_move.MoveReport(
            ok=True, dry_run=True, company_id=company_id, from_mode="legacy", to_mode=to_mode,
            status="dry-run", collections=[{"name": "orders", "count": 3, "bytes": 30}],
        )

    async def apply(db, company_id, to_mode, *, batch_size=50, on_batch=None):
        calls.append(("apply", company_id, to_mode))
        if on_batch:
            result = on_batch("orders", 3)
            if hasattr(result, "__await__"):
                await result
        return storage_move.MoveReport(
            ok=True, wrote=True, dry_run=False, move_id="mv1", company_id=company_id,
            from_mode="legacy", to_mode=to_mode, status="completed",
            collections=[{"name": "orders", "count": 3, "bytes": 30}],
            counts={"orders": {"source": 3, "target": 3}},
            checksums={"orders": {"source": "a", "target": "a"}},
            duration_ms=1000,
        )

    async def rollback(db, move_id, *, batch_size=50, on_batch=None):
        calls.append(("rollback", move_id))
        return storage_move.MoveReport(ok=True, move_id=move_id, status="rolled_back", company_id="comp_a")

    async def recover(db, move_id):
        calls.append(("recover", move_id))
        return storage_move.MoveReport(ok=True, move_id=move_id, status="recovered", company_id="comp_a")

    monkeypatch.setattr(storage_move, "plan_move", plan)
    monkeypatch.setattr(storage_move, "apply_move", apply)
    monkeypatch.setattr(storage_move, "rollback_move", rollback)
    monkeypatch.setattr(storage_move, "recover_move", recover)
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")

    async def _case():
        db = MemDB()
        await db.companies.insert_one(_company())
        actor = {"id": "sa", "name": "Mustafa"}
        dry = await storage_admin.enqueue(db, kind="dry_run", company_id="comp_a", actor=actor, to_mode="shared_v2")
        assert dry["status"] == "queued"
        assert await storage_admin.worker(db) == 1
        assert calls[0] == ("plan", "comp_a", "shared_v2")
        summary = await db[storage_admin.SUMMARIES].find_one({"_id": "comp_a"})
        assert summary["last_dry_run"]["ok"] is True
        applied = await storage_admin.enqueue(db, kind="apply", company_id="comp_a", actor=actor, to_mode="shared_v2")
        assert applied["status"] == "queued"
        await storage_admin.worker(db)
        assert ("apply", "comp_a", "shared_v2") in calls
        job = await db[storage_admin.JOBS].find_one({"_id": applied["job_id"]})
        assert job["status"] == "completed"
        assert job["progress"]["collection"] == "orders"
        await db.storage_moves.insert_one({
            "_id": "mv1", "company_id": "comp_a", "from_mode": "legacy", "to_mode": "shared_v2", "status": "completed",
        })
        await db.companies.update_one({"_id": "comp_a"}, {"$set": {"storage_mode": "shared_v2"}})
        back = await storage_admin.enqueue(
            db, kind="rollback", company_id="comp_a", actor=actor, move_id="mv1",
        )
        await storage_admin.worker(db)
        assert ("rollback", "mv1") in calls
        await storage_admin.enqueue(db, kind="recover", company_id="comp_a", actor=actor, move_id="mv1")
        await storage_admin.worker(db)
        assert ("recover", "mv1") in calls
        audits = await storage_admin._all(db, storage_admin.AUDITS)
        actions = {row.get("action") for row in audits}
        assert "storage_admin.dry_run" in actions
        assert "storage_admin.apply" in actions
        assert "storage_admin.rollback" in actions
        assert "storage_admin.recover" in actions
        assert all(row.get("user_id") == "sa" for row in audits)
        assert back["job_id"]

    _run(_case())


def test_pool_without_lease_does_not_run_the_job(monkeypatch):
    async def boom(*_args, **_kwargs):
        raise RuntimeError("platform_locks yok")

    monkeypatch.setattr("platform_lease.try_acquire", boom)

    async def _case():
        db = MemDB()
        db._pool = object()
        called = {"n": 0}

        async def claim(_db, now=None):
            called["n"] += 1
            return None

        monkeypatch.setattr(storage_admin, "claim_next", claim)
        assert await storage_admin.worker(db) == 0
        assert called["n"] == 0

    _run(_case())


def test_second_move_rejected_without_dry_run_and_schedule_cancels(monkeypatch):
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")

    async def boom(*args, **kwargs):
        raise AssertionError("storage_move çağrılmamalı")

    monkeypatch.setattr(storage_move, "apply_move", boom)
    monkeypatch.setattr(storage_move, "plan_move", boom)

    async def _case():
        db = MemDB()
        await db.companies.insert_one(_company())
        actor = {"id": "sa", "name": "Mustafa"}
        with pytest.raises(storage_admin.StorageAdminError, match="deneme"):
            await storage_admin.enqueue(db, kind="apply", company_id="comp_a", actor=actor, to_mode="dedicated")
        await db[storage_admin.SUMMARIES].insert_one({
            "_id": "comp_a",
            "last_dry_run": {"ok": True, "to_mode": "dedicated", "collections": 1},
        })
        await db[storage_admin.JOBS].insert_one({
            "_id": "running", "kind": "apply", "company_id": "comp_a", "status": "running", "started_at": storage_admin._iso(),
        })
        with pytest.raises(storage_admin.StorageAdminError, match="tek taşıma"):
            await storage_admin.enqueue(db, kind="apply", company_id="comp_a", actor=actor, to_mode="dedicated")
        await db[storage_admin.JOBS].delete_one({"_id": "running"})
        planned = await storage_admin.enqueue(
            db, kind="apply", company_id="comp_a", actor=actor, to_mode="dedicated", when="maintenance",
        )
        assert planned["status"] == "scheduled"
        assert planned["scheduled_for"]
        cancelled = await storage_admin.cancel_job(db, planned["job_id"], actor)
        assert cancelled["status"] == "cancelled"
        assert await storage_admin.worker(db) == 0
        with pytest.raises(storage_admin.StorageAdminError, match="planlanan"):
            await storage_admin.cancel_job(db, planned["job_id"], actor)

    _run(_case())


def test_router_off_rejects_apply(monkeypatch):
    monkeypatch.delenv("STORAGE_ROUTER_ENABLED", raising=False)

    async def _case():
        db = MemDB()
        await db.companies.insert_one(_company())
        await db[storage_admin.SUMMARIES].insert_one({
            "_id": "comp_a", "last_dry_run": {"ok": True, "to_mode": "shared_v2"},
        })
        with pytest.raises(storage_admin.StorageAdminError, match="kapalı"):
            await storage_admin.enqueue(
                db, kind="apply", company_id="comp_a", actor={"id": "sa", "name": "A"}, to_mode="shared_v2",
            )

    _run(_case())


def test_prepare_dedicated_seals_without_leaking(monkeypatch, caplog):
    captured = {}

    class Conn:
        def __init__(self):
            self.statements = []

        def execute(self, sql, params=None):
            self.statements.append((sql, params))

        def close(self):
            captured["closed"] = True

    conn = Conn()

    def connect(dsn):
        captured["admin"] = dsn
        return conn

    def migrate(dsn):
        captured["migrated"] = dsn

    def seal(dsn):
        captured["sealed_plain"] = dsn
        return "gAAAA-sealed-token"

    monkeypatch.setenv("STORAGE_DBA_DSN", "mysql://dba:S3cret-Value@127.0.0.1:9/mysql")
    monkeypatch.setattr(storage_admin, "connect_admin", connect)
    monkeypatch.setattr(storage_admin, "apply_migrations", migrate)
    monkeypatch.setattr(storage_router, "seal_dedicated_dsn", seal)

    async def _case():
        db = MemDB()
        await db.companies.insert_one(_company("comp_a"))
        with pytest.raises(storage_admin.StorageAdminError, match="ayrı onay"):
            await storage_admin.prepare_dedicated(db, "comp_a", confirm=False, actor={"id": "sa", "name": "M"})
        with caplog.at_level(logging.INFO, logger="storage_admin"):
            result = await storage_admin.prepare_dedicated(
                db, "comp_a", confirm=True, actor={"id": "sa", "name": "M"},
            )
        company = await db.companies.find_one({"_id": "comp_a"})
        assert company["dedicated_dsn_ref"] == "gAAAA-sealed-token"
        assert result["has_dedicated_dsn"] is True
        assert result["created"] is True
        assert "S3cret-Value" not in str(result)
        assert "mysql://" not in str(result)
        grant = [sql for sql, _params in conn.statements if sql.startswith("GRANT")]
        assert grant and "tk_compa" in grant[0]
        assert "ON *.*" not in grant[0]
        assert "S3cret-Value" not in grant[0]
        assert any(params and "S3cret-Value" not in (params or ()) for _sql, params in conn.statements if params)
        blob = caplog.text + str(result)
        assert "S3cret-Value" not in blob
        assert "mysql://" not in blob
        assert captured["migrated"].endswith("/tk_compa")
        assert captured["sealed_plain"] == captured["migrated"]

    _run(_case())


def test_prepare_without_admin_privilege_does_not_connect(monkeypatch):
    def connect(_dsn):
        raise AssertionError("bağlantı açılmamalı")

    monkeypatch.setattr(storage_admin, "connect_admin", connect)
    monkeypatch.delenv("STORAGE_DBA_DSN", raising=False)

    async def _case():
        db = MemDB()
        await db.companies.insert_one(_company())
        with pytest.raises(storage_admin.StorageAdminError, match="yönetici yetkisi"):
            await storage_admin.prepare_dedicated(db, "comp_a", confirm=True, actor={"id": "sa", "name": "M"})

    _run(_case())


def test_dedicated_statements_limit_privileges():
    database, user = storage_admin.dedicated_names("comp_505a96e8")
    statements = storage_admin.dedicated_statements(database, user, "S3cret-Value")
    sql = "\n".join(item[0] for item in statements)
    assert f"CREATE DATABASE IF NOT EXISTS `{database}`" in sql
    assert "IDENTIFIED BY %s" in sql
    assert "S3cret-Value" not in sql
    assert "SUPER" not in sql
    assert "FILE" not in sql
    assert "CREATE USER" not in sql.split("GRANT", 1)[1]
    assert f"ON `{database}`.*" in sql


def test_endpoints_require_super_admin_and_2fa(monkeypatch):
    db = MemDB()
    storage_admin.init(db)
    saas._db = db
    app = FastAPI()
    app.include_router(storage_admin.router)
    client = TestClient(app)

    missing = client.get("/api/system/storage-admin")
    assert missing.status_code == 401

    async def normal(token, database, **kwargs):
        return {"_id": "u", "is_super_admin": False, "name": "Ada"}

    monkeypatch.setattr(saas, "get_user_from_token", normal)
    denied = client.get("/api/system/storage-admin", headers={"Authorization": "Bearer tok"})
    assert denied.status_code == 403

    async def no_2fa(token, database, **kwargs):
        return {"_id": "sa", "is_super_admin": True, "totp_enabled": False, "name": "M"}

    async def required(_db):
        return True

    monkeypatch.setattr(saas, "get_user_from_token", no_2fa)
    import superadmin_2fa
    monkeypatch.setattr(superadmin_2fa, "platform_requires_2fa", required)
    blocked = client.get("/api/system/storage-admin", headers={"Authorization": "Bearer tok"})
    assert blocked.status_code == 403
    assert blocked.json()["detail"]["code"] == "2fa_setup_required"

    async def ready(token, database, **kwargs):
        return {
            "_id": "sa", "is_super_admin": True, "totp_enabled": True,
            "totp_secret": "gAAAA-should-not-leak", "name": "Mustafa",
        }

    monkeypatch.setattr(saas, "get_user_from_token", ready)
    allowed = client.get("/api/system/storage-admin", headers={"Authorization": "Bearer tok"})
    assert allowed.status_code == 200
    assert allowed.json()["totals"]["companies"] == 0
    assert "gAAAA-should-not-leak" not in allowed.text
    assert "mysql://" not in allowed.text


def test_apply_migrations_uses_only_the_given_target(monkeypatch):
    seen = {}

    class Session:
        def close(self):
            seen["closed"] = True

    def connect(dsn, *, write):
        seen["dsn"] = dsn
        seen["write"] = write
        return Session()

    def apply(session, migrations=None, *, confirm, dry_run):
        seen["confirm"] = confirm
        seen["dry_run"] = dry_run
        return None

    monkeypatch.setattr("storage_migrations.session.connect", connect)
    monkeypatch.setattr("storage_migrations.engine.apply", apply)
    storage_admin.apply_migrations("sqlite:///tmp/only-this-target.db")
    assert seen["dsn"].endswith("only-this-target.db")
    assert seen["write"] is True
    assert seen["confirm"] is True
    assert seen["dry_run"] is False
    assert seen["closed"] is True
