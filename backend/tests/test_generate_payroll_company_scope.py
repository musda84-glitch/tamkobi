"""POST /personnel/generate-payroll employee_id firma filtresini korur.

Başka firmanın çalışanı employee_id ile okunamaz ve onun için bordro yazılmaz.
Bellek içi koleksiyon mysql_store.match_query kullanır (dashboard_memdb.MemDB).
Canlı veritabanına ve 8021 portuna bağlanmaz.
"""
from __future__ import annotations

import asyncio
import copy
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

os.environ.setdefault("JWT_SECRET", "test-generate-payroll-company-scope-jwt-secret-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import attendance  # noqa: E402
import server  # noqa: E402
from dashboard_memdb import MemColl, MemDB, _split_field_ops  # noqa: E402
from mysql_store import match_query  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
PERIOD = "2026-10"
EMP_A = "emp_a"
EMP_B = "emp_b"
EMP_LEFT = "emp_left"
NAME_A = "A Personeli"
NAME_B = "Gizli B Personeli"
NAME_LEFT = "Ayrılmış Personel"
SALARY_A = 32100.5
SALARY_B = 98765.43
SALARY_LEFT = 11111.11


def _run(coro):
    return asyncio.run(coro)


def _user(*company_ids, active=None, role="admin"):
    ids = list(company_ids)
    return {
        "_id": "user-" + "-".join(ids),
        "id": "user-" + "-".join(ids),
        "email": "user@example.com",
        "name": "Firma Yöneticisi",
        "role": role,
        "is_active": True,
        "is_super_admin": False,
        "company_ids": ids,
        "active_company_id": active or ids[0],
    }


class PayrollMemColl(MemColl):
    async def replace_one(self, query, replacement, upsert=False):
        query = _split_field_ops(query or {})
        for i, doc in enumerate(self.docs):
            if match_query(doc, query):
                self.docs[i] = copy.deepcopy(replacement)
                return SimpleNamespace(matched_count=1, modified_count=1, upserted_id=None)
        if upsert:
            stored = copy.deepcopy(replacement)
            self.docs.append(stored)
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=stored.get("_id"))
        return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)


class PayrollMemDB(MemDB):
    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = PayrollMemColl(name, self)
            self._cols[name] = coll
        return coll


def _bind():
    db = PayrollMemDB()
    queries = []
    replaces = []
    prev = (server.db, attendance._db)
    server.db = db
    attendance._db = db

    orig_find = db.employees.find

    def wrapped_find(query=None, projection=None):
        queries.append(copy.deepcopy(query))
        return orig_find(query, projection)

    db.employees.find = wrapped_find
    orig_replace = db.payrolls.replace_one

    async def wrapped_replace(query, replacement, upsert=False):
        replaces.append({
            "query": copy.deepcopy(query),
            "upsert": upsert,
            "_id": (replacement or {}).get("_id"),
            "employee_id": (replacement or {}).get("employee_id"),
            "company_id": (replacement or {}).get("company_id"),
            "status": (replacement or {}).get("status"),
        })
        return await orig_replace(query, replacement, upsert=upsert)

    db.payrolls.replace_one = wrapped_replace
    return db, queries, replaces, prev


def _restore(prev):
    server.db, attendance._db = prev


def _employee(eid, company_id, name, salary, status="active"):
    return {
        "_id": eid,
        "company_id": company_id,
        "full_name": name,
        "status": status,
        "salary": salary,
        "pay_type": "monthly",
    }


async def _seed(db):
    await db.employees.insert_one(_employee(EMP_A, CO_A, NAME_A, SALARY_A))
    await db.employees.insert_one(_employee(EMP_B, CO_B, NAME_B, SALARY_B))
    await db.employees.insert_one(_employee(EMP_LEFT, CO_A, NAME_LEFT, SALARY_LEFT, status="terminated"))
    await db.companies.insert_one({"_id": CO_A, "name": "Firma A"})
    await db.companies.insert_one({"_id": CO_B, "name": "Firma B"})


def _assert_no_b_pii(result, db):
    blob = repr(result)
    assert NAME_B not in blob
    assert str(SALARY_B) not in blob
    assert result["payrolls"] == []
    for doc in db.payrolls.docs:
        assert doc.get("employee_id") != EMP_B
        assert doc.get("company_id") != CO_B
        assert doc.get("employee_name") != NAME_B
        assert doc.get("net_salary") != SALARY_B


def test_other_company_employee_id_returns_empty_and_writes_nothing():
    """Firma A yöneticisi, firma B çalışan id'siyle çağırınca bordro boştur ve B'ye yazılmaz."""
    db, queries, replaces, prev = _bind()

    async def run():
        await _seed(db)
        out = await server.generate_payroll(
            {"company_id": CO_A, "period": PERIOD, "employee_id": EMP_B},
            _user(CO_A),
        )
        assert set(out) == {"status", "message", "payrolls"}
        assert out["status"] == "success"
        assert out["message"] == f"{PERIOD} dönemi için 0 personelin bordrosu hesaplandı."
        assert out["payrolls"] == []
        assert queries == [{"_id": EMP_B, "company_id": CO_A}]
        assert replaces == []
        assert db.payrolls.docs == []
        _assert_no_b_pii(out, db)

    try:
        _run(run())
    finally:
        _restore(prev)


