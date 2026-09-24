"""Iteration 4 backend tests: preferences, company settings, print templates,
e-invoice settings, generic file upload, quotes / projects / surveys."""
import io
import os
import re
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    raise RuntimeError("REACT_APP_BACKEND_URL missing")
BASE = base_url.rstrip("/") + "/api"
COMPANY = "comp_nexus_main_01"

PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4"
    "890000000a49444154789c6300010000050001"
    "0d0a2db40000000049454e44ae426082"
)


@pytest.fixture(scope="session")
def creds():
    content = Path("/app/memory/test_credentials.md").read_text(encoding="utf-8")
    email = re.search(r"(?im)^\s*-\s*\*\*Email:\*\*\s*(\S+)", content).group(1)
    pwd = re.search(r"(?im)^\s*-\s*\*\*Password:\*\*\s*(\S+)", content).group(1)
    return {"email": email, "password": pwd}


@pytest.fixture(scope="session")
def client(creds):
    s = requests.Session()
    r = s.post(f"{BASE}/auth/login", json=creds, timeout=30)
    if r.status_code != 200:
        pytest.fail(f"Login failed {r.status_code}: {r.text[:300]}")
    return s


# ---------------- Preferences ----------------
class TestPreferences:
    def test_update_and_persist_module_order(self, client):
        original = client.get(f"{BASE}/auth/me", timeout=30).json()["user"].get("preferences", {}).get("module_order")
        order = ["/settings", "/"]
        r = client.put(f"{BASE}/auth/me/preferences", json={"module_order": order}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json().get("module_order") == order
        me = client.get(f"{BASE}/auth/me", timeout=30).json()
        assert me["user"]["preferences"]["module_order"] == order
        # restore
        client.put(f"{BASE}/auth/me/preferences", json={"module_order": original or []}, timeout=30)

    def test_update_and_persist_dashboard_layout(self, client):
        original = client.get(f"{BASE}/auth/me", timeout=30).json()["user"].get("preferences", {}).get("dashboard_layout")
        layout = ["charts", "alerts", "overview", "decision", "demo", "ai", "kpis", "bottom"]
        r = client.put(f"{BASE}/auth/me/preferences", json={"dashboard_layout": layout}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json().get("dashboard_layout") == layout
        me = client.get(f"{BASE}/auth/me", timeout=30).json()
        assert me["user"]["preferences"]["dashboard_layout"] == layout
        client.put(f"{BASE}/auth/me/preferences", json={"dashboard_layout": original or []}, timeout=30)

    def test_dashboard_layout_must_be_list(self, client):
        r = client.put(f"{BASE}/auth/me/preferences", json={"dashboard_layout": "alerts"}, timeout=30)
        assert r.status_code == 400

    def test_disallowed_key_ignored(self, client):
        r = client.put(f"{BASE}/auth/me/preferences", json={"role": "superadmin"}, timeout=30)
        assert r.status_code == 200
        assert "role" not in r.json()
        me = client.get(f"{BASE}/auth/me", timeout=30).json()
        assert me["user"]["role"] == "admin"


# ---------------- Company ----------------
class TestCompany:
    def test_get_and_update_company(self, client):
        r = client.get(f"{BASE}/companies/{COMPANY}", timeout=30)
        assert r.status_code == 200, r.text
        c = r.json()
        assert c["id"] == COMPANY and c.get("name")
        old_phone, old_iban = c.get("phone"), c.get("iban")
        up = client.put(f"{BASE}/companies/{COMPANY}", json={"phone": "+90 555 000 0000", "iban": "TR000000000000000000000000", "name_hack": "x"}, timeout=30)
        assert up.status_code == 200, up.text
        d = up.json()
        assert d["phone"] == "+90 555 000 0000"
        assert d["iban"] == "TR000000000000000000000000"
        assert "name_hack" not in d
        again = client.get(f"{BASE}/companies/{COMPANY}", timeout=30).json()
        assert again["phone"] == "+90 555 000 0000"
        client.put(f"{BASE}/companies/{COMPANY}", json={"phone": old_phone, "iban": old_iban}, timeout=30)
        assert client.get(f"{BASE}/companies/{COMPANY}", timeout=30).json()["phone"] == old_phone

    def test_price_decimals_saved_and_clamped(self, client):
        current = client.get(f"{BASE}/companies/{COMPANY}", timeout=30).json()
        old = current.get("price_decimals", 2)
        up = client.put(f"{BASE}/companies/{COMPANY}", json={"price_decimals": 4}, timeout=30)
        assert up.status_code == 200, up.text
        assert up.json()["price_decimals"] == 4
        clamped = client.put(f"{BASE}/companies/{COMPANY}", json={"price_decimals": 9}, timeout=30)
        assert clamped.json()["price_decimals"] == 4
        invalid = client.put(f"{BASE}/companies/{COMPANY}", json={"price_decimals": "x"}, timeout=30)
        assert invalid.json()["price_decimals"] == 2
        client.put(f"{BASE}/companies/{COMPANY}", json={"price_decimals": old if old is not None else 2}, timeout=30)

    def test_get_company_404(self, client):
        assert client.get(f"{BASE}/companies/nope_xx", timeout=30).status_code == 404


# ---------------- Print templates ----------------
class TestPrintTemplates:
    def test_defaults_present(self, client):
        r = client.get(f"{BASE}/companies/{COMPANY}/print-templates", timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert set(d.keys()) == {"invoice", "order", "quote", "dispatch"}
        for v in d.values():
            assert "primary_color" in v and "footer_note" in v and "paper" in v

    def test_save_invoice_template_persists(self, client):
        old = client.get(f"{BASE}/companies/{COMPANY}/print-templates", timeout=30).json()["invoice"]
        payload = {**old, "primary_color": "#123456", "footer_note": "X"}
        r = client.put(f"{BASE}/companies/{COMPANY}/print-templates/invoice", json=payload, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["primary_color"] == "#123456"
        got = client.get(f"{BASE}/companies/{COMPANY}/print-templates", timeout=30).json()["invoice"]
        assert got["primary_color"] == "#123456" and got["footer_note"] == "X"
        client.put(f"{BASE}/companies/{COMPANY}/print-templates/invoice", json=old, timeout=30)

    def test_invalid_doc_type(self, client):
        r = client.put(f"{BASE}/companies/{COMPANY}/print-templates/bogus", json={"paper": "A5"}, timeout=30)
        assert r.status_code == 400


# ---------------- E-invoice ----------------
class TestEInvoice:
    def test_providers(self, client):
        r = client.get(f"{BASE}/einvoice/providers", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert len(data) == 6
        assert {p["code"] for p in data} == {"n11faturam", "foriba", "elogo", "uyumsoft", "izibiz", "other"}
        assert any(p["code"] == "n11faturam" and "n11" in p["name"].lower() for p in data)

    def test_tenant_cannot_assign_provider(self, client):
        r = client.put(f"{BASE}/einvoice/settings", json={"provider": "foriba", "username": "TEST_user", "password": "TEST_pass", "mode": "test"}, timeout=30)
        assert r.status_code in (400, 403), r.text

    def test_configure_then_reset(self, client):
        a = client.put(f"{BASE}/system/companies/{COMPANY}/einvoice", json={"provider": "foriba"}, timeout=30)
        assert a.status_code == 200, a.text
        assert a.json()["provider"] == "foriba" and a.json()["assigned"] is True
        r = client.put(f"{BASE}/einvoice/settings", json={"username": "TEST_user", "password": "TEST_pass", "mode": "test"}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["provider"] == "foriba" and d["status"] == "configured"
        assert d["has_password"] is True
        assert "password" not in d and "password_enc" not in d
        g = client.get(f"{BASE}/einvoice/settings", timeout=30).json()
        assert g["status"] == "configured" and g["username"] == "TEST_user" and "password" not in g
        steal = client.put(f"{BASE}/einvoice/settings", json={"provider": "elogo", "username": "TEST_user"}, timeout=30)
        assert steal.status_code == 403
        r2 = client.put(f"{BASE}/system/companies/{COMPANY}/einvoice", json={"provider": ""}, timeout=30)
        assert r2.status_code == 200
        assert r2.json()["status"] == "simulated" and r2.json()["assigned"] is False
        assert client.get(f"{BASE}/einvoice/settings", timeout=30).json()["status"] == "simulated"

    def test_bad_provider(self, client):
        assert client.put(f"{BASE}/system/companies/{COMPANY}/einvoice", json={"provider": "hackprov"}, timeout=30).status_code == 400


# ---------------- Quotes ----------------
@pytest.fixture
def quote(client):
    ids = []

    def _make(**over):
        body = {"contact_id": "cnt_01", "contact_name": "TEST_Musteri", "title": "TEST_Teklif",
                "items": [{"name": "TEST_Kalem", "quantity": 2, "unit_price": 1000, "vat_rate": 20}]}
        body.update(over)
        r = client.post(f"{BASE}/quotes", json=body, timeout=30)
        assert r.status_code == 200, r.text
        q = r.json()
        ids.append(q["id"])
        return q

    yield _make
    for qid in ids:
        q = client.get(f"{BASE}/quotes/{qid}", timeout=30)
        if q.status_code == 200 and q.json().get("invoice_id"):
            inv_id = q.json()["invoice_id"]
            requests.delete(f"{BASE}/invoices/{inv_id}", timeout=30)
        client.delete(f"{BASE}/quotes/{qid}", timeout=30)


class TestQuotes:
    def test_create_totals_and_number(self, quote):
        q = quote()
        assert re.match(r"^TKF-\d{4}-\d{4}$", q["quote_number"]), q["quote_number"]
        assert q["subtotal"] == 2000 and q["vat_total"] == 400 and q["grand_total"] == 2400
        assert q["status"] == "draft" and q["items"][0]["total"] == 2000

    def test_empty_items_400(self, client):
        r = client.post(f"{BASE}/quotes", json={"contact_id": "cnt_01", "items": []}, timeout=30)
        assert r.status_code == 400

    def test_status_update_persists(self, client, quote):
        q = quote()
        r = client.put(f"{BASE}/quotes/{q['id']}", json={"status": "sent"}, timeout=30)
        assert r.status_code == 200 and r.json()["status"] == "sent"
        assert client.get(f"{BASE}/quotes/{q['id']}", timeout=30).json()["status"] == "sent"

    def test_items_recalculated_on_update(self, client, quote):
        q = quote()
        r = client.put(f"{BASE}/quotes/{q['id']}", json={"items": [{"name": "a", "quantity": 1, "unit_price": 500, "vat_rate": 10}]}, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert d["subtotal"] == 500 and d["vat_total"] == 50 and d["grand_total"] == 550

    def test_convert_to_invoice(self, client, quote):
        q = quote()
        bal_before = client.get(f"{BASE}/contacts", timeout=30).json()
        bal_before = next(c["balance"] for c in bal_before if c["id"] == "cnt_01")
        r = client.post(f"{BASE}/quotes/{q['id']}/convert-to-invoice", json={}, timeout=30)
        assert r.status_code == 200, r.text
        inv = r.json()["invoice"]
        assert inv["status"] == "draft" and inv["grand_total"] == 2400 and inv["subtotal"] == 2000
        assert inv["invoice_number"].startswith("TA")
        assert inv.get("quote_id") == q["id"]
        upd = client.get(f"{BASE}/quotes/{q['id']}", timeout=30).json()
        assert upd["status"] == "accepted" and upd["invoice_number"] == inv["invoice_number"]
        bal_after = next(c["balance"] for c in client.get(f"{BASE}/contacts", timeout=30).json() if c["id"] == "cnt_01")
        assert round(bal_after - bal_before, 2) == 2400
        # second conversion blocked
        assert client.post(f"{BASE}/quotes/{q['id']}/convert-to-invoice", json={}, timeout=30).status_code == 400
        # restore contact balance
        client.put(f"{BASE}/contacts/cnt_01", json={"balance": bal_before}, timeout=30)

    def test_delete_quote(self, client):
        q = client.post(f"{BASE}/quotes", json={"contact_id": "cnt_01", "title": "TEST_del", "items": [{"name": "x", "quantity": 1, "unit_price": 10}]}, timeout=30).json()
        assert client.delete(f"{BASE}/quotes/{q['id']}", timeout=30).status_code == 200
        assert client.get(f"{BASE}/quotes/{q['id']}", timeout=30).status_code == 404

    def test_get_missing_quote_404(self, client):
        assert client.get(f"{BASE}/quotes/does_not_exist", timeout=30).status_code == 404

    def test_upload_image_to_quote(self, client, quote):
        q = quote()
        r = client.post(f"{BASE}/files/upload?entity=quote&entity_id={q['id']}", files={"file": ("t.png", io.BytesIO(PNG), "image/png")}, timeout=60)
        assert r.status_code == 200, r.text
        url = r.json()["url"]
        assert url.startswith("/api/files/")
        assert url in client.get(f"{BASE}/quotes/{q['id']}", timeout=30).json()["images"]

    def test_upload_octet_stream_sniffed_from_ext(self, client, quote):
        """Mobile often sends empty / octet-stream; infer image type from filename."""
        q = quote()
        r = client.post(
            f"{BASE}/files/upload?entity=quotes&entity_id={q['id']}",
            files={"file": ("photo.png", io.BytesIO(PNG), "application/octet-stream")},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        assert r.json()["url"] in client.get(f"{BASE}/quotes/{q['id']}", timeout=30).json()["images"]

    def test_upload_pdf_allowed_txt_rejected(self, client):
        r = client.post(f"{BASE}/files/upload?entity=misc", files={"file": ("t.pdf", io.BytesIO(b"%PDF-1.4 test"), "application/pdf")}, timeout=60)
        assert r.status_code == 200, r.text
        bad = client.post(f"{BASE}/files/upload?entity=misc", files={"file": ("t.txt", io.BytesIO(b"hello"), "text/plain")}, timeout=60)
        assert bad.status_code == 400


# ---------------- Projects ----------------
class TestProjects:
    def test_project_crud(self, client):
        r = client.post(f"{BASE}/projects", json={"name": "TEST_Proje", "contact_id": "cnt_01", "contact_name": "TEST_M", "budget": 50000}, timeout=30)
        assert r.status_code == 200, r.text
        p = r.json()
        assert re.match(r"^PRJ-\d{4}-\d{4}$", p["project_number"])
        assert p["budget"] == 50000 and p["status"] == "planning"
        pid = p["id"]
        up = client.put(f"{BASE}/projects/{pid}", json={"status": "active"}, timeout=30)
        assert up.status_code == 200 and up.json()["status"] == "active"
        lst = client.get(f"{BASE}/projects", timeout=30).json()
        row = next(x for x in lst if x["id"] == pid)
        assert row["status"] == "active" and row["quote_count"] == 0 and row["quoted_total"] == 0
        assert client.delete(f"{BASE}/projects/{pid}", timeout=30).status_code == 200
        assert all(x["id"] != pid for x in client.get(f"{BASE}/projects", timeout=30).json())

    def test_project_requires_name(self, client):
        assert client.post(f"{BASE}/projects", json={"budget": 10}, timeout=30).status_code == 400

    def test_project_quote_aggregation(self, client):
        p = client.post(f"{BASE}/projects", json={"name": "TEST_Proje_Agg"}, timeout=30).json()
        q = client.post(f"{BASE}/quotes", json={"contact_id": "cnt_01", "title": "TEST_pq", "project_id": p["id"],
                                                "items": [{"name": "x", "quantity": 1, "unit_price": 100, "vat_rate": 20}]}, timeout=30).json()
        row = next(x for x in client.get(f"{BASE}/projects", timeout=30).json() if x["id"] == p["id"])
        assert row["quote_count"] == 1 and row["quoted_total"] == 120 and row["invoiced_total"] == 0
        client.delete(f"{BASE}/quotes/{q['id']}", timeout=30)
        client.delete(f"{BASE}/projects/{p['id']}", timeout=30)

    def test_update_missing_project_404(self, client):
        assert client.put(f"{BASE}/projects/nope_x", json={"status": "active"}, timeout=30).status_code == 404

    def test_quote_convert_to_project(self, client):
        s = client.post(f"{BASE}/surveys", json={"contact_id": "cnt_01", "contact_name": "TEST_M", "address": "TEST_Saha",
                                                 "measurements": [{"name": "Duvar", "quantity": 10, "unit": "m2", "unit_price": 100}]}, timeout=30).json()
        conv_q = client.post(f"{BASE}/surveys/{s['id']}/convert-to-quote", timeout=30)
        assert conv_q.status_code == 200, conv_q.text
        q = conv_q.json()["quote"]
        again_q = client.post(f"{BASE}/surveys/{s['id']}/convert-to-quote", timeout=30)
        assert again_q.status_code == 400
        conv_p = client.post(f"{BASE}/quotes/{q['id']}/convert-to-project", timeout=30)
        assert conv_p.status_code == 200, conv_p.text
        p = conv_p.json()["project"]
        assert re.match(r"^PRJ-\d{4}-\d{4}$", p["project_number"])
        assert p["contact_id"] == "cnt_01" and p["address"] == "TEST_Saha"
        assert p["budget"] == q["grand_total"] and p["quote_id"] == q["id"]
        q2 = client.get(f"{BASE}/quotes/{q['id']}", timeout=30).json()
        assert q2["project_id"] == p["id"] and q2["project_number"] == p["project_number"]
        assert q2["status"] == "accepted"
        s2 = next(x for x in client.get(f"{BASE}/surveys", timeout=30).json() if x["id"] == s["id"])
        assert s2["project_id"] == p["id"]
        again_p = client.post(f"{BASE}/quotes/{q['id']}/convert-to-project", timeout=30)
        assert again_p.status_code == 200, again_p.text
        assert again_p.json().get("updated") is True
        assert again_p.json()["project"]["id"] == p["id"]
        client.put(f"{BASE}/quotes/{q['id']}", json={"title": "Guncel Villa", "notes": "revize", "items": q.get("items") or []}, timeout=30)
        synced = client.post(f"{BASE}/quotes/{q['id']}/convert-to-project", timeout=30)
        assert synced.status_code == 200, synced.text
        p2 = synced.json()["project"]
        assert p2["id"] == p["id"]
        assert p2["name"] == "Guncel Villa"
        assert p2["description"] == "revize"
        client.delete(f"{BASE}/quotes/{q['id']}", timeout=30)
        client.delete(f"{BASE}/projects/{p['id']}", timeout=30)
        client.delete(f"{BASE}/surveys/{s['id']}", timeout=30)

    def test_convert_missing_quote_to_project_404(self, client):
        assert client.post(f"{BASE}/quotes/nope_x/convert-to-project", timeout=30).status_code == 404


# ---------------- Surveys ----------------
class TestSurveys:
    def test_survey_crud_and_convert(self, client):
        r = client.post(f"{BASE}/surveys", json={"contact_id": "cnt_01", "contact_name": "TEST_M", "address": "TEST_Adres",
                                                 "measurements": [{"name": "Duvar", "quantity": 12, "unit": "m2", "unit_price": 150}]}, timeout=30)
        assert r.status_code == 200, r.text
        s = r.json()
        assert re.match(r"^KSF-\d{4}-\d{4}$", s["survey_number"])
        assert s["status"] == "planned" and s["address"] == "TEST_Adres"
        sid = s["id"]
        up = client.put(f"{BASE}/surveys/{sid}", json={"status": "done"}, timeout=30)
        assert up.status_code == 200 and up.json()["status"] == "done"
        conv = client.post(f"{BASE}/surveys/{sid}/convert-to-quote", timeout=30)
        assert conv.status_code == 200, conv.text
        q = conv.json()["quote"]
        assert q["items"][0]["name"] == "Duvar" and q["items"][0]["quantity"] == 12 and q["items"][0]["unit_price"] == 150
        assert q["subtotal"] == 1800 and q["grand_total"] == 2160
        s2 = client.get(f"{BASE}/surveys", timeout=30).json()
        row = next(x for x in s2 if x["id"] == sid)
        assert row["status"] == "quoted" and row["quote_id"] == q["id"]
        client.delete(f"{BASE}/quotes/{q['id']}", timeout=30)
        assert client.delete(f"{BASE}/surveys/{sid}", timeout=30).status_code == 200
        assert all(x["id"] != sid for x in client.get(f"{BASE}/surveys", timeout=30).json())

    def test_survey_convert_keeps_line_features(self, client):
        r = client.post(f"{BASE}/surveys", json={
            "contact_id": "cnt_01", "contact_name": "TEST_M", "address": "TEST_Adres",
            "measurements": [
                {
                    "name": "Profil", "quantity": 2, "unit": "Adet", "unit_price": 100,
                    "vat_rate": 10, "is_service": False, "product_id": "p_1",
                    "image_url": "/api/files/a.jpg", "description": "Keşif notu",
                },
                {
                    "name": "Montaj", "quantity": 1, "unit": "Adet", "unit_price": 50,
                    "vat_rate": 20, "is_service": True, "print_image_url": "/api/files/b.jpg",
                },
            ],
        }, timeout=30)
        assert r.status_code == 200, r.text
        sid = r.json()["id"]
        conv = client.post(f"{BASE}/surveys/{sid}/convert-to-quote", timeout=30)
        assert conv.status_code == 200, conv.text
        items = conv.json()["quote"]["items"]
        assert items[0]["name"] == "Profil" and items[0]["vat_rate"] == 10
        assert items[0]["image_url"] == "/api/files/a.jpg" and items[0]["description"] == "Keşif notu"
        assert items[1]["is_service"] is True and items[1]["print_image_url"] == "/api/files/b.jpg"
        client.delete(f"{BASE}/quotes/{conv.json()['quote']['id']}", timeout=30)
        client.delete(f"{BASE}/surveys/{sid}", timeout=30)

    def test_update_missing_survey_404(self, client):
        assert client.put(f"{BASE}/surveys/nope_x", json={"status": "done"}, timeout=30).status_code == 404

    def test_convert_missing_survey_404(self, client):
        assert client.post(f"{BASE}/surveys/nope_x/convert-to-quote", timeout=30).status_code == 404
