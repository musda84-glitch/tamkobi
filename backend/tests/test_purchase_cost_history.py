"""Previous purchase costs on stock / product list."""
import os
import re
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE = base_url.rstrip("/") + "/api"
COMPANY = "comp_nexus_main_01"


@pytest.fixture(scope="module")
def api():
    content = Path("/app/memory/test_credentials.md").read_text(encoding="utf-8")
    email = re.search(r"(?im)^\s*-\s*\*\*Email:\*\*\s*(\S+)", content)
    pwd = re.search(r"(?im)^\s*\-\s*\*\*Password:\*\*\s*(\S+)", content)
    s = requests.Session()
    if email and pwd:
        r = s.post(f"{BASE}/auth/login", json={"email": email.group(1), "password": pwd.group(1)}, timeout=30)
        if r.status_code != 200:
            pytest.fail(f"Login failed {r.status_code}: {r.text[:300]}")
    else:
        r = s.post(f"{BASE}/auth/login", json={"email": "admin@nexus.com", "password": "admin123"}, timeout=30)
        assert r.status_code == 200, r.text
    return s


def test_product_lists_previous_purchase_costs(api):
    sku = f"COST_{uuid.uuid4().hex[:8]}"
    prod = api.post(f"{BASE}/products", json={
        "company_id": COMPANY, "name": f"TEST_cost {sku}", "sku": sku, "category": "TEST",
        "unit": "Adet", "sale_price": 120, "purchase_price": 50, "vat_rate": 20, "stock_quantity": 5,
    }, timeout=30).json()
    pid = prod["id"]
    contacts = api.get(f"{BASE}/contacts?company_id={COMPANY}", timeout=30).json()
    c = next((x for x in contacts if x.get("type") in (None, "customer", "supplier") or x.get("name")), contacts[0])
    a = api.post(f"{BASE}/invoices", json={
        "company_id": COMPANY, "invoice_type": "purchase", "e_type": "paper", "status": "draft",
        "contact_id": c["id"], "contact_name": c.get("name") or "TEST_sup", "issue_date": "2026-01-10",
        "items": [{"product_id": pid, "name": prod["name"], "quantity": 2, "unit": "Adet", "unit_price": 40, "vat_rate": 20, "total": 80}],
    }, timeout=30)
    assert a.status_code == 200, a.text
    inv_a = a.json()
    b = api.post(f"{BASE}/invoices", json={
        "company_id": COMPANY, "invoice_type": "purchase", "e_type": "paper", "status": "draft",
        "contact_id": c["id"], "contact_name": c.get("name") or "TEST_sup", "issue_date": "2026-08-20",
        "items": [{"product_id": pid, "name": prod["name"], "quantity": 1, "unit": "Adet", "unit_price": 70, "vat_rate": 20, "total": 70}],
    }, timeout=30)
    assert b.status_code == 200, b.text
    inv_b = b.json()
    try:
        listed = api.get(f"{BASE}/products?company_id={COMPANY}", timeout=30).json()
        row = next(x for x in listed if x["id"] == pid)
        assert row["last_purchase_price"] == 70
        assert row["last_purchase_date"] == "2026-08-20"
        prices = [x["unit_price"] for x in row["purchase_costs"]]
        assert prices[:2] == [70, 40]
        assert row["avg_purchase_price"] == 55
        one = api.get(f"{BASE}/products/{pid}", timeout=30).json()
        assert one["last_purchase_price"] == 70
        hist = api.get(f"{BASE}/products/{pid}/purchase-costs", timeout=30).json()
        assert hist["card_purchase_price"] == 50
        assert hist["last_purchase_price"] == 70
        assert [x["unit_price"] for x in hist["costs"]][:2] == [70, 40]
    finally:
        api.delete(f"{BASE}/invoices/{inv_a['id']}", timeout=30)
        api.delete(f"{BASE}/invoices/{inv_b['id']}", timeout=30)
        api.delete(f"{BASE}/products/{pid}", timeout=30)
