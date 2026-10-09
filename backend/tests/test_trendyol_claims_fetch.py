"""Trendyol claims() her claimItemStatus için filtreli çeker."""
import asyncio
from unittest.mock import AsyncMock, MagicMock

import marketplace_providers as mp


def test_claims_queries_each_status():
    client = MagicMock(spec=mp.TrendyolClient)
    client.seller_id = "123"
    seen = []

    async def fake_paged(path, start, end, size, extra=None, max_pages=20):
        st = (extra or {}).get("claimItemStatus")
        seen.append(st)
        if st == "WaitingInAction":
            return [{"id": 1, "orderNumber": "A", "items": []}]
        if st == "Created":
            return [{"id": 2, "orderNumber": "B", "items": []}]
        return []

    client._paged = AsyncMock(side_effect=fake_paged)
    out = asyncio.run(mp.TrendyolClient.claims(client, days=2))
    assert "WaitingInAction" in seen
    assert "Created" in seen
    assert "Accepted" in seen
    ids = {c["id"] for c in out}
    assert ids == {1, 2}
