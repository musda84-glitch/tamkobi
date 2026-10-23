"""Personel GET listelerinde satır kapsamı.

İzin, prim, bordro, puantaj ve vardiya: yalnız kendi satırı.
Çalışan listesi: firma dizini (finansal alan yok); kendi kartı tam kayıt.

FastAPI TestClient ve bellek içi veritabanı. Canlı sunucu, 8021, MySQL yok.
"""
from __future__ import annotations

import asyncio
import copy
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-personnel-self-scope-jwt-secret-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import addons  # noqa: E402
import attendance  # noqa: E402
import auth_utils  # noqa: E402
import mail_accounts  # noqa: E402
import personnel_scope  # noqa: E402
import rbac  # noqa: E402
import saas  # noqa: E402
import server  # noqa: E402
from mysql_store import match_query, new_upsert_doc, sort_docs  # noqa: E402

_CMP_OPS = ("$gt", "$gte", "$lt", "$lte")

CID = "comp_scope"
OTHER = "comp_other"
MONTH = "2026-10"
WEEK = "2026-10-12"


def _and_cmp(query):
    if not isinstance(query, dict):
        return query
    out = {}
    extra = []
    for key, cond in query.items():
        if key in ("$and", "$or", "$nor") and isinstance(cond, list):
            out[key] = [_and_cmp(item) for item in cond]
            continue
        if isinstance(cond, dict) and sum(op in cond for op in _CMP_OPS) > 1:
            for op in _CMP_OPS:
                if op in cond:
                    extra.append({key: {op: cond[op]}})
            rest = {k: v for k, v in cond.items() if k not in _CMP_OPS}
            if rest:
                extra.append({key: rest})
            continue
        out[key] = cond
    if not extra:
        return out
    parts = ([out] if out else []) + extra
    return parts[0] if len(parts) == 1 else {"$and": parts}


def _docs_match(doc, query):
    return match_query(doc, _and_cmp(query or {}))


def _run(coro):
    return asyncio.run(coro)


class MemCursor:
    def __init__(self, docs):
        self._docs = docs
        self._sort = None

    def sort(self, key, direction=1):
        self._sort = [(key, direction)] if isinstance(key, str) else list(key)
        return self

    def limit(self, n):
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

    def find(self, query=None, projection=None):
        return MemCursor([d for d in self.docs if _docs_match(d, query)])

    async def find_one(self, query=None, projection=None):
        for doc in self.docs:
            if _docs_match(doc, query):
                return copy.deepcopy(doc)
        return None

    async def count_documents(self, query=None):
        return sum(1 for doc in self.docs if _docs_match(doc, query))

    async def insert_one(self, doc):
        self.docs.append(copy.deepcopy(doc))
        return SimpleNamespace(inserted_id=doc.get("_id"))

    async def insert_many(self, docs):
        self.docs.extend(copy.deepcopy(list(docs)))
        return SimpleNamespace(inserted_ids=[d.get("_id") for d in docs])

    async def update_one(self, query, update, upsert=False):
        from mysql_store import apply_update

        for i, doc in enumerate(self.docs):
            if _docs_match(doc, query):
                self.docs[i] = apply_update(doc, update, query)
                return SimpleNamespace(modified_count=1, matched_count=1)
        if upsert:
            self.docs.append(new_upsert_doc(update, query))
            return SimpleNamespace(modified_count=0, matched_count=0, upserted_id=self.docs[-1].get("_id"))
        return SimpleNamespace(modified_count=0, matched_count=0)

    async def delete_one(self, query):
        for i, doc in enumerate(self.docs):
            if _docs_match(doc, query):
                self.docs.pop(i)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def delete_many(self, query):
        kept, deleted = [], 0
        for doc in self.docs:
            if _docs_match(doc, query):
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


def _user(uid, role, *, employee_id=None, superadmin=False, companies=None, active=None):
    companies = list(companies if companies is not None else [CID])
    doc = {
        "_id": uid,
        "id": uid,
        "email": f"{uid}@example.com",
        "name": uid,
        "role": role,
        "is_active": True,
        "is_super_admin": superadmin,
        "company_ids": companies,
        "active_company_id": CID if active is None else active,
        "user_number": f"U-{uid}",
    }
    if employee_id:
        doc["employee_id"] = employee_id
        # Bu dosya satır kapsamını ölçer. Mesai kilidi personel kartlı kullanıcıyı
        # girişsizken 403 yapar; kapsam örnekleri puantaj sisteminin dışındadır.
        doc["skip_check_in"] = True
    return doc


