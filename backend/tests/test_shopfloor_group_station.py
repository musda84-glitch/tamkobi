"""Atölye peşi sıra istasyon ayarı kalan adımları yeniden dizer."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import server
from production_work_orders import regroup_remaining_work_orders


def test_shopfloor_settings_get():
    fake_db = MagicMock()
    fake_db.companies.find_one = AsyncMock(return_value={"_id": "c1", "shopfloor_group_same_station": True})

    async def run():
        with patch.object(server, "db", fake_db):
            return await server.get_shopfloor_settings("c1")

    assert asyncio.run(run()) == {"group_same_station": True}


def test_shopfloor_settings_put_regroups():
    rows = [
        {"_id": "w1", "step_no": 1, "status": "ready", "station": "HOLZHER", "original_step_no": 1},
        {"_id": "w2", "step_no": 2, "status": "waiting", "station": "OMAKSAN", "original_step_no": 2},
        {"_id": "w3", "step_no": 3, "status": "waiting", "station": "HOLZHER", "original_step_no": 3},
    ]
    fake_db = MagicMock()
    fake_db.companies.find_one = AsyncMock(return_value={"_id": "c1"})
    fake_db.companies.update_one = AsyncMock()
    fake_db.production_orders.find = MagicMock()
    fake_db.production_orders.find.return_value.to_list = AsyncMock(return_value=[{"_id": "po1"}])
    fake_db.work_orders.find = MagicMock()
    fake_db.work_orders.find.return_value.to_list = AsyncMock(return_value=rows)
    fake_db.work_orders.update_one = AsyncMock()

    async def run():
        with patch.object(server, "db", fake_db):
            return await server.put_shopfloor_settings({"company_id": "c1", "group_same_station": True})

    out = asyncio.run(run())
    assert out["group_same_station"] is True
    assert out["regrouped_orders"] == 1
    assert fake_db.work_orders.update_one.await_count == 3
    grouped = regroup_remaining_work_orders(
        [
            {"_id": "w1", "step_no": 1, "status": "ready", "station": "HOLZHER", "original_step_no": 1},
            {"_id": "w2", "step_no": 2, "status": "waiting", "station": "OMAKSAN", "original_step_no": 2},
            {"_id": "w3", "step_no": 3, "status": "waiting", "station": "HOLZHER", "original_step_no": 3},
        ],
        enabled=True,
    )
    assert [w["_id"] for w in grouped] == ["w1", "w3", "w2"]
