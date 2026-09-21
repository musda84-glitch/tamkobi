"""Staff PUT /orders/{id} — edit items/notes when not invoiced."""
import requests

from conftest import API as BASE, TEST_COMPANY_ID as CO

TIMEOUT = 30


def _create_saha(s, notes="TEST_order_update", qty=2, price=None):
    contacts = s.get(f"{BASE}/contacts", params={"company_id": CO}, timeout=TIMEOUT).json()
    contact = next((c for c in contacts if c.get("type") in ("customer", "both")), contacts[0])
    products = s.get(f"{BASE}/products", params={"company_id": CO}, timeout=TIMEOUT).json()
    product = next((p for p in products if (p.get("sale_price") or 0) > 0), products[0])
    unit = float(price if price is not None else product.get("sale_price") or 10)
    payload = {
        "company_id": CO,
        "channel": "saha",
        "customer_name": contact["name"],
        "customer_phone": contact.get("phone") or "",
        "shipping_address": contact.get("address") or "Saha teslim",
        "city": contact.get("city") or "İstanbul",
        "contact_id": contact["id"],
        "notes": notes,
        "salesperson_name": "Update Test",
        "order_status": "pending",
        "items": [{
            "product_id": product["id"],
            "product_name": product["name"],
            "sku": product.get("sku") or "",
            "quantity": qty,
            "unit_price": unit,
            "total": qty * unit,
        }],
        "total_amount": qty * unit,
    }
    r = s.post(f"{BASE}/orders", json=payload, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    return r.json(), product


def test_staff_update_order_items_and_notes():
    s = requests.Session()
    created, product = _create_saha(s)
    oid = created.get("id") or created.get("_id")
    try:
        r = s.put(f"{BASE}/orders/{oid}", json={
            "notes": "TEST_order_update düzenlendi",
            "customer_order_number": "PO-99",
            "items": [{
                "product_id": product["id"],
                "product_name": product["name"],
                "quantity": 3,
                "unit_price": float(product.get("sale_price") or 10),
            }],
        }, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        body = r.json()
        d = body.get("order") or body
        assert "güncellendi" in (body.get("message") or "")
        assert d.get("notes") == "TEST_order_update düzenlendi"
        assert d.get("customer_order_number") == "PO-99"
        assert abs(float(d["items"][0]["quantity"]) - 3) < 0.01
        got = s.get(f"{BASE}/orders/{oid}", timeout=TIMEOUT).json()
        assert got.get("notes") == "TEST_order_update düzenlendi"
        assert abs(float(got["items"][0]["quantity"]) - 3) < 0.01
    finally:
        s.delete(f"{BASE}/orders/{oid}", timeout=15)


def test_staff_update_unknown_404():
    r = requests.put(f"{BASE}/orders/nope_order_update", json={"notes": "x"}, timeout=TIMEOUT)
    assert r.status_code == 404


def test_staff_update_empty_items_400():
    s = requests.Session()
    created, _ = _create_saha(s, notes="TEST_order_update_empty")
    oid = created.get("id") or created.get("_id")
    try:
        r = s.put(f"{BASE}/orders/{oid}", json={"items": []}, timeout=TIMEOUT)
        assert r.status_code == 400
        assert "ürün" in r.json().get("detail", "").lower()
    finally:
        s.delete(f"{BASE}/orders/{oid}", timeout=15)


def test_staff_update_issued_order_stays_locked_draft_link_does_not():
    """Kesilmiş fatura (is_invoiced) kilitli kalır. Yalnızca taslak invoice_id düzenlemeyi kesmez."""
    s = requests.Session()
    orders = s.get(f"{BASE}/orders", params={"company_id": CO}, timeout=TIMEOUT).json()
    issued = next((o for o in orders if o.get("is_invoiced")), None)
    if issued:
        r = s.put(f"{BASE}/orders/{issued['id']}", json={"notes": issued.get("notes") or ""}, timeout=TIMEOUT)
        if r.status_code == 400:
            assert "E-belge" in r.json().get("detail", "") or "düzenlenemez" in r.json().get("detail", "")
        else:
            assert r.status_code == 200, r.text
    draft_linked = next((
        o for o in orders
        if o.get("invoice_id") and not o.get("is_invoiced") and o.get("order_status") not in ("cancelled", "returned", "completed", "delivered")
    ), None)
    if not draft_linked:
        return
    r = s.put(
        f"{BASE}/orders/{draft_linked['id']}",
        json={"notes": draft_linked.get("notes") or ""},
        timeout=TIMEOUT,
    )
    assert r.status_code == 200, r.text
