"""Puantaj sorgu kiracı dalgası 23.

Bellek içi MemDB. Canlı veritabanına, 8021 portuna ve ağa bağlanmaz.
Konum, tutar, izin nedeni ve belge içeriği loglanmaz.
"""
from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import attendance  # noqa: E402
import event_notify  # noqa: E402
import location_consent  # noqa: E402
import notify  # noqa: E402
import tenant_access  # noqa: E402
import tenant_scope  # noqa: E402
import tenant_scope_allowlist as allowlist  # noqa: E402
from dashboard_memdb import MemColl, MemDB, _split_field_ops  # noqa: E402
from mysql_store import match_query  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
EMP = "emp-shared"
NAME_A = "Ali A"
SECRET = "GizliPersonelB"
SECRET_NOTE = "gizli-puantaj-b"
IN_A = "09:12"
IN_B = "07:41"
ATT = "att-shared"
DAY = "2026-10-21"
YDAY = "2026-10-20"
MON = "2026-10-19"
NEXT_MON = "2026-10-26"

_REMOVED = (
    ("attendance.py", "_on_leave_today", "leave_requests", "find_one"),
    ("attendance.py", "accept_location_consent", "employees", "update_one"),
    ("attendance.py", "accrue_task_yevmiye", "attendance", "update_one"),
    ("attendance.py", "accrue_task_yevmiye", "bonus_payments", "find_one"),
    ("attendance.py", "apply_day", "attendance", "find_one"),
    ("attendance.py", "apply_day", "shift_plans", "find_one"),
    ("attendance.py", "apply_location_exit_wage_deduction", "bonus_payments", "find_one"),
    ("attendance.py", "approve_attendance_device", "attendance_devices", "find_one"),
    ("attendance.py", "bulk_assign_shifts", "leave_requests", "find_one"),
    ("attendance.py", "bulk_assign_shifts", "shift_plans", "find_one"),
    ("attendance.py", "bulk_assign_shifts", "shift_templates", "find_one"),
    ("attendance.py", "cancel_early_leave_request", "attendance", "find_one"),
    ("attendance.py", "cancel_early_leave_request", "attendance", "update_one"),
    ("attendance.py", "cancel_intraday_leave_request", "attendance", "find_one"),
    ("attendance.py", "cancel_intraday_leave_request", "attendance", "update_one"),
    ("attendance.py", "cancel_my_advance", "bonus_payments", "delete_one"),
    ("attendance.py", "cancel_my_leave", "leave_requests", "delete_one"),
    ("attendance.py", "confirm_attendance", "attendance", "find_one"),
    ("attendance.py", "confirm_attendance", "attendance", "update_one"),
    ("attendance.py", "copy_week", "shift_plans", "update_one"),
    ("attendance.py", "create_my_leave", "leave_requests", "find"),
    ("attendance.py", "create_my_leave", "leave_requests", "find_one"),
    ("attendance.py", "dispute_attendance", "attendance", "find_one"),
    ("attendance.py", "dispute_attendance", "attendance", "update_one"),
    ("attendance.py", "employee_for_user", "employees", "find_one"),
    ("attendance.py", "employee_puantaj", "attendance", "find"),
    ("attendance.py", "employee_puantaj", "employees", "update_one"),
    ("attendance.py", "employee_puantaj", "leave_requests", "find"),
    ("attendance.py", "employee_puantaj", "leave_year_archives", "find"),
    ("attendance.py", "ensure_location_moves", "attendance", "update_one"),
    ("attendance.py", "ignore_employee_location_move", "attendance", "update_one"),
    ("attendance.py", "list_employee_location_moves", "attendance", "find"),
    ("attendance.py", "list_employee_overtime_moves", "attendance", "find"),
    ("attendance.py", "list_leave_years", "leave_requests", "find"),
    ("attendance.py", "list_leave_years", "leave_year_archives", "find"),
    ("attendance.py", "mark_employee_location_signal", "employees", "update_one"),
    ("attendance.py", "maybe_auto_checkout", "attendance", "update_one"),
    ("attendance.py", "maybe_open_location_exit", "attendance", "update_one"),
    ("attendance.py", "maybe_open_overtime_confirm", "attendance", "update_one"),
    ("attendance.py", "maybe_retract_auto_checkout", "attendance", "find_one"),
    ("attendance.py", "maybe_retract_auto_checkout", "attendance", "update_one"),
    ("attendance.py", "my_attendance", "attendance", "find"),
    ("attendance.py", "my_attendance", "attendance", "find_one"),
    ("attendance.py", "my_attendance", "shift_plans", "find"),
    ("attendance.py", "my_leaves", "leave_requests", "find"),
    ("attendance.py", "notify_managers", "attendance_alerts", "find_one"),
    ("attendance.py", "open_geo_confirm_request", "attendance", "find_one"),
    ("attendance.py", "open_geo_confirm_request", "attendance", "insert_one"),
    ("attendance.py", "open_geo_confirm_request", "attendance", "update_one"),
    ("attendance.py", "overtime_pay_for_period", "attendance", "find"),
    ("attendance.py", "process_auto_exit_overtime", "attendance", "find_one"),
    ("attendance.py", "process_auto_exit_overtime", "shift_plans", "find_one"),
    ("attendance.py", "punch_date_for_action", "attendance", "find_one"),
    ("attendance.py", "put_reminder_prefs", "employees", "update_one"),
    ("attendance.py", "put_shifts", "employees", "find_one"),
    ("attendance.py", "put_shifts", "leave_requests", "find_one"),
    ("attendance.py", "rehome_early_checkout", "attendance", "find_one"),
    ("attendance.py", "rehome_early_checkout", "attendance", "update_one"),
    ("attendance.py", "rehome_early_checkouts_for_company", "employees", "find"),
    ("attendance.py", "self_location_unavailable", "attendance", "find_one"),
    ("attendance.py", "self_task_site_presence", "attendance", "find_one"),
    ("attendance.py", "self_task_site_presence", "attendance", "update_one"),
    ("attendance.py", "self_task_site_presence", "employees", "update_one"),
    ("attendance.py", "sync_employee_presence_from_attendance", "employees", "update_one"),
    ("attendance.py", "sync_yevmiye_adjustment", "attendance", "update_one"),
    ("attendance.py", "sync_yevmiye_adjustment", "bonus_payments", "find_one"),
    ("attendance.py", "workplaces_by_employee", "employees", "find"),
)


