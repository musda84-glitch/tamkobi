"""Mutating routes: route-level auth and company resolution.

In-process TestClient and a memory database. No live server and no port 8021.
External HTTP (İşNet, bank APIs) is mocked.
"""
from __future__ import annotations

import asyncio
import copy
import inspect
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from fastapi.params import Query as QueryParam
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-mutating-routes-auth-jwt-secret-not-default-32b")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import addons  # noqa: E402
import attendance  # noqa: E402
import auth_utils  # noqa: E402
import mobile_logs  # noqa: E402
import rbac  # noqa: E402
import saas  # noqa: E402
import server  # noqa: E402
import trash  # noqa: E402
from mysql_store import apply_update, match_query, sort_docs  # noqa: E402

COMP_A = "A"
COMP_B = "B"
NEXUS = "comp_nexus_main_01"

_EINVOICE_OK = {"ok": True, "message": "n11 tamam"}


def _run(coro):
    return asyncio.run(coro)


class MemCursor:
    def __init__(self, docs):
        self._docs = docs
        self._sort = None

    def sort(self, key, direction=1):
        self._sort = [(key, direction)] if isinstance(key, str) else list(key)
        return self

    def _rows(self, length=None):
        rows = sort_docs(list(self._docs), self._sort) if self._sort else list(self._docs)
        if length is not None:
            rows = rows[: int(length)]
        return copy.deepcopy(rows)

    async def to_list(self, length=None):
        return self._rows(length)

    def __aiter__(self):
        rows = self._rows()

        async def _gen():
            for row in rows:
                yield row

        return _gen()


class MemColl:
    def __init__(self, name, db):
        self.name = name
        self.db = db
        self.docs = []

    def _note(self, op, query=None, payload=None):
        self.db.writes.append({
            "coll": self.name,
            "op": op,
            "query": copy.deepcopy(query) if query is not None else None,
            "payload": copy.deepcopy(payload) if payload is not None else None,
        })

    def find(self, query=None, projection=None):
        matched = [d for d in self.docs if match_query(d, query or {})]
        return MemCursor(matched)

    async def find_one(self, query=None, projection=None):
        for doc in self.docs:
            if match_query(doc, query or {}):
                return copy.deepcopy(doc)
        return None

    async def count_documents(self, query=None):
        return sum(1 for doc in self.docs if match_query(doc, query or {}))

    async def insert_one(self, doc):
        self._note("insert_one", payload=doc)
        self.docs.append(copy.deepcopy(doc))
        return SimpleNamespace(inserted_id=doc.get("_id"))

    async def insert_many(self, docs):
        self._note("insert_many", payload=docs)
        self.docs.extend(copy.deepcopy(list(docs)))
        return SimpleNamespace(inserted_ids=[d.get("_id") for d in docs])

    async def update_one(self, query, update, upsert=False):
        self._note("update_one", query, update)
        for i, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                self.docs[i] = apply_update(doc, update, query)
                return SimpleNamespace(modified_count=1, matched_count=1)
        return SimpleNamespace(modified_count=0, matched_count=0)

    async def update_many(self, query, update, upsert=False):
        self._note("update_many", query, update)
        modified = 0
        for i, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                new = apply_update(doc, update, query)
                if new != doc:
                    modified += 1
                self.docs[i] = new
        return SimpleNamespace(modified_count=modified, matched_count=modified)

    async def delete_one(self, query):
        self._note("delete_one", query)
        for i, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                self.docs.pop(i)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def delete_many(self, query):
        self._note("delete_many", query)
        kept = []
        deleted = 0
        for doc in self.docs:
            if match_query(doc, query or {}):
                deleted += 1
            else:
                kept.append(doc)
        self.docs[:] = kept
        return SimpleNamespace(deleted_count=deleted)

    async def create_index(self, *args, **kwargs):
        return None


class MemDB:
    def __init__(self):
        self._cols = {}
        self.writes = []

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = MemColl(name, self)
            self._cols[name] = coll
        return coll

    def __getitem__(self, name):
        return getattr(self, name)

    async def _ensure(self):
        return None


def _user(uid, company_ids, active, *, role="admin", superadmin=False):
    return {
        "_id": uid,
        "id": uid,
        "email": f"{uid}@example.com",
        "name": uid,
        "role": role,
        "is_active": True,
        "is_super_admin": superadmin,
        "company_ids": list(company_ids),
        "active_company_id": active,
    }


