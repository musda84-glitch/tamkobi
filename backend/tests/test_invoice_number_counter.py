"""Fatura numarası: şirket + önek + yıl atomik sayaç."""
import asyncio
import copy
from datetime import datetime, timezone

import pytest

from invoice_numbers import SALES_INVOICE_PREFIX, format_sales_invoice_number, next_invoice_number
from models import Invoice
from mysql_store import apply_update, match_query, new_upsert_doc


def _run(coro):
    return asyncio.run(coro)


def _year() -> str:
    return datetime.now(timezone.utc).strftime("%Y")


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, n=None):
        if n is None:
            return list(self.rows)
        return list(self.rows[:n])


class _Coll:
    def __init__(self):
        self.docs = []

    async def find_one(self, query=None, projection=None):
        for doc in self.docs:
            if match_query(doc, query or {}):
                return copy.deepcopy(doc)
        return None

    def find(self, query=None, projection=None):
        rows = [copy.deepcopy(doc) for doc in self.docs if match_query(doc, query or {})]
        return _Cursor(rows)

    async def insert_one(self, doc):
        self.docs.append(copy.deepcopy(doc))

    async def update_one(self, query, update, upsert=False):
        for i, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                self.docs[i] = apply_update(doc, update, query)
                return
        if not upsert:
            return
        self.docs.append(new_upsert_doc(update, query))

    async def find_one_and_update(self, query, update, upsert=False, return_document=True, projection=None):
        for i, doc in enumerate(self.docs):
            if not match_query(doc, query or {}):
                continue
            before = copy.deepcopy(doc)
            self.docs[i] = apply_update(doc, update, query)
            found = self.docs[i] if return_document else before
            return copy.deepcopy(found)
        if not upsert:
            return None
        created = new_upsert_doc(update, query)
        self.docs.append(created)
        return copy.deepcopy(created) if return_document else None


class _Db:
    def __init__(self):
        self.invoices = _Coll()
        self.counters = _Coll()
        self.contacts = _Coll()
        self.products = _Coll()


def _inv(company_id, number, iid=None):
    return {
        "_id": iid or number,
        "company_id": company_id,
        "invoice_number": number,
    }


@pytest.fixture
def db():
    """Bellek içi db. Ortam değişkeni bu dosyada değiştirilmez."""
    return _Db()


def _invoice(**extra):
    data = dict(
        company_id="co",
        invoice_type="sales",
        contact_id="",
        contact_name="Cari",
    )
    data.update(extra)
    return Invoice(**data)


def test_empty_company_first_sales_number(db):
    year = _year()
    number = _run(next_invoice_number(db, "co-empty", SALES_INVOICE_PREFIX, year))
    assert number == f"TA{year}00000001"
    assert number == format_sales_invoice_number(1, year)
    assert db.counters.docs[0]["_id"] == f"INV-TA-{year}-co-empty"
    assert db.counters.docs[0]["seq"] == 1


def test_seed_uses_highest_numeric_and_purchase_is_separate(db):
    year = _year()
    prev = str(int(year) - 1)
    db.invoices.docs.extend([
        _inv("co", f"TA{year}00000007", "ta7"),
        _inv("co", f"TA{year}00000003", "ta3"),
        _inv("co", f"AL{year}00000020", "al20"),
        _inv("co", f"AL{year}00000004", "al4"),
        _inv("co", f"TA{prev}00000099", "old"),
        _inv("other", f"TA{year}00000050", "foreign"),
        _inv("co", f"TA{year}0007", "short"),
        _inv("co", f"IRS-{year}-0009", "dispatch"),
    ])
    before = copy.deepcopy(db.invoices.docs)
    sales = _run(next_invoice_number(db, "co", "TA", year))
    purchase = _run(next_invoice_number(db, "co", "AL", year))
    assert sales == f"TA{year}00000008"
    assert purchase == f"AL{year}00000021"
    assert db.invoices.docs == before
    assert {doc["_id"] for doc in db.counters.docs} == {
        f"INV-TA-{year}-co",
        f"INV-AL-{year}-co",
    }


