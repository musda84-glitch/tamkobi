"""Bank account PUT (edit) and grouped-account delete rules."""
import os
import uuid
import pytest
import requests
from dotenv import dotenv_values

_fe = dotenv_values("/workspace/frontend/.env") or dotenv_values("/app/frontend/.env") or {}
BASE = (os.environ.get("REACT_APP_BACKEND_URL") or _fe.get("REACT_APP_BACKEND_URL") or "http://127.0.0.1:8000").rstrip("/")
API = f"{BASE}/api"
CID = os.environ.get("TEST_COMPANY_ID") or "comp_nexus_main_01"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


def test_update_account_name_and_iban(s):
    r = s.post(f"{API}/banking/accounts", json={
        "company_id": CID, "type": "bank", "bank_name": "TEST_Grup Banka",
        "account_name": "TEST_Eski Ad", "iban": "TR00TEST0001", "currency": "TRY", "current_balance": 0
    })
    assert r.status_code == 200, r.text
    aid = r.json()["id"]
    try:
        u = s.put(f"{API}/banking/accounts/{aid}", json={"account_name": "TEST_Yeni Ad", "iban": "TR00TEST0002", "bank_name": "TEST_Grup Banka 2"})
        assert u.status_code == 200, u.text
        d = u.json()
        assert d["account_name"] == "TEST_Yeni Ad"
        assert d["iban"] == "TR00TEST0002"
        assert d["bank_name"] == "TEST_Grup Banka 2"
    finally:
        s.delete(f"{API}/banking/accounts/{aid}")


def test_update_missing_account_404(s):
    r = s.put(f"{API}/banking/accounts/nope-{uuid.uuid4().hex[:6]}", json={"account_name": "x"})
    assert r.status_code == 404


def test_update_rejects_bad_type(s):
    r = s.post(f"{API}/banking/accounts", json={
        "company_id": CID, "type": "cash_box", "bank_name": "TEST_Kasa",
        "account_name": "TEST_Tip", "currency": "TRY", "current_balance": 0
    })
    assert r.status_code == 200, r.text
    aid = r.json()["id"]
    try:
        bad = s.put(f"{API}/banking/accounts/{aid}", json={"type": "wallet"})
        assert bad.status_code == 400, bad.text
    finally:
        s.delete(f"{API}/banking/accounts/{aid}")
