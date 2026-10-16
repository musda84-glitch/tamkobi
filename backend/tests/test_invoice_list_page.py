"""Fatura listesi: sayfalı birleşim, sayfasız Python referansı ile aynı.

Sekme, arama, ödeme, belge, tarih, tutar ve 14 sıralama sayfadan önce uygulanır.
Özet filtrelenmiş kümenin tamamıdır. Başka firmanın faturası gelmez.
GET yazmaz. Kalemler yanıta girmez.

Bellek içi koleksiyon. MYSQL_URL / canlı veritabanı okunmaz, yazılmaz.
MySQL karşılaştırması yalnız TAMKOBI_TEST_MYSQL_URL (yoksa skip).
"""
from __future__ import annotations

import asyncio
import copy
import os
import sys
import uuid
from pathlib import Path
from unittest.mock import patch
from urllib.parse import unquote, urlparse

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import invoice_list_page as page  # noqa: E402
from mysql_store import match_query, sort_docs  # noqa: E402

CID = "c-inv-1"
OTHER = "c-inv-2"
TODAY = "2026-10-16"
TABS = ["all", "sales", "purchase", "incoming", "outgoing_gib", "export", "import"]
SORTS = [
    "date_desc", "date_asc", "due_asc", "due_desc",
    "amount_desc", "amount_asc", "contact_asc", "contact_desc",
    "number_desc", "number_asc", "gib_asc", "gib_desc", "pay_asc", "pay_desc",
]


def _inv(**kwargs):
    doc = {
        "company_id": CID,
        "invoice_number": "AR-0",
        "invoice_type": "sales",
        "e_type": "paper",
        "contact_id": "ct",
        "contact_name": "Aras",
        "contact_tax_id": "111",
        "notes": "",
        "issue_date": "2026-03-01",
        "issue_time": "10:00:00",
        "due_date": "2026-12-01",
        "grand_total": 100,
        "currency": "TRY",
        "status": "approved",
        "payment_status": "unpaid",
        "gib_status": "Taslak",
        "items": [{"name": "Kalem", "quantity": 1, "unit_price": 100}],
        "created_at": "2026-03-01T10:00:00",
    }
    doc.update(kwargs)
    doc["_id"] = kwargs["_id"]
    return doc


