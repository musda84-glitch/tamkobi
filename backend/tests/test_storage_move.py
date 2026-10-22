"""Şirket depolama taşıması. Canlı veritabanına ve 8021 portuna bağlanmaz.

SQLite her zaman çalışır. MariaDB 11.8 strict, STORAGE_MARIADB_DSN veya
STORAGE_SHARED_V2_TEST_DSN varsa aynı senaryoları tekrarlar. .env okunmaz.
"""
from __future__ import annotations

import asyncio
import copy
import os
import sqlite3
import subprocess
import sys
import uuid
from pathlib import Path
from urllib.parse import unquote, urlparse

import pytest
from cryptography.fernet import Fernet

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(Path(__file__).resolve().parent))

os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

from dashboard_memdb import MemDB  # noqa: E402
import storage_dedicated  # noqa: E402
import storage_router  # noqa: E402
from scripts import storage_move  # noqa: E402
import storage_shared_v2  # noqa: E402
import tenant_db  # noqa: E402
from tenant_scope import TenantScope  # noqa: E402

PAIRS = [
    ("legacy", "shared_v2"),
    ("legacy", "dedicated"),
    ("shared_v2", "dedicated"),
    ("shared_v2", "legacy"),
    ("dedicated", "shared_v2"),
    ("dedicated", "legacy"),
]
_STRICT = "STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION"
_SECRET = "s3cret-move-dsn"
_VKN = "12345678901"
_ETTN = "11111111-1111-1111-1111-111111111111"


def _base_dsn() -> str:
    return (
        os.environ.get("STORAGE_MARIADB_DSN")
        or os.environ.get("STORAGE_SHARED_V2_TEST_DSN")
        or ""
    ).strip()


@pytest.fixture(params=["sqlite", "mariadb"])
def engine(request):
    if request.param == "mariadb" and not _base_dsn():
        pytest.fail("STORAGE_MARIADB_DSN / STORAGE_SHARED_V2_TEST_DSN yok; MariaDB 11.8 strict atlanamaz")
    return request.param


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    storage_router.reset()
    storage_shared_v2.reset_store()
    monkeypatch.setattr(storage_move.time, "sleep", lambda *_args, **_kwargs: None)
    yield
    storage_router.reset()
    storage_shared_v2.reset_store()


def _scope(company_id):
    return TenantScope(
        company_id=company_id,
        allowed=frozenset({company_id}),
        kind="user",
        actor_id="user-move",
        reason="test",
    )


