"""Pazaryeri sipariş kalemleri: Ürünler & Fiyat cache görsel/adı."""
import asyncio
from unittest.mock import AsyncMock, MagicMock

import order_mp_item_media as omp


def test_apply_marketplace_item_media_by_barcode():
    order = {
        "channel": "trendyol",
        "items": [
            {"barcode": "869111", "sku": "SKU-1", "product_name": "Eski ad", "quantity": 2},
            {"barcode": "unknown", "product_name": "Kalır", "quantity": 1},
        ],
    }
    by_ch = {
        "trendyol": {
            "869111": {"image": "https://cdn.example/a.jpg", "title": "Liste Başlığı"},
        }
    }
    out = omp.apply_marketplace_item_media(order, by_ch)
    assert out["items"][0]["image_url"] == "https://cdn.example/a.jpg"
    assert out["items"][0]["product_name"] == "Liste Başlığı"
    assert out["items"][1]["product_name"] == "Kalır"
    assert "image_url" not in out["items"][1]


def test_apply_marketplace_item_media_by_sku():
    order = {
        "channel": "shopphp",
        "items": [{"sku": "STK-9", "product_name": "X", "quantity": 1}],
    }
    by_ch = {"shopphp": {"stk-9": {"image": "/img.webp", "title": "Shop Başlık"}}}
    out = omp.apply_marketplace_item_media(order, by_ch)
    assert out["items"][0]["image_url"] == "/img.webp"
    assert out["items"][0]["product_name"] == "Shop Başlık"


def test_apply_marketplace_item_media_skips_b2b():
    order = {"channel": "b2b", "items": [{"barcode": "1", "product_name": "X"}]}
    out = omp.apply_marketplace_item_media(order, {"b2b": {"1": {"image": "/a.jpg", "title": "T"}}})
    assert out is order


def test_build_cache_media_index():
    idx = omp.build_cache_media_index([
        {"barcode": "BC1", "stock_code": "SKU1", "title": "TY Ürün", "image": "https://cdn.ty/img.jpg"},
        {"barcode": "", "title": "", "image": ""},
    ])
    assert idx["bc1"]["title"] == "TY Ürün"
    assert idx["sku1"]["image"] == "https://cdn.ty/img.jpg"


def test_enrich_orders_marketplace_item_media_loads_cache():
    docs = [
        {
            "id": "o1",
            "company_id": "comp_1",
            "channel": "trendyol",
            "items": [{"barcode": "BC1", "product_name": "Ham", "quantity": 1}],
        }
    ]
    fake_db = MagicMock()
    fake_db.marketplace_product_cache.find_one = AsyncMock(
        return_value={
            "items": [
                {"barcode": "BC1", "title": "TY Ürün", "image": "https://cdn.ty/img.jpg", "stock_code": "SKU1"},
            ]
        }
    )

    out = asyncio.run(omp.enrich_orders_marketplace_item_media(fake_db, docs, company_id="comp_1"))
    assert out[0]["items"][0]["image_url"] == "https://cdn.ty/img.jpg"
    assert out[0]["items"][0]["product_name"] == "TY Ürün"
    fake_db.marketplace_product_cache.find_one.assert_awaited()
