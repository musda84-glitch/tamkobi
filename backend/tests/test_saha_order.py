"""Field salesperson tablet/phone orders — channel=saha."""
import pytest
import requests

from conftest import API as BASE, TEST_COMPANY_ID as CO

TIMEOUT = 30


@pytest.fixture(scope="module")
def s():
    return requests.Session()


def test_saha_order_create_persists_notes_and_contact(s):
    contacts = s.get(f"{BASE}/contacts", params={"company_id": CO}, timeout=TIMEOUT).json()
    contact = next((c for c in contacts if c.get("type") in ("customer", "both")), contacts[0])
    products = s.get(f"{BASE}/products", params={"company_id": CO}, timeout=TIMEOUT).json()
    product = next((p for p in products if (p.get("sale_price") or 0) > 0), products[0])
    qty = 2
    price = float(product.get("sale_price") or 10)
    payload = {
        "company_id": CO,
        "channel": "saha",
        "customer_name": contact["name"],
        "customer_phone": contact.get("phone") or "",
        "shipping_address": contact.get("address") or "Saha teslim",
        "city": contact.get("city") or "İstanbul",
        "contact_id": contact["id"],
        "notes": "TEST_saha tablet sipariş",
        "salesperson_name": "Saha Test",
        "order_status": "pending",
        "items": [{
            "product_id": product["id"],
            "product_name": product["name"],
            "sku": product.get("sku") or "",
            "quantity": qty,
            "unit_price": price,
            "total": qty * price,
        }],
        "total_amount": qty * price,
    }
    r = s.post(f"{BASE}/orders", json=payload, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["channel"] == "saha"
    assert d["order_number"].startswith("ORD-")
    assert d.get("contact_id") == contact["id"]
    assert d.get("notes") == "TEST_saha tablet sipariş"
    assert d.get("salesperson_name") == "Saha Test"
    assert d["total_amount"] == qty * price
    oid = d.get("id") or d.get("_id")

    listed = s.get(f"{BASE}/orders", params={"company_id": CO}, timeout=TIMEOUT).json()
    found = next((o for o in listed if (o.get("id") or o.get("_id")) == oid), None)
    assert found, "saha order missing from GET /orders"
    assert found["channel"] == "saha"

    profit = s.get(f"{BASE}/marketplace/profitability", params={"company_id": CO, "days": 7}, timeout=TIMEOUT)
    if profit.status_code == 200:
        ids = {o.get("id") or o.get("order_number") for o in profit.json().get("orders") or []}
        assert oid not in ids and d["order_number"] not in ids

    try:
        s.delete(f"{BASE}/orders/{oid}", timeout=15)
    except Exception:
        pass


def test_saha_channel_not_treated_as_marketplace_settlement(s):
    r = s.post(f"{BASE}/orders", json={
        "company_id": CO, "channel": "saha",
        "customer_name": "TEST_saha settlement skip",
        "shipping_address": "-", "city": "Ankara",
        "items": [{"product_id": "", "sku": "SAHA", "product_name": "TEST_saha kalem", "quantity": 1, "unit_price": 25, "total": 25}],
        "total_amount": 25.0,
    }, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("settlement") in (None, {}, []) or not d.get("settlement")
    oid = d.get("id") or d.get("_id")
    try:
        s.delete(f"{BASE}/orders/{oid}", timeout=15)
    except Exception:
        pass
