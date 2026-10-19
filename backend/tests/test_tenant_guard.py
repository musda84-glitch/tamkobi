"""Kiracı çalışma zamanı koruması. Bellek içi MemDB; canlı veritabanına bağlanmaz."""
from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import time
from pathlib import Path

import pytest

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(Path(__file__).resolve().parent))

os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

import mysql_store  # noqa: E402
import tenant_db  # noqa: E402
import tenant_scope  # noqa: E402
from dashboard_memdb import MemDB  # noqa: E402
from tenant_scope import TenantScope, TenantScopeViolation, bind, reset  # noqa: E402

CO_A = "co_guard_a"
CO_B = "co_guard_b"
CO_C = "co_guard_c"
_LOG_FIELDS = {"collection", "op", "caller", "kind", "mode"}


@pytest.fixture(autouse=True)
def _restore_guard_state():
    prev = tenant_scope.get_mode()
    tenant_scope.reset_violations()
    yield
    tenant_scope.set_mode(prev)
    tenant_scope.reset_violations()
    tenant_scope._SCOPE.set(None)
    tenant_scope._UNSCOPED.set(False)


def _scope(company_id=CO_A, allowed=None):
    return TenantScope(
        company_id=company_id,
        allowed=frozenset(allowed if allowed is not None else {company_id}),
        kind="user",
        actor_id="actor-guard",
        reason="test",
    )


def _run(coro):
    return asyncio.run(coro)


def test_off_returns_without_frame_scan(monkeypatch):
    tenant_scope.set_mode("off")
    db = MemDB()
    armed = {"on": False, "n": 0}
    real = sys._getframe

    def wrapped(depth=0):
        if armed["on"]:
            armed["n"] += 1
        return real(depth + 1)

    logged = []
    monkeypatch.setattr(tenant_scope, "log_event", lambda *args, **kwargs: logged.append(args))
    token = bind(_scope())
    sys._getframe = wrapped
    try:
        armed["on"] = True
        _run(db.products.find_one({"_id": "x"}))
        tenant_scope.check("products", "find_one", query=["LEAK-TYPE"])
        armed["on"] = False
    finally:
        sys._getframe = real
        reset(token)
    assert armed["n"] == 0
    assert logged == []
    assert tenant_scope.violations() == {}


def test_log_once_per_caller_without_payload(monkeypatch):
    tenant_scope.set_mode("log")
    seen = []

    def capture(event, message="", **fields):
        seen.append({"event": event, "message": message, "fields": dict(fields)})

    monkeypatch.setattr(tenant_scope, "log_event", capture)
    db = MemDB()

    async def missing():
        for _ in range(2):
            await db.products.find_one({"_id": "row", "note": "LEAK-FILTER", "body": "LEAK-DOC"})
        await db.products.find_one({"_id": "row", "note": "LEAK-FILTER", "body": "LEAK-DOC"})

    _run(missing())
    unscoped = [row for row in seen if row["event"] == "tenant_guard.unscoped"]
    assert len(unscoped) == 2
    assert unscoped[0]["fields"]["caller"] != unscoped[1]["fields"]["caller"]
    assert len({row["fields"]["caller"] for row in unscoped}) == 2

    token = bind(_scope())
    try:
        async def clash():
            for _ in range(2):
                await db.products.find_one({"company_id": "LEAK-CID", "body": "LEAK-DOC"})
            await db.products.find_one({"company_id": "LEAK-CID", "body": "LEAK-DOC"})

        _run(clash())
    finally:
        reset(token)

    conflicts = [row for row in seen if row["event"] == "tenant_guard.conflict"]
    assert len(conflicts) == 2
    assert conflicts[0]["fields"]["caller"] != conflicts[1]["fields"]["caller"]
    for row in seen:
        assert row["event"] in {"tenant_guard.unscoped", "tenant_guard.conflict"}
        assert set(row["fields"]) == _LOG_FIELDS
        assert row["fields"]["collection"] == "products"
        assert row["fields"]["op"] == "find_one"
        assert row["fields"]["mode"] == "log"
        assert row["fields"]["caller"].startswith("test_tenant_guard.py:")
        assert "LEAK-" not in row["message"]
    assert all(row["fields"]["kind"] == "none" for row in unscoped)
    assert all(row["fields"]["kind"] == "user" for row in conflicts)
    blob = repr(seen)
    assert "LEAK-FILTER" not in blob
    assert "LEAK-DOC" not in blob
    assert "LEAK-CID" not in blob
    assert tenant_scope.violations() == {}


