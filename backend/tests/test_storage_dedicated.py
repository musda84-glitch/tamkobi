"""Dedicated arka uç. Canlı veritabanına ve 8021 portuna bağlanmaz.

İki firma iki geçici dosyada durur. Havuz sınırı, boşta kapanma ve
şema sürümü açık hata verir. DSN loga ve hata metnine yazılmaz.
"""
from __future__ import annotations

import asyncio
import logging
import os
import sqlite3
import sys
from pathlib import Path

import pytest
from cryptography.fernet import Fernet

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(Path(__file__).resolve().parent))

os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

from dashboard_memdb import MemDB  # noqa: E402
import storage_dedicated  # noqa: E402
import storage_router  # noqa: E402
import tenant_db  # noqa: E402
from storage_dedicated import DedicatedStorageError  # noqa: E402
from storage_migrations.engine import apply  # noqa: E402
from storage_migrations.loader import load_migrations  # noqa: E402
from storage_migrations.session import connect  # noqa: E402
from tenant_scope import TenantScope  # noqa: E402

SECRET = "s3cret-dsn-value"
CO_A = "co_a"
CO_B = "co_b"
CO_L = "co_legacy"


@pytest.fixture(autouse=True)
def _reset():
    storage_router.reset()
    yield
    storage_router.reset()


def _scope(company_id):
    return TenantScope(
        company_id=company_id,
        allowed=frozenset({company_id}),
        kind="user",
        actor_id="user-a",
        reason="test",
    )


def _migrate(dsn, pack=None):
    session = connect(dsn, write=True)
    try:
        apply(session, pack, confirm=True, dry_run=False)
    finally:
        session.close()


def _seal(monkeypatch, tmp_path):
    key = Fernet.generate_key().decode()
    previous = os.environ.get("CREDENTIAL_ENCRYPTION_KEY")
    monkeypatch.setenv("CREDENTIAL_ENCRYPTION_KEY", key)
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    import comm_service

    comm_service.reset_fernet_for_tests()
    return previous, comm_service


def _restore(monkeypatch, previous, comm_service):
    if previous is None:
        monkeypatch.delenv("CREDENTIAL_ENCRYPTION_KEY", raising=False)
    else:
        monkeypatch.setenv("CREDENTIAL_ENCRYPTION_KEY", previous)
    comm_service.reset_fernet_for_tests()


def _names(path):
    conn = sqlite3.connect(path)
    try:
        return {row[0] for row in conn.execute("SELECT name FROM sqlite_master")}
    finally:
        conn.close()


def _bodies(path, collection):
    conn = sqlite3.connect(path)
    try:
        rows = conn.execute(
            "SELECT doc FROM storage_records WHERE collection = ?",
            (collection,),
        ).fetchall()
    finally:
        conn.close()
    return [row[0] for row in rows]


def test_two_dedicated_companies_do_not_mix(monkeypatch, tmp_path):
    previous, comm_service = _seal(monkeypatch, tmp_path)
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    try:
        path_a = tmp_path / SECRET / "a.db"
        path_b = tmp_path / SECRET / "b.db"
        path_a.parent.mkdir()
        dsn_a = f"sqlite:///{path_a}"
        dsn_b = f"sqlite:///{path_b}"
        _migrate(dsn_a)
        _migrate(dsn_b)
        db = MemDB()

        async def run():
            await db.companies.insert_one({
                "_id": CO_A,
                "storage_mode": "dedicated",
                "dedicated_dsn_ref": storage_router.seal_dedicated_dsn(dsn_a),
            })
            await db.companies.insert_one({
                "_id": CO_B,
                "storage_mode": " Dedicated ",
                "dedicated_dsn_ref": storage_router.seal_dedicated_dsn(dsn_b),
            })
            await db.companies.insert_one({"_id": CO_L, "name": "legacy"})
            legacy = tenant_db.TenantDB(db, _scope(CO_L))
            await legacy.products.insert_one({"_id": "p1", "name": "eski"})
            first = tenant_db.TenantDB(db, _scope(CO_A))
            second = tenant_db.TenantDB(db, _scope(CO_B))
            raw = first._collection("products")
            assert SECRET not in repr(raw)
            assert SECRET not in repr(raw._raw)
            await first.products.insert_one({"_id": "p1", "name": "kalem", "sku": "A"})
            await second.products.insert_one({"_id": "p1", "name": "defter", "sku": "B"})
            await first.products.update_one({"_id": "p1"}, {"$set": {"sku": "A2"}})
            got_a = await first.products.find_one({"_id": "p1"})
            got_b = await second.products.find_one({"sku": "B"})
            got_l = await legacy.products.find_one({"_id": "p1"})
            assert got_a["name"] == "kalem"
            assert got_a["sku"] == "A2"
            assert got_a["company_id"] == CO_A
            assert got_b["name"] == "defter"
            assert got_b["company_id"] == CO_B
            assert got_l["name"] == "eski"
            assert await second.products.find_one({"name": "kalem"}) is None
            assert await first.products.find_one({"name": "defter"}) is None
            assert await db.products.find_one({"name": "kalem"}) is None
            assert await db.products.find_one({"name": "defter"}) is None
            listed = await first.products.find({"company_id": CO_A}).to_list(10)
            assert [row["name"] for row in listed] == ["kalem"]
            stored = next(item for item in db.companies.docs if item["_id"] == CO_A)
            assert stored["dedicated_dsn_ref"].startswith("gAAAA")
            assert SECRET not in stored["dedicated_dsn_ref"]

        asyncio.run(run())
        blob_a = "\n".join(_bodies(path_a, "products"))
        blob_b = "\n".join(_bodies(path_b, "products"))
        assert "kalem" in blob_a
        assert "defter" not in blob_a
        assert "eski" not in blob_a
        assert "defter" in blob_b
        assert "kalem" not in blob_b
        assert "docs" not in _names(path_a)
    finally:
        _restore(monkeypatch, previous, comm_service)


