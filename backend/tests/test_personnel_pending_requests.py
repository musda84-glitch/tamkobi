"""Personnel pending-requests inbox endpoint."""
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


class TestPersonnelPendingRequests:
    def test_pending_requests_shape(self, api):
        r = api.get(f"{BASE}/personnel/pending-requests", params={"company_id": COMPANY}, timeout=60)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "count" in data and "items" in data
        assert isinstance(data["items"], list)
        assert data["count"] == len(data["items"])
        for it in data["items"][:20]:
            assert it.get("kind") in ("leave", "early_leave", "intraday_leave", "dispute", "advance", "yevmiye_adjustment", "location_exit")
            assert it.get("id")
            assert "employee_id" in it
            assert "employee_name" in it
            assert "title" in it
            assert "link" in it
