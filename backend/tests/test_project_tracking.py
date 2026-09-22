"""Public project status tracking (login-free, read-only)."""
import os
import uuid

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env") or dotenv_values("/workspace/frontend/.env") or {}
base_url = os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL")
if not base_url:
    pytest.skip("REACT_APP_BACKEND_URL missing", allow_module_level=True)
BASE = base_url.rstrip("/") + "/api"
COMPANY = os.environ.get("TEST_COMPANY_ID") or "comp_nexus_main_01"


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture
def project(api):
    r = api.post(f"{BASE}/projects", json={
        "company_id": COMPANY,
        "name": f"TEST takip {uuid.uuid4().hex[:6]}",
        "contact_id": "cnt_01",
        "contact_name": "TEST müşteri",
        "status": "planning",
        "description": "Müşteri görür",
        "address": "Test cad.",
        "tasks": [{"title": "Keşif randevusu", "done": True}, {"title": "Montaj", "done": False}],
    }, timeout=30)
    assert r.status_code == 200, r.text
    p = r.json()
    yield p
    api.delete(f"{BASE}/projects/{p['id']}", timeout=20)


class TestProjectTracking:
    def test_mint_link_and_public_read_only_payload(self, api, project):
        r = api.post(f"{BASE}/projects/{project['id']}/send-tracking", json={"channels": [], "base_url": "https://ornek.tamkobi.com"}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["status"] == "success"
        token = d["token"]
        assert len(token) >= 16
        assert d["link"] == f"https://ornek.tamkobi.com/proje/{token}"

        pub = api.get(f"{BASE}/public/projects/{token}", timeout=30)
        assert pub.status_code == 200, pub.text
        body = pub.json()
        blob = str(body)
        assert "company_id" not in body
        assert "contact_id" not in body
        assert project["id"] not in blob
        assert "_id" not in blob
        assert body["project_number"] == project["project_number"]
        assert body["name"] == project["name"]
        assert body["status"] == "planning"
        assert body["status_label"] == "Planlama"
        assert body["description"] == "Müşteri görür"
        assert any(s["key"] == "created" and s["done"] for s in body["steps"])
        assert any(s.get("current") for s in body["steps"])
        assert {t["title"] for t in body["tasks"]} == {"Keşif randevusu", "Montaj"}
        assert body["company"]["name"]
        assert "budget" not in body
        assert "view_count" not in body
        assert "last_viewed_at" not in body
        assert "company_id" not in str(body.get("company") or {})

        again = api.post(f"{BASE}/projects/{project['id']}/send-tracking", json={"channels": [], "base_url": "https://ornek.tamkobi.com"}, timeout=30)
        assert again.status_code == 200
        assert again.json()["token"] == token

    def test_related_quote_does_not_leak_amounts(self, api, project):
        q = api.post(f"{BASE}/quotes", json={
            "company_id": COMPANY, "contact_id": "cnt_01", "contact_name": "TEST müşteri",
            "title": "Gizli fiyat", "project_id": project["id"],
            "items": [{"name": "Montaj", "quantity": 1, "unit_price": 9999, "vat_rate": 20}],
        }, timeout=30)
        assert q.status_code == 200, q.text
        token = api.post(f"{BASE}/projects/{project['id']}/send-tracking", json={"channels": [], "base_url": "http://x"}, timeout=30).json()["token"]
        body = api.get(f"{BASE}/public/projects/{token}", timeout=30).json()
        blob = str(body)
        assert "9999" not in blob
        assert "grand_total" not in body
        assert any(x.get("quote_number") == q.json()["quote_number"] for x in body["quotes"])

        detail = api.get(f"{BASE}/public/projects/{token}/quotes/{q.json()['quote_number']}", timeout=30)
        assert detail.status_code == 200, detail.text
        shown = detail.json()
        assert shown["quote_number"] == q.json()["quote_number"]
        assert shown["title"] == "Gizli fiyat"
        assert shown["items"]
        assert "grand_total" in shown
        assert "9999" in str(shown) or float(shown.get("grand_total") or 0) > 0
        assert "company_id" not in shown
        assert "contact_id" not in shown
        assert api.get(f"{BASE}/public/projects/{token}/quotes/NO-SUCH-QUOTE", timeout=30).status_code == 404
        api.delete(f"{BASE}/quotes/{q.json()['id']}", timeout=20)

    def test_status_change_is_reflected_dynamically(self, api, project):
        token = api.post(f"{BASE}/projects/{project['id']}/send-tracking", json={"channels": [], "base_url": "http://x"}, timeout=30).json()["token"]
        api.put(f"{BASE}/projects/{project['id']}", json={"status": "active"}, timeout=30)
        body = api.get(f"{BASE}/public/projects/{token}", timeout=30).json()
        assert body["status"] == "active"
        assert body["status_label"] == "Devam Ediyor"
        work = next(s for s in body["steps"] if s["key"] == "work")
        assert work["current"] is True
        assert work["done"] is False
        api.put(f"{BASE}/projects/{project['id']}", json={"status": "completed"}, timeout=30)
        body = api.get(f"{BASE}/public/projects/{token}", timeout=30).json()
        assert body["status"] == "completed"
        assert next(s for s in body["steps"] if s["key"] == "done")["done"] is True

    def test_invalid_and_short_token_404(self, api):
        assert api.get(f"{BASE}/public/projects/deadbeef", timeout=30).status_code == 404
        assert api.get(f"{BASE}/public/projects/{uuid.uuid4().hex}", timeout=30).status_code == 404
        assert api.post(f"{BASE}/public/projects/{uuid.uuid4().hex}", json={}, timeout=30).status_code in (404, 405)

    def test_whatsapp_channel_without_phone_fails_gracefully(self, api, project):
        r = api.post(f"{BASE}/projects/{project['id']}/send-tracking", json={"channels": ["whatsapp"], "phone": "", "base_url": "http://x"}, timeout=30)
        # contact cnt_01 usually has a phone; if send is simulated/sent that's ok, if failed due to missing phone also ok
        assert r.status_code == 200, r.text
        assert r.json()["token"]
        assert r.json()["link"].endswith(r.json()["token"])
