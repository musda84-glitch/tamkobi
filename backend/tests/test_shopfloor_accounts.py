"""Atölye hesap tipi: saf kararlar ve uçlar. Canlı veritabanı yok."""
from __future__ import annotations

import copy
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import addons  # noqa: E402
import attendance  # noqa: E402
import auth_utils  # noqa: E402
import rbac  # noqa: E402
import saas  # noqa: E402
import server  # noqa: E402
import shopfloor_accounts as sfa  # noqa: E402
import shopfloor_pin  # noqa: E402
from mysql_store import apply_update, match_query, sort_docs  # noqa: E402

COMP_A = "co_a"
COMP_B = "co_b"
PW = "pw-sentinel-DoNotLog-91"
PIN = "pin-sentinel-DoNotLog-77"
DAY = "2026-10-20"


class MemCursor:
    def __init__(self, docs):
        self._docs = docs
        self._sort = None

    def sort(self, key, direction=1):
        self._sort = [(key, direction)] if isinstance(key, str) else list(key)
        return self

    async def to_list(self, length=None):
        rows = sort_docs(list(self._docs), self._sort) if self._sort else list(self._docs)
        if length is not None:
            rows = rows[: int(length)]
        return copy.deepcopy(rows)


class MemColl:
    def __init__(self, name):
        self.name = name
        self.docs = []

    def find(self, query=None, projection=None):
        matched = [d for d in self.docs if match_query(d, query or {})]
        return MemCursor(matched)

    async def find_one(self, query=None, projection=None):
        for doc in self.docs:
            if match_query(doc, query or {}):
                return copy.deepcopy(doc)
        return None

    async def distinct(self, key, query=None):
        seen = []
        for doc in self.docs:
            if not match_query(doc, query or {}):
                continue
            val = doc.get(key)
            if val not in seen:
                seen.append(val)
        return seen

    async def count_documents(self, query=None):
        return sum(1 for doc in self.docs if match_query(doc, query or {}))

    async def insert_one(self, doc):
        self.docs.append(copy.deepcopy(doc))
        return None

    async def insert_many(self, docs):
        self.docs.extend(copy.deepcopy(list(docs)))
        return None

    async def update_one(self, query, update, upsert=False):
        for i, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                self.docs[i] = apply_update(doc, update, query)
                return type("R", (), {"matched_count": 1, "modified_count": 1})()
        return type("R", (), {"matched_count": 0, "modified_count": 0})()

    async def update_many(self, query, update):
        n = 0
        for i, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                self.docs[i] = apply_update(doc, update, query)
                n += 1
        return type("R", (), {"matched_count": n, "modified_count": n})()

    async def delete_one(self, query):
        for i, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                self.docs.pop(i)
                return None
        return None

    async def delete_many(self, query):
        self.docs[:] = [d for d in self.docs if not match_query(d, query or {})]
        return None


class MemDB:
    def __init__(self):
        self._cols = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = MemColl(name)
            self._cols[name] = coll
        return coll

    def __getitem__(self, name):
        return getattr(self, name)


def _user(uid, company, *, role="admin", employee_id=None, account_type=None, stations=None, name=None):
    doc = {
        "_id": uid,
        "id": uid,
        "email": f"{uid}@example.com",
        "name": name or uid,
        "role": role,
        "is_active": True,
        "is_super_admin": False,
        "company_ids": [company],
        "active_company_id": company,
        "user_number": f"U-{uid}",
        "preferences": {},
    }
    if employee_id:
        doc["employee_id"] = employee_id
    if account_type:
        doc["account_type"] = account_type
    if stations is not None:
        doc["shopfloor_stations"] = list(stations)
    return doc


def _wo(wid, station, status, *, operator="", step=1):
    doc = {
        "_id": wid,
        "company_id": COMP_A,
        "order_id": "po-1",
        "station": station,
        "status": status,
        "step_name": "Kesim",
        "step_no": step,
        "order_code": "UE-1",
        "planned_quantity": 1,
        "planned_date": DAY,
        "operator_name": operator,
    }
    if status == "done":
        doc["started_at"] = f"{DAY}T10:00:00"
        doc["finished_at"] = f"{DAY}T11:00:00"
        doc["produced_qty"] = 1
        doc["scrap_qty"] = 0
        doc["paused_seconds"] = 0
    return doc


