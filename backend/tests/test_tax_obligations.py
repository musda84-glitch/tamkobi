import asyncio
import os
import sys
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import tax_obligations  # noqa: E402


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *a, **k):
        return self

    async def to_list(self, n):
        return list(self.rows[:n])


class FakeCollection:
    def __init__(self):
        self.docs = []

    def _match(self, d, q):
        return all(d.get(k) == v for k, v in (q or {}).items() if not isinstance(v, dict))

    async def find_one(self, q=None, projection=None):
        return next((d for d in self.docs if self._match(d, q)), None)

    def find(self, q=None, projection=None):
        return FakeCursor([d for d in self.docs if self._match(d, q)])

    async def insert_one(self, doc):
        self.docs.append(doc)

    async def update_one(self, q, upd):
        d = next((x for x in self.docs if self._match(x, q)), None)
        if not d:
            return
        if "$set" in upd:
            d.update(upd["$set"])
        if "$inc" in upd:
            for k, v in upd["$inc"].items():
                d[k] = (d.get(k) or 0) + v

    async def delete_one(self, q):
        self.docs[:] = [d for d in self.docs if not self._match(d, q)]


class FakeDb:
    def __init__(self):
        self.tax_documents = FakeCollection()
        self.tax_obligations = FakeCollection()
        self.bank_accounts = FakeCollection()
        self.bank_transactions = FakeCollection()
        self.bank_connections = FakeCollection()
        self.partners = FakeCollection()
        self.partner_transactions = FakeCollection()


def test_payroll_from_uploaded_bordro():
    docs = [{
        "source_kind": "bordro",
        "summary": {"count": 4, "gross": 180000, "net": 139634.4, "employer_cost": 211500},
    }]
    p = tax_obligations.payroll_from_documents(docs)
    assert p["count"] == 4 and p["gross"] == 180000 and p["source"] == "upload"
    assert tax_obligations.payroll_from_documents([]) is None


def test_month_summary_unpaid():
    s = tax_obligations.month_summary([
        {"amount": 100, "payment_status": "unpaid"},
        {"amount": 40, "payment_status": "paid"},
    ])
    assert s["unpaid_count"] == 1 and s["unpaid_total"] == 100 and s["paid_total"] == 40


def test_import_and_pay():
    db = FakeDb()
    tax_obligations.init(db)
    db.bank_accounts.docs.append({"_id": "acc1", "account_name": "Kasa", "current_balance": 100000})
    draft = {
        "source_kind": "bordro",
        "period": "2026-09",
        "title": "Bordro 2026-09",
        "filename": "matek bordro 2026-09.pdf",
        "summary": {"count": 4, "gross": 180000, "net": 139634.4, "employer_cost": 211500},
        "obligations": [
            {"kind": "sgk", "title": "SGK primi", "amount": 58500, "period": "2026-09", "due_date": "2026-10-26"},
            {"kind": "gelir_vergisi", "title": "Gelir vergisi", "amount": 12000, "period": "2026-09", "due_date": "2026-10-26"},
        ],
    }
    imported = asyncio.run(tax_obligations.import_tax_doc({"company_id": "c1", "draft": draft}))
    assert len(imported["obligations"]) == 2
    oid = imported["obligations"][0]["id"]
    with patch("tax_obligations.assert_manual_allowed", new_callable=AsyncMock):
        paid = asyncio.run(tax_obligations.pay_tax_obligation(oid, {"account_id": "acc1"}))
    assert paid["payment_status"] == "paid"
    assert db.bank_accounts.docs[0]["current_balance"] == 100000 - 58500
    assert db.bank_transactions.docs[0]["source"] == "tax_obligation"
