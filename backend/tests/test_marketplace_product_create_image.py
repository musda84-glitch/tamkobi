"""Pazaryeri Kart Aç: görsel yükleme + eşleşmeyenlere toplu kart."""
from __future__ import annotations

import asyncio
import os
import sys
from types import ModuleType
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def _stub_emergent():
    if "emergentintegrations" in sys.modules:
        return
    root = ModuleType("emergentintegrations")
    llm = ModuleType("emergentintegrations.llm")
    chat = ModuleType("emergentintegrations.llm.chat")

    class LlmChat:
        def __init__(self, *a, **k):
            pass

        async def send_message(self, *a, **k):
            return ""

    class UserMessage:
        def __init__(self, *a, **k):
            pass

    chat.LlmChat = LlmChat
    chat.UserMessage = UserMessage
    payments = ModuleType("emergentintegrations.payments")
    stripe_svc = ModuleType("emergentintegrations.payments.stripe")
    stripe_checkout = ModuleType("emergentintegrations.payments.stripe.checkout")

    class StripeCheckout:
        def __init__(self, *a, **k):
            pass

    class CheckoutSessionRequest:
        def __init__(self, *a, **k):
            pass

    class CheckoutSessionResponse:
        def __init__(self, *a, **k):
            pass

    stripe_checkout.StripeCheckout = StripeCheckout
    stripe_checkout.CheckoutSessionRequest = CheckoutSessionRequest
    stripe_checkout.CheckoutSessionResponse = CheckoutSessionResponse
    sys.modules["emergentintegrations"] = root
    sys.modules["emergentintegrations.llm"] = llm
    sys.modules["emergentintegrations.llm.chat"] = chat
    sys.modules["emergentintegrations.payments"] = payments
    sys.modules["emergentintegrations.payments.stripe"] = stripe_svc
    sys.modules["emergentintegrations.payments.stripe.checkout"] = stripe_checkout


_stub_emergent()

import server  # noqa: E402


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


@pytest.fixture(autouse=True)
def _reset_db():
    server.db.products.find_one = AsyncMock(return_value=None)
    server.db.products.insert_one = AsyncMock()
    server.db.products.update_one = AsyncMock()
    server.db.products.find = MagicMock()
    server.db.files.insert_one = AsyncMock()
    server.db.marketplace_product_cache.find_one = AsyncMock(return_value=None)
    yield


def test_create_product_attaches_remote_image():
    async def _attach(pid, url):
        assert url == "https://cdn.example/p/ty.jpg"
        assert pid
        return "/api/files/c1/products/a.webp"

    async def _find_one(q, *a, **k):
        if isinstance(q, dict) and q.get("_id"):
            return {"_id": q["_id"], "company_id": "c1", "name": "TY Ürün", "image_url": "/api/files/c1/products/a.webp"}
        return None

    server.db.products.find_one = AsyncMock(side_effect=_find_one)

    with patch.object(server.saas, "check_product_limit", AsyncMock()), \
         patch.object(server, "_remember_category", AsyncMock()), \
         patch.object(server, "_remember_unit", AsyncMock()), \
         patch.object(server, "_attach_product_image_from_url", AsyncMock(side_effect=_attach)):
        out = _run(server.create_product_from_marketplace({
            "company_id": "c1",
            "product_name": "TY Ürün",
            "barcode": "8699999000001",
            "sku": "TY-1",
            "channel": "trendyol",
            "image": "https://cdn.example/p/ty.jpg",
        }))
    assert out["image_url"] == "/api/files/c1/products/a.webp"
    assert "görsel yüklendi" in out["message"]
    assert out["product"].get("image_url") == "/api/files/c1/products/a.webp"


def test_create_product_without_image_ok():
    with patch.object(server.saas, "check_product_limit", AsyncMock()), \
         patch.object(server, "_remember_category", AsyncMock()), \
         patch.object(server, "_remember_unit", AsyncMock()), \
         patch.object(server, "_attach_product_image_from_url", AsyncMock()) as attach:
        out = _run(server.create_product_from_marketplace({
            "company_id": "c1",
            "product_name": "Görselsiz",
            "barcode": "8699999000002",
            "channel": "trendyol",
        }))
    attach.assert_not_awaited()
    assert out["image_url"] is None
    assert out["status"] == "success"


def test_attach_from_url_downloads_and_stores():
    jpeg = b"\xff\xd8\xff\xe0" + b"\x00" * 64
    product = {"_id": "p1", "company_id": "c1"}
    server.db.products.find_one = AsyncMock(return_value=product)

    class _Resp:
        status_code = 200
        content = jpeg
        headers = {"content-type": "image/jpeg"}

    class _Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url):
            assert "cdn.example" in url
            return _Resp()

    with patch.object(server.httpx, "AsyncClient", return_value=_Client()), \
         patch.object(server, "_store_product_image_bytes", AsyncMock(return_value={"image_url": "/api/files/z.jpg"})) as store:
        url = _run(server._attach_product_image_from_url("p1", "https://cdn.example/x.jpg"))
    assert url == "/api/files/z.jpg"
    store.assert_awaited_once()
    assert store.await_args.args[2] == "image/jpeg"


def test_bulk_create_from_items_with_images():
    async def _one(payload):
        return {
            "status": "success",
            "product": {"id": f"p-{payload.get('barcode')}", "_id": f"p-{payload.get('barcode')}"},
            "image_url": "/api/files/x.jpg" if payload.get("image") else None,
            "message": "ok",
        }

    with patch.object(server, "create_product_from_marketplace", AsyncMock(side_effect=_one)) as create:
        out = _run(server.create_products_from_marketplace_bulk({
            "company_id": "c1",
            "channel": "trendyol",
            "items": [
                {"product_name": "A", "barcode": "1", "image": "https://cdn.example/a.jpg"},
                {"product_name": "B", "barcode": "2"},
            ],
        }))
    assert create.await_count == 2
    assert out["created"] == 2
    assert out["with_image"] == 1
    assert "2 stok kartı" in out["message"]


def test_bulk_create_loads_unmatched_from_cache():
    server.db.marketplace_product_cache.find_one = AsyncMock(return_value={
        "items": [
            {"barcode": "111", "title": "Eşleşmemiş", "stock_code": "S1", "sale_price": 10, "quantity": 2, "image": "https://cdn.example/1.jpg"},
            {"barcode": "222", "title": "Eşleşmiş", "stock_code": "S2", "sale_price": 20, "quantity": 1, "image": "https://cdn.example/2.jpg"},
        ]
    })
    cursor = MagicMock()
    cursor.to_list = AsyncMock(return_value=[
        {"_id": "p2", "barcode": "222", "sku": "S2", "marketplace_aliases": [], "variants": []},
    ])
    server.db.products.find = MagicMock(return_value=cursor)

    async def _one(payload):
        return {
            "status": "success",
            "product": {"id": "p-new", "_id": "p-new"},
            "image_url": "/api/files/y.jpg",
            "message": "ok",
        }

    with patch.object(server, "create_product_from_marketplace", AsyncMock(side_effect=_one)) as create:
        out = _run(server.create_products_from_marketplace_bulk({
            "company_id": "c1",
            "channel": "trendyol",
            "items": [],
        }))
    assert create.await_count == 1
    call_payload = create.await_args.args[0]
    assert call_payload["barcode"] == "111"
    assert call_payload["image"] == "https://cdn.example/1.jpg"
    assert out["created"] == 1
    assert out["with_image"] == 1
