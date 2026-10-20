"""Personnel / attendance / payroll GET routes: route-level auth and company resolution.

In-process TestClient and a memory database. No live server and no port 8021.
"""
from __future__ import annotations

import asyncio
import copy
import inspect
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-personnel-get-routes-auth-jwt-secret-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import addons  # noqa: E402
import attendance  # noqa: E402
import auth_utils  # noqa: E402
import mail_accounts  # noqa: E402
import rbac  # noqa: E402
import saas  # noqa: E402
import server  # noqa: E402
from mysql_store import match_query, new_upsert_doc, sort_docs  # noqa: E402

_CMP_OPS = ("$gt", "$gte", "$lt", "$lte")

COMP_A = "A"
COMP_B = "B"
NEXUS = "comp_nexus_main_01"
MONTH = "2026-10"
WEEK = "2026-10-12"
DENY = "Bu şirket hesabına erişiminiz yok."
UNAUTH = "Giriş yapmanız gerekiyor."


def _and_cmp(query):
    """Mongo ANDs every operator on a field. The in-memory matcher returns on the first."""
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

    def _note(self, op):
        self.db.writes.append({"coll": self.name, "op": op})

    def find(self, query=None, projection=None):
        matched = [d for d in self.docs if _docs_match(d, query)]
        return MemCursor(matched)

    async def find_one(self, query=None, projection=None):
        for doc in self.docs:
            if _docs_match(doc, query):
                return copy.deepcopy(doc)
        return None

    async def count_documents(self, query=None):
        return sum(1 for doc in self.docs if _docs_match(doc, query))

    async def insert_one(self, doc):
        self._note("insert_one")
        self.docs.append(copy.deepcopy(doc))
        return SimpleNamespace(inserted_id=doc.get("_id"))

    async def insert_many(self, docs):
        self._note("insert_many")
        self.docs.extend(copy.deepcopy(list(docs)))
        return SimpleNamespace(inserted_ids=[d.get("_id") for d in docs])

    async def update_one(self, query, update, upsert=False):
        self._note("update_one")
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
        self._note("delete_one")
        for i, doc in enumerate(self.docs):
            if _docs_match(doc, query):
                self.docs.pop(i)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def delete_many(self, query):
        self._note("delete_many")
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


def _user(uid, company_ids, active, *, role="admin", superadmin=False, name=None, employee_id=None, skip_check_in=False):
    doc = {
        "_id": uid,
        "id": uid,
        "email": f"{uid}@example.com",
        "name": name or uid,
        "role": role,
        "is_active": True,
        "is_super_admin": superadmin,
        "company_ids": list(company_ids),
        "active_company_id": active,
        "user_number": f"U-{uid}",
    }
    if employee_id:
        doc["employee_id"] = employee_id
    if skip_check_in:
        # Atölye portal kullanıcısı satır kapsamını ölçer; mesai kilidinin konusu değildir.
        doc["skip_check_in"] = True
    return doc


def _user_a():
    return _user("user-a", [COMP_A], COMP_A, name="Ali A", employee_id="empA")


def _routes():
    return [
        (server.personnel_pending_requests, server.get_current_user, "/api/personnel/pending-requests", {}),
        (server.list_leaves, server.get_current_user, "/api/personnel/leaves", {}),
        (server.list_bonuses, server.get_current_user, "/api/personnel/bonuses", {}),
        (server.list_attendance, server.get_current_user, "/api/personnel/attendance", {}),
        (server.geo_status, server.get_current_user, "/api/personnel/attendance/geo-status", {}),
        (server.personnel_role_options, server.get_current_user, "/api/personnel/role-options", {}),
        (server.list_employees, server.get_current_user, "/api/personnel/employees", {}),
        (server.list_payrolls, server.get_current_user, "/api/personnel/payrolls", {}),
        (attendance.overtime_preview, attendance._user_dep, "/api/personnel/overtime-preview", {}),
        (attendance.get_shifts, attendance._user_dep, "/api/personnel/shifts", {}),
        (attendance.list_shift_templates, attendance._user_dep, "/api/personnel/shift-templates", {}),
    ]


def _emp(eid, company, name, *, status="active", user_id=None):
    doc = {
        "_id": eid,
        "company_id": company,
        "full_name": name,
        "status": status,
        "salary": 1000,
        "department": "Uretim",
        "annual_leave_days": 14,
        "used_leave_days": 0,
    }
    if user_id:
        doc["user_id"] = user_id
    return doc


