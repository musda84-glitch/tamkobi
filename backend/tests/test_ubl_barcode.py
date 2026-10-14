"""E-fatura / e-irsaliye UBL satır barkodu — AdditionalItemIdentification."""
from __future__ import annotations

import os
import sys
import xml.etree.ElementTree as ET
from unittest.mock import AsyncMock, MagicMock, patch

import asyncio

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import ubl_export  # noqa: E402
from line_totals import order_items_to_invoice_items  # noqa: E402
from stock_codes import apply_stock_codes, fill_stock_codes  # noqa: E402

CBC = "{urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2}"
CAC = "{urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2}"

# UBL-TR Item child order (TR1.2). StandardItemIdentification is not used.
UBL_TR_ITEM_ORDER = (
    "Description",
    "Name",
    "Keyword",
    "BrandName",
    "ModelName",
    "BuyersItemIdentification",
    "SellersItemIdentification",
    "ManufacturersItemIdentification",
    "AdditionalItemIdentification",
    "CatalogueItemIdentification",
    "ItemInstance",
    "Certificate",
    "Dimension",
    "OriginCountry",
    "CommodityClassification",
    "TransactionConditions",
    "HazardousItem",
    "ClassifiedTaxCategory",
    "AdditionalItemProperty",
    "ManufacturerParty",
    "InformationContentProviderParty",
    "OriginAddress",
)


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _seller():
    return {"name": "Satıcı A.Ş.", "tax_number": "4810173324", "tax_office": "Tuzla", "city": "İstanbul", "address": "Cad 1"}


def _buyer():
    return {"name": "Alıcı Ltd.", "tax_number_or_id": "6320984412", "city": "Ankara"}


def _inv(**extra):
    base = {
        "_id": "inv_bc",
        "company_id": "c1",
        "invoice_number": "MTE2026000000029",
        "invoice_type": "sales",
        "e_type": "e_invoice",
        "gib_scenario": "TICARIFATURA",
        "issue_date": "2026-10-14",
        "items": [
            {
                "name": "Duvar Rafı",
                "sku": "RAF-60",
                "barcode": "8680001234567",
                "quantity": 1,
                "unit": "Adet",
                "unit_price": 100,
                "vat_rate": 20,
                "total": 100,
            }
        ],
        "subtotal": 100,
        "vat_total": 20,
        "grand_total": 120,
    }
    base.update(extra)
    return base


def _item(root, path="InvoiceLine"):
    return root.find(f"{CAC}{path}/{CAC}Item")


def _item_child_names(item_el):
    return [_local(c.tag) for c in list(item_el)]


def assert_ubl_tr_item_order(item_el):
    names = _item_child_names(item_el)
    assert "StandardItemIdentification" not in names
    known = [n for n in names if n in UBL_TR_ITEM_ORDER]
    positions = [UBL_TR_ITEM_ORDER.index(n) for n in known]
    assert positions == sorted(positions), names


def assert_send_ready_has_no_visuals(xml: bytes) -> None:
    """İşNet: satır görselleri yalnız XSLT üzerinden; UBL'de barkod resmi yok."""
    root = ET.fromstring(xml)
    for item in root.iter(f"{CAC}Item"):
        for emb in item.iter(f"{CBC}EmbeddedDocumentBinaryObject"):
            raise AssertionError("Item must not embed visuals")
        for el in item.iter():
            mime = (el.attrib.get("mimeCode") or "").lower()
            if mime.startswith("image/"):
                raise AssertionError(f"Item must not contain image mime: {mime}")
        text = ET.tostring(item, encoding="unicode")
        assert "data:image" not in text
        assert "code128" not in text.lower()
        assert "ean13" not in text.lower()
    for line_tag in ("InvoiceLine", "DespatchLine"):
        for line in root.iter(f"{CAC}{line_tag}"):
            for emb in line.iter(f"{CBC}EmbeddedDocumentBinaryObject"):
                mime = (emb.attrib.get("mimeCode") or "").lower()
                if mime.startswith("image/"):
                    raise AssertionError("line visual is not allowed in send_ready UBL")


def test_invoice_ubl_writes_additional_item_identification():
    xml = ubl_export.build_invoice_ubl(_inv(), _seller(), _buyer())
    root = ET.fromstring(xml)
    item = _item(root)
    assert item is not None
    sku = item.find(f"{CAC}SellersItemIdentification/{CBC}ID")
    bar = item.find(f"{CAC}AdditionalItemIdentification/{CBC}ID")
    assert sku is not None and sku.text == "RAF-60"
    assert bar is not None and bar.text == "8680001234567"
    assert item.find(f"{CAC}StandardItemIdentification") is None
    assert_ubl_tr_item_order(item)
    names = _item_child_names(item)
    assert names.index("SellersItemIdentification") < names.index("AdditionalItemIdentification")


def test_despatch_ubl_writes_additional_item_identification():
    inv = _inv(invoice_type="dispatch", e_type="e_dispatch", despatch_plate="34ABC123")
    xml = ubl_export.build_despatch_ubl(inv, _seller(), _buyer(), send_ready=True)
    root = ET.fromstring(xml)
    item = _item(root, "DespatchLine")
    bar = item.find(f"{CAC}AdditionalItemIdentification/{CBC}ID")
    assert bar is not None and bar.text == "8680001234567"
    assert item.find(f"{CAC}StandardItemIdentification") is None
    assert_ubl_tr_item_order(item)
    assert_send_ready_has_no_visuals(xml)


