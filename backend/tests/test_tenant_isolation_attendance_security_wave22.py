"""Cihaz bağlama, PIN, hatırlatma, kişisel dışa aktarım ve B2B yasal metin kiracı dalgası 22.

Bellek içi MemDB. Canlı veritabanına, 8021 portuna ve ağa bağlanmaz.
PIN, PIN özeti, cihaz parmak izi, IBAN, TC no ve belge içeriği loglanmaz.
"""
from __future__ import annotations

import asyncio
import copy
import hashlib
import io
import json
import subprocess
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import attendance  # noqa: E402
import attendance_security as sec  # noqa: E402
import data_export  # noqa: E402
import legal_docs  # noqa: E402
import tenant_scope  # noqa: E402
import tenant_scope_allowlist as allowlist  # noqa: E402
from auth_utils import hash_password  # noqa: E402
from dashboard_memdb import MemDB  # noqa: E402
from tenant_scope import TenantScope, bind, reset  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
CO_C = "co_c"
EMP = "emp-shared"
DEV = "dev-shared"
DEV_OLD = "dev-old"
PIN_B = "9999"
PIN_A = "1234"
IBAN_A = "TR-A-IBAN-11001"
IBAN_B = "TR-B-IBAN-88001"
IBAN_C = "TR-C-IBAN-77001"
TC_A = "TC-A-11001"
TC_B = "TC-B-88001"
TC_C = "TC-C-77001"
SALARY_A = 11001
SALARY_B = 88001
SALARY_C = 77001
TOK_A = "tok-a-legal"
TOK_B = "tok-b-legal"
_MONDAY = datetime(2026, 10, 12, 5, 55, tzinfo=timezone.utc)

_REMOVED = (
    ("attendance_security.py", "_claim_slot", "attendance_devices", "find_one"),
    ("attendance_security.py", "_claim_slot", "attendance_devices", "update_one"),
    ("attendance_security.py", "_enroll_punch_pin", "employees", "find_one"),
    ("attendance_security.py", "_enroll_punch_pin", "employees", "update_one"),
    ("attendance_security.py", "_on_leave", "leave_requests", "find_one"),
    ("attendance_security.py", "_point_slot", "attendance_devices", "find_one"),
    ("attendance_security.py", "_point_slot", "attendance_devices", "insert_one"),
    ("attendance_security.py", "_point_slot", "attendance_devices", "update_one"),
    ("attendance_security.py", "_punch_auth_state", "employees", "find_one"),
    ("attendance_security.py", "_release_slot_if_idle", "attendance_devices", "update_one"),
    ("attendance_security.py", "_upsert_bound_device", "attendance_devices", "find_one"),
    ("attendance_security.py", "_upsert_bound_device", "attendance_devices", "insert_one"),
    ("attendance_security.py", "_upsert_bound_device", "attendance_devices", "update_one"),
    ("attendance_security.py", "approve_device", "attendance_devices", "update_one"),
    ("attendance_security.py", "claim_once", "attendance_alerts", "find_one"),
    ("attendance_security.py", "gate_self_punch", "attendance_devices", "insert_one"),
    ("attendance_security.py", "release_new_bind", "attendance_devices", "update_one"),
    ("attendance_security.py", "revoke_device", "attendance_devices", "update_one"),
    ("attendance_security.py", "run_reminders", "attendance", "find_one"),
    ("attendance_security.py", "run_reminders", "shift_plans", "find_one"),
    ("data_export.py", "export_my_data", "employees", "find_one"),
    ("legal_docs.py", "get_b2b_legal", "contacts", "find_one"),
    ("legal_docs.py", "list_b2b_legal", "contacts", "find_one"),
)


def _run(coro):
    return asyncio.run(coro)


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


def _merge(company, employee=None):
    return attendance.merge_schedule(company, employee)


def _company(company_id, **extra):
    row = {
        "_id": company_id,
        "name": "Firma " + company_id,
        "work_schedule": {
            "timezone": "Europe/Istanbul",
            "start": "09:00",
            "end": "18:00",
            "work_days": [0, 1, 2, 3, 4],
        },
    }
    row.update(extra)
    return row


