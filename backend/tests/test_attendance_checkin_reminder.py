"""Giriş hatırlatması zamanı ve başka personelin cihazından reddedilen giriş."""
from __future__ import annotations

import asyncio
import copy
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mysql_store import DuplicateKeyError, UpdateResult, apply_update, match_query
import attendance
import attendance_security as sec


class MemoryCollection:
    def __init__(self):
        self.docs = {}

    async def insert_one(self, doc):
        doc = copy.deepcopy(doc)
        if doc["_id"] in self.docs:
            raise DuplicateKeyError("dup")
        self.docs[doc["_id"]] = doc
        return doc

    async def find_one(self, query):
        for doc in self.docs.values():
            if match_query(doc, query or {}):
                return copy.deepcopy(doc)
        return None

    def find(self, query=None):
        matched = [copy.deepcopy(d) for d in self.docs.values() if match_query(d, query or {})]
        return _Cursor(matched)

    async def update_one(self, query, update, upsert=False):
        for doc_id, old in list(self.docs.items()):
            if match_query(old, query):
                self.docs[doc_id] = apply_update(old, update, query)
                return UpdateResult(1, 1, None)
        return UpdateResult(0, 0, None)


class _Cursor:
    def __init__(self, docs):
        self._docs = docs

    async def to_list(self, limit=None):
        if limit is None:
            return list(self._docs)
        return list(self._docs)[:limit]


class MemoryDB:
    def __init__(self):
        self._cols = {}

    def __getitem__(self, name):
        if name not in self._cols:
            self._cols[name] = MemoryCollection()
        return self._cols[name]

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return self[name]


def _merge(company, employee=None):
    return attendance.merge_schedule(company, employee)


def _company(schedule=None):
    base = {"timezone": "Europe/Istanbul", "start": "09:00", "end": "18:00", "work_days": [0, 1, 2, 3, 4]}
    base.update(schedule or {})
    return {"_id": "co", "work_schedule": base}


def _emp(emp_id="e1", **extra):
    row = {"_id": emp_id, "company_id": "co", "full_name": "Ali", "status": "active", "user_id": f"u-{emp_id}"}
    row.update(extra)
    return row


async def _seed(db, schedule=None, emp=None):
    await db.companies.insert_one(_company(schedule))
    await db.employees.insert_one(emp or _emp())


def _run(coro):
    return asyncio.run(coro)


def test_reminder_exact_minutes_and_checked_in():
    # İkinci hatırlatma ilkinden 15 dk sonra: 09:00 mesai → 08:55 ve 09:10.
    assert sec.checkin_reminder_kind("08:54", "09:00", checked_in=False, eligible=True) is None
    assert sec.checkin_reminder_kind("08:55", "09:00", checked_in=False, eligible=True) == "before"
    assert sec.checkin_reminder_kind("08:55", "09:00", checked_in=True, eligible=True) is None
    assert sec.checkin_reminder_kind("09:09", "09:00", checked_in=False, eligible=True) is None
    assert sec.checkin_reminder_kind("09:10", "09:00", checked_in=False, eligible=True) == "after"
    assert sec.checkin_reminder_kind("09:10", "09:00", checked_in=True, eligible=True) is None
    assert sec.checkin_reminder_kind("09:11", "09:00", checked_in=False, eligible=True, window=0) is None
    assert sec.checkin_reminder_kind("08:56", "09:00", checked_in=False, eligible=True, window=1) == "before"


def test_skips_leave_holiday_and_no_shift():
    assert sec.day_reminder_eligible(skip_check_in=False, on_leave=True, attendance_status=None, shift_ok=True) is False
    assert sec.day_reminder_eligible(skip_check_in=True, on_leave=False, attendance_status=None, shift_ok=True) is False
    assert sec.shift_context({"work_days": [0, 1, 2, 3, 4], "start": "09:00", "end": "18:00"}, 0, {"off": True})["reason"] == "holiday"
    assert sec.shift_context({"work_days": [0, 1, 2, 3, 4], "start": "09:00", "end": "18:00"}, 6, None)["reason"] == "no_shift"
    assert sec.shift_context({"work_days": [0, 1, 2, 3, 4], "start": "09:00", "end": "18:00"}, 0, None)["eligible"] is True


def test_timezone_defaults_to_istanbul():
    moment = datetime(2026, 10, 12, 5, 55, tzinfo=timezone.utc)
    date, hm, weekday = sec.local_clock(moment, "Europe/Istanbul")
    assert (date, hm, weekday) == ("2026-10-12", "08:55", 0)
    utc_date, utc_hm, _utc_wd = sec.local_clock(moment, "UTC")
    assert utc_hm == "05:55"
    assert attendance.DEFAULT_SCHEDULE["timezone"] == "Europe/Istanbul"
    assert _merge({})["timezone"] == "Europe/Istanbul"
    assert _merge({})["notify_checkin_reminder"] is True
    assert _merge({})["notify_checkout_reminder"] is False


