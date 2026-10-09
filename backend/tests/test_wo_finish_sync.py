"""Work order finish: idempotent + work_order payload for client sync."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import server


def test_finish_already_done_is_idempotent():
    wo = {
        "_id": "wo1",
        "order_id": "po1",
        "step_name": "PVC",
        "status": "done",
        "produced_qty": 3,
        "finished_at": "2026-10-09T10:00:00+00:00",
    }

    async def run():
        with patch.object(server, "_wo", AsyncMock(return_value=dict(wo))):
            return await server.finish_work_order("wo1", {"produced_qty": 3})

    r = asyncio.run(run())
    assert r["status"] == "success"
    assert r.get("already_done") is True
    assert r["work_order"]["status"] == "done"
    assert r["work_order"]["id"] == "wo1"


def test_finish_returns_work_order_payload():
    wo = {
        "_id": "wo2",
        "order_id": "po1",
        "company_id": "c1",
        "step_name": "Kesim",
        "step_no": 1,
        "status": "in_progress",
        "planned_quantity": 1,
        "unit": "Adet",
        "paused_seconds": 0,
        "materials": [],
    }
    updated = {**wo, "status": "done", "produced_qty": 1, "scrap_qty": 0, "finished_at": "2026-10-09T12:00:00+00:00"}

    fake_db = MagicMock()
    fake_db.work_orders.update_one = AsyncMock()
    fake_db.work_orders.find_one = AsyncMock(side_effect=[None, updated])  # nxt=None, then updated
    fake_db.production_orders.find_one = AsyncMock(return_value=None)

    async def run():
        with patch.object(server, "db", fake_db), \
             patch.object(server, "_wo", AsyncMock(return_value=dict(wo))), \
             patch.object(server, "_log", lambda *a, **k: {"action": "finish"}):
            return await server.finish_work_order("wo2", {"produced_qty": 1, "scrap_qty": 0, "operator_name": "Ali"})

    r = asyncio.run(run())
    assert r["status"] == "success"
    assert r["work_order"]["status"] == "done"
    assert r["work_order"]["id"] == "wo2"