def _seed():
    return [
        _inv(_id="s-cem", invoice_number="AR-1", contact_name="Cem Aras", grand_total=100, issue_date="2026-02-01", due_date="2026-11-01", created_at="2026-02-01T08:00:00", gib_status="Onaylandı"),
        _inv(_id="s-celik", invoice_number="AR-2", contact_name="Çelik Aras", grand_total=40, issue_date="2026-05-01", due_date="2026-01-01", status="draft", payment_status="unpaid", updated_at="2026-06-01T12:00:00", gib_status="Taslak"),
        _inv(_id="s-tie-a", invoice_number="AR-T1", contact_name="Cem Aras", grand_total=100, issue_date="2026-02-01", issue_time="08:00:00", due_date="2026-11-01", created_at="2026-02-01T08:00:00", gib_status="Onaylandı"),
        _inv(_id="s-tie-b", invoice_number="AR-T2", contact_name="Cem Aras", grand_total=100, issue_date="2026-02-01", issue_time="08:00:00", due_date="2026-11-01", created_at="2026-02-01T08:00:00", gib_status="Onaylandı"),
        _inv(_id="s-note", invoice_number="ZZ-1", contact_name="Zeynep", notes="özel arama", grand_total=30, issue_date="2026-07-01", due_date="", gib_status="Not"),
        _inv(_id="s-paid", invoice_number="AR-O", contact_name="Aras Ödenmiş", grand_total=110, payment_status="paid", due_date="2026-01-01", gib_status="Ödendi"),
        _inv(_id="s-part", invoice_number="AR-KSM", contact_name="Aras Kısmi", grand_total=130, payment_status="partially_paid", due_date="2026-12-15", gib_status="Kısmi"),
        _inv(_id="s-usd", invoice_number="AR-USD", contact_name="Aras Döviz", grand_total=20, currency="USD", local_total=250, gib_status="Döviz"),
        _inv(_id="s-gib", invoice_number="AR-G", contact_name="Aras Giden", e_type="e_invoice", gib_uuid="uuid-1", gib_status="GİB'e gönderildi", grand_total=80, status="approved"),
        _inv(_id="s-gib2", invoice_number="AR-G2", contact_name="Aras Giden İki", e_type="e_archive", gib_tracking_id="trk-2", einvoice_state="sent", gib_status="İletildi", grand_total=85),
        _inv(_id="p-local", invoice_number="AR-P", invoice_type="purchase", contact_name="Aras Tedarik", grand_total=70, gib_status="Alış"),
        _inv(_id="p-local2", invoice_number="AR-P2", invoice_type="purchase", contact_name="Aras Alış", grand_total=60, issue_date="2026-04-02", gib_status="Alış iki"),
        _inv(_id="p-in", invoice_number="AR-IN", invoice_type="purchase", e_type="e_invoice", contact_name="Aras Gelen", grand_total=90, gib_status="Gelen e-Fatura", direction="incoming"),
        _inv(_id="p-in2", invoice_number="AR-IN2", invoice_type="purchase", e_type="e_invoice", contact_name="Aras Gelen İki", grand_total=95, gib_uuid="in-2", gib_status="Gelen"),
        _inv(_id="ex1", invoice_number="AR-X", trade_kind="export", e_type="e_export", contact_name="Aras İhracat", grand_total=200, gib_status="İhracat"),
        _inv(_id="ex2", invoice_number="AR-X2", trade_kind="export", e_type="e_export", contact_name="Bora Aras", grand_total=150, issue_date="2026-08-01", gib_status="İhracat iki"),
        _inv(_id="im1", invoice_number="AR-M", invoice_type="purchase", trade_kind="import", contact_name="Aras İthalat", grand_total=300, gib_status="İthalat"),
        _inv(_id="im2", invoice_number="AR-M2", invoice_type="purchase", trade_kind="import", contact_name="Cem Aras İthal", grand_total=120, issue_date="2026-01-20", gib_status="İthalat iki"),
        _inv(_id="disp", invoice_number="AR-D", invoice_type="dispatch", e_type="e_dispatch", contact_name="Aras Sevk", grand_total=50, gib_status="İrsaliye"),
        _inv(_id="cancel", invoice_number="AR-C", contact_name="Aras İptal", status="cancelled", grand_total=60, gib_status="Taslak"),
        _inv(_id="gib-cancel", invoice_number="AR-K", contact_name="Aras Durum", status="approved", gib_status="İptal edildi", grand_total=55),
        _inv(_id="foreign", company_id=OTHER, invoice_number="AR-Z", contact_name="Aras Yabancı", grand_total=9999),
    ]


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
        self.db.log.append(("find", self.name, copy.deepcopy(query), copy.deepcopy(projection)))
        return MemCursor(self._match(query))

    async def find_one(self, query=None, projection=None):
        self.db.log.append(("find_one", self.name, copy.deepcopy(query)))
        rows = self._match(query)
        return copy.deepcopy(rows[0]) if rows else None

    async def update_one(self, *args, **kwargs):
        self.db.writes.append(("update_one", self.name))

    async def insert_one(self, *args, **kwargs):
        self.db.writes.append(("insert_one", self.name))

    async def delete_one(self, *args, **kwargs):
        self.db.writes.append(("delete_one", self.name))

    async def update_many(self, *args, **kwargs):
        self.db.writes.append(("update_many", self.name))

    async def insert_many(self, *args, **kwargs):
        self.db.writes.append(("insert_many", self.name))

    async def delete_many(self, *args, **kwargs):
        self.db.writes.append(("delete_many", self.name))

    async def replace_one(self, *args, **kwargs):
        self.db.writes.append(("replace_one", self.name))


