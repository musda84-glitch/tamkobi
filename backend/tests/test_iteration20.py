"""Iteration 20: vardiya planı (shift_plans), izin self-servis, atomik B2B sipariş numarası."""
import re

import pytest
import requests

from conftest import API, TEST_COMPANY_ID, resolve_b2b_token

EMP = "emp_03"          # Emre Çetin (annual 14, used 0)
ADMIN_USER = "usr_admin_01"
W1 = "2026-09-07"       # Pazartesi
W2 = "2026-09-14"
D1, D2 = "2026-09-07", "2026-09-08"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------- helpers / cleanup ----------
def _delete_week_plans(client, week_start):
    r = client.get(f"{API}/personnel/shifts", params={"company_id": TEST_COMPANY_ID, "week_start": week_start})
    if r.status_code != 200:
        return
    for row in r.json().get("rows", []):
        for c in row["cells"]:
            if c.get("planned") and c.get("id"):
                client.delete(f"{API}/personnel/shifts/{c['id']}")


@pytest.fixture(scope="module", autouse=True)
def cleanup(client):
    yield
    _delete_week_plans(client, W1)
    _delete_week_plans(client, W2)
    # leaves created by self-service
    me = client.get(f"{API}/personnel/leaves/me")
    if me.status_code == 200:
        for lv in (me.json().get("leaves") or []):
            if lv.get("source") == "self":
                client.delete(f"{API}/personnel/leaves/self/{lv['id']}")
    client.put(f"{API}/users/{ADMIN_USER}", json={"employee_id": None})


# ---------- Vardiya planı: PUT/GET /personnel/shifts ----------
class TestShiftPlan:
    def test_put_shifts_saves_two(self, client):
        r = client.put(f"{API}/personnel/shifts", json={"company_id": TEST_COMPANY_ID, "items": [
            {"employee_id": EMP, "date": D1, "start": "14:00", "end": "22:00", "break_minutes": 30, "note": "gece"},
            {"employee_id": EMP, "date": D2, "off": True},
        ]})
        assert r.status_code == 200, r.text
        assert r.json()["saved"] == 2

    def test_get_shifts_week(self, client):
        r = client.get(f"{API}/personnel/shifts", params={"company_id": TEST_COMPANY_ID, "week_start": W1})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["week_start"] == W1
        assert d["dates"] == ["2026-09-0" + str(i) for i in range(7, 10)] + ["2026-09-1" + str(i) for i in range(0, 4)]
        assert d["day_labels"][0] == "Pzt" and d["day_labels"][6] == "Paz"
        row = next(x for x in d["rows"] if x["employee_id"] == EMP)
        cells = {c["date"]: c for c in row["cells"]}
        assert cells[D1]["planned"] is True
        assert (cells[D1]["start"], cells[D1]["end"], cells[D1]["break_minutes"]) == ("14:00", "22:00", 30)
        assert cells[D1]["note"] == "gece" and cells[D1]["off"] is False
        assert cells[D2]["planned"] is True and cells[D2]["off"] is True
        # unplanned weekday filled from company schedule, weekend off
        wed = cells["2026-09-09"]
        assert wed["planned"] is False and wed["off"] is False and wed["start"] and wed["end"]
        sat, sun = cells["2026-09-12"], cells["2026-09-13"]
        assert sat["planned"] is False and sat["off"] is True
        assert sun["off"] is True and sun["start"] is None

    def test_put_shifts_invalid_end(self, client):
        r = client.put(f"{API}/personnel/shifts", json={"company_id": TEST_COMPANY_ID, "items": [
            {"employee_id": EMP, "date": "2026-09-10", "start": "18:00", "end": "09:00"}]})
        assert r.status_code == 400, r.text
        assert "bitiş" in r.json()["detail"].lower()

    def test_put_shifts_unknown_employee(self, client):
        r = client.put(f"{API}/personnel/shifts", json={"company_id": TEST_COMPANY_ID, "items": [
            {"employee_id": "emp_zzz_missing", "date": "2026-09-10", "start": "09:00", "end": "18:00"}]})
        assert r.status_code == 404, r.text

    def test_put_shifts_empty_items(self, client):
        r = client.put(f"{API}/personnel/shifts", json={"company_id": TEST_COMPANY_ID, "items": []})
        assert r.status_code == 400