def _seed(db):
    db.companies.docs.extend([
        {"_id": COMP_A, "name": "Firma A", "location": {"latitude": 41.0, "longitude": 29.0, "radius_m": 300, "label": "LOK-A"}},
        {"_id": COMP_B, "name": "B-SECRET", "location": {"latitude": 39.0, "longitude": 32.0, "radius_m": 100, "label": "B-SECRET-LOK"}},
        {"_id": NEXUS, "name": "NEXUS-ONLY", "location": {"latitude": 1.0, "longitude": 1.0, "radius_m": 50, "label": "NEXUS-ONLY"}},
    ])
    db.employees.docs.extend([
        _emp("empA", COMP_A, "Ali Veli", user_id="user-a"),
        _emp("empA2", COMP_A, "Veli Usta"),
        _emp("empOff", COMP_A, "Pasif A", status="inactive"),
        _emp("empB", COMP_B, "B-SECRET-EMP"),
        _emp("empN", NEXUS, "NEXUS-ONLY"),
    ])
    db.leave_requests.docs.extend([
        {"_id": "lvA2", "company_id": COMP_A, "employee_id": "empA2", "employee_name": "Veli Usta", "type": "sick", "start_date": "2026-11-03", "end_date": "2026-11-03", "days": 1, "reason": "rapor", "status": "pending", "created_at": "2026-10-08T00:00:00+00:00"},
        {"_id": "lvA", "company_id": COMP_A, "employee_id": "empA", "employee_name": "Ali Veli", "type": "annual", "start_date": "2026-11-01", "end_date": "2026-11-02", "days": 2, "reason": "aile", "status": "pending", "created_at": "2026-10-05T00:00:00+00:00"},
        {"_id": "lvAok", "company_id": COMP_A, "employee_id": "empA", "employee_name": "Ali Veli", "type": "annual", "start_date": WEEK, "end_date": WEEK, "days": 1, "status": "approved", "created_at": "2026-10-01T00:00:00+00:00"},
        {"_id": "lvB", "company_id": COMP_B, "employee_id": "empB", "employee_name": "B-SECRET-EMP", "type": "annual", "start_date": "2026-11-01", "end_date": "2026-11-02", "days": 2, "reason": "B-SECRET-LEAVE", "status": "pending", "created_at": "2026-10-09T00:00:00+00:00"},
        {"_id": "lvN", "company_id": NEXUS, "employee_id": "empN", "employee_name": "NEXUS-ONLY", "type": "annual", "start_date": "2026-11-01", "end_date": "2026-11-01", "days": 1, "status": "pending", "created_at": "2026-10-09T00:00:00+00:00"},
    ])
    db.attendance.docs.extend([
        {"_id": "attEarly", "company_id": COMP_A, "employee_id": "empA", "employee_name": "Ali Veli", "date": "2026-10-04", "status": "present", "check_in": "09:00", "check_out": "16:00", "hours": 6, "overtime_hours": 0, "employee_confirmed": True, "early_leave_request": {"status": "pending", "planned_time": "16:00", "reason": "doktor", "requested_at": "2026-10-04T00:00:00+00:00"}},
        {"_id": "attIntra", "company_id": COMP_A, "employee_id": "empA", "employee_name": "Ali Veli", "date": "2026-10-03", "status": "present", "hours": 8, "overtime_hours": 0, "employee_confirmed": True, "intraday_leave_request": {"status": "pending", "out_time": "11:00", "return_time": "12:00", "reason": "banka", "requested_at": "2026-10-03T00:00:00+00:00"}},
        {"_id": "attDisp", "company_id": COMP_A, "employee_id": "empA", "employee_name": "Ali Veli", "date": "2026-10-02", "status": "present", "hours": 8, "overtime_hours": 1, "employee_confirmed": False, "dispute_note": "eksik saat", "dispute_resolved": False, "disputed_at": "2026-10-02T00:00:00+00:00"},
        {"_id": "attDispDone", "company_id": COMP_A, "employee_id": "empA", "employee_name": "Ali Veli", "date": "2026-09-20", "status": "present", "dispute_note": "kapandi", "dispute_resolved": True, "disputed_at": "2026-09-20T00:00:00+00:00"},
        {"_id": "attYev", "company_id": COMP_A, "employee_id": "empA", "employee_name": "Ali Veli", "date": "2026-10-01", "status": "present", "hours": 8, "overtime_hours": 0, "employee_confirmed": True, "late_minutes": 15, "yevmiye_adjustment_request": {"status": "pending", "late_minutes": 15, "early_leave_minutes": 0, "full_amount": 1000, "proposed_amount": 900, "requested_at": "2026-10-01T00:00:00+00:00"}},
        {"_id": "attGeo", "company_id": COMP_A, "employee_id": "empA", "employee_name": "Ali Veli", "date": "2026-09-30", "status": "present", "geo_confirm_request": {"status": "pending", "action": "check_in", "reason": "offsite", "proposed_time": "09:10", "place": "saha", "distance_m": 120, "requested_at": "2026-09-30T00:00:00+00:00"}},
        {"_id": "attExit", "company_id": COMP_A, "employee_id": "empA", "employee_name": "Ali Veli", "date": "2026-09-29", "status": "present", "location_exit_request": {"status": "pending", "place": "disari", "distance_m": 800, "tolerance_hours": 1, "wage_deduction": None, "requested_at": "2026-09-29T00:00:00+00:00"}},
        {"_id": "attOt", "company_id": COMP_A, "employee_id": "empA", "employee_name": "Ali Veli", "date": "2026-09-28", "status": "present", "overtime_confirm_request": {"status": "pending", "hours": 1.5, "schedule_end": "18:00", "proposed_out": "19:30", "tolerance_minutes": 15, "requested_at": "2026-09-28T00:00:00+00:00"}},
        {"_id": "attA2", "company_id": COMP_A, "employee_id": "empA2", "employee_name": "Veli Usta", "date": "2026-10-01", "status": "present", "hours": 8, "overtime_hours": 0, "normal_hours": 8, "late_minutes": 0, "employee_confirmed": True},
        {"_id": "attOld", "company_id": COMP_A, "employee_id": "empA", "employee_name": "Ali Veli", "date": "2026-09-15", "status": "present", "hours": 8, "overtime_hours": 2, "is_off_day": False, "employee_confirmed": True},
        {"_id": "attB", "company_id": COMP_B, "employee_id": "empB", "employee_name": "B-SECRET-EMP", "date": "2026-10-02", "status": "present", "hours": 9, "overtime_hours": 1, "employee_confirmed": True, "early_leave_request": {"status": "pending", "reason": "B-SECRET-EARLY", "requested_at": "2026-10-02T00:00:00+00:00"}},
    ])
    db.bonus_payments.docs.extend([
        {"_id": "bonA", "company_id": COMP_A, "employee_id": "empA", "employee_name": "Ali Veli", "type": "bonus", "type_label": "Prim", "period": MONTH, "amount": 100, "status": "pending", "note": "prim", "created_at": "2026-10-08T01:00:00+00:00"},
        {"_id": "advA", "company_id": COMP_A, "employee_id": "empA", "employee_name": "Ali Veli", "type": "advance", "source": "self", "status": "pending", "amount": 250, "period": MONTH, "note": "okul", "created_at": "2026-10-06T00:00:00+00:00"},
        {"_id": "bonAold", "company_id": COMP_A, "employee_id": "empA2", "employee_name": "Veli Usta", "type": "bonus", "period": "2026-09", "amount": 40, "status": "paid", "created_at": "2026-09-01T00:00:00+00:00"},
        {"_id": "bonB", "company_id": COMP_B, "employee_id": "empB", "employee_name": "B-SECRET-EMP", "type": "bonus", "period": MONTH, "amount": 999, "status": "pending", "note": "B-SECRET-BONUS", "created_at": "2026-10-09T00:00:00+00:00"},
    ])
    db.payrolls.docs.extend([
        {"_id": "payA", "company_id": COMP_A, "employee_id": "empA", "employee_name": "Ali Veli", "period": MONTH, "status": "pending", "net_salary": 1000, "final_payable": 1000},
        {"_id": "payAold", "company_id": COMP_A, "employee_id": "empA2", "employee_name": "Veli Usta", "period": "2026-09", "status": "paid", "net_salary": 800, "final_payable": 800},
        {"_id": "payB", "company_id": COMP_B, "employee_id": "empB", "employee_name": "B-SECRET-EMP", "period": MONTH, "status": "pending", "net_salary": 5000, "final_payable": 5000, "note": "B-SECRET-PAY"},
    ])
    db.work_order_trash_requests.docs.extend([
        {"_id": "trA", "company_id": COMP_A, "status": "pending", "requested_by": "Operatör A", "order_code": "URT-A", "step_no": 1, "product_name": "Parca", "work_order_id": "woA", "requested_at": "2026-10-07T00:00:00+00:00"},
        {"_id": "trB", "company_id": COMP_B, "status": "pending", "requested_by": "B-SECRET-OP", "order_code": "URT-B", "product_name": "B-SECRET", "work_order_id": "woB", "requested_at": "2026-10-10T00:00:00+00:00"},
    ])
    db.shift_plans.docs.extend([
        {"_id": "shA", "company_id": COMP_A, "employee_id": "empA", "employee_name": "Ali Veli", "date": WEEK, "off": False, "start": "09:00", "end": "18:00", "break_minutes": 60, "note": ""},
        {"_id": "shB", "company_id": COMP_B, "employee_id": "empB", "employee_name": "B-SECRET-EMP", "date": WEEK, "off": False, "start": "08:00", "end": "17:00", "break_minutes": 60, "note": "B-SECRET-SHIFT"},
    ])
    db.shift_templates.docs.extend([
        {"_id": "tplSabah", "company_id": COMP_A, "name": "Sabah A", "days": {"0": {"off": False, "start": "08:00", "end": "16:00", "break_minutes": 60}}},
        {"_id": "tplAksam", "company_id": COMP_A, "name": "Aksam A", "days": {"0": {"off": False, "start": "16:00", "end": "00:30", "break_minutes": 30}}},
        {"_id": "tplB", "company_id": COMP_B, "name": "B-SECRET-TPL", "days": {}},
    ])
    db.roles.docs.append({"_id": "roleBcustom", "company_id": COMP_B, "code": "usta_b", "name": "B-SECRET-ROLE", "is_system": False})
    db.expenses.docs.append({"_id": "exB", "company_id": COMP_B, "employee_id": "empB", "total": 50, "category": "B-SECRET-EXP", "date": "2026-10-01"})


