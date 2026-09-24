"""Satış faturası numarası: TA + yıl + 8 hane."""

from datetime import datetime, timezone

SALES_INVOICE_PREFIX = "TA"


def format_sales_invoice_number(seq, year=None) -> str:
    y = str(year or datetime.now(timezone.utc).year)
    try:
        n = int(str(seq).strip() or "1")
    except (TypeError, ValueError):
        n = 1
    return f"{SALES_INVOICE_PREFIX}{y}{str(max(n, 1)).zfill(8)}"
