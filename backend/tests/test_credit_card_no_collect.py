"""Credit cards cannot be used as tahsilat (collection) targets."""
import os
import uuid

import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "http://127.0.0.1:8000").rstrip("/")
API = BASE_URL + "/api"
COMPANY = "comp_nexus_main_01"
ADMIN_EMAIL = "admin@nexus.com"
ADMIN_PASS = "admin123"


def _admin():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20)
    assert r.status_code == 200, r.text
    return s


class TestCreditCardNoCollect:
    def test_inflow_rejected_on_credit_card(self):
        s = _admin()
        name = f"CC-{uuid.uuid4().hex[:6]}"
        created = s.post(f"{API}/banking/accounts", json={
            "company_id": COMPANY, "type": "credit_card", "bank_name": "Test Kart",
            "account_name": name, "currency": "TRY", "current_balance": 0,
        }, timeout=20)
        assert created.status_code in (200, 201), created.text[:300]
        cid = created.json()["id"]
        bad = s.post(f"{API}/banking/transactions", json={
            "company_id": COMPANY, "account_id": cid, "account_name": name,
            "type": "inflow", "category": "Cari Tahsilat", "amount": 50, "currency": "TRY",
            "description": "should fail", "source": "manual",
        }, timeout=20)
        assert bad.status_code == 400, bad.text[:300]
        assert "tahsilat" in (bad.json().get("detail") or "").lower()

        ok = s.post(f"{API}/banking/transactions", json={
            "company_id": COMPANY, "account_id": cid, "account_name": name,
            "type": "outflow", "category": "Kart Harcaması", "amount": 10, "currency": "TRY",
            "description": "spend ok", "source": "manual",
        }, timeout=20)
        assert ok.status_code in (200, 201), ok.text[:300]
