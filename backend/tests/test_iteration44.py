"""Customers can pick modules one-by-one on the public site and start a custom trial."""
import uuid

import pytest
import requests

from conftest import API


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


class TestCustomModulePack:
    def test_public_catalog_has_module_prices(self, api):
        r = api.get(f"{API}/public/plans")
        assert r.status_code == 200, r.text
        d = r.json()
        priced = [m for m in d["catalog"] if not m.get("is_core")]
        assert priced
        assert all("price_monthly" in m for m in priced)
        assert any(m["price_monthly"] > 0 for m in priced)
        assert "plan_custom" not in {p["id"] for p in d["plans"]}

    def test_signup_with_picked_modules(self, api):
        email = f"pack_{uuid.uuid4().hex[:8]}@test.com"
        r = api.post(
            f"{API}/public/signup",
            json={
                "company_name": "TEST Özel Paket Ltd",
                "name": "Paketçi",
                "email": email,
                "password": "abc12345",
                "modules": ["/invoices", "contacts", "/stock"],
            },
        )
        assert r.status_code == 200, r.text
        lic = r.json()["license"]
        self.__class__.cid = r.json()["company_id"]
        assert lic["plan_id"] == "plan_custom"
        assert lic["plan_name"] == "Özel Paket"
        assert lic["status"] == "trial"
        assert lic["modules"].get("/invoices") is True
        assert lic["modules"].get("/contacts") is True
        assert lic["modules"].get("/stock") is True
        assert lic["modules"].get("/ecommerce") is False
        assert lic["modules"].get("/production") is False
        assert lic.get("custom_price_monthly", 0) > 0

    def test_unknown_module_ignored_not_500(self, api):
        email = f"pack2_{uuid.uuid4().hex[:8]}@test.com"
        r = api.post(
            f"{API}/public/signup",
            json={
                "company_name": "TEST Bad Mod",
                "name": "X",
                "email": email,
                "password": "abc12345",
                "modules": ["/nope", "/invoices"],
            },
        )
        assert r.status_code == 200, r.text
        lic = r.json()["license"]
        assert lic["modules"].get("/invoices") is True
        assert "/nope" not in (lic.get("modules") or {})

    def test_ready_made_plan_signup_unchanged(self, api):
        email = f"pack3_{uuid.uuid4().hex[:8]}@test.com"
        r = api.post(
            f"{API}/public/signup",
            json={
                "company_name": "TEST Standart",
                "name": "Y",
                "email": email,
                "password": "abc12345",
                "plan_id": "plan_standard",
            },
        )
        assert r.status_code == 200, r.text
        lic = r.json()["license"]
        assert lic["plan_name"] == "Standart"
        assert lic["modules"].get("/invoices") is True
        assert lic["modules"].get("/ecommerce") is False
