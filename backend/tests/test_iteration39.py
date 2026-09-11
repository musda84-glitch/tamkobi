"""Iteration 39: impersonation, PayTR provider/settings/session/callback, auto e-Archive subscription invoice."""
import base64
import hashlib
import hmac
import os

import pytest
import requests
from dotenv import dotenv_values

BASE = (os.environ.get("REACT_APP_BACKEND_URL") or dotenv_values("/app/frontend/.env").get("REACT_APP_BACKEND_URL") or "").rstrip("/")
assert BASE, "REACT_APP_BACKEND_URL missing"
SA_EMAIL = "musda84@gmail.com"
SA_PASS = "Nexus2026!"
ADMIN_EMAIL = "admin@nexus.com"
ADMIN_PASS = "admin123"
SALES_EMAIL = "satis@nexus.com"
SALES_PASS = "satis123"
TARGET_CID = "comp_nexus_b2b_02"
MAIN_CID = "comp_nexus_main_01"


def _login(email, pw):
    s = requests.Session()
    r = s.post(f"{BASE}/api/auth/login", json={"email": email, "password": pw}, timeout=20)
    assert r.status_code == 200, f"login {email} -> {r.status_code} {r.text[:200]}"
    return s


@pytest.fixture(scope="module")
def sa():
    return _login(SA_EMAIL, SA_PASS)


@pytest.fixture(scope="module")
def sales():
    return _login(SALES_EMAIL, SALES_PASS)


# ---------------- Impersonation ----------------
class TestImpersonation:
    def test_impersonate_no_token(self):
        r = requests.post(f"{BASE}/api/system/companies/{TARGET_CID}/impersonate", timeout=20)
        assert r.status_code == 401, r.text[:200]

    def test_impersonate_non_super(self, sales):
        r = sales.post(f"{BASE}/api/system/companies/{TARGET_CID}/impersonate", timeout=20)
        assert r.status_code == 403, r.text[:200]

    def test_impersonate_unknown_company(self, sa):
        r = sa.post(f"{BASE}/api/system/companies/comp_does_not_exist/impersonate", timeout=20)
        assert r.status_code in (400, 404), r.text[:200]

    def test_impersonate_flow(self):
        s = _login(SA_EMAIL, SA_PASS)
        # save panel cookie
        r = s.post(f"{BASE}/api/system/companies/{TARGET_CID}/impersonate", timeout=20)
        assert r.status_code == 200, r.text[:200]
        data = r.json()
        assert "message" in data and data.get("company_name")
        # new access_token cookie set
        assert s.cookies.get("access_token") is not None
        assert s.cookies.get("sa_return") is not None
        # /auth/me now returns target company admin
        me = s.get(f"{BASE}/api/auth/me", timeout=20).json()
        assert me["user"]["email"] == ADMIN_EMAIL, me
        assert (me.get("impersonation") or {}).get("by") == SA_EMAIL, me
        # exit
        r = s.post(f"{BASE}/api/auth/impersonate/exit", timeout=20)
        assert r.status_code == 200
        assert r.json().get("redirect") == "/sistem/sirketler"
        me2 = s.get(f"{BASE}/api/auth/me", timeout=20).json()
        assert me2["user"]["email"] == SA_EMAIL, me2
        assert not me2.get("impersonation"), me2