_PIN_HASH = "hash-should-not-leak"
_IBAN = "TR330006100519786457841326"
_TCKN = "10000000146"
_DIRECTORY_LEAKS = (
    "salary", "payroll_salary", "second_salary", "daily_wage", "official_salary",
    "iban", "tc_kimlik", "tckn", "phone", "address", "birth_date", "email",
    "shopfloor_pin_hash", "cashier_pin_hash", "punch_pin_hash", "password_hash",
    "balance", "leave_balance", "yevmiye_due", "yevmiye_days", "annual_leave_days",
    "used_leave_days", "meal_allowance", "transport_allowance", "notes",
    "overtime_hourly_rate", "emergency_contact",
)


def _emp(eid, name, company=CID, user_id=None):
    doc = {
        "_id": eid,
        "company_id": company,
        "full_name": name,
        "status": "active",
        "position": "Usta",
        "department": "Uretim",
        "salary": 1000,
        "payroll_salary": 900,
        "second_salary": 100,
        "daily_wage": 400,
        "iban": _IBAN,
        "tc_kimlik": _TCKN,
        "phone": "5551112233",
        "email": "gizli@example.com",
        "address": "Gizli adres",
        "birth_date": "1990-01-01",
        "shopfloor_pin_hash": _PIN_HASH,
        "cashier_pin_hash": "cashier-hash-secret",
        "punch_pin_hash": "punch-hash-secret",
        "password_hash": "password-hash-secret",
        "annual_leave_days": 14,
        "used_leave_days": 0,
    }
    if user_id:
        doc["user_id"] = user_id
    return doc


def _seed(db):
    db.companies.docs.append({
        "_id": CID,
        "name": "Scope A",
        "location": {"label": "Merkez Atolye", "latitude": 41.01, "longitude": 29.01, "radius_m": 200},
    })
    db.companies.docs.append({"_id": OTHER, "name": "Scope B"})
    inactive = _emp("empOff", "Pasif P")
    inactive["status"] = "inactive"
    db.employees.docs.extend([
        _emp("empA", "Ada A", user_id="user-a"),
        _emp("empB", "Bora B", user_id="user-b"),
        inactive,
        _emp("empOther", "Dis Kart", company=OTHER, user_id="user-foreign-card"),
    ])
    db.leave_requests.docs.extend([
        {"_id": "lvA", "company_id": CID, "employee_id": "empA", "employee_name": "Ada A", "type": "annual", "start_date": "2026-11-01", "end_date": "2026-11-02", "days": 2, "status": "pending", "created_at": "2026-10-02T00:00:00+00:00"},
        {"_id": "lvB", "company_id": CID, "employee_id": "empB", "employee_name": "Bora B", "type": "annual", "start_date": "2026-11-03", "end_date": "2026-11-04", "days": 2, "status": "pending", "created_at": "2026-10-03T00:00:00+00:00"},
        {"_id": "lvAok", "company_id": CID, "employee_id": "empA", "employee_name": "Ada A", "type": "annual", "start_date": WEEK, "end_date": WEEK, "days": 1, "status": "approved", "created_at": "2026-10-01T00:00:00+00:00"},
    ])
    db.bonus_payments.docs.extend([
        {"_id": "bonA", "company_id": CID, "employee_id": "empA", "employee_name": "Ada A", "type": "bonus", "period": MONTH, "amount": 100, "status": "pending", "created_at": "2026-10-02T00:00:00+00:00"},
        {"_id": "bonB", "company_id": CID, "employee_id": "empB", "employee_name": "Bora B", "type": "bonus", "period": MONTH, "amount": 200, "status": "pending", "created_at": "2026-10-03T00:00:00+00:00"},
    ])
    db.payrolls.docs.extend([
        {"_id": "payA", "company_id": CID, "employee_id": "empA", "employee_name": "Ada A", "period": MONTH, "status": "pending", "net_salary": 1000, "final_payable": 1000},
        {"_id": "payB", "company_id": CID, "employee_id": "empB", "employee_name": "Bora B", "period": MONTH, "status": "pending", "net_salary": 2000, "final_payable": 2000},
    ])
    db.attendance.docs.extend([
        {"_id": "attA", "company_id": CID, "employee_id": "empA", "employee_name": "Ada A", "date": "2026-10-02", "status": "present", "hours": 8, "overtime_hours": 1, "normal_hours": 8, "late_minutes": 0, "employee_confirmed": True},
        {"_id": "attB", "company_id": CID, "employee_id": "empB", "employee_name": "Bora B", "date": "2026-10-02", "status": "present", "hours": 8, "overtime_hours": 0, "normal_hours": 8, "late_minutes": 0, "employee_confirmed": True},
    ])
    db.shift_plans.docs.extend([
        {"_id": "shA", "company_id": CID, "employee_id": "empA", "employee_name": "Ada A", "date": WEEK, "off": False, "start": "09:00", "end": "18:00", "break_minutes": 60, "note": ""},
        {"_id": "shB", "company_id": CID, "employee_id": "empB", "employee_name": "Bora B", "date": WEEK, "off": False, "start": "08:00", "end": "17:00", "break_minutes": 60, "note": ""},
    ])
    db.shift_templates.docs.extend([
        {"_id": "tpl1", "company_id": CID, "name": "Sabah", "days": {"0": {"start": "08:00", "end": "16:00", "break_minutes": 60}}},
        {"_id": "tpl2", "company_id": CID, "name": "Aksam", "days": {"0": {"start": "16:00", "end": "00:30", "break_minutes": 30}}},
    ])


