"""Atölye operatör PIN'i ve sunucu imzalı operatör token'ı. Canlı veritabanı yok."""
from __future__ import annotations

import copy
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import jwt
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
from auth_utils import JWT_ALGORITHM  # noqa: E402
from mysql_store import apply_update, match_query, new_upsert_doc, sort_docs  # noqa: E402

COMP_A = "co_a"
COMP_B = "co_b"
PIN = "5829"
OTHER_PIN = "2468"
LOGIN_PIN = "7391"
PLAIN_PIN = "4816"
SECRET = "test-shopfloor-pin-jwt-secret-not-default"
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
        if not upsert:
            return type("R", (), {"matched_count": 0, "modified_count": 0})()
        created = new_upsert_doc(update, query)
        self.docs.append(created)
        return type("R", (), {"matched_count": 0, "modified_count": 0, "upserted_id": created.get("_id")})()

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


def _user(uid, company, *, role="admin", name=None, employee_id=None, account_type=None, stations=None, companies=None):
    ids = list(companies) if companies is not None else [company]
    doc = {
        "_id": uid,
        "id": uid,
        "email": f"{uid}@example.com",
        "name": name or uid,
        "role": role,
        "is_active": True,
        "is_super_admin": False,
        "company_ids": ids,
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


def _emp(eid, company, name, *, pin_hash=None, pin_ver=0, skip=False, status="active", station="CNC", user_id=None, plain=None):
    doc = {
        "_id": eid,
        "company_id": company,
        "full_name": name,
        "status": status,
        "station": station,
        "shopfloor_pin_ver": pin_ver,
    }
    if pin_hash:
        doc["shopfloor_pin_hash"] = pin_hash
    if skip:
        doc["skip_check_in"] = True
    if user_id:
        doc["user_id"] = user_id
    if plain:
        doc["shopfloor_pin"] = plain
    return doc


def _wo(wid, status, company=COMP_A, station="CNC", operator="", step=1):
    return {
        "_id": wid,
        "company_id": company,
        "order_id": "po-1" if company == COMP_A else "po-b",
        "station": station,
        "status": status,
        "step_name": "Kesim",
        "step_no": step,
        "order_code": "UE-1",
        "planned_quantity": 1,
        "planned_date": DAY,
        "operator_name": operator,
    }


def _schedule():
    return {
        "start": "00:00",
        "end": "23:59",
        "break_minutes": 0,
        "work_days": [0, 1, 2, 3, 4, 5, 6],
        "exit_tolerance_minutes": 0,
        "timezone": "Europe/Istanbul",
    }


def _seed(db, pin_hash):
    sched = _schedule()
    today = attendance._today(sched)
    db.companies.docs.append({"_id": COMP_A, "name": "Firma A", "work_parks": [{"name": "CNC"}], "work_schedule": sched})
    db.companies.docs.append({"_id": COMP_B, "name": "Firma B", "work_parks": [{"name": "CNC"}], "work_schedule": sched})
    db.users.docs.extend([
        _user("admin-a", COMP_A, name="Admin A"),
        _user("sales-a", COMP_A, role="sales", name="Satis A"),
        _user("manager-a", COMP_A, role="manager", name="Mudur A"),
        _user("yonetici-a", COMP_A, role="yönetici", name="Yonetici A"),
        _user("owner-a", COMP_A, role="owner", name="Owner A", employee_id="emp-owner"),
        _user("plain-a", COMP_A, name="Normal A"),
        _user("linked-a", COMP_A, name="Bagli Kullanici", employee_id="emp-linked"),
        _user("floor-a", COMP_A, name="Atolye A", account_type="atolye", stations=["CNC"]),
        _user("floor-both", COMP_A, name="Atolye Iki", account_type="atolye", stations=["CNC"], companies=[COMP_A, COMP_B]),
        _user("admin-b", COMP_B, name="Admin B"),
    ])
    linked = next(u for u in db.users.docs if u["_id"] == "linked-a")
    linked["password_hash"] = auth_utils.hash_password(LOGIN_PIN)
    db.employees.docs.extend([
        _emp("emp-pin", COMP_A, "Usta Pin", pin_hash=pin_hash, pin_ver=1, skip=True),
        _emp("emp-open", COMP_A, "Usta Acik", pin_hash=pin_hash, pin_ver=1, skip=True),
        _emp("emp-nopin", COMP_A, "Pinsiz", skip=True),
        _emp("emp-nocheck", COMP_A, "Giris Yok", pin_hash=pin_hash, pin_ver=1),
        _emp("emp-check", COMP_A, "Giris Var", pin_hash=pin_hash, pin_ver=1),
        _emp("emp-owner", COMP_A, "Sahip Kart", pin_hash=pin_hash, pin_ver=1, user_id="owner-a"),
        _emp("emp-linked", COMP_A, "Kart Adi", pin_hash=pin_hash, pin_ver=1, skip=True, user_id="linked-a"),
        _emp("emp-inactive", COMP_A, "Pasif", pin_hash=pin_hash, pin_ver=1, skip=True, status="passive"),
        _emp("emp-plain", COMP_A, "Duz PIN", plain=PLAIN_PIN, skip=True),
        _emp("emp-b", COMP_B, "B Personel", pin_hash=pin_hash, pin_ver=1, skip=True),
    ])
    for i in range(1, 7):
        db.employees.docs.append(_emp(f"emp-r{i}", COMP_A, f"Hiz {i}", pin_hash=pin_hash, pin_ver=1, skip=True))
    db.attendance.docs.append({
        "_id": "att-check",
        "company_id": COMP_A,
        "employee_id": "emp-check",
        "date": today,
        "check_in": "09:00",
    })
    db.production_orders.docs.extend([
        {"_id": "po-1", "company_id": COMP_A, "status": "planned", "order_code": "UE-1"},
        {"_id": "po-b", "company_id": COMP_B, "status": "planned", "order_code": "UE-B"},
    ])
    db.work_orders.docs.extend([
        _wo("wo-ready", "ready", step=1),
        _wo("wo-run", "in_progress", operator="Eski", step=2),
        _wo("wo-fin", "in_progress", operator="Eski", step=3),
        _wo("wo-trash", "ready", step=4),
        _wo("wo-assign", "ready", step=5),
        _wo("wo-b", "ready", company=COMP_B, step=1),
        _wo("wo-linked", "ready", step=6),
    ])


@pytest.fixture
def pin_hash():
    return auth_utils.hash_password(PIN)


@pytest.fixture
def api(monkeypatch, pin_hash):
    monkeypatch.setenv("LOG_DB_PERSIST", "0")
    monkeypatch.setenv("JWT_SECRET", SECRET)
    monkeypatch.setenv("TAMKOBI_BACKGROUND_JOBS", "0")
    db = MemDB()
    _seed(db, pin_hash)
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


def _op_token(*, name="Token Adi", company=COMP_A, aid="floor-a", oid="emp-pin", otype="employee", pin_ver=1, exp=None, typ=None, aud=None, secret=None):
    now = datetime.now(timezone.utc)
    payload = {
        "typ": typ or shopfloor_pin.TYP,
        "aud": aud or shopfloor_pin.AUD,
        "cid": company,
        "aid": aid,
        "oid": oid,
        "otype": otype,
        "oname": name,
        "pver": pin_ver,
        "iat": int(now.timestamp()),
        "exp": exp or (now + timedelta(hours=2)),
    }
    return jwt.encode(payload, secret or auth_utils.get_jwt_secret(), algorithm=JWT_ALGORITHM)


def _floor(name="Token Adi", **kwargs):
    headers = _auth("floor-a")
    headers["X-Shopfloor-Operator"] = _op_token(name=name, **kwargs)
    return headers


def _emp_doc(db, eid):
    return next(d for d in db.employees.docs if d["_id"] == eid)


def _user_doc(db, uid):
    return next(d for d in db.users.docs if d["_id"] == uid)


def _wo_doc(db, wid):
    return next(d for d in db.work_orders.docs if d["_id"] == wid)


def _audit_clean(db, *secrets):
    forbidden = ("pin", "token", "hash", "password")
    for row in db.shopfloor_pin_audit.docs:
        for key in row:
            low = str(key).lower()
            assert not any(word in low for word in forbidden), key
        blob = str(row)
        for secret in secrets:
            if secret:
                assert secret not in blob


def _log_clean(caplog, *secrets):
    chunks = [caplog.text]
    for rec in caplog.records:
        chunks.append(rec.getMessage())
        chunks.append(str(getattr(rec, "event_data", "")))
        chunks.append(str(rec.__dict__))
    blob = "\n".join(chunks)
    for secret in secrets:
        if secret:
            assert secret not in blob


@pytest.mark.parametrize("value", ["123", "12345", "12a4", " 1234", "1234 ", "", None, "12 4"])
def test_validate_pin_rejects(value):
    assert shopfloor_pin.validate_pin(value) is False
    assert shopfloor_pin.validate_pin(value, reject_trivial=True) is False


def test_validate_pin_accepts_and_trivial_list():
    assert shopfloor_pin.validate_pin("5829") is True
    assert shopfloor_pin.validate_pin("5829", reject_trivial=True) is True
    for trivial in ("0000", "1111", "9999", "1234", "4321", "0123", "3210"):
        assert shopfloor_pin.validate_pin(trivial) is True
        assert shopfloor_pin.validate_pin(trivial, reject_trivial=True) is False


def test_lock_and_account_window_helpers():
    start = datetime(2026, 10, 20, 8, 0, tzinfo=timezone.utc)
    state = None
    for _ in range(4):
        state = shopfloor_pin.register_failure(state, start)
        assert shopfloor_pin.is_locked(state, start) is None
    assert state["fails"] == 4
    state = shopfloor_pin.register_failure(state, start)
    until = shopfloor_pin.is_locked(state, start)
    assert until is not None
    assert shopfloor_pin.is_locked(state, start + timedelta(minutes=15)) is None
    assert shopfloor_pin.register_failure(state, start + timedelta(minutes=15))["fails"] == 1
    assert shopfloor_pin.reset_failures()["fails"] == 0
    acct = None
    now = start
    for _ in range(20):
        assert shopfloor_pin.account_blocked(acct, now) is False
        acct = shopfloor_pin.register_account_attempt(acct, now)
    assert shopfloor_pin.account_blocked(acct, now) is True
    assert shopfloor_pin.account_blocked(acct, now + timedelta(minutes=11)) is False


def test_operator_session_expiry_uses_shift_end_or_fallback():
    morning = datetime(2026, 10, 20, 7, 0, tzinfo=timezone.utc)  # 10:00 Istanbul
    schedule = {"timezone": "Europe/Istanbul", "start": "08:00", "end": "18:00", "work_days": [0, 1, 2, 3, 4, 5, 6]}
    end = shopfloor_pin.operator_session_expiry(schedule, morning)
    assert end == datetime(2026, 10, 20, 15, 0, tzinfo=timezone.utc)
    late = datetime(2026, 10, 20, 17, 0, tzinfo=timezone.utc)  # 20:00 Istanbul, mesai bitmiş
    assert shopfloor_pin.operator_session_expiry(schedule, late) == late + timedelta(hours=8)
    assert shopfloor_pin.operator_session_expiry({}, morning) == morning + timedelta(hours=8)
    assert shopfloor_pin.operator_session_expiry(None, morning) == morning + timedelta(hours=8)


def test_decode_rejects_bad_tokens(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", SECRET)
    now = datetime.now(timezone.utc)
    good = _op_token(exp=now + timedelta(hours=1))
    payload = shopfloor_pin.decode_operator_token(good, company_id=COMP_A, atolye_user_id="floor-a", now=now)
    assert payload["oname"] == "Token Adi"
    with pytest.raises(shopfloor_pin.PinResult) as expired:
        shopfloor_pin.decode_operator_token(good, company_id=COMP_A, atolye_user_id="floor-a", now=now + timedelta(hours=3))
    assert expired.value.status_code == 401
    assert expired.value.detail == shopfloor_pin.TOKEN_DETAIL
    past = _op_token(exp=now - timedelta(minutes=1))
    with pytest.raises(shopfloor_pin.PinResult) as past_exc:
        shopfloor_pin.decode_operator_token(past, company_id=COMP_A, atolye_user_id="floor-a", now=now)
    assert past_exc.value.status_code == 401
    broken = good[:-4] + "xxxx"
    with pytest.raises(shopfloor_pin.PinResult):
        shopfloor_pin.decode_operator_token(broken, company_id=COMP_A, atolye_user_id="floor-a", now=now)
    wrong_typ = _op_token(typ="access")
    with pytest.raises(shopfloor_pin.PinResult) as typ_exc:
        shopfloor_pin.decode_operator_token(wrong_typ, company_id=COMP_A, atolye_user_id="floor-a", now=now)
    assert typ_exc.value.status_code == 401
    wrong_aud = _op_token(aud="tamkobi-web")
    with pytest.raises(shopfloor_pin.PinResult):
        shopfloor_pin.decode_operator_token(wrong_aud, company_id=COMP_A, atolye_user_id="floor-a", now=now)
    access = auth_utils.create_access_token("floor-a", "floor-a@example.com", "admin")
    with pytest.raises(shopfloor_pin.PinResult):
        shopfloor_pin.decode_operator_token(access, company_id=COMP_A, atolye_user_id="floor-a", now=now)
    with pytest.raises(shopfloor_pin.PinResult) as other_co:
        shopfloor_pin.decode_operator_token(good, company_id=COMP_B, atolye_user_id="floor-a", now=now)
    assert other_co.value.status_code == 403
    with pytest.raises(shopfloor_pin.PinResult) as other_aid:
        shopfloor_pin.decode_operator_token(good, company_id=COMP_A, atolye_user_id="floor-b", now=now)
    assert other_aid.value.status_code == 403
    assert PIN not in str(expired.value)


def test_set_stores_only_bcrypt_and_password_does_not_unlock(api, caplog):
    client, db = api
    caplog.set_level(logging.INFO, logger="tamkobi.app")
    res = client.post(
        "/api/personnel/employees/emp-nopin/shopfloor-pin",
        json={"password": OTHER_PIN},
        headers=_auth("admin-a"),
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["has_shopfloor_pin"] is True
    assert "shopfloor_pin_hash" not in body
    assert OTHER_PIN not in res.text
    stored = _emp_doc(db, "emp-nopin")
    assert str(stored["shopfloor_pin_hash"]).startswith("$2")
    assert stored.get("shopfloor_pin_v") == 2
    assert int(stored["shopfloor_pin_ver"]) == 1
    assert "shopfloor_pin" not in stored
    assert OTHER_PIN not in str(stored)
    trivial = client.post(
        "/api/personnel/employees/emp-nopin/shopfloor-pin",
        json={"pin": "1234"},
        headers=_auth("admin-a"),
    )
    assert trivial.status_code == 400, trivial.text
    assert trivial.json()["detail"] == shopfloor_pin.PIN_TRIVIAL
    assert _emp_doc(db, "emp-nopin")["shopfloor_pin_hash"] == stored["shopfloor_pin_hash"]
    unlock = client.post(
        "/api/production/work-orders/shopfloor-unlock",
        json={"company_id": COMP_A, "employee_id": "emp-linked", "password": LOGIN_PIN},
        headers=_auth("admin-a"),
    )
    assert unlock.status_code == 401, unlock.text
    assert isinstance(unlock.json()["detail"], str)
    assert "shopfloor_pin_hash" not in unlock.text
    real = client.post(
        "/api/production/work-orders/shopfloor-unlock",
        json={"company_id": COMP_A, "employee_id": "emp-linked", "password": PIN},
        headers=_auth("linked-a"),
    )
    assert real.status_code == 200, real.text
    payload = real.json()
    assert payload["status"] == "success"
    assert payload["employee_id"] == "emp-linked"
    assert payload["operator_name"] == "Kart Adi"
    assert payload["operator_type"] == "employee"
    assert payload["operator_id"] == "emp-linked"
    assert payload["operator_token"]
    assert payload["expires_at"]
    assert "shopfloor_pin_hash" not in payload
    assert PIN not in real.text
    _audit_clean(db, PIN, OTHER_PIN, LOGIN_PIN, payload["operator_token"], stored["shopfloor_pin_hash"])
    _log_clean(caplog, PIN, OTHER_PIN, LOGIN_PIN, payload["operator_token"], stored["shopfloor_pin_hash"])


def test_password_hash_is_never_the_compare_target(api, monkeypatch):
    client, db = api
    pin_hash = _emp_doc(db, "emp-linked")["shopfloor_pin_hash"]
    login_hash = _user_doc(db, "linked-a")["password_hash"]
    seen = []

    def _spy(plain, hashed):
        seen.append(str(hashed))
        return False

    monkeypatch.setattr(shopfloor_pin, "verify_password", _spy)
    res = client.post(
        "/api/production/work-orders/shopfloor-unlock",
        json={"company_id": COMP_A, "employee_id": "emp-linked", "password": LOGIN_PIN},
        headers=_auth("admin-a"),
    )
    assert res.status_code == 401, res.text
    assert seen == [pin_hash]
    assert login_hash not in seen


def test_lockout_then_timeout_then_reset(api, monkeypatch, caplog):
    client, db = api
    caplog.set_level(logging.INFO, logger="tamkobi.app")
    clock = {"now": datetime(2026, 10, 20, 8, 0, tzinfo=timezone.utc)}
    monkeypatch.setattr(shopfloor_pin, "utcnow", lambda: clock["now"])

    def _verify(plain, hashed):
        return plain == PIN

    monkeypatch.setattr(shopfloor_pin, "verify_password", _verify)
    headers = _auth("floor-a")
    for remaining in (4, 3, 2, 1):
        res = client.post(
            "/api/production/work-orders/shopfloor-unlock",
            json={"company_id": COMP_A, "employee_id": "emp-open", "pin": "0000"},
            headers=headers,
        )
        assert res.status_code == 401, res.text
        body = res.json()
        assert isinstance(body["detail"], str)
        assert body["remaining_attempts"] == remaining
        assert str(remaining) in body["detail"]
    locked = client.post(
        "/api/production/work-orders/shopfloor-unlock",
        json={"company_id": COMP_A, "employee_id": "emp-open", "pin": "0000"},
        headers=headers,
    )
    assert locked.status_code == 423, locked.text
    assert locked.json()["remaining_attempts"] == 0
    assert "15 dk" in locked.json()["detail"]
    still = client.post(
        "/api/production/work-orders/shopfloor-unlock",
        json={"company_id": COMP_A, "employee_id": "emp-open", "pin": PIN},
        headers=headers,
    )
    assert still.status_code == 423, still.text
    clock["now"] = clock["now"] + timedelta(minutes=15)
    opened = client.post(
        "/api/production/work-orders/shopfloor-unlock",
        json={"company_id": COMP_A, "employee_id": "emp-open", "password": PIN},
        headers=headers,
    )
    assert opened.status_code == 200, opened.text
    state = next(d for d in db.shopfloor_pin_attempts.docs if d["subject"] == "emp:emp-open")
    assert state["fails"] == 0
    assert state["company_id"] == COMP_A
    short = client.post(
        "/api/production/work-orders/shopfloor-unlock",
        json={"company_id": COMP_A, "employee_id": "emp-open", "pin": "12"},
        headers=headers,
    )
    assert short.status_code == 400
    assert "yöneticinizden yeni PIN isteyin" in short.json()["detail"]
    assert next(d for d in db.shopfloor_pin_attempts.docs if d["subject"] == "emp:emp-open")["fails"] == 0
    _audit_clean(db, PIN, "0000", opened.json()["operator_token"])
    _log_clean(caplog, PIN, "0000", opened.json()["operator_token"])
    actions = {row["action"] for row in db.shopfloor_pin_audit.docs}
    assert {"unlock_fail", "locked", "unlock_ok"} <= actions


def test_atolye_account_rate_limit_across_operators(api, monkeypatch):
    client, db = api
    monkeypatch.setattr(shopfloor_pin, "verify_password", lambda plain, hashed: False)
    headers = _auth("floor-a")
    for i in range(20):
        emp = f"emp-r{(i % 5) + 1}"
        res = client.post(
            "/api/production/work-orders/shopfloor-unlock",
            json={"company_id": COMP_A, "employee_id": emp, "pin": "0000"},
            headers=headers,
        )
        assert res.status_code == 401, (i, res.text)
    blocked = client.post(
        "/api/production/work-orders/shopfloor-unlock",
        json={"company_id": COMP_A, "employee_id": "emp-r1", "pin": PIN},
        headers=headers,
    )
    assert blocked.status_code == 429, blocked.text
    assert blocked.json()["detail"] == shopfloor_pin.RATE_DETAIL
    acct = next(d for d in db.shopfloor_pin_attempts.docs if d["subject"] == "acct:floor-a")
    assert acct["company_id"] == COMP_A
    assert acct["fails"] == 20
    missing = client.post(
        "/api/production/work-orders/shopfloor-unlock",
        json={"company_id": COMP_A, "employee_id": "emp-yok", "pin": "0000"},
        headers=_auth("admin-a"),
    )
    assert missing.status_code == 404
    assert missing.json()["detail"] == "Çalışan bulunamadı."


def test_undefined_pin_does_not_count_operator_failures(api, monkeypatch):
    client, db = api
    seen = []
    monkeypatch.setattr(shopfloor_pin, "verify_password", lambda plain, hashed: seen.append(hashed) or False)
    res = client.post(
        "/api/production/work-orders/shopfloor-unlock",
        json={"company_id": COMP_A, "employee_id": "emp-nopin", "pin": "0000"},
        headers=_auth("floor-a"),
    )
    assert res.status_code == 400, res.text
    assert res.json()["detail"] == shopfloor_pin.PIN_UNDEFINED
    assert seen and str(seen[0]).startswith("$2")
    assert not any(d["subject"] == "emp:emp-nopin" for d in db.shopfloor_pin_attempts.docs)
    acct = next(d for d in db.shopfloor_pin_attempts.docs if d["subject"] == "acct:floor-a")
    assert acct["fails"] == 1


def test_token_drives_actions_and_rejects_bad_sessions(api, caplog):
    client, db = api
    caplog.set_level(logging.INFO, logger="tamkobi.app")
    token = _op_token(name="Token Adi")
    headers = _auth("floor-a")
    headers["X-Shopfloor-Operator"] = token
    body = {"operator_name": "Başkası", "operator_token": "ignore-me", "produced_qty": 1}
    started = client.post("/api/production/work-orders/wo-ready/start", json=body, headers=headers)
    assert started.status_code == 200, started.text
    assert _wo_doc(db, "wo-ready")["operator_name"] == "Token Adi"
    assert _wo_doc(db, "wo-ready")["logs"][-1]["by"] == "Token Adi"
    paused = client.post("/api/production/work-orders/wo-run/pause", json=body, headers=headers)
    assert paused.status_code == 200, paused.text
    assert _wo_doc(db, "wo-run")["logs"][-1]["by"] == "Token Adi"
    finished = client.post("/api/production/work-orders/wo-fin/finish", json=body, headers=headers)
    assert finished.status_code == 200, finished.text
    assert _wo_doc(db, "wo-fin")["operator_name"] == "Token Adi"
    assert _wo_doc(db, "wo-fin")["logs"][-1]["by"] == "Token Adi"
    trashed = client.post("/api/production/work-orders/wo-trash/trash-request", json={"operator_name": "Başkası"}, headers=headers)
    assert trashed.status_code == 200, trashed.text
    assert db.work_order_trash_requests.docs[-1]["requested_by"] == "Token Adi"
    assigned = client.put(
        "/api/production/work-orders/wo-assign/assign",
        json={"assigned_to": "emp-x", "assigned_name": "Hedef Kisi", "operator_name": "Başkası"},
        headers=headers,
    )
    assert assigned.status_code == 200, assigned.text
    assert _wo_doc(db, "wo-assign")["assigned_name"] == "Hedef Kisi"
    assert _wo_doc(db, "wo-assign")["logs"][-1]["by"] == "Token Adi"
    policy = client.get(
        "/api/production/work-orders/pause-policy",
        params={"company_id": COMP_A, "operator_name": "Başkası"},
        headers=headers,
    )
    assert policy.status_code == 200, policy.text
    assert policy.json()["operator_name"] == "Token Adi"
    no_token = client.post(
        "/api/production/work-orders/wo-linked/start",
        json={"operator_name": "Başkası"},
        headers=_auth("floor-a"),
    )
    assert no_token.status_code == 401
    assert no_token.json()["detail"] == shopfloor_pin.TOKEN_DETAIL
    for bad in (
        _op_token(exp=datetime.now(timezone.utc) - timedelta(minutes=5)),
        _op_token()[:-4] + "xxxx",
        _op_token(typ="access"),
        _op_token(aud="other-aud"),
        auth_utils.create_access_token("floor-a", "floor-a@example.com", "admin"),
        _op_token(aid="floor-both"),
    ):
        denied = client.post(
            "/api/production/work-orders/wo-linked/start",
            json={"operator_token": bad, "operator_name": "Başkası"},
            headers=_auth("floor-a"),
        )
        assert denied.status_code in (401, 403), denied.text
        assert denied.json()["detail"] == shopfloor_pin.TOKEN_DETAIL
        assert bad not in denied.text
    body_ok = client.post(
        "/api/production/work-orders/wo-linked/start",
        json={"operator_token": token, "operator_name": "Başkası"},
        headers=_auth("floor-a"),
    )
    assert body_ok.status_code == 200, body_ok.text
    assert _wo_doc(db, "wo-linked")["operator_name"] == "Token Adi"
    session = client.post(
        "/api/production/work-orders/wo-assign/pause",
        json={},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert session.status_code == 401
    cleared = client.delete("/api/personnel/employees/emp-pin/shopfloor-pin", headers=_auth("admin-a"))
    assert cleared.status_code == 200, cleared.text
    assert _emp_doc(db, "emp-pin").get("shopfloor_pin_hash") in (None, "")
    assert int(_emp_doc(db, "emp-pin")["shopfloor_pin_ver"]) == 2
    stale = client.post(
        "/api/production/work-orders/wo-ready/pause",
        json={"operator_token": token},
        headers=_auth("floor-a"),
    )
    assert stale.status_code == 401, stale.text
    cross = client.post(
        "/api/production/work-orders/wo-b/start",
        json={"operator_token": _op_token(company=COMP_A, aid="floor-both")},
        headers=_auth("floor-both"),
    )
    assert cross.status_code == 403, cross.text
    _audit_clean(db, PIN, token)
    _log_clean(caplog, PIN, token)
    assert any(row["action"] == "wo_action" and row.get("wo_id") == "wo-ready" for row in db.shopfloor_pin_audit.docs)
    assert any(row["action"] == "pin_cleared" for row in db.shopfloor_pin_audit.docs)


def test_tenant_isolation(api):
    client, db = api
    unlock = client.post(
        "/api/production/work-orders/shopfloor-unlock",
        json={"company_id": COMP_A, "employee_id": "emp-b", "pin": PIN},
        headers=_auth("admin-a"),
    )
    assert unlock.status_code == 404, unlock.text
    before = _emp_doc(db, "emp-b")["shopfloor_pin_hash"]
    pin = client.post(
        "/api/personnel/employees/emp-b/shopfloor-pin",
        json={"pin": OTHER_PIN},
        headers=_auth("admin-a"),
    )
    assert pin.status_code == 404, pin.text
    assert pin.json()["detail"] == "Çalışan bulunamadı."
    assert _emp_doc(db, "emp-b")["shopfloor_pin_hash"] == before
    ver_before = int(_emp_doc(db, "emp-b")["shopfloor_pin_ver"])
    deleted = client.delete(
        "/api/personnel/employees/emp-b/shopfloor-pin",
        headers=_auth("admin-a"),
    )
    assert deleted.status_code == 404, deleted.text
    assert deleted.json()["detail"] == "Çalışan bulunamadı."
    assert _emp_doc(db, "emp-b")["shopfloor_pin_hash"] == before
    assert int(_emp_doc(db, "emp-b")["shopfloor_pin_ver"]) == ver_before
    other = client.post(
        "/api/production/work-orders/wo-b/start",
        json={"operator_token": _op_token()},
        headers=_auth("floor-a"),
    )
    assert other.status_code == 404, other.text


def test_normal_user_is_always_self(api):
    client, db = api
    headers = _auth("plain-a")
    started = client.post(
        "/api/production/work-orders/wo-ready/start",
        json={"operator_name": "Başkası"},
        headers=headers,
    )
    assert started.status_code == 200, started.text
    assert _wo_doc(db, "wo-ready")["operator_name"] == "Normal A"
    assert _wo_doc(db, "wo-ready")["logs"][-1]["by"] == "Normal A"
    paused = client.post(
        "/api/production/work-orders/wo-run/pause",
        json={"operator_name": "Başkası"},
        headers=headers,
    )
    assert paused.status_code == 200, paused.text
    assert _wo_doc(db, "wo-run")["logs"][-1]["by"] == "Normal A"
    finished = client.post(
        "/api/production/work-orders/wo-fin/finish",
        json={"operator_name": "Başkası", "produced_qty": 1},
        headers=headers,
    )
    assert finished.status_code == 200, finished.text
    assert _wo_doc(db, "wo-fin")["operator_name"] == "Normal A"
    trashed = client.post(
        "/api/production/work-orders/wo-trash/trash-request",
        json={"operator_name": "Başkası"},
        headers=headers,
    )
    assert trashed.status_code == 200, trashed.text
    assert db.work_order_trash_requests.docs[-1]["requested_by"] == "Normal A"
    assigned = client.put(
        "/api/production/work-orders/wo-assign/assign",
        json={"assigned_name": "Hedef Kisi", "operator_name": "Başkası"},
        headers=headers,
    )
    assert assigned.status_code == 200, assigned.text
    assert _wo_doc(db, "wo-assign")["assigned_name"] == "Hedef Kisi"
    assert _wo_doc(db, "wo-assign")["logs"][-1]["by"] == "Normal A"
    linked = client.post(
        "/api/production/work-orders/wo-linked/start",
        json={"operator_name": "Başkası"},
        headers=_auth("linked-a"),
    )
    assert linked.status_code == 200, linked.text
    assert _wo_doc(db, "wo-linked")["operator_name"] == "Kart Adi"
    policy = client.get(
        "/api/production/work-orders/pause-policy",
        params={"operator_name": "Başkası"},
        headers=headers,
    )
    assert policy.status_code == 200, policy.text
    assert policy.json()["operator_name"] == "Normal A"


def test_manager_own_pin_and_atolye_forbidden(api):
    client, db = api
    denied_role = client.put(
        "/api/auth/me/shopfloor-pin",
        json={"pin": OTHER_PIN, "pin_confirm": OTHER_PIN},
        headers=_auth("manager-a", "manager"),
    )
    assert denied_role.status_code == 403, denied_role.text
    mismatch = client.put(
        "/api/auth/me/shopfloor-pin",
        json={"pin": OTHER_PIN, "pin_confirm": "9991"},
        headers=_auth("yonetici-a", "yönetici"),
    )
    assert mismatch.status_code == 400
    saved = client.put(
        "/api/auth/me/shopfloor-pin",
        json={"pin": OTHER_PIN, "pin_confirm": OTHER_PIN},
        headers=_auth("yonetici-a", "yönetici"),
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["has_shopfloor_pin"] is True
    assert "shopfloor_pin_hash" not in saved.json()
    manager = _user_doc(db, "yonetici-a")
    assert str(manager["shopfloor_pin_hash"]).startswith("$2")
    assert OTHER_PIN not in str(manager)
    assert "shopfloor_pin" not in manager
    linked = client.put(
        "/api/auth/me/shopfloor-pin",
        json={"pin": "1357"},
        headers=_auth("linked-a"),
    )
    assert linked.status_code == 200, linked.text
    assert "shopfloor_pin_hash" not in _user_doc(db, "linked-a")
    assert str(_emp_doc(db, "emp-linked")["shopfloor_pin_hash"]).startswith("$2")
    atolye = client.put("/api/auth/me/shopfloor-pin", json={"pin": OTHER_PIN}, headers=_auth("floor-a"))
    assert atolye.status_code == 403, atolye.text
    atolye_del = client.delete("/api/auth/me/shopfloor-pin", headers=_auth("floor-a"))
    assert atolye_del.status_code == 403, atolye_del.text
    sales = client.post(
        "/api/personnel/employees/emp-nopin/shopfloor-pin",
        json={"pin": OTHER_PIN},
        headers=_auth("sales-a", "sales"),
    )
    assert sales.status_code == 403, sales.text
    editor = client.post(
        "/api/personnel/employees/emp-nopin/shopfloor-pin",
        json={"pin": "8642"},
        headers=_auth("manager-a", "manager"),
    )
    assert editor.status_code == 200, editor.text
    removed = client.delete("/api/auth/me/shopfloor-pin", headers=_auth("yonetici-a", "yönetici"))
    assert removed.status_code == 200, removed.text
    assert _user_doc(db, "yonetici-a").get("shopfloor_pin_hash") in (None, "")
    assert int(_user_doc(db, "yonetici-a")["shopfloor_pin_ver"]) >= 2
    actions = {row["action"] for row in db.shopfloor_pin_audit.docs}
    assert "pin_set" in actions and "pin_cleared" in actions


def test_operator_list_filters_and_hides_hash(api):
    client, _db = api
    listed = client.get(
        "/api/production/work-orders/shopfloor-operators",
        params={"company_id": COMP_A},
        headers=_auth("floor-a"),
    )
    assert listed.status_code == 200, listed.text
    rows = listed.json()
    ids = {(row["operator_type"], row["id"]) for row in rows}
    assert ("employee", "emp-pin") in ids
    assert ("employee", "emp-check") in ids
    assert ("employee", "emp-owner") in ids
    assert ("employee", "emp-linked") in ids
    assert ("employee", "emp-nopin") not in ids
    assert ("employee", "emp-nocheck") not in ids
    assert ("employee", "emp-inactive") not in ids
    assert ("employee", "emp-b") not in ids
    assert all(row["has_shopfloor_pin"] is True for row in rows)
    assert "$2" not in listed.text
    assert "shopfloor_pin_hash" not in listed.text
    client.put(
        "/api/auth/me/shopfloor-pin",
        json={"pin": OTHER_PIN},
        headers=_auth("yonetici-a", "yönetici"),
    )
    again = client.get("/api/production/work-orders/shopfloor-operators", headers=_auth("admin-a")).json()
    users = [row for row in again if row["operator_type"] == "user"]
    assert any(row["id"] == "yonetici-a" and row["name"] == "Yonetici A" for row in users)
    assert all(row["id"] != "linked-a" for row in users)
    assert all(row["id"] != "floor-a" for row in again)


def test_plaintext_pin_is_hashed_on_read(api):
    client, db = api
    res = client.post(
        "/api/production/work-orders/shopfloor-unlock",
        json={"company_id": COMP_A, "employee_id": "emp-plain", "password": PLAIN_PIN},
        headers=_auth("admin-a"),
    )
    assert res.status_code == 200, res.text
    stored = _emp_doc(db, "emp-plain")
    assert "shopfloor_pin" not in stored
    assert str(stored["shopfloor_pin_hash"]).startswith("$2")
    assert PLAIN_PIN not in str(stored)
    assert PLAIN_PIN not in res.text


def test_me_hides_pin_hash(api):
    client, db = api
    _user_doc(db, "yonetici-a")["shopfloor_pin_hash"] = "$2b$12$placeholderhashvalue000000000000000000000"
    me = client.get("/api/auth/me", headers=_auth("yonetici-a", "yönetici"))
    assert me.status_code == 200, me.text
    user = me.json()["user"]
    assert user["has_shopfloor_pin"] is True
    assert "shopfloor_pin_hash" not in user
    assert "$2" not in me.text
