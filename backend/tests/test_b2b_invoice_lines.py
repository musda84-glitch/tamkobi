"""B2B hesap ekstresi: bayi yalnız kendi faturasının kalemlerini görür."""
import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

import server


SECRET_KEYS = {
    "purchase_price", "cost_price", "last_purchase_price", "avg_purchase_price",
    "landed_unit_try", "unit_cost", "cost", "cost_amount", "buy_price",
    "profit", "profit_amount", "gross_profit", "net_profit",
    "margin", "margin_pct", "margin_amount",
    "internal_note", "internal_notes", "notes", "note",
}
SECRET_TEXT = ("IC-NOT-GIZLI-XYZ", "IC-SATIR-NOTU", "FATURA-IC-NOT", "123456.78", "999999.99")

CONTACT = {
    "_id": "cnt_01",
    "company_id": "comp_01",
    "name": "Demo Bayi",
    "b2b_enabled": True,
    "b2b_token": "tok",
}
COMPANY = {"_id": "comp_01", "b2b_settings": {"enabled": True, "show_statement": True}}
PRODUCT = {
    "_id": "prod_01",
    "company_id": "comp_01",
    "name": "Duvar Rafı",
    "sku": "DRC",
    "barcode": "8680000000000",
    "unit": "Adet",
    "image_url": "/api/files/raf.webp",
    "purchase_price": 123456.78,
    "cost_price": 111111.11,
    "variants": [{
        "variant_id": "v2",
        "name": "Beyaz",
        "sku": "DRC-W",
        "barcode": "8680001234013",
        "image_url": "/api/files/raf-beyaz.webp",
        "purchase_price": 999999.99,
    }],
}
OWN = {
    "_id": "inv_own",
    "company_id": "comp_01",
    "contact_id": "cnt_01",
    "status": "approved",
    "invoice_number": "SF-1",
    "currency": "USD",
    "subtotal": 1250.5,
    "vat_total": 250.1,
    "grand_total": 1500.6,
    "notes": "FATURA-IC-NOT",
    "internal_notes": "IC-NOT-GIZLI-XYZ",
    "profit": 400,
    "items": [
        {
            "product_id": "prod_01",
            "name": "Duvar Rafı",
            "variant_id": "v2",
            "variant_name": "Beyaz",
            "quantity": 2,
            "unit": "Adet",
            "unit_price": 500,
            "discount_rate": 10,
            "vat_rate": 20,
            "total": 900,
            "purchase_price": 123456.78,
            "cost_price": 40,
            "profit": 80,
            "profit_amount": 80,
            "margin": 30,
            "landed_unit_try": 77.7,
            "internal_note": "IC-NOT-GIZLI-XYZ",
            "note": "IC-SATIR-NOTU",
        },
        {
            "name": "Kurulum",
            "quantity": 1,
            "unit": "Saat",
            "unit_price": 350.5,
            "vat_rate": 20,
            "total": 350.5,
            "notes": "FATURA-IC-NOT",
        },
    ],
}
OTHER = {
    "_id": "inv_other",
    "company_id": "comp_01",
    "contact_id": "cnt_other",
    "status": "approved",
    "invoice_number": "SF-X",
    "items": [{"name": "Gizli Ürün", "purchase_price": 1, "total": 1, "quantity": 1, "unit_price": 1}],
    "notes": "FATURA-IC-NOT",
}
DRAFT = {**OWN, "_id": "inv_draft", "status": "draft", "invoice_number": "TASLAK"}
CANCELLED = {**OWN, "_id": "inv_cancel", "status": "cancelled", "invoice_number": "IPTAL"}
DOCS = [OWN, OTHER, DRAFT, CANCELLED]


def _match(doc, query):
    for key, expected in (query or {}).items():
        if isinstance(expected, dict):
            if "$nin" in expected and doc.get(key) in expected["$nin"]:
                return False
            if "$in" in expected and doc.get(key) not in expected["$in"]:
                return False
            continue
        if doc.get(key) != expected:
            return False
    return True


def _keys(obj):
    found = set()
    if isinstance(obj, dict):
        for key, val in obj.items():
            found.add(key)
            found |= _keys(val)
    elif isinstance(obj, list):
        for val in obj:
            found |= _keys(val)
    return found


