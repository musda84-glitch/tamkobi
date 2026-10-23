"""Taşıma kilidi ayrı süreçlerde. MariaDB 11.8 strict.

STORAGE_MARIADB_DSN veya STORAGE_SHARED_V2_TEST_DSN yoksa testler atlanır.
DSN varsa atlanmaz. Katalog ve shared_v2 ayrı veritabanıdır. Canlı
uygulamaya ve 8021 portuna bağlanmaz. Parola ve DSN çıktıya yazılmaz.
"""
from __future__ import annotations

import asyncio
import json
import multiprocessing
import os
import subprocess
import sys
import uuid
from pathlib import Path
from urllib.parse import unquote, urlparse

import pytest

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

import storage_router  # noqa: E402
import storage_shared_v2  # noqa: E402
from scripts import storage_move  # noqa: E402

_STRICT = "STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION"


def _base_dsn() -> str:
    return (
        os.environ.get("STORAGE_MARIADB_DSN")
        or os.environ.get("STORAGE_SHARED_V2_TEST_DSN")
        or ""
    ).strip()


def _parsed_dsn():
    raw = _base_dsn()
    if not raw:
        pytest.skip("STORAGE_MARIADB_DSN / STORAGE_SHARED_V2_TEST_DSN yok")
    return urlparse(raw.replace("mariadb://", "mysql://", 1).replace("mysql+pymysql://", "mysql://", 1))


@pytest.fixture(autouse=True)
def _needs_dsn():
    if not _base_dsn():
        pytest.skip("STORAGE_MARIADB_DSN / STORAGE_SHARED_V2_TEST_DSN yok")


def _admin():
    parsed = _parsed_dsn()
    import pymysql

    return pymysql.connect(
        host=parsed.hostname or "127.0.0.1",
        port=parsed.port or 3306,
        user=unquote(parsed.username or ""),
        password=unquote(parsed.password or ""),
        charset="utf8mb4",
        autocommit=True,
        connect_timeout=5,
    )


def _secret() -> str:
    return unquote(_parsed_dsn().password or "")


def _hide(text: str) -> None:
    secret = _secret()
    if secret:
        assert secret not in text


def _dsn(name: str) -> str:
    parsed = _parsed_dsn()
    user = unquote(parsed.username or "")
    password = unquote(parsed.password or "")
    auth = user if not password else f"{user}:{password}"
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or 3306
    return f"mysql://{auth}@{host}:{port}/{name}"


def _create(name: str) -> str:
    conn = _admin()
    try:
        with conn.cursor() as cur:
            cur.execute(
                f"CREATE DATABASE IF NOT EXISTS `{name}` "
                "CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci"
            )
    finally:
        conn.close()
    return _dsn(name)


def _drop(name: str) -> None:
    conn = _admin()
    try:
        with conn.cursor() as cur:
            cur.execute(f"DROP DATABASE IF EXISTS `{name}`")
    finally:
        conn.close()


def test_mariadb_11_8_strict_is_up():
    conn = _admin()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT VERSION()")
            version = str(cur.fetchone()[0])
            cur.execute("SELECT @@sql_mode")
            mode = str(cur.fetchone()[0])
    finally:
        conn.close()
    assert version.startswith("11.8"), version
    assert "STRICT_TRANS_TABLES" in mode


def _migrate(dsn: str) -> None:
    from storage_migrations.engine import apply
    from storage_migrations.session import connect

    session = connect(dsn, write=True)
    try:
        session.execute(f"SET SESSION sql_mode='{_STRICT}'")
        session.commit()
        apply(session, confirm=True, dry_run=False)
    finally:
        session.close()


def _env(catalog: str, shared: str) -> dict:
    env = os.environ.copy()
    env.update({
        "MYSQL_URL": catalog,
        "STORAGE_SHARED_V2_DSN": shared,
        "STORAGE_ROUTER_ENABLED": "1",
        "STORAGE_MOVE_LOCK_TTL": "0.3",
        "STORAGE_MOVE_MODE_TTL": "0.3",
        "STORAGE_MOVE_STALE_SECONDS": "30",
        "REACT_APP_BACKEND_URL": "http://127.0.0.1:9",
    })
    return env


def _client(catalog: str):
    os.environ["MYSQL_URL"] = catalog
    from mysql_store import MySQLClient, mysql_settings_from_env

    settings = mysql_settings_from_env()
    return MySQLClient()[settings["db"]]


def _spawn(spec: dict):
    ctx = multiprocessing.get_context("spawn")
    os.environ["PYTHONPATH"] = str(_BACKEND)
    spec = dict(spec)
    spec_env = dict(spec.get("env") or {})
    spec_env["PYTHONPATH"] = str(_BACKEND)
    spec["env"] = spec_env
    proc = ctx.Process(target=storage_move._process_entry, args=(spec,), daemon=True)
    proc.start()
    return proc


