"""Fiyat Merkezi: pazaryeri fiyatı + güncel komisyon oranı satırda dönsün."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pricing


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_compute_includes_marketplace_price_and_commission():
    fake_db = MagicMock()
    fake_db.pricing_rules.find = MagicMock(return_value=MagicMock(to_list=AsyncMock(return_value=[])))
    fake_db.integration_configs.find_one = AsyncMock(return_value={
        "channel": "trendyol",
        "fees": {"commission_rate": 18.5, "commission_vat_rate": 20.0, "service_fee": 10.0, "cargo_fee": 0.0},
    })
    pricing.init(fake_db, {
        "channel_fees": lambda cfg, ch: {
            "commission_rate": 18.5,
            "commission_vat_rate": 20.0,
            "service_fee": 10.0,
            "cargo_fee": 0.0,
        },
        "marketplace_products": AsyncMock(return_value={
            "push_supported": True,
            "rows": [
                {
                    "product_id": "p1",
                    "barcode": "8691",
                    "title": "Test",
                    "product_name": "Test",
                    "product_sku": "T1",
                    "sale_price": 199.0,
                    "local_price": 210.0,
                    "purchase_price": 80.0,
                    "quantity": 3,
                    "image": None,
                },
            ],
        }),
    })
    out = _run(pricing.compute_prices({"company_id": "c1", "channel": "trendyol"}))
    assert out["fees"]["commission_rate"] == 18.5
    row = out["rows"][0]
    assert row["marketplace_price"] == 199.0
    assert row["sale_price"] == 199.0
    assert row["local_price"] == 210.0
    assert row["commission_rate"] == 18.5
    assert row["effective_commission_rate"] == 22.2  # 18.5 * 1.2
    assert row["current_net"] is not None
    # 199 * (1 - 0.222) - 10 - 80 = 199*0.778 - 90
    assert abs(row["current_net"] - (199 * (1 - 0.222) - 10 - 80)) < 0.02


def test_compute_no_cost_still_exposes_mp_and_commission():
    fake_db = MagicMock()
    fake_db.pricing_rules.find = MagicMock(return_value=MagicMock(to_list=AsyncMock(return_value=[])))
    fake_db.integration_configs.find_one = AsyncMock(return_value={"channel": "trendyol", "fees": {}})
    pricing.init(fake_db, {
        "channel_fees": lambda cfg, ch: {
            "commission_rate": 21.5,
            "commission_vat_rate": 20.0,
            "service_fee": 12.99,
            "cargo_fee": 0.0,
        },
        "marketplace_products": AsyncMock(return_value={
            "push_supported": True,
            "rows": [{
                "product_id": "p2",
                "barcode": "8692",
                "title": "NoCost",
                "product_sku": "N1",
                "sale_price": 50.0,
                "purchase_price": 0,
                "quantity": 1,
            }],
        }),
    })
    out = _run(pricing.compute_prices({"company_id": "c1", "channel": "trendyol"}))
    row = out["rows"][0]
    assert row["suggested"] is None
    assert row["marketplace_price"] == 50.0
    assert row["commission_rate"] == 21.5
