"""Atölye kiosk cihaz eşleştirme. Canlı veritabanı yok."""
from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import addons  # noqa: E402
import attendance  # noqa: E402
import attendance_security as sec  # noqa: E402
import auth_utils  # noqa: E402
import rbac  # noqa: E402
import saas  # noqa: E402
import server  # noqa: E402
import shopfloor_accounts as sfa  # noqa: E402
import shopfloor_devices as sfd  # noqa: E402
import shopfloor_pin  # noqa: E402
from mysql_store import apply_update, match_query, new_upsert_doc, sort_docs  # noqa: E402

COMP_A = "co_a"
COMP_B = "co_b"
PIN = "4826"
DAY = "2026-10-21"
T0 = datetime(2026, 10, 21, 9, 0, tzinfo=timezone.utc)


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
                return type("R", (), {"matched_count": 1, "modified_count": 1, "upserted_id": None})()
        if upsert:
            created = new_upsert_doc(update, query)
            self.docs.append(created)
            return type("R", (), {"matched_count": 0, "modified_count": 0, "upserted_id": created.get("_id")})()
        return type("R", (), {"matched_count": 0, "modified_count": 0, "upserted_id": None})()

    async def update_one_atomic(self, query, update):
        for i, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                updated = apply_update(doc, update, query)
                changed = updated != doc
                self.docs[i] = updated
                return type("R", (), {"matched_count": 1, "modified_count": 1 if changed else 0, "upserted_id": None})()
        return type("R", (), {"matched_count": 0, "modified_count": 0, "upserted_id": None})()

    async def find_one_and_update(self, query, update, upsert=False, return_document=True, projection=None):
        for i, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                updated = apply_update(doc, update, query)
                self.docs[i] = updated
                return copy.deepcopy(updated if return_document else doc)
        return None

    async def count_documents(self, query=None):
        return sum(1 for doc in self.docs if match_query(doc, query or {}))


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


def _user(uid, company, *, role="admin", account_type=None, stations=None, name=None):
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
    if account_type:
        doc["account_type"] = account_type
    if stations is not None:
        doc["shopfloor_stations"] = list(stations)
    return doc


def _wo(wid, company, station, order_id):
    return {
        "_id": wid,
        "company_id": company,
        "order_id": order_id,
        "station": station,
        "status": "ready",
        "step_name": "Kesim",
        "step_no": 1,
        "order_code": order_id,
        "planned_quantity": 1,
        "planned_date": DAY,
    }


def _seed(db):
    parks = [{"name": "CNC"}, {"name": "LAZER"}, {"name": "KAYNAK"}]
    db.companies.docs.append({
        "_id": COMP_A,
        "name": "Firma A",
        "work_parks": parks,
        "work_schedule": {"start": "08:00", "end": "18:00", "timezone": "Europe/Istanbul", "work_days": [0, 1, 2, 3, 4, 5, 6]},
    })
    db.companies.docs.append({
        "_id": COMP_B,
        "name": "Firma B",
        "work_parks": [{"name": "Kaynak"}],
    })
    op = _user("op-a", COMP_A, role="admin", name="Operatör")
    op["shopfloor_pin_hash"] = "pin-hash"
    op["shopfloor_pin_ver"] = 1
    db.users.docs.extend([
        _user("admin-a", COMP_A, role="admin", name="Admin A"),
        _user("admin-b", COMP_B, role="admin", name="Admin B"),
        _user("sales-a", COMP_A, role="sales", name="Satış"),
        _user("floor-a", COMP_A, role="admin", account_type="atolye", stations=["CNC"], name="Atölye"),
        op,
    ])
    db.production_orders.docs.extend([
        {"_id": "po-a", "company_id": COMP_A, "status": "planned"},
        {"_id": "po-b", "company_id": COMP_B, "status": "planned"},
    ])
    db.work_orders.docs.extend([
        _wo("wo-cnc", COMP_A, "CNC", "po-a"),
        _wo("wo-lazer", COMP_A, "LAZER", "po-a"),
        _wo("wo-kaynak", COMP_A, "KAYNAK", "po-a"),
        _wo("wo-b", COMP_B, "Kaynak", "po-b"),
    ])


