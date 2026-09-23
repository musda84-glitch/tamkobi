"""Ürün görseli: label_image_url ve galeri güncelleme."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch


def test_update_product_images_sets_label_image_url():
    import server

    product_id = "prod_img_1"
    doc = {
        "_id": product_id,
        "company_id": "comp_1",
        "name": "Test",
        "sku": "T1",
        "images": ["/api/files/a.webp", "/api/files/b.webp"],
        "image_url": "/api/files/a.webp",
    }
    updated = {**doc, "label_image_url": "/api/files/b.webp", "image_url": "/api/files/a.webp"}

    fake_db = MagicMock()
    fake_db.products = MagicMock()
    fake_db.products.update_one = AsyncMock(return_value=MagicMock())
    fake_db.products.find_one = AsyncMock(return_value=updated)

    async def _run():
        with patch.object(server, "db", fake_db):
            return await server.update_product_images(
                product_id,
                {
                    "images": doc["images"],
                    "image_url": doc["image_url"],
                    "label_image_url": "/api/files/b.webp",
                },
            )

    out = asyncio.run(_run())
    assert out["label_image_url"] == "/api/files/b.webp"
    kwargs = fake_db.products.update_one.await_args
    assert kwargs.args[1]["$set"]["label_image_url"] == "/api/files/b.webp"


def test_update_product_images_clears_label_image_url():
    import server

    product_id = "prod_img_2"
    updated = {
        "_id": product_id,
        "images": ["/api/files/a.webp"],
        "image_url": "/api/files/a.webp",
        "label_image_url": None,
    }
    fake_db = MagicMock()
    fake_db.products = MagicMock()
    fake_db.products.update_one = AsyncMock()
    fake_db.products.find_one = AsyncMock(return_value=updated)

    async def _run():
        with patch.object(server, "db", fake_db):
            return await server.update_product_images(
                product_id,
                {"images": ["/api/files/a.webp"], "image_url": "/api/files/a.webp", "label_image_url": None},
            )

    asyncio.run(_run())
    assert fake_db.products.update_one.await_args.args[1]["$set"]["label_image_url"] is None
