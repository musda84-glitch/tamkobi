"""Invoice line items copy product SKU/barcode so print preview can render stock barcodes."""
import os
import uuid

import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "http://127.0.0.1:8000").rstrip("/")
API = BASE_URL + "/api"
COMPANY = "comp_nexus_main_01"


def _sku():
    return f"DEL_{uuid.uuid4().hex[:8]}"


def test_create_invoice_copies_product_sku_and_barcode():
    sku = _sku()
    pr = requests.post(
        f"{API}/products",
        json={
            "company_id": COMPANY,
            "name": f"TEST_barcode {sku}",
            "sku": sku,
            "barcode": "8680001234567",
            "category": "TEST",
            "unit": "Adet",
            "sale_price": 95,
            "purchase_price": 50,
            "vat_rate": 20,
            "stock_quantity": 10,
        },
        timeout=20,
    )
    assert pr.status_code == 200, pr.text
    prod = pr.json()
    pid = prod["id"]
    try:
        r = requests.post(
            f"{API}/invoices",
            json={
                "company_id": COMPANY,
                "contact_id": "cnt_01",
                "contact_name": "TEST Cari",
                "invoice_type": "sales",
                "status": "draft",
                "items": [
                    {
                        "product_id": pid,
                        "name": prod["name"],
                        "quantity": 1,
                        "unit": "Adet",
                        "unit_price": 95,
                        "vat_rate": 20,
                        "total": 95,
                    }
                ],
            },
            timeout=20,
        )
        assert r.status_code == 200, r.text
        inv = r.json()
        item = inv["items"][0]
        assert item.get("sku") == sku, item
        assert item.get("barcode") == "8680001234567", item
        dr = requests.delete(f"{API}/invoices/{inv['id']}", timeout=20)
        assert dr.status_code == 200, dr.text
    finally:
        requests.delete(f"{API}/products/{pid}", timeout=20)