def test_async_entry_uses_sealed_ref_not_legacy(monkeypatch, tmp_path):
    previous, comm_service = _seal(monkeypatch, tmp_path)
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    try:
        path_a = tmp_path / "a.db"
        path_b = tmp_path / "b.db"
        dsn_a = f"sqlite:///{path_a}"
        dsn_b = f"sqlite:///{path_b}"
        _migrate(dsn_a)
        _migrate(dsn_b)

        class Companies:
            def __init__(self):
                self.rows = {}

            async def find_one(self, query, projection=None):
                doc = self.rows.get(str((query or {}).get("_id") or ""))
                if not doc:
                    return None
                if not projection:
                    return dict(doc)
                out = {"_id": doc.get("_id")}
                for key, flag in projection.items():
                    if flag and key in doc:
                        out[key] = doc[key]
                return out

        class DB:
            def __init__(self):
                self.companies = Companies()

            def __getitem__(self, name):
                if name == "companies":
                    return self.companies
                raise AssertionError("legacy yol")

        db = DB()
        db.companies.rows[CO_A] = {
            "_id": CO_A,
            "storage_mode": "dedicated",
            "dedicated_dsn_ref": storage_router.seal_dedicated_dsn(dsn_a),
        }
        db.companies.rows[CO_B] = {
            "_id": CO_B,
            "storage_mode": "dedicated",
            "dedicated_dsn_ref": storage_router.seal_dedicated_dsn(dsn_b),
        }
        tenant_db.init(db)

        async def run():
            async with tenant_db.for_company(CO_A, "aktar") as handle:
                await handle.products.insert_one({"_id": "p1", "name": "kalem"})
                found = await handle.products.find_one({"_id": "p1"})
                assert found["name"] == "kalem"
                assert found["company_id"] == CO_A
            async with tenant_db.for_company(CO_B, "aktar") as handle:
                await handle.products.insert_one({"_id": "p1", "name": "defter"})
                assert await handle.products.find_one({"name": "kalem"}) is None

        asyncio.run(run())
        assert storage_dedicated._sealed[CO_A].startswith("gAAAA")
        assert SECRET not in storage_dedicated._sealed[CO_A]
        assert "kalem" in "\n".join(_bodies(path_a, "products"))
        assert "defter" not in "\n".join(_bodies(path_a, "products"))
        assert "defter" in "\n".join(_bodies(path_b, "products"))
        assert "kalem" not in "\n".join(_bodies(path_b, "products"))
    finally:
        _restore(monkeypatch, previous, comm_service)