def _seed_business(db):
    db.writes.clear()
    for name in (
        "einvoice_settings", "notifications", "units", "products", "product_categories",
        "bank_accounts", "bank_connections", "bank_transactions", "bank_match_rules",
        "companies", "mobile_client_logs", "trash", "activity_logs", "company_audit_log",
        "roles", "employees", "attendance", "attendance_alerts",
    ):
        db[name].docs.clear()

    db.companies.docs.extend([
        {"_id": COMP_A, "name": "Firma A"},
        {"_id": COMP_B, "name": "Firma B"},
        {"_id": NEXUS, "name": "Nexus"},
    ])
    db.einvoice_settings.docs.extend([
        {"_id": "esA", "company_id": COMP_A, "provider": "n11faturam", "status": "simulated", "password_enc": "x"},
        {"_id": "esB", "company_id": COMP_B, "provider": "n11faturam", "status": "simulated", "password_enc": "x", "secret": "B-SECRET"},
        {"_id": "esN", "company_id": NEXUS, "provider": "n11faturam", "status": "simulated", "password_enc": "x", "secret": "NEXUS-ONLY"},
    ])
    db.notifications.docs.extend([
        {"_id": "na1", "company_id": COMP_A, "is_read": False, "type": "info", "title": "A1"},
        {"_id": "na2", "company_id": COMP_A, "is_read": False, "type": "info", "title": "A2"},
        {"_id": "na3", "company_id": COMP_A, "is_read": True, "type": "info", "title": "A3"},
        {"_id": "nb1", "company_id": COMP_B, "is_read": False, "type": "info", "title": "B1", "message": "B-SECRET"},
        {"_id": "nn1", "company_id": NEXUS, "is_read": False, "type": "info", "title": "N1", "message": "NEXUS-ONLY"},
    ])
    db.units.docs.extend([
        {"_id": "ua", "company_id": COMP_A, "name": "Adet"},
        {"_id": "ub", "company_id": COMP_B, "name": "Adet"},
        {"_id": "un", "company_id": NEXUS, "name": "Adet"},
        {"_id": "uka", "company_id": COMP_A, "name": "Koli"},
        {"_id": "ukb", "company_id": COMP_B, "name": "Koli"},
        {"_id": "ukn", "company_id": NEXUS, "name": "Koli"},
    ])
    db.products.docs.extend([
        {"_id": "p1", "company_id": COMP_A, "unit": "Adet", "name": "A bir"},
        {"_id": "p2", "company_id": COMP_A, "unit": "Adet", "name": "A iki"},
        {"_id": "p3", "company_id": COMP_B, "unit": "Adet", "name": "B-SECRET"},
        {"_id": "p4", "company_id": NEXUS, "unit": "Adet", "name": "NEXUS-ONLY"},
    ])
    db.product_categories.docs.extend([
        {"_id": "ca", "company_id": COMP_A, "name": "Gida"},
        {"_id": "cb", "company_id": COMP_B, "name": "Gida"},
        {"_id": "cn", "company_id": NEXUS, "name": "Gida"},
    ])
    db.bank_accounts.docs.extend([
        {"_id": "accA", "company_id": COMP_A, "account_name": "Kasa A", "current_balance": 100.0, "type": "bank"},
        {"_id": "accB", "company_id": COMP_B, "account_name": "Kasa B", "current_balance": 100.0, "type": "bank"},
        {"_id": "accN", "company_id": NEXUS, "account_name": "Kasa N", "current_balance": 100.0, "type": "bank"},
    ])
    db.bank_connections.docs.extend([
        {"_id": "cA", "company_id": COMP_A, "auto_sync": True, "linked_account_id": "accA", "provider": "enpara", "provider_name": "Enpara"},
        {"_id": "cAoff", "company_id": COMP_A, "auto_sync": False, "linked_account_id": "accA", "provider": "enpara", "provider_name": "Kapali"},
        {"_id": "cB", "company_id": COMP_B, "auto_sync": True, "linked_account_id": "accB", "provider": "enpara", "provider_name": "Enpara B"},
        {"_id": "cN", "company_id": NEXUS, "auto_sync": True, "linked_account_id": "accN", "provider": "enpara", "provider_name": "Enpara N"},
    ])
    db.bank_transactions.docs.extend([
        {"_id": "sa1", "company_id": COMP_A, "source": "bank_sync", "is_simulated": True, "amount": 10, "type": "inflow", "description": "demo a1", "account_name": "Kasa A", "account_id": "accA", "date": "2026-10-01"},
        {"_id": "sa2", "company_id": COMP_A, "source": "bank_sync", "is_simulated": True, "amount": 5, "type": "inflow", "description": "demo a2", "account_name": "Kasa A", "account_id": "accA", "date": "2026-10-02"},
        {"_id": "realA", "company_id": COMP_A, "source": "bank_sync", "is_simulated": False, "amount": 7, "type": "inflow", "description": "gercek", "account_name": "Kasa A", "account_id": "accA", "date": "2026-10-03", "match_status": "unmatched"},
        {"_id": "sb1", "company_id": COMP_B, "source": "bank_sync", "is_simulated": True, "amount": 9, "type": "inflow", "description": "B-SECRET", "account_name": "Kasa B", "account_id": "accB", "date": "2026-10-01"},
        {"_id": "sn1", "company_id": NEXUS, "source": "bank_sync", "is_simulated": True, "amount": 8, "type": "inflow", "description": "NEXUS-ONLY", "account_name": "Kasa N", "account_id": "accN", "date": "2026-10-01"},
        {"_id": "txmA", "company_id": COMP_A, "source": "bank_sync", "is_simulated": False, "match_status": "unmatched", "description": "ACME MARKET pos", "amount": 20, "type": "outflow", "date": "2026-10-16", "account_id": "accA", "account_name": "Kasa A"},
        {"_id": "txmB", "company_id": COMP_B, "source": "bank_sync", "is_simulated": False, "match_status": "unmatched", "description": "ACME MARKET pos", "amount": 20, "type": "outflow", "date": "2026-10-16", "account_id": "accB", "account_name": "Kasa B"},
        {"_id": "txmN", "company_id": NEXUS, "source": "bank_sync", "is_simulated": False, "match_status": "unmatched", "description": "ACME MARKET pos", "amount": 20, "type": "outflow", "date": "2026-10-16", "account_id": "accN", "account_name": "Kasa N"},
    ])
    db.bank_match_rules.docs.append({
        "_id": "ruleA", "company_id": COMP_A, "pattern": "acme market", "category": "Market",
        "hits": 0, "source": "manual",
    })
    db.mobile_client_logs.docs.extend([
        {"_id": "la1", "company_id": COMP_A, "message": "a bir"},
        {"_id": "la2", "company_id": COMP_A, "message": "a iki"},
        {"_id": "lb1", "company_id": COMP_B, "message": "B-SECRET"},
        {"_id": "ln1", "company_id": NEXUS, "message": "NEXUS-ONLY"},
    ])