def _seed(db):
    db.companies.docs.append({
        "_id": COMP_A,
        "name": "Firma A",
        "work_parks": [{"name": "CNC"}, {"name": "LAZER"}],
        "work_schedule": {
            "start": "00:00",
            "end": "23:59",
            "break_minutes": 0,
            "work_days": [0, 1, 2, 3, 4, 5, 6],
            "exit_tolerance_minutes": 0,
            "timezone": "Europe/Istanbul",
        },
    })
    db.companies.docs.append({"_id": COMP_B, "name": "Firma B", "work_parks": [{"name": "CNC"}]})
    db.users.docs.extend([
        _user("admin-a", COMP_A, role="admin", name="Admin A"),
        _user("sales-a", COMP_A, role="sales", name="Satis A"),
        _user("floor-a", COMP_A, role="admin", name="Atolye A"),
        _user("plain-a", COMP_A, role="admin", name="Normal A"),
        _user("linked-a", COMP_A, role="admin", employee_id="emp-1", name="Bagli A"),
        _user("user-b", COMP_B, role="admin", name="Admin B"),
        _operator_user(),
    ])
    db.production_orders.docs.append({
        "_id": "po-1",
        "company_id": COMP_A,
        "status": "planned",
        "order_code": "UE-1",
    })
    db.work_orders.docs.extend([
        _wo("wo-ready", "CNC", "ready", step=1),
        _wo("wo-run", "CNC", "in_progress", operator="Op A", step=2),
        _wo("wo-fin", "CNC", "in_progress", operator="Op Fin", step=3),
        _wo("wo-lazer", "LAZER", "ready", step=4),
        _wo("wo-lazer-run", "LAZER", "in_progress", operator="Op Lazer", step=5),
        _wo("wo-done-cnc", "CNC", "done", operator="Op A", step=6),
        _wo("wo-done-lazer", "LAZER", "done", operator="Op Lazer", step=7),
        _wo("wo-spaced", "  CNC  ", "ready", step=8),
    ])


@pytest.fixture
def api(monkeypatch):
    monkeypatch.setenv("LOG_DB_PERSIST", "0")
    monkeypatch.setenv("JWT_SECRET", "test-shopfloor-accounts-jwt-secret-not-default")
    monkeypatch.setenv("TAMKOBI_BACKGROUND_JOBS", "0")
    db = MemDB()
    _seed(db)
    prev = (server.db, rbac._db, saas._db, addons._db, attendance._db, sfa._db)
    server.db = db
    rbac._db = db
    saas._db = db
    addons._db = db
    attendance._db = db
    sfa._db = db
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
        server.db, rbac._db, saas._db, addons._db, attendance._db, sfa._db = prev
        router.on_startup[:] = saved_up
        router.on_shutdown[:] = saved_down
        saas.invalidate()


def _token(uid, role="admin"):
    return auth_utils.create_access_token(uid, f"{uid}@example.com", role)


def _auth(uid, role="admin"):
    return {"Authorization": f"Bearer {_token(uid, role)}"}


def _operator_user():
    doc = _user("op-seed", COMP_A, role="admin", name="Op Seed")
    doc["shopfloor_pin_hash"] = "$2b$12$shopfloorpinhashplaceholder000000000000000000"
    doc["shopfloor_pin_ver"] = 1
    return doc


def _op_token(name):
    now = datetime.now(timezone.utc)
    return shopfloor_pin.issue_operator_token(
        company_id=COMP_A,
        atolye_user_id="floor-a",
        operator_id="op-seed",
        operator_type="user",
        operator_name=name,
        pin_ver=1,
        exp=now + timedelta(hours=4),
        now=now,
    )


def _floor(name="Op A"):
    headers = _auth("floor-a")
    headers["X-Shopfloor-Operator"] = _op_token(name)
    return headers


def _doc(db, uid):
    return next(d for d in db.users.docs if d["_id"] == uid)