def _bind(db):
    prev = (
        server.db, attendance._db, attendance._current_user,
        rbac._db, saas._db, addons._db, mail_accounts._db,
    )
    server.db = db
    attendance._db = db
    attendance._current_user = server.get_current_user
    rbac._db = db
    saas._db = db
    addons._db = db
    mail_accounts._db = db
    return prev


def _unbind(prev):
    (
        server.db, attendance._db, attendance._current_user,
        rbac._db, saas._db, addons._db, mail_accounts._db,
    ) = prev


@pytest.fixture
def api():
    db = MemDB()
    db.users.docs.extend([
        _user("user-a", "personel", employee_id="empA"),
        _user("user-b", "personel", employee_id="empB"),
        _user("user-plain", "personel"),
        _user("user-foreign-card", "personel", employee_id="empOther"),
        _user("user-admin", "admin"),
        _user("user-manager", "manager"),
        _user("user-advisor", "advisor"),
        _user("user-accountant", "accountant"),
        _user("user-sales", "sales"),
        _user("user-warehouse", "warehouse"),
        _user("user-production", "production", employee_id="empB"),
        _user("user-sa", "personel", superadmin=True, companies=[], active=""),
    ])
    _seed(db)
    prev = _bind(db)
    saas.invalidate()
    _run(rbac.ensure_roles(CID))
    _run(rbac.ensure_roles(CID))
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
        _unbind(prev)
        router.on_startup[:] = saved_up
        router.on_shutdown[:] = saved_down
        saas.invalidate()


def _auth(uid, *, superadmin=False, role="personel"):
    token = auth_utils.create_access_token(uid, f"{uid}@example.com", role, is_super_admin=superadmin)
    return {"Authorization": f"Bearer {token}"}


def _ids(rows):
    return [row.get("id") or row.get("employee_id") for row in rows]


def _assert_directory_row(row):
    assert set(row) <= set(personnel_scope.DIRECTORY_FIELDS)
    assert row["full_name"]
    assert row["status"] == "active"
    assert row["position"] == "Usta"
    assert row["department"] == "Uretim"
    assert row["has_user"] is True
    assert row["user_id"]
    assert row["has_shopfloor_pin"] is True
    assert row["has_cashier_pin"] is True
    assert row["workplace"] == "Merkez Atolye"
    assert isinstance(row["workplace"], str)
    for key in _DIRECTORY_LEAKS:
        assert key not in row, key
    blob = str(row)
    assert _PIN_HASH not in blob
    assert _IBAN not in blob
    assert _TCKN not in blob
    assert "latitude" not in blob and "longitude" not in blob