def _no_foreign(text):
    assert "B-SECRET" not in text
    assert "NEXUS-ONLY" not in text


def _ids(rows):
    return [row.get("id") for row in rows]


def _snapshot(db):
    return {name: copy.deepcopy(coll.docs) for name, coll in db._cols.items()}


def _business_snapshot(db):
    names = (
        "leave_requests", "bonus_payments", "payrolls", "employees", "attendance",
        "notifications", "shift_plans", "shift_templates", "work_order_trash_requests",
        "expenses", "companies", "users",
    )
    return {name: copy.deepcopy(getattr(db, name).docs) for name in names}


def _bind(db):
    prev = (
        server.db, attendance._db, attendance._current_user,
        rbac._db, saas._db, addons._db, mail_accounts._db,
    )
    server.db = db
    attendance._db = db
    # Diğer testler attendance.init ile _current_user'ı değiştirebilir; bu dosya gerçek oturumu kullanır.
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
        _user("user-a", [COMP_A], COMP_A, name="Ali A", employee_id="empA"),
        _user("user-b", [COMP_B], COMP_B, name="B-SECRET"),
        _user("user-plain", [COMP_A], COMP_A, name="Duz Admin"),
        _user("user-sa", [], "", superadmin=True, name="Super"),
        _user("user-sa-a", [COMP_A], COMP_A, superadmin=True, name="Super A"),
        _user("user-atolye", [COMP_A], COMP_A, role="personel", name="Atolye", employee_id="empA", skip_check_in=True),
    ])
    _seed(db)
    prev = _bind(db)
    saas.invalidate()
    for cid in (COMP_A, COMP_B, NEXUS):
        _run(rbac.ensure_roles(cid))
        _run(rbac.ensure_roles(cid))
    db.roles.docs.append({"_id": "roleAcustom", "company_id": COMP_A, "code": "usta_a", "name": "Usta A", "is_system": False, "permissions": {}})
    db.writes.clear()
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