def test_runner_sends_before_and_second_only_if_still_out():
    async def scene(now, attendance_row=None, schedule=None, emp=None, plan=None, leave=None):
        db = MemoryDB()
        await _seed(db, schedule, emp)
        if attendance_row:
            await db.attendance.insert_one(attendance_row)
        if plan:
            await db.shift_plans.insert_one(plan)
        if leave:
            await db.leave_requests.insert_one(leave)
        sent = []

        async def send(employee, kind, title, message, link):
            sent.append({"kind": kind, "title": title, "link": link, "employee_id": employee["_id"], "message": message})

        out = await sec.run_reminders(db, _merge, send, now_utc=now, window=0)
        return sent, out

    before = datetime(2026, 10, 12, 5, 55, tzinfo=timezone.utc)  # 08:55 Istanbul, Pazartesi
    sent, out = _run(scene(before))
    assert [s["kind"] for s in sent] == ["before"]
    assert sent[0]["title"] == "Giriş yapmayı unutma"
    assert sent[0]["link"] == "/mesai"
    assert out[0]["timezone"] == "Europe/Istanbul"

    again, _ = _run(scene(before))
    # yeni veritabanı; aynı dakikada bir kez (aşağıda aynı db)
    assert again[0]["kind"] == "before"

    async def once_then_again():
        db = MemoryDB()
        await _seed(db)
        sent = []

        async def send(employee, kind, title, message, link):
            sent.append(kind)

        await sec.run_reminders(db, _merge, send, now_utc=before, window=0)
        await sec.run_reminders(db, _merge, send, now_utc=before, window=0)
        return sent

    assert _run(once_then_again()) == ["before"]

    checked = {"_id": "att1", "employee_id": "e1", "date": "2026-10-12", "check_in": "08:50", "status": "present"}
    sent, _ = _run(scene(before, attendance_row=checked))
    assert sent == []

    late = datetime(2026, 10, 12, 6, 10, tzinfo=timezone.utc)  # 09:10 Istanbul
    sent, _ = _run(scene(late))
    assert [s["kind"] for s in sent] == ["after"]
    assert sent[0]["title"] == "Giriş yapmayı unutma"
    sent, _ = _run(scene(late, attendance_row=checked))
    assert sent == []

    too_early = datetime(2026, 10, 12, 5, 54, tzinfo=timezone.utc)  # 08:54
    sent, _ = _run(scene(too_early))
    assert sent == []


def test_runner_skips_leave_sick_holiday_noshift_and_opt_out():
    async def count(now, **kwargs):
        db = MemoryDB()
        await _seed(db, kwargs.get("schedule"), kwargs.get("emp"))
        if kwargs.get("plan"):
            await db.shift_plans.insert_one(kwargs["plan"])
        if kwargs.get("leave"):
            await db.leave_requests.insert_one(kwargs["leave"])
        sent = []

        async def send(*_a, **_k):
            sent.append(1)

        await sec.run_reminders(db, _merge, send, now_utc=now, window=0)
        return len(sent)

    before = datetime(2026, 10, 12, 5, 55, tzinfo=timezone.utc)
    leave = {"_id": "lv", "employee_id": "e1", "status": "approved", "start_date": "2026-10-12", "end_date": "2026-10-12", "type": "annual"}
    sick = {**leave, "_id": "sick", "type": "sick"}
    assert _run(count(before, leave=leave)) == 0
    assert _run(count(before, leave=sick)) == 0
    assert _run(count(before, plan={"_id": "p", "employee_id": "e1", "date": "2026-10-12", "off": True})) == 0
    sunday = datetime(2026, 10, 11, 5, 55, tzinfo=timezone.utc)  # Pazar 08:55
    assert _run(count(sunday)) == 0
    assert _run(count(before, emp=_emp(skip_check_in=True))) == 0
    assert _run(count(before, schedule={"notify_checkin_reminder": False})) == 0
    assert _run(count(before, emp=_emp(notify_checkin_reminder=False))) == 0
    utc = datetime(2026, 10, 12, 5, 55, tzinfo=timezone.utc)
    assert _run(count(utc, schedule={"timezone": "UTC"})) == 0


