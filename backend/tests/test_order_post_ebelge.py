"""Sipariş Faturala: taslak onay → cari; e-belge GİB işaretlemesi."""
from unittest.mock import AsyncMock, MagicMock, patch
import asyncio
import types


def test_approve_invoice_marks_order_invoiced_and_applies_effects():
    import server

    inv = {
        "_id": "inv_1",
        "status": "draft",
        "order_id": "ord_1",
        "invoice_number": "SF-001",
        "contact_id": "c1",
        "invoice_type": "sales",
        "grand_total": 100.0,
        "e_type": "e_archive",
        "gib_status": "Taslak",
        "items": [],
    }
    db = MagicMock()
    db.invoices.find_one = AsyncMock(side_effect=[inv, {**inv, "status": "approved", "effects_applied": True}])
    db.invoices.update_one = AsyncMock()
    db.orders.update_one = AsyncMock()

    async def run():
        with patch.object(server, "db", db), patch.object(server, "_apply_invoice_effects", AsyncMock()) as apply:
            out = await server.approve_invoice("inv_1")
            assert out["status"] == "success"
            apply.assert_awaited_once()
            db.orders.update_one.assert_awaited()
            args, kwargs = db.orders.update_one.await_args
            assert args[0] == {"_id": "ord_1"}
            assert args[1]["$set"]["is_invoiced"] is True
            assert args[1]["$set"]["invoice_id"] == "inv_1"

    asyncio.run(run())


def test_finalize_create_result_sets_order_invoiced():
    import e_invoice as ei

    db = MagicMock()
    db.invoices.find_one = AsyncMock(return_value={"_id": "inv_2", "invoice_number": "SF-002", "order_id": "ord_2", "company_id": "co"})
    db.orders.update_one = AsyncMock()
    db.e_invoices.update_one = AsyncMock()

    async def run():
        with patch.object(ei, "_db", db), patch.object(ei, "record_e_invoice", AsyncMock()):
            out = await ei.finalize_create_result(
                {"status": "success", "message": "ok"},
                "inv_2",
                order_id="ord_2",
                company_id="co",
            )
            assert out["invoice_id"] == "inv_2"
            db.orders.update_one.assert_awaited()
            args = db.orders.update_one.await_args[0]
            assert args[0] == {"_id": "ord_2"}
            assert args[1]["$set"]["is_invoiced"] is True

    asyncio.run(run())
