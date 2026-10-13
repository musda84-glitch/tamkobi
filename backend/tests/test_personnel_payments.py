"""Personel ödeme satırları: maaş, kısmi, çoklu hesap, avans, fazla, SGK, tenant, geri alma."""
import asyncio
import os
import re
import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import employee_pay  # noqa: E402
import linked_moves  # noqa: E402
import personnel_payments  # noqa: E402
from fastapi import HTTPException  # noqa: E402
from mysql_store import DuplicateKeyError  # noqa: E402


class FakeCollection:
    def __init__(self):
        self.docs = []

    def _match(self, d, q):
        if not q:
            return True
        if "$or" in q:
            rest = {k: v for k, v in q.items() if k != "$or"}
            if rest and not self._match(d, rest):
                return False
            return any(self._match(d, clause) for clause in q["$or"])
        if "$and" in q:
            return all(self._match(d, clause) for clause in q["$and"])
        for k, v in (q or {}).items():
            if isinstance(v, dict):
                if "$exists" in v:
                    exists = k in d
                    if bool(v["$exists"]) != exists:
                        return False
                    continue
                if "$ne" in v:
                    if d.get(k) == v["$ne"]:
                        return False
                    continue
                if "$in" in v:
                    if d.get(k) not in v["$in"]:
                        return False
                    continue
                if "$nin" in v and d.get(k) in v["$nin"]:
                    return False
                if "$regex" in v:
                    flags = re.I if "i" in str(v.get("$options") or "") else 0
                    if not re.search(v["$regex"], str(d.get(k) or ""), flags):
                        return False
                    continue
                if d.get(k) != v:
                    return False
            elif d.get(k) != v:
                return False
        return True

    async def find_one(self, q=None, projection=None):
        return next((d for d in self.docs if self._match(d, q)), None)

    def find(self, q=None, projection=None):
        return FakeCursor([d for d in self.docs if self._match(d, q)])

    async def insert_one(self, doc):
        if any(x.get("_id") == doc.get("_id") for x in self.docs if doc.get("_id") is not None):
            raise DuplicateKeyError(doc.get("_id"))
        self.docs.append(doc)
        return doc

    def _apply(self, d, upd):
        for k, v in (upd.get("$set") or {}).items():
            d[k] = v
        for k, v in (upd.get("$inc") or {}).items():
            d[k] = float(d.get(k) or 0) + float(v)
        for k in (upd.get("$unset") or {}):
            d.pop(k, None)

    async def update_one(self, q, upd):
        for d in self.docs:
            if not self._match(d, q):
                continue
            self._apply(d, upd)
            return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def update_one_atomic(self, q, upd):
        return await self.update_one(q, upd)

    async def delete_one(self, q):
        before = len(self.docs)
        self.docs[:] = [d for d in self.docs if not self._match(d, q)]
        return SimpleNamespace(deleted_count=before - len(self.docs))

    async def delete_many(self, q):
        before = len(self.docs)
        self.docs[:] = [d for d in self.docs if not self._match(d, q)]
        return SimpleNamespace(deleted_count=before - len(self.docs))

    async def create_index(self, *a, **k):
        return None


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

    def __getitem__(self, name):
        return getattr(self, name)


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


def _acc(aid="bank", **extra):
    doc = {"_id": aid, "company_id": "c1", "type": "bank", "account_name": "Banka", "current_balance": 50000}
    doc.update(extra)
    return doc


def _run(db, emp, lines, *, balance=None, company=None, key=None, date="2026-10-13"):
    payload = {"lines": lines, "idempotency_key": key}
    bal = balance or {"remaining": 10000, "unpaid_payroll": 10000, "meal_due": 0, "transport_due": 0}
    return asyncio.run(personnel_payments.apply_payment_lines(
        db, emp, company or {}, payload, balance=bal, pay_date=date, period="2026-10",
    ))