def test_raise_bound_scope_blocks_unscoped_and_conflict(monkeypatch):
    tenant_scope.set_mode("raise")
    monkeypatch.setattr(tenant_scope, "log_event", lambda *args, **kwargs: None)
    db = MemDB()
    scope = _scope()
    token = bind(scope)
    try:
        async def blocked():
            with pytest.raises(TenantScopeViolation) as exc:
                await db.products.find_one({"_id": "x"})
            assert exc.value.status_code == 404
            assert exc.value.detail == "Kayıt bulunamadı."
            with pytest.raises(TenantScopeViolation):
                db.products.find({"_id": "x"})
            with pytest.raises(TenantScopeViolation):
                await db.products.count_documents({})
            with pytest.raises(TenantScopeViolation):
                await db.products.update_one({"_id": "x"}, {"$set": {"name": "y"}})
            with pytest.raises(TenantScopeViolation):
                await db.products.insert_one({"_id": "new", "name": "y"})
            with pytest.raises(TenantScopeViolation):
                db.products.aggregate([{"$match": {"name": "y"}}])
            with pytest.raises(TenantScopeViolation):
                db.products.aggregate([{"$group": {"_id": "$name"}}])
            assert db.products.docs == []

            await db.products.find_one({"_id": "x", "company_id": CO_A})
            await db.products.find_one({"company_id": {"$in": [CO_A]}})
            await db.products.find_one({"company_id": {"$eq": CO_A}})
            await db.products.find_one({"$and": [{"name": "kalem"}, {"company_id": CO_A}]})
            with pytest.raises(TenantScopeViolation):
                await db.products.find_one({"company_id": {"$in": [CO_A, CO_B]}})
            with pytest.raises(TenantScopeViolation):
                await db.products.find_one({"company_id": CO_B})
            with pytest.raises(TenantScopeViolation):
                await db.products.find_one({"company_id": {"$gt": CO_A}})

            await db.products.update_one(
                {"_id": "up"},
                {"$set": {"name": "n"}, "$setOnInsert": {"company_id": CO_A}},
                upsert=True,
            )
            with pytest.raises(TenantScopeViolation):
                await db.products.update_one(
                    {"_id": "up"},
                    {"$set": {"name": "n"}, "$setOnInsert": {"company_id": CO_A}},
                    upsert=False,
                )
            with pytest.raises(TenantScopeViolation):
                await db.products.update_one(
                    {"_id": "up", "company_id": CO_A},
                    {"$set": {"company_id": CO_B}},
                )

            await db.users.find_one({})
            await db.companies.find_one({})
            await db.help_articles.find_one({})
            await db.password_resets.find_one({})
            db.users.find({})
            db.companies.find({})
            db.help_articles.find({})
            db.password_resets.find({})

            await db.products.insert_one({"_id": "p1", "company_id": CO_A, "name": "kalem"})
            tdb = tenant_db.TenantDB(db, scope)
            found = await tdb.products.find_one({"_id": "p1"})
            assert found["name"] == "kalem"
            rows = await tdb.products.find({}).to_list(10)
            assert [row["_id"] for row in rows] == ["p1"]
            assert await tdb.products.count_documents({}) == 1
            await tdb.products.update_one({"_id": "p1"}, {"$set": {"name": "kalem-2"}})
            await tdb.products.insert_one({"_id": "p2", "name": "yeni"})
            stored = await db.products.find_one({"_id": "p2", "company_id": CO_A})
            assert stored["company_id"] == CO_A
            agg = await tdb.products.aggregate([{"$match": {"name": "yeni"}}]).to_list(10)
            assert [row["_id"] for row in agg] == ["p2"]

            with tenant_scope.unscoped("bakım"):
                await db.products.find_one({"_id": "serbest"})
            with pytest.raises(TenantScopeViolation):
                await db.products.find_one({"_id": "serbest"})

            with pytest.raises(TenantScopeViolation):
                await db.not_in_catalog_xyz.find_one({"_id": "z"})

        _run(blocked())

        coll = mysql_store.MySQLCollection(object(), "products")
        with pytest.raises(TenantScopeViolation) as exc:
            _run(coll.delete_one({"_id": "x"}))
        assert exc.value.status_code == 404
        with pytest.raises(TenantScopeViolation):
            _run(coll.replace_one({"company_id": CO_A}, {"_id": "a", "name": "x"}))
        tenant_scope.check(
            "products",
            "replace_one",
            query={"_id": "a", "company_id": CO_A},
            doc={"_id": "a", "company_id": CO_A, "name": "x"},
        )
    finally:
        reset(token)

    wide = _scope(allowed={CO_A, CO_C})
    token = bind(wide)
    try:
        _run(db.products.find_one({"company_id": {"$in": [CO_A, CO_C]}}))
        with pytest.raises(TenantScopeViolation):
            _run(db.products.find_one({"company_id": CO_C}))
    finally:
        reset(token)


