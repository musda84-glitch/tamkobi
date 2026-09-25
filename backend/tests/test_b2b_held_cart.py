"""B2B held cart persists as order_status=held_cart for panel/mobile lists."""
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


def test_decorate_b2b_held_order_noop_for_pending():
    o = {"order_status": "pending", "order_number": "B2B-1"}
    out = server._decorate_b2b_held_order(dict(o))
    assert out.get("is_held_cart") is not True
    assert out["order_status"] == "pending"


def test_b2b_hold_cart_creates_held_order():
    contact = {
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
    product = {
        "_id": "prod_01",
        "company_id": "comp_nexus_main_01",
        "name": "Ürün A",
        "sku": "A1",
        "sale_price": 100,
        "vat_rate": 20,
        "unit": "Adet",
    }
    inserted = {}

    async def insert_one(doc):
        inserted["doc"] = doc
        return MagicMock(inserted_id=doc["_id"])

    fake_db = MagicMock()
    fake_db.contacts.find_one = AsyncMock(return_value=contact)
    fake_db.companies.find_one = AsyncMock(return_value={"_id": "comp_nexus_main_01", "b2b_settings": {"allow_orders": True}})
    fake_db.products.find_one = AsyncMock(return_value=product)
    fake_db.orders.count_documents = AsyncMock(return_value=0)
    fake_db.orders.insert_one = AsyncMock(side_effect=insert_one)

    async def run():
        with patch.object(server, "db", fake_db), \
             patch.object(server, "_next_order_number", AsyncMock(return_value="BH-2026-0001")), \
             patch.object(server, "_notify_company", AsyncMock()):
            return await server.b2b_hold_cart("tok", {"items": [{"product_id": "prod_01", "quantity": 2}], "note": "acil"})

    r = asyncio.get_event_loop().run_until_complete(run()) if False else asyncio.run(run())

    assert r["status"] == "success"
    assert inserted["doc"]["order_status"] == "held_cart"
    assert inserted["doc"]["is_held_cart"] is True
    assert inserted["doc"]["source"] == "b2b_held_cart"
    assert inserted["doc"]["held_label"] == "Bekleyen sepet #1"
    assert inserted["doc"]["channel"] == "b2b"
    assert r["order"]["is_held_cart"] is True
