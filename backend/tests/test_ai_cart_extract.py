"""Panel Yeni Sipariş — AI cart extract (B2B motoru ile aynı)."""
import io
import os
import sys

import openpyxl
import pytest
import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from conftest import API, TEST_COMPANY_ID  # noqa: E402


def _xlsx(headers, rows):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.append(headers)
    for r in rows:
        ws.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_ai_cart_extract_table_mode():
    data = _xlsx(
        ["Ürün Adı", "Stok Kodu", "Adet"],
        [["Nexus RGB Mekanik Gaming Klavye (Blue Switch)", "NEX-KYB", 2]],
    )
    r = requests.post(
        f"{API}/ai/cart-extract",
        params={"company_id": TEST_COMPANY_ID},
        files={"file": ("siparis.xlsx", data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        timeout=60,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("parse_mode") == "table"
    assert body["total_lines"] >= 1
    assert isinstance(body.get("items"), list)
    assert isinstance(body.get("unmatched"), list)


def test_ai_cart_extract_rejects_xls():
    r = requests.post(
        f"{API}/ai/cart-extract",
        params={"company_id": TEST_COMPANY_ID},
        files={"file": ("eski.xls", b"\xd0\xcf\x11\xe0", "application/vnd.ms-excel")},
        timeout=30,
    )
    assert r.status_code == 400
    assert "xlsx" in (r.json().get("detail") or "").lower()


def test_ai_cart_learn_roundtrip():
    # Learn a nonsense alias then match via extract of csv-like text through learn endpoint only
    products = requests.get(f"{API}/products", params={"company_id": TEST_COMPANY_ID}, timeout=30)
    if products.status_code != 200 or not products.json():
        pytest.skip("no products")
    plist = products.json()
    p = plist[0] if isinstance(plist, list) else (plist.get("items") or plist.get("products") or [None])[0]
    if not p:
        pytest.skip("empty product list")
    pid = p.get("id") or p.get("_id")
    alias = f"order-ai-alias-{os.getpid()}"
    r = requests.post(
        f"{API}/ai/cart-learn",
        json={"company_id": TEST_COMPANY_ID, "mappings": [{"alias": alias, "product_id": pid}]},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    assert r.json().get("count", 0) >= 1