def _fake_db(company=None):
    product_queries = []

    async def find_contact(query):
        if query.get("b2b_token") == "tok":
            return CONTACT
        return None

    async def find_invoice(query):
        for doc in DOCS:
            if _match(doc, query):
                return doc
        return None

    def find_products(query, *args, **kwargs):
        product_queries.append(query)
        rows = [PRODUCT] if query.get("company_id") == PRODUCT["company_id"] else []
        if "$in" in (query.get("_id") or {}) and PRODUCT["_id"] not in query["_id"]["$in"]:
            rows = []
        cur = MagicMock()
        cur.to_list = AsyncMock(return_value=rows)
        return cur

    fake = MagicMock()
    fake.contacts.find_one = AsyncMock(side_effect=find_contact)
    fake.companies.find_one = AsyncMock(return_value=company or COMPANY)
    fake.invoices.find_one = AsyncMock(side_effect=find_invoice)
    fake.products.find = MagicMock(side_effect=find_products)
    fake.product_queries = product_queries
    return fake


def _run(invoice_id, company=None):
    fake = _fake_db(company)

    async def run():
        with patch.object(server, "db", fake):
            return await server.b2b_invoice_lines("tok", invoice_id)

    return asyncio.run(run()), fake


def test_b2b_invoice_summary_exposes_id_not_lines_or_cost():
    row = server._b2b_invoice_summary({
        "_id": "inv1",
        "invoice_number": "SF-1",
        "grand_total": 10,
        "currency": "EUR",
        "items": [{"purchase_price": 1, "name": "X"}],
        "notes": "gizli",
        "purchase_price": 5,
    })
    assert row["id"] == "inv1"
    assert row["currency"] == "EUR"
    assert row["invoice_number"] == "SF-1"
    assert "items" not in row
    assert _keys(row).isdisjoint(SECRET_KEYS)


def test_lines_view_appends_variant_once_and_drops_internal_fields():
    body = server.b2b_invoice_lines_view({
        "_id": "i",
        "currency": "EUR",
        "subtotal": 10,
        "vat_total": 2,
        "grand_total": 12,
        "notes": "FATURA-IC-NOT",
        "profit": 4,
        "items": [{
            "name": "Duvar Rafı - Beyaz",
            "variant_name": "Beyaz",
            "quantity": 1,
            "unit_price": 10,
            "vat_rate": 0,
            "total": 10,
            "purchase_price": 3,
            "internal_note": "IC-NOT-GIZLI-XYZ",
        }],
    }, {})
    assert body["items"][0]["name"] == "Duvar Rafı - Beyaz"
    assert body["currency"] == "EUR"
    assert body["items"][0]["vat_rate"] == 0
    assert _keys(body).isdisjoint(SECRET_KEYS)
    blob = json.dumps(body, ensure_ascii=False)
    assert "IC-NOT-GIZLI-XYZ" not in blob
    assert "FATURA-IC-NOT" not in blob


def test_b2b_user_gets_own_invoice_lines():
    body, fake = _run("inv_own")
    assert body["id"] == "inv_own"
    assert body["invoice_number"] == "SF-1"
    assert body["currency"] == "USD"
    assert body["subtotal"] == 1250.5
    assert body["vat_total"] == 250.1
    assert body["grand_total"] == 1500.6
    assert set(body) == {"id", "invoice_number", "currency", "subtotal", "vat_total", "grand_total", "items"}
    line = body["items"][0]
    assert line["name"] == "Duvar Rafı — Beyaz"
    assert line["sku"] == "DRC-W"
    assert line["barcode"] == "8680001234013"
    assert line["image_url"] == "/api/files/raf-beyaz.webp"
    assert line["quantity"] == 2
    assert line["unit"] == "Adet"
    assert line["unit_price"] == 500
    assert line["discount_rate"] == 10
    assert line["vat_rate"] == 20
    assert line["total"] == 900
    plain = body["items"][1]
    assert plain["name"] == "Kurulum"
    assert plain["unit"] == "Saat"
    assert "barcode" not in plain
    assert "image_url" not in plain
    assert "discount_rate" not in plain
    assert _keys(body).isdisjoint(SECRET_KEYS)
    blob = json.dumps(body, ensure_ascii=False)
    for secret in SECRET_TEXT:
        assert secret not in blob
    assert fake.product_queries
    assert fake.product_queries[0]["company_id"] == "comp_01"
    assert "prod_01" in fake.product_queries[0]["_id"]["$in"]


def test_other_contact_invoice_is_404():
    with pytest.raises(HTTPException) as ei:
        _run("inv_other")
    assert ei.value.status_code == 404


def test_draft_and_cancelled_invoices_are_404():
    for invoice_id in ("inv_draft", "inv_cancel", "missing"):
        with pytest.raises(HTTPException) as ei:
            _run(invoice_id)
        assert ei.value.status_code == 404


def test_statement_hidden_is_404():
    hidden = {"_id": "comp_01", "b2b_settings": {"enabled": True, "show_statement": False}}
    with pytest.raises(HTTPException) as ei:
        _run("inv_own", company=hidden)
    assert ei.value.status_code == 404
