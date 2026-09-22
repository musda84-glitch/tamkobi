"""POST /products/{id}/copy — stok kartı kopyala, SKU çakışmasın."""
import os
import uuid

import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "http://127.0.0.1:8000").rstrip("/")
API = BASE_URL + "/api"
COMPANY = "comp_nexus_main_01"
ADMIN_EMAIL = "admin@nexus.com"
ADMIN_PASS = "admin123"


def _admin():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20)
    assert r.status_code == 200, r.text
    return s


class TestProductCopy:
    def test_copy_product_unique_sku_and_zero_stock(self):
        s = _admin()
        sku = f"CP{uuid.uuid4().hex[:8]}"
        p = s.post(
            f"{API}/products",
            json={
                "company_id": COMPANY,
                "name": "Kopya Kaynak Ürün",
                "sku": sku,
                "barcode": f"869{uuid.uuid4().int % 10**10:010d}",
                "sale_price": 42,
                "purchase_price": 20,
                "stock_quantity": 17,
                "category": "Test",
                "unit": "Adet",
            },
            timeout=20,
        )
        assert p.status_code in (200, 201), p.text[:300]
        src = p.json()
        pid = src["id"]

        c1 = s.post(f"{API}/products/{pid}/copy", timeout=20)
        assert c1.status_code == 200, c1.text[:400]
        copy1 = c1.json()
        assert copy1["id"] != pid
        assert copy1["sku"] == f"{sku}-KOPYA"
        assert copy1["name"].endswith("(Kopya)")
        assert float(copy1.get("stock_quantity") or 0) == 0
        assert copy1.get("barcode") and copy1["barcode"] != src.get("barcode")
        assert float(copy1.get("sale_price") or 0) == 42

        c2 = s.post(f"{API}/products/{pid}/copy", timeout=20)
        assert c2.status_code == 200, c2.text[:400]
        copy2 = c2.json()
        assert copy2["sku"] == f"{sku}-KOPYA2"
        assert copy2["id"] != copy1["id"]

        for x in (pid, copy1["id"], copy2["id"]):
            s.delete(f"{API}/products/{x}", timeout=15)
