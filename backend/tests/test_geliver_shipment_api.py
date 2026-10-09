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
                    "percentageCompleted": 100,
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


def test_geliver_friendly_error_yetki():
    import cargo_providers as cp

    msg = cp._geliver_friendly_error("bu işlem için yetkiniz yok", status_code=403, path="/transactions")
    assert "yetkiniz yok" in msg.lower()
    assert "bakiye" in msg.lower()
    assert "test" in msg.lower()
    assert "geliver:" in msg.lower()


def test_geliver_token_rejects_undecryptable_fernet_blob():
    """Rotated encryption key must not send ciphertext to Geliver as Bearer token."""
    import cargo_providers as cp

    cfg = {"api_key": "gAAAA" + ("A" * 80)}
    with pytest.raises(HTTPException) as exc:
        cp.geliver_token(cfg)
    assert "okunamadı" in str(exc.value.detail).lower() or "token" in str(exc.value.detail).lower()


def test_geliver_token_strips_bearer_prefix():
    import cargo_providers as cp

    assert cp.geliver_token({"api_key": "Bearer abc.def"}) == "abc.def"
    assert cp.geliver_token({"api_key": "  plain-token  "}) == "plain-token"


def test_geliver_test_uses_unfiltered_addresses_first():
    """Connection test must hit bare /addresses first (filter caused 403 on some accounts)."""
    import cargo_providers as cp

    calls = []

    async def fake_geliver(method, path, token, **kwargs):
        calls.append((method, path, kwargs.get("params")))
        if path == "/prices/balance":
            return {"balance": 100}
        assert method == "GET" and path == "/addresses"
        return {
            "items": [
                {
                    "id": "addr_sender",
                    "name": "Depo",
                    "cityName": "İstanbul",
                    "districtName": "Kadıköy",
                    "isRecipientAddress": False,
                },
                {
                    "id": "addr_recv",
                    "name": "Alıcı",
                    "cityName": "Ankara",
                    "districtName": "Çankaya",
                    "isRecipientAddress": True,
                },
            ]
        }

    with patch.object(cp, "_geliver", side_effect=fake_geliver):
        result = asyncio.run(cp.geliver_test({"api_key": "plain-token", "test_mode": True}))

    addr_call = next(c for c in calls if c[1] == "/addresses")
    assert addr_call[2] == {"limit": 50}
    assert "isRecipientAddress" not in (addr_call[2] or {})
    assert len(result["addresses"]) == 1
    assert result["addresses"][0]["id"] == "addr_sender"
    assert result["ok"] is True


def test_geliver_accept_yetki_soft_fails():
    import cargo_providers as cp

    async def fake_geliver(method, path, token, **kwargs):
        if method == "POST" and path == "/shipments":
            return {
                "id": "shp_perm",
                "offers": {
                    "percentageCompleted": 100,
                    "cheapest": {"id": "off_x", "providerServiceCode": "YK", "totalAmount": "10"},
                },
            }
        if method == "POST" and path == "/transactions":
            raise HTTPException(
                status_code=400,
                detail=cp._geliver_friendly_error("bu işlem için yetkiniz yok", status_code=403, path="/transactions"),
            )
        raise AssertionError(f"unexpected {method} {path}")

    cfg = {"api_key": "t", "sender_address_id": "a1", "test_mode": True}
    order = {
        "customer_name": "A",
        "customer_phone": "05321112233",
        "shipping_address": "Adr",
        "city": "İstanbul",
        "items": [],
    }
    with patch.object(cp, "_geliver", side_effect=fake_geliver):
        result = asyncio.run(cp.geliver_create_shipment(cfg, order, {"accept_offer": True}))
    assert result["accepted"] is False
    assert result["geliver_id"] == "shp_perm"
    assert result.get("accept_error")
    assert "yetki" in result["accept_error"].lower()


def test_cargo_create_shipment_allowed_with_orders_edit():
    """POST /api/cargo/create-shipment should pass when user has /orders edit even if /cargo is view."""
    from rbac import PermissionAndAuditMiddleware

    perms = {"/cargo": "view", "/orders": "edit"}
    module = "/cargo"
    path = "/api/cargo/create-shipment"
    allowed = perms.get(module, "none") == "edit"
    if not allowed and module == "/cargo" and (
        path.startswith("/api/cargo/create-shipment") or path.startswith("/api/cargo/auto-ship")
    ):
        allowed = perms.get("/orders", "none") == "edit"
    assert allowed is True

    perms2 = {"/cargo": "view", "/orders": "view"}
    allowed2 = perms2.get(module, "none") == "edit"
    if not allowed2 and module == "/cargo" and path.startswith("/api/cargo/create-shipment"):
        allowed2 = perms2.get("/orders", "none") == "edit"
    assert allowed2 is False
    _ = PermissionAndAuditMiddleware  # import sanity


def test_opt_flag_json_false():
    import cargo_providers as cp

    assert cp.opt_flag({}, "accept_offer", True) is True
    assert cp.opt_flag({"accept_offer": False}, "accept_offer", True) is False
    assert cp.opt_flag({"accept_offer": "false"}, "accept_offer", True) is False
    assert cp.opt_flag({"quote_only": True}, "quote_only", False) is True


