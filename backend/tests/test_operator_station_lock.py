"""Operatör istasyon kilidi: in_progress bitmeden/duraklatmadan başka istasyon yok."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import shopfloor_operators as sfo
import server


def test_blocker_only_for_same_operator_other_station():
    rows = [
        {"_id": "a", "status": "in_progress", "operator_name": "Ali", "station": "PVC", "order_code": "URT-1", "step_no": 3},
        {"_id": "b", "status": "paused", "operator_name": "Ali", "station": "HOLZHER"},
        {"_id": "c", "status": "in_progress", "operator_name": "Veli", "station": "HOLZHER"},
    ]
    assert sfo.operator_active_station_blocker(rows, "Ali", "HOLZHER")["_id"] == "a"
    assert sfo.operator_active_station_blocker(rows, "Ali", "PVC") is None
    # Ali'nin PVC işi Veli'yi engellemez; Veli kendi HOLZHER işinde aynı istasyonda serbest
    assert sfo.operator_active_station_blocker([rows[0]], "Veli", "HOLZHER") is None
    assert sfo.operator_active_station_blocker(rows, "Veli", "HOLZHER") is None
    assert sfo.operator_active_station_blocker(rows, "Ali", "HOLZHER", exclude_wo_id="a") is None
    msg = sfo.operator_station_lock_detail(rows[0], "Ali")
    assert "PVC" in msg and "Başka personel" in msg


def test_start_blocked_when_operator_busy_elsewhere():
    wo = {
        "_id": "wo_new",
        "company_id": "c1",
        "order_id": "po1",
        "step_name": "Kesim",
        "station": "HOLZHER",
        "status": "ready",
        "assigned_name": None,
        "paused_seconds": 0,
    }
    active = [{
        "_id": "wo_busy",
        "status": "in_progress",
        "operator_name": "Muhammed ASLAN",
        "station": "PVC BANTLAMA MIZRAK",
        "order_code": "URT-2026-97189",
        "step_no": 3,
    }]

    class FakeCursor:
        async def to_list(self, n):
            return active

    fake_db = MagicMock()
    fake_db.work_orders.find = MagicMock(return_value=FakeCursor())
    fake_db.work_orders.update_one = AsyncMock()
    fake_db.production_orders.update_one = AsyncMock()

    async def run():
        with patch.object(server, "db", fake_db), \
             patch.object(server, "_wo", AsyncMock(return_value=dict(wo))):
            return await server.start_work_order("wo_new", {"operator_name": "Muhammed ASLAN"})

    try:
        asyncio.run(run())
        assert False, "expected HTTPException"
    except server.HTTPException as e:
        assert e.status_code == 400
        assert "PVC BANTLAMA" in str(e.detail)
        assert "Başka personel" in str(e.detail)
    fake_db.work_orders.update_one.assert_not_awaited()


def test_start_allowed_for_other_operator_while_busy():
    wo = {
        "_id": "wo_new",
        "company_id": "c1",
        "order_id": "po1",
        "step_name": "Kesim",
        "station": "HOLZHER",
        "status": "ready",
        "assigned_name": None,
        "paused_seconds": 0,
    }

    class FakeCursor:
        async def to_list(self, n):
            return []  # Veli'nin in_progress işi yok

    started = {**wo, "status": "in_progress", "operator_name": "Veli", "started_at": "2026-01-01T00:00:00+00:00"}
    fake_db = MagicMock()
    fake_db.work_orders.find = MagicMock(return_value=FakeCursor())
    fake_db.work_orders.find_one = AsyncMock(return_value=started)
    fake_db.work_orders.update_one = AsyncMock()
    fake_db.production_orders.update_one = AsyncMock()

    async def run():
        with patch.object(server, "db", fake_db), \
             patch.object(server, "_wo", AsyncMock(return_value=dict(wo))), \
             patch.object(server, "_log", lambda *a, **k: {"action": "start"}), \
             patch.object(server, "clean_doc", lambda d: d):
            return await server.start_work_order("wo_new", {"operator_name": "Veli"})

    r = asyncio.run(run())
    assert r["status"] == "success"
    assert r.get("work_order", {}).get("status") == "in_progress"
    fake_db.work_orders.update_one.assert_awaited()