def test_salary_payment_writes_movement_and_bank():
    db = FakeDb()
    db.bank_accounts.docs.append(_acc())
    result = _run(db, _emp(), [{"kind": "salary", "amount": 10000, "account_id": "bank"}])
    assert result["paid"] == ["salary"]
    assert len(db.personnel_movements.docs) == 1
    mov = db.personnel_movements.docs[0]
    assert mov["kind"] == "salary" and mov["period"] == "2026-10" and mov["amount"] == 10000
    assert len(db.bank_transactions.docs) == 1
    tx = db.bank_transactions.docs[0]
    assert tx["type"] == "outflow"
    assert tx["source_type"] == "personnel_payment"
    assert tx["source_id"] == mov["_id"]
    assert tx["personnel_movement_id"] == mov["_id"]
    assert db.bank_accounts.docs[0]["current_balance"] == 40000
    payroll = db.payrolls.docs[0]
    assert payroll["status"] == "paid" and payroll["paid_amount"] == 10000
    assert payroll["source_type"] == "personnel_payment"
    assert result["receipt_id"]
    assert db.personnel_receipts.docs[0]["_id"] == result["receipt_id"]


def test_partial_payment_keeps_payroll_open():
    db = FakeDb()
    db.bank_accounts.docs.append(_acc())
    db.payrolls.docs.append({
        "_id": "p1", "company_id": "c1", "employee_id": "e1", "period": "2026-10", "status": "pending",
        "final_payable": 10000, "net_salary": 10000, "paid_amount": 0,
    })
    result = _run(db, _emp(), [{"kind": "salary", "amount": 4000, "account_id": "bank"}], balance={"remaining": 10000, "unpaid_payroll": 10000})
    assert db.payrolls.docs[0]["paid_amount"] == 4000
    assert db.payrolls.docs[0]["status"] == "pending"
    assert result["remaining_after"] == 6000