class MemDB:
    def __init__(self, invoices):
        self.log = []
        self.writes = []
        self.invoices = MemColl(self, "invoices", invoices)

    def __getattr__(self, name):
        coll = MemColl(self, name, [])
        setattr(self, name, coll)
        return coll


def _db():
    invoices = copy.deepcopy(_seed())
    return MemDB(invoices), invoices


def _run(coro):
    return asyncio.run(coro)


def _ids(rows):
    return [row.get("id") for row in rows]


def reference(docs, **kwargs):
    """Ön süzgeç yok: firma kümesi üstünde aynı Python filtre ve sıra."""
    kwargs = dict(kwargs)
    kwargs.setdefault("today", TODAY)
    rows = []
    for doc in docs:
        if str(doc.get("company_id") or "") != CID:
            continue
        rows.append(page.lite_invoice(copy.deepcopy(doc)))
    return page.select_invoices(rows, **kwargs)


def _sample(**over):
    base = dict(
        q="ar",
        pay="all",
        etype="all",
        date_from="2026-01-01",
        date_to="2026-12-31",
        min_amount="10",
        max_amount="9000",
        show_cancelled=False,
        contact_id="",
        today=TODAY,
    )
    base.update(over)
    return base


async def _collect(db, page_size=2, **kwargs):
    page_n = 1
    items = []
    bodies = []
    while page_n < 40:
        body = await page.list_invoices_paged(db, CID, page=page_n, page_size=page_size, **kwargs)
        bodies.append(body)
        items.extend(body["items"])
        if not body["has_more"]:
            return items, bodies
        page_n += 1
    raise AssertionError("sayfa döngüsü kapanmadı")


@pytest.mark.parametrize("tab", TABS)
@pytest.mark.parametrize("sort", SORTS)
def test_paged_union_matches_reference(tab, sort):
    db, invoices = _db()
    spec = _sample(tab=tab, sort=sort)
    expected = reference(invoices, **spec)

    async def _go():
        db.writes.clear()
        items, bodies = await _collect(db, page_size=2, **{k: v for k, v in spec.items()})
        plain = await page.list_invoices_unpaged(db, CID, **{k: v for k, v in spec.items()})
        return items, bodies, plain

    items, bodies, plain = _run(_go())
    assert _ids(items) == _ids(expected)
    assert _ids(plain) == _ids(expected)
    assert expected, f"{tab} {sort} örnek filtre boş kaldı"
    assert bodies[0]["summary"]["count"] == len(expected)
    assert bodies[0]["summary"]["total_amount"] == page.summarize(expected)["total_amount"]
    assert bodies[0]["summary"]["draft_count"] == page.summarize(expected)["draft_count"]
    assert bodies[0]["summary"]["approved_count"] == page.summarize(expected)["approved_count"]
    assert bodies[0]["total"] == len(expected)
    assert all("items" not in row for row in items)
    assert db.writes == []
    assert invoices[0]["items"][0]["name"] == "Kalem"


def test_summary_is_full_set_not_the_page_slice():
    db, invoices = _db()
    spec = _sample(tab="all", sort="amount_desc")
    expected = reference(invoices, **spec)

    async def _go():
        body = await page.list_invoices_paged(db, CID, page=1, page_size=1, **spec)
        return body

    body = _run(_go())
    assert len(body["items"]) == 1
    assert body["summary"]["count"] == len(expected) > 1
    assert body["summary"]["total_amount"] == page.summarize(expected)["total_amount"]
    usd = next(row for row in expected if row["id"] == "s-usd")
    assert page.row_display_amount(usd) == 250
    assert body["has_more"] is True


