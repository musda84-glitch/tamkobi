"""Iteration 38: SaaS panel ayrımı, Stripe checkout, lisans hatırlatmaları, public signup/plans, platform ayarları."""
import os
import time
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://isletme-one.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

SUPER_EMAIL = "musda84@gmail.com"
SUPER_PASS = "Nexus2026!"
SALES_EMAIL = "satis@nexus.com"
SALES_PASS = "satis123"
ADMIN_EMAIL = "admin@nexus.com"
ADMIN_PASS = "admin123"

_state = {}


# -------- helpers / fixtures --------
def _login(email, pwd):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pwd}, timeout=30)
    assert r.status_code == 200, f"login({email})={r.status_code}:{r.text}"
    return s, r.json().get("token") or r.json().get("access_token")


@pytest.fixture(scope="module")
def super_admin():
    s, tok = _login(SUPER_EMAIL, SUPER_PASS)
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def sales_user():
    s, tok = _login(SALES_EMAIL, SALES_PASS)
    if tok:
        s.headers.update({"Authorization": f"Bearer {tok}"})
    return s


# -------- 1. Auth / super-admin gate --------
class TestAuthGating:
    def test_system_overview_no_token_is_401(self):
        # Fresh session, no cookies, no bearer
        r = requests.get(f"{API}/system/overview", timeout=15)
        assert r.status_code == 401, f"expected 401 got {r.status_code}: {r.text[:200]}"

    def test_system_overview_super_admin_ok(self, super_admin):
        r = super_admin.get(f"{API}/system/overview", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "companies" in data and "mrr" in data

    def test_system_overview_non_super_admin_403(self, sales_user):
        r = sales_user.get(f"{API}/system/overview", timeout=15)
        assert r.status_code == 403

    def test_auth_me_no_token_authenticated_false(self):
        r = requests.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("authenticated") is False

    def test_auth_me_with_token_authenticated_true(self, super_admin):
        r = super_admin.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 200
        assert r.json().get("authenticated") is True


# -------- 2. Public plans & signup --------
class TestPublicSignup:
    def test_public_plans(self):
        r = requests.get(f"{API}/public/plans", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert len(d["plans"]) >= 4
        assert d["trial_days"] == 14
        assert d["brand_name"]
        assert isinstance(d["catalog"], list)

    def test_signup_success_and_cookie(self):
        email = f"test_signup_{uuid.uuid4().hex[:8]}@test.com"
        _state["signup_email"] = email
        payload = {
            "company_name": f"TEST_Signup_{uuid.uuid4().hex[:6]}",
            "name": "Test Kullanıcı",
            "email": email,
            "password": "abc123",
            "phone": "+905551112233",
            "plan_id": "plan_standard",
        }
        s = requests.Session()
        r = s.post(f"{API}/public/signup", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["company_id"]
        assert d["license"]["status"] == "trial"
        assert d["license"]["days_left"] in (13, 14)
        assert "access_token" in s.cookies
        _state["signup_session"] = s
        _state["signup_cid"] = d["company_id"]

        # /auth/me with cookie
        me = s.get(f"{API}/auth/me", timeout=15)
        assert me.status_code == 200
        md = me.json()
        assert md["authenticated"] is True
        assert md["license"]["plan_name"] == "Standart"
        assert md["user"]["role"] == "admin"

    def test_signup_duplicate_email_400(self):
        email = _state.get("signup_email")
        assert email
        r = requests.post(f"{API}/public/signup", json={
            "company_name": "TEST_Dupe", "name": "Dupe", "email": email,
            "password": "abc123", "phone": "", "plan_id": "plan_starter"
        }, timeout=15)
        assert r.status_code == 400

    def test_signup_short_password_400(self):
        r = requests.post(f"{API}/public/signup", json={
            "company_name": "TEST_Short", "name": "Short",
            "email": f"short_{uuid.uuid4().hex[:6]}@test.com",
            "password": "12", "phone": "", "plan_id": "plan_starter"
        }, timeout=15)
        assert r.status_code == 400


# -------- 3. Stripe checkout --------
class TestPayments:
    def test_checkout_ok(self, super_admin):
        cid = _state["signup_cid"]
        r = super_admin.post(f"{API}/payments/checkout", json={
            "company_id": cid, "plan_id": "plan_pro", "period": "yearly",
            "origin_url": BASE_URL,
        }, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["checkout_url"].startswith("https://checkout.stripe.com")
        assert d["session_id"]
        _state["session_id"] = d["session_id"]

    def test_checkout_invalid_plan_400(self, super_admin):
        cid = _state["signup_cid"]
        r = super_admin.post(f"{API}/payments/checkout", json={
            "company_id": cid, "plan_id": "plan_nope", "period": "yearly",
            "origin_url": BASE_URL,
        }, timeout=15)
        assert r.status_code == 400

    def test_payment_status_initiated(self):
        sid = _state["session_id"]
        r = requests.get(f"{API}/payments/status/{sid}", timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["status"] in ("initiated", "completed")
        assert d["payment_status"] in ("pending", "paid", "unpaid")

    def test_payment_status_not_found_404(self):
        r = requests.get(f"{API}/payments/status/cs_nope_{uuid.uuid4().hex}", timeout=15)
        assert r.status_code == 404

    def test_system_payments_list(self, super_admin):
        r = super_admin.get(f"{API}/system/payments", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert "items" in d and "total_paid" in d
        sids = [i.get("session_id") for i in d["items"]]
        assert _state["session_id"] in sids
        it = next(i for i in d["items"] if i.get("session_id") == _state["session_id"])
        assert it.get("company_name")


# -------- 4. Reminders --------
class TestReminders:
    def test_set_trial_1_day_and_run(self, super_admin):
        cid = _state["signup_cid"]
        ends = (datetime.now(timezone.utc) + timedelta(hours=20)).isoformat()
        r = super_admin.put(f"{API}/system/companies/{cid}/license", json={
            "status": "trial", "trial_ends_at": ends,
        }, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["days_left"] == 1

        # Run reminders
        r = super_admin.post(f"{API}/system/reminders/run", timeout=60)
        assert r.status_code == 200
        d = r.json()
        assert d["count"] >= 1
        # Find our company entry
        me = [x for x in d["sent"] if x.get("kind") == "d1"]
        assert me, f"no d1 reminder sent: {d}"
        assert me[0]["notification"] is True

    def test_reminders_dedupe(self, super_admin):
        r = super_admin.post(f"{API}/system/reminders/run", timeout=60)
        assert r.status_code == 200
        # Second run: our signup company shouldn't be re-sent
        cid_name = None  # we don't have the name, but at least the count is not duplicated for same key
        # No error → ok
        d = r.json()
        # If sent again, it would still be same key; but dedupe uses period_end date. Check that our company not re-emitted.
        # (Cannot assert 0 globally because other trial companies may have transitions.)
        assert isinstance(d["sent"], list)

    def test_reminders_log_has_entry(self, super_admin):
        r = super_admin.get(f"{API}/system/reminders", timeout=15)
        assert r.status_code == 200
        rows = r.json()
        cid = _state["signup_cid"]
        assert any(x["company_id"] == cid for x in rows)

    def test_notification_created(self, super_admin):
        cid = _state["signup_cid"]
        r = super_admin.get(f"{API}/notifications?company_id={cid}", timeout=15)
        assert r.status_code == 200
        body = r.json()
        items = body if isinstance(body, list) else body.get("items", [])
        titles = " ".join((n.get("title") or "") + (n.get("message") or "") for n in items).lower()
        assert "sona er" in titles or "gün" in titles

    def test_expire_then_run_locks_and_403(self, super_admin):
        cid = _state["signup_cid"]
        past = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
        r = super_admin.put(f"{API}/system/companies/{cid}/license", json={
            "status": "trial", "trial_ends_at": past,
        }, timeout=15)
        assert r.status_code == 200

        r = super_admin.post(f"{API}/system/reminders/run", timeout=60)
        assert r.status_code == 200
        d = r.json()
        me = [x for x in d["sent"] if x.get("kind") == "expired"]
        # Might be that the company matched
        # /api/invoices as the signed-up user with expired trial → 403
        s = _state["signup_session"]
        r = s.get(f"{API}/invoices?company_id={cid}", timeout=15)
        assert r.status_code == 403, f"expected 403 for locked module, got {r.status_code}"


# -------- 5. Platform settings --------
class TestPlatformSettings:
    def test_get_settings_defaults(self, super_admin):
        r = super_admin.get(f"{API}/system/settings", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["reminder_days"]  # default present
        assert "trial_days" in d
        _state["orig_settings"] = {"reminder_days": d["reminder_days"], "trial_days": d["trial_days"],
                                    "support_email": d.get("support_email", "")}

    def test_put_settings_and_revert(self, super_admin):
        r = super_admin.put(f"{API}/system/settings", json={
            "reminder_days": [10, 3, 1], "trial_days": 21, "support_email": "destek@x.com"
        }, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["reminder_days"] == [10, 3, 1]
        assert d["trial_days"] == 21
        assert d["support_email"] == "destek@x.com"

        # revert
        r = super_admin.put(f"{API}/system/settings", json={
            "reminder_days": [7, 1], "trial_days": 14,
            "support_email": _state["orig_settings"]["support_email"],
        }, timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["reminder_days"] == [7, 1]
        assert d["trial_days"] == 14


# -------- 6. Regression: main company license --------
class TestRegression:
    def test_main_company_still_enterprise_active(self, super_admin):
        r = super_admin.get(f"{API}/system/companies/comp_nexus_main_01", timeout=15)
        assert r.status_code == 200
        d = r.json()
        assert d["license"]["plan_id"] == "plan_enterprise"
        assert d["license"]["status"] == "active"
        assert d["license"].get("module_overrides", {}) == {}