def _assert_full_employee(row, *, salary):
    assert "balance" in row and "leave_balance" in row
    assert "annual_leave_days" in row
    assert row["salary"] == salary
    assert row["payroll_salary"] == (900 if salary else 0)
    assert row["second_salary"] == (100 if salary else 0)
    assert row["iban"] == _IBAN
    assert row["tc_kimlik"] == _TCKN
    assert isinstance(row.get("workplace"), dict)
    assert row["workplace"]["label"] == "Merkez Atolye"
    assert row["has_shopfloor_pin"] is True
    assert row["has_user"] is (row["id"] != "empOff")
    assert "shopfloor_pin_hash" not in row
    assert "cashier_pin_hash" not in row
    assert "punch_pin_hash" not in row
    assert "password_hash" not in row
    assert _PIN_HASH not in str(row)


def _enable_atolye(db):
    for doc in db.roles.docs:
        if doc.get("company_id") == CID and doc.get("code") == "personel":
            doc["features"] = {**(doc.get("features") or {}), "portal_atolye": True}


def test_personnel_scope_matrix():
    assert _run(personnel_scope.personnel_scope({"is_super_admin": True, "role": "personel"}, CID)) is None
    assert _run(personnel_scope.personnel_scope({"role": "admin", "is_super_admin": False}, CID)) is None


def test_personel_sees_only_own_rows(api):
    client, _db = api
    headers = _auth("user-a")
    params = {"company_id": CID}

    leaves = client.get("/api/personnel/leaves", params=params, headers=headers)
    assert leaves.status_code == 200, leaves.text
    assert _ids(leaves.json()) == ["lvA", "lvAok"]
    assert "Bora B" not in leaves.text

    bonuses = client.get("/api/personnel/bonuses", params=params, headers=headers)
    assert bonuses.status_code == 200, bonuses.text
    assert _ids(bonuses.json()) == ["bonA"]

    payrolls = client.get("/api/personnel/payrolls", params=params, headers=headers)
    assert payrolls.status_code == 200, payrolls.text
    assert _ids(payrolls.json()) == ["payA"]

    attendance_rows = client.get("/api/personnel/attendance", params={**params, "month": MONTH}, headers=headers)
    assert attendance_rows.status_code == 200, attendance_rows.text
    att = attendance_rows.json()
    assert [row["id"] for row in att["records"]] == ["attA"]
    assert [row["employee_id"] for row in att["summary"]] == ["empA"]
    assert "month" in att and "schedule" in att

    preview = client.get("/api/personnel/overtime-preview", params={**params, "period": MONTH}, headers=headers)
    assert preview.status_code == 200, preview.text
    assert [row["employee_id"] for row in preview.json()["rows"]] == ["empA"]

    shifts = client.get("/api/personnel/shifts", params={**params, "week_start": WEEK}, headers=headers)
    assert shifts.status_code == 200, shifts.text
    grid = shifts.json()
    assert [row["employee_id"] for row in grid["rows"]] == ["empA"]
    assert grid["dates"] and grid["day_labels"]

    pending = client.get("/api/personnel/pending-requests", params=params, headers=headers)
    assert pending.status_code == 403, pending.text
    assert pending.json()["detail"] == "Bu işlem için yetkiniz yok (Personel rolü: /personnel)."

    employees = client.get("/api/personnel/employees", params=params, headers=headers)
    assert employees.status_code == 200, employees.text
    assert employees.headers.get("x-prices-masked") == "1"
    rows = employees.json()
    assert [row["id"] for row in rows] == ["empA", "empB"]
    assert "empOff" not in [row["id"] for row in rows]
    own, other = rows
    assert own["full_name"] == "Ada A"
    _assert_full_employee(own, salary=0)
    _assert_directory_row(other)
    assert other["full_name"] == "Bora B"
    assert other["user_id"] == "user-b"


