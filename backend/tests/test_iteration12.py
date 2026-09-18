"""Iteration 12 — refactor/security regression tests.

MODULE: conftest dynamic B2B token resolution (no hardcoded secrets)
MODULE: /api/banking/connections + sync (sha256 simulation seed)
"""
import os

import pytest
import requests

from conftest import API as BASE, TEST_COMPANY_ID as CO, resolve_b2b_token


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# ---------------- MODULE: conftest dynamic token ----------------
class TestConftestTokenResolution:
    def test_resolve_b2b_token_without_env(self, s, monkeypatch):
        monkeypatch.delenv("TEST_B2B_TOKEN", raising=False)
        assert not os.environ.get("TEST_B2B_TOKEN")
        token = resolve_b2b_token()
        assert isinstance(token, str) and len(token) > 8
        # token must actually work against the public portal endpoint
        r = s.get(f"{BASE}/public/b2b/{token}")
        assert r.status_code == 200, r.text
        products = r.json()["products"]
        assert isinstance(products, list) and len(products) > 0
        assert "_id" not in products[0]

    def test_b2b_access_endpoint_is_idempotent(self, s):
        r1 = s.post(f"{BASE}/contacts/cnt_01/b2b-access", json={"enabled": True, "discount": 5})
        r2 = s.post(f"{BASE}/contacts/cnt_01/b2b-access", json={"enabled": True, "discount": 5})
        assert r1.status_code == 200 and r2.status_code == 200
        assert r1.json()["b2b_token"] == r2.json()["b2b_token"]


# ---------------- MODULE: Banking connections & sync ----------------
class TestBankingConnections:
    conn_id = None

    def test_cleanup_stale_test_connections(self, s):
        for c in s.get(f"{BASE}/banking/connections", params={"company_id": CO}).json():
            cid = str(c.get("client_id") or "")
            if cid in ("TEST_cid", "••••_cid") or c.get("last_error"):
                s.delete(f"{BASE}/banking/connections/{c['id']}")

    def test_list_connections(self, s):
        r = s.get(f"{BASE}/banking/connections", params={"company_id": CO})
        assert r.status_code == 200, r.text
        conns = r.json()
        assert isinstance(conns, list)
        for c in conns:
            assert "_id" not in c
            assert c.get("client_secret") in (None, "", "••••••••") or c["client_secret"].startswith("••••")
        if conns:
            TestBankingConnections.conn_id = conns[0]["id"]

    def test_create_connection_if_needed(self, s):
        if TestBankingConnections.conn_id:
            pytest.skip("existing connection available")
        accs = s.get(f"{BASE}/banking/accounts", params={"company_id": CO}).json()
        assert accs, "no bank accounts to link"
        r = s.post(f"{BASE}/banking/connections", json={
            "company_id": CO, "provider": "kuveytturk", "linked_account_id": accs[0]["id"],
            "mode": "simulation",
        })
        assert r.status_code == 200, r.text
        TestBankingConnections.conn_id = r.json()["id"]

    def test_test_connection(self, s):
        assert TestBankingConnections.conn_id
        r = s.post(f"{BASE}/banking/connections/{TestBankingConnections.conn_id}/test")
        assert r.status_code == 200, r.text
        assert "status" in r.json()

    def test_sync_produces_transactions_sha256_seed(self, s):
        cid = TestBankingConnections.conn_id
        assert cid
        r = s.post(f"{BASE}/banking/connections/{cid}/sync", params={"days": 7})
        assert r.status_code == 200, r.text
        d = r.json()
        assert "inserted" in d or "message" in d, d
        total = (d.get("inserted") or 0) + (d.get("skipped") or 0)
        assert total > 0, f"sync produced no movements: {d}"
        # verify connection state persisted
        conns = s.get(f"{BASE}/banking/connections", params={"company_id": CO}).json()
        me = next(c for c in conns if c["id"] == cid)
        assert me.get("last_synced_at")
        assert me.get("status") in ("simulated", "connected")

    def test_sync_is_idempotent(self, s):
        cid = TestBankingConnections.conn_id
        r = s.post(f"{BASE}/banking/connections/{cid}/sync", params={"days": 7})
        assert r.status_code == 200, r.text
        assert (r.json().get("inserted") or 0) == 0, "duplicate external_ids inserted twice"

    def test_sync_unknown_404(self, s):
        r = s.post(f"{BASE}/banking/connections/conn_does_not_exist/sync")
        assert r.status_code == 404


# ---------------- MODULE: smoke of key page endpoints (regression for hook refactor) ----------------
@pytest.mark.parametrize("path,params", [
    ("/dashboard/stats", {"company_id": CO}),
    ("/invoices", {"company_id": CO}),
    ("/contacts", {"company_id": CO}),
    ("/products", {"company_id": CO}),
    ("/warehouses", {"company_id": CO}),
    ("/orders", {"company_id": CO}),
    ("/installments", {"company_id": CO}),
    ("/production/recipes", {"company_id": CO}),
    ("/production/orders", {"company_id": CO}),
    ("/projects", {"company_id": CO}),
    ("/personnel/employees", {"company_id": CO}),
    ("/personnel/leaves", {"company_id": CO}),
    ("/personnel/bonuses", {"company_id": CO}),
    ("/personnel/attendance", {"company_id": CO, "month": "2026-07"}),
    ("/banking/accounts", {"company_id": CO}),
    ("/integrations/cargo/catalog", {"company_id": CO}),
    ("/integrations/ecommerce", {"company_id": CO}),
    ("/comm/mail/account", {"company_id": CO}),
    ("/notifications", {"company_id": CO}),
])
def test_page_endpoints_ok(s, path, params):
    r = s.get(f"{BASE}{path}", params=params)
    assert r.status_code == 200, f"{path} -> {r.status_code} {r.text[:200]}"
    body = r.json()
    if isinstance(body, list):
        assert all("_id" not in x for x in body if isinstance(x, dict)), f"{path} leaks _id"
    elif isinstance(body, dict):
        assert "_id" not in body, f"{path} leaks _id"
