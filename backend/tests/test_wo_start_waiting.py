"""Work order: waiting adım araya girilerek başlatılabilir."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import server


def test_start_work_order_allows_waiting():
    wo = {
        "_id": "wo_wait",
        "order_id": "po1",
        "step_name": "Kesim",
        "status": "waiting",
        "assigned_name": None,
        "paused_seconds": 0,
    }
    fake_db = MagicMock()
    fake_db.work_orders.update_one = AsyncMock()
    fake_db.production_orders.update_one = AsyncMock()
    captured = {}

    async def update_one(filt, upd):
        captured["filt"] = filt
        captured["upd"] = upd
        return MagicMock()

    fake_db.work_orders.update_one = AsyncMock(side_effect=update_one)

    async def run():
        with patch.object(server, "db", fake_db), \
             patch.object(server, "_wo", AsyncMock(return_value=dict(wo))), \
             patch.object(server, "_log", lambda *a, **k: {"action": a[1] if len(a) > 1 else "start"}):
            return await server.start_work_order("wo_wait", {"operator_name": "Ali"})

    r = asyncio.run(run())
    assert r["status"] == "success"
    assert captured["upd"]["$set"]["status"] == "in_progress"
    assert captured["upd"]["$set"]["operator_name"] == "Ali"
    assert captured["upd"]["$set"].get("started_at")


def test_start_work_order_rejects_done():
    wo = {"_id": "wo_done", "order_id": "po1", "step_name": "X", "status": "done"}

    async def run():
        with patch.object(server, "_wo", AsyncMock(return_value=dict(wo))):
            return await server.start_work_order("wo_done", {"operator_name": "Ali"})

    try:
        asyncio.run(run())
        assert False, "expected HTTPException"
    except server.HTTPException as e:
        assert e.status_code == 400
