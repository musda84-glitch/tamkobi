"""Depolama alan yöneticisi — yol/alias birim testleri + canlı API."""
import os
import uuid

import pytest
import requests

import storage_manager as sm

BASE = (os.environ.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
API = f"{BASE}/api" if BASE else ""
ADMIN = os.environ.get("TEST_ADMIN_EMAIL", "admin@nexus.com")
ADMIN_PW = os.environ.get("TEST_ADMIN_PASSWORD", "admin123")


def test_area_for_entity_aliases():
    assert sm.area_for_entity("product") == "products"
    assert sm.area_for_entity("products") == "products"
    assert sm.area_for_entity("employee") == "employees"
    assert sm.area_for_entity("employee_photo") == "employees"
    assert sm.area_for_entity("personnel_photo") == "employees"
    assert sm.area_for_entity("contact") == "contacts"
    assert sm.area_for_entity("partner_photo") == "partners"
    assert sm.area_for_entity("partner") == "partners"
    assert sm.area_for_entity("contacts") == "contacts"
    assert sm.area_for_entity("quote") == "quotes"
    assert sm.area_for_entity("purchase_invoice") == "purchase_invoices"
    assert sm.area_for_entity("unknown_x") == "misc"


def test_object_path_account_layout():
    path = sm.object_path("comp_demo", "product", "jpg")
    assert path.startswith("tamkobi/accounts/comp_demo/products/")
    assert path.endswith(".jpg")
    assert sm.folder_path("comp_demo", "expenses") == "tamkobi/accounts/comp_demo/expenses"


def test_default_areas_cover_uploadables():
    keys = {a["key"] for a in sm.STORAGE_AREAS}
    for need in ("products", "company", "contacts", "expenses", "employees", "edocs", "misc"):
        assert need in keys


@pytest.mark.skipif(not BASE, reason="REACT_APP_BACKEND_URL missing")
def test_system_storage_api_flow():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN, "password": ADMIN_PW}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"admin login unavailable: {r.status_code}")
    tok = r.json().get("token")
    if not tok:
        pytest.skip("no token")
    hdr = {"Authorization": f"Bearer {tok}"}

    ov = requests.get(f"{API}/system/storage", headers=hdr, timeout=60)
    if ov.status_code == 404:
        pytest.skip("storage module not deployed")
    assert ov.status_code == 200, ov.text[:400]
    body = ov.json()
    assert "accounts" in body
    assert "areas" in body
    assert len(body["areas"]) >= 5

    create = requests.post(f"{API}/system/companies", headers=hdr, json={
        "name": f"TEST Depo {uuid.uuid4().hex[:6]}",
        "admin_email": f"depo_{uuid.uuid4().hex[:8]}@test.local",
        "admin_password": "Test1234",
        "admin_name": "Depo Test",
        "plan_id": "plan_starter",
        "trial_days": 7,
    }, timeout=60)
    assert create.status_code == 200, create.text[:500]
    cid = create.json()["id"]
    try:
        ens = requests.post(f"{API}/system/storage/{cid}/ensure", headers=hdr, timeout=30)
        assert ens.status_code == 200, ens.text[:400]
        assert ens.json()["folder_count"] >= len(sm.STORAGE_AREAS)

        detail = requests.get(f"{API}/system/storage/{cid}", headers=hdr, timeout=30)
        assert detail.status_code == 200, detail.text[:400]
        d = detail.json()
        assert d["company_id"] == cid
        assert len(d["folders"]) >= len(sm.STORAGE_AREAS)
        paths = [f.get("path") or "" for f in d["folders"]]
        assert any(f"/accounts/{cid}/products" in p for p in paths)

        custom = requests.post(
            f"{API}/system/storage/{cid}/folders",
            headers=hdr,
            json={"label": "Sözleşmeler"},
            timeout=20,
        )
        assert custom.status_code == 200, custom.text[:400]
        assert custom.json()["area_key"].startswith("custom_")

        files = requests.get(
            f"{API}/system/storage/{cid}/folders/products/files",
            headers=hdr,
            timeout=20,
        )
        assert files.status_code == 200
        assert "files" in files.json()
    finally:
        requests.delete(f"{API}/system/companies/{cid}", headers=hdr, timeout=30)
