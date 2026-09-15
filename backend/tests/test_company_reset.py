"""Şirket iş verisi sıfırlama: /api/system/companies/{id}/reset-preview|reset-data."""
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
    email = f"reset_{uuid.uuid4().hex[:8]}@tenant.test"
    name = f"Reset Co {uuid.uuid4().hex[:6]}"
    r = s.post(
        f"{API}/system/companies",
        json={
            "name": name,
            "admin_email": email,
            "admin_password": "tenant123",
            "admin_name": "Reset Admin",
            "plan_id": "plan_standard",
            "trial_days": 0,
        },
        timeout=30,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    return body["id"], name, email


class TestCompanyDataReset:
    def test_requires_auth(self):
        r = requests.get(f"{API}/system/companies/comp_x/reset-preview", timeout=20)
        assert r.status_code == 401

    def test_preview_and_reset_keeps_users_and_license(self):
        s = _admin()
        cid, name, email = _create_company(s)

        prev = s.get(f"{API}/system/companies/{cid}/reset-preview", timeout=20)
        assert prev.status_code == 200, prev.text
        body = prev.json()
        assert body["id"] == cid
        assert body["name"] == name
        assert body["confirm_phrase"] == "VERİLERİ SIFIRLA"
        assert body["total_docs"] > 0
        highlight = {h["key"]: h["count"] for h in body["highlight"]}
        assert highlight.get("invoices", 0) >= 1 or highlight.get("products", 0) >= 1
        assert body["kept"]["company"] == 1
        assert body["kept"]["license"] == 1

        bad = s.post(
            f"{API}/system/companies/{cid}/reset-data",
            json={"confirm_name": "YANLIS", "confirm_phrase": body["confirm_phrase"], "admin_password": ADMIN_PASS},
            timeout=30,
        )
        assert bad.status_code == 400

        bad = s.post(
            f"{API}/system/companies/{cid}/reset-data",
            json={"confirm_name": name, "confirm_phrase": "YANLIS", "admin_password": ADMIN_PASS},
            timeout=30,
        )
        assert bad.status_code == 400

        bad = s.post(
            f"{API}/system/companies/{cid}/reset-data",
            json={"confirm_name": name, "confirm_phrase": body["confirm_phrase"], "admin_password": "wrong-pass"},
            timeout=30,
        )
        assert bad.status_code in (400, 403)

        ok = s.post(
            f"{API}/system/companies/{cid}/reset-data",
            json={"confirm_name": name, "confirm_phrase": body["confirm_phrase"], "admin_password": ADMIN_PASS},
            timeout=60,
        )
        assert ok.status_code == 200, ok.text
        result = ok.json()
        assert result["status"] == "success"
        assert result["total_deleted"] >= 1
        assert result["after_total"] == 0

        # Company + license still exist
        company = s.get(f"{API}/system/companies/{cid}", timeout=20)
        assert company.status_code == 200, company.text
        assert company.json()["name"] == name
        assert company.json()["license"]["plan_id"]
        assert company.json()["usage"]["invoices"] == 0
        assert company.json()["usage"]["products"] == 0
        assert company.json()["usage"]["orders"] == 0

        # Tenant admin still searchable
        users = s.get(f"{API}/system/tenant-users", params={"q": email.split("@")[0]}, timeout=20)
        assert users.status_code == 200, users.text
        assert any(u["email"] == email for u in users.json()["users"])

        # Business collections empty
        after = s.get(f"{API}/system/companies/{cid}/reset-preview", timeout=20)
        assert after.status_code == 200, after.text
        assert after.json()["total_docs"] == 0

    def test_missing_company_404(self):
        s = _admin()
        r = s.get(f"{API}/system/companies/comp_no_such_reset/reset-preview", timeout=20)
        assert r.status_code == 404

    def test_selective_scopes_invoices_only(self):
        s = _admin()
        cid, name, _email = _create_company(s)

        prev = s.get(
            f"{API}/system/companies/{cid}/reset-preview",
            params={"scopes": "invoices"},
            timeout=20,
        )
        assert prev.status_code == 200, prev.text
        body = prev.json()
        assert body["scopes"] == ["invoices"]
        assert any(c["key"] == "invoices" for c in body["available_scopes"])
        assert body["by_collection"].get("products", 0) == 0
        inv_before = int(body["by_collection"].get("invoices") or 0)
        assert inv_before >= 1

        full = s.get(f"{API}/system/companies/{cid}/reset-preview", timeout=20)
        assert full.status_code == 200, full.text
        products_before = int(full.json()["by_collection"].get("products") or 0)
        orders_before = int(full.json()["by_collection"].get("orders") or 0)
        assert products_before >= 1

        ok = s.post(
            f"{API}/system/companies/{cid}/reset-data",
            json={
                "confirm_name": name,
                "confirm_phrase": "VERİLERİ SIFIRLA",
                "admin_password": ADMIN_PASS,
                "scopes": ["invoices"],
            },
            timeout=60,
        )
        assert ok.status_code == 200, ok.text
        result = ok.json()
        assert result["scopes"] == ["invoices"]
        assert result["total_deleted"] >= 1
        assert "invoices" in result["deleted"]
        assert "products" not in result["deleted"]

        after = s.get(f"{API}/system/companies/{cid}/reset-preview", timeout=20)
        assert after.status_code == 200, after.text
        after_body = after.json()
        assert int(after_body["by_collection"].get("invoices") or 0) == 0
        assert int(after_body["by_collection"].get("products") or 0) == products_before
        assert int(after_body["by_collection"].get("orders") or 0) == orders_before

        company = s.get(f"{API}/system/companies/{cid}", timeout=20)
        assert company.status_code == 200, company.text
        assert company.json()["usage"]["invoices"] == 0
        assert company.json()["usage"]["products"] == products_before

    def test_invalid_scope_rejected(self):
        s = _admin()
        cid, name, _email = _create_company(s)
        bad = s.post(
            f"{API}/system/companies/{cid}/reset-data",
            json={
                "confirm_name": name,
                "confirm_phrase": "VERİLERİ SIFIRLA",
                "admin_password": ADMIN_PASS,
                "scopes": ["not-a-scope"],
            },
            timeout=30,
        )
        assert bad.status_code == 400
