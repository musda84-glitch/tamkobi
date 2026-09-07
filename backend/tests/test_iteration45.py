"""Iteration 45: B2B portal contact can change their own password."""
import os
import uuid
import pytest
import requests

def _load_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if not v:
        for path in ("/app/frontend/.env", "/workspace/frontend/.env"):
            try:
                for line in open(path):
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        v = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break
            except Exception:
                pass
            if v:
                break
    if not v:
        v = "http://127.0.0.1:8000"
    return v.rstrip("/")

BASE_URL = _load_url()
API = BASE_URL + "/api"
ADMIN_EMAIL = "admin@nexus.com"
ADMIN_PASS = "admin123"
B2B_EMAIL = "b2btest@musteri.com"
B2B_PASS = "b2b12345"


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20)
    assert r.status_code == 200, r.text
    return s


def _ensure_b2b(admin):
    r = admin.post(f"{API}/contacts/cnt_01/b2b-access", json={
        "enabled": True, "password": B2B_PASS, "login_email": B2B_EMAIL, "base_url": BASE_URL,
    }, timeout=20)
    assert r.status_code == 200, r.text
    lg = requests.post(f"{API}/public/b2b/login", json={"email": B2B_EMAIL, "password": B2B_PASS}, timeout=20)
    assert lg.status_code == 200, lg.text
    return lg.json()["token"]


def _restore_b2b(admin):
    admin.post(f"{API}/contacts/cnt_01/b2b-access", json={
        "enabled": True, "password": B2B_PASS, "login_email": B2B_EMAIL, "base_url": BASE_URL,
    }, timeout=20)


class TestIteration45:
    def test_portal_exposes_has_password_not_hash(self, admin):
        token = _ensure_b2b(admin)
        r = requests.get(f"{API}/public/b2b/{token}", timeout=20)
        assert r.status_code == 200, r.text
        contact = r.json()["contact"]
        assert contact["has_password"] is True
        assert "b2b_password_hash" not in contact
        assert "password_hash" not in contact
        assert "password" not in contact

    def test_unknown_token(self):
        r = requests.post(
            f"{API}/public/b2b/deadbeefdeadbeef/change-password",
            json={"current_password": B2B_PASS, "new_password": "newpass1"},
            timeout=20,
        )
        assert r.status_code == 404

    def test_wrong_current(self, admin):
        token = _ensure_b2b(admin)
        r = requests.post(
            f"{API}/public/b2b/{token}/change-password",
            json={"current_password": "definitely-wrong", "new_password": "newpass1"},
            timeout=20,
        )
        assert r.status_code == 400
        assert "hatalı" in (r.json().get("detail") or "").lower()

    def test_short_new_password(self, admin):
        token = _ensure_b2b(admin)
        r = requests.post(
            f"{API}/public/b2b/{token}/change-password",
            json={"current_password": B2B_PASS, "new_password": "123"},
            timeout=20,
        )
        assert r.status_code == 400

    def test_same_as_current(self, admin):
        token = _ensure_b2b(admin)
        r = requests.post(
            f"{API}/public/b2b/{token}/change-password",
            json={"current_password": B2B_PASS, "new_password": B2B_PASS},
            timeout=20,
        )
        assert r.status_code == 400

    def test_success_then_login(self, admin):
        token = _ensure_b2b(admin)
        new_pw = f"it43_{uuid.uuid4().hex[:8]}"
        try:
            r = requests.post(
                f"{API}/public/b2b/{token}/change-password",
                json={"current_password": B2B_PASS, "new_password": new_pw},
                timeout=20,
            )
            assert r.status_code == 200, r.text
            assert r.json().get("status") == "success"
            old = requests.post(f"{API}/public/b2b/login", json={"email": B2B_EMAIL, "password": B2B_PASS}, timeout=20)
            assert old.status_code == 401
            ok = requests.post(f"{API}/public/b2b/login", json={"email": B2B_EMAIL, "password": new_pw}, timeout=20)
            assert ok.status_code == 200, ok.text
            assert ok.json()["token"] == token
        finally:
            _restore_b2b(admin)
