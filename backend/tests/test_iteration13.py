"""Iteration 13: RBAC (roles/users/invites/activity log), personnel card, AI PDF import, Geliver cargo."""
import base64
import io
import os

import pytest
import requests

from conftest import API, TEST_COMPANY_ID

ADMIN_EMAIL = "admin@nexus.com"
ADMIN_PASSWORD = "admin123"
PDF_PATH = "/app/backend/tests/sample_supplier_invoice.pdf"
TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=="
)


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    return s


# ---------------- Auth ----------------
class TestAuth:
    def test_login_admin(self, client):
        r = client.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        u = d.get("user") or d
        assert u["role_name"] == "Yönetici", u.get("role_name")
        assert isinstance(u.get("permissions"), dict)
        assert len(u["permissions"]) == 19, len(u["permissions"])
        assert u["permissions"]["/invoices"] == "edit"
        assert "access_token" in client.cookies

    def test_auth_me(self, client):
        r = client.get(f"{API}/auth/me", timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        u = d.get("user") or d
        assert u["role_name"] == "Yönetici"
        assert len(u["permissions"]) == 19


# ---------------- Roles ----------------
class TestRoles:
    created_role_id = None

    def test_list_roles(self):
        r = requests.get(f"{API}/roles", params={"company_id": TEST_COMPANY_ID}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert len(d["modules"]) == 19
        assert d["levels"] == ["none", "view", "edit", "delete"]
        codes = [x["code"] for x in d["roles"]]
        for c in ("admin", "accountant", "sales", "warehouse", "production", "advisor"):
            assert c in codes
        assert all("user_count" in x for x in d["roles"])
        assert all("_id" not in x for x in d["roles"])

    def test_create_update_delete_role(self):
        r = requests.post(f"{API}/roles", json={"company_id": TEST_COMPANY_ID, "name": "TEST_ROL"}, timeout=30)
        assert r.status_code == 200, r.text
        role = r.json()
        rid = role["id"]
        TestRoles.created_role_id = rid
        assert role["name"] == "TEST_ROL"
        assert role["is_system"] is False
        assert len(role["permissions"]) == 19

        r = requests.put(f"{API}/roles/{rid}", json={"permissions": {"/invoices": "edit"}}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["permissions"]["/invoices"] == "edit"

        # verify persisted
        listing = requests.get(f"{API}/roles", params={"company_id": TEST_COMPANY_ID}, timeout=30).json()
        got = [x for x in listing["roles"] if x["id"] == rid][0]
        assert got["permissions"]["/invoices"] == "edit"

        r = requests.delete(f"{API}/roles/{rid}", timeout=30)
        assert r.status_code == 200, r.text
        listing = requests.get(f"{API}/roles", params={"company_id": TEST_COMPANY_ID}, timeout=30).json()
        assert rid not in [x["id"] for x in listing["roles"]]

    def test_admin_role_permissions_locked(self):
        rid = f"role_{TEST_COMPANY_ID}_admin"
        r = requests.put(f"{API}/roles/{rid}", json={"permissions": {"/invoices": "none"}}, timeout=30)
        assert r.status_code == 400, r.text

    def test_system_role_delete_blocked(self):
        r = requests.delete(f"{API}/roles/role_{TEST_COMPANY_ID}_sales", timeout=30)
        assert r.status_code == 400, r.text


# ---------------- Users / invites / permission enforcement ----------------
class TestUsersInvites:
    state = {}

    def test_list_users(self):
        r = requests.get(f"{API}/users", params={"company_id": TEST_COMPANY_ID}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert len(d["users"]) >= 3, len(d["users"])
        emails = [u["email"] for u in d["users"]]
        assert ADMIN_EMAIL not in emails, "platform staff must not appear in company user lists"
        assert all("password_hash" not in u for u in d["users"])
        assert all("role_name" in u and "is_active" in u for u in d["users"])
        assert isinstance(d["invites"], list)

    def test_invite_flow(self):
        r = requests.post(f"{API}/users/invite", json={"company_id": TEST_COMPANY_ID, "email": "it13_test@nexus.com",
                                                       "name": "IT13", "role": "warehouse", "base_url": "https://x"}, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "/davet/" in d["link"]
        assert d["mail"]["status"] in ("skipped", "sent", "failed")
        token = d["id"]
        TestUsersInvites.state["token"] = token

        r = requests.get(f"{API}/public/invites/{token}", timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["email"] == "it13_test@nexus.com"
        assert r.json()["role_name"] == "Depo"

        # invite shows in list
        d = requests.get(f"{API}/users", params={"company_id": TEST_COMPANY_ID}, timeout=30).json()
        assert "it13_test@nexus.com" in [i["email"] for i in d["invites"]]

        s = requests.Session()
        r = s.post(f"{API}/public/invites/{token}/accept", json={"password": "test1234", "name": "IT13"}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["user"]["email"] == "it13_test@nexus.com"
        assert d["user"]["role"] == "warehouse"
        assert "password_hash" not in d["user"]
        assert "access_token" in s.cookies
        TestUsersInvites.state["user_id"] = d["user"]["id"]
        TestUsersInvites.state["session"] = s

        # second accept fails
        r2 = requests.post(f"{API}/public/invites/{token}/accept", json={"password": "test1234"}, timeout=30)
        assert r2.status_code == 400, r2.text

    def test_invite_existing_email_rejected(self):
        r = requests.post(f"{API}/users/invite", json={"company_id": TEST_COMPANY_ID, "email": ADMIN_EMAIL, "role": "sales"}, timeout=30)
        assert r.status_code == 400, r.text

    def test_permission_enforcement(self):
        s = TestUsersInvites.state.get("session")
        assert s is not None, "invite flow must run first"
        # warehouse: /projects none -> quotes POST blocked
        r = s.post(f"{API}/quotes", json={"company_id": TEST_COMPANY_ID, "contact_id": "cnt_01", "items": []}, timeout=30)
        assert r.status_code == 403, f"expected 403 got {r.status_code} {r.text[:200]}"
        assert "yetkiniz yok" in r.json().get("detail", "").lower()

        # warehouse: /stock edit -> allowed
        r = s.post(f"{API}/products/units", json={"name": "IT13B", "company_id": TEST_COMPANY_ID}, timeout=30)
        assert r.status_code == 200, r.text
        unit = r.json()
        uid = unit.get("id") or unit.get("_id")
        if uid:
            requests.delete(f"{API}/products/units/{uid}", timeout=30)

        # GET is free
        r = s.get(f"{API}/invoices", params={"company_id": TEST_COMPANY_ID}, timeout=30)
        assert r.status_code == 200, r.text

    def test_deactivate_blocks_login(self):
        uid = TestUsersInvites.state["user_id"]
        r = requests.put(f"{API}/users/{uid}", json={"is_active": False}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["is_active"] is False
        r = requests.post(f"{API}/auth/login", json={"email": "it13_test@nexus.com", "password": "test1234"}, timeout=30)
        assert r.status_code == 403, f"expected 403 got {r.status_code}: {r.text[:200]}"
        assert "pasif" in r.text.lower()

    def test_activity_logs(self):
        r = requests.get(f"{API}/activity-logs", params={"company_id": TEST_COMPANY_ID, "limit": 5}, timeout=30)
        assert r.status_code == 200, r.text
        logs = r.json()
        assert len(logs) > 0
        for l in logs:
            assert "user_name" in l and "method" in l and "path" in l and "module" in l
            assert "_id" not in l

    def test_cleanup_users_and_invite(self):
        uid = TestUsersInvites.state["user_id"]
        r = requests.delete(f"{API}/users/{uid}", timeout=30)
        assert r.status_code == 200, r.text
        d = requests.get(f"{API}/users", params={"company_id": TEST_COMPANY_ID}, timeout=30).json()
        assert "it13_test@nexus.com" not in [u["email"] for u in d["users"]]
        r = requests.delete(f"{API}/users/invite/{TestUsersInvites.state['token']}", timeout=30)
        assert r.status_code == 200

    def test_main_admin_cannot_be_deleted(self):
        r = requests.delete(f"{API}/users/usr_admin_01", timeout=30)
        assert r.status_code == 400, r.text


# ---------------- Personnel card ----------------
class TestPersonnelCard:
    state = {}

    def test_employee_card(self):
        r = requests.get(f"{API}/personnel/employees", params={"company_id": TEST_COMPANY_ID}, timeout=30)
        assert r.status_code == 200, r.text
        emps = r.json()
        assert len(emps) > 0
        emp_id = emps[0]["id"]
        TestPersonnelCard.state["emp_id"] = emp_id

        r = requests.get(f"{API}/personnel/employees/{emp_id}/card", timeout=30)
        assert r.status_code == 200, r.text
        c = r.json()
        for k in ("employee", "payrolls", "leaves", "bonuses", "leave_balance", "attendance", "documents", "totals", "balance", "overtime", "performance"):
            assert k in c, k
        assert c["employee"]["id"] == emp_id
        assert "remaining" in c["balance"]
        assert "hours" in c["overtime"]
        assert "overall" in c["performance"]
        for k in ("annual", "used", "remaining", "pending"):
            assert k in c["leave_balance"]
        assert c["leave_balance"]["remaining"] == c["leave_balance"]["annual"] - c["leave_balance"]["used"]
        for k in ("month", "days_present", "days_absent", "total_hours"):
            assert k in c["attendance"]
        assert "user" in c

    def test_card_404(self):
        r = requests.get(f"{API}/personnel/employees/nope_xyz/card", timeout=30)
        assert r.status_code == 404

    def test_document_upload_and_delete(self):
        emp_id = TestPersonnelCard.state["emp_id"]
        files = {"file": ("TEST_doc.png", io.BytesIO(TINY_PNG), "image/png")}
        r = requests.post(f"{API}/files/upload", params={"entity": "employee", "entity_id": emp_id, "company_id": TEST_COMPANY_ID},
                          files=files, timeout=60)
        assert r.status_code == 200, r.text
        assert r.json()["url"].startswith("/api/files/")

        card = requests.get(f"{API}/personnel/employees/{emp_id}/card", timeout=30).json()
        docs = [d for d in card["documents"] if d["original_filename"] == "TEST_doc.png"]
        assert docs, "uploaded document not visible in card"
        fid = docs[0]["id"]

        r = requests.delete(f"{API}/files/{fid}", timeout=30)
        assert r.status_code == 200, r.text
        card = requests.get(f"{API}/personnel/employees/{emp_id}/card", timeout=30).json()
        assert fid not in [d["id"] for d in card["documents"]]

    def test_create_user_for_employee(self):
        emp_id = TestPersonnelCard.state["emp_id"]
        card = requests.get(f"{API}/personnel/employees/{emp_id}/card", timeout=30).json()
        if card.get("user"):
            pytest.skip("employee already has a system user")
        r = requests.post(f"{API}/personnel/employees/{emp_id}/create-user",
                          json={"email": "it13_emp@nexus.com", "role": "production", "password": "test1234"}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["mode"] == "password"
        user_id = d["user_id"]
        TestPersonnelCard.state["user_id"] = user_id

        card = requests.get(f"{API}/personnel/employees/{emp_id}/card", timeout=30).json()
        assert card["user"] and card["user"]["email"] == "it13_emp@nexus.com"
        assert card["user"]["role"] == "production"

        # same e-mail again -> 400
        r = requests.post(f"{API}/personnel/employees/{emp_id}/create-user",
                          json={"email": "it13_emp@nexus.com", "role": "production", "password": "test1234"}, timeout=30)
        assert r.status_code == 400, f"duplicate e-mail should fail: {r.status_code} {r.text[:200]}"

        # KNOWN GAP (report-only): a *different* e-mail creates a 2nd user for the same employee
        r2 = requests.post(f"{API}/personnel/employees/{emp_id}/create-user",
                           json={"email": "it13_emp2@nexus.com", "role": "production", "password": "test1234"}, timeout=30)
        if r2.status_code == 200:
            requests.delete(f"{API}/users/{r2.json()['user_id']}", timeout=30)
        assert r2.status_code == 400, f"employee already has a system user but a 2nd one was created ({r2.status_code})"

    def test_cleanup_employee_user(self):
        uid = TestPersonnelCard.state.get("user_id")
        if not uid:
            pytest.skip("no user created")
        r = requests.delete(f"{API}/users/{uid}", timeout=30)
        assert r.status_code == 200, r.text


# ---------------- AI PDF import ----------------
class TestAiPdfImport:
    state = {}

    def test_extract(self):
        assert os.path.exists(PDF_PATH)
        with open(PDF_PATH, "rb") as f:
            r = requests.post(f"{API}/ai/invoice-extract", params={"company_id": TEST_COMPANY_ID},
                              files={"file": ("sample_supplier_invoice.pdf", f, "application/pdf")}, timeout=180)
        assert r.status_code == 200, r.text
        d = r.json()
        draft = d["draft"]
        assert "Anadolu" in (draft["supplier"].get("name") or ""), draft["supplier"]
        assert len(draft["items"]) == 2, draft["items"]
        assert abs(float(draft["grand_total"]) - 14100) < 50, draft["grand_total"]
        assert d["file_url"].startswith("/api/files/")
        assert d.get("matched_contact") is None
        TestAiPdfImport.state["draft"] = draft
        TestAiPdfImport.state["file_url"] = d["file_url"]

    def test_extract_wrong_type(self):
        r = requests.post(f"{API}/ai/invoice-extract", params={"company_id": TEST_COMPANY_ID},
                          files={"file": ("a.csv", io.BytesIO(b"a,b\n1,2"), "text/csv")}, timeout=60)
        assert r.status_code == 400, r.text

    def test_confirm(self):
        st = TestAiPdfImport.state
        if "draft" not in st:
            pytest.skip("extract failed")
        r = requests.post(f"{API}/ai/invoice-extract/confirm",
                          json={"company_id": TEST_COMPANY_ID, "draft": st["draft"], "contact_id": None, "file_url": st["file_url"]},
                          timeout=120)
        assert r.status_code == 200, r.text
        d = r.json()
        inv = d.get("invoice") or d
        assert inv["invoice_type"] == "purchase", inv.get("invoice_type")
        assert inv["status"] == "draft"
        assert abs(float(inv["grand_total"]) - 14100) < 50
        assert inv.get("contact_id"), "new supplier contact should be linked"
        TestAiPdfImport.state["invoice_id"] = inv["id"]
        TestAiPdfImport.state["contact_id"] = inv["contact_id"]

        # verify persistence via list
        g = requests.get(f"{API}/invoices", params={"company_id": TEST_COMPANY_ID}, timeout=30)
        assert g.status_code == 200, g.text
        rows = [x for x in g.json() if x["id"] == inv["id"]]
        assert rows, "created AI invoice not found in list"
        assert rows[0]["invoice_type"] == "purchase"
        assert rows[0]["status"] == "draft"


# ---------------- Geliver cargo ----------------
class TestGeliverCargo:
    state = {}

    def test_create_integration(self):
        r = requests.post(f"{API}/integrations/cargo", json={"company_id": TEST_COMPANY_ID, "carrier_code": "geliver",
                                                             "api_key": "dummy", "sender_address_id": "abc"}, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "connected", d
        cid = d["id"]
        TestGeliverCargo.state["id"] = cid
        assert d.get("api_key") == "••••••••", d
        assert d.get("test_mode") is True
        assert d.get("sender_address_id") == "abc"

    def test_get_integrations_masked(self):
        r = requests.get(f"{API}/integrations/cargo", params={"company_id": TEST_COMPANY_ID}, timeout=30)
        assert r.status_code == 200, r.text
        rows = [x for x in r.json() if x["id"] == TestGeliverCargo.state["id"]]
        assert rows, "created integration not listed"
        row = rows[0]
        assert row.get("api_key") == "••••••••", row
        assert row.get("has_api_key") is True

    def test_connection_test_returns_400_not_500(self):
        cid = TestGeliverCargo.state["id"]
        r = requests.post(f"{API}/integrations/cargo/{cid}/test", timeout=90)
        assert r.status_code != 500, f"500 from Geliver test: {r.text[:300]}"
        assert r.status_code == 400, f"{r.status_code} {r.text[:300]}"

    def test_update_integration(self):
        cid = TestGeliverCargo.state["id"]
        r = requests.put(f"{API}/integrations/cargo/{cid}", json={"test_mode": False, "sender_address_id": "zzz"}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["test_mode"] is False
        assert d.get("sender_address_id") == "zzz", d
        assert d.get("api_key") == "••••••••"

    def test_geliver_shipment_live_error(self):
        r = requests.post(f"{API}/cargo/create-shipment", json={"carrier_code": "geliver", "customer_name": "T", "address": "x",
                                                                "city": "İzmir", "company_id": TEST_COMPANY_ID}, timeout=90)
        assert r.status_code != 500, f"500 from Geliver shipment: {r.text[:300]}"
        assert r.status_code == 400, f"{r.status_code} {r.text[:300]}"

    def test_simulated_shipment(self):
        r = requests.post(f"{API}/cargo/create-shipment", json={"carrier_code": "yurtici", "customer_name": "TEST_Sim", "address": "x",
                                                                "city": "İzmir", "company_id": TEST_COMPANY_ID}, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("is_live") is False, d
        assert "SİMÜLE" in str(d.get("message", "")), d
        TestGeliverCargo.state["shipment_id"] = (d.get("shipment") or {}).get("id") or d.get("id")

    def test_delete_integration(self):
        cid = TestGeliverCargo.state["id"]
        r = requests.delete(f"{API}/integrations/cargo/{cid}", timeout=30)
        assert r.status_code == 200, r.text
        rows = requests.get(f"{API}/integrations/cargo", params={"company_id": TEST_COMPANY_ID}, timeout=30).json()
        assert cid not in [x["id"] for x in rows]