def test_personel_employee_id_of_other_returns_directory_row(api):
    client, _db = api
    headers = _auth("user-a")
    foreign = {"company_id": CID, "employee_id": "empB"}

    leaves = client.get("/api/personnel/leaves", params=foreign, headers=headers)
    assert leaves.status_code == 200, leaves.text
    assert leaves.json() == []

    bonuses = client.get("/api/personnel/bonuses", params=foreign, headers=headers)
    assert bonuses.status_code == 200, bonuses.text
    assert bonuses.json() == []

    payrolls = client.get("/api/personnel/payrolls", params=foreign, headers=headers)
    assert payrolls.status_code == 200, payrolls.text
    assert payrolls.json() == []

    attendance_rows = client.get("/api/personnel/attendance", params={**foreign, "month": MONTH}, headers=headers)
    assert attendance_rows.status_code == 200, attendance_rows.text
    att = attendance_rows.json()
    assert att["records"] == [] and att["summary"] == []
    assert att["month"] == MONTH

    preview = client.get("/api/personnel/overtime-preview", params={**foreign, "period": MONTH}, headers=headers)
    assert preview.status_code == 200, preview.text
    assert preview.json()["rows"] == []
    assert preview.json()["total"] == 0

    shifts = client.get("/api/personnel/shifts", params={**foreign, "week_start": WEEK}, headers=headers)
    assert shifts.status_code == 200, shifts.text
    assert shifts.json()["rows"] == []

    employees = client.get("/api/personnel/employees", params=foreign, headers=headers)
    assert employees.status_code == 200, employees.text
    rows = employees.json()
    assert [row["id"] for row in rows] == ["empB"]
    _assert_directory_row(rows[0])
    assert rows[0]["full_name"] == "Bora B"
    missing = client.get("/api/personnel/employees", params={**foreign, "employee_id": "emp-yok"}, headers=headers)
    assert missing.status_code == 200 and missing.json() == []
    inactive = client.get("/api/personnel/employees", params={**foreign, "employee_id": "empOff"}, headers=headers)
    assert inactive.status_code == 200 and inactive.json() == []


def test_own_employee_id_returns_only_full_card(api):
    client, _db = api
    headers = _auth("user-a")
    own = {"company_id": CID, "employee_id": "empA"}
    employees = client.get("/api/personnel/employees", params=own, headers=headers)
    assert employees.status_code == 200, employees.text
    rows = employees.json()
    assert [row["id"] for row in rows] == ["empA"]
    _assert_full_employee(rows[0], salary=0)


def test_own_employee_id_still_returns_own_rows(api):
    client, _db = api
    headers = _auth("user-a")
    own = {"company_id": CID, "employee_id": "empA"}
    leaves = client.get("/api/personnel/leaves", params=own, headers=headers)
    assert leaves.status_code == 200, leaves.text
    assert _ids(leaves.json()) == ["lvA", "lvAok"]


def test_portal_atolye_keeps_full_employee_list(api):
    client, db = api
    _enable_atolye(db)
    headers = _auth("user-a")
    params = {"company_id": CID}
    employees = client.get("/api/personnel/employees", params=params, headers=headers)
    assert employees.status_code == 200, employees.text
    rows = employees.json()
    assert [row["id"] for row in rows] == ["empA", "empB", "empOff"]
    for row in rows:
        _assert_full_employee(row, salary=0)
    narrowed = client.get("/api/personnel/employees", params={**params, "employee_id": "empB"}, headers=headers)
    assert [row["id"] for row in narrowed.json()] == ["empA", "empB", "empOff"]

    leaves = client.get("/api/personnel/leaves", params=params, headers=headers)
    assert _ids(leaves.json()) == ["lvA", "lvAok"]
    pending = client.get("/api/personnel/pending-requests", params=params, headers=headers)
    assert pending.status_code == 403, pending.text


def test_unlinked_personel_gets_empty_lists_not_500(api):
    client, _db = api
    headers = _auth("user-plain")
    params = {"company_id": CID}
    leaves = client.get("/api/personnel/leaves", params=params, headers=headers)
    assert leaves.status_code == 200, leaves.text
    assert leaves.json() == []
    bonuses = client.get("/api/personnel/bonuses", params=params, headers=headers)
    assert bonuses.status_code == 200 and bonuses.json() == []
    payrolls = client.get("/api/personnel/payrolls", params=params, headers=headers)
    assert payrolls.status_code == 200 and payrolls.json() == []
    attendance_rows = client.get("/api/personnel/attendance", params={**params, "month": MONTH}, headers=headers)
    assert attendance_rows.status_code == 200, attendance_rows.text
    assert attendance_rows.json()["records"] == [] and attendance_rows.json()["summary"] == []
    preview = client.get("/api/personnel/overtime-preview", params={**params, "period": MONTH}, headers=headers)
    assert preview.status_code == 200 and preview.json()["rows"] == []
    shifts = client.get("/api/personnel/shifts", params={**params, "week_start": WEEK}, headers=headers)
    assert shifts.status_code == 200 and shifts.json()["rows"] == []
    employees = client.get("/api/personnel/employees", params=params, headers=headers)
    assert employees.status_code == 200, employees.text
    rows = employees.json()
    assert [row["id"] for row in rows] == ["empA", "empB"]
    for row in rows:
        _assert_directory_row(row)
        assert "balance" not in row
    pending = client.get("/api/personnel/pending-requests", params=params, headers=headers)
    assert pending.status_code == 403, pending.text