def _rows(db, coll, company):
    return [copy.deepcopy(d) for d in db[coll].docs if d.get("company_id") == company]


def _ids(db, coll, company):
    return [d["_id"] for d in db[coll].docs if d.get("company_id") == company]


def _foreign_snapshot(db):
    names = (
        "einvoice_settings", "notifications", "units", "products", "product_categories",
        "bank_accounts", "bank_connections", "bank_transactions", "bank_match_rules",
        "mobile_client_logs", "trash", "companies",
    )
    return {name: _rows(db, name, COMP_B) + _rows(db, name, NEXUS) for name in names}


@pytest.fixture
def api():
    db = MemDB()
    db.users.docs.append(_user("user-a", [COMP_A], COMP_A))
    db.users.docs.append(_user("user-b", [COMP_B], COMP_B))
    db.users.docs.append(_user("user-sa", [], "", superadmin=True))
    db.users.docs.append(_user("user-sa-a", [COMP_A], COMP_A, superadmin=True))
    db.users.docs.append(_user("user-p", [COMP_A], COMP_A, role="personel"))
    _seed_business(db)
    prev = (server.db, rbac._db, saas._db, addons._db, trash._db, attendance._db, mobile_logs._db)
    prev_user = (attendance._current_user, mobile_logs._current_user)
    server.db = db
    rbac._db = db
    saas._db = db
    addons._db = db
    trash._db = db
    attendance._db = db
    mobile_logs._db = db
    attendance._current_user = server.get_current_user
    mobile_logs._current_user = server.get_current_user
    saas.invalidate()
    router = server.app.router
    saved_up = list(router.on_startup)
    saved_down = list(router.on_shutdown)
    router.on_startup.clear()
    router.on_shutdown.clear()
    client = TestClient(server.app)
    entered = False
    try:
        client.__enter__()
        entered = True
        yield client, db
    finally:
        if entered:
            client.__exit__(None, None, None)
        server.db, rbac._db, saas._db, addons._db, trash._db, attendance._db, mobile_logs._db = prev
        attendance._current_user, mobile_logs._current_user = prev_user
        router.on_startup[:] = saved_up
        router.on_shutdown[:] = saved_down
        saas.invalidate()


