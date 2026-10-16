"""Ürün listesi: sayfalı birleşim sayfasız küme ile aynı.

Arama, kategori, marka, depo, durum, B2B, stok seviyesi ve sıralama
sayfadan önce uygulanır. Stok değeri ve depo adetleri sayfa diliminin
değil, filtrelenmiş kümenin toplamıdır. Depo adedi kayıtlı stock_quantity'dir.
Başka firmanın ürünü gelmez. GET yazmaz.

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

import product_list_page as page  # noqa: E402
from mysql_store import match_query, sort_docs  # noqa: E402

CID = "c-products-1"
OTHER = "c-products-2"


def _product(**kwargs):
    doc = {
        "company_id": CID,
        "name": "Ürün",
        "sku": "SKU",
        "barcode": "",
        "category": "Genel",
        "brand": "",
        "type": "product",
        "unit": "Adet",
        "purchase_price": 10,
        "sale_price": 20,
        "stock_quantity": 5,
        "min_stock_alert": 5,
        "track_stock": True,
        "show_in_b2b": True,
        "is_active": True,
        "warehouse_id": "wh_main",
        "created_at": "2026-01-01T00:00:00Z",
        "variants": [],
    }
    doc.update(kwargs)
    doc["_id"] = kwargs["_id"]
    return doc


def _seed():
    return [
        _product(
            _id="ada", name="Ada Kulaklık", sku="ADA-1", barcode="111", category="Elektronik", brand="Tam",
            stock_quantity=2, min_stock_alert=5, purchase_price=10, sale_price=100, warehouse_id="wh_main",
            created_at="2026-01-02T00:00:00Z",
            variants=[{"variant_id": "v1", "stock": 7}, {"variant_id": "v2", "stock": 8}],
        ),
        _product(
            _id="ada2", name="Ada Kulaklık", sku="ADA-2", barcode="777", category="Elektronik", brand="Tam",
            stock_quantity=9, min_stock_alert=1, purchase_price=10, sale_price=50, warehouse_id="wh_main",
            created_at="2026-01-03T00:00:00Z",
        ),
        _product(
            _id="bora", name="Bora Kablo", sku="BOR-2", barcode="222", category="Aksesuar", brand="Nil",
            stock_quantity=8, min_stock_alert=1, purchase_price=4, sale_price=9, warehouse_id="wh_main",
            show_in_b2b=False, created_at="2026-03-01T00:00:00Z",
        ),
        _product(
            _id="cem", name="Cem Vida", sku="CEM-3", barcode="333", category="Hammadde", brand="Tam",
            stock_quantity=0, min_stock_alert=5, purchase_price=2, sale_price=3, warehouse_id="wh_raw",
            created_at="2026-02-01T00:00:00Z",
        ),
        _product(
            _id="deniz", name="Deniz Eksi", sku="DEN-4", barcode="444", category="Hammadde", brand="Nil",
            stock_quantity=-3, min_stock_alert=0, purchase_price=5, sale_price=1, warehouse_id="wh_raw",
            is_active=False, created_at="2026-04-01T00:00:00Z",
        ),
        _product(
            _id="efe", name="Efe Hizmet", sku="EFE-5", barcode="555", category="Hizmet", brand="",
            type="service", track_stock=False, stock_quantity=4, min_stock_alert=1, purchase_price=7,
            sale_price=11, warehouse_id="wh_main", created_at="2026-05-01T00:00:00Z",
        ),
        _product(
            _id="nil", name="Nil Şişe", sku="NIL-6", barcode="666", category="Cam", brand="Çelik",
            stock_quantity=4, min_stock_alert=4, purchase_price=8, sale_price=12, warehouse_id="wh_ank",
            created_at="2026-06-01T00:00:00Z",
        ),
        _product(
            _id="gok", name="Gök Taş", sku="GOK-7", barcode="869ABC", category="Genel", brand="Gök",
            stock_quantity=3, purchase_price=1, sale_price=2, warehouse_id="wh_main",
            created_at="2026-07-01T00:00:00Z",
        ),
        _product(
            _id="sif", name="Sıfır Eşik", sku="SIF-8", barcode="888", category="Genel", brand="Tam",
            stock_quantity=3, min_stock_alert=0, purchase_price=6, sale_price=6, warehouse_id="wh_main",
            created_at="2026-08-01T00:00:00Z",
        ),
        _product(
            _id="foreign", company_id=OTHER, name="Ada Kulaklık", sku="ADA-1", barcode="111",
            stock_quantity=999, purchase_price=100, sale_price=100, warehouse_id="wh_main",
        ),
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
        self.db.log.append(("find_one", self.name, copy.deepcopy(query), copy.deepcopy(projection)))
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
    def __init__(self, products, invoices=None):
        self.log = []
        self.writes = []
        self.products = MemColl(self, "products", products)
        self.invoices = MemColl(self, "invoices", invoices or [])

    def __getitem__(self, name):
        return getattr(self, name)


def _db():
    products = copy.deepcopy(_seed())
    return MemDB(products), products


def _run(coro):
    return asyncio.run(coro)


def _ids(rows):
    return [row.get("id") for row in rows]


def _blank(value):
    return value is None or str(value).strip() == "" or str(value).strip().lower() == "all"


def _tracked(row):
    return row.get("track_stock") is not False


def _search(row, q):
    raw = "" if q is None else str(q)
    if raw == "":
        return True
    needle = raw.lower()
    if needle in str(row.get("name") or "").lower():
        return True
    if needle in str(row.get("sku") or "").lower():
        return True
    return raw in str(row.get("barcode") or "")


def _status(row, status):
    if status in ("", "all", None):
        return True
    tracked = _tracked(row)
    qty = page.js_num(row.get("stock_quantity"))
    if status == "critical":
        return page.is_critical(row)
    if status == "out":
        return tracked and qty <= 0
    if status == "in":
        return tracked and qty > 0
    if status == "untracked":
        return not tracked
    if status == "zero":
        return tracked and qty == 0
    if status == "negative":
        return tracked and qty < 0
    return True


def _public(docs):
    out = []
    for doc in docs:
        if doc.get("company_id") != CID:
            continue
        row = copy.deepcopy(doc)
        row["id"] = str(row.pop("_id"))
        out.append(row)
    return out


def _passes_query(row, spec):
    if spec.get("type") and spec.get("type") != "all" and row.get("type") != spec.get("type"):
        return False
    if spec.get("category") and spec.get("category") != "all" and row.get("category") != spec.get("category"):
        return False
    if spec.get("b2b_only"):
        if row.get("show_in_b2b") is False or row.get("is_active") is False:
            return False
        if page.js_num(row.get("sale_price")) <= 0:
            return False
    ids = [x for x in str(spec.get("ids") or "").split(",") if x]
    skus = [x for x in str(spec.get("skus") or "").split(",") if x]
    if ids or skus:
        if row.get("id") not in ids and row.get("sku") not in skus:
            return False
    return True


def _view(docs, spec):
    rows = []
    pre_brand = []
    for row in _public(docs):
        if not _passes_query(row, spec):
            continue
        if not _search(row, spec.get("q", "")):
            continue
        if not _blank(spec.get("warehouse_id")) and str(row.get("warehouse_id") or "") != str(spec.get("warehouse_id")):
            continue
        active = spec.get("active") or "all"
        on = row.get("is_active") is not False
        if active == "active" and not on:
            continue
        if active == "inactive" and on:
            continue
        b2b = spec.get("b2b") or "all"
        visible = row.get("show_in_b2b") is not False
        if b2b == "yes" and not visible:
            continue
        if b2b == "no" and visible:
            continue
        pre_brand.append(row)
        if not _blank(spec.get("brand")) and str(row.get("brand") or "").lower() != str(spec.get("brand")).lower():
            continue
        rows.append(row)
    base = list(rows)
    chosen = [row for row in base if _status(row, spec.get("status") or "all")]
    ordered = page.sort_products(chosen, spec.get("sort") or "name_asc")
    return ordered, base, pre_brand


def _money(rows):
    value = 0.0
    qty = 0.0
    for row in rows:
        value += page.stock_value_of(row)
        if _tracked(row):
            qty += page.js_num(row.get("stock_quantity"))
    return round(value, 2), round(qty, 4)


def _core(row):
    stocks = tuple((v or {}).get("stock") for v in (row.get("variants") or []))
    return (row.get("id"), row.get("stock_quantity"), row.get("warehouse_id"), stocks, row.get("company_id"))


async def _collect(db, page_size=2, **kwargs):
    page_n = 1
    items = []
    bodies = []
    while page_n < 40:
        body = await page.list_products_paged(db, CID, page=page_n, page_size=page_size, **kwargs)
        bodies.append(body)
        items.extend(body["items"])
        if not body["has_more"]:
            return items, bodies
        page_n += 1
    raise AssertionError("sayfa döngüsü kapanmadı")


def _kwargs(spec):
    return {
        "q": spec.get("q", ""),
        "category": spec.get("category"),
        "brand": spec.get("brand", ""),
        "warehouse_id": spec.get("warehouse_id", ""),
        "active": spec.get("active", "all"),
        "b2b": spec.get("b2b", "all"),
        "status": spec.get("status", "all"),
        "sort": spec.get("sort", "name_asc"),
        "type": spec.get("type"),
        "b2b_only": bool(spec.get("b2b_only")),
        "lite": bool(spec.get("lite")),
        "ids": spec.get("ids"),
        "skus": spec.get("skus"),
    }


CASES = [
    {},
    {"q": "kulak"},
    {"q": "KULAK"},
    {"q": "bor-2"},
    {"q": "869ABC"},
    {"q": "869abc"},
    {"q": "işık"},
    {"category": "Elektronik"},
    {"category": "Hammadde"},
    {"brand": "tam"},
    {"brand": "Çelik"},
    {"warehouse_id": "wh_raw"},
    {"warehouse_id": "wh_main"},
    {"warehouse_id": "wh_ank"},
    {"status": "critical"},
    {"status": "out"},
    {"status": "in"},
    {"status": "untracked"},
    {"status": "zero"},
    {"status": "negative"},
    {"active": "active"},
    {"active": "inactive"},
    {"b2b": "yes"},
    {"b2b": "no"},
    {"sort": "name_desc"},
    {"sort": "stock_asc"},
    {"sort": "stock_desc"},
    {"sort": "price_asc"},
    {"sort": "price_desc"},
    {"sort": "value_desc"},
    {"sort": "newest"},
    {"type": "service"},
    {"b2b_only": True},
    {"lite": True, "q": "ada"},
    {"ids": "ada,cem"},
    {"skus": "NIL-6"},
    {"q": "a", "category": "Elektronik", "brand": "Tam", "warehouse_id": "wh_main", "status": "critical", "sort": "stock_asc", "b2b": "yes", "active": "active"},
    {"warehouse_id": "wh_raw", "status": "negative", "sort": "name_desc"},
]


@pytest.mark.parametrize("spec", CASES, ids=lambda s: ",".join(f"{k}={v}" for k, v in s.items()) or "default")
def test_paged_matches_unpaged_set(spec):
    db, products = _db()
    before = copy.deepcopy(products)
    kwargs = _kwargs(spec)

    async def _go():
        full = await page.list_products_unpaged(db, CID, **kwargs)
        items, bodies = await _collect(db, **kwargs)
        tail = await page.list_products_paged(db, CID, page=99, page_size=2, **kwargs)
        return full, items, bodies, tail

    full, items, bodies, tail = _run(_go())
    expected, base, _pre = _view(products, spec)
    assert [_core(row) for row in items] == [_core(row) for row in expected]
    assert [_core(row) for row in full] == [_core(row) for row in expected]
    assert "foreign" not in {row.get("id") for row in items}
    assert all(row.get("company_id") == CID for row in items)
    value, qty = _money(expected)
    wh = page.warehouse_quantities(expected)
    facets = page.facet_counts(base)
    assert bodies, "en az bir sayfa"
    for body in bodies:
        assert body["total"] == len(expected)
        assert body["summary"]["count"] == len(expected)
        assert body["summary"]["stock_value"] == value
        assert body["summary"]["quantity_total"] == qty
        assert body["summary"]["warehouse_quantities"] == wh
        assert body["summary"]["critical_count"] == facets["critical"]
        assert body["summary"]["zero_count"] == facets["zero"]
        assert body["summary"]["negative_count"] == facets["negative"]
        assert body["page_size"] == 2 or spec.get("ids") or spec.get("skus") or body["total"] == 0
    assert tail["items"] == []
    assert tail["total"] == len(expected)
    assert tail["summary"]["stock_value"] == value
    assert tail["summary"]["warehouse_quantities"] == wh
    assert db.writes == []
    assert products == before
    if items:
        items[0]["stock_quantity"] = -123456
        if items[0].get("variants"):
            items[0]["variants"][0]["stock"] = 0
        assert products == before


def test_summary_is_not_the_page_slice_and_warehouse_qty_is_stored():
    db, products = _db()
    before = copy.deepcopy(products)

    async def _go():
        body = await page.list_products_paged(db, CID, page=1, page_size=1, sort="name_asc")
        wide = await page.list_products_paged(db, CID, page=1, page_size=50, status="critical")
        raw = await page.list_products_paged(db, CID, page=1, page_size=50, warehouse_id="wh_raw")
        return body, wide, raw

    body, wide, raw = _run(_go())
    assert _ids(body["items"]) == ["ada"]
    assert body["items"][0]["stock_quantity"] == 2
    assert body["items"][0]["variants"][0]["stock"] == 7
    assert body["items"][0]["variants"][1]["stock"] == 8
    assert body["total"] == 9
    assert body["summary"]["count"] == 9
    assert body["summary"]["stock_value"] == 180
    assert body["summary"]["quantity_total"] == 26
    assert body["summary"]["critical_count"] == 5
    assert body["summary"]["zero_count"] == 1
    assert body["summary"]["negative_count"] == 1
    assert body["summary"]["warehouse_quantities"] == {"wh_ank": 4, "wh_main": 29, "wh_raw": -3}
    assert body["summary"]["stock_value"] != page.stock_value_of(body["items"][0])
    assert wide["total"] == 5
    assert wide["summary"]["count"] == 5
    assert wide["summary"]["critical_count"] == 5
    assert set(_ids(wide["items"])) == {"ada", "cem", "deniz", "nil", "gok"}
    assert _ids(raw["items"]) == ["cem", "deniz"]
    assert [row["stock_quantity"] for row in raw["items"]] == [0, -3]
    assert raw["summary"]["warehouse_quantities"] == {"wh_raw": -3}
    assert raw["summary"]["negative_count"] == 1
    assert raw["summary"]["zero_count"] == 1
    assert db.writes == []
    assert products == before


def test_default_name_order_breaks_ties_on_id():
    db, _products = _db()

    async def _go():
        rows = await page.list_products_unpaged(db, CID, sort="name_asc")
        desc = await page.list_products_unpaged(db, CID, sort="stock_desc")
        newest = await page.list_products_unpaged(db, CID, sort="newest")
        return rows, desc, newest

    rows, desc, newest = _run(_go())
    assert _ids(rows) == ["ada", "ada2", "bora", "cem", "deniz", "efe", "gok", "nil", "sif"]
    assert _ids(desc) == ["ada2", "bora", "efe", "nil", "gok", "sif", "ada", "cem", "deniz"]
    assert _ids(newest) == ["sif", "gok", "nil", "efe", "deniz", "bora", "cem", "ada2", "ada"]


def test_queries_stay_inside_company_and_do_not_write():
    db, products = _db()

    async def _go():
        db.log.clear()
        await page.list_products_paged(db, CID, page=1, page_size=20, q="ada", status="critical", warehouse_id="wh_main")
        return list(db.log)

    finds = _run(_go())
    assert finds
    assert {name for _kind, name, _query, _proj in finds} == {"products"}
    for _kind, _name, query, _proj in finds:
        assert query.get("company_id") == CID
    assert db.writes == []
    assert all(doc.get("stock_quantity") != -1 for doc in products)


def test_other_company_is_forbidden_and_page_size_caps():
    db, products = _db()
    user_c1 = {"id": "u1", "company_ids": [CID], "active_company_id": CID}
    user_c2 = {"id": "u2", "company_ids": [OTHER], "active_company_id": OTHER}

    async def _go():
        own = await page.list_products_for_user(db, user_c1, CID, paged=True, page=1, page_size=500)
        plain = await page.list_products_for_user(db, user_c1, None, paged=False)
        foreign_list = await page.list_products_for_user(db, user_c2, paged=False)
        denied = None
        try:
            await page.list_products_for_user(db, user_c2, CID, paged=True, page=1, page_size=20)
        except HTTPException as exc:
            denied = exc.status_code
        bad = None
        try:
            await page.list_products_paged(db, CID, page=1, page_size=10, status="maybe")
        except HTTPException as exc:
            bad = exc.status_code
        bad_sort = None
        try:
            await page.list_products_paged(db, CID, page=1, page_size=10, sort="sku")
        except HTTPException as exc:
            bad_sort = exc.status_code
        exported = await page.list_products_paged(db, CID, page=3, page_size=1, export=True)
        tiny = await page.list_products_paged(db, CID, page=0, page_size=0)
        return own, plain, foreign_list, denied, bad, bad_sort, exported, tiny

    own, plain, foreign_list, denied, bad, bad_sort, exported, tiny = _run(_go())
    assert own["page_size"] == 200
    assert {row["id"] for row in own["items"]} == {row["id"] for row in plain}
    assert "foreign" not in {row["id"] for row in plain}
    assert [row["id"] for row in foreign_list] == ["foreign"]
    assert denied == 403
    assert bad == 400
    assert bad_sort == 400
    assert exported["page"] == 1
    assert exported["page_size"] == page.FETCH_CAP
    assert exported["total"] == len(plain)
    assert len(exported["items"]) == len(plain)
    assert tiny["page"] == 1
    assert tiny["page_size"] == page.PAGE_SIZE_DEFAULT
    assert db.writes == []
    assert products[0]["stock_quantity"] == 2


def test_unpaged_route_stays_an_array_and_module_does_not_write():
    root = Path(__file__).resolve().parents[1]
    server_src = (root / "server.py").read_text(encoding="utf-8")
    src = (root / "product_list_page.py").read_text(encoding="utf-8")
    assert 'products = await db.products.find(query, proj).to_list(limit if keyed else (5000 if lite else 10000))' in server_src
    assert "if page is not None or page_size is not None:" in server_src
    assert "return [_with_purchase_costs(p, cost_map.get(p.get(\"_id\") or p.get(\"id\")) or []) for p in products]" in server_src
    for bad in ("update_one", "insert_one", "delete_one", "update_many", "insert_many", "delete_many", "$set", "replace_one"):
        assert bad not in src


def test_route_without_page_is_the_old_list_and_page_does_not_write():
    import server
    from unittest.mock import AsyncMock, patch

    db, products = _db()
    before = copy.deepcopy(products)
    user = {"id": "u1", "company_ids": [CID], "active_company_id": CID}

    async def _go():
        with patch.object(server, "db", db), patch.object(server, "get_current_user", AsyncMock(return_value=user)):
            legacy = await server.list_products(company_id=CID, q="ada", brand="Tam", status="critical")
            db.log.clear()
            db.writes.clear()
            body = await server.list_products(company_id=CID, page=1, page_size=2, q="ada", request=object())
            paged_log = list(db.log)
            paged_writes = list(db.writes)
            denied = None
            try:
                await server.list_products(company_id=CID, page=1, page_size=10)
            except HTTPException as exc:
                denied = exc.status_code
            other = None
            try:
                await server.list_products(
                    company_id=OTHER, page=1, page_size=10, request=object(),
                )
            except HTTPException as exc:
                other = exc.status_code
            return legacy, body, paged_log, paged_writes, denied, other

    legacy, body, paged_log, paged_writes, denied, other = _run(_go())
    assert isinstance(legacy, list)
    assert not isinstance(legacy, dict)
    assert len(legacy) == 9
    assert {row["id"] for row in legacy} == {"ada", "ada2", "bora", "cem", "deniz", "efe", "gok", "nil", "sif"}
    ada = next(row for row in legacy if row["id"] == "ada")
    assert ada["stock_quantity"] == 2
    assert ada["variants"][0]["stock"] == 7
    assert "purchase_costs" in ada
    assert isinstance(body, dict)
    assert body["total"] == 2
    assert _ids(body["items"]) == ["ada", "ada2"]
    assert body["items"][0]["stock_quantity"] == 2
    assert body["summary"]["warehouse_quantities"]["wh_main"] == 11
    assert {name for _kind, name, _query, _proj in paged_log} == {"products", "invoices"}
    assert sum(1 for kind, name, *_rest in paged_log if name == "invoices" and kind == "find") == 1
    assert paged_writes == []
    assert denied == 401
    assert other == 403
    assert db.writes == []
    assert products == before


_COST_KEYS = (
    "purchase_costs",
    "last_purchase_price",
    "last_purchase_date",
    "last_purchase_supplier",
    "avg_purchase_price",
)


def _purchase_invoices():
    """Ada'nın iki alışı ve sayfa dışında kalacak Bora'nın bir alışı."""
    return [
        {
            "_id": "inv-ada-new",
            "company_id": CID,
            "invoice_type": "purchase",
            "status": "approved",
            "issue_date": "2026-08-01",
            "contact_name": "Yeni Tedarik",
            "invoice_number": "AF-2",
            "items": [{"product_id": "ada", "unit_price": 15, "quantity": 2}],
        },
        {
            "_id": "inv-ada-old",
            "company_id": CID,
            "invoice_type": "purchase",
            "status": "approved",
            "issue_date": "2026-01-15",
            "contact_name": "Eski Tedarik",
            "invoice_number": "AF-1",
            "items": [{"product_id": "ada", "unit_price": 9, "quantity": 1}],
        },
        {
            "_id": "inv-ada-void",
            "company_id": CID,
            "invoice_type": "purchase",
            "status": "cancelled",
            "issue_date": "2026-09-01",
            "contact_name": "İptal",
            "invoice_number": "AF-X",
            "items": [{"product_id": "ada", "unit_price": 99, "quantity": 1}],
        },
        {
            "_id": "inv-bora",
            "company_id": CID,
            "invoice_type": "purchase",
            "status": "approved",
            "issue_date": "2026-07-01",
            "contact_name": "Bora Tedarik",
            "invoice_number": "AF-B",
            "items": [{"product_id": "bora", "unit_price": 4, "quantity": 3}],
        },
        {
            "_id": "inv-other",
            "company_id": OTHER,
            "invoice_type": "purchase",
            "status": "approved",
            "issue_date": "2026-08-02",
            "contact_name": "Yabancı",
            "invoice_number": "AF-F",
            "items": [{"product_id": "ada", "unit_price": 500, "quantity": 1}],
        },
    ]


def test_paged_purchase_costs_match_legacy_and_skip_off_page_and_lite():
    import server
    from unittest.mock import AsyncMock, patch

    products = copy.deepcopy(_seed())
    db = MemDB(products, invoices=copy.deepcopy(_purchase_invoices()))
    before = copy.deepcopy(products)
    invoices_before = copy.deepcopy(db.invoices.docs)
    user = {"id": "u1", "company_ids": [CID], "active_company_id": CID}
    applied = []
    map_calls = []
    real_with = server._with_purchase_costs
    real_map = server._purchase_costs_by_product

    def spy_with(product, hist):
        applied.append(str((product or {}).get("_id") or (product or {}).get("id") or ""))
        return real_with(product, hist)

    async def spy_map(company_id, limit_each=8):
        map_calls.append(str(company_id))
        return await real_map(company_id, limit_each=limit_each)

    async def _go():
        with patch.object(server, "db", db), patch.object(server, "get_current_user", AsyncMock(return_value=user)), patch.object(server, "_with_purchase_costs", spy_with), patch.object(server, "_purchase_costs_by_product", spy_map):
            legacy = await server.list_products(company_id=CID)
            applied.clear()
            map_calls.clear()
            db.log.clear()
            db.writes.clear()
            body = await server.list_products(
                company_id=CID, page=1, page_size=1, sort="name_asc", request=object(),
            )
            paged_applied = list(applied)
            paged_maps = list(map_calls)
            paged_writes = list(db.writes)
            applied.clear()
            map_calls.clear()
            db.log.clear()
            db.writes.clear()
            lite = await server.list_products(
                company_id=CID, page=1, page_size=5, lite=True, sort="name_asc", request=object(),
            )
            return legacy, body, paged_applied, paged_maps, paged_writes, lite, list(applied), list(map_calls), list(db.writes)

    legacy, body, paged_applied, paged_maps, paged_writes, lite, lite_applied, lite_maps, lite_writes = _run(_go())
    by_id = {row["id"]: row for row in legacy}
    assert _ids(body["items"]) == ["ada"]
    assert "bora" not in _ids(body["items"])
    page_ada = body["items"][0]
    for key in _COST_KEYS:
        assert page_ada[key] == by_id["ada"][key]
    assert page_ada["last_purchase_price"] == 15
    assert page_ada["last_purchase_supplier"] == "Yeni Tedarik"
    assert page_ada["last_purchase_date"] == "2026-08-01"
    assert page_ada["avg_purchase_price"] == 12
    assert [row["unit_price"] for row in page_ada["purchase_costs"]] == [15, 9]
    assert paged_applied == ["ada"]
    assert "bora" not in paged_applied
    assert paged_maps == [CID]
    assert paged_writes == []
    assert lite_applied == []
    assert lite_maps == []
    assert lite_writes == []
    assert lite["items"]
    for row in lite["items"]:
        for key in _COST_KEYS:
            assert key not in row
    assert db.writes == []
    assert products == before
    assert db.invoices.docs == invoices_before


def test_lite_projection_is_recorded_and_still_filters():
    db, _products = _db()

    async def _go():
        db.log.clear()
        body = await page.list_products_paged(db, CID, page=1, page_size=50, lite=True, q="vida")
        return body, list(db.log)

    body, finds = _run(_go())
    assert _ids(body["items"]) == ["cem"]
    assert finds
    proj = finds[0][3]
    assert proj is not None
    assert "name" in proj
    assert "variants" not in proj


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

    cid = "c-ppage-" + uuid.uuid4().hex[:10]
    other = "c-ppage-x-" + uuid.uuid4().hex[:8]
    rows = []
    for doc in _seed():
        row = copy.deepcopy(doc)
        row["company_id"] = cid if doc["company_id"] == CID else other
        rows.append(row)
    mem = MemDB(copy.deepcopy(rows))

    async def _expected():
        return await page.list_products_unpaged(mem, cid, q="kulak", warehouse_id="wh_main", sort="stock_desc")

    expected = _run(_expected())
    expected_ids = _ids(expected)
    expected_wh = page.warehouse_quantities(expected)
    expected_value = round(sum(page.stock_value_of(row) for row in expected), 2)

    async def _go():
        db = MySQLDatabase({**settings, "charset": "utf8mb4", "autocommit": True})
        await db._ensure()
        previous = os.environ.get("MYSQL_STORE_SQL_PUSHDOWN")
        try:
            for doc in rows:
                await db.products.insert_one(doc)
            sample_id = rows[0]["_id"]
            before = await db.products.find_one({"_id": sample_id, "company_id": cid})
            results = []
            for flag in ("0", "1"):
                os.environ["MYSQL_STORE_SQL_PUSHDOWN"] = flag
                body = await page.list_products_paged(
                    db, cid, page=1, page_size=1, q="kulak", warehouse_id="wh_main", sort="stock_desc",
                )
                full = await page.list_products_unpaged(
                    db, cid, q="kulak", warehouse_id="wh_main", sort="stock_desc",
                )
                results.append((flag, _ids(full), body))
            after = await db.products.find_one({"_id": sample_id, "company_id": cid})
            return results, before, after
        finally:
            if previous is None:
                os.environ.pop("MYSQL_STORE_SQL_PUSHDOWN", None)
            else:
                os.environ["MYSQL_STORE_SQL_PUSHDOWN"] = previous
            await db.products.delete_many({"company_id": cid})
            await db.products.delete_many({"company_id": other})
            await db.close()

    results, before, after = _run(_go())
    assert expected_ids
    seen = {}
    for flag, ids, body in results:
        assert ids == expected_ids
        assert body["summary"]["stock_value"] == expected_value
        assert body["summary"]["warehouse_quantities"] == expected_wh
        assert body["summary"]["count"] == len(expected_ids)
        assert len(body["items"]) <= 1
        assert body["items"][0]["stock_quantity"] == expected[0]["stock_quantity"]
        seen[flag] = ids
    assert seen["0"] == seen["1"]
    assert before["stock_quantity"] == after["stock_quantity"]
    assert before["name"] == after["name"]
