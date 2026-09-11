"""AI / Excel stok yükleme: tablo eşlemesi LLM olmadan çalışır; cari bakiyesi etkilenmez."""
import os
import uuid

import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "http://127.0.0.1:8000").rstrip("/")
API = BASE_URL + "/api"
COMPANY = "comp_nexus_main_01"


def _csv(rows):
    return "\n".join(rows).encode("utf-8")


class TestAiStockImport:
    def test_excel_csv_extract_and_confirm(self):
        sku = f"AIIMP_{uuid.uuid4().hex[:8]}"
        data = _csv([
            "Ürün Adı;Stok Kodu;Barkod;Kategori;Birim;KDV;Alış Fiyatı;Satış Fiyatı;Stok Miktarı",
            f"AI Import Kalem;{sku};8690001112223;TEST;Adet;20;12,5;25,00;7",
        ])
        r = requests.post(
            f"{API}/ai/product-extract",
            params={"company_id": COMPANY},
            files={"file": ("stok.csv", data, "text/csv")},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["count"] == 1
        assert body["source"] == "table"
        prod = body["products"][0]
        assert prod["name"] == "AI Import Kalem"
        assert prod["sku"] == sku
        assert prod["status"] == "yeni"
        assert abs(float(prod["sale_price"]) - 25) < 0.01
        assert abs(float(prod["stock_quantity"]) - 7) < 0.01

        r = requests.post(
            f"{API}/ai/product-extract/confirm",
            json={"company_id": COMPANY, "products": body["products"], "update_existing": True, "update_stock": True},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.json()["inserted"] == 1
        listed = requests.get(f"{API}/products", params={"company_id": COMPANY}, timeout=20).json()
        saved = next(p for p in listed if p.get("sku") == sku)
        assert saved["name"] == "AI Import Kalem"
        assert abs(float(saved["stock_quantity"]) - 7) < 0.01

        data2 = _csv([
            "Ürün Adı;Stok Kodu;Satış Fiyatı;Stok Miktarı",
            f"AI Import Kalem Güncel;{sku};40;15",
        ])
        r = requests.post(
            f"{API}/ai/product-extract",
            params={"company_id": COMPANY},
            files={"file": ("stok2.csv", data2, "text/csv")},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.json()["products"][0]["status"] == "güncelle"
        r = requests.post(
            f"{API}/ai/product-extract/confirm",
            json={"company_id": COMPANY, "products": r.json()["products"], "update_existing": True, "update_stock": True},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        assert r.json()["updated"] == 1
        listed = requests.get(f"{API}/products", params={"company_id": COMPANY}, timeout=20).json()
        saved = next(p for p in listed if p.get("sku") == sku)
        assert saved["name"] == "AI Import Kalem Güncel"
        assert abs(float(saved["sale_price"]) - 40) < 0.01
        assert abs(float(saved["stock_quantity"]) - 15) < 0.01
        requests.delete(f"{API}/products/{saved['id']}", timeout=20)

    def test_empty_file_rejected(self):
        r = requests.post(
            f"{API}/ai/product-extract",
            params={"company_id": COMPANY},
            files={"file": ("empty.csv", b"\n", "text/csv")},
            timeout=20,
        )
        assert r.status_code == 400

    def test_pdf_without_text_rejected(self):
        r = requests.post(
            f"{API}/ai/product-extract",
            params={"company_id": COMPANY},
            files={"file": ("blank.pdf", b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF", "application/pdf")},
            timeout=20,
        )
        assert r.status_code in (400, 502)