def _token(uid, *, superadmin=False, role="admin"):
    return auth_utils.create_access_token(uid, f"{uid}@example.com", role, is_super_admin=superadmin)


def _auth(uid, *, superadmin=False, role="admin"):
    return {"Authorization": f"Bearer {_token(uid, superadmin=superadmin, role=role)}"}


def _user_a():
    return _user("user-a", [COMP_A], COMP_A)


_HTTP = [
    ("post", "/api/einvoice/test", "query", None),
    ("post", "/api/einvoice/incoming/sync", "query", None),
    ("post", "/api/notifications/read-all", "query", None),
    ("post", "/api/notifications/clear", "query", None),
    ("put", "/api/products/units/Adet", "query", {"name": "Parca"}),
    ("delete", "/api/products/units/Koli", "query", None),
    ("delete", "/api/products/categories/Gida", "query", None),
    ("delete", "/api/banking/transactions/simulated", "query", None),
    ("post", "/api/banking/sync-all", "query", None),
    ("post", "/api/banking/transactions/auto-match", "query", None),
    ("post", "/api/personnel/attendance/run-alerts", "query", None),
    ("delete", "/api/mobile/logs/la1", "query", None),
    ("post", "/api/mobile/logs/empty", "body", None),
]


def _hit(client, method, path, where, body, *, headers=None, company_id=None, omit=False):
    params = None
    payload = body
    if where == "query" and not omit and company_id is not None:
        params = {"company_id": company_id}
    if where == "body":
        payload = {} if omit or company_id is None else {"company_id": company_id}
    fn = getattr(client, method)
    kwargs = {"headers": headers, "params": params}
    if method != "delete":
        kwargs["json"] = payload
    return fn(path, **kwargs)


def _mocks():
    fetch = AsyncMock(return_value={"transactions": [], "simulated": True, "balance": None})
    return patch.object(server.n11faturam, "test_login", AsyncMock(return_value=dict(_EINVOICE_OK))), \
        patch.object(server, "_einvoice_password", return_value="secret"), \
        patch.object(server.n11faturam, "list_incoming", AsyncMock(return_value=[])), \
        patch.object(server.bank_providers, "fetch_transactions", fetch)


def test_route_signatures_have_auth_and_no_nexus_default():
    pairs = [
        (server.test_einvoice_connection, server.get_current_user, True),
        (server.sync_einvoice_incoming, server.get_current_user, True),
        (server.read_all_notifications, server.get_current_user, True),
        (server.clear_notifications, server.get_current_user, True),
        (server.rename_unit, server.get_current_user, True),
        (server.delete_unit, server.get_current_user, True),
        (server.delete_product_category, server.get_current_user, True),
        (server.delete_simulated_bank_transactions, server.get_current_user, True),
        (server.sync_all_connections, server.get_current_user, True),
        (server.auto_match_transactions, server.get_current_user, True),
        (attendance.run_alerts_now, attendance._user_dep, True),
        (mobile_logs.delete_mobile_log, mobile_logs._user_dep, True),
        (mobile_logs.empty_mobile_logs, mobile_logs._user_dep, False),
    ]
    assert len(pairs) == 13
    for fn, dep, has_company in pairs:
        sig = inspect.signature(fn)
        assert sig.parameters["user"].default.dependency is dep
        src = inspect.getsource(fn)
        assert "comp_nexus_main_01" not in src
        assert "resolve_company_id" in src
        assert "is_super_admin" not in src
        if has_company:
            default = sig.parameters["company_id"].default
            if isinstance(default, QueryParam):
                assert default.default is None
            else:
                assert default is None
    sim = inspect.signature(server.delete_simulated_bank_transactions)
    assert isinstance(sim.parameters["company_id"].default, QueryParam)
    assert "request" not in inspect.signature(server.read_all_notifications).parameters
    assert "request" not in inspect.signature(server.clear_notifications).parameters
    assert list(inspect.signature(server.pull_einvoice_incoming).parameters) == ["company_id", "days", "settings"]
    assert list(inspect.signature(server._sync_bank_connection_core).parameters) == ["conn_id", "days", "user", "request", "company_id"]
    assert list(inspect.signature(server._auto_process_bank_txs).parameters) == ["company_id", "txs", "via", "use_cari", "actor"]
    assert list(inspect.signature(attendance.run_missing_checkin_check).parameters) == ["company_id", "force"]
    assert list(inspect.signature(attendance.run_checkin_reminders).parameters) == ["company_id", "now_utc"]
    assert list(inspect.signature(attendance.run_auto_checkout_ot_check).parameters) == ["company_id"]


