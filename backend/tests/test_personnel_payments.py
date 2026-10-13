"""Personel ödeme satırları: maaş, kısmi, çoklu hesap, avans, fazla, SGK."""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import employee_pay  # noqa: E402
import personnel_payments  # noqa: E402
from fastapi import HTTPException  # noqa: E402


class FakeCollection:
    def __init__(self):
        self.docs = []

    def _match(self, d, q):
        for k, v in (q or {}).items():
            if isinstance(v, dict):
                continue
            if d.get(k) != v:
                return False
        return True

    async def find_one(self, q=None, projection=None):
        return next((d for d in self.docs if self._match(d, q)), None)

    def find(self, q=None, projection=None):
        return FakeCursor([d for d in self.docs if self._match(d, q)])

    async def insert_one(self, doc):
        self.docs.append(doc)
        return doc

    async def update_one(self, q, upd):
        for d in self.docs:
            if not self._match(d, q):
                continue
            for k, v in (upd.get("$set") or {}).items():
                d[k] = v
            for k, v in (upd.get("$inc") or {}).items():
                d[k] = float(d.get(k) or 0) + float(v)
            return


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, n):
        return list(self.rows[:n])


class FakeDb:
    def __init__(self):
        self._cols = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        if name not in self._cols:
            self._cols[name] = FakeCollection()
        return self._cols[name]


def _emp(**extra):
    base = {
        "_id": "e1",
        "company_id": "c1",
        "full_name": "Ali",
        "salary": 10000,
        "pay_type": "monthly",
        "pay_start_date": "2026-01-01",
        "pay_recurring": True,
        "iban": "TR330006100519786457841326",
    }
    base.update(extra)
    return base


def _run(db, emp, lines, *, balance=None, company=None, key=None, date="2026-10-13"):
    payload = {"lines": lines, "idempotency_key": key}
    bal = balance or {"remaining": 10000, "unpaid_payroll": 10000, "meal_due": 0, "transport_due": 0}
    return asyncio.run(personnel_payments.apply_payment_lines(
        db, emp, company or {}, payload, balance=bal, pay_date=date, period="2026-10",
    ))


def test_salary_payment_writes_movement_and_bank():
    db = FakeDb()
    db.bank_accounts.docs.append({"_id": "bank", "type": "bank", "account_name": "Maaş", "current_balance": 50000})
    result = _run(db, _emp(), [{"kind": "salary", "amount": 10000, "account_id": "bank"}])
    assert result["paid"] == ["salary"]
    assert len(db.personnel_movements.docs) == 1
    mov = db.personnel_movements.docs[0]
    assert mov["kind"] == "salary" and mov["period"] == "2026-10" and mov["amount"] == 10000
    assert len(db.bank_transactions.docs) == 1
    assert db.bank_transactions.docs[0]["type"] == "outflow"
    assert db.bank_accounts.docs[0]["current_balance"] == 40000
    payroll = db.payrolls.docs[0]
    assert payroll["status"] == "paid" and payroll["paid_amount"] == 10000
    assert result["receipt_id"]
    assert db.personnel_receipts.docs[0]["_id"] == result["receipt_id"]


def test_partial_payment_keeps_payroll_open():
    db = FakeDb()
    db.bank_accounts.docs.append({"_id": "bank", "type": "bank", "account_name": "Maaş", "current_balance": 50000})
    db.payrolls.docs.append({
        "_id": "p1", "employee_id": "e1", "period": "2026-10", "status": "pending",
        "final_payable": 10000, "net_salary": 10000, "paid_amount": 0,
    })
    result = _run(db, _emp(), [{"kind": "salary", "amount": 4000, "account_id": "bank"}], balance={"remaining": 10000, "unpaid_payroll": 10000})
    assert db.payrolls.docs[0]["paid_amount"] == 4000
    assert db.payrolls.docs[0]["status"] == "pending"
    assert result["remaining_after"] == 6000


def test_multi_account_lines():
    db = FakeDb()
    db.bank_accounts.docs.extend([
        {"_id": "cash", "type": "cash_box", "account_name": "Kasa", "current_balance": 3000},
        {"_id": "bank", "type": "bank", "account_name": "Banka", "current_balance": 20000},
    ])
    result = _run(db, _emp(), [
        {"kind": "salary", "amount": 7000, "account_id": "bank"},
        {"kind": "salary", "amount": 3000, "account_id": "cash"},
    ])
    assert len(result["lines"]) == 2
    assert len(db.personnel_movements.docs) == 2
    assert len(db.bank_transactions.docs) == 2
    assert db.payrolls.docs[0]["status"] == "paid"
    assert {a["_id"]: a["current_balance"] for a in db.bank_accounts.docs} == {"cash": 0, "bank": 13000}


