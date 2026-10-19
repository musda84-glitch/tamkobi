"""Varyant alış fiyatı kaydı. Eski varyantlar 0 sayılır; başka firmanın kartı 404."""
from __future__ import annotations

import asyncio
from unittest.mock import patch

from fastapi import HTTPException

import server
from models import ProductVariant


OWN = "co_mine"
OTHER = "co_other"
USER = {
    "_id": "u_mine",
    "company_ids": [OWN],
    "active_company_id": OWN,
    "is_super_admin": False,
    "role": "admin",
}


class _Coll:
    def __init__(self, docs):
        self.docs = {d["_id"]: dict(d) for d in docs}

    async def find_one(self, q):
        for d in self.docs.values():
            if all(d.get(k) == v for k, v in q.items()):
                return dict(d)
        return None

    async def update_one(self, q, upd):
        for d in self.docs.values():
            if all(d.get(k) == v for k, v in q.items()):
                d.update(upd.get("$set") or {})
                return


class _DB:
    def __init__(self, docs):
        self.products = _Coll(docs)

    def __getitem__(self, name):
        return getattr(self, name)


def _run(coro):
    try:
        return 200, asyncio.run(coro)
    except HTTPException as exc:
        return exc.status_code, exc.detail


def _product(pid, company_id, price=250.0):
    return {
        "_id": pid,
        "company_id": company_id,
        "name": "Raf",
        "sku": "RAF",
        "sale_price": 300,
        "purchase_price": 180,
        "variants": [],
        "stock_quantity": 0,
    }


def test_update_variants_keeps_purchase_price_and_sale_price():
    db = _DB([_product("prod_own", OWN)])
    req = server.VariantsUpdateRequest(variants=[{
        "variant_id": "v1",
        "name": "Mavi",
        "sku": "RAF-M",
        "barcode": "8680001",
        "stock": 4,
        "price": 250,
        "purchase_price": 175.5,
        "attributes": {"Renk": "Mavi"},
    }])
    with patch.object(server, "db", db):
        status, body = _run(server.update_product_variants("prod_own", req, USER))
    assert status == 200
    saved = body["variants"][0]
    assert saved["purchase_price"] == 175.5
    assert saved["price"] == 250
    stored = db.products.docs["prod_own"]["variants"][0]
    assert stored["purchase_price"] == 175.5
    assert stored["price"] == 250


def test_missing_purchase_price_and_old_variant_default_to_zero():
    old = {
        "variant_id": "eski",
        "name": "Eski",
        "sku": "ESKI-1",
        "barcode": "8680002",
        "stock": 3,
        "price": 42.0,
        "attributes": {"Renk": "Mavi"},
    }
    parsed = ProductVariant(**old)
    assert parsed.purchase_price == 0.0
    assert parsed.price == 42.0
    assert parsed.model_dump()["purchase_price"] == 0.0

    db = _DB([_product("prod_own", OWN)])
    req = server.VariantsUpdateRequest(variants=[old])
    with patch.object(server, "db", db):
        status, body = _run(server.update_product_variants("prod_own", req, USER))
    assert status == 200
    assert body["variants"][0]["purchase_price"] == 0.0
    assert body["variants"][0]["price"] == 42.0
    assert db.products.docs["prod_own"]["variants"][0]["purchase_price"] == 0.0


def test_negative_variant_purchase_price_is_stored_as_zero():
    db = _DB([_product("prod_own", OWN)])
    req = server.VariantsUpdateRequest(variants=[{
        "name": "Kırmızı",
        "sku": "RAF-K",
        "barcode": "8680003",
        "stock": 1,
        "price": 90,
        "purchase_price": -12,
    }])
    with patch.object(server, "db", db):
        status, body = _run(server.update_product_variants("prod_own", req, USER))
    assert status == 200
    assert body["variants"][0]["purchase_price"] == 0.0
    assert body["variants"][0]["price"] == 90
    assert db.products.docs["prod_own"]["variants"][0]["purchase_price"] == 0.0


def test_other_company_product_variants_404():
    db = _DB([_product("prod_other", OTHER)])
    before = dict(db.products.docs["prod_other"])
    req = server.VariantsUpdateRequest(variants=[{
        "name": "Sızma",
        "sku": "HACK",
        "barcode": "8680099",
        "stock": 1,
        "price": 1,
        "purchase_price": 999,
    }])
    with patch.object(server, "db", db):
        status, detail = _run(server.update_product_variants("prod_other", req, USER))
    assert status == 404
    assert detail == "Ürün bulunamadı."
    assert db.products.docs["prod_other"]["variants"] == before["variants"]
    assert db.products.docs["prod_other"]["variants"] == []
