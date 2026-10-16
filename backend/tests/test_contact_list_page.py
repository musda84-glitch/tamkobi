"""Cari listesi: sayfalı ve sayfasız yanıt aynı küme.

Arama, durum, tip, finansal filtre ve sıralama sayfadan önce uygulanır.
Alacak/borç toplamı sayfa diliminin değil, filtrelenmiş kümenin toplamıdır.
Facet adetleri finansal filtreden önceki kümedendir.

Bellek içi koleksiyon. MYSQL_URL / canlı veritabanı okunmaz, yazılmaz.
"""
from __future__ import annotations

import asyncio
import copy
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import contact_list_page as page  # noqa: E402
from mysql_store import match_query, sort_docs  # noqa: E402

CID = "c-contacts-1"
OTHER = "c-contacts-2"
TODAY = "2026-10-16"


def _contact(**kwargs):
    doc = {
        "company_id": CID,
        "name": "Cari",
        "company_title": "",
        "tax_number_or_id": "",
        "type": "customer",
        "balance": 0,
        "is_active": True,
    }
    doc.update(kwargs)
    doc["_id"] = kwargs["_id"]
    return doc


def _seed():
    contacts = [
        _contact(_id="ada", name="Ada Yılmaz", company_title="Ada Ltd", tax_number_or_id="1111111111", type="customer", balance=100, is_active=True, b2b_password_hash="secret"),
        _contact(_id="bora", name="Bora Demir", company_title="Bora Ticaret", tax_number_or_id="222", type="supplier", balance=-40, is_active=True),
        _contact(_id="cem", name="Cem Işık", company_title="", tax_number_or_id="333", type="both", balance=0, is_active=True),
        _contact(_id="deniz", name="Deniz Kaya", company_title="Deniz A.Ş.", tax_number_or_id="444", type="customer", balance=15.5, is_active=False),
        _contact(_id="efe", name="Efe Öz", company_title="Öz Cam", tax_number_or_id="ABC999", type="customer", balance=-8, is_active=True),
        _contact(_id="nil", name="Nil Ünal", company_title="Nil", tax_number_or_id="555", type="supplier", balance=0, is_active=None),
        _contact(_id="over", name="Vade Geçen", company_title="Vade", tax_number_or_id="666", type="customer", balance=20, is_active=True),
        _contact(_id="inst", name="Taksitli Cari", company_title="Taksit", tax_number_or_id="777", type="customer", balance=5, is_active=True),
        _contact(_id="zero", name="Sıfır Bakiye", company_title="Sıfır", tax_number_or_id="888", type="supplier", balance=0, is_active=True),
        _contact(_id="foreign", company_id=OTHER, name="Ada Yılmaz", company_title="Yabancı Ada", tax_number_or_id="1111111111", type="customer", balance=99999, is_active=True),
    ]
    invoices = [
        {"_id": "i1", "company_id": CID, "contact_id": "ada", "invoice_type": "sales", "status": "approved", "grand_total": 100, "paid_amount": 40, "payment_status": "partial", "due_date": "2026-12-01"},
        {"_id": "i2", "company_id": CID, "contact_id": "ada", "invoice_type": "sales", "status": "draft", "grand_total": 500, "paid_amount": 0, "payment_status": "unpaid", "due_date": "2026-01-01"},
        {"_id": "i3", "company_id": CID, "contact_id": "bora", "invoice_type": "sales", "status": "cancelled", "grand_total": 80, "paid_amount": 0, "payment_status": "unpaid", "due_date": "2026-01-01"},
        {"_id": "i4", "company_id": CID, "contact_id": "over", "invoice_type": "sales", "status": "approved", "grand_total": 30, "paid_amount": 10, "payment_status": "partial", "due_date": "2026-10-01", "issue_date": "2026-09-01"},
        {"_id": "i5", "company_id": CID, "contact_id": "efe", "invoice_type": "purchase", "status": "approved", "grand_total": 70, "paid_amount": 0, "payment_status": "unpaid", "due_date": "2026-01-01"},
        {"_id": "i6", "company_id": OTHER, "contact_id": "ada", "invoice_type": "sales", "status": "approved", "grand_total": 1000, "paid_amount": 0, "payment_status": "unpaid", "due_date": "2026-01-01"},
        {"_id": "i7", "company_id": CID, "contact_id": "cem", "invoice_type": "sales", "status": "approved", "grand_total": 10, "paid_amount": 10, "payment_status": "paid", "due_date": "2026-01-01"},
    ]
    installments = [
        {"_id": "t1", "company_id": CID, "contact_id": "inst", "status": "pending", "amount": 12, "paid_amount": 2, "due_date": "2026-10-20"},
        {"_id": "t2", "company_id": CID, "contact_id": "over", "status": "pending", "amount": 4, "paid_amount": 0, "due_date": "2026-10-10"},
        {"_id": "t3", "company_id": OTHER, "contact_id": "ada", "status": "pending", "amount": 9, "paid_amount": 0, "due_date": "2026-10-10"},
        {"_id": "t4", "company_id": CID, "contact_id": "bora", "status": "paid", "amount": 50, "paid_amount": 50, "due_date": "2026-10-01"},
    ]
    return contacts, invoices, installments