def _token(uid, *, superadmin=False, role="admin", aud=None):
    return auth_utils.create_access_token(uid, f"{uid}@example.com", role, is_super_admin=superadmin, aud=aud)


def _auth(uid, *, superadmin=False, role="admin", aud=None):
    return {"Authorization": f"Bearer {_token(uid, superadmin=superadmin, role=role, aud=aud)}"}


def _enable_atolye(db):
    for doc in db.roles.docs:
        if doc.get("company_id") == COMP_A and doc.get("code") == "personel":
            doc["features"] = {**(doc.get("features") or {}), "portal_atolye": True}


def test_route_signatures_have_auth_and_no_nexus_default():
    routes = _routes()
    assert len(routes) == 11
    for fn, dep, _path, _extra in routes:
        sig = inspect.signature(fn)
        assert sig.parameters["company_id"].default is None
        assert sig.parameters["user"].default.dependency is dep
        src = inspect.getsource(fn)
        assert "comp_nexus_main_01" not in src
        assert "resolve_company_id" in src
        assert "cid = tenant_access.resolve_company_id(user, company_id)" in src
    assert "employee_id" in inspect.signature(server.list_leaves).parameters
    assert "resolve_company_id" not in inspect.getsource(attendance.create_my_leave)
    assert "resolve_company_id" not in inspect.getsource(attendance.request_my_advance)
    assert "resolve_company_id" not in inspect.getsource(attendance.cancel_my_leave)
    assert "resolve_company_id" not in inspect.getsource(attendance.cancel_my_advance)
    assert ("/api/personnel/employees", "portal_atolye") in rbac._IK_HELPER_READS
    pending = inspect.getsource(server.personnel_pending_requests)
    assert pending.count(".to_list(200)") == 9
    assert ".to_list(100)" in pending
    assert '.sort("created_at", -1)' in pending
    assert ".to_list(500)" in inspect.getsource(server.list_leaves)
    assert ".to_list(500)" in inspect.getsource(server.list_bonuses)
    assert ".to_list(3000)" in inspect.getsource(server.list_attendance)
    assert ".to_list(200)" in inspect.getsource(server.list_attendance)
    assert ".to_list(100)" in inspect.getsource(server.list_employees)
    assert ".to_list(4000)" in inspect.getsource(server.list_employees)
    assert ".to_list(8000)" in inspect.getsource(server.list_employees)
    assert ".to_list(100)" in inspect.getsource(server.list_payrolls)
    assert ".to_list(300)" in inspect.getsource(attendance.overtime_preview)
    assert ".to_list(2000)" in inspect.getsource(attendance.get_shifts)
    assert ".to_list(1000)" in inspect.getsource(attendance.get_shifts)
    assert ".to_list(100)" in inspect.getsource(attendance.list_shift_templates)
    assert '.sort("name", 1)' in inspect.getsource(attendance.list_shift_templates)
    assert '.sort("full_name", 1)' in inspect.getsource(attendance.get_shifts)


