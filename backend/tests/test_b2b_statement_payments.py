"""B2B hesap ekstresi: fatura + tahsilat/ödeme, kiracı sınırı, gizli alan yok.

Bellek içi sahte koleksiyon. Modül ortam değişkeni yazmaz.
"""
from __future__ import annotations

import asyncio
import copy
import json
from datetime import date, timedelta

import addons
import server
from mysql_store import match_query, sort_docs

TOKEN = "tok-bayi"
COMPANY = "co-1"
CONTACT = "cnt-1"
SECRET_KEYS = {
    "account_id",
    "created_by",
    "created_by_id",
    "created_by_name",
    "internal_note",
    "internal_notes",
    "notes",
    "note",
    "cost",
    "cost_price",
    "purchase_price",
    "cost_amount",
}


class MemCursor:
    def __init__(self, docs, coll):
        self._docs = docs
        self._sort = None
        self._coll = coll

    def sort(self, key, direction=1):
        self._sort = [(key, direction)] if isinstance(key, str) else list(key)
        self._coll.sorts.append(list(self._sort))
        return self

    async def to_list(self, length=None):
        self._coll.limits.append(length)
        rows = sort_docs(list(self._docs), self._sort) if self._sort else list(self._docs)
        if length is not None:
            rows = rows[: int(length)]
        return copy.deepcopy(rows)


class MemColl:
    def __init__(self):
        self.docs = []
        self.queries = []
        self.limits = []
        self.sorts = []

    def find(self, query=None, projection=None):
        self.queries.append(copy.deepcopy(query or {}))
        rows = [d for d in self.docs if match_query(d, query or {})]
        return MemCursor(rows, self)

    async def find_one(self, query=None, projection=None):
        self.queries.append(copy.deepcopy(query or {}))
        for doc in self.docs:
            if match_query(doc, query or {}):
                return copy.deepcopy(doc)
        return None


class MemDB:
    def __init__(self):
        self._cols = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = MemColl()
            self._cols[name] = coll
        return coll


def _keys(obj):
    found = set()
    if isinstance(obj, dict):
        for key, val in obj.items():
            found.add(key)
            found |= _keys(val)
    elif isinstance(obj, list):
        for val in obj:
            found |= _keys(val)
    return found


def _contact(balance=600):
    return {
        "_id": CONTACT,
        "company_id": COMPANY,
        "name": "Demo Bayi",
        "b2b_enabled": True,
        "b2b_token": TOKEN,
        "is_active": True,
        "balance": balance,
        "phone": "555",
        "email": "bayi@example.com",
    }


def _company(show_statement=True):
    return {
        "_id": COMPANY,
        "name": "TamKobi",
        "b2b_settings": {"enabled": True, "show_statement": show_statement},
    }


def _invoice(**extra):
    doc = {
        "_id": "inv-1",
        "company_id": COMPANY,
        "contact_id": CONTACT,
        "status": "approved",
        "invoice_type": "sales",
        "invoice_number": "SF-1",
        "issue_date": "2026-10-01",
        "grand_total": 1000,
        "paid_amount": 0,
        "payment_status": "unpaid",
        "currency": "TRY",
        "notes": "FATURA-IC-NOT",
        "internal_notes": "IC-NOT",
        "purchase_price": 10,
    }
    doc.update(extra)
    return doc


def _payment(**extra):
    doc = {
        "_id": "pay-1",
        "company_id": COMPANY,
        "contact_id": CONTACT,
        "type": "inflow",
        "amount": 400,
        "date": "2026-10-02",
        "account_id": "acc-secret",
        "account_name": "Kasa",
        "description": "Nakit",
        "created_by": "user-secret",
        "created_by_id": "user-secret",
        "created_by_name": "Gizli Kullanıcı",
        "notes": "IC-NOT",
        "internal_note": "IC-NOT",
        "cost": 12.5,
    }
    doc.update(extra)
    return doc


async def _is_on(*_args, **_kwargs):
    return False


def _portal(monkeypatch, *, invoices=None, payments=None, cheques=None, show_statement=True, balance=600):
    db = MemDB()
    db.contacts.docs.append(_contact(balance))
    db.companies.docs.append(_company(show_statement))
    db.invoices.docs.extend(invoices or [])
    db.bank_transactions.docs.extend(payments or [])
    db.cheques.docs.extend(cheques or [])
    monkeypatch.setattr(server, "db", db)
    monkeypatch.setattr(addons, "is_on", _is_on)
    body = asyncio.run(server.b2b_portal(TOKEN))
    return body, db


