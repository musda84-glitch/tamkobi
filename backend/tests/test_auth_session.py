"""Proje analizi leftovers: real /auth/me session, no fake guest user."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient

from server import app

client = TestClient(app)


def test_auth_me_guest_is_unauthenticated_not_demo_admin():
    r = client.get("/api/auth/me")
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["authenticated"] is False
    assert body["user"] is None
    assert body["companies"] == []
    assert body["license"] is None


def test_auth_me_after_login_returns_real_user():
    login = client.post(
        "/api/auth/login",
        json={"email": "admin@nexus.com", "password": "admin123"},
    )
    assert login.status_code == 200, login.text
    token = login.json()["token"]
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["authenticated"] is True
    assert body["user"]["email"] == "admin@nexus.com"
    assert body["user"]["name"] != "Sarp Yılmaz"
    assert body["companies"]


def test_jwt_secret_is_insecure_helper():
    from auth_utils import jwt_secret_is_insecure

    assert jwt_secret_is_insecure("") is True
    assert jwt_secret_is_insecure("change-me") is True
    assert jwt_secret_is_insecure("nexus_default_secret_key_99482910") is True
    assert jwt_secret_is_insecure("a-long-unique-secret-not-in-the-blocklist") is False
