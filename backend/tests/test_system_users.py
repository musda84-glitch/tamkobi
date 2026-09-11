"""Platform staff vs company users: GET/POST/PUT/DELETE /api/system/users."""
import os
import uuid

import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "http://127.0.0.1:8000").rstrip("/")
API = BASE_URL + "/api"
ADMIN_EMAIL = "admin@nexus.com"
ADMIN_PASS = "admin123"


def _admin():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20)
    assert r.status_code == 200, r.text
    assert r.json()["user"].get("is_super_admin") is True
    return s


class TestSystemUsers:
    def test_requires_auth(self):
        r = requests.get(f"{API}/system/users", timeout=20)
        assert r.status_code == 401

    def test_list_is_platform_staff_only(self):
        s = _admin()
        r = s.get(f"{API}/system/users", timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "users" in body
        assert body["users"], "seed super admin must appear"
        assert all(u.get("is_super_admin") is True for u in body["users"])
        assert any(u["email"] == ADMIN_EMAIL for u in body["users"])
        tenant = s.get(f"{API}/users", params={"company_id": "comp_nexus_main_01"}, timeout=20)
        assert tenant.status_code == 200, tenant.text
        emails = [u["email"] for u in tenant.json()["users"]]
        assert ADMIN_EMAIL not in emails

    def test_list_create_update_delete(self):
        s = _admin()
        r = s.get(f"{API}/system/users", timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "users" in body and "companies" in body and "roles" in body
        assert any(u["email"] == ADMIN_EMAIL for u in body["users"])
        email = f"pu_{uuid.uuid4().hex[:8]}@nexus.test"
        r = s.post(
            f"{API}/system/users",
            json={"name": "Platform Test", "email": email, "password": "testpass1", "role": "sales", "company_ids": ["comp_nexus_main_01"], "is_super_admin": False},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        created = r.json()
        uid = created["id"]
        assert created["email"] == email
        assert created.get("is_super_admin") is True
        assert created.get("company_ids") == []
        listed = s.get(f"{API}/system/users", timeout=20).json()["users"]
        assert any(u["id"] == uid for u in listed)
        tenant = s.get(f"{API}/users", params={"company_id": "comp_nexus_main_01"}, timeout=20).json()["users"]
        assert email not in [u["email"] for u in tenant]
        r = s.put(f"{API}/system/users/{uid}", json={"password": "newpass1"}, timeout=20)
        assert r.status_code == 200, r.text
        login = requests.post(f"{API}/auth/login", json={"email": email, "password": "newpass1"}, timeout=20)
        assert login.status_code == 200, login.text
        assert login.json()["user"].get("is_super_admin") is True
        r = s.put(f"{API}/system/users/{uid}", json={"name": "Platform Test 2", "is_active": False}, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["name"] == "Platform Test 2"
        assert r.json()["is_active"] is False
        blocked = requests.post(f"{API}/auth/login", json={"email": email, "password": "newpass1"}, timeout=20)
        assert blocked.status_code == 403
        r = s.delete(f"{API}/system/users/{uid}", timeout=20)
        assert r.status_code == 200, r.text
        r = s.delete(f"{API}/system/users/{uid}", timeout=20)
        assert r.status_code == 404

    def test_tenant_company_admin_not_on_staff_list(self):
        s = _admin()
        email = f"co_{uuid.uuid4().hex[:8]}@tenant.test"
        r = s.post(
            f"{API}/system/companies",
            json={"name": "Staff Split Co", "admin_email": email, "admin_password": "tenant1", "admin_name": "Tenant Admin", "plan_id": "plan_standard", "trial_days": 0},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        cid = r.json()["id"]
        staff = s.get(f"{API}/system/users", timeout=20).json()["users"]
        assert email not in [u["email"] for u in staff]
        co = s.get(f"{API}/system/companies/{cid}", timeout=20)
        assert co.status_code == 200, co.text
        co_emails = [u["email"] for u in co.json()["users"]]
        assert email in co_emails
        assert ADMIN_EMAIL not in co_emails

    def test_protects_seed_admin(self):
        s = _admin()
        r = s.get(f"{API}/system/users", timeout=20)
        assert r.status_code == 200, r.text
        admin = next(u for u in r.json()["users"] if u["email"] == ADMIN_EMAIL)
        r = s.delete(f"{API}/system/users/{admin['id']}", timeout=20)
        assert r.status_code == 400
        assert "silinemez" in r.json()["detail"].lower()
        r = s.put(f"{API}/system/users/{admin['id']}", json={"is_super_admin": False}, timeout=20)
        assert r.status_code == 400
        r = s.put(f"{API}/system/users/{admin['id']}", json={"is_active": False}, timeout=20)
        assert r.status_code == 400
