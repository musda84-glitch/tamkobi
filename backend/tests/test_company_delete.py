"""Company delete + Aktif/Pasif activation for platform super-admin."""
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


def _create_company(s, **extra):
    email = f"del_{uuid.uuid4().hex[:8]}@nexus.test"
    payload = {
        "name": f"Silinecek {uuid.uuid4().hex[:6]}",
        "admin_email": email,
        "admin_password": "test1234",
        "plan_id": "plan_standard",
        "trial_days": 14,
        **extra,
    }
    r = s.post(f"{API}/system/companies", json=payload, timeout=20)
    assert r.status_code == 200, r.text
    body = r.json()
    return body["id"], email, body["name"]


class TestCompanyActivationAndDelete:
    def test_requires_auth(self):
        r = requests.delete(f"{API}/system/companies/comp_does_not_exist", timeout=20)
        assert r.status_code == 401

    def test_protects_seed_companies(self):
        s = _admin()
        for cid in ("comp_nexus_main_01", "comp_nexus_b2b_02"):
            r = s.delete(f"{API}/system/companies/{cid}", timeout=20)
            assert r.status_code == 400, r.text
            assert "silinemez" in r.json()["detail"].lower()
            r = s.get(f"{API}/system/companies/{cid}", timeout=20)
            assert r.status_code == 200, r.text
            assert r.json().get("protected") is True

    def test_activate_suspend_and_delete(self):
        s = _admin()
        cid, email, name = _create_company(s)
        r = s.post(f"{API}/contacts", json={"company_id": cid, "name": "Silinecek Cari", "type": "customer", "tax_number_or_id": "1111111111"}, timeout=20)
        assert r.status_code in (200, 201), r.text

        r = s.post(f"{API}/system/companies/{cid}/activation", json={"active": False}, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "suspended"
        assert r.json()["locked"] is True
        blocked = s.get(f"{API}/invoices", params={"company_id": cid}, timeout=20)
        assert blocked.status_code == 403

        r = s.post(f"{API}/system/companies/{cid}/activation", json={"active": True}, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "trial"
        assert r.json()["locked"] is False
        ok = s.get(f"{API}/invoices", params={"company_id": cid}, timeout=20)
        assert ok.status_code == 200

        r = s.delete(f"{API}/system/companies/{cid}", timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "success"
        assert r.json()["users"]["deleted"] >= 1

        gone = s.get(f"{API}/system/companies/{cid}", timeout=20)
        assert gone.status_code == 404
        listed = s.get(f"{API}/system/companies", timeout=20)
        assert listed.status_code == 200
        assert all(row.get("id") != cid for row in listed.json())

        contacts = s.get(f"{API}/contacts", params={"company_id": cid}, timeout=20)
        assert contacts.status_code == 200
        assert contacts.json() == [] or all((c.get("company_id") != cid) for c in contacts.json())

        login = requests.post(f"{API}/auth/login", json={"email": email, "password": "test1234"}, timeout=20)
        assert login.status_code in (401, 403)

        again = s.delete(f"{API}/system/companies/{cid}", timeout=20)
        assert again.status_code == 404

    def test_missing_company_404(self):
        s = _admin()
        r = s.delete(f"{API}/system/companies/comp_no_such_99", timeout=20)
        assert r.status_code == 404
        r = s.post(f"{API}/system/companies/comp_no_such_99/activation", json={"active": False}, timeout=20)
        assert r.status_code == 404
