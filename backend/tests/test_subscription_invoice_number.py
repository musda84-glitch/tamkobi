"""Abonelik fatura numarası: atomik sayaç, yıl sınırı ve aynı ödeme kaydı."""
import asyncio
import copy
import os
import sys
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "docker", "stubs"))

import saas_billing  # noqa: E402
import saas_extras  # noqa: E402
from mysql_store import apply_update, match_query, new_upsert_doc  # noqa: E402

PLATFORM = "plat_01"
CUSTOMER = "cust_01"


def _run(coro):
    return asyncio.run(coro)


def _year() -> int:
    return datetime.now(timezone.utc).year


def _abn(year: int, seq: int) -> str:
    return f"ABN{year}{seq:06d}"


class _Cursor:
    def __init__(self, rows):
        self.rows = list(rows)

    async def to_list(self, n=None):
        await asyncio.sleep(0)
        if n is None:
            return list(self.rows)
        return list(self.rows[:n])


class _Coll:
    """Bellek içi koleksiyon. Her işlem atomik; beklemeler eşzamanlı çağrıyı keser."""

    def __init__(self):
        self.docs = []
        self._lock = asyncio.Lock()

    async def find_one(self, query=None, projection=None):
        await asyncio.sleep(0)
        async with self._lock:
            for doc in self.docs:
                if match_query(doc, query or {}):
                    return copy.deepcopy(doc)
            return None

    def find(self, query=None, projection=None):
        rows = [copy.deepcopy(doc) for doc in self.docs if match_query(doc, query or {})]
        return _Cursor(rows)

    async def insert_one(self, doc):
        await asyncio.sleep(0)
        async with self._lock:
            self.docs.append(copy.deepcopy(doc))
            return SimpleNamespace(inserted_id=doc.get("_id"))

    async def update_one(self, query, update, upsert=False):
        await asyncio.sleep(0)
        async with self._lock:
            for i, doc in enumerate(self.docs):
                if match_query(doc, query or {}):
                    self.docs[i] = apply_update(doc, update, query)
                    return SimpleNamespace(matched_count=1, modified_count=1, upserted_id=None)
            if not upsert:
                return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)
            created = new_upsert_doc(update, query)
            self.docs.append(created)
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=created.get("_id"))

    async def find_one_and_update(self, query, update, upsert=False, return_document=True, projection=None):
        await asyncio.sleep(0)
        async with self._lock:
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
        self.platform_settings = _Coll()
        self.companies = _Coll()
        self.users = _Coll()
        self.contacts = _Coll()
        self.invoices = _Coll()
        self.payment_transactions = _Coll()
        self.counters = _Coll()


def _invoice(company_id, number, iid, source="subscription"):
    return {
        "_id": iid,
        "company_id": company_id,
        "invoice_number": number,
        "source": source,
    }


def _tx(tx_id, company_id=CUSTOMER):
    return {
        "_id": tx_id,
        "company_id": company_id,
        "amount": 120.0,
        "period": "monthly",
        "plan_name": "Pro",
        "provider": "paytr",
        "merchant_oid": f"oid-{tx_id}",
    }


def _prepare(db, txs):
    db.platform_settings.docs.append({
        "_id": "platform",
        "sender_company_id": PLATFORM,
        "brand_name": "TamKobi",
    })
    db.companies.docs.append({
        "_id": CUSTOMER,
        "name": "Deneme Ltd",
        "tax_number": "1234567890",
        "email": "firma@example.com",
        "phone": "555",
        "city": "Istanbul",
    })
    db.users.docs.append({
        "_id": "usr_admin",
        "company_ids": [CUSTOMER],
        "role": "admin",
        "email": "admin@example.com",
    })
    for tx in txs:
        db.payment_transactions.docs.append(copy.deepcopy(tx))


class _Bind:
    def __init__(self, db):
        self.db = db

    def __enter__(self):
        self.prev = (saas_extras._db, saas_billing._db)
        saas_extras.init(self.db, {})
        saas_billing.init(self.db, {})
        return self

    def __exit__(self, *_args):
        saas_extras._db, saas_billing._db = self.prev
        return False


