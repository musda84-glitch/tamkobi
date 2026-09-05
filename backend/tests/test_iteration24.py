"""Iteration 24 — Trendyol live integration + order deletion + marketplace claims/questions."""
import os
import pytest
import requests
from dotenv import dotenv_values

_env = dotenv_values("/app/frontend/.env")
_URL = os.environ.get("REACT_APP_BACKEND_URL") or _env.get("REACT_APP_BACKEND_URL")
BASE = _URL.rstrip("/") + "/api"
COMPANY = "comp_nexus_main_01"
CH_ID = "ecom_trendyol"
REAL_ORDER_NUMBER = "11571862893"  # real Trendyol order — must NEVER be deleted


@pytest.fixture(scope="module")
def s():
    ss = requests.Session()
    # Demo admin fallback works; try login anyway
    try:
        ss.post(f"{BASE}/auth/login", json={"email": "admin@nexus.com", "password": "admin123"}, timeout=15)
    except Exception:
        pass
    return ss


# ---- Trendyol live connection + sync ----
class TestTrendyolLive:
    def test_test_connection(self, s):
        r = s.post(f"{BASE}/integrations/ecommerce/{CH_ID}/test-connection", timeout=60)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("status") == "success", j
        assert j.get("live") is True, j
        assert "doğrulandı" in j.get("message", "")

    def test_sync_now_14d(self, s):
        r = s.post(f"{BASE}/integrations/ecommerce/{CH_ID}/sync-now", params={"days": 14}, timeout=120)
        assert r.status_code == 200, r.text
        j = r.json()
        assert j.get("live") is True, j
        assert "canlı senkron" in j.get("message", ""), j.get("message")
        # store counts to compare on 2nd sync
        pytest.trendyol_first = j

    def test_orders_contains_real_order(self, s):
        r = s.get(f"{BASE}/orders", params={"company_id": COMPANY}, timeout=30)
        assert r.status_code == 200
        orders = r.json()
        ty = [o for o in orders if o.get("channel") == "trendyol"]
        assert len(ty) > 0, "Trendyol siparişi bulunamadı"
        found = next((o for o in ty if str(o.get("order_number")) == REAL_ORDER_NUMBER), None)
        assert found is not None, f"Gerçek sipariş {REAL_ORDER_NUMBER} bulunamadı"
        assert found.get("source") == "marketplace_sync"
        assert not found.get("is_simulated"), "Gerçek sipariş is_simulated olmamalı"
        # Expected fields from mapping
        for k in ("marketplace_status", "cargo_carrier_name", "cargo_tracking_number", "shipment_package_id"):
            assert k in found, f"Alan eksik: {k}"
        assert isinstance(found.get("items"), list) and len(found["items"]) > 0
        assert "barcode" in found["items"][0]
        pytest.real_order_id = found["_id"] if "_id" in found else found.get("id")

    def test_sync_idempotent(self, s):
        r = s.post(f"{BASE}/integrations/ecommerce/{CH_ID}/sync-now", params={"days": 14}, timeout=120)
        assert r.status_code == 200
        j = r.json()
        assert j.get("inserted", 0) == 0, f"İkinci sync'te mükerrer insert oldu: {j}"
        assert j.get("updated", 0) >= 1, j

    def test_sync_45days_no_error(self, s):
        r = s.post(f"{BASE}/integrations/ecommerce/{CH_ID}/sync-now", params={"days": 45}, timeout=180)
        assert r.status_code == 200, r.text
        assert r.json().get("live") is True


# ---- Marketplace claims / questions ----
class TestMarketplacePanels:
    def test_claims_list(self, s):
        r = s.get(f"{BASE}/marketplace/claims", params={"company_id": COMPANY}, timeout=20)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_questions_list(self, s):
        r = s.get(f"{BASE}/marketplace/questions", params={"company_id": COMPANY}, timeout=20)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_answer_short_400(self, s):
        r = s.post(f"{BASE}/marketplace/questions/nonexistent_id/answer", json={"text": "kısa"}, timeout=20)
        assert r.status_code == 400

    def test_answer_nonexistent_404(self, s):
        r = s.post(f"{BASE}/marketplace/questions/nonexistent_id/answer",
                   json={"text": "Merhaba, ürün stoklarımızda mevcut, en kısa sürede kargoya vereceğiz."},
                   timeout=20)
        assert r.status_code == 404

    def test_approve_claim_404(self, s):
        r = s.post(f"{BASE}/marketplace/claims/nonexistent_id/approve", json={}, timeout=20)
        assert r.status_code == 404


