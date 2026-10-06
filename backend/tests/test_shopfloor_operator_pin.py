"""Shopfloor operator select requires employee PIN or linked user password + mesaim check-in."""
import uuid

from attendance import SHOPFLOOR_REQUIRE_CHECKIN_DETAIL
from conftest import API, TEST_COMPANY_ID

ADMIN_EMAIL = "admin@nexus.com"
ADMIN_PASS = "admin123"


def _admin():
    import requests
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20)
    assert r.status_code == 200, r.text
    return s


def _ensure_check_in(s, employee_id: str):
    r = s.post(f"{API}/personnel/attendance", json={
        "employee_id": employee_id, "action": "check_in",
    }, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()


class TestShopfloorOperatorPin:
    def test_list_employees_does_not_leak_hash(self):
        s = _admin()
        r = s.get(f"{API}/personnel/employees", params={"company_id": TEST_COMPANY_ID}, timeout=20)
        assert r.status_code == 200, r.text
        ahmet = next(e for e in r.json() if e.get("full_name") == "Ahmet Yılmaz")
        assert "shopfloor_pin_hash" not in ahmet
        assert ahmet.get("has_shopfloor_pin") is True
        for e in r.json():
            assert "has_user" in e
            assert e["has_user"] is True or e["has_user"] is False
        # Demo seed: PIN var, create-user yok
        assert ahmet.get("has_user") is False

    def test_wrong_pin_rejected(self):
        s = _admin()
        r = s.post(f"{API}/production/work-orders/shopfloor-unlock", json={
            "company_id": TEST_COMPANY_ID, "employee_id": "emp_01", "password": "wrong-pin",
        }, timeout=20)
        assert r.status_code == 401, r.text

    def test_unlock_without_check_in_forbidden(self):
        s = _admin()
        # emp_03: clear today's attendance if any, then unlock should 403
        emps = s.get(f"{API}/personnel/employees", params={"company_id": TEST_COMPANY_ID}, timeout=20).json()
        emp = next(e for e in emps if e.get("full_name") == "Emre Çetin")
        # Ensure PIN exists
        s.post(f"{API}/personnel/employees/{emp['id']}/shopfloor-pin", json={"password": "1234"}, timeout=20)
        # Wipe today check-in via upsert without check_in (leave)
        from datetime import datetime, timezone
        # Use a fresh employee snapshot: punch leave for today to clear? Better: pick day with no record.
        # Manager upsert with status leave clears punches in apply_day when leave.
        me = s.get(f"{API}/personnel/attendance", params={"company_id": TEST_COMPANY_ID}, timeout=20)
        assert me.status_code == 200
        # Force absent/no check_in for today
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        s.post(f"{API}/personnel/attendance", json={
            "employee_id": emp["id"], "date": today, "status": "leave", "check_in": None, "check_out": None,
        }, timeout=20)
        r = s.post(f"{API}/production/work-orders/shopfloor-unlock", json={
            "company_id": TEST_COMPANY_ID, "employee_id": emp["id"], "password": "1234",
        }, timeout=20)
        assert r.status_code == 403, r.text
        assert SHOPFLOOR_REQUIRE_CHECKIN_DETAIL in (r.json().get("detail") or "")

    def test_demo_pin_unlocks_after_check_in(self):
        s = _admin()
        pin_r = s.post(f"{API}/personnel/employees/emp_01/shopfloor-pin", json={"password": "1234"}, timeout=20)
        assert pin_r.status_code == 200, pin_r.text
        _ensure_check_in(s, "emp_01")
        r = s.post(f"{API}/production/work-orders/shopfloor-unlock", json={
            "company_id": TEST_COMPANY_ID, "employee_id": "emp_01", "password": "1234",
        }, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["operator_name"] == "Ahmet Yılmaz"

    def test_set_pin_and_unlock(self):
        s = _admin()
        emps = s.get(f"{API}/personnel/employees", params={"company_id": TEST_COMPANY_ID}, timeout=20).json()
        emp = next(e for e in emps if e.get("full_name") == "Emre Çetin")
        pin = f"p{uuid.uuid4().hex[:6]}"
        r = s.post(f"{API}/personnel/employees/{emp['id']}/shopfloor-pin", json={"password": pin}, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["has_shopfloor_pin"] is True
        _ensure_check_in(s, emp["id"])
        ok = s.post(f"{API}/production/work-orders/shopfloor-unlock", json={
            "company_id": TEST_COMPANY_ID, "employee_id": emp["id"], "password": pin,
        }, timeout=20)
        assert ok.status_code == 200, ok.text
        assert ok.json()["operator_name"] == "Emre Çetin"
        # restore demo pin so other tests stay stable
        s.post(f"{API}/personnel/employees/{emp['id']}/shopfloor-pin", json={"password": "1234"}, timeout=20)

    def test_missing_pin_too_short(self):
        s = _admin()
        r = s.post(f"{API}/personnel/employees/emp_01/shopfloor-pin", json={"password": "12"}, timeout=20)
        assert r.status_code == 400

    def test_unlock_without_password(self):
        s = _admin()
        r = s.post(f"{API}/production/work-orders/shopfloor-unlock", json={
            "company_id": TEST_COMPANY_ID, "employee_id": "emp_01",
        }, timeout=20)
        assert r.status_code == 400