def _run(coro):
    return asyncio.run(coro)


def _user():
    uid = "user-" + CO_A
    return {
        "_id": uid,
        "id": uid,
        "name": "Yonetici",
        "role": "admin",
        "is_active": True,
        "is_super_admin": False,
        "company_ids": [CO_A],
        "active_company_id": CO_A,
        "employee_id": EMP,
    }


def _add(db, coll, doc):
    db[coll].docs.append(copy.deepcopy(doc))


def _row(db, coll, company_id, doc_id):
    for doc in db[coll].docs:
        if doc.get("_id") == doc_id and doc.get("company_id") == company_id:
            return doc
    return None


def _digest(db, company_id):
    payload = []
    for name in sorted(db._cols):
        rows = [copy.deepcopy(d) for d in db._cols[name].docs if d.get("company_id") == company_id]
        if not rows:
            continue
        rows.sort(key=lambda d: json.dumps(d, sort_keys=True, default=str))
        payload.append([name, rows])
    raw = json.dumps(payload, sort_keys=True, default=str).encode()
    return hashlib.sha256(raw).hexdigest()


def _no_secret(blob):
    text = blob if isinstance(blob, str) else json.dumps(blob, ensure_ascii=False, default=str)
    assert SECRET not in text
    assert SECRET_NOTE not in text
    assert IN_B not in text


def _schedule():
    return {
        "start": "09:00",
        "end": "18:00",
        "break_minutes": 60,
        "work_days": [0, 1, 2, 3, 4, 5, 6],
        "timezone": "Europe/Istanbul",
        "require_geo": False,
        "late_tolerance_minutes": 0,
        "exit_tolerance_minutes": 0,
    }


def _company(company_id):
    return {
        "_id": company_id,
        "name": "FirmaA" if company_id == CO_A else "FirmaB",
        "work_schedule": _schedule(),
        "location": {
            "latitude": 41.015 if company_id == CO_A else 36.9,
            "longitude": 28.979 if company_id == CO_A else 30.7,
            "radius_m": 150,
            "label": "MerkezA" if company_id == CO_A else "MerkezB",
        },
    }


def _consent():
    return {"accept_kvkk": True, "accept_share": True, "accepted_at": "2026-01-01T00:00:00+00:00"}


def _employee(company_id, **extra):
    row = {
        "_id": EMP,
        "company_id": company_id,
        "full_name": NAME_A if company_id == CO_A else SECRET,
        "user_id": "user-" + CO_A,
        "status": "active",
        "daily_wage": 100 if company_id == CO_A else 777,
        "pay_type": "daily",
        "location_consent": _consent(),
        "annual_leave_days": 14,
        "leave_year": 2026,
        "used_leave_days": 0 if company_id == CO_A else 9,
        "leave_carry_days": 0,
        "location_last_ok": True,
        "location_last_inside": False,
        "notify_checkin_reminder": True,
    }
    row.update(extra)
    return row


def _attendance(company_id, **extra):
    row = {
        "_id": ATT,
        "company_id": company_id,
        "employee_id": EMP,
        "employee_name": NAME_A if company_id == CO_A else SECRET,
        "date": DAY,
        "status": "present",
        "check_in": IN_A if company_id == CO_A else IN_B,
        "check_out": None,
        "source": "self",
        "note": "" if company_id == CO_A else SECRET_NOTE,
        "overtime_hours": 1 if company_id == CO_A else 9,
    }
    row.update(extra)
    return row


def _shift(company_id, date, **extra):
    row = {
        "_id": "shift-" + company_id + "-" + date,
        "company_id": company_id,
        "employee_id": EMP,
        "date": date,
        "off": False,
        "start": "08:00" if company_id == CO_A else "23:00",
        "end": "18:00" if company_id == CO_A else "23:59",
        "note": "" if company_id == CO_A else SECRET_NOTE,
    }
    row.update(extra)
    return row


def _seed_people(db, employee_order="b-first"):
    _add(db, "companies", _company(CO_B))
    _add(db, "companies", _company(CO_A))
    order = (CO_B, CO_A) if employee_order == "b-first" else (CO_A, CO_B)
    for company_id in order:
        _add(db, "employees", _employee(company_id))


def _move(move_id, place, kind="lost"):
    return attendance.build_location_move(
        kind=kind, at=DAY + "T12:00:00", place=place, ignorable=True, move_id=move_id,
    )


