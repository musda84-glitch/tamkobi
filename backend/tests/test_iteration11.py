"""Iteration 11 regression: B2B order create/delete, cargo integrations collection unification,
convert-to-invoice idempotency + e_type + contact resolution, product units CRUD."""
import os
import subprocess
import sys
import uuid

import pytest
import requests

from conftest import API as BASE, TEST_COMPANY_ID as COMPANY, TEST_B2B_CONTACT_ID, resolve_b2b_token
B2B_TOKEN = resolve_b2b_token()


@pytest.fixture(scope="module", autouse=True)
def _cleanup_it11():
    yield
    subprocess.run([sys.executable, os.path.join(os.path.dirname(__file__), "cleanup_iteration11.py")], check=False, capture_output=True)


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# ---------------- B2B order create + delete ----------------
class TestB2BOrders:
    def test_create_b2b_order_and_delete(self, api):
        r = api.post(f"{BASE}/public/b2b/{B2B_TOKEN}/orders",
                     json={"items": [{"product_id": "prod_01", "quantity": 1}], "note": "TEST_IT11"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["status"] == "success"
        order = data["order"]
        assert order["order_number"].startswith("B2B-"), order["order_number"]
        assert order["channel"] == "b2b"
        assert order["order_status"] == "pending"
        assert order["total_amount"] > 0
        assert "_id" not in order and order.get("id")
        oid = order["id"]

        # visible in /api/orders
        lst = api.get(f"{BASE}/orders", params={"company_id": COMPANY})
        assert lst.status_code == 200
        assert any(o["id"] == oid for o in lst.json())

        # visible in portal
        portal = api.get(f"{BASE}/public/b2b/{B2B_TOKEN}")
        assert portal.status_code == 200
        assert any(o["id"] == oid for o in portal.json()["orders"])

        # delete
        d = api.delete(f"{BASE}/orders/{oid}")
        assert d.status_code == 200, d.text
        lst2 = api.get(f"{BASE}/orders", params={"company_id": COMPANY})
        assert not any(o["id"] == oid for o in lst2.json())

    def test_empty_cart_400(self, api):
        r = api.post(f"{BASE}/public/b2b/{B2B_TOKEN}/orders", json={"items": []})
        assert r.status_code == 400

    def test_delete_unknown_order_404(self, api):
        assert api.delete(f"{BASE}/orders/nope_{uuid.uuid4().hex[:6]}").status_code == 404

    def test_delete_invoiced_order_400(self, api):
        orders = api.get(f"{BASE}/orders", params={"company_id": COMPANY}).json()
        inv = next((o for o in orders if o.get("is_invoiced") or o.get("invoice_id")), None)
        if not inv:
            pytest.skip("no invoiced order available")
        r = api.delete(f"{BASE}/orders/{inv['id']}")
        assert r.status_code == 400
        assert "Faturalanmış" in r.json().get("detail", "")


# ---------------- Cargo integrations ----------------
class TestCargo:
    def test_add_list_delete_geliver(self, api):
        # cleanup any leftover
        for c in api.get(f"{BASE}/integrations/cargo", params={"company_id": COMPANY}).json():
            if c.get("carrier_code") == "geliver":
                api.delete(f"{BASE}/integrations/cargo/{c['id']}")

        r = api.post(f"{BASE}/integrations/cargo", json={"company_id": COMPANY, "carrier_code": "geliver", "api_key": "TESTKEY"})
        assert r.status_code == 200, r.text
        added = r.json()
        assert added["carrier_code"] == "geliver"
        assert added["status"] == "connected"
        assert added["api_key"] == "••••••••"
        cid = added["id"]

        lst = api.get(f"{BASE}/integrations/cargo", params={"company_id": COMPANY}).json()
        assert any(c["id"] == cid for c in lst), "GET /integrations/cargo does not list added provider"
        assert all("_id" not in c for c in lst)

        cat = api.get(f"{BASE}/integrations/cargo/catalog", params={"company_id": COMPANY}).json()
        gel = next(c for c in cat if c["carrier_code"] == "geliver")
        assert gel["installed"] is True

        dup = api.post(f"{BASE}/integrations/cargo", json={"company_id": COMPANY, "carrier_code": "geliver", "api_key": "x"})
        assert dup.status_code == 400

        d = api.delete(f"{BASE}/integrations/cargo/{cid}")
        assert d.status_code == 200
        lst2 = api.get(f"{BASE}/integrations/cargo", params={"company_id": COMPANY}).json()
        assert not any(c["id"] == cid for c in lst2)
        cat2 = api.get(f"{BASE}/integrations/cargo/catalog", params={"company_id": COMPANY}).json()
        assert next(c for c in cat2 if c["carrier_code"] == "geliver")["installed"] is False

    def test_unknown_code_400(self, api):
        assert api.post(f"{BASE}/integrations/cargo", json={"carrier_code": "zzz"}).status_code == 400


# ---------------- convert-to-invoice ----------------
class TestConvertToInvoice:
    def test_already_invoiced_returns_info(self, api):
        orders = api.get(f"{BASE}/orders", params={"company_id": COMPANY}).json()
        inv = next((o for o in orders if o.get("is_invoiced") or o.get("invoice_id")), None)
        if not inv:
            pytest.skip("no invoiced order")
        before = len(api.get(f"{BASE}/invoices", params={"company_id": COMPANY}).json())
        r = api.post(f"{BASE}/orders/{inv['id']}/convert-to-invoice", json={})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "info"
        after = len(api.get(f"{BASE}/invoices", params={"company_id": COMPANY}).json())
        assert after == before, "duplicate invoice created for already invoiced order"

    def test_convert_paper_resolves_contact(self, api):
        # create a B2B order for cnt_01 (customer name matches contact)
        r = api.post(f"{BASE}/public/b2b/{B2B_TOKEN}/orders",
                     json={"items": [{"product_id": "prod_01", "quantity": 2}], "note": "TEST_IT11_CONV"})
        assert r.status_code == 200, r.text
        order = r.json()["order"]
        oid = order["id"]
        cname = order["customer_name"]
        try:
            conv = api.post(f"{BASE}/orders/{oid}/convert-to-invoice", json={"e_type": "paper"})
            assert conv.status_code == 200, conv.text
            body = conv.json()
            assert body["status"] == "success", body
            inv_id = body["invoice_id"]
            assert inv_id
            invs = api.get(f"{BASE}/invoices", params={"company_id": COMPANY}).json()
            invoice = next((i for i in invs if i["id"] == inv_id), None)
            assert invoice is not None, "invoice not persisted / not listed"
            assert invoice["e_type"] == "paper", invoice["e_type"]
            assert invoice["contact_name"] == cname
            # contact resolved by name / contact_id, not hardcoded cnt_01 fallback
            contacts = api.get(f"{BASE}/contacts", params={"company_id": COMPANY}).json()
            match = next((c for c in contacts if c["id"] == invoice["contact_id"]), None)
            assert match is not None, "invoice contact_id does not exist"
            assert match["name"] == cname, f"contact mismatch: {match['name']} != {cname}"
            # order now flagged
            o2 = next(o for o in api.get(f"{BASE}/orders", params={"company_id": COMPANY}).json() if o["id"] == oid)
            assert o2.get("is_invoiced") is True
            assert o2.get("invoice_id") == inv_id
            # second attempt -> info, no duplicate
            again = api.post(f"{BASE}/orders/{oid}/convert-to-invoice", json={"e_type": "paper"})
            assert again.json()["status"] == "info"
        finally:
            TestConvertToInvoice.created_order_number = order["order_number"]


# ---------------- Units ----------------
class TestUnits:
    def test_defaults_with_counts(self, api):
        r = api.get(f"{BASE}/products/units", params={"company_id": COMPANY})
        assert r.status_code == 200
        units = r.json()
        assert len(units) >= 17, len(units)
        names = [u["name"] for u in units]
        for expected in ("Adet", "Kg", "Ton"):
            assert expected in names
        assert all("count" in u and isinstance(u["count"], int) for u in units)
        assert next(u for u in units if u["name"] == "Adet")["count"] > 0

    def test_add_rename_delete(self, api):
        api.delete(f"{BASE}/products/units/Rulo", params={"company_id": COMPANY})
        api.delete(f"{BASE}/products/units/Rulo2", params={"company_id": COMPANY})

        a = api.post(f"{BASE}/products/units", json={"company_id": COMPANY, "name": "Rulo"})
        assert a.status_code == 200, a.text
        names = [u["name"] for u in api.get(f"{BASE}/products/units", params={"company_id": COMPANY}).json()]
        assert "Rulo" in names

        p = api.put(f"{BASE}/products/units/Rulo", params={"company_id": COMPANY}, json={"name": "Rulo2"})
        assert p.status_code == 200, p.text
        names = [u["name"] for u in api.get(f"{BASE}/products/units", params={"company_id": COMPANY}).json()]
        assert "Rulo2" in names and "Rulo" not in names

        d = api.delete(f"{BASE}/products/units/Rulo2", params={"company_id": COMPANY})
        assert d.status_code == 200
        names = [u["name"] for u in api.get(f"{BASE}/products/units", params={"company_id": COMPANY}).json()]
        assert "Rulo2" not in names

    def test_empty_name_400(self, api):
        assert api.post(f"{BASE}/products/units", json={"company_id": COMPANY, "name": "  "}).status_code == 400

    def test_delete_used_unit_400(self, api):
        r = api.delete(f"{BASE}/products/units/Adet", params={"company_id": COMPANY})
        assert r.status_code == 400, r.text
        assert "kullanan" in r.json().get("detail", "")
        names = [u["name"] for u in api.get(f"{BASE}/products/units", params={"company_id": COMPANY}).json()]
        assert "Adet" in names


# ---------------- Categories ----------------
class TestCategories:
    def test_add_and_delete_unused_category(self, api):
        api.delete(f"{BASE}/products/categories/TEST_IT11_KAT", params={"company_id": COMPANY})
        a = api.post(f"{BASE}/products/categories", json={"company_id": COMPANY, "name": "TEST_IT11_KAT"})
        assert a.status_code == 200
        cats = api.get(f"{BASE}/products/categories", params={"company_id": COMPANY}).json()
        assert any(c["name"] == "TEST_IT11_KAT" for c in cats)
        d = api.delete(f"{BASE}/products/categories/TEST_IT11_KAT", params={"company_id": COMPANY})
        assert d.status_code == 200
        cats2 = api.get(f"{BASE}/products/categories", params={"company_id": COMPANY}).json()
        assert not any(c["name"] == "TEST_IT11_KAT" for c in cats2)

    def test_delete_used_category_400(self, api):
        cats = api.get(f"{BASE}/products/categories", params={"company_id": COMPANY}).json()
        used = next((c for c in cats if c["count"] > 0), None)
        if not used:
            pytest.skip("no used category")
        r = api.delete(f"{BASE}/products/categories/{used['name']}", params={"company_id": COMPANY})
        assert r.status_code == 400