def test_raise_without_scope_counts_and_does_not_raise():
    tenant_scope.set_mode("raise")
    assert tenant_scope.current() is None
    db = MemDB()

    async def run():
        for _ in range(2):
            await db.products.find_one({"_id": "x"})
        db.products.find({"_id": "x"})

    _run(run())
    found = tenant_scope.violations()
    find_one_keys = [key for key in found if key[0] == "products" and key[1] == "find_one"]
    find_keys = [key for key in found if key[0] == "products" and key[1] == "find"]
    assert len(find_one_keys) == 1
    assert len(find_keys) == 1
    caller = find_one_keys[0][2]
    assert caller.startswith("test_tenant_guard.py:")
    assert found[find_one_keys[0]] == 2
    assert found[find_keys[0]] == 1


def test_changed_since_uses_company_argument():
    tenant_scope.set_mode("raise")
    sql = []

    class _Cursor:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_exc):
            return False

        async def execute(self, statement, args):
            sql.append((statement, list(args)))

        async def fetchall(self):
            return []

    class _Conn:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_exc):
            return False

        def cursor(self):
            return _Cursor()

    class _Pool:
        def acquire(self):
            return _Conn()

    class _DB:
        def __init__(self):
            self._pool = _Pool()

        async def _ensure(self):
            return None

    coll = mysql_store.MySQLCollection(_DB(), "products")
    token = bind(_scope())
    try:
        docs, _cursor, more = _run(coll.changed_since(company_id=CO_A))
        assert docs == []
        assert more is False
        assert sql and "company_id" in sql[0][0]
        assert CO_A in sql[0][1]
        sql.clear()
        with pytest.raises(TenantScopeViolation):
            _run(coll.changed_since(company_id=None))
        with pytest.raises(TenantScopeViolation):
            _run(coll.changed_since(company_id=CO_B))
        assert sql == []
    finally:
        reset(token)

    async def unbound():
        return await coll.changed_since(company_id=None)

    docs, _cursor, _more = _run(unbound())
    assert docs == []
    counted = [key for key in tenant_scope.violations() if key[1] == "changed_since"]
    assert counted
    assert counted[0][0] == "products"
    assert counted[0][2].startswith("test_tenant_guard.py:")


