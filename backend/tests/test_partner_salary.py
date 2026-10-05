"""Ortak aylık maaş — alacağa yazma, aynı ay tekrar etmez."""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import partner_pay  # noqa: E402


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

    async def update_one(self, q, update):
        d = await self.find_one(q)
        if not d:
            return
        for k, v in (update.get("$inc") or {}).items():
            d[k] = float(d.get(k) or 0) + float(v)
        d.update(update.get("$set") or {})


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, n):
        return list(self.rows[:n])


class FakeDb:
    def __init__(self):
        self.partners = FakeCollection()
        self.partner_transactions = FakeCollection()


def _partner(pid="p1", salary=10000, active=True, company="comp1"):
    return {
        "_id": pid,
        "company_id": company,
        "name": "Ali BAL",
        "monthly_salary": salary,
        "is_active": active,
        "balance": 0,
        "total_capital_in": 0,
        "total_withdrawn": 0,
    }


def test_salary_period_label():
    assert partner_pay.salary_period_label("2026-10") == "Ekim 2026"
    assert partner_pay.normalize_period("2026-10-05") == "2026-10"


def test_accrue_writes_receivable_once():
    db = FakeDb()
    db.partners.docs.append(_partner())
    r1 = asyncio.run(partner_pay.accrue_monthly_salaries(db, "comp1", period="2026-10"))
    assert r1["posted_count"] == 1
    assert r1["posted"][0]["amount"] == 10000
    assert db.partners.docs[0]["balance"] == 10000
    tx = db.partner_transactions.docs[0]
    assert tx["type"] == "salary" and tx["salary_period"] == "2026-10"
    assert "Ekim 2026" in tx["description"]
    r2 = asyncio.run(partner_pay.accrue_monthly_salaries(db, "comp1", period="2026-10"))
    assert r2["posted_count"] == 0
    assert len(db.partner_transactions.docs) == 1
    assert db.partners.docs[0]["balance"] == 10000


def test_accrue_skips_zero_and_inactive():
    db = FakeDb()
    db.partners.docs.append(_partner("p0", salary=0))
    db.partners.docs.append(_partner("p2", salary=5000, active=False))
    r = asyncio.run(partner_pay.accrue_monthly_salaries(db, "comp1", period="2026-10"))
    assert r["posted_count"] == 0
    assert {s["reason"] for s in r["skipped"]} == {"no_salary", "inactive"}


def test_accrue_other_month_is_separate():
    db = FakeDb()
    db.partners.docs.append(_partner())
    asyncio.run(partner_pay.accrue_monthly_salaries(db, "comp1", period="2026-10"))
    r = asyncio.run(partner_pay.accrue_monthly_salaries(db, "comp1", period="2026-11"))
    assert r["posted_count"] == 1
    assert db.partners.docs[0]["balance"] == 20000
    assert {t["salary_period"] for t in db.partner_transactions.docs} == {"2026-10", "2026-11"}
