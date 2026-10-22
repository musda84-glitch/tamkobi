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
import rbac  # noqa: E402
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
            rest = {k: v for k, v in q.items() if k != "$and"}
            if rest and not self._match(d, rest):
                return False
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
                if any(op in v for op in ("$lt", "$lte", "$gt", "$gte")):
                    cur = d.get(k)
                    try:
                        if "$lt" in v and not (cur is not None and cur < v["$lt"]):
                            return False
                        if "$lte" in v and not (cur is not None and cur <= v["$lte"]):
                            return False
                        if "$gt" in v and not (cur is not None and cur > v["$gt"]):
                            return False
                        if "$gte" in v and not (cur is not None and cur >= v["$gte"]):
                            return False
                    except TypeError:
                        return False
                    continue
                if "$in" in v:
                    if d.get(k) not in v["$in"]:
                        return False
                    continue
                if "$nin" in v:
                    if d.get(k) in v["$nin"]:
                        return False
                    continue
                if "$regex" in v:
                    flags = re.I if "i" in str(v.get("$options") or "") else 0
                    if not re.search(v["$regex"], str(d.get(k) or ""), flags):
                        return False
                    continue
                if "$elemMatch" in v:
                    items = d.get(k)
                    spec = v["$elemMatch"] if isinstance(v["$elemMatch"], dict) else {}
                    if not isinstance(items, list) or not any(
                        isinstance(item, dict) and self._match(item, spec) for item in items
                    ):
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

    def _insert_update(self, q, upd):
        doc = {}
        for k, v in (q or {}).items():
            if not str(k).startswith("$") and not isinstance(v, dict):
                doc[k] = v
        for k, v in (upd.get("$setOnInsert") or {}).items():
            doc[k] = v
        self._apply(doc, upd)
        self.docs.append(doc)
        return doc

    async def update_one(self, q, upd, upsert=False):
        for d in self.docs:
            if not self._match(d, q):
                continue
            self._apply(d, upd)
            return SimpleNamespace(matched_count=1, modified_count=1)
        if not upsert:
            return SimpleNamespace(matched_count=0, modified_count=0)
        doc = self._insert_update(q, upd)
        return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=doc.get("_id"))

    async def find_one_and_update(self, q, upd, upsert=False, return_document=True, projection=None):
        for d in self.docs:
            if not self._match(d, q):
                continue
            before = dict(d)
            self._apply(d, upd)
            return dict(d if return_document else before)
        if not upsert:
            return None
        doc = self._insert_update(q, upd)
        return dict(doc)

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


def test_salary_without_pay_start_does_not_create_payroll():
    db = FakeDb()
    db.bank_accounts.docs.append(_acc())
    emp = _emp()
    emp.pop("pay_start_date", None)
    result = _run(
        db, emp, [{"kind": "salary", "amount": 10000, "account_id": "bank"}],
        balance={"remaining": 0, "unpaid_payroll": 0},
    )
    assert db.payrolls.docs == []
    assert result["manual_salary"] is True
    assert db.bonus_payments.docs and db.bonus_payments.docs[0]["type"] == "advance"
    assert db.personnel_movements.docs[0]["kind"] == "salary"


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


def _admin():
    return {"_id": "u_admin", "role": "admin", "company_ids": ["c1"], "active_company_id": "c1"}


def _reverse(db, mov, actor=None):
    async def _sd(coll, doc, *a, **k):
        await db[coll].delete_one({"_id": doc["_id"]})
        return "tid"

    async def _go():
        with patch.object(linked_moves.trash, "soft_delete", new=AsyncMock(side_effect=_sd)):
            return await personnel_payments.reverse_payment(db, mov, actor=actor)

    return asyncio.run(_go())


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
    rev = _reverse(db, mov, actor=_admin())
    assert rev["status"] == "success"
    assert db.bank_accounts.docs[0]["current_balance"] == 50000
    assert db.payrolls.docs[0]["paid_amount"] == 0
    assert db.payrolls.docs[0]["status"] == "pending"
    assert db.personnel_receipts.docs[0]["status"] == "cancelled"
    assert db.personnel_movements.docs[0]["status"] == "reversed"
    assert not any(t.get("personnel_movement_id") == mov["_id"] for t in db.bank_transactions.docs)
    assert not any(t.get("payroll_id") == "p1" for t in db.bank_transactions.docs)


def test_reverse_first_of_two_payments_keeps_the_second():
    db = FakeDb()
    _init_linked(db)
    db.bank_accounts.docs.append(_acc(current_balance=50000))
    db.payrolls.docs.append({
        "_id": "p1", "company_id": "c1", "employee_id": "e1", "period": "2026-10", "status": "pending",
        "final_payable": 10000, "net_salary": 10000, "paid_amount": 0,
    })
    _run(db, _emp(), [{"kind": "salary", "amount": 4000, "account_id": "bank"}])
    _run(db, _emp(), [{"kind": "salary", "amount": 3000, "account_id": "bank"}])
    assert db.payrolls.docs[0]["paid_amount"] == 7000
    assert db.bank_accounts.docs[0]["current_balance"] == 43000
    first, second = db.personnel_movements.docs
    assert first["effects"][0]["paid_delta"] == 4000
    assert first["effects"][0]["prev_paid"] == 0
    rev = _reverse(db, first, actor=_admin())
    assert rev["idempotent"] is False
    payroll = db.payrolls.docs[0]
    assert payroll["paid_amount"] == 3000
    assert payroll["status"] == "pending"
    assert db.personnel_movements.docs[0]["status"] == "reversed"
    assert db.personnel_movements.docs[1]["status"] == "posted"
    assert db.bank_accounts.docs[0]["current_balance"] == 47000
    assert second["effects"][0]["paid_delta"] == 3000