def test_background_loops_call_helpers_not_these_routes():
    text = Path(server.__file__).read_text(encoding="utf-8")
    assert "await sync_einvoice_incoming(" not in text
    assert "await sync_all_connections(" not in text
    assert "await auto_match_transactions(" not in text
    assert "await test_einvoice_connection(" not in text
    tick = inspect.getsource(server._run_einvoice_inbox_auto_tick)
    assert "pull_einvoice_incoming" in tick
    assert "sync_einvoice_incoming" not in tick
    bank = inspect.getsource(server._run_bank_auto_sync_tick)
    assert "_sync_bank_connection_core" in bank
    assert "sync_all_connections" not in bank
    assert "auto_match_transactions" not in bank


def test_no_token_is_401(api):
    client, db = api
    foreign = _foreign_snapshot(db)
    for method, path, where, body in _HTTP:
        before = len(db.writes)
        response = _hit(client, method, path, where, body)
        assert response.status_code == 401, (method, path, response.text)
        assert "B-SECRET" not in response.text
        assert "NEXUS-ONLY" not in response.text
        assert db.writes[before:] == []
    assert _foreign_snapshot(db) == foreign


def test_other_company_is_403_and_writes_nothing(api):
    client, db = api
    foreign = _foreign_snapshot(db)
    headers = _auth("user-a")
    for method, path, where, body in _HTTP:
        before = len(db.writes)
        response = _hit(client, method, path, where, body, headers=headers, company_id=COMP_B)
        assert response.status_code == 403, (method, path, response.text)
        assert "B-SECRET" not in response.text
        assert "NEXUS-ONLY" not in response.text
        assert db.writes[before:] == [], (method, path, db.writes[before:])
    assert _foreign_snapshot(db) == foreign
    assert _ids(db, "notifications", COMP_B) == ["nb1"]
    assert _ids(db, "mobile_client_logs", COMP_B) == ["lb1"]
    assert _ids(db, "bank_transactions", COMP_B) == ["sb1", "txmB"]


def test_direct_call_other_company_is_403_without_middleware(api):
    _client, db = api
    user = _user_a()
    calls = [
        lambda: server.test_einvoice_connection(company_id=COMP_B, user=user),
        lambda: server.sync_einvoice_incoming(company_id=COMP_B, user=user),
        lambda: server.read_all_notifications(company_id=COMP_B, user=user),
        lambda: server.clear_notifications(company_id=COMP_B, user=user),
        lambda: server.rename_unit("Adet", {"name": "Parca"}, company_id=COMP_B, user=user),
        lambda: server.delete_unit("Koli", company_id=COMP_B, user=user),
        lambda: server.delete_product_category("Gida", company_id=COMP_B, user=user),
        lambda: server.delete_simulated_bank_transactions(company_id=COMP_B, user=user),
        lambda: server.sync_all_connections(company_id=COMP_B, user=user),
        lambda: server.auto_match_transactions(SimpleNamespace(), company_id=COMP_B, user=user),
        lambda: attendance.run_alerts_now(company_id=COMP_B, user=user),
        lambda: mobile_logs.delete_mobile_log("lb1", company_id=COMP_B, user=user),
        lambda: mobile_logs.empty_mobile_logs({"company_id": COMP_B}, user=user),
    ]
    assert len(calls) == 13
    foreign = _foreign_snapshot(db)
    for call in calls:
        before = len(db.writes)
        with pytest.raises(HTTPException) as exc:
            _run(call())
        assert exc.value.status_code == 403
        assert db.writes[before:] == []
    assert _foreign_snapshot(db) == foreign


