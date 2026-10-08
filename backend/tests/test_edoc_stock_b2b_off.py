"""Gelen e-belge / alış eşleştirme: stok kartları B2B kapalı açılsın."""
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

import edocs  # noqa: E402
import server  # noqa: E402


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_ensure_products_passes_show_in_b2b_false():
    doc = {
        "_id": "ed1",
        "company_id": "c1",
        "lines": [
            {"name": "Vida M8", "quantity": 10, "unit_price": 2, "vat_rate": 20, "total": 20},
        ],
    }
    create = AsyncMock(return_value={"product": {"id": "p_new", "name": "Vida M8"}})
    fake_db = MagicMock()
    fake_db.incoming_edocs.update_one = AsyncMock()
    edocs.init(fake_db, {"create_product": create})
    n = _run(edocs.ensure_products_for_unmatched(doc))
    assert n == 1
    kwargs = create.await_args.args[0]
    assert kwargs.get("show_in_b2b") is False
    assert kwargs.get("channel") == "edoc"


def test_set_lines_closes_b2b_on_match():
    doc = {
        "_id": "ed2",
        "company_id": "c1",
        "status": "pending",
        "lines": [{"name": "Somun", "sku": "S1", "product_id": None}],
        "matched_lines": 0,
    }
    prod = {"_id": "p1", "name": "Somun", "supplier_codes": []}
    fake_db = MagicMock()
    fake_db.incoming_edocs.find_one = AsyncMock(return_value=doc)
    fake_db.products.find_one = AsyncMock(return_value=prod)
    fake_db.products.update_one = AsyncMock()
    fake_db.incoming_edocs.update_one = AsyncMock()
    edocs.init(fake_db, {})
    out = _run(edocs.set_lines("ed2", {"lines": [{"idx": 0, "product_id": "p1"}]}))
    assert out["lines"][0]["product_id"] == "p1"
    upd = fake_db.products.update_one.await_args.args[1]
    assert upd["$set"]["show_in_b2b"] is False
    assert upd["$addToSet"]["supplier_codes"] == "S1"


def test_enrich_auto_match_closes_b2b():
    products_cursor = MagicMock()
    products_cursor.to_list = AsyncMock(return_value=[
        {"_id": "p9", "name": "Kalem", "sku": "K1", "barcode": "869", "marketplace_aliases": [], "supplier_codes": []},
    ])
    fake_db = MagicMock()
    fake_db.contacts.find_one = AsyncMock(return_value=None)
    fake_db.products.find = MagicMock(return_value=products_cursor)
    fake_db.products.update_many = AsyncMock()
    edocs.init(fake_db, {})
    doc = {
        "supplier": {"name": "T", "tax_id": ""},
        "lines": [{"name": "Kalem", "sku": "K1", "barcode": ""}],
    }
    out = _run(edocs._enrich(doc, "c1"))
    assert out["lines"][0]["product_id"] == "p9"
    assert out["lines"][0]["auto_matched"] is True
    fake_db.products.update_many.assert_awaited_once()
    assert fake_db.products.update_many.await_args.args[1] == {"$set": {"show_in_b2b": False}}


def test_create_product_marketplace_edoc_b2b_off():
    server.db.products.find_one = AsyncMock(return_value=None)
    server.db.products.insert_one = AsyncMock()
    with patch.object(server.saas, "check_product_limit", AsyncMock()), \
         patch.object(server, "_remember_category", AsyncMock()), \
         patch.object(server, "_remember_unit", AsyncMock()):
        out = _run(server.create_product_from_marketplace({
            "company_id": "c1",
            "product_name": "Alış Kalemi",
            "sku": "EDOC-1",
            "purchase_price": 10,
            "sale_price": 14,
            "vat_rate": 20,
            "channel": "edoc",
            "category": "Tedarik",
        }))
    inserted = server.db.products.insert_one.await_args.args[0]
    assert inserted["show_in_b2b"] is False
    assert out["product"]["show_in_b2b"] is False


def test_create_product_marketplace_default_b2b_on():
    server.db.products.find_one = AsyncMock(return_value=None)
    server.db.products.insert_one = AsyncMock()
    with patch.object(server.saas, "check_product_limit", AsyncMock()), \
         patch.object(server, "_remember_category", AsyncMock()), \
         patch.object(server, "_remember_unit", AsyncMock()):
        _run(server.create_product_from_marketplace({
            "company_id": "c1",
            "product_name": "Pazar Ürünü",
            "sku": "MP-1",
            "barcode": "8691111111111",
            "channel": "trendyol",
        }))
    inserted = server.db.products.insert_one.await_args.args[0]
    assert inserted["show_in_b2b"] is True


def test_invoice_match_closes_b2b():
    inv = {
        "_id": "inv1",
        "company_id": "c1",
        "invoice_type": "purchase",
        "direction": "incoming",
        "status": "approved",
        "items": [{"name": "Peynir", "sku": "PY1"}],
    }
    prod = {"_id": "p1", "name": "Peynir", "company_id": "c1", "supplier_codes": [], "show_in_b2b": True}
    server.db.invoices.find_one = AsyncMock(return_value=inv)
    server.db.products.find_one = AsyncMock(return_value=prod)
    server.db.invoices.update_one = AsyncMock()
    server.db.products.update_one = AsyncMock()
    out = _run(server.match_invoice_item_product("inv1", {"idx": 0, "product_id": "p1"}))
    assert out["status"] == "success"
    upd = server.db.products.update_one.await_args.args[1]
    assert upd["$set"]["show_in_b2b"] is False
