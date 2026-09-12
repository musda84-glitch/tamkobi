"""Shared cargo package fields (desi, package_count, weight, dims) for all carriers."""
from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest
from fastapi import HTTPException


def test_normalize_package_opts_from_desi_and_count():
    import cargo_providers as cp

    pkg = cp.normalize_package_opts({"desi": 3, "package_count": 2}, {})
    assert pkg["package_count"] == 2
    assert pkg["desi"] == 3.0
    assert pkg["total_desi"] == 6.0
    assert pkg["weight"] == 3.0
    assert pkg["length"] == pkg["width"] == pkg["height"]
    assert pkg["length"] > 0


def test_normalize_package_opts_from_dimensions():
    import cargo_providers as cp

    pkg = cp.normalize_package_opts({"length": 30, "width": 20, "height": 10, "weight": 1.2}, {})
    assert pkg["desi"] == 2.0  # 30*20*10/3000
    assert pkg["weight"] == 1.2
    assert pkg["total_weight"] == 1.2


def test_normalize_package_opts_from_order_items_and_config():
    import cargo_providers as cp

    order = {"items": [{"desi": 1.5, "quantity": 2}, {"desi": 0.5, "quantity": 1}]}
    pkg = cp.normalize_package_opts({}, {"default_package_count": 1}, order)
    assert pkg["desi"] == 3.5
    assert pkg["package_count"] == 1


def test_geliver_payload_includes_desi_and_extra_parcels():
    import cargo_providers as cp

    calls = []

    async def fake_geliver(method, path, token, **kwargs):
        calls.append((method, path, kwargs.get("json")))
        if method == "POST" and path == "/shipments":
            return {
                "id": "shp_pkg",
                "offers": {
                    "percentageCompleted": 100,
                    "cheapest": {"id": "off_1", "providerServiceCode": "YK", "totalAmount": "50"},
                },
            }
        if method == "POST" and path == "/transactions":
            return {"id": "tx_1", "shipment": {"trackingNumber": "T1", "barcode": "B1", "labelURL": "https://l", "trackingUrl": "https://t"}}
        raise AssertionError(f"unexpected {method} {path}")

    cfg = {"api_key": "tok", "sender_address_id": "addr_1", "test_mode": True}
    order = {
        "customer_name": "Ayşe",
        "customer_phone": "05321112233",
        "shipping_address": "Cadde 1",
        "city": "Ankara",
        "items": [{"product_name": "Kutu", "quantity": 1}],
    }
    opts = {"package_count": 3, "desi": 2, "weight": 1.5, "accept_offer": True}

    with patch.object(cp, "_geliver", side_effect=fake_geliver):
        result = asyncio.run(cp.geliver_create_shipment(cfg, order, opts))

    body = next(b for m, p, b in calls if m == "POST" and p == "/shipments")
    assert body["desi"] == "2.0"
    assert body["weight"] == "1.5"
    assert len(body["extraParcels"]) == 2
    assert body["extraParcels"][0]["desi"] == "2.0"
    assert result["accepted"] is True
    assert result["package"]["package_count"] == 3
    assert result["package"]["total_desi"] == 6.0
