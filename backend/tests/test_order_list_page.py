"""Sipariş listesi: sayfalı birleşim sayfasız küme ile aynı.

Arama, durum, kanal, fatura, kargo, tarih, cari ve sıralama sayfadan önce
uygulanır. Tutar özeti sayfa diliminin değil, filtrelenmiş kümenin toplamıdır.
Başka firmanın siparişi gelmez. GET yazmaz.

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
from urllib.parse import unquote, urlparse

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import order_list_page as page  # noqa: E402
from mysql_store import match_query, sort_docs  # noqa: E402
from order_list_filter import order_display_amount  # noqa: E402

CID = "c-orders-1"
OTHER = "c-orders-2"


def _order(**kwargs):
    doc = {
        "company_id": CID,
        "order_number": "ORD",
        "customer_name": "Müşteri",
        "order_status": "pending",
        "channel": "b2b",
        "order_date": "2026-10-16T10:00:00Z",
        "currency": "TRY",
        "grand_total": 0,
        "total_amount": 0,
        "items": [],
    }
    doc.update(kwargs)
    doc["_id"] = kwargs["_id"]
    return doc


def _seed():
    return [
        _order(_id="b2", order_number="ORD-B", customer_name="Ada Şişe", order_status="pending", channel="b2b", order_date="2026-10-16T10:00:00Z", grand_total=100, total_amount=100, items=[{"product_name": "Şişe", "quantity": 2, "sku": "S1"}]),
        _order(_id="a1", order_number="ORD-A", customer_name="Bora", order_status="shipped", channel="trendyol", order_date="2026-10-16T10:00:00Z", grand_total=40, total_amount=40, cargo_tracking_number="TRK1", marketplace_status="shipped", customer_phone="555"),
        _order(_id="c3", order_number="ORD-C", customer_name="Cem", order_status="cancelled", channel="b2b", order_date="2026-10-15T10:00:00Z", grand_total=21, total_amount=21),
        _order(_id="d4", order_number="ORD-D", customer_name="Deniz", order_status="pending", channel="manual", order_date="2026-10-15T22:00:00Z", grand_total=15, total_amount=15),
        _order(_id="e5", order_number="ORD-E", customer_name="Sepet", order_status="active_cart", channel="b2b", order_date="2026-10-16T12:00:00Z", grand_total=1, total_amount=1, is_active_cart=True, source="b2b_active_cart"),
        _order(_id="f6", order_number="ORD-F", customer_name="Bekleyen", order_status="pending", channel="b2b", order_date="2026-10-16T11:00:00Z", grand_total=7, total_amount=7, source="b2b_held_cart", held_seq=2),
        _order(_id="g7", order_number="ORD-G", customer_name="Gül", order_status="pending", channel="n11", order_date="2026-10-16T09:00:00Z", grand_total=80, total_amount=80, invoice_id="inv-g", is_invoiced=True, invoice_e_type="e_invoice", einvoice_state="accepted"),
        _order(_id="h8", company_id=OTHER, order_number="ORD-H", customer_name="Ada Şişe", order_status="pending", channel="b2b", order_date="2026-10-16T10:00:00Z", grand_total=99999, total_amount=99999, items=[{"product_name": "Şişe", "quantity": 1}]),
        _order(_id="i9", order_number="ORD-I", customer_name="İptal Talep", order_status="pending", channel="b2b", order_date="2026-10-16T08:00:00Z", grand_total=5, total_amount=5, cancel_request={"status": "pending"}),
        _order(_id="j0", order_number="ORD-J", customer_name="Yarın", order_status="pending", channel="saha", order_date="2026-10-16T21:30:00Z", grand_total=3, total_amount=3),
        _order(_id="k1", order_number="ORD-K", customer_name="Ada Şişe", order_status="pending", channel="b2b", order_date="2026-10-16T10:00:00Z", grand_total=100, total_amount=100, items=[{"product_name": "Kutu", "quantity": 1}]),
        _order(_id="u2", order_number="ORD-U", customer_name="Taslak", order_status="pending", channel="b2b", order_date="2026-10-14T10:00:00Z", grand_total=9, total_amount=9, invoice_id="inv-u", invoice_e_type="e_archive", einvoice_state="draft"),
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
    def __init__(self, orders):
        self.log = []
        self.writes = []
        self.orders = MemColl(self, "orders", orders)
        self._extra = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._extra.get(name)
        if coll is None:
            coll = MemColl(self, name, [])
            self._extra[name] = coll
        return coll


def _db():
    orders = _seed()
    return MemDB(copy.deepcopy(orders)), orders


def _run(coro):
    return asyncio.run(coro)


def _ids(rows):
    return [row.get("id") for row in rows]


def _money(rows):
    return round(sum(order_display_amount(row) for row in rows), 2)


async def _collect(db, page_size=2, **kwargs):
    page_n = 1
    items = []
    bodies = []
    while page_n < 40:
        body = await page.list_orders_paged(db, CID, page=page_n, page_size=page_size, **kwargs)
        bodies.append(body)
        items.extend(body["items"])
        if not body["has_more"]:
            return items, bodies
        page_n += 1
    raise AssertionError("sayfa döngüsü kapanmadı")


CASES = [
    {},
    {"q": "şişe"},
    {"q": "SISE"},
    {"q": "ada"},
    {"status": "pending"},
    {"status": "shipped"},
    {"status": "held_cart"},
    {"status": "active_cart"},
    {"status": "incoming"},
    {"status": "cancelled"},
    {"status": "dispatched"},
    {"channel": "n11"},
    {"channel": "trendyol"},
    {"channel": "b2b"},
    {"invoiced": "yes"},
    {"invoiced": "no"},
    {"invoiced": "einvoice"},
    {"invoiced": "einvoice_unsent"},
    {"cargo": "yes"},
    {"cargo": "no"},
    {"doc_status": "invoiced"},
    {"doc_status": "draft,cancelled"},
    {"date_from": "2026-10-16", "date_to": "2026-10-16"},
    {"customer": "Ada Şişe"},
    {"sort": "date_asc"},
    {"sort": "amount_desc"},
    {"sort": "amount_asc"},
    {"sort": "customer"},
    {"sort": "customer_desc"},
    {"sort": "number"},
    {"sort": "number_asc"},
    {"sort": "status_asc"},
    {"sort": "items_desc"},
    {"cancel_request": "pending"},
    {"scope": "cancellations"},
    {"include_active_cart": True},
    {"q": "ada", "status": "pending", "channel": "b2b", "sort": "amount_desc"},
    {"date_from": "2026-10-16", "date_to": "2026-10-16", "status": "pending", "cargo": "no"},
]


@pytest.mark.parametrize("spec", CASES, ids=lambda s: ",".join(f"{k}={v}" for k, v in s.items()) or "default")
def test_paged_union_matches_unpaged(spec):
    db, orders = _db()
    before = copy.deepcopy(orders)
    kwargs = dict(spec)

    async def _go():
        db.log.clear()
        full = await page.list_orders_unpaged(db, CID, **kwargs)
        items, bodies = await _collect(db, page_size=2, **kwargs)
        tail = await page.list_orders_paged(db, CID, page=99, page_size=2, **kwargs)
        return full, items, bodies, tail, list(db.log)

    full, items, bodies, tail, finds = _run(_go())
    assert _ids(items) == _ids(full)
    assert "h8" not in set(_ids(items))
    assert all(row.get("company_id") == CID for row in items)
    amount = _money(full)
    assert bodies, "en az bir sayfa"
    for body in bodies:
        assert body["total"] == len(full)
        assert body["summary"]["count"] == len(full)
        assert body["summary"]["total_amount"] == amount
        assert body["has_more"] == (body["page"] * body["page_size"] < body["total"] or False)
        assert body["page_size"] == 2
    assert tail["items"] == []
    assert tail["total"] == len(full)
    assert tail["summary"]["total_amount"] == amount
    assert finds
    for kind, name, query in finds:
        if kind == "find" and name == "orders":
            assert query.get("company_id") == CID
            assert "$or" not in query
    assert db.writes == []
    assert orders == before
    if items:
        items[0]["grand_total"] = -123456
        assert orders == before


def test_summary_is_filtered_set_not_the_page_slice():
    db, orders = _db()
    before = copy.deepcopy(orders)

    async def _go():
        one = await page.list_orders_paged(db, CID, page=1, page_size=1)
        wide = await page.list_orders_paged(db, CID, page=1, page_size=50, sort="amount_desc")
        day = await page.list_orders_paged(db, CID, page=1, page_size=50, date_from="2026-10-16", date_to="2026-10-16")
        return one, wide, day

    one, wide, day = _run(_go())
    assert len(one["items"]) == 1
    assert one["total"] == 9
    assert one["summary"]["count"] == 9
    assert one["summary"]["total_amount"] == 359
    assert one["summary"]["total_amount"] != order_display_amount(one["items"][0])
    assert one["summary"]["closed_count"] == 0
    assert one["summary"]["pool_closed_count"] >= 1
    assert _ids(wide["items"])[:2] == ["b2", "k1"]
    assert wide["summary"]["total_amount"] == 359
    assert "j0" not in _ids(day["items"])
    assert "d4" in _ids(day["items"])
    assert "c3" not in _ids(day["items"])
    assert day["has_more"] is False
    assert day["summary"]["total_amount"] == _money(day["items"])
    assert db.writes == []
    assert orders == before


def test_same_date_breaks_ties_by_id():
    db, _orders = _db()

    async def _go():
        desc = await page.list_orders_paged(db, CID, page=1, page_size=50, sort="date_desc")
        asc = await page.list_orders_paged(db, CID, page=1, page_size=50, sort="date_asc")
        return desc, asc

    desc, asc = _run(_go())
    ids = _ids(desc["items"])
    trio = [i for i in ids if i in {"a1", "b2", "k1"}]
    assert trio == ["a1", "b2", "k1"]
    assert _ids(asc["items"]) != ids
    assert db.writes == []


def test_queries_stay_inside_company_and_do_not_write():
    db, orders = _db()

    async def _go():
        db.log.clear()
        await page.list_orders_paged(db, CID, page=1, page_size=20, q="şişe", status="pending", sort="amount_asc")
        return list(db.log)

    finds = _run(_go())
    assert finds
    assert {name for kind, name, _q in finds if kind == "find"} <= {"orders"}
    for kind, name, query in finds:
        if name == "orders":
            assert query.get("company_id") == CID
            assert "$or" not in (query or {})
    assert db.writes == []
    assert all(doc.get("grand_total") != -1 for doc in orders)


def test_other_company_is_forbidden_and_page_size_caps():
    db, orders = _db()
    user_c1 = {"id": "u1", "company_ids": [CID], "active_company_id": CID}
    user_c2 = {"id": "u2", "company_ids": [OTHER], "active_company_id": OTHER}

    async def _go():
        own = await page.list_orders_for_user(db, user_c1, CID, paged=True, page=1, page_size=500)
        plain = await page.list_orders_for_user(db, user_c1, None, paged=False)
        foreign = await page.list_orders_for_user(db, user_c2, paged=False)
        denied = None
        try:
            await page.list_orders_for_user(db, user_c2, CID, paged=True, page=1, page_size=20)
        except HTTPException as exc:
            denied = exc.status_code
        exported = await page.list_orders_paged(db, CID, page=3, page_size=1, export=True)
        return own, plain, foreign, denied, exported

    own, plain, foreign, denied, exported = _run(_go())
    assert own["page_size"] == 200
    assert _ids(own["items"]) == _ids(plain)
    assert "h8" not in set(_ids(plain))
    assert _ids(foreign) == ["h8"]
    assert denied == 403
    assert exported["page"] == 1
    assert exported["page_size"] == page.FETCH_CAP
    assert exported["total"] == len(plain)
    assert len(exported["items"]) == len(plain)
    assert db.writes == []
    assert orders[0]["grand_total"] == 100


def test_unpaged_route_stays_an_array_and_module_does_not_write():
    root = Path(__file__).resolve().parents[1]
    server_src = (root / "server.py").read_text(encoding="utf-8")
    src = (root / "order_list_page.py").read_text(encoding="utf-8")
    assert 'orders = await db.orders.find(query).sort("order_date", -1).to_list(500)' in server_src
    assert "if page is not None or page_size is not None:" in server_src
    assert "if paged or (export and page is None and page_size is None):" in server_src
    for bad in ("update_one", "insert_one", "delete_one", "update_many", "insert_many", "delete_many", "$set", "replace_one"):
        assert bad not in src


def test_get_without_page_is_a_list_and_page_does_not_write():
    import server
    from unittest.mock import AsyncMock, patch

    db, _orders = _db()
    user = {"id": "u1", "company_ids": [CID], "active_company_id": CID}

    async def _go():
        with patch.object(server, "db", db), patch.object(server, "get_current_user", AsyncMock(return_value=user)):
            missing = None
            try:
                await server.list_orders(company_id=CID, page=1, page_size=2, user=None)
            except HTTPException as exc:
                missing = exc.status_code
            array = await server.list_orders(company_id=CID, user=user)
            paged = await server.list_orders(company_id=CID, page=1, page_size=2, user=user)
            legacy = await server.list_orders(company_id=CID, paged=True, page=1, page_size=2, user=user)
            return missing, array, paged, legacy

    missing, array, paged, legacy = _run(_go())
    assert missing == 401
    assert isinstance(array, list)
    assert isinstance(paged, dict)
    assert "summary" in paged
    assert paged["summary"]["total_amount"] == paged["summary"]["total_amount"]
    assert paged["total"] >= len(paged["items"])
    assert isinstance(legacy, dict)
    assert "items" in legacy
    assert db.writes == []


def _stock_match_pairs(body):
    out = {}
    for row in body.get("items") or []:
        out[row.get("id")] = [
            (str((it or {}).get("product_id") or ""), str((it or {}).get("matched_product_name") or ""))
            for it in (row.get("items") or [])
            if isinstance(it, dict)
        ]
    return out


def _stock_match_db(orders, products):
    db = MemDB(copy.deepcopy(orders))
    db.products = MemColl(db, "products", copy.deepcopy(products))
    return db


def _product_finds(db):
    return [query for kind, name, query in db.log if kind == "find" and name == "products"]


def test_page_stock_match_matches_legacy_paged_without_writing():
    """Barkodu eşleşen pazaryeri satırı sayfalı yanıtta paged=1 ile aynı adı alır. Yazma yok."""
    import server
    from unittest.mock import AsyncMock, patch

    barcode = "8690001112223"
    foreign_barcode = "8690009998887"
    bare_item = {"barcode": barcode, "product_name": "Pazar Adı", "quantity": 1, "sku": ""}
    orders = [
        _order(_id="mp1", order_number="MP-1", channel="trendyol", customer_name="Pazar", order_date="2026-10-16T12:00:00Z", grand_total=10, total_amount=10, items=[{**bare_item, "product_id": ""}]),
        _order(_id="mp2", order_number="MP-2", channel="hepsiburada", customer_name="Pazar İki", order_date="2026-10-16T11:00:00Z", grand_total=11, total_amount=11, items=[{**bare_item, "product_name": "İkinci"}]),
        _order(_id="mpx", order_number="MP-X", channel="n11", customer_name="Yabancı Barkod", order_date="2026-10-16T10:30:00Z", grand_total=4, total_amount=4, items=[{"barcode": foreign_barcode, "product_name": "Başka Firma", "quantity": 1, "product_id": ""}]),
        _order(_id="b2b1", order_number="B-1", channel="b2b", customer_name="Bayi", order_date="2026-10-16T10:00:00Z", grand_total=8, total_amount=8, items=[{**bare_item, "product_name": "Bayi Kalem", "product_id": ""}]),
        _order(_id="man1", order_number="M-1", channel="manual", customer_name="Elle", order_date="2026-10-16T09:00:00Z", grand_total=6, total_amount=6, items=[{**bare_item, "product_name": "Elle Kalem"}]),
        _order(_id="saha1", order_number="S-1", channel="saha", customer_name="Saha", order_date="2026-10-16T08:00:00Z", grand_total=5, total_amount=5, items=[{**bare_item, "product_name": "Saha Kalem"}]),
        _order(_id="other1", company_id=OTHER, order_number="X-1", channel="trendyol", customer_name="Başka", order_date="2026-10-16T12:00:00Z", grand_total=999, total_amount=999, items=[{**bare_item, "product_id": ""}]),
    ]
    products = [
        {"_id": "prod_ours", "company_id": CID, "name": "Bizim Ürün", "barcode": barcode, "sku": "SKU-1"},
        {"_id": "prod_theirs", "company_id": OTHER, "name": "Onların Ürünü", "barcode": barcode, "sku": "SKU-X"},
        {"_id": "prod_foreign_only", "company_id": OTHER, "name": "Yabancı Kart", "barcode": foreign_barcode, "sku": "SKU-Y"},
    ]
    user = {"id": "u1", "company_ids": [CID], "active_company_id": CID}
    db = _stock_match_db(orders, products)
    before = copy.deepcopy(db.orders.docs)

    async def _page():
        with patch.object(server, "db", db), patch.object(server, "get_current_user", AsyncMock(return_value=user)):
            db.log.clear()
            db.writes.clear()
            body = await server.list_orders(company_id=CID, page=1, page_size=50, user=user)
            await asyncio.sleep(0)
            return body, list(db.writes), _product_finds(db)

    body, writes, finds = _run(_page())
    pairs = _stock_match_pairs(body)
    assert pairs["mp1"] == [("prod_ours", "Bizim Ürün")]
    assert pairs["mp2"] == [("prod_ours", "Bizim Ürün")]
    assert pairs["mpx"] == [("", "")]
    assert pairs["b2b1"] == [("", "")]
    assert pairs["man1"] == [("", "")]
    assert pairs["saha1"] == [("", "")]
    assert "other1" not in pairs
    assert all(row.get("company_id") == CID for row in body["items"])
    assert len(finds) == 1
    assert finds[0].get("company_id") == CID
    assert writes == []
    assert db.orders.docs == before

    legacy_db = _stock_match_db(orders, products)

    async def _legacy():
        with patch.object(server, "db", legacy_db):
            return await server.list_orders(company_id=CID, paged=True, page=1, page_size=50, user=user)

    legacy_pairs = _stock_match_pairs(_run(_legacy()))
    for oid in ("mp1", "mp2", "mpx", "b2b1", "man1", "saha1"):
        assert pairs[oid] == legacy_pairs[oid]
    assert "other1" not in legacy_pairs


def test_page_stock_match_skips_orders_outside_the_slice():
    """Eşleme yalnız dönen dilimde. Dilimde pazaryeri yoksa ürün indeksi yüklenmez."""
    import server
    from unittest.mock import AsyncMock, patch

    barcode = "8690001112223"
    orders = [
        _order(_id="b2b-new", order_number="B-NEW", channel="b2b", customer_name="Bayi", order_date="2026-10-16T18:00:00Z", grand_total=8, total_amount=8, items=[{"barcode": barcode, "product_name": "Bayi Kalem", "quantity": 1, "product_id": ""}]),
        _order(_id="mp-old", order_number="MP-OLD", channel="trendyol", customer_name="Pazar", order_date="2026-10-16T08:00:00Z", grand_total=10, total_amount=10, items=[{"barcode": barcode, "product_name": "Pazar Adı", "quantity": 1, "product_id": ""}]),
        _order(_id="mp-older", order_number="MP-OLDER", channel="n11", customer_name="Pazar Eski", order_date="2026-10-15T08:00:00Z", grand_total=9, total_amount=9, items=[{"barcode": barcode, "product_name": "Eski", "quantity": 1}]),
    ]
    products = [
        {"_id": "prod_ours", "company_id": CID, "name": "Bizim Ürün", "barcode": barcode, "sku": "SKU-1"},
    ]
    user = {"id": "u1", "company_ids": [CID], "active_company_id": CID}

    async def _one(page_n):
        db = _stock_match_db(orders, products)
        before = copy.deepcopy(db.orders.docs)
        with patch.object(server, "db", db), patch.object(server, "get_current_user", AsyncMock(return_value=user)):
            db.log.clear()
            db.writes.clear()
            body = await server.list_orders(company_id=CID, page=page_n, page_size=1, user=user)
            await asyncio.sleep(0)
            return body, list(db.writes), _product_finds(db), db.orders.docs == before

    async def _go():
        first = await _one(1)
        second = await _one(2)
        return first, second

    first, second = _run(_go())
    page1, writes1, finds1, intact1 = first
    page2, writes2, finds2, intact2 = second
    assert _ids(page1["items"]) == ["b2b-new"]
    assert _stock_match_pairs(page1)["b2b-new"] == [("", "")]
    assert finds1 == []
    assert writes1 == []
    assert intact1
    assert _ids(page2["items"]) == ["mp-old"]
    assert _stock_match_pairs(page2)["mp-old"] == [("prod_ours", "Bizim Ürün")]
    assert len(finds2) == 1
    assert finds2[0].get("company_id") == CID
    assert writes2 == []
    assert intact2


# --- MySQL: iki pushdown modu. Canlı DSN okunmaz. -------------------------


def _mysql_settings():
    url = (os.environ.get("TAMKOBI_TEST_MYSQL_URL") or "").strip()
    if not url:
        pytest.skip("TAMKOBI_TEST_MYSQL_URL yok")
    if url.startswith("mysql+"):
        url = "mysql://" + url.split("://", 1)[1]
    if not url.startswith("mysql://"):
        pytest.skip("TAMKOBI_TEST_MYSQL_URL mysql değil")
    parsed = urlparse(url)
    return {
        "host": parsed.hostname or "127.0.0.1",
        "port": parsed.port or 3306,
        "user": unquote(parsed.username or "tamkobi"),
        "password": unquote(parsed.password or ""),
        "db": (parsed.path or "").lstrip("/").split("?")[0],
        "charset": "utf8mb4",
        "autocommit": True,
    }


def _require_mysql():
    settings = _mysql_settings()
    name = str(settings.get("db") or "").lower()
    if "test" not in name and "pushdown" not in name:
        pytest.skip("hedef veritabanı adı test veya pushdown içermiyor")
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

    cid = "c-opage-" + uuid.uuid4().hex[:10]
    other = "c-opage-x-" + uuid.uuid4().hex[:8]
    rows = []
    for doc in _seed():
        row = copy.deepcopy(doc)
        row["company_id"] = cid if doc["company_id"] == CID else other
        rows.append(row)
    mem = MemDB(copy.deepcopy(rows))

    async def _expected():
        return await page.list_orders_unpaged(mem, cid, q="şişe", sort="amount_desc")

    expected = _run(_expected())
    expected_ids = _ids(expected)
    expected_amount = _money(expected)

    async def _go():
        db = MySQLDatabase({**settings, "charset": "utf8mb4", "autocommit": True})
        await db._ensure()
        previous = os.environ.get("MYSQL_STORE_SQL_PUSHDOWN")
        try:
            for doc in rows:
                await db.orders.insert_one(doc)
            sample_id = rows[0]["_id"]
            before = await db.orders.find_one({"_id": sample_id})
            results = []
            for flag in ("0", "1"):
                os.environ["MYSQL_STORE_SQL_PUSHDOWN"] = flag
                sqls = []
                orig = db.orders._fetch_rows

                async def _wrap(sql, params, _orig=orig, _sqls=sqls):
                    _sqls.append(" ".join(sql.split()))
                    return await _orig(sql, params)

                db.orders._fetch_rows = _wrap
                try:
                    body = await page.list_orders_paged(db, cid, page=1, page_size=2, q="şişe", sort="amount_desc")
                    full = await page.list_orders_unpaged(db, cid, q="şişe", sort="amount_desc")
                finally:
                    db.orders._fetch_rows = orig
                results.append((flag, _ids(full), body, sqls))
            after = await db.orders.find_one({"_id": sample_id})
            return results, before, after
        finally:
            if previous is None:
                os.environ.pop("MYSQL_STORE_SQL_PUSHDOWN", None)
            else:
                os.environ["MYSQL_STORE_SQL_PUSHDOWN"] = previous
            await db.orders.delete_many({"company_id": cid})
            await db.orders.delete_many({"company_id": other})
            await db.close()

    results, before, after = _run(_go())
    assert expected_ids
    seen = {}
    for flag, ids, body, sqls in results:
        assert ids == expected_ids
        assert body["summary"]["total_amount"] == expected_amount
        assert body["summary"]["count"] == len(expected_ids)
        assert len(body["items"]) <= 2
        seen[flag] = ids
        if flag == "1":
            pages = [sql for sql in sqls if "ORDER BY" in sql and "LIMIT" in sql]
            assert pages
    assert seen["0"] == seen["1"]
    assert before["grand_total"] == after["grand_total"]
    assert before["customer_name"] == after["customer_name"]
