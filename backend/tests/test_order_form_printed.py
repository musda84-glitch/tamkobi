"""mark-form-printed endpoint sets form_printed_at on orders."""
from unittest.mock import AsyncMock, MagicMock, patch
import asyncio


def test_mark_form_printed_sets_timestamp():
    import server

    db = MagicMock()
    db.orders.update_many = AsyncMock()

    async def run():
        with patch.object(server, "db", db):
            out = await server.mark_form_printed({"ids": ["ord_a", "ord_b"]})
            assert out["status"] == "success"
            assert out["count"] == 2
            assert out.get("form_printed_at")
            db.orders.update_many.assert_awaited()
            args = db.orders.update_many.await_args[0]
            assert args[0] == {"_id": {"$in": ["ord_a", "ord_b"]}}
            assert "form_printed_at" in args[1]["$set"]

    asyncio.run(run())


def test_mark_form_printed_requires_ids():
    import server
    from fastapi import HTTPException

    async def run():
        try:
            await server.mark_form_printed({"ids": []})
            assert False, "expected HTTPException"
        except HTTPException as e:
            assert e.status_code == 400

    asyncio.run(run())