class MemCursor:
    def __init__(self, docs):
        self._docs = docs
        self._sort = None

    def sort(self, key, direction=1):
        self._sort = [(key, direction)] if isinstance(key, str) else key
        return self

    async def to_list(self, length=None):
        rows = sort_docs(list(self._docs), self._sort) if self._sort else list(self._docs)
        if length is not None:
            rows = rows[: int(length)]
        return copy.deepcopy(rows)


class MemColl:
    def __init__(self, db, name, docs):
        self.db = db
        self.name = name
        self.docs = docs

    def _match(self, query):
        return [d for d in self.docs if match_query(d, query or {})]

    def find(self, query=None, projection=None):
        self.db.log.append(("find", self.name, copy.deepcopy(query)))
        return MemCursor(self._match(query))

    async def find_one(self, query=None, projection=None):
        self.db.log.append(("find_one", self.name, copy.deepcopy(query)))
        rows = self._match(query)
        return copy.deepcopy(rows[0]) if rows else None

    async def update_one(self, *args, **kwargs):
        self.db.writes.append(("update", self.name))

    async def insert_one(self, *args, **kwargs):
        self.db.writes.append(("insert", self.name))

    async def delete_one(self, *args, **kwargs):
        self.db.writes.append(("delete", self.name))

    async def update_many(self, *args, **kwargs):
        self.db.writes.append(("update_many", self.name))

    async def insert_many(self, *args, **kwargs):
        self.db.writes.append(("insert_many", self.name))

    async def delete_many(self, *args, **kwargs):
        self.db.writes.append(("delete_many", self.name))


class MemDB:
    def __init__(self, contacts, invoices, installments):
        self.log = []
        self.writes = []
        self.contacts = MemColl(self, "contacts", contacts)
        self.invoices = MemColl(self, "invoices", invoices)
        self.installments = MemColl(self, "installments", installments)

    def __getitem__(self, name):
        return getattr(self, name)


def _db():
    contacts, invoices, installments = _seed()
    return MemDB(copy.deepcopy(contacts), copy.deepcopy(invoices), copy.deepcopy(installments)), contacts, invoices, installments


def _run(coro):
    return asyncio.run(coro)


def _signed(balance):
    if isinstance(balance, bool) or balance is None or balance == "":
        return 0.0
    try:
        return float(balance)
    except (TypeError, ValueError):
        return 0.0


def _clear(balance):
    if balance is None or balance is False or balance == "":
        return True
    if isinstance(balance, bool):
        return False
    if isinstance(balance, (int, float)):
        return balance == 0
    return False


def _search(contact, q):
    raw = "" if q is None else str(q)
    if raw == "":
        return True
    needle = raw.lower()
    if needle in str(contact.get("name") or "").lower():
        return True
    title = contact.get("company_title")
    if title and needle in str(title).lower():
        return True
    tax = contact.get("tax_number_or_id")
    return raw in str("" if tax is None else tax)


def _fin(contact, fin, flags):
    if fin in ("", "all", None):
        return True
    bal = contact.get("balance")
    if fin == "debtors":
        return _signed(bal) > 0
    if fin == "creditors":
        return _signed(bal) < 0
    if fin == "clear":
        return _clear(bal)
    info = (flags or {}).get(contact.get("id") or "") or {}
    if fin == "overdue":
        return int(info.get("overdue_count") or 0) > 0 or int(info.get("installment_overdue_count") or 0) > 0
    if fin == "installments":
        return int(info.get("installment_due_count") or 0) > 0
    return True


def _sort(rows, sort):
    if sort in ("", "name", None):
        return list(rows)
    if sort == "name_desc":
        return sorted(rows, key=lambda c: (str(c.get("name") or ""), str(c.get("id") or "")), reverse=True)
    if sort == "balance_asc":
        return sorted(rows, key=lambda c: (_signed(c.get("balance")), str(c.get("name") or "").lower(), str(c.get("id") or "")))
    return sorted(rows, key=lambda c: (-_signed(c.get("balance")), str(c.get("name") or "").lower(), str(c.get("id") or "")))


def _view(docs, flags, *, q="", status="all", fin="all", sort="name"):
    base = []
    for row in docs:
        if status == "active" and row.get("is_active") is False:
            continue
        if status == "inactive" and row.get("is_active") is not False:
            continue
        if not _search(row, q):
            continue
        base.append(row)
    chosen = [row for row in base if _fin(row, fin, flags)]
    return _sort(chosen, sort), base