def test_cancelled_hidden_overdue_and_turkish_search():
    db, invoices = _db()

    async def _go():
        hidden = await page.list_invoices_unpaged(db, CID, tab="all", sort="number_asc", today=TODAY)
        shown = await page.list_invoices_unpaged(db, CID, tab="all", sort="number_asc", show_cancelled=True, today=TODAY)
        late = await page.list_invoices_unpaged(db, CID, tab="sales", pay="overdue", today=TODAY, sort="date_desc")
        folded = await page.list_invoices_unpaged(db, CID, tab="sales", q="celik", today=TODAY)
        turkish = await page.list_invoices_unpaged(db, CID, tab="sales", q="çelik", today=TODAY)
        note = await page.list_invoices_unpaged(db, CID, tab="sales", q="ÖZEL", today=TODAY)
        sales = await page.list_invoices_unpaged(db, CID, tab="sales", today=TODAY)
        incoming = await page.list_invoices_unpaged(db, CID, tab="incoming", today=TODAY)
        outgoing = await page.list_invoices_unpaged(db, CID, tab="outgoing_gib", today=TODAY)
        return hidden, shown, late, folded, turkish, note, sales, incoming, outgoing

    hidden, shown, late, folded, turkish, note, sales, incoming, outgoing = _run(_go())
    hidden_ids = set(_ids(hidden))
    assert "cancel" not in hidden_ids
    assert "gib-cancel" not in hidden_ids
    assert "disp" not in hidden_ids
    assert {"cancel", "gib-cancel"} <= set(_ids(shown))
    assert _ids(late) == ["s-celik"]
    assert _ids(folded) == []
    assert _ids(turkish) == ["s-celik"]
    assert _ids(note) == ["s-note"]
    sales_ids = set(_ids(sales))
    assert "s-gib" not in sales_ids and "p-in" not in sales_ids and "s-cem" in sales_ids
    assert set(_ids(incoming)) == {"p-in", "p-in2"}
    assert set(_ids(outgoing)) == {"s-gib", "s-gib2"}
    assert "foreign" not in hidden_ids


def test_sort_tie_breaks_on_id_and_contact_tr_order():
    db, _invoices = _db()

    async def _go():
        dated = await page.list_invoices_unpaged(db, CID, tab="sales", q="AR-T", sort="date_desc", today=TODAY)
        dated_asc = await page.list_invoices_unpaged(db, CID, tab="sales", q="AR-T", sort="date_asc", today=TODAY)
        names = await page.list_invoices_unpaged(
            db, CID, tab="sales", contact_id="", q="", sort="contact_asc", today=TODAY,
            show_cancelled=False,
        )
        return dated, dated_asc, names

    dated, dated_asc, names = _run(_go())
    assert _ids(dated) == ["s-tie-a", "s-tie-b"]
    assert _ids(dated_asc) == ["s-tie-a", "s-tie-b"]
    ordered = [row["contact_name"] for row in names]
    assert ordered.index("Cem Aras") < ordered.index("Çelik Aras")


def test_page_size_caps_and_zero_is_422_and_ids_match():
    db, invoices = _db()
    spec = _sample(tab="all", sort="number_asc")
    expected = reference(invoices, **spec)

    async def _go():
        wide = await page.list_invoices_paged(db, CID, page=1, page_size=250, **spec)
        tiny = None
        try:
            await page.list_invoices_paged(db, CID, page=1, page_size=0, **spec)
        except HTTPException as exc:
            tiny = exc.status_code
        bad = None
        try:
            await page.list_invoices_paged(db, CID, page=0, page_size=-3, **spec)
        except HTTPException as exc:
            bad = exc.status_code
        ids_body = await page.list_invoice_ids(db, CID, **spec)
        paged, _bodies = await _collect(db, page_size=3, **spec)
        return wide, tiny, bad, ids_body, paged

    wide, tiny, bad, ids_body, paged = _run(_go())
    assert wide["page_size"] == 200
    assert wide["page"] == 1
    assert tiny == 422
    assert bad == 422
    assert ids_body["ids"] == _ids(expected)
    assert ids_body["total"] == len(expected)
    assert _ids(paged) == ids_body["ids"]
    assert "items" not in wide["items"][0]