async def _own(db_arg, collection, doc_id, actor, **kwargs):
    allowed = {str(item) for item in (actor.get("company_ids") or [])}
    for row in db_arg[collection].docs:
        if str(row.get("_id")) == str(doc_id) and str(row.get("company_id") or "") in allowed:
            return copy.deepcopy(row)
    raise HTTPException(status_code=404, detail=kwargs.get("not_found") or "Kayıt bulunamadı.")


async def _delete_one(self, query=None):
    tenant_scope.check(self.name, "delete_one", query=query)
    folded = _split_field_ops(query or {})
    for index, doc in enumerate(list(self.docs)):
        if match_query(doc, folded):
            del self.docs[index]
            return SimpleNamespace(deleted_count=1)
    return SimpleNamespace(deleted_count=0)


async def _noop(*_args, **_kwargs):
    return None


async def _inapp(*_args, **_kwargs):
    return True


async def _mail(*_args, **_kwargs):
    return {"status": "skipped"}


def _bind(db, monkeypatch, user=None):
    user = user or _user()
    prev = (attendance._db, attendance._current_user, event_notify._db, tenant_access.get_tenant_doc)

    async def _current(_request=None):
        return user

    attendance._db = db
    attendance._current_user = _current
    event_notify._db = db
    monkeypatch.setattr(tenant_access, "get_tenant_doc", _own)
    monkeypatch.setattr(MemColl, "delete_one", _delete_one, raising=False)
    monkeypatch.setattr(notify, "insert_notification", _noop)
    monkeypatch.setattr(notify, "dispatch_push", _noop)
    monkeypatch.setattr(event_notify, "inapp_enabled", _inapp)
    monkeypatch.setattr(event_notify, "queue_event_email", _mail)
    monkeypatch.setattr(attendance, "_today", lambda schedule=None: DAY)
    monkeypatch.setattr(attendance, "now_hm", lambda schedule=None: "10:00")
    return prev


def _restore(prev):
    attendance._db, attendance._current_user, event_notify._db, tenant_access.get_tenant_doc = prev
    tenant_scope.reset_violations()


