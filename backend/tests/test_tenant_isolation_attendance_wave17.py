"""Puantaj yönetici kararları kiracı dalgası 17.

Bellek içi MemDB. Canlı veritabanına, 8021 portuna ve ağa bağlanmaz.
Tutar, yevmiye, kesinti, şirket kimliği ve belge içeriği loglanmaz.
"""
from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import attendance  # noqa: E402
import notify  # noqa: E402
import personnel_wage  # noqa: E402
import tenant_scope  # noqa: E402
import tenant_scope_allowlist as allowlist  # noqa: E402
from dashboard_memdb import MemDB  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
EMP = "emp-shared"
BONUS = "bonus-shared"
BONUS_B = "bonus-b-only"
NAME_A = "Ali A"
SECRET_NAME = "GizliPersonelB"
SECRET_NOTE = "gizli-prim-notu-b"
ATT_B = "att-b-yest"

_REMOVED = (
    ("attendance.py", "decide_attendance_dispute", "attendance", "find_one"),
    ("attendance.py", "decide_attendance_dispute", "attendance", "update_one"),
    ("attendance.py", "decide_attendance_dispute", "employees", "find_one"),
    ("attendance.py", "decide_early_leave", "attendance", "find_one"),
    ("attendance.py", "decide_early_leave", "attendance", "update_one"),
    ("attendance.py", "decide_early_leave", "employees", "find_one"),
    ("attendance.py", "decide_geo_confirm", "attendance", "find_one"),
    ("attendance.py", "decide_geo_confirm", "attendance", "update_one"),
    ("attendance.py", "decide_geo_confirm", "employees", "find_one"),
    ("attendance.py", "decide_intraday_leave", "attendance", "find_one"),
    ("attendance.py", "decide_intraday_leave", "attendance", "update_one"),
    ("attendance.py", "decide_intraday_leave", "employees", "find_one"),
    ("attendance.py", "decide_location_exit", "attendance", "find_one"),
    ("attendance.py", "decide_location_exit", "attendance", "update_one"),
    ("attendance.py", "decide_location_exit", "employees", "find_one"),
    ("attendance.py", "decide_overtime_confirm", "attendance", "find_one"),
    ("attendance.py", "decide_overtime_confirm", "attendance", "update_one"),
    ("attendance.py", "decide_overtime_confirm", "employees", "find_one"),
    ("attendance.py", "decide_time_edit", "attendance", "find_one"),
    ("attendance.py", "decide_time_edit", "attendance", "update_one"),
    ("attendance.py", "decide_time_edit", "employees", "find_one"),
    ("attendance.py", "decide_yevmiye_adjustment", "attendance", "update_one"),
    ("attendance.py", "decide_yevmiye_adjustment", "bonus_payments", "update_one"),
    ("attendance.py", "decide_yevmiye_adjustment", "employees", "find_one"),
)

_ENDPOINTS = (
    attendance.decide_geo_confirm,
    attendance.decide_location_exit,
    attendance.decide_overtime_confirm,
    attendance.decide_yevmiye_adjustment,
    attendance.decide_early_leave,
    attendance.decide_intraday_leave,
    attendance.decide_time_edit,
    attendance.decide_attendance_dispute,
)


def _run(coro):
    return asyncio.run(coro)