def test_is_atolye_user():
    assert sfa.is_atolye_user({"account_type": "atolye"}) is True
    assert sfa.is_atolye_user({"account_type": " ATOLYE "}) is True
    assert sfa.is_atolye_user({"account_type": "standard"}) is False
    assert sfa.is_atolye_user({}) is False
    assert sfa.is_atolye_user(None) is False
    assert sfa.public_account_type({}) == "standard"
    assert sfa.public_stations({}) == []
    assert sfa.public_stations({"shopfloor_stations": [" CNC ", "", None]}) == ["CNC"]


def test_atolye_path_allowed():
    allowed = [
        ("GET", "/api/auth/me"),
        ("PUT", "/api/auth/me"),
        ("POST", "/api/auth/logout"),
        ("GET", "/api/personnel/employees"),
        ("HEAD", "/api/personnel/employees"),
        ("GET", "/api/production/work-orders"),
        ("GET", "/api/production/work-orders?station=CNC"),
        ("GET", "/api/production/work-orders/stations"),
        ("GET", "/api/production/work-orders/pause-policy"),
        ("GET", "/api/production/work-orders/performance"),
        ("GET", "/api/production/work-orders/shopfloor-settings"),
        ("POST", "/api/production/work-orders/shopfloor-unlock"),
        ("PUT", "/api/production/work-orders/wo1/assign"),
        ("POST", "/api/production/work-orders/wo1/start"),
        ("POST", "/api/production/work-orders/wo1/pause"),
        ("POST", "/api/production/work-orders/wo1/finish"),
        ("POST", "/api/production/work-orders/wo1/trash-request"),
    ]
    denied = [
        ("GET", "/api/invoices"),
        ("GET", "/api/personnel/payrolls"),
        ("POST", "/api/personnel/employees"),
        ("GET", "/api/personnel/employees/emp-1"),
        ("GET", "/api/production/orders"),
        ("POST", "/api/production/work-orders/shopfloor-settings"),
        ("POST", "/api/production/work-orders/trash-completed"),
        ("POST", "/api/production/work-orders/wo1/admin-trash"),
        ("POST", "/api/production/work-orders/trash-requests/req1/decide"),
        ("DELETE", "/api/auth-extra"),
    ]
    for method, path in allowed:
        assert sfa.atolye_path_allowed(method, path) is True, (method, path)
    for method, path in denied:
        assert sfa.atolye_path_allowed(method, path) is False, (method, path)


def test_station_allowed_and_filter():
    floor = {"account_type": "atolye", "shopfloor_stations": [" CNC "]}
    plain = {"role": "admin"}
    assert sfa.station_allowed(floor, "cnc") is True
    assert sfa.station_allowed(floor, "  Cnc") is True
    assert sfa.station_allowed(floor, "LAZER") is False
    assert sfa.station_allowed(floor, "") is False
    assert sfa.station_allowed(floor, None) is False
    assert sfa.station_allowed(plain, "LAZER") is True
    rows = [
        {"_id": "1", "station": "CNC"},
        {"_id": "2", "station": "  cnc "},
        {"_id": "3", "station": "LAZER"},
        {"_id": "4", "station": ""},
    ]
    kept = sfa.filter_work_orders_for_user(floor, rows)
    assert [r["_id"] for r in kept] == ["1", "2"]
    assert sfa.filter_work_orders_for_user(plain, rows) == rows
    assert sfa.filter_work_orders_for_user(floor, None) == []
    both = {"account_type": "atolye", "shopfloor_stations": ["CNC", "LAZER"]}
    assert sfa.station_query_values(both) == ["CNC", "LAZER"]
    assert sfa.station_query_values(both, "  cnc ") == ["CNC"]
    assert sfa.station_query_values(both, "Kaynak") == []
    assert sfa.station_query_values(both, None) == ["CNC", "LAZER"]
    assert sfa.station_query_values(both, "") == ["CNC", "LAZER"]


