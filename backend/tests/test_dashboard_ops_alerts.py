"""Dashboard ops-alerts endpoint."""
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


class TestDashboardOpsAlerts:
    def test_ops_alerts_shape(self, api):
        r = api.get(f"{BASE}/dashboard/ops-alerts", params={"company_id": COMPANY}, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "count" in data and "groups" in data
        keys = {g["key"] for g in data["groups"]}
        assert keys == {"pick_missing", "low_stock", "production", "shipped", "new_orders"}
        by_key = {g["key"]: g for g in data["groups"]}
        assert "status=critical" in by_key["low_stock"]["path"]
        assert "status=dispatched" in by_key["shipped"]["path"]
        assert "status=incoming" in by_key["new_orders"]["path"]
        assert by_key["production"]["path"].startswith("/production")
        assert by_key["pick_missing"]["path"].startswith("/production")
        for g in data["groups"]:
            assert "label" in g and "count" in g and "items" in g and "path" in g
            assert isinstance(g["items"], list)
            assert g["count"] >= len(g["items"])