class _Mail:
    def __init__(self):
        self.calls = 0

    async def __call__(self, *_args, **_kwargs):
        self.calls += 1
        return {"status": "sent", "to": ["firma@example.com"]}


def _mails():
    mailer = _Mail()
    return patch("mail_service.send_mail", new=mailer), patch(
        "saas_docs.build_invoice_pdf", return_value=b"%PDF-1.4",
    ), mailer


def _issue(db, tx):
    mail, pdf, mailer = _mails()
    with mail, pdf, _Bind(db):
        invoice_id = _run(saas_extras.issue_subscription_invoice(tx))
    return invoice_id, mailer


def _issued(db):
    return [doc for doc in db.invoices.docs if doc.get("payment_tx_id")]


def test_first_invoice_is_000001_even_when_previous_year_exists():
    db = _Db()
    year = _year()
    prev = year - 1
    db.invoices.docs.append(_invoice(PLATFORM, _abn(prev, 50), "old-year"))
    db.invoices.docs.append(_invoice("other-co", _abn(year, 99), "foreign"))
    tx = _tx("tx-first")
    _prepare(db, [tx])
    invoice_id, mailer = _issue(db, tx)
    created = _issued(db)
    assert len(created) == 1
    assert created[0]["_id"] == invoice_id
    assert created[0]["invoice_number"] == _abn(year, 1)
    assert db.counters.docs[0]["_id"] == f"ABN-{year}-{PLATFORM}"
    assert db.counters.docs[0]["seq"] == 1
    stored = next(doc for doc in db.payment_transactions.docs if doc["_id"] == "tx-first")
    assert stored["invoice_id"] == invoice_id
    assert stored["invoice_number"] == _abn(year, 1)
    assert mailer.calls == 1


def test_seed_uses_highest_numeric_suffix_of_this_year():
    db = _Db()
    year = _year()
    prev = year - 1
    db.invoices.docs.extend([
        _invoice(PLATFORM, _abn(year, 2), "low"),
        _invoice(PLATFORM, _abn(year, 10), "high"),
        _invoice(PLATFORM, f"ABN{year}0007", "short"),
        _invoice(PLATFORM, _abn(prev, 50), "old-year"),
        _invoice("other-co", _abn(year, 80), "foreign"),
    ])
    tx = _tx("tx-seed")
    _prepare(db, [tx])
    _issue(db, tx)
    created = _issued(db)
    assert len(created) == 1
    assert created[0]["invoice_number"] == _abn(year, 11)
    assert db.counters.docs[0]["seq"] == 11


def test_concurrent_calls_return_distinct_numbers():
    db = _Db()
    year = _year()
    txs = [_tx(f"tx-{i}") for i in range(10)]
    _prepare(db, txs)

    async def _all():
        return await asyncio.gather(*(saas_extras.issue_subscription_invoice(tx) for tx in txs))

    mail, pdf, mailer = _mails()
    with mail, pdf, _Bind(db):
        ids = _run(_all())
    numbers = [doc["invoice_number"] for doc in _issued(db)]
    assert len(ids) == 10
    assert len(set(ids)) == 10
    assert len(numbers) == 10
    assert set(numbers) == {_abn(year, n) for n in range(1, 11)}
    assert len({doc["_id"] for doc in db.counters.docs}) == 1
    assert db.counters.docs[0]["seq"] == 10
    assert mailer.calls == 10


def test_same_payment_tx_issues_one_invoice():
    db = _Db()
    year = _year()
    tx = _tx("tx-same")
    _prepare(db, [tx])
    mail, pdf, mailer = _mails()
    with mail, pdf, _Bind(db):
        first = _run(saas_extras.issue_subscription_invoice(tx))
        second = _run(saas_extras.issue_subscription_invoice(tx))
    created = _issued(db)
    assert first == second
    assert len(created) == 1
    assert created[0]["_id"] == first
    assert created[0]["invoice_number"] == _abn(year, 1)
    assert db.counters.docs[0]["seq"] == 1
    assert mailer.calls == 1