def test_background_loops_do_not_call_these_routes():
    names = [fn.__name__ for fn, _dep, _path, _extra in _routes()]
    blobs = []
    for mod in (server, attendance):
        for name, obj in vars(mod).items():
            if not callable(obj):
                continue
            if "loop" not in name and not name.endswith("_tick") and name not in (
                "run_missing_checkin_check", "run_auto_checkout_ot_check", "run_checkin_reminders",
            ):
                continue
            try:
                blobs.append(inspect.getsource(obj))
            except (OSError, TypeError):
                continue
    text = "\n".join(blobs)
    assert "run_missing_checkin_check" in text
    for name in names:
        assert f"{name}(" not in text


def test_backend_callers_are_only_the_definitions():
    names = [fn.__name__ for fn, _dep, _path, _extra in _routes()]
    root = _BACKEND
    for py in root.rglob("*.py"):
        if "tests" in py.parts or "docker" in py.parts:
            continue
        lines = py.read_text(encoding="utf-8").splitlines()
        for name in names:
            for line in lines:
                if f"{name}(" not in line:
                    continue
                if f"def {name}(" in line:
                    continue
                raise AssertionError(f"{py}:{line.strip()}")


def test_no_token_is_401(api):
    client, db = api
    before = _snapshot(db)
    for _fn, _dep, path, extra in _routes():
        response = client.get(path, params=extra or None)
        assert response.status_code == 401, (path, response.text)
        assert response.json()["detail"] == UNAUTH
        _no_foreign(response.text)
    for path in ("/api/personnel/leaves/self", "/api/personnel/bonuses/self"):
        response = client.post(path, json={"amount": 10})
        assert response.status_code == 401, (path, response.text)
        _no_foreign(response.text)
    assert _snapshot(db) == before


def test_other_company_is_403_and_returns_nothing(api):
    client, db = api
    before = _snapshot(db)
    headers = _auth("user-a")
    for _fn, _dep, path, extra in _routes():
        response = client.get(path, params={"company_id": COMP_B, **extra}, headers=headers)
        assert response.status_code == 403, (path, response.text)
        assert response.json()["detail"] == DENY
        _no_foreign(response.text)
    assert _snapshot(db) == before


def test_direct_call_other_company_is_403_without_middleware(api):
    _client, db = api
    user_a = _user_a()
    before = _snapshot(db)
    for fn, _dep, path, extra in _routes():
        with pytest.raises(HTTPException) as exc:
            _run(fn(company_id=COMP_B, user=user_a, **extra))
        assert exc.value.status_code == 403, path
        assert exc.value.detail == DENY
    assert _snapshot(db) == before


def test_missing_company_id_uses_active_company_only(api):
    client, _db = api
    headers = _auth("user-a")
    user_a = _user_a()
    for fn, _dep, path, extra in _routes():
        response = client.get(path, params=extra or None, headers=headers)
        assert response.status_code == 200, (path, response.text)
        _no_foreign(response.text)
        direct = _run(fn(company_id=None, user=user_a, **extra))
        assert response.json() == direct
        blank = client.get(path, params={"company_id": ""}, headers=headers)
        assert blank.status_code == 200, (path, blank.text)
        assert blank.json() == response.json()
        _no_foreign(blank.text)


