"""Iteration 21 retest:
- POST /api/orders with order_number OMITTED -> auto B2B-2026-XXXX / ORD-2026-XXXX
- POST /api/personnel/generate-payroll -> overtime_rate.divisor == 225
"""
import re

import pytest
import requests

from conftest import API, TEST_COMPANY_ID


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


class TestOrderNumberOptional:
    created = []

    @pytest.fixture(scope="class", autouse=True)
    def _cleanup(self, client):
        yield
        for oid in self.created:
            client.delete(f"{API}/orders/{oid}")

    def _payload(self, channel):
        return {
            "company_id": TEST_COMPANY_ID,
            "channel": channel,
            "customer_name": f"TEST_it21 {channel}",
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
        }

    def test_b2b_channel_no_order_number(self, client):
        # NOTE: no order_number key at all in the body
        payload = self._payload("b2b")
        assert "order_number" not in payload
        r = client.post(f"{API}/orders", json=payload)
        assert r.status_code in (200, 201), r.text
        o = r.json()
        o = o.get("order", o)
        assert o.get("id"), o
        self.created.append(o["id"])
        num = o.get("order_number")
        assert num, o
        assert re.match(r"^B2B-\d{4}-\d{4}$", num), num
        # verify persisted
        g = client.get(f"{API}/orders/{o['id']}")
        assert g.status_code == 200, g.text
        got = g.json()
        got = got.get("order", got)
        assert got["order_number"] == num

    def test_marketplace_channel_no_order_number(self, client):
        payload = self._payload("marketplace")
        r = client.post(f"{API}/orders", json=payload)
        assert r.status_code in (200, 201), r.text
        o = r.json()
        o = o.get("order", o)
        self.created.append(o["id"])
        num = o.get("order_number")
        assert num, o
        assert re.match(r"^ORD-\d{4}-\d{4}$", num), num


class TestPayrollDivisor:
    created_ids = []

    @pytest.fixture(scope="class", autouse=True)
    def _cleanup(self, client):
        yield
        # Delete pending payrolls for the target period
        for pid in self.created_ids:
            client.delete(f"{API}/personnel/payrolls/{pid}")
        # extra safety: query and delete any pending 2026-09 payroll left behind
        r = client.get(f"{API}/personnel/payrolls", params={"company_id": TEST_COMPANY_ID, "period": "2026-09"})
        if r.status_code == 200:
            data = r.json()
            rows = data if isinstance(data, list) else (data.get("payrolls") or data.get("rows") or [])
            for p in rows:
                if p.get("status") == "pending" and p.get("id"):
                    client.delete(f"{API}/personnel/payrolls/{p['id']}")

    def test_generate_payroll_divisor_225(self, client):
        r = client.post(f"{API}/personnel/generate-payroll",
                        json={"company_id": TEST_COMPANY_ID, "period": "2026-09"})
        assert r.status_code == 200, r.text
        d = r.json()
        payrolls = d.get("payrolls") or d.get("rows") or (d if isinstance(d, list) else [])
        assert payrolls, d
        for p in payrolls:
            ot = p.get("overtime_rate")
            assert isinstance(ot, dict), p
            assert ot.get("divisor") == 225, p
            if p.get("id") and p.get("status") == "pending":
                self.created_ids.append(p["id"])