@pytest.fixture
def api(monkeypatch):
    monkeypatch.setenv("LOG_DB_PERSIST", "0")
    monkeypatch.setenv("JWT_SECRET", "test-shopfloor-devices-jwt-secret-not-default")
    monkeypatch.setenv("TAMKOBI_BACKGROUND_JOBS", "0")
    monkeypatch.setattr(shopfloor_pin, "verify_password", lambda plain, hashed: plain == PIN)
    clock = {"now": T0}
    monkeypatch.setattr(sfd, "utcnow", lambda: clock["now"])
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
        yield client, db, clock
    finally:
        if entered:
            client.__exit__(None, None, None)
        server.db, rbac._db, saas._db, addons._db, attendance._db, sfa._db = prev
        router.on_startup[:] = saved_up
        router.on_shutdown[:] = saved_down
        saas.invalidate()


def _auth(uid, role="admin"):
    token = auth_utils.create_access_token(uid, f"{uid}@example.com", role)
    return {"Authorization": f"Bearer {token}"}


def _dump(db) -> str:
    blob = {
        "devices": db.shopfloor_devices.docs,
        "codes": db.shopfloor_device_codes.docs,
        "audit": db.shopfloor_pin_audit.docs,
    }
    return json.dumps(blob, default=str)


def _issue(client, *, mode="all", stations=None, headers=None, company_id=None):
    body = {"station_mode": mode}
    if stations is not None:
        body["stations"] = stations
    if company_id is not None:
        body["company_id"] = company_id
    res = client.post("/api/shopfloor/devices/pairing-codes", json=body, headers=headers or _auth("admin-a"))
    return res


def _pair(client, code, company_id=None):
    body = {"code": code}
    if company_id is not None:
        body["company_id"] = company_id
    return client.post("/api/shopfloor/devices/pair", json=body)


def _ids(res):
    return {row.get("id") or row.get("_id") for row in res.json()}


