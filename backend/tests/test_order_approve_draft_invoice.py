"""Sipariş onayında cariye taslak fatura düşmesi."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest


def test_create_draft_invoice_for_order_inserts_draft():
    import server

    order = {
        "_id": "ord_test_1",
        "company_id": "comp_1",
        "order_number": "ORD-100",
        "customer_name": "Test Cari A.Ş.",
        "channel": "b2b",
        "currency": "TRY",
        "items": [
            {
                "product_id": "p1",
                "product_name": "Kalem",
                "name": "Kalem",
                "quantity": 2,
                "unit_price": 50,
                "vat_rate": 20,
                "unit": "Adet",
            }
        ],
    }
    contact = {
        "_id": "cnt_1",
        "name": "Test Cari A.Ş.",
        "tax_number_or_id": "1234567890",
        "is_e_invoice_user": False,
        "payment_term_days": 14,
    }

    inserted = {}

    async def _insert(doc):
        inserted["doc"] = doc

    order_updates = {}

    async def _order_update(filt, update):
        order_updates["filt"] = filt
        order_updates["set"] = update["$set"]

    mock_db = MagicMock()
    mock_db.invoices.find_one = AsyncMock(return_value=None)
    mock_db.invoices.insert_one = AsyncMock(side_effect=_insert)
    mock_db.invoices.count_documents = AsyncMock(return_value=3)
    mock_db.orders.update_one = AsyncMock(side_effect=_order_update)

    with patch.object(server, "db", mock_db), patch.object(
        server, "_ensure_order_contact", AsyncMock(return_value=contact)
    ), patch.object(server, "_fill_stock_codes", AsyncMock()):
        doc = asyncio.get_event_loop().run_until_complete(
            server._create_draft_invoice_for_order(order)
        )

    assert doc is not None
    assert inserted["doc"]["status"] == "draft"
    assert inserted["doc"]["gib_status"] == "Taslak"
    assert inserted["doc"]["payment_status"] == "unpaid"
    assert inserted["doc"]["invoice_type"] == "sales"
    assert inserted["doc"]["contact_id"] == "cnt_1"
    assert inserted["doc"]["order_id"] == "ord_test_1"
    assert inserted["doc"]["grand_total"] > 0
    assert order_updates["set"]["invoice_id"] == inserted["doc"]["_id"]
    assert order_updates["set"]["is_invoiced"] is False


def test_create_draft_invoice_skips_when_already_invoiced():
    import server

    order = {"_id": "ord_x", "is_invoiced": True, "invoice_id": "inv_old"}
    with patch.object(server, "db", MagicMock()):
        doc = asyncio.get_event_loop().run_until_complete(
            server._create_draft_invoice_for_order(order)
        )
    assert doc is None
