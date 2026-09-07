"""Warehouse order pick / barcode match / missing notify / partial ship."""
import os
import uuid

import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "http://127.0.0.1:8000").rstrip("/")
API = BASE_URL + "/api"
COMPANY = "comp_nexus_main_01"
ADMIN_EMAIL = "admin@nexus.com"
ADMIN_PASS = "admin123"


def _admin():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20)
    assert r.status_code == 200, r.text
    return s


class TestOrderPickKiosk:
    def test_scan_match_mismatch_notify_partial(self):
        s = _admin()
        sku = f"PK{uuid.uuid4().hex[:8]}"
        barcode = f"869{uuid.uuid4().int % 10**10:010d}"
        p = s.post(f"{API}/products", json={"company_id": COMPANY, "name": "Pick Test Kalem", "sku": sku, "barcode": barcode, "sale_price": 10, "stock_quantity": 50}, timeout=20)
        assert p.status_code in (200, 201), p.text[:300]
        pid = p.json()["id"]
        o = s.post(f"{API}/orders", json={
            "company_id": COMPANY, "channel": "manual", "customer_name": "Depo Test Cari",
            "shipping_address": "Depo", "city": "İstanbul", "total_amount": 30, "order_status": "approved",
            "items": [{"product_id": pid, "product_name": "Pick Test Kalem", "sku": sku, "quantity": 3, "unit_price": 10, "total": 30}],
        }, timeout=20)
        assert o.status_code in (200, 201), o.text[:400]
        oid = o.json()["id"]
        on = o.json()["order_number"]

        lst = s.get(f"{API}/order-picks", params={"company_id": COMPANY}, timeout=20)
        assert lst.status_code == 200, lst.text[:200]
        assert any(r["id"] == oid for r in lst.json()), lst.json()[:3]

        opened = s.get(f"{API}/order-picks/{oid}", timeout=20)
        assert opened.status_code == 200, opened.text[:300]
        assert opened.json()["items"][0]["ordered_qty"] == 3

        bad = s.post(f"{API}/order-picks/{oid}/scan", json={"barcode": "NO-SUCH-BARCODE-999"}, timeout=20)
        assert bad.status_code == 404, bad.text[:200]

        ok = s.post(f"{API}/order-picks/{oid}/scan", json={"barcode": barcode}, timeout=20)
        assert ok.status_code == 200, ok.text[:300]
        assert ok.json()["items"][0]["picked_qty"] == 1

        sku_ok = s.post(f"{API}/order-picks/{oid}/scan", json={"barcode": sku}, timeout=20)
        assert sku_ok.status_code == 200, sku_ok.text[:200]
        assert sku_ok.json()["items"][0]["picked_qty"] == 2

        miss = s.post(f"{API}/order-picks/{oid}/notify-missing", timeout=20)
        assert miss.status_code == 200, miss.text[:300]
        assert miss.json()["missing"]
        notes = s.get(f"{API}/notifications", params={"company_id": COMPANY}, timeout=20)
        assert notes.status_code == 200
        assert any("Depo eksik" in (n.get("title") or "") and on in (n.get("message") or "") for n in notes.json())

        part = s.post(f"{API}/order-picks/{oid}/complete", json={"mode": "partial"}, timeout=20)
        assert part.status_code == 200, part.text[:300]
        got = s.get(f"{API}/orders/{oid}", timeout=20)
        if got.status_code == 200:
            assert got.json().get("order_status") == "preparing"
            assert got.json().get("pick_status") == "partial"
        else:
            listed = s.get(f"{API}/orders", params={"company_id": COMPANY}, timeout=20).json()
            row = next(x for x in listed if x["id"] == oid)
            assert row["order_status"] == "preparing"

        prod = s.post(f"{API}/order-picks/{oid}/to-production", timeout=20)
        assert prod.status_code == 200, prod.text[:300]
        assert "skipped" in prod.json() or "created" in prod.json()
        again = s.post(f"{API}/order-picks/{oid}/to-production", timeout=20)
        assert again.status_code == 200
        assert again.json().get("created") == []

    def test_variant_scan_hits_matching_line(self):
        s = _admin()
        sku_a, sku_b = f"VA{uuid.uuid4().hex[:6]}", f"VB{uuid.uuid4().hex[:6]}"
        bar_a, bar_b = f"869{uuid.uuid4().int % 10**10:010d}", f"868{uuid.uuid4().int % 10**10:010d}"
        p = s.post(f"{API}/products", json={
            "company_id": COMPANY, "name": "Varyant Üst", "sku": f"P{uuid.uuid4().hex[:6]}",
            "sale_price": 10, "stock_quantity": 20,
            "variants": [{"sku": sku_a, "barcode": bar_a, "name": "Kırmızı"}, {"sku": sku_b, "barcode": bar_b, "name": "Mavi"}],
        }, timeout=20)
        assert p.status_code in (200, 201), p.text[:300]
        pid = p.json()["id"]
        o = s.post(f"{API}/orders", json={
            "company_id": COMPANY, "channel": "manual", "customer_name": "Varyant Test",
            "shipping_address": "Depo", "city": "İstanbul", "total_amount": 20, "order_status": "approved",
            "items": [
                {"product_id": pid, "product_name": "Varyant Üst Kırmızı", "sku": sku_a, "barcode": bar_a, "quantity": 1, "unit_price": 10, "total": 10},
                {"product_id": pid, "product_name": "Varyant Üst Mavi", "sku": sku_b, "barcode": bar_b, "quantity": 1, "unit_price": 10, "total": 10},
            ],
        }, timeout=20)
        assert o.status_code in (200, 201), o.text[:400]
        oid = o.json()["id"]
        s.get(f"{API}/order-picks/{oid}", timeout=20)
        first = s.post(f"{API}/order-picks/{oid}/scan", json={"barcode": bar_b}, timeout=20)
        assert first.status_code == 200, first.text[:300]
        items = first.json()["items"]
        assert items[0]["picked_qty"] == 0
        assert items[1]["picked_qty"] == 1