def test_pair_happy_path_stores_only_hashes(api):
    client, db, _clock = api
    created = _issue(client, mode="all")
    assert created.status_code == 200, created.text
    code = created.json()["code"]
    assert sfd.CODE_RE.fullmatch(code)
    assert code not in _dump(db)
    code_row = db.shopfloor_device_codes.docs[0]
    assert code_row["code_hash"] == sfd.hash_pairing_code(code)
    assert code_row["code_hash"] != hashlib.sha256(code.encode("utf-8")).hexdigest()
    assert "code" not in code_row

    paired = _pair(client, code)
    assert paired.status_code == 200, paired.text
    token = paired.json()["token"]
    device_id = paired.json()["device_id"]
    assert token not in _dump(db)
    assert code not in _dump(db)
    device = next(row for row in db.shopfloor_devices.docs if row["_id"] == device_id)
    assert device["token_hash"] == sec.hash_device_token(token)
    assert device["company_id"] == COMP_A
    assert device["status"] == "active"
    assert "token" not in device
    stored_code = db.shopfloor_device_codes.docs[0]
    assert stored_code["consumed_at"]
    assert stored_code["device_id"] == device_id
    assert device["_id"] == stored_code["_id"]
    assert sec.device_token_matches(token, device["token_hash"])

    stations = client.get(
        "/api/production/work-orders/stations",
        params={"company_id": COMP_A},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert stations.status_code == 200, stations.text
    assert stations.json() == ["CNC", "LAZER", "KAYNAK"]
    actions = {row["action"] for row in db.shopfloor_pin_audit.docs}
    assert {"create_code", "pair"} <= actions
    assert code not in _dump(db) and token not in _dump(db)


def test_code_reuse_expiry_and_rate_limit(api):
    client, db, clock = api
    created = _issue(client)
    assert created.status_code == 200, created.text
    code = created.json()["code"]
    first = _pair(client, code)
    assert first.status_code == 200, first.text
    again = _pair(client, code)
    assert again.status_code == 400, again.text
    assert first.json()["token"] not in again.text

    fresh = _issue(client)
    assert fresh.status_code == 200, fresh.text
    clock["now"] = T0 + timedelta(minutes=10, seconds=1)
    expired = _pair(client, fresh.json()["code"])
    assert expired.status_code == 400, expired.text
    assert db.shopfloor_devices.docs[-1]["_id"] == first.json()["device_id"]

    clock["now"] = T0 + timedelta(minutes=11)
    issued = 0
    for _ in range(sfd.CODE_RATE_MAX):
        res = _issue(client)
        assert res.status_code == 200, res.text
        issued += 1
        assert res.json()["code"] not in _dump(db)
    blocked = _issue(client)
    assert blocked.status_code == 429, blocked.text
    assert "code" not in blocked.json()
    clock["now"] = T0 + timedelta(minutes=22)
    opened = _issue(client)
    assert opened.status_code == 200, opened.text
    assert issued == sfd.CODE_RATE_MAX


def test_revoked_device_and_operator_token(api):
    client, db, _clock = api
    created = _issue(client, mode="one", stations=["CNC"])
    code = created.json()["code"]
    paired = _pair(client, code)
    assert paired.status_code == 200, paired.text
    token = paired.json()["token"]
    device_id = paired.json()["device_id"]
    headers = {"Authorization": f"Bearer {token}"}
    unlock = client.post(
        "/api/production/work-orders/shopfloor-unlock",
        json={"user_id": "op-a", "pin": PIN},
        headers=headers,
    )
    assert unlock.status_code == 200, unlock.text
    op_token = unlock.json()["operator_token"]
    claims = shopfloor_pin._operator_claims(
        op_token, company_id=COMP_A, atolye_user_id=device_id, now=datetime.now(timezone.utc),
    )
    assert claims["did"] == device_id
    user = {
        "_id": device_id,
        "id": device_id,
        "account_type": "atolye_device",
        "active_company_id": COMP_A,
        "company_ids": [COMP_A],
    }
    name = asyncio.run(shopfloor_pin.resolve_operator({"operator_token": op_token}, user, {"company_id": COMP_A}))
    assert str(name) == "Operatör"

    revoked = client.post(
        f"/api/shopfloor/devices/{device_id}/revoke",
        headers=_auth("admin-a"),
    )
    assert revoked.status_code == 200, revoked.text
    assert next(row for row in db.shopfloor_devices.docs if row["_id"] == device_id)["status"] == "revoked"
    for path in (
        "/api/production/work-orders/stations",
        "/api/production/work-orders",
        "/api/users",
    ):
        res = client.get(path, params={"company_id": COMP_A}, headers=headers)
        assert res.status_code == 401, (path, res.text)
    denied_unlock = client.post(
        "/api/production/work-orders/shopfloor-unlock",
        json={"user_id": "op-a", "pin": PIN},
        headers=headers,
    )
    assert denied_unlock.status_code == 401, denied_unlock.text
    with pytest.raises(HTTPException) as exc:
        asyncio.run(shopfloor_pin.resolve_operator({"operator_token": op_token}, user, {"company_id": COMP_A}))
    assert exc.value.status_code == 401
    assert op_token not in _dump(db)


def test_station_modes_filter_work_orders_and_enforce(api):
    client, _db, _clock = api
    created = _issue(client, mode="all")
    paired = _pair(client, created.json()["code"])
    token = paired.json()["token"]
    device_id = paired.json()["device_id"]
    headers = {"Authorization": f"Bearer {token}"}

    def listed():
        res = client.get("/api/production/work-orders", params={"company_id": COMP_A}, headers=headers)
        assert res.status_code == 200, res.text
        return _ids(res)

    assert listed() == {"wo-cnc", "wo-lazer", "wo-kaynak"}
    principal = asyncio.run(sfd.principal_from_token(token, server.db))
    sfa.enforce_station(principal, "KAYNAK")
    with pytest.raises(HTTPException):
        sfa.enforce_station(principal, "Kaynak-B")

    edited = client.put(
        f"/api/shopfloor/devices/{device_id}",
        json={"station_mode": "many", "stations": ["CNC", "LAZER"]},
        headers=_auth("admin-a"),
    )
    assert edited.status_code == 200, edited.text
    assert listed() == {"wo-cnc", "wo-lazer"}
    principal = asyncio.run(sfd.principal_from_token(token, server.db))
    sfa.enforce_station(principal, "LAZER")
    with pytest.raises(HTTPException) as many_denied:
        sfa.enforce_station(principal, "KAYNAK")
    assert many_denied.value.status_code == 403

    one = client.put(
        f"/api/shopfloor/devices/{device_id}",
        json={"station_mode": "one", "stations": ["cnc"]},
        headers=_auth("admin-a"),
    )
    assert one.status_code == 200, one.text
    assert one.json()["device"]["stations"] == ["CNC"]
    assert listed() == {"wo-cnc"}
    blocked = client.post(
        "/api/production/work-orders/wo-lazer/start",
        json={},
        headers=headers,
    )
    assert blocked.status_code == 403, blocked.text
    allowed = client.post(
        "/api/production/work-orders/wo-cnc/start",
        json={},
        headers=headers,
    )
    assert allowed.status_code == 401, allowed.text
    assert sfa.station_query_values(asyncio.run(sfd.principal_from_token(token, server.db))) == ["CNC"]


def test_device_cannot_leave_shopfloor_paths(api):
    client, _db, _clock = api
    created = _issue(client)
    paired = _pair(client, created.json()["code"])
    headers = {"Authorization": f"Bearer {paired.json()['token']}"}
    users = client.get("/api/users", params={"company_id": COMP_A}, headers=headers)
    assert users.status_code == 403, users.text
    settings = client.post(
        "/api/production/work-orders/shopfloor-settings",
        json={"company_id": COMP_A, "group_same_station": True},
        headers=headers,
    )
    assert settings.status_code == 403, settings.text
    stations = client.get("/api/production/work-orders/stations", params={"company_id": COMP_A}, headers=headers)
    assert stations.status_code == 200, stations.text


def test_company_isolation(api):
    client, db, _clock = api
    foreign = _issue(client, company_id=COMP_B)
    assert foreign.status_code == 403, foreign.text
    created = _issue(client, mode="one", stations=["CNC"])
    assert created.status_code == 200, created.text
    paired = _pair(client, created.json()["code"], company_id=COMP_B)
    assert paired.status_code == 200, paired.text
    device_id = paired.json()["device_id"]
    assert next(row for row in db.shopfloor_devices.docs if row["_id"] == device_id)["company_id"] == COMP_A
    token = paired.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    own = client.get("/api/shopfloor/devices", headers=_auth("admin-a"))
    assert own.status_code == 200, own.text
    assert {row["id"] for row in own.json()} == {device_id}
    assert "token_hash" not in own.text and token not in own.text
    other = client.get("/api/shopfloor/devices", headers=_auth("admin-b"))
    assert other.status_code == 200, other.text
    assert other.json() == []

    edit = client.put(
        f"/api/shopfloor/devices/{device_id}",
        json={"label": "B", "station_mode": "all"},
        headers=_auth("admin-b"),
    )
    assert edit.status_code == 404, edit.text
    revoke = client.post(f"/api/shopfloor/devices/{device_id}/revoke", headers=_auth("admin-b"))
    assert revoke.status_code == 404, revoke.text
    assert next(row for row in db.shopfloor_devices.docs if row["_id"] == device_id)["status"] == "active"

    orders = client.get("/api/production/work-orders", headers=headers)
    assert orders.status_code == 200, orders.text
    assert "wo-b" not in _ids(orders)
    cross = client.get("/api/production/work-orders", params={"company_id": COMP_B}, headers=headers)
    assert cross.status_code == 403, cross.text
    ops = client.get("/api/production/work-orders/shopfloor-operators", headers=headers)
    assert ops.status_code == 200, ops.text
    assert all(row["id"] != "admin-b" for row in ops.json())


def test_non_admin_and_atolye_cannot_manage_devices(api):
    client, db, _clock = api
    sales = _issue(client, headers=_auth("sales-a", "sales"))
    assert sales.status_code == 403, sales.text
    floor = _issue(client, headers=_auth("floor-a"))
    assert floor.status_code == 403, floor.text
    assert db.shopfloor_device_codes.docs == []
    created = _issue(client)
    device_id = _pair(client, created.json()["code"]).json()["device_id"]
    for headers in (_auth("sales-a", "sales"), _auth("floor-a")):
        listed = client.get("/api/shopfloor/devices", headers=headers)
        assert listed.status_code == 403, listed.text
        edited = client.put(
            f"/api/shopfloor/devices/{device_id}",
            json={"label": "yok"},
            headers=headers,
        )
        assert edited.status_code == 403, edited.text
        revoked = client.post(f"/api/shopfloor/devices/{device_id}/revoke", headers=headers)
        assert revoked.status_code == 403, revoked.text


class _Req:
    def __init__(self, ip):
        self.headers = {}
        self.client = type("C", (), {"host": ip})()


def _call_pair(ip, code):
    try:
        return asyncio.run(sfd.pair_device(_Req(ip), {"code": code}))
    except HTTPException as exc:
        return exc


def test_pairing_code_hash_uses_server_secret(api, monkeypatch):
    _client, db, _clock = api
    created = _issue(api[0])
    code = created.json()["code"]
    stored = db.shopfloor_device_codes.docs[0]["code_hash"]
    assert stored == sfd.hash_pairing_code(code)
    assert stored != hashlib.sha256(code.encode("utf-8")).hexdigest()
    monkeypatch.setattr(sfd, "get_jwt_secret", lambda: "baska-sunucu-sirri")
    assert sfd.hash_pairing_code(code) != stored
    assert code not in json.dumps(db.shopfloor_device_codes.docs)


def test_concurrent_pair_cannot_mint_two_devices(api):
    client, db, _clock = api
    created = _issue(client)
    code = created.json()["code"]

    class _RaceCodes:
        def __init__(self, docs):
            self.docs = docs
            self.reads = 0
            self._go = asyncio.Event()
            self._lock = asyncio.Lock()
            self.atomic_calls = 0

        async def find_one(self, query=None, projection=None):
            if isinstance(query, dict) and "code_hash" in query:
                snap = None
                for doc in self.docs:
                    if match_query(doc, query):
                        snap = copy.deepcopy(doc)
                        break
                self.reads += 1
                if self.reads == 1:
                    await self._go.wait()
                else:
                    self._go.set()
                return snap
            for doc in self.docs:
                if match_query(doc, query or {}):
                    return copy.deepcopy(doc)
            return None

        async def update_one_atomic(self, query, update):
            self.atomic_calls += 1
            async with self._lock:
                for i, doc in enumerate(self.docs):
                    if match_query(doc, query or {}):
                        updated = apply_update(doc, update, query)
                        changed = updated != doc
                        self.docs[i] = updated
                        return type("R", (), {"matched_count": 1, "modified_count": 1 if changed else 0})()
                return type("R", (), {"matched_count": 0, "modified_count": 0})()

        async def update_one(self, query, update, upsert=False):
            idx = None
            snap = None
            for i, doc in enumerate(self.docs):
                if match_query(doc, query or {}):
                    idx = i
                    snap = copy.deepcopy(doc)
                    break
            await asyncio.sleep(0)
            if idx is None:
                return type("R", (), {"matched_count": 0, "modified_count": 0})()
            self.docs[idx] = apply_update(snap, update, query)
            return type("R", (), {"matched_count": 1, "modified_count": 1})()

    db.shopfloor_device_codes = _RaceCodes(db.shopfloor_device_codes.docs)

    async def both():
        return await asyncio.gather(
            sfd.pair_device(_Req("198.51.100.21"), {"code": code}),
            sfd.pair_device(_Req("198.51.100.22"), {"code": code}),
            return_exceptions=True,
        )

    results = asyncio.run(both())
    ok = [row for row in results if isinstance(row, dict) and row.get("token")]
    denied = [row for row in results if isinstance(row, HTTPException)]
    assert len(ok) == 1
    assert len(denied) == 1 and denied[0].status_code == 400
    assert len(db.shopfloor_devices.docs) == 1
    assert db.shopfloor_devices.docs[0]["_id"] == db.shopfloor_device_codes.docs[0]["_id"]
    assert db.shopfloor_device_codes.atomic_calls == 2
    assert code not in _dump(db)
    assert ok[0]["token"] not in _dump(db)


def test_pair_ip_global_and_failure_limits(api, monkeypatch):
    client, db, clock = api
    monkeypatch.setattr(sfd, "PAIR_IP_MAX", 3)
    monkeypatch.setattr(sfd, "PAIR_GLOBAL_MAX", 100)
    monkeypatch.setattr(sfd, "PAIR_FAIL_MAX", 100)
    bad = "AAAAAA"
    for _ in range(3):
        res = _call_pair("198.51.100.8", bad)
        assert isinstance(res, HTTPException) and res.status_code == 400
    blocked = _call_pair("198.51.100.8", bad)
    assert isinstance(blocked, HTTPException) and blocked.status_code == 429
    assert bad not in str(blocked.detail)
    other = _call_pair("198.51.100.9", bad)
    assert isinstance(other, HTTPException) and other.status_code == 400
    assert bad not in _dump(db)
    assert bad not in json.dumps(db.login_attempts.docs, default=str)

    monkeypatch.setattr(sfd, "PAIR_IP_MAX", 100)
    monkeypatch.setattr(sfd, "PAIR_GLOBAL_MAX", 2)
    monkeypatch.setattr(sfd, "PAIR_FAIL_MAX", 100)
    clock["now"] = T0 + timedelta(minutes=11)
    first = _call_pair("203.0.113.1", bad)
    second = _call_pair("203.0.113.2", bad)
    assert first.status_code == 400 and second.status_code == 400
    global_block = _call_pair("203.0.113.3", bad)
    assert global_block.status_code == 429

    monkeypatch.setattr(sfd, "PAIR_IP_MAX", 100)
    monkeypatch.setattr(sfd, "PAIR_GLOBAL_MAX", 100)
    monkeypatch.setattr(sfd, "PAIR_FAIL_MAX", 2)
    clock["now"] = T0 + timedelta(minutes=22)
    fail_ip = "203.0.113.40"
    assert _call_pair(fail_ip, bad).status_code == 400
    assert _call_pair(fail_ip, bad).status_code == 400
    assert _call_pair(fail_ip, bad).status_code == 429
    fail_row = next(row for row in db.login_attempts.docs if row.get("identifier") == f"shopfloor_pair:fail:{fail_ip}")
    assert int(fail_row["fails"]) == 2
    clock["now"] = T0 + timedelta(minutes=33)
    assert _call_pair(fail_ip, bad).status_code == 400


def test_device_role_and_auth_me_are_not_admin(api):
    client, _db, _clock = api
    paired = _pair(client, _issue(client).json()["code"])
    token = paired.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}
    principal = asyncio.run(sfd.principal_from_token(token, server.db))
    assert principal["role"] == "atolye_device"
    role = asyncio.run(rbac.role_for(principal))
    assert role["code"] == "atolye_device"
    assert role["permissions"]["/atolye"] == "edit"
    assert role["permissions"]["/settings"] == "none"
    assert role["permissions"]["/invoices"] == "none"
    feats = rbac.role_features(role)
    assert feats["portal_atolye"] is True
    assert feats["account_companies"] is False
    assert feats["view_prices"] is False
    assert set(feats.values()) <= {False, True}
    assert sum(1 for value in feats.values() if value) == 1

    stations = client.get("/api/production/work-orders/stations", params={"company_id": COMP_A}, headers=headers)
    assert stations.status_code == 200, stations.text
    me = client.get("/api/auth/me", headers=headers)
    assert me.status_code == 200, me.text
    body = me.json()["user"]
    assert body["role"] == "atolye_device"
    assert body["is_super_admin"] is False
    assert body["permissions"]["/atolye"] == "edit"
    assert body["permissions"]["/settings"] == "none"
    assert set(body["permissions"].values()) <= {"none", "edit"}
    assert body["features"]["portal_atolye"] is True
    assert body["features"]["account_companies"] is False
    assert body["features"]["view_prices"] is False
    logout = client.post("/api/auth/logout", headers=headers)
    assert logout.status_code == 200, logout.text
    password = client.post(
        "/api/auth/change-password",
        json={"current_password": "eski", "new_password": "yeni-sifre"},
        headers=headers,
    )
    assert password.status_code == 403, password.text
    device = {"account_type": "atolye_device"}
    assert sfa.atolye_path_allowed("GET", "/api/auth/me", device) is True
    assert sfa.atolye_path_allowed("POST", "/api/auth/logout", device) is True
    assert sfa.atolye_path_allowed("PUT", "/api/auth/me") is True
    assert sfa.atolye_path_allowed("POST", "/api/auth/switch-company", device) is False
    assert sfa.atolye_path_allowed("PUT", "/api/auth/me", device) is False
    assert sfa.atolye_path_allowed("POST", "/api/auth/change-password", device) is False


def test_switch_company_rejects_device_blank_email(api):
    client, db, _clock = api
    db.users.docs.append({
        "_id": "blank-email",
        "email": "",
        "name": "Boş",
        "role": "admin",
        "active_company_id": "elsewhere",
        "company_ids": [COMP_A, "elsewhere"],
        "is_active": True,
    })
    paired = _pair(client, _issue(client).json()["code"])
    headers = {"Authorization": f"Bearer {paired.json()['token']}"}
    res = client.post("/api/auth/switch-company", json={"company_id": COMP_A}, headers=headers)
    assert res.status_code == 403, res.text
    blank = next(row for row in db.users.docs if row["_id"] == "blank-email")
    assert blank["active_company_id"] == "elsewhere"
    user = {
        "_id": paired.json()["device_id"],
        "account_type": "atolye_device",
        "email": "",
        "role": "atolye_device",
        "company_ids": [COMP_A],
        "active_company_id": COMP_A,
    }
    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.switch_company({"company_id": COMP_A}, user))
    assert exc.value.status_code == 403
    blank = next(row for row in db.users.docs if row["_id"] == "blank-email")
    assert blank["active_company_id"] == "elsewhere"
