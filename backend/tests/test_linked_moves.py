"""Linked movement cleanup: link fields, reverse, guards, integrity, restore."""
import asyncio
import os
import re
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import linked_moves  # noqa: E402
import partner_pay  # noqa: E402


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *a, **k):
        return self

    async def to_list(self, n):
        return [dict(x) for x in self.rows[:n]]


class FakeCollection:
    def __init__(self):
        self.docs = []

    def _match(self, d, q):
        if not q:
            return True
        if "$or" in q:
            return any(self._match(d, clause) for clause in q["$or"])
        if "$and" in q:
            return all(self._match(d, clause) for clause in q["$and"])
        for k, v in q.items():
            if isinstance(v, dict):
                if "$exists" in v:
                    exists = k in d and d[k] is not None
                    want = bool(v["$exists"])
                    if exists != want:
                        return False
                    if "$nin" in v and d.get(k) in v["$nin"]:
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
        d = next((x for x in self.docs if self._match(x, q)), None)
        return dict(d) if d else None

    def find(self, q=None, projection=None):
        return FakeCursor([d for d in self.docs if self._match(d, q)])

    async def insert_one(self, doc):
        self.docs.append(dict(doc))

    async def update_one(self, q, upd):
        d = next((x for x in self.docs if self._match(x, q)), None)
        if not d:
            return
        if "$set" in upd:
            d.update(upd["$set"])
        if "$inc" in upd:
            for k, v in upd["$inc"].items():
                d[k] = float(d.get(k) or 0) + float(v)
        if "$unset" in upd:
            for k in upd["$unset"]:
                d.pop(k, None)

    async def delete_one(self, q):
        before = len(self.docs)
        self.docs[:] = [d for d in self.docs if not self._match(d, q)]
        return MagicMock(deleted_count=before - len(self.docs))

    async def delete_many(self, q):
        before = len(self.docs)
        self.docs[:] = [d for d in self.docs if not self._match(d, q)]
        return MagicMock(deleted_count=before - len(self.docs))

    async def count_documents(self, q=None):
        return len([d for d in self.docs if self._match(d, q)])


class FakeDb:
    def __init__(self):
        names = [
            "bank_accounts", "bank_transactions", "partners", "partner_transactions",
            "bonus_payments", "payrolls", "loans", "installments", "expenses",
            "contacts", "companies", "activity_logs", "trash", "products", "stock_movements",
            "invoices",
        ]
        for n in names:
            setattr(self, n, FakeCollection())

    def __getitem__(self, name):
        if not hasattr(self, name):
            setattr(self, name, FakeCollection())
        return getattr(self, name)


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture
def db():
    fake = FakeDb()
    fake.companies.docs.append({"_id": "c1", "name": "Demo"})
    fake.bank_accounts.docs.append({
        "_id": "acc1", "company_id": "c1", "account_name": "Kasa",
        "type": "cash_box", "current_balance": 1000.0,
    })
    fake.partners.docs.append({
        "_id": "p1", "company_id": "c1", "name": "Ortak", "balance": 500.0, "total_withdrawn": 0,
    })

    async def reverse_tx(tx, sign=-1):
        amt = float(tx.get("amount") or 0) * sign
        change = amt if tx.get("type") == "inflow" else -amt
        if tx.get("account_id"):
            await fake.bank_accounts.update_one({"_id": tx["account_id"]}, {"$inc": {"current_balance": change}})
        if tx.get("contact_id"):
            await fake.contacts.update_one({"_id": tx["contact_id"]}, {"$inc": {"balance": -change}})

    linked_moves.init(fake, reverse_tx_fn=reverse_tx)
    return fake


def test_link_fields_specialty():
    f = linked_moves.link_fields("personnel_bonus", "b1")
    assert f["bonus_id"] == "b1" and f["source_type"] == "personnel_bonus" and f["source"] == "personnel_bonus"
    f2 = linked_moves.link_fields("payroll", "pay1")
    assert f2["payroll_id"] == "pay1" and f2["source"] == "payroll"
    f3 = linked_moves.link_fields("loan", "L1")
    assert f3["loan_id"] == "L1"
    f4 = linked_moves.link_fields("installment", "i1")
    assert f4["installment_id"] == "i1"


def test_source_guard_blocks_linked_tx():
    with pytest.raises(Exception) as ei:
        linked_moves.assert_not_source_linked({"bonus_id": "b1", "amount": 10})
    assert ei.value.status_code == 400
    assert "Kaynak kayıttan geri alın" in str(ei.value.detail)
    with pytest.raises(Exception) as ei2:
        linked_moves.assert_not_source_linked({"payroll_id": "p1"})
    assert ei2.value.status_code == 400
    linked_moves.assert_not_source_linked({"amount": 5, "source": "manual"})  # no raise


