"""B2B AI sepet: Excel tablo okuma (AI anahtarı olmadan)."""
import io
import os
import sys

import requests
from openpyxl import Workbook

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import server  # noqa: E402

from conftest import API


def _xlsx(headers, rows, *, title_row=None, extra_sheets=None) -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Sheet1"
    if title_row:
        ws.append([title_row])
    ws.append(headers)
    for r in rows:
        ws.append(r)
    for name, h2, rows2 in extra_sheets or []:
        w2 = wb.create_sheet(name)
        w2.append(h2)
        for r in rows2:
            w2.append(r)
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


class TestB2bCartTableParse:
    def test_stok_miktari_and_raf_columns(self):
        data = _xlsx(
            ["Ürün Adı", "Stok Kodu", "Raf", "Stok Miktarı"],
            [["Duvar Rafı 60cm", "RAF-60", "A1", 5], ["Köşe Rafı", "RAF-KOSE", "B2", 2]],
        )
        lines = server._b2b_parse_cart_table("Raflar.xlsx", data)
        assert len(lines) == 2
        assert lines[0]["product_name"] == "Duvar Rafı 60cm"
        assert lines[0]["sku"] == "RAF-60"
        assert lines[0]["quantity"] == 5
        assert lines[1]["quantity"] == 2

    def test_no_qty_defaults_to_one(self):
        data = _xlsx(
            ["Ürün Adı", "Stok Kodu", "Raf"],
            [["Duvar Rafı 60cm", "RAF-60", "A1"], ["Köşe Rafı", "RAF-KOSE", "B2"]],
        )
        lines = server._b2b_parse_cart_table("Raflar.xlsx", data)
        assert len(lines) == 2
        assert all(x["quantity"] == 1 for x in lines)

    def test_talep_and_adedi_headers(self):
        data = _xlsx(["Kod", "Malzeme", "Talep"], [["RAF-60", "Duvar Rafı", 3]])
        lines = server._b2b_parse_cart_table("siparis.xlsx", data)
        assert lines == [{"product_name": "Duvar Rafı", "sku": "RAF-60", "barcode": None, "quantity": 3}]

        data2 = _xlsx(["Stokkodu", "Ürün Adı", "Adedi"], [["SKU1", "Test Ürün", 7]])
        lines2 = server._b2b_parse_cart_table("a.xlsx", data2)
        assert lines2[0]["quantity"] == 7
        assert lines2[0]["sku"] == "SKU1"

    def test_second_sheet_and_title_row(self):
        data = _xlsx(
            ["x"],
            [["y"]],
            extra_sheets=[("Liste", ["Ürün", "Adet"], [["Duvar Rafı", 2], ["Köşe Rafı", 4]])],
        )
        lines = server._b2b_parse_cart_table("Raflar.xlsx", data)
        assert len(lines) == 2
        assert lines[0]["quantity"] == 2
        assert lines[1]["product_name"] == "Köşe Rafı"

        data2 = _xlsx(["Ürün Adı", "Adet"], [["Duvar Rafı", 4]], title_row="RAFLAR SİPARİŞ LİSTESİ")
        lines2 = server._b2b_parse_cart_table("Raflar.xlsx", data2)
        assert lines2 == [{"product_name": "Duvar Rafı", "sku": None, "barcode": None, "quantity": 4}]

    def test_sample_ornek_xlsx(self):
        path = os.path.join(os.path.dirname(__file__), "b2b_siparis_ornek.xlsx")
        data = open(path, "rb").read()
        lines = server._b2b_parse_cart_table("b2b_siparis_ornek.xlsx", data)
        assert len(lines) >= 3
        assert lines[0]["quantity"] == 3

    def test_magic_bytes_without_xlsx_extension(self):
        path = os.path.join(os.path.dirname(__file__), "Raflar.xlsx")
        data = open(path, "rb").read()
        lines = server._b2b_parse_cart_table("siparis.bin", data)
        assert len(lines) >= 1
        assert lines[0]["quantity"] >= 1

    def test_ean_code_column_and_excel_float(self):
        # Excel often stores EAN as float (…6789.0); header may be "EAN CODE" / "EANCODE"
        data = _xlsx(["EAN CODE", "Adet"], [[8690123456789.0, 2], ["869 0123 4567 89", 1]])
        lines = server._b2b_parse_cart_table("ean.xlsx", data)
        assert len(lines) == 2
        assert lines[0]["barcode"] == "8690123456789"
        assert lines[0]["quantity"] == 2
        assert lines[1]["barcode"] == "8690123456789"

        data2 = _xlsx(["EANCODE", "Qty"], [[8680001234567, 3]])
        lines2 = server._b2b_parse_cart_table("e.xlsx", data2)
        assert lines2 == [{"product_name": "8680001234567", "sku": None, "barcode": "8680001234567", "quantity": 3}]

        assert server._b2b_norm_code(8690123456789.0) == "8690123456789"
        assert server._b2b_norm_code("8690-1234-5678-9") == "8690123456789"

    def test_api_raflar_without_ai(self):
        token = os.environ.get("TEST_B2B_TOKEN") or "9a89e4fd1a0e451c8461f1bccd9f5028"
        data = _xlsx(
            ["Ürün Adı", "Stok Kodu", "Raf", "Stok Miktarı"],
            [["Nexus RGB Mekanik Gaming Klavye (Blue Switch)", "NEX-KYB", "A1", 2]],
        )
        r = requests.post(
            f"{API}/public/b2b/{token}/ai-cart",
            files={"file": ("Raflar.xlsx", data, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("parse_mode") == "table"
        assert body["total_lines"] >= 1
        assert body["items"] or body["unmatched"]

        # Uzantı yanlış olsa bile xlsx içeriği okunmalı
        r2 = requests.post(
            f"{API}/public/b2b/{token}/ai-cart",
            files={"file": ("liste.bin", open(path := os.path.join(os.path.dirname(__file__), "Raflar.xlsx"), "rb").read(), "application/octet-stream")},
            timeout=60,
        )
        assert r2.status_code == 200, r2.text
        assert r2.json().get("parse_mode") == "table"
        assert r2.json()["total_lines"] >= 1

        r3 = requests.post(
            f"{API}/public/b2b/{token}/ai-cart",
            files={"file": ("eski.xls", b"\xd0\xcf\x11\xe0", "application/vnd.ms-excel")},
            timeout=30,
        )
        assert r3.status_code == 400
        assert "xlsx" in (r3.json().get("detail") or "").lower()
