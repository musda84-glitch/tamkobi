"""Taşıma kilidi ayrı süreçlerde. MariaDB 11.8 strict. Atlanmaz.

Katalog, shared_v2 ve dedicated ayrı veritabanıdır. Canlı uygulamaya ve
8021 portuna bağlanmaz. Parola ve DSN çıktıya yazılmaz.
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

_PASSWORD = "move-secret"
_USER = "move"
_HOST = "127.0.0.1"
_PORT = 3306
_STRICT = "STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION"


def _admin():
    import pymysql

    return pymysql.connect(
        host=_HOST,
        port=_PORT,
        user=_USER,
        password=_PASSWORD,
        charset="utf8mb4",
        autocommit=True,
        connect_timeout=5,
    )


def _dsn(name: str) -> str:
    return f"mysql://{_USER}:{_PASSWORD}@{_HOST}:{_PORT}/{name}"


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
        assert _PASSWORD not in json.dumps(body)

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
        assert _PASSWORD not in proc.stdout
        assert _PASSWORD not in proc.stderr
        assert "orders" in proc.stdout
    finally:
        _drop(name)
        _drop(shared_name)