def _money(rows):
    receivable = payable = 0.0
    for row in rows:
        bal = _signed(row.get("balance"))
        if bal > 0:
            receivable += bal
        elif bal < 0:
            payable += -bal
    return round(receivable - payable, 2), round(receivable, 2), round(payable, 2)


def _core(row):
    return (row.get("id"), row.get("balance"), row.get("open_amount"), row.get("company_id"))


async def _collect(db, page_size=2, **kwargs):
    page_n = 1
    items = []
    bodies = []
    while page_n < 40:
        body = await page.list_contacts_paged(db, CID, page=page_n, page_size=page_size, today=TODAY, **kwargs)
        bodies.append(body)
        items.extend(body["items"])
        if not body["has_more"]:
            return items, bodies
        page_n += 1
    raise AssertionError("sayfa döngüsü kapanmadı")


def _fetch_kwargs(spec):
    out = {}
    for key in ("type", "lite", "include_inactive"):
        if key in spec:
            out[key] = spec[key]
    return out


def _filter_kwargs(spec):
    return {
        "q": spec.get("q", ""),
        "status": spec.get("status", "all"),
        "fin": spec.get("fin", "all"),
        "sort": spec.get("sort", "name"),
    }


CASES = [
    {},
    {"q": "yılmaz"},
    {"q": "Yılmaz"},
    {"q": "ABC"},
    {"q": "abc"},
    {"q": "öz"},
    {"q": "işık"},
    {"type": "customer"},
    {"type": "supplier"},
    {"type": "both"},
    {"status": "active"},
    {"status": "inactive"},
    {"fin": "debtors"},
    {"fin": "creditors"},
    {"fin": "clear"},
    {"fin": "overdue"},
    {"fin": "installments"},
    {"sort": "name_desc"},
    {"sort": "balance_asc"},
    {"sort": "balance_desc"},
    {"type": "customer", "status": "active", "fin": "debtors", "sort": "balance_desc", "q": "a"},
    {"q": "yılmaz", "fin": "debtors", "sort": "balance_desc", "status": "active"},
    {"lite": True, "q": "ada", "fin": "debtors"},
    {"include_inactive": False, "status": "all", "fin": "clear"},
    {"include_inactive": False, "status": "inactive"},
]


@pytest.mark.parametrize("spec", CASES, ids=lambda s: ",".join(f"{k}={v}" for k, v in s.items()) or "default")
def test_paged_matches_unpaged_set(spec):
    db, contacts, invoices, installments = _db()
    before = copy.deepcopy(contacts)
    fetch = _fetch_kwargs(spec)
    filt = _filter_kwargs(spec)

    async def _go():
        full = await page.list_contacts_unpaged(
            db, CID,
            type=fetch.get("type"),
            lite=bool(fetch.get("lite")),
            include_inactive=fetch.get("include_inactive", None),
        )
        flags = await page.compute_flags(db, CID, today=TODAY)
        items, bodies = await _collect(db, **fetch, **filt)
        tail = await page.list_contacts_paged(db, CID, page=99, page_size=2, today=TODAY, **fetch, **filt)
        return full, flags, items, bodies, tail

    full, flags, items, bodies, tail = _run(_go())
    expected, base = _view(full, flags, **filt)
    assert [_core(row) for row in items] == [_core(row) for row in expected]
    assert "foreign" not in {row.get("id") for row in items}
    assert all(row.get("company_id") == CID for row in items)
    assert all("b2b_password_hash" not in row for row in items)
    total_bal, receivable, payable = _money(expected)
    assert bodies, "en az bir sayfa"
    for body in bodies:
        assert body["total"] == len(expected)
        assert body["summary"]["count"] == len(expected)
        assert body["summary"]["balance_total"] == total_bal
        assert body["summary"]["receivable_total"] == receivable
        assert body["summary"]["payable_total"] == payable
        assert body["summary"]["facet_total"] == len(base)
        assert body["summary"]["debtors"] == sum(1 for row in base if _signed(row.get("balance")) > 0)
        assert body["summary"]["creditors"] == sum(1 for row in base if _signed(row.get("balance")) < 0)
        assert body["summary"]["clear"] == sum(1 for row in base if _clear(row.get("balance")))
    assert tail["items"] == []
    assert tail["total"] == len(expected)
    assert tail["summary"]["receivable_total"] == receivable
    assert db.writes == []
    assert contacts == before
    if items:
        items[0]["balance"] = -123456
        assert contacts == before
    if not spec.get("lite"):
        by_id = {row["id"]: row for row in full}
        if "ada" in by_id:
            assert by_id["ada"].get("open_amount") == 60
        if "cem" in by_id:
            assert by_id["cem"].get("open_amount") == 0
        assert "open_amount" not in by_id.get("bora", {})
        assert "open_amount" not in by_id.get("efe", {})
    else:
        assert all("open_amount" not in row for row in items)