def _employee(company_id, **extra):
    row = {
        "_id": EMP,
        "company_id": company_id,
        "full_name": "Ali " + company_id,
        "status": "active",
        "user_id": "user-shared",
        "email": "ali@example.test",
    }
    row.update(extra)
    return row


def _user(company_ids, active=None):
    ids = list(company_ids)
    return {
        "_id": "user-shared",
        "id": "user-shared",
        "name": "Ali",
        "role": "admin",
        "email": "ali@example.test",
        "employee_id": EMP,
        "is_active": True,
        "is_super_admin": False,
        "company_ids": ids,
        "active_company_id": active or ids[0],
        "features": {"export_personal_data": True},
    }


def _zip_map(blob: bytes) -> dict:
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        return {name: zf.read(name).decode("utf-8") for name in zf.namelist()}


async def _export_blob(db, user):
    prev = data_export._db
    data_export._db = db

    async def _as_user(_request):
        return user

    data_export._token_user = _as_user
    try:
        resp = await data_export.export_my_data(object())
        chunks = []
        async for chunk in resp.body_iterator:
            chunks.append(chunk.encode("utf-8") if isinstance(chunk, str) else chunk)
        return b"".join(chunks)
    finally:
        data_export._db = prev


def test_shared_device_and_pin_stay_inside_company():
    db = MemDB()
    pin_b = hash_password(PIN_B)
    _add(db, "employees", _employee(CO_B, punch_pin_hash=pin_b))
    _add(db, "employees", _employee(CO_A))
    _add(db, "attendance_devices", {
        "_id": sec.device_row_id(EMP, DEV),
        "company_id": CO_B,
        "employee_id": EMP,
        "device_id": DEV,
        "status": "active",
        "device_token_hash": "hash-b-keep",
    })
    _add(db, "attendance_devices", {
        "_id": sec.active_slot_id(CO_B, EMP),
        "company_id": CO_B,
        "employee_id": EMP,
        "device_id": DEV,
        "status": "slot",
    })
    before = _digest(db, CO_B)

    async def go():
        state = await sec._punch_auth_state(
            db, _employee(CO_A), "pin", {"punch_pin": PIN_A},
        )
        gate = await sec.gate_self_punch(
            db,
            company_id=CO_A,
            employee=_employee(CO_A),
            schedule={"require_registered_device": True, "require_punch_auth": "pin"},
            req={"device_id": DEV, "punch_pin": PIN_A},
            notify=None,
            today="2026-10-12",
        )
        saved = await sec.commit_device_bind(db, gate)
        return state, gate, saved

    state, gate, saved = _run(go())
    assert state["ok"] is True and state["wrong"] is False and state["enroll"] is True
    assert gate["allow"] is True and gate["reason"] == "bind"
    assert saved["ok"] is True and saved["created"] is True
    own = _row(db, "employees", CO_A, EMP)
    assert own.get("punch_pin_hash") and own["punch_pin_hash"] != pin_b
    assert _row(db, "employees", CO_B, EMP)["punch_pin_hash"] == pin_b
    foreign = _row(db, "attendance_devices", CO_B, sec.device_row_id(EMP, DEV))
    assert foreign["status"] == "active"
    assert foreign["device_token_hash"] == "hash-b-keep"
    assert _row(db, "attendance_devices", CO_B, sec.active_slot_id(CO_B, EMP))["device_id"] == DEV
    own_dev = _row(db, "attendance_devices", CO_A, sec.device_row_id(EMP, DEV))
    assert own_dev is not None and own_dev["status"] == "active"
    assert _digest(db, CO_B) == before

    async def closed():
        missed = await sec._punch_auth_state(db, {"_id": EMP}, "pin", {"punch_pin": PIN_B})
        await sec._enroll_punch_pin(db, {"_id": EMP}, PIN_A)
        return missed

    missed = _run(closed())
    assert missed["ok"] is False and missed["wrong"] is False
    assert _row(db, "employees", CO_B, EMP)["punch_pin_hash"] == pin_b
    assert _digest(db, CO_B) == before


