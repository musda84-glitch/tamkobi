"""ERP / personel / panel şifre sıfırlama — canlı API varsa çalışır."""
import os
import requests
import pytest


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
    return (v or "http://127.0.0.1:8000").rstrip("/")


BASE_URL = _load_url()
API = BASE_URL + "/api"
ADMIN_EMAIL = "admin@nexus.com"
ADMIN_PASS = "admin123"


def _api_up():
    try:
        r = requests.get(f"{API}/health", timeout=3)
        return r.status_code < 500
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not _api_up(), reason="backend API not running")


def test_forgot_unknown_email_generic():
    r = requests.post(f"{API}/auth/forgot-password", json={"email": "nobody-xyz@example.com"}, timeout=20)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d.get("status") == "ok"
    assert "reset_token" not in d
    assert "reset_url" not in d


def test_forgot_never_returns_reset_link_on_mail_fail():
    r = requests.post(
        f"{API}/auth/forgot-password",
        json={"email": ADMIN_EMAIL, "base_url": BASE_URL, "next": "login"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    d = r.json()
    assert "reset_token" not in d
    assert "reset_url" not in d
    assert d.get("status") == "ok"


def test_erp_forgot_and_reset_roundtrip():
    r = requests.post(
        f"{API}/auth/forgot-password",
        json={"email": ADMIN_EMAIL, "base_url": BASE_URL, "next": "login"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    token = r.json().get("reset_token")
    if not token:
        pytest.skip("reset token istemciye dönülmez (e-posta zorunlu)")
    g = requests.get(f"{API}/auth/reset/{token}", timeout=20)
    assert g.status_code == 200, g.text
    assert g.json().get("valid") is True
    short = requests.post(f"{API}/auth/reset/{token}", json={"password": "123"}, timeout=20)
    assert short.status_code == 400
    r2 = requests.post(f"{API}/auth/reset/{token}", json={"password": ADMIN_PASS}, timeout=20)
    assert r2.status_code == 200, r2.text
    assert r2.json().get("redirect") == "/login"
    reused = requests.post(f"{API}/auth/reset/{token}", json={"password": "again99"}, timeout=20)
    assert reused.status_code == 400
    ok = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20)
    assert ok.status_code == 200, ok.text


def test_panel_forgot_next_sistem():
    r = requests.post(
        f"{API}/auth/forgot-password",
        json={"email": ADMIN_EMAIL, "base_url": BASE_URL, "next": "sistem"},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    token = r.json().get("reset_token")
    if not token:
        pytest.skip("reset token istemciye dönülmez")
    g = requests.get(f"{API}/auth/reset/{token}", timeout=20)
    assert g.json().get("next") == "sistem"
    r2 = requests.post(f"{API}/auth/reset/{token}", json={"password": ADMIN_PASS}, timeout=20)
    assert r2.status_code == 200, r2.text
    assert r2.json().get("redirect") == "/sistem/giris"