def test_multi_account_lines():
    db = FakeDb()
    db.bank_accounts.docs.extend([
        _acc("cash", type="cash_box", account_name="Kasa", current_balance=3000),
        _acc("bank", type="bank", account_name="Banka", current_balance=20000),
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
    db.bank_accounts.docs.append(_acc("cash", type="cash_box", account_name="Kasa", current_balance=5000))
    _run(db, _emp(), [{"kind": "advance", "amount": 1500, "account_id": "cash"}], balance={"remaining": 10000, "unpaid_payroll": 10000})
    assert db.bonus_payments.docs[0]["type"] == "advance"
    assert db.bonus_payments.docs[0]["status"] == "paid"
    assert db.bonus_payments.docs[0]["source_type"] == "personnel_payment"
    advance = employee_pay.extra_advance_due(
        db.bonus_payments.docs, [], counts_as_advance=lambda b: b.get("type") == "advance" and b.get("status") != "rejected",
    )
    assert employee_pay.compose_remaining(unpaid_payroll=10000, extra_advance=advance) == 8500


def test_overpay_becomes_advance_for_next_salary():
    db = FakeDb()
    db.bank_accounts.docs.append(_acc(current_balance=20000))
    db.payrolls.docs.append({
        "_id": "p1", "company_id": "c1", "employee_id": "e1", "period": "2026-10", "status": "pending",
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
    assert db.bonus_payments.docs[0]["source_type"] == "personnel_payment"


def test_sgk_cash_blocked_and_bank_allowed():
    db = FakeDb()
    db.bank_accounts.docs.extend([
        _acc("cash", type="cash_box", account_name="Kasa", current_balance=50000),
        _acc("bank", type="bank", account_name="Banka", current_balance=50000),
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
    db.bank_accounts.docs.append(_acc())
    lines = [{"kind": "salary", "amount": 10000, "account_id": "bank"}]
    first = _run(db, _emp(), lines, key="click-1")
    second = _run(db, _emp(), lines, key="click-1")
    assert second["receipt_id"] == first["receipt_id"]
    assert len(db.personnel_movements.docs) == 1
    assert len(db.bank_transactions.docs) == 1
    assert db.bank_accounts.docs[0]["current_balance"] == 40000


def test_foreign_company_account_returns_404_and_leaves_balance():
    db = FakeDb()
    db.bank_accounts.docs.append(_acc("foreign", company_id="c2", account_name="Other", current_balance=999))
    db.bank_accounts.docs.append(_acc("own", current_balance=50000))
    try:
        _run(db, _emp(), [{"kind": "salary", "amount": 100, "account_id": "foreign"}])
        raise AssertionError("404 expected")
    except HTTPException as exc:
        assert exc.status_code == 404
    foreign = next(a for a in db.bank_accounts.docs if a["_id"] == "foreign")
    assert foreign["current_balance"] == 999
    assert db.personnel_movements.docs == []
    assert db.bank_transactions.docs == []


def test_cover_salary_ignores_other_company_payroll():
    db = FakeDb()
    db.bank_accounts.docs.append(_acc())
    db.payrolls.docs.append({
        "_id": "p_other", "company_id": "c2", "employee_id": "e1", "period": "2026-10",
        "status": "pending", "final_payable": 10000, "net_salary": 10000, "paid_amount": 0,
    })
    _run(db, _emp(), [{"kind": "salary", "amount": 10000, "account_id": "bank"}])
    other = next(p for p in db.payrolls.docs if p["_id"] == "p_other")
    assert other["paid_amount"] == 0 and other["status"] == "pending"
    own = [p for p in db.payrolls.docs if p.get("company_id") == "c1"]
    assert own and own[0]["status"] == "paid" and own[0]["paid_amount"] == 10000


def test_cover_bonus_ignores_other_company_bonus():
    db = FakeDb()
    db.bank_accounts.docs.append(_acc())
    db.bonus_payments.docs.append({
        "_id": "b_other", "company_id": "c2", "employee_id": "e1", "type": "bonus",
        "status": "pending", "amount": 500,
    })
    _run(db, _emp(), [{"kind": "bonus", "amount": 500, "account_id": "bank"}], balance={"remaining": 500, "unpaid_payroll": 0})
    other = next(b for b in db.bonus_payments.docs if b["_id"] == "b_other")
    assert other["status"] == "pending"


def _init_linked(db):
    async def reverse_tx(tx, sign=-1):
        amt = float(tx.get("amount") or 0) * sign
        change = amt if tx.get("type") == "inflow" else -amt
        if tx.get("account_id"):
            await db.bank_accounts.update_one({"_id": tx["account_id"]}, {"$inc": {"current_balance": change}})

    linked_moves.init(db, reverse_tx_fn=reverse_tx)


def test_reverse_payment_restores_balance_and_no_orphans():
    db = FakeDb()
    _init_linked(db)
    db.bank_accounts.docs.append(_acc(current_balance=50000))
    db.payrolls.docs.append({
        "_id": "p1", "company_id": "c1", "employee_id": "e1", "period": "2026-10", "status": "pending",
        "final_payable": 10000, "net_salary": 10000, "paid_amount": 0,
    })
    result = _run(db, _emp(), [{"kind": "salary", "amount": 10000, "account_id": "bank"}])
    assert db.bank_accounts.docs[0]["current_balance"] == 40000
    assert db.payrolls.docs[0]["paid_amount"] == 10000
    mov = db.personnel_movements.docs[0]

    async def _sd(coll, doc, *a, **k):
        await db[coll].delete_one({"_id": doc["_id"]})
        return "tid"

    with patch.object(linked_moves.trash, "soft_delete", new=AsyncMock(side_effect=_sd)):
        rev = asyncio.run(personnel_payments.reverse_payment(db, mov))
    assert rev["status"] == "success"
    assert db.bank_accounts.docs[0]["current_balance"] == 50000
    assert db.payrolls.docs[0]["paid_amount"] == 0
    assert db.payrolls.docs[0]["status"] == "pending"
    assert db.personnel_receipts.docs[0]["status"] == "cancelled"
    assert db.personnel_movements.docs[0]["status"] == "reversed"
    assert not any(t.get("personnel_movement_id") == mov["_id"] for t in db.bank_transactions.docs)
    report = asyncio.run(linked_moves.scan_orphans(db, "c1"))
    assert report["orphan_personnel_payment_moves"] == []
    assert report["summary"]["orphan_moves"] == 0
