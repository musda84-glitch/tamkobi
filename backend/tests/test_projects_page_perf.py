"""Lightweight list endpoints used by Teklif / Proje / Keşif page."""
import os

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


class TestProjectsPagePerfEndpoints:
    def test_quotes_summary_omits_items(self, api):
        summary = api.get(f"{BASE}/quotes", params={"company_id": COMPANY, "summary": 1}, timeout=60)
        assert summary.status_code == 200, summary.text
        rows = summary.json()
        assert isinstance(rows, list)
        for q in rows[:20]:
            assert "items" not in q
            assert q.get("quote_number") or q.get("id")

    def test_projects_light_has_quote_aggregates(self, api):
        r = api.get(f"{BASE}/projects", params={"company_id": COMPANY, "light": 1}, timeout=60)
        assert r.status_code == 200, r.text
        rows = r.json()
        assert isinstance(rows, list)
        for p in rows[:20]:
            assert "quote_count" in p
            assert "quoted_total" in p
            assert "invoiced_total" in p
            assert "expense_total" in p

    def test_contacts_lite_and_products_lite(self, api):
        c = api.get(f"{BASE}/contacts", params={"company_id": COMPANY, "lite": 1}, timeout=60)
        assert c.status_code == 200, c.text
        contacts = c.json()
        assert isinstance(contacts, list)
        if contacts:
            assert "name" in contacts[0]

        p = api.get(f"{BASE}/products", params={"company_id": COMPANY, "lite": 1}, timeout=60)
        assert p.status_code == 200, p.text
        products = p.json()
        assert isinstance(products, list)
        for prod in products[:20]:
            assert "purchase_costs" not in prod
            assert "avg_purchase_price" not in prod
            assert "last_purchase_price" not in prod

        # lite print fields
        sample = next((x for x in products if x.get("image_url") or x.get("images")), products[0] if products else None)
        if sample:
            assert "name" in sample
            pid = sample.get("id")
            r2 = api.get(f"{BASE}/products", params={"company_id": COMPANY, "lite": 1, "ids": pid}, timeout=60)
            assert r2.status_code == 200, r2.text
            filtered = r2.json()
            assert isinstance(filtered, list)
            assert len(filtered) >= 1
            assert all(x.get("id") == pid for x in filtered)
            for prod in filtered:
                assert "purchase_costs" not in prod
                assert "avg_purchase_price" not in prod
