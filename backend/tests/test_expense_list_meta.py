"""Masraf listesi: hızlı özet sorgusu + created_by / paid_by aktör alanları."""
import asyncio
import os
import sys
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import expenses  # noqa: E402


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_actor_name_prefers_created_then_paid():
    assert expenses._actor_name({"created_by_name": "Ayşe", "paid_by_name": "Ali"}, "created_by_name", "paid_by_name") == "Ayşe"
    assert expenses._actor_name({"paid_by_name": " Ali "}, "paid_by_name", "user_name") == "Ali"
    assert expenses._actor_name({"user_name": "Mehmet"}, "created_by_name", "paid_by_name", "user_name") == "Mehmet"
    assert expenses._actor_name({}) is None
    assert expenses._actor_name(None) is None
    long = "x" * 200
    assert len(expenses._actor_name({"created_by_name": long})) == 120


def test_try_total_uses_local_for_fx():
    assert expenses._try_total({"total": 100, "currency": "TRY"}) == 100.0
    assert expenses._try_total({"total": 10, "currency": "USD", "local_total": 340}) == 340.0


def test_list_expenses_skips_full_collection_scan_when_filtered():
    find_calls = []

    class Cursor:
        def __init__(self, rows):
            self._rows = rows

        def sort(self, *a, **k):
            return self

        async def to_list(self, n):
            return list(self._rows)

    def find(q, proj=None):
        find_calls.append((q, proj))
        if proj is not None:
            return Cursor([{"total": 50, "currency": "TRY", "date": "2026-10-01"}])
        return Cursor([{
            "_id": "e1",
            "company_id": "c1",
            "date": "2026-10-01",
            "category": "Diğer",
            "total": 50,
            "vat_amount": 0,
            "payment_status": "unpaid",
            "currency": "TRY",
            "notes": "test not",
            "created_by_name": "Ayşe",
        }])

    db = MagicMock()
    db.expenses.find = find
    db.expenses.count_documents = AsyncMock(return_value=2)
    expenses.init(db)
    out = _run(expenses.list_expenses(company_id="c1", date_from="2026-10-01", date_to="2026-10-31"))
    assert out["summary"]["this_month_count"] == 1
    assert out["summary"]["recurring_count"] == 2
    assert out["expenses"][0]["created_by_name"] == "Ayşe"
    full_scans = [c for c in find_calls if c[1] is None and set(c[0].keys()) == {"company_id"}]
    assert not full_scans
