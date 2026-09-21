from stock_moves import invoice_stock_moves


def test_invoice_stock_moves_sales_and_purchase():
    invoices = [
        {
            "_id": "i1",
            "invoice_type": "purchase",
            "invoice_number": "ALI-1",
            "contact_name": "Tedarikçi",
            "issue_date": "2026-09-10",
            "items": [{"product_id": "p1", "quantity": 4}],
        },
        {
            "_id": "i2",
            "invoice_type": "sales",
            "invoice_number": "SAT-1",
            "contact_name": "Cari",
            "issue_date": "2026-09-12",
            "items": [{"product_id": "p1", "quantity": 1}, {"product_id": "other", "quantity": 9}],
        },
        {"_id": "i3", "invoice_type": "draft", "items": [{"product_id": "p1", "quantity": 2}]},
    ]
    rows = invoice_stock_moves(invoices, "p1")
    assert [(r["change"], r["reason"]) for r in rows] == [
        (4.0, "Alış: ALI-1 · Tedarikçi"),
        (-1.0, "Satış: SAT-1 · Cari"),
    ]