def test_guard_swallows_unexpected_and_reraises_violation(monkeypatch):
    monkeypatch.setattr(mysql_store, "sql_page_pushdown_enabled", lambda: False)
    loaded = []

    async def load(query):
        loaded.append(dict(query))
        return [{"_id": "p1", "name": "kalem", "company_id": CO_A}]

    coll = mysql_store.MySQLCollection(None, "products")
    coll._load_filtered = load

    def boom(*_args, **_kwargs):
        raise RuntimeError("guard-boom")

    monkeypatch.setattr(tenant_scope, "check", boom)
    for mode in ("log", "raise"):
        tenant_scope.set_mode(mode)
        loaded.clear()
        doc = _run(coll.find_one({"_id": "LEAK-id", "name": "LEAK-DOC"}))
        assert doc["name"] == "kalem"
        assert loaded and loaded[0]["_id"] == "LEAK-id"

    def deny(*_args, **_kwargs):
        raise TenantScopeViolation()

    monkeypatch.setattr(tenant_scope, "check", deny)
    for mode in ("log", "raise"):
        tenant_scope.set_mode(mode)
        loaded.clear()
        with pytest.raises(TenantScopeViolation):
            _run(coll.find_one({"_id": "p1"}))
        assert loaded == []


def test_mysql_store_import_does_not_load_tenant_scope():
    script = "import sys, mysql_store; assert 'tenant_scope' not in sys.modules"
    proc = subprocess.run(
        [sys.executable, "-c", script],
        cwd=str(_BACKEND),
        capture_output=True,
        text=True,
        check=False,
    )
    assert proc.returncode == 0, proc.stderr


def test_read_mode_off_log_raise(monkeypatch):
    monkeypatch.delenv("TAMKOBI_TENANT_GUARD", raising=False)
    assert tenant_scope._read_mode() == "off"
    monkeypatch.setenv("TAMKOBI_TENANT_GUARD", "foo")
    assert tenant_scope._read_mode() == "off"
    monkeypatch.setenv("TAMKOBI_TENANT_GUARD", "  ")
    assert tenant_scope._read_mode() == "off"
    monkeypatch.setenv("TAMKOBI_TENANT_GUARD", "log")
    assert tenant_scope._read_mode() == "log"
    monkeypatch.setenv("TAMKOBI_TENANT_GUARD", "LOG")
    assert tenant_scope._read_mode() == "log"
    monkeypatch.setenv("TAMKOBI_TENANT_GUARD", "raise")
    assert tenant_scope._read_mode() == "raise"
    prev = tenant_scope.set_mode("log")
    assert tenant_scope.get_mode() == "log"
    assert tenant_scope.set_mode(prev) == "log"


def test_hot_path_skips_caller(monkeypatch):
    calls = {"n": 0}
    real = tenant_scope._escape_caller

    def wrapped(*args, **kwargs):
        calls["n"] += 1
        return real(*args, **kwargs)

    monkeypatch.setattr(tenant_scope, "_escape_caller", wrapped)
    query = {"_id": "p", "company_id": CO_A}
    token = bind(_scope())
    try:
        for mode in ("off", "log", "raise"):
            tenant_scope.set_mode(mode)
            calls["n"] = 0
            started = time.perf_counter()
            for _ in range(10000):
                tenant_scope.check("products", "find_one", query=query)
            elapsed = time.perf_counter() - started
            assert calls["n"] == 0
            assert elapsed < 3.0
    finally:
        reset(token)


def test_internal_error_is_counted_not_raised():
    tenant_scope.set_mode("raise")
    token = bind(_scope())
    try:
        tenant_scope.check("products", "find_one", query=["LEAK-TYPE"])
        tenant_scope.check("products", "find_one", query=["LEAK-TYPE"])
    finally:
        reset(token)
    assert tenant_scope.violations()[("products", "find_one", "internal")] == 2
    tenant_scope.reset_violations()
    tenant_scope.set_mode("log")
    tenant_scope.check("products", "find_one", query=object())
    assert tenant_scope.violations()[("products", "find_one", "internal")] == 1
