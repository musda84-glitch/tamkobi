"""Ürün stok kartı: etiket tasarımı serbest alanları (label_text_1..3)."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from models import Product


def test_product_model_has_label_text_fields():
    p = Product(
        company_id="comp_1",
        name="Test",
        sku="T1",
        barcode="8680000000001",
        label_text_1="Menşei TR",
        label_text_2="Gri",
        label_text_3="2026",
    )
    assert p.label_text_1 == "Menşei TR"
    assert p.label_text_2 == "Gri"
    assert p.label_text_3 == "2026"
    assert Product.model_fields["label_text_1"].default is None
    assert Product.model_fields["label_text_2"].default is None
    assert Product.model_fields["label_text_3"].default is None


def test_update_product_persists_label_texts():
    import server

    product_id = "prod_lbl_txt_1"
    updated = {
        "_id": product_id,
        "company_id": "comp_1",
        "name": "Profil",
        "sku": "P1",
        "label_text_1": "A",
        "label_text_2": "B",
        "label_text_3": None,
    }
    fake_db = MagicMock()
    fake_db.products = MagicMock()
    fake_db.products.update_one = AsyncMock(return_value=MagicMock())
    fake_db.products.find_one = AsyncMock(return_value=updated)

    async def _run():
        with patch.object(server, "db", fake_db):
            return await server.update_product(
                product_id,
                {"label_text_1": "A", "label_text_2": "B", "label_text_3": None},
            )

    out = asyncio.run(_run())
    assert out["label_text_1"] == "A"
    assert out["label_text_2"] == "B"
    assert out["label_text_3"] is None
    kwargs = fake_db.products.update_one.await_args
    assert kwargs.args[1]["$set"]["label_text_1"] == "A"
    assert kwargs.args[1]["$set"]["label_text_2"] == "B"
    assert kwargs.args[1]["$set"]["label_text_3"] is None
