"""Low-stock products → given purchase orders (verilen sipariş)."""
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
    # Local / unit-only environments: skip live API suite.
    pytest.skip("REACT_APP_BACKEND_URL missing", allow_module_level=True)
BASE = base_url.rstrip("/") + "/api"
COMPANY = "comp_nexus_main_01"


@pytest.fixture(scope="module")
def api():
    cred_path = Path("/app/memory/test_credentials.md")
    s = requests.Session()
    if cred_path.exists():
        content = cred_path.read_text(encoding="utf-8")
        email = re.search(r"(?im)^\s*-\s*\*\*Email:\*\*\s*(\S+)", content)
        pwd = re.search(r"(?im)^\s*\-\s*\*\*Password:\*\*\s*(\S+)", content)
        if email and pwd:
            r = s.post(f"{BASE}/auth/login", json={"email": email.group(1), "password": pwd.group(1)}, timeout=30)
            if r.status_code == 200:
                return s
    r = s.post(f"{BASE}/auth/login", json={"email": "admin@nexus.com", "password": "admin123"}, timeout=30)
    assert r.status_code == 200, r.text
    return s


def test_reorder_creates_purchase_order_from_last_supplier(api):
    sku = f"REO_{uuid.uuid4().hex[:8]}"
    prod = api.post(f"{BASE}/products", json={
        "company_id": COMPANY, "name": f"TEST_reorder {sku}", "sku": sku, "category": "TEST",
        "unit": "Adet", "sale_price": 90, "purchase_price": 30, "vat_rate": 20,
        "stock_quantity": 2, "min_stock_alert": 10, "track_stock": True,
    }, timeout=30).json()
    pid = prod["id"]
    contacts = api.get(f"{BASE}/contacts?company_id={COMPANY}", timeout=30).json()
    c = next((x for x in contacts if (x.get("type") or "") in ("supplier", "both", "customer")), contacts[0])
    pin = api.post(f"{BASE}/invoices", json={
        "company_id": COMPANY, "invoice_type": "purchase", "e_type": "paper", "status": "draft",
        "contact_id": c["id"], "contact_name": c.get("name") or "TEST_sup", "issue_date": "2026-07-01",
        "items": [{"product_id": pid, "name": prod["name"], "quantity": 1, "unit": "Adet", "unit_price": 44, "vat_rate": 20, "total": 44}],
    }, timeout=30)
    assert pin.status_code == 200, pin.text
    old = pin.json()
    created = []
    try:
        prev = api.get(f"{BASE}/products/reorder-preview", params={"company_id": COMPANY, "product_ids": pid}, timeout=30)
        assert prev.status_code == 200, prev.text
        line = next(x for x in prev.json()["lines"] if x["product_id"] == pid)
        assert line["quantity"] == 8
        assert line["unit_price"] == 44
        assert line["contact_id"] == c["id"]
        r = api.post(f"{BASE}/products/reorder-purchases", json={"company_id": COMPANY, "lines": [line]}, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["count"] == 1
        assert "verilen sipariş" in (data.get("message") or "").lower()
        order = data["orders"][0]
        created.append(order["id"])
        full = api.get(f"{BASE}/purchase-orders/{order['id']}", timeout=30)
        assert full.status_code == 200, full.text
        doc = full.json()
        assert doc["order_status"] == "draft"
        assert doc["contact_id"] == c["id"]
        assert doc["items"][0]["quantity"] == 8
        assert doc["items"][0]["unit_price"] == 44
        conv = api.post(f"{BASE}/purchase-orders/{order['id']}/convert-to-invoice", timeout=30)
        assert conv.status_code == 200, conv.text
        inv = conv.json()["invoice"]
        assert inv["invoice_type"] == "purchase"
        assert inv["status"] == "draft"
        api.delete(f"{BASE}/invoices/{inv['id']}", timeout=30)
    finally:
        api.delete(f"{BASE}/invoices/{old['id']}", timeout=30)
        for oid in created:
            # faturalandıktan sonra silinemez; iptal sonrası da invoice_id kalabilir — best effort
            api.put(f"{BASE}/purchase-orders/{oid}/status", json={"order_status": "cancelled"}, timeout=30)
        api.delete(f"{BASE}/products/{pid}", timeout=30)


def test_reorder_does_not_use_foreign_company_product(api):
    r = api.post(f"{BASE}/products/reorder-purchases", json={
        "company_id": COMPANY,
        "lines": [{"product_id": "prod_other_tenant", "quantity": 1, "contact_id": "cnt_01", "unit_price": 1}],
    }, timeout=30)
    assert r.status_code in (200, 400)
    if r.status_code == 200:
        assert r.json().get("count", 0) == 0
