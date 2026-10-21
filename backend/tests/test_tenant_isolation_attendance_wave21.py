"""Puantaj öz-servis ve zamanlayıcı kiracı dalgası 21.

Bellek içi MemDB. Canlı veritabanına, 8021 portuna ve ağa bağlanmaz.
Konum, tutar, avans, şirket kimliği ve belge içeriği loglanmaz.
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
import event_notify  # noqa: E402
import location_consent  # noqa: E402
import notify  # noqa: E402
import tenant_scope  # noqa: E402
import tenant_scope_allowlist as allowlist  # noqa: E402
from dashboard_memdb import MemDB  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
EMP = "emp-shared"
NAME_A = "Ali A"
SECRET_NAME = "GizliPersonelB"
SECRET_NOTE = "gizli-puantaj-b"
SECRET_SHIFT = "gizli-vardiya-notu-b"
SECRET_ADVANCE = "gizli-avans-notu-b"
IN_A = "09:12"
IN_B = "07:41"
ATT_A = "att-a"
ATT_B = "att-b"
DEVICE_B = "dev-b"
DEVICE_A = "dev-a"

_REMOVED = (
    ("attendance.py", "request_early_leave", "attendance", "find_one"),
    ("attendance.py", "request_early_leave", "attendance", "update_one"),
    ("attendance.py", "request_intraday_leave", "attendance", "find_one"),
    ("attendance.py", "request_intraday_leave", "attendance", "update_one"),
    ("attendance.py", "request_my_advance", "bonus_payments", "find_one"),
    ("attendance.py", "revoke_attendance_device", "attendance_devices", "find_one"),
    ("attendance.py", "revoke_location_consent", "employees", "update_one"),
    ("attendance.py", "rollover_leave_year", "employees", "find_one"),
    ("attendance.py", "rollover_leave_year", "employees", "update_one"),
    ("attendance.py", "rollover_leave_year", "leave_requests", "find"),
    ("attendance.py", "rollover_leave_year", "leave_year_archives", "find_one"),
    ("attendance.py", "run_auto_checkout_ot_check", "attendance", "find_one"),
    ("attendance.py", "run_auto_checkout_ot_check", "shift_plans", "find_one"),
    ("attendance.py", "run_missing_checkin_check", "attendance", "find_one"),
    ("attendance.py", "run_missing_checkin_check", "shift_plans", "find_one"),
    ("attendance.py", "save_location_move", "attendance", "update_one"),
    ("attendance.py", "self_attendance", "attendance", "find"),
    ("attendance.py", "self_attendance", "attendance", "find_one"),
    ("attendance.py", "self_attendance", "attendance", "update_one"),
    ("attendance.py", "self_location_ping", "attendance", "find"),
    ("attendance.py", "self_location_ping", "attendance", "find_one"),
    ("attendance.py", "self_location_ping", "attendance", "update_one"),
    ("attendance.py", "self_location_ping", "employees", "update_one"),
    ("attendance.py", "self_location_ping", "shift_plans", "find_one"),
)


def _run(coro):
    return asyncio.run(coro)


def _user(company_id, role="admin"):
    uid = "user-" + company_id
    return {
        "_id": uid,
        "id": uid,
        "name": "Yonetici",
        "role": role,
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


def _consent():
    return {"accept_kvkk": True, "accept_share": True, "accepted_at": "2026-01-01T00:00:00+00:00"}


def _company(company_id, **extra):
    row = {
        "_id": company_id,
        "name": "FirmaA" if company_id == CO_A else "FirmaB",
        "work_schedule": {
            "start": "09:00",
            "end": "18:00",
            "break_minutes": 60,
            "work_days": [0, 1, 2, 3, 4],
            "timezone": "Europe/Istanbul",
            "require_geo": False,
            "notify_missing_checkin": True,
        },
        "location": {
            "latitude": 41.015 if company_id == CO_A else 36.9,
            "longitude": 28.979 if company_id == CO_A else 30.7,
            "radius_m": 150,
            "label": "MerkezA" if company_id == CO_A else "MerkezB",
        },
    }
    if extra.get("work_schedule"):
        row["work_schedule"] = {**row["work_schedule"], **extra.pop("work_schedule")}
    row.update(extra)
    return row


def _employee(company_id, **extra):
    row = {
        "_id": EMP,
        "company_id": company_id,
        "full_name": NAME_A if company_id == CO_A else SECRET_NAME,
        "user_id": "user-" + company_id,
        "status": "active",
        "daily_wage": 100 if company_id == CO_A else 777,
        "location_consent": _consent(),
        "annual_leave_days": 14,
        "leave_year": 2026,
        "used_leave_days": 0,
        "leave_carry_days": 0,
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
        "check_in": IN_A if company_id == CO_A else IN_B,
        "check_out": None,
        "source": "self",
        "note": "" if company_id == CO_A else SECRET_NOTE,
        "location_inside_at": "2026-10-21T06:00:00+00:00",
    }
    row.update(extra)
    return row


def _shift(company_id, date, end, **extra):
    row = {
        "_id": "shift-" + company_id,
        "company_id": company_id,
        "employee_id": EMP,
        "date": date,
        "off": False,
        "start": "08:00",
        "end": end,
        "note": "" if company_id == CO_A else SECRET_SHIFT,
    }
    row.update(extra)
    return row


def _bind(db, monkeypatch, user):
    prev = (attendance._db, attendance._current_user, event_notify._db)

    async def _current(_request=None):
        return user

    async def _push(*_args, **_kwargs):
        return {"sent": 0}

    async def _signal(_emp_id, ok, company_id=None):
        return location_consent.location_signal_view({"location_last_ok": bool(ok)})

    attendance._db = db
    attendance._current_user = _current
    event_notify._db = db
    monkeypatch.setattr(notify, "dispatch_push", _push)
    monkeypatch.setattr(attendance, "mark_employee_location_signal", _signal)
    return prev


def _restore(prev):
    attendance._db, attendance._current_user, event_notify._db = prev
    tenant_scope.reset_violations()


def test_self_service_stays_inside_company(monkeypatch):
    user = _user(CO_A)
    db = MemDB()
    today = attendance._today(_company(CO_A)["work_schedule"])
    for company_id in (CO_B, CO_A):
        _add(db, "companies", _company(company_id))
        _add(db, "employees", _employee(company_id))
    _add(db, "attendance", _attendance(CO_B, ATT_B, today))
    _add(db, "attendance", _attendance(CO_A, ATT_A, today))
    _add(db, "shift_plans", _shift(CO_B, today, "18:00"))
    _add(db, "shift_plans", _shift(CO_A, today, "11:00"))
    prev = _bind(db, monkeypatch, user)
    monkeypatch.setattr(attendance, "location_tracking_active", lambda: True)
    monkeypatch.setattr(attendance, "location_ping_checks_out", lambda: True)
    monkeypatch.setattr(attendance, "now_hm", lambda schedule=None: "12:00")
    monkeypatch.setattr(
        attendance,
        "location_mode_for",
        lambda *_a, **_k: {"enabled": True, "continuous": False, "interval_minutes": 15, "exit_tolerance_hours": 0},
    )

    async def _no_ot(*_a, **_k):
        return {"auto_checkout": False, "auto_checkout_retracted": False, "overtime_confirm": None}

    monkeypatch.setattr(attendance, "process_auto_exit_overtime", _no_ot)
    try:
        before = _digest(db, CO_B)
        with pytest.raises(HTTPException) as raised:
            _run(attendance.self_attendance({"action": "check_in"}, None))
        assert raised.value.status_code == 400
        assert IN_A in str(raised.value.detail)
        assert IN_B not in str(raised.value.detail)

        early = _run(attendance.request_early_leave({"reason": "doktor randevusu"}, None))
        intra = _run(attendance.request_intraday_leave(
            {"reason": "banka islemi", "out_time": "13:00", "return_time": "14:00"},
            None,
        ))
        ping = _run(attendance.self_location_ping({"latitude": 39.0, "longitude": 32.0}, None))

        blob = json.dumps(
            {"early": early, "intra": intra, "ping": ping, "detail": str(raised.value.detail)},
            ensure_ascii=False,
            default=str,
        )
        assert SECRET_NAME not in blob
        assert SECRET_NOTE not in blob
        assert SECRET_SHIFT not in blob
        assert IN_B not in blob
        assert early["record"]["id"] == ATT_A
        assert early["record"]["employee_name"] == NAME_A
        assert intra["record"]["id"] == ATT_A
        assert ping["record"]["id"] == ATT_A
        assert ping["record"]["employee_name"] == NAME_A
        assert ping["record"].get("check_out") in (None, "")
        assert _digest(db, CO_B) == before

        own = _row(db, "attendance", CO_A, ATT_A)
        other = _row(db, "attendance", CO_B, ATT_B)
        assert (own.get("early_leave_request") or {}).get("status") == "pending"
        assert (own.get("intraday_leave_request") or {}).get("status") == "pending"
        assert not other.get("early_leave_request")
        assert not other.get("intraday_leave_request")
        assert other["check_in"] == IN_B
        assert other.get("check_out") in (None, "")
        assert other["note"] == SECRET_NOTE
        assert other.get("employee_name") == SECRET_NAME
        assert _row(db, "shift_plans", CO_B, "shift-" + CO_B)["note"] == SECRET_SHIFT
        assert _row(db, "shift_plans", CO_B, "shift-" + CO_B)["end"] == "18:00"
        assert _row(db, "employees", CO_B, EMP)["full_name"] == SECRET_NAME
        assert _row(db, "employees", CO_B, EMP)["daily_wage"] == 777
        assert location_consent.location_consent_accepted(_row(db, "employees", CO_B, EMP))
        assert own.get("check_out") in (None, "")
        assert (own.get("location_moves") or []) != (other.get("location_moves") or [])
    finally:
        _restore(prev)


def test_schedulers_ignore_other_company_rows(monkeypatch):
    db = MemDB()
    schedule = {
        "start": "09:00",
        "end": "18:00",
        "break_minutes": 0,
        "work_days": [],
        "timezone": "Europe/Istanbul",
        "notify_missing_checkin": True,
        "late_tolerance_minutes": 0,
    }
    today = attendance.local_now(schedule).strftime("%Y-%m-%d")
    _add(db, "companies", _company(CO_B, work_schedule=schedule))
    _add(db, "companies", _company(CO_A, work_schedule=schedule))
    _add(db, "employees", _employee(CO_B, status="inactive"))
    _add(db, "employees", _employee(CO_A, status="active"))
    _add(db, "shift_plans", _shift(CO_B, today, "18:00", off=False, start="08:00"))
    _add(db, "shift_plans", _shift(CO_A, today, "18:00", off=True, start="08:00"))
    _add(db, "attendance", _attendance(CO_B, ATT_B, today, check_in=None, status="present"))
    _add(db, "attendance", _attendance(CO_A, ATT_A, today, check_in=None, status="present"))
    prev = _bind(db, monkeypatch, _user(CO_A))
    try:
        before = _digest(db, CO_B)
        missing = _run(attendance.run_missing_checkin_check(force=True))
        assert missing == []
        assert _digest(db, CO_B) == before
        assert _row(db, "attendance", CO_B, ATT_B).get("check_in") in (None, "")
        assert _row(db, "shift_plans", CO_B, "shift-" + CO_B)["off"] is False
    finally:
        _restore(prev)

    db = MemDB()
    open_schedule = {
        "start": "09:00",
        "end": "18:00",
        "break_minutes": 0,
        "work_days": [0, 1, 2, 3, 4, 5, 6],
        "timezone": "Europe/Istanbul",
    }
    today = attendance.local_now(open_schedule).strftime("%Y-%m-%d")
    _add(db, "companies", _company(CO_B, work_schedule=open_schedule))
    _add(db, "companies", _company(CO_A, work_schedule=open_schedule))
    _add(db, "employees", _employee(CO_B, status="inactive"))
    _add(db, "employees", _employee(CO_A, status="active"))
    _add(db, "shift_plans", _shift(CO_B, today, "00:01"))
    _add(db, "shift_plans", _shift(CO_A, today, "23:59"))
    _add(db, "attendance", _attendance(CO_B, ATT_B, today, check_in="09:00", check_out=None))
    _add(db, "attendance", _attendance(CO_A, ATT_A, today, check_in=None, status="present"))
    prev = _bind(db, monkeypatch, _user(CO_A))
    try:
        before = _digest(db, CO_B)
        auto = _run(attendance.run_auto_checkout_ot_check())
        assert auto == []
        assert _digest(db, CO_B) == before
        other = _row(db, "attendance", CO_B, ATT_B)
        assert other["check_in"] == "09:00"
        assert other.get("check_out") in (None, "")
        assert not other.get("auto_checkout")
        own = _row(db, "attendance", CO_A, ATT_A)
        assert own.get("check_in") in (None, "")
        assert own.get("check_out") in (None, "")
    finally:
        _restore(prev)


def test_rollover_stays_inside_company(monkeypatch):
    user = _user(CO_A)
    db = MemDB()
    _add(db, "companies", _company(CO_A))
    _add(db, "companies", _company(CO_B))
    _add(db, "employees", _employee(CO_A, leave_year=2026, annual_leave_days=14, used_leave_days=0))
    _add(db, "employees", _employee(
        CO_B, leave_year=2024, annual_leave_days=20, used_leave_days=3, leave_carry_days=1,
    ))
    _add(db, "leave_requests", {
        "_id": "lv-b",
        "company_id": CO_B,
        "employee_id": EMP,
        "status": "approved",
        "type": "annual",
        "start_date": "2026-03-02",
        "end_date": "2026-03-06",
        "days": 5,
    })
    _add(db, "leave_year_archives", {
        "_id": "arch-b",
        "company_id": CO_B,
        "employee_id": EMP,
        "year": 2026,
        "annual": 20,
        "used": 5,
        "remaining": 15,
        "carry_over": 15,
    })
    prev = _bind(db, monkeypatch, user)
    try:
        before = _digest(db, CO_B)
        out = _run(attendance.rollover_leave_year(EMP, {}, user))
        assert out["status"] == "success"
        assert out["archive"]["year"] == 2026
        assert out["archive"]["used"] == 0
        assert out["archive"]["remaining"] == 14
        assert out["archive"]["carry_over"] == 14
        assert out["archive"]["company_id"] == CO_A
        assert SECRET_NAME not in json.dumps(out, ensure_ascii=False, default=str)
        assert _digest(db, CO_B) == before
        other = _row(db, "employees", CO_B, EMP)
        assert other["leave_year"] == 2024
        assert other["used_leave_days"] == 3
        assert other["leave_carry_days"] == 1
        assert other["annual_leave_days"] == 20
        assert _row(db, "leave_requests", CO_B, "lv-b")["days"] == 5
        assert _row(db, "leave_year_archives", CO_B, "arch-b")["used"] == 5
        own = _row(db, "employees", CO_A, EMP)
        assert own["leave_year"] == 2027
        assert own["used_leave_days"] == 0
        assert own["leave_carry_days"] == 14
    finally:
        _restore(prev)


def test_advance_device_consent_and_move_stay_inside_company(monkeypatch):
    user = _user(CO_A)
    db = MemDB()
    _add(db, "companies", _company(CO_B))
    _add(db, "companies", _company(CO_A))
    _add(db, "employees", _employee(CO_B))
    _add(db, "employees", _employee(CO_A))
    _add(db, "bonus_payments", {
        "_id": "adv-b",
        "company_id": CO_B,
        "employee_id": EMP,
        "type": "advance",
        "source": "self",
        "status": "pending",
        "amount": 900,
        "note": SECRET_ADVANCE,
    })
    _add(db, "attendance_devices", {
        "_id": DEVICE_B,
        "company_id": CO_B,
        "employee_id": EMP,
        "device_id": "phone-b",
        "status": "active",
    })
    _add(db, "attendance_devices", {
        "_id": DEVICE_A,
        "company_id": CO_A,
        "employee_id": EMP,
        "device_id": "phone-a",
        "status": "active",
    })
    _add(db, "attendance", _attendance(CO_B, "att-shared", "2026-10-21", location_moves=[{"id": "mv-b", "kind": "enter"}]))
    _add(db, "attendance", _attendance(CO_A, "att-shared", "2026-10-21", location_moves=[]))
    prev = _bind(db, monkeypatch, user)
    try:
        before = _digest(db, CO_B)
        advance = _run(attendance.request_my_advance({"amount": 40, "note": "yol", "period": "2026-10"}, None))
        assert advance["company_id"] == CO_A
        assert advance["amount"] == 40
        assert advance["status"] == "pending"
        blob = json.dumps(advance, ensure_ascii=False, default=str)
        assert SECRET_ADVANCE not in blob
        assert advance["note"] == "yol"
        assert advance["amount"] != 900
        assert _row(db, "bonus_payments", CO_B, "adv-b")["amount"] == 900
        assert _row(db, "bonus_payments", CO_B, "adv-b")["note"] == SECRET_ADVANCE

        with pytest.raises(HTTPException) as raised:
            _run(attendance.revoke_attendance_device(DEVICE_B, None))
        assert raised.value.status_code == 404
        assert _row(db, "attendance_devices", CO_B, DEVICE_B)["status"] == "active"

        revoked = _run(attendance.revoke_attendance_device(DEVICE_A, None))
        assert revoked["status"] == "success"
        assert _row(db, "attendance_devices", CO_A, DEVICE_A)["status"] == "revoked"
        assert _row(db, "attendance_devices", CO_B, DEVICE_B)["status"] == "active"

        consent = _run(attendance.revoke_location_consent(None))
        assert consent["status"] == "success"
        assert not location_consent.location_consent_accepted(_row(db, "employees", CO_A, EMP))
        assert location_consent.location_consent_accepted(_row(db, "employees", CO_B, EMP))
        assert _row(db, "employees", CO_B, EMP)["full_name"] == SECRET_NAME

        own = _row(db, "attendance", CO_A, "att-shared")
        move = attendance.build_location_move(kind="leave", at="2026-10-21T12:00:00+00:00", place="MerkezA")
        _run(attendance.save_location_move(dict(own), move))
        assert _row(db, "attendance", CO_B, "att-shared")["location_moves"] == [{"id": "mv-b", "kind": "enter"}]
        assert any(item.get("kind") == "leave" for item in _row(db, "attendance", CO_A, "att-shared")["location_moves"])

        bare = {"_id": "att-shared", "employee_id": EMP, "location_moves": []}
        _run(attendance.save_location_move(bare, move))
        assert _row(db, "attendance", CO_B, "att-shared")["location_moves"] == [{"id": "mv-b", "kind": "enter"}]
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_wave21_baseline_keys_removed():
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