def test_own_company_returns_only_own_rows(api):
    client, db = api
    headers = _auth("user-a")
    user_a = _user_a()
    before = _business_snapshot(db)

    pending = client.get("/api/personnel/pending-requests", params={"company_id": COMP_A}, headers=headers)
    assert pending.status_code == 200, pending.text
    body = pending.json()
    assert body == _run(server.personnel_pending_requests(company_id=COMP_A, user=user_a))
    assert body["count"] == len(body["items"]) == 11
    assert [row["id"] for row in body["items"]] == [
        "lvA2", "trA", "advA", "lvA", "attEarly", "attIntra", "attDisp", "attYev", "attGeo", "attExit", "attOt",
    ]
    assert [row["kind"] for row in body["items"]] == [
        "leave", "work_order_trash", "advance", "leave", "early_leave", "intraday_leave",
        "dispute", "yevmiye_adjustment", "geo_confirm", "location_exit", "overtime_confirm",
    ]
    _no_foreign(pending.text)

    leaves = client.get("/api/personnel/leaves", params={"company_id": COMP_A}, headers=headers)
    assert leaves.status_code == 200, leaves.text
    assert leaves.json() == _run(server.list_leaves(company_id=COMP_A, user=user_a))
    assert _ids(leaves.json()) == ["lvA2", "lvA", "lvAok"]
    filtered = client.get("/api/personnel/leaves", params={"company_id": COMP_A, "employee_id": "empA2"}, headers=headers)
    assert _ids(filtered.json()) == ["lvA2"]
    assert filtered.json() == _run(server.list_leaves(company_id=COMP_A, employee_id="empA2", user=user_a))
    _no_foreign(leaves.text)

    bonuses = client.get("/api/personnel/bonuses", params={"company_id": COMP_A}, headers=headers)
    assert bonuses.status_code == 200, bonuses.text
    assert bonuses.json() == _run(server.list_bonuses(company_id=COMP_A, user=user_a))
    assert _ids(bonuses.json()) == ["bonA", "advA", "bonAold"]
    period = client.get("/api/personnel/bonuses", params={"company_id": COMP_A, "period": MONTH}, headers=headers)
    assert _ids(period.json()) == ["bonA", "advA"]
    assert period.json() == _run(server.list_bonuses(company_id=COMP_A, period=MONTH, user=user_a))
    _no_foreign(bonuses.text)

    attendance_rows = client.get("/api/personnel/attendance", params={"company_id": COMP_A, "month": MONTH}, headers=headers)
    assert attendance_rows.status_code == 200, attendance_rows.text
    att = attendance_rows.json()
    assert att == _run(server.list_attendance(company_id=COMP_A, month=MONTH, user=user_a))
    assert att["month"] == MONTH
    assert [row["id"] for row in att["records"]] == ["attEarly", "attIntra", "attDisp", "attYev", "attA2"]
    assert [row["employee_name"] for row in att["summary"]] == ["Ali Veli", "Veli Usta", "Pasif A"]
    assert set(att["schedule"]) >= {"start", "end", "work_days"}
    older = client.get("/api/personnel/attendance", params={"company_id": COMP_A, "month": "2026-09"}, headers=headers)
    assert [row["id"] for row in older.json()["records"]] == ["attGeo", "attExit", "attOt", "attDispDone", "attOld"]
    assert older.json() == _run(server.list_attendance(company_id=COMP_A, month="2026-09", user=user_a))
    _no_foreign(attendance_rows.text)

    geo = client.get("/api/personnel/attendance/geo-status", params={"company_id": COMP_A}, headers=headers)
    assert geo.status_code == 200, geo.text
    view = geo.json()
    assert view == _run(server.geo_status(company_id=COMP_A, user=user_a))
    assert view["location"]["label"] == "LOK-A"
    assert view["company_location"]["label"] == "LOK-A"
    assert view["employee"] == {"id": "empA", "full_name": "Ali Veli"}
    assert view["schedule"]["start"] == "09:00"
    assert view["schedule"]["end"] == "18:00"
    assert "today_date" in view and "now" in view and "checkout_unlocked" in view
    assert "location_consent" in view and "location_signal" in view
    _no_foreign(geo.text)
    cookie = client.get("/api/personnel/attendance/geo-status", params={"company_id": COMP_A}, cookies={"access_token": _token("user-a")})
    assert cookie.status_code == 200, cookie.text
    assert cookie.json() == view

    roles = client.get("/api/personnel/role-options", params={"company_id": COMP_A}, headers=headers)
    assert roles.status_code == 200, roles.text
    role_body = roles.json()
    assert role_body == _run(server.personnel_role_options(company_id=COMP_A, user=user_a))
    names = [row["name"] for row in role_body["roles"]]
    assert "Usta A" in names
    assert "Yönetici" in names
    assert names.index("Yönetici") < names.index("Usta A")
    assert all(row["code"] and row["name"] for row in role_body["roles"])
    assert all("company_id" not in row for row in role_body["roles"])
    _no_foreign(roles.text)

    employees = client.get("/api/personnel/employees", params={"company_id": COMP_A}, headers=headers)
    assert employees.status_code == 200, employees.text
    emp_rows = employees.json()
    assert emp_rows == _run(server.list_employees(company_id=COMP_A, user=user_a))
    assert [row["id"] for row in emp_rows] == ["empA", "empA2", "empOff"]
    assert [row["full_name"] for row in emp_rows] == ["Ali Veli", "Veli Usta", "Pasif A"]
    ali = emp_rows[0]
    for key in ("balance", "workplace", "has_user", "leave_balance", "yevmiye_days", "yevmiye_due", "annual_leave_days", "used_leave_days"):
        assert key in ali
    assert ali["has_user"] is True
    assert emp_rows[1]["has_user"] is False
    assert ali["annual_leave_days"] == ali["leave_balance"]["annual"]
    assert ali["used_leave_days"] == ali["leave_balance"]["used"]
    _no_foreign(employees.text)

    payrolls = client.get("/api/personnel/payrolls", params={"company_id": COMP_A}, headers=headers)
    assert payrolls.status_code == 200, payrolls.text
    assert payrolls.json() == _run(server.list_payrolls(company_id=COMP_A, user=user_a))
    assert _ids(payrolls.json()) == ["payA", "payAold"]
    one_period = client.get("/api/personnel/payrolls", params={"company_id": COMP_A, "period": MONTH}, headers=headers)
    assert _ids(one_period.json()) == ["payA"]
    assert one_period.json() == _run(server.list_payrolls(company_id=COMP_A, period=MONTH, user=user_a))
    _no_foreign(payrolls.text)

    preview = client.get("/api/personnel/overtime-preview", params={"company_id": COMP_A, "period": MONTH}, headers=headers)
    assert preview.status_code == 200, preview.text
    prev = preview.json()
    assert prev == _run(attendance.overtime_preview(company_id=COMP_A, period=MONTH, user=user_a))
    assert prev["period"] == MONTH
    assert [row["employee_id"] for row in prev["rows"]] == ["empA", "empA2"]
    assert "empOff" not in [row["employee_id"] for row in prev["rows"]]
    assert prev["total"] == round(sum(row["amount"] for row in prev["rows"]), 2)
    assert "weekday_hours" in prev["rows"][0] and "amount" in prev["rows"][0]
    _no_foreign(preview.text)

    shifts = client.get("/api/personnel/shifts", params={"company_id": COMP_A, "week_start": WEEK}, headers=headers)
    assert shifts.status_code == 200, shifts.text
    grid = shifts.json()
    assert grid == _run(attendance.get_shifts(company_id=COMP_A, week_start=WEEK, user=user_a))
    assert grid["week_start"] == WEEK
    assert grid["dates"][0] == WEEK and len(grid["dates"]) == 7
    assert grid["day_labels"] == attendance.DAY_LABELS
    assert [row["employee_name"] for row in grid["rows"]] == ["Ali Veli", "Veli Usta"]
    monday = grid["rows"][0]["cells"][0]
    assert monday["planned"] is True and monday["leave"]["id"] == "lvAok"
    assert monday["conflict"] is True
    assert grid["conflicts"] == 1
    _no_foreign(shifts.text)

    templates = client.get("/api/personnel/shift-templates", params={"company_id": COMP_A}, headers=headers)
    assert templates.status_code == 200, templates.text
    assert templates.json() == _run(attendance.list_shift_templates(company_id=COMP_A, user=user_a))
    assert [row["name"] for row in templates.json()] == ["Aksam A", "Sabah A"]
    assert [row["id"] for row in templates.json()] == ["tplAksam", "tplSabah"]
    _no_foreign(templates.text)

    assert _business_snapshot(db) == before