def _assert_private(body):
    blob = json.dumps(body, ensure_ascii=False)
    assert _keys(body.get("statement") or {}).isdisjoint(SECRET_KEYS)
    for secret in ("acc-secret", "user-secret", "Gizli Kullanıcı", "IC-NOT", "FATURA-IC-NOT"):
        assert secret not in blob


def test_invoice_plus_collection_ends_at_600(monkeypatch):
    body, db = _portal(
        monkeypatch,
        invoices=[
            _invoice(),
            _invoice(_id="inv-draft", status="draft", invoice_number="TASLAK", grand_total=50, issue_date="2026-09-01"),
            _invoice(_id="inv-cancel", status="cancelled", invoice_number="IPTAL", grand_total=70, issue_date="2026-09-02"),
        ],
        payments=[
            _payment(),
            _payment(_id="pay-cancel", amount=50, date="2026-10-05", status="cancelled", description="iptal"),
            _payment(_id="pay-del", type="outflow", amount=20, date="2026-10-06", deleted_at="2026-10-07T00:00:00Z", description="silindi"),
        ],
    )
    rows = body["statement"]["rows"]
    assert [row["doc"] for row in rows] == ["SF-1 • Satış Faturası", "Tahsilat • Kasa • Nakit"]
    assert rows[0]["debit"] == 1000 and rows[0]["credit"] == 0 and rows[0]["balance"] == 1000
    assert rows[1]["debit"] == 0 and rows[1]["credit"] == 400 and rows[1]["balance"] == 600
    assert rows[1]["kind"] == "payment"
    assert body["statement"]["payments"] == [rows[1]]
    assert len(rows) == 2
    invoice_query = db.invoices.queries[-1]
    pay_query = db.bank_transactions.queries[-1]
    assert invoice_query["company_id"] == COMPANY and invoice_query["contact_id"] == CONTACT
    assert pay_query["company_id"] == COMPANY and pay_query["contact_id"] == CONTACT
    assert pay_query["type"] == {"$ne": "transfer"}
    assert db.invoices.limits[-1] >= 500
    assert db.bank_transactions.limits[-1] >= 500
    _assert_private(body)


def test_other_company_payment_and_invoice_stay_hidden(monkeypatch):
    body, _db = _portal(
        monkeypatch,
        invoices=[
            _invoice(),
            _invoice(_id="inv-foreign", company_id="co-other", invoice_number="YABANCI", grand_total=5000, issue_date="2026-09-01"),
        ],
        payments=[_payment(_id="pay-foreign", company_id="co-other", amount=999, date="2026-10-03", description="yabancı")],
    )
    rows = body["statement"]["rows"]
    assert len(rows) == 1
    assert rows[0]["balance"] == 1000
    assert "YABANCI" not in json.dumps(body["statement"], ensure_ascii=False)
    assert all(row.get("credit") != 999 for row in rows)


def test_other_contact_payment_stays_hidden(monkeypatch):
    body, _db = _portal(
        monkeypatch,
        invoices=[_invoice()],
        payments=[_payment(_id="pay-other", contact_id="cnt-other", amount=888, date="2026-10-03", description="başka cari")],
    )
    rows = body["statement"]["rows"]
    assert len(rows) == 1
    assert rows[0]["doc"] == "SF-1 • Satış Faturası"
    assert rows[0]["balance"] == 1000
    assert body["statement"]["payments"] == []


def test_transfer_is_excluded(monkeypatch):
    body, _db = _portal(
        monkeypatch,
        invoices=[_invoice()],
        payments=[_payment(_id="pay-virman", type="transfer", amount=777, date="2026-10-04", description="Virman")],
    )
    rows = body["statement"]["rows"]
    assert len(rows) == 1
    assert rows[0]["balance"] == 1000
    assert body["statement"]["payments"] == []
    assert "Virman" not in json.dumps(body["statement"], ensure_ascii=False)


def test_show_statement_false_returns_empty_statement(monkeypatch):
    body, db = _portal(
        monkeypatch,
        show_statement=False,
        invoices=[_invoice()],
        payments=[_payment()],
    )
    assert body["statement"] == {"rows": [], "payments": []}
    assert body["invoices"] == []
    assert db.invoices.queries == []
    assert db.bank_transactions.queries == []
    assert db.cheques.queries == []


def test_statement_response_omits_account_and_actor(monkeypatch):
    body, _db = _portal(monkeypatch, invoices=[_invoice()], payments=[_payment()])
    _assert_private(body)
    allowed = {"date", "doc", "debit", "credit", "balance", "kind"}
    for row in body["statement"]["rows"] + body["statement"]["payments"]:
        assert set(row) == allowed


