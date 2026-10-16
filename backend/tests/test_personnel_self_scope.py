"""Personel rolü GET listelerinde yalnız kendi satırını görür.

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
    return doc


def _emp(eid, name, company=CID, user_id=None):
    doc = {
        "_id": eid,
        "company_id": company,
        "full_name": name,
        "status": "active",
        "salary": 1000,
        "department": "Uretim",
        "annual_leave_days": 14,
        "used_leave_days": 0,
    }
    if user_id:
        doc["user_id"] = user_id
    return doc


def _seed(db):
    db.companies.docs.append({"_id": CID, "name": "Scope A"})
    db.companies.docs.append({"_id": OTHER, "name": "Scope B"})
    db.employees.docs.extend([
        _emp("empA", "Ada A", user_id="user-a"),
        _emp("empB", "Bora B", user_id="user-b"),
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
        _user("user-sales", "sales"),
        _user("user-warehouse", "warehouse"),
        _user("user-sa", "personel", superadmin=True, companies=[], active=""),
    ])
    _seed(db)
    prev = _bind(db)
    saas.invalidate()
    _run(rbac.ensure_roles(CID))
    _run(rbac.ensure_roles(CID))
    for doc in db.roles.docs:
        if doc.get("company_id") == CID and doc.get("code") == "manager":
            perms = dict(doc.get("permissions") or {})
            perms["/personnel"] = "view"
            doc["permissions"] = perms
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
    assert pending.json()["detail"] == personnel_scope.PENDING_FORBIDDEN

    employees = client.get("/api/personnel/employees", params=params, headers=headers)
    assert employees.status_code == 200, employees.text
    assert [row["id"] for row in employees.json()] == ["empA"]
    assert employees.json()[0]["full_name"] == "Ada A"


def test_personel_employee_id_of_other_returns_empty(api):
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
    assert employees.json() == []
    assert "Bora B" not in employees.text


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
    assert [row["id"] for row in employees.json()] == ["empA", "empB"]

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
    assert employees.status_code == 200 and employees.json() == []
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
    assert employees.json() == []


def _assert_full_list(client, headers):
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
    assert [row["employee_id"] for row in att["summary"]] == ["empA", "empB"]
    preview = client.get("/api/personnel/overtime-preview", params={**params, "period": MONTH}, headers=headers)
    assert [row["employee_id"] for row in preview.json()["rows"]] == ["empA", "empB"]
    shifts = client.get("/api/personnel/shifts", params={**params, "week_start": WEEK}, headers=headers)
    assert [row["employee_id"] for row in shifts.json()["rows"]] == ["empA", "empB"]
    pending = client.get("/api/personnel/pending-requests", params=params, headers=headers)
    assert pending.status_code == 200, pending.text
    assert pending.json()["count"] == 2
    assert {row["employee_id"] for row in pending.json()["items"]} == {"empA", "empB"}
    employees = client.get("/api/personnel/employees", params=params, headers=headers)
    assert [row["id"] for row in employees.json()] == ["empA", "empB"]
    filtered = client.get("/api/personnel/leaves", params={**params, "employee_id": "empB"}, headers=headers)
    assert _ids(filtered.json()) == ["lvB"]


def test_admin_manager_advisor_and_super_admin_see_full_list(api):
    client, db = api
    manager = next(r for r in db.roles.docs if r.get("code") == "manager" and r.get("company_id") == CID)
    assert manager["permissions"]["/personnel"] == "view"
    _assert_full_list(client, _auth("user-admin", role="admin"))
    _assert_full_list(client, _auth("user-manager", role="manager"))
    _assert_full_list(client, _auth("user-advisor", role="advisor"))
    _assert_full_list(client, _auth("user-sa", role="personel", superadmin=True))


def test_sales_and_warehouse_without_personnel_view_are_scoped(api):
    client, _db = api
    params = {"company_id": CID}
    for uid, role in (("user-sales", "sales"), ("user-warehouse", "warehouse")):
        headers = _auth(uid, role=role)
        employees = client.get("/api/personnel/employees", params=params, headers=headers)
        assert employees.status_code == 200, employees.text
        assert employees.json() == []
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
