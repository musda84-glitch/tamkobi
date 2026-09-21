from stock_moves import invoice_stock_moves, item_matches_product, merge_stock_moves, order_stock_moves


def test_item_matches_product_id_sku_and_name():
    product = {"_id": "p1", "sku": "DRD-70", "name": "Duvar Rafı Çizgili"}
    assert item_matches_product({"product_id": "p1"}, product, "p1")
    assert item_matches_product({"sku": "DRD-70", "quantity": 2}, product, "p1")
    assert item_matches_product({"product_name": "Duvar Rafı Çizgili", "quantity": 1}, product, "p1")
    assert not item_matches_product({"sku": "OTHER"}, product, "p1")


def test_invoice_stock_moves_sales_and_purchase():
    product = {"_id": "p1", "sku": "DRD-70", "name": "Duvar Rafı"}
    invoices = [
        {
            "_id": "i1",
            "invoice_type": "purchase",
            "invoice_number": "ALI-1",
            "contact_name": "Tedarikçi",
            "issue_date": "2026-09-10",
            "items": [{"sku": "DRD-70", "quantity": 4}],
        },
        {
            "_id": "i2",
            "invoice_type": "sales",
            "invoice_number": "SAT-1",
            "contact_name": "Cari",
            "issue_date": "2026-09-12",
            "items": [{"product_id": "p1", "quantity": 1}, {"product_id": "other", "quantity": 9}],
        },
    ]
    rows = invoice_stock_moves(invoices, "p1", product)
    assert [(r["change"], r["reason"]) for r in rows] == [
        (4.0, "Alış: ALI-1 · Tedarikçi"),
        (-1.0, "Satış: SAT-1 · Cari"),
    ]


def test_order_and_merge_sort():
    product = {"_id": "p1"}
    orders = [{
        "_id": "o1",
        "order_number": "B2B-1",
        "order_date": "2026-09-13",
        "customer_name": "Cari",
        "items": [{"product_id": "p1", "quantity": 2}],
    }]
    rows = merge_stock_moves(
        invoice_stock_moves([{
            "_id": "i1", "invoice_type": "purchase", "invoice_number": "A",
            "issue_date": "2026-09-10", "items": [{"product_id": "p1", "quantity": 5}],
        }], "p1", product),
        order_stock_moves(orders, "p1", product),
    )
    assert [r["source"] for r in rows] == ["order", "invoice"]
    assert rows[0]["change"] == -2.0