def _read_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def test_processes_lock_mode_parallel_and_recover(tmp_path, monkeypatch):
    token = uuid.uuid4().hex[:8]
    names = [f"smc_{token}", f"sms_{token}"]
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    monkeypatch.setenv("STORAGE_MOVE_LOCK_TTL", "0.3")
    monkeypatch.setenv("STORAGE_MOVE_MODE_TTL", "0.3")
    storage_router.reset()
    storage_shared_v2.reset_store()
    try:
        catalog = _create(names[0])
        shared = _create(names[1])
        _migrate(shared)
        monkeypatch.setenv("MYSQL_URL", catalog)
        monkeypatch.setenv("STORAGE_SHARED_V2_DSN", shared)
        env = _env(catalog, shared)
        company_a = "co_proc_a"
        company_b = "co_proc_b"

        async def seed():
            database = _client(catalog)
            try:
                for cid, number in ((company_a, "S-a"), (company_b, "S-b")):
                    await database.companies.insert_one({"_id": cid, "name": cid, "storage_mode": "legacy"})
                    await database.orders.insert_one({
                        "_id": f"o-{cid}",
                        "company_id": cid,
                        "order_number": number,
                        "order_status": "open",
                        "channel": "manual",
                        "total_amount": 5,
                    })
            finally:
                await database.close()

        asyncio.run(seed())
        db = _client(catalog)

        ready = tmp_path / "ready"
        tried = tmp_path / "tried"
        release = tmp_path / "release"
        write_result = tmp_path / "write.json"
        writer = _spawn({
            "action": "write",
            "company_id": company_a,
            "env": env,
            "ready": str(ready),
            "tried": str(tried),
            "release": str(release),
            "result": str(write_result),
        })

        async def on_batch(_name, _count):
            ready.write_text("1", encoding="utf-8")
            for _ in range(200):
                if tried.exists():
                    return
                await asyncio.sleep(0.05)
            raise TimeoutError("yazma denemesi gelmedi")

        async def _apply():
            try:
                return await storage_move.apply_move(
                    db, company_a, "shared_v2", batch_size=1, on_batch=on_batch,
                )
            finally:
                await db.close()

        report = asyncio.run(_apply())
        release.write_text("1", encoding="utf-8")
        writer.join(30)
        assert writer.exitcode == 0
        assert report.ok
        body = _read_json(write_result)
        assert body["blocked"] is True
        assert "salt okunur" in body["message"]
        assert body["mode"] == "shared_v2"
        assert body["landed"] == "ok"
        _hide(json.dumps(body))

        async def where():
            try:
                legacy = await db.products.find_one({"_id": "p-after"})
                shared_coll = storage_router.collection_for_mode(db, "shared_v2", company_a, "products")
                moved = await shared_coll.find_one({"_id": "p-after"})
                company = await db.companies.find_one({"_id": company_a})
                return legacy, moved, company
            finally:
                await db.close()

        storage_shared_v2.reset_store()
        db = _client(catalog)
        legacy, moved, company = asyncio.run(where())
        assert legacy is None
        assert moved["name"] == "Sonra"
        assert company["storage_mode"] == "shared_v2"
        assert int(company.get("storage_epoch") or 0) >= 1

        same_a = tmp_path / "same-a.json"
        same_b = tmp_path / "same-b.json"
        same_release = tmp_path / "same-release"
        first = _spawn({
            "action": "apply",
            "company_id": company_b,
            "to_mode": "shared_v2",
            "env": env,
            "ready": str(tmp_path / "same-ready"),
            "release": str(same_release),
            "result": str(same_a),
        })
        second = _spawn({
            "action": "apply",
            "company_id": company_b,
            "to_mode": "shared_v2",
            "env": env,
            "ready": str(tmp_path / "same-ready-b"),
            "release": str(same_release),
            "result": str(same_b),
        })
        busy = None
        for _ in range(400):
            for path in (same_a, same_b):
                if path.exists() and _read_json(path).get("status") == "busy":
                    busy = path
                    break
            if busy:
                break
            first.join(0.05)
            second.join(0.05)
        assert busy is not None
        same_release.write_text("1", encoding="utf-8")
        first.join(30)
        second.join(30)
        left = _read_json(same_a)
        right = _read_json(same_b)
        statuses = {left["status"], right["status"]}
        assert "busy" in statuses
        assert "completed" in statuses

        other_ready_a = tmp_path / "par-a"
        other_ready_b = tmp_path / "par-b"
        other_release = tmp_path / "par-release"
        # company_a is already shared. Move it back while company_b stays shared.
        # Use a fresh pair so both directions start together.
        company_c = "co_proc_c"
        company_d = "co_proc_d"

        async def seed_more():
            try:
                for cid in (company_c, company_d):
                    await db.companies.insert_one({"_id": cid, "name": cid, "storage_mode": "legacy"})
                    await db.products.insert_one({
                        "_id": f"p-{cid}",
                        "company_id": cid,
                        "name": cid,
                        "sku": f"sku-{cid}",
                        "price": 2,
                    })
            finally:
                await db.close()

        db = _client(catalog)
        asyncio.run(seed_more())
        proc_c = _spawn({
            "action": "apply",
            "company_id": company_c,
            "to_mode": "shared_v2",
            "env": env,
            "ready": str(other_ready_a),
            "release": str(other_release),
            "result": str(tmp_path / "par-a.json"),
        })
        proc_d = _spawn({
            "action": "apply",
            "company_id": company_d,
            "to_mode": "shared_v2",
            "env": env,
            "ready": str(other_ready_b),
            "release": str(other_release),
            "result": str(tmp_path / "par-b.json"),
        })
        for _ in range(200):
            if other_ready_a.exists() and other_ready_b.exists():
                break
            proc_c.join(0.05)
            proc_d.join(0.05)
        assert other_ready_a.exists() and other_ready_b.exists()
        other_release.write_text("1", encoding="utf-8")
        proc_c.join(30)
        proc_d.join(30)
        assert _read_json(tmp_path / "par-a.json")["status"] == "completed"
        assert _read_json(tmp_path / "par-b.json")["status"] == "completed"

        company_e = "co_proc_e"

        async def seed_e():
            try:
                await db.companies.insert_one({"_id": company_e, "name": company_e, "storage_mode": "legacy"})
                await db.orders.insert_one({
                    "_id": "o-e",
                    "company_id": company_e,
                    "order_number": "S-e",
                    "order_status": "open",
                    "channel": "manual",
                    "total_amount": 7,
                })
            finally:
                await db.close()

        db = _client(catalog)
        asyncio.run(seed_e())
        crash_ready = tmp_path / "crash-ready"
        crash_release = tmp_path / "crash-release"
        victim = _spawn({
            "action": "apply",
            "company_id": company_e,
            "to_mode": "shared_v2",
            "env": env,
            "ready": str(crash_ready),
            "release": str(crash_release),
            "result": str(tmp_path / "crash.json"),
        })
        for _ in range(200):
            if crash_ready.exists():
                break
            victim.join(0.05)
        assert crash_ready.exists()
        victim.kill()
        victim.join(10)

        async def recover():
            try:
                rows = []
                cursor = db.storage_moves.find({"company_id": company_e, "status": "running"})
                rows.extend(await storage_move._collect(cursor))
                assert rows
                return await storage_move.recover_move(db, rows[0]["_id"])
            finally:
                await db.close()

        storage_shared_v2.reset_store()
        db = _client(catalog)
        recovered = asyncio.run(recover())
        assert recovered.ok
        assert recovered.status == "recovered"

        async def after_crash():
            try:
                company = await db.companies.find_one({"_id": company_e})
                locks = await storage_move._lock_docs(db, company_e)
                coll = storage_router.collection_for_mode(db, "shared_v2", company_e, "orders")
                leftover = await coll.find_one({"_id": "o-e"})
                original = await db.orders.find_one({"_id": "o-e"})
                return company, locks, leftover, original
            finally:
                await db.close()

        storage_shared_v2.reset_store()
        db = _client(catalog)
        company, locks, leftover, original = asyncio.run(after_crash())
        assert company["storage_mode"] == "legacy"
        assert company.get("storage_write_lock") is False
        assert locks == []
        assert leftover is None
        assert original["order_number"] == "S-e"
    finally:
        storage_router.reset()
        storage_shared_v2.reset_store()
        for name in names:
            _drop(name)


def test_cli_dry_run_uses_app_catalog(tmp_path, monkeypatch):
    token = uuid.uuid4().hex[:8]
    name = f"smcli_{token}"
    shared_name = f"smclis_{token}"
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    try:
        catalog = _create(name)
        shared = _create(shared_name)
        _migrate(shared)
        monkeypatch.setenv("MYSQL_URL", catalog)
        monkeypatch.setenv("STORAGE_SHARED_V2_DSN", shared)
        db = _client(catalog)
        company_id = "co_cli"

        async def seed():
            try:
                await db.companies.insert_one({
                    "_id": company_id,
                    "name": "cli",
                    "storage_mode": "legacy",
                })
                await db.orders.insert_one({
                    "_id": "o-cli",
                    "company_id": company_id,
                    "order_number": "S-cli",
                    "order_status": "open",
                    "channel": "manual",
                    "total_amount": 3,
                })
            finally:
                await db.close()

        asyncio.run(seed())
        env = os.environ.copy()
        env["MYSQL_URL"] = catalog
        env["STORAGE_SHARED_V2_DSN"] = shared
        env["STORAGE_ROUTER_ENABLED"] = "1"
        env["PYTHONPATH"] = str(_BACKEND)
        proc = subprocess.run(
            [sys.executable, "-m", "scripts.storage_move", "--company", company_id, "--to", "shared_v2"],
            cwd=str(_BACKEND),
            capture_output=True,
            text=True,
            check=False,
            env=env,
        )
        assert proc.returncode == 0, proc.stderr + "\n" + proc.stdout
        assert "dry-run" in proc.stdout
        assert "yazılmadı" in proc.stdout
        _hide(proc.stdout)
        _hide(proc.stderr)
        assert "orders" in proc.stdout
    finally:
        _drop(name)
        _drop(shared_name)


