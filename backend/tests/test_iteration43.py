"""Iteration 43: order approve-only + B2B stock-note cart lines."""
import pytest
import requests

from conftest import API, TEST_COMPANY_ID, resolve_b2b_token
"""Partner payment source tests plus approve-without-cargo."""
"""Partner current-account as a payment source for avans, masraf, maaş, cari."""
import os
import uuid

import pytest
import requests

from conftest import API, TEST_COMPANY_ID

TIMEOUT = 40
COMPANY = TEST_COMPANY_ID


@pytest.fixture(scope="module")
def api():
    return requests.Session()


def _partners(api):
    r = api.get(f"{API}/banking/partners", params={"company_id": COMPANY}, timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    rows = r.json()
    assert rows, "no partners seeded"
    return rows


def _partner(api, pid="partner_01"):
    rows = _partners(api)
    return next((p for p in rows if p["id"] == pid), rows[0])


class TestPartnerPaymentSource:
    def test_bonus_advance_via_partner_and_delete_restores(self, api):
        p = _partner(api)
        before = float(p.get("balance") or 0)
        withdrawn = float(p.get("total_withdrawn") or 0)
        r = api.post(f"{API}/personnel/bonuses", json={
            "employee_id": "emp_01", "type": "advance", "amount": 37.5,
            "partner_id": p["id"], "period": "2097-03", "note": "IT43 partner avans",
        }, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "paid"
        assert d["partner_id"] == p["id"]
        assert "Ortak" in (d.get("account_name") or "")
        p2 = _partner(api, p["id"])
        assert p2["balance"] == pytest.approx(before - 37.5, abs=0.01)
        assert p2["total_withdrawn"] == pytest.approx(withdrawn + 37.5, abs=0.01)
        ptx = api.get(f"{API}/banking/partners/transactions", params={"company_id": COMPANY, "partner_id": p["id"]}, timeout=TIMEOUT).json()
        assert any(t.get("bonus_id") == d["id"] or "IT43" in (t.get("description") or "") or "Avans" in (t.get("description") or "") for t in ptx)
        dr = api.delete(f"{API}/personnel/bonuses/{d['id']}", timeout=TIMEOUT)
        assert dr.status_code == 200, dr.text
        p3 = _partner(api, p["id"])
        assert p3["balance"] == pytest.approx(before, abs=0.01)
        assert p3["total_withdrawn"] == pytest.approx(withdrawn, abs=0.01)

    def test_expense_pay_via_partner_unpay_restores(self, api):
        p = _partner(api)
        before = float(p.get("balance") or 0)
        created = api.post(f"{API}/expenses", json={
            "company_id": COMPANY, "description": "IT43 partner masraf", "category": "Personel Masrafı",
            "amount": 80, "vat_rate": 0,
        }, timeout=TIMEOUT)
        assert created.status_code == 200, created.text
        exp = created.json()
        assert exp["payment_status"] == "unpaid"
        pay = api.post(f"{API}/expenses/{exp['id']}/pay", json={"partner_id": p["id"]}, timeout=TIMEOUT)
        assert pay.status_code == 200, pay.text
        paid = pay.json()
        assert paid["payment_status"] == "paid"
        assert paid["partner_id"] == p["id"]
        assert paid.get("account_id") in (None, "")
        p2 = _partner(api, p["id"])
        assert p2["balance"] == pytest.approx(before - 80, abs=0.01)
        unpay = api.post(f"{API}/expenses/{exp['id']}/unpay", timeout=TIMEOUT)
        assert unpay.status_code == 200, unpay.text
        p3 = _partner(api, p["id"])
        assert p3["balance"] == pytest.approx(before, abs=0.01)
        api.delete(f"{API}/expenses/{exp['id']}", timeout=TIMEOUT)

    def test_expense_create_paid_from_partner(self, api):
        p = _partner(api)
        before = float(p.get("balance") or 0)
        r = api.post(f"{API}/expenses", json={
            "company_id": COMPANY, "description": "IT43 partner kira", "category": "Kira",
            "amount": 12, "vat_rate": 0, "partner_id": p["id"],
        }, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        exp = r.json()
        assert exp["payment_status"] == "paid"
        assert exp["partner_id"] == p["id"]
        p2 = _partner(api, p["id"])
        assert p2["balance"] == pytest.approx(before - 12, abs=0.01)
        api.delete(f"{API}/expenses/{exp['id']}", timeout=TIMEOUT)
        p3 = _partner(api, p["id"])
        assert p3["balance"] == pytest.approx(before, abs=0.01)

    def test_contact_collect_via_partner(self, api):
        p = _partner(api)
        before = float(p.get("balance") or 0)
        name = f"IT43 Cari {uuid.uuid4().hex[:6]}"
        cr = api.post(f"{API}/contacts", json={"company_id": COMPANY, "name": name, "type": "customer", "tax_number_or_id": f"VKN{uuid.uuid4().hex[:8]}"}, timeout=TIMEOUT)
        assert cr.status_code == 200, cr.text
        cid = cr.json()["id"]
        ov = api.get(f"{API}/contacts/{cid}/overview", timeout=TIMEOUT).json()
        c_before = float(ov["contact"].get("balance") or 0)
        r = api.post(f"{API}/contacts/{cid}/record-payment", json={
            "partner_id": p["id"], "type": "inflow", "amount": 15, "description": "IT43 tahsilat",
        }, timeout=TIMEOUT)
        assert r.status_code == 200, r.text
        assert r.json()["via"] == "partner"
        p2 = _partner(api, p["id"])
        assert p2["balance"] == pytest.approx(before - 15, abs=0.01)
        ov2 = api.get(f"{API}/contacts/{cid}/overview", timeout=TIMEOUT).json()
        assert ov2["contact"]["balance"] == pytest.approx(c_before - 15, abs=0.01)
        assert any(x.get("source") == "partner" and x.get("amount") == 15 for x in ov2["payments"])
        ptxs = api.get(f"{API}/banking/partners/transactions", params={"company_id": COMPANY, "partner_id": p["id"]}, timeout=TIMEOUT).json()
        tx = next(t for t in ptxs if t.get("contact_id") == cid or "IT43 tahsilat" in (t.get("description") or ""))
        api.delete(f"{API}/banking/partners/transactions/{tx['id']}", timeout=TIMEOUT)
        api.delete(f"{API}/contacts/{cid}", timeout=TIMEOUT)
        p3 = _partner(api, p["id"])
        assert p3["balance"] == pytest.approx(before, abs=0.01)

    def test_pay_expense_requires_target(self, api):
        created = api.post(f"{API}/expenses", json={
            "company_id": COMPANY, "description": "IT43 no target", "category": "Diğer", "amount": 9, "vat_rate": 0,
        }, timeout=TIMEOUT)
        assert created.status_code == 200
        eid = created.json()["id"]
        r = api.post(f"{API}/expenses/{eid}/pay", json={}, timeout=TIMEOUT)
        assert r.status_code == 400
        api.delete(f"{API}/expenses/{eid}", timeout=TIMEOUT)


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


class TestApproveWithoutCargo:
    created = []

    @pytest.fixture(scope="class", autouse=True)
    def _cleanup(self, client):
        yield
        for oid in self.created:
            client.delete(f"{API}/orders/{oid}")

    def test_approve_empty_body_sets_approved_not_cargo(self, client):
        r = client.post(f"{API}/orders", json={
            "company_id": TEST_COMPANY_ID,
            "channel": "b2b",
            "customer_name": "TEST_it43 approve-only",
            "shipping_address": "TEST addr",
            "city": "İstanbul",
            "items": [{
                "product_id": "prod_01",
                "product_name": "TEST ürün",
                "sku": "NX-BT-PRO",
                "quantity": 1,
                "unit_price": 100,
                "total": 100,
                "vat_rate": 20,
            }],
            "total_amount": 120,
        })
        assert r.status_code in (200, 201), r.text
        order = r.json()
        order = order.get("order", order)
        oid = order["id"]
        self.created.append(oid)
        assert order.get("order_status") == "pending"
        assert not order.get("cargo_carrier")
        assert not order.get("cargo_tracking_number")

        r = client.post(f"{API}/orders/{oid}/approve", json={})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["order_status"] in ("approved", "Onaylandı")
        assert not d.get("cargo_carrier")
        assert not d.get("cargo_tracking_number")


class TestB2BNoteLines:
    created_orders = []
    created_invoices = []

    @pytest.fixture(scope="class", autouse=True)
    def _cleanup(self, client):
        yield
        for iid in self.created_invoices:
            client.delete(f"{API}/invoices/{iid}")
        for oid in self.created_orders:
            client.delete(f"{API}/orders/{oid}")

    def test_different_notes_keep_separate_lines(self, client):
        token = resolve_b2b_token()
        r = client.post(
            f"{API}/public/b2b/{token}/orders",
            json={
                "items": [
                    {"product_id": "prod_01", "quantity": 1, "note": "  kırmızı kutu  "},
                    {"product_id": "prod_01", "quantity": 2, "note": "mavi kutu"},
                ],
                "note": "TEST_it43_notes",
            },
        )
        assert r.status_code == 200, r.text
        order = r.json()["order"]
        self.created_orders.append(order["id"])
        items = [it for it in order["items"] if it.get("product_id") == "prod_01"]
        assert len(items) == 2, items
        notes = {str(it.get("note") or "").strip() for it in items}
        assert notes == {"kırmızı kutu", "mavi kutu"}

    def test_missing_note_still_creates_order(self, client):
        token = resolve_b2b_token()
        r = client.post(
            f"{API}/public/b2b/{token}/orders",
            json={"items": [{"product_id": "prod_01", "quantity": 1}], "note": "TEST_it43_plain"},
        )
        assert r.status_code == 200, r.text
        order = r.json()["order"]
        self.created_orders.append(order["id"])
        assert len(order["items"]) == 1
        assert not (order["items"][0].get("note") or "").strip()

    def test_convert_to_invoice_copies_line_notes(self, client):
        token = resolve_b2b_token()
        r = client.post(
            f"{API}/public/b2b/{token}/orders",
            json={
                "items": [
                    {"product_id": "prod_01", "quantity": 1, "note": "fişte basılacak A"},
                    {"product_id": "prod_01", "quantity": 1, "note": "fişte basılacak B"},
                ],
                "note": "TEST_it43_invoice",
            },
        )
        assert r.status_code == 200, r.text
        oid = r.json()["order"]["id"]
        self.created_orders.append(oid)
        conv = client.post(f"{API}/orders/{oid}/convert-to-invoice", json={"e_type": "paper"})
        assert conv.status_code == 200, conv.text
        body = conv.json()
        assert body.get("status") == "success", body
        iid = body.get("invoice_id")
        assert iid
        self.created_invoices.append(iid)
        invs = client.get(f"{API}/invoices", params={"company_id": TEST_COMPANY_ID})
        assert invs.status_code == 200
        invoice = next((i for i in invs.json() if i["id"] == iid), None)
        assert invoice is not None
        notes = {str(it.get("note") or "").strip() for it in invoice.get("items") or []}
        assert "fişte basılacak A" in notes
        assert "fişte basılacak B" in notes
        assert len(invoice.get("items") or []) == 2
"""Iteration 43: B2B portal contact can change their own password."""
import os
import uuid
import pytest
import requests

def _load_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if not v:
        for path in ("/app/frontend/.env", "/workspace/frontend/.env"):
            try:
                for line in open(path):
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        v = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break
            except Exception:
                pass
            if v:
                break
    if not v:
        v = "http://127.0.0.1:8000"
    return v.rstrip("/")

BASE_URL = _load_url()
API = BASE_URL + "/api"
ADMIN_EMAIL = "admin@nexus.com"
ADMIN_PASS = "admin123"
B2B_EMAIL = "b2btest@musteri.com"
B2B_PASS = "b2b12345"


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20)
    assert r.status_code == 200, r.text
    return s


def _ensure_b2b(admin):
    r = admin.post(f"{API}/contacts/cnt_01/b2b-access", json={
        "enabled": True, "password": B2B_PASS, "login_email": B2B_EMAIL, "base_url": BASE_URL,
    }, timeout=20)
    assert r.status_code == 200, r.text
    lg = requests.post(f"{API}/public/b2b/login", json={"email": B2B_EMAIL, "password": B2B_PASS}, timeout=20)
    assert lg.status_code == 200, lg.text
    return lg.json()["token"]


def _restore_b2b(admin):
    admin.post(f"{API}/contacts/cnt_01/b2b-access", json={
        "enabled": True, "password": B2B_PASS, "login_email": B2B_EMAIL, "base_url": BASE_URL,
    }, timeout=20)


class TestIteration43:
    def test_portal_exposes_has_password_not_hash(self, admin):
        token = _ensure_b2b(admin)
        r = requests.get(f"{API}/public/b2b/{token}", timeout=20)
        assert r.status_code == 200, r.text
        contact = r.json()["contact"]
        assert contact["has_password"] is True
        assert "b2b_password_hash" not in contact
        assert "password_hash" not in contact
        assert "password" not in contact

    def test_unknown_token(self):
        r = requests.post(
            f"{API}/public/b2b/deadbeefdeadbeef/change-password",
            json={"current_password": B2B_PASS, "new_password": "newpass1"},
            timeout=20,
        )
        assert r.status_code == 404

    def test_wrong_current(self, admin):
        token = _ensure_b2b(admin)
        r = requests.post(
            f"{API}/public/b2b/{token}/change-password",
            json={"current_password": "definitely-wrong", "new_password": "newpass1"},
            timeout=20,
        )
        assert r.status_code == 400
        assert "hatalı" in (r.json().get("detail") or "").lower()

    def test_short_new_password(self, admin):
        token = _ensure_b2b(admin)
        r = requests.post(
            f"{API}/public/b2b/{token}/change-password",
            json={"current_password": B2B_PASS, "new_password": "123"},
            timeout=20,
        )
        assert r.status_code == 400

    def test_same_as_current(self, admin):
        token = _ensure_b2b(admin)
        r = requests.post(
            f"{API}/public/b2b/{token}/change-password",
            json={"current_password": B2B_PASS, "new_password": B2B_PASS},
            timeout=20,
        )
        assert r.status_code == 400

    def test_success_then_login(self, admin):
        token = _ensure_b2b(admin)
        new_pw = f"it43_{uuid.uuid4().hex[:8]}"
        try:
            r = requests.post(
                f"{API}/public/b2b/{token}/change-password",
                json={"current_password": B2B_PASS, "new_password": new_pw},
                timeout=20,
            )
            assert r.status_code == 200, r.text
            assert r.json().get("status") == "success"
            old = requests.post(f"{API}/public/b2b/login", json={"email": B2B_EMAIL, "password": B2B_PASS}, timeout=20)
            assert old.status_code == 401
            ok = requests.post(f"{API}/public/b2b/login", json={"email": B2B_EMAIL, "password": new_pw}, timeout=20)
            assert ok.status_code == 200, ok.text
            assert ok.json()["token"] == token
        finally:
            _restore_b2b(admin)