def test_other_company_employee_without_explicit_company_uses_active_company():
    """company_id gönderilmezse aktif firma çözülür; başka firmanın kartı yine eşleşmez."""
    db, queries, replaces, prev = _bind()

    async def run():
        await _seed(db)
        out = await server.generate_payroll(
            {"period": PERIOD, "employee_id": EMP_B},
            _user(CO_A, active=CO_A),
        )
        assert out["status"] == "success"
        assert out["payrolls"] == []
        assert "0 personel" in out["message"]
        assert queries == [{"_id": EMP_B, "company_id": CO_A}]
        assert replaces == []
        _assert_no_b_pii(out, db)

    try:
        _run(run())
    finally:
        _restore(prev)


def test_own_employee_id_generates_payroll():
    """Firma A kendi çalışan id'siyle çağırınca bordro üretilir ve yazılır."""
    db, queries, replaces, prev = _bind()

    async def run():
        await _seed(db)
        out = await server.generate_payroll(
            {"company_id": CO_A, "period": PERIOD, "employee_id": EMP_A},
            _user(CO_A),
        )
        assert out["status"] == "success"
        assert out["message"] == f"{PERIOD} dönemi için 1 personelin bordrosu hesaplandı."
        assert len(out["payrolls"]) == 1
        row = out["payrolls"][0]
        assert row["employee_id"] == EMP_A
        assert row["employee_name"] == NAME_A
        assert row["company_id"] == CO_A
        assert row["period"] == PERIOD
        assert row["net_salary"] == SALARY_A
        assert row["status"] == "pending"
        assert row["id"]
        assert queries == [{"_id": EMP_A, "company_id": CO_A}]
        assert "status" not in queries[0]
        stored = await db.payrolls.find_one({"employee_id": EMP_A, "company_id": CO_A, "period": PERIOD})
        assert stored is not None
        assert stored["_id"] == row["id"]
        assert stored["employee_name"] == NAME_A
        assert stored["net_salary"] == SALARY_A
        assert stored["company_id"] == CO_A
        assert len(db.payrolls.docs) == 1
        assert len(replaces) == 1
        assert replaces[0]["upsert"] is True
        assert replaces[0]["query"] == {"_id": stored["_id"], "company_id": CO_A}
        assert replaces[0]["employee_id"] == EMP_A
        assert replaces[0]["company_id"] == CO_A
        assert NAME_B not in repr(out)
        assert str(SALARY_B) not in repr(out)
        assert all(doc.get("employee_id") != EMP_B for doc in db.payrolls.docs)

    try:
        _run(run())
    finally:
        _restore(prev)


def test_single_employee_keeps_non_active_status():
    """Tekil çalışan sorgusuna status eklenmez; ayrılmış kart da kendi firmasında üretilir."""
    db, queries, replaces, prev = _bind()

    async def run():
        await _seed(db)
        out = await server.generate_payroll(
            {"company_id": CO_A, "period": PERIOD, "employee_id": EMP_LEFT},
            _user(CO_A),
        )
        assert queries == [{"_id": EMP_LEFT, "company_id": CO_A}]
        assert len(out["payrolls"]) == 1
        assert out["payrolls"][0]["employee_id"] == EMP_LEFT
        assert out["payrolls"][0]["employee_name"] == NAME_LEFT
        assert out["payrolls"][0]["net_salary"] == SALARY_LEFT
        assert len(replaces) == 1

    try:
        _run(run())
    finally:
        _restore(prev)


def test_bulk_generate_stays_company_and_active():
    """employee_id yoksa sorgu firma + active kalır; başka firma ve ayrılmış kart girmez."""
    db, queries, replaces, prev = _bind()

    async def run():
        await _seed(db)
        out = await server.generate_payroll(
            {"company_id": CO_A, "period": PERIOD},
            _user(CO_A),
        )
        assert queries == [{"company_id": CO_A, "status": "active"}]
        ids = [row["employee_id"] for row in out["payrolls"]]
        assert ids == [EMP_A]
        assert NAME_B not in repr(out)
        assert str(SALARY_B) not in repr(out)
        assert all(doc.get("employee_id") != EMP_B for doc in db.payrolls.docs)
        assert len(replaces) == 1
        assert replaces[0]["employee_id"] == EMP_A

    try:
        _run(run())
    finally:
        _restore(prev)


