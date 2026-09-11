"""Proje analizi leftovers: real /auth/me session, no fake guest user."""
from __future__ import annotations

import requests

from conftest import API


def test_auth_me_guest_is_unauthenticated_not_demo_admin():
    r = requests.get(f"{API}/auth/me", timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["authenticated"] is False
    assert body["user"] is None
    assert body["companies"] == []
    assert body["license"] is None


def test_auth_me_after_login_returns_real_user():
    login = requests.post(
        f"{API}/auth/login",
        json={"email": "admin@nexus.com", "password": "admin123"},
        timeout=15,
    )
    assert login.status_code == 200, login.text
    token = login.json()["token"]
    r = requests.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"}, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["authenticated"] is True
    assert body["user"]["email"] == "admin@nexus.com"
    assert body["user"]["id"]
    assert body["companies"]


def test_jwt_secret_is_insecure_helper():
    from auth_utils import jwt_secret_is_insecure

    assert jwt_secret_is_insecure("") is True
    assert jwt_secret_is_insecure("change-me") is True
    assert jwt_secret_is_insecure("nexus_default_secret_key_99482910") is True
    assert jwt_secret_is_insecure("a-long-unique-secret-not-in-the-blocklist") is False
