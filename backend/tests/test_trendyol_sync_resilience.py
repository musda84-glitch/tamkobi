"""Trendyol sync window + V2 client path helpers (no live API)."""
import asyncio
import os
import sys
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import marketplace_providers as mp  # noqa: E402


def test_resolve_sync_days_first_pull_defaults_to_7():
    assert mp.resolve_sync_days(None, None, default_days=7) == 7
    assert mp.resolve_sync_days(None, 14) == 14
    assert mp.resolve_sync_days(None, 90, max_days=45) == 45


def test_resolve_sync_days_incremental_from_last_sync():
    recent = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    # 2h + 6h overlap → still 1 day window
    assert mp.resolve_sync_days(recent, 14, default_days=7, overlap_hours=6) == 1
    day_ago = (datetime.now(timezone.utc) - timedelta(days=1, hours=1)).isoformat()
    assert mp.resolve_sync_days(day_ago, 14, overlap_hours=6) >= 1
    assert mp.resolve_sync_days(day_ago, 14, overlap_hours=6) <= 14


def test_trendyol_orders_path_is_v2():
    assert "{seller_id}" in mp.TY_ORDERS_PATH
    assert "/v2/orders" in mp.TY_ORDERS_PATH
    client = mp.TrendyolClient({"api_key": "k", "api_secret": "s", "supplier_id": "304401"})
    assert client._orders_path.endswith("/v2/orders")
    assert "304401" in client._orders_path
    assert "/orders" in client._orders_path and "/v1/" not in client._orders_path


def test_paged_caps_at_50_pages_and_uses_path():
    async def _run():
        client = mp.TrendyolClient({"api_key": "k", "api_secret": "s", "supplier_id": "1"})
        calls = []

        async def fake_call(method, path, **kw):
            calls.append((method, path, kw.get("params") or {}))
            page = (kw.get("params") or {}).get("page", 0)
            # Pretend infinite pages — must stop at max_pages
            return {"content": [{"id": page}], "totalPages": 999, "page": page, "size": 200}

        client._call = fake_call
        with patch.object(mp.asyncio, "sleep", new=AsyncMock()):
            out = await client._paged(client._orders_path, 1, 2, 200, max_pages=mp.TY_ORDERS_MAX_PAGES)
        await client.close()
        assert len(calls) == mp.TY_ORDERS_MAX_PAGES
        assert all("/v2/orders" in c[1] for c in calls)
        assert len(out) == mp.TY_ORDERS_MAX_PAGES

    asyncio.run(_run())


def test_call_retries_on_429():
    async def _run():
        client = mp.TrendyolClient({"api_key": "k", "api_secret": "s", "supplier_id": "1"})
        responses = [
            MagicMock(status_code=429, text="rate", content=b""),
            MagicMock(status_code=200, content=b'{"ok":true}', json=lambda: {"ok": True}),
        ]

        async def request(*a, **k):
            return responses.pop(0)

        client.http.request = request
        with patch.object(mp.asyncio, "sleep", new=AsyncMock()):
            data = await client._call("GET", "/x")
        await client.close()
        assert data == {"ok": True}

    asyncio.run(_run())