def test_admin_assigns_and_me_returns_fields(api):
    client, db = api
    res = client.put(
        "/api/users/floor-a/shopfloor-account",
        json={"account_type": "atolye", "shopfloor_stations": [" cnc ", "CNC"], "password": PW, "pin": PIN},
        headers=_auth("admin-a"),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["account_type"] == "atolye"
    assert body["shopfloor_stations"] == ["CNC"]
    assert PW not in res.text and PIN not in res.text
    stored = _doc(db, "floor-a")
    assert stored["account_type"] == "atolye"
    assert stored["shopfloor_stations"] == ["CNC"]

    me = client.get("/api/auth/me", headers=_auth("floor-a"))
    assert me.status_code == 200, me.text
    user = me.json()["user"]
    assert user["account_type"] == "atolye"
    assert user["shopfloor_stations"] == ["CNC"]

    plain = client.get("/api/auth/me", headers=_auth("plain-a"))
    assert plain.status_code == 200, plain.text
    assert plain.json()["user"]["account_type"] == "standard"
    assert plain.json()["user"]["shopfloor_stations"] == []


def test_non_admin_cannot_assign(api):
    client, db = api
    res = client.put(
        "/api/users/floor-a/shopfloor-account",
        json={"account_type": "atolye", "shopfloor_stations": ["CNC"], "password": PW},
        headers=_auth("sales-a", "sales"),
    )
    assert res.status_code == 403, res.text
    assert "account_type" not in _doc(db, "floor-a")


def test_empty_unknown_and_linked_employee_rejected(api):
    client, db = api
    empty = client.put(
        "/api/users/floor-a/shopfloor-account",
        json={"account_type": "atolye", "shopfloor_stations": []},
        headers=_auth("admin-a"),
    )
    assert empty.status_code == 400, empty.text

    unknown = client.put(
        "/api/users/floor-a/shopfloor-account",
        json={"account_type": "atolye", "shopfloor_stations": ["Kaynak"]},
        headers=_auth("admin-a"),
    )
    assert unknown.status_code == 400, unknown.text
    assert "Kaynak" in unknown.text

    linked = client.put(
        "/api/users/linked-a/shopfloor-account",
        json={"account_type": "atolye", "shopfloor_stations": ["CNC"]},
        headers=_auth("admin-a"),
    )
    assert linked.status_code == 400, linked.text
    assert "account_type" not in _doc(db, "linked-a")
    assert "account_type" not in _doc(db, "floor-a")


def test_other_company_user_is_404(api):
    client, db = api
    res = client.put(
        "/api/users/user-b/shopfloor-account",
        json={"account_type": "atolye", "shopfloor_stations": ["CNC"]},
        headers=_auth("admin-a"),
    )
    assert res.status_code == 404, res.text
    assert "account_type" not in _doc(db, "user-b")


def test_profile_and_user_update_ignore_shopfloor_fields(api):
    client, db = api
    me = client.put(
        "/api/auth/me",
        json={"name": "Yeni Ad", "account_type": "atolye", "shopfloor_stations": ["CNC"], "password": PW, "pin": PIN},
        headers=_auth("plain-a"),
    )
    assert me.status_code == 200, me.text
    assert _doc(db, "plain-a")["name"] == "Yeni Ad"
    assert "account_type" not in _doc(db, "plain-a")
    assert "shopfloor_stations" not in _doc(db, "plain-a")

    edited = client.put(
        "/api/users/floor-a",
        json={"name": "Liste Ad", "account_type": "atolye", "shopfloor_stations": ["LAZER"], "password": PW},
        headers=_auth("admin-a"),
    )
    assert edited.status_code == 200, edited.text
    assert _doc(db, "floor-a")["name"] == "Liste Ad"
    assert "account_type" not in _doc(db, "floor-a")


def _assign(client):
    res = client.put(
        "/api/users/floor-a/shopfloor-account",
        json={"account_type": "atolye", "shopfloor_stations": ["CNC"]},
        headers=_auth("admin-a"),
    )
    assert res.status_code == 200, res.text


def test_atolye_user_is_limited_to_shopfloor_paths(api):
    client, _db = api
    _assign(client)
    floor = _auth("floor-a")
    plain = _auth("plain-a")

    blocked = client.get(
        "/api/invoices",
        params={"company_id": COMP_A},
        headers={**floor, "Origin": "http://localhost:3000"},
    )
    assert blocked.status_code == 403, blocked.text
    assert blocked.headers.get("access-control-allow-origin") == "http://localhost:3000"
    payrolls = client.get("/api/personnel/payrolls", params={"company_id": COMP_A}, headers=floor)
    assert payrolls.status_code == 403, payrolls.text
    employees = client.get("/api/personnel/employees", params={"company_id": COMP_A}, headers=floor)
    assert employees.status_code == 200, employees.text
    assert employees.json() == []

    open_invoices = client.get("/api/invoices", params={"company_id": COMP_A}, headers=plain)
    assert open_invoices.status_code == 200, open_invoices.text
    open_pay = client.get("/api/personnel/payrolls", params={"company_id": COMP_A}, headers=plain)
    assert open_pay.status_code == 200, open_pay.text

    settings = client.get("/api/production/work-orders/shopfloor-settings", params={"company_id": COMP_A}, headers=floor)
    assert settings.status_code == 200, settings.text
    assert settings.json()["group_same_station"] is False
    unlock = client.post("/api/production/work-orders/shopfloor-unlock", json={"company_id": COMP_A}, headers=floor)
    assert unlock.status_code == 400, unlock.text
    post_settings = client.post(
        "/api/production/work-orders/shopfloor-settings",
        json={"company_id": COMP_A, "group_same_station": True},
        headers=floor,
    )
    assert post_settings.status_code == 403, post_settings.text
    for path in (
        "/api/production/work-orders/trash-completed",
        "/api/production/work-orders/trash-requests/req1/decide",
        "/api/production/work-orders/wo-ready/admin-trash",
    ):
        denied = client.post(path, json={"company_id": COMP_A, "password": PW, "status": "rejected"}, headers=floor)
        assert denied.status_code == 403, (path, denied.text)


def test_work_orders_filtered_and_actions_scoped(api):
    client, db = api
    _assign(client)
    floor = _auth("floor-a")
    plain = _auth("plain-a")

    listed = client.get("/api/production/work-orders", params={"company_id": COMP_A}, headers=floor)
    assert listed.status_code == 200, listed.text
    ids = {row["id"] for row in listed.json()}
    assert "wo-lazer" not in ids and "wo-lazer-run" not in ids and "wo-done-lazer" not in ids
    assert {"wo-ready", "wo-run", "wo-fin", "wo-done-cnc"} <= ids

    bad_station = client.get(
        "/api/production/work-orders",
        params={"company_id": COMP_A, "station": "lazer"},
        headers=floor,
    )
    assert bad_station.status_code == 403, bad_station.text
    good_station = client.get(
        "/api/production/work-orders",
        params={"company_id": COMP_A, "station": "cnc"},
        headers=floor,
    )
    assert good_station.status_code == 200, good_station.text
    assert {row["id"] for row in good_station.json()} == {"wo-ready", "wo-run", "wo-fin", "wo-done-cnc"}

    stations = client.get("/api/production/work-orders/stations", params={"company_id": COMP_A}, headers=floor)
    assert stations.status_code == 200, stations.text
    assert stations.json() == ["CNC"]

    perf = client.get(
        "/api/production/work-orders/performance",
        params={"company_id": COMP_A, "date_from": DAY, "date_to": DAY},
        headers=floor,
    )
    assert perf.status_code == 200, perf.text
    assert perf.json()["total_done"] == 1
    assert [row["name"] for row in perf.json()["stations"]] == ["CNC"]

    plain_perf = client.get(
        "/api/production/work-orders/performance",
        params={"company_id": COMP_A, "date_from": DAY, "date_to": DAY},
        headers=plain,
    )
    assert plain_perf.status_code == 200, plain_perf.text
    assert plain_perf.json()["total_done"] == 2
    assert {row["name"] for row in plain_perf.json()["stations"]} == {"CNC", "LAZER"}

    policy = client.get(
        "/api/production/work-orders/pause-policy",
        params={"company_id": COMP_A, "operator_name": "Op A"},
        headers=_floor("Op A"),
    )
    assert policy.status_code == 200, policy.text
    outside = client.get(
        "/api/production/work-orders/pause-policy",
        params={"company_id": COMP_A, "operator_name": "Op Lazer"},
        headers=_floor("Op Lazer"),
    )
    assert outside.status_code == 403, outside.text
    plain_policy = client.get(
        "/api/production/work-orders/pause-policy",
        params={"company_id": COMP_A, "operator_name": "Op Lazer"},
        headers=plain,
    )
    assert plain_policy.status_code == 200, plain_policy.text

    plain_list = client.get("/api/production/work-orders", params={"company_id": COMP_A}, headers=plain)
    assert plain_list.status_code == 200, plain_list.text
    plain_ids = {row["id"] for row in plain_list.json()}
    assert {"wo-lazer", "wo-done-lazer", "wo-ready"} <= plain_ids
    plain_station = client.get(
        "/api/production/work-orders",
        params={"company_id": COMP_A, "station": "LAZER"},
        headers=plain,
    )
    assert plain_station.status_code == 200, plain_station.text
    assert {row["id"] for row in plain_station.json()} == {"wo-lazer", "wo-lazer-run", "wo-done-lazer"}
    plain_case = client.get(
        "/api/production/work-orders",
        params={"company_id": COMP_A, "station": "cnc"},
        headers=plain,
    )
    assert plain_case.status_code == 200, plain_case.text
    assert plain_case.json() == []
    plain_stations = client.get("/api/production/work-orders/stations", params={"company_id": COMP_A}, headers=plain)
    assert plain_stations.json() == ["CNC", "LAZER"]

    for path in ("start", "pause", "finish", "trash-request"):
        denied = client.post(
            f"/api/production/work-orders/wo-lazer/{path}",
            json={"operator_name": "Op A", "password": PW, "pin": PIN},
            headers=floor,
        )
        assert denied.status_code == 403, (path, denied.text)
    assign_denied = client.put(
        "/api/production/work-orders/wo-lazer/assign",
        json={"assigned_name": "Op A"},
        headers=floor,
    )
    assert assign_denied.status_code == 403, assign_denied.text

    started = client.post(
        "/api/production/work-orders/wo-ready/start",
        json={"operator_name": "Op A"},
        headers=_floor("Op A"),
    )
    assert started.status_code == 200, started.text
    paused = client.post(
        "/api/production/work-orders/wo-run/pause",
        json={"operator_name": "Op A"},
        headers=_floor("Op A"),
    )
    assert paused.status_code == 200, paused.text
    finished = client.post(
        "/api/production/work-orders/wo-fin/finish",
        json={"operator_name": "Op Fin", "produced_qty": 1},
        headers=_floor("Op Fin"),
    )
    assert finished.status_code == 200, finished.text
    trash = client.post(
        "/api/production/work-orders/wo-spaced/trash-request",
        json={"operator_name": "Op A"},
        headers=_floor("Op A"),
    )
    assert trash.status_code == 200, trash.text
    assigned = client.put(
        "/api/production/work-orders/wo-done-cnc/assign",
        json={"assigned_to": "u", "assigned_name": "Op A"},
        headers=_floor("Op A"),
    )
    assert assigned.status_code == 200, assigned.text

    normal_trash = client.post(
        "/api/production/work-orders/trash-requests/missing/decide",
        json={"status": "rejected"},
        headers=plain,
    )
    assert normal_trash.status_code == 404, normal_trash.text
    assert db.work_orders.docs


def _spy_find(coll):
    seen = []
    real = coll.find

    def wrapped(query=None, projection=None):
        seen.append(copy.deepcopy(query) if isinstance(query, dict) else query)
        return real(query, projection)

    coll.find = wrapped
    return seen


def test_list_query_scopes_atolye_stations_and_keeps_normal_exact(api):
    client, db = api
    _assign(client)
    seen = _spy_find(db.work_orders)

    listed = client.get("/api/production/work-orders", params={"company_id": COMP_A}, headers=_auth("floor-a"))
    assert listed.status_code == 200, listed.text
    assert seen[-1]["station"] == {"$in": ["CNC"]}
    assert seen[-1]["company_id"] == COMP_A

    one = client.get(
        "/api/production/work-orders",
        params={"company_id": COMP_A, "station": "cnc"},
        headers=_auth("floor-a"),
    )
    assert one.status_code == 200, one.text
    assert seen[-1]["station"] == {"$in": ["CNC"]}
    assert {row["id"] for row in one.json()} == {"wo-ready", "wo-run", "wo-fin", "wo-done-cnc"}

    denied = client.get(
        "/api/production/work-orders",
        params={"company_id": COMP_A, "station": "lazer"},
        headers=_auth("floor-a"),
    )
    assert denied.status_code == 403, denied.text
    assert seen[-1]["station"] == {"$in": ["CNC"]}

    normal = client.get(
        "/api/production/work-orders",
        params={"company_id": COMP_A, "station": "LAZER"},
        headers=_auth("plain-a"),
    )
    assert normal.status_code == 200, normal.text
    assert seen[-1]["station"] == "LAZER"
    assert {row["id"] for row in normal.json()} == {"wo-lazer", "wo-lazer-run", "wo-done-lazer"}

    normal_case = client.get(
        "/api/production/work-orders",
        params={"company_id": COMP_A, "station": "cnc"},
        headers=_auth("plain-a"),
    )
    assert normal_case.status_code == 200, normal_case.text
    assert seen[-1]["station"] == "cnc"
    assert normal_case.json() == []


def test_atolye_list_is_not_cut_by_other_station_cap(api):
    """Başka istasyondaki 1000 satır, izinli istasyonun satırlarını listeden düşürmesin."""
    client, db = api
    _assign(client)
    for i in range(1001):
        db.work_orders.docs.append({
            "_id": f"wo-fill-{i}",
            "company_id": COMP_A,
            "order_id": "po-1",
            "station": "LAZER",
            "status": "ready",
            "step_name": "Kesim",
            "step_no": i,
            "order_code": "AAA",
            "planned_quantity": 1,
            "planned_date": DAY,
        })
    allowed = []
    for i in range(3):
        wid = f"wo-late-{i}"
        allowed.append(wid)
        db.work_orders.docs.append({
            "_id": wid,
            "company_id": COMP_A,
            "order_id": "po-1",
            "station": "CNC",
            "status": "ready",
            "step_name": "Kesim",
            "step_no": i,
            "order_code": "ZZZ",
            "planned_quantity": 1,
            "planned_date": "2099-01-01",
        })
    listed = client.get("/api/production/work-orders", params={"company_id": COMP_A}, headers=_auth("floor-a"))
    assert listed.status_code == 200, listed.text
    ids = {row["id"] for row in listed.json()}
    assert not any(str(row.get("station") or "").casefold().strip() == "lazer" for row in listed.json())
    assert "wo-ready" in ids and "wo-run" in ids and "wo-fin" in ids and "wo-done-cnc" in ids
    assert set(allowed) <= ids
    narrowed = client.get(
        "/api/production/work-orders",
        params={"company_id": COMP_A, "station": "cnc"},
        headers=_auth("floor-a"),
    )
    assert narrowed.status_code == 200, narrowed.text
    assert set(allowed) <= {row["id"] for row in narrowed.json()}
    blocked = client.get(
        "/api/production/work-orders",
        params={"company_id": COMP_A, "station": "lazer"},
        headers=_auth("floor-a"),
    )
    assert blocked.status_code == 403, blocked.text


def _blob(caplog):
    parts = [caplog.text]
    for rec in caplog.records:
        parts.append(rec.getMessage())
        parts.append(str(getattr(rec, "event_data", "")))
    return "\n".join(parts)


def test_logs_omit_secrets(api, caplog):
    client, _db = api
    app_log = logging.getLogger("tamkobi.app")
    err_log = logging.getLogger("tamkobi.error")
    prev_app, prev_err = app_log.propagate, err_log.propagate
    app_log.propagate = True
    err_log.propagate = True
    app_log.addHandler(caplog.handler)
    err_log.addHandler(caplog.handler)
    caplog.set_level(logging.INFO)
    token = _token("floor-a")
    try:
        assigned = client.put(
            "/api/users/floor-a/shopfloor-account",
            json={"account_type": "atolye", "shopfloor_stations": ["CNC"], "password": PW, "pin": PIN},
            headers=_auth("admin-a"),
        )
        assert assigned.status_code == 200, assigned.text
        denied = client.post(
            "/api/invoices",
            json={"password": PW, "pin": PIN, "token": token},
            headers={"Authorization": f"Bearer {token}"},
        )
        assert denied.status_code == 403, denied.text
        blob = _blob(caplog)
        assert "shopfloor_account_assigned" in blob
        assert "shopfloor_account_denied" in blob
        assert PW not in blob
        assert PIN not in blob
        assert token not in blob
        assert "floor-a" in blob
        assert COMP_A in blob
    finally:
        app_log.removeHandler(caplog.handler)
        err_log.removeHandler(caplog.handler)
        app_log.propagate = prev_app
        err_log.propagate = prev_err
