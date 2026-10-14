"""Personel hak ediş satırları ve yemek/yol tahakkuku."""
import asyncio
import os
import sys
from datetime import datetime, timezone, date

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


def test_period_entitled_and_allowance_due_gate():
    emp = {
        "_id": "e1", "pay_start_date": "2026-11-01", "pay_day": 1, "pay_recurring": True,
        "meal_allowance": 5000, "transport_allowance": 2000,
    }
    assert employee_pay.period_is_entitled(emp, "2026-11", as_of="2026-10-20") is False
    assert employee_pay.entitlement_allowance_due(emp, 5000, "Yemek", [], "2026-11", as_of="2026-10-20") == 0.0
    assert employee_pay.period_is_entitled(emp, "2026-11", as_of="2026-11-01") is True
    assert employee_pay.entitlement_allowance_due(emp, 5000, "Yemek", [], "2026-11", as_of="2026-11-01") == 5000.0
    assert employee_pay.entitlement_allowance_due(
        emp, 5000, "Yemek",
        [{"category": "Yemek", "date": "2026-11-01", "total": 1500}],
        "2026-11", as_of="2026-11-01",
    ) == 3500.0


def test_allowance_save_message_scheduled():
    msg = employee_pay.allowance_save_message(
        {"posted_count": 0, "scheduled_date": "2026-11-01", "skipped": [{"reason": "not_due", "due_date": "2026-11-01"}]},
        "2026-11-01",
    )
    assert "01.11.2026" in msg and "alacağa yazılacak" in msg
    assert "yazıldı" in employee_pay.allowance_save_message({"posted_count": 2, "message": "2 hak ediş masrafı yazıldı."})


def test_accrue_skips_before_entitlement_day():
    db = FakeDb()
    db.employees.docs.append({
        "_id": "e1", "company_id": "c1", "full_name": "Ali", "status": "active",
        "meal_allowance": 5000, "transport_allowance": 2000,
        "pay_start_date": "2026-11-01", "pay_day": 1, "pay_recurring": True,
    })
    r = asyncio.run(employee_pay.accrue_allowances(db, "c1", employee_id="e1", as_of="2026-10-05"))
    assert r["posted_count"] == 0
    assert r["scheduled_date"] == "2026-11-01"
    assert not db.expenses.docs


def test_accrue_meal_once_on_entitlement_day():
    db = FakeDb()
    db.employees.docs.append({
        "_id": "e1", "company_id": "c1", "full_name": "Ali", "status": "active",
        "meal_allowance": 2500, "transport_allowance": 1500,
        "pay_start_date": "2026-10-05", "pay_day": 5, "pay_recurring": True,
    })
    r = asyncio.run(employee_pay.accrue_allowances(db, "c1", employee_id="e1", as_of="2026-10-05"))
    assert r["posted_count"] == 2
    cats = {e["category"] for e in db.expenses.docs}
    assert cats == {"Yemek", "Yol / Ulaşım"}
    assert all(e["payment_status"] == "unpaid" for e in db.expenses.docs)
    assert all(e["date"] == "2026-10-05" for e in db.expenses.docs)
    r2 = asyncio.run(employee_pay.accrue_allowances(db, "c1", employee_id="e1", as_of="2026-10-20"))
    assert r2["posted_count"] == 0
    assert len(db.expenses.docs) == 2


def test_istanbul_day_makes_salary_due_before_utc_midnight():
    # 13 Ekim 2026 01:00 İstanbul = 12 Ekim 22:00 UTC. UTC günü henüz hak ediş günü değil.
    instant = datetime(2026, 10, 12, 22, 0, tzinfo=timezone.utc)
    assert employee_pay.istanbul_today(instant).isoformat() == "2026-10-13"
    assert employee_pay.istanbul_period(instant) == "2026-10"
    boundary = datetime(2026, 9, 30, 21, 30, tzinfo=timezone.utc)
    assert employee_pay.istanbul_period(boundary) == "2026-10"
    emp = {
        "salary": 10000, "pay_type": "monthly", "pay_recurring": True,
        "pay_start_date": "2026-01-13", "pay_day": 13,
    }
    assert employee_pay.unpaid_salary_amount(emp, [], "2026-10", employee_pay.istanbul_today(instant)) == 10000
    assert employee_pay.unpaid_salary_amount(emp, [], "2026-10", date(2026, 10, 12)) == 0


def test_missing_pay_start_does_not_estimate_salary():
    emp = {"salary": 12000, "start_date": "2026-01-01", "pay_type": "monthly", "pay_recurring": True}
    assert employee_pay.has_pay_start_date(emp) is False
    assert employee_pay.entitlement_slot_partner(emp, "2026-10") is None
    assert employee_pay.unpaid_salary_amount(emp, [], "2026-10", date(2026, 10, 13)) == 0
    no_hire = {"salary": 15000, "pay_type": "monthly", "pay_recurring": True}
    assert employee_pay.entitlement_slot_partner(no_hire, "2026-10") is None
    assert employee_pay.unpaid_salary_amount(no_hire, [], "2026-10", date(2026, 10, 13)) == 0
    figs = employee_pay.period_figures(emp, [], [], "2026-10", unpaid_payroll=12000)
    assert figs["salary_earned"] == 0