def test_bonus_pay_delete_clears_move_and_balance(db):
    bid = "bonus1"
    link = linked_moves.link_fields("personnel_bonus", bid)
    db.bonus_payments.docs.append({
        "_id": bid, "company_id": "c1", "status": "paid", "amount": 100,
        "account_id": "acc1", "employee_name": "Ali", "type": "bonus",
    })
    db.bank_transactions.docs.append({
        "_id": "open1", "company_id": "c1", "account_id": "acc1", "type": "inflow",
        "amount": 1000, "source": "opening", "description": "Açılış",
    })
    db.bank_transactions.docs.append({
        "_id": "tx1", "company_id": "c1", "account_id": "acc1", "type": "outflow",
        "amount": 100, "description": "Ali prim", **link,
    })
    db.bank_accounts.docs[0]["current_balance"] = 900.0

    related = _run(linked_moves.prepare_source_trash(db, "personnel_bonus", bid))
    assert related and related[0]["collection"] == "bank_transactions"
    # soft_delete simulation then recalc (production order)
    for block in related:
        for d in block["docs"]:
            _run(db[block["collection"]].delete_one({"_id": d["_id"]}))
    _run(linked_moves.recalc_after_trash(db, related))
    assert not any(t.get("bonus_id") == bid for t in db.bank_transactions.docs)
    assert db.bank_accounts.docs[0]["current_balance"] == pytest.approx(1000.0, abs=0.01)

    # restore: re-insert related then apply effects
    for block in related:
        for d in block["docs"]:
            _run(db[block["collection"]].insert_one(d))
    _run(linked_moves.restore_linked_from_related(db, related))
    assert db.bank_accounts.docs[0]["current_balance"] == pytest.approx(900.0, abs=0.01)


def test_payroll_same_pattern(db):
    pid = "pay1"
    link = linked_moves.link_fields("payroll", pid)
    db.payrolls.docs.append({"_id": pid, "company_id": "c1", "status": "paid", "final_payable": 50, "account_id": "acc1"})
    db.bank_transactions.docs.append({
        "_id": "open1", "company_id": "c1", "account_id": "acc1", "type": "inflow",
        "amount": 1000, "source": "opening", "description": "Açılış",
    })
    db.bank_transactions.docs.append({
        "_id": "txp", "company_id": "c1", "account_id": "acc1", "type": "outflow", "amount": 50, **link,
    })
    db.bank_accounts.docs[0]["current_balance"] = 950.0
    related = _run(linked_moves.prepare_source_trash(db, "payroll", pid))
    for block in related:
        for d in block["docs"]:
            _run(db[block["collection"]].delete_one({"_id": d["_id"]}))
    _run(linked_moves.recalc_after_trash(db, related))
    assert db.bank_accounts.docs[0]["current_balance"] == pytest.approx(1000.0, abs=0.01)


def test_loan_and_installment_delete_reverses_all(db):
    lid = "loan1"
    link = linked_moves.link_fields("loan", lid)
    db.loans.docs.append({"_id": lid, "company_id": "c1", "name": "Kredi", "principal": 1000})
    db.bank_transactions.docs.append({
        "_id": "tx_in", "company_id": "c1", "account_id": "acc1", "type": "inflow",
        "amount": 1000, **link,
    })
    db.bank_transactions.docs.append({
        "_id": "tx_out", "company_id": "c1", "account_id": "acc1", "type": "outflow",
        "amount": 200, **link, "installment_no": 1,
    })
    db.expenses.docs.append({"_id": "e1", "company_id": "c1", "loan_id": lid, "amount": 30, "total": 30})
    db.bank_accounts.docs[0]["current_balance"] = 1800.0  # +1000 -200
    related = _run(linked_moves.prepare_source_trash(db, "loan", lid))
    assert len(related) >= 2  # bank + expenses
    bank_n = sum(len(b["docs"]) for b in related if b["collection"] == "bank_transactions")
    assert bank_n == 2
    for block in related:
        for d in block["docs"]:
            _run(db[block["collection"]].delete_one({"_id": d["_id"]}))
    assert not any(t.get("loan_id") == lid for t in db.bank_transactions.docs)
    assert not any(e.get("loan_id") == lid for e in db.expenses.docs)


def test_installment_unpay_via_reverse_linked(db):
    iid = "inst1"
    link = linked_moves.link_fields("installment", iid)
    db.contacts.docs.append({"_id": "cnt1", "company_id": "c1", "balance": 0})
    db.installments.docs.append({
        "_id": iid, "company_id": "c1", "status": "paid", "paid_amount": 75,
        "amount": 75, "contact_id": "cnt1", "direction": "receivable",
    })
    # Açılış hareketi — kasa sync hareket toplamına kilitler
    db.bank_transactions.docs.append({
        "_id": "open1", "company_id": "c1", "account_id": "acc1", "type": "inflow",
        "amount": 1000, "source": "opening", "description": "Açılış",
    })
    db.bank_transactions.docs.append({
        "_id": "txi", "company_id": "c1", "account_id": "acc1", "type": "inflow",
        "amount": 75, "contact_id": "cnt1", **link,
    })
    db.bank_accounts.docs[0]["current_balance"] = 1075.0
    db.contacts.docs[0]["balance"] = -75.0

    async def _sd(coll, doc, *a, **k):
        await db[coll].delete_one({"_id": doc["_id"]})
        return "tid"

    with patch.object(linked_moves.trash, "soft_delete", new=AsyncMock(side_effect=_sd)):
        rev = _run(linked_moves.reverse_linked(db, "installment", iid, mode="delete", reason="unpay"))
    assert rev["bank"] == 1
    assert db.bank_accounts.docs[0]["current_balance"] == pytest.approx(1000.0, abs=0.01)
    assert not any(t.get("installment_id") == iid for t in db.bank_transactions.docs)