# ---------------- PayTR ----------------
class TestPaytr:
    def test_providers_paytr_disabled_initially(self, sa):
        # ensure disabled first
        sa.put(f"{BASE}/api/system/paytr", json={"enabled": False}, timeout=20)
        r = requests.get(f"{BASE}/api/payments/providers", timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d["stripe"] is True
        assert d["paytr"] is False

    def test_paytr_session_when_disabled(self):
        r = requests.post(f"{BASE}/api/payments/paytr/session",
                          json={"company_id": MAIN_CID, "plan_id": "plan_pro", "period": "monthly"},
                          timeout=20)
        assert r.status_code == 400
        assert "aktif değil" in r.text.lower() or "aktif degil" in r.text.lower()

    def test_get_paytr_initial(self, sa):
        r = sa.get(f"{BASE}/api/system/paytr", timeout=20)
        assert r.status_code == 200
        d = r.json()
        assert d["enabled"] is False
        # has_key may be True from prior test runs, don't strictly assert False

    def test_enable_without_creds_fails(self, sa):
        # First wipe by not being able to; try enabling only. If server already has creds from prior runs,
        # it may succeed. So set an isolated bad state: PUT enable + empty is a no-op for creds. To force
        # 400 we clear via nothing - but there's no clear endpoint. So we test enable=True alone: if has_key
        # is already true from prior runs, it may pass. Handle both.
        cur = sa.get(f"{BASE}/api/system/paytr", timeout=20).json()
        r = sa.put(f"{BASE}/api/system/paytr", json={"enabled": True}, timeout=20)
        if cur.get("has_key") and cur.get("has_salt") and cur.get("merchant_id"):
            # already had creds -> allowed
            assert r.status_code == 200
            # disable back
            sa.put(f"{BASE}/api/system/paytr", json={"enabled": False}, timeout=20)
        else:
            assert r.status_code == 400, r.text[:200]

    def test_put_paytr_creds(self, sa):
        r = sa.put(f"{BASE}/api/system/paytr", json={
            "merchant_id": "123456", "merchant_key": "testkey", "merchant_salt": "testsalt",
            "test_mode": True, "enabled": False
        }, timeout=20)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        assert d["has_key"] is True
        assert d["has_salt"] is True
        assert d["merchant_id"] == "123456"
        assert d["enabled"] is False

    def test_callback_bad_hash(self):
        r = requests.post(f"{BASE}/api/payments/paytr/callback",
                          data={"merchant_oid": "XYZ", "status": "success", "total_amount": "100", "hash": "yanlis"},
                          timeout=20)
        assert r.status_code == 400
        assert "invalid" in r.text.lower()

    def test_callback_correct_hash_unknown_order(self):
        oid, status, total = "XYZUNKNOWN", "success", "100"
        msg = (oid + "testsalt" + status + total).encode()
        h = base64.b64encode(hmac.new(b"testkey", msg, hashlib.sha256).digest()).decode()
        r = requests.post(f"{BASE}/api/payments/paytr/callback",
                          data={"merchant_oid": oid, "status": status, "total_amount": total, "hash": h},
                          timeout=20)
        assert r.status_code == 404, r.text[:200]

    def test_cleanup_disable(self, sa):
        r = sa.put(f"{BASE}/api/system/paytr", json={"enabled": False}, timeout=20)
        assert r.status_code == 200
        assert r.json()["enabled"] is False


# ---------------- Auto-invoice from prior Stripe payments ----------------
class TestAutoInvoice:
    def test_subscription_invoice_present(self, sa):
        r = sa.get(f"{BASE}/api/invoices", params={"company_id": MAIN_CID, "type": "sales"}, timeout=20)
        assert r.status_code == 200
        items = r.json()
        subs = [i for i in items if i.get("source") == "subscription"]
        assert len(subs) >= 1, f"no subscription invoices found; got {len(items)} sales invoices"
        inv = subs[0]
        assert inv.get("invoice_number", "").startswith("ABN2026"), inv.get("invoice_number")
        assert inv.get("e_type") == "e_archive"
        assert inv.get("payment_status") == "paid"
        assert (inv.get("email_result") or {}).get("status") in ("sent", "failed", "skipped")

    def test_system_payments_has_invoice(self, sa):
        r = sa.get(f"{BASE}/api/system/payments", timeout=20)
        assert r.status_code == 200
        rows = r.json()
        # rows may be dict wrapper or list
        if isinstance(rows, dict):
            rows = rows.get("items", [])
        paid = [p for p in rows if p.get("payment_status") == "paid" and p.get("invoice_number")]
        assert len(paid) >= 1, f"no paid rows with invoice_number; total rows={len(rows)}"
        top = paid[0]
        assert top.get("invoice_number", "").startswith("ABN2026")
        # older records may not carry an explicit provider field; treat missing as stripe (frontend default)
        assert top.get("provider", "stripe") in ("stripe", "paytr")

    def test_payments_status_returns_invoice(self, sa):
        rows = sa.get(f"{BASE}/api/system/payments", timeout=20).json()
        if isinstance(rows, dict):
            rows = rows.get("items", [])
        paid = [p for p in rows if p.get("payment_status") == "paid" and p.get("invoice_number") and p.get("session_id")]
        if not paid:
            pytest.skip("no paid Stripe row with session_id")
        sid = paid[0]["session_id"]
        r = requests.get(f"{BASE}/api/payments/status/{sid}", timeout=20)
        assert r.status_code == 200, r.text[:200]
        d = r.json()
        assert d.get("invoice_number", "").startswith("ABN2026") or d.get("invoice_number") == paid[0]["invoice_number"]