def test_other_company_forbidden_and_get_does_not_write():
    db, invoices = _db()
    before = copy.deepcopy(invoices)
    user_a = {"id": "u1", "company_ids": [CID], "active_company_id": CID}
    user_b = {"id": "u2", "company_ids": [OTHER], "active_company_id": OTHER}

    async def _go():
        db.writes.clear()
        db.log.clear()
        own = await page.list_invoices_page_for_user(db, user_a, CID, page=1, page_size=50, tab="all", today=TODAY)
        foreign = await page.list_invoices_page_for_user(db, user_b, page=1, page_size=20, tab="all", today=TODAY)
        denied = None
        try:
            await page.list_invoices_page_for_user(db, user_b, CID, page=1, page_size=20, tab="all")
        except HTTPException as exc:
            denied = exc.status_code
        return own, foreign, denied, list(db.writes), list(db.log)

    own, foreign, denied, writes, log = _run(_go())
    assert "foreign" not in _ids(own["items"])
    assert _ids(foreign["items"]) == ["foreign"]
    assert denied == 403
    assert writes == []
    assert log and all(kind == "find" and name == "invoices" for kind, name, *_rest in log)
    assert invoices == before
    src = Path(__file__).resolve().parents[1].joinpath("invoice_list_page.py").read_text(encoding="utf-8")
    for bad_name in ("update_one", "insert_one", "delete_one", "update_many", "insert_many", "delete_many", "replace_one", "$set"):
        assert bad_name not in src


def test_route_is_separate_from_legacy_list_and_requires_user():
    import server

    root = Path(__file__).resolve().parents[1]
    server_src = (root / "server.py").read_text(encoding="utf-8")
    legacy = server_src.split("async def list_invoices(", 1)[1].split("async def ", 1)[0]
    assert "invoice_list_page" not in legacy
    assert server_src.index('@api_router.get("/invoices/page")') < server_src.index('@api_router.get("/invoices/{invoice_id}")')
    assert server_src.index('@api_router.get("/invoices/page/ids")') < server_src.index('@api_router.get("/invoices/{invoice_id}")')

    db, invoices = _db()
    before = copy.deepcopy(invoices)
    user_a = {"id": "u1", "company_ids": [CID], "active_company_id": CID}
    user_b = {"id": "u2", "company_ids": [OTHER], "active_company_id": OTHER}

    async def _go():
        with patch.object(server, "db", db):
            db.writes.clear()
            body = await server.list_invoices_page(
                company_id=CID, tab="sales", page=1, page_size=2, sort="contact_asc", user=user_a,
            )
            ids_body = await server.list_invoices_page_ids(company_id=CID, tab="sales", sort="contact_asc", user=user_a)
            denied = None
            try:
                await server.list_invoices_page(company_id=CID, page=1, page_size=10, user=user_b)
            except HTTPException as exc:
                denied = exc.status_code
            legacy_rows = await server.list_invoices(company_id=CID, user=user_a)
            return body, ids_body, denied, legacy_rows, list(db.writes)

    body, ids_body, denied, legacy_rows, writes = _run(_go())
    assert isinstance(legacy_rows, list)
    assert body["page_size"] == 2
    assert body["summary"]["count"] == len(ids_body["ids"])
    assert _ids(body["items"]) == ids_body["ids"][:2]
    assert all("items" not in row for row in body["items"])
    assert denied == 403
    assert writes == []
    assert invoices == before


