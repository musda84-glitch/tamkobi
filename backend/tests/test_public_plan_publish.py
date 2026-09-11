"""Publish/unpublish SaaS plans: admin toggle vs GET /api/public/plans vitrin."""
import os
import uuid

import requests

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or "http://127.0.0.1:8000").rstrip("/")
API = BASE_URL + "/api"
ADMIN_EMAIL = "admin@nexus.com"
ADMIN_PASS = "admin123"


def _admin():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20)
    assert r.status_code == 200, r.text
    assert r.json()["user"].get("is_super_admin") is True
    return s


class TestPublicPlanPublish:
    def test_public_plans_follow_is_public(self):
        pub = requests.get(f"{API}/public/plans", timeout=20)
        assert pub.status_code == 200, pub.text
        body = pub.json()
        assert body.get("brand_name")
        ids = {p["id"] for p in body["plans"]}
        assert ids, "vitrinde en az bir paket olmalı"

        s = _admin()
        r = s.get(f"{API}/system/plans", timeout=20)
        assert r.status_code == 200, r.text
        hidden_name = f"Gizli {uuid.uuid4().hex[:6]}"
        r = s.post(
            f"{API}/system/plans",
            json={"name": hidden_name, "tagline": "test", "price_monthly": 1, "price_yearly": 10, "user_limit": 1, "modules": ["/contacts"], "is_public": False, "sort": 99},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        pid = r.json()["id"]
        try:
            vis = {p["id"] for p in requests.get(f"{API}/public/plans", timeout=20).json()["plans"]}
            assert pid not in vis
            r = s.put(f"{API}/system/plans/{pid}", json={"is_public": True}, timeout=20)
            assert r.status_code == 200, r.text
            assert r.json()["is_public"] is True
            vis = {p["id"] for p in requests.get(f"{API}/public/plans", timeout=20).json()["plans"]}
            assert pid in vis
            r = s.put(f"{API}/system/plans/{pid}", json={"is_public": False}, timeout=20)
            assert r.status_code == 200, r.text
            vis = {p["id"] for p in requests.get(f"{API}/public/plans", timeout=20).json()["plans"]}
            assert pid not in vis
        finally:
            s.delete(f"{API}/system/plans/{pid}", timeout=20)
