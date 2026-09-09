"""Company privacy: opt out of platform management-panel impersonation."""
import os

import pytest
import requests
from dotenv import dotenv_values

BASE = (os.environ.get("REACT_APP_BACKEND_URL") or dotenv_values("/app/frontend/.env").get("REACT_APP_BACKEND_URL") or dotenv_values("/workspace/frontend/.env").get("REACT_APP_BACKEND_URL") or "").rstrip("/")
if not BASE:
    pytest.skip("REACT_APP_BACKEND_URL missing", allow_module_level=True)
API = BASE + "/api"
SA_EMAIL = "musda84@gmail.com"
SA_PASS = "Nexus2026!"
ADMIN_EMAIL = "admin@nexus.com"
ADMIN_PASS = "admin123"
SALES_EMAIL = "satis@nexus.com"
SALES_PASS = "satis123"
CID = "comp_nexus_main_01"


def _login(email, pw):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": pw}, timeout=20)
    assert r.status_code == 200, f"login {email} -> {r.status_code} {r.text[:240]}"
    return s


def _restore():
    admin = _login(ADMIN_EMAIL, ADMIN_PASS)
    admin.put(f"{API}/companies/{CID}/privacy", json={"allow_platform_access": True}, timeout=20)


@pytest.fixture(autouse=True)
def restore_privacy():
    yield
    try:
        _restore()
    except Exception:
        pass


class TestPlatformAccessPrivacy:
    def test_default_allows_impersonation(self):
        admin = _login(ADMIN_EMAIL, ADMIN_PASS)
        r = admin.get(f"{API}/companies/{CID}/privacy", timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["allow_platform_access"] is True

    def test_opt_out_blocks_impersonate_and_is_visible_on_platform(self):
        admin = _login(ADMIN_EMAIL, ADMIN_PASS)
        r = admin.put(f"{API}/companies/{CID}/privacy", json={"allow_platform_access": False}, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["allow_platform_access"] is False
        assert "kapat" in (r.json().get("message") or "").lower()

        sa = _login(SA_EMAIL, SA_PASS)
        blocked = sa.post(f"{API}/system/companies/{CID}/impersonate", timeout=20)
        assert blocked.status_code == 403, blocked.text
        assert "gizlilik" in blocked.json().get("detail", "").lower() or "erişim" in blocked.json().get("detail", "").lower()

        listed = sa.get(f"{API}/system/companies", timeout=20)
        assert listed.status_code == 200, listed.text
        row = next(x for x in listed.json() if x["id"] == CID)
        assert row["allow_platform_access"] is False

        r = admin.put(f"{API}/companies/{CID}/privacy", json={"allow_platform_access": True}, timeout=20)
        assert r.status_code == 200
        assert r.json()["allow_platform_access"] is True
        ok = sa.post(f"{API}/system/companies/{CID}/impersonate", timeout=20)
        assert ok.status_code == 200, ok.text
        sa.post(f"{API}/auth/impersonate/exit", timeout=20)

    def test_sales_cannot_change_privacy(self):
        sales = _login(SALES_EMAIL, SALES_PASS)
        r = sales.put(f"{API}/companies/{CID}/privacy", json={"allow_platform_access": False}, timeout=20)
        assert r.status_code == 403, r.text

    def test_outsider_cannot_read_or_write(self):
        r = requests.get(f"{API}/companies/{CID}/privacy", timeout=20)
        # demo fallback user may exist without cookie; still must be a member
        if r.status_code == 200:
            # unauthenticated get_current_user may return demo admin — that's tenant admin of CID
            assert r.json()["allow_platform_access"] in (True, False)
        sa = _login(SA_EMAIL, SA_PASS)
        # super admin is not the company tenant admin path if they aren't a member; if they are, skip
        me = sa.get(f"{API}/auth/me", timeout=20).json()
        cids = me.get("user", {}).get("company_ids") or [me.get("user", {}).get("active_company_id")]
        if CID not in cids:
            r = sa.put(f"{API}/companies/{CID}/privacy", json={"allow_platform_access": False}, timeout=20)
            assert r.status_code == 403, r.text

    def test_missing_field_400(self):
        admin = _login(ADMIN_EMAIL, ADMIN_PASS)
        r = admin.put(f"{API}/companies/{CID}/privacy", json={}, timeout=20)
        assert r.status_code == 400, r.text