def test_deleted_invoice_does_not_lower_counter(db):
    year = _year()
    db.invoices.docs.extend([
        _inv("co", f"TA{year}00000007", "ta7"),
        _inv("co", f"TA{year}00000003", "ta3"),
    ])
    first = _run(next_invoice_number(db, "co", "TA", year))
    db.invoices.docs.clear()
    second = _run(next_invoice_number(db, "co", "TA", year))
    assert first == f"TA{year}00000008"
    assert second == f"TA{year}00000009"
    assert [doc["_id"] for doc in db.counters.docs] == [f"INV-TA-{year}-co"]
    assert db.counters.docs[0]["seq"] == 9


def test_concurrent_calls_return_distinct_numbers(db):
    year = _year()

    async def _all():
        return await asyncio.gather(*(
            next_invoice_number(db, "co", SALES_INVOICE_PREFIX, year) for _ in range(20)
        ))

    numbers = _run(_all())
    assert len(numbers) == 20
    assert len(set(numbers)) == 20
    assert set(numbers) == {f"TA{year}{n:08d}" for n in range(1, 21)}


def test_companies_have_separate_counters(db):
    year = _year()
    db.invoices.docs.append(_inv("A", f"TA{year}00000007", "a7"))
    a1 = _run(next_invoice_number(db, "A", "TA", year))
    b1 = _run(next_invoice_number(db, "B", "TA", year))
    a2 = _run(next_invoice_number(db, "A", "TA", year))
    b2 = _run(next_invoice_number(db, "B", "AL", year))
    assert [a1, a2] == [f"TA{year}00000008", f"TA{year}00000009"]
    assert b1 == f"TA{year}00000001"
    assert b2 == f"AL{year}00000001"
    assert {doc["_id"] for doc in db.counters.docs} == {
        f"INV-TA-{year}-A",
        f"INV-TA-{year}-B",
        f"INV-AL-{year}-B",
    }


def test_create_core_keeps_manual_invoice_number(db, monkeypatch):
    import server

    monkeypatch.setattr(server, "db", db)
    out = _run(server._create_invoice_core(
        _invoice(invoice_number="ELLE-1", company_id="co"),
        {"is_super_admin": True},
    ))
    assert out["invoice_number"] == "ELLE-1"
    assert db.counters.docs == []
    assert db.invoices.docs[-1]["invoice_number"] == "ELLE-1"


def test_create_core_assigns_sales_number_from_counter(db, monkeypatch):
    import server

    year = _year()
    db.invoices.docs.extend([
        _inv("co", f"TA{year}00000007", "ta7"),
        _inv("co", f"AL{year}00000009", "al9"),
    ])
    monkeypatch.setattr(server, "db", db)
    user = {"is_super_admin": True}
    sales = _run(server._create_invoice_core(_invoice(company_id="co"), user))
    purchase = _run(server._create_invoice_core(
        _invoice(company_id="co", invoice_type="purchase"), user,
    ))
    export = _run(server._create_invoice_core(
        _invoice(company_id="co", trade_kind="export"), user,
    ))
    imported = _run(server._create_invoice_core(
        _invoice(company_id="co", trade_kind="import", e_type="e_archive"), user,
    ))
    e_export = _run(server._create_invoice_core(
        _invoice(company_id="co", e_type="e_export"), user,
    ))
    assert sales["invoice_number"] == f"TA{year}00000008"
    assert purchase["invoice_number"] == f"AL{year}00000010"
    assert export["invoice_number"] == f"IHR{year}00000001"
    assert imported["invoice_number"] == f"ITH{year}00000001"
    assert e_export["invoice_number"] == f"IHR{year}00000002"


def test_create_core_dispatch_keeps_irs_counter(db, monkeypatch):
    import server

    year = _year()
    monkeypatch.setattr(server, "db", db)
    out = _run(server._create_invoice_core(
        _invoice(company_id="co", invoice_type="dispatch"),
        {"is_super_admin": True},
    ))
    assert out["invoice_number"] == f"IRS-{year}-0001"
    assert [doc["_id"] for doc in db.counters.docs] == [f"IRS-{year}"]
