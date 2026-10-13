"""GET /orders listesi: aktif sepet hariç + üretim enrich company_id."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import server


def test_orders_list_active_cart_nor_shape():
    nor = server._orders_list_active_cart_nor()
    assert "$nor" in nor
    keys = {tuple(sorted(x.keys())) for x in nor["$nor"]}
    assert ("order_status",) in keys
    assert ("is_active_cart",) in keys
    assert ("source",) in keys


def test_list_orders_excludes_active_cart_by_default():
    captured = {}

    class FakeCursor:
        def sort(self, *a, **k):
            return self

        async def to_list(self, n):
            return []

    fake_db = MagicMock()

    def find(q, *a, **k):
        captured["q"] = q
        return FakeCursor()

    fake_db.orders.find = MagicMock(side_effect=find)

    async def run():
        with patch.object(server, "db", fake_db), \
             patch.object(server, "clean_docs", lambda x: x), \
             patch.object(server, "dedupe_orders_by_marketplace_key", lambda x: x), \
             patch.object(server, "_decorate_b2b_held_order", lambda o: o), \
             patch.object(server, "_enrich_orders_production_flags", AsyncMock(return_value=[])), \
             patch.object(server, "_enrich_orders_invoice_ebelge", AsyncMock(return_value=[])), \
             patch.object(server, "_sort_b2b_cart_orders", lambda x: x):
            return await server.list_orders(company_id="comp_1")

    asyncio.run(run())
    q = captured["q"]
    assert q["company_id"] == "comp_1"
    assert "$nor" in q
    assert any(x.get("order_status") == "active_cart" for x in q["$nor"])
    assert any(x.get("is_active_cart") is True for x in q["$nor"])
    assert any(x.get("source") == "b2b_active_cart" for x in q["$nor"])


def test_list_orders_include_active_cart_flag():
    captured = {}

    class FakeCursor:
        def sort(self, *a, **k):
            return self

        async def to_list(self, n):
            return []

    fake_db = MagicMock()

    def find(q, *a, **k):
        captured["q"] = q
        return FakeCursor()

    fake_db.orders.find = MagicMock(side_effect=find)

    async def run():
        with patch.object(server, "db", fake_db), \
             patch.object(server, "clean_docs", lambda x: x), \
             patch.object(server, "dedupe_orders_by_marketplace_key", lambda x: x), \
             patch.object(server, "_decorate_b2b_held_order", lambda o: o), \
             patch.object(server, "_enrich_orders_production_flags", AsyncMock(return_value=[])), \
             patch.object(server, "_enrich_orders_invoice_ebelge", AsyncMock(return_value=[])), \
             patch.object(server, "_sort_b2b_cart_orders", lambda x: x):
            return await server.list_orders(company_id="comp_1", include_active_cart=True)

    asyncio.run(run())
    assert "$nor" not in captured["q"]


def test_list_orders_status_active_cart_allowed():
    captured = {}

    class FakeCursor:
        def sort(self, *a, **k):
            return self

        async def to_list(self, n):
            return []

    fake_db = MagicMock()

    def find(q, *a, **k):
        captured["q"] = q
        return FakeCursor()

    fake_db.orders.find = MagicMock(side_effect=find)

    async def run():
        with patch.object(server, "db", fake_db), \
             patch.object(server, "clean_docs", lambda x: x), \
             patch.object(server, "dedupe_orders_by_marketplace_key", lambda x: x), \
             patch.object(server, "_decorate_b2b_held_order", lambda o: o), \
             patch.object(server, "_enrich_orders_production_flags", AsyncMock(return_value=[])), \
             patch.object(server, "_enrich_orders_invoice_ebelge", AsyncMock(return_value=[])), \
             patch.object(server, "_sort_b2b_cart_orders", lambda x: x):
            return await server.list_orders(company_id="comp_1", status="active_cart")

    asyncio.run(run())
    assert captured["q"]["order_status"] == "active_cart"
    assert "$nor" not in captured["q"]


def test_enrich_production_flags_scopes_recipes_by_company():
    captured = {}

    class FakeCursor:
        async def to_list(self, n):
            return []

    fake_db = MagicMock()

    def find(q, *a, **k):
        captured["q"] = q
        return FakeCursor()

    fake_db.recipes.find = MagicMock(side_effect=find)

    docs = [
        {"_id": "o1", "company_id": "comp_x", "order_number": "B2B-1", "order_status": "approved"},
        {"_id": "o2", "company_id": "comp_x", "order_status": "active_cart", "is_active_cart": True},
    ]

    async def run():
        with patch.object(server, "db", fake_db):
            return await server._enrich_orders_production_flags(docs, company_id="comp_x")

    out = asyncio.run(run())
    assert out[1]["has_production_order"] is False
    assert captured["q"]["company_id"] == "comp_x"
    assert "$or" in captured["q"]


def _paged_list_harness(rows):
    captured = {"q": None, "limit": None, "ebelge": []}

    class FakeCursor:
        def sort(self, *a, **k):
            return self

        async def to_list(self, n):
            captured["limit"] = n
            return list(rows[:n])

    fake_db = MagicMock()

    def find(q, *a, **k):
        captured["q"] = q
        return FakeCursor()

    fake_db.orders.find = MagicMock(side_effect=find)

    async def record_ebelge(docs):
        captured["ebelge"].append(len(docs))
        return docs

    async def ident(docs, company_id=None):
        return docs

    async def run(**kwargs):
        with patch.object(server, "db", fake_db), \
             patch.object(server, "clean_docs", lambda x: x), \
             patch.object(server, "dedupe_orders_by_marketplace_key", lambda x: x), \
             patch.object(server, "_decorate_b2b_held_order", lambda o: o), \
             patch.object(server, "_enrich_orders_invoice_ebelge", AsyncMock(side_effect=record_ebelge)), \
             patch.object(server, "_enrich_orders_marketplace_item_media", AsyncMock(side_effect=ident)), \
             patch.object(server, "_enrich_orders_stock_matches", AsyncMock(side_effect=ident)), \
             patch.object(server, "_enrich_orders_production_flags", AsyncMock(side_effect=ident)):
            return await server.list_orders(company_id="comp_1", paged=True, page_size=50, **kwargs)

    return captured, run


def test_paged_orders_enrich_ebelge_only_page_items():
    rows = [
        {"_id": f"o{i}", "order_number": f"N{i:04d}", "order_status": "pending", "channel": "b2b",
         "order_date": "2026-06-01T00:00:00Z", "total_amount": 1}
        for i in range(80)
    ]
    captured, run = _paged_list_harness(rows)
    out = asyncio.run(run())
    assert out["total"] == 80
    assert len(out["items"]) == 50
    assert captured["ebelge"] == [50]
    assert out["truncated"] is False


def test_paged_einvoice_filter_enriches_matching_scan():
    rows = [
        {"_id": f"o{i}", "order_number": f"N{i:04d}", "order_status": "pending", "channel": "b2b",
         "order_date": "2026-06-01T00:00:00Z", "total_amount": 1, "invoice_id": f"inv{i}"}
        for i in range(12)
    ]
    captured, run = _paged_list_harness(rows)
    out = asyncio.run(run(invoiced="einvoice"))
    assert captured["ebelge"] == [12]
    assert out["total"] == 0


def test_paged_orders_sql_date_and_truncated():
    cap = server.ORDER_LIST_SCAN_CAP
    rows = [
        {"_id": f"o{i}", "order_number": f"N{i:04d}", "order_status": "pending", "channel": "b2b",
         "order_date": "2026-10-13T10:00:00Z", "total_amount": 1}
        for i in range(cap + 3)
    ]
    captured, run = _paged_list_harness(rows)
    out = asyncio.run(run(date_from="2026-10-13", date_to="2026-10-13"))
    assert captured["q"]["company_id"] == "comp_1"
    assert "$gte" in captured["q"]["order_date"]
    assert "$lt" in captured["q"]["order_date"]
    assert captured["limit"] == cap + 1
    assert out["truncated"] is True
    assert out["total"] == cap