def test_confirmed_writes_land_in_final_store(tmp_path, monkeypatch):
    token = uuid.uuid4().hex[:8]
    names = [f"smdc_{token}", f"smds_{token}"]
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    monkeypatch.setenv("STORAGE_MOVE_LOCK_TTL", "0.3")
    monkeypatch.setenv("STORAGE_MOVE_MODE_TTL", "0.3")
    monkeypatch.setenv("STORAGE_MOVE_STALE_SECONDS", "30")
    storage_router.reset()
    storage_shared_v2.reset_store()
    try:
        catalog = _create(names[0])
        shared = _create(names[1])
        _migrate(shared)
        monkeypatch.setenv("MYSQL_URL", catalog)
        monkeypatch.setenv("STORAGE_SHARED_V2_DSN", shared)
        env = _env(catalog, shared)
        company_id = "co_dur"
        db = _client(catalog)

        async def seed():
            try:
                await db.companies.insert_one({
                    "_id": company_id,
                    "name": company_id,
                    "storage_mode": "legacy",
                })
                await db.products.insert_one({
                    "_id": "p-seed",
                    "company_id": company_id,
                    "name": "Tohum",
                    "sku": "SKU-seed",
                    "price": 1,
                })
            finally:
                await db.close()

        asyncio.run(seed())
        ready = tmp_path / "dur-ready"
        tried = tmp_path / "dur-tried"
        release = tmp_path / "dur-release"
        result = tmp_path / "dur.json"
        writer = _spawn({
            "action": "durability",
            "company_id": company_id,
            "env": env,
            "ready": str(ready),
            "tried": str(tried),
            "release": str(release),
            "result": str(result),
        })

        async def on_batch(_name, _count):
            ready.write_text("1", encoding="utf-8")
            for _ in range(200):
                if tried.exists():
                    return
                await asyncio.sleep(0.05)
            raise TimeoutError("yazma denemesi gelmedi")

        db = _client(catalog)

        async def _apply():
            try:
                return await storage_move.apply_move(
                    db, company_id, "shared_v2", batch_size=1, on_batch=on_batch,
                )
            finally:
                await db.close()

        report = asyncio.run(_apply())
        release.write_text("1", encoding="utf-8")
        writer.join(30)
        assert writer.exitcode == 0
        assert report.ok, report.errors
        body = _read_json(result)
        _hide(json.dumps(body))
        assert not body.get("error"), body
        attempts = body["attempts"]
        during = [row for row in attempts if row["phase"] == "during"]
        after = [row for row in attempts if row["phase"] == "after"]
        assert len(during) == 4 and len(after) == 4
        assert all(row.get("locked") for row in during), during
        assert all(row["ok"] for row in after), after
        labels = {row["label"] for row in after}
        assert labels == {"tenant", "raw_update", "raw_insert", "store"}

        async def check():
            try:
                shared_coll = storage_router.collection_for_mode(db, "shared_v2", company_id, "products")
                losses = []
                found = {}
                for row in after:
                    doc = await shared_coll.find_one({"_id": row["id"]})
                    found[row["id"]] = None if doc is None else doc.get(row["field"])
                    if doc is None or doc.get(row["field"]) != row["value"]:
                        losses.append(row["id"])
                legacy_seed = await db.products.find_one({"_id": "p-seed"})
                legacy_raw = await db.products.find_one({"_id": "p-raw-after"})
                legacy_tenant = await db.products.find_one({"_id": "p-tenant-after"})
                legacy_store = await db.products.find_one({"_id": "p-store-after"})
                return losses, found, legacy_seed, legacy_raw, legacy_tenant, legacy_store
            finally:
                await db.close()

        storage_shared_v2.reset_store()
        db = _client(catalog)
        losses, found, legacy_seed, legacy_raw, legacy_tenant, legacy_store = asyncio.run(check())
        assert losses == []
        assert found["p-seed"] == "Son"
        assert found["p-tenant-after"] == "TenantSon"
        assert found["p-raw-after"] == "HamSon"
        assert found["p-store-after"] == "DepoSon"
        assert legacy_seed["name"] == "Tohum"
        assert legacy_raw is None
        assert legacy_tenant is None
        assert legacy_store is None
    finally:
        storage_router.reset()
        storage_shared_v2.reset_store()
        for name in names:
            _drop(name)


def test_unreadable_catalog_rejects_locked_write(monkeypatch):
    token = uuid.uuid4().hex[:8]
    name = f"smu_{token}"
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    storage_router.reset()
    try:
        catalog = _create(name)
        monkeypatch.setenv("MYSQL_URL", catalog)
        cid = "co_unread"
        db = _client(catalog)

        async def unread(*_args, **_kwargs):
            return storage_router._UNREAD

        async def run():
            try:
                await db.companies.insert_one({
                    "_id": cid,
                    "name": cid,
                    "storage_mode": "legacy",
                    "storage_write_lock": False,
                    "storage_epoch": 1,
                })
                await db.products.insert_one({
                    "_id": "p-unread",
                    "company_id": cid,
                    "name": "Eski",
                    "sku": "SKU-unread",
                    "price": 1,
                })
                await db.companies.update_one(
                    {"_id": cid},
                    {"$set": {"storage_write_lock": True}},
                )
                storage_router._cache[cid] = ("legacy", 0.0, 0, False)
                storage_router._lock_cache[cid] = (False, 0.0)
                monkeypatch.setattr(storage_router, "read_company_doc_async", unread)
                monkeypatch.setattr(storage_router, "_read_company_doc", lambda *_a, **_k: storage_router._UNREAD)
                assert storage_router._locked_now(db, cid) is True
                with pytest.raises(storage_router.StorageWriteLocked):
                    await db.products.update_one({"_id": "p-unread"}, {"$set": {"name": "Kayip"}})
                with pytest.raises(storage_router.StorageWriteLocked):
                    await db.products.insert_one({
                        "_id": "p-new",
                        "company_id": cid,
                        "name": "Yeni",
                        "sku": "SKU-new",
                        "price": 2,
                    })
                kept = await db.products.find_one({"_id": "p-unread"})
                missing = await db.products.find_one({"_id": "p-new"})
                return kept, missing
            finally:
                await db.close()

        kept, missing = asyncio.run(run())
        assert kept["name"] == "Eski"
        assert missing is None
        assert storage_router._lock_cache[cid][1] <= storage_router._now()
        assert storage_router._locked_now(db, cid) is True
    finally:
        storage_router.reset()
        _drop(name)