def _mysql_settings():
    url = (os.environ.get("TAMKOBI_TEST_MYSQL_URL") or "").strip()
    if not url:
        pytest.skip("TAMKOBI_TEST_MYSQL_URL yok")
    if url.startswith("mysql+"):
        url = "mysql://" + url.split("://", 1)[1]
    if not url.startswith("mysql://"):
        pytest.skip("TAMKOBI_TEST_MYSQL_URL mysql değil")
    parsed = urlparse(url)
    name = (parsed.path or "").lstrip("/").split("?")[0]
    if "test" not in name.lower():
        pytest.skip("hedef veritabanı adı test içermiyor")
    return {
        "host": parsed.hostname or "127.0.0.1",
        "port": parsed.port or 3306,
        "user": unquote(parsed.username or ""),
        "password": unquote(parsed.password or ""),
        "db": name,
        "charset": "utf8mb4",
        "autocommit": True,
    }


def _require_mysql():
    settings = _mysql_settings()
    import pymysql
    try:
        conn = pymysql.connect(
            host=settings["host"],
            port=int(settings["port"]),
            user=settings["user"],
            password=settings["password"],
            database=settings["db"],
            charset="utf8mb4",
            connect_timeout=3,
        )
    except (pymysql.err.OperationalError, ConnectionRefusedError, ConnectionError, OSError):
        pytest.skip("MySQL test sunucusu yok")
    else:
        conn.close()
    return settings


def test_mysql_pushdown_on_and_off_match():
    settings = _require_mysql()
    from mysql_store import MySQLDatabase

    cid = "c-ipage-" + uuid.uuid4().hex[:10]
    other = "c-ipage-x-" + uuid.uuid4().hex[:8]
    rows = []
    for doc in _seed():
        row = copy.deepcopy(doc)
        row["company_id"] = cid if doc["company_id"] == CID else other
        rows.append(row)
    mem = MemDB(copy.deepcopy(rows))

    async def _expected():
        return await page.list_invoices_unpaged(mem, cid, tab="all", q="çelik", sort="amount_desc", today=TODAY)

    expected = _run(_expected())
    expected_ids = _ids(expected)

    async def _go():
        db = MySQLDatabase({**settings, "charset": "utf8mb4", "autocommit": True})
        await db._ensure()
        previous = os.environ.get("MYSQL_STORE_SQL_PUSHDOWN")
        try:
            for doc in rows:
                await db.invoices.insert_one(doc)
            sample_id = rows[0]["_id"]
            before = await db.invoices.find_one({"_id": sample_id})
            results = []
            for flag in ("0", "1"):
                os.environ["MYSQL_STORE_SQL_PUSHDOWN"] = flag
                body = await page.list_invoices_paged(
                    db, cid, page=1, page_size=1, tab="sales", q="aras", sort="contact_asc", today=TODAY,
                )
                full = await page.list_invoices_unpaged(db, cid, tab="sales", q="aras", sort="contact_asc", today=TODAY)
                outgoing = await page.list_invoices_unpaged(db, cid, tab="outgoing_gib", sort="number_asc", today=TODAY)
                results.append((flag, _ids(full), body, _ids(outgoing)))
            after = await db.invoices.find_one({"_id": sample_id})
            return results, before, after
        finally:
            if previous is None:
                os.environ.pop("MYSQL_STORE_SQL_PUSHDOWN", None)
            else:
                os.environ["MYSQL_STORE_SQL_PUSHDOWN"] = previous
            await db.invoices.delete_many({"company_id": cid})
            await db.invoices.delete_many({"company_id": other})
            await db.close()

    results, before, after = _run(_go())
    assert expected_ids == ["s-celik"]
    seen = {}
    for flag, ids, body, outgoing_ids in results:
        assert ids
        assert body["summary"]["count"] == len(ids)
        assert _ids(body["items"]) == ids[:1]
        assert "s-gib" not in ids
        assert outgoing_ids == ["s-gib", "s-gib2"]
        seen[flag] = (ids, outgoing_ids, body["summary"]["total_amount"])
    assert seen["0"] == seen["1"]
    assert before.get("items")
    assert before.get("grand_total") == after.get("grand_total")
    assert before.get("contact_name") == after.get("contact_name")
