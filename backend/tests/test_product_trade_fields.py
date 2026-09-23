"""Stok kartı: menşei, GTIP ve üretici kodu alanları."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from models import Product


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_product_model_has_trade_identity_fields():
    p = Product(
        company_id="c1",
        name="Kulaklık",
        sku="BT-1",
        gtip="8518.30.00.00.00",
        origin_country="CN",
        manufacturer_code="SONY-WH1000",
    )
    assert p.gtip == "8518.30.00.00.00"
    assert p.origin_country == "CN"
    assert p.manufacturer_code == "SONY-WH1000"
    assert Product.model_fields["gtip"].default is None
    assert Product.model_fields["origin_country"].default is None
    assert Product.model_fields["manufacturer_code"].default is None


def test_update_product_persists_mensei_gtip_manufacturer():
    import server

    product_id = "prod_trade_1"
    updated = {
        "_id": product_id,
        "company_id": "c1",
        "name": "Kulaklık",
        "sku": "BT-1",
        "gtip": "8518.30.00.00.00",
        "origin_country": "CN",
        "manufacturer_code": "SONY-WH1000",
    }
    fake_db = MagicMock()
    fake_db.products.update_one = AsyncMock()
    fake_db.products.find_one = AsyncMock(return_value=updated)

    with patch.object(server, "db", fake_db):
        out = _run(server.update_product(product_id, {
            "gtip": "8518.30.00.00.00",
            "origin_country": "CN",
            "manufacturer_code": "SONY-WH1000",
        }))

    assert out["gtip"] == "8518.30.00.00.00"
    assert out["origin_country"] == "CN"
    assert out["manufacturer_code"] == "SONY-WH1000"
    patch_set = fake_db.products.update_one.await_args.args[1]["$set"]
    assert patch_set["gtip"] == "8518.30.00.00.00"
    assert patch_set["origin_country"] == "CN"
    assert patch_set["manufacturer_code"] == "SONY-WH1000"


def test_update_product_clears_trade_fields():
    import server

    product_id = "prod_trade_2"
    updated = {
        "_id": product_id,
        "gtip": None,
        "origin_country": None,
        "manufacturer_code": None,
    }
    fake_db = MagicMock()
    fake_db.products.update_one = AsyncMock()
    fake_db.products.find_one = AsyncMock(return_value=updated)

    with patch.object(server, "db", fake_db):
        out = _run(server.update_product(product_id, {
            "gtip": None,
            "origin_country": None,
            "manufacturer_code": None,
        }))

    assert out.get("gtip") is None
    assert out.get("origin_country") is None
    assert out.get("manufacturer_code") is None
