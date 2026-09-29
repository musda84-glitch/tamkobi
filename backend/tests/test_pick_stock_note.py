"""Pick session copies B2B sipariş stok notu onto warehouse pick lines."""
import asyncio
from unittest.mock import AsyncMock, MagicMock


def test_enrich_items_copies_line_note():
    import order_pick as op

    db = MagicMock()
    db.products.find_one = AsyncMock(return_value={
        "_id": "p1", "name": "MDF", "sku": "MDF3MM", "barcode": "8691", "image_url": None,
    })
    op.init(db, {})

    items = asyncio.run(op._enrich_items("c1", [
        {"product_id": "p1", "product_name": "MDF", "quantity": 40, "note": "  tek yüz beyaz  "},
        {"product_id": "p1", "product_name": "MDF", "quantity": 5},
    ]))

    assert items[0]["note"] == "tek yüz beyaz"
    assert "note" not in items[1] or not items[1].get("note")
    assert items[0]["ordered_qty"] == 40


def test_sync_stock_notes_backfills_existing_session():
    import order_pick as op

    order = {
        "_id": "ord1",
        "items": [
            {"product_id": "p1", "quantity": 2, "note": "kırmızı kutu"},
            {"product_id": "p2", "quantity": 1, "line_note": "mavi kutu"},
        ],
    }
    ses = {
        "_id": "ses1",
        "items": [
            {"line_index": 0, "product_id": "p1", "ordered_qty": 2, "picked_qty": 1},
            {"line_index": 1, "product_id": "p2", "ordered_qty": 1, "picked_qty": 0, "note": ""},
        ],
    }
    db = MagicMock()
    db.order_pick_sessions.update_one = AsyncMock()
    op.init(db, {})

    out = asyncio.run(op._sync_stock_notes(ses, order))
    assert out["items"][0]["note"] == "kırmızı kutu"
    assert out["items"][1]["note"] == "mavi kutu"
    db.order_pick_sessions.update_one.assert_awaited()


def test_sync_stock_notes_keeps_existing_note():
    import order_pick as op

    order = {"_id": "ord1", "items": [{"product_id": "p1", "quantity": 1, "note": "yeni"}]}
    ses = {
        "_id": "ses1",
        "items": [{"line_index": 0, "product_id": "p1", "ordered_qty": 1, "picked_qty": 0, "note": "eski"}],
    }
    db = MagicMock()
    db.order_pick_sessions.update_one = AsyncMock()
    op.init(db, {})

    out = asyncio.run(op._sync_stock_notes(ses, order))
    assert out["items"][0]["note"] == "eski"
    db.order_pick_sessions.update_one.assert_not_called()