def test_summary_is_not_the_page_slice_and_flags_match():
    db, contacts, _, _ = _db()
    before = copy.deepcopy(contacts)

    async def _go():
        body = await page.list_contacts_paged(db, CID, page=1, page_size=1, today=TODAY)
        flags = await page.compute_flags(db, CID, today=TODAY)
        wide = await page.list_contacts_paged(db, CID, page=1, page_size=50, fin="debtors", today=TODAY)
        return body, flags, wide

    body, flags, wide = _run(_go())
    assert body["total"] > 1
    assert len(body["items"]) == 1
    assert body["summary"]["receivable_total"] != _signed(body["items"][0].get("balance"))
    assert body["summary"]["receivable_total"] == 140.5
    assert body["summary"]["payable_total"] == 48
    assert body["summary"]["balance_total"] == 92.5
    assert flags["over"]["overdue_count"] == 1
    assert flags["over"]["overdue_amount"] == 20
    assert flags["over"]["installment_overdue_count"] == 1
    assert flags["inst"]["installment_due_count"] == 1
    assert flags["inst"]["installment_overdue_count"] == 0
    assert "ada" not in flags
    over = next(row for row in wide["items"] if row["id"] == "over")
    assert over["flags"]["overdue_count"] == 1
    assert over["balance"] == 20
    assert wide["summary"]["facet_total"] > wide["total"]
    assert wide["summary"]["creditors"] > 0
    assert wide["total"] == wide["summary"]["debtors"]
    assert db.writes == []
    assert contacts == before


def test_queries_stay_inside_company_and_do_not_write():
    db, contacts, _, _ = _db()

    async def _go():
        db.log.clear()
        await page.list_contacts_paged(db, CID, page=1, page_size=20, q="ada", fin="overdue", today=TODAY)
        return list(db.log)

    finds = _run(_go())
    assert finds
    assert {name for _, name, _ in finds} <= {"contacts", "invoices", "installments"}
    for _kind, _name, query in finds:
        assert query.get("company_id") == CID
        assert "$or" not in query
    assert db.writes == []
    assert all(doc.get("balance") != -1 for doc in contacts)


def test_other_company_is_forbidden_and_page_size_caps():
    db, contacts, _, _ = _db()
    user_c1 = {"id": "u1", "company_ids": [CID], "active_company_id": CID}
    user_c2 = {"id": "u2", "company_ids": [OTHER], "active_company_id": OTHER}

    async def _go():
        own = await page.list_contacts_for_user(db, user_c1, CID, paged=True, page=1, page_size=500, today=TODAY)
        plain = await page.list_contacts_for_user(db, user_c1, None, paged=False)
        foreign_list = await page.list_contacts_for_user(db, user_c2, paged=False)
        denied = None
        try:
            await page.list_contacts_for_user(db, user_c2, CID, paged=True, page=1, page_size=20, today=TODAY)
        except HTTPException as exc:
            denied = exc.status_code
        bad = None
        try:
            await page.list_contacts_paged(db, CID, page=1, page_size=10, fin="maybe", today=TODAY)
        except HTTPException as exc:
            bad = exc.status_code
        exported = await page.list_contacts_paged(db, CID, page=3, page_size=1, export=True, today=TODAY)
        return own, plain, foreign_list, denied, bad, exported

    own, plain, foreign_list, denied, bad, exported = _run(_go())
    assert own["page_size"] == 200
    assert {row["id"] for row in own["items"]} == {row["id"] for row in plain}
    assert "foreign" not in {row["id"] for row in plain}
    assert [row["id"] for row in foreign_list] == ["foreign"]
    assert denied == 403
    assert bad == 400
    assert exported["page"] == 1
    assert exported["page_size"] == page.FETCH_CAP
    assert exported["total"] == len(plain)
    assert len(exported["items"]) == len(plain)
    assert db.writes == []
    assert contacts[0]["balance"] == 100


def test_unpaged_route_stays_an_array_and_module_does_not_write():
    root = Path(__file__).resolve().parents[1]
    server = (root / "server.py").read_text(encoding="utf-8")
    src = (root / "contact_list_page.py").read_text(encoding="utf-8")
    assert 'contacts = await db.contacts.find(query, proj).sort("name", 1).to_list(5000 if lite else 10000)' in server
    assert "if page is not None or page_size is not None:" in server
    assert "return docs" in server
    for bad in ("update_one", "insert_one", "delete_one", "update_many", "insert_many", "delete_many", "$set", "replace_one"):
        assert bad not in src