def test_concurrent_reverse_applies_once():
    db = FakeDb()
    _init_linked(db)
    db.bank_accounts.docs.append(_acc(current_balance=50000))
    db.payrolls.docs.append({
        "_id": "p1", "company_id": "c1", "employee_id": "e1", "period": "2026-10", "status": "pending",
        "final_payable": 10000, "net_salary": 10000, "paid_amount": 0,
    })
    _run(db, _emp(), [{"kind": "salary", "amount": 4000, "account_id": "bank"}])
    _run(db, _emp(), [{"kind": "salary", "amount": 3000, "account_id": "bank"}])
    first = db.personnel_movements.docs[0]

    async def _sd(coll, doc, *a, **k):
        await db[coll].delete_one({"_id": doc["_id"]})
        return "tid"

    async def _both():
        with patch.object(linked_moves.trash, "soft_delete", new=AsyncMock(side_effect=_sd)):
            return await asyncio.gather(
                personnel_payments.reverse_payment(db, first, actor=_admin()),
                personnel_payments.reverse_payment(db, first, actor=_admin()),
                return_exceptions=True,
            )

    results = asyncio.run(_both())
    applied = [r for r in results if isinstance(r, dict) and r.get("status") == "success" and not r.get("idempotent")]
    blocked = [r for r in results if isinstance(r, HTTPException) and r.status_code == 409]
    idem = [r for r in results if isinstance(r, dict) and r.get("idempotent")]
    assert len(applied) == 1, results
    assert len(blocked) + len(idem) == 1, results
    assert db.payrolls.docs[0]["paid_amount"] == 3000
    assert db.payrolls.docs[0]["status"] == "pending"
    assert db.bank_accounts.docs[0]["current_balance"] == 47000
    assert db.personnel_movements.docs[1]["status"] == "posted"


def test_reverse_status_only_bonus_restores_previous_status():
    db = FakeDb()
    _init_linked(db)
    db.bank_accounts.docs.append(_acc(current_balance=5000))
    db.bonus_payments.docs.append({
        "_id": "b1", "company_id": "c1", "employee_id": "e1", "type": "bonus",
        "status": "pending", "amount": 500,
    })
    _run(db, _emp(), [{"kind": "bonus", "amount": 500, "account_id": "bank"}], balance={"remaining": 500, "unpaid_payroll": 0})
    assert db.bonus_payments.docs[0]["status"] == "paid"
    mov = db.personnel_movements.docs[0]
    _reverse(db, mov, actor=_admin())
    assert db.bonus_payments.docs[0]["status"] == "pending"
    assert "paid_amount" not in db.bonus_payments.docs[0]
    assert db.bank_accounts.docs[0]["current_balance"] == 5000
    assert db.personnel_movements.docs[0]["status"] == "reversed"


def test_reverse_requires_company_admin():
    db = FakeDb()
    _init_linked(db)
    db.personnel_movements.docs.append({
        "_id": "m1", "company_id": "c1", "status": "posted", "effects": [], "amount": 10,
    })
    sales = {"_id": "u_sales", "role": "sales", "company_ids": ["c1"], "active_company_id": "c1"}
    try:
        _reverse(db, db.personnel_movements.docs[0], actor=sales)
        raise AssertionError("403 expected")
    except HTTPException as exc:
        assert exc.status_code == 403
    assert db.personnel_movements.docs[0]["status"] == "posted"
    src = open(os.path.join(os.path.dirname(__file__), "..", "server.py"), encoding="utf-8").read()
    start = src.index("async def reverse_personnel_movement")
    chunk = src[start:start + 700]
    assert "require_company_admin" in chunk


def test_undo_effect_subtracts_paid_amount_on_other_collections():
    db = FakeDb()
    db.bonus_payments.docs.append({
        "_id": "b1", "company_id": "c1", "paid_amount": 800, "amount": 1000, "status": "pending",
    })
    db.expenses.docs.append({
        "_id": "x1", "company_id": "c1", "paid_amount": 100, "total": 100, "amount": 100,
        "payment_status": "paid",
    })

    async def _go():
        await personnel_payments._undo_effect(db, {
            "collection": "bonus_payments", "id": "b1", "action": "update",
            "paid_delta": 300, "prev_paid": 0, "prev_status": "pending",
        })
        await personnel_payments._undo_effect(db, {
            "collection": "expenses", "id": "x1", "action": "update",
            "paid_delta": 40, "prev_paid": 0, "prev_status": "unpaid", "status_field": "payment_status",
        })

    asyncio.run(_go())
    assert db.bonus_payments.docs[0]["paid_amount"] == 500
    assert db.bonus_payments.docs[0]["status"] == "pending"
    assert db.expenses.docs[0]["paid_amount"] == 60
    assert db.expenses.docs[0]["payment_status"] == "unpaid"


