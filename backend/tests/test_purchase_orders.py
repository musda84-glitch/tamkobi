"""Unit tests for given purchase orders (verilen sipariş)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import purchase_orders as po


def test_build_item_totals():
    item = po.build_po_item(
        product_id="p1",
        product_name="Vida",
        sku="V-1",
        quantity=10,
        unit_price=5,
        vat_rate=20,
    )
    assert item.total == 50
    assert item.vat_amount == 10
    assert item.total_incl == 60


def test_make_purchase_order():
    items = [
        po.build_po_item(product_name="A", quantity=2, unit_price=100, vat_rate=20),
        po.build_po_item(product_name="B", quantity=1, unit_price=50, vat_rate=10),
    ]
    order = po.make_purchase_order(
        company_id="c1",
        order_number="VSP-2026-0001",
        supplier_name="Tedarikçi A",
        contact_id="cnt1",
        items=items,
        source_channel="stock_reorder",
    )
    assert order.order_number == "VSP-2026-0001"
    assert order.subtotal == 250
    assert order.vat_total == 45  # 40 + 5
    assert order.grand_total == 295
    assert order.order_status == "draft"


def test_po_to_invoice_items():
    items = [po.build_po_item(product_id="p1", product_name="X", quantity=3, unit_price=10, vat_rate=20)]
    rows = po.po_to_invoice_items(items)
    assert len(rows) == 1
    assert rows[0]["name"] == "X"
    assert rows[0]["quantity"] == 3
    assert rows[0]["unit_price"] == 10
    assert rows[0]["vat_rate"] == 20
