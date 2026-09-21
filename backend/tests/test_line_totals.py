"""Unit tests for shared order/invoice line totals (no live API)."""
from line_totals import drop_stale_inclusive_markup, enrich_items, enrich_line, invoice_document_totals, order_document_totals, quote_line_price_mode, unit_excl_from_incl, unit_incl_from_excl


def test_unit_price_roundtrip():
    assert abs(unit_incl_from_excl(100, 20) - 120) < 1e-9
    assert abs(unit_excl_from_incl(120, 20) - 100) < 1e-9
    assert abs(unit_incl_from_excl(100, 0) - 100) < 1e-9


def test_line_excl_qty_discount_vat():
    row = {"name": "Hizmet", "quantity": 2, "unit_price": 100, "vat_rate": 20, "discount_rate": 10}
    enrich_line(row, default_vat=20)
    assert row["unit_price"] == 100
    assert abs(row["unit_price_incl"] - 120) < 0.01
    assert row["total"] == 180.0  # 2 * 100 * 0.9
    assert row["vat_amount"] == 36.0
    assert row["total_incl"] == 216.0


def test_line_legacy_incl_mode_without_unit_price_incl():
    row = {"name": "Ürün", "quantity": 1, "unit_price": 120, "vat_rate": 20}
    enrich_line(row, price_mode="incl", default_vat=20)
    assert abs(row["unit_price"] - 100) < 0.01
    assert abs(row["unit_price_incl"] - 120) < 0.01
    assert row["total"] == 100.0
    assert row["total_incl"] == 120.0


def test_line_keeps_net_when_both_prices_present():
    row = {"name": "Ürün", "quantity": 1, "unit_price": 100, "unit_price_incl": 120, "vat_rate": 10}
    enrich_line(row, price_mode="incl", default_vat=20)
    assert row["unit_price"] == 100
    assert abs(row["unit_price_incl"] - 110) < 0.01  # vat 10% on stored net


def test_missing_vat_on_order_defaults_zero():
    row = {"product_name": "Eski kalem", "quantity": 2, "unit_price": 50}
    enrich_line(row, default_vat=0)
    assert row["vat_rate"] == 0
    assert row["total"] == 100.0
    assert row["total_incl"] == 100.0


def test_invoice_totals_round_inclusive_260_lines_to_520():
    """260 KDV dahil × 2 (%10) belge toplamı 520,00 olmalı; 519,99 değil."""
    items = []
    for name in ("A", "B"):
        row = {"name": name, "quantity": 1, "unit_price_incl": 260, "vat_rate": 10}
        enrich_line(row, default_vat=10)
        items.append(row)
    assert items[0]["total"] == 236.36
    assert items[0]["vat_amount"] == 23.64
    assert items[0]["total_incl"] == 260.0
    t = invoice_document_totals(items)
    assert t["subtotal"] == 472.72
    assert t["vat_total"] == 47.28
    assert t["grand_total"] == 520.0


def test_invoice_totals_with_general_discount():
    items = [
        {"name": "A", "quantity": 1, "unit_price": 100, "vat_rate": 20, "discount_rate": 0},
        {"name": "B", "quantity": 1, "unit_price": 100, "vat_rate": 10, "discount_rate": 0},
    ]
    for it in items:
        enrich_line(it, default_vat=20)
    t = invoice_document_totals(items, general_discount_rate=10)
    # net 200, 10% GD → 180; VAT scaled by 0.9 → 20*0.9 + 10*0.9 = 27
    assert t["subtotal"] == 180.0
    assert t["vat_total"] == 27.0
    assert t["grand_total"] == 207.0


def test_order_document_totals():
    items = [
        {"product_name": "A", "quantity": 2, "unit_price": 100, "vat_rate": 20, "discount_rate": 0},
        {"product_name": "B", "quantity": 1, "unit_price": 50, "vat_rate": 10, "discount_rate": 0},
    ]
    for it in items:
        enrich_line(it, default_vat=0)
    sub, vat, disc, grand = order_document_totals(items)
    assert sub == 250.0
    assert vat == 45.0  # 40 + 5
    assert grand == 295.0
    assert disc == 0.0


