"""Platform / auth: POST /api/auth/change-password."""
import os
import uuid

import pytest
import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "http://127.0.0.1:8000").rstrip("/")
API = BASE_URL + "/api"


class TestChangePassword:
    def test_requires_auth(self):
        r = requests.post(
            f"{API}/auth/change-password",
            json={"current_password": "x", "new_password": "newpass1"},
            timeout=20,
        )
        assert r.status_code == 401

    def test_own_account_roundtrip(self):
        email = f"chg_{uuid.uuid4().hex[:8]}@nexus.test"
        r = requests.post(
            f"{API}/auth/register",
            json={"name": "Chg User", "email": email, "password": "oldpass1", "company_name": "Chg Co"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        token = r.json().get("token") or r.json().get("access_token")
        assert token
        h = {"Authorization": f"Bearer {token}"}
        r = requests.post(
            f"{API}/auth/change-password",
            json={"current_password": "oldpass1", "new_password": "short"},
            headers=h,
            timeout=20,
        )
        assert r.status_code == 400
        r = requests.post(
            f"{API}/auth/change-password",
            json={"current_password": "oldpass1", "new_password": "oldpass1"},
            headers=h,
            timeout=20,
        )
        assert r.status_code == 400
        r = requests.post(
            f"{API}/auth/change-password",
            json={"current_password": "wrong-current", "new_password": "newpass1"},
            headers=h,
            timeout=20,
        )
        assert r.status_code == 400
        r = requests.post(
            f"{API}/auth/change-password",
            json={"current_password": "oldpass1", "new_password": "newpass1"},
            headers=h,
            timeout=20,
        )
        assert r.status_code == 200, r.text
        assert requests.post(f"{API}/auth/login", json={"email": email, "password": "oldpass1"}, timeout=20).status_code == 401
        r2 = requests.post(f"{API}/auth/login", json={"email": email, "password": "newpass1"}, timeout=20)
        assert r2.status_code == 200, r2.text
