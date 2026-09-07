"""Shopfloor operator select requires employee PIN or linked user password."""
import uuid

from conftest import API, TEST_COMPANY_ID

ADMIN_EMAIL = "admin@nexus.com"
ADMIN_PASS = "admin123"


def _admin():
    import requests
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20)
    assert r.status_code == 200, r.text
    return s


class TestShopfloorOperatorPin:
    def test_list_employees_does_not_leak_hash(self):
        s = _admin()
        r = s.get(f"{API}/personnel/employees", params={"company_id": TEST_COMPANY_ID}, timeout=20)
        assert r.status_code == 200, r.text
        ahmet = next(e for e in r.json() if e.get("full_name") == "Ahmet Yılmaz")
        assert "shopfloor_pin_hash" not in ahmet
        assert ahmet.get("has_shopfloor_pin") is True

    def test_wrong_pin_rejected(self):
        s = _admin()
        r = s.post(f"{API}/production/work-orders/shopfloor-unlock", json={
            "company_id": TEST_COMPANY_ID, "employee_id": "emp_01", "password": "wrong-pin",
        }, timeout=20)
        assert r.status_code == 401, r.text

    def test_demo_pin_unlocks(self):
        s = _admin()
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
