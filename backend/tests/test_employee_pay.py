"""Personel hak ediş satırları ve yemek/yol tahakkuku."""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import employee_pay  # noqa: E402


class FakeCollection:
    def __init__(self):
        self.docs = []

    def _match(self, d, q):
        return all(d.get(k) == v for k, v in (q or {}).items() if not isinstance(v, dict))

    async def find_one(self, q=None, projection=None):
        return next((d for d in self.docs if self._match(d, q)), None)

    def find(self, q=None, projection=None):
        rows = [d for d in self.docs if self._match(d, q)]
        return FakeCursor(rows)

    async def insert_one(self, doc):
        self.docs.append(doc)


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, n):
        return list(self.rows[:n])


class FakeDb:
    def __init__(self):
        self.employees = FakeCollection()
        self.expenses = FakeCollection()


def test_due_lines_skip_zeros():
    rows = employee_pay.due_lines({
        "unpaid_payroll": 1000, "overtime_due": 0, "bonus_pending": 50,
        "meal_due": 0, "transport_due": 25, "unpaid_expenses": 0,
    })
    assert [r["key"] for r in rows] == ["salary", "bonus", "transport"]
    assert employee_pay.selected_kinds({"mode": "all"}, rows) == ["salary", "bonus", "transport"]
    assert employee_pay.selected_kinds({"mode": "split", "kinds": ["transport", "meal"]}, rows) == ["transport"]


def test_prepare_pay_date_and_recurring():
    d = employee_pay.prepare_employee_pay({"pay_start_date": "2026-11-01", "pay_recurring": True})
    assert d["pay_start_date"] == "2026-11-01" and d["pay_day"] == 1
    d2 = employee_pay.prepare_employee_pay({}, fill_start=True)
    assert d2["pay_start_date"] and d2["pay_day"] >= 1


def test_split_allows_advance_without_kinds():
    rows = employee_pay.due_lines({"unpaid_payroll": 100})
    assert employee_pay.selected_kinds({"mode": "split", "kinds": [], "advance": 50}, rows) == []


def test_split_keeps_explicit_salary_without_due():
    rows = employee_pay.due_lines({"unpaid_payroll": 0, "meal_due": 10})
    assert employee_pay.selected_kinds({"mode": "split", "kinds": ["salary"]}, rows) == ["salary"]


def test_accrue_calls_payroll_generator():
    db = FakeDb()
    db.employees.docs.append({
        "_id": "e1", "company_id": "c1", "full_name": "Ali", "status": "active",
        "meal_allowance": 0, "transport_allowance": 0,
        "pay_start_date": "2026-10-05", "pay_day": 5, "pay_recurring": True,
    })
    called = []

    async def gen(req):
        called.append(req)

    r = asyncio.run(employee_pay.accrue_allowances(
        db, "c1", employee_id="e1", as_of="2026-10-05", force_start=True, generate_payroll_fn=gen,
    ))
    assert r["posted_count"] == 0
    assert called and called[0]["employee_id"] == "e1" and called[0]["period"] == "2026-10"


def test_accrue_meal_once_on_entitlement_day():
    db = FakeDb()
    db.employees.docs.append({
        "_id": "e1", "company_id": "c1", "full_name": "Ali", "status": "active",
        "meal_allowance": 2500, "transport_allowance": 1500,
        "pay_start_date": "2026-10-05", "pay_day": 5, "pay_recurring": True,
    })
    r = asyncio.run(employee_pay.accrue_allowances(db, "c1", employee_id="e1", as_of="2026-10-05", force_start=True))
    assert r["posted_count"] == 2
    cats = {e["category"] for e in db.expenses.docs}
    assert cats == {"Yemek", "Yol / Ulaşım"}
    assert all(e["payment_status"] == "unpaid" for e in db.expenses.docs)
    r2 = asyncio.run(employee_pay.accrue_allowances(db, "c1", employee_id="e1", as_of="2026-10-20"))
    assert r2["posted_count"] == 0
    assert len(db.expenses.docs) == 2
