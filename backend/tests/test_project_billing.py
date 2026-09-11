"""Project completion invoicing and expense / purchase-invoice linking."""
import os
import re
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
    pwd = re.search(r"(?im)^\s*-\s*\*\*Password:\*\*\s*(\S+)", content)
    s = requests.Session()
    if email and pwd:
        r = s.post(f"{BASE}/auth/login", json={"email": email.group(1), "password": pwd.group(1)}, timeout=30)
        if r.status_code != 200:
            pytest.fail(f"Login failed {r.status_code}: {r.text[:300]}")
    else:
        r = s.post(f"{BASE}/auth/login", json={"email": "admin@nexus.com", "password": "admin123"}, timeout=30)
        assert r.status_code == 200, r.text
    return s


@pytest.fixture
def contact(api):
    rows = api.get(f"{BASE}/contacts?company_id={COMPANY}", timeout=30).json()
    c = next((x for x in rows if x.get("id") == "cnt_01" or (x.get("name") or "").startswith("TEST")), None)
    if c:
        return c
    r = api.post(f"{BASE}/contacts", json={"company_id": COMPANY, "type": "customer", "name": "TEST_prj_cari", "tax_number_or_id": "1111111111", "city": "İstanbul", "category": "Genel"}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _cleanup(api, p=None, q=None, inv=None, exp=None):
    if q:
        api.delete(f"{BASE}/quotes/{q}", timeout=30)
    if inv:
        api.delete(f"{BASE}/invoices/{inv}", timeout=30)
    if exp:
        api.delete(f"{BASE}/expenses/{exp}", timeout=30)
    if p:
        api.delete(f"{BASE}/projects/{p}", timeout=30)


def test_invoice_requires_completed(api, contact):
    p = api.post(f"{BASE}/projects", json={"company_id": COMPANY, "name": "TEST_prj_stage", "contact_id": contact["id"], "contact_name": contact["name"], "budget": 1000}, timeout=30).json()
    r = api.post(f"{BASE}/projects/{p['id']}/invoice", json={}, timeout=30)
    assert r.status_code == 400
    _cleanup(api, p=p["id"])


def test_invoice_on_complete_from_quote(api, contact):
    p = api.post(f"{BASE}/projects", json={"company_id": COMPANY, "name": "TEST_prj_bill", "contact_id": contact["id"], "contact_name": contact["name"], "budget": 500}, timeout=30).json()
    q = api.post(f"{BASE}/quotes", json={"company_id": COMPANY, "contact_id": contact["id"], "contact_name": contact["name"], "title": "TEST_prj_q", "project_id": p["id"],
                                        "items": [{"name": "TEST_kalem", "quantity": 2, "unit_price": 50, "vat_rate": 20}]}, timeout=30).json()
    api.put(f"{BASE}/projects/{p['id']}", json={"status": "completed"}, timeout=30)
    conv = api.post(f"{BASE}/projects/{p['id']}/invoice", json={}, timeout=30)
    assert conv.status_code == 200, conv.text
    inv = conv.json()["invoice"]
    assert inv["project_id"] == p["id"]
    assert inv["grand_total"] == 120
    again = api.post(f"{BASE}/projects/{p['id']}/invoice", json={}, timeout=30)
    assert again.status_code == 200
    assert again.json().get("status") == "exists"
    row = next(x for x in api.get(f"{BASE}/projects?company_id={COMPANY}", timeout=30).json() if x["id"] == p["id"])
    assert row["can_invoice"] is False
    assert row["invoiced_total"] == 120
    _cleanup(api, p=p["id"], q=q["id"], inv=inv["id"])


def test_expense_and_purchase_link_to_project(api, contact):
    p = api.post(f"{BASE}/projects", json={"company_id": COMPANY, "name": "TEST_prj_cost", "contact_id": contact["id"], "contact_name": contact["name"]}, timeout=30).json()
    exp = api.post(f"{BASE}/expenses", json={"company_id": COMPANY, "description": "TEST_prj_masraf", "amount": 80, "vat_rate": 20, "project_id": p["id"]}, timeout=30).json()
    assert exp["project_id"] == p["id"]
    pin = api.post(f"{BASE}/invoices", json={
        "company_id": COMPANY, "invoice_type": "purchase", "e_type": "paper", "contact_id": contact["id"], "contact_name": contact["name"],
        "project_id": p["id"], "project_number": p["project_number"], "status": "draft",
        "items": [{"name": "TEST_gider", "quantity": 1, "unit": "Adet", "unit_price": 100, "vat_rate": 20, "total": 100}],
    }, timeout=30).json()
    assert pin["project_id"] == p["id"]
    row = next(x for x in api.get(f"{BASE}/projects?company_id={COMPANY}", timeout=30).json() if x["id"] == p["id"])
    assert row["expense_total"] == 96
    assert row["purchase_invoice_total"] == 120
    assert row["cost_total"] == 216
    listed = api.get(f"{BASE}/expenses?company_id={COMPANY}&project_id={p['id']}", timeout=30).json()["expenses"]
    assert any(x["id"] == exp["id"] for x in listed)
    _cleanup(api, p=p["id"], inv=pin.get("id"), exp=exp["id"])