def test_open_cheque_without_bank_row_is_listed_once(monkeypatch):
    body, _db = _portal(
        monkeypatch,
        invoices=[_invoice()],
        payments=[_payment(_id="pay-ch", amount=300, date="2026-10-02", cheque_id="ch1", account_name="Çek Portföyü", description="")],
        cheques=[
            {
                "_id": "ch1",
                "company_id": COMPANY,
                "contact_id": CONTACT,
                "instrument": "cheque",
                "direction": "received",
                "status": "open",
                "amount": 300,
                "due_date": "2026-11-01",
                "serial_no": "SN1",
                "account_id": "acc-secret",
                "created_by": "user-secret",
                "notes": "IC-NOT",
            },
            {
                "_id": "ch2",
                "company_id": COMPANY,
                "contact_id": CONTACT,
                "instrument": "cheque",
                "direction": "received",
                "status": "open",
                "amount": 50,
                "due_date": "2026-10-03",
                "serial_no": "SN2",
                "bank_name": "Ziraat",
            },
            {
                "_id": "ch-bounce",
                "company_id": COMPANY,
                "contact_id": CONTACT,
                "instrument": "cheque",
                "direction": "received",
                "status": "bounced",
                "amount": 999,
                "due_date": "2026-10-04",
                "serial_no": "BOUNCE",
            },
            {
                "_id": "ch-other",
                "company_id": "co-other",
                "contact_id": CONTACT,
                "instrument": "cheque",
                "direction": "received",
                "status": "open",
                "amount": 80,
                "due_date": "2026-10-03",
                "serial_no": "YABANCI",
            },
        ],
    )
    docs = [row["doc"] for row in body["statement"]["rows"]]
    assert docs == [
        "SF-1 • Satış Faturası",
        "Tahsilat • Çek Portföyü",
        "Alınan Çek • SN2 • Ziraat",
    ]
    assert body["statement"]["rows"][-1]["balance"] == 650
    assert "SN1" not in docs[1]
    assert "BOUNCE" not in json.dumps(docs, ensure_ascii=False)
    assert "YABANCI" not in json.dumps(docs, ensure_ascii=False)
    _assert_private(body)


def test_over_limit_keeps_newest_payments(monkeypatch):
    start = date(2024, 1, 1)
    payments = [
        _payment(
            _id=f"pay-{i:04d}",
            amount=1,
            date=(start + timedelta(days=i)).isoformat(),
            description=f"H{i:04d}",
        )
        for i in range(600)
    ]
    body, db = _portal(monkeypatch, payments=payments, balance=0)
    docs = [row["doc"] for row in body["statement"]["rows"]]
    assert len(docs) == 500
    assert any("H0599" in doc for doc in docs)
    assert all("H0000" not in doc and "H0099" not in doc for doc in docs)
    assert any("H0100" in doc for doc in docs)
    assert body["statement"]["rows"][-1]["date"] == payments[-1]["date"]
    assert db.bank_transactions.sorts[-1] == [("date", -1)]
    assert db.bank_transactions.limits[-1] == 500
    assert db.cheques.sorts[-1] == [("due_date", -1)]


def test_skip_ledger_and_installment_notes_stay_off_statement(monkeypatch):
    body, _db = _portal(
        monkeypatch,
        invoices=[_invoice()],
        payments=[_payment()],
        cheques=[
            {
                "_id": "note-skip",
                "company_id": COMPANY,
                "contact_id": CONTACT,
                "instrument": "promissory",
                "direction": "received",
                "status": "open",
                "amount": 300,
                "due_date": "2026-10-08",
                "serial_no": "SKIP300",
                "skip_ledger": True,
            },
            {
                "_id": "note-inst",
                "company_id": COMPANY,
                "contact_id": CONTACT,
                "instrument": "promissory",
                "direction": "received",
                "status": "open",
                "amount": 150,
                "due_date": "2026-10-09",
                "serial_no": "TAKSIT",
                "installment_id": "inst-1",
            },
        ],
    )
    docs = [row["doc"] for row in body["statement"]["rows"]]
    assert docs == ["SF-1 • Satış Faturası", "Tahsilat • Kasa • Nakit"]
    assert body["statement"]["rows"][-1]["balance"] == 600
    blob = json.dumps(body["statement"], ensure_ascii=False)
    assert "SKIP300" not in blob and "TAKSIT" not in blob
    _assert_private(body)
