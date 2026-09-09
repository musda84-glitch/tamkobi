"""Iteration 43: POST /orders/{id}/approve without cargo_carrier only approves."""
import pytest
import requests

from conftest import API, TEST_COMPANY_ID


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


class TestApproveWithoutCargo:
    created = []

    @pytest.fixture(scope="class", autouse=True)
    def _cleanup(self, client):
        yield
        for oid in self.created:
            client.delete(f"{API}/orders/{oid}")

    def test_approve_empty_body_sets_approved_not_cargo(self, client):
        r = client.post(f"{API}/orders", json={
            "company_id": TEST_COMPANY_ID,
            "channel": "b2b",
            "customer_name": "TEST_it43 approve-only",
            "shipping_address": "TEST addr",
            "city": "İstanbul",
            "items": [{
                "product_id": "prod_01",
                "product_name": "TEST ürün",
                "sku": "NX-BT-PRO",
                "quantity": 1,
                "unit_price": 100,
                "total": 100,
                "vat_rate": 20,
            }],
            "total_amount": 120,
        })
        assert r.status_code in (200, 201), r.text
        order = r.json()
        order = order.get("order", order)
        oid = order["id"]
        self.created.append(oid)
        assert order.get("order_status") == "pending"
        assert not order.get("cargo_carrier")
        assert not order.get("cargo_tracking_number")

        r = client.post(f"{API}/orders/{oid}/approve", json={})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["order_status"] in ("approved", "Onaylandı")
        assert not d.get("cargo_carrier")
        assert not d.get("cargo_tracking_number")
