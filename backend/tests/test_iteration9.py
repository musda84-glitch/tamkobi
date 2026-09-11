"""Iteration 9 backend regression: recipe auto-code, _id removal, work-order finish validation,
finish without update_cost, and GET /api/contacts/flags."""
import os

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE = base_url.rstrip("/") + "/api"
COMPANY = "comp_nexus_main_01"
REC = "rec_01"

S = requests.Session()
S.headers.update({"Content-Type": "application/json"})
STATE = {}


def get(p, **kw):
    return S.get(f"{BASE}{p}", timeout=60, **kw)


def post(p, payload=None):
    return S.post(f"{BASE}{p}", json=payload or {}, timeout=60)


# ---------------- Recipes: auto code ----------------
class TestRecipeAutoCode:
    def test_recipe_without_code_autogenerates(self):
        r = get("/products?company_id=" + COMPANY)
        assert r.status_code == 200
        prod = r.json()[0]
        payload = {
            "company_id": COMPANY,
            "name": "TEST_it9_recipe",
            "finished_product_id": prod["id"],
            "finished_product_name": prod.get("name"),
            "target_quantity": 1,
            "materials": [],
        }
        c = post("/production/recipes", payload)
        assert c.status_code == 200, c.text
        d = c.json()
        assert "_id" not in d
        assert d.get("code", "").startswith("BOM-"), d.get("code")
        STATE["recipe_id"] = d["id"]
        # verify persisted
        lst = get("/production/recipes?company_id=" + COMPANY).json()
        found = next((x for x in lst if x["id"] == STATE["recipe_id"]), None)
        assert found is not None
        assert found["code"] == d["code"]

    def test_cleanup_recipe(self):
        rid = STATE.get("recipe_id")
        if not rid:
            pytest.skip("no recipe created")
        d = S.delete(f"{BASE}/production/recipes/{rid}", timeout=60)
        assert d.status_code == 200


# ---------------- _id leak ----------------
class TestNoMongoId:
    @pytest.mark.parametrize("path", [
        "/contacts?company_id=" + COMPANY,
        "/invoices?company_id=" + COMPANY,
        "/production/work-orders?company_id=" + COMPANY,
        "/products?company_id=" + COMPANY,
        "/production/recipes?company_id=" + COMPANY,
        "/production/orders?company_id=" + COMPANY,
        "/quotes?company_id=" + COMPANY,
    ])
    def test_no_underscore_id(self, path):
        r = get(path)
        assert r.status_code == 200, r.text
        data = r.json()
        rows = data if isinstance(data, list) else [data]
        for row in rows[:50]:
            assert isinstance(row, dict)
            assert "_id" not in row, f"{path} leaks _id"
            assert "id" in row, f"{path} row missing id"

    def test_contact_detail_no_id(self):
        r = get("/contacts/cnt_01/detail")
        if r.status_code == 404:
            r = get("/contacts/cnt_01/statement")
        assert r.status_code == 200, r.text
        blob = r.text
        assert '"_id"' not in blob


# ---------------- contact flags ----------------
class TestContactFlags:
    def test_flags_shape(self):
        r = get("/contacts/flags?company_id=" + COMPANY)
        assert r.status_code == 200, r.text
        flags = r.json()
        assert isinstance(flags, dict)
        keys = {"overdue_amount", "overdue_count", "installment_due_amount",
                "installment_due_count", "installment_overdue_count"}
        for cid, v in flags.items():
            assert isinstance(cid, str)
            assert keys.issubset(set(v.keys())), v
            assert isinstance(v["overdue_count"], int)
            assert isinstance(v["installment_due_count"], int)
        STATE["flags"] = flags

    def test_cnt_01_has_due_installment(self):
        flags = STATE.get("flags") or get("/contacts/flags?company_id=" + COMPANY).json()
        v = flags.get("cnt_01")
        assert v is not None, "cnt_01 missing from flags"
        assert v["installment_due_count"] >= 1, v
        assert v["installment_due_amount"] > 0, v

    def test_flags_days_param(self):
        r0 = get("/contacts/flags?company_id=%s&days=0" % COMPANY)
        r90 = get("/contacts/flags?company_id=%s&days=90" % COMPANY)
        assert r0.status_code == 200 and r90.status_code == 200
        c0 = sum(v["installment_due_count"] for v in r0.json().values())
        c90 = sum(v["installment_due_count"] for v in r90.json().values())
        assert c90 >= c0, (c0, c90)