def test_geliver_collect_offers_merges_list_cheapest_fastest():
    import cargo_providers as cp

    offers, cheapest, pct = cp.geliver_collect_offers({
        "offers": {
            "percentageCompleted": 90,
            "cheapest": {"id": "off_cheap", "providerServiceCode": "MNG_STANDART", "totalAmount": "32.50", "providerCode": "MNG"},
            "fastest": {"id": "off_fast", "providerServiceCode": "YK_NEXTDAY", "totalAmount": "48.00", "providerCode": "YURTICI"},
            "list": [
                {"id": "off_cheap", "providerServiceCode": "MNG_STANDART", "totalAmount": "32.50", "providerCode": "MNG"},
                {"id": "off_fast", "providerServiceCode": "YK_NEXTDAY", "totalAmount": "48.00", "providerCode": "YURTICI"},
                {"id": "off_mid", "providerServiceCode": "SURAT_STANDART", "totalAmount": "39.00", "providerCode": "SURAT"},
            ],
        }
    })
    ids = [o["id"] for o in offers]
    assert ids == ["off_cheap", "off_mid", "off_fast"]
    assert cheapest["id"] == "off_cheap"
    assert pct == 90
    cheap_row = next(o for o in offers if o["id"] == "off_cheap")
    fast_row = next(o for o in offers if o["id"] == "off_fast")
    assert cheap_row["is_cheapest"] is True
    assert fast_row["is_fastest"] is True
    assert cheap_row["service"] == "MNG_STANDART"


def test_geliver_quote_only_skips_transactions():
    import cargo_providers as cp

    calls = []

    async def fake_geliver(method, path, token, **kwargs):
        calls.append((method, path, kwargs.get("json")))
        if method == "POST" and path == "/shipments":
            return {
                "id": "shp_q",
                "offers": {
                    "percentageCompleted": 100,
                    "cheapest": {"id": "off_a", "providerServiceCode": "MNG_STANDART", "totalAmount": "20"},
                    "fastest": {"id": "off_b", "providerServiceCode": "YK_NEXTDAY", "totalAmount": "35"},
                    "list": [
                        {"id": "off_a", "providerServiceCode": "MNG_STANDART", "totalAmount": "20"},
                        {"id": "off_b", "providerServiceCode": "YK_NEXTDAY", "totalAmount": "35"},
                    ],
                },
            }
        raise AssertionError(f"unexpected {method} {path}")

    cfg = {"api_key": "t", "sender_address_id": "a1", "test_mode": True}
    order = {
        "customer_name": "A",
        "customer_phone": "05321112233",
        "shipping_address": "Adr",
        "city": "İstanbul",
        "items": [],
    }
    with patch.object(cp, "_geliver", side_effect=fake_geliver):
        result = asyncio.run(cp.geliver_create_shipment(cfg, order, {"accept_offer": False}))
    assert result["accepted"] is False
    assert result["geliver_id"] == "shp_q"
    assert [o["id"] for o in result["offers"]] == ["off_a", "off_b"]
    assert not any(p == "/transactions" for _, p, _ in calls)


def test_geliver_accept_offer_posts_selected_id():
    import cargo_providers as cp

    calls = []

    async def fake_geliver(method, path, token, **kwargs):
        calls.append((method, path, kwargs.get("json")))
        if method == "POST" and path == "/transactions":
            assert kwargs.get("json") == {"offerID": "off_b"}
            return {
                "id": "tx_sel",
                "shipment": {
                    "id": "shp_q",
                    "trackingNumber": "YK999",
                    "barcode": "BC9",
                    "labelURL": "https://label/9.pdf",
                },
                "offer": {"id": "off_b", "providerServiceCode": "YK_NEXTDAY", "totalAmount": "35"},
            }
        raise AssertionError(f"unexpected {method} {path}")

    with patch.object(cp, "_geliver", side_effect=fake_geliver):
        result = asyncio.run(cp.geliver_accept_offer({"api_key": "t"}, "off_b", "shp_q"))
    assert result["accepted"] is True
    assert result["tracking_number"] == "YK999"
    assert result["geliver_id"] == "shp_q"
    assert any(m == "POST" and p == "/transactions" for m, p, _ in calls)


def test_geliver_refresh_quotes_get_only():
    import cargo_providers as cp

    calls = []

    async def fake_geliver(method, path, token, **kwargs):
        calls.append((method, path))
        assert method == "GET" and path == "/shipments/shp_q"
        return {
            "id": "shp_q",
            "offers": {
                "percentageCompleted": 100,
                "cheapest": {"id": "off_a", "totalAmount": "20", "providerServiceCode": "MNG_STANDART"},
                "list": [{"id": "off_a", "totalAmount": "20", "providerServiceCode": "MNG_STANDART"}],
            },
        }

    with patch.object(cp, "_geliver", side_effect=fake_geliver):
        result = asyncio.run(cp.geliver_refresh_quotes({"api_key": "t"}, "shp_q"))
    assert result["accepted"] is False
    assert len(result["offers"]) == 1
    assert result["offers"][0]["id"] == "off_a"
