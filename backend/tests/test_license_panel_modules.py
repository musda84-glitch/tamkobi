"""Sidebar pages that used to inherit a parent license key must be first-class modules."""
import os

import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "http://127.0.0.1:8000").rstrip("/")
API = BASE_URL + "/api"
ADMIN_EMAIL = "admin@nexus.com"
ADMIN_PASS = "admin123"
MAIN_CID = "comp_nexus_main_01"

PANEL_MODULES = {
    "/edoc-inbox": "Gelen e-Belgeler",
    "/dis-ticaret": "İthalat / İhracat",
    "/b2b-yonetim": "B2B Portal Yönetimi",
    "/sayim": "Stok Sayımı",
    "/saha": "Saha Sipariş",
    "/sevk": "Depo Sevkiyatı",
    "/mesai": "Mesaim",
    "/purchase-orders": "Verilen Siparişler",
}


def _admin():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20)
    assert r.status_code == 200, r.text
    assert r.json()["user"].get("is_super_admin") is True
    return s


class TestLicensePanelModules:
    def test_catalog_includes_panel_modules(self):
        s = _admin()
        r = s.get(f"{API}/system/modules", timeout=20)
        assert r.status_code == 200, r.text
        by_key = {m["key"]: m for m in r.json()}
        for key, label in PANEL_MODULES.items():
            assert key in by_key, f"missing catalog key {key}"
            assert by_key[key].get("is_core") is not True
            assert by_key[key]["label"] == label
            assert by_key[key].get("category")

    def test_enterprise_plan_includes_panel_modules(self):
        s = _admin()
        r = s.get(f"{API}/system/plans", timeout=20)
        assert r.status_code == 200, r.text
        ent = next((p for p in r.json() if p.get("code") == "enterprise" or p.get("id") == "plan_enterprise"), None)
        assert ent, "enterprise plan missing"
        mods = set(ent.get("modules") or [])
        for key in PANEL_MODULES:
            assert key in mods, f"enterprise plan missing {key}"

    def test_starter_keeps_invoice_and_stock_children(self):
        s = _admin()
        r = s.get(f"{API}/system/plans", timeout=20)
        starter = next((p for p in r.json() if p.get("code") == "starter" or p.get("id") == "plan_starter"), None)
        assert starter
        mods = set(starter.get("modules") or [])
        for key in ("/edoc-inbox", "/dis-ticaret", "/b2b-yonetim", "/sayim", "/purchase-orders"):
            assert key in mods, f"starter plan missing {key}"

    def test_toggle_edoc_inbox_blocks_api(self):
        s = _admin()
        r = s.post(f"{API}/system/companies/{MAIN_CID}/modules/edoc-inbox", json={"enabled": False}, timeout=20)
        assert r.status_code == 200, r.text
        modules = r.json().get("modules") or r.json().get("license", {}).get("modules") or {}
        assert modules.get("/edoc-inbox") is False
        try:
            blocked = s.get(f"{API}/edocs/inbox", params={"company_id": MAIN_CID}, timeout=20)
            assert blocked.status_code == 403, blocked.text
        finally:
            s.post(f"{API}/system/companies/{MAIN_CID}/modules/edoc-inbox", json={"enabled": True}, timeout=20)
