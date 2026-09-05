"""Iteration 40: Subscription invoice PDF, renew link, reminders, public_url, withholding, print template."""
import os
import sys
import io
import pytest
import requests
from datetime import datetime, timezone, timedelta

def _load_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if not v:
        try:
            for line in open("/app/frontend/.env"):
                if line.startswith("REACT_APP_BACKEND_URL="):
                    v = line.split("=", 1)[1].strip()
                    break
        except Exception:
            pass
    if not v:
        raise RuntimeError("REACT_APP_BACKEND_URL not set")
    return v.rstrip("/")

BASE_URL = _load_url()
API = BASE_URL + "/api"

SUPER_EMAIL = "musda84@gmail.com"
SUPER_PASS = "Nexus2026!"
ADMIN_EMAIL = "admin@nexus.com"
ADMIN_PASS = "admin123"
MAIN_CID = "comp_nexus_main_01"
B2B_CID = "comp_nexus_b2b_02"


@pytest.fixture(scope="module")
def super_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": SUPER_EMAIL, "password": SUPER_PASS})
    assert r.status_code == 200, r.text
    return s


@pytest.fixture(scope="module")
def admin_session():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS})
    assert r.status_code == 200, r.text
    return s


# ============= (1) Subscription invoice PDF =============
class TestSubscriptionInvoicePDF:
    def test_get_subscription_invoice_pdf(self, admin_session):
        r = admin_session.get(f"{API}/invoices", params={"company_id": MAIN_CID, "type": "sales"})
        assert r.status_code == 200
        subs = [x for x in r.json() if x.get("source") == "subscription"]
        assert len(subs) > 0, "No subscription-source invoice present; iteration 38/39 should have created one"
        inv_id = subs[0]["id"]
        pdf = admin_session.get(f"{API}/invoices/{inv_id}/pdf")
        assert pdf.status_code == 200
        assert pdf.headers.get("content-type", "").startswith("application/pdf")
        assert len(pdf.content) > 10_000
        assert pdf.content[:4] == b"%PDF"

    def test_pdf_not_found(self, admin_session):
        r = admin_session.get(f"{API}/invoices/nonexistent_xxxxx/pdf")
        assert r.status_code == 404


# ============= (2) Renew link =============
class TestRenewLink:
    session_id = None

    def test_bad_token(self):
        r = requests.get(f"{API}/public/renew/not-a-real-token")
        assert r.status_code == 400

    def test_renew_info_and_checkout(self):
        # generate token via saas_docs
        sys.path.insert(0, "/app/backend")
        from dotenv import load_dotenv
        load_dotenv("/app/backend/.env")
        import saas_docs
        token = saas_docs.make_renew_token(B2B_CID, "plan_standard")
        r = requests.get(f"{API}/public/renew/{token}")
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["company"]["id"] == B2B_CID
        assert data["company"]["name"]
        assert data["plan"]["name"] == "Standart"
        assert len(data["plans"]) == 4
        assert "providers" in data and "stripe" in data["providers"]
        assert "catalog" in data
        assert data.get("license") is not None

        # Checkout with plan override (plan_pro)
        r2 = requests.post(f"{API}/public/renew/{token}/checkout", json={
            "period": "yearly",
            "plan_id": "plan_pro",
            "origin_url": "https://example.com",
        })
        assert r2.status_code == 200, r2.text
        d2 = r2.json()
        assert "checkout_url" in d2 or "url" in d2
        assert "session_id" in d2 or "sid" in d2 or "id" in d2
        sid = d2.get("session_id") or d2.get("sid") or d2.get("id")
        assert sid
        TestRenewLink.session_id = sid

        r3 = requests.get(f"{API}/payments/status/{sid}")
        assert r3.status_code == 200
        st = r3.json()
        # Stripe status; not paid yet
        assert st.get("payment_status") in ("unpaid", "pending", None) or st.get("status") in ("initiated", "pending", "unpaid", "open")


# ============= (3) Reminders =============
class TestReminders:
    def test_reminder_run_and_renew_link(self, super_session):
        expires = (datetime.now(timezone.utc) + timedelta(hours=20)).isoformat()
        r = super_session.put(f"{API}/system/companies/{B2B_CID}/license",
                              json={"status": "active", "expires_at": expires})
        assert r.status_code == 200, r.text

        run = super_session.post(f"{API}/system/reminders/run")
        assert run.status_code == 200

        rlist = super_session.get(f"{API}/system/reminders")
        assert rlist.status_code == 200
        data = rlist.json()
        items = data if isinstance(data, list) else data.get("items") or data.get("reminders") or []
        assert len(items) > 0
        # Latest should have renew_link true
        latest = items[0]
        result = latest.get("result") or {}
        assert result.get("renew_link") is True, f"latest: {latest}"

    def test_cleanup_b2b_license(self, super_session):
        r = super_session.put(f"{API}/system/companies/{B2B_CID}/license",
                              json={"status": "active", "expires_at": None})
        assert r.status_code == 200