def test_advance_offsets_remaining():
    db = FakeDb()
    db.bank_accounts.docs.append({"_id": "cash", "type": "cash_box", "account_name": "Kasa", "current_balance": 5000})
    _run(db, _emp(), [{"kind": "advance", "amount": 1500, "account_id": "cash"}], balance={"remaining": 10000, "unpaid_payroll": 10000})
    assert db.bonus_payments.docs[0]["type"] == "advance"
    assert db.bonus_payments.docs[0]["status"] == "paid"
    advance = employee_pay.extra_advance_due(
        db.bonus_payments.docs, [], counts_as_advance=lambda b: b.get("type") == "advance" and b.get("status") != "rejected",
    )
    assert employee_pay.compose_remaining(unpaid_payroll=10000, extra_advance=advance) == 8500


def test_overpay_becomes_advance_for_next_salary():
    db = FakeDb()
    db.bank_accounts.docs.append({"_id": "bank", "type": "bank", "account_name": "Banka", "current_balance": 20000})
    db.payrolls.docs.append({
        "_id": "p1", "employee_id": "e1", "period": "2026-10", "status": "pending",
        "final_payable": 5000, "net_salary": 5000, "paid_amount": 0,
    })
    result = _run(
        db, _emp(salary=5000),
        [{"kind": "salary", "amount": 7000, "account_id": "bank"}],
        balance={"remaining": 5000, "unpaid_payroll": 5000},
    )
    assert result["overpaid"] is True
    assert "sonraki maaştan düşülecek" in result["message"]
    assert result["remaining_after"] == -2000
    assert db.payrolls.docs[0]["status"] == "paid"
    assert db.payrolls.docs[0]["paid_amount"] == 5000
    assert db.bonus_payments.docs[0]["type"] == "advance"
    assert db.bonus_payments.docs[0]["amount"] == 2000


def test_sgk_cash_blocked_and_bank_allowed():
    db = FakeDb()
    db.bank_accounts.docs.extend([
        {"_id": "cash", "type": "cash_box", "account_name": "Kasa", "current_balance": 50000},
        {"_id": "bank", "type": "bank", "account_name": "Banka", "current_balance": 50000},
    ])
    emp = _emp(sgk_insured=True, official_salary=15000, salary=20000)
    try:
        _run(db, emp, [{"kind": "salary", "amount": 15000, "account_id": "cash"}], balance={"remaining": 20000, "unpaid_payroll": 20000})
        raise AssertionError("kasa engellenmeli")
    except HTTPException as exc:
        assert exc.status_code == 400
        assert exc.detail == "SGK'lı personelin resmi maaşı bankadan ödenmelidir"
    assert db.personnel_movements.docs == []
    assert db.bank_transactions.docs == []
    result = _run(db, emp, [
        {"kind": "salary", "amount": 15000, "account_id": "bank"},
        {"kind": "salary", "amount": 5000, "account_id": "cash"},
    ], balance={"remaining": 20000, "unpaid_payroll": 20000})
    assert result["status"] == "success"
    assert db.payrolls.docs[0]["paid_amount"] == 20000
    assert db.payrolls.docs[0]["status"] == "paid"


def test_receipt_pdf_starts_with_pdf_header():
    import personnel_receipt
    pdf = personnel_receipt.render_pdf({
        "_id": "rcpt_1",
        "employee_name": "Ali",
        "period": "2026-10",
        "date": "2026-10-13",
        "lines": [{"kind_label": "Maaş", "account_name": "Banka", "amount": 10000, "description": ""}],
        "total": 10000,
        "remaining_after": -500,
        "overpaid": True,
    }, {"name": "Tamkobi"})
    assert pdf.startswith(b"%PDF")
    assert b"sonraki" in pdf or b"maas" in pdf.lower() or len(pdf) > 500


def test_idempotent_replay_does_not_double_post():
    db = FakeDb()
    db.bank_accounts.docs.append({"_id": "bank", "type": "bank", "account_name": "Banka", "current_balance": 50000})
    lines = [{"kind": "salary", "amount": 10000, "account_id": "bank"}]
    first = _run(db, _emp(), lines, key="click-1")
    second = _run(db, _emp(), lines, key="click-1")
    assert second["idempotent"] is True
    assert second["receipt_id"] == first["receipt_id"]
    assert len(db.personnel_movements.docs) == 1
    assert len(db.bank_transactions.docs) == 1
    assert db.bank_accounts.docs[0]["current_balance"] == 40000
