"""Depodan sevk işaretleme — kargo firması olmadan sevk."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import warehouse_ship as ws


def test_tracking_and_flags():
    assert ws.tracking_number("B2B-2026-0014") == "DEPO-B2B-2026-0014"
    assert ws.is_warehouse_shipped({"warehouse_shipped": True})
    assert ws.is_warehouse_shipped({"cargo_carrier": "warehouse", "order_status": "shipped"})
    assert ws.is_warehouse_shipped({"cargo_tracking_number": "DEPO-X"})
    assert not ws.is_warehouse_shipped({"order_status": "approved"})
    assert ws.has_external_cargo({"cargo_tracking_number": "YK-123"})
    assert not ws.has_external_cargo({"cargo_tracking_number": "DEPO-B2B-1"})
    assert not ws.has_external_cargo({"cargo_carrier": "warehouse", "cargo_tracking_number": "x"})


def test_can_warehouse_ship_states():
    assert ws.can_warehouse_ship({"order_status": "approved"})[0] == "ok"
    assert ws.can_warehouse_ship({"order_status": "cancelled"})[0] == "closed"
    assert ws.can_warehouse_ship({"warehouse_shipped": True})[0] == "exists"
    assert ws.can_warehouse_ship({"cargo_tracking_number": "ARAS-1"})[0] == "cargo"


def test_order_set_fields_marks_shipped():
    fields = ws.order_set_fields({"order_number": "B2B-1", "order_status": "approved"}, "2026-09-29T12:00:00+00:00")
    assert fields["order_status"] == "shipped"
    assert fields["warehouse_shipped"] is True
    assert fields["cargo_carrier"] == "warehouse"
    assert fields["cargo_carrier_name"] == "Depodan sevk"
    assert fields["cargo_tracking_number"] == "DEPO-B2B-1"
    assert fields["ship_method"] == "warehouse"


def test_apply_warehouse_ship_updates_order():
    order = {
        "_id": "ord_wh_1",
        "company_id": "c1",
        "order_number": "B2B-2026-0014",
        "order_status": "approved",
        "customer_name": "Ersay",
        "items": [{"product_name": "Raf", "quantity": 1, "unit_price": 10, "vat_rate": 20}],
    }
    mock_db = MagicMock()
    mock_db.orders.find_one = AsyncMock(side_effect=[
        order,
        {**order, "order_status": "shipped", "warehouse_shipped": True},
        {**order, "order_status": "shipped", "warehouse_shipped": True, "invoice_id": "inv_1", "invoice_number": "NX1"},
    ])
    mock_db.orders.update_one = AsyncMock()
    draft = {"_id": "inv_1", "invoice_number": "NX1"}
    create_draft = AsyncMock(return_value=draft)
    push = AsyncMock()

    out = asyncio.get_event_loop().run_until_complete(
        ws.apply_warehouse_ship(
            mock_db,
            "ord_wh_1",
            "2026-09-29T12:00:00+00:00",
            create_draft=create_draft,
            push_shopphp=push,
        )
    )

    assert out["status"] == "success"
    assert "depodan sevk" in out["message"].lower()
    set_doc = mock_db.orders.update_one.await_args.args[1]["$set"]
    assert set_doc["order_status"] == "shipped"
    assert set_doc["warehouse_shipped"] is True
    assert set_doc["cargo_carrier"] == "warehouse"
    assert set_doc["cargo_tracking_number"].startswith("DEPO-")
    assert out["draft_invoice_number"] == "NX1"
    create_draft.assert_awaited_once()
    push.assert_awaited_once()


def test_apply_warehouse_ship_rejects_closed():
    mock_db = MagicMock()
    mock_db.orders.find_one = AsyncMock(return_value={"_id": "x", "order_status": "cancelled"})
    out = asyncio.get_event_loop().run_until_complete(
        ws.apply_warehouse_ship(mock_db, "x", "2026-09-29T12:00:00+00:00")
    )
    assert out["status"] == "closed"
    assert "iptal" in out["message"].lower() or "iade" in out["message"].lower()


def test_apply_warehouse_ship_exists():
    mock_db = MagicMock()
    mock_db.orders.find_one = AsyncMock(return_value={
        "_id": "x", "order_number": "B2B-1", "order_status": "shipped", "warehouse_shipped": True,
    })
    out = asyncio.get_event_loop().run_until_complete(
        ws.apply_warehouse_ship(mock_db, "x", "2026-09-29T12:00:00+00:00")
    )
    assert out["status"] == "exists"


def test_apply_warehouse_ship_not_found():
    mock_db = MagicMock()
    mock_db.orders.find_one = AsyncMock(return_value=None)
    out = asyncio.get_event_loop().run_until_complete(
        ws.apply_warehouse_ship(mock_db, "missing", "2026-09-29T12:00:00+00:00")
    )
    assert out["status"] == "not_found"
