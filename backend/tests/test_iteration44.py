"""Customers can pick modules one-by-one on the public site and start a custom trial."""
import uuid

import pytest
import requests

from conftest import API


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


class TestCustomModulePack:
    def test_public_catalog_has_module_prices(self, api):
        r = api.get(f"{API}/public/plans")
        assert r.status_code == 200, r.text
        d = r.json()
        priced = [m for m in d["catalog"] if not m.get("is_core")]
        assert priced
        assert all("price_monthly" in m for m in priced)
        assert any(m["price_monthly"] > 0 for m in priced)
        assert "plan_custom" not in {p["id"] for p in d["plans"]}

    def test_signup_with_picked_modules(self, api):
        email = f"pack_{uuid.uuid4().hex[:8]}@test.com"
        r = api.post(
            f"{API}/public/signup",
            json={
                "company_name": "TEST Özel Paket Ltd",
                "name": "Paketçi",
                "email": email,
                "password": "abc12345",
                "modules": ["/invoices", "contacts", "/stock"],
            },
        )
        assert r.status_code == 200, r.text
        lic = r.json()["license"]
        self.__class__.cid = r.json()["company_id"]
        assert lic["plan_id"] == "plan_custom"
        assert lic["plan_name"] == "Özel Paket"
        assert lic["status"] == "trial"
        assert lic["modules"].get("/invoices") is True
        assert lic["modules"].get("/contacts") is True
        assert lic["modules"].get("/stock") is True
        assert lic["modules"].get("/ecommerce") is False
        assert lic["modules"].get("/production") is False
        assert lic.get("custom_price_monthly", 0) > 0

    def test_unknown_module_ignored_not_500(self, api):
        email = f"pack2_{uuid.uuid4().hex[:8]}@test.com"
        r = api.post(
            f"{API}/public/signup",
            json={
                "company_name": "TEST Bad Mod",
                "name": "X",
                "email": email,
                "password": "abc12345",
                "modules": ["/nope", "/invoices"],
            },
        )
        assert r.status_code == 200, r.text
        lic = r.json()["license"]
        assert lic["modules"].get("/invoices") is True
        assert "/nope" not in (lic.get("modules") or {})

    def test_ready_made_plan_signup_unchanged(self, api):
        email = f"pack3_{uuid.uuid4().hex[:8]}@test.com"
        r = api.post(
            f"{API}/public/signup",
            json={
                "company_name": "TEST Standart",
                "name": "Y",
                "email": email,
                "password": "abc12345",
                "plan_id": "plan_standard",
            },
        )
        assert r.status_code == 200, r.text
        lic = r.json()["license"]
        assert lic["plan_name"] == "Standart"
        assert lic["modules"].get("/invoices") is True
        assert lic["modules"].get("/ecommerce") is False
"""B2B portal: edit/delete pending orders; cancel-request for approved."""
import pytest
import requests

from conftest import API, TEST_COMPANY_ID, resolve_b2b_token

TOKEN = resolve_b2b_token()


@pytest.fixture(scope="module")
def s():
    ses = requests.Session()
    ses.headers.update({"Content-Type": "application/json"})
    return ses


def _create(s, qty=1, note="IT44"):
    r = s.post(f"{API}/public/b2b/{TOKEN}/orders", json={"items": [{"product_id": "prod_01", "quantity": qty}], "note": note}, timeout=20)
    assert r.status_code == 200, r.text
    return r.json()["order"]


class TestB2BOrderLifecycle:
    def test_edit_pending_changes_qty(self, s):
        o = _create(s, qty=1, note="edit-me")
        r = s.put(f"{API}/public/b2b/{TOKEN}/orders/{o['id']}", json={
            "items": [{"product_id": "prod_01", "quantity": 3}], "note": "edited",
        }, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()["order"]
        assert d["notes"] == "edited"
        assert d["items"][0]["quantity"] == 3
        assert d["total_amount"] == pytest.approx(o["total_amount"] * 3, rel=0.02)
        assert d["order_status"] == "pending"

    def test_edit_wrong_token_404(self, s):
        o = _create(s, qty=1)
        r = s.put(f"{API}/public/b2b/not-a-real-token/orders/{o['id']}", json={"items": [{"product_id": "prod_01", "quantity": 1}]}, timeout=20)
        assert r.status_code == 404

    def test_edit_approved_rejected(self, s):
        o = _create(s, qty=1)
        assert s.post(f"{API}/orders/{o['id']}/approve", json={}, timeout=20).status_code == 200
        r = s.put(f"{API}/public/b2b/{TOKEN}/orders/{o['id']}", json={"items": [{"product_id": "prod_01", "quantity": 2}]}, timeout=20)
        assert r.status_code == 400

    def test_delete_pending(self, s):
        o = _create(s, qty=1, note="delete-me")
        r = s.delete(f"{API}/public/b2b/{TOKEN}/orders/{o['id']}", timeout=20)
        assert r.status_code == 200, r.text
        portal = s.get(f"{API}/public/b2b/{TOKEN}", timeout=20).json()
        assert o["id"] not in {x["id"] for x in portal["orders"]}

    def test_delete_approved_rejected(self, s):
        o = _create(s, qty=1)
        assert s.post(f"{API}/orders/{o['id']}/approve", json={}, timeout=20).status_code == 200
        r = s.delete(f"{API}/public/b2b/{TOKEN}/orders/{o['id']}", timeout=20)
        assert r.status_code == 400

    def test_cancel_request_then_admin_accept(self, s):
        o = _create(s, qty=1)
        r = s.post(f"{API}/public/b2b/{TOKEN}/orders/{o['id']}/cancel-request", json={"reason": "yanlış sipariş"}, timeout=20)
        assert r.status_code == 400
        assert s.post(f"{API}/orders/{o['id']}/approve", json={}, timeout=20).status_code == 200
        r = s.post(f"{API}/public/b2b/{TOKEN}/orders/{o['id']}/cancel-request", json={"reason": "yanlış sipariş"}, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()["order"]
        assert d["cancel_request"]["status"] == "pending"
        assert d["cancel_request"]["reason"] == "yanlış sipariş"
        r2 = s.post(f"{API}/public/b2b/{TOKEN}/orders/{o['id']}/cancel-request", json={}, timeout=20)
        assert r2.status_code == 200
        assert r2.json()["status"] == "exists"
        acc = s.post(f"{API}/orders/{o['id']}/resolve-cancel-request", json={"action": "accept"}, timeout=20)
        assert acc.status_code == 200, acc.text
        got = s.get(f"{API}/orders", params={"company_id": TEST_COMPANY_ID}, timeout=20).json()
        row = next(x for x in got if x["id"] == o["id"])
        assert row["order_status"] == "cancelled"
        assert row["cancel_request"]["status"] == "accepted"

    def test_cancel_request_reject_keeps_approved(self, s):
        o = _create(s, qty=1)
        assert s.post(f"{API}/orders/{o['id']}/approve", json={}, timeout=20).status_code == 200
        assert s.post(f"{API}/public/b2b/{TOKEN}/orders/{o['id']}/cancel-request", json={"reason": "vazgeçtim"}, timeout=20).status_code == 200
        rej = s.post(f"{API}/orders/{o['id']}/resolve-cancel-request", json={"action": "reject"}, timeout=20)
        assert rej.status_code == 200, rej.text
        got = s.get(f"{API}/orders", params={"company_id": TEST_COMPANY_ID}, timeout=20).json()
        row = next(x for x in got if x["id"] == o["id"])
        assert row["order_status"] == "approved"
        assert row["cancel_request"]["status"] == "rejected"
