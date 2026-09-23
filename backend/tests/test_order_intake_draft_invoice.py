"""Yeni siparişte otomatik taslak fatura (cariye düşer)."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch


def test_attach_draft_on_intake_calls_create():
    import server

    order = {"_id": "ord_in", "company_id": "c1", "order_number": "ORD-1", "items": [{"product_name": "A", "quantity": 1, "unit_price": 10, "vat_rate": 20}]}
    draft = {"_id": "inv_d", "status": "draft", "invoice_number": "NX1"}

    with patch.object(server, "_create_draft_invoice_for_order", AsyncMock(return_value=draft)) as create:
        out = asyncio.get_event_loop().run_until_complete(server._attach_draft_invoice_on_intake(order, source="b2b"))

    assert out is draft
    create.assert_awaited_once()
    assert create.await_args.kwargs.get("source") == "b2b" or create.await_args.args[1] == "b2b"


def test_attach_draft_on_intake_swallows_errors():
    import server

    with patch.object(server, "_create_draft_invoice_for_order", AsyncMock(side_effect=RuntimeError("boom"))):
        out = asyncio.get_event_loop().run_until_complete(
            server._attach_draft_invoice_on_intake({"_id": "x"}, source="intake")
        )
    assert out is None


def test_create_order_attaches_draft_invoice():
    import server
    from models import Order, OrderItem

    items = [OrderItem(product_name="Kalem", quantity=1, unit_price=100, vat_rate=20, total=100)]
    order = Order(company_id="comp_1", channel="manual", customer_name="Ali", shipping_address="A", city="İstanbul", items=items, total_amount=120)

    inserted = {}

    async def _insert(doc):
        inserted["doc"] = doc

    mock_db = MagicMock()
    mock_db.orders.insert_one = AsyncMock(side_effect=_insert)
    mock_db.orders.find_one = AsyncMock(side_effect=lambda q: {**(inserted.get("doc") or {}), "invoice_id": "inv_new", "invoice_number": "NX9"})

    with patch.object(server, "db", mock_db), patch.object(
        server, "_fill_stock_codes", AsyncMock()
    ), patch.object(server, "_next_order_number", AsyncMock(return_value="ORD-99")), patch.object(
        server, "_ensure_order_contact", AsyncMock(return_value={"_id": "cnt"})
    ), patch.object(server, "_attach_draft_invoice_on_intake", AsyncMock(return_value={"_id": "inv_new"})) as attach:
        out = asyncio.get_event_loop().run_until_complete(server.create_order(order))

    attach.assert_awaited_once()
    assert attach.await_args.kwargs.get("source") == "intake" or (
        len(attach.await_args.args) > 1 and attach.await_args.args[1] == "intake"
    )
    assert out.get("invoice_id") == "inv_new"
