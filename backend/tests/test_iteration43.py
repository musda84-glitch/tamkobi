"""Iteration 43: order approve-only + B2B stock-note cart lines."""
import pytest
import requests

from conftest import API, TEST_COMPANY_ID, resolve_b2b_token


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


class TestB2BNoteLines:
    created_orders = []
    created_invoices = []

    @pytest.fixture(scope="class", autouse=True)
    def _cleanup(self, client):
        yield
        for iid in self.created_invoices:
            client.delete(f"{API}/invoices/{iid}")
        for oid in self.created_orders:
            client.delete(f"{API}/orders/{oid}")

    def test_different_notes_keep_separate_lines(self, client):
        token = resolve_b2b_token()
        r = client.post(
            f"{API}/public/b2b/{token}/orders",
            json={
                "items": [
                    {"product_id": "prod_01", "quantity": 1, "note": "  kırmızı kutu  "},
                    {"product_id": "prod_01", "quantity": 2, "note": "mavi kutu"},
                ],
                "note": "TEST_it43_notes",
            },
        )
        assert r.status_code == 200, r.text
        order = r.json()["order"]
        self.created_orders.append(order["id"])
        items = [it for it in order["items"] if it.get("product_id") == "prod_01"]
        assert len(items) == 2, items
        notes = {str(it.get("note") or "").strip() for it in items}
        assert notes == {"kırmızı kutu", "mavi kutu"}

    def test_missing_note_still_creates_order(self, client):
        token = resolve_b2b_token()
        r = client.post(
            f"{API}/public/b2b/{token}/orders",
            json={"items": [{"product_id": "prod_01", "quantity": 1}], "note": "TEST_it43_plain"},
        )
        assert r.status_code == 200, r.text
        order = r.json()["order"]
        self.created_orders.append(order["id"])
        assert len(order["items"]) == 1
        assert not (order["items"][0].get("note") or "").strip()

    def test_convert_to_invoice_copies_line_notes(self, client):
        token = resolve_b2b_token()
        r = client.post(
            f"{API}/public/b2b/{token}/orders",
            json={
                "items": [
                    {"product_id": "prod_01", "quantity": 1, "note": "fişte basılacak A"},
                    {"product_id": "prod_01", "quantity": 1, "note": "fişte basılacak B"},
                ],
                "note": "TEST_it43_invoice",
            },
        )
        assert r.status_code == 200, r.text
        oid = r.json()["order"]["id"]
        self.created_orders.append(oid)
        conv = client.post(f"{API}/orders/{oid}/convert-to-invoice", json={"e_type": "paper"})
        assert conv.status_code == 200, conv.text
        body = conv.json()
        assert body.get("status") == "success", body
        iid = body.get("invoice_id")
        assert iid
        self.created_invoices.append(iid)
        invs = client.get(f"{API}/invoices", params={"company_id": TEST_COMPANY_ID})
        assert invs.status_code == 200
        invoice = next((i for i in invs.json() if i["id"] == iid), None)
        assert invoice is not None
        notes = {str(it.get("note") or "").strip() for it in invoice.get("items") or []}
        assert "fişte basılacak A" in notes
        assert "fişte basılacak B" in notes
        assert len(invoice.get("items") or []) == 2
