"""Teklif, proje and keşif are separate license modules on platform plans."""
import os

import requests

from conftest import API

ADMIN_EMAIL = "admin@nexus.com"
ADMIN_PASS = "admin123"


def _admin():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20)
    assert r.status_code == 200, r.text
    return s


class TestSplitSalesModules:
    def test_catalog_lists_three_sales_modules(self):
        s = _admin()
        r = s.get(f"{API}/system/modules", timeout=20)
        assert r.status_code == 200, r.text
        keys = {m["key"]: m for m in r.json()}
        assert keys["/quotes"]["label"] == "Teklifler"
        assert keys["/projects"]["label"] == "Projeler"
        assert keys["/surveys"]["label"] == "Keşifler"
        assert keys["/quotes"]["category"] == "Satış"
        assert keys["/projects"]["category"] == "Satış"
        assert keys["/surveys"]["category"] == "Satış"

    def test_standard_and_enterprise_include_all_three(self):
        s = _admin()
        plans = {p["id"]: p for p in s.get(f"{API}/system/plans", timeout=20).json()}
        starter = set(plans["plan_starter"]["modules"])
        standard = set(plans["plan_standard"]["modules"])
        enterprise = set(plans["plan_enterprise"]["modules"])
        for key in ("/quotes", "/projects", "/surveys"):
            assert key not in starter
            assert key in standard
            assert key in enterprise

    def test_quotes_api_is_own_module(self):
        s = _admin()
        r = s.get(f"{API}/quotes", params={"company_id": os.environ.get("TEST_COMPANY_ID") or "comp_nexus_main_01"}, timeout=20)
        assert r.status_code == 200, r.text
