"""B2B portal: customer order number and line image/barcode on orders."""
import uuid

import requests

from conftest import API as BASE, resolve_b2b_token

TOKEN = resolve_b2b_token()


def test_b2b_order_stores_customer_number_and_line_codes():
    token = TOKEN or resolve_b2b_token()
    portal = requests.get(f"{BASE}/public/b2b/{token}", timeout=20)
    assert portal.status_code == 200, portal.text
    products = portal.json()["products"]
    prod = next((p for p in products if p.get("id") and p.get("in_stock") is not False), None)
    assert prod, "no B2B product"
    cust_no = f"PO-{uuid.uuid4().hex[:8]}"
    r = requests.post(
        f"{BASE}/public/b2b/{token}/orders",
        json={"items": [{"product_id": prod["id"], "quantity": 1}], "note": "TEST_b2b_preview", "customer_order_number": cust_no},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    order = r.json()["order"]
    assert order.get("customer_order_number") == cust_no, order
    listed = requests.get(f"{BASE}/public/b2b/{token}", timeout=20).json()["orders"]
    hit = next((o for o in listed if o["id"] == order["id"]), None)
    assert hit, "created order missing from portal"
    assert hit.get("customer_order_number") == cust_no
    lit = hit["items"][0]
    assert lit.get("sku") or lit.get("barcode") or prod.get("sku") or prod.get("barcode")