def test_run_alerts_personnel_still_403(api):
    client, db = api
    user = _user("user-p", [COMP_A], COMP_A, role="personel")
    before = len(db.writes)
    with pytest.raises(HTTPException) as exc:
        _run(attendance.run_alerts_now(company_id=COMP_A, user=user))
    assert exc.value.status_code == 403
    assert "yönetici" in str(exc.value.detail)
    assert db.writes[before:] == []
    with pytest.raises(HTTPException) as foreign:
        _run(attendance.run_alerts_now(company_id=COMP_B, user=user))
    assert foreign.value.status_code == 403
    response = client.post(
        "/api/personnel/attendance/run-alerts",
        params={"company_id": COMP_A},
        headers=_auth("user-p", role="personel"),
    )
    assert response.status_code == 403
    assert _ids(db, "notifications", COMP_A) == ["na1", "na2", "na3"]


def test_run_alerts_manager_and_accountant_still_pass_role_check(api):
    _client, _db = api
    for role in ("manager", "accountant"):
        user = _user("user-m", [COMP_A], COMP_A, role=role)
        out = _run(attendance.run_alerts_now(company_id=COMP_A, user=user))
        assert out["status"] == "success"
        assert out["results"] == []
        assert out["reminders"] == []
        assert out["auto_checkout"] == []
        assert out["auto_pause"] == []


def test_direct_call_without_company_id_stays_on_active_company(api):
    _client, db = api
    user = _user_a()
    login, password, incoming, fetch = _mocks()
    with login, password, incoming, fetch:
        info = _run(server.test_einvoice_connection(company_id=None, user=user))
        sync = _run(server.sync_einvoice_incoming(company_id="", user=user))
        read = _run(server.read_all_notifications(company_id=None, user=user))
        renamed = _run(server.rename_unit("Adet", {"name": "Parca"}, company_id=None, user=user))
        deleted_unit = _run(server.delete_unit("Koli", company_id="", user=user))
        deleted_cat = _run(server.delete_product_category("Gida", company_id=None, user=user))
        simulated = _run(server.delete_simulated_bank_transactions(company_id=None, user=user))
        synced = _run(server.sync_all_connections(company_id=None, user=user))
        matched = _run(server.auto_match_transactions(SimpleNamespace(), company_id=None, user=user))
        alerts = _run(attendance.run_alerts_now(company_id=None, user=user))
        one = _run(mobile_logs.delete_mobile_log("la1", company_id=None, user=user))
        emptied = _run(mobile_logs.empty_mobile_logs({}, user=user))
        cleared = _run(server.clear_notifications(company_id=None, user=user))
    assert info == _EINVOICE_OK
    assert sync["status"] == "success" and sync["found"] == 0 and sync["pulled"] == 0
    assert "n11 Faturam" in sync["message"]
    assert "processed" not in sync
    assert read == {"status": "success", "updated": 2}
    assert renamed == {"status": "success", "updated_products": 2}
    assert deleted_unit == {"status": "success"}
    assert deleted_cat == {"status": "success"}
    assert simulated["status"] == "success" and simulated["removed"] == 2
    assert "2 simüle" in simulated["message"]
    assert len(synced["results"]) == 1 and synced["results"][0]["connection_id"] == "cA"
    assert synced["results"][0]["inserted"] == 0 and synced["results"][0]["status"] == "success"
    assert matched["status"] == "success" and matched["matched"] == 1
    assert "1 hareket" in matched["message"]
    assert alerts["status"] == "success" and alerts["results"] == [] and alerts["reminders"] == []
    assert one == {"status": "success", "message": "Log silindi."}
    assert emptied["deleted"] == 1 and emptied["status"] == "success"
    assert cleared["status"] == "success" and cleared["deleted"] == 3
    assert _ids(db, "notifications", COMP_B) == ["nb1"]
    assert _ids(db, "notifications", NEXUS) == ["nn1"]
    assert db.einvoice_settings.docs[1]["status"] == "simulated"
    assert "last_inbox_sync_at" not in db.einvoice_settings.docs[1]
    assert _ids(db, "units", COMP_B) == ["ub", "ukb"]
    assert next(d for d in db.units.docs if d["_id"] == "ub")["name"] == "Adet"
    assert next(d for d in db.products.docs if d["_id"] == "p3")["unit"] == "Adet"
    assert _ids(db, "product_categories", COMP_B) == ["cb"]
    assert _ids(db, "bank_transactions", COMP_B) == ["sb1", "txmB"]
    assert next(d for d in db.bank_transactions.docs if d["_id"] == "txmB")["match_status"] == "unmatched"
    assert next(d for d in db.bank_connections.docs if d["_id"] == "cB").get("last_synced_at") is None
    assert _ids(db, "mobile_client_logs", COMP_B) == ["lb1"]
    assert _ids(db, "mobile_client_logs", NEXUS) == ["ln1"]
    assert next(d for d in db.bank_accounts.docs if d["_id"] == "accB")["current_balance"] == 100.0


