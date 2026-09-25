"""Tenant isolation: company accounts cannot see each other; a license can open extra companies up to plan limit."""
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


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, r.text
    return s, r.json()


def _create_customer(admin, plan_id, tag):
    suffix = uuid.uuid4().hex[:8]
    email = f"{tag}_{suffix}@iso.test"
    password = "iso-pass1"
    r = admin.post(
        f"{API}/system/companies",
        json={
            "name": f"ISO {tag} {suffix}",
            "admin_email": email,
            "admin_password": password,
            "admin_name": f"{tag} Yonetici",
            "plan_id": plan_id,
            "trial_days": 0,
            "city": "Istanbul",
            "tax_number": suffix,
        },
        timeout=20,
    )
    assert r.status_code == 200, r.text
    return r.json(), email, password


def _ids(companies):
    return {c.get("id") or c.get("_id") for c in companies or []}


class TestCompanyIsolation:
    def test_tenants_cannot_see_or_switch_to_each_other(self):
        admin = _admin()
        listed = admin.get(f"{API}/system/companies", timeout=20)
        assert listed.status_code == 200, listed.text
        assert _ids(listed.json()), "platform must still list all customer companies"

        a, a_email, a_pass = _create_customer(admin, "plan_starter", "alpha")
        b, b_email, b_pass = _create_customer(admin, "plan_starter", "beta")
        a_id, b_id = a["id"], b["id"]

        listed2 = admin.get(f"{API}/system/companies", timeout=20)
        assert listed2.status_code == 200
        all_ids = _ids(listed2.json())
        assert a_id in all_ids and b_id in all_ids

        sa, _login_a = _login(a_email, a_pass)
        me = sa.get(f"{API}/auth/me", timeout=20)
        assert me.status_code == 200, me.text
        assert _ids(me.json().get("companies")) == {a_id}

        sw = sa.post(f"{API}/auth/switch-company", json={"company_id": b_id}, timeout=20)
        assert sw.status_code == 403, sw.text

        leaked = sa.get(f"{API}/contacts", params={"company_id": b_id}, timeout=20)
        assert leaked.status_code == 403, leaked.text

        own = sa.get(f"{API}/contacts", timeout=20)
        assert own.status_code == 200, own.text
        for row in own.json():
            assert row.get("company_id") == a_id

        lic_b = sa.get(f"{API}/license/me", params={"company_id": b_id}, timeout=20)
        assert lic_b.status_code == 403, lic_b.text

        r = admin.put(f"{API}/system/companies/{a_id}/license", json={"company_limit": 1}, timeout=20)
        assert r.status_code == 200, r.text
        blocked = sa.post(
            f"{API}/license/companies",
            json={"company_id": a_id, "name": f"ISO extra {uuid.uuid4().hex[:6]}"},
            timeout=20,
        )
        assert blocked.status_code == 403, blocked.text

        r = admin.put(f"{API}/system/companies/{a_id}/license", json={"company_limit": 2}, timeout=20)
        assert r.status_code == 200, r.text

        extra_name = f"ISO sibling {uuid.uuid4().hex[:6]}"
        added = sa.post(
            f"{API}/license/companies",
            json={"company_id": a_id, "name": extra_name, "tax_number": "111", "city": "Ankara"},
            timeout=20,
        )
        assert added.status_code == 200, added.text
        extra_id = added.json()["id"]
        assert extra_id != a_id
        assert added.json().get("license_id") == a_id
        assert added.json().get("parent_company_id") == a_id

        me2 = sa.get(f"{API}/auth/me", timeout=20)
        assert me2.status_code == 200, me2.text
        assert _ids(me2.json().get("companies")) == {a_id, extra_id}

        sw_ok = sa.post(f"{API}/auth/switch-company", json={"company_id": extra_id}, timeout=20)
        assert sw_ok.status_code == 200, sw_ok.text

        sb, _ = _login(b_email, b_pass)
        me_b = sb.get(f"{API}/auth/me", timeout=20)
        assert me_b.status_code == 200, me_b.text
        b_mine = _ids(me_b.json().get("companies"))
        assert b_mine == {b_id}

        still_all = admin.get(f"{API}/system/companies", timeout=20)
        assert still_all.status_code == 200
        final_ids = _ids(still_all.json())
        assert a_id in final_ids and b_id in final_ids and extra_id in final_ids
        row_a = next(r for r in still_all.json() if r["id"] == a_id)
        row_extra = next(r for r in still_all.json() if r["id"] == extra_id)
        sib_ids = {c["id"] for c in row_a.get("license_companies") or []}
        assert a_id in sib_ids and extra_id in sib_ids
        assert b_id not in sib_ids
        assert row_a.get("is_primary") is True
        assert not row_a.get("parent_company_id")
        assert row_extra.get("parent_company_id") == a_id
        assert row_extra.get("parent_company_name") == a["name"]
        assert row_extra.get("is_primary") is False
        extra_brief = next(c for c in row_a["license_companies"] if c["id"] == extra_id)
        assert extra_brief.get("parent_company_id") == a_id
        assert extra_brief.get("parent_company_name") == a["name"]

        cycle = admin.put(f"{API}/system/companies/{a_id}/parent", json={"parent_company_id": extra_id}, timeout=20)
        assert cycle.status_code == 400, cycle.text

        r = admin.put(f"{API}/system/companies/{a_id}/license", json={"company_limit": 3}, timeout=20)
        assert r.status_code == 200, r.text
        gamma, _, _ = _create_customer(admin, "plan_starter", "gamma")
        g_id = gamma["id"]
        attached = admin.put(f"{API}/system/companies/{g_id}/parent", json={"parent_company_id": a_id}, timeout=20)
        assert attached.status_code == 200, attached.text
        assert attached.json().get("parent_company_id") == a_id
        assert attached.json().get("license_id") == a_id
        assert attached.json().get("parent_company_name") == a["name"]

    def test_separate_login_sibling_stays_isolated(self):
        """New legal company with admin_email/password gets its own login; creator keeps only parent."""
        admin = _admin()
        parent, parent_email, parent_pass = _create_customer(admin, "plan_starter", "seplog")
        parent_id = parent["id"]

        r = admin.put(f"{API}/system/companies/{parent_id}/license", json={"company_limit": 3}, timeout=20)
        assert r.status_code == 200, r.text

        sa, _ = _login(parent_email, parent_pass)
        me0 = sa.get(f"{API}/auth/me", timeout=20)
        assert me0.status_code == 200, me0.text
        assert _ids(me0.json().get("companies")) == {parent_id}

        sib_email = f"sib_{uuid.uuid4().hex[:8]}@iso.test"
        sib_pass = "sib-pass1"
        added = sa.post(
            f"{API}/license/companies",
            json={
                "company_id": parent_id,
                "name": f"ISO separate {uuid.uuid4().hex[:6]}",
                "tax_number": "222",
                "city": "Izmir",
                "admin_name": "Kardes Yonetici",
                "admin_email": sib_email,
                "admin_password": sib_pass,
                "separate_login": True,
            },
            timeout=20,
        )
        assert added.status_code == 200, added.text
        body = added.json()
        sib_id = body["id"]
        assert body.get("separate_login") is True
        assert body.get("admin_email") == sib_email
        assert sib_id != parent_id
        assert body.get("parent_company_id") == parent_id
        assert body.get("license_id") == parent_id

        # Creator must NOT gain access / must not be switched onto the new company
        me1 = sa.get(f"{API}/auth/me", timeout=20)
        assert me1.status_code == 200, me1.text
        assert _ids(me1.json().get("companies")) == {parent_id}
        assert me1.json().get("user", {}).get("active_company_id") == parent_id

        sw = sa.post(f"{API}/auth/switch-company", json={"company_id": sib_id}, timeout=20)
        assert sw.status_code == 403, sw.text

        leaked = sa.get(f"{API}/contacts", params={"company_id": sib_id}, timeout=20)
        assert leaked.status_code == 403, leaked.text

        # New admin logs in only to the sibling company
        sb, _ = _login(sib_email, sib_pass)
        me_sib = sb.get(f"{API}/auth/me", timeout=20)
        assert me_sib.status_code == 200, me_sib.text
        assert _ids(me_sib.json().get("companies")) == {sib_id}
        assert me_sib.json().get("user", {}).get("active_company_id") == sib_id

        sw_back = sb.post(f"{API}/auth/switch-company", json={"company_id": parent_id}, timeout=20)
        assert sw_back.status_code == 403, sw_back.text

        parent_leak = sb.get(f"{API}/contacts", params={"company_id": parent_id}, timeout=20)
        assert parent_leak.status_code == 403, parent_leak.text

        # Missing credentials when separate_login forced
        bad = sa.post(
            f"{API}/license/companies",
            json={"company_id": parent_id, "name": "No creds", "separate_login": True},
            timeout=20,
        )
        assert bad.status_code == 400, bad.text

        # Duplicate email rejected
        dup = sa.post(
            f"{API}/license/companies",
            json={
                "company_id": parent_id,
                "name": "Dup email co",
                "admin_email": sib_email,
                "admin_password": "another1",
                "separate_login": True,
            },
            timeout=20,
        )
        assert dup.status_code == 400, dup.text
