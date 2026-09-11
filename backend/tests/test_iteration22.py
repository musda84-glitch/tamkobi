"""Iteration 22: B2B portal cargo tracking + shift/leave conflict."""
import os
import requests
import pytest
from dotenv import dotenv_values
from mysql_store import SyncMySQLClient as MongoClient

_fenv = dotenv_values("/app/frontend/.env")
_benv = dotenv_values("/app/backend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _fenv.get("REACT_APP_BACKEND_URL")).rstrip("/")
API = f"{BASE_URL}/api"
COMPANY = "comp_nexus_main_01"
B2B_TOKEN = "57b063b0e3fb4e7e893b8429c3f8b654"

_mc = MongoClient(_benv.get("MONGO_URL") or os.environ["MONGO_URL"])
_db = _mc[_benv.get("DB_NAME") or os.environ["DB_NAME"]]


@pytest.fixture(scope="module")
def s():
    return requests.Session()


# ---- B2B tracking ----
class TestB2BTracking:
    def test_portal_tracking_shape(self, s):
        r = s.get(f"{API}/public/b2b/{B2B_TOKEN}")
        assert r.status_code == 200, r.text
        data = r.json()
        orders = data["orders"]
        assert orders, "portal should return orders"
        shipped = [o for o in orders if o.get("order_status") in ("shipped", "delivered") and o.get("cargo_tracking_number")]
        pending = [o for o in orders if o.get("order_status") in ("pending", "processing", "confirmed") and not o.get("cargo_tracking_number")]
        assert shipped, "expected at least one shipped order with tracking number"

        for o in shipped:
            t = o.get("tracking")
            assert t is not None, f"tracking must not be null for shipped order {o.get('order_number')}"
            assert t["tracking_number"]
            assert t["status"] in ("in_transit", "created", "picked_up", "out_for_delivery", "delivered")
            assert isinstance(t["step"], int) and 0 <= t["step"] <= 4
            assert isinstance(t["steps"], list) and len(t["steps"]) == 5
            assert "estimated_delivery" in t
            assert isinstance(t["is_late"], bool)
            assert "shipped_at" in t
            if t.get("carrier") == "yurtici":
                assert "yurticikargo.com" in (t["tracking_url"] or "")
                assert f"code={t['tracking_number']}" in t["tracking_url"]

        for o in pending:
            assert o.get("tracking") is None, f"pending order {o.get('order_number')} should have tracking null"

    def test_create_shipment_updates_tracking(self, s):
        # pick a pending order to create a shipment for
        r = s.get(f"{API}/public/b2b/{B2B_TOKEN}")
        assert r.status_code == 200
        orders = r.json()["orders"]
        pending = next((o for o in orders if o.get("order_status") == "pending" and not o.get("cargo_tracking_number")), None)
        if not pending:
            pytest.skip("no pending order to test with")
        order_id = pending["id"]

        cr = s.post(f"{API}/cargo/create-shipment", json={
            "order_id": order_id, "carrier_code": "yurtici",
            "customer_name": pending.get("customer_name") or "Müşteri",
            "address": pending.get("shipping_address") or "Adres",
            "city": pending.get("city") or "İstanbul",
            "company_id": COMPANY,
        })
        assert cr.status_code == 200, cr.text
        shp = cr.json()
        shipment_id = shp["id"] if "id" in shp else shp.get("_id")
        try:
            # verify tracking now present in portal
            r2 = s.get(f"{API}/public/b2b/{B2B_TOKEN}")
            o2 = next(o for o in r2.json()["orders"] if o["id"] == order_id)
            t = o2["tracking"]
            assert t is not None
            assert t["tracking_number"] == shp["tracking_number"]
            assert t["status"] in ("in_transit", "created")
            assert t["carrier"] in (shp.get("carrier_name"), "yurtici")
            assert t["estimated_delivery"]  # simulated shipment sets it
        finally:
            # cleanup shipment + revert order via direct DB
            if shipment_id:
                _db.cargo_shipments.delete_one({"_id": shipment_id})
            _db.orders.update_one({"_id": order_id}, {"$set": {"order_status": "pending"}, "$unset": {"cargo_tracking_number": "", "cargo_carrier": "", "cargo_barcode": "", "cargo_tracking_url": "", "cargo_shipment_id": "", "cargo_label_url": ""}})


# ---- Shift-Leave conflict ----
class TestShiftLeaveConflict:
    @pytest.fixture(scope="class")
    def employee_id(self, s):
        r = s.get(f"{API}/personnel/employees?company_id={COMPANY}")
        assert r.status_code == 200
        emps = r.json()
        active = [e for e in emps if e.get("status") == "active"]
        assert active
        return active[0]["id"] if "id" in active[0] else active[0]["_id"]

    def test_conflict_flow(self, s, employee_id):
        # 1) create leave
        cr = s.post(f"{API}/personnel/leaves", json={
            "employee_id": employee_id, "type": "unpaid",
            "start_date": "2026-09-15", "end_date": "2026-09-16", "reason": "TEST_iter22"
        })
        assert cr.status_code == 200, cr.text
        leave_id = cr.json()["id"] if "id" in cr.json() else cr.json()["_id"]

        shift_ids = []
        try:
            # 2) approve
            dr = s.post(f"{API}/personnel/leaves/{leave_id}/decide", json={"status": "approved"})
            assert dr.status_code == 200, dr.text
            assert dr.json()["status"] == "approved"

            # 3) GET shifts - initial: no plan, leave shows on cell, no conflict
            gr = s.get(f"{API}/personnel/shifts?company_id={COMPANY}&week_start=2026-09-14")
            assert gr.status_code == 200
            grid = gr.json()
            row = next(r for r in grid["rows"] if r["employee_id"] == employee_id)
            cell15 = next(c for c in row["cells"] if c["date"] == "2026-09-15")
            cell16 = next(c for c in row["cells"] if c["date"] == "2026-09-16")
            for cell in (cell15, cell16):
                assert cell.get("leave"), f"leave should be attached to {cell['date']}"
                assert cell["leave"]["type"] == "unpaid"
                assert cell["leave"]["label"] == "Ücretsiz"
                if not cell["planned"]:
                    assert not cell.get("conflict", False)
            # conflicts count should be 0 (no plans)
            assert grid["conflicts"] == 0

            # 4) PUT shift on leave day → warning
            pr = s.put(f"{API}/personnel/shifts", json={
                "company_id": COMPANY,
                "items": [{"employee_id": employee_id, "date": "2026-09-15", "start": "09:00", "end": "18:00"}]
            })
            assert pr.status_code == 200, pr.text
            pdata = pr.json()
            assert pdata["warnings"], "expected warnings on conflict"
            assert "izinli" in pdata["warnings"][0].lower()
            assert "çakışıyor" in pdata["warnings"][0]
            assert "Uyarı" in pdata["message"]

            # 5) GET again → cell.conflict True, conflicts 1
            gr2 = s.get(f"{API}/personnel/shifts?company_id={COMPANY}&week_start=2026-09-14")
            grid2 = gr2.json()
            row2 = next(r for r in grid2["rows"] if r["employee_id"] == employee_id)
            cell15b = next(c for c in row2["cells"] if c["date"] == "2026-09-15")
            assert cell15b["planned"] is True
            assert cell15b["conflict"] is True
            assert grid2["conflicts"] >= 1
            shift_ids.append(cell15b["id"])

            # 6) PUT with off:true → conflict False
            pr2 = s.put(f"{API}/personnel/shifts", json={
                "company_id": COMPANY,
                "items": [{"employee_id": employee_id, "date": "2026-09-15", "off": True}]
            })
            assert pr2.status_code == 200
            assert not pr2.json()["warnings"]

            gr3 = s.get(f"{API}/personnel/shifts?company_id={COMPANY}&week_start=2026-09-14")
            row3 = next(r for r in gr3.json()["rows"] if r["employee_id"] == employee_id)
            cell15c = next(c for c in row3["cells"] if c["date"] == "2026-09-15")
            assert cell15c["off"] is True
            assert cell15c.get("conflict") is False
        finally:
            # cleanup
            for sid in shift_ids:
                s.delete(f"{API}/personnel/shifts/{sid}")
            # also delete any plan we made
            gr_c = s.get(f"{API}/personnel/shifts?company_id={COMPANY}&week_start=2026-09-14")
            if gr_c.status_code == 200:
                row_c = next((r for r in gr_c.json()["rows"] if r["employee_id"] == employee_id), None)
                if row_c:
                    for c in row_c["cells"]:
                        if c.get("planned") and c.get("id"):
                            s.delete(f"{API}/personnel/shifts/{c['id']}")
            s.delete(f"{API}/personnel/leaves/{leave_id}")