def test_happy_path_with_company_a_keeps_response_shape(api):
    client, db = api
    headers = _auth("user-a")
    login, password, incoming, fetch = _mocks()
    with login, password, incoming, fetch:
        tested = client.post("/api/einvoice/test", params={"company_id": COMP_A}, headers=headers)
        synced = client.post("/api/einvoice/incoming/sync", params={"company_id": COMP_A}, headers=headers)
        read = client.post("/api/notifications/read-all", params={"company_id": COMP_A}, headers=headers)
        renamed = client.put("/api/products/units/Adet", params={"company_id": COMP_A}, json={"name": "Parca"}, headers=headers)
        deleted_unit = client.delete("/api/products/units/Koli", params={"company_id": COMP_A}, headers=headers)
        deleted_cat = client.delete("/api/products/categories/Gida", params={"company_id": COMP_A}, headers=headers)
        simulated = client.delete("/api/banking/transactions/simulated", params={"company_id": COMP_A}, headers=headers)
        banks = client.post("/api/banking/sync-all", params={"company_id": COMP_A}, headers=headers)
        matched = client.post("/api/banking/transactions/auto-match", params={"company_id": COMP_A}, headers=headers)
        alerts = client.post("/api/personnel/attendance/run-alerts", params={"company_id": COMP_A}, headers=headers)
        one = client.delete("/api/mobile/logs/la1", params={"company_id": COMP_A}, headers=headers)
        emptied = client.post("/api/mobile/logs/empty", json={"company_id": COMP_A}, headers=headers)
        cleared = client.post("/api/notifications/clear", params={"company_id": COMP_A}, headers=headers)
    assert tested.status_code == 200, tested.text
    assert tested.json() == _EINVOICE_OK
    assert synced.status_code == 200, synced.text
    body = synced.json()
    assert body["status"] == "success" and body["found"] == 0 and body["pulled"] == 0
    assert "n11 Faturam" in body["message"] and "processed" not in body
    assert read.status_code == 200 and read.json() == {"status": "success", "updated": 2}
    assert renamed.status_code == 200 and renamed.json() == {"status": "success", "updated_products": 2}
    assert deleted_unit.status_code == 200 and deleted_unit.json() == {"status": "success"}
    assert deleted_cat.status_code == 200 and deleted_cat.json() == {"status": "success"}
    assert simulated.status_code == 200, simulated.text
    assert simulated.json()["removed"] == 2 and simulated.json()["status"] == "success"
    assert "2 simüle" in simulated.json()["message"]
    assert banks.status_code == 200, banks.text
    assert len(banks.json()["results"]) == 1
    assert banks.json()["results"][0]["connection_id"] == "cA"
    assert banks.json()["results"][0]["inserted"] == 0
    assert matched.status_code == 200, matched.text
    assert matched.json()["matched"] == 1 and matched.json()["status"] == "success"
    assert "1 hareket" in matched.json()["message"]
    assert alerts.status_code == 200, alerts.text
    assert alerts.json()["status"] == "success"
    assert alerts.json()["results"] == [] and alerts.json()["reminders"] == []
    assert alerts.json()["auto_checkout"] == [] and alerts.json()["auto_pause"] == []
    assert one.status_code == 200 and one.json() == {"status": "success", "message": "Log silindi."}
    assert emptied.status_code == 200, emptied.text
    assert emptied.json()["deleted"] == 1 and emptied.json()["status"] == "success"
    assert "1 mobil log silindi." == emptied.json()["message"]
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["deleted"] == 3 and cleared.json()["message"] == "Bildirimler silindi."
    assert next(d for d in db.einvoice_settings.docs if d["_id"] == "esA")["status"] == "configured"
    assert next(d for d in db.einvoice_settings.docs if d["_id"] == "esB")["status"] == "simulated"
    assert "last_inbox_sync_at" in next(d for d in db.einvoice_settings.docs if d["_id"] == "esA")
    assert "last_inbox_sync_at" not in next(d for d in db.einvoice_settings.docs if d["_id"] == "esB")
    assert next(d for d in db.products.docs if d["_id"] == "p1")["unit"] == "Parca"
    assert next(d for d in db.products.docs if d["_id"] == "p3")["unit"] == "Adet"
    assert next(d for d in db.bank_accounts.docs if d["_id"] == "accA")["current_balance"] == 85.0
    assert next(d for d in db.bank_accounts.docs if d["_id"] == "accB")["current_balance"] == 100.0
    assert "sb1" in _ids(db, "bank_transactions", COMP_B)
    assert "realA" in _ids(db, "bank_transactions", COMP_A)
    assert "sa1" not in _ids(db, "bank_transactions", COMP_A)
    assert next(d for d in db.bank_transactions.docs if d["_id"] == "txmA")["match_status"] == "matched"
    assert next(d for d in db.bank_transactions.docs if d["_id"] == "txmB")["match_status"] == "unmatched"
    assert next(d for d in db.bank_transactions.docs if d["_id"] == "txmN")["match_status"] == "unmatched"
    assert _ids(db, "mobile_client_logs", COMP_A) == []
    assert _ids(db, "mobile_client_logs", COMP_B) == ["lb1"]
    assert _ids(db, "notifications", COMP_A) == []
    assert _ids(db, "notifications", COMP_B) == ["nb1"]
    assert _ids(db, "notifications", NEXUS) == ["nn1"]
    assert "B-SECRET" not in tested.text and "NEXUS-ONLY" not in banks.text


