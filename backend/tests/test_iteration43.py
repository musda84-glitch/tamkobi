"""Iteration 43: B2B same product + different stock notes stay separate order lines."""
import pytest
import requests

from conftest import API as BASE, TEST_COMPANY_ID as COMPANY, resolve_b2b_token


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


class TestB2BNoteLines:
    created_orders = []
    created_invoices = []

    @pytest.fixture(scope="class", autouse=True)
    def _cleanup(self, api):
        yield
        for iid in self.created_invoices:
            api.delete(f"{BASE}/invoices/{iid}")
        for oid in self.created_orders:
            api.delete(f"{BASE}/orders/{oid}")

    def test_different_notes_keep_separate_lines(self, api):
        token = resolve_b2b_token()
        r = api.post(
            f"{BASE}/public/b2b/{token}/orders",
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
        qty_by_note = {str(it.get("note") or "").strip(): int(it["quantity"]) for it in items}
        assert qty_by_note["kırmızı kutu"] == 1
        assert qty_by_note["mavi kutu"] == 2

        listed = api.get(f"{BASE}/orders", params={"company_id": COMPANY})
        assert listed.status_code == 200
        saved = next((o for o in listed.json() if o["id"] == order["id"]), None)
        assert saved, "order missing from GET /orders"
        assert len(saved["items"]) == 2
        assert {it.get("note") for it in saved["items"]} == {"kırmızı kutu", "mavi kutu"}

    def test_missing_note_still_creates_order(self, api):
        token = resolve_b2b_token()
        r = api.post(
            f"{BASE}/public/b2b/{token}/orders",
            json={"items": [{"product_id": "prod_01", "quantity": 1}], "note": "TEST_it43_plain"},
        )
        assert r.status_code == 200, r.text
        order = r.json()["order"]
        self.created_orders.append(order["id"])
        assert len(order["items"]) == 1
        assert not (order["items"][0].get("note") or "").strip()

    def test_convert_to_invoice_copies_line_notes(self, api):
        token = resolve_b2b_token()
        r = api.post(
            f"{BASE}/public/b2b/{token}/orders",
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
        conv = api.post(f"{BASE}/orders/{oid}/convert-to-invoice", json={"e_type": "paper"})
        assert conv.status_code == 200, conv.text
        body = conv.json()
        assert body.get("status") == "success", body
        iid = body.get("invoice_id")
        assert iid
        self.created_invoices.append(iid)
        invs = api.get(f"{BASE}/invoices", params={"company_id": COMPANY})
        assert invs.status_code == 200
        invoice = next((i for i in invs.json() if i["id"] == iid), None)
        assert invoice is not None
        notes = {str(it.get("note") or "").strip() for it in invoice.get("items") or []}
        assert "fişte basılacak A" in notes
        assert "fişte basılacak B" in notes
        assert len(invoice.get("items") or []) == 2
