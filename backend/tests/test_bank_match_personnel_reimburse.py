"""Banka eşleştirme: personel masraf iadesi mevcut bank_sync çıkışına bağlanır.

Bellek içi veritabanı ve TestClient. Canlı DB, 8021 ve banka API'si yok.
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

os.environ.setdefault("JWT_SECRET", "test-bank-match-personnel-reimburse-jwt-secret")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import addons  # noqa: E402
import auth_utils  # noqa: E402
import expenses as expenses_mod  # noqa: E402
import personnel_payments  # noqa: E402
import rbac  # noqa: E402
import saas  # noqa: E402
import server  # noqa: E402
from mysql_store import apply_update, match_query, new_upsert_doc  # noqa: E402

CID = "c1"
OTHER = "c2"


def _run(coro):
    return asyncio.run(coro)


class MemCursor:
    def __init__(self, docs):
        self._docs = docs

    def sort(self, key, direction=1):
        return self

    def limit(self, n):
        return self

    async def to_list(self, length=None):
        rows = list(self._docs)
        if length is not None:
            rows = rows[: int(length)]
        return copy.deepcopy(rows)


class MemColl:
    def __init__(self):
        self.docs = []

    def find(self, query=None, projection=None):
        return MemCursor([d for d in self.docs if match_query(d, query or {})])

    async def find_one(self, query=None, projection=None):
        for doc in self.docs:
            if match_query(doc, query or {}):
                return copy.deepcopy(doc)
        return None

    async def count_documents(self, query=None):
        return sum(1 for doc in self.docs if match_query(doc, query or {}))

    async def insert_one(self, doc):
        self.docs.append(copy.deepcopy(doc))
        return SimpleNamespace(inserted_id=doc.get("_id"))

    async def insert_many(self, docs):
        self.docs.extend(copy.deepcopy(list(docs)))
        return SimpleNamespace(inserted_ids=[d.get("_id") for d in docs])

    async def update_one(self, query, update, upsert=False):
        for i, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                self.docs[i] = apply_update(doc, update, query)
                return SimpleNamespace(modified_count=1, matched_count=1)
        if upsert:
            self.docs.append(new_upsert_doc(update, query))
            return SimpleNamespace(modified_count=0, matched_count=0, upserted_id=self.docs[-1].get("_id"))
        return SimpleNamespace(modified_count=0, matched_count=0)

    async def update_one_atomic(self, query, update, upsert=False):
        return await self.update_one(query, update, upsert=upsert)

    async def delete_one(self, query):
        for i, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                self.docs.pop(i)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def delete_many(self, query):
        before = len(self.docs)
        self.docs[:] = [d for d in self.docs if not match_query(d, query or {})]
        return SimpleNamespace(deleted_count=before - len(self.docs))

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
            coll = MemColl()
            self._cols[name] = coll
        return coll

    def __getitem__(self, name):
        return getattr(self, name)


def _tx(tid="tx1", **extra):
    doc = {
        "_id": tid,
        "company_id": CID,
        "account_id": "acc1",
        "account_name": "Vadesiz",
        "type": "outflow",
        "amount": -1000.0,
        "description": "AYSE MASRAF IADE",
        "date": "2026-10-09",
        "currency": "TRY",
        "match_status": "unmatched",
        "source": "bank_sync",
    }
    doc.update(extra)
    return doc


def _emp(eid="e1", company=CID, name="Ayşe Yılmaz"):
    return {
        "_id": eid,
        "company_id": company,
        "full_name": name,
        "is_active": True,
        "status": "active",
        "salary": 0,
    }


def _debt(eid="ex1", employee="e1", total=1000, **extra):
    doc = {
        "_id": eid,
        "company_id": CID,
        "employee_id": employee,
        "expense_number": "MSR-2026-0007",
        "date": "2026-10-01",
        "description": "Market",
        "category": "Yemek",
        "total": total,
        "amount": total,
        "payment_status": "unpaid",
        "paid_by_personnel": True,
        "personnel_debt_status": "open",
    }
    doc.update(extra)
    return doc


@pytest.fixture
def api():
    db = MemDB()
    db.companies.docs.append({"_id": CID, "name": "Firma"})
    db.companies.docs.append({"_id": OTHER, "name": "Diger"})
    db.users.docs.append({
        "_id": "u1",
        "email": "u1@example.com",
        "name": "Admin",
        "role": "admin",
        "is_active": True,
        "is_super_admin": False,
        "company_ids": [CID],
        "active_company_id": CID,
    })
    db.bank_accounts.docs.append({
        "_id": "acc1", "company_id": CID, "type": "bank",
        "account_name": "Vadesiz", "current_balance": 8000.0,
    })
    db.employees.docs.extend([
        _emp(),
        _emp("e2", OTHER, "Baska"),
        _emp("e3", CID, "Borcsuz"),
    ])
    db.expenses.docs.append(_debt())
    db.bank_transactions.docs.append(_tx())
    prev = (server.db, rbac._db, saas._db, expenses_mod._db, addons._db)
    server.db = db
    rbac._db = db
    saas._db = db
    expenses_mod._db = db
    addons._db = db
    saas.invalidate()
    router = server.app.router
    saved_up = list(router.on_startup)
    saved_down = list(router.on_shutdown)
    router.on_startup.clear()
    router.on_shutdown.clear()
    client = TestClient(server.app)
    token = auth_utils.create_access_token("u1", "u1@example.com", "admin")
    headers = {"Authorization": f"Bearer {token}"}
    try:
        client.__enter__()
        yield client, db, headers
    finally:
        client.__exit__(None, None, None)
        server.db, rbac._db, saas._db, expenses_mod._db, addons._db = prev
        router.on_startup[:] = saved_up
        router.on_shutdown[:] = saved_down
        saas.invalidate()


def _balance(db):
    return db.bank_accounts.docs[0]["current_balance"]


def _tx_count(db):
    return len(db.bank_transactions.docs)


def _active_moves(db):
    return [m for m in db.personnel_movements.docs if m.get("status") not in ("reversed", "cancelled")]


def _match(client, headers, tid, **body):
    return client.post(f"/api/banking/transactions/{tid}/match", json=body, headers=headers)


def _recv(db, eid="e1"):
    emp = next(e for e in db.employees.docs if e["_id"] == eid)
    payrolls = [p for p in db.payrolls.docs if p.get("employee_id") == eid]
    bonuses = [b for b in db.bonus_payments.docs if b.get("employee_id") == eid]
    expenses = [e for e in db.expenses.docs if e.get("employee_id") == eid]
    return _run(server._employee_receivable(emp, payrolls, bonuses, "2026-10", expenses=expenses))


def test_reimburse_closes_debt_without_second_bank_outflow(api):
    client, db, headers = api
    before = _recv(db)
    assert before["unpaid_expenses"] == 0
    bal = _balance(db)
    ntx = _tx_count(db)

    res = _match(
        client, headers, "tx1",
        as_expense=True,
        category="Personel Masrafı",
        employee_id="e1",
        personnel_pay_kind="reimburse",
        learn=True,
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["personnel_pay_kind"] == "reimburse"
    assert body["category"] == "Personel Masraf İadesi"
    assert body["employee_name"] == "Ayşe Yılmaz"
    assert body.get("personnel_movement_id")

    assert len(db.personnel_movements.docs) == 1
    mov = db.personnel_movements.docs[0]
    assert mov["kind"] == "reimburse"
    assert mov["cash_mode"] == "bank_match"
    assert mov["bank_transaction_id"] == "tx1"
    assert mov["idempotency_key"] == "bankmatch:tx1"
    assert mov["status"] == "posted"

    exp = db.expenses.docs[0]
    assert exp["personnel_debt_status"] == "closed"
    assert exp["payment_status"] == "unpaid"
    assert len(db.expenses.docs) == 1
    assert _balance(db) == bal
    assert _tx_count(db) == ntx
    bank = db.bank_transactions.docs[0]
    assert bank["_id"] == "tx1"
    assert bank["source"] == "bank_sync"
    assert bank.get("source_type") in (None, "")
    assert bank.get("personnel_movement_id") == mov["_id"]

    after = _recv(db)
    assert after["unpaid_expenses"] == before["unpaid_expenses"] == 0
    assert after["unpaid_payroll"] == before["unpaid_payroll"]
    assert after["remaining"] == before["remaining"]

    rule = db.bank_match_rules.docs[0]
    assert rule.get("category") == "Personel Masraf İadesi"
    assert "employee_id" not in rule

    emp = db.employees.docs[0]
    again = _run(personnel_payments.apply_payment_lines(
        db, emp, {},
        {
            "lines": [{"kind": "reimburse", "amount": 1000, "account_id": "acc1"}],
            "existing_bank_tx_id": "tx1",
            "idempotency_key": "bankmatch:tx1",
        },
        balance=after,
        pay_date="2026-10-09",
        period="2026-10",
    ))
    assert again["idempotent"] is True
    assert len(db.personnel_movements.docs) == 1
    assert len(_active_moves(db)) == 1
    assert _balance(db) == bal
    assert _tx_count(db) == ntx


def test_second_match_is_400_and_unmatch_restores_debt(api):
    client, db, headers = api
    bal = _balance(db)
    first = _match(
        client, headers, "tx1",
        as_expense=True, category="Personel Masrafı", employee_id="e1",
        personnel_pay_kind="reimburse", learn=False,
    )
    assert first.status_code == 200, first.text
    second = _match(
        client, headers, "tx1",
        as_expense=True, category="Personel Masrafı", employee_id="e1",
        personnel_pay_kind="reimburse", learn=False,
    )
    assert second.status_code == 400
    assert "zaten eşleştirilmiş" in str(second.json().get("detail"))
    assert len(db.personnel_movements.docs) == 1

    undone = client.post("/api/banking/transactions/tx1/unmatch", headers=headers)
    assert undone.status_code == 200, undone.text
    assert db.personnel_movements.docs[0]["status"] == "reversed"
    exp = db.expenses.docs[0]
    assert exp["personnel_debt_status"] == "open"
    assert exp["payment_status"] == "unpaid"
    bank = db.bank_transactions.docs[0]
    assert bank["_id"] == "tx1"
    assert bank["source"] == "bank_sync"
    assert bank["match_status"] == "unmatched"
    assert "personnel_movement_id" not in bank
    assert _balance(db) == bal
    assert _tx_count(db) == 1

    rematch = _match(
        client, headers, "tx1",
        as_expense=True, category="Personel Masrafı", employee_id="e1",
        personnel_pay_kind="reimburse", expense_id="ex1", learn=False,
    )
    assert rematch.status_code == 200, rematch.text
    assert len(_active_moves(db)) == 1
    assert len(db.personnel_movements.docs) == 2
    assert db.expenses.docs[0]["personnel_debt_status"] == "closed"
    assert _balance(db) == bal
    assert _tx_count(db) == 1
    assert db.bank_transactions.docs[0]["source"] == "bank_sync"


def test_reimburse_without_open_debt_is_400(api):
    client, db, headers = api
    db.bank_transactions.docs.append(_tx("tx_empty", description="BORC YOK", amount=-250))
    res = _match(
        client, headers, "tx_empty",
        as_expense=True, category="Personel Masrafı", employee_id="e3",
        personnel_pay_kind="reimburse", learn=False,
    )
    assert res.status_code == 400
    assert res.json()["detail"] == "Bu personelde açık masraf borcu yok — Avans, Maaş veya 'Şirket masrafı' seçin."
    assert db.personnel_movements.docs == []
    assert _balance(db) == 8000.0
    assert all(t["_id"] != "tx_empty" or t["match_status"] == "unmatched" for t in db.bank_transactions.docs)


def test_category_only_personnel_rejected_rent_kept(api):
    client, db, headers = api
    denied = _match(client, headers, "tx1", as_expense=False, category="Personel Masrafı", learn=False)
    assert denied.status_code == 400
    assert denied.json()["detail"] == "Personel ödemesi için 'Masraf' modunda personel seçin."
    assert db.bank_transactions.docs[0]["match_status"] == "unmatched"
    assert db.personnel_movements.docs == []

    db.bank_transactions.docs.append(_tx("tx_rent", description="KIRA ODEME", amount=-500))
    ok = _match(client, headers, "tx_rent", as_expense=False, category="Kira", learn=False)
    assert ok.status_code == 200, ok.text
    saved = next(t for t in db.bank_transactions.docs if t["_id"] == "tx_rent")
    assert saved["match_status"] == "matched"
    assert saved["category"] == "Kira"
    assert "expense_id" not in saved
    assert db.personnel_movements.docs == []
    assert _balance(db) == 8000.0


def test_advance_salary_expense_regression(api):
    client, db, headers = api
    bal = _balance(db)
    base_tx = _tx_count(db)
    base_exp = len(db.expenses.docs)

    db.bank_transactions.docs.append(_tx("tx_adv", description="AVANS", amount=1500))
    adv = _match(
        client, headers, "tx_adv",
        as_expense=True, category="Personel Masrafı", employee_id="e1",
        personnel_pay_kind="advance", learn=False,
    )
    assert adv.status_code == 200, adv.text
    assert db.bonus_payments.docs[-1]["type"] == "advance"
    assert db.bonus_payments.docs[-1]["source"] == "bank_match"
    assert db.personnel_movements.docs == []
    assert _tx_count(db) == base_tx + 1
    assert _balance(db) == bal

    db.payrolls.docs.append({
        "_id": "pr1", "company_id": CID, "employee_id": "e1", "period": "2026-10",
        "status": "unpaid", "final_payable": 20000.0, "net_salary": 20000.0,
    })
    db.bank_transactions.docs.append(_tx("tx_sal", description="MAAS", amount=20000))
    sal = _match(
        client, headers, "tx_sal",
        as_expense=True, category="Personel Masrafı", employee_id="e1",
        personnel_pay_kind="salary", learn=False,
    )
    assert sal.status_code == 200, sal.text
    assert db.payrolls.docs[0]["status"] == "paid"
    assert db.personnel_movements.docs == []
    assert _balance(db) == bal
    assert _tx_count(db) == base_tx + 2

    db.bank_transactions.docs.append(_tx("tx_exp", description="SIRKET MASRAF", amount=400))
    exp = _match(
        client, headers, "tx_exp",
        as_expense=True, category="Personel Masrafı", employee_id="e1",
        personnel_pay_kind="expense", learn=False,
    )
    assert exp.status_code == 200, exp.text
    created = [e for e in db.expenses.docs if e.get("source") == "bank_match"]
    assert len(created) == 1
    assert created[0]["employee_id"] == "e1"
    assert created[0]["payment_status"] == "paid"
    assert len(db.expenses.docs) == base_exp + 1
    assert db.personnel_movements.docs == []
    assert db.expenses.docs[0]["personnel_debt_status"] == "open"
    assert _balance(db) == bal
    assert _tx_count(db) == base_tx + 3


def test_other_company_employee_is_404(api):
    client, db, headers = api
    res = _match(
        client, headers, "tx1",
        as_expense=True, category="Personel Masrafı", employee_id="e2",
        personnel_pay_kind="reimburse", learn=False,
    )
    assert res.status_code == 404
    assert db.personnel_movements.docs == []
    assert db.expenses.docs[0]["personnel_debt_status"] == "open"
    assert _balance(db) == 8000.0


def test_auto_match_personnel_category_does_not_write_ledger(api):
    client, db, headers = api
    db.bank_match_rules.docs.append({
        "_id": "rule1",
        "company_id": CID,
        "pattern": "ayse masraf iade",
        "category": "Personel Masrafı",
        "source": "learned",
        "hits": 1,
    })
    matched, _details, _skipped = _run(server._auto_match_by_rules(CID, list(db.bank_transactions.docs), via="rule"))
    assert db.personnel_movements.docs == []
    assert db.bonus_payments.docs == []
    bank = db.bank_transactions.docs[0]
    assert not bank.get("personnel_movement_id")
    assert not bank.get("employee_id")
    if matched:
        assert bank.get("category")
        assert bank.get("match_status") == "matched"
