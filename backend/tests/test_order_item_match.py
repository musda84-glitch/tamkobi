"""Sipariş satırı → stok kartı eşleştirme (pazaryeri dahil)."""
from __future__ import annotations

import asyncio
import os
import sys
from types import ModuleType
from unittest.mock import AsyncMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def _stub_emergent():
    if "emergentintegrations" in sys.modules:
        return
    root = ModuleType("emergentintegrations")
    llm = ModuleType("emergentintegrations.llm")
    chat = ModuleType("emergentintegrations.llm.chat")

    class LlmChat:
        def __init__(self, *a, **k):
            pass

        async def send_message(self, *a, **k):
            return ""

    class UserMessage:
        def __init__(self, *a, **k):
            pass

    chat.LlmChat = LlmChat
    chat.UserMessage = UserMessage
    payments = ModuleType("emergentintegrations.payments")
    stripe_svc = ModuleType("emergentintegrations.payments.stripe")
    stripe_checkout = ModuleType("emergentintegrations.payments.stripe.checkout")

    class StripeCheckout:
        def __init__(self, *a, **k):
            pass

    class CheckoutSessionRequest:
        def __init__(self, *a, **k):
            pass

    class CheckoutSessionResponse:
        def __init__(self, *a, **k):
            pass

    stripe_checkout.StripeCheckout = StripeCheckout
    stripe_checkout.CheckoutSessionRequest = CheckoutSessionRequest
    stripe_checkout.CheckoutSessionResponse = CheckoutSessionResponse
    sys.modules["emergentintegrations"] = root
    sys.modules["emergentintegrations.llm"] = llm
    sys.modules["emergentintegrations.llm.chat"] = chat
    sys.modules["emergentintegrations.payments"] = payments
    sys.modules["emergentintegrations.payments.stripe"] = stripe_svc
    sys.modules["emergentintegrations.payments.stripe.checkout"] = stripe_checkout


_stub_emergent()

import server  # noqa: E402
from fastapi import HTTPException  # noqa: E402


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_match_order_item_sets_product_id_on_marketplace_order():
    order = {
        "_id": "ord1",
        "company_id": "c1",
        "channel": "trendyol",
        "order_number": "TY-1",
        "items": [{
            "product_name": "Namaz Kıble Ibadet Mihrab",
            "sku": "NK-1",
            "barcode": "869111",
            "quantity": 1,
            "unit_price": 100,
        }],
    }
    prod = {"_id": "p1", "company_id": "c1", "name": "Mihrab Dekor", "sku": "MDF-1", "barcode": "869999"}

    async def _find_ord(q, *a, **k):
        return order if q.get("_id") == "ord1" else None

    async def _find_prod(q, *a, **k):
        if q.get("_id") == "p1" and q.get("company_id") == "c1":
            return prod
        return None

    server.db.orders.find_one = AsyncMock(side_effect=_find_ord)
    server.db.products.find_one = AsyncMock(side_effect=_find_prod)
    server.db.orders.update_one = AsyncMock()
    server.db.products.update_one = AsyncMock()

    out = _run(server.match_order_item_product("ord1", {"idx": 0, "product_id": "p1"}))
    assert out["status"] == "success"
    assert out["order"]["items"][0]["product_id"] == "p1"
    assert out["order"]["items"][0]["matched_product_name"] == "Mihrab Dekor"
    prod_upd = server.db.products.update_one.await_args.args[1]
    assert "marketplace_aliases" in prod_upd["$addToSet"]


def test_match_order_item_rejects_missing_product():
    server.db.orders.find_one = AsyncMock(return_value={
        "_id": "ord2",
        "company_id": "c1",
        "items": [{"product_name": "X"}],
    })
    server.db.products.find_one = AsyncMock(return_value=None)
    try:
        _run(server.match_order_item_product("ord2", {"idx": 0, "product_id": "missing"}))
        assert False, "expected HTTPException"
    except HTTPException as e:
        assert e.status_code == 404


def test_match_route_registered():
    paths = [getattr(r, "path", "") or "" for r in server.api_router.routes]
    assert any(p.endswith("/orders/{order_id}/items/match") for p in paths)