def test_checkout_reminder_is_optional():
    async def count(flag, checked_out=False):
        db = MemoryDB()
        await _seed(db, {"notify_checkout_reminder": flag})
        row = {"_id": "att", "employee_id": "e1", "date": "2026-10-12", "check_in": "09:00", "status": "present"}
        if checked_out:
            row["check_out"] = "18:00"
        await db.attendance.insert_one(row)
        sent = []

        async def send(employee, kind, title, message, link):
            sent.append({"kind": kind, "title": title, "link": link})

        end = datetime(2026, 10, 12, 15, 0, tzinfo=timezone.utc)  # 18:00 Istanbul
        await sec.run_reminders(db, _merge, send, now_utc=end, window=0)
        return sent

    on = _run(count(True))
    assert [s["kind"] for s in on] == ["checkout"]
    assert on[0]["link"] == "/mesai"
    assert _run(count(False)) == []
    assert _run(count(True, checked_out=True)) == []


def test_other_employee_device_is_rejected_without_attendance():
    async def go():
        db = MemoryDB()
        await db.attendance_devices.insert_one({
            "_id": "devbind:e1:phone-a", "company_id": "co", "employee_id": "e1",
            "device_id": "phone-a", "status": "active",
        })
        notes = []

        async def notify(company_id, ntype, title, message, link="/personnel?tab=attendance", dedupe_key=None):
            notes.append({"ntype": ntype, "title": title, "dedupe_key": dedupe_key})

        gate = await sec.gate_self_punch(
            db, company_id="co",
            employee={"_id": "e2", "full_name": "Ayşe", "company_id": "co", "user_id": "u2"},
            schedule={"require_registered_device": True, "require_punch_auth": "off"},
            req={"device_id": "phone-a", "punch_auth": False},
            notify=notify, today="2026-10-12",
        )
        written = gate["allow"]
        if written:
            await db.attendance.insert_one({"_id": "should-not", "employee_id": "e2", "date": "2026-10-12", "check_in": "09:00"})
        return gate, notes, await db.attendance.find_one({"employee_id": "e2"})

    gate, notes, row = _run(go())
    assert gate["allow"] is False
    assert gate["reason"] == "device_other_employee"
    assert row is None
    assert notes and notes[0]["ntype"] == "attendance_device"
    assert "reddedildi" in notes[0]["title"].lower() or "Ayşe" in notes[0]["title"]


def test_mock_root_and_punch_auth_rejected():
    async def reject(req, schedule=None):
        db = MemoryDB()
        notes = []

        async def notify(*_a, **_k):
            notes.append(1)

        gate = await sec.gate_self_punch(
            db, company_id="co",
            employee={"_id": "e1", "full_name": "Ali", "company_id": "co"},
            schedule=schedule or {"require_registered_device": True, "require_punch_auth": "pin"},
            req=req, notify=notify, today="2026-10-12",
        )
        return gate, len(notes), await db.attendance_devices.find_one({"employee_id": "e1", "status": "active"})

    mock, n, bound = _run(reject({"device_id": "phone-a", "is_mock": True, "punch_auth": True}))
    assert mock["reason"] == "mock_location" and n == 1 and bound is None
    root, n, bound = _run(reject({"device_id": "phone-a", "is_rooted": True, "punch_auth": True}))
    assert root["reason"] == "rooted" and n == 1 and bound is None
    pin, n, bound = _run(reject({"device_id": "phone-a", "punch_auth": False}))
    assert pin["reason"] == "punch_auth_required" and bound is None


def test_device_change_needs_approval_then_allows_new_phone():
    async def go():
        db = MemoryDB()
        await db.attendance_devices.insert_one({
            "_id": "devbind:e1:phone-a", "company_id": "co", "employee_id": "e1",
            "device_id": "phone-a", "status": "active",
        })
        gate = await sec.gate_self_punch(
            db, company_id="co",
            employee={"_id": "e1", "full_name": "Ali", "company_id": "co"},
            schedule={"require_registered_device": True},
            req={"device_id": "phone-b"}, notify=None, today="2026-10-12",
        )
        pending = await db.attendance_devices.find_one({"device_id": "phone-b"})
        approved = await sec.approve_device(db, "co", pending["_id"], "boss")
        old = await db.attendance_devices.find_one({"_id": "devbind:e1:phone-a"})
        new = await db.attendance_devices.find_one({"_id": pending["_id"]})
        return gate, approved, old, new

    gate, approved, old, new = _run(go())
    assert gate["allow"] is False and gate["reason"] == "device_change"
    assert approved["ok"] is True
    assert old["status"] == "revoked"
    assert new["status"] == "active"


def test_self_checkin_calls_gate_before_write():
    text = (Path(__file__).resolve().parents[1] / "attendance.py").read_text(encoding="utf-8")
    gate_at = text.find("gate_self_punch")
    apply_at = text.find("await apply_day(emp, date, patch", gate_at)
    raise_at = text.find('if not gate["allow"]', gate_at)
    assert 0 < gate_at < raise_at < apply_at