def test_approve_and_revoke_do_not_close_other_company_device():
    db = MemDB()
    shared_old = sec.device_row_id(EMP, DEV_OLD)
    pending_id = sec.device_row_id(EMP, DEV, pending=True)
    only_b = "devbind:emp-shared:only-b"
    _add(db, "attendance_devices", {
        "_id": shared_old, "company_id": CO_B, "employee_id": EMP,
        "device_id": DEV_OLD, "status": "active",
    })
    _add(db, "attendance_devices", {
        "_id": only_b, "company_id": CO_B, "employee_id": EMP,
        "device_id": "dev-b-only", "status": "active",
    })
    _add(db, "attendance_devices", {
        "_id": shared_old, "company_id": CO_A, "employee_id": EMP,
        "device_id": DEV_OLD, "status": "active",
    })
    _add(db, "attendance_devices", {
        "_id": pending_id, "company_id": CO_A, "employee_id": EMP,
        "device_id": DEV, "status": "pending",
    })
    before = _digest(db, CO_B)

    async def go():
        missing = await sec.approve_device(db, CO_A, only_b, "boss")
        revoked_missing = await sec.revoke_device(db, CO_A, only_b, "boss")
        approved = await sec.approve_device(db, CO_A, pending_id, "boss")
        await sec.release_new_bind(db, {
            "created": True,
            "doc": {
                "_id": shared_old, "company_id": CO_A, "employee_id": EMP, "device_id": DEV_OLD,
            },
        })
        return missing, revoked_missing, approved

    missing, revoked_missing, approved = _run(go())
    assert missing["status"] == 404 and missing["ok"] is False
    assert revoked_missing["status"] == 404 and revoked_missing["ok"] is False
    assert approved["ok"] is True and approved["status"] == 200
    assert _row(db, "attendance_devices", CO_A, pending_id)["status"] == "active"
    assert _row(db, "attendance_devices", CO_A, shared_old)["status"] == "revoked"
    assert _row(db, "attendance_devices", CO_B, shared_old)["status"] == "active"
    assert _row(db, "attendance_devices", CO_B, only_b)["status"] == "active"
    assert _row(db, "attendance_devices", CO_B, only_b)["device_id"] == "dev-b-only"
    assert _digest(db, CO_B) == before


def test_reminders_ignore_other_company_rows():
    db = MemDB()
    day = "2026-10-12"
    _add(db, "companies", _company(CO_B, name="Firma B"))
    _add(db, "companies", _company(CO_A, name="Firma A"))
    _add(db, "employees", _employee(CO_B, full_name="Gizli B"))
    _add(db, "employees", _employee(CO_A, full_name="Ali A"))
    _add(db, "leave_requests", {
        "_id": "lv-b", "company_id": CO_B, "employee_id": EMP, "status": "approved",
        "start_date": day, "end_date": day, "type": "annual",
    })
    _add(db, "shift_plans", {
        "_id": "plan-b", "company_id": CO_B, "employee_id": EMP, "date": day, "off": True,
    })
    _add(db, "attendance", {
        "_id": "att-b", "company_id": CO_B, "employee_id": EMP, "date": day,
        "check_in": "08:00", "status": "present",
    })
    key = f"remind-before:{EMP}:{day}"
    _add(db, "attendance_alerts", {
        "_id": f"{CO_A}:{key}", "company_id": CO_B, "type": "remind-before",
    })
    before = _digest(db, CO_B)

    async def go():
        on_leave = await sec._on_leave(db, EMP, day, CO_A)
        foreign_leave = await sec._on_leave(db, EMP, day, CO_B)
        claimed = await sec.claim_once(db, CO_A, "other-key")
        sent = []

        async def send(employee, kind, title, message, link):
            sent.append({"kind": kind, "employee_id": employee["_id"], "company_id": employee.get("company_id")})

        out = await sec.run_reminders(
            db, _merge, send, company_id=CO_A, now_utc=_MONDAY, window=0,
        )
        return on_leave, foreign_leave, claimed, sent, out

    on_leave, foreign_leave, claimed, sent, out = _run(go())
    assert on_leave is False
    assert foreign_leave is True
    assert claimed is True
    assert [row["kind"] for row in sent] == ["before"]
    assert sent[0]["company_id"] == CO_A
    assert out and out[0]["employee_id"] == EMP
    assert _row(db, "leave_requests", CO_B, "lv-b")["status"] == "approved"
    assert _row(db, "shift_plans", CO_B, "plan-b")["off"] is True
    assert _row(db, "attendance", CO_B, "att-b")["check_in"] == "08:00"
    assert _row(db, "attendance_alerts", CO_B, f"{CO_A}:{key}")["type"] == "remind-before"
    assert _digest(db, CO_B) == before