def test_other_host_live_move_is_not_stolen(monkeypatch):
    token = uuid.uuid4().hex[:8]
    name = f"smh_{token}"
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    monkeypatch.setenv("STORAGE_MOVE_STALE_SECONDS", "30")
    storage_router.reset()
    try:
        catalog = _create(name)
        monkeypatch.setenv("MYSQL_URL", catalog)
        db = _client(catalog)

        async def run():
            try:
                cid = "co_remote"
                fresh = storage_move._now()
                await db.companies.insert_one({"_id": cid, "name": cid, "storage_mode": "legacy"})
                await db.storage_move_locks.insert_one({
                    "_id": cid,
                    "company_id": cid,
                    "move_id": "remote-move",
                    "status": "running",
                    "owner_host": "remote-host",
                    "owner_pid": 1,
                    "heartbeat_at": fresh,
                    "to_mode": "shared_v2",
                })
                with pytest.raises(storage_router.StorageMoveBusy):
                    await storage_move._acquire_lock(db, cid, "local-move", "shared_v2")
                with pytest.raises(storage_router.StorageWriteLocked):
                    await db.products.insert_one({
                        "_id": "p-anon",
                        "name": "anon",
                        "sku": "SKU-anon",
                        "price": 1,
                    })
                assert await db.products.find_one({"_id": "p-anon"}) is None
                remote = await storage_move._lock_docs(db, cid)
                assert remote[0]["move_id"] == "remote-move"
                assert remote[0]["owner_host"] == "remote-host"

                dead = "co_dead"
                await db.companies.insert_one({"_id": dead, "name": dead, "storage_mode": "legacy"})
                await db.storage_move_locks.insert_one({
                    "_id": dead,
                    "company_id": dead,
                    "move_id": "dead-move",
                    "status": "running",
                    "owner_host": storage_move._owner_host(),
                    "owner_pid": 2_147_000_001,
                    "heartbeat_at": fresh,
                    "to_mode": "shared_v2",
                })
                await storage_move._acquire_lock(db, dead, "takeover", "shared_v2")
                taken = await storage_move._lock_docs(db, dead)
                assert taken[0]["move_id"] == "takeover"

                old = "co_old_host"
                await db.companies.insert_one({"_id": old, "name": old, "storage_mode": "legacy"})
                await db.storage_move_locks.insert_one({
                    "_id": old,
                    "company_id": old,
                    "move_id": "old-move",
                    "status": "running",
                    "owner_host": "remote-host",
                    "owner_pid": 1,
                    "heartbeat_at": "2000-01-01T00:00:00Z",
                    "to_mode": "shared_v2",
                })
                await storage_move._acquire_lock(db, old, "stale-take", "shared_v2")
                aged = await storage_move._lock_docs(db, old)
                assert aged[0]["move_id"] == "stale-take"
            finally:
                await db.close()

        asyncio.run(run())
    finally:
        storage_router.reset()
        _drop(name)


def test_commit_owner_is_conditional(monkeypatch):
    token = uuid.uuid4().hex[:8]
    name = f"smown_{token}"
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    storage_router.reset()
    try:
        catalog = _create(name)
        monkeypatch.setenv("MYSQL_URL", catalog)
        cid = "co_own"
        db = _client(catalog)

        async def run():
            try:
                await db.companies.insert_one({
                    "_id": cid,
                    "name": cid,
                    "storage_mode": "legacy",
                    "storage_epoch": 0,
                    "storage_write_lock": True,
                })
                await db.storage_move_locks.insert_one({
                    "_id": cid,
                    "company_id": cid,
                    "move_id": "move-a",
                    "status": "running",
                    "heartbeat_at": storage_move._now(),
                    "owner_host": "host-a",
                    "owner_pid": 1,
                    "to_mode": "shared_v2",
                })
                owned = await storage_move._commit_owner(
                    db, cid, "move-a", mode="shared_v2", unlock=True,
                )
                stolen = await storage_move._commit_owner(
                    db, cid, "move-b", mode="dedicated", unlock=False,
                )
                company = await db.companies.find_one({"_id": cid})
                locks = await storage_move._lock_docs(db, cid)
                return owned, stolen, company, locks
            finally:
                await db.close()

        owned, stolen, company, locks = asyncio.run(run())
        assert owned is True
        assert stolen is False
        assert company["storage_mode"] == "shared_v2"
        assert company.get("storage_write_lock") is False
        assert int(company.get("storage_epoch") or 0) == 1
        assert locks[0]["move_id"] == "move-a"
    finally:
        storage_router.reset()
        _drop(name)


def test_stolen_lock_stops_and_keeps_the_thief(tmp_path, monkeypatch):
    token = uuid.uuid4().hex[:8]
    names = [f"smsteal_{token}", f"smsteals_{token}"]
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    monkeypatch.setenv("STORAGE_MOVE_LOCK_TTL", "0.2")
    monkeypatch.setenv("STORAGE_MOVE_MODE_TTL", "0.2")
    storage_router.reset()
    storage_shared_v2.reset_store()
    try:
        catalog = _create(names[0])
        shared = _create(names[1])
        _migrate(shared)
        monkeypatch.setenv("MYSQL_URL", catalog)
        monkeypatch.setenv("STORAGE_SHARED_V2_DSN", shared)
        cid = "co_steal"
        db = _client(catalog)

        async def seed():
            try:
                await db.companies.insert_one({"_id": cid, "name": cid, "storage_mode": "legacy"})
                await db.products.insert_one({
                    "_id": "p-seed",
                    "company_id": cid,
                    "name": "Tohum",
                    "sku": "SKU-seed",
                    "price": 1,
                })
            finally:
                await db.close()

        asyncio.run(seed())
        db = _client(catalog)
        stolen = {}

        async def on_batch(name, _count):
            if stolen:
                return
            stolen["name"] = name
            with storage_router.bypass_write_lock(cid):
                await db.storage_move_locks.update_one(
                    {"_id": cid},
                    {"$set": {
                        "move_id": "thief-live",
                        "status": "running",
                        "heartbeat_at": storage_move._now(),
                        "owner_host": "other-host",
                        "owner_pid": 424242,
                    }},
                )
            target = storage_router.collection_for_mode(db, "shared_v2", cid, "products")
            with storage_router.bypass_write_lock(cid):
                await target.insert_one({
                    "_id": "p-thief",
                    "company_id": cid,
                    "name": "Hirsiz",
                    "sku": "SKU-thief",
                    "price": 2,
                })

        async def apply():
            try:
                return await storage_move.apply_move(
                    db, cid, "shared_v2", batch_size=1, on_batch=on_batch,
                )
            finally:
                await db.close()

        report = asyncio.run(apply())
        storage_shared_v2.reset_store()
        db = _client(catalog)

        async def check():
            try:
                company = await db.companies.find_one({"_id": cid})
                locks = await storage_move._lock_docs(db, cid)
                source = await db.products.find_one({"_id": "p-seed"})
                target = storage_router.collection_for_mode(db, "shared_v2", cid, "products")
                copied = await target.find_one({"_id": "p-seed"})
                thief = await target.find_one({"_id": "p-thief"})
                return company, locks, source, copied, thief
            finally:
                await db.close()

        company, locks, source, copied, thief = asyncio.run(check())
        assert report.ok is False
        assert report.status == "failed"
        assert storage_router.normalize_mode(company.get("storage_mode")) == "legacy"
        assert int(company.get("storage_epoch") or 0) == 0
        assert company.get("storage_write_lock") is True
        assert locks[0]["move_id"] == "thief-live"
        assert source["name"] == "Tohum"
        assert copied is None
        assert thief["name"] == "Hirsiz"
    finally:
        storage_router.reset()
        storage_shared_v2.reset_store()
        for item in names:
            _drop(item)


