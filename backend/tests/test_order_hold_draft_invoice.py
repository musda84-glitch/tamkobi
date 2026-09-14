"""Onaylı sipariş beklemeye alınca taslak fatura silinmeli; kağıt/taslak fatura silinebilmeli."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_update_order_status_pending_deletes_linked_draft():
    import server

    order = {
        "_id": "ord_1",
        "order_status": "approved",
        "invoice_id": "inv_draft_1",
        "invoice_number": "NX20260001",
        "is_invoiced": False,
    }
    draft = {
        "_id": "inv_draft_1",
        "status": "draft",
        "invoice_number": "NX20260001",
        "contact_name": "Cari",
        "grand_total": 100,
        "e_type": "e_archive",
    }

    mock_db = MagicMock()
    mock_db.orders.find_one = AsyncMock(side_effect=[order, {**order, "order_status": "pending", "invoice_id": None}])
    mock_db.orders.update_one = AsyncMock()
    mock_db.invoices.find_one = AsyncMock(return_value=draft)

    with patch.object(server, "db", mock_db), patch.object(
        server, "_soft_delete_invoice_doc", AsyncMock(return_value="trash_1")
    ) as soft_del, patch.object(server, "_push_order_to_shopphp", AsyncMock()):
        result = _run(server.update_order_status("ord_1", {"status": "pending"}))

    soft_del.assert_awaited_once()
    assert soft_del.await_args.args[0]["_id"] == "inv_draft_1"
    assert result["order_status"] == "pending"
    assert result["draft_invoice_cleared"] is True
    assert "taslak fatura" in result["message"].lower() or "taslak" in result["message"].lower()

    ops = mock_db.orders.update_one.await_args.args[1]
    assert ops["$set"]["order_status"] == "pending"
    assert "invoice_id" in ops.get("$unset", {})


def test_update_order_status_pending_keeps_issued_invoice():
    import server

    order = {
        "_id": "ord_2",
        "order_status": "approved",
        "invoice_id": "inv_ok",
        "is_invoiced": True,
    }
    mock_db = MagicMock()
    mock_db.orders.find_one = AsyncMock(side_effect=[order, {**order, "order_status": "pending"}])
    mock_db.orders.update_one = AsyncMock()

    with patch.object(server, "db", mock_db), patch.object(
        server, "_soft_delete_invoice_doc", AsyncMock()
    ) as soft_del, patch.object(server, "_push_order_to_shopphp", AsyncMock()):
        result = _run(server.update_order_status("ord_2", {"status": "pending"}))

    soft_del.assert_not_awaited()
    assert result.get("draft_invoice_cleared") is False


def test_invoice_delete_block_reason_allows_draft_and_paper():
    import server

    assert server._invoice_delete_block_reason({"status": "draft"}) is None
    assert server._invoice_delete_block_reason({"status": "approved", "e_type": "paper"}) is None
    assert server._invoice_delete_block_reason(
        {"status": "approved", "e_type": "paper", "paid_amount": 50, "payment_status": "partially_paid"}
    )
    assert server._invoice_delete_block_reason({"status": "approved", "e_type": "e_invoice"})


def test_delete_invoice_allows_paper_and_reverses_effects():
    import server

    inv = {
        "_id": "inv_paper",
        "status": "approved",
        "e_type": "paper",
        "invoice_number": "KAGIT-1",
        "contact_name": "Cari",
        "grand_total": 200,
        "effects_applied": True,
        "paid_amount": 0,
        "payment_status": "unpaid",
    }
    mock_db = MagicMock()
    mock_db.invoices.find_one = AsyncMock(return_value=inv)

    with patch.object(server, "db", mock_db), patch.object(
        server, "_soft_delete_invoice_doc", AsyncMock(return_value="t1")
    ) as soft_del:
        result = _run(server.delete_invoice("inv_paper"))

    soft_del.assert_awaited_once()
    assert result["status"] == "success"
    assert "Kağıt" in result["message"] or "kağıt" in result["message"].lower() or "Kağıt" in result["message"]


def test_delete_invoice_rejects_einvoice():
    import server

    inv = {
        "_id": "inv_e",
        "status": "approved",
        "e_type": "e_invoice",
        "invoice_number": "EF-1",
        "contact_name": "Cari",
        "grand_total": 200,
    }
    mock_db = MagicMock()
    mock_db.invoices.find_one = AsyncMock(return_value=inv)

    with patch.object(server, "db", mock_db):
        with pytest.raises(HTTPException) as ei:
            _run(server.delete_invoice("inv_e"))
    assert ei.value.status_code == 400
