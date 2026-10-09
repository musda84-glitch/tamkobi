"""Taslak fatura ↔ sipariş kalem senkronu."""
from __future__ import annotations

import asyncio
import os
import sys
from types import ModuleType
from unittest.mock import AsyncMock, MagicMock, patch

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


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_sync_draft_order_items_updates_linked_order():
    invoice = {
        "_id": "inv_draft_1",
        "status": "draft",
        "order_id": "ord_1",
        "invoice_number": "TF-1",
        "company_id": "comp_1",
        "items": [
            {
                "product_id": "p1",
                "name": "Profil",
                "quantity": 2,
                "unit_price": 50000,
                "vat_rate": 20,
                "unit": "Adet",
                "total": 100000,
                "total_incl": 120000,
                "vat_amount": 20000,
            }
        ],
    }
    order = {
        "_id": "ord_1",
        "invoice_id": "inv_draft_1",
        "is_invoiced": False,
        "company_id": "comp_1",
        "items": [{"product_name": "Eski", "quantity": 1, "unit_price": 10}],
        "grand_total": 12,
    }

    order_sets = {}

    async def _order_update(filt, update):
        order_sets["filt"] = filt
        order_sets["set"] = update["$set"]

    mock_db = MagicMock()
    mock_db.orders.find_one = AsyncMock(return_value=order)
    mock_db.orders.update_one = AsyncMock(side_effect=_order_update)

    with patch.object(server, "db", mock_db), patch.object(
        server, "_fill_stock_codes", AsyncMock()
    ):
        _run(server._sync_draft_order_items(invoice, invoice["items"]))

    assert order_sets["filt"] == {"_id": "ord_1"}
    assert order_sets["set"]["is_invoiced"] is False
    assert order_sets["set"]["invoice_id"] == "inv_draft_1"
    assert order_sets["set"]["grand_total"] == 120000.0
    assert order_sets["set"]["items"][0]["product_name"] == "Profil"
    assert order_sets["set"]["items"][0]["quantity"] == 2


def test_sync_draft_order_skips_when_invoiced():
    invoice = {
        "_id": "inv_1",
        "status": "draft",
        "order_id": "ord_1",
        "items": [{"name": "X", "quantity": 1, "unit_price": 1}],
    }
    order = {"_id": "ord_1", "is_invoiced": True, "invoice_id": "inv_1"}
    mock_db = MagicMock()
    mock_db.orders.find_one = AsyncMock(return_value=order)
    mock_db.orders.update_one = AsyncMock()

    with patch.object(server, "db", mock_db):
        _run(server._sync_draft_order_items(invoice, invoice["items"]))
    mock_db.orders.update_one.assert_not_called()


def test_sync_draft_invoice_still_updates_from_order():
    """Mevcut sipariş→fatura yönü bozulmasın."""
    order = {
        "_id": "ord_2",
        "invoice_id": "inv_2",
        "is_invoiced": False,
        "company_id": "comp_1",
    }
    invoice = {"_id": "inv_2", "status": "draft"}
    inv_sets = {}

    async def _inv_update(filt, update):
        inv_sets["set"] = update["$set"]

    mock_db = MagicMock()
    mock_db.invoices.find_one = AsyncMock(return_value=invoice)
    mock_db.invoices.update_one = AsyncMock(side_effect=_inv_update)

    items = [
        {
            "product_name": "Kalem",
            "quantity": 3,
            "unit_price": 100,
            "vat_rate": 20,
            "unit": "Adet",
        }
    ]

    with patch.object(server, "db", mock_db), patch.object(
        server, "_fill_stock_codes", AsyncMock()
    ):
        _run(server._sync_draft_invoice_items(order, items))

    assert inv_sets["set"]["grand_total"] == 360.0
    assert inv_sets["set"]["items"][0]["name"] == "Kalem"