def _user(company_id):
    uid = "user-" + company_id
    return {
        "_id": uid,
        "id": uid,
        "name": "Yonetici",
        "role": "admin",
        "is_active": True,
        "is_super_admin": False,
        "company_ids": [company_id],
        "active_company_id": company_id,
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


def _company(company_id):
    if company_id == CO_A:
        schedule = {"start": "09:00", "end": "18:00", "break_minutes": 60, "work_days": [0, 1, 2, 3, 4]}
        name = "FirmaA"
    else:
        schedule = {"start": "09:00", "end": "13:00", "break_minutes": 0, "work_days": [0, 1, 2, 3, 4]}
        name = "FirmaB"
    return {"_id": company_id, "name": name, "work_schedule": schedule}


def _employee(company_id):
    row = {
        "_id": EMP,
        "company_id": company_id,
        "full_name": NAME_A if company_id == CO_A else SECRET_NAME,
        "user_id": "user-emp-" + company_id,
        "daily_wage": 100 if company_id == CO_A else 777,
        "pay_type": "daily",
    }
    if company_id == CO_B:
        row["work_schedule"] = {"start": "09:00", "end": "13:00", "break_minutes": 0}
    return row


def _bonus(company_id, doc_id=BONUS, **extra):
    row = {
        "_id": doc_id,
        "company_id": company_id,
        "employee_id": EMP,
        "amount": 100 if company_id == CO_A else 900,
        "daily_wage": 100 if company_id == CO_A else 900,
        "note": "yevmiye-a" if company_id == CO_A else SECRET_NOTE,
        "status": "pending",
        "type": "yevmiye",
    }
    row.update(extra)
    return row


def _attendance(company_id, doc_id, date, **extra):
    row = {
        "_id": doc_id,
        "company_id": company_id,
        "employee_id": EMP,
        "employee_name": NAME_A if company_id == CO_A else SECRET_NAME,
        "date": date,
        "status": "present",
        "check_in": "09:00",
        "check_out": "18:00",
        "source": "self",
    }
    row.update(extra)
    return row


def _seed(db):
    today = attendance._today()
    yesterday = attendance.previous_ymd(today)
    for company_id in (CO_B, CO_A):
        _add(db, "companies", _company(company_id))
        _add(db, "employees", _employee(company_id))
    _add(db, "bonus_payments", _bonus(CO_B))
    _add(db, "bonus_payments", _bonus(CO_A))
    _add(db, "bonus_payments", _bonus(CO_B, BONUS_B, amount=500, daily_wage=500, note=SECRET_NOTE))
    _add(db, "attendance", _attendance(
        CO_B, ATT_B, yesterday, check_in="18:00", check_out=None,
    ))
    _add(db, "attendance", _attendance(
        CO_A, "att-geo", today, check_in="09:30", check_out="07:00",
        geo_confirm_request={"status": "pending", "action": "check_out", "proposed_time": "07:00"},
    ))
    _add(db, "attendance", _attendance(
        CO_A, "att-loc", "2026-03-06",
        location_exit_request={"status": "pending"},
    ))
    _add(db, "attendance", _attendance(
        CO_A, "att-ot", "2026-03-02", auto_checkout=True,
        overtime_confirm_request={
            "status": "pending", "schedule_end": "18:00", "proposed_out": "20:00", "hours": 2,
        },
    ))
    _add(db, "attendance", _attendance(
        CO_A, "att-yev", "2026-03-10",
        yevmiye_bonus_id=BONUS, yevmiye_full_amount=100,
        yevmiye_adjustment_request={
            "status": "pending", "full_amount": 100, "proposed_amount": 80,
            "late_minutes": 30, "early_leave_minutes": 0,
        },
    ))
    _add(db, "attendance", _attendance(
        CO_A, "att-yev-b", "2026-03-11",
        yevmiye_bonus_id=BONUS_B, yevmiye_full_amount=100,
        late_minutes=60, early_leave_minutes=0,
    ))
    _add(db, "attendance", _attendance(
        CO_A, "att-early", "2026-03-03",
        early_leave_request={"status": "pending", "reason": "doktor", "planned_time": "16:00"},
    ))
    _add(db, "attendance", _attendance(
        CO_A, "att-intra", "2026-03-04",
        intraday_leave_request={
            "status": "pending", "reason": "banka", "out_time": "13:00", "return_time": "14:00",
        },
    ))
    _add(db, "attendance", _attendance(
        CO_A, "att-time", "2026-03-05",
        manager_time_edit={
            "pending_employee": True,
            "prev_check_in": "09:00",
            "prev_check_out": "17:00",
            "check_in": "09:30",
            "check_out": "18:00",
        },
    ))
    _add(db, "attendance", _attendance(
        CO_A, "att-dis", "2026-03-09",
        dispute_note="saat hatali", dispute_resolved=False,
    ))


async def _silent_push(*_args, **_kwargs):
    return {"sent": 0}


def _bind(db, monkeypatch):
    prev = attendance._db
    attendance._db = db
    monkeypatch.setattr(notify, "dispatch_push", _silent_push)
    return prev


def test_decisions_stay_inside_company(monkeypatch):
    user = _user(CO_A)
    db = MemDB()
    _seed(db)
    company_a = _company(CO_A)
    company_b = _company(CO_B)
    own_minutes = personnel_wage.scheduled_work_minutes(attendance.merge_schedule(company_a, _employee(CO_A)))
    other_minutes = personnel_wage.scheduled_work_minutes(attendance.merge_schedule(company_b, _employee(CO_B)))
    own_amount = personnel_wage.yevmiye_adjusted_amount(100, 60, 0, own_minutes)
    other_amount = personnel_wage.yevmiye_adjusted_amount(100, 60, 0, other_minutes)
    assert own_amount != other_amount
    prev = _bind(db, monkeypatch)
    try:
        before = _digest(db, CO_B)
        for endpoint in _ENDPOINTS:
            with pytest.raises(HTTPException) as raised:
                _run(endpoint(ATT_B, {"decision": "approve"}, user))
            assert raised.value.status_code == 404
        assert _digest(db, CO_B) == before

        outs = []
        outs.append(_run(attendance.decide_geo_confirm(
            "att-geo", {"decision": "approve"}, user,
        )))
        outs.append(_run(attendance.decide_location_exit(
            "att-loc", {"decision": "approve", "wage_deduction": True}, user,
        )))
        outs.append(_run(attendance.decide_overtime_confirm(
            "att-ot", {"decision": "yes", "check_out": "20:00"}, user,
        )))
        outs.append(_run(attendance.decide_yevmiye_adjustment(
            "att-yev", {"decision": "approve"}, user,
        )))
        outs.append(_run(attendance.decide_yevmiye_adjustment(
            "att-yev-b", {"decision": "approve"}, user,
        )))
        outs.append(_run(attendance.decide_early_leave(
            "att-early", {"decision": "approve"}, user,
        )))
        outs.append(_run(attendance.decide_intraday_leave(
            "att-intra", {"decision": "approve"}, user,
        )))
        outs.append(_run(attendance.decide_time_edit(
            "att-time", {"decision": "reject"}, user,
        )))
        outs.append(_run(attendance.decide_attendance_dispute(
            "att-dis", {"decision": "approve"}, user,
        )))

        blob = json.dumps({"outs": outs, "notes": db.notifications.docs}, ensure_ascii=False, default=str)
        assert SECRET_NAME not in blob
        assert SECRET_NOTE not in blob
        assert _digest(db, CO_B) == before

        yesterday = _row(db, "attendance", CO_B, ATT_B)
        assert yesterday["check_in"] == "18:00"
        assert not yesterday.get("check_out")
        assert yesterday["employee_name"] == SECRET_NAME
        assert _row(db, "employees", CO_B, EMP)["full_name"] == SECRET_NAME
        assert _row(db, "employees", CO_B, EMP)["daily_wage"] == 777
        shared_b = _row(db, "bonus_payments", CO_B, BONUS)
        assert shared_b["amount"] == 900
        assert shared_b["note"] == SECRET_NOTE
        only_b = _row(db, "bonus_payments", CO_B, BONUS_B)
        assert only_b["amount"] == 500
        assert only_b["note"] == SECRET_NOTE

        shared_a = _row(db, "bonus_payments", CO_A, BONUS)
        assert shared_a["amount"] == 80
        assert shared_a["daily_wage"] == 80
        assert shared_a["note"].startswith("Görev yevmiye")
        assert outs[3]["approved"] is True
        assert outs[3]["amount"] == 80
        assert outs[4]["amount"] == own_amount
        assert outs[1]["deduction_amount"] == 100
        assert outs[1]["wage_deduction"] is True
        assert _row(db, "attendance", CO_A, "att-geo")["company_id"] == CO_A
        assert (_row(db, "attendance", CO_A, "att-geo").get("geo_confirm_request") or {}).get("status") == "approved"
        assert all(row.get("company_id") == CO_A for row in db.notifications.docs)
    finally:
        attendance._db = prev
        tenant_scope.reset_violations()


def test_wave17_baseline_keys_removed():
    base = allowlist.TENANT_SCOPE_BASELINE
    present = [key for key in _REMOVED if key in base]
    assert present == []
    assert len(_REMOVED) == 24
    assert len(set(_REMOVED)) == 24
    assert all(key[0] == "attendance.py" for key in _REMOVED)
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