# ---------- Puantaj plana göre hesap ----------
class TestAttendanceUsesPlan:
    def test_attendance_uses_shift_plan(self, client):
        r = client.post(f"{API}/personnel/attendance", json={"employee_id": EMP, "date": D1, "check_in": "14:10", "check_out": "23:00", "status": "present"})
        assert r.status_code == 200, r.text
        rec = r.json()
        rec = rec.get("record", rec)
        snap = rec["schedule_snapshot"]
        assert snap["from_shift_plan"] is True
        assert (snap["start"], snap["end"]) == ("14:00", "22:00")
        assert rec["hours"] == pytest.approx(8.33, abs=0.02)
        assert rec["overtime_hours"] == pytest.approx(1.0, abs=0.01)
        assert rec["late_minutes"] == 0
        assert rec["is_off_day"] is False

    def test_attendance_off_plan_counts_all_as_overtime(self, client):
        r = client.post(f"{API}/personnel/attendance", json={"employee_id": EMP, "date": D2, "check_in": "10:00", "check_out": "13:00", "status": "present"})
        assert r.status_code == 200, r.text
        rec = r.json()
        rec = rec.get("record", rec)
        assert rec["is_off_day"] is True
        assert rec["overtime_hours"] == pytest.approx(2.0, abs=0.01)
        assert rec["schedule_snapshot"]["from_shift_plan"] is True


# ---------- copy-week & delete ----------
class TestCopyWeekAndDelete:
    def test_copy_week(self, client):
        r = client.post(f"{API}/personnel/shifts/copy-week", json={"company_id": TEST_COMPANY_ID, "from_week_start": W1, "to_week_start": W2})
        assert r.status_code == 200, r.text
        assert r.json()["copied"] == 2
        g = client.get(f"{API}/personnel/shifts", params={"company_id": TEST_COMPANY_ID, "week_start": W2}).json()
        row = next(x for x in g["rows"] if x["employee_id"] == EMP)
        cells = {c["date"]: c for c in row["cells"]}
        assert cells["2026-09-14"]["planned"] is True and cells["2026-09-14"]["start"] == "14:00"
        assert cells["2026-09-15"]["planned"] is True and cells["2026-09-15"]["off"] is True

    def test_delete_shift_twice(self, client):
        g = client.get(f"{API}/personnel/shifts", params={"company_id": TEST_COMPANY_ID, "week_start": W2}).json()
        row = next(x for x in g["rows"] if x["employee_id"] == EMP)
        sid = next(c["id"] for c in row["cells"] if c.get("planned"))
        assert client.delete(f"{API}/personnel/shifts/{sid}").status_code == 200
        assert client.delete(f"{API}/personnel/shifts/{sid}").status_code == 404


# ---------- İzin self-servis ----------
class TestLeaveSelfService:
    def test_post_self_without_link_403(self, client):
        client.put(f"{API}/users/{ADMIN_USER}", json={"employee_id": None})
        r = client.post(f"{API}/personnel/leaves/self", json={"type": "unpaid", "start_date": "2026-10-05", "end_date": "2026-10-07"})
        assert r.status_code == 403, r.text
        me = client.get(f"{API}/personnel/leaves/me")
        assert me.status_code == 200 and me.json()["employee"] is None

    def test_link_and_get_me(self, client):
        r = client.put(f"{API}/users/{ADMIN_USER}", json={"employee_id": EMP})
        assert r.status_code == 200, r.text
        me = client.get(f"{API}/personnel/leaves/me")
        assert me.status_code == 200, me.text
        d = me.json()
        assert d["employee"]["id"] == EMP
        assert isinstance(d["leaves"], list)
        assert d["types"]["unpaid"] == "Ücretsiz"
        b = d["balance"]
        assert b["annual"] == 14 and b["remaining"] == b["annual"] - b["used"]
        assert "pending_days" in b

    def test_create_self_leave(self, client):
        r = client.post(f"{API}/personnel/leaves/self", json={"type": "unpaid", "start_date": "2026-10-05", "end_date": "2026-10-07", "reason": "TEST_ozel"})
        assert r.status_code == 200, r.text
        lv = r.json()
        assert lv["status"] == "pending" and lv["days"] == 3 and lv["source"] == "self"
        assert lv["employee_id"] == EMP and "id" in lv and "_id" not in lv
        # notification to managers
        n = client.get(f"{API}/notifications", params={"company_id": TEST_COMPANY_ID})
        assert n.status_code == 200
        rows = n.json() if isinstance(n.json(), list) else n.json().get("notifications", [])
        assert any(x.get("type") == "leave_request" and "İzin talebi" in (x.get("title") or "") for x in rows), rows[:3]
        # visible in /me
        me = client.get(f"{API}/personnel/leaves/me").json()
        assert any(x["id"] == lv["id"] for x in me["leaves"])

    def test_overlap_rejected(self, client):
        r = client.post(f"{API}/personnel/leaves/self", json={"type": "unpaid", "start_date": "2026-10-06", "end_date": "2026-10-09"})
        assert r.status_code == 400, r.text
        assert "çakışan" in r.json()["detail"].lower()

    def test_annual_balance_insufficient(self, client):
        r = client.post(f"{API}/personnel/leaves/self", json={"type": "annual", "start_date": "2026-11-02", "end_date": "2026-12-15"})
        assert r.status_code == 400, r.text
        assert "Yetersiz yıllık izin bakiyesi" in r.json()["detail"]

    def test_end_before_start(self, client):
        r = client.post(f"{API}/personnel/leaves/self", json={"type": "unpaid", "start_date": "2026-10-20", "end_date": "2026-10-18"})
        assert r.status_code == 400, r.text

    def test_cancel_pending_and_not_found(self, client):
        me = client.get(f"{API}/personnel/leaves/me").json()
        lv = next(x for x in me["leaves"] if x.get("source") == "self" and x["status"] == "pending")
        assert client.delete(f"{API}/personnel/leaves/self/{lv['id']}").status_code == 200
        assert client.delete(f"{API}/personnel/leaves/self/{lv['id']}").status_code == 404
        me2 = client.get(f"{API}/personnel/leaves/me").json()
        assert all(x["id"] != lv["id"] for x in me2["leaves"])

    def test_cancel_approved_rejected(self, client):
        me = client.get(f"{API}/personnel/leaves/me").json()
        approved = [x for x in me["leaves"] if x.get("status") == "approved"]
        if not approved:
            pytest.skip("No approved leave for emp_03")
        r = client.delete(f"{API}/personnel/leaves/self/{approved[0]['id']}")
        assert r.status_code == 400 and "bekleyen" in r.json()["detail"].lower()

    def test_cancel_other_employee_leave_404(self, client):
        allr = client.get(f"{API}/personnel/leaves", params={"company_id": TEST_COMPANY_ID})
        assert allr.status_code == 200, allr.text
        data = allr.json()
        rows = data if isinstance(data, list) else (data.get("leaves") or data.get("rows") or [])
        other = [x for x in rows if x.get("employee_id") != EMP]
        if not other:
            pytest.skip("No other employee's leave")
        r = client.delete(f"{API}/personnel/leaves/self/{other[0]['id']}")
        assert r.status_code == 404, r.text


