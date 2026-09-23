"""Sipariş Faturala → taslak fatura (as_draft)."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch


def test_convert_order_as_draft_creates_draft_not_approved():
    import server

    order = {
        "_id": "ord_draft_cv",
        "company_id": "comp_1",
        "order_number": "ORD-2026-0003",
        "customer_name": "Demo Cari",
        "channel": "b2b",
        "currency": "TRY",
        "is_invoiced": False,
        "items": [
            {
                "product_id": "p1",
                "product_name": "Ürün",
                "quantity": 1,
                "unit_price": 100,
                "vat_rate": 20,
                "unit": "Adet",
            }
        ],
    }
    contact = {
        "_id": "cnt_1",
        "name": "Demo Cari",
        "tax_number_or_id": "123",
        "is_e_invoice_user": True,
        "payment_term_days": 14,
    }
    inserted = {}

    async def _insert(doc):
        inserted["doc"] = doc

    order_sets = []

    async def _order_update(filt, update):
        order_sets.append(update.get("$set") or {})

    mock_db = MagicMock()
    mock_db.orders.find_one = AsyncMock(return_value=order)
    mock_db.invoices.find_one = AsyncMock(return_value=None)
    mock_db.invoices.insert_one = AsyncMock(side_effect=_insert)
    mock_db.invoices.count_documents = AsyncMock(return_value=1)
    mock_db.invoices.update_one = AsyncMock()
    mock_db.orders.update_one = AsyncMock(side_effect=_order_update)

    with patch.object(server, "db", mock_db), patch.object(
        server, "_ensure_order_contact", AsyncMock(return_value=contact)
    ), patch.object(server, "_fill_stock_codes", AsyncMock()), patch.object(
        server, "_post_marketplace_settlement", AsyncMock()
    ) as settle, patch.object(server, "_push_order_to_shopphp", AsyncMock()) as push:
        out = asyncio.get_event_loop().run_until_complete(
            server.convert_order_to_invoice("ord_draft_cv", {"e_type": "e_invoice", "as_draft": True})
        )

    assert out["draft"] is True
    assert "Taslak" in out["message"]
    assert inserted["doc"]["status"] == "draft"
    assert inserted["doc"]["gib_status"] == "Taslak"
    assert inserted["doc"]["payment_status"] == "unpaid"
    assert inserted["doc"]["e_type"] == "e_invoice"
    assert any(s.get("is_invoiced") is False for s in order_sets)
    settle.assert_not_called()
    push.assert_not_called()


def test_convert_order_as_draft_returns_existing_draft():
    import server

    order = {
        "_id": "ord_2",
        "company_id": "comp_1",
        "order_number": "ORD-2",
        "is_invoiced": False,
        "invoice_id": "inv_existing",
    }
    existing = {
        "_id": "inv_existing",
        "status": "draft",
        "invoice_number": "NX20260001",
        "e_type": "e_archive",
    }
    mock_db = MagicMock()
    mock_db.orders.find_one = AsyncMock(return_value=order)
    mock_db.invoices.find_one = AsyncMock(return_value=existing)
    mock_db.invoices.update_one = AsyncMock()

    with patch.object(server, "db", mock_db):
        out = asyncio.get_event_loop().run_until_complete(
            server.convert_order_to_invoice("ord_2", {"e_type": "paper", "as_draft": True})
        )

    assert out["draft"] is True
    assert out["invoice_id"] == "inv_existing"
    mock_db.invoices.update_one.assert_called()