def test_recover_does_not_destroy_a_live_move(monkeypatch):
    token = uuid.uuid4().hex[:8]
    names = [f"smrec_{token}", f"smrecs_{token}"]
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    monkeypatch.setenv("STORAGE_MOVE_STALE_SECONDS", "30")
    storage_router.reset()
    storage_shared_v2.reset_store()
    try:
        catalog = _create(names[0])
        shared = _create(names[1])
        _migrate(shared)
        monkeypatch.setenv("MYSQL_URL", catalog)
        monkeypatch.setenv("STORAGE_SHARED_V2_DSN", shared)
        cid = "co_rec"
        db = _client(catalog)

        async def run():
            try:
                await db.companies.insert_one({
                    "_id": cid,
                    "name": cid,
                    "storage_mode": "legacy",
                    "storage_write_lock": True,
                })
                await db.storage_moves.insert_one({
                    "_id": "old-move",
                    "company_id": cid,
                    "from_mode": "legacy",
                    "to_mode": "shared_v2",
                    "status": "running",
                    "counts": {"products": {"source": 1, "target": 0}},
                    "copied": {"products": ["p-old"]},
                    "collections": ["products"],
                })
                await db.storage_move_locks.insert_one({
                    "_id": cid,
                    "company_id": cid,
                    "move_id": "live-move",
                    "status": "running",
                    "heartbeat_at": storage_move._now(),
                    "owner_host": "other-host",
                    "owner_pid": 424242,
                    "to_mode": "shared_v2",
                })
                products = storage_router.collection_for_mode(db, "shared_v2", cid, "products")
                with storage_router.bypass_write_lock(cid):
                    await products.insert_one({
                        "_id": "p-old", "company_id": cid, "name": "Eski", "sku": "SKU-old", "price": 1,
                    })
                    await products.insert_one({
                        "_id": "p-live", "company_id": cid, "name": "Canli", "sku": "SKU-live", "price": 2,
                    })
                report = await storage_move.recover_move(db, "old-move")
                company = await db.companies.find_one({"_id": cid})
                locks = await storage_move._lock_docs(db, cid)
                old = await products.find_one({"_id": "p-old"})
                live = await products.find_one({"_id": "p-live"})
                return report, company, locks, old, live
            finally:
                await db.close()

        storage_shared_v2.reset_store()
        report, company, locks, old, live = asyncio.run(run())
        assert report.status == "abandoned"
        assert report.ok is True
        assert company.get("storage_write_lock") is True
        assert company.get("storage_mode") == "legacy"
        assert locks[0]["move_id"] == "live-move"
        assert old["name"] == "Eski"
        assert live["name"] == "Canli"
    finally:
        storage_router.reset()
        storage_shared_v2.reset_store()
        for item in names:
            _drop(item)


@pytest.mark.parametrize("target", ["shared_v2", "dedicated"])
def test_legacy_rollback_under_writer_load(tmp_path, monkeypatch, target):
    token = uuid.uuid4().hex[:8]
    names = [f"smrb_{token}", f"smrbs_{token}", f"smrbd_{token}"]
    from cryptography.fernet import Fernet

    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    monkeypatch.setenv("STORAGE_MOVE_LOCK_TTL", "0.3")
    monkeypatch.setenv("STORAGE_MOVE_MODE_TTL", "0.3")
    monkeypatch.setenv("CREDENTIAL_ENCRYPTION_KEY", Fernet.generate_key().decode())
    storage_router.reset()
    storage_shared_v2.reset_store()
    try:
        import comm_service

        comm_service.reset_fernet_for_tests()
        catalog = _create(names[0])
        shared = _create(names[1])
        dedicated = _create(names[2])
        _migrate(shared)
        _migrate(dedicated)
        monkeypatch.setenv("MYSQL_URL", catalog)
        monkeypatch.setenv("STORAGE_SHARED_V2_DSN", shared)
        env = _env(catalog, shared)
        cid = "co_rb"
        db = _client(catalog)

        async def seed():
            try:
                await db.companies.insert_one({
                    "_id": cid,
                    "name": cid,
                    "storage_mode": "legacy",
                    "dedicated_dsn_ref": storage_router.seal_dedicated_dsn(dedicated),
                })
                await db.products.insert_one({
                    "_id": "p-seed",
                    "company_id": cid,
                    "name": "Tohum",
                    "sku": "SKU-seed",
                    "price": 1,
                })
            finally:
                await db.close()

        asyncio.run(seed())
        db = _client(catalog)

        async def move():
            try:
                report = await storage_move.apply_move(db, cid, target)
                assert report.ok, report.errors
                if target == "dedicated":
                    import storage_dedicated

                    extra = storage_dedicated.DedicatedCollection(cid, "products", dedicated)
                else:
                    extra = storage_router.collection_for_mode(db, target, cid, "products")
                with storage_router.bypass_write_lock(cid):
                    await extra.insert_one({
                        "_id": "p-extra",
                        "company_id": cid,
                        "name": "Ek",
                        "sku": "SKU-extra",
                        "price": 8,
                    })
                return report
            finally:
                await db.close()

        report = asyncio.run(move())
        ready = tmp_path / f"rb-ready-{target}"
        tried = tmp_path / f"rb-tried-{target}"
        release = tmp_path / f"rb-release-{target}"
        result = tmp_path / f"rb-{target}.json"
        writer = _spawn({
            "action": "durability",
            "company_id": cid,
            "env": env,
            "ready": str(ready),
            "tried": str(tried),
            "release": str(release),
            "result": str(result),
        })

        async def on_batch(_name, _count):
            ready.write_text("1", encoding="utf-8")
            for _ in range(200):
                if tried.exists():
                    return
                await asyncio.sleep(0.05)
            raise TimeoutError("yazma denemesi gelmedi")

        storage_shared_v2.reset_store()
        db = _client(catalog)

        async def roll():
            try:
                return await storage_move.rollback_move(db, report.move_id, batch_size=1, on_batch=on_batch)
            finally:
                await db.close()

        back = asyncio.run(roll())
        release.write_text("1", encoding="utf-8")
        writer.join(30)
        assert writer.exitcode == 0
        assert back.ok, back.errors
        assert back.status == "rolled_back"
        body = _read_json(result)
        _hide(json.dumps(body))
        assert not body.get("error"), body
        attempts = body["attempts"]
        during = [row for row in attempts if row["phase"] == "during"]
        after = [row for row in attempts if row["phase"] == "after"]
        assert len(during) == 4 and len(after) == 4
        assert all(row.get("locked") for row in during), during
        assert all(row["ok"] for row in after), after

        storage_shared_v2.reset_store()
        db = _client(catalog)

        async def check():
            try:
                company = await db.companies.find_one({"_id": cid})
                losses = []
                for row in after:
                    doc = await db.products.find_one({"_id": row["id"]})
                    if doc is None or doc.get(row["field"]) != row["value"]:
                        losses.append(row["id"])
                blocked = []
                for row in during:
                    if row["id"] == "p-seed":
                        continue
                    if await db.products.find_one({"_id": row["id"]}):
                        blocked.append(row["id"])
                extra = await db.products.find_one({"_id": "p-extra"})
                return company, losses, blocked, extra
            finally:
                await db.close()

        company, losses, blocked, extra = asyncio.run(check())
        assert company["storage_mode"] == "legacy"
        assert company.get("storage_write_lock") is not True
        assert losses == []
        assert blocked == []
        assert extra["name"] == "Ek"
    finally:
        storage_router.reset()
        storage_shared_v2.reset_store()
        try:
            import comm_service

            comm_service.reset_fernet_for_tests()
        except Exception:
            pass
        for item in names:
            _drop(item)


