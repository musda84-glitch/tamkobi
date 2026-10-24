"""Platform çevrimdışı ayarı: süper admin, denetim, süre ve izleme."""
import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from fastapi.routing import APIRoute

import idempotency
import offline_admin
import offline_sync


def _run(coro):
    return asyncio.run(coro)


class Coll:
    def __init__(self):
        self.docs = []

    def find(self, query):
        rows = [row for row in self.docs if self._match(row, query)]
        return self._Cursor(rows)

    class _Cursor:
        def __init__(self, rows):
            self.rows = rows

        async def to_list(self, limit):
            return [dict(row) for row in self.rows[:limit]]

    @staticmethod
    def _match(doc, query):
        for key, expected in (query or {}).items():
            if doc.get(key) != expected:
                return False
        return True

    async def find_one(self, query):
        for row in self.docs:
            if self._match(row, query):
                return dict(row)
        return None

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    async def update_one(self, query, upd):
        for row in self.docs:
            if self._match(row, query):
                row.update(upd.get("$set") or {})
                return


class DB:
    def __init__(self):
        self.companies = Coll()
        self.offline_device_pending = Coll()
        self.offline_conflicts = Coll()
        self.idempotency_keys = Coll()


def test_policy_defaults_keep_current_behavior():
    policy = offline_sync.company_offline_policy({})
    assert policy["offline_enabled"] is True
    assert policy["offline_max_minutes"] == 10
    assert policy["offline_modules"] == {"pos": True, "pick": True, "order": True}
    assert policy["idempotency_ttl_hours"] == 24
    assert offline_sync.clamp_idempotency_ttl_hours(0) == 1
    assert offline_sync.clamp_idempotency_ttl_hours(999) == 168
    assert offline_sync.clamp_idempotency_ttl_hours("nope") == 24


def test_routes_require_super_admin(monkeypatch):
    routes = [route for route in offline_admin.router.routes if isinstance(route, APIRoute)]
    assert {route.path for route in routes} == {
        "/api/system/offline-admin",
        "/api/system/offline-admin/companies/{company_id}",
    }
    for route in routes:
        assert offline_admin.require_platform_admin in [dep.call for dep in route.dependant.dependencies]

    import sys
    import types

    called = {}

    async def require_super_admin(_request):
        called["path"] = "saas.require_super_admin"
        return {"is_super_admin": True, "id": "sa"}

    fake = types.ModuleType("saas")
    fake.require_super_admin = require_super_admin
    monkeypatch.setitem(sys.modules, "saas", fake)
    user = _run(offline_admin.require_platform_admin(MagicMock()))
    assert called["path"] == "saas.require_super_admin"
    assert user["id"] == "sa"


def test_company_user_cannot_change_settings():
    db = DB()
    db.companies.docs.append({"_id": "A", "name": "Ada"})
    with pytest.raises(HTTPException) as ei:
        _run(offline_admin.update_company_offline(db, "A", {"offline_enabled": False}, {"is_super_admin": False, "id": "u1"}))
    assert ei.value.status_code == 403
    assert db.companies.docs[0].get("offline_enabled") is None


def test_super_admin_change_is_audited_and_partial(monkeypatch):
    db = DB()
    db.companies.docs.append({"_id": "A", "name": "Ada", "offline_max_minutes": 10})
    audits = []

    async def fake_audit(**kwargs):
        audits.append(kwargs)

    monkeypatch.setattr(offline_admin, "_write_audit", fake_audit)
    saved = _run(offline_admin.update_company_offline(
        db, "A",
        {"offline_enabled": False, "offline_modules": {"pos": False}, "idempotency_ttl_hours": 6},
        {"is_super_admin": True, "id": "sa1"},
        ip="127.0.0.1",
    ))
    assert saved["offline_enabled"] is False
    assert saved["offline_modules"]["pos"] is False
    assert saved["offline_modules"]["pick"] is True
    assert saved["offline_max_minutes"] == 10
    assert saved["idempotency_ttl_hours"] == 6
    assert audits[0]["action"] == "offline_settings_update"
    assert audits[0]["actor_id"] == "sa1"
    assert audits[0]["target_id"] == "A"
    assert "offline_enabled" in audits[0]["details"]["changed"]
    assert "password" not in str(audits)

    same = _run(offline_admin.update_company_offline(
        db, "A", {"offline_enabled": False}, {"is_super_admin": True, "id": "sa1"},
    ))
    assert same["offline_enabled"] is False
    assert len(audits) == 1


def test_pending_and_conflict_counts_are_company_scoped():
    db = DB()
    db.companies.docs.extend([{"_id": "A", "name": "Ada"}, {"_id": "B", "name": "Beta"}])
    now = datetime.now(timezone.utc).isoformat()
    old = (datetime.now(timezone.utc) - timedelta(hours=30)).isoformat()
    _run(offline_sync.remember_device_pending(db, "A", "device-aaa", 2))
    _run(offline_sync.remember_device_pending(db, "A", "device-bbb", 3))
    _run(offline_sync.remember_device_pending(db, "B", "device-ccc", 9))
    db.offline_device_pending.docs.append({
        "_id": "A:stale", "company_id": "A", "device_id": "stale-dev", "pending": 100, "at": old,
    })
    _run(offline_sync.note_conflict(db, "A", {"code": "stock_conflict", "message": "Stok yetersiz", "iban": "TR00"}))
    _run(offline_sync.note_conflict(db, "B", {"code": "document_conflict", "message": "Belge"}))
    overview = _run(offline_admin.list_overview(db))
    by_id = {row["id"]: row for row in overview["companies"]}
    assert by_id["A"]["pending"] == 5
    assert by_id["A"]["conflicts"] == 1
    assert by_id["B"]["pending"] == 9
    assert by_id["B"]["conflicts"] == 1
    assert overview["totals"]["pending"] == 14
    assert overview["totals"]["conflicts"] == 2
    blob = str(db.offline_conflicts.docs)
    assert "TR00" not in blob
    assert now[:4] in blob


def test_short_ttl_expires_cached_key():
    idempotency._INDEXED = True
    db = MagicMock()
    store = idempotency_store()
    old = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    store.docs["co1:k"] = {
        "_id": "co1:k", "company_id": "co1", "key": "k", "status": "completed",
        "response": {"old": True}, "created_at": old,
    }
    db.idempotency_keys = store

    class Companies:
        async def find_one(self, _query):
            return {"_id": "co1", "idempotency_ttl_hours": 1}

    db.companies = Companies()
    req = MagicMock()
    req.headers = {"Idempotency-Key": "k"}
    calls = {"n": 0}

    async def fn():
        calls["n"] += 1
        return {"fresh": True}

    result = _run(idempotency.run(db, "co1", req, "orders/create", fn))
    assert result == {"fresh": True}
    assert calls["n"] == 1


def idempotency_store():
    from idempotency import DuplicateKeyError

    class Store:
        def __init__(self):
            self.docs = {}

        async def insert_one(self, doc):
            if doc["_id"] in self.docs:
                raise DuplicateKeyError("dup")
            self.docs[doc["_id"]] = dict(doc)

        async def find_one(self, query):
            row = self.docs.get(query.get("_id"))
            return dict(row) if row else None

        async def update_one(self, query, upd):
            row = self.docs.get(query.get("_id"))
            if row and "$set" in upd:
                row.update(upd["$set"])
            return MagicMock(matched_count=1 if row else 0)

        async def delete_one(self, query):
            self.docs.pop(query.get("_id"), None)

    return Store()