def test_multi_company_user_generates_for_requested_company_only():
    """Çok firmalı kullanıcı seçtiği firmadaki kartı üretir; diğer firmanın kartını o firmaya karıştırmaz."""
    db, queries, replaces, prev = _bind()

    async def run():
        await _seed(db)
        user = _user(CO_A, CO_B, active=CO_A)
        blocked = await server.generate_payroll(
            {"company_id": CO_A, "period": PERIOD, "employee_id": EMP_B},
            user,
        )
        assert blocked["payrolls"] == []
        assert queries == [{"_id": EMP_B, "company_id": CO_A}]
        assert db.payrolls.docs == []

        allowed = await server.generate_payroll(
            {"company_id": CO_B, "period": PERIOD, "employee_id": EMP_B},
            user,
        )
        assert queries[1] == {"_id": EMP_B, "company_id": CO_B}
        assert len(allowed["payrolls"]) == 1
        assert allowed["payrolls"][0]["employee_id"] == EMP_B
        assert allowed["payrolls"][0]["employee_name"] == NAME_B
        assert allowed["payrolls"][0]["company_id"] == CO_B
        assert allowed["payrolls"][0]["net_salary"] == SALARY_B
        stored = await db.payrolls.find_one({"_id": allowed["payrolls"][0]["id"]})
        assert stored["company_id"] == CO_B
        assert stored["employee_id"] == EMP_B
        assert len(replaces) == 1
        assert replaces[0]["company_id"] == CO_B

    try:
        _run(run())
    finally:
        _restore(prev)


def test_inaccessible_company_is_rejected_before_employee_lookup():
    """Firma çözümlemesi aynı kalır: erişilemeyen company_id çalışan sorgusundan önce 403."""
    db, queries, replaces, prev = _bind()

    async def run():
        await _seed(db)
        with pytest.raises(HTTPException) as raised:
            await server.generate_payroll(
                {"company_id": CO_B, "period": PERIOD, "employee_id": EMP_B},
                _user(CO_A),
            )
        assert raised.value.status_code == 403
        assert queries == []
        assert replaces == []
        assert db.payrolls.docs == []

    try:
        _run(run())
    finally:
        _restore(prev)


def test_paid_payroll_is_skipped_and_pending_is_upserted():
    """Ödenmiş bordro atlanır; bekleyen kayıt aynı _id ile replace_one upsert edilir."""
    db, queries, replaces, prev = _bind()

    async def run():
        await _seed(db)
        await db.payrolls.insert_one({
            "_id": "pay_paid",
            "company_id": CO_A,
            "employee_id": EMP_A,
            "employee_name": NAME_A,
            "period": PERIOD,
            "status": "paid",
            "net_salary": 1,
            "bonus": 9,
        })
        skipped = await server.generate_payroll(
            {"company_id": CO_A, "period": PERIOD, "employee_id": EMP_A},
            _user(CO_A),
        )
        assert skipped["payrolls"] == []
        assert "0 personel" in skipped["message"]
        assert replaces == []
        paid = await db.payrolls.find_one({"_id": "pay_paid"})
        assert paid["status"] == "paid"
        assert paid["net_salary"] == 1
        assert paid["bonus"] == 9

        await db.payrolls.insert_one({
            "_id": "pay_pending",
            "company_id": CO_A,
            "employee_id": EMP_LEFT,
            "employee_name": "eski",
            "period": PERIOD,
            "status": "pending",
            "bonus": 150,
            "deduction": 20,
            "advance_payment": 5,
            "paid_amount": 0,
            "created_at": "2026-01-01T00:00:00+00:00",
        })
        updated = await server.generate_payroll(
            {"company_id": CO_A, "period": PERIOD, "employee_id": EMP_LEFT},
            _user(CO_A),
        )
        assert len(updated["payrolls"]) == 1
        row = updated["payrolls"][0]
        assert row["id"] == "pay_pending"
        assert row["bonus"] == 150
        assert row["deduction"] == 20
        assert row["advance_payment"] == 5
        assert row["net_salary"] == SALARY_LEFT
        assert row["employee_name"] == NAME_LEFT
        assert row["status"] == "pending"
        assert row["created_at"] == "2026-01-01T00:00:00+00:00"
        stored = await db.payrolls.find_one({"_id": "pay_pending"})
        assert stored["net_salary"] == SALARY_LEFT
        assert stored["bonus"] == 150
        assert stored["status"] == "pending"
        assert stored["_id"] == "pay_pending"
        pending_rows = [d for d in db.payrolls.docs if d.get("employee_id") == EMP_LEFT]
        assert len(pending_rows) == 1
        assert len(replaces) == 1
        assert replaces[0]["upsert"] is True
        assert replaces[0]["query"] == {"_id": "pay_pending", "company_id": CO_A}
        assert queries[0] == {"_id": EMP_A, "company_id": CO_A}
        assert queries[1] == {"_id": EMP_LEFT, "company_id": CO_A}

    try:
        _run(run())
    finally:
        _restore(prev)
