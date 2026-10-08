"""create_invoice must not 500 when product has price_includes_vat (Pydantic InvoiceItem)."""
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
from models import Invoice, InvoiceItem  # noqa: E402


def test_invoice_item_accepts_price_includes_vat():
    it = InvoiceItem(
        name="MDF",
        quantity=1,
        unit_price=100,
        total=100,
        price_includes_vat=True,
        unit_price_incl=None,
    )
    assert it.price_includes_vat is True
    assert it.unit_price_incl is None


def test_fill_stock_codes_sets_price_includes_vat_on_model():
    item = InvoiceItem(
        product_id="p1",
        name="ATLANTİK CAM MDF",
        quantity=54,
        unit_price=3858.0247,
        unit_price_incl=4629.6296,
        vat_rate=20,
        total=208333.33,
        total_incl=250000.0,
    )
    prod = {
        "_id": "p1",
        "sku": "MDF-01",
        "barcode": "8680001111111",
        "sale_price": 4629.6296,
        "price_includes_vat": True,
        "variants": [],
    }

    async def _run():
        find = MagicMock()
        find.to_list = AsyncMock(return_value=[prod])
        with patch.object(server.db, "products") as products:
            products.find = MagicMock(return_value=find)
            await server._fill_stock_codes("comp_nexus_main_01", [item])

    asyncio.run(_run())
    assert item.sku == "MDF-01"
    assert item.barcode == "8680001111111"
    assert item.price_includes_vat is True


def test_create_invoice_payload_with_vat_incl_product_parses():
    inv = Invoice(
        company_id="comp_nexus_main_01",
        invoice_type="sales",
        e_type="e_invoice",
        contact_id="c1",
        contact_name="KİNETİK",
        status="draft",
        gib_status="Taslak",
        items=[
            InvoiceItem(
                product_id="p1",
                name="ATLANTİK CAM MDF 280*210*18 PLAKA",
                quantity=54,
                unit_price=3858.0247,
                unit_price_incl=4629.6296,
                vat_rate=20,
                total=208333.33,
                total_incl=250000.0,
                price_includes_vat=True,
            )
        ],
    )
    assert inv.items[0].price_includes_vat is True
    assert inv.contact_name == "KİNETİK"