def test_global_write_skips_archived_source_rows(monkeypatch):
    token = uuid.uuid4().hex[:8]
    names = [f"smarc_{token}", f"smarcs_{token}"]
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    storage_router.reset()
    storage_shared_v2.reset_store()
    try:
        catalog = _create(names[0])
        shared = _create(names[1])
        _migrate(shared)
        monkeypatch.setenv("MYSQL_URL", catalog)
        monkeypatch.setenv("STORAGE_SHARED_V2_DSN", shared)
        db = _client(catalog)

        async def run():
            try:
                await db.companies.insert_one({
                    "_id": "co_arch",
                    "name": "arsiv",
                    "storage_mode": "shared_v2",
                    "storage_epoch": 2,
                })
                await db.companies.insert_one({
                    "_id": "co_leg",
                    "name": "eski",
                    "storage_mode": "legacy",
                    "storage_epoch": 0,
                })
                await db.products.insert_one({
                    "_id": "p-arch", "company_id": "co_arch", "name": "Arsiv", "sku": "SKU-arch", "price": 1,
                })
                await db.products.insert_one({
                    "_id": "p-leg", "company_id": "co_leg", "name": "Legacy", "sku": "SKU-leg", "price": 1,
                })
                storage_router.forget_mode("co_arch")
                storage_router.forget_mode("co_leg")
                shared_products = storage_router.collection_for_mode(db, "shared_v2", "co_arch", "products")
                await shared_products.insert_one({
                    "_id": "p-arch", "company_id": "co_arch", "name": "Arsiv", "sku": "SKU-arch", "price": 1,
                })
                light = {"n": 0}
                full = {"n": 0}
                original_light = db.products.distinct_company_ids
                original_full = db.products._load_filtered

                async def counted_light(query):
                    light["n"] += 1
                    return await original_light(query)

                async def counted_full(query):
                    full["n"] += 1
                    return await original_full(query)

                db.products.distinct_company_ids = counted_light
                db.products._load_filtered = counted_full
                broad = {}
                many = await db.products.update_many(broad, {"$set": {"note": "genel"}})
                after_many = full["n"]
                sku = {"sku": "SKU-arch"}
                sku_result = await db.products.update_one(sku, {"$set": {"price": 9}})
                await db.products.update_one({"_id": "p-arch"}, {"$set": {"name": "Yonlendi"}})
                arch = await db.products.find_one({"_id": "p-arch"})
                leg = await db.products.find_one({"_id": "p-leg"})
                routed = await shared_products.find_one({"_id": "p-arch"})
                removed = await db.products.delete_many({"sku": "SKU-arch"})
                gone = await shared_products.find_one({"_id": "p-arch"})
                return arch, leg, routed, gone, light["n"], after_many, many, sku, sku_result, removed, broad
            finally:
                await db.close()

        storage_shared_v2.reset_store()
        arch, leg, routed, gone, light_n, full_n, many, sku, sku_result, removed, broad = asyncio.run(run())
        assert broad == {}
        assert sku == {"sku": "SKU-arch"}
        assert many.matched_count == 2
        assert sku_result.matched_count == 1
        assert removed.deleted_count == 1
        assert arch["name"] == "Arsiv"
        assert arch.get("note") != "genel"
        assert arch.get("price") == 1
        assert leg["note"] == "genel"
        assert routed["name"] == "Yonlendi"
        assert routed["note"] == "genel"
        assert routed["price"] == 9
        assert gone is None
        assert light_n >= 1
        assert full_n == 1
    finally:
        storage_router.reset()
        storage_shared_v2.reset_store()
        for item in names:
            _drop(item)


def _product(doc_id: str, company_id: str, name: str, sku: str) -> dict:
    return {
        "_id": doc_id,
        "company_id": company_id,
        "name": name,
        "sku": sku,
        "price": 3,
    }


async def _gap_apis(db, company_id: str, prefix: str, rounds: int) -> list:
    import tenant_db
    from tenant_scope import TenantScope

    scope = TenantScope(
        company_id=company_id,
        allowed=frozenset({company_id}),
        kind="user",
        actor_id="proc",
        reason="test",
    )
    await storage_router.set_company_maintenance(db, company_id, False)
    handle = tenant_db.TenantDB(db, scope)
    store = await storage_router.open_company_store(db, company_id)
    rows = []
    for index in range(rounds):
        tenant_id = f"{prefix}-tenant-{index}"
        raw_id = f"{prefix}-raw-{index}"
        store_id = f"{prefix}-store-{index}"
        await handle.products.insert_one(_product(tenant_id, company_id, f"T{index}", f"SKU-{prefix}-T-{index}"))
        await db.products.insert_one(_product(raw_id, company_id, f"R{index}", f"SKU-{prefix}-R-{index}"))
        await store.products.insert_one(_product(store_id, company_id, f"S{index}", f"SKU-{prefix}-S-{index}"))
        rows.extend((tenant_id, raw_id, store_id))
    return rows


def _other_products(shared: str, company_id: str):
    import pymysql

    parsed = urlparse(shared.replace("mariadb://", "mysql://", 1).replace("mysql+pymysql://", "mysql://", 1))
    conn = pymysql.connect(
        host=parsed.hostname or "127.0.0.1",
        port=parsed.port or 3306,
        user=unquote(parsed.username or ""),
        password=unquote(parsed.password or ""),
        database=(parsed.path or "/").lstrip("/").split("?")[0],
        charset="utf8mb4",
        autocommit=False,
        connect_timeout=5,
    )
    store = storage_shared_v2.SharedV2Store()
    store.attach(conn, "mysql", owned=True)
    coll = storage_shared_v2.SharedV2Collection(store, company_id, "products")
    return coll


def test_same_process_rollback_sees_commits_after_a_stale_read(tmp_path, monkeypatch):
    token = uuid.uuid4().hex[:8]
    names = [f"smgap_{token}", f"smgaps_{token}"]
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    monkeypatch.setenv("STORAGE_MOVE_LOCK_TTL", "0.2")
    monkeypatch.setenv("STORAGE_MOVE_MODE_TTL", "0.2")
    storage_router.reset()
    storage_shared_v2.reset_store()
    other = None
    try:
        catalog = _create(names[0])
        shared = _create(names[1])
        _migrate(shared)
        monkeypatch.setenv("MYSQL_URL", catalog)
        monkeypatch.setenv("STORAGE_SHARED_V2_DSN", shared)
        cid = "co_gap"
        db = _client(catalog)

        async def seed():
            try:
                await db.companies.insert_one({"_id": cid, "name": cid, "storage_mode": "legacy"})
                await db.products.insert_one(_product("p-seed", cid, "Tohum", "SKU-seed"))
            finally:
                await db.close()

        asyncio.run(seed())
        db = _client(catalog)

        async def move():
            try:
                report = await storage_move.apply_move(db, cid, "shared_v2")
                assert report.ok, report.errors
                confirmed = await _gap_apis(db, cid, "same", 4)
                store = await storage_router.open_company_store(db, cid)
                await store.products.find_one({"_id": "p-seed"})
                return report, confirmed
            finally:
                await db.close()

        report, confirmed = asyncio.run(move())
        other = _other_products(shared, cid)
        hidden = [f"same-other-{index}" for index in range(4)]

        async def hide():
            with storage_router.bypass_write_lock(cid):
                for index, doc_id in enumerate(hidden):
                    await other.insert_one(_product(doc_id, cid, f"O{index}", f"SKU-same-O-{index}"))

        asyncio.run(hide())
        db = _client(catalog)

        async def roll():
            try:
                return await storage_move.rollback_move(db, report.move_id)
            finally:
                await db.close()

        back = asyncio.run(roll())
        assert back.ok, back.errors
        assert back.status == "rolled_back"
        db = _client(catalog)

        async def check():
            try:
                company = await db.companies.find_one({"_id": cid})
                missing = []
                for doc_id in confirmed + hidden:
                    found = await db.products.find_one({"_id": doc_id})
                    if found is None:
                        missing.append(doc_id)
                return company, missing
            finally:
                await db.close()

        company, missing = asyncio.run(check())
        assert company["storage_mode"] == "legacy"
        assert missing == []
    finally:
        if other is not None:
            try:
                other.store.close()
            except Exception:
                pass
        storage_router.reset()
        storage_shared_v2.reset_store()
        for item in names:
            _drop(item)