def _seal(monkeypatch, tmp_path):
    monkeypatch.setenv("CREDENTIAL_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    import comm_service

    comm_service.reset_fernet_for_tests()
    return comm_service


def _migrate(dsn: str) -> None:
    from storage_migrations.engine import apply
    from storage_migrations.session import connect

    session = connect(dsn, write=True)
    try:
        if session.dialect == "mysql":
            session.execute(f"SET SESSION sql_mode='{_STRICT}'")
            session.commit()
        apply(session, confirm=True, dry_run=False)
    finally:
        session.close()


def _parse(dsn: str):
    return urlparse(dsn.replace("mariadb://", "mysql://", 1).replace("mysql+pymysql://", "mysql://", 1))


def _mysql_dsn(base: str, name: str) -> str:
    parsed = _parse(base)
    import pymysql

    admin = pymysql.connect(
        host=parsed.hostname or "127.0.0.1",
        port=parsed.port or 3306,
        user=unquote(parsed.username or ""),
        password=unquote(parsed.password or ""),
        charset="utf8mb4",
        autocommit=True,
        connect_timeout=5,
    )
    try:
        with admin.cursor() as cur:
            cur.execute(
                f"CREATE DATABASE IF NOT EXISTS `{name}` "
                "CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci"
            )
    finally:
        admin.close()
    user = unquote(parsed.username or "")
    password = unquote(parsed.password or "")
    auth = user if not password else f"{user}:{password}"
    host = parsed.hostname or "127.0.0.1"
    port = parsed.port or 3306
    scheme = "mariadb" if base.startswith("mariadb") else "mysql"
    return f"{scheme}://{auth}@{host}:{port}/{name}"


def _drop_db(base: str, name: str) -> None:
    parsed = _parse(base)
    import pymysql

    admin = pymysql.connect(
        host=parsed.hostname or "127.0.0.1",
        port=parsed.port or 3306,
        user=unquote(parsed.username or ""),
        password=unquote(parsed.password or ""),
        charset="utf8mb4",
        autocommit=True,
        connect_timeout=5,
    )
    try:
        with admin.cursor() as cur:
            cur.execute(f"DROP DATABASE IF EXISTS `{name}`")
    finally:
        admin.close()


class World:
    def __init__(self):
        self.db = MemDB()
        self.company_id = "co_move"
        self.other_id = "co_other"
        self.engine = "sqlite"
        self.shared_conn = None
        self.shared_dsn = ""
        self.dedicated_dsn = ""
        self._mysql_names = []
        self._base = ""

    def counts(self) -> dict:
        shared = _table_counts(self.shared_conn, "mysql" if self.engine == "mariadb" else "sqlite")
        dedicated = _dsn_counts(self.dedicated_dsn)
        return {"shared": shared, "dedicated": dedicated}

    def mem_docs(self) -> dict:
        found = {}
        for name, coll in self.db._cols.items():
            if coll.docs:
                found[name] = copy.deepcopy(coll.docs)
        return found


def _table_counts(conn, dialect: str) -> dict:
    if conn is None:
        return {}
    tables = (
        "docs_v2",
        "t_orders",
        "t_invoices",
        "t_stock_moves",
        "t_bank_transactions",
        "storage_records",
    )
    found = {}
    for table in tables:
        try:
            if dialect == "sqlite":
                row = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()
            else:
                cursor = conn.cursor()
                cursor.execute(f"SELECT COUNT(*) FROM `{table}`")
                row = cursor.fetchone()
            found[table] = int(row[0] or 0)
        except Exception:
            found[table] = 0
    return found


def _dsn_counts(dsn: str) -> dict:
    from storage_migrations.session import connect

    session = connect(dsn, write=False)
    try:
        return _table_counts(session.conn, session.dialect)
    finally:
        session.close()


def _open_world(engine: str, tmp_path: Path, monkeypatch) -> World:
    world = World()
    world.engine = engine
    _seal(monkeypatch, tmp_path)
    token = uuid.uuid4().hex[:8]
    if engine == "sqlite":
        shared_path = tmp_path / "shared.db"
        dedicated_path = tmp_path / "dedicated.db"
        world.shared_dsn = f"sqlite:///{shared_path}"
        world.dedicated_dsn = f"sqlite:///{dedicated_path}"
        _migrate(world.shared_dsn)
        _migrate(world.dedicated_dsn)
        world.shared_conn = sqlite3.connect(str(shared_path), isolation_level=None, check_same_thread=False)
        storage_shared_v2.bind_sqlite(world.shared_conn)
    else:
        base = _base_dsn()
        world._base = base
        shared_name = f"sm_s_{token}"
        dedicated_name = f"sm_d_{token}"
        world._mysql_names = [shared_name, dedicated_name]
        world.shared_dsn = _mysql_dsn(base, shared_name)
        world.dedicated_dsn = _mysql_dsn(base, dedicated_name)
        _migrate(world.shared_dsn)
        _migrate(world.dedicated_dsn)
        monkeypatch.setenv("STORAGE_SHARED_V2_DSN", world.shared_dsn)
        storage_shared_v2.reset_store()
        store = storage_shared_v2.get_store()
        conn = store.connection()
        cursor = conn.cursor()
        cursor.execute(f"SET SESSION sql_mode='{_STRICT}'")
        conn.commit()
        world.shared_conn = conn
        storage_dedicated.checkout(world.company_id, world.dedicated_dsn)
        pool = storage_dedicated._pools[world.company_id]
        pool.session.execute(f"SET SESSION sql_mode='{_STRICT}'")
        pool.session.commit()
        storage_dedicated.release(world.company_id)
    return world


def _close_world(world: World) -> None:
    storage_router.reset()
    storage_shared_v2.reset_store()
    conn = world.shared_conn
    world.shared_conn = None
    if world.engine == "sqlite" and conn is not None:
        conn.close()
    for name in world._mysql_names:
        try:
            _drop_db(world._base, name)
        except Exception:
            pass


def _sample(company_id: str) -> dict:
    return {
        "orders": {
            "_id": "o1",
            "company_id": company_id,
            "order_number": "S-1",
            "order_status": "open",
            "order_date": "2026-01-02",
            "contact_id": "c1",
            "channel": "manual",
            "total_amount": 10,
            "note": "ölçü",
        },
        "products": {
            "_id": "p1",
            "company_id": company_id,
            "name": "Kalem ölçü",
            "sku": "K-1",
            "price": 12,
        },
        "invoices": {
            "_id": "i1",
            "company_id": company_id,
            "invoice_number": "F-1",
            "status": "draft",
            "issue_date": "2026-01-03",
            "contact_id": "c1",
            "grand_total": 12,
        },
    }


async def _seed(world: World, source: str) -> None:
    sealed = storage_router.seal_dedicated_dsn(world.dedicated_dsn)
    assert _SECRET not in sealed
    await world.db.companies.insert_one({
        "_id": world.company_id,
        "name": "Taşıma",
        "storage_mode": source,
        "dedicated_dsn_ref": sealed,
    })
    await world.db.companies.insert_one({
        "_id": world.other_id,
        "name": "Öteki",
        "storage_mode": "legacy",
    })
    await world.db.products.insert_one({
        "_id": "other-p",
        "company_id": world.other_id,
        "name": "yabancı",
        "sku": "Y-1",
    })
    storage_router.forget_mode(world.company_id)
    handle = tenant_db.TenantDB(world.db, _scope(world.company_id))
    docs = _sample(world.company_id)
    await handle.orders.insert_one(docs["orders"])
    await handle.products.insert_one(docs["products"])
    await handle.invoices.insert_one(docs["invoices"])


def _freeze_rows(rows) -> list:
    return sorted(storage_move._freeze(row) for row in rows)


async def _snapshot(world: World) -> dict:
    storage_router.forget_mode(world.company_id)
    handle = tenant_db.TenantDB(world.db, _scope(world.company_id))
    found = {}
    for name in ("orders", "products", "invoices"):
        rows = await handle[name].find({}).to_list(50)
        found[name] = _freeze_rows(rows)
    return found


async def _mode(world: World) -> str:
    doc = await world.db.companies.find_one({"_id": world.company_id})
    return storage_router.normalize_mode((doc or {}).get("storage_mode"))


async def _other_untouched(world: World) -> None:
    handle = tenant_db.TenantDB(world.db, _scope(world.other_id))
    row = await handle.products.find_one({"_id": "other-p"})
    assert row["name"] == "yabancı"
    storage_router.forget_mode(world.company_id)
    mine = tenant_db.TenantDB(world.db, _scope(world.company_id))
    assert await mine.products.find_one({"_id": "other-p"}) is None


def _assert_checksums(report) -> None:
    assert report.checksums
    for name, pair in report.checksums.items():
        assert pair["source"] == pair["target"]
        assert pair["source"]
        assert report.counts[name]["source"] == report.counts[name]["target"]
        assert report.counts[name]["source"] > 0


@pytest.mark.parametrize("source,target", PAIRS)
def test_dry_run_writes_nothing(engine, source, target, tmp_path, monkeypatch):
    world = _open_world(engine, tmp_path, monkeypatch)

    async def run():
        await _seed(world, source)
        before_docs = world.mem_docs()
        before_sql = world.counts()
        before_mode = await _mode(world)
        report = await storage_move.plan_move(world.db, world.company_id, target)
        assert report.ok
        assert report.dry_run
        assert report.wrote is False
        assert report.from_mode == source
        assert report.to_mode == target
        expected = {"invoices", "orders", "products"}
        if source == "legacy":
            expected.add("companies")
        assert {row["name"] for row in report.collections} == expected
        for row in report.collections:
            assert row["count"] == 1
            assert row["bytes"] > 0
            assert row["target"]
            assert row["target_count"] == 0
        assert not report.conflicts
        assert not report.errors
        assert await _mode(world) == before_mode
        assert world.mem_docs() == before_docs
        assert world.counts() == before_sql
        assert "storage_moves" not in world.db._cols
        text = storage_move.render(report)
        assert "yazılmadı" in text
        assert _SECRET not in text
        assert "gAAAA" not in text

    try:
        asyncio.run(run())
    finally:
        _close_world(world)


@pytest.mark.parametrize("source,target", PAIRS)
def test_apply_matches_queries_and_keeps_source(engine, source, target, tmp_path, monkeypatch):
    world = _open_world(engine, tmp_path, monkeypatch)

    async def run():
        await _seed(world, source)
        before = await _snapshot(world)
        report = await storage_move.apply_move(world.db, world.company_id, target)
        assert report.ok
        assert report.wrote is True
        assert report.status == "completed"
        assert report.move_id
        _assert_checksums(report)
        assert await _mode(world) == target
        storage_router.forget_mode(world.company_id)
        assert await _snapshot(world) == before
        company = await world.db.companies.find_one({"_id": world.company_id})
        assert company.get("storage_write_lock") is False
        record = await world.db.storage_moves.find_one({"_id": report.move_id})
        assert record["status"] == "completed"
        assert "dedicated_dsn_ref" not in record
        assert _SECRET not in str(record)
        assert "gAAAA" not in str(record)
        for name in ("orders", "products", "invoices"):
            left = await storage_move._read(world.db, source, world.company_id, name, company)
            assert len(left) == 1
        await _other_untouched(world)

    try:
        asyncio.run(run())
    finally:
        _close_world(world)


@pytest.mark.parametrize("source,target", PAIRS)
def test_fault_rolls_back_target_and_keeps_mode(engine, source, target, tmp_path, monkeypatch, caplog):
    world = _open_world(engine, tmp_path, monkeypatch)
    real = storage_move._digest

    async def on_batch(name, count):
        raise RuntimeError(f"mysql://user:{_SECRET}@127.0.0.1:3306/app {_VKN} {_ETTN}")

    async def run():
        await _seed(world, source)
        before = await _snapshot(world)
        before_sql = world.counts()
        with caplog.at_level("INFO", logger="storage_move"):
            report = await storage_move.apply_move(
                world.db, world.company_id, target, batch_size=1, on_batch=on_batch,
            )
        assert report.ok is False
        assert report.wrote is False
        assert report.status == "failed"
        assert await _mode(world) == source
        assert await _snapshot(world) == before
        company = await world.db.companies.find_one({"_id": world.company_id})
        assert company.get("storage_write_lock") is not True
        for name in ("orders", "products", "invoices"):
            rows = await storage_move._read(world.db, target, world.company_id, name, company)
            assert rows == []
        record = await world.db.storage_moves.find_one({"_id": report.move_id})
        assert record["status"] == "failed"
        blob = str(record) + report.errors[0] + caplog.text
        assert _SECRET not in blob
        assert _VKN not in blob
        assert _ETTN not in blob
        assert "gAAAA" not in blob
        assert world.counts() == before_sql

    try:
        asyncio.run(run())
    finally:
        storage_move._digest = real
        _close_world(world)


@pytest.mark.parametrize("source,target", PAIRS)
def test_checksum_mismatch_rolls_back(engine, source, target, tmp_path, monkeypatch):
    world = _open_world(engine, tmp_path, monkeypatch)
    real = storage_move._digest
    state = {"armed": False, "n": 0}

    async def on_batch(name, count):
        if state["armed"]:
            return
        state["armed"] = True

        def fake(docs):
            state["n"] += 1
            if state["n"] == 2:
                return "0" * 64
            return real(docs)

        storage_move._digest = fake

    async def run():
        await _seed(world, source)
        report = await storage_move.apply_move(
            world.db, world.company_id, target, batch_size=1, on_batch=on_batch,
        )
        assert report.status == "failed"
        assert "sağlama" in report.errors[0]
        assert await _mode(world) == source
        company = await world.db.companies.find_one({"_id": world.company_id})
        for name in ("orders", "products", "invoices"):
            rows = await storage_move._read(world.db, target, world.company_id, name, company)
            assert rows == []
        assert not storage_router.company_write_locked(world.company_id)
        assert storage_router._move_owner is None

    try:
        asyncio.run(run())
    finally:
        storage_move._digest = real
        _close_world(world)


@pytest.mark.parametrize("source,target", PAIRS)
def test_rollback_copies_writes_back(engine, source, target, tmp_path, monkeypatch):
    world = _open_world(engine, tmp_path, monkeypatch)

    async def run():
        await _seed(world, source)
        report = await storage_move.apply_move(world.db, world.company_id, target)
        assert report.ok
        storage_router.forget_mode(world.company_id)
        handle = tenant_db.TenantDB(world.db, _scope(world.company_id))
        await handle.orders.insert_one({
            "_id": "o2",
            "company_id": world.company_id,
            "order_number": "S-2",
            "order_status": "open",
            "order_date": "2026-02-02",
            "contact_id": "c1",
            "channel": "manual",
            "total_amount": 4,
        })
        await handle.products.update_one({"_id": "p1"}, {"$set": {"name": "Kalem yeni"}})
        expected = await _snapshot(world)
        back = await storage_move.rollback_move(world.db, report.move_id)
        assert back.ok
        assert back.status == "rolled_back"
        assert back.wrote is True
        for pair in back.checksums.values():
            assert pair["source"] == pair["target"]
        assert await _mode(world) == source
        storage_router.forget_mode(world.company_id)
        assert await _snapshot(world) == expected
        record = await world.db.storage_moves.find_one({"_id": report.move_id})
        assert record["status"] == "rolled_back"
        assert _SECRET not in str(record)
        company = await world.db.companies.find_one({"_id": world.company_id})
        still = await storage_move._read(world.db, target, world.company_id, "orders", company)
        assert {row["_id"] for row in still} >= {"o1", "o2"}
        await _other_untouched(world)

    try:
        asyncio.run(run())
    finally:
        _close_world(world)


@pytest.mark.parametrize("source,target", PAIRS)
def test_write_lock_during_move(engine, source, target, tmp_path, monkeypatch):
    world = _open_world(engine, tmp_path, monkeypatch)
    seen = {}

    async def on_batch(name, count):
        if seen.get("hit"):
            return
        seen["hit"] = name
        assert storage_router.company_write_locked(world.company_id)
        company = await world.db.companies.find_one({"_id": world.company_id})
        assert company["storage_write_lock"] is True
        handle = tenant_db.TenantDB(world.db, _scope(world.company_id))
        current = await handle.orders.find_one({"_id": "o1"})
        assert current["order_number"] == "S-1"
        with pytest.raises(storage_router.StorageWriteLocked) as exc:
            await handle.orders.insert_one({
                "_id": "o-locked",
                "order_number": "S-kilit",
                "order_status": "open",
                "channel": "manual",
                "total_amount": 1,
            })
        assert "salt okunur" in str(exc.value)

    async def run():
        await _seed(world, source)
        report = await storage_move.apply_move(
            world.db, world.company_id, target, batch_size=1, on_batch=on_batch,
        )
        assert report.ok
        assert seen.get("hit")
        assert not storage_router.company_write_locked(world.company_id)
        company = await world.db.companies.find_one({"_id": world.company_id})
        assert company.get("storage_write_lock") is False
        storage_router.forget_mode(world.company_id)
        handle = tenant_db.TenantDB(world.db, _scope(world.company_id))
        await handle.products.insert_one({
            "_id": "p2",
            "name": "Defter",
            "sku": "K-2",
            "price": 3,
        })
        found = await handle.products.find_one({"_id": "p2"})
        assert found["name"] == "Defter"
        assert found["company_id"] == world.company_id

    try:
        asyncio.run(run())
    finally:
        _close_world(world)


@pytest.mark.parametrize("source,target", PAIRS)
def test_second_move_cannot_start(engine, source, target, tmp_path, monkeypatch):
    world = _open_world(engine, tmp_path, monkeypatch)
    started = asyncio.Event()
    release = asyncio.Event()

    async def on_batch(name, count):
        if started.is_set():
            return
        started.set()
        await release.wait()

    async def run():
        await _seed(world, source)
        task = asyncio.create_task(
            storage_move.apply_move(
                world.db, world.company_id, target, batch_size=1, on_batch=on_batch,
            )
        )
        await asyncio.wait_for(started.wait(), timeout=10)
        with pytest.raises(storage_router.StorageMoveBusy):
            await storage_move.apply_move(world.db, world.company_id, target)
        release.set()
        report = await task
        assert report.ok
        assert await _mode(world) == target
        assert storage_router._move_owner is None

    try:
        asyncio.run(run())
    finally:
        _close_world(world)


def test_flag_off_does_not_change_behavior(tmp_path, monkeypatch):
    world = _open_world("sqlite", tmp_path, monkeypatch)
    monkeypatch.delenv("STORAGE_ROUTER_ENABLED", raising=False)
    storage_router.reset()

    async def run():
        await world.db.companies.insert_one({
            "_id": world.company_id,
            "name": "Kapalı",
            "storage_mode": "shared_v2",
        })
        await world.db.products.insert_one({
            "_id": "p1",
            "company_id": world.company_id,
            "name": "eski",
            "sku": "E-1",
        })
        handle = tenant_db.TenantDB(world.db, _scope(world.company_id))
        assert handle._storage_mode is None
        assert handle._collection("products")._raw is world.db.products
        found = await handle.products.find_one({"_id": "p1"})
        assert found["name"] == "eski"
        report = await storage_move.apply_move(world.db, world.company_id, "dedicated")
        assert report.wrote is False
        assert report.ok is False
        assert "kapalı" in report.errors[0]
        assert await _mode(world) == "shared_v2"
        again = await world.db.products.find_one({"_id": "p1"})
        assert again["name"] == "eski"
        assert "storage_moves" not in world.db._cols
        assert handle._collection("orders")._raw is world.db.orders

    try:
        asyncio.run(run())
    finally:
        _close_world(world)


def test_cli_dry_run_and_missing_catalog(tmp_path, monkeypatch, capsys):
    world = _open_world("sqlite", tmp_path, monkeypatch)

    async def seed():
        await _seed(world, "legacy")

    try:
        asyncio.run(seed())
        code = storage_move.main(
            ["--company", world.company_id, "--to", "shared_v2"],
            catalog=world.db,
        )
        out = capsys.readouterr().out
        assert code == 0
        assert "yazılmadı" in out
        assert "dry-run" in out
        assert _SECRET not in out
        assert "storage_moves" not in world.db._cols
        missing = storage_move.main(["--company", "x", "--to", "legacy"], catalog=None)
        err = capsys.readouterr().err
        assert missing == 2
        assert "kataloğu yok" in err
    finally:
        _close_world(world)


def test_module_entrypoint_does_not_touch_env():
    env = os.environ.copy()
    for key in (
        "MYSQL_URL",
        "DATABASE_URL",
        "MYSQL_HOST",
        "MYSQL_PASSWORD",
        "MYSQL_USER",
        "STORAGE_MARIADB_DSN",
        "STORAGE_SHARED_V2_TEST_DSN",
    ):
        env.pop(key, None)
    proc = subprocess.run(
        [sys.executable, "-m", "scripts.storage_move"],
        cwd=str(_BACKEND),
        capture_output=True,
        text=True,
        check=False,
        env=env,
    )
    assert proc.returncode == 2
    assert "kataloğu yok" in proc.stderr
    assert _SECRET not in proc.stderr
    assert ".env" not in proc.stderr


def test_rollback_refuses_when_source_is_gone(tmp_path, monkeypatch):
    world = _open_world("sqlite", tmp_path, monkeypatch)

    async def run():
        await _seed(world, "legacy")
        report = await storage_move.apply_move(world.db, world.company_id, "shared_v2")
        assert report.ok
        for name in ("orders", "products", "invoices"):
            await world.db[name].delete_many({"company_id": world.company_id})
        back = await storage_move.rollback_move(world.db, report.move_id)
        assert back.ok is False
        assert "durmuyor" in back.errors[0]
        assert await _mode(world) == "shared_v2"
        record = await world.db.storage_moves.find_one({"_id": report.move_id})
        assert record["status"] == "completed"

    try:
        asyncio.run(run())
    finally:
        _close_world(world)


def test_apply_waits_lock_ttl_then_mode_ttl(tmp_path, monkeypatch):
    slept = []
    monkeypatch.setattr(storage_move.time, "sleep", lambda seconds: slept.append(seconds))
    monkeypatch.setattr(storage_router, "LOCK_TTL_SECONDS", 0.25)
    monkeypatch.setattr(storage_router, "TTL_SECONDS", 0.4)
    monkeypatch.delenv("STORAGE_MOVE_LOCK_TTL", raising=False)
    monkeypatch.delenv("STORAGE_MOVE_MODE_TTL", raising=False)
    world = _open_world("sqlite", tmp_path, monkeypatch)

    async def run():
        await _seed(world, "legacy")
        report = await storage_move.apply_move(world.db, world.company_id, "shared_v2")
        assert report.ok
        company = await world.db.companies.find_one({"_id": world.company_id})
        assert int(company.get("storage_epoch") or 0) >= 1
        assert "bekle:kilit" in {step.get("name") for step in report.steps}
        assert "bekle:kip" in {step.get("name") for step in report.steps}

    try:
        asyncio.run(run())
        assert slept[0] == 0.25
        assert 0.4 in slept
        assert slept[-1] == 0.25
    finally:
        _close_world(world)


def test_routed_membership_and_token_are_copied(tmp_path, monkeypatch):
    world = _open_world("sqlite", tmp_path, monkeypatch)

    async def run():
        await _seed(world, "legacy")
        await world.db.users.insert_one({
            "_id": "user-move",
            "email": "move@example.com",
            "company_ids": [world.company_id, world.other_id],
        })
        await world.db.password_resets.insert_one({
            "_id": "reset-move",
            "company_id": world.company_id,
            "token_hash": "hash-move",
        })
        await world.db.password_resets.insert_one({
            "_id": "reset-other",
            "company_id": world.other_id,
            "token_hash": "hash-other",
        })
        report = await storage_move.apply_move(world.db, world.company_id, "shared_v2")
        assert report.ok
        names = {row["name"] for row in report.collections}
        assert "users" in names
        assert "password_resets" in names
        users = storage_router.collection_for_mode(world.db, "shared_v2", world.company_id, "users")
        found = await users.find_one({"_id": "user-move"})
        assert found["email"] == "move@example.com"
        resets = storage_router.collection_for_mode(world.db, "shared_v2", world.company_id, "password_resets")
        own = await resets.find_one({"_id": "reset-move"})
        assert own["token_hash"] == "hash-move"
        assert await resets.find_one({"_id": "reset-other"}) is None
        still = await world.db.password_resets.find_one({"_id": "reset-other"})
        assert still["company_id"] == world.other_id

    try:
        asyncio.run(run())
    finally:
        _close_world(world)


def test_legacy_names_without_list_collection_names(tmp_path, monkeypatch):
    world = _open_world("sqlite", tmp_path, monkeypatch)

    class Hidden:
        def __init__(self, inner):
            self._inner = inner

        def __getitem__(self, name):
            return self._inner[name]

        @property
        def companies(self):
            return self._inner.companies

        @property
        def _cols(self):
            return self._inner._cols

    async def run():
        await _seed(world, "legacy")
        hidden = Hidden(world.db)
        assert getattr(hidden, "list_collection_names", None) is None
        report = await storage_move.plan_move(hidden, world.company_id, "shared_v2")
        assert report.ok
        assert "orders" in {row["name"] for row in report.collections}

    try:
        asyncio.run(run())
    finally:
        _close_world(world)


def test_sql_collection_list_when_method_missing(monkeypatch):
    seen = {}

    def fake_sql(settings):
        seen["db"] = settings.get("db")
        return ["orders", "companies"]

    monkeypatch.setattr(storage_move, "_sql_collections", fake_sql)

    class Bare:
        _settings = {"host": "127.0.0.1", "db": "tamkobi", "user": "u", "password": "gizli"}

    names = asyncio.run(storage_move._list_names(Bare()))
    assert names == ["orders", "companies"]
    assert seen["db"] == "tamkobi"


def test_t_row_unique_is_checked_directly(tmp_path, monkeypatch):
    world = _open_world("sqlite", tmp_path, monkeypatch)
    world.db._indexes = {"orders": [(("order_number",), True)]}
    world.db.orders._db = world.db

    async def run():
        await _seed(world, "legacy")
        report = await storage_move.apply_move(world.db, world.company_id, "shared_v2")
        assert report.ok
        pair = report.checksums["t_row_unique"]
        assert pair["source"] == pair["target"]
        assert report.counts["t_row_unique"]["source"] >= 1
        rows = storage_move._fetch_unique(world.company_id, ["orders"])
        assert rows
        assert rows[0][0] == "orders"
        assert rows[0][1] == "o1"

    try:
        asyncio.run(run())
    finally:
        _close_world(world)
