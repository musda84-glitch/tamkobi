"""server.py kiracı dalgası 2 (personel / İK). Bellek içi MemDB.

Canlı veritabanına ve 8021'deki sunucuya bağlanmaz.
Değer, filtre, şirket kimliği, e-posta, PIN veya kayıt içeriği loglanmaz.
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
import expenses  # noqa: E402
import notify  # noqa: E402
import personnel_payments  # noqa: E402
import rbac  # noqa: E402
import server  # noqa: E402
import tenant_scope  # noqa: E402
import tenant_scope_allowlist as allowlist  # noqa: E402
import trash  # noqa: E402
from dashboard_memdb import MemColl, MemDB, _split_field_ops  # noqa: E402
from models import Employee  # noqa: E402
from mysql_store import apply_update, match_query, new_upsert_doc  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
EMP = "emp-dup"
EMP_A = "emp-a"
EMP_B = "emp-b"
EMP_OLD = "emp-old"
EMP_INV = "emp-inv"
LEAVE = "leave-dup"
LEAVE_B = "leave-b"
BONUS = "bonus-dup"
BONUS_B = "bonus-b"
PAY = "pay-dup"
PAY_B = "pay-b"
PAY_HAPPY = "pay-happy"
MONTH = "2026-10"

_REMOVED = (
    ("server.py", "assign_office_task", "employees", "update_one"),
    ("server.py", "cancel_leave", "leave_requests", "find_one"),
    ("server.py", "cancel_leave", "leave_requests", "update_one"),
    ("server.py", "create_employee", "employees", "insert_one"),
    ("server.py", "decide_bonus", "bonus_payments", "find_one"),
    ("server.py", "decide_bonus", "bonus_payments", "update_one"),
    ("server.py", "decide_leave", "employees", "update_one"),
    ("server.py", "decide_leave", "leave_requests", "find_one"),
    ("server.py", "decide_leave", "leave_requests", "update_one"),
    ("server.py", "delete_payroll", "payrolls", "find_one"),
    ("server.py", "employee_card", "attendance", "find"),
    ("server.py", "employee_card", "bonus_payments", "find"),
    ("server.py", "employee_card", "employees", "update_one"),
    ("server.py", "employee_card", "expenses", "find"),
    ("server.py", "employee_card", "files", "find"),
    ("server.py", "employee_card", "leave_requests", "find"),
    ("server.py", "employee_card", "payrolls", "find"),
    ("server.py", "employee_card", "personnel_movements", "find"),
    ("server.py", "employee_card", "user_invites", "find_one"),
    ("server.py", "employee_create_user", "employees", "update_one"),
    ("server.py", "generate_payroll", "attendance", "find"),
    ("server.py", "generate_payroll", "bonus_payments", "find"),
    ("server.py", "generate_payroll", "employees", "find"),
    ("server.py", "generate_payroll", "payrolls", "replace_one"),
    ("server.py", "geo_status", "attendance", "find_one"),
    ("server.py", "geo_status", "employees", "find_one"),
    ("server.py", "list_employees", "expenses", "find"),
    ("server.py", "list_employees", "leave_requests", "find"),
    ("server.py", "my_personnel_self", "attendance", "find"),
    ("server.py", "my_personnel_self", "bonus_payments", "find"),
    ("server.py", "my_personnel_self", "expenses", "find"),
    ("server.py", "my_personnel_self", "leave_requests", "find"),
    ("server.py", "my_personnel_self", "payrolls", "find"),
    ("server.py", "my_personnel_self", "personnel_movements", "find"),
    ("server.py", "personnel_receipt_pdf", "personnel_receipts", "find_one"),
    ("server.py", "set_employee_active_duty", "employees", "update_one"),
    ("server.py", "set_shopfloor_pin", "employees", "update_one"),
    ("server.py", "settle_employee", "bonus_payments", "find"),
    ("server.py", "settle_employee", "expenses", "find"),
    ("server.py", "settle_employee", "payrolls", "find"),
    ("server.py", "terminate_employee", "employees", "find_one"),
    ("server.py", "terminate_employee", "employees", "update_one"),
    ("server.py", "update_employee", "employees", "find_one"),
    ("server.py", "update_employee", "employees", "update_one"),
)


def _run(coro):
    return asyncio.run(coro)


def _user(company_id, role="admin", employee_id=None, uid=None):
    uid = uid or ("user-" + role + "-" + company_id)
    doc = {
        "_id": uid,
        "id": uid,
        "name": "Kullanici",
        "role": role,
        "is_active": True,
        "is_super_admin": False,
        "company_ids": [company_id],
        "active_company_id": company_id,
    }
    if employee_id:
        doc["employee_id"] = employee_id
    return doc


class _Coll(MemColl):
    async def delete_many(self, query=None):
        query = _split_field_ops(query or {})
        kept = []
        removed = 0
        for doc in self.docs:
            if match_query(doc, query):
                removed += 1
            else:
                kept.append(doc)
        self.docs[:] = kept
        return SimpleNamespace(deleted_count=removed)

    async def delete_one(self, query=None):
        tenant_scope.check(self.name, "delete_one", query=query)
        query = _split_field_ops(query or {})
        for i, doc in enumerate(self.docs):
            if match_query(doc, query):
                del self.docs[i]
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def update_one(self, query, update, upsert=False):
        tenant_scope.check(self.name, "update_one", query=query, update=update, upsert=upsert)
        query = _split_field_ops(query or {})
        for i, doc in enumerate(self.docs):
            if match_query(doc, query):
                self.docs[i] = apply_update(doc, update, query)
                return SimpleNamespace(modified_count=1, matched_count=1, upserted_id=None)
        if not upsert:
            return SimpleNamespace(modified_count=0, matched_count=0, upserted_id=None)
        created = new_upsert_doc(update, query)
        self.docs.append(created)
        return SimpleNamespace(modified_count=0, matched_count=0, upserted_id=created.get("_id"))

    async def find_one_and_update(self, query, update, upsert=False, return_document=True):
        query = _split_field_ops(query or {})
        for i, doc in enumerate(self.docs):
            if match_query(doc, query):
                before = copy.deepcopy(doc)
                self.docs[i] = apply_update(doc, update, query)
                return copy.deepcopy(self.docs[i] if return_document else before)
        if not upsert:
            return None
        created = new_upsert_doc(update, query)
        self.docs.append(created)
        return copy.deepcopy(created)

    async def replace_one(self, query, replacement, upsert=False):
        tenant_scope.check(self.name, "replace_one", query=query, doc=replacement, upsert=upsert)
        query = _split_field_ops(query or {})
        for i, doc in enumerate(self.docs):
            if match_query(doc, query):
                stored = copy.deepcopy(replacement)
                if doc.get("_id") is not None:
                    stored["_id"] = doc["_id"]
                self.docs[i] = stored
                return SimpleNamespace(matched_count=1, modified_count=1, upserted_id=None)
        if not upsert:
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)
        stored = copy.deepcopy(replacement)
        self.docs.append(stored)
        return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=stored.get("_id"))


class _DB(MemDB):
    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = _Coll(name, self)
            self._cols[name] = coll
        return coll


def _bind():
    db = _DB()
    prev = (server.db, attendance._db, trash._db, rbac._db)
    server.db = db
    attendance._db = db
    trash._db = db
    rbac._db = db
    return db, prev


def _restore(prev):
    server.db, attendance._db, trash._db, rbac._db = prev


def _emp(eid, company_id, name, **extra):
    doc = {
        "_id": eid,
        "full_name": name,
        "status": "active",
        "salary": 100.0,
        "pay_type": "monthly",
        "used_leave_days": 0,
        "annual_leave_days": 14,
        "start_date": "2024-01-01",
        "department": "Uretim",
        "position": "Usta",
        "phone": "555000",
        "email": "personel@example.com",
        "tc_kimlik": "10000000000",
        "office_tasks": [],
        "company_id": company_id,
    }
    doc.update(extra)
    return doc


def _add(db, coll, doc):
    db[coll].docs.append(doc)


def _seed(db, today):
    _add(db, "companies", {"_id": CO_A, "name": "Firma A", "office_task_types": [{"id": "t1", "name": "Sayim"}]})
    _add(db, "companies", {"_id": CO_B, "name": "Firma B", "office_task_types": [{"id": "t1", "name": "Sayim"}]})
    _add(db, "employees", _emp(EMP_A, CO_A, "Person A", salary=100.0, user_id="user-admin-co_a"))
    _add(db, "employees", _emp(EMP, CO_A, "Ortak A", salary=100.0, used_leave_days=9, user_id="user-self-a"))
    _add(db, "employees", _emp(EMP_INV, CO_A, "Davet A", email="davet-a@example.com"))
    _add(db, "employees", _emp(EMP_OLD, None, "Eski A", used_leave_days=4, salary=40.0))
    _add(db, "employees", _emp(EMP_B, CO_B, "Person B", salary=900.0, used_leave_days=3))
    _add(db, "employees", _emp(EMP, CO_B, "Ortak B", salary=900.0, used_leave_days=9))
    _add(db, "employees", _emp(EMP_INV, CO_B, "Davet B", email="davet-b@example.com"))
    _add(db, "employees", _emp(EMP_OLD, CO_B, "Eski B", salary=80.0, used_leave_days=4))

    _add(db, "leave_requests", {
        "_id": LEAVE, "company_id": CO_A, "employee_id": EMP, "employee_name": "Ortak A",
        "type": "annual", "start_date": "2026-10-01", "end_date": "2026-10-02", "days": 2,
        "status": "pending", "reason": "",
    })
    _add(db, "leave_requests", {
        "_id": "leave-a-ok", "company_id": CO_A, "employee_id": EMP, "employee_name": "Ortak A",
        "type": "annual", "start_date": "2026-03-01", "end_date": "2026-03-01", "days": 1,
        "status": "approved", "reason": "",
    })
    _add(db, "leave_requests", {
        "_id": "leave-cancel", "company_id": CO_A, "employee_id": EMP, "employee_name": "Ortak A",
        "type": "annual", "start_date": "2026-10-08", "end_date": "2026-10-08", "days": 1,
        "status": "pending", "reason": "",
    })
    _add(db, "leave_requests", {
        "_id": LEAVE_B, "company_id": CO_B, "employee_id": EMP_B, "employee_name": "Person B",
        "type": "annual", "start_date": "2026-10-03", "end_date": "2026-10-03", "days": 1,
        "status": "pending", "reason": "",
    })
    _add(db, "leave_requests", {
        "_id": LEAVE, "company_id": CO_B, "employee_id": EMP, "employee_name": "Ortak B",
        "type": "annual", "start_date": "2026-04-01", "end_date": "2026-04-03", "days": 3,
        "status": "pending", "reason": "",
    })
    _add(db, "leave_requests", {
        "_id": "leave-cancel", "company_id": CO_B, "employee_id": EMP, "employee_name": "Ortak B",
        "type": "annual", "start_date": "2026-10-09", "end_date": "2026-10-09", "days": 1,
        "status": "pending", "reason": "",
    })
    _add(db, "leave_requests", {
        "_id": "leave-b-ok", "company_id": CO_B, "employee_id": EMP, "employee_name": "Ortak B",
        "type": "annual", "start_date": "2026-05-01", "end_date": "2026-05-05", "days": 5,
        "status": "approved", "reason": "",
    })
    _add(db, "leave_requests", {
        "_id": "leave-old-b", "company_id": CO_B, "employee_id": EMP_OLD, "employee_name": "Eski B",
        "type": "annual", "start_date": "2026-06-01", "end_date": "2026-06-02", "days": 2,
        "status": "approved", "reason": "",
    })

    _add(db, "bonus_payments", {
        "_id": BONUS, "company_id": CO_A, "employee_id": EMP, "employee_name": "Ortak A",
        "type": "prim", "amount": 15, "status": "pending", "period": MONTH, "created_at": "2026-10-01T00:00:00+00:00",
    })
    _add(db, "bonus_payments", {
        "_id": BONUS_B, "company_id": CO_B, "employee_id": EMP_B, "type": "prim", "amount": 70,
        "status": "pending", "period": MONTH, "created_at": "2026-10-01T00:00:00+00:00",
    })
    _add(db, "bonus_payments", {
        "_id": BONUS, "company_id": CO_B, "employee_id": EMP, "type": "prim", "amount": 500,
        "status": "pending", "period": MONTH, "created_at": "2026-10-02T00:00:00+00:00",
    })
    _add(db, "bonus_payments", {
        "_id": "bonus-old-a", "company_id": CO_A, "employee_id": EMP_OLD, "type": "prim", "amount": 4,
        "status": "pending", "period": MONTH, "created_at": "2026-10-01T00:00:00+00:00",
    })
    _add(db, "bonus_payments", {
        "_id": "bonus-old-b", "company_id": CO_B, "employee_id": EMP_OLD, "type": "prim", "amount": 40,
        "status": "pending", "period": MONTH, "created_at": "2026-10-02T00:00:00+00:00",
    })

    _add(db, "payrolls", {
        "_id": PAY, "company_id": CO_A, "employee_id": EMP, "employee_name": "Ortak A",
        "period": MONTH, "status": "pending", "net_salary": 100, "final_payable": 100,
        "paid_amount": 0, "bonus": 3, "deduction": 0, "advance_payment": 0,
    })
    _add(db, "payrolls", {
        "_id": PAY_B, "company_id": CO_B, "employee_id": EMP_B, "employee_name": "Person B",
        "period": MONTH, "status": "pending", "net_salary": 900, "final_payable": 900, "paid_amount": 0,
    })
    _add(db, "payrolls", {
        "_id": PAY, "company_id": CO_B, "employee_id": EMP, "employee_name": "Ortak B",
        "period": MONTH, "status": "pending", "net_salary": 1, "final_payable": 900, "bonus": 77,
        "paid_amount": 0, "deduction": 0, "advance_payment": 0,
    })
    _add(db, "payrolls", {
        "_id": PAY_HAPPY, "company_id": CO_A, "employee_id": EMP_A, "employee_name": "Person A",
        "period": MONTH, "status": "pending", "net_salary": 100, "final_payable": 100, "paid_amount": 0,
    })
    _add(db, "payrolls", {
        "_id": "pay-old-a", "company_id": CO_A, "employee_id": EMP_OLD, "employee_name": "Eski A",
        "period": MONTH, "status": "pending", "net_salary": 40, "final_payable": 40, "paid_amount": 0,
    })
    _add(db, "payrolls", {
        "_id": "pay-old-b", "company_id": CO_B, "employee_id": EMP_OLD, "employee_name": "Eski B",
        "period": MONTH, "status": "pending", "net_salary": 80, "final_payable": 80, "paid_amount": 0,
    })

    _add(db, "personnel_movements", {
        "_id": "mov-a", "company_id": CO_A, "employee_id": EMP, "status": "posted", "kind": "reimburse",
        "amount": 6, "date": "2026-10-02", "created_at": "2026-10-02T00:00:00+00:00",
    })
    _add(db, "personnel_movements", {
        "_id": "mov-b", "company_id": CO_B, "employee_id": EMP, "status": "posted", "kind": "reimburse",
        "amount": 60, "date": "2026-10-02", "created_at": "2026-10-02T00:00:00+00:00",
    })
    _add(db, "attendance", {
        "_id": "att-a", "company_id": CO_A, "employee_id": EMP, "date": today, "status": "present",
        "note": "day-a", "employee_confirmed": True,
    })
    _add(db, "attendance", {
        "_id": "att-b", "company_id": CO_B, "employee_id": EMP, "date": today, "status": "present",
        "note": "day-b", "employee_confirmed": True,
    })
    for n in range(3):
        _add(db, "attendance", {
            "_id": "att-b-extra-" + str(n), "company_id": CO_B, "employee_id": EMP,
            "date": f"{MONTH}-1{n}", "status": "present", "employee_confirmed": True,
        })
    _add(db, "attendance", {
        "_id": "att-old-a", "company_id": CO_A, "employee_id": EMP_OLD, "date": f"{MONTH}-02",
        "status": "present", "employee_confirmed": True,
    })
    _add(db, "attendance", {
        "_id": "att-old-b", "company_id": CO_B, "employee_id": EMP_OLD, "date": f"{MONTH}-03",
        "status": "absent", "employee_confirmed": True,
    })
    _add(db, "expenses", {
        "_id": "exp-a", "company_id": CO_A, "employee_id": EMP, "total": 12, "payment_status": "unpaid",
        "category": "Masraf", "date": f"{MONTH}-04", "is_recurring": False,
    })
    _add(db, "expenses", {
        "_id": "exp-b", "company_id": CO_B, "employee_id": EMP, "total": 80, "payment_status": "unpaid",
        "category": "Masraf", "date": f"{MONTH}-04", "is_recurring": False,
    })
    _add(db, "expenses", {
        "_id": "exp-rec-a", "company_id": CO_A, "employee_id": EMP, "total": 5, "payment_status": "template",
        "category": "Yemek", "date": f"{MONTH}-01", "is_recurring": True,
    })
    _add(db, "expenses", {
        "_id": "exp-rec-b", "company_id": CO_B, "employee_id": EMP, "total": 50, "payment_status": "template",
        "category": "Yemek", "date": f"{MONTH}-01", "is_recurring": True,
    })
    _add(db, "files", {
        "_id": "file-a", "company_id": CO_A, "entity": "employee", "entity_id": EMP,
        "is_deleted": False, "storage_path": "a.bin", "created_at": "2026-10-01T00:00:00+00:00",
    })
    _add(db, "files", {
        "_id": "file-b", "company_id": CO_B, "entity": "employee", "entity_id": EMP,
        "is_deleted": False, "storage_path": "b.bin", "created_at": "2026-10-01T00:00:00+00:00",
    })
    _add(db, "user_invites", {
        "_id": "inv-a", "company_id": CO_A, "employee_id": EMP, "email": "davet-a@example.com",
        "accepted_at": None, "role": "sales",
    })
    _add(db, "user_invites", {
        "_id": "inv-b", "company_id": CO_B, "employee_id": EMP, "email": "davet-b@example.com",
        "accepted_at": None, "role": "sales",
    })
    _add(db, "users", {
        "_id": "user-self-a", "employee_id": EMP, "email": "self-a@example.com", "is_active": True,
        "role": "personel", "company_ids": [CO_A], "active_company_id": CO_A, "name": "Self A",
    })
    _add(db, "users", {
        "_id": "user-self-b", "employee_id": EMP, "email": "self-b@example.com", "is_active": True,
        "role": "personel", "company_ids": [CO_B], "active_company_id": CO_B, "name": "Self B",
    })
    _add(db, "personnel_receipts", {
        "_id": "rcpt-a", "company_id": CO_A, "employee_id": EMP, "employee_name": "Ortak A",
        "period": MONTH, "date": "2026-10-05", "total": 10, "lines": [], "status": "posted",
    })
    _add(db, "personnel_receipts", {
        "_id": "rcpt-b", "company_id": CO_B, "employee_id": EMP_B, "employee_name": "Person B",
        "period": MONTH, "date": "2026-10-05", "total": 90, "lines": [], "status": "posted",
    })
    _add(db, "personnel_receipts", {
        "_id": "rcpt-a", "company_id": CO_B, "employee_id": EMP, "employee_name": "Ortak B",
        "period": MONTH, "date": "2026-10-06", "total": 90, "lines": [], "status": "posted",
    })


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


def _doc(db, coll, doc_id, company_id):
    for row in db[coll].docs:
        if row.get("_id") == doc_id and row.get("company_id") == company_id:
            return row
    return None


def _blank(db):
    for row in db.employees.docs:
        if row.get("_id") == EMP_OLD and not row.get("company_id"):
            return row
    return None


def _ids(node, found=None):
    found = found if found is not None else set()
    if isinstance(node, dict):
        if node.get("id"):
            found.add(str(node["id"]))
        if node.get("_id"):
            found.add(str(node["_id"]))
        for value in node.values():
            _ids(value, found)
    elif isinstance(node, list):
        for item in node:
            _ids(item, found)
    return found


_B_IDS = {
    LEAVE_B, BONUS_B, PAY_B, "leave-b-ok", "leave-old-b", "bonus-old-b", "pay-old-b",
    "mov-b", "att-b", "att-b-extra-0", "att-b-extra-1", "att-b-extra-2", "exp-b", "exp-rec-b",
    "file-b", "inv-b", "rcpt-b", EMP_B,
}


async def _expect(coro, detail):
    with pytest.raises(HTTPException) as exc:
        await coro
    assert exc.value.status_code == 404
    assert exc.value.detail == detail


def test_cross_tenant_root_ids_are_404():
    db, prev = _bind()
    try:
        today = attendance._today()
        _seed(db, today)
        user = _user(CO_A)
        before = _digest(db, CO_B)

        async def run():
            await _expect(server.assign_office_task(EMP_B, {"task_type_id": "t1"}, user), "Çalışan bulunamadı.")
            await _expect(server.set_employee_active_duty(EMP_B, {"kind": "office", "title": "Ic"}, user), "Çalışan bulunamadı.")
            await _expect(server.decide_leave(LEAVE_B, {"status": "approved"}, user), "İzin bulunamadı.")
            await _expect(server.cancel_leave(LEAVE_B, user), "İzin bulunamadı.")
            await _expect(server.decide_bonus(BONUS_B, {"status": "approved"}, user), "Kayıt bulunamadı.")
            await _expect(server.update_employee(EMP_B, {"phone": "500"}, user), "Çalışan bulunamadı.")
            await _expect(server.employee_card(EMP_B, MONTH, user), "Çalışan bulunamadı.")
            await _expect(server.settle_employee(EMP_B, {"lines": [{"kind": "salary", "amount": 1}]}, user=user), "Çalışan bulunamadı.")
            await _expect(server.terminate_employee(EMP_B, {"confirm": True}, user), "Çalışan bulunamadı.")
            await _expect(server.personnel_receipt_pdf("rcpt-b", user), "Makbuz bulunamadı.")
            await _expect(server.employee_create_user(EMP_B, {"email": "b@example.com", "password": "secret1"}, None, user), "Çalışan bulunamadı.")
            await _expect(server.set_shopfloor_pin(EMP_B, {"pin": "2468"}, user), "Çalışan bulunamadı.")
            await _expect(server.delete_payroll(PAY_B, user), "Bordro kaydı bulunamadı.")

        _run(run())
        assert _digest(db, CO_B) == before
        assert _doc(db, "employees", EMP_B, CO_B)["status"] == "active"
        assert _doc(db, "leave_requests", LEAVE_B, CO_B)["status"] == "pending"
        assert _doc(db, "bonus_payments", BONUS_B, CO_B)["status"] == "pending"
        assert _doc(db, "payrolls", PAY_B, CO_B)["status"] == "pending"
    finally:
        _restore(prev)


def test_shared_rows_stay_out_and_unwritten(monkeypatch):
    db, prev = _bind()
    seen = {"payrolls": [], "bonuses": [], "expenses": []}

    async def _lines(db_, emp, company, body, balance=None, pay_date="", period="", request=None, actor=None):
        return {"status": "success", "paid": []}

    real_recv = server._employee_receivable

    async def _recv(emp, payrolls, bonuses, month, expenses=None):
        seen["payrolls"].append(sorted(p.get("_id") or p.get("id") for p in payrolls))
        seen["bonuses"].append(sorted(b.get("_id") or b.get("id") for b in bonuses))
        return await real_recv(emp, payrolls, bonuses, month, expenses=expenses)

    async def _pay_exp(exp_id, pay_req, user):
        seen["expenses"].append(exp_id)
        return {"status": "success"}

    async def _pay_roll(payroll_id, req, user, idempotency_key=""):
        return {"status": "success"}

    async def _no_push(db_, note):
        return {"sent": 0}

    async def _invite(req, request):
        return {"mail": {"detail": "Davet hazir."}}

    async def _no_reverse(doc, collection):
        return None

    try:
        today = attendance._today()
        _seed(db, today)
        user = _user(CO_A)
        self_user = _user(CO_A, role="personel", employee_id=EMP, uid="user-self-a")
        before = _digest(db, CO_B)
        monkeypatch.setattr(personnel_payments, "apply_payment_lines", _lines)
        monkeypatch.setattr(server, "_employee_receivable", _recv)
        monkeypatch.setattr(expenses, "_pay_expense_core", _pay_exp)
        monkeypatch.setattr(server, "_pay_payroll_core", _pay_roll)
        monkeypatch.setattr(notify, "dispatch_push", _no_push)
        monkeypatch.setattr(rbac, "invite_user", _invite)
        monkeypatch.setattr(server, "_reverse_personnel_payment_links", _no_reverse)

        async def run():
            office = await server.assign_office_task(EMP, {"task_type_id": "t1"}, user)
            duty = await server.set_employee_active_duty(EMP, {"kind": "office", "title": "Ic gorev"}, user)
            decided = await server.decide_leave(LEAVE, {"status": "approved"}, user)
            cancelled = await server.cancel_leave("leave-cancel", user)
            bonus = await server.decide_bonus(BONUS, {"status": "rejected"}, user)
            geo_user = _user(CO_A, uid="user-geo-a")
            geo_user["employee_id"] = EMP
            geo = await server.geo_status(company_id=CO_A, user=geo_user)
            listed = await server.list_employees(company_id=CO_A, user=user)
            updated = await server.update_employee(EMP, {"full_name": "Ortak A2", "company_id": CO_B}, user)
            card = await server.employee_card(EMP, MONTH, user)
            await server.settle_employee(EMP, {"lines": [{"kind": "salary", "amount": 1}], "period": MONTH}, user=user)
            await server.settle_employee(
                EMP, {"mode": "split", "kinds": ["expense"], "account_id": "acc-a", "period": MONTH}, user=user,
            )
            generated = await server.generate_payroll(
                {"company_id": CO_A, "period": MONTH, "employee_id": EMP}, user,
            )
            self_view = await server.my_personnel_self(MONTH, self_user)
            invited = await server.employee_create_user(
                EMP_INV, {"email": "davet-a@example.com", "role": "sales"}, None, user,
            )
            created = await server.employee_create_user(
                EMP_INV, {"email": "ortak-a@example.com", "password": "secret1", "role": "sales"}, None, user,
            )
            pinned = await server.set_shopfloor_pin(EMP, {"pin": "2468"}, user)
            terminated = await server.terminate_employee(EMP_A, {"confirm": True, "end_date": "2026-10-15"}, user)
            pdf = await server.personnel_receipt_pdf("rcpt-a", user)
            deleted = await server.delete_payroll(PAY_HAPPY, user)
            return office, duty, decided, cancelled, bonus, geo, listed, updated, card, generated, self_view, created, invited, pinned, terminated, pdf, deleted

        (
            office, duty, decided, cancelled, bonus, geo, listed, updated, card, generated,
            self_view, created, invited, pinned, terminated, pdf, deleted,
        ) = _run(run())

        assert _digest(db, CO_B) == before
        assert _doc(db, "employees", EMP, CO_B)["full_name"] == "Ortak B"
        assert _doc(db, "employees", EMP, CO_B)["used_leave_days"] == 9
        assert _doc(db, "employees", EMP, CO_B)["office_tasks"] == []
        assert _doc(db, "employees", EMP, CO_B).get("active_duty") in (None, {})
        assert "shopfloor_pin_hash" not in _doc(db, "employees", EMP, CO_B)
        assert _doc(db, "employees", EMP, CO_B).get("user_id") in (None, "")
        assert _doc(db, "employees", EMP_INV, CO_B)["email"] == "davet-b@example.com"
        assert _doc(db, "employees", EMP_INV, CO_B).get("user_id") in (None, "")
        assert _doc(db, "leave_requests", "leave-cancel", CO_B)["status"] == "pending"
        assert _doc(db, "leave_requests", LEAVE, CO_B)["status"] == "pending"
        assert _doc(db, "bonus_payments", BONUS, CO_B)["status"] == "pending"
        assert _doc(db, "payrolls", PAY, CO_B)["bonus"] == 77
        assert _doc(db, "payrolls", PAY, CO_B)["net_salary"] == 1
        assert _doc(db, "personnel_receipts", "rcpt-a", CO_B)["total"] == 90
        assert _doc(db, "employees", EMP, CO_A)["used_leave_days"] == 3
        assert _doc(db, "employees", EMP, CO_A)["full_name"] == "Ortak A2"
        assert office["status"] == "success"
        assert duty["active_duty"]["kind"] == "office"
        assert decided["status"] == "approved"
        assert cancelled["status"] == "cancelled"
        assert bonus["status"] == "rejected"
        assert geo["employee"]["full_name"] == "Ortak A"
        assert geo["today"]["note"] == "day-a"
        ids = [row["id"] for row in listed]
        assert EMP_B not in ids
        assert ids.count(EMP) == 1
        ortak = next(row for row in listed if row["id"] == EMP)
        assert ortak["full_name"] == "Ortak A"
        assert ortak["balance"]["bonus_pending"] == 15
        assert ortak["balance"]["unpaid_expenses"] == 12
        assert ortak["leave_balance"]["used"] == 3
        assert updated["company_id"] == CO_A
        assert updated["full_name"] == "Ortak A2"
        assert {row["id"] for row in card["payrolls"]} == {PAY}
        assert {row["id"] for row in card["leaves"]} == {LEAVE, "leave-a-ok", "leave-cancel"}
        assert {row["id"] for row in card["bonuses"]} == {BONUS}
        assert {row["id"] for row in card["movements"]} == {"mov-a"}
        assert {row["id"] for row in card["documents"]} == {"file-a"}
        assert card["pending_invite"]["id"] == "inv-a"
        assert {row["id"] for row in card["recurring_expenses"]} == {"exp-rec-a"}
        assert card["user"]["id"] == "user-self-a"
        assert card["employee"]["used_leave_days"] == 3
        assert seen["expenses"] == ["exp-a", "exp-rec-a"]
        assert all(PAY_B not in row and "pay-old-b" not in row for row in seen["payrolls"])
        assert all(BONUS_B not in row and "bonus-old-b" not in row for row in seen["bonuses"])
        assert [PAY] in seen["payrolls"]
        assert len(generated["payrolls"]) == 1
        assert generated["payrolls"][0]["employee_name"] == "Ortak A2"
        assert generated["payrolls"][0]["net_salary"] == 100
        assert generated["payrolls"][0]["worked_days"] == 1
        assert generated["payrolls"][0]["id"] == PAY
        assert {row["id"] for row in self_view["payrolls"]} == {PAY}
        assert {row["id"] for row in self_view["bonuses"]} == {BONUS}
        assert {row["id"] for row in self_view["leaves"]} == {LEAVE, "leave-a-ok", "leave-cancel"}
        assert {row["id"] for row in self_view["reimbursements"]} == {"mov-a"}
        assert {row["id"] for row in self_view["recurring_expenses"]} == {"exp-rec-a"}
        assert self_view["attendance"]["days_present"] == 1
        assert created["mode"] == "password"
        assert created["status"] == "success"
        assert invited["mode"] == "invite"
        assert invited["message"] == "Davet hazir."
        assert pinned == {"status": "success", "has_shopfloor_pin": True, "message": "Atölye şifresi kaydedildi."}
        assert _doc(db, "employees", EMP, CO_A).get("shopfloor_pin_hash")
        assert terminated["employee"]["status"] == "terminated"
        assert terminated["employee"]["id"] == EMP_A
        assert pdf.media_type == "application/pdf"
        assert b"Ortak B" not in pdf.body
        assert deleted == {"status": "success", "message": "Maaş kaydı çöp kutusuna taşındı."}
        assert _doc(db, "payrolls", PAY_HAPPY, CO_A) is None
        leaked = _ids(card) | _ids(self_view) | _ids(listed) | _ids(generated) | _ids(geo)
        assert leaked.isdisjoint(_B_IDS)
    finally:
        _restore(prev)


def test_blank_company_employee_uses_caller_company():
    db, prev = _bind()
    try:
        today = attendance._today()
        _seed(db, today)
        user = _user(CO_A)
        self_user = _user(CO_A, role="personel", employee_id=EMP_OLD, uid="user-old-a")
        before = _digest(db, CO_B)

        async def run():
            card = await server.employee_card(EMP_OLD, MONTH, user)
            view = await server.my_personnel_self(MONTH, self_user)
            return card, view

        card, view = _run(run())
        assert _digest(db, CO_B) == before
        assert {row["id"] for row in card["payrolls"]} == {"pay-old-a"}
        assert {row["id"] for row in card["bonuses"]} == {"bonus-old-a"}
        assert card["leaves"] == []
        assert "pay-old-b" not in _ids(card)
        assert "leave-old-b" not in _ids(card)
        assert {row["id"] for row in view["payrolls"]} == {"pay-old-a"}
        assert {row["id"] for row in view["bonuses"]} == {"bonus-old-a"}
        assert view["leaves"] == []
        assert view["attendance"]["days_present"] == 1
        assert view["attendance"]["days_absent"] == 0
        assert _blank(db)["used_leave_days"] == 4
        assert _doc(db, "employees", EMP_OLD, CO_B)["used_leave_days"] == 4
        assert card["employee"]["used_leave_days"] == 0
    finally:
        _restore(prev)


def test_same_company_responses():
    db, prev = _bind()
    try:
        today = attendance._today()
        _seed(db, today)
        db.employees.docs = [row for row in db.employees.docs if row.get("company_id") == CO_A]
        for coll in (
            "leave_requests", "bonus_payments", "payrolls", "personnel_movements", "attendance",
            "expenses", "files", "user_invites", "personnel_receipts", "users",
        ):
            db[coll].docs = [row for row in db[coll].docs if row.get("company_id") == CO_A]
        user = _user(CO_A)

        async def run():
            listed = await server.list_employees(company_id=CO_A, user=user)
            card = await server.employee_card(EMP_A, MONTH, user)
            created = await server.create_employee(Employee(
                company_id=CO_A,
                full_name="Yeni A",
                tc_kimlik="10000000001",
                department="Uretim",
                position="Usta",
                phone="555111",
                email="yeni-a@example.com",
                start_date="2026-01-01",
                salary=120,
            ), user)
            blocked = None
            try:
                await server.create_employee(Employee(
                    company_id=CO_B,
                    full_name="Yeni B",
                    tc_kimlik="10000000002",
                    department="Uretim",
                    position="Usta",
                    phone="555222",
                    email="yeni-b@example.com",
                    start_date="2026-01-01",
                ), user)
            except HTTPException as exc:
                blocked = exc
            generated = await server.generate_payroll(
                {"period": MONTH, "employee_id": EMP_A}, user,
            )
            return listed, card, created, blocked, generated

        listed, card, created, blocked, generated = _run(run())
        assert [row["id"] for row in listed] == [EMP_A, EMP, EMP_INV]
        assert card["employee"]["full_name"] == "Person A"
        assert card["payrolls"][0]["id"] == PAY_HAPPY
        assert created["company_id"] == CO_A
        assert created["full_name"] == "Yeni A"
        stored = next(row for row in db.employees.docs if row.get("full_name") == "Yeni A")
        assert stored["company_id"] == CO_A
        assert blocked is not None and blocked.status_code == 403
        assert all(row.get("full_name") != "Yeni B" for row in db.employees.docs)
        assert generated["status"] == "success"
        assert len(generated["payrolls"]) == 1
        assert generated["payrolls"][0]["employee_id"] == EMP_A
        assert generated["payrolls"][0]["company_id"] == CO_A
        assert generated["payrolls"][0]["net_salary"] == 100
        assert "1 personel" in generated["message"]
    finally:
        _restore(prev)


def test_wave2_baseline_keys_removed():
    base = allowlist.TENANT_SCOPE_BASELINE
    present = [key for key in _REMOVED if key in base]
    assert present == []
    assert len(_REMOVED) == 44
    assert sum(1 for key in base if key[0] == "server.py") == 581
    script = _BACKEND / "scripts" / "tenant_scope_baseline.py"
    proc = subprocess.run(
        [sys.executable, str(script), "--check"],
        cwd=str(_BACKEND.parent),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 0
    assert "temiz" in proc.stdout