def test_employee_card_in_other_company_is_empty(api):
    client, _db = api
    headers = _auth("user-foreign-card")
    leaves = client.get("/api/personnel/leaves", params={"company_id": CID}, headers=headers)
    assert leaves.status_code == 200, leaves.text
    assert leaves.json() == []
    employees = client.get("/api/personnel/employees", params={"company_id": CID}, headers=headers)
    assert employees.status_code == 200, employees.text
    rows = employees.json()
    assert [row["id"] for row in rows] == ["empA", "empB"]
    for row in rows:
        _assert_directory_row(row)


def test_directory_projection_is_allowlist():
    raw = _emp("empX", "Gizli Kisi", user_id="user-x")
    raw["role"] = "Usta"
    raw["notes"] = "gizli not"
    raw["token"] = "session-token"
    row = personnel_scope.project_directory(
        raw,
        has_user=True,
        workplace={"label": "Saha", "latitude": 41.0, "longitude": 29.0, "address": "gizli adres"},
    )
    assert set(row) <= set(personnel_scope.DIRECTORY_FIELDS)
    assert row["workplace"] == "Saha"
    assert row["has_user"] is True
    assert row["user_id"] == "user-x"
    assert row["has_shopfloor_pin"] is True
    assert _PIN_HASH not in str(row)
    assert "session-token" not in str(row)
    assert "latitude" not in row
    empty = personnel_scope.project_directory({"_id": "e", "full_name": "A", "status": "active"}, has_user=False)
    assert empty["has_user"] is False
    assert "user_id" not in empty
    assert "salary" not in empty


def _assert_full_list(client, headers, *, salary=1000):
    params = {"company_id": CID}
    leaves = client.get("/api/personnel/leaves", params=params, headers=headers)
    assert leaves.status_code == 200, leaves.text
    assert _ids(leaves.json()) == ["lvB", "lvA", "lvAok"]
    bonuses = client.get("/api/personnel/bonuses", params=params, headers=headers)
    assert _ids(bonuses.json()) == ["bonB", "bonA"]
    payrolls = client.get("/api/personnel/payrolls", params=params, headers=headers)
    assert set(_ids(payrolls.json())) == {"payA", "payB"}
    attendance_rows = client.get("/api/personnel/attendance", params={**params, "month": MONTH}, headers=headers)
    assert attendance_rows.status_code == 200, attendance_rows.text
    att = attendance_rows.json()
    assert {row["id"] for row in att["records"]} == {"attA", "attB"}
    assert [row["employee_id"] for row in att["summary"]] == ["empA", "empB", "empOff"]
    preview = client.get("/api/personnel/overtime-preview", params={**params, "period": MONTH}, headers=headers)
    assert [row["employee_id"] for row in preview.json()["rows"]] == ["empA", "empB"]
    shifts = client.get("/api/personnel/shifts", params={**params, "week_start": WEEK}, headers=headers)
    assert [row["employee_id"] for row in shifts.json()["rows"]] == ["empA", "empB"]
    pending = client.get("/api/personnel/pending-requests", params=params, headers=headers)
    assert pending.status_code == 200, pending.text
    assert pending.json()["count"] == 2
    assert {row["employee_id"] for row in pending.json()["items"]} == {"empA", "empB"}
    employees = client.get("/api/personnel/employees", params=params, headers=headers)
    assert employees.status_code == 200, employees.text
    rows = employees.json()
    assert [row["id"] for row in rows] == ["empA", "empB", "empOff"]
    for row in rows:
        _assert_full_employee(row, salary=salary)
        assert "shopfloor_pin_hash" not in row
    narrowed = client.get("/api/personnel/employees", params={**params, "employee_id": "empB"}, headers=headers)
    assert [row["id"] for row in narrowed.json()] == ["empA", "empB", "empOff"]
    filtered = client.get("/api/personnel/leaves", params={**params, "employee_id": "empB"}, headers=headers)
    assert _ids(filtered.json()) == ["lvB"]


