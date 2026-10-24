"""Dedicated şema açılışta sürer. Anahtar tablosu yokken banka ekleme 500 olmaz.

Canlı veritabanına ve 8021 portuna bağlanmaz. DSN loglanmaz.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sqlite3
import sys
from pathlib import Path

import pytest
from cryptography.fernet import Fernet

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

import storage_dedicated  # noqa: E402
import storage_router  # noqa: E402
from mysql_store import DuplicateKeyError  # noqa: E402
from storage_dedicated import DedicatedStorageError  # noqa: E402
from storage_migrations.engine import apply  # noqa: E402
from storage_migrations.loader import load_migrations  # noqa: E402
from storage_migrations.session import connect  # noqa: E402

EXT = "ext-startup-1"


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    storage_router.reset()
    storage_dedicated.reset_pools()
    monkeypatch.delenv("STORAGE_ROUTER_ENABLED", raising=False)
    yield
    storage_router.reset()
    storage_dedicated.reset_pools()


def _run(coro):
    return asyncio.run(coro)


def _seal(monkeypatch, tmp_path):
    previous = os.environ.get("CREDENTIAL_ENCRYPTION_KEY")
    monkeypatch.setenv("CREDENTIAL_ENCRYPTION_KEY", Fernet.generate_key().decode())
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


def _apply_until(dsn: str, version: int) -> None:
    session = connect(dsn, write=True)
    try:
        pack = tuple(item for item in load_migrations() if item.version <= version)
        apply(session, pack, confirm=True, dry_run=False)
    finally:
        session.close()


def _names(path: Path) -> set[str]:
    conn = sqlite3.connect(path)
    try:
        rows = conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'").fetchall()
    finally:
        conn.close()
    return {row[0] for row in rows}


def _versions(path: Path) -> dict:
    conn = sqlite3.connect(path)
    try:
        rows = conn.execute("SELECT version, state FROM schema_version").fetchall()
    finally:
        conn.close()
    return {int(row[0]): row[1] for row in rows}


class _Companies:
    def __init__(self, docs):
        self.docs = docs

    def find(self, query=None):
        rows = list(self.docs)

        class _Cursor:
            async def to_list(self, limit=None):
                return rows

        return _Cursor()


class _DB:
    def __init__(self, docs):
        self.companies = _Companies(docs)

    def __getitem__(self, name):
        if name == "companies":
            return self.companies
        raise KeyError(name)


class _Rows:
    def __init__(self, rows):
        self._rows = list(rows)

    def fetchmany(self, size):
        chunk = self._rows[:size]
        self._rows = self._rows[size:]
        return chunk

    def fetchall(self):
        rows = self._rows
        self._rows = []
        return rows


class _MissingTable(Exception):
    def __init__(self):
        super().__init__(1146, "Table 'tk_comp.storage_bank_external' doesn't exist")


class _Session:
    """Şema var. Anahtar tablosu ya listelenmez ya da kullanımı 1146 verir."""

    def __init__(self, *, tables_raise=False, listed=False):
        self.docs = []
        self.tables_raise = tables_raise
        self.listed = listed
        self.calls = 0
        self.dialect = "mysql"

    def tables(self):
        self.calls += 1
        # Şema kontrolü tek sayılı çağrıdadır. Anahtar kontrolü çift sayılıda 1146 verir.
        if self.tables_raise and self.calls % 2 == 0:
            raise _MissingTable()
        names = {"storage_records", "schema_version"}
        if self.listed:
            names.add("storage_bank_external")
        return names

    def fetchall(self, sql, params=None):
        if "schema_version" in sql:
            return [(4,)]
        if "SELECT doc FROM storage_records" in sql:
            return [(json.dumps(doc),) for doc in self.docs]
        return []

    def execute(self, sql, params=None):
        if "storage_bank_external" in sql.lower():
            raise _MissingTable()
        if "INSERT INTO storage_records" in sql:
            self.docs.append(json.loads(params[2]))
            return _Rows([])
        if "FROM storage_records" in sql:
            if "SELECT doc " in sql:
                rows = [(json.dumps(doc),) for doc in self.docs]
            else:
                rows = [
                    (doc.get("_id"), doc.get("company_id"), doc.get("external_id"))
                    for doc in self.docs
                ]
            return _Rows(rows)
        return _Rows([])

    def commit(self):
        return None

    def rollback(self):
        return None


def _insert_pair(session, company_id: str):
    coll = storage_dedicated.DedicatedCollection(company_id, "bank_transactions", "sqlite:///unused")
    token = storage_dedicated.use_read_session(company_id, session)
    try:
        async def run():
            first = await coll.insert_one({
                "_id": "b1",
                "company_id": company_id,
                "external_id": EXT,
                "amount": 1,
            })
            assert first.inserted_id == "b1"
            with pytest.raises(DuplicateKeyError):
                await coll.insert_one({
                    "_id": "b2",
                    "company_id": company_id,
                    "external_id": EXT,
                    "amount": 2,
                })

        _run(run())
    finally:
        storage_dedicated.reset_read_session(token)


def test_startup_calls_dedicated_migration_after_warm():
    text = (_BACKEND / "server.py").read_text(encoding="utf-8")
    warm = text.find("warm_dedicated_refs")
    migrate = text.find("apply_dedicated_migrations")
    assert warm > 0
    assert migrate > warm


def test_schema_is_not_applied_on_read_or_move_helpers():
    """Şema yazan yollar hazırlık, CLI ve açılış. Okuma ve taşıma betiği uygulamaz."""
    move = (_BACKEND / "scripts" / "storage_move.py").read_text(encoding="utf-8")
    assert "apply_schema" not in move
    assert "apply_dedicated_migrations" not in move
    dedicated = (_BACKEND / "storage_dedicated.py").read_text(encoding="utf-8")
    assert "burada tablo açılmaz" in dedicated.split("class DedicatedCollection", 1)[0]


def test_bank_insert_without_key_table_uses_scan_and_warns(tmp_path, caplog):
    path = tmp_path / "v6.db"
    dsn = f"sqlite:///{path}"
    _apply_until(dsn, 6)
    assert "storage_bank_external" not in _names(path)
    assert 7 not in _versions(path)
    company_id = "comp_v6"
    coll = storage_dedicated.DedicatedCollection(company_id, "bank_transactions", dsn)

    async def run():
        await coll.insert_one({
            "_id": "b1",
            "company_id": company_id,
            "external_id": EXT,
            "amount": 4,
        })
        with pytest.raises(DuplicateKeyError):
            await coll.insert_one({
                "_id": "b2",
                "company_id": company_id,
                "external_id": f"  {EXT}  ",
                "amount": 5,
            })
        removed = await coll.delete_one({"_id": "b1", "company_id": company_id})
        assert removed.deleted_count == 1

    with caplog.at_level(logging.WARNING, logger="storage_dedicated"):
        _run(run())
    assert "storage_bank_external yok" in caplog.text
    assert company_id in caplog.text
    assert "sqlite://" not in caplog.text
    assert "storage_bank_external" not in _names(path)
    conn = sqlite3.connect(path)
    try:
        left = conn.execute(
            "SELECT doc_id FROM storage_records WHERE collection = ?",
            ("bank_transactions",),
        ).fetchall()
    finally:
        conn.close()
    assert left == []


@pytest.mark.parametrize("tables_raise,listed", [(True, False), (False, True)])
def test_mysql_1146_on_key_table_does_not_become_storage_error(tables_raise, listed, caplog):
    session = _Session(tables_raise=tables_raise, listed=listed)
    company_id = "comp_mysql"
    with caplog.at_level(logging.WARNING, logger="storage_dedicated"):
        _insert_pair(session, company_id)
    assert len(session.docs) == 1
    assert session.docs[0]["_id"] == "b1"
    assert "storage_bank_external yok" in caplog.text
    assert "Dedicated işlemi kesildi" not in caplog.text


def test_flag_off_does_not_migrate(monkeypatch):
    monkeypatch.delenv("STORAGE_ROUTER_ENABLED", raising=False)

    async def run():
        return await storage_router.apply_dedicated_migrations(_DB([]))

    assert _run(run()) == []


def test_startup_applies_pending_migration_and_is_idempotent(monkeypatch, tmp_path, caplog):
    previous, comm_service = _seal(monkeypatch, tmp_path)
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    try:
        ready = tmp_path / "ready.db"
        legacy = tmp_path / "legacy.db"
        _apply_until(f"sqlite:///{ready}", 6)
        sealed = storage_router.seal_dedicated_dsn(f"sqlite:///{ready}")
        docs = [
            {"_id": "comp_legacy", "storage_mode": "legacy"},
            {
                "_id": "comp_bad",
                "storage_mode": "dedicated",
                "storage_epoch": 1,
                "dedicated_dsn_ref": "not-sealed",
            },
            {
                "_id": "comp_ready",
                "storage_mode": "dedicated",
                "storage_epoch": 1,
                "storage_write_lock": True,
                "dedicated_dsn_ref": sealed,
            },
            {"_id": "comp_noref", "storage_mode": "dedicated", "storage_epoch": 1},
        ]

        async def once():
            return await storage_router.apply_dedicated_migrations(_DB(docs))

        with caplog.at_level(logging.INFO, logger="storage_dedicated"):
            first = _run(once())
            second = _run(once())
        by_id = {row["company_id"]: row for row in first}
        assert set(by_id) == {"comp_bad", "comp_ready"}
        assert by_id["comp_bad"]["ok"] is False
        assert by_id["comp_ready"]["ok"] is True
        assert by_id["comp_ready"]["advanced"] == 1
        assert _versions(ready)[7] == "applied"
        assert "storage_bank_external" in _names(ready)
        assert all(row["advanced"] == 0 and row["ok"] for row in second if row["company_id"] == "comp_ready")
        assert not legacy.exists()
        assert "sqlite://" not in caplog.text
        assert "gAAAA" not in caplog.text
        assert "not-sealed" not in caplog.text
    finally:
        _restore(monkeypatch, previous, comm_service)


def test_dedicated_storage_error_is_unhandled_runtime_error():
    """Yakalanmayan dedicated hatası HTTP katmanında 500 olur. 1146 o yola düşmemeli."""
    err = DedicatedStorageError("Dedicated işlemi kesildi.", company_id="comp_ready")
    assert isinstance(err, RuntimeError)
    assert not isinstance(err, storage_router.StorageWriteLocked)
