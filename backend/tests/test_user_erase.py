"""Sistem paneli kullanıcı veri silme: /api/system/tenant-users ve erase uçları."""
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


def _create_company(s):
    email = f"erase_{uuid.uuid4().hex[:8]}@tenant.test"
    r = s.post(
        f"{API}/system/companies",
        json={
            "name": f"Erase Co {uuid.uuid4().hex[:6]}",
            "admin_email": email,
            "admin_password": "tenant123",
            "admin_name": "Erase Admin",
            "plan_id": "plan_standard",
            "trial_days": 0,
        },
        timeout=30,
    )
    assert r.status_code == 200, r.text
    cid = r.json()["id"]
    found = s.get(f"{API}/system/tenant-users", params={"q": email.split("@")[0]}, timeout=20)
    assert found.status_code == 200, found.text
    user = next(u for u in found.json()["users"] if u["email"] == email)
    return cid, user, email, found.json()["confirm_phrase"]


def _add_staff(admin_email, company_id):
    email = f"staff_{uuid.uuid4().hex[:8]}@tenant.test"
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": admin_email, "password": "tenant123"}, timeout=20)
    assert r.status_code == 200, r.text
    r = s.post(
        f"{API}/users",
        json={"name": "Staff User", "email": email, "password": "staff123", "role": "sales", "company_id": company_id},
        params={"company_id": company_id},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    uid = body.get("id") or body.get("_id")
    return uid, email


class TestUserErase:
    def test_requires_auth(self):
        r = requests.get(f"{API}/system/tenant-users", params={"q": "ab"}, timeout=20)
        assert r.status_code == 401

    def test_search_preview_and_last_admin_block(self):
        s = _admin()
        cid, user, email, phrase = _create_company(s)
        assert phrase
        assert user["can_erase"] is False
        assert user["block_reasons"]

        prev = s.get(f"{API}/system/users/{user['id']}/erase-preview", timeout=20)
        assert prev.status_code == 200, prev.text
        assert prev.json()["email"] == email
        assert prev.json()["can_erase"] is False
        assert prev.json()["confirm_phrase"] == phrase

        bad = s.post(
            f"{API}/system/users/{user['id']}/erase",
            json={"confirm_email": "wrong@x.com", "confirm_phrase": phrase, "admin_password": ADMIN_PASS},
            timeout=20,
        )
        assert bad.status_code == 400

        bad = s.post(
            f"{API}/system/users/{user['id']}/erase",
            json={"confirm_email": email, "confirm_phrase": "YANLIS", "admin_password": ADMIN_PASS},
            timeout=20,
        )
        assert bad.status_code == 400

        bad = s.post(
            f"{API}/system/users/{user['id']}/erase",
            json={"confirm_email": email, "confirm_phrase": phrase, "admin_password": "bad-password"},
            timeout=20,
        )
        assert bad.status_code in (400, 403)

        blocked = s.post(
            f"{API}/system/users/{user['id']}/erase",
            json={"confirm_email": email, "confirm_phrase": phrase, "admin_password": ADMIN_PASS},
            timeout=20,
        )
        assert blocked.status_code == 400
        assert "yönetici" in blocked.json()["detail"].lower()

    def test_erase_staff_user_with_password_and_phrase(self):
        s = _admin()
        cid, admin_user, admin_email, phrase = _create_company(s)
        staff_id, staff_email = _add_staff(admin_email, cid)
        if not staff_id:
            # resolve via search
            listed = s.get(f"{API}/system/tenant-users", params={"q": staff_email.split("@")[0]}, timeout=20).json()["users"]
            staff = next(u for u in listed if u["email"] == staff_email)
            staff_id = staff["id"]

        listed = s.get(f"{API}/system/tenant-users", params={"q": staff_email.split("@")[0]}, timeout=20)
        assert listed.status_code == 200, listed.text
        phrase = listed.json()["confirm_phrase"]
        found = next(u for u in listed.json()["users"] if u["email"] == staff_email)
        assert found["can_erase"] is True

        prev = s.get(f"{API}/system/users/{staff_id}/erase-preview", timeout=20)
        assert prev.status_code == 200, prev.text
        assert prev.json()["can_erase"] is True

        erased = s.post(
            f"{API}/system/users/{staff_id}/erase",
            json={"confirm_email": staff_email, "confirm_phrase": phrase, "admin_password": ADMIN_PASS},
            timeout=20,
        )
        assert erased.status_code == 200, erased.text
        assert erased.json()["deleted"]["user"] == 1

        listed = s.get(f"{API}/system/tenant-users", params={"q": staff_email.split("@")[0]}, timeout=20).json()["users"]
        assert all(u["email"] != staff_email for u in listed)
        assert s.get(f"{API}/system/users/{staff_id}/erase-preview", timeout=20).status_code == 404

        # company admin still searchable
        admins = s.get(f"{API}/system/tenant-users", params={"q": admin_email.split("@")[0]}, timeout=20).json()["users"]
        assert any(u["email"] == admin_email for u in admins)