def test_other_process_rollback_sees_gap_writes(tmp_path, monkeypatch):
    token = uuid.uuid4().hex[:8]
    names = [f"smgapp_{token}", f"smgapps_{token}"]
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    monkeypatch.setenv("STORAGE_MOVE_LOCK_TTL", "0.2")
    monkeypatch.setenv("STORAGE_MOVE_MODE_TTL", "0.2")
    storage_router.reset()
    storage_shared_v2.reset_store()
    try:
        catalog = _create(names[0])
        shared = _create(names[1])
        _migrate(shared)
        monkeypatch.setenv("MYSQL_URL", catalog)
        monkeypatch.setenv("STORAGE_SHARED_V2_DSN", shared)
        env = _env(catalog, shared)
        cid = "co_gap_p"
        db = _client(catalog)

        async def seed():
            try:
                await db.companies.insert_one({"_id": cid, "name": cid, "storage_mode": "legacy"})
                await db.products.insert_one(_product("p-seed", cid, "Tohum", "SKU-seed"))
            finally:
                await db.close()

        asyncio.run(seed())
        db = _client(catalog)

        async def move():
            try:
                report = await storage_move.apply_move(db, cid, "shared_v2")
                assert report.ok, report.errors
                return report
            finally:
                await db.close()

        report = asyncio.run(move())
        result = tmp_path / "gap.json"
        writer = _spawn({
            "action": "gap",
            "company_id": cid,
            "rounds": 8,
            "env": env,
            "result": str(result),
        })
        writer.join(60)
        assert writer.exitcode == 0
        body = _read_json(result)
        _hide(json.dumps(body))
        assert not body.get("error"), body
        rows = body["rows"]
        assert len(rows) == 24
        db = _client(catalog)

        async def roll():
            try:
                return await storage_move.rollback_move(db, report.move_id)
            finally:
                await db.close()

        back = asyncio.run(roll())
        assert back.ok, back.errors
        assert back.status == "rolled_back"
        db = _client(catalog)

        async def check():
            try:
                company = await db.companies.find_one({"_id": cid})
                missing = []
                for doc_id in rows:
                    found = await db.products.find_one({"_id": doc_id})
                    if found is None:
                        missing.append(doc_id)
                return company, missing
            finally:
                await db.close()

        company, missing = asyncio.run(check())
        assert company["storage_mode"] == "legacy"
        assert missing == []
    finally:
        storage_router.reset()
        storage_shared_v2.reset_store()
        for item in names:
            _drop(item)


def test_mysql_precopy_delta_follows_source_writes(tmp_path, monkeypatch):
    """Gerçek MySQL katalogda ön kopya sonrası yazılar tombstone farkıyla gelir."""
    from cryptography.fernet import Fernet

    token = uuid.uuid4().hex[:8]
    names = [f"smdelta_{token}", f"smdeltas_{token}", f"smdeltad_{token}"]
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    monkeypatch.setenv("STORAGE_MOVE_LOCK_TTL", "0.05")
    monkeypatch.setenv("STORAGE_MOVE_MODE_TTL", "0.05")
    monkeypatch.setenv("CREDENTIAL_ENCRYPTION_KEY", Fernet.generate_key().decode())
    storage_router.reset()
    storage_shared_v2.reset_store()
    try:
        import comm_service

        comm_service.reset_fernet_for_tests()
        catalog = _create(names[0])
        shared = _create(names[1])
        dedicated = _create(names[2])
        _migrate(shared)
        _migrate(dedicated)
        monkeypatch.setenv("MYSQL_URL", catalog)
        monkeypatch.setenv("STORAGE_SHARED_V2_DSN", shared)
        cid = "co_delta"
        db = _client(catalog)

        async def seed():
            try:
                await db.companies.insert_one({
                    "_id": cid,
                    "name": "Delta",
                    "storage_mode": "legacy",
                    "dedicated_dsn_ref": storage_router.seal_dedicated_dsn(dedicated),
                })
                await db.products.insert_one({
                    "_id": "p1", "company_id": cid, "name": "Kalem", "sku": "K-1", "price": 12,
                })
                await db.orders.insert_one({
                    "_id": "o1",
                    "company_id": cid,
                    "order_number": "S-1",
                    "order_status": "open",
                    "order_date": "2026-01-02",
                    "contact_id": "c1",
                    "channel": "manual",
                    "total_amount": 10,
                })
                await db.invoices.insert_one({
                    "_id": "i1",
                    "company_id": cid,
                    "invoice_number": "F-1",
                    "status": "draft",
                    "issue_date": "2026-01-03",
                    "contact_id": "c1",
                    "grand_total": 12,
                })
            finally:
                await db.close()

        asyncio.run(seed())

        async def on_precopy():
            database = _client(catalog)
            try:
                await database.products.update_one({"_id": "p1"}, {"$set": {"name": "Kalem guncel"}})
                await database.invoices.insert_one({
                    "_id": "i-yeni",
                    "company_id": cid,
                    "invoice_number": "F-yeni",
                    "status": "draft",
                    "issue_date": "2026-04-01",
                    "contact_id": "c1",
                    "grand_total": 9,
                })
                await database.orders.delete_one({"_id": "o1"})
            finally:
                await database.close()

        db = _client(catalog)

        async def run():
            try:
                return await storage_move.apply_move(
                    db, cid, "dedicated", on_precopy=on_precopy,
                )
            finally:
                await db.close()

        report = asyncio.run(run())
        assert report.ok, report.errors
        assert report.counts["products"]["source"] == report.counts["products"]["target"] == 1
        assert report.counts["invoices"]["source"] == report.counts["invoices"]["target"] == 2
        assert report.counts.get("orders", {}).get("source", 0) == 0
        assert report.checksums["products"]["source"] == report.checksums["products"]["target"]
        assert report.checksums["invoices"]["source"] == report.checksums["invoices"]["target"]
        methods = [step.get("yontem") for step in report.steps if step.get("name") == "fark"]
        assert methods == ["tombstone"]
        assert report.locked_ms < report.duration_ms
        db = _client(catalog)

        async def read_back():
            import storage_dedicated

            try:
                company = await db.companies.find_one({"_id": cid})
                products = storage_dedicated.DedicatedCollection(cid, "products", dedicated)
                invoices = storage_dedicated.DedicatedCollection(cid, "invoices", dedicated)
                orders = storage_dedicated.DedicatedCollection(cid, "orders", dedicated)
                product = await products.find_one({"_id": "p1"})
                invoice = await invoices.find_one({"_id": "i-yeni"})
                order = await orders.find_one({"_id": "o1"})
                return company, product, invoice, order
            finally:
                await db.close()

        company, product, invoice, order = asyncio.run(read_back())
        assert company["storage_mode"] == "dedicated"
        assert product["name"] == "Kalem guncel"
        assert invoice["invoice_number"] == "F-yeni"
        assert order is None
    finally:
        storage_router.reset()
        storage_shared_v2.reset_store()
        try:
            import comm_service

            comm_service.reset_fernet_for_tests()
        except Exception:
            pass
        for item in names:
            _drop(item)


