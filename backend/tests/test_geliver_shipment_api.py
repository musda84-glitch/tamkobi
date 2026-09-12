"""Geliver shipment payload & accept-offer endpoint must match official SDK."""
from __future__ import annotations

import asyncio
from unittest.mock import patch

import pytest
from fastapi import HTTPException


def test_geliver_accept_offer_posts_transactions_not_accept_offer_path():
    import cargo_providers as cp

    calls = []

    async def fake_geliver(method, path, token, **kwargs):
        calls.append((method, path, kwargs.get("json")))
        if method == "POST" and path == "/shipments":
            return {
                "id": "shp_1",
                "offers": {
                    "cheapest": {
                        "id": "off_1",
                        "providerServiceCode": "YURTICI",
                        "totalAmount": "45.00",
                    }
                },
            }
        if method == "POST" and path == "/transactions":
            assert kwargs.get("json") == {"offerID": "off_1"}
            return {
                "id": "tx_1",
                "shipment": {
                    "trackingNumber": "YK123",
                    "barcode": "BC1",
                    "labelURL": "https://label/1.pdf",
                    "trackingUrl": "https://track/1",
                },
            }
        if method == "POST" and path == "/transactions/accept-offer":
            raise AssertionError("legacy accept-offer path must not be used")
        raise AssertionError(f"unexpected call {method} {path}")

    cfg = {
        "api_key": "plain-token",
        "sender_address_id": "addr_1",
        "test_mode": True,
        "status": "connected",
        "is_active": True,
    }
    order = {
        "customer_name": "Ali Veli",
        "customer_phone": "05321234567",
        "shipping_address": "Test Mah. No:1",
        "city": "İstanbul",
        "district": "Kadıköy",
        "order_number": "ORD-1",
        "total_amount": 150,
        "items": [{"product_name": "Kalem", "quantity": 2}],
    }

    with patch.object(cp, "_geliver", side_effect=fake_geliver):
        result = asyncio.run(cp.geliver_create_shipment(cfg, order, {"accept_offer": True}))

    assert any(m == "POST" and p == "/shipments" for m, p, _ in calls)
    assert any(m == "POST" and p == "/transactions" for m, p, _ in calls)
    assert not any(p == "/transactions/accept-offer" for _, p, _ in calls)
    assert result["accepted"] is True
    assert result["tracking_number"] == "YK123"
    assert result["label_url"] == "https://label/1.pdf"

    create_body = next(body for m, p, body in calls if m == "POST" and p == "/shipments")
    assert create_body["senderAddressID"] == "addr_1"
    assert create_body["recipientAddress"]["cityName"] == "İstanbul"
    assert create_body["recipientAddress"]["zip"]
    assert create_body["recipientAddress"]["phone"].startswith("+90")
    assert create_body["order"]["totalAmountCurrency"] == "TRY"
    assert isinstance(create_body["order"]["totalAmount"], str)


def test_geliver_requires_sender_and_phone():
    import cargo_providers as cp

    with pytest.raises(HTTPException) as e1:
        asyncio.run(
            cp.geliver_create_shipment(
                {"api_key": "x", "test_mode": True},
                {"customer_phone": "05321112233", "city": "Ankara"},
                {},
            )
        )
    assert "gönderici" in e1.value.detail.lower() or "adres" in e1.value.detail.lower()

    with pytest.raises(HTTPException) as e2:
        asyncio.run(
            cp.geliver_create_shipment(
                {"api_key": "x", "sender_address_id": "a1", "test_mode": True},
                {"customer_name": "A", "shipping_address": "X", "city": "Ankara"},
                {},
            )
        )
    assert "telefon" in e2.value.detail.lower()
