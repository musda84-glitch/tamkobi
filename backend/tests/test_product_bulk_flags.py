"""Toplu B2B / stok takibi kapatma."""
import os
import uuid

import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "http://127.0.0.1:8000").rstrip("/")
API = BASE_URL + "/api"
COMPANY = "comp_nexus_main_01"


def _create():
    sku = f"BLK_{uuid.uuid4().hex[:8]}"
    r = requests.post(
        f"{API}/products",
        json={
            "company_id": COMPANY,
            "name": f"TEST_bulk {sku}",
            "sku": sku,
            "category": "TEST",
            "unit": "Adet",
            "sale_price": 10,
            "purchase_price": 5,
            "vat_rate": 20,
            "stock_quantity": 3,
            "show_in_b2b": True,
            "track_stock": True,
        },
        timeout=20,
    )
    assert r.status_code == 200, r.text
    return r.json()


class TestProductBulkFlags:
    def test_bulk_close_b2b_and_track(self):
        a, b = _create(), _create()
        ids = [a["id"], b["id"]]
        empty = requests.post(f"{API}/products/bulk-flags", json={"show_in_b2b": False}, timeout=20)
        assert empty.status_code == 400

        r = requests.post(
            f"{API}/products/bulk-flags",
            json={"ids": ids, "company_id": COMPANY, "show_in_b2b": False, "track_stock": False},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("modified", 0) >= 1
        assert body.get("show_in_b2b") is False
        assert body.get("track_stock") is False

        for pid in ids:
            g = requests.get(f"{API}/products/{pid}", timeout=20)
            if g.status_code == 200:
                d = g.json()
            else:
                listed = requests.get(f"{API}/products?company_id={COMPANY}", timeout=20).json()
                rows = listed if isinstance(listed, list) else listed.get("items") or []
                d = next(x for x in rows if x.get("id") == pid)
            assert d.get("show_in_b2b") is False
            assert d.get("track_stock") is False

        opened = requests.post(
            f"{API}/products/bulk-flags",
            json={"ids": ids, "company_id": COMPANY, "show_in_b2b": True, "track_stock": True},
            timeout=20,
        )
        assert opened.status_code == 200, opened.text
        assert opened.json().get("show_in_b2b") is True
        assert opened.json().get("track_stock") is True
        for pid in ids:
            g = requests.get(f"{API}/products/{pid}", timeout=20)
            if g.status_code == 200:
                d = g.json()
            else:
                listed = requests.get(f"{API}/products?company_id={COMPANY}", timeout=20).json()
                rows = listed if isinstance(listed, list) else listed.get("items") or []
                d = next(x for x in rows if x.get("id") == pid)
            assert d.get("show_in_b2b") is True
            assert d.get("track_stock") is True
            requests.delete(f"{API}/products/{pid}", timeout=20)
