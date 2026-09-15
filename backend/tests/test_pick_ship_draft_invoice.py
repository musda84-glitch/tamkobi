"""Sevk tamamlanınca taslak fatura oluşmalı."""
import asyncio
from unittest.mock import AsyncMock, MagicMock


def test_complete_ship_creates_draft_invoice(monkeypatch):
    import order_pick as op

    order = {
        "_id": "ord_1",
        "company_id": "c1",
        "order_number": "S-1",
        "order_status": "approved",
        "items": [{"product_id": "p1", "product_name": "X", "quantity": 2}],
    }
    ses = {
        "_id": "ses_1",
        "order_id": "ord_1",
        "company_id": "c1",
        "status": "picking",
        "items": [{"product_id": "p1", "product_name": "X", "ordered_qty": 2, "picked_qty": 2, "line_index": 0}],
    }
    draft = {"_id": "inv_1", "invoice_number": "NX202600000001"}

    db = MagicMock()
    db.orders.find_one = AsyncMock(side_effect=[
        order,
        {**order, "order_status": "shipped"},
        {**order, "order_status": "shipped", "invoice_id": "inv_1", "invoice_number": draft["invoice_number"]},
    ])
    db.orders.update_one = AsyncMock()
    db.order_pick_sessions.update_one = AsyncMock()

    create_draft = AsyncMock(return_value=draft)
    op.init(db, {"create_draft_invoice_for_order": create_draft})

    async def fake_session(o, create=False):
        return ses

    monkeypatch.setattr(op, "_session_for", fake_session)
    monkeypatch.setattr(op, "_progress", lambda items: {"complete": True, "picked": 2, "ordered": 2})
    monkeypatch.setattr(op, "_public", lambda s, o=None: {"order_id": "ord_1", "items": s["items"], "progress": {"complete": True}})

    out = asyncio.run(op.complete_pick("ord_1", {"mode": "ship"}))
    assert create_draft.await_count == 1
    assert out["draft_invoice_number"] == "NX202600000001"
    assert "taslak fatura" in out["message"].lower()
