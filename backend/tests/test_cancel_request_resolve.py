"""ERP: approve or reject a pending B2B cancel request."""
import requests

from conftest import API, TEST_COMPANY_ID

PAYLOAD = {
    "company_id": TEST_COMPANY_ID,
    "order_number": "",
    "channel": "b2b",
    "customer_name": "TEST_cancel_req",
    "shipping_address": "TEST",
    "city": "İstanbul",
    "items": [{"product_id": "prod_01", "product_name": "TEST ürün", "sku": "NX-BT-PRO", "quantity": 1, "unit_price": 100, "total": 100}],
    "total_amount": 100,
    "order_status": "approved",
    "cancel_request": {"status": "pending", "reason": "yanlış sipariş"},
}


def _create():
    r = requests.post(f"{API}/orders", json=PAYLOAD, timeout=20)
    assert r.status_code in (200, 201), r.text
    return r.json()


def test_accept_cancel_request_cancels_order():
    o = _create()
    acc = requests.post(f"{API}/orders/{o['id']}/resolve-cancel-request", json={"action": "accept"}, timeout=20)
    assert acc.status_code == 200, acc.text
    assert acc.json()["order_status"] == "cancelled"
    got = requests.get(f"{API}/orders", params={"company_id": TEST_COMPANY_ID}, timeout=20).json()
    row = next(x for x in got if x["id"] == o["id"])
    assert row["order_status"] == "cancelled"
    assert row["cancel_request"]["status"] == "accepted"


def test_reject_cancel_request_keeps_approved():
    o = _create()
    rej = requests.post(f"{API}/orders/{o['id']}/resolve-cancel-request", json={"action": "reject"}, timeout=20)
    assert rej.status_code == 200, rej.text
    got = requests.get(f"{API}/orders", params={"company_id": TEST_COMPANY_ID}, timeout=20).json()
    row = next(x for x in got if x["id"] == o["id"])
    assert row["order_status"] == "approved"
    assert row["cancel_request"]["status"] == "rejected"


def test_resolve_without_pending_request_fails():
    o = _create()
    assert requests.post(f"{API}/orders/{o['id']}/resolve-cancel-request", json={"action": "accept"}, timeout=20).status_code == 200
    again = requests.post(f"{API}/orders/{o['id']}/resolve-cancel-request", json={"action": "accept"}, timeout=20)
    assert again.status_code == 400
