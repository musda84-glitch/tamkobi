"""Purchased / saved plan must land on the shared parent license; drawer extend must not 500."""
import uuid

import requests

from conftest import API

ADMIN_EMAIL = "admin@nexus.com"
ADMIN_PASS = "admin123"


def _admin():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20)
    assert r.status_code == 200, r.text
    assert r.json()["user"].get("is_super_admin") is True
    return s


def _create_company(admin, plan_id, tag):
    suffix = uuid.uuid4().hex[:8]
    email = f"{tag}_{suffix}@lic.test"
    r = admin.post(
        f"{API}/system/companies",
        json={
            "name": f"LIC {tag} {suffix}",
            "admin_email": email,
            "admin_password": "lic-pass1",
            "admin_name": f"{tag} Yonetici",
            "plan_id": plan_id,
            "trial_days": 0,
            "city": "Istanbul",
        },
        timeout=20,
    )
    assert r.status_code == 200, r.text
    return r.json()


def _lic(admin, company_id):
    r = admin.get(f"{API}/system/companies/{company_id}", timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["license"]


class TestLicensePlanApply:
    def test_signup_keeps_chosen_plan(self):
        email = f"signup_{uuid.uuid4().hex[:8]}@lic.test"
        r = requests.post(
            f"{API}/public/signup",
            json={
                "company_name": f"Signup {uuid.uuid4().hex[:6]}",
                "name": "Paket Test",
                "email": email,
                "password": "abc12345",
                "plan_id": "plan_standard",
            },
            timeout=30,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["license"]["plan_id"] == "plan_standard"
        assert d["license"]["plan_name"] == "Standart"
        assert d["license"]["status"] == "trial"

    def test_drawer_save_on_sibling_updates_parent_plan(self):
        admin = _admin()
        parent = _create_company(admin, "plan_starter", "parent")
        pid = parent["id"]
        assert _lic(admin, pid)["plan_id"] == "plan_starter"

        r = admin.put(f"{API}/system/companies/{pid}/license", json={"company_limit": 3}, timeout=20)
        assert r.status_code == 200, r.text
        added = admin.post(
            f"{API}/system/companies/{pid}/companies",
            json={"name": f"Sube {uuid.uuid4().hex[:6]}", "city": "Ankara"},
            timeout=20,
        )
        assert added.status_code == 200, added.text
        sib = added.json()["id"]
        assert sib != pid

        saved = admin.put(
            f"{API}/system/companies/{sib}/license",
            json={"plan_id": "plan_pro", "status": "active", "billing_period": "yearly"},
            timeout=20,
        )
        assert saved.status_code == 200, saved.text
        body = saved.json()
        assert body["plan_id"] == "plan_pro"
        assert body["license_id"] == pid

        parent_lic = _lic(admin, pid)
        sib_lic = _lic(admin, sib)
        assert parent_lic["plan_id"] == "plan_pro"
        assert sib_lic["plan_id"] == "plan_pro"
        assert parent_lic["license_id"] == sib_lic["license_id"] == pid
        assert parent_lic["modules"].get("/personnel") is True
        assert sib_lic["modules"].get("/personnel") is True
        assert parent_lic["module_overrides"] == {}

    def test_upgrade_request_from_sibling_applies_to_parent(self):
        admin = _admin()
        parent = _create_company(admin, "plan_starter", "upg")
        pid = parent["id"]
        admin.put(f"{API}/system/companies/{pid}/license", json={"company_limit": 3}, timeout=20)
        sib = admin.post(
            f"{API}/system/companies/{pid}/companies",
            json={"name": f"Upg sube {uuid.uuid4().hex[:6]}"},
            timeout=20,
        ).json()["id"]

        req = admin.post(
            f"{API}/license/upgrade-request",
            json={"company_id": sib, "plan_id": "plan_standard", "message": "sibling buy"},
            timeout=20,
        )
        assert req.status_code == 200, req.text
        rid = req.json()["request"]["id"]
        appr = admin.put(f"{API}/system/upgrade-requests/{rid}", json={"status": "approved", "apply": True}, timeout=20)
        assert appr.status_code == 200, appr.text
        assert _lic(admin, pid)["plan_id"] == "plan_standard"
        assert _lic(admin, sib)["plan_id"] == "plan_standard"

    def test_extend_days_sets_expiry(self):
        admin = _admin()
        parent = _create_company(admin, "plan_standard", "ext")
        pid = parent["id"]
        r = admin.put(f"{API}/system/companies/{pid}/license", json={"extend_days": 30}, timeout=20)
        assert r.status_code == 200, r.text
        lic = r.json()
        assert lic["expires_at"]
        assert lic["days_left"] is not None
        assert 29 <= int(lic["days_left"]) <= 31
        again = admin.put(f"{API}/system/companies/{pid}/license", json={"extend_days": 7}, timeout=20)
        assert again.status_code == 200, again.text
        assert int(again.json()["days_left"]) >= int(lic["days_left"])

    def test_changing_plan_clears_overrides(self):
        admin = _admin()
        parent = _create_company(admin, "plan_starter", "ov")
        pid = parent["id"]
        tog = admin.post(f"{API}/system/companies/{pid}/modules/personnel", json={"enabled": True}, timeout=20)
        assert tog.status_code == 200, tog.text
        assert tog.json()["module_overrides"].get("/personnel") is True
        saved = admin.put(f"{API}/system/companies/{pid}/license", json={"plan_id": "plan_pro"}, timeout=20)
        assert saved.status_code == 200, saved.text
        assert saved.json()["plan_id"] == "plan_pro"
        assert saved.json()["module_overrides"] == {}
        assert saved.json()["modules"].get("/personnel") is True
