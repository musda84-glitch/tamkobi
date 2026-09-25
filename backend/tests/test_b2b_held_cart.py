"""B2B held/active cart persists for panel/mobile order lists."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import server


def test_decorate_b2b_held_order_marks_view_only():
    o = {"order_status": "held_cart", "held_seq": 2, "order_number": "BH-2026-0001"}
    out = server._decorate_b2b_held_order(o)
    assert out["is_held_cart"] is True
    assert out["view_only"] is True
    assert out["held_label"] == "Bekleyen sepet #2"
    assert out["order_status"] == "held_cart"


def test_decorate_b2b_active_cart_marks_view_only():
    o = {"order_status": "active_cart", "order_number": "BA-1", "source": "b2b_active_cart"}
    out = server._decorate_b2b_held_order(o)
    assert out["is_active_cart"] is True
    assert out["view_only"] is True
    assert out["held_label"] == "Aktif sepet"
    assert out["order_status"] == "active_cart"


def test_decorate_b2b_held_order_noop_for_pending():
    o = {"order_status": "pending", "order_number": "B2B-1"}
    out = server._decorate_b2b_held_order(dict(o))
    assert out.get("is_held_cart") is not True
    assert out.get("is_active_cart") is not True
    assert out["order_status"] == "pending"


def test_sort_b2b_cart_orders_active_then_held():
    docs = [
        {"id": "1", "order_status": "pending"},
        {"id": "2", "order_status": "held_cart", "is_held_cart": True},
        {"id": "3", "order_status": "active_cart", "is_active_cart": True},
    ]
    out = server._sort_b2b_cart_orders(docs)
    assert [o["id"] for o in out] == ["3", "2", "1"]


CONTACT = {
    "_id": "cnt_01",
    "company_id": "comp_nexus_main_01",
    "name": "Demo Bayi",
    "email": "b@x.com",
    "phone": "0500",
    "address": "Adr",
    "city": "İstanbul",
    "b2b_enabled": True,
    "b2b_discount": 0,
}
PRODUCT = {
    "_id": "prod_01",
    "company_id": "comp_nexus_main_01",
    "name": "Ürün A",
    "sku": "A1",
    "sale_price": 100,
    "vat_rate": 20,
    "unit": "Adet",
}


def test_b2b_hold_cart_creates_held_order():
    inserted = {}

    async def insert_one(doc):
        inserted["doc"] = doc
        return MagicMock(inserted_id=doc["_id"])

    fake_db = MagicMock()
    fake_db.contacts.find_one = AsyncMock(return_value=CONTACT)
    fake_db.companies.find_one = AsyncMock(return_value={"_id": "comp_nexus_main_01", "b2b_settings": {"allow_orders": True}})
    fake_db.products.find_one = AsyncMock(return_value=PRODUCT)
    fake_db.orders.count_documents = AsyncMock(return_value=0)
    fake_db.orders.insert_one = AsyncMock(side_effect=insert_one)
    fake_db.orders.delete_many = AsyncMock(return_value=MagicMock(deleted_count=1))

    async def run():
        with patch.object(server, "db", fake_db), \
             patch.object(server, "_next_order_number", AsyncMock(return_value="BH-2026-0001")), \
             patch.object(server, "_notify_company", AsyncMock()):
            return await server.b2b_hold_cart("tok", {"items": [{"product_id": "prod_01", "quantity": 2}], "note": "acil"})

    r = asyncio.run(run())

    assert r["status"] == "success"
    assert inserted["doc"]["order_status"] == "held_cart"
    assert inserted["doc"]["is_held_cart"] is True
    assert inserted["doc"]["source"] == "b2b_held_cart"
    assert inserted["doc"]["held_label"] == "Bekleyen sepet #1"
    assert inserted["doc"]["channel"] == "b2b"
    assert r["order"]["is_held_cart"] is True
    fake_db.orders.delete_many.assert_awaited()


def test_b2b_upsert_active_cart_creates_order():
    inserted = {}

    async def insert_one(doc):
        inserted["doc"] = doc
        return MagicMock(inserted_id=doc["_id"])

    fake_db = MagicMock()
    fake_db.contacts.find_one = AsyncMock(return_value=CONTACT)
    fake_db.companies.find_one = AsyncMock(return_value={"_id": "comp_nexus_main_01", "b2b_settings": {"allow_orders": True}})
    fake_db.products.find_one = AsyncMock(return_value=PRODUCT)
    fake_db.orders.find_one = AsyncMock(return_value=None)
    fake_db.orders.insert_one = AsyncMock(side_effect=insert_one)
    fake_db.orders.delete_many = AsyncMock(return_value=MagicMock(deleted_count=0))

    async def run():
        with patch.object(server, "db", fake_db), \
             patch.object(server, "_next_order_number", AsyncMock(return_value="BA-2026-0001")):
            return await server.b2b_upsert_active_cart(
                "tok",
                {"items": [{"product_id": "prod_01", "quantity": 3}], "note": "sepet"},
            )

    r = asyncio.run(run())
    assert r["status"] == "success"
    assert inserted["doc"]["order_status"] == "active_cart"
    assert inserted["doc"]["is_active_cart"] is True
    assert inserted["doc"]["source"] == "b2b_active_cart"
    assert inserted["doc"]["held_label"] == "Aktif sepet"
    assert r["order"]["is_active_cart"] is True


def test_b2b_upsert_active_cart_empty_clears():
    fake_db = MagicMock()
    fake_db.contacts.find_one = AsyncMock(return_value=CONTACT)
    fake_db.orders.delete_many = AsyncMock(return_value=MagicMock(deleted_count=1))

    async def run():
        with patch.object(server, "db", fake_db):
            return await server.b2b_upsert_active_cart("tok", {"items": []})

    r = asyncio.run(run())
    assert r["order"] is None
    fake_db.orders.delete_many.assert_awaited()
