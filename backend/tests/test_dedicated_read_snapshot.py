"""Dedicated havuz bağlantısı bayat REPEATABLE READ görüntüsü tutmasın.

autocommit kapalı kalır. İki yazma aynı commit'tedir; commit sonrası
rollback satırı silmez. Okuma bitince görüntü kapanır, diğer worker'ın
commit'i sonraki okumada ve /api/sync imlecinde görünür.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

import pytest

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

import storage_dedicated  # noqa: E402
import tenant_scope  # noqa: E402
from storage_dedicated import DedicatedCollection, DedicatedStorageError  # noqa: E402

CO = "co_snap"
DSN = "mysql://user@127.0.0.1/snap"


class _Cur:
    def __init__(self, rows):
        self._rows = list(rows)
        self._i = 0

    def fetchmany(self, n):
        chunk = self._rows[self._i:self._i + int(n)]
        self._i += int(n)
        return chunk

    def fetchall(self):
        rest = self._rows[self._i:]
        self._i = len(self._rows)
        return rest

    def close(self):
        return None


class RRSession:
    """REPEATABLE READ: ilk SELECT görüntüyü dondurur, rollback çözene kadar."""

    def __init__(self, *, fail_storage: bool = False, reject_isolation: bool = False):
        self.dialect = "mysql"
        self.autocommit = False
        self.store = []
        self.keys = []
        self.buf = []
        self.snapshot = None
        self.sqls = []
        self.rollbacks = 0
        self.commits = 0
        self.fail_storage = fail_storage
        self.reject_isolation = reject_isolation

    def tables(self):
        return {"schema_version", "storage_records", "storage_bank_external"}

    def execute(self, sql, params=None):
        text = str(sql or "").strip()
        self.sqls.append(text)
        head = text.lstrip().upper()
        if head.startswith("SET"):
            if self.reject_isolation:
                raise RuntimeError("izolasyon reddedildi")
            return _Cur([])
        if head.startswith("SELECT"):
            if "schema_version" in text:
                return _Cur([(storage_dedicated.STORAGE_RECORDS_VERSION,)])
            if self.snapshot is None:
                self.snapshot = list(self.store)
            coll = params[0] if params else None
            rows = []
            for collection, _doc_id, doc in self.snapshot:
                if coll is None or collection == coll:
                    rows.append((doc,))
            return _Cur(rows)
        if head.startswith("INSERT") and "storage_records" in text:
            if self.fail_storage:
                self.fail_storage = False
                raise RuntimeError("kesildi")
            self.buf.append(("doc", tuple(params or ())))
            return _Cur([])
        if head.startswith("INSERT") and "storage_bank_external" in text:
            self.buf.append(("key", tuple(params or ())))
            return _Cur([])
        return _Cur([])

    def fetchall(self, sql, params=None):
        return self.execute(sql, params).fetchall()

    def commit(self):
        for kind, params in self.buf:
            if kind == "doc":
                self.store.append(params)
            else:
                self.keys.append(params)
        self.buf.clear()
        self.snapshot = None
        self.commits += 1

    def rollback(self):
        self.buf.clear()
        self.snapshot = None
        self.rollbacks += 1

    def close(self):
        return None


@pytest.fixture(autouse=True)
def _quiet():
    previous = tenant_scope.set_mode("off")
    storage_dedicated.reset_pools()
    yield
    tenant_scope.set_mode(previous)
    storage_dedicated.reset_pools()


def _run(coro):
    return asyncio.run(coro)


def _patch_connect(monkeypatch, session):
    def _connect(dsn, write=True):
        return session

    monkeypatch.setattr(storage_dedicated, "connect", _connect)


def _doc(doc_id, stamp):
    return json.dumps({
        "_id": doc_id,
        "company_id": CO,
        "_row_updated_at": stamp,
    })


def test_read_committed_and_snapshot_closes(monkeypatch):
    session = RRSession()
    _patch_connect(monkeypatch, session)
    coll = DedicatedCollection(CO, "expenses", DSN)

    async def run():
        await coll.find({}).to_list(10)
        session.store.append(("expenses", "new", _doc("new", "2026-10-24T12:00:00+00:00")))
        found = await coll.find({}).to_list(10)
        ids = [json.loads(row[2])["_id"] for row in session.store]
        return [doc["_id"] for doc in found], ids

    found, stored = _run(run())
    assert stored == ["new"]
    assert found == ["new"]
    assert session.rollbacks >= 1
    assert session.autocommit is False
    assert any("READ COMMITTED" in sql for sql in session.sqls)
    assert not any("autocommit" in sql.lower() for sql in session.sqls)


def test_sync_sees_other_worker_after_snapshot(monkeypatch):
    session = RRSession()
    session.store.append(("expenses", "old", _doc("old", "2026-10-24T10:00:00+00:00")))
    _patch_connect(monkeypatch, session)
    coll = DedicatedCollection(CO, "expenses", DSN)
    since = "2026-10-24T11:00:00+00:00"

    async def run():
        first, _cursor, _more = await coll.changed_since(since, company_id=CO, limit=10)
        session.store.append(("expenses", "new", _doc("new", "2026-10-24T12:00:00+00:00")))
        second, _cursor2, _more2 = await coll.changed_since(since, company_id=CO, limit=10)
        return first, second

    first, second = _run(run())
    assert [doc["_id"] for doc in first] == []
    assert [doc["_id"] for doc in second] == ["new"]


def test_commit_survives_later_rollback(monkeypatch):
    session = RRSession()
    _patch_connect(monkeypatch, session)
    coll = DedicatedCollection(CO, "expenses", DSN)

    async def run():
        result = await coll.insert_one({"_id": "e1", "company_id": CO, "amount": 5})
        session.rollback()
        found = await coll.find_one({"_id": "e1"})
        return result.inserted_id, found

    inserted, found = _run(run())
    assert inserted == "e1"
    assert found["_id"] == "e1"
    assert session.commits >= 1
    assert session.autocommit is False


def test_failed_bank_write_rolls_back_key_and_doc(monkeypatch):
    session = RRSession(fail_storage=True)
    _patch_connect(monkeypatch, session)
    coll = DedicatedCollection(CO, "bank_transactions", DSN)

    async def run():
        with pytest.raises(DedicatedStorageError):
            await coll.insert_one({
                "_id": "b1",
                "company_id": CO,
                "external_id": "ext-1",
                "amount": 9,
            })

    _run(run())
    assert session.store == []
    assert session.keys == []
    assert session.buf == []


def test_bank_key_and_doc_commit_together(monkeypatch):
    session = RRSession()
    _patch_connect(monkeypatch, session)
    coll = DedicatedCollection(CO, "bank_transactions", DSN)

    async def run():
        await coll.insert_one({
            "_id": "b1",
            "company_id": CO,
            "external_id": "ext-1",
            "amount": 9,
        })

    _run(run())
    assert len(session.store) == 1
    assert session.store[0][1] == "b1"
    assert len(session.keys) == 1
    assert session.keys[0][1] == "ext-1"


def test_isolation_failure_still_refreshes_snapshot(monkeypatch):
    session = RRSession(reject_isolation=True)
    _patch_connect(monkeypatch, session)
    coll = DedicatedCollection(CO, "expenses", DSN)

    async def run():
        await coll.find({}).to_list(5)
        session.store.append(("expenses", "new", _doc("new", "2026-10-24T12:00:00+00:00")))
        return await coll.find({}).to_list(5)

    found = _run(run())
    assert [doc["_id"] for doc in found] == ["new"]


def test_injected_session_is_left_open():
    session = RRSession()
    coll = DedicatedCollection(CO, "expenses", DSN)
    token = storage_dedicated.use_read_session(CO, session)
    try:
        _run(coll.find({}).to_list(5))
    finally:
        storage_dedicated.reset_read_session(token)
    assert session.rollbacks == 0
    assert session.commits == 0