def test_reverse_linked_idempotent(db):
    r1 = _run(linked_moves.reverse_linked(db, "personnel_bonus", "missing", mode="delete"))
    assert r1["idempotent"] is True and r1["reversed"] == 0
    r2 = _run(linked_moves.reverse_linked(db, "personnel_bonus", "missing", mode="delete"))
    assert r2["idempotent"] is True


def test_integrity_orphans_and_dry_run(db):
    # orphan move: bonus_id set but bonus gone
    db.bank_transactions.docs.append({
        "_id": "orphan1", "company_id": "c1", "account_id": "acc1", "type": "outflow",
        "amount": 40, "bonus_id": "gone", "description": "ghost",
    })
    # paid bonus without move + heuristic candidate
    db.bonus_payments.docs.append({
        "_id": "b_old", "company_id": "c1", "status": "paid", "amount": 55,
        "account_id": "acc1", "employee_name": "Zeynep", "period": "2026-01", "type_label": "Prim",
    })
    db.bank_transactions.docs.append({
        "_id": "legacy", "company_id": "c1", "account_id": "acc1", "type": "outflow",
        "amount": 55, "description": "Zeynep - 2026-01 Prim", "category": "Personel Prim",
    })
    # drift
    db.bank_accounts.docs[0]["current_balance"] = 9999.0

    report = _run(linked_moves.scan_orphans(db, "c1"))
    assert report["summary"]["orphan_moves"] >= 1
    assert report["paid_bonus_without_moves"]
    assert report["heuristic_bonus_links"]
    assert report["cash_balance_drift"]

    before_tx = len(db.bank_transactions.docs)
    before_bal = db.bank_accounts.docs[0]["current_balance"]
    dry = _run(linked_moves.cleanup_orphans(db, "c1", dry_run=True))
    assert dry["dry_run"] is True
    assert len(db.bank_transactions.docs) == before_tx
    assert db.bank_accounts.docs[0]["current_balance"] == before_bal

    async def _sd(coll, doc, *a, **k):
        await db[coll].delete_one({"_id": doc["_id"]})
        return "t"

    with patch.object(linked_moves.trash, "soft_delete", new=AsyncMock(side_effect=_sd)):
        applied = _run(linked_moves.cleanup_orphans(db, "c1", dry_run=False, actor={"name": "test"}))
    assert applied["dry_run"] is False
    assert db.activity_logs.docs, "cleanup should write activity_logs audit"
    # cash drift synced to movement sum
    assert db.bank_accounts.docs[0]["current_balance"] != pytest.approx(9999.0)


def test_integrity_other_company_403(db):
    user = {"role": "admin", "company_ids": ["c1"], "active_company_id": "c1"}
    with pytest.raises(Exception) as ei:
        linked_moves._require_integrity_access(user, "other_co")
    assert ei.value.status_code in (403, 404)
    sa = {"is_super_admin": True}
    linked_moves._require_integrity_access(sa, "other_co")  # ok


def test_stock_count_reverse(db):
    db.products.docs.append({"_id": "prod1", "stock_quantity": 10})
    sc = {
        "_id": "sc1", "status": "completed", "applied": True, "name": "Sayım",
        "items": [{"product_id": "prod1", "product_name": "X", "expected": 8, "counted": 10}],
    }
    n = _run(linked_moves.reverse_applied_stock_count(db, sc))
    assert n == 1
    assert db.products.docs[0]["stock_quantity"] == pytest.approx(8.0)
    assert db.stock_movements.docs and db.stock_movements.docs[0]["change"] == pytest.approx(-2.0)


def test_heuristic_bonus_match_score():
    bonus = {"amount": 100, "account_id": "a1", "employee_name": "Ali Veli", "period": "2026-03", "type_label": "Avans"}
    tx = {"amount": 100, "account_id": "a1", "description": "Ali Veli - 2026-03 Avans", "category": "Personel Avans"}
    ok, conf = linked_moves._heuristic_bonus_match(bonus, tx)
    assert ok and conf >= 0.55
    bad = {"amount": 99, "account_id": "a1", "description": "x", "category": "Diğer"}
    ok2, _ = linked_moves._heuristic_bonus_match(bonus, bad)
    assert not ok2