# ---- Order deletion + bulk + mark labels ----
class TestOrderDeletion:
    @pytest.fixture(scope="class")
    def two_orders(self, s):
        created = []
        for i in range(2):
            r = s.post(f"{BASE}/orders", json={
                "company_id": COMPANY, "channel": "b2b", "customer_name": f"TEST_it24_{i}",
                "shipping_address": "TEST addr", "city": "İstanbul",
                "items": [{"product_id": "prod_test", "sku": "TST", "product_name": "Test", "quantity": 1, "unit_price": 10, "total": 10}],
                "total_amount": 10.0
            }, timeout=20)
            assert r.status_code in (200, 201), r.text
            j = r.json()
            oid = j.get("_id") or j.get("id")
            assert oid
            created.append(oid)
        yield created
        # cleanup any survivors
        for oid in created:
            try:
                s.delete(f"{BASE}/orders/{oid}", timeout=10)
            except Exception:
                pass

    def test_single_delete(self, s, two_orders):
        r = s.delete(f"{BASE}/orders/{two_orders[0]}", timeout=15)
        assert r.status_code == 200, r.text
        # verify gone
        gr = s.get(f"{BASE}/orders", params={"company_id": COMPANY}, timeout=20)
        ids = [o.get("_id") or o.get("id") for o in gr.json()]
        assert two_orders[0] not in ids

    def test_bulk_delete(self, s, two_orders):
        r = s.post(f"{BASE}/orders/bulk-delete", json={"ids": [two_orders[1]]}, timeout=20)
        assert r.status_code == 200
        j = r.json()
        assert j.get("deleted") == 1, j

    def test_invoiced_cannot_delete(self, s):
        # create + mark as invoiced directly is not exposed; simulate via orders endpoint
        r = s.post(f"{BASE}/orders", json={
            "company_id": COMPANY, "channel": "b2b", "customer_name": "TEST_it24_inv",
            "shipping_address": "TEST", "city": "İzmir",
            "items": [{"product_id": "prod_test", "sku": "X", "product_name": "X", "quantity": 1, "unit_price": 5, "total": 5}],
            "total_amount": 5.0, "is_invoiced": True
        }, timeout=15)
        if r.status_code not in (200, 201):
            pytest.skip("Order create failed")
        oid = r.json().get("_id") or r.json().get("id")
        try:
            d = s.delete(f"{BASE}/orders/{oid}", timeout=15)
            assert d.status_code == 400, d.text
        finally:
            # force cleanup via direct patch flag reset then delete
            requests.patch  # noop
            s.post(f"{BASE}/orders/{oid}/update" if False else f"{BASE}/orders/bulk-delete",
                   json={"ids": [oid]}, timeout=10)

    def test_mark_labels_printed(self, s):
        # Create a test order, mark labels, verify label_printed_at present
        r = s.post(f"{BASE}/orders", json={
            "company_id": COMPANY, "channel": "b2b", "customer_name": "TEST_it24_lbl",
            "shipping_address": "TEST", "city": "Bursa",
            "items": [{"product_id": "prod_test", "sku": "L", "product_name": "L", "quantity": 1, "unit_price": 1, "total": 1}],
            "total_amount": 1.0
        }, timeout=15)
        assert r.status_code in (200, 201)
        oid = r.json().get("_id") or r.json().get("id")
        try:
            m = s.post(f"{BASE}/orders/mark-labels-printed", json={"ids": [oid]}, timeout=15)
            assert m.status_code == 200
            assert m.json().get("count") == 1
            g = s.get(f"{BASE}/orders", params={"company_id": COMPANY}, timeout=20)
            row = next((o for o in g.json() if (o.get("_id") or o.get("id")) == oid), None)
            assert row is not None
            assert row.get("label_printed_at"), "label_printed_at set edilmedi"
        finally:
            s.delete(f"{BASE}/orders/{oid}", timeout=10)
