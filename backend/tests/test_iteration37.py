"""Iteration 37 backend tests: SaaS System Admin + Inbound e-Documents.

Covers:
- Super admin login + license/is_super_admin in /auth/me
- 403 for non-super-admin on /api/system/*
- system overview, modules, plans, companies
- Plan CRUD
- Company creation w/ trial license
- Module toggle (enable/disable ecommerce) w/ license guard behavior
- License status suspended/active + extend_days
- User limit enforcement via invite
- License customer-side endpoints (/api/license/me, upgrade-request)
- Register → auto trial license
- /api/edocs/inbox: upload, duplicate, supplier/lines/product/approve/reject/delete
"""

import copy
import os
import time
import uuid
from pathlib import Path

import pytest
import requests

def _read_frontend_env():
    try:
        for line in Path("/app/frontend/.env").read_text().splitlines():
            if line.startswith("REACT_APP_BACKEND_URL="):
                return line.split("=", 1)[1].strip()
    except Exception:
        pass
    return None


BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _read_frontend_env() or "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL not configured"
API = f"{BASE_URL}/api"
MAIN_CID = "comp_nexus_main_01"
SAMPLE_XML = Path("/app/backend/tests/sample_einvoice_ubl.xml")


# ---------- fixtures ----------
def _login(email: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {email}: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("token") or data.get("access_token")
    assert token, f"no token in login response: {data}"
    return token


@pytest.fixture(scope="module")
def super_token():
    return _login("musda84@gmail.com", "Nexus2026!")


@pytest.fixture(scope="module")
def sales_token():
    try:
        return _login("satis@nexus.com", "satis123")
    except AssertionError:
        pytest.skip("sales user not available (possibly locked out)")


def hdr(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---------- 1. Auth + super admin ----------
class TestAuthLicense:
    def test_super_admin_login_returns_license(self):
        r = requests.post(f"{API}/auth/login", json={"email": "musda84@gmail.com", "password": "Nexus2026!"}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["user"].get("is_super_admin") is True
        lic = d.get("license") or {}
        assert "plan_name" in lic and "status" in lic and "modules" in lic

    def test_auth_me_includes_license(self, super_token):
        r = requests.get(f"{API}/auth/me", headers=hdr(super_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d.get("user", {}).get("is_super_admin") is True
        assert "license" in d and "modules" in d["license"]


# ---------- 2. RBAC on /api/system/* ----------
class TestSystemRBAC:
    def test_non_super_admin_forbidden(self, sales_token):
        r = requests.get(f"{API}/system/overview", headers=hdr(sales_token), timeout=30)
        assert r.status_code == 403


# ---------- 3. System readonly endpoints ----------
class TestSystemReadonly:
    def test_overview(self, super_token):
        r = requests.get(f"{API}/system/overview", headers=hdr(super_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ["companies", "users", "by_status", "by_plan", "mrr", "module_usage", "expiring", "pending_requests", "recent"]:
            assert k in d, f"missing key {k}"

    def test_modules_catalog(self, super_token):
        r = requests.get(f"{API}/system/modules", headers=hdr(super_token), timeout=30)
        assert r.status_code == 200
        mods = r.json()
        keys = {m["key"]: m for m in mods}
        for core in ["/", "/settings", "/trash"]:
            assert core in keys, f"missing core module {core}"
            assert keys[core].get("is_core") is True

    def test_plans(self, super_token):
        r = requests.get(f"{API}/system/plans", headers=hdr(super_token), timeout=30)
        assert r.status_code == 200
        plans = r.json()
        names = [p["name"] for p in plans]
        for n in ["Başlangıç", "Standart", "Profesyonel", "Kurumsal"]:
            assert n in names, f"missing default plan {n} (got {names})"
        for p in plans:
            assert "company_count" in p

    def test_companies(self, super_token):
        r = requests.get(f"{API}/system/companies", headers=hdr(super_token), timeout=30)
        assert r.status_code == 200
        rows = r.json()
        assert len(rows) >= 1
        row = rows[0]
        assert "license" in row and "usage" in row and "admin" in row


# ---------- 4. Plan CRUD ----------
class TestPlanCRUD:
    def test_plan_create_update_delete(self, super_token):
        payload = {"name": f"TEST_Plan_{uuid.uuid4().hex[:6]}", "price_monthly": 100, "price_yearly": 1000, "user_limit": 5, "modules": ["/", "/settings", "/trash", "/contacts"]}
        r = requests.post(f"{API}/system/plans", json=payload, headers=hdr(super_token), timeout=30)
        assert r.status_code in (200, 201), r.text
        pid = r.json().get("id") or r.json().get("plan", {}).get("id")
        assert pid
        r2 = requests.put(f"{API}/system/plans/{pid}", json={**payload, "price_monthly": 200}, headers=hdr(super_token), timeout=30)
        assert r2.status_code == 200, r2.text
        r3 = requests.delete(f"{API}/system/plans/{pid}", headers=hdr(super_token), timeout=30)
        assert r3.status_code in (200, 204), r3.text


# ---------- 5. Company creation ----------
@pytest.fixture(scope="module")
def test_company(super_token):
    admin_email = f"TEST_admin_{uuid.uuid4().hex[:8]}@nexus.local"
    payload = {"name": f"TEST_Co_{uuid.uuid4().hex[:6]}", "admin_email": admin_email, "admin_password": "test1234", "plan_id": "plan_standard", "trial_days": 14}
    r = requests.post(f"{API}/system/companies", json=payload, headers=hdr(super_token), timeout=30)
    assert r.status_code in (200, 201), r.text
    d = r.json()
    cid = d.get("id") or d.get("company", {}).get("id") or d.get("company_id")
    assert cid, f"no company id: {d}"
    yield {"id": cid, "admin_email": admin_email, "admin_password": "test1234"}


class TestCompanyCreate:
    def test_new_company_trial(self, super_token, test_company):
        r = requests.get(f"{API}/system/companies", headers=hdr(super_token), timeout=30)
        rows = r.json()
        row = next((x for x in rows if x.get("id") == test_company["id"]), None)
        assert row, "created company not listed"
        assert row["license"]["status"] == "trial"

    def test_new_admin_login(self, test_company):
        r = requests.post(f"{API}/auth/login", json={"email": test_company["admin_email"], "password": test_company["admin_password"]}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("license", {}).get("plan_name") == "Standart"

    def test_short_password_400(self, super_token):
        r = requests.post(f"{API}/system/companies", json={"name": "TEST_X", "admin_email": f"x_{uuid.uuid4().hex[:6]}@t.com", "admin_password": "12", "plan_id": "plan_standard", "trial_days": 7}, headers=hdr(super_token), timeout=30)
        assert r.status_code == 400

    def test_duplicate_email_400(self, super_token, test_company):
        r = requests.post(f"{API}/system/companies", json={"name": "TEST_dup", "admin_email": test_company["admin_email"], "admin_password": "test1234", "plan_id": "plan_standard", "trial_days": 7}, headers=hdr(super_token), timeout=30)
        assert r.status_code == 400


# ---------- 6. Module toggle on MAIN company ----------
class TestModuleToggle:
    def test_disable_ecommerce_blocks_api(self, super_token):
        # disable
        r = requests.post(f"{API}/system/companies/{MAIN_CID}/modules/ecommerce",
                          json={"enabled": False}, headers=hdr(super_token), timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        # check state
        modules = d.get("license", {}).get("modules") or d.get("modules") or {}
        # ecommerce should be locked
        assert modules.get("/ecommerce") is False or d.get("module_overrides", {}).get("/ecommerce") is False

        # API call → 403
        r2 = requests.get(f"{API}/integrations/ecommerce?company_id={MAIN_CID}", headers=hdr(super_token), timeout=30)
        assert r2.status_code == 403, f"expected 403 got {r2.status_code}: {r2.text}"
        body = r2.json() if r2.headers.get("content-type", "").startswith("application/json") else {}
        # code may be nested
        code = body.get("code") or body.get("detail", {}).get("code") if isinstance(body.get("detail"), dict) else body.get("code")
        # accept either 'module_disabled' in body or plain 403
        assert (code == "module_disabled") or ("module" in str(body).lower())

        # different module still works
        r3 = requests.get(f"{API}/orders?company_id={MAIN_CID}", headers=hdr(super_token), timeout=30)
        assert r3.status_code == 200

        # re-enable
        r4 = requests.post(f"{API}/system/companies/{MAIN_CID}/modules/ecommerce",
                           json={"enabled": True}, headers=hdr(super_token), timeout=30)
        assert r4.status_code == 200

        # verify overrides cleared
        r5 = requests.get(f"{API}/integrations/ecommerce?company_id={MAIN_CID}", headers=hdr(super_token), timeout=30)
        assert r5.status_code == 200, f"expected 200 after re-enable: {r5.status_code} {r5.text}"


# ---------- 7. License suspend/active/extend on TEST company ----------
class TestLicenseStatus:
    def test_suspend_and_active(self, super_token, test_company):
        cid = test_company["id"]
        r = requests.put(f"{API}/system/companies/{cid}/license", json={"status": "suspended"}, headers=hdr(super_token), timeout=30)
        assert r.status_code == 200
        # invoice call blocked
        r2 = requests.get(f"{API}/invoices?company_id={cid}", headers=hdr(super_token), timeout=30)
        assert r2.status_code == 403
        # unlock
        r3 = requests.put(f"{API}/system/companies/{cid}/license", json={"status": "active"}, headers=hdr(super_token), timeout=30)
        assert r3.status_code == 200
        r4 = requests.get(f"{API}/invoices?company_id={cid}", headers=hdr(super_token), timeout=30)
        assert r4.status_code == 200

    def test_extend_days(self, super_token, test_company):
        cid = test_company["id"]
        r0 = requests.get(f"{API}/system/companies", headers=hdr(super_token), timeout=30)
        rows = r0.json()
        before = next((x for x in rows if x.get("id") == cid), {}).get("license", {}).get("expires_at")
        r = requests.put(f"{API}/system/companies/{cid}/license", json={"extend_days": 30}, headers=hdr(super_token), timeout=30)
        assert r.status_code == 200
        r1 = requests.get(f"{API}/system/companies", headers=hdr(super_token), timeout=30)
        rows2 = r1.json()
        after_row = next((x for x in rows2 if x.get("id") == cid), {})
        after = after_row.get("license", {}).get("expires_at") or after_row.get("license", {}).get("trial_ends_at")
        assert after and (before is None or after > before)


# ---------- 8. User limit ----------
class TestUserLimit:
    def test_user_limit_blocks_invite(self, super_token, test_company):
        cid = test_company["id"]
        # set user_limit=1 (only current admin exists)
        r = requests.put(f"{API}/system/companies/{cid}/license", json={"user_limit": 1}, headers=hdr(super_token), timeout=30)
        assert r.status_code == 200
        r2 = requests.post(f"{API}/users/invite", json={"company_id": cid, "email": f"limit_{uuid.uuid4().hex[:6]}@t.com", "role": "sales"}, headers=hdr(super_token), timeout=30)
        assert r2.status_code == 403
        # remove limit
        r3 = requests.put(f"{API}/system/companies/{cid}/license", json={"user_limit": None}, headers=hdr(super_token), timeout=30)
        assert r3.status_code == 200
        r4 = requests.post(f"{API}/users/invite", json={"company_id": cid, "email": f"ok_{uuid.uuid4().hex[:6]}@t.com", "role": "sales"}, headers=hdr(super_token), timeout=30)
        assert r4.status_code in (200, 201), r4.text


# ---------- 9. Customer-side license endpoints ----------
class TestCustomerLicense:
    def test_license_me(self, super_token, test_company):
        cid = test_company["id"]
        r = requests.get(f"{API}/license/me?company_id={cid}", headers=hdr(super_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        for k in ["plan_id", "plan_name", "status", "modules", "catalog", "plans", "users"]:
            assert k in d, f"missing {k}"

    def test_upgrade_request_flow(self, super_token, test_company):
        cid = test_company["id"]
        # first request
        r = requests.post(f"{API}/license/upgrade-request", json={"company_id": cid, "plan_id": "plan_pro", "message": "TEST upgrade"}, headers=hdr(super_token), timeout=30)
        assert r.status_code in (200, 201), r.text
        # duplicate → 400
        r2 = requests.post(f"{API}/license/upgrade-request", json={"company_id": cid, "plan_id": "plan_pro", "message": "again"}, headers=hdr(super_token), timeout=30)
        assert r2.status_code == 400
        # list pending
        r3 = requests.get(f"{API}/system/upgrade-requests?status=pending", headers=hdr(super_token), timeout=30)
        assert r3.status_code == 200
        reqs = r3.json()
        my = next((x for x in reqs if x.get("company_id") == cid), None)
        assert my, "pending request not listed"
        rid = my.get("id") or my.get("_id")
        # approve
        r4 = requests.put(f"{API}/system/upgrade-requests/{rid}", json={"status": "approved", "apply": True}, headers=hdr(super_token), timeout=30)
        assert r4.status_code == 200
        # verify company's plan is now pro
        r5 = requests.get(f"{API}/license/me?company_id={cid}", headers=hdr(super_token), timeout=30)
        assert r5.status_code == 200
        assert r5.json().get("plan_id") == "plan_pro"


# ---------- 10. Register auto trial ----------
class TestRegisterTrial:
    def test_register_creates_trial(self):
        email = f"reg_{uuid.uuid4().hex[:8]}@t.local"
        r = requests.post(f"{API}/auth/register", json={"name": "TEST Reg", "email": email, "password": "test1234", "company_name": f"TEST_Reg_{uuid.uuid4().hex[:6]}"}, timeout=30)
        assert r.status_code in (200, 201), r.text
        d = r.json()
        token = d.get("token") or d.get("access_token")
        assert token
        me = requests.get(f"{API}/auth/me", headers=hdr(token), timeout=30).json()
        cid = me.get("user", {}).get("active_company_id") or me.get("user", {}).get("company_ids", [None])[0]
        assert cid, f"no cid in me: {me}"
        r2 = requests.get(f"{API}/license/me?company_id={cid}", headers=hdr(token), timeout=30)
        assert r2.status_code == 200
        d2 = r2.json()
        assert d2.get("status") == "trial"


# ---------- 11. E-doc inbox ----------
def _make_xml_with_new_uuid() -> bytes:
    raw = SAMPLE_XML.read_bytes().decode("utf-8")
    new_uuid = str(uuid.uuid4())
    new_id = f"ABC2026{uuid.uuid4().hex[:9].upper()}"
    # replace UUID and ID
    import re
    raw = re.sub(r"<cbc:UUID>[^<]+</cbc:UUID>", f"<cbc:UUID>{new_uuid}</cbc:UUID>", raw)
    raw = re.sub(r"<cbc:ID>[^<]+</cbc:ID>", f"<cbc:ID>{new_id}</cbc:ID>", raw, count=1)
    return raw.encode("utf-8")


class TestEdocInbox:
    @pytest.fixture(scope="class")
    def uploaded_doc(self, super_token):
        xml = _make_xml_with_new_uuid()
        files = {"file": ("einvoice.xml", xml, "application/xml")}
        r = requests.post(f"{API}/edocs/inbox/upload", files=files, data={"company_id": MAIN_CID}, headers=hdr(super_token), timeout=60)
        assert r.status_code in (200, 201), r.text
        d = r.json()
        did = d.get("id") or d.get("doc", {}).get("id") or d.get("_id")
        assert did, f"no doc id: {d}"
        return {"id": did, "xml": xml}

    def test_duplicate_upload_400(self, super_token, uploaded_doc):
        files = {"file": ("einvoice.xml", uploaded_doc["xml"], "application/xml")}
        r = requests.post(f"{API}/edocs/inbox/upload", files=files, data={"company_id": MAIN_CID}, headers=hdr(super_token), timeout=60)
        assert r.status_code == 400

    def test_list_pending(self, super_token, uploaded_doc):
        r = requests.get(f"{API}/edocs/inbox?company_id={MAIN_CID}&status=pending", headers=hdr(super_token), timeout=30)
        assert r.status_code == 200
        docs = r.json().get("items", [])
        ids = [d.get("id") for d in docs]
        assert uploaded_doc["id"] in ids

    def test_approve_flow(self, super_token, uploaded_doc):
        did = uploaded_doc["id"]
        # approve without supplier → 400
        r = requests.post(f"{API}/edocs/inbox/{did}/approve", json={}, headers=hdr(super_token), timeout=30)
        assert r.status_code == 400
        # create supplier
        r2 = requests.post(f"{API}/edocs/inbox/{did}/create-supplier", json={}, headers=hdr(super_token), timeout=30)
        assert r2.status_code in (200, 201), r2.text
        # match first line to a product (create product for line 0)
        r3 = requests.post(f"{API}/edocs/inbox/{did}/create-product", json={"idx": 0}, headers=hdr(super_token), timeout=30)
        assert r3.status_code in (200, 201), r3.text
        # approve with allow_unmatched and update_stock
        r4 = requests.post(f"{API}/edocs/inbox/{did}/approve", json={"allow_unmatched": True, "update_stock": True}, headers=hdr(super_token), timeout=60)
        assert r4.status_code == 200, r4.text
        d = r4.json()
        inv_no = d.get("invoice_number") or d.get("invoice", {}).get("invoice_number")
        # ensure invoice appears in purchase list
        r5 = requests.get(f"{API}/invoices?company_id={MAIN_CID}&type=purchase", headers=hdr(super_token), timeout=30)
        assert r5.status_code == 200
        js = r5.json()
        invs = js.get("invoices") if isinstance(js, dict) else js
        nums = [i.get("invoice_number") for i in (invs or [])]
        if inv_no:
            assert inv_no in nums

    def test_delete_approved_400(self, super_token, uploaded_doc):
        r = requests.delete(f"{API}/edocs/inbox/{uploaded_doc['id']}", headers=hdr(super_token), timeout=30)
        assert r.status_code == 400

    def test_reject_flow(self, super_token):
        # upload another doc and reject
        xml = _make_xml_with_new_uuid()
        files = {"file": ("einvoice2.xml", xml, "application/xml")}
        r = requests.post(f"{API}/edocs/inbox/upload", files=files, data={"company_id": MAIN_CID}, headers=hdr(super_token), timeout=60)
        assert r.status_code in (200, 201)
        did = r.json().get("id") or r.json().get("doc", {}).get("id")
        r2 = requests.post(f"{API}/edocs/inbox/{did}/reject", json={"reason": "TEST reject"}, headers=hdr(super_token), timeout=30)
        assert r2.status_code == 200
