"""Ürün stok kartı: label_template_id kaydı ve okuma."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from models import Product


def test_product_model_has_label_template_id():
    p = Product(
        company_id="comp_1",
        name="Test",
        sku="T1",
        barcode="8680000000001",
        label_template_id="tpl_abc",
    )
    assert p.label_template_id == "tpl_abc"
    assert Product.model_fields["label_template_id"].default is None


def test_update_product_persists_label_template_id():
    import server

    product_id = "prod_lbl_1"
    updated = {
        "_id": product_id,
        "company_id": "comp_1",
        "name": "Profil",
        "sku": "P1",
        "label_template_id": "tpl_50x30",
    }
    fake_db = MagicMock()
    fake_db.products = MagicMock()
    fake_db.products.update_one = AsyncMock(return_value=MagicMock())
    fake_db.products.find_one = AsyncMock(return_value=updated)

    async def _run():
        with patch.object(server, "db", fake_db):
            return await server.update_product(product_id, {"label_template_id": "tpl_50x30"})

    out = asyncio.run(_run())
    assert out["label_template_id"] == "tpl_50x30"
    kwargs = fake_db.products.update_one.await_args
    assert kwargs.args[1]["$set"]["label_template_id"] == "tpl_50x30"


def test_update_product_clears_label_template_id():
    import server

    product_id = "prod_lbl_2"
    updated = {"_id": product_id, "label_template_id": None}
    fake_db = MagicMock()
    fake_db.products = MagicMock()
    fake_db.products.update_one = AsyncMock()
    fake_db.products.find_one = AsyncMock(return_value=updated)

    async def _run():
        with patch.object(server, "db", fake_db):
            return await server.update_product(product_id, {"label_template_id": None})

    asyncio.run(_run())
    assert fake_db.products.update_one.await_args.args[1]["$set"]["label_template_id"] is None
