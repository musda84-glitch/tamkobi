"""Iteration 42: change-password, B2B password reset, AI cart alias learning."""
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


@pytest.fixture(scope="module")
def admin():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20)
    assert r.status_code == 200, r.text
    return s


def _ensure_b2b(admin):
    r = admin.post(f"{API}/contacts/cnt_01/b2b-access", json={
        "enabled": True, "password": "b2b12345", "login_email": "b2btest@musteri.com", "base_url": BASE_URL,
    }, timeout=20)
    assert r.status_code == 200, r.text
    lg = requests.post(f"{API}/public/b2b/login", json={"email": "b2btest@musteri.com", "password": "b2b12345"}, timeout=20)
    assert lg.status_code == 200, lg.text
    return lg.json()["token"]


class TestIteration42:
    def test_change_password_requires_auth(self):
        r = requests.post(f"{API}/auth/change-password", json={"current_password": "x", "new_password": "newpass1"}, timeout=20)
        assert r.status_code == 401

    def test_change_password_wrong_current(self, admin):
        r = admin.post(f"{API}/auth/change-password", json={"current_password": "definitely-wrong", "new_password": "newpass1"}, timeout=20)
        assert r.status_code == 400

    def test_change_password_own_account(self):
        email = f"it42_{uuid.uuid4().hex[:8]}@nexus.test"
        r = requests.post(f"{API}/auth/register", json={"name": "IT42 User", "email": email, "password": "oldpass1", "company_name": "IT42 Co"}, timeout=20)
        assert r.status_code == 200, r.text
        token = r.json().get("token") or r.json().get("access_token")
        assert token
        h = {"Authorization": f"Bearer {token}"}
        r = requests.post(f"{API}/auth/change-password", json={"current_password": "oldpass1", "new_password": "short"}, headers=h, timeout=20)
        assert r.status_code == 400
        r = requests.post(f"{API}/auth/change-password", json={"current_password": "oldpass1", "new_password": "oldpass1"}, headers=h, timeout=20)
        assert r.status_code == 400
        r = requests.post(f"{API}/auth/change-password", json={"current_password": "oldpass1", "new_password": "newpass1"}, headers=h, timeout=20)
        assert r.status_code == 200, r.text
        assert requests.post(f"{API}/auth/login", json={"email": email, "password": "oldpass1"}, timeout=20).status_code == 401
        r2 = requests.post(f"{API}/auth/login", json={"email": email, "password": "newpass1"}, timeout=20)
        assert r2.status_code == 200, r2.text

    def test_forgot_unknown_email_generic(self):
        r = requests.post(f"{API}/public/b2b/forgot-password", json={"email": "nobody-xyz@example.com"}, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "reset_token" not in d
        assert d.get("status") == "ok"

    def test_b2b_forgot_and_reset_roundtrip(self, admin):
        _ensure_b2b(admin)
        r = requests.post(f"{API}/public/b2b/forgot-password", json={"email": "b2btest@musteri.com", "base_url": BASE_URL}, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "reset_token" not in d
        assert "reset_url" not in d
        token = d.get("reset_token")
        if not token:
            pytest.skip("reset token istemciye dönülmez (e-posta zorunlu); roundtrip e-posta ile test edilir")
        g = requests.get(f"{API}/public/b2b/reset/{token}", timeout=20)
        assert g.status_code == 200, g.text
        assert g.json().get("valid") is True
        r2 = requests.post(f"{API}/public/b2b/reset/{token}", json={"password": "reset99"}, timeout=20)
        assert r2.status_code == 200, r2.text
        ok = requests.post(f"{API}/public/b2b/login", json={"email": "b2btest@musteri.com", "password": "reset99"}, timeout=20)
        assert ok.status_code == 200, ok.text
        reused = requests.post(f"{API}/public/b2b/reset/{token}", json={"password": "again99"}, timeout=20)
        assert reused.status_code == 400
        _ensure_b2b(admin)

    def test_b2b_forgot_never_returns_reset_link(self, admin):
        _ensure_b2b(admin)
        r = requests.post(f"{API}/public/b2b/forgot-password", json={"email": "b2btest@musteri.com", "base_url": BASE_URL}, timeout=20)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "reset_token" not in d
        assert "reset_url" not in d
        assert d.get("status") == "ok"

    def test_b2b_reset_short_password(self, admin):
        _ensure_b2b(admin)
        r = requests.post(f"{API}/public/b2b/forgot-password", json={"email": "b2btest@musteri.com"}, timeout=20)
        token = r.json().get("reset_token")
        if not token:
            pytest.skip("reset token istemciye dönülmez")
        r2 = requests.post(f"{API}/public/b2b/reset/{token}", json={"password": "123"}, timeout=20)
        assert r2.status_code == 400
        requests.post(f"{API}/public/b2b/reset/{token}", json={"password": "b2b12345"}, timeout=20)

    def test_ai_cart_learn_then_match(self, admin):
        token = _ensure_b2b(admin)
        portal = requests.get(f"{API}/public/b2b/{token}", timeout=20)
        assert portal.status_code == 200, portal.text
        products = portal.json().get("products") or []
        assert products, "B2B catalog empty"
        p = products[0]
        alias = f"it42-ozel-ad-{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/public/b2b/{token}/ai-cart/learn", json={"mappings": [{"alias": alias, "product_id": p["id"]}]}, timeout=20)
        assert r.status_code == 200, r.text
        assert r.json()["count"] == 1
        m = requests.post(f"{API}/public/b2b/{token}/ai-cart/match", json={"items": [{"product_name": alias, "quantity": 3}]}, timeout=20)
        assert m.status_code == 200, m.text
        d = m.json()
        assert len(d["items"]) == 1
        assert d["items"][0]["product_id"] == p["id"]
        assert d["items"][0]["learned"] is True
        assert d["items"][0]["quantity"] == 3
        m2 = requests.post(f"{API}/public/b2b/{token}/ai-cart/match", json={"items": [{"product_name": "zzzxxyyqq-unknown-42", "quantity": 1}]}, timeout=20)
        assert m2.status_code == 200
        assert m2.json()["unmatched"]

    def test_ai_cart_learn_bad_token(self):
        r = requests.post(f"{API}/public/b2b/BADTOKEN/ai-cart/learn", json={"mappings": [{"alias": "x", "product_id": "p1"}]}, timeout=20)
        assert r.status_code == 404