def test_export_hides_non_member_employee_and_keeps_member_companies():
    db = MemDB()
    _add(db, "companies", _company(CO_C, name="Firma C"))
    _add(db, "companies", _company(CO_B, name="Firma B"))
    _add(db, "companies", _company(CO_A, name="Firma A"))
    _add(db, "employees", _employee(CO_C, salary=SALARY_C, iban=IBAN_C, tc_no=TC_C))
    _add(db, "employees", _employee(CO_B, salary=SALARY_B, iban=IBAN_B, tc_no=TC_B))
    _add(db, "employees", _employee(CO_A, salary=SALARY_A, iban=IBAN_A, tc_no=TC_A))
    _add(db, "payrolls", {
        "_id": "pay-b", "company_id": CO_B, "employee_id": EMP, "net": SALARY_B, "note": IBAN_B,
    })
    _add(db, "payrolls", {
        "_id": "pay-a", "company_id": CO_A, "employee_id": EMP, "net": SALARY_A, "note": IBAN_A,
    })
    _add(db, "payrolls", {
        "_id": "pay-c", "company_id": CO_C, "employee_id": EMP, "net": SALARY_C, "note": IBAN_C,
    })
    before_b = _digest(db, CO_B)
    before_c = _digest(db, CO_C)

    only_a = _zip_map(_run(_export_blob(db, _user([CO_A]))))
    person = json.loads(only_a["personel.json"])
    assert person["company_id"] == CO_A
    assert person["salary"] == SALARY_A
    assert person["iban"] == IBAN_A
    assert person["tc_no"] == TC_A
    blob_a = "\n".join(only_a.values())
    assert IBAN_B not in blob_a and TC_B not in blob_a and str(SALARY_B) not in blob_a
    assert IBAN_C not in blob_a and TC_C not in blob_a and str(SALARY_C) not in blob_a
    assert IBAN_A in only_a["bordrolar.json"]
    assert IBAN_B not in only_a["bordrolar.json"]

    both = _zip_map(_run(_export_blob(db, _user([CO_A, CO_B], active=CO_A))))
    kept = json.loads(both["personel.json"])
    assert kept["company_id"] in (CO_A, CO_B)
    blob_both = "\n".join(both.values())
    assert IBAN_B in blob_both and TC_B in blob_both and str(SALARY_B) in blob_both
    assert IBAN_C not in blob_both and TC_C not in blob_both and str(SALARY_C) not in blob_both
    assert _digest(db, CO_B) == before_b
    assert _digest(db, CO_C) == before_c


def test_export_without_active_company_employee_keeps_other_membership():
    db = MemDB()
    _add(db, "companies", _company(CO_C))
    _add(db, "companies", _company(CO_B))
    _add(db, "companies", _company(CO_A))
    _add(db, "employees", _employee(CO_C, salary=SALARY_C, iban=IBAN_C, tc_no=TC_C))
    _add(db, "employees", _employee(CO_B, salary=SALARY_B, iban=IBAN_B, tc_no=TC_B))
    files = _zip_map(_run(_export_blob(db, _user([CO_A, CO_B], active=CO_A))))
    person = json.loads(files["personel.json"])
    assert person["company_id"] == CO_B
    assert person["salary"] == SALARY_B
    assert person["iban"] == IBAN_B
    assert person["tc_no"] == TC_B
    blob = "\n".join(files.values())
    assert IBAN_C not in blob and TC_C not in blob and str(SALARY_C) not in blob