# ---------- B2B atomik sipariş numarası ----------
class TestB2BOrderNumber:
    created = []

    @pytest.fixture(scope="class", autouse=True)
    def _cleanup_orders(self, client):
        yield
        for oid in self.created:
            client.delete(f"{API}/orders/{oid}")

    def test_public_b2b_orders_unique_increment(self, client):
        token = resolve_b2b_token()
        cat = client.get(f"{API}/public/b2b/{token}")
        assert cat.status_code == 200, cat.text
        prods = cat.json().get("products") or cat.json().get("items") or []
        assert prods, cat.text[:300]
        p = prods[0]
        payload = {"items": [{"product_id": p.get("id"), "quantity": 1, "unit_price": p.get("price") or p.get("sale_price") or 100}],
                   "note": "TEST_it20", "shipping_address": "TEST adres", "city": "İstanbul"}
        nums = []
        for _ in range(2):
            r = client.post(f"{API}/public/b2b/{token}/orders", json=payload)
            assert r.status_code == 200, r.text
            d = r.json()
            order = d.get("order", d)
            oid = order.get("id") or d.get("order_id")
            num = order.get("order_number") or d.get("order_number")
            assert num and re.match(r"^B2B-\d{4}-\d{4}$", num), num
            nums.append(num)
            if oid:
                self.created.append(oid)
        assert nums[0] != nums[1], nums
        assert int(nums[1].rsplit("-", 1)[1]) == int(nums[0].rsplit("-", 1)[1]) + 1, nums

    def test_all_orders_numbers_unique(self, client):
        r = client.get(f"{API}/orders", params={"company_id": TEST_COMPANY_ID})
        assert r.status_code == 200
        data = r.json()
        rows = data if isinstance(data, list) else (data.get("orders") or data.get("rows") or [])
        nums = [o["order_number"] for o in rows if o.get("order_number")]
        dupes = {n for n in nums if nums.count(n) > 1}
        assert not dupes, f"Mükerrer sipariş numarası: {dupes}"

    def test_create_order_generates_number(self, client):
        r = client.post(f"{API}/orders", json={"company_id": TEST_COMPANY_ID, "order_number": "", "channel": "manual", "customer_name": "TEST_it20 Müşteri",
                                               "shipping_address": "TEST", "city": "İstanbul",
                                               "items": [{"product_id": "prod_01", "product_name": "TEST ürün", "sku": "NX-BT-PRO", "quantity": 1, "unit_price": 100, "total": 100, "vat_rate": 20}],
                                               "total_amount": 120})
        assert r.status_code in (200, 201), r.text
        o = r.json()
        o = o.get("order", o)
        assert o.get("order_number"), o
        assert re.match(r"^(ORD|B2B)-\d{4}-\d{4}$", o["order_number"]), o["order_number"]
        self.created.append(o["id"])
