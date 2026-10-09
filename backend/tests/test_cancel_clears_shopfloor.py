"""İptal / silinen üretim emirleri atölye (work_orders) listesinden de kalkmalı."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import server


def test_cancel_production_order_trashes_work_orders():
    order = {
        "_id": "po_cancel_1",
        "status": "in_production",
        "order_code": "URT-99",
        "product_name": "Masa",
    }
    wos = [
        {
            "_id": "wo1",
            "order_id": "po_cancel_1",
            "order_code": "URT-99",
            "step_name": "Kesim",
            "product_name": "Masa",
            "station": "CNC",
            "job_file_name": "AHM-1",
        },
        {
            "_id": "wo2",
            "order_id": "po_cancel_1",
            "order_code": "URT-99",
            "step_name": "Montaj",
            "product_name": "Masa",
            "station": "Montaj",
        },
    ]
    fake_db = MagicMock()
    fake_db.production_orders.find_one = AsyncMock(return_value=order)
    fake_db.production_orders.update_one = AsyncMock()
    fake_db.work_orders.find = MagicMock(return_value=MagicMock(to_list=AsyncMock(return_value=wos)))
    soft = AsyncMock()

    async def run():
        with patch.object(server, "db", fake_db), patch.object(server.trash, "soft_delete", soft):
            return await server.cancel_production_order("po_cancel_1")

    r = asyncio.run(run())
    assert r["status"] == "success"
    assert r["trashed_work_orders"] == 2
    assert "atölyeden kaldırıldı" in r["message"]
    fake_db.production_orders.update_one.assert_awaited_once()
    assert soft.await_count == 2
    first = soft.await_args_list[0]
    assert first.args[0] == "work_orders"
    assert first.args[1]["_id"] == "wo1"
    assert first.args[2] == "work_order"
    assert "üretim emri iptal" in first.kwargs.get("note", "")


def test_cancel_completed_rejected():
    fake_db = MagicMock()
    fake_db.production_orders.find_one = AsyncMock(return_value={"_id": "po_x", "status": "completed"})
    soft = AsyncMock()

    async def run():
        with patch.object(server, "db", fake_db), patch.object(server.trash, "soft_delete", soft):
            return await server.cancel_production_order("po_x")

    try:
        asyncio.run(run())
        assert False, "expected HTTPException"
    except server.HTTPException as e:
        assert e.status_code == 400
    soft.assert_not_awaited()


def test_filter_active_production_work_orders_hides_cancelled_and_orphan():
    rows = [
        {"id": "a", "order_id": "po_ok"},
        {"id": "b", "order_id": "po_cancel"},
        {"id": "c", "order_id": "po_gone"},
        {"id": "d"},  # no order_id
    ]
    fake_db = MagicMock()
    fake_db.production_orders.find = MagicMock(
        return_value=MagicMock(
            to_list=AsyncMock(
                return_value=[
                    {"_id": "po_ok", "status": "planned"},
                    {"_id": "po_cancel", "status": "cancelled"},
                ]
            )
        )
    )

    async def run():
        with patch.object(server, "db", fake_db):
            return await server._filter_active_production_work_orders(rows)

    out = asyncio.run(run())
    assert [r["id"] for r in out] == ["a"]


def test_list_work_orders_applies_active_filter():
    fake_rows = [
        {"id": "wo_keep", "order_id": "po1", "status": "ready", "company_id": "c1"},
        {"id": "wo_drop", "order_id": "po2", "status": "ready", "company_id": "c1"},
    ]
    find_cursor = MagicMock()
    find_cursor.sort = MagicMock(return_value=find_cursor)
    find_cursor.to_list = AsyncMock(return_value=[{"_id": r["id"], **{k: v for k, v in r.items() if k != "id"}} for r in fake_rows])

    fake_db = MagicMock()
    fake_db.work_orders.find = MagicMock(return_value=find_cursor)
    fake_db.production_orders.find = MagicMock(
        return_value=MagicMock(
            to_list=AsyncMock(return_value=[{"_id": "po1", "status": "in_production"}])
        )
    )
    fake_db.companies.find_one = AsyncMock(return_value={})
    fake_db.work_order_trash_requests.find = MagicMock(
        return_value=MagicMock(to_list=AsyncMock(return_value=[]))
    )

    async def run():
        with patch.object(server, "db", fake_db), \
             patch.object(server, "clean_docs", side_effect=lambda xs: [{**x, "id": x.get("_id") or x.get("id")} for x in xs]), \
             patch.object(server, "_enrich_work_orders_job_fields", AsyncMock(side_effect=lambda rows: rows)):
            return await server.list_work_orders(response=MagicMock(), company_id="c1")

    out = asyncio.run(run())
    assert len(out) == 1
    assert out[0]["id"] == "wo_keep"