def test_payroll_payment_respects_fresh_pay_claim():
    from datetime import datetime, timezone
    db = FakeDb()
    db.bank_accounts.docs.append(_acc(current_balance=50000))
    fresh = datetime.now(timezone.utc).isoformat()
    db.payrolls.docs.append({
        "_id": "p1", "company_id": "c1", "employee_id": "e1", "period": "2026-10", "status": "pending",
        "final_payable": 10000, "net_salary": 10000, "paid_amount": 0,
        "_pay_claimed_at": fresh,
    })
    try:
        _run(db, _emp(), [{"kind": "salary", "amount": 4000, "account_id": "bank"}])
        raise AssertionError("409 expected")
    except HTTPException as exc:
        assert exc.status_code == 409
        assert "sürüyor" in str(exc.detail)
    assert db.payrolls.docs[0]["paid_amount"] == 0
    assert db.payrolls.docs[0]["_pay_claimed_at"] == fresh
    assert db.personnel_movements.docs == []
    assert db.bank_transactions.docs == []
    assert db.bank_accounts.docs[0]["current_balance"] == 50000


def test_payroll_payment_takes_over_stale_pay_claim():
    from datetime import datetime, timedelta, timezone
    db = FakeDb()
    db.bank_accounts.docs.append(_acc(current_balance=50000))
    stale = (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat()
    db.payrolls.docs.append({
        "_id": "p1", "company_id": "c1", "employee_id": "e1", "period": "2026-10", "status": "pending",
        "final_payable": 10000, "net_salary": 10000, "paid_amount": 0,
        "_pay_claimed_at": stale,
    })
    _run(db, _emp(), [{"kind": "salary", "amount": 4000, "account_id": "bank"}])
    payroll = db.payrolls.docs[0]
    assert payroll["paid_amount"] == 4000
    assert payroll["status"] == "pending"
    assert "_pay_claimed_at" not in payroll


def _reverse_links(db, doc, collection):
    async def _sd(coll, row, *a, **k):
        await db[coll].delete_one({"_id": row["_id"]})
        return "tid"

    async def _go():
        with patch.object(linked_moves.trash, "soft_delete", new=AsyncMock(side_effect=_sd)):
            return await personnel_payments.reverse_linked_personnel_payments(
                db, doc, collection=collection,
            )

    return asyncio.run(_go())


def test_deleting_advance_reverses_linked_source_movement():
    """Avans personel kaydı silinince bağlı banka hareketi de geri alınır; bakiye bir kez düzelir."""
    db = FakeDb()
    _init_linked(db)
    db.bank_accounts.docs.append(_acc("bank", type="bank", account_name="Banka", current_balance=5000))
    _run(
        db, _emp(),
        [{"kind": "advance", "amount": 1500, "account_id": "bank", "description": "Avans"}],
        balance={"remaining": 0, "unpaid_payroll": 0},
    )
    bonus = dict(db.bonus_payments.docs[0])
    mov = db.personnel_movements.docs[0]
    assert bonus["source_type"] == "personnel_payment"
    assert bonus["source_id"] == mov["_id"]
    assert mov["account_name"] == "Banka"
    assert db.bank_accounts.docs[0]["current_balance"] == 3500
    n = _reverse_links(db, bonus, "bonus_payments")
    assert n == 1
    assert db.bonus_payments.docs == []
    assert db.personnel_movements.docs[0]["status"] == "reversed"
    assert db.bank_transactions.docs == []
    assert db.bank_accounts.docs[0]["current_balance"] == 5000
    assert _reverse_links(db, bonus, "bonus_payments") == 0
    assert db.bank_accounts.docs[0]["current_balance"] == 5000


def test_deleting_payroll_reverses_linked_movement_once():
    db = FakeDb()
    _init_linked(db)
    db.bank_accounts.docs.append(_acc(current_balance=50000))
    db.payrolls.docs.append({
        "_id": "p1", "company_id": "c1", "employee_id": "e1", "period": "2026-10", "status": "pending",
        "final_payable": 10000, "net_salary": 10000, "paid_amount": 0,
    })
    _run(db, _emp(), [{"kind": "salary", "amount": 10000, "account_id": "bank"}])
    payroll = dict(db.payrolls.docs[0])
    assert payroll.get("source_type") != "personnel_payment"
    assert db.bank_accounts.docs[0]["current_balance"] == 40000
    db.personnel_movements.docs.append({
        "_id": "other_co", "company_id": "c2", "status": "posted", "amount": 10,
        "effects": [{"collection": "payrolls", "id": "p1", "action": "update"}],
    })
    n = _reverse_links(db, payroll, "payrolls")
    assert n == 1
    assert db.payrolls.docs[0]["paid_amount"] == 0
    assert db.payrolls.docs[0]["status"] == "pending"
    assert db.personnel_movements.docs[0]["status"] == "reversed"
    assert db.personnel_movements.docs[1]["status"] == "posted"
    assert db.bank_accounts.docs[0]["current_balance"] == 50000
    assert _reverse_links(db, payroll, "payrolls") == 0
    assert db.bank_accounts.docs[0]["current_balance"] == 50000


def test_delete_endpoints_call_linked_payment_reverse():
    root = os.path.join(os.path.dirname(__file__), "..")
    server = open(os.path.join(root, "server.py"), encoding="utf-8").read()
    payments = open(os.path.join(root, "personnel_payments.py"), encoding="utf-8").read()
    bonus_start = server.index("async def delete_bonus")
    bonus_chunk = server[bonus_start:bonus_start + 1200]
    assert "delete_bonus_record" in bonus_chunk
    payroll_start = server.index("async def delete_payroll")
    payroll_chunk = server[payroll_start:payroll_start + 1200]
    assert "_reverse_personnel_payment_links" in payroll_chunk
    record_start = payments.index("async def delete_bonus_record")
    record_chunk = payments[record_start:record_start + 1600]
    assert "reverse_linked_personnel_payments" in record_chunk
    assert "prepare_source_trash" in record_chunk
    emp_start = server.index("async def delete_employee")
    emp_chunk = server[emp_start:emp_start + 1200]
    assert "delete_employee_bonuses" in emp_chunk
    assert '[{"collection": "bonus_payments", "docs": bonuses}]' in emp_chunk
    assert "related=related" in emp_chunk


def _raises(fn):
    try:
        fn()
    except HTTPException as exc:
        return exc
    raise AssertionError("HTTPException bekleniyordu")


def test_reimburse_cash_exit_does_not_touch_salary_advance_or_expense():
    db = FakeDb()
    db.bank_accounts.docs.append(_acc(current_balance=50000))
    db.payrolls.docs.append({
        "_id": "p1", "company_id": "c1", "employee_id": "e1", "period": "2026-10",
        "status": "pending", "final_payable": 10000, "paid_amount": 1000,
    })
    db.bonus_payments.docs.append({
        "_id": "adv", "company_id": "c1", "employee_id": "e1", "type": "advance",
        "amount": 500, "status": "paid",
    })
    result = _run(
        db, _emp(),
        [{"kind": "reimburse", "amount": 800, "account_id": "bank", "description": "Yakıt", "category": "Yakıt"}],
        balance={"remaining": 8000, "unpaid_payroll": 8000},
    )
    assert result["paid"] == ["reimburse"]
    assert result["remaining_after"] == 8000
    assert result["overpaid"] is False
    assert len(db.personnel_movements.docs) == 1
    mov = db.personnel_movements.docs[0]
    assert mov["kind"] == "reimburse"
    assert mov["kind_label"] == "Masraf ödemesi"
    assert db.bank_accounts.docs[0]["current_balance"] == 49200
    tx = db.bank_transactions.docs[0]
    assert tx["type"] == "outflow" and tx["amount"] == 800
    assert len(db.expenses.docs) == 1
    exp = db.expenses.docs[0]
    assert str(exp.get("expense_number") or "").startswith("MSR-")
    assert exp["employee_id"] == "e1"
    assert exp["payment_status"] == "paid"
    assert exp["category"] == "Yakıt" or exp["category"]
    assert exp.get("source_type") == "personnel_payment"
    assert len(db.bonus_payments.docs) == 1
    assert db.bonus_payments.docs[0]["amount"] == 500
    assert db.payrolls.docs[0]["paid_amount"] == 1000
    assert db.personnel_receipts.docs[0]["total"] == 800
    rows = personnel_payments.reimbursement_rows(db.personnel_movements.docs)
    assert rows[0]["kind"] == "reimburse"
    assert rows[0]["kind_label"] == "Masraf ödemesi"
    assert rows[0]["amount"] == 800
    assert rows[0]["expense_number"] == exp["expense_number"]
    assert rows[0]["charge_to_account"] is False


def test_reimburse_partner_is_withdrawal():
    db = FakeDb()
    db.partners.docs.append({"_id": "ort1", "company_id": "c1", "name": "Ayşe Ortak", "balance": 1000})
    result = _run(
        db, _emp(),
        [{"kind": "reimburse", "amount": 300, "partner_id": "ort1"}],
        balance={"remaining": 4000, "unpaid_payroll": 4000},
    )
    assert result["remaining_after"] == 4000
    assert db.partners.docs[0]["balance"] == 700
    assert db.partner_transactions.docs[0]["type"] == "withdrawal"
    assert db.partner_transactions.docs[0]["amount"] == 300
    assert db.bank_transactions.docs == []
    assert len(db.expenses.docs) == 1
    assert db.expenses.docs[0]["payment_status"] == "paid"
    assert "Ortak" in (db.personnel_movements.docs[0]["account_name"] or "")


def test_reimburse_closes_personnel_debt_without_rewriting_expense():
    db = FakeDb()
    db.bank_accounts.docs.append(_acc(current_balance=50000))
    db.expenses.docs.append({
        "_id": "ex1", "company_id": "c1", "employee_id": "e1",
        "expense_number": "MSR-2026-0007", "total": 250, "amount": 250,
        "payment_status": "unpaid", "paid_by_personnel": True, "personnel_debt_status": "open",
        "description": "Market",
    })
    _run(
        db, _emp(),
        [{"kind": "reimburse", "amount": 300, "account_id": "bank", "expense_id": "ex1"}],
        balance={"remaining": 9000, "unpaid_payroll": 9000, "unpaid_expenses": 0},
    )
    assert len(db.expenses.docs) == 1
    assert db.bonus_payments.docs == []
    assert db.payrolls.docs == []
    exp = db.expenses.docs[0]
    assert exp["personnel_debt_status"] == "closed"
    assert exp["payment_status"] == "unpaid"
    assert exp["reimburse_movement_id"] == db.personnel_movements.docs[0]["_id"]
    assert "personnel_movement_id" not in exp
    assert exp.get("source_type") != "personnel_payment"
    assert db.personnel_movements.docs[0]["expense_number"] == "MSR-2026-0007"
    assert db.personnel_movements.docs[0]["kind_label"] == "Masraf ödemesi"
    assert db.bank_accounts.docs[0]["current_balance"] == 49700
    assert result_remaining_unchanged(db)


def test_reimburse_by_number_and_rejects_short_foreign_other_and_closed():
    db = FakeDb()
    db.bank_accounts.docs.append(_acc(current_balance=50000))
    db.expenses.docs.append({
        "_id": "ex1", "company_id": "c1", "employee_id": "e1",
        "expense_number": "MSR-2026-0011", "total": 250,
        "payment_status": "unpaid", "notes": "Personel tarafından ödendi",
    })
    short = _raises(lambda: _run(
        db, _emp(),
        [{"kind": "reimburse", "amount": 100, "account_id": "bank", "expense_number": "MSR-2026-0011"}],
        balance={"remaining": 1000},
    ))
    assert short.status_code == 400 and "az" in str(short.detail)
    assert db.bank_accounts.docs[0]["current_balance"] == 50000
    assert db.personnel_movements.docs == []
    assert db.expenses.docs[0].get("personnel_debt_status") in (None, "")

    foreign = FakeDb()
    foreign.bank_accounts.docs.append(_acc(current_balance=50000))
    foreign.expenses.docs.append({
        "_id": "exf", "company_id": "c2", "employee_id": "e1",
        "expense_number": "MSR-2026-0099", "total": 40, "paid_by_personnel": True,
    })
    missing = _raises(lambda: _run(
        foreign, _emp(),
        [{"kind": "reimburse", "amount": 40, "account_id": "bank", "expense_id": "exf"}],
    ))
    assert missing.status_code == 404
    assert foreign.bank_accounts.docs[0]["current_balance"] == 50000

    other = FakeDb()
    other.bank_accounts.docs.append(_acc(current_balance=50000))
    other.expenses.docs.append({
        "_id": "exo", "company_id": "c1", "employee_id": "e2",
        "expense_number": "MSR-2026-0002", "total": 40, "personnel_debt_status": "open",
    })
    wrong = _raises(lambda: _run(
        other, _emp(),
        [{"kind": "reimburse", "amount": 40, "account_id": "bank", "expense_id": "exo"}],
    ))
    assert wrong.status_code == 400 and "personele" in str(wrong.detail)

    closed = FakeDb()
    closed.bank_accounts.docs.append(_acc(current_balance=50000))
    closed.expenses.docs.append({
        "_id": "exc", "company_id": "c1", "employee_id": "e1",
        "total": 40, "personnel_debt_status": "closed", "paid_by_personnel": True,
    })
    done = _raises(lambda: _run(
        closed, _emp(),
        [{"kind": "reimburse", "amount": 40, "account_id": "bank", "expense_id": "exc"}],
    ))
    assert done.status_code == 400 and "kapanmış" in str(done.detail)

    plain = FakeDb()
    plain.bank_accounts.docs.append(_acc(current_balance=50000))
    plain.expenses.docs.append({
        "_id": "exp", "company_id": "c1", "employee_id": "e1",
        "expense_number": "MSR-2026-0040", "total": 40, "payment_status": "unpaid",
    })
    _run(
        plain, _emp(),
        [{"kind": "reimburse", "amount": 40, "account_id": "bank", "expense_id": "exp"}],
        balance={"remaining": 1000},
    )
    assert len(plain.expenses.docs) == 1
    assert plain.expenses.docs[0]["payment_status"] == "paid"
    assert plain.expenses.docs[0]["expense_number"] == "MSR-2026-0040"


def result_remaining_unchanged(db):
    return db.personnel_receipts.docs[0]["remaining_after"] == db.personnel_receipts.docs[0]["remaining_before"]


def test_reverse_reimburse_deletes_bank_exit_and_reopens_debt():
    db = FakeDb()
    _init_linked(db)
    db.bank_accounts.docs.append(_acc(current_balance=50000))
    db.expenses.docs.append({
        "_id": "ex1", "company_id": "c1", "employee_id": "e1",
        "expense_number": "MSR-2026-0007", "total": 250,
        "payment_status": "unpaid", "paid_by_personnel": True,
    })
    _run(
        db, _emp(),
        [{"kind": "reimburse", "amount": 250, "account_id": "bank", "expense_number": "MSR-2026-0007"}],
        balance={"remaining": 1000, "unpaid_payroll": 1000},
    )
    mov = db.personnel_movements.docs[0]
    assert db.expenses.docs[0]["personnel_debt_status"] == "closed"
    out = _reverse(db, mov, actor=_admin())
    assert out["status"] == "success"
    assert db.bank_transactions.docs == []
    assert db.bank_accounts.docs[0]["current_balance"] == 50000
    assert len(db.expenses.docs) == 1
    exp = db.expenses.docs[0]
    assert exp["expense_number"] == "MSR-2026-0007"
    assert exp["personnel_debt_status"] in (None, "")
    assert exp.get("reimburse_movement_id") in (None, "")
    assert exp["payment_status"] == "unpaid"
    assert db.personnel_movements.docs[0]["status"] == "reversed"
    hidden = personnel_payments.reimbursement_rows(db.personnel_movements.docs)
    assert hidden == []


def test_expense_refund_does_not_close_personnel_debt():
    db = FakeDb()
    db.bank_accounts.docs.append(_acc(current_balance=50000))
    db.expenses.docs.append({
        "_id": "ex1", "company_id": "c1", "employee_id": "e1",
        "total": 200, "payment_status": "unpaid", "paid_by_personnel": True,
        "personnel_debt_status": "open",
    })
    _run(
        db, _emp(),
        [{"kind": "expense", "amount": 200, "account_id": "bank"}],
        balance={"remaining": 0, "unpaid_payroll": 0, "unpaid_expenses": 0},
    )
    exp = db.expenses.docs[0]
    assert exp["payment_status"] == "unpaid"
    assert exp["personnel_debt_status"] == "open"
    assert db.bonus_payments.docs and db.bonus_payments.docs[0]["type"] == "advance"


def test_personnel_paid_expense_is_outside_receivable_and_same_rbac():
    assert employee_pay.expense_counts_in_receivable({"payment_status": "unpaid", "total": 10}) is True
    assert employee_pay.expense_counts_in_receivable({"payment_status": "paid", "total": 10}) is False
    assert employee_pay.expense_counts_in_receivable({"payment_status": "unpaid", "paid_by_personnel": True}) is False
    assert employee_pay.personnel_debt_open({"notes": "Personel tarafından ödendi"}) is True
    assert employee_pay.personnel_debt_open({"personnel_debt_status": "closed", "paid_by_personnel": True}) is False
    assert employee_pay.payment_lines_affecting_balance([
        {"kind": "salary", "amount": 10},
        {"kind": "reimburse", "amount": 5},
    ]) == [{"kind": "salary", "amount": 10}]
    settle = rbac.module_for_path("/api/personnel/employees/e1/settle")
    move = rbac.module_for_path("/api/personnel/movements/mov1")
    assert settle == "/personnel"
    assert move == settle
    assert rbac.personnel_expense_forbidden(
        {"role": "muhasebe", "permissions": {"/personnel": "edit", "/expenses": "view"}},
    ) == rbac.PERSONNEL_EXPENSE_PERM_MSG
    assert rbac.personnel_expense_forbidden(
        {"role": "admin", "permissions": {"/personnel": "view", "/expenses": "view"}},
    ) is None
    assert rbac.personnel_expense_forbidden(
        {"role": "muhasebe", "permissions": {"/personnel": "edit", "/expenses": "edit"}},
    ) is None


def test_reimburse_charge_off_does_not_write_personnel_account():
    db = FakeDb()
    db.bank_accounts.docs.append(_acc(current_balance=50000))
    result = _run(
        db, _emp(),
        [{"kind": "reimburse", "amount": 400, "account_id": "bank", "category": "Kira", "charge_to_account": False}],
        balance={"remaining": 9000, "unpaid_payroll": 9000},
    )
    assert result["remaining_after"] == 9000
    assert result["overpaid"] is False
    assert [b.get("type") for b in db.bonus_payments.docs] == []
    assert db.expenses.docs[0]["category"] == "Kira"
    assert db.expenses.docs[0]["employee_id"] == "e1"
    assert db.personnel_movements.docs[0]["charge_to_account"] is False


def test_reimburse_charge_debt_writes_borc():
    db = FakeDb()
    db.bank_accounts.docs.append(_acc(current_balance=50000))
    result = _run(
        db, _emp(),
        [{
            "kind": "reimburse", "amount": 600, "account_id": "bank", "category": "İnternet / Telefon",
            "charge_to_account": True, "account_effect": "debt",
        }],
        balance={"remaining": 9000, "unpaid_payroll": 9000},
    )
    assert result["remaining_after"] == 8400
    assert db.bonus_payments.docs[0]["type"] == "borc"
    assert db.bonus_payments.docs[0]["amount"] == 600
    assert db.bonus_payments.docs[0]["type_label"] == personnel_payments.DEBT_LABEL
    figures = employee_pay.period_figures(
        _emp(), [], db.bonus_payments.docs, "2026-10",
        unpaid_payroll=9000, extra_advance=600,
    )
    assert figures["deductions"] == 600


def test_reimburse_charge_entitlement_writes_bakiye():
    db = FakeDb()
    db.bank_accounts.docs.append(_acc(current_balance=50000))
    result = _run(
        db, _emp(),
        [{
            "kind": "reimburse", "amount": 350, "account_id": "bank",
            "charge_to_account": True, "account_effect": "entitlement",
        }],
        balance={"remaining": 2000, "unpaid_payroll": 2000},
    )
    assert result["remaining_after"] == 1650
    assert db.bonus_payments.docs[0]["type"] == "bakiye"
    assert db.bonus_payments.docs[0]["type_label"] == personnel_payments.ENTITLEMENT_LABEL
    remaining = employee_pay.compose_remaining(unpaid_payroll=2000, bakiye_paid=350)
    assert remaining == 1650


def test_reimburse_empty_amount_is_not_overpay():
    preview = employee_pay.payment_after(-1200, employee_pay.payment_lines_affecting_balance([
        {"kind": "reimburse", "amount": 0},
        {"kind": "reimburse", "amount": "", "charge_to_account": False},
    ]))
    assert preview["overpaid"] is False
    assert preview["message"] is None
    charged = employee_pay.payment_after(100, employee_pay.payment_lines_affecting_balance([
        {"kind": "reimburse", "amount": 250, "charge_to_account": True},
    ]))
    assert charged["overpaid"] is True


def test_reimburse_forbidden_without_expense_edit():
    db = FakeDb()
    db.bank_accounts.docs.append(_acc(current_balance=50000))
    actor = {"role": "muhasebe", "permissions": {"/personnel": "edit", "/expenses": "view"}}
    exc = _raises(lambda: asyncio.run(personnel_payments.apply_payment_lines(
        db, _emp(), {},
        {"lines": [{"kind": "reimburse", "amount": 80, "account_id": "bank"}], "_actor": actor},
        balance={"remaining": 0}, pay_date="2026-10-13", period="2026-10",
    )))
    assert exc.status_code == 403
    assert "yetki" in str(exc.detail).lower()
    assert db.expenses.docs == []
    assert db.bank_accounts.docs[0]["current_balance"] == 50000


def test_reimburse_recurring_is_idempotent_for_same_month():
    db = FakeDb()
    db.bank_accounts.docs.append(_acc(current_balance=50000))
    _run(
        db, _emp(),
        [{
            "kind": "reimburse", "amount": 220, "account_id": "bank", "category": "Kira",
            "recurring": True, "recurring_day": 5, "charge_to_account": True, "account_effect": "debt",
        }],
        balance={"remaining": 5000, "unpaid_payroll": 5000},
        date="2026-10-05",
    )
    templates = [e for e in db.expenses.docs if e.get("is_recurring")]
    assert len(templates) == 1
    tpl = templates[0]
    assert tpl["recurrence_day"] == 5
    assert tpl["source"] == "personnel_reimburse_recurring"
    first_paid = [e for e in db.expenses.docs if e.get("payment_status") == "paid"]
    assert len(first_paid) == 1
    assert first_paid[0].get("recurring_parent_id") == tpl["_id"]
    again = asyncio.run(personnel_payments.spawn_recurring_reimburse(db, tpl, "2026-10-05"))
    assert again["reason"] == "already"
    assert len([e for e in db.expenses.docs if e.get("payment_status") == "paid"]) == 1
    spawned = asyncio.run(personnel_payments.spawn_recurring_reimburse(db, tpl, "2026-11-05"))
    assert spawned["status"] == "success"
    paid = [e for e in db.expenses.docs if e.get("payment_status") == "paid"]
    assert len(paid) == 2
    assert all(e.get("recurring_parent_id") == tpl["_id"] for e in paid)
    assert len([b for b in db.bonus_payments.docs if b.get("type") == "borc"]) == 2


def test_reverse_created_reimburse_removes_expense_and_charge():
    db = FakeDb()
    _init_linked(db)
    db.bank_accounts.docs.append(_acc(current_balance=50000))
    _run(
        db, _emp(),
        [{
            "kind": "reimburse", "amount": 180, "account_id": "bank",
            "charge_to_account": True, "account_effect": "debt",
        }],
        balance={"remaining": 1000, "unpaid_payroll": 1000},
    )
    mov = db.personnel_movements.docs[0]
    assert db.expenses.docs and db.bonus_payments.docs
    out = _reverse(db, mov, actor=_admin())
    assert out["status"] == "success"
    assert db.bank_accounts.docs[0]["current_balance"] == 50000
    leftover = [e for e in db.expenses.docs if e.get("source") != "personnel_reimburse_recurring"]
    assert leftover == []
    assert db.bonus_payments.docs == []


def test_delete_recurring_template_keeps_history():
    db = FakeDb()
    db.bank_accounts.docs.append(_acc(current_balance=50000))
    _run(
        db, _emp(),
        [{"kind": "reimburse", "amount": 90, "account_id": "bank", "recurring": True, "recurring_day": 1}],
        date="2026-10-01",
    )
    tpl = next(e for e in db.expenses.docs if e.get("is_recurring"))
    paid = [e for e in db.expenses.docs if e.get("payment_status") == "paid"]
    asyncio.run(personnel_payments.spawn_recurring_reimburse(db, tpl, "2026-11-01"))
    asyncio.run(db.expenses.delete_one({"_id": tpl["_id"]}))
    history = [e for e in db.expenses.docs if e.get("payment_status") == "paid"]
    assert len(history) >= 2
    assert all(e["_id"] != tpl["_id"] for e in history)
    assert paid[0]["_id"] in {e["_id"] for e in history}


def _trash_employee(db, emp, bonuses):
    import trash
    related = [{"collection": "bonus_payments", "docs": bonuses}] if bonuses else None
    return asyncio.run(trash.soft_delete(
        "employees", emp, "employee", emp.get("full_name") or emp["_id"], related=related,
    ))


def test_paid_or_linked_bonus_blocks_employee_delete_without_money_change():
    import trash
    db = FakeDb()
    _init_linked(db)
    trash.init(db)
    emp = _emp()
    db.employees.docs.append(emp)
    db.bank_accounts.docs.append(_acc(current_balance=4800))
    db.bonus_payments.docs.extend([
        {
            "_id": "b_paid", "company_id": "c1", "employee_id": "e1", "employee_name": "Ali",
            "type": "bonus", "status": "paid", "amount": 200, "account_id": "bank",
        },
        {
            "_id": "b_open", "company_id": "c1", "employee_id": "e1", "employee_name": "Ali",
            "type": "bonus", "status": "pending", "amount": 40,
        },
    ])
    db.bank_transactions.docs.append({
        "_id": "tx1", "company_id": "c1", "account_id": "bank", "type": "outflow",
        "amount": 200, **linked_moves.link_fields("personnel_bonus", "b_paid"),
    })
    db.payrolls.docs.append({
        "_id": "p1", "company_id": "c1", "employee_id": "e1", "status": "pending", "final_payable": 1000,
    })
    exc = _raises(lambda: asyncio.run(personnel_payments.delete_employee_bonuses(db, emp)))
    assert exc.status_code == 409
    assert exc.detail == "Ödenmiş/hareketli primler var, önce onları yönetin"
    assert {b["_id"] for b in db.bonus_payments.docs} == {"b_paid", "b_open"}
    assert db.employees.docs[0]["_id"] == "e1"
    assert db.bank_transactions.docs[0]["_id"] == "tx1"
    assert db.bank_accounts.docs[0]["current_balance"] == 4800
    assert db.payrolls.docs[0]["_id"] == "p1"
    assert db.trash.docs == []

    db.bonus_payments.docs[:] = [{
        "_id": "b_move", "company_id": "c1", "employee_id": "e1", "status": "pending", "amount": 15,
    }]
    db.partner_transactions.docs.append({
        "_id": "pt1", "company_id": "c1", "partner_id": "p1", "type": "withdrawal", "amount": 15,
        **linked_moves.link_fields("personnel_bonus", "b_move"),
    })
    exc2 = _raises(lambda: asyncio.run(personnel_payments.delete_employee_bonuses(db, emp)))
    assert exc2.status_code == 409
    assert db.partner_transactions.docs[0]["_id"] == "pt1"
    assert db.bonus_payments.docs[0]["_id"] == "b_move"
    assert db.trash.docs == []


def test_unpaid_bonus_follows_employee_to_trash_and_restores():
    import trash
    db = FakeDb()
    _init_linked(db)
    trash.init(db)
    emp = _emp()
    db.employees.docs.append(dict(emp))
    db.bonus_payments.docs.extend([
        {
            "_id": "b_pending", "company_id": "c1", "employee_id": "e1", "employee_name": "Ali",
            "type": "bonus", "status": "pending", "amount": 80,
        },
        {
            "_id": "b_other", "company_id": "c2", "employee_id": "e1", "type": "bonus",
            "status": "pending", "amount": 50,
        },
    ])
    db.payrolls.docs.append({
        "_id": "p1", "company_id": "c1", "employee_id": "e1", "status": "pending", "final_payable": 1000,
    })
    bonuses = asyncio.run(personnel_payments.delete_employee_bonuses(db, emp))
    assert [b["_id"] for b in bonuses] == ["b_pending"]
    assert {b["_id"] for b in db.bonus_payments.docs} == {"b_pending", "b_other"}
    _trash_employee(db, emp, bonuses)
    assert [b["_id"] for b in db.bonus_payments.docs] == ["b_other"]
    assert db.employees.docs == []
    assert db.payrolls.docs[0]["_id"] == "p1"
    rec = db.trash.docs[0]
    assert rec["entity_type"] == "employee"
    assert rec["doc"]["_id"] == "e1"
    related = rec["related"]
    assert related[0]["collection"] == "bonus_payments"
    assert related[0]["docs"][0]["_id"] == "b_pending"
    user = {"is_super_admin": True, "company_ids": ["c1"], "active_company_id": "c1"}
    out = asyncio.run(trash.restore_trash_item(rec["_id"], user=user))
    assert out["status"] == "success"
    assert db.employees.docs[0]["_id"] == "e1"
    assert {b["_id"] for b in db.bonus_payments.docs} == {"b_pending", "b_other"}
    assert db.trash.docs == []


def test_receipt_no_increments_per_company_and_stays_isolated():
    db = FakeDb()
    db.bank_accounts.docs.append(_acc())
    db.bank_accounts.docs.append(_acc("bank-b", company_id="c2", account_name="Diğer", current_balance=8000))
    bal = {"remaining": 1000, "unpaid_payroll": 1000, "meal_due": 0, "transport_due": 0}
    line = [{"kind": "salary", "amount": 100, "account_id": "bank"}]
    first = _run(db, _emp(), line, key="pay-a", balance=bal)
    second = _run(db, _emp(), line, key="pay-b", balance=bal)
    other = _run(
        db, _emp(company_id="c2", _id="e2"),
        [{"kind": "salary", "amount": 100, "account_id": "bank-b"}],
        key="pay-c", balance=bal,
    )
    replay = _run(db, _emp(), line, key="pay-a", balance=bal)
    assert first["receipt_no"] == "PM-2026-0001"
    assert second["receipt_no"] == "PM-2026-0002"
    assert other["receipt_no"] == "PM-2026-0001"
    assert replay["receipt_no"] == first["receipt_no"]
    assert replay["receipt_id"] == first["receipt_id"]
    assert [d["receipt_no"] for d in db.personnel_receipts.docs] == [
        "PM-2026-0001", "PM-2026-0002", "PM-2026-0001",
    ]
    assert {d["_id"] for d in db.counters.docs} == {"PM-2026-c1", "PM-2026-c2"}
    own = next(d for d in db.counters.docs if d["_id"] == "PM-2026-c1")
    other_counter = next(d for d in db.counters.docs if d["_id"] == "PM-2026-c2")
    assert int(own["seq"]) == 2
    assert int(other_counter["seq"]) == 1
    assert db.personnel_receipts.docs[0]["company_id"] == "c1"
    assert db.personnel_receipts.docs[2]["company_id"] == "c2"


def test_blank_company_skips_receipt_counter_and_keeps_rcpt_id():
    db = FakeDb()
    db.bank_accounts.docs.append(_acc(company_id=""))
    emp = _emp(company_id="")
    result = _run(
        db, emp, [{"kind": "salary", "amount": 100, "account_id": "bank"}],
        balance={"remaining": 1000, "unpaid_payroll": 1000},
    )
    assert str(result["receipt_id"]).startswith("rcpt_")
    assert result["receipt_no"] == result["receipt_id"]
    assert "receipt_no" not in db.personnel_receipts.docs[0]
    assert "counters" not in db._cols
