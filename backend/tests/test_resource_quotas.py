"""Live API tests for resource quotas (stok, cari, şirket, resim)."""
import os
import uuid

import pytest
import requests

BASE = (os.environ.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
API = f"{BASE}/api" if BASE else ""
ADMIN = os.environ.get("TEST_ADMIN_EMAIL", "admin@nexus.com")
ADMIN_PW = os.environ.get("TEST_ADMIN_PASSWORD", "admin123")


pytestmark = pytest.mark.skipif(not BASE, reason="REACT_APP_BACKEND_URL missing")


def _login():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN, "password": ADMIN_PW}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"admin login unavailable: {r.status_code}")
    tok = r.json().get("token")
    if not tok:
        pytest.skip("no token")
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def hdr():
    return _login()


@pytest.fixture(scope="module")
def quotas_ready(hdr):
    r = requests.get(f"{API}/system/quotas", headers=hdr, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"quotas module not deployed ({r.status_code})")
    return r.json()


def test_system_quotas_lists_licenses(quotas_ready):
    d = quotas_ready
    assert "quotas" in d
    row = next((x for x in d["quotas"] if x.get("id")), None)
    assert row, "no license rows"
    for k in ("product_limit", "contact_limit", "storage_limit_mb", "company_limit", "product_count", "contact_count", "storage_bytes"):
        assert k in row


def test_product_and_contact_limit_enforced(hdr, quotas_ready):
    r = requests.post(f"{API}/system/companies", headers=hdr, json={
        "name": f"TEST Kota {uuid.uuid4().hex[:6]}",
        "admin_email": f"kota_{uuid.uuid4().hex[:8]}@test.local",
        "admin_password": "Test1234",
        "admin_name": "Kota Test",
        "plan_id": "plan_starter",
        "trial_days": 7,
    }, timeout=30)
    assert r.status_code == 200, r.text[:500]
    cid = r.json()["id"]
    try:
        u = requests.put(f"{API}/system/companies/{cid}/license", headers=hdr, json={"product_limit": 1, "contact_limit": 1}, timeout=20)
        assert u.status_code == 200, u.text[:300]
        usage = requests.get(f"{API}/system/quotas", headers=hdr, timeout=30).json()
        row = next(x for x in usage["quotas"] if x["id"] == cid)
        # New firms may receive demo cards; cap just above current usage.
        requests.put(f"{API}/system/companies/{cid}/license", headers=hdr, json={
            "product_limit": int(row["product_count"]) + 1,
            "contact_limit": int(row["contact_count"]) + 1,
        }, timeout=20)
        p1 = requests.post(f"{API}/products", headers=hdr, json={"company_id": cid, "name": "Kota Stok 1", "sku": f"Q-{uuid.uuid4().hex[:6]}", "sale_price": 1, "purchase_price": 1, "stock_quantity": 0, "vat_rate": 20, "unit": "Adet", "type": "product"}, timeout=20)
        assert p1.status_code == 200, p1.text[:400]
        p2 = requests.post(f"{API}/products", headers=hdr, json={"company_id": cid, "name": "Kota Stok 2", "sku": f"Q-{uuid.uuid4().hex[:6]}", "sale_price": 1, "purchase_price": 1, "stock_quantity": 0, "vat_rate": 20, "unit": "Adet", "type": "product"}, timeout=20)
        assert p2.status_code == 403, p2.text[:400]
        assert "Stok kartı" in (p2.json().get("detail") or "")
        c1 = requests.post(f"{API}/contacts", headers=hdr, json={"company_id": cid, "type": "customer", "name": "Kota Cari 1", "tax_number_or_id": "11111111111"}, timeout=20)
        assert c1.status_code == 200, c1.text[:400]
        c2 = requests.post(f"{API}/contacts", headers=hdr, json={"company_id": cid, "type": "customer", "name": "Kota Cari 2", "tax_number_or_id": "22222222222"}, timeout=20)
        assert c2.status_code == 403, c2.text[:400]
        assert "Cari kart" in (c2.json().get("detail") or "")
        requests.put(f"{API}/system/companies/{cid}/license", headers=hdr, json={"product_limit": 0, "contact_limit": 0}, timeout=20)
        p3 = requests.post(f"{API}/products", headers=hdr, json={"company_id": cid, "name": "Kota Stok 3", "sku": f"Q-{uuid.uuid4().hex[:6]}", "sale_price": 1, "purchase_price": 1, "stock_quantity": 0, "vat_rate": 20, "unit": "Adet", "type": "product"}, timeout=20)
        assert p3.status_code == 200, p3.text[:400]
    finally:
        requests.delete(f"{API}/system/companies/{cid}", headers=hdr, timeout=30)