def test_order_items_to_invoice_keeps_line_vat_and_discount():
    from line_totals import order_items_to_invoice_items
    rows = order_items_to_invoice_items([
        {"product_name": "%10", "quantity": 1, "unit_price": 200, "vat_rate": 10, "discount_rate": 0, "total": 200},
        {"product_name": "iskontolu", "quantity": 2, "unit_price": 100, "vat_rate": 20, "discount_rate": 10},
    ])
    a, b = rows
    assert a["vat_rate"] == 10
    assert a["total"] == 200.0
    assert abs(a["total_incl"] - 220) < 0.05
    assert abs(a["unit_price_incl"] - 220) < 0.05
    assert b["total"] == 180.0
    assert b["total_incl"] == 216.0
    assert b["discount_rate"] == 10
    t = invoice_document_totals(rows)
    assert t["subtotal"] == 380.0
    assert t["vat_total"] == 56.0
    assert t["grand_total"] == 436.0


def test_order_items_to_invoice_gross_b2b_line():
    from line_totals import order_items_to_invoice_items
    rows = order_items_to_invoice_items([
        {"product_name": "B2B brüt", "quantity": 1, "unit_price": 120, "vat_rate": 20, "price_includes_vat": True},
    ])
    it = rows[0]
    assert abs(it["unit_price"] - 100) < 0.05
    assert abs(it["unit_price_incl"] - 120) < 0.05
    assert it["total"] == 100.0
    assert it["total_incl"] == 120.0


def test_order_items_missing_vat_defaults_20_not_overwrite_zero():
    from line_totals import order_items_to_invoice_items
    missing = order_items_to_invoice_items([{"product_name": "eski", "quantity": 1, "unit_price": 100}])[0]
    assert missing["vat_rate"] == 20
    assert missing["total_incl"] == 120.0
    zero = order_items_to_invoice_items([{"product_name": "ihracat", "quantity": 1, "unit_price": 100, "vat_rate": 0}])[0]
    assert zero["vat_rate"] == 0
    assert zero["total_incl"] == 100.0
    items = [
        {"product_name": "A", "quantity": 2, "unit_price": 100, "vat_rate": 20, "discount_rate": 0},
        {"product_name": "B", "quantity": 1, "unit_price": 50, "vat_rate": 10, "discount_rate": 0},
    ]
    for it in items:
        enrich_line(it, default_vat=0)
    sub, vat, disc, grand = order_document_totals(items)
    assert sub == 250.0
    assert vat == 45.0  # 40 + 5
    assert grand == 295.0
    assert disc == 0.0


def test_drop_stale_inclusive_markup_clears_false_unit_price_incl():
    row = {"name": "Raf", "quantity": 2, "unit_price": 260, "unit_price_incl": 286, "vat_rate": 10, "price_includes_vat": True}
    drop_stale_inclusive_markup(row, {"sale_price": 260, "price_includes_vat": True})
    assert row.get("unit_price_incl") in (None, "")
    rows = enrich_items([row], default_vat=10)
    assert rows[0]["total_incl"] == 520.0
    assert abs(rows[0]["total"] + rows[0]["vat_amount"] - 520) < 0.02


def test_enrich_items_treats_price_includes_vat_as_gross():
    rows = enrich_items([
        {"name": "KDV dahil stok", "quantity": 1, "unit_price": 120, "vat_rate": 20, "price_includes_vat": True},
        {"name": "KDV hariç", "quantity": 1, "unit_price": 100, "vat_rate": 20},
    ], default_vat=20)
    assert abs(rows[0]["unit_price"] - 100) < 0.01
    assert rows[0]["total_incl"] == 120.0
    assert rows[0]["vat_amount"] == 20.0
    assert rows[1]["total"] == 100.0
    assert rows[1]["total_incl"] == 120.0
    assert quote_line_price_mode(rows[0]) == "excl"  # unit_price_incl artık dolu


def test_inclusive_product_order_totals_consistent():
    """KDV dahil satış fiyatı enrich sonrası subtotal + vat == grand_total."""
    row = {
        "product_name": "KDV dahil ürün",
        "quantity": 2,
        "unit_price": 120,  # brüt katalog fiyatı
        "vat_rate": 20,
        "price_includes_vat": True,
        "discount_rate": 0,
    }
    enrich_line(row, price_mode="incl", default_vat=20)
    assert abs(row["unit_price"] - 100) < 0.01
    assert row["total"] == 200.0
    assert row["vat_amount"] == 40.0
    assert row["total_incl"] == 240.0
    sub, vat, disc, grand = order_document_totals([row])
    assert sub == 200.0
    assert vat == 40.0
    assert grand == 240.0
    assert abs(sub + vat - grand) < 0.001