def test_admin_manager_advisor_and_super_admin_see_full_list(api):
    client, db = api
    manager = next(r for r in db.roles.docs if r.get("code") == "manager" and r.get("company_id") == CID)
    assert rbac.level_allows(manager["permissions"]["/personnel"], "edit")
    accountant = next(r for r in db.roles.docs if r.get("code") == "accountant" and r.get("company_id") == CID)
    advisor = next(r for r in db.roles.docs if r.get("code") == "advisor" and r.get("company_id") == CID)
    assert accountant["permissions"]["/personnel"] == "view"
    assert advisor["permissions"]["/personnel"] == "view"
    _assert_full_list(client, _auth("user-admin", role="admin"))
    _assert_full_list(client, _auth("user-manager", role="manager"))
    _assert_full_list(client, _auth("user-advisor", role="advisor"))
    _assert_full_list(client, _auth("user-accountant", role="accountant"))
    # Süper admin tam listeyi görür; token rolü personel olduğu için fiyat maskesi durur.
    client_sa_headers = _auth("user-sa", role="personel", superadmin=True)
    params = {"company_id": CID}
    employees = client.get("/api/personnel/employees", params=params, headers=client_sa_headers)
    assert employees.status_code == 200, employees.text
    assert employees.headers.get("x-prices-masked") == "1"
    rows = employees.json()
    assert [row["id"] for row in rows] == ["empA", "empB", "empOff"]
    for row in rows:
        _assert_full_employee(row, salary=0)
    _assert_full_list(client, client_sa_headers, salary=0)


def test_production_sales_and_warehouse_see_directory(api):
    client, db = api
    production = next(r for r in db.roles.docs if r.get("code") == "production" and r.get("company_id") == CID)
    assert production["permissions"].get("/personnel", "none") == "none"
    assert rbac.role_features(production).get("portal_atolye") is False
    params = {"company_id": CID}
    headers = _auth("user-production", role="production")
    employees = client.get("/api/personnel/employees", params=params, headers=headers)
    assert employees.status_code == 200, employees.text
    assert employees.headers.get("x-prices-masked") == "1"
    rows = employees.json()
    assert [row["id"] for row in rows] == ["empA", "empB"]
    _assert_directory_row(rows[0])
    _assert_full_employee(rows[1], salary=0)
    assert rows[1]["full_name"] == "Bora B"
    other = client.get("/api/personnel/employees", params={**params, "employee_id": "empA"}, headers=headers)
    assert other.status_code == 200, other.text
    assert [row["id"] for row in other.json()] == ["empA"]
    _assert_directory_row(other.json()[0])
    leaves = client.get("/api/personnel/leaves", params=params, headers=headers)
    assert leaves.status_code == 200, leaves.text
    assert _ids(leaves.json()) == ["lvB"]
    pending = client.get("/api/personnel/pending-requests", params=params, headers=headers)
    assert pending.status_code == 403, pending.text

    for uid, role in (("user-sales", "sales"), ("user-warehouse", "warehouse")):
        headers = _auth(uid, role=role)
        employees = client.get("/api/personnel/employees", params=params, headers=headers)
        assert employees.status_code == 200, employees.text
        rows = employees.json()
        assert [row["id"] for row in rows] == ["empA", "empB"]
        for row in rows:
            _assert_directory_row(row)
        leaves = client.get("/api/personnel/leaves", params=params, headers=headers)
        assert leaves.status_code == 200 and leaves.json() == []
        pending = client.get("/api/personnel/pending-requests", params=params, headers=headers)
        assert pending.status_code == 403, pending.text


def test_unchanged_reads_stay_company_wide_for_personel(api):
    client, _db = api
    headers = _auth("user-a")
    params = {"company_id": CID}
    roles = client.get("/api/personnel/role-options", params=params, headers=headers)
    assert roles.status_code == 200, roles.text
    codes = {row["code"] for row in roles.json()["roles"]}
    assert {"admin", "personel", "manager", "advisor"} <= codes
    templates = client.get("/api/personnel/shift-templates", params=params, headers=headers)
    assert templates.status_code == 200, templates.text
    assert [row["name"] for row in templates.json()] == ["Aksam", "Sabah"]
    geo = client.get("/api/personnel/attendance/geo-status", params=params, headers=headers)
    assert geo.status_code == 200, geo.text
    assert geo.json()["employee"]["id"] == "empA"
    assert geo.json()["employee"]["full_name"] == "Ada A"