def test_send_ready_invoice_has_no_visuals():
    xml = ubl_export.build_invoice_ubl(_inv(), _seller(), _buyer(), send_ready=True)
    assert_send_ready_has_no_visuals(xml)
    root = ET.fromstring(xml)
    assert_ubl_tr_item_order(_item(root))


def test_line_without_barcode_is_filled_from_product():
    item = {"product_id": "p1", "name": "Duvar Rafı", "sku": "RAF-60", "quantity": 1}
    products = {"p1": {"_id": "p1", "sku": "RAF-60", "barcode": "8680001111111", "variants": []}}
    apply_stock_codes([item], products)
    assert item["barcode"] == "8680001111111"
    xml = ubl_export.build_invoice_ubl(_inv(items=[{**item, "unit_price": 10, "vat_rate": 20, "total": 10}]), _seller(), _buyer())
    root = ET.fromstring(xml)
    bar = _item(root).find(f"{CAC}AdditionalItemIdentification/{CBC}ID")
    assert bar is not None and bar.text == "8680001111111"


def test_variant_barcode_is_selected():
    item = {"product_id": "p1", "name": "Varyant Üst Kırmızı", "sku": "V-RED"}
    products = {
        "p1": {
            "_id": "p1",
            "sku": "PARENT",
            "barcode": "1111111111111",
            "variants": [
                {"sku": "V-RED", "barcode": "8680002222222", "name": "Kırmızı"},
                {"sku": "V-BLU", "barcode": "8680003333333", "name": "Mavi"},
            ],
        }
    }
    apply_stock_codes([item], products)
    assert item["barcode"] == "8680002222222"
    assert item["sku"] == "V-RED"


def test_fill_stock_codes_loads_product_barcode():
    item = {"product_id": "p1", "name": "Kalem", "quantity": 1}
    prod = {"_id": "p1", "sku": "K1", "barcode": "8680004444444", "variants": []}
    find = MagicMock()
    find.to_list = AsyncMock(return_value=[prod])
    db = MagicMock()
    db.products.find = MagicMock(return_value=find)
    asyncio.run(fill_stock_codes(db, "c1", [item]))
    assert item["sku"] == "K1"
    assert item["barcode"] == "8680004444444"


def test_build_and_store_xml_fills_missing_barcode():
    import e_invoice

    inv = _inv(items=[{"product_id": "p1", "name": "Raf", "sku": "RAF-1", "quantity": 1, "unit_price": 10, "vat_rate": 20, "total": 10}])
    prod = {"_id": "p1", "sku": "RAF-1", "barcode": "8680005555555", "variants": []}
    find = MagicMock()
    find.to_list = AsyncMock(return_value=[prod])
    db = MagicMock()
    db.products.find = MagicMock(return_value=find)
    db.outgoing_einvoice_xml.update_one = AsyncMock()

    async def _run():
        with patch.object(e_invoice, "_db", db):
            return await e_invoice.build_and_store_xml(
                inv,
                {"name": "S", "tax_number": "4810173324"},
                {"name": "A", "tax_number_or_id": "6320984412"},
                "TICARIFATURA",
            )

    xml = asyncio.run(_run())
    assert inv["items"][0]["barcode"] == "8680005555555"
    root = ET.fromstring(xml)
    bar = _item(root).find(f"{CAC}AdditionalItemIdentification/{CBC}ID")
    assert bar is not None and bar.text == "8680005555555"


def test_isnet_build_ubl_fills_from_products_and_writes_barcode():
    import isnet

    inv = _inv(
        items=[{"product_id": "p1", "name": "Kırmızı", "sku": "V-RED", "quantity": 1, "unit_price": 10, "vat_rate": 20, "total": 10}],
        _products={
            "p1": {
                "_id": "p1",
                "sku": "PARENT",
                "barcode": "111",
                "variants": [{"sku": "V-RED", "barcode": "8680006666666"}],
            }
        },
    )
    xml, ettn, inv_id = isnet.build_ubl(inv, _seller(), {"name": "Alıcı", "tax_number_or_id": "6320984412"})
    assert inv_id == "MTE2026000000029"
    assert ettn
    assert "8680006666666" in xml
    assert "AdditionalItemIdentification" in xml
    assert "StandardItemIdentification" not in xml
    assert_send_ready_has_no_visuals(xml.encode("utf-8"))


def test_b2b_order_to_invoice_ubl_keeps_barcode():
    order_items = [
        {
            "product_id": "p1",
            "product_name": "Duvar Rafı",
            "sku": "RAF-60",
            "barcode": "8680001234567",
            "quantity": 2,
            "unit": "Adet",
            "unit_price": 100,
            "vat_rate": 20,
        }
    ]
    inv_items = order_items_to_invoice_items(order_items)
    assert inv_items[0]["barcode"] == "8680001234567"
    xml = ubl_export.build_invoice_ubl(_inv(items=inv_items, subtotal=200, vat_total=40, grand_total=240), _seller(), _buyer(), send_ready=True)
    root = ET.fromstring(xml)
    bar = _item(root).find(f"{CAC}AdditionalItemIdentification/{CBC}ID")
    assert bar is not None and bar.text == "8680001234567"
    assert_ubl_tr_item_order(_item(root))
    assert_send_ready_has_no_visuals(xml)
