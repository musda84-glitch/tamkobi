"""Personel operasyonel veri sıfırlama (onay + koleksiyon silme)."""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import employee_data_reset as edr  # noqa: E402


class FakeResult:
    def __init__(self, n):
        self.deleted_count = n
        self.modified_count = n


class FakeCollection:
    def __init__(self, docs=None):
        self.docs = list(docs or [])
        self.last_update = None

    def _match(self, d, q):
        for k, v in (q or {}).items():
            if d.get(k) != v:
                return False
        return True

    async def find_one(self, q=None, projection=None):
        return next((d for d in self.docs if self._match(d, q)), None)

    def find(self, q=None, projection=None):
        return FakeCursor([d for d in self.docs if self._match(d, q)])

    async def delete_many(self, q):
        before = len(self.docs)
        self.docs = [d for d in self.docs if not self._match(d, q)]
        return FakeResult(before - len(self.docs))

    async def update_one(self, q, upd):
        self.last_update = (q, upd)
        for d in self.docs:
            if self._match(d, q):
                if "$inc" in upd:
                    for k, v in upd["$inc"].items():
                        d[k] = (d.get(k) or 0) + v
                if "$unset" in upd:
                    for k in upd["$unset"]:
                        d.pop(k, None)
                if "$set" in upd:
                    d.update(upd["$set"])
                return FakeResult(1)
        return FakeResult(0)


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, n):
        return list(self.rows[:n])


class FakeDb:
    def __init__(self):
        self.payrolls = FakeCollection()
        self.bonus_payments = FakeCollection()
        self.expenses = FakeCollection()
        self.attendance = FakeCollection()
        self.employees = FakeCollection()
        self.bank_accounts = FakeCollection()
        self.bank_transactions = FakeCollection()


def test_confirm_required():
    db = FakeDb()
    try:
        asyncio.run(edr.reset_operational_data(db, {"_id": "e1"}, confirm=False))
        assert False, "expected ConfirmRequired"
    except edr.ConfirmRequired:
        pass
    assert edr.truthy_confirm(True) and edr.truthy_confirm("evet")
    assert not edr.truthy_confirm("") and not edr.truthy_confirm(None)


def test_reset_deletes_ops_keeps_employee():
    db = FakeDb()
    db.employees.docs.append({
        "_id": "e1", "full_name": "Ali", "location_last_inside": True, "location_inside_at": "t",
    })
    db.payrolls.docs.append({"_id": "p1", "employee_id": "e1", "status": "pending", "net_salary": 10})
    db.payrolls.docs.append({"_id": "p2", "employee_id": "other", "status": "pending"})
    db.bonus_payments.docs.append({"_id": "b1", "employee_id": "e1", "status": "paid", "amount": 5, "account_id": "acc1"})
    db.expenses.docs.append({"_id": "x1", "employee_id": "e1", "payment_status": "unpaid", "total": 3})
    db.attendance.docs.extend([
        {"_id": "a1", "employee_id": "e1", "date": "2026-10-01"},
        {"_id": "a2", "employee_id": "e1", "date": "2026-10-02"},
        {"_id": "a3", "employee_id": "other"},
    ])
    db.bank_accounts.docs.append({"_id": "acc1", "current_balance": 100})
    db.bank_transactions.docs.append({"_id": "t1", "bonus_id": "b1", "amount": 5})

    counts = asyncio.run(edr.reset_operational_data(db, db.employees.docs[0], confirm=True))
    assert counts == {"payrolls": 1, "bonuses": 1, "expenses": 1, "attendance": 2}
    assert [p["_id"] for p in db.payrolls.docs] == ["p2"]
    assert db.bonus_payments.docs == []
    assert db.expenses.docs == []
    assert [a["_id"] for a in db.attendance.docs] == ["a3"]
    emp = db.employees.docs[0]
    assert emp["_id"] == "e1"
    assert "location_last_inside" not in emp
    assert "location_inside_at" not in emp
    assert emp.get("updated_at")
    assert db.bank_accounts.docs[0]["current_balance"] == 105
    assert db.bank_transactions.docs == []
    msg = edr.reset_message(emp, counts)
    assert "Ali" in msg and "puantaj" in msg
    assert "Personel kartı" in edr.RESET_HINT
