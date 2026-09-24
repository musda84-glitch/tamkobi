from invoice_numbers import SALES_INVOICE_PREFIX, format_sales_invoice_number


def test_sales_invoice_number_starts_with_ta():
    assert SALES_INVOICE_PREFIX == "TA"
    assert format_sales_invoice_number(14, 2026) == "TA202600000014"
    assert format_sales_invoice_number("4", "2026").startswith("TA")
    assert not format_sales_invoice_number(1, 2026).startswith("NX")
