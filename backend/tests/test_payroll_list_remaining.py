"""Aylık bordro tahakkuku liste kartındaki kalan alacağa yansır."""
import os
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

_frontend_env = dotenv_values("/app/frontend/.env") or dotenv_values("/workspace/frontend/.env") or {}
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _frontend_env.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
API = f"{BASE_URL}/api" if BASE_URL else ""
COMPANY = os.environ.get("TEST_COMPANY_ID") or "comp_nexus_main_01"
ADMIN = os.environ.get("TEST_ADMIN_EMAIL", "admin@nexus.com")
ADMIN_PW = os.environ.get("TEST_ADMIN_PASSWORD", "admin123")
PERIOD = "2098-07"


@pytest.fixture
def api_client():
    if not API:
        pytest.skip("REACT_APP_BACKEND_URL missing")
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN, "password": ADMIN_PW}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"admin login unavailable: {r.status_code}")
    return s


def test_generate_payroll_shows_remaining_on_employee_list(api_client):
    salary = 2800.75
    r = api_client.post(
        f"{API}/personnel/employees",
        json={
            "company_id": COMPANY,
            "full_name": "Tahakkuk Alacak Test",
            "tc_kimlik": f"1{uuid.uuid4().hex[:10]}",
            "department": "Muhasebe",
            "position": "Uzman",
            "phone": "05550001111",
            "email": f"tah_{uuid.uuid4().hex[:8]}@test.local",
            "salary": salary,
            "start_date": "2026-01-01",
        },
        timeout=30,
    )
    assert r.status_code == 200, r.text
    emp = r.json()
    eid = emp["id"]

    before = api_client.get(f"{API}/personnel/employees", params={"company_id": COMPANY}, timeout=30)
    assert before.status_code == 200, before.text
    row0 = next(x for x in before.json() if x["id"] == eid)
    rem0 = float((row0.get("balance") or {}).get("remaining") or 0)

    gen = api_client.post(
        f"{API}/personnel/generate-payroll",
        json={"company_id": COMPANY, "period": PERIOD},
        timeout=60,
    )
    assert gen.status_code == 200, gen.text
    mine = [p for p in (gen.json().get("payrolls") or []) if p.get("employee_id") == eid]
    assert mine, gen.json().get("message")
    assert mine[0]["status"] == "pending"
    assert float(mine[0]["final_payable"]) >= salary

    after = api_client.get(f"{API}/personnel/employees", params={"company_id": COMPANY}, timeout=30)
    assert after.status_code == 200, after.text
    row = next(x for x in after.json() if x["id"] == eid)
    rem = float((row.get("balance") or {}).get("remaining") or 0)
    unpaid = float((row.get("balance") or {}).get("unpaid_payroll") or 0)
    assert unpaid >= salary
    assert rem >= rem0 + salary - 0.05
