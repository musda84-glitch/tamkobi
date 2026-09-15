"""Fazla barkod okutmada 409 overscan dönmeli."""
import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException


def test_scan_rejects_overscan(monkeypatch):
    import order_pick as op

    order = {
        "_id": "ord_os",
        "company_id": "c1",
        "order_number": "S-OS",
        "order_status": "preparing",
        "items": [{"product_id": "p1", "product_name": "Duvar Rafı", "quantity": 2, "barcode": "DRD_35_BYZ"}],
    }
    ses = {
        "_id": "ses_os",
        "order_id": "ord_os",
        "company_id": "c1",
        "status": "picking",
        "items": [{
            "product_id": "p1",
            "product_name": "Duvar Rafı",
            "barcode": "DRD_35_BYZ",
            "sku": "DRD_35_BYZ",
            "ordered_qty": 2,
            "picked_qty": 2,
            "line_index": 0,
        }],
    }

    db = MagicMock()
    db.orders.find_one = AsyncMock(return_value=order)
    db.order_pick_sessions.find_one = AsyncMock(return_value=ses)
    db.order_pick_sessions.update_one = AsyncMock()
    db.orders.update_one = AsyncMock()
    op.init(db, {})

    async def fake_session(o, create=False):
        return ses

    monkeypatch.setattr(op, "_session_for", fake_session)
    monkeypatch.setattr(op, "_product_by_code", AsyncMock(return_value={"_id": "p1", "barcode": "DRD_35_BYZ"}))

    with pytest.raises(HTTPException) as ei:
        asyncio.run(op.scan_pick("ord_os", {"barcode": "DRD_35_BYZ", "quantity": 1}))

    assert ei.value.status_code == 409
    detail = ei.value.detail
    assert isinstance(detail, dict)
    assert detail["code"] == "overscan"
    assert "fazla" in detail["message"].lower()
    assert detail["picked_qty"] == 2
    assert detail["ordered_qty"] == 2
    db.order_pick_sessions.update_one.assert_not_called()
