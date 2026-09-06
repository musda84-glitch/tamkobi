"""Platform super-admin user CRUD: GET/POST/PUT/DELETE /api/system/users."""
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

    def test_list_create_update_delete(self):
        s = _admin()
        r = s.get(f"{API}/system/users", timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "users" in body and "companies" in body and "roles" in body
        assert any(u["email"] == ADMIN_EMAIL for u in body["users"])
        cid = (body["companies"][0]["id"] if body["companies"] else None)
        email = f"pu_{uuid.uuid4().hex[:8]}@nexus.test"
        r = s.post(
            f"{API}/system/users",
            json={"name": "Platform Test", "email": email, "password": "testpass1", "role": "sales", "company_ids": [cid] if cid else [], "is_super_admin": not cid},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        uid = r.json()["id"]
        assert r.json()["email"] == email
        r = s.put(f"{API}/system/users/{uid}", json={"name": "Platform Test 2", "is_active": False}, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["name"] == "Platform Test 2"
        assert r.json()["is_active"] is False
        r = s.put(f"{API}/system/users/{uid}", json={"password": "newpass1"}, timeout=20)
        assert r.status_code == 200, r.text
        login = requests.post(f"{API}/auth/login", json={"email": email, "password": "newpass1"}, timeout=20)
        assert login.status_code == 200, login.text
        r = s.delete(f"{API}/system/users/{uid}", timeout=20)
        assert r.status_code == 200, r.text
        r = s.delete(f"{API}/system/users/{uid}", timeout=20)
        assert r.status_code == 404

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
