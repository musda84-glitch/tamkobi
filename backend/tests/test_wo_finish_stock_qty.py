"""Bitir modalı: fazla/eksik üretilen miktara göre stok düşümü."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import production_work_orders as pwo


def test_discrete_round_for_finish_adet():
    assert pwo.round_needed_qty(2.857, "Adet") == 3
    assert pwo.round_needed_qty(2.0, "Adet") == 2
    assert pwo.round_needed_qty(16.4, "Metre") == 16.4


def test_finish_material_step_deducts_entered_stock():
    """Hammadde adımında girilen 5 Adet → stok -5 (plan 3 olsa bile)."""
    import server

    wo = {
        "_id": "wo1",
        "order_id": "po1",
        "company_id": "c1",
        "status": "in_progress",
        "step_no": 1,
        "step_name": "Kesim",
        "step_count": 2,
        "order_code": "URT-1",
        "material_product_id": "mat1",
        "material_name": "MDF Plaka",
        "unit": "Adet",
        "planned_quantity": 10,
        "materials": [{"product_id": "mat1", "product_name": "MDF Plaka", "needed": 3, "unit": "Adet"}],
        "logs": [],
    }
    nxt = {"_id": "wo2", "step_no": 2, "step_name": "Montaj", "station": "Atölye"}

    fake_db = MagicMock()
    fake_db.work_orders = MagicMock()
    fake_db.work_orders.update_one = AsyncMock()
    fake_db.work_orders.find_one = AsyncMock(return_value=nxt)
    fake_db.products = MagicMock()
    fake_db.products.find_one = AsyncMock(return_value={"_id": "mat1", "name": "MDF Plaka", "company_id": "c1"})
    fake_db.products.update_one = AsyncMock()
    fake_db.stock_movements = MagicMock()
    fake_db.stock_movements.insert_one = AsyncMock()

    with patch.object(server, "db", fake_db), patch.object(server, "_wo", AsyncMock(return_value=dict(wo))):
        out = asyncio.run(
            server.finish_work_order("wo1", {"produced_qty": 5, "scrap_qty": 0, "operator_name": "Ali"})
        )

    assert "stoktan" in out["message"].lower()
    fake_db.products.update_one.assert_awaited()
    args = fake_db.products.update_one.await_args.args
    assert args[0] == {"_id": "mat1"}
    assert args[1] == {"$inc": {"stock_quantity": -5.0}}
    wo_set = fake_db.work_orders.update_one.await_args_list[0].args[1]["$set"]
    assert wo_set["material_stock_deducted"] is True
    assert wo_set["material_stock_qty"] == 5.0
    assert wo_set["produced_qty"] == 5.0


def test_finish_ceils_fractional_adet_before_stock():
    import server

    wo = {
        "_id": "wo1",
        "order_id": "po1",
        "company_id": "c1",
        "status": "in_progress",
        "step_no": 1,
        "step_name": "Kesim",
        "step_count": 2,
        "order_code": "URT-1",
        "material_product_id": "mat1",
        "material_name": "Plaka",
        "unit": "Adet",
        "planned_quantity": 10,
        "materials": [{"product_id": "mat1", "product_name": "Plaka", "needed": 2.857, "unit": "Adet"}],
        "logs": [],
    }
    fake_db = MagicMock()
    fake_db.work_orders = MagicMock()
    fake_db.work_orders.update_one = AsyncMock()
    fake_db.work_orders.find_one = AsyncMock(return_value={"_id": "wo2", "step_no": 2, "step_name": "X", "station": "Y"})
    fake_db.products = MagicMock()
    fake_db.products.find_one = AsyncMock(return_value={"_id": "mat1", "name": "Plaka", "company_id": "c1"})
    fake_db.products.update_one = AsyncMock()
    fake_db.stock_movements = MagicMock()
    fake_db.stock_movements.insert_one = AsyncMock()

    with patch.object(server, "db", fake_db), patch.object(server, "_wo", AsyncMock(return_value=dict(wo))):
        asyncio.run(server.finish_work_order("wo1", {"produced_qty": 2.857, "scrap_qty": 0}))

    args = fake_db.products.update_one.await_args.args
    assert args[1] == {"$inc": {"stock_quantity": -3.0}}
    wo_set = fake_db.work_orders.update_one.await_args_list[0].args[1]["$set"]
    assert wo_set["produced_qty"] == 3.0