# ============= (4) public_url =============
class TestPublicUrl:
    def test_set_and_clear_public_url(self, super_session):
        r = super_session.put(f"{API}/system/settings", json={"public_url": "https://ornek.com"})
        assert r.status_code == 200
        assert r.json().get("public_url") == "https://ornek.com"
        r2 = super_session.put(f"{API}/system/settings", json={"public_url": ""})
        assert r2.status_code == 200
        assert r2.json().get("public_url") == ""


# ============= (5) Withholding invoice =============
class TestWithholding:
    def test_draft_and_approved(self, admin_session):
        # pick an existing contact
        cr = admin_session.get(f"{API}/contacts", params={"company_id": MAIN_CID})
        assert cr.status_code == 200
        contacts = cr.json()
        assert contacts
        contact = contacts[0]
        contact_id = contact["id"]
        contact_name = contact.get("name", "TEST_Contact")
        balance_before = contact.get("balance", 0)

        today = datetime.now().date().isoformat()
        due = (datetime.now().date() + timedelta(days=15)).isoformat()

        payload = {
            "company_id": MAIN_CID,
            "invoice_type": "sales",
            "e_type": "paper",
            "status": "draft",
            "contact_id": contact_id,
            "contact_name": contact_name,
            "issue_date": today,
            "due_date": due,
            "items": [{"product_id": "", "name": "TEST_Danışmanlık hizmeti", "quantity": 1,
                       "unit": "Adet", "unit_price": 1000, "vat_rate": 20, "total": 1000,
                       "is_service": True}],
            "withholding_rate": 0.5,
            "withholding_code": "602",
        }
        r = admin_session.post(f"{API}/invoices", json=payload)
        assert r.status_code == 200, r.text
        inv = r.json()
        assert inv["subtotal"] == 1000
        assert inv["vat_total"] == 200
        assert inv["withholding_amount"] == 100
        assert inv["grand_total"] == 1100
        assert inv["status"] == "draft"

        def _bal():
            r = admin_session.get(f"{API}/contacts", params={"company_id": MAIN_CID})
            for c in r.json():
                if c["id"] == contact_id:
                    return c.get("balance", 0)
            return 0

        # balance unchanged for draft
        assert abs(_bal() - balance_before) < 0.01

        # Now approved
        payload["status"] = "approved"
        r2 = admin_session.post(f"{API}/invoices", json=payload)
        assert r2.status_code == 200, r2.text
        inv2 = r2.json()
        assert inv2["grand_total"] == 1100
        assert abs(_bal() - (balance_before + 1100)) < 0.01

        # cleanup: delete both test invoices and reset balance
        try:
            admin_session.delete(f"{API}/invoices/{inv['id']}")
            admin_session.delete(f"{API}/invoices/{inv2['id']}")
            admin_session.put(f"{API}/contacts/{contact_id}", json={"balance": balance_before})
        except Exception:
            pass


# ============= (6) Print template =============
class TestPrintTemplate:
    def test_get_put_order_template(self, admin_session):
        r = admin_session.get(f"{API}/companies/{MAIN_CID}/print-templates")
        assert r.status_code == 200
        orig = r.json().get("order", {})

        upd = admin_session.put(f"{API}/companies/{MAIN_CID}/print-templates/order",
                                json={"hide_all_prices": True, "show_order_notes": True})
        assert upd.status_code == 200
        got = upd.json()
        assert got.get("hide_all_prices") is True
        assert got.get("show_order_notes") is True

        # verify persistence
        r2 = admin_session.get(f"{API}/companies/{MAIN_CID}/print-templates")
        assert r2.json().get("order", {}).get("hide_all_prices") is True

        # revert
        rev = admin_session.put(f"{API}/companies/{MAIN_CID}/print-templates/order",
                                json={"hide_all_prices": False, "show_order_notes": orig.get("show_order_notes", True)})
        assert rev.status_code == 200
        assert rev.json().get("hide_all_prices") is False


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
