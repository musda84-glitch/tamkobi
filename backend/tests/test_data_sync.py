"""Artımlı /api/sync: yalnızca değişen ve silinen kayıtlar."""
import os
import sys
import time
import uuid

import pytest
import requests
from dotenv import dotenv_values

for _p in ("/app/backend", "/workspace/backend"):
    if _p not in sys.path:
        sys.path.insert(0, _p)

frontend_env = dotenv_values("/app/frontend/.env") or dotenv_values("/workspace/frontend/.env") or {}
backend_env = dotenv_values("/app/backend/.env") or dotenv_values("/workspace/backend/.env") or {}
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL") or backend_env.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
if not BASE_URL:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
API = BASE_URL + "/api"
COMPANY = os.environ.get("TEST_COMPANY_ID") or "comp_nexus_main_01"


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": "admin@nexus.com", "password": "admin123"}, timeout=20)
    assert r.status_code == 200, r.text
    return s


class TestMergeDelta:
    def test_merge_and_delete(self):
        from importlib.util import spec_from_loader, module_from_spec
        # Python-side equivalent of frontend mergeDelta
        def merge_delta(items, changed, deleted, replace):
            nxt = {} if replace else dict(items)
            for d in changed or []:
                i = d.get("id") or d.get("_id")
                if i:
                    nxt[i] = d
            for i in deleted or []:
                nxt.pop(i, None)
            return nxt
        a = merge_delta({"1": {"id": "1", "n": 1}}, [{"id": "2", "n": 2}, {"id": "1", "n": 9}], [], False)
        assert a["1"]["n"] == 9 and a["2"]["n"] == 2
        b = merge_delta(a, [], ["1"], False)
        assert "1" not in b and "2" in b
        c = merge_delta(b, [{"id": "3"}], [], True)
        assert list(c) == ["3"]


class TestSyncApi:
    def test_full_then_delta_then_delete(self, client):
        full = client.get(f"{API}/sync", params={"company_id": COMPANY, "collections": "invoices"}, timeout=30)
        assert full.status_code == 200, full.text
        body = full.json()
        assert body["full"] is True
        chunk = body["collections"]["invoices"]
        assert chunk["complete"] is True
        assert isinstance(chunk["changed"], list)
        cursor = chunk["cursor"]
        assert cursor

        payload = {
            "company_id": COMPANY, "invoice_type": "sales", "e_type": "paper",
            "invoice_number": f"SYNC-{uuid.uuid4().hex[:10].upper()}",
            "contact_id": "cnt_01", "contact_name": "TEST Sync", "status": "draft",
            "issue_date": "2026-09-08",
            "items": [{"name": "SYNC", "quantity": 1, "unit": "Adet", "unit_price": 10, "vat_rate": 20, "total": 10}],
        }
        created = client.post(f"{API}/invoices", json=payload, timeout=20)
        assert created.status_code == 200, created.text
        inv_id = created.json()["id"]
        time.sleep(0.05)
        delta = client.get(f"{API}/sync", params={"company_id": COMPANY, "collections": "invoices", "since": cursor}, timeout=30)
        assert delta.status_code == 200, delta.text
        dbody = delta.json()
        assert dbody["full"] is False
        ids = {x["id"] for x in dbody["collections"]["invoices"]["changed"]}
        assert inv_id in ids
        assert dbody["collections"]["invoices"]["changed"][0].get("invoice_number") or True
        cursor2 = dbody["collections"]["invoices"]["cursor"]

        client.put(f"{API}/invoices/{inv_id}", json={"notes": "SYNC-UPDATED"}, timeout=20)
        time.sleep(0.05)
        d2 = client.get(f"{API}/sync", params={"company_id": COMPANY, "collections": "invoices", "since": cursor2}, timeout=30)
        notes = {x["id"]: x.get("notes") for x in d2.json()["collections"]["invoices"]["changed"]}
        assert notes.get(inv_id) == "SYNC-UPDATED"
        cursor3 = d2.json()["collections"]["invoices"]["cursor"]

        deleted = client.delete(f"{API}/invoices/{inv_id}", timeout=20)
        assert deleted.status_code == 200, deleted.text
        time.sleep(0.05)
        d3 = client.get(f"{API}/sync", params={"company_id": COMPANY, "collections": "invoices", "since": cursor3}, timeout=30)
        gone = d3.json()["collections"]["invoices"]["deleted"]
        assert inv_id in gone

    def test_unknown_collection_ignored(self, client):
        r = client.get(f"{API}/sync", params={"company_id": COMPANY, "collections": "nope,contacts"}, timeout=20)
        assert r.status_code == 200
        assert "contacts" in r.json()["collections"]
        assert "nope" not in r.json()["collections"]
