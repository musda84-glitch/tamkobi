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
