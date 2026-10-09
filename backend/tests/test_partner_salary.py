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


def _salaried(pid="p1", **kw):
    p = _partner(pid)
    salary = kw.pop("salary", None)
    if salary is not None:
        p["monthly_salary"] = salary
    p.update(kw)
    return p


def test_prepare_rejects_bad_entitlement_date():
    import pytest
    from fastapi import HTTPException
    with pytest.raises(HTTPException) as ei:
        partner_pay.prepare_partner_salary({"monthly_salary": 1, "salary_start_date": "2026-13-40"}, fill_start=False)
    assert ei.value.status_code == 400


def test_salary_due_clamps_end_of_month():
    assert partner_pay.salary_due_on("2026-02", 31).isoformat() == "2026-02-28"
    assert partner_pay.salary_due_on("2026-10", 5).isoformat() == "2026-10-05"
    assert partner_pay.parse_iso_date("2026-10-05").day == 5
    assert partner_pay.parse_iso_date("nope") is None


def test_accrue_uses_entitlement_date():
    db = FakeDb()
    db.partners.docs.append(_salaried(salary_start_date="2026-10-05", salary_day=5))
    r = asyncio.run(partner_pay.accrue_monthly_salaries(db, "comp1", period="2026-10"))
    assert r["posted_count"] == 1
    tx = db.partner_transactions.docs[0]
    assert tx["date"] == "2026-10-05"
    assert tx["salary_date"] == "2026-10-05"


def test_monthly_repeat_does_not_backfill_past_months():
    """Her ay tekrarla: Ocak→bugün aralığı açılmaz; yalnız as_of ayı (vadesi geldiyse)."""
    db = FakeDb()
    db.partners.docs.append(_salaried(salary_start_date="2026-01-11", salary_day=11, salary_recurring=True))
    r = asyncio.run(partner_pay.accrue_monthly_salaries(db, "comp1", as_of="2026-10-09"))
    # 9 Ekim < 11 Ekim → Ekim henüz değil; geçmiş aylar da yazılmaz
    assert r["posted_count"] == 0
    assert db.partner_transactions.docs == []
    r2 = asyncio.run(partner_pay.accrue_monthly_salaries(db, "comp1", as_of="2026-10-20"))
    assert r2["posted_count"] == 1
    assert db.partner_transactions.docs[0]["salary_period"] == "2026-10"
    assert db.partner_transactions.docs[0]["date"] == "2026-10-11"


def test_monthly_repeat_catchup_opt_in():
    db = FakeDb()
    db.partners.docs.append(_salaried(salary_start_date="2026-08-05", salary_day=5, salary_recurring=True))
    slots = partner_pay.salary_slots(
        db.partners.docs[0],
        partner_pay.parse_iso_date("2026-10-03"),
        catch_up=True,
    )
    assert {p for p, _ in slots} == {"2026-08", "2026-09"}


def test_non_recurring_posts_only_start_month():
    db = FakeDb()
    db.partners.docs.append(_salaried(salary_start_date="2026-10-05", salary_recurring=False))
    r = asyncio.run(partner_pay.accrue_monthly_salaries(db, "comp1", as_of="2026-12-20"))
    assert r["posted_count"] == 1
    assert db.partner_transactions.docs[0]["salary_period"] == "2026-10"


def test_future_entitlement_waits_until_due_date():
    db = FakeDb()
    db.partners.docs.append(_salaried(salary_start_date="2026-11-01", salary_day=1))
    r = asyncio.run(partner_pay.accrue_monthly_salaries(db, "comp1", as_of="2026-10-05"))
    assert r["posted_count"] == 0
    assert db.partner_transactions.docs == []
    assert r["scheduled_date"] == "2026-11-01"
    assert r["skipped"][0]["reason"] == "not_due"
    r2 = asyncio.run(partner_pay.accrue_monthly_salaries(db, "comp1", as_of="2026-11-01"))
    assert r2["posted_count"] == 1
    assert db.partner_transactions.docs[0]["date"] == "2026-11-01"
    assert db.partners.docs[0]["balance"] == 10000


def test_force_start_posts_future_entitlement():
    db = FakeDb()
    db.partners.docs.append(_salaried(salary_start_date="2026-12-15", salary_day=15))
    r = asyncio.run(partner_pay.accrue_monthly_salaries(db, "comp1", as_of="2026-10-05", force_start=True))
    assert r["posted_count"] == 1
    assert db.partner_transactions.docs[0]["date"] == "2026-12-15"
    r2 = asyncio.run(partner_pay.accrue_monthly_salaries(db, "comp1", as_of="2026-10-05"))
    assert r2["posted_count"] == 0


def test_scheduler_posts_due_across_companies():
    db = FakeDb()
    db.partners.docs.append(_salaried("a", company_id="c1", salary_start_date="2026-10-01"))
    db.partners.docs.append(_salaried("b", company_id="c2", salary=2500, salary_start_date="2026-10-01"))
    r = asyncio.run(partner_pay.accrue_due_for_all_companies(db, as_of="2026-10-05"))
    assert r["companies"] == 2
    assert r["posted_count"] == 2
