"""POST /invoices/{id}/copy — aynı/farklı cari taslak + tedarikçi siparişi."""
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


def _contact(s, name):
    r = s.post(
        f"{API}/contacts",
        json={
            "company_id": COMPANY,
            "name": name,
            "type": "both",
            "tax_number_or_id": f"1{uuid.uuid4().int % 10**10:010d}",
        },
        timeout=20,
    )
    assert r.status_code in (200, 201), r.text[:400]
    return r.json()


def _draft_invoice(s, contact, suffix=""):
    r = s.post(
        f"{API}/invoices",
        json={
            "company_id": COMPANY,
            "invoice_type": "sales",
            "e_type": "e_archive",
            "contact_id": contact["id"],
            "contact_name": contact["name"],
            "status": "draft",
            "items": [
                {
                    "name": f"Kopya kalem {suffix}",
                    "quantity": 2,
                    "unit": "Adet",
                    "unit_price": 50,
                    "vat_rate": 20,
                    "total": 100,
                }
            ],
        },
        timeout=20,
    )
    assert r.status_code in (200, 201), r.text[:500]
    return r.json()


class TestInvoiceCopy:
    def test_same_contact_creates_draft(self):
        s = _admin()
        c = _contact(s, f"Kopya Cari {uuid.uuid4().hex[:6]}")
        src = _draft_invoice(s, c, "A")
        r = s.post(f"{API}/invoices/{src['id']}/copy", json={"mode": "same_contact"}, timeout=20)
        assert r.status_code == 200, r.text[:500]
        body = r.json()
        assert body["kind"] == "invoice"
        inv = body["invoice"]
        assert inv["id"] != src["id"]
        assert inv["status"] == "draft"
        assert inv["contact_id"] == c["id"]
        assert len(inv.get("items") or []) == 1
        assert inv.get("copied_from") == src["id"]
        s.delete(f"{API}/invoices/{src['id']}", timeout=15)
        s.delete(f"{API}/invoices/{inv['id']}", timeout=15)

    def test_different_contact(self):
        s = _admin()
        a = _contact(s, f"Kaynak {uuid.uuid4().hex[:6]}")
        b = _contact(s, f"Hedef {uuid.uuid4().hex[:6]}")
        src = _draft_invoice(s, a, "B")
        r = s.post(
            f"{API}/invoices/{src['id']}/copy",
            json={"mode": "different_contact", "contact_id": b["id"]},
            timeout=20,
        )
        assert r.status_code == 200, r.text[:500]
        inv = r.json()["invoice"]
        assert inv["contact_id"] == b["id"]
        assert inv["contact_name"] == b["name"]
        s.delete(f"{API}/invoices/{src['id']}", timeout=15)
        s.delete(f"{API}/invoices/{inv['id']}", timeout=15)

    def test_to_supplier_order(self):
        s = _admin()
        c = _contact(s, f"Tedarikçi {uuid.uuid4().hex[:6]}")
        src = _draft_invoice(s, c, "C")
        r = s.post(
            f"{API}/invoices/{src['id']}/copy",
            json={"mode": "to_supplier_order", "contact_id": c["id"]},
            timeout=20,
        )
        assert r.status_code == 200, r.text[:500]
        body = r.json()
        assert body["kind"] == "purchase_order"
        po = body["purchase_order"]
        assert po.get("order_number", "").startswith("VSP-")
        assert po["contact_id"] == c["id"]
        assert len(po.get("items") or []) == 1
        s.delete(f"{API}/invoices/{src['id']}", timeout=15)
        s.delete(f"{API}/purchase-orders/{po['id']}", timeout=15)
