"""Stok kartı silme: kullanılmamış kart çöp kutusuna gider; işlem görmüş kart cari bakiyesini etkilemez."""
import os
import uuid

import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "http://127.0.0.1:8000").rstrip("/")
API = BASE_URL + "/api"
COMPANY = "comp_nexus_main_01"


def _sku():
    return f"DEL_{uuid.uuid4().hex[:8]}"


def _create_product():
    sku = _sku()
    r = requests.post(
        f"{API}/products",
        json={
            "company_id": COMPANY,
            "name": f"TEST_delete {sku}",
            "sku": sku,
            "category": "TEST",
            "unit": "Adet",
            "sale_price": 100,
            "purchase_price": 50,
            "vat_rate": 20,
            "stock_quantity": 10,
        },
        timeout=20,
    )
    assert r.status_code == 200, r.text
    return r.json()


class TestProductDelete:
    def test_unused_product_goes_to_trash(self):
        prod = _create_product()
        pid = prod["id"]
        r = requests.delete(f"{API}/products/{pid}", timeout=20)
        assert r.status_code == 200, r.text
        assert requests.get(f"{API}/products/{pid}", timeout=20).status_code == 404
        trash = requests.get(f"{API}/trash", params={"company_id": COMPANY, "entity_type": "product"}, timeout=20).json()
        entry = next((x for x in trash.get("items") or [] if x.get("original_id") == pid), None)
        assert entry is not None
        requests.delete(f"{API}/trash/{entry['id']}", timeout=20)

    def test_used_on_invoice_blocked_and_cari_unchanged(self):
        prod = _create_product()
        pid = prod["id"]
        r = requests.post(
            f"{API}/contacts",
            json={"company_id": COMPANY, "type": "customer", "name": f"TEST_del_cari_{pid[:8]}", "tax_number_or_id": "22222222222"},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        contact = r.json()
        cid = contact["id"]
        bal0 = float(contact.get("balance") or 0)

        r = requests.post(
            f"{API}/invoices",
            json={
                "company_id": COMPANY,
                "contact_id": cid,
                "contact_name": contact["name"],
                "invoice_type": "sales",
                "status": "approved",
                "items": [{"product_id": pid, "name": prod["name"], "quantity": 1, "unit": "Adet", "unit_price": 100, "vat_rate": 20, "total": 100}],
            },
            timeout=20,
        )
        assert r.status_code == 200, r.text
        inv = r.json()
        iid = inv["id"]

        contacts = requests.get(f"{API}/contacts", params={"company_id": COMPANY}, timeout=20).json()
        after = next(x for x in contacts if x["id"] == cid)
        bal1 = float(after.get("balance") or 0)
        assert round(bal1 - bal0, 2) == round(float(inv.get("grand_total") or 120), 2)

        r = requests.delete(f"{API}/products/{pid}", timeout=20)
        assert r.status_code == 400, r.text
        detail = (r.json().get("detail") or "").lower()
        assert "silinemez" in detail
        assert "cari" in detail

        still = requests.get(f"{API}/products/{pid}", timeout=20)
        assert still.status_code == 200, still.text
        assert still.json()["id"] == pid

        contacts2 = requests.get(f"{API}/contacts", params={"company_id": COMPANY}, timeout=20).json()
        after2 = next(x for x in contacts2 if x["id"] == cid)
        assert round(float(after2.get("balance") or 0), 2) == round(bal1, 2)

        r = requests.delete(f"{API}/invoices/{iid}", timeout=20)
        assert r.status_code == 400

    def test_used_on_order_blocked(self):
        prod = _create_product()
        pid = prod["id"]
        r = requests.post(
            f"{API}/orders",
            json={
                "company_id": COMPANY,
                "channel": "manual",
                "customer_name": "TEST_del order cust",
                "shipping_address": "test",
                "city": "İstanbul",
                "items": [{"product_id": pid, "sku": prod["sku"], "product_name": prod["name"], "quantity": 1, "unit_price": 100, "total": 100}],
                "total_amount": 100.0,
            },
            timeout=20,
        )
        assert r.status_code == 200, r.text
        oid = r.json()["id"]
        r = requests.delete(f"{API}/products/{pid}", timeout=20)
        assert r.status_code == 400, r.text
        assert "sipariş" in (r.json().get("detail") or "").lower()
        assert requests.get(f"{API}/products/{pid}", timeout=20).status_code == 200
        requests.delete(f"{API}/orders/{oid}", timeout=20)
        r = requests.delete(f"{API}/products/{pid}", timeout=20)
        assert r.status_code == 200, r.text
        trash = requests.get(f"{API}/trash", params={"company_id": COMPANY, "entity_type": "product"}, timeout=20).json()
        entry = next((x for x in trash.get("items") or [] if x.get("original_id") == pid), None)
        if entry:
            requests.delete(f"{API}/trash/{entry['id']}", timeout=20)