def test_old_schema_is_rejected_without_creating_tables(monkeypatch, tmp_path):
    previous, comm_service = _seal(monkeypatch, tmp_path)
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    try:
        assert storage_dedicated.expected_schema_version() == 4
        path = tmp_path / "eski.db"
        dsn = f"sqlite:///{path}"
        pack = load_migrations()
        _migrate(dsn, pack[:2])
        before = _names(path)
        assert "storage_records" not in before
        db = MemDB()

        async def run():
            await db.companies.insert_one({
                "_id": CO_A,
                "storage_mode": "dedicated",
                "dedicated_dsn_ref": storage_router.seal_dedicated_dsn(dsn),
            })
            handle = tenant_db.TenantDB(db, _scope(CO_A))
            with pytest.raises(DedicatedStorageError, match="şema sürümü eski") as caught:
                await handle.products.find_one({"_id": "p1"})
            assert SECRET not in str(caught.value)
            assert "sqlite" not in str(caught.value)
            assert _names(path) == before
            _migrate(dsn)
            await handle.products.insert_one({"_id": "p1", "name": "kalem"})
            found = await handle.products.find_one({"_id": "p1"})
            assert found["name"] == "kalem"

        asyncio.run(run())
        source = Path(storage_dedicated.__file__).read_text(encoding="utf-8").upper()
        assert "CREATE TABLE" not in source
        assert "CREATE INDEX" not in source
    finally:
        _restore(monkeypatch, previous, comm_service)


def test_pool_lru_idle_and_open_failure(monkeypatch, tmp_path, caplog):
    monkeypatch.setenv("STORAGE_DEDICATED_POOL_MAX", "2")
    monkeypatch.setenv("STORAGE_DEDICATED_POOL_IDLE_SECONDS", "10")
    clock = {"t": 1_000.0}
    monkeypatch.setattr(storage_dedicated, "_now", lambda: clock["t"])
    opens = {"n": 0}
    real = storage_dedicated.connect

    def counting(dsn, *, write):
        opens["n"] += 1
        if "bozuk" in dsn:
            logging.getLogger("storage_dedicated").warning("fail %s", dsn)
            raise RuntimeError(dsn)
        return real(dsn, write=write)

    monkeypatch.setattr(storage_dedicated, "connect", counting)
    path_a = tmp_path / "a.db"
    path_b = tmp_path / "b.db"
    path_c = tmp_path / "c.db"
    dsn_a = f"sqlite:///{path_a}"
    dsn_b = f"sqlite:///{path_b}"
    dsn_c = f"sqlite:///{path_c}"
    caplog.set_level(logging.WARNING, logger="storage_dedicated")
    storage_dedicated.acquire(CO_A, dsn_a)
    storage_dedicated.acquire(CO_B, dsn_b)
    assert opens["n"] == 2
    with pytest.raises(DedicatedStorageError, match="dolu") as caught:
        storage_dedicated.acquire("co_c", dsn_c)
    assert SECRET not in str(caught.value)
    assert storage_dedicated.is_open(CO_A)
    assert storage_dedicated.is_open(CO_B)
    storage_dedicated.release(CO_A)
    storage_dedicated.acquire("co_c", dsn_c)
    assert opens["n"] == 3
    assert not storage_dedicated.is_open(CO_A)
    assert storage_dedicated.is_open(CO_B)
    assert storage_dedicated.is_open("co_c")
    storage_dedicated.release(CO_B)
    storage_dedicated.release("co_c")
    first = storage_dedicated.generation(CO_B)
    clock["t"] += 11
    storage_dedicated.acquire(CO_B, dsn_b)
    assert opens["n"] == 4
    assert storage_dedicated.generation(CO_B) != first
    storage_dedicated.release(CO_B)
    bad = f"sqlite:///{tmp_path / SECRET / 'bozuk.db'}"
    with pytest.raises(DedicatedStorageError, match="açılamadı") as caught:
        storage_dedicated.acquire("co_bad", bad)
    assert SECRET not in str(caught.value)
    assert "bozuk" not in str(caught.value)
    assert SECRET not in caplog.text
    assert "bozuk" not in caplog.text
    assert not storage_dedicated.is_open("co_bad")


def test_flag_off_keeps_legacy_collection(monkeypatch, tmp_path):
    previous, comm_service = _seal(monkeypatch, tmp_path)
    monkeypatch.delenv("STORAGE_ROUTER_ENABLED", raising=False)
    try:
        path = tmp_path / "a.db"
        dsn = f"sqlite:///{path}"
        db = MemDB()

        async def run():
            await db.companies.insert_one({
                "_id": CO_A,
                "storage_mode": "dedicated",
                "dedicated_dsn_ref": storage_router.seal_dedicated_dsn(dsn),
            })
            handle = tenant_db.TenantDB(db, _scope(CO_A))
            await handle.products.insert_one({"_id": "p1", "name": "eski"})
            found = await db.products.find_one({"_id": "p1"})
            assert found["name"] == "eski"

        asyncio.run(run())
        assert not path.exists()
    finally:
        _restore(monkeypatch, previous, comm_service)
