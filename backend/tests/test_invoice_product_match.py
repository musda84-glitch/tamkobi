"""Gelen fatura/irsaliye satır stok kartı eşleştirme."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

import server


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_is_incoming_product_matchable_purchase_and_dispatch():
    assert server._is_incoming_product_matchable({
        "invoice_type": "purchase",
        "direction": "incoming",
        "status": "approved",
    })
    assert server._is_incoming_product_matchable({
        "invoice_type": "dispatch",
        "direction": "incoming",
        "e_type": "e_dispatch",
        "status": "approved",
    })
    assert server._is_incoming_product_matchable({
        "invoice_type": "purchase",
        "source": "edoc_inbox",
        "status": "approved",
    })
    assert not server._is_incoming_product_matchable({
        "invoice_type": "sales",
        "direction": "outgoing",
        "status": "approved",
    })
    assert not server._is_incoming_product_matchable({
        "invoice_type": "purchase",
        "direction": "incoming",
        "status": "cancelled",
    })


def test_match_invoice_item_product_links_and_alias():
    inv = {
        "_id": "inv1",
        "company_id": "c1",
        "invoice_type": "purchase",
        "direction": "incoming",
        "status": "approved",
        "items": [
            {"name": "Araç Kiralama Hizmeti — TEST", "sku": "AK-1", "quantity": 1, "unit_price": 100, "vat_rate": 20, "total": 100},
        ],
    }
    product = {"_id": "p1", "name": "Araç Kiralama", "company_id": "c1", "supplier_codes": []}

    async def _find_one(q, *a, **k):
        if q.get("_id") == "inv1":
            return inv
        if q.get("_id") == "p1":
            return product
        return None

    server.db.invoices.find_one = AsyncMock(side_effect=_find_one)
    server.db.products.find_one = AsyncMock(return_value=product)
    server.db.invoices.update_one = AsyncMock()
    server.db.products.update_one = AsyncMock()

    out = _run(server.match_invoice_item_product("inv1", {"idx": 0, "product_id": "p1"}))
    assert out["status"] == "success"
    assert out["invoice"]["items"][0]["product_id"] == "p1"
    assert out["invoice"]["items"][0]["matched_product_name"] == "Araç Kiralama"
    # supplier_codes + marketplace_aliases
    assert server.db.products.update_one.await_count >= 2


def test_create_missing_products_for_invoice():
    inv = {
        "_id": "inv2",
        "company_id": "c1",
        "invoice_type": "dispatch",
        "direction": "incoming",
        "e_type": "e_dispatch",
        "status": "approved",
        "items": [
            {"name": "Kalem A", "quantity": 2, "unit_price": 10, "vat_rate": 20, "total": 20},
            {"name": "Kalem B", "quantity": 1, "unit_price": 5, "vat_rate": 20, "total": 5, "product_id": "p_exist"},
        ],
    }
    created_ids = {"Kalem A": "p_new"}

    async def _find_inv(q, *a, **k):
        return inv

    async def _find_prod(q, *a, **k):
        if q.get("_id") == "p_new":
            return {"_id": "p_new", "name": "Kalem A", "company_id": "c1"}
        if q.get("_id") == "p_exist":
            return {"_id": "p_exist", "name": "Kalem B", "company_id": "c1"}
        return None

    server.db.invoices.find_one = AsyncMock(side_effect=_find_inv)
    server.db.products.find_one = AsyncMock(side_effect=_find_prod)
    server.db.invoices.update_one = AsyncMock()
    server.db.products.update_one = AsyncMock()

    with patch.object(
        server,
        "create_product_from_marketplace",
        AsyncMock(return_value={"product": {"id": "p_new", "name": "Kalem A"}}),
    ) as create_mock, patch.object(
        server,
        "_find_product_for_invoice_line",
        AsyncMock(return_value=None),
    ):
        out = _run(server.create_missing_products_for_invoice("inv2", {}))

    assert out["created_products"] == 1
    assert out["invoice"]["items"][0]["product_id"] == "p_new"
    assert out["invoice"]["items"][1]["product_id"] == "p_exist"
    create_mock.assert_awaited_once()


def test_match_rejects_outgoing_sales():
    server.db.invoices.find_one = AsyncMock(return_value={
        "_id": "inv3",
        "invoice_type": "sales",
        "status": "approved",
        "items": [{"name": "X"}],
    })
    with pytest.raises(HTTPException) as e:
        _run(server.match_invoice_item_product("inv3", {"idx": 0, "product_id": "p1"}))
    assert e.value.status_code == 400


def test_routes_registered():
    paths = [getattr(r, "path", "") or "" for r in server.api_router.routes]
    assert any(p.endswith("/invoices/{invoice_id}/items/match") for p in paths)
    assert any(p.endswith("/invoices/{invoice_id}/items/create-product") for p in paths)
    assert any(p.endswith("/invoices/{invoice_id}/items/create-missing-products") for p in paths)
