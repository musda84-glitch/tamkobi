"""POST /production/recipes/{id}/copy — reçete kopyala, yeni BOM kodu."""
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


class TestRecipeCopy:
    def test_copy_recipe_new_code_and_name(self):
        s = _admin()
        sku = f"RC{uuid.uuid4().hex[:8]}"
        mat_sku = f"RM{uuid.uuid4().hex[:8]}"
        fin = s.post(
            f"{API}/products",
            json={"company_id": COMPANY, "name": "Reçete Kopya Mamul", "sku": sku, "sale_price": 100, "stock_quantity": 0},
            timeout=20,
        )
        assert fin.status_code in (200, 201), fin.text[:300]
        mat = s.post(
            f"{API}/products",
            json={"company_id": COMPANY, "name": "Reçete Kopya Hammadde", "sku": mat_sku, "type": "raw_material", "purchase_price": 5, "stock_quantity": 50},
            timeout=20,
        )
        assert mat.status_code in (200, 201), mat.text[:300]
        fid, mid = fin.json()["id"], mat.json()["id"]

        created = s.post(
            f"{API}/production/recipes",
            json={
                "company_id": COMPANY,
                "name": "Test Reçete Kaynak",
                "finished_product_id": fid,
                "finished_product_name": "Reçete Kopya Mamul",
                "target_quantity": 2,
                "unit": "Adet",
                "materials": [{"product_id": mid, "product_name": "Reçete Kopya Hammadde", "quantity": 1, "unit": "Adet", "wastage_percent": 0}],
                "labor_cost": 10,
            },
            timeout=20,
        )
        assert created.status_code in (200, 201), created.text[:400]
        src = created.json()
        rid = src["id"]

        cp = s.post(f"{API}/production/recipes/{rid}/copy", timeout=20)
        assert cp.status_code == 200, cp.text[:400]
        body = cp.json()
        assert body["id"] != rid
        assert body["code"] != src.get("code")
        assert body["code"].startswith("BOM-")
        assert body["name"].endswith("(Kopya)")
        assert body["finished_product_id"] == fid
        assert len(body.get("materials") or []) == 1
        assert float(body.get("labor_cost") or 0) == 10

        s.delete(f"{API}/production/recipes/{body['id']}", timeout=15)
        s.delete(f"{API}/production/recipes/{rid}", timeout=15)
        s.delete(f"{API}/products/{fid}", timeout=15)
        s.delete(f"{API}/products/{mid}", timeout=15)
