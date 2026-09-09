"""Live API tests for comprehensive order/invoice line structure."""
import os
import uuid

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env") or dotenv_values("/workspace/frontend/.env") or {}
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    pytest.skip("REACT_APP_BACKEND_URL missing", allow_module_level=True)
BASE = base_url.rstrip("/") + "/api"
COMPANY = os.environ.get("TEST_COMPANY_ID") or "comp_nexus_main_01"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def contact_id(api):
    rows = api.get(f"{BASE}/contacts", params={"company_id": COMPANY}, timeout=30).json()
    assert rows, "seed contacts required"
    return rows[0]["id"]


class TestInvoiceLineStructure:
    def test_create_recomputes_dual_prices_and_totals(self, api, contact_id):
        payload = {
            "company_id": COMPANY,
            "invoice_type": "sales",
            "e_type": "paper",
            "status": "draft",
            "contact_id": contact_id,
            "contact_name": "TEST line",
            "items": [
                {"name": "TEST satır A", "quantity": 2, "unit": "Adet", "unit_price": 100, "vat_rate": 20, "discount_rate": 10, "total": 0},
                {"name": "TEST satır B", "quantity": 1, "unit": "Adet", "unit_price": 50, "vat_rate": 10, "discount_rate": 0, "total": 9999},
            ],
        }
        r = api.post(f"{BASE}/invoices", json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text
        inv = r.json()
        a, b = inv["items"]
        assert a["unit_price"] == 100
        assert abs(a["unit_price_incl"] - 120) < 0.02
        assert a["total"] == 180.0
        assert a["total_incl"] == 216.0
        assert b["total"] == 50.0
        assert abs(b["total_incl"] - 55) < 0.02
        assert inv["subtotal"] == 230.0
        assert inv["vat_total"] == 41.0
        assert inv["grand_total"] == 271.0
        api.delete(f"{BASE}/invoices/{inv['id']}", timeout=20)

    def test_legacy_incl_mode_converts_unit_price(self, api, contact_id):
        payload = {
            "company_id": COMPANY,
            "invoice_type": "sales",
            "e_type": "paper",
            "status": "draft",
            "price_mode": "incl",
            "contact_id": contact_id,
            "contact_name": "TEST incl",
            "items": [{"name": "TEST brüt", "quantity": 1, "unit": "Adet", "unit_price": 120, "vat_rate": 20, "total": 120}],
        }
        r = api.post(f"{BASE}/invoices", json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text
        inv = r.json()
        it = inv["items"][0]
        assert abs(it["unit_price"] - 100) < 0.05
        assert abs(it["unit_price_incl"] - 120) < 0.05
        assert it["total"] == 100.0
        assert it["total_incl"] == 120.0
        assert inv["grand_total"] == 120.0
        api.delete(f"{BASE}/invoices/{inv['id']}", timeout=20)


class TestOrderLineStructure:
    def test_create_order_with_vat_and_discount(self, api):
        payload = {
            "company_id": COMPANY,
            "channel": "manual",
            "customer_name": f"TEST line {uuid.uuid4().hex[:6]}",
            "shipping_address": "TEST",
            "city": "İstanbul",
            "items": [{
                "product_id": "",
                "product_name": "TEST sipariş kalemi",
                "sku": "TST-LINE",
                "quantity": 2,
                "unit_price": 100,
                "vat_rate": 20,
                "discount_rate": 10,
                "total": 0,
            }],
            "total_amount": 1,
        }
        r = api.post(f"{BASE}/orders", json=payload, timeout=30)
        assert r.status_code in (200, 201), r.text
        o = r.json()
        it = o["items"][0]
        assert it["product_name"] == "TEST sipariş kalemi"
        assert it["total"] == 180.0
        assert it["total_incl"] == 216.0
        assert abs(it["unit_price_incl"] - 120) < 0.02
        assert o["subtotal"] == 180.0
        assert o["vat_total"] == 36.0
        assert o["grand_total"] == 216.0
        assert o["total_amount"] == 216.0
        return o

    def test_convert_order_uses_line_vat_not_hardcoded_20(self, api):
        payload = {
            "company_id": COMPANY,
            "channel": "manual",
            "customer_name": f"TEST convert {uuid.uuid4().hex[:6]}",
            "shipping_address": "TEST",
            "city": "Ankara",
            "items": [{
                "product_id": "",
                "product_name": "TEST %10",
                "sku": "",
                "quantity": 1,
                "unit_price": 200,
                "vat_rate": 10,
                "discount_rate": 0,
                "total": 200,
            }],
            "total_amount": 220,
        }
        o = api.post(f"{BASE}/orders", json=payload, timeout=30).json()
        r = api.post(f"{BASE}/orders/{o['id']}/convert-to-invoice", json={"e_type": "paper"}, timeout=30)
        assert r.status_code == 200, r.text
        inv_id = r.json()["invoice_id"]
        invs = api.get(f"{BASE}/invoices", params={"company_id": COMPANY}, timeout=30).json()
        inv = next(x for x in invs if x["id"] == inv_id)
        assert inv["items"][0]["vat_rate"] in (10, 10.0)
        assert inv["items"][0]["total"] == 200.0
        assert abs(inv["items"][0]["total_incl"] - 220) < 0.05
        assert inv["subtotal"] == 200.0
        assert inv["vat_total"] == 20.0
        assert inv["grand_total"] == 220.0