def test_lookup_pay_and_presence_stay_inside_company(monkeypatch):
    user = _user()
    db = MemDB()
    _seed_people(db)
    _add(db, "attendance", _attendance(CO_B, status="present", overtime_hours=9))
    _add(db, "attendance", _attendance(CO_A, status="present", overtime_hours=1, is_off_day=False))
    prev = _bind(db, monkeypatch, user)
    try:
        before = _digest(db, CO_B)
        found = _run(attendance.employee_for_user(user))
        assert found["full_name"] == NAME_A
        assert found["company_id"] == CO_A
        pay = _run(attendance.overtime_pay_for_period(_company(CO_A), found, "2026-10"))
        assert pay["overtime_hours"] == 1
        assert pay["amount"] != 0 or pay["weekday_hours"] == 1
        _no_secret(pay)
        signal = _run(attendance.mark_employee_location_signal(EMP, False, CO_A))
        assert signal["ok"] is False
        assert _row(db, "employees", CO_A, EMP)["location_last_ok"] is False
        assert _row(db, "employees", CO_B, EMP)["location_last_ok"] is True
        patch = _run(attendance.sync_employee_presence_from_attendance(
            found, _attendance(CO_A, check_out=None), _schedule(),
        ))
        assert patch["location_last_inside"] is True
        assert _row(db, "employees", CO_A, EMP)["location_last_inside"] is True
        assert _row(db, "employees", CO_B, EMP)["location_last_inside"] is False
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_workplaces_use_caller_company_duty(monkeypatch):
    db = MemDB()
    _add(db, "companies", _company(CO_A))
    _add(db, "companies", _company(CO_B))
    _add(db, "employees", _employee(CO_A, active_duty={"kind": "field", "task_id": "task-a", "title": "SahaA"}))
    _add(db, "employees", _employee(CO_B, active_duty={"kind": "office", "title": SECRET}))
    _add(db, "projects", {
        "_id": "proj-a",
        "company_id": CO_A,
        "name": "ProjeA",
        "status": "active",
        "latitude": 41.02,
        "longitude": 29.01,
        "radius_m": 120,
        "tasks": [{"id": "task-a", "assignee_id": EMP, "title": "SahaA", "kind": "field", "status": "open"}],
    })
    _add(db, "projects", {
        "_id": "proj-b",
        "company_id": CO_B,
        "name": SECRET,
        "status": "active",
        "tasks": [{"id": "task-b", "assignee_id": EMP, "title": SECRET, "kind": "field", "status": "open"}],
    })
    prev = _bind(db, monkeypatch)
    try:
        before = _digest(db, CO_B)
        out = _run(attendance.workplaces_by_employee(CO_A, [EMP], DAY, _company(CO_A)["location"]))
        assert out[EMP]["kind"] == "task"
        assert out[EMP]["task_title"] == "SahaA"
        _no_secret(out)
        assert _row(db, "employees", CO_B, EMP)["active_duty"]["title"] == SECRET
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_apply_rehome_and_punch_date_ignore_other_company(monkeypatch):
    db = MemDB()
    _seed_people(db)
    _add(db, "shift_plans", _shift(CO_B, DAY, end="23:59", note=SECRET_NOTE))
    _add(db, "shift_plans", _shift(CO_A, DAY, end="17:00"))
    _add(db, "attendance", _attendance(CO_B, check_in=None, check_out="07:00", note=SECRET_NOTE))
    _add(db, "attendance", _attendance(CO_A, check_in=IN_A, check_out=None, note=""))
    _add(db, "attendance", _attendance(CO_B, _id="att-y-b", date=YDAY, check_in="09:00", check_out=None, note=SECRET_NOTE))
    _add(db, "attendance", _attendance(CO_A, _id="att-y-a", date=YDAY, check_in="09:00", check_out="18:00"))
    emp = _employee(CO_A)
    prev = _bind(db, monkeypatch)
    try:
        before = _digest(db, CO_B)
        saved = _run(attendance.apply_day(emp, DAY, {"check_in": "09:30", "status": "present"}, source="manual"))
        assert saved["check_in"] == "09:30"
        assert saved["company_id"] == CO_A
        assert _row(db, "attendance", CO_B, ATT)["check_out"] == "07:00"
        assert _row(db, "attendance", CO_B, ATT)["note"] == SECRET_NOTE
        assert _row(db, "shift_plans", CO_B, "shift-" + CO_B + "-" + DAY)["note"] == SECRET_NOTE

        punch = _run(attendance.punch_date_for_action(emp, _schedule(), "check_out", "07:30", DAY))
        assert punch == DAY
        assert _row(db, "attendance", CO_B, "att-y-b")["check_out"] in (None, "")
        assert _digest(db, CO_B) == before

        gcr = {"status": "pending", "action": "check_out", "proposed_time": "07:00"}
        _row(db, "attendance", CO_A, ATT)["geo_confirm_request"] = dict(gcr)
        _row(db, "attendance", CO_A, ATT)["check_out"] = "18:00"
        _row(db, "attendance", CO_B, ATT)["geo_confirm_request"] = {"status": "pending", "action": "check_out", "proposed_time": "07:00", "place": SECRET}
        _row(db, "attendance", CO_B, ATT)["check_out"] = "18:00"
        before = _digest(db, CO_B)
        moved = _run(attendance.rehome_early_checkout(emp, DAY, _schedule(), proposed_in="09:30"))
        assert moved is True
        assert "geo_confirm_request" not in _row(db, "attendance", CO_A, ATT)
        assert _row(db, "attendance", CO_B, ATT)["geo_confirm_request"]["place"] == SECRET

        _add(db, "attendance", _attendance(
            CO_A, _id="att-night-a", check_in=None, check_out="18:00", note="",
        ))
        count = _run(attendance.rehome_early_checkouts_for_company(_company(CO_A), DAY))
        assert count == 0
        assert _row(db, "attendance", CO_B, ATT)["note"] == SECRET_NOTE
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_auto_exit_helpers_write_only_caller_company(monkeypatch):
    db = MemDB()
    _seed_people(db)
    _add(db, "shift_plans", _shift(CO_B, DAY, end="23:59"))
    _add(db, "shift_plans", _shift(CO_A, DAY, end="18:00"))
    _add(db, "attendance", _attendance(CO_B, check_in=None, check_out=IN_B, note=SECRET_NOTE))
    _add(db, "attendance", _attendance(CO_A, check_in="09:00", check_out=None, note=""))
    emp = _employee(CO_A)
    company = _company(CO_A)
    schedule = _schedule()
    prev = _bind(db, monkeypatch)
    try:
        before = _digest(db, CO_B)
        out = _run(attendance.process_auto_exit_overtime(
            emp, company, schedule, None, date=DAY, now_s="19:00",
        ))
        assert out["auto_checkout"] is True
        assert _row(db, "attendance", CO_A, ATT).get("check_out") == "18:00"
        assert _row(db, "attendance", CO_B, ATT).get("check_out") == IN_B
        assert _row(db, "shift_plans", CO_B, "shift-" + CO_B + "-" + DAY)["end"] == "23:59"

        db2 = MemDB()
        _seed_people(db2)
        _add(db2, "attendance", _attendance(
            CO_B, check_in="09:00", check_out="18:00", auto_checkout=True, auto_checkout_end="18:00", note=SECRET_NOTE,
        ))
        _add(db2, "attendance", _attendance(
            CO_A, check_in="09:00", check_out="18:00", auto_checkout=True, auto_checkout_end="18:00",
            assigned_overtime_hours=2, note="",
        ))
        attendance._db = db2
        before_b = _digest(db2, CO_B)
        retracted = _run(attendance.maybe_retract_auto_checkout(
            emp, schedule, _attendance(CO_A, check_in="09:00", check_out="18:00", auto_checkout=True,
                                       auto_checkout_end="18:00", assigned_overtime_hours=2),
            date=DAY, now_s="19:00",
        ))
        assert retracted is not None
        assert _row(db2, "attendance", CO_A, ATT).get("check_out") in (None, "")
        assert _row(db2, "attendance", CO_B, ATT).get("check_out") == "18:00"
        assert _row(db2, "attendance", CO_B, ATT)["note"] == SECRET_NOTE
        assert _digest(db2, CO_B) == before_b

        db3 = MemDB()
        _seed_people(db3)
        _add(db3, "attendance", _attendance(CO_B, check_in="09:00", check_out=None, note=SECRET_NOTE))
        _add(db3, "attendance", _attendance(CO_A, check_in="09:00", check_out=None, note=""))
        attendance._db = db3
        before_c = _digest(db3, CO_B)
        auto = _run(attendance.maybe_auto_checkout(
            emp, schedule, dict(_row(db3, "attendance", CO_A, ATT)), date=DAY, now_s="19:00",
        ))
        assert auto is not None
        assert _row(db3, "attendance", CO_A, ATT).get("check_out") == "18:00"
        assert _row(db3, "attendance", CO_B, ATT).get("check_out") in (None, "")
        assert _digest(db3, CO_B) == before_c

        db4 = MemDB()
        _seed_people(db4)
        _add(db4, "attendance", _attendance(CO_B, check_in="09:00", check_out=None, note=SECRET_NOTE))
        _add(db4, "attendance", _attendance(CO_A, check_in="09:00", check_out=None, note=""))
        attendance._db = db4
        before_d = _digest(db4, CO_B)
        opened = _run(attendance.maybe_open_overtime_confirm(
            emp, dict(_row(db4, "attendance", CO_A, ATT)), schedule,
            {"enabled": True, "exit_tolerance_hours": 0},
            location_active=True, date=DAY, now_s="19:00",
        ))
        assert opened and opened.get("status") == "pending"
        assert _row(db4, "attendance", CO_A, ATT).get("overtime_confirm_request")
        assert not _row(db4, "attendance", CO_B, ATT).get("overtime_confirm_request")
        assert _digest(db4, CO_B) == before_d
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_location_moves_and_yevmiye_stay_inside_company(monkeypatch):
    db = MemDB()
    _seed_people(db)
    secret_move = _move("mv-b", SECRET)
    own_move = _move("mv-a", "MerkezA")
    _add(db, "attendance", _attendance(CO_B, location_moves=[secret_move], note=SECRET_NOTE))
    _add(db, "attendance", _attendance(CO_A, location_moves=[own_move], check_in="09:00", note=""))
    _add(db, "bonus_payments", {
        "_id": "bon-shared", "company_id": CO_B, "employee_id": EMP, "type": "yevmiye",
        "source": "attendance", "date": DAY, "amount": 777, "status": "paid", "note": SECRET_NOTE,
    })
    emp = _employee(CO_A)
    prev = _bind(db, monkeypatch)
    try:
        before = _digest(db, CO_B)
        ignored = _run(attendance.ignore_employee_location_move(ATT, "mv-a", user=_user()))
        assert ignored["status"] == "success"
        assert _row(db, "attendance", CO_A, ATT)["location_moves"][0]["ignored"] is True
        assert _row(db, "attendance", CO_B, ATT)["location_moves"][0]["place"] == SECRET
        assert _row(db, "attendance", CO_B, ATT)["location_moves"][0]["ignored"] is False

        bare = dict(_row(db, "attendance", CO_A, ATT))
        bare.pop("location_moves", None)
        moves = _run(attendance.ensure_location_moves(bare))
        assert moves
        assert _row(db, "attendance", CO_B, ATT)["location_moves"][0]["place"] == SECRET
        assert _row(db, "attendance", CO_A, ATT)["location_moves"]

        workplace = {
            "kind": "task", "has_coords": True,
            "latitude": 41.015, "longitude": 28.979, "radius_m": 80, "label": "SahaA",
        }
        opened = _run(attendance.maybe_open_location_exit(
            emp, dict(_row(db, "attendance", CO_A, ATT)), workplace, workplace,
            {"enabled": True, "exit_tolerance_hours": 0}, 39.0, 32.0,
        ))
        assert opened and opened.get("status") == "pending"
        assert not _row(db, "attendance", CO_B, ATT).get("location_exit_request")
        inside = dict(_row(db, "attendance", CO_A, ATT))
        inside["location_left_at"] = DAY + "T11:00:00"
        _run(attendance.maybe_open_location_exit(
            emp, inside, workplace, workplace,
            {"enabled": True, "exit_tolerance_hours": 0}, 41.015, 28.979,
        ))
        assert "location_left_at" not in _row(db, "attendance", CO_A, ATT)
        assert not _row(db, "attendance", CO_B, ATT).get("location_left_at")

        listed = _run(attendance.list_employee_location_moves(EMP, "all", user=_user()))
        _no_secret(listed)
        assert listed["count"] >= 1
        overtime = _run(attendance.list_employee_overtime_moves(EMP, "all", user=_user()))
        _no_secret(overtime)
        assert overtime["items"][0]["hours"] == 1

        rec = dict(_row(db, "attendance", CO_A, ATT))
        rec["id"] = ATT
        bonus = _run(attendance.accrue_task_yevmiye(emp, rec, {"kind": "task"}, _schedule()))
        assert bonus["company_id"] == CO_A
        assert bonus["amount"] == 100
        assert bonus["_id"] != "bon-shared"
        assert _row(db, "bonus_payments", CO_B, "bon-shared")["amount"] == 777
        assert _row(db, "bonus_payments", CO_B, "bon-shared")["note"] == SECRET_NOTE

        _add(db, "bonus_payments", {
            "_id": "bon-adj", "company_id": CO_A, "employee_id": EMP, "type": "yevmiye",
            "source": "attendance", "status": "pending", "amount": 100, "daily_wage": 100, "date": DAY,
        })
        rec = dict(_row(db, "attendance", CO_A, ATT))
        rec["id"] = ATT
        rec["yevmiye_bonus_id"] = "bon-adj"
        rec["yevmiye_full_amount"] = 100
        rec["late_minutes"] = 60
        _run(attendance.sync_yevmiye_adjustment(emp, rec, _schedule()))
        assert _row(db, "attendance", CO_A, ATT)["yevmiye_adjustment_request"]["status"] == "pending"
        assert _row(db, "bonus_payments", CO_B, "bon-shared")["status"] == "paid"

        ler = {"deduction_bonus_id": "bon-shared"}
        out_ler = _run(attendance.apply_location_exit_wage_deduction(emp, rec, ler))
        assert out_ler["deduction_bonus_id"] != "bon-shared"
        assert _row(db, "bonus_payments", CO_B, "bon-shared")["amount"] == 777
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_self_service_reads_and_writes_stay_inside_company(monkeypatch):
    db = MemDB()
    _seed_people(db)
    _add(db, "shift_plans", _shift(CO_B, DAY, note=SECRET_NOTE))
    _add(db, "shift_plans", _shift(CO_A, DAY, end="18:00", note=""))
    _add(db, "attendance", _attendance(CO_B, location_moves=[_move("mv-b", SECRET)], note=SECRET_NOTE))
    _add(db, "attendance", _attendance(
        CO_A, location_moves=[_move("mv-a", "MerkezA")], check_in=IN_A, note="",
        early_leave_request={"status": "pending", "reason": "doktor"},
        intraday_leave_request={"status": "pending", "reason": "banka", "out_time": "13:00", "return_time": "14:00"},
    ))
    _row_b = _attendance(CO_B, note=SECRET_NOTE, location_moves=[_move("mv-b", SECRET)])
    _row_b["early_leave_request"] = {"status": "pending", "reason": SECRET}
    _row_b["intraday_leave_request"] = {"status": "pending", "reason": SECRET}
    db.attendance.docs[0] = _row_b
    prev = _bind(db, monkeypatch)

    async def _fields(emp):
        if str(emp.get("company_id") or "") != CO_A:
            return []
        return [{
            "id": "task-a", "title": "SahaA", "kind": "field", "status": "open",
            "latitude": 41.015, "longitude": 28.979, "radius_m": 200, "project_name": "ProjeA",
        }]

    monkeypatch.setattr(attendance, "field_assignments_for", _fields)
    try:
        before = _digest(db, CO_B)
        mine = _run(attendance.my_attendance(None))
        _no_secret(mine)
        assert mine["today"]["check_in"] == IN_A
        assert mine["records"][0]["check_in"] == IN_A

        geo = _run(attendance.open_geo_confirm_request(
            _employee(CO_A), _user(), dict(_row(db, "attendance", CO_A, ATT)), DAY, "check_in", "10:05",
            {"verdict": "time_edit", "place": "MerkezA"}, None, None, None, None, reason="time_edit",
        ))
        assert geo["status"] == "pending"
        _no_secret(geo)
        assert _row(db, "attendance", CO_A, ATT).get("geo_confirm_request")
        assert not _row(db, "attendance", CO_B, ATT).get("geo_confirm_request")

        site = _run(attendance.self_task_site_presence(
            {"task_id": "task-a", "latitude": 41.015, "longitude": 28.979}, None,
        ))
        assert site["recorded"] is True
        assert site["onsite"] is True
        _no_secret(site)
        assert _row(db, "attendance", CO_A, ATT).get("task_site_presence", {}).get("task_id") == "task-a"
        assert not _row(db, "attendance", CO_B, ATT).get("task_site_presence")
        assert _row(db, "employees", CO_A, EMP)["location_last_inside"] is True
        assert _row(db, "employees", CO_B, EMP)["location_last_inside"] is False

        lost = _run(attendance.self_location_unavailable({"reason": "gps kapali"}, None))
        assert lost["status"] == "success"
        assert _row(db, "employees", CO_A, EMP)["location_last_ok"] is False
        assert _row(db, "employees", CO_B, EMP)["location_last_ok"] is True
        assert _row(db, "attendance", CO_B, ATT)["location_moves"][0]["place"] == SECRET

        consent = _run(attendance.accept_location_consent({"accept_kvkk": True, "accept_share": True}, None))
        assert consent["status"] == "success"
        assert location_consent.location_consent_accepted(_row(db, "employees", CO_A, EMP))
        assert location_consent.location_consent_accepted(_row(db, "employees", CO_B, EMP))

        early = _run(attendance.cancel_early_leave_request(None))
        intra = _run(attendance.cancel_intraday_leave_request(None))
        assert early["status"] == "success"
        assert intra["status"] == "success"
        assert not _row(db, "attendance", CO_A, ATT).get("early_leave_request")
        assert not _row(db, "attendance", CO_B, ATT).get("early_leave_request") or _row(db, "attendance", CO_B, ATT)["early_leave_request"]["reason"] == SECRET
        assert _row(db, "attendance", CO_B, ATT)["early_leave_request"]["reason"] == SECRET
        assert _row(db, "attendance", CO_B, ATT)["intraday_leave_request"]["reason"] == SECRET

        prefs = _run(attendance.put_reminder_prefs({"notify_checkin_reminder": False}, None))
        assert prefs["status"] == "success"
        assert _row(db, "employees", CO_A, EMP)["notify_checkin_reminder"] is False
        assert _row(db, "employees", CO_B, EMP)["notify_checkin_reminder"] is True
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_confirm_dispute_notify_and_device_stay_inside_company(monkeypatch):
    db = MemDB()
    _seed_people(db)
    _add(db, "attendance", _attendance(CO_B, employee_confirmed=False, note=SECRET_NOTE))
    _add(db, "attendance", _attendance(CO_A, employee_confirmed=False, note=""))
    _add(db, "attendance_alerts", {"_id": f"{CO_A}:k1", "company_id": CO_B, "type": "kept", "note": SECRET_NOTE})
    _add(db, "attendance_devices", {
        "_id": "dev-shared", "company_id": CO_B, "employee_id": EMP, "device_id": "phone-b", "status": "pending",
    })
    _add(db, "attendance_devices", {
        "_id": "dev-shared", "company_id": CO_A, "employee_id": EMP, "device_id": "phone-a", "status": "pending",
    })
    user = _user()
    prev = _bind(db, monkeypatch, user)
    try:
        before = _digest(db, CO_B)
        confirmed = _run(attendance.confirm_attendance(ATT, {}, user))
        assert confirmed["employee_confirmed"] is True
        _no_secret(confirmed)
        assert _row(db, "attendance", CO_B, ATT)["employee_confirmed"] is False
        assert _row(db, "attendance", CO_B, ATT)["note"] == SECRET_NOTE

        disputed = _run(attendance.dispute_attendance(ATT, {"note": "saat hatali"}, user))
        assert disputed["dispute_note"] == "saat hatali"
        _no_secret(disputed)
        assert not _row(db, "attendance", CO_B, ATT).get("dispute_note")

        sent = _run(attendance.notify_managers(CO_A, "attendance_late", "Gec", "Ali gec kaldi", dedupe_key="k1"))
        assert sent["status"] == "sent"
        assert _row(db, "attendance_alerts", CO_B, f"{CO_A}:k1")["type"] == "kept"
        assert any(doc.get("company_id") == CO_A and doc.get("_id") == f"{CO_A}:k1" for doc in db.attendance_alerts.docs)

        on_leave = _run(attendance._on_leave_today(EMP, DAY, CO_A))
        assert on_leave is False
        assert _digest(db, CO_B) == before
        _add(db, "leave_requests", {
            "_id": "lv-b", "company_id": CO_B, "employee_id": EMP, "status": "approved", "type": "annual",
            "start_date": DAY, "end_date": DAY, "days": 5, "reason": SECRET,
        })
        assert _run(attendance._on_leave_today(EMP, DAY, CO_A)) is False
        _add(db, "leave_requests", {
            "_id": "lv-a", "company_id": CO_A, "employee_id": EMP, "status": "approved", "type": "annual",
            "start_date": DAY, "end_date": DAY, "days": 1, "reason": "izin-a",
        })
        assert _run(attendance._on_leave_today(EMP, DAY, CO_A)) is True
        assert _row(db, "leave_requests", CO_B, "lv-b")["days"] == 5
        before = _digest(db, CO_B)

        approved = _run(attendance.approve_attendance_device("dev-shared", None))
        assert approved["status"] == "success"
        assert _row(db, "attendance_devices", CO_A, "dev-shared")["status"] == "active"
        assert _row(db, "attendance_devices", CO_B, "dev-shared")["status"] == "pending"
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_shifts_leaves_and_puantaj_stay_inside_company(monkeypatch):
    db = MemDB()
    _seed_people(db)
    _add(db, "attendance", _attendance(CO_B, note=SECRET_NOTE, overtime_hours=9))
    _add(db, "attendance", _attendance(CO_A, note="", overtime_hours=1, check_in=IN_A))
    _add(db, "leave_requests", {
        "_id": "lv-shared", "company_id": CO_B, "employee_id": EMP, "status": "approved", "type": "annual",
        "start_date": "2026-10-01", "end_date": "2026-10-01", "days": 5, "reason": SECRET, "created_at": "2026-10-01T00:00:00+00:00",
    })
    _add(db, "leave_requests", {
        "_id": "lv-year-a", "company_id": CO_A, "employee_id": EMP, "status": "approved", "type": "annual",
        "start_date": "2026-10-02", "end_date": "2026-10-02", "days": 1, "reason": "izin-a", "created_at": "2026-10-02T00:00:00+00:00",
    })
    _add(db, "leave_year_archives", {
        "_id": "arch-shared", "company_id": CO_B, "employee_id": EMP, "year": 2024, "used": 9, "note": SECRET_NOTE,
    })
    _add(db, "leave_year_archives", {
        "_id": "arch-shared", "company_id": CO_A, "employee_id": EMP, "year": 2025, "used": 1, "note": "",
    })
    _add(db, "shift_plans", _shift(CO_B, DAY, _id="shift-shared", start="23:00", end="23:59", note=SECRET_NOTE))
    _add(db, "shift_plans", _shift(CO_A, DAY, _id="shift-shared", start="01:00", end="02:00", note=""))
    _add(db, "shift_plans", _shift(CO_B, NEXT_MON, _id="shift-dst", start="23:00", end="23:59", note=SECRET_NOTE))
    _add(db, "shift_plans", _shift(CO_A, NEXT_MON, _id="shift-dst", start="01:00", end="02:00", note=""))
    _add(db, "shift_plans", _shift(CO_B, MON, _id="shift-mon", start="23:00", end="23:59", note=SECRET_NOTE))
    _add(db, "shift_plans", _shift(CO_A, MON, _id="shift-mon", start="01:00", end="02:00", note=""))
    _add(db, "shift_plans", _shift(CO_A, MON, _id="shift-src", start="08:00", end="17:00", note=""))
    _add(db, "shift_templates", {
        "_id": "tpl-shared", "company_id": CO_B, "name": SECRET,
        "days": {"0": {"off": True}},
    })
    _add(db, "shift_templates", {
        "_id": "tpl-shared", "company_id": CO_A, "name": "SablonA",
        "days": {"0": {"off": False, "start": "09:00", "end": "18:00", "break_minutes": 60}},
    })
    _add(db, "bonus_payments", {
        "_id": "adv-shared", "company_id": CO_B, "employee_id": EMP, "type": "advance", "source": "self",
        "status": "pending", "amount": 900, "note": SECRET_NOTE,
    })
    _add(db, "bonus_payments", {
        "_id": "adv-shared", "company_id": CO_A, "employee_id": EMP, "type": "advance", "source": "self",
        "status": "pending", "amount": 40, "note": "yol",
    })
    _add(db, "leave_requests", {
        "_id": "lv-cancel", "company_id": CO_B, "employee_id": EMP, "status": "pending", "type": "annual",
        "start_date": "2026-12-01", "end_date": "2026-12-01", "days": 1, "reason": SECRET,
    })
    _add(db, "leave_requests", {
        "_id": "lv-cancel", "company_id": CO_A, "employee_id": EMP, "status": "pending", "type": "annual",
        "start_date": "2026-12-02", "end_date": "2026-12-02", "days": 1, "reason": "iptal-a",
    })
    _add(db, "leave_requests", {
        "_id": "lv-overlap-b", "company_id": CO_B, "employee_id": EMP, "status": "approved", "type": "annual",
        "start_date": "2026-11-02", "end_date": "2026-11-02", "days": 5, "reason": SECRET,
    })
    user = _user()
    prev = _bind(db, monkeypatch, user)
    try:
        before = _digest(db, CO_B)
        card = _run(attendance.employee_puantaj(EMP, "2026-10", user))
        _no_secret(card)
        assert card["employee_name"] == NAME_A
        assert _row(db, "employees", CO_A, EMP)["used_leave_days"] == 1
        assert _row(db, "employees", CO_B, EMP)["used_leave_days"] == 9
        assert _row(db, "attendance", CO_B, ATT)["note"] == SECRET_NOTE

        years = _run(attendance.list_leave_years(EMP, user))
        _no_secret(years)
        assert years["archives"][0]["year"] == 2025 or years["archives"][-1]["used"] != 9
        assert all(item.get("note") != SECRET_NOTE for item in years["archives"])

        mine = _run(attendance.my_leaves(None))
        _no_secret(mine)
        assert any(item.get("reason") == "izin-a" for item in mine["leaves"])
        assert all(item.get("reason") != SECRET for item in mine["leaves"])

        created = _run(attendance.create_my_leave({
            "type": "annual", "start_date": "2026-11-02", "end_date": "2026-11-02", "days": 1, "reason": "yeni",
        }, None))
        assert created["company_id"] == CO_A
        assert created["reason"] == "yeni"
        assert _row(db, "leave_requests", CO_B, "lv-overlap-b")["days"] == 5

        _run(attendance.cancel_my_leave("lv-cancel", user))
        assert _row(db, "leave_requests", CO_B, "lv-cancel")["status"] == "pending"
        assert _row(db, "leave_requests", CO_B, "lv-cancel")["reason"] == SECRET
        assert _row(db, "leave_requests", CO_A, "lv-cancel") is None

        _run(attendance.cancel_my_advance("adv-shared", user))
        assert _row(db, "bonus_payments", CO_B, "adv-shared")["amount"] == 900
        assert _row(db, "bonus_payments", CO_B, "adv-shared")["note"] == SECRET_NOTE
        assert _row(db, "bonus_payments", CO_A, "adv-shared") is None

        saved = _run(attendance.put_shifts({
            "company_id": CO_A,
            "items": [{"employee_id": EMP, "date": DAY, "off": False, "start": "08:30", "end": "17:30", "break_minutes": 30}],
        }, user))
        assert saved["saved"] == 1
        assert saved["warnings"] == []
        assert _row(db, "shift_plans", CO_A, "shift-shared")["start"] == "08:30"
        assert _row(db, "shift_plans", CO_B, "shift-shared")["start"] == "23:00"
        assert _row(db, "shift_plans", CO_B, "shift-shared")["note"] == SECRET_NOTE

        copied = _run(attendance.copy_week({"company_id": CO_A, "from_week_start": MON, "to_week_start": NEXT_MON}, user))
        assert copied["copied"] >= 1
        assert _row(db, "shift_plans", CO_A, "shift-dst")["start"] == "08:00"
        assert _row(db, "shift_plans", CO_B, "shift-dst")["start"] == "23:00"
        assert _row(db, "shift_plans", CO_B, "shift-dst")["note"] == SECRET_NOTE

        bulk = _run(attendance.bulk_assign_shifts({
            "company_id": CO_A, "week_start": MON, "template_id": "tpl-shared", "employee_ids": [EMP],
        }, user))
        assert bulk["saved"] >= 1
        assert _row(db, "shift_plans", CO_A, "shift-mon")["start"] == "09:00"
        assert _row(db, "shift_plans", CO_A, "shift-mon")["off"] is False
        assert _row(db, "shift_plans", CO_B, "shift-mon")["start"] == "23:00"
        assert _row(db, "shift_plans", CO_B, "shift-mon")["note"] == SECRET_NOTE
        assert _row(db, "shift_templates", CO_B, "tpl-shared")["name"] == SECRET
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_wave23_baseline_keys_removed():
    base = allowlist.TENANT_SCOPE_BASELINE
    present = [key for key in _REMOVED if key in base]
    assert present == []
    assert len(_REMOVED) == 67
    assert len(set(_REMOVED)) == 67
    assert all(key[0] == "attendance.py" for key in _REMOVED)
    assert sum(1 for key in base if key[0] == "attendance.py") == 67 - len(_REMOVED)
    script = _BACKEND / "scripts" / "tenant_scope_baseline.py"
    proc = subprocess.run(
        [sys.executable, str(script), "--check"],
        cwd=str(_BACKEND.parent),
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "temiz" in proc.stdout
