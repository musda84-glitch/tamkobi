"""Iteration 8 backend tests: production work orders (atölye) + iteration-7 fix verifications."""
import os
import time
import uuid

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


def get(path, **kw):
    return S.get(f"{BASE}{path}", timeout=60, **kw)


def post(path, payload=None):
    return S.post(f"{BASE}{path}", json=payload or {}, timeout=60)


# ---------------- Work orders (iş emirleri) ----------------
@pytest.mark.order(1)
class TestWorkOrderFlow:
    def test_01_recipe_steps_persist(self):
        r = get("/production/recipes")
        assert r.status_code == 200
        rec = next((x for x in r.json() if x["id"] == REC), None)
        assert rec is not None, "seeded rec_01 not found"
        STATE["orig_steps"] = rec.get("steps") or []
        STATE["rec_unit_cost"] = rec.get("unit_cost")
        steps = [
            {"no": 1, "name": "Montaj", "station": "Montaj Hattı 1", "duration_min": 20},
            {"no": 2, "name": "Kalite Kontrol", "station": "QC", "duration_min": 5},
        ]
        u = S.put(f"{BASE}/production/recipes/{REC}", json={"steps": steps}, timeout=60)
        assert u.status_code == 200, u.text
        assert u.json().get("steps") == steps
        # verify persisted via GET
        rec2 = next(x for x in get("/production/recipes").json() if x["id"] == REC)
        assert rec2["steps"] == steps

    def test_02_recipe_unit_cost_present(self):
        rec = next(x for x in get("/production/recipes").json() if x["id"] == REC)
        assert "unit_cost" in rec and rec["unit_cost"] > 0, rec.get("unit_cost")

    def test_03_create_order_generates_two_work_orders(self):
        r = post("/production/orders", {"company_id": COMPANY, "recipe_id": REC, "planned_quantity": 2})
        assert r.status_code in (200, 201), r.text
        o = r.json()
        STATE["order_id"] = o["id"]
        STATE["order_code"] = o["order_code"]
        assert o["status"] == "planned"
        w = get("/production/work-orders", params={"order_id": o["id"]})
        assert w.status_code == 200
        wos = w.json()
        assert len(wos) == 2, wos
        assert [x["step_no"] for x in wos] == [1, 2]
        assert wos[0]["status"] == "ready" and wos[1]["status"] == "waiting"
        assert wos[0]["step_name"] == "Montaj" and wos[1]["step_name"] == "Kalite Kontrol"
        assert wos[0]["station"] == "Montaj Hattı 1" and wos[1]["station"] == "QC"
        for x in wos:
            assert x["step_count"] == 2
            assert x["unit"]
            assert x["planned_quantity"] == 2
        STATE["id_leak"] = any("_id" in x for x in wos)
        STATE["wo1"], STATE["wo2"] = wos[0]["id"], wos[1]["id"]

    def test_03b_no_mongo_id_leak(self):
        # pre-existing issue reported since iteration 6 (clean_doc keeps raw _id)
        assert STATE.get("id_leak") is False, "Mongo _id leaked in work-order payloads"

    def test_04_stations_endpoint(self):
        r = get("/production/work-orders/stations")
        assert r.status_code == 200
        st = r.json()
        assert isinstance(st, list)
        assert "Montaj Hattı 1" in st and "QC" in st

    def test_05_generate_work_orders_idempotent(self):
        r = post(f"/production/orders/{STATE['order_id']}/generate-work-orders")
        assert r.status_code == 200, r.text
        assert r.json()["count"] == 2

    def test_06_start_wo1_sets_order_in_production(self):
        r = post(f"/production/work-orders/{STATE['wo1']}/start", {"operator_name": "Ali"})
        assert r.status_code == 200, r.text
        wos = get("/production/work-orders", params={"order_id": STATE["order_id"]}).json()
        w1 = next(x for x in wos if x["id"] == STATE["wo1"])
        assert w1["status"] == "in_progress"
        assert w1["operator_name"] == "Ali"
        assert w1["started_at"]
        assert "elapsed_min" in w1
        po = next(x for x in get("/production/orders").json() if x["id"] == STATE["order_id"])
        assert po["status"] == "in_production"

    def test_07_start_waiting_step_rejected(self):
        r = post(f"/production/work-orders/{STATE['wo2']}/start", {"operator_name": "Veli"})
        assert r.status_code == 400, r.text

    def test_08_pause_and_resume(self):
        r = post(f"/production/work-orders/{STATE['wo1']}/pause", {"reason": "Mola"})
        assert r.status_code == 200, r.text
        w1 = next(x for x in get("/production/work-orders", params={"order_id": STATE["order_id"]}).json() if x["id"] == STATE["wo1"])
        assert w1["status"] == "paused" and w1.get("paused_at")
        # pause again -> 400
        assert post(f"/production/work-orders/{STATE['wo1']}/pause").status_code == 400
        time.sleep(2)
        r = post(f"/production/work-orders/{STATE['wo1']}/start", {"operator_name": "Ali"})
        assert r.status_code == 200, r.text
        w1 = next(x for x in get("/production/work-orders", params={"order_id": STATE["order_id"]}).json() if x["id"] == STATE["wo1"])
        assert w1["status"] == "in_progress"
        assert w1.get("paused_seconds", 0) >= 1, w1.get("paused_seconds")
        assert w1.get("paused_at") in (None, "")

    def test_09_assign_work_order(self):
        r = S.put(f"{BASE}/production/work-orders/{STATE['wo2']}/assign", json={"assigned_to": "emp_x", "assigned_name": "Ayşe"}, timeout=60)
        assert r.status_code == 200, r.text
        w2 = next(x for x in get("/production/work-orders", params={"order_id": STATE["order_id"]}).json() if x["id"] == STATE["wo2"])
        assert w2["assigned_name"] == "Ayşe" and w2["assigned_to"] == "emp_x"

    def test_10_finish_wo1_activates_wo2(self):
        # snapshot stock before
        prods = get("/products").json()
        STATE["stock_before"] = {p["id"]: p.get("stock_quantity") for p in prods}
        rec = next(x for x in get("/production/recipes").json() if x["id"] == REC)
        STATE["recipe"] = rec
        fin_prod = next(p for p in prods if p["id"] == rec["finished_product_id"])
        STATE["fin_price_before"] = fin_prod.get("purchase_price")

        r = post(f"/production/work-orders/{STATE['wo1']}/finish", {"produced_qty": 2, "scrap_qty": 0, "operator_name": "Ali"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert not body.get("order_completed"), body
        wos = get("/production/work-orders", params={"order_id": STATE["order_id"]}).json()
        w1 = next(x for x in wos if x["id"] == STATE["wo1"])
        w2 = next(x for x in wos if x["id"] == STATE["wo2"])
        assert w1["status"] == "done" and w1["produced_qty"] == 2 and w1["finished_at"]
        assert w2["status"] == "ready"

    def test_11_finish_done_wo_rejected(self):
        r = post(f"/production/work-orders/{STATE['wo1']}/finish", {"produced_qty": 1})
        assert r.status_code == 400, r.text

    def test_12_finish_last_step_completes_order_and_moves_stock(self):
        assert post(f"/production/work-orders/{STATE['wo2']}/start", {"operator_name": "Ayşe"}).status_code == 200
        r = post(f"/production/work-orders/{STATE['wo2']}/finish", {"produced_qty": 2, "scrap_qty": 0, "operator_name": "Ayşe"})
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("order_completed") is True, body
        po = next(x for x in get("/production/orders").json() if x["id"] == STATE["order_id"])
        assert po["status"] == "completed"
        assert po["completed_quantity"] == 2
        after = {p["id"]: p.get("stock_quantity") for p in get("/products").json()}
        rec = STATE["recipe"]
        fid = rec["finished_product_id"]
        assert round(after[fid] - STATE["stock_before"][fid], 3) == 2, (after[fid], STATE["stock_before"][fid])
        for m in rec["materials"]:
            pid = m["product_id"]
            assert after[pid] < STATE["stock_before"][pid], f"raw material {m['product_name']} not decreased"

    def test_13_finished_products_stay_out_of_ready_list(self):
        rows = get("/production/work-orders", params={"status": "ready,in_progress,paused,waiting"}).json()
        assert all(x["id"] not in (STATE["wo1"], STATE["wo2"]) for x in rows)
        done = get("/production/work-orders", params={"status": "done", "order_id": STATE["order_id"]}).json()
        assert len(done) == 2

    def test_14_station_filter(self):
        rows = get("/production/work-orders", params={"station": "QC"}).json()
        assert rows, "no work orders at QC station"
        assert all(x["station"] == "QC" for x in rows)

    def test_15_404s(self):
        assert post(f"/production/work-orders/{uuid.uuid4()}/start").status_code == 404
        assert post(f"/production/orders/{uuid.uuid4()}/generate-work-orders").status_code == 404


# ---------------- iteration-7 fix verifications ----------------
class TestIteration7Fixes:
    def test_recipe_without_code_autogenerates(self):
        prods = get("/products").json()
        fin = prods[0]
        mat = prods[1]
        payload = {"company_id": COMPANY, "name": "TEST_Reçete_it8", "finished_product_id": fin["id"],
                   "finished_product_name": fin["name"],
                   "materials": [{"product_id": mat["id"], "product_name": mat["name"], "quantity": 1, "unit": mat.get("unit", "Adet")}]}
        r = post("/production/recipes", payload)
        assert r.status_code in (200, 201), f"expected auto-code, got {r.status_code}: {r.text[:300]}"
        body = r.json()
        assert body.get("code"), "code not auto-generated"
        STATE["tmp_recipe"] = body["id"]
        STATE["tmp_recipe_product"] = fin["id"]

    def test_product_without_barcode_autogenerates(self):
        payload = {"company_id": COMPANY, "name": "TEST_Ürün_it8", "sku": f"TEST-{uuid.uuid4().hex[:6]}"}
        r = post("/products", payload)
        assert r.status_code in (200, 201), f"{r.status_code}: {r.text[:300]}"
        body = r.json()
        assert body.get("barcode"), "barcode not auto-generated"
        STATE["tmp_product"] = body["id"]

    def test_complete_planned_order_rejected(self):
        r = post("/production/orders", {"company_id": COMPANY, "recipe_id": REC, "planned_quantity": 1})
        assert r.status_code in (200, 201)
        oid = r.json()["id"]
        STATE["planned_order"] = oid
        c = post(f"/production/orders/{oid}/complete", {"quantity": 1})
        assert c.status_code == 400, c.text
        assert "başlat" in c.json().get("detail", "").lower()

    def test_complete_without_update_cost_keeps_purchase_price(self):
        oid = STATE["planned_order"]
        rec = next(x for x in get("/production/recipes").json() if x["id"] == REC)
        fid = rec["finished_product_id"]
        before = next(p for p in get("/products").json() if p["id"] == fid)
        price_before = before.get("purchase_price")
        stock_before = before.get("stock_quantity")
        assert post(f"/production/orders/{oid}/start").status_code == 200
        c = post(f"/production/orders/{oid}/complete", {"quantity": 1})
        assert c.status_code == 200, c.text
        after = next(p for p in get("/products").json() if p["id"] == fid)
        assert after.get("purchase_price") == price_before, (price_before, after.get("purchase_price"))
        assert round(after["stock_quantity"] - stock_before, 3) == 1
        STATE["completed_extra_order"] = oid

    def test_invoice_edit_guard(self):
        invs = get("/invoices").json()
        target = next((i for i in invs if i.get("status") != "draft"), None)
        assert target, "no non-draft invoice to test"
        r = S.put(f"{BASE}/invoices/{target['id']}", json={"notes": "x", "items": target.get("items", [])}, timeout=60)
        assert r.status_code == 400, f"{r.status_code}: {r.text[:200]}"
        # notes only still allowed
        ok = S.put(f"{BASE}/invoices/{target['id']}", json={"notes": target.get("notes") or ""}, timeout=60)
        assert ok.status_code == 200, ok.text
