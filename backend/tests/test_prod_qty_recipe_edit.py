"""Production order: edit plan qty/recipe; allow over-production on finish/complete."""
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


def _product(s, name, sku, **extra):
    p = s.post(
        f"{API}/products",
        json={"company_id": COMPANY, "name": name, "sku": sku, "sale_price": 50, "stock_quantity": 100, **extra},
        timeout=20,
    )
    assert p.status_code in (200, 201), p.text[:300]
    return p.json()


class TestProdQtyRecipeEdit:
    def test_update_plan_qty_and_over_complete(self):
        s = _admin()
        fin = _product(s, "Plan Edit Mamul", f"PE{uuid.uuid4().hex[:8]}")
        mat = _product(s, "Plan Edit Ham", f"PH{uuid.uuid4().hex[:8]}", type="raw_material", purchase_price=2)
        rec = s.post(
            f"{API}/production/recipes",
            json={
                "company_id": COMPANY,
                "name": "Plan Edit Reçete A",
                "finished_product_id": fin["id"],
                "finished_product_name": fin["name"],
                "target_quantity": 1,
                "materials": [{"product_id": mat["id"], "product_name": mat["name"], "quantity": 1, "unit": "Adet"}],
            },
            timeout=20,
        )
        assert rec.status_code in (200, 201), rec.text[:300]
        rid = rec.json()["id"]

        rec2 = s.post(
            f"{API}/production/recipes",
            json={
                "company_id": COMPANY,
                "name": "Plan Edit Reçete B",
                "finished_product_id": fin["id"],
                "finished_product_name": fin["name"],
                "target_quantity": 1,
                "materials": [{"product_id": mat["id"], "product_name": mat["name"], "quantity": 2, "unit": "Adet"}],
            },
            timeout=20,
        )
        assert rec2.status_code in (200, 201), rec2.text[:300]
        rid2 = rec2.json()["id"]

        po = s.post(
            f"{API}/production/orders",
            json={"company_id": COMPANY, "recipe_id": rid, "planned_quantity": 5},
            timeout=20,
        )
        assert po.status_code in (200, 201), po.text[:400]
        oid = po.json()["id"]
        assert float(po.json()["planned_quantity"]) == 5

        upd = s.put(f"{API}/production/orders/{oid}", json={"planned_quantity": 9, "recipe_id": rid2}, timeout=20)
        assert upd.status_code == 200, upd.text[:400]
        assert float(upd.json()["planned_quantity"]) == 9
        assert upd.json()["recipe_id"] == rid2

        assert s.post(f"{API}/production/orders/{oid}/start", json={}, timeout=20).status_code == 200

        # Plan üstü tamamla
        done = s.post(
            f"{API}/production/orders/{oid}/complete",
            json={"quantity": 11, "update_cost": True, "allow_over": True},
            timeout=30,
        )
        assert done.status_code == 200, done.text[:400]
        assert done.json().get("finished") is True
        got = next(x for x in s.get(f"{API}/production/orders", params={"company_id": COMPANY}, timeout=20).json() if x["id"] == oid)
        assert float(got["completed_quantity"]) == 11
        assert float(got["planned_quantity"]) == 9
        assert got.get("over_produced") is True

    def test_finish_work_order_allows_over_plan(self):
        s = _admin()
        fin = _product(s, "WO Over Mamul", f"WO{uuid.uuid4().hex[:8]}")
        mat = _product(s, "WO Over Ham", f"WH{uuid.uuid4().hex[:8]}", type="raw_material", purchase_price=1)
        rec = s.post(
            f"{API}/production/recipes",
            json={
                "company_id": COMPANY,
                "name": "WO Over Reçete",
                "finished_product_id": fin["id"],
                "finished_product_name": fin["name"],
                "target_quantity": 1,
                "materials": [{"product_id": mat["id"], "product_name": mat["name"], "quantity": 1, "unit": "Adet"}],
                "steps": [{"no": 1, "name": "Üretim", "station": "Genel", "duration_min": 1}],
            },
            timeout=20,
        )
        assert rec.status_code in (200, 201), rec.text[:300]
        po = s.post(
            f"{API}/production/orders",
            json={"company_id": COMPANY, "recipe_id": rec.json()["id"], "planned_quantity": 3},
            timeout=20,
        )
        assert po.status_code in (200, 201), po.text[:400]
        oid = po.json()["id"]
        wos = s.get(f"{API}/production/work-orders", params={"company_id": COMPANY, "order_id": oid}, timeout=20)
        assert wos.status_code == 200 and wos.json(), wos.text[:200]
        wo = wos.json()[0]
        assert s.post(f"{API}/production/work-orders/{wo['id']}/start", json={"operator_name": "Test"}, timeout=20).status_code == 200
        fin_r = s.post(
            f"{API}/production/work-orders/{wo['id']}/finish",
            json={"produced_qty": 5, "scrap_qty": 0, "operator_name": "Test"},
            timeout=30,
        )
        assert fin_r.status_code == 200, fin_r.text[:400]
        assert "üstü" in (fin_r.json().get("message") or "").lower() or fin_r.json().get("order_completed") is True