def test_pay_start_keeps_salary_entitlement():
    emp = {
        "salary": 12000, "pay_start_date": "2026-01-01", "pay_type": "monthly", "pay_recurring": True,
    }
    assert employee_pay.has_pay_start_date(emp) is True
    partner = employee_pay.entitlement_slot_partner(emp, "2026-10")
    assert partner and partner["salary_start_date"] == "2026-01-01"
    assert employee_pay.unpaid_salary_amount(emp, [], "2026-10", date(2026, 10, 13)) == 12000
    figs = employee_pay.period_figures(emp, [], [], "2026-10", unpaid_payroll=12000)
    assert figs["salary_earned"] == 12000


def test_rejected_payroll_does_not_hide_or_inflate_salary():
    emp = {"salary": 12000, "pay_start_date": "2026-01-01", "pay_type": "monthly"}
    rejected = [{"period": "2026-10", "status": "Rejected", "final_payable": 12000}]
    assert employee_pay.unpaid_salary_amount(emp, rejected, "2026-10", date(2026, 10, 13)) == 12000
    cancelled = [{"period": "2026-10", "status": "void", "final_payable": 1}]
    assert employee_pay.unpaid_salary_amount(emp, cancelled, "2026-10", date(2026, 10, 13)) == 12000


def test_partial_paid_amount_reduces_open_salary():
    emp = {"salary": 10000, "pay_start_date": "2026-01-01", "pay_type": "monthly"}
    rows = [{"period": "2026-10", "status": "pending", "final_payable": 10000, "paid_amount": 4000}]
    assert employee_pay.unpaid_salary_amount(emp, rows, "2026-10", date(2026, 10, 13)) == 6000
    paid = [{"period": "2026-10", "status": "paid", "final_payable": 10000}]
    assert employee_pay.unpaid_salary_amount(emp, paid, "2026-10", date(2026, 10, 13)) == 0


def test_sgk_official_salary_blocks_cash_and_allows_bank_split():
    emp = {"sgk_insured": True, "official_salary": 15000, "salary": 28000}
    bank = {"_id": "b1", "type": "bank"}
    cash = {"_id": "c1", "type": "cash_box", "current_balance": 80000}
    accounts = {"b1": bank, "c1": cash}
    cash_only = [{"kind": "salary", "amount": 15000, "account_id": "c1"}]
    assert employee_pay.validate_sgk_lines(emp, {}, cash_only, accounts) == employee_pay.SGK_BANK_MSG
    split = [
        {"kind": "salary", "amount": 15000, "account_id": "b1"},
        {"kind": "salary", "amount": 5000, "account_id": "c1"},
    ]
    assert employee_pay.validate_sgk_lines(emp, {}, split, accounts) is None
    assert employee_pay.validate_sgk_lines(emp, {}, [{"kind": "advance", "amount": 2000, "account_id": "c1"}], accounts) is None
    assert employee_pay.validate_sgk_lines(
        {"sgk_insured": False, "salary": 10000}, {}, cash_only, accounts,
    ) is None
    assert employee_pay.validate_sgk_lines(
        emp, {"settings": {"sgk_salary_bank_only": False}}, cash_only, accounts,
    ) is None
    by_number = {"sgk_number": "12345678901", "salary": 10000}
    assert employee_pay.validate_sgk_lines(
        by_number, {}, [{"kind": "salary", "amount": 10000, "account_id": "c1"}], accounts,
    ) == employee_pay.SGK_BANK_MSG
    assert employee_pay.sgk_rule_enabled({}) is True
    assert employee_pay.sgk_setting_error({"role": "sales"}, False) == "SGK maaş kuralını yalnızca firma yöneticisi kapatabilir."
    assert employee_pay.sgk_setting_error({"role": "admin"}, False) is None


def test_cash_shortfall_and_overpay_preview():
    cash = {"type": "cash_box", "current_balance": 100}
    assert employee_pay.cash_shortfall(cash, 150) is True
    assert employee_pay.cash_shortfall({"type": "bank", "current_balance": 0}, 150) is False
    assert employee_pay.grouped_cash_shortfall(
        [{"account_id": "k", "amount": 80}, {"account_id": "k", "amount": 40}],
        {"k": {"type": "cash_box", "current_balance": 100}},
    ) == employee_pay.CASH_SHORT_MSG
    preview = employee_pay.payment_after(5000, [{"amount": 7000}])
    assert preview["remaining_after"] == -2000
    assert preview["message"] == "sonraki maaştan düşülecek"
    assert employee_pay.payment_after(5000, [{"amount": 2000}])["message"] is None


def test_advance_offsets_next_remaining():
    def counts(b):
        return str(b.get("type") or "").lower() in ("advance", "borc") and b.get("status") != "rejected"

    advance = employee_pay.extra_advance_due(
        [{"type": "advance", "amount": 1500, "status": "paid"}], [], counts_as_advance=counts,
    )
    assert advance == 1500
    assert employee_pay.compose_remaining(unpaid_payroll=10000, extra_advance=advance) == 8500