def test_large_company_apply_shortens_the_write_lock(tmp_path, monkeypatch):
    """Yaklaşık 200 bin satırda kilit, apply süresinin küçük parçasıdır."""
    from cryptography.fernet import Fernet

    rows = 200_000
    token = uuid.uuid4().hex[:8]
    names = [f"smlock_{token}", f"smlocks_{token}", f"smlockd_{token}"]
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    monkeypatch.setenv("STORAGE_MOVE_LOCK_TTL", "0.05")
    monkeypatch.setenv("STORAGE_MOVE_MODE_TTL", "0.05")
    monkeypatch.setenv("CREDENTIAL_ENCRYPTION_KEY", Fernet.generate_key().decode())
    storage_router.reset()
    storage_shared_v2.reset_store()
    beats = {"n": 0}
    real_beat = storage_move._beat

    async def _count_beat(*args, **kwargs):
        beats["n"] += 1
        return await real_beat(*args, **kwargs)

    monkeypatch.setattr(storage_move, "_beat", _count_beat)
    try:
        import comm_service

        comm_service.reset_fernet_for_tests()
        catalog = _create(names[0])
        shared = _create(names[1])
        dedicated = _create(names[2])
        _migrate(shared)
        _migrate(dedicated)
        monkeypatch.setenv("MYSQL_URL", catalog)
        monkeypatch.setenv("STORAGE_SHARED_V2_DSN", shared)
        cid = "co_buyuk"

        async def ensure_catalog():
            database = _client(catalog)
            try:
                await database._ensure()
            finally:
                await database.close()

        asyncio.run(ensure_catalog())
        parsed = _parsed_dsn()
        import pymysql
        from mysql_store import dumps

        admin = pymysql.connect(
            host=parsed.hostname or "127.0.0.1",
            port=parsed.port or 3306,
            user=unquote(parsed.username or ""),
            password=unquote(parsed.password or ""),
            database=names[0],
            charset="utf8mb4",
            autocommit=False,
            connect_timeout=5,
        )
        try:
            cursor = admin.cursor()
            cursor.execute(
                "INSERT INTO docs (collection, id, doc) VALUES (%s, %s, %s)",
                ("companies", cid, dumps({
                    "_id": cid,
                    "name": "Buyuk",
                    "storage_mode": "legacy",
                    "dedicated_dsn_ref": storage_router.seal_dedicated_dsn(dedicated),
                })),
            )
            batch = []
            for index in range(rows):
                ident = f"p{index:06d}"
                batch.append(("products", ident, dumps({
                    "_id": ident,
                    "company_id": cid,
                    "name": "Kalem",
                    "sku": ident,
                    "price": 1,
                })))
                if len(batch) == 1000:
                    cursor.executemany(
                        "INSERT INTO docs (collection, id, doc) VALUES (%s, %s, %s)",
                        batch,
                    )
                    batch.clear()
            if batch:
                cursor.executemany(
                    "INSERT INTO docs (collection, id, doc) VALUES (%s, %s, %s)",
                    batch,
                )
            admin.commit()
        finally:
            admin.close()

        db = _client(catalog)

        async def run():
            try:
                return await storage_move.apply_move(db, cid, "dedicated", batch_size=1000)
            finally:
                await db.close()

        report = asyncio.run(run())
        assert report.ok, report.errors
        assert report.counts["products"]["source"] == rows
        assert report.counts["products"]["source"] == report.counts["products"]["target"]
        assert report.checksums["products"]["source"] == report.checksums["products"]["target"]
        assert report.locked_ms * 2 < report.duration_ms
        # Eski yol 50 satırda iki kalp atışıydı (200 bin satırda yaklaşık 8000).
        assert beats["n"] * 50 < rows, (beats["n"], report.duration_ms, report.locked_ms)
        assert any(
            step.get("name") == "fark" and step.get("yontem") == "tombstone"
            for step in report.steps
        )
        db = _client(catalog)

        async def index_and_count():
            try:
                await db._ensure()
                async with db._pool.acquire() as conn:
                    async with conn.cursor() as cur:
                        await cur.execute("SHOW INDEX FROM docs WHERE Key_name=%s", (storage_move._MOVE_INDEX,))
                        found = await cur.fetchall()
                return len(found or [])
            finally:
                await db.close()

        indexed = asyncio.run(index_and_count())
        assert indexed >= 1
        from storage_migrations.session import connect as open_session

        session = open_session(dedicated, write=False)
        try:
            counted = session.fetchall(
                "SELECT COUNT(*) FROM storage_records WHERE collection=%s AND company_id=%s",
                ("products", cid),
            )
        finally:
            session.close()
        assert int(counted[0][0]) == rows
        detail = f"sure_ms={report.duration_ms} kilit_ms={report.locked_ms} beat={beats['n']}"
        assert report.duration_ms > 0
        assert report.locked_ms >= 0
        print(detail)
    finally:
        storage_router.reset()
        storage_shared_v2.reset_store()
        try:
            import comm_service

            comm_service.reset_fernet_for_tests()
        except Exception:
            pass
        for item in names:
            _drop(item)


def test_flag_off_keeps_the_original_tombstone_list(tmp_path, monkeypatch):
    from mysql_store import SKIP_TOMBSTONE

    assert SKIP_TOMBSTONE == frozenset({
        "sync_tombstones",
        "trash",
        "login_attempts",
        "activity_logs",
        "notifications",
    })
    token = uuid.uuid4().hex[:8]
    names = [f"smtomb_{token}"]
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "0")
    storage_router.reset()
    try:
        catalog = _create(names[0])
        monkeypatch.setenv("MYSQL_URL", catalog)
        db = _client(catalog)

        async def run():
            try:
                await db.system_logs.insert_one({"_id": "log-1", "company_id": "co", "message": "satir"})
                await db.storage_moves.insert_one({"_id": "mv-1", "company_id": "co", "status": "completed"})
                await db.system_logs.delete_one({"_id": "log-1"})
                await db.storage_moves.delete_one({"_id": "mv-1"})
                rows = await db.sync_tombstones.find({}).to_list(20)
                return sorted(row.get("collection") for row in rows)
            finally:
                await db.close()

        collections = asyncio.run(run())
        assert collections.count("system_logs") == 1
        assert collections.count("storage_moves") == 1
    finally:
        storage_router.reset()
        for item in names:
            _drop(item)