def test_http_without_company_id_stays_on_active_company(api):
    client, db = api
    headers = _auth("user-a")
    foreign = _foreign_snapshot(db)
    login, password, incoming, fetch = _mocks()
    with login, password, incoming, fetch:
        for method, path, where, body in _HTTP:
            if path.endswith("/clear"):
                continue
            response = _hit(client, method, path, where, body, headers=headers, omit=True)
            assert response.status_code == 200, (method, path, response.text)
            assert "B-SECRET" not in response.text
            assert "NEXUS-ONLY" not in response.text
    assert _foreign_snapshot(db) == foreign
    assert next(d for d in db.products.docs if d["_id"] == "p1")["unit"] == "Parca"
    assert next(d for d in db.notifications.docs if d["_id"] == "na1")["is_read"] is True
    assert next(d for d in db.notifications.docs if d["_id"] == "nb1")["is_read"] is False


def test_super_admin_follows_resolve_company_id(api):
    client, db = api
    missing = client.post("/api/notifications/read-all", headers=_auth("user-sa", superadmin=True))
    assert missing.status_code == 400
    assert db.writes == []
    user_sa = _user("user-sa", [], "", superadmin=True)
    with pytest.raises(HTTPException) as exc:
        _run(server.read_all_notifications(user=user_sa))
    assert exc.value.status_code == 400

    active = client.post("/api/notifications/read-all", headers=_auth("user-sa-a", superadmin=True))
    assert active.status_code == 200, active.text
    assert active.json()["updated"] == 2
    assert next(d for d in db.notifications.docs if d["_id"] == "nb1")["is_read"] is False
    assert next(d for d in db.notifications.docs if d["_id"] == "nn1")["is_read"] is False

    foreign = client.post(
        "/api/notifications/read-all",
        params={"company_id": COMP_B},
        headers=_auth("user-sa", superadmin=True),
    )
    assert foreign.status_code == 200, foreign.text
    assert foreign.json()["updated"] == 1
    assert next(d for d in db.notifications.docs if d["_id"] == "nb1")["is_read"] is True
    assert next(d for d in db.notifications.docs if d["_id"] == "nn1")["is_read"] is False