def test_super_admin_follows_resolve_company_id(api):
    client, _db = api
    missing = client.get("/api/personnel/employees", headers=_auth("user-sa", superadmin=True))
    assert missing.status_code == 400, missing.text
    assert missing.json()["detail"] == "Şirket seçilmedi."
    _no_foreign(missing.text)
    for fn, _dep, path, extra in _routes():
        response = client.get(path, params=extra or None, headers=_auth("user-sa", superadmin=True))
        assert response.status_code == 400, (path, response.text)
        with pytest.raises(HTTPException) as exc:
            _run(fn(user=_user("user-sa", [], "", superadmin=True), **extra))
        assert exc.value.status_code == 400

    active = client.get("/api/personnel/leaves", headers=_auth("user-sa-a", superadmin=True))
    assert active.status_code == 200, active.text
    assert _ids(active.json()) == ["lvA2", "lvA", "lvAok"]
    _no_foreign(active.text)

    headers = _auth("user-sa", superadmin=True)
    foreign = {
        "/api/personnel/pending-requests": lambda body: body["items"][0]["id"] == "trB" and body["count"] >= 2,
        "/api/personnel/leaves": lambda body: _ids(body) == ["lvB"],
        "/api/personnel/bonuses": lambda body: _ids(body) == ["bonB"],
        "/api/personnel/attendance": lambda body: any(row["employee_name"] == "B-SECRET-EMP" for row in body["summary"]),
        "/api/personnel/attendance/geo-status": lambda body: body["location"]["label"] == "B-SECRET-LOK" and body["employee"] is None,
        "/api/personnel/role-options": lambda body: any(row["name"] == "B-SECRET-ROLE" for row in body["roles"]),
        "/api/personnel/employees": lambda body: [row["full_name"] for row in body] == ["B-SECRET-EMP"],
        "/api/personnel/payrolls": lambda body: _ids(body) == ["payB"],
        "/api/personnel/overtime-preview": lambda body: [row["employee_name"] for row in body["rows"]] == ["B-SECRET-EMP"],
        "/api/personnel/shifts": lambda body: [row["employee_name"] for row in body["rows"]] == ["B-SECRET-EMP"],
        "/api/personnel/shift-templates": lambda body: [row["name"] for row in body] == ["B-SECRET-TPL"],
    }
    assert len(foreign) == 11
    for _fn, _dep, path, extra in _routes():
        response = client.get(path, params={"company_id": COMP_B, **extra}, headers=headers)
        assert response.status_code == 200, (path, response.text)
        assert foreign[path](response.json()), (path, response.text)
        assert "NEXUS-ONLY" not in response.text
        assert "Ali Veli" not in response.text