# ---------------- work order finish validation ----------------
class TestWorkOrderFinishValidation:
    def test_setup_order(self):
        c = post("/production/orders", {"company_id": COMPANY, "recipe_id": REC, "planned_quantity": 2})
        assert c.status_code == 200, c.text
        o = c.json().get("order") or c.json()
        STATE["order_id"] = o["id"]
        STATE["order_code"] = o.get("order_code")
        assert "_id" not in o
        s = post(f"/production/orders/{STATE['order_id']}/start")
        assert s.status_code == 200, s.text
        wos = get(f"/production/work-orders?company_id={COMPANY}&order_id={STATE['order_id']}").json()
        assert len(wos) >= 1, wos
        wos = sorted(wos, key=lambda x: x["step_no"])
        STATE["wos"] = wos
        st = post(f"/production/work-orders/{wos[0]['id']}/start", {"operator_name": "TEST_it9"})
        assert st.status_code == 200, st.text

    def test_finish_over_planned_rejected(self):
        wo = STATE["wos"][0]
        r = post(f"/production/work-orders/{wo['id']}/finish", {"produced_qty": 2, "scrap_qty": 1})
        assert r.status_code == 400, r.text
        assert "aşamaz" in r.json().get("detail", ""), r.text

    def test_finish_negative_rejected(self):
        wo = STATE["wos"][0]
        r = post(f"/production/work-orders/{wo['id']}/finish", {"produced_qty": -1})
        assert r.status_code == 400, r.text

    def test_finish_within_planned_ok(self):
        wo = STATE["wos"][0]
        r = post(f"/production/work-orders/{wo['id']}/finish", {"produced_qty": 1, "scrap_qty": 1})
        assert r.status_code == 200, r.text

    def test_finish_last_step_does_not_change_purchase_price(self):
        wos = STATE["wos"]
        if len(wos) < 2:
            pytest.skip("recipe has single step")
        rec = next(x for x in get("/production/recipes?company_id=" + COMPANY).json() if x["id"] == REC)
        pid = rec["finished_product_id"]
        before = next(p for p in get("/products?company_id=" + COMPANY).json() if p["id"] == pid)
        STATE["price_before"] = before.get("purchase_price")
        STATE["stock_before"] = before.get("stock_quantity")
        last = wos[-1]
        assert post(f"/production/work-orders/{last['id']}/start", {"operator_name": "TEST_it9"}).status_code == 200
        r = post(f"/production/work-orders/{last['id']}/finish", {"produced_qty": 1})
        assert r.status_code == 200, r.text
        after = next(p for p in get("/products?company_id=" + COMPANY).json() if p["id"] == pid)
        assert after.get("purchase_price") == STATE["price_before"], (
            "purchase_price changed without update_cost", STATE["price_before"], after.get("purchase_price"))
        STATE["stock_after"] = after.get("stock_quantity")
        assert after.get("stock_quantity") == STATE["stock_before"] + 1

    def test_cleanup(self):
        oid = STATE.get("order_id")
        if not oid:
            pytest.skip("nothing to clean")
        # revert stock added by production
        if STATE.get("stock_after") is not None:
            rec = next(x for x in get("/production/recipes?company_id=" + COMPANY).json() if x["id"] == REC)
            pid = rec["finished_product_id"]
            u = S.put(f"{BASE}/products/{pid}", json={"stock_quantity": STATE["stock_before"]}, timeout=60)
            assert u.status_code == 200, u.text
        d = S.delete(f"{BASE}/production/orders/{oid}", timeout=60)
        assert d.status_code in (200, 204, 404), d.text