def test_b2b_legal_public_token_stays_on_own_company():
    db = MemDB()
    legal_docs._db = db
    _add(db, "companies", _company(CO_B, name="Firma B", iban=IBAN_B, tax_number="9990000002"))
    _add(db, "companies", _company(CO_A, name="Firma A", iban=IBAN_A, tax_number="1110000001"))
    _add(db, "contacts", {
        "_id": "cnt-b", "company_id": CO_B, "b2b_token": TOK_B, "b2b_enabled": True, "name": "Cari B",
    })
    _add(db, "contacts", {
        "_id": "cnt-a", "company_id": CO_A, "b2b_token": TOK_A, "b2b_enabled": True, "name": "Cari A",
    })
    before = _digest(db, CO_B)
    listed = _run(legal_docs.list_b2b_legal(TOK_A))
    doc = _run(legal_docs.get_b2b_legal(TOK_A, "on-bilgilendirme"))
    assert listed["seller"]["name"] == "Firma A"
    assert listed["seller"]["iban"] == IBAN_A
    assert IBAN_B not in json.dumps(listed, ensure_ascii=False)
    assert IBAN_A in doc["text"]
    assert IBAN_B not in doc["text"]
    assert doc["seller"]["name"] == "Firma A"
    assert _digest(db, CO_B) == before


def test_b2b_session_rejects_other_company_contact():
    db = MemDB()
    legal_docs._db = db
    _add(db, "companies", _company(CO_B, name="Firma B", iban=IBAN_B))
    _add(db, "companies", _company(CO_A, name="Firma A", iban=IBAN_A))
    _add(db, "contacts", {
        "_id": "cnt-b", "company_id": CO_B, "b2b_token": TOK_B, "b2b_enabled": True, "name": "Cari B",
    })
    _add(db, "contacts", {
        "_id": "cnt-a", "company_id": CO_A, "b2b_token": TOK_A, "b2b_enabled": True, "name": "Cari A",
    })
    before = _digest(db, CO_B)

    async def go():
        foreign = TenantScope(
            company_id=CO_A,
            allowed=frozenset([CO_A]),
            kind="b2b",
            actor_id="cnt-b",
            reason="b2b",
            contact_id="cnt-b",
        )
        token = bind(foreign)
        try:
            with pytest.raises(HTTPException) as listed:
                await legal_docs.list_b2b_legal(TOK_B)
            with pytest.raises(HTTPException) as fetched:
                await legal_docs.get_b2b_legal(TOK_B, "on-bilgilendirme")
            with pytest.raises(HTTPException) as by_id:
                await legal_docs.list_b2b_legal("cnt-b")
        finally:
            reset(token)
        own_scope = TenantScope(
            company_id=CO_A,
            allowed=frozenset([CO_A]),
            kind="b2b",
            actor_id="cnt-a",
            reason="b2b",
            contact_id="cnt-a",
        )
        token = bind(own_scope)
        try:
            own = await legal_docs.list_b2b_legal(TOK_A)
            with pytest.raises(HTTPException) as wrong_token:
                await legal_docs.get_b2b_legal(TOK_B, "on-bilgilendirme")
        finally:
            reset(token)
        return listed.value, fetched.value, by_id.value, own, wrong_token.value

    listed, fetched, by_id, own, wrong_token = _run(go())
    assert listed.status_code == 404
    assert fetched.status_code == 404
    assert by_id.status_code == 404
    assert wrong_token.status_code == 404
    assert own["seller"]["name"] == "Firma A"
    assert own["seller"]["iban"] == IBAN_A
    assert _row(db, "contacts", CO_B, "cnt-b")["name"] == "Cari B"
    assert _digest(db, CO_B) == before
    tenant_scope.reset_violations()


def test_wave22_baseline_keys_removed():
    base = allowlist.TENANT_SCOPE_BASELINE
    present = [key for key in _REMOVED if key in base]
    assert present == []
    assert len(_REMOVED) == 23
    assert len(set(_REMOVED)) == 23
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