def test_portal_atolye_lists_own_company_employees(api):
    client, db = api
    _enable_atolye(db)
    ik = TestClient(server.app, base_url="https://ik.tamkobi.com")
    headers = _auth("user-atolye", role="personel", aud="ik")
    with ik:
        response = ik.get("/api/personnel/employees", params={"company_id": COMP_A}, headers=headers)
    assert response.status_code == 200, response.text
    rows = response.json()
    assert [row["id"] for row in rows] == ["empA", "empA2", "empOff"]
    assert [row["full_name"] for row in rows] == ["Ali Veli", "Veli Usta", "Pasif A"]
    _no_foreign(response.text)
    # Row-level "personel sees only self" stays out of this package.
    assert len(rows) == 3


def test_portal_atolye_off_still_blocks_ik_employee_list(api):
    _client, _db = api
    ik = TestClient(server.app, base_url="https://ik.tamkobi.com")
    headers = _auth("user-atolye", role="personel", aud="ik")
    with ik:
        response = ik.get("/api/personnel/employees", params={"company_id": COMP_A}, headers=headers)
    assert response.status_code == 403, response.text
    assert "yetkiniz yok" in response.json()["detail"].lower()
    _no_foreign(response.text)


def test_self_leave_and_advance_keep_current_behavior(api):
    client, db = api
    headers = _auth("user-a")
    plain = _auth("user-plain")
    denied = client.post("/api/personnel/leaves/self", json={"type": "sick", "start_date": "2026-11-10", "end_date": "2026-11-10"}, headers=plain)
    assert denied.status_code == 403, denied.text
    assert denied.json()["detail"] == "Kullanıcınız bir personel kartına bağlı değil."
    denied_adv = client.post("/api/personnel/bonuses/self", json={"amount": 50, "period": "2026-11"}, headers=plain)
    assert denied_adv.status_code == 403, denied_adv.text

    created = client.post(
        "/api/personnel/leaves/self",
        json={"type": "sick", "start_date": "2026-11-10", "end_date": "2026-11-11", "reason": "grip", "company_id": COMP_B},
        headers=headers,
    )
    assert created.status_code == 200, created.text
    leave = created.json()
    assert leave["company_id"] == COMP_A
    assert leave["employee_id"] == "empA"
    assert leave["employee_name"] == "Ali Veli"
    assert leave["status"] == "pending"
    assert leave["source"] == "self"
    assert leave["type"] == "sick"
    assert leave["days"] == 2
    assert leave["id"] and "_id" not in leave
    stored = next(doc for doc in db.leave_requests.docs if doc.get("_id") == leave["id"])
    assert stored["company_id"] == COMP_A
    overlap = client.post(
        "/api/personnel/leaves/self",
        json={"type": "sick", "start_date": "2026-11-11", "end_date": "2026-11-11"},
        headers=headers,
    )
    assert overlap.status_code == 400, overlap.text
    assert "çakışan" in overlap.json()["detail"]

    pending = client.post(
        "/api/personnel/bonuses/self",
        json={"amount": 150, "period": "2026-11", "note": "okul", "company_id": COMP_B},
        headers=headers,
    )
    assert pending.status_code == 400, pending.text
    assert pending.json()["detail"] == "Bekleyen bir avans talebiniz var."
    assert {doc["_id"] for doc in db.bonus_payments.docs} == {"bonA", "advA", "bonAold", "bonB"}
    next(doc for doc in db.bonus_payments.docs if doc.get("_id") == "advA")["status"] = "approved"
    advance = client.post(
        "/api/personnel/bonuses/self",
        json={"amount": 150, "period": "2026-11", "note": "okul", "company_id": COMP_B},
        headers=headers,
    )
    assert advance.status_code == 200, advance.text
    bonus = advance.json()
    assert bonus["company_id"] == COMP_A
    assert bonus["employee_id"] == "empA"
    assert bonus["type"] == "advance"
    assert bonus["source"] == "self"
    assert bonus["status"] == "pending"
    assert bonus["amount"] == 150
    assert bonus["period"] == "2026-11"
    assert "message" in bonus
    stored_bonus = next(doc for doc in db.bonus_payments.docs if doc.get("_id") == bonus["id"])
    assert stored_bonus["company_id"] == COMP_A
    again = client.post("/api/personnel/bonuses/self", json={"amount": 10, "period": "2026-11"}, headers=headers)
    assert again.status_code == 400, again.text
    assert again.json()["detail"] == "Bekleyen bir avans talebiniz var."
    _no_foreign(created.text)
    _no_foreign(advance.text)
