"""Live /api/setup endpoints: existing TamKobi installs must not re-run the wizard."""
from __future__ import annotations

import os

import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "http://127.0.0.1:8000").rstrip("/")
API = BASE_URL + "/api"


class TestSetupWizardApi:
    def test_status_reports_installed_on_seeded_server(self):
        r = requests.get(f"{API}/setup/status", timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["installed"] is True
        assert "defaults" in body
        assert body["defaults"]["db_name"]
        assert "password" not in body["defaults"]
        assert "db_password" not in body["defaults"]

    def test_install_rejected_when_already_installed(self):
        r = requests.post(
            f"{API}/setup/install",
            json={
                "db_host": "127.0.0.1",
                "db_port": 3306,
                "db_name": "tamkobi",
                "db_user": "tamkobi",
                "db_password": "x",
                "site_name": "Should Not Apply",
                "admin_email": "nobody@example.com",
                "admin_password": "password1",
                "admin_name": "Nope",
            },
            timeout=20,
        )
        assert r.status_code == 409, r.text

    def test_test_db_rejected_when_already_installed(self):
        r = requests.post(
            f"{API}/setup/test-db",
            json={
                "db_host": "127.0.0.1",
                "db_port": 3306,
                "db_name": "tamkobi",
                "db_user": "tamkobi",
                "db_password": "x",
            },
            timeout=20,
        )
        assert r.status_code == 409, r.text
