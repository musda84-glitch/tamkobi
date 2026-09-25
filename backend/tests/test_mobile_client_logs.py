"""Company-scoped mobile / panel client logs (Çöp Kutusu > Mobil Loglar)."""
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
    return s


def _create_tenant(admin):
    suffix = uuid.uuid4().hex[:8]
    email = f"mlog_{suffix}@test.local"
    password = "mlog-pass1"
    r = admin.post(
        f"{API}/system/companies",
        json={
            "name": f"MLog {suffix}",
            "admin_email": email,
            "admin_password": password,
            "admin_name": "MLog Admin",
            "plan_id": "plan_starter",
            "trial_days": 0,
        },
        timeout=20,
    )
    assert r.status_code == 200, r.text
    return r.json()["id"], email, password


def _login(email, password):
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=20)
    assert r.status_code == 200, r.text
    return s


class TestMobileClientLogs:
    def test_post_list_delete_and_isolate(self):
        admin = _admin()
        a_id, a_email, a_pass = _create_tenant(admin)
        b_id, b_email, b_pass = _create_tenant(admin)

        sa = _login(a_email, a_pass)
        sb = _login(b_email, b_pass)

        created = sa.post(
            f"{API}/mobile/logs",
            json={
                "company_id": a_id,
                "source": "mobile",
                "level": "ERROR",
                "message": "Stok ekranı çöktü",
                "screen": "Stok",
                "stack": "Error: boom\n  at Stock.tsx:1",
                "platform": "android 34",
                "app_version": "1.2.3",
            },
            timeout=20,
        )
        assert created.status_code == 200, created.text
        log_id = created.json()["id"]
        assert log_id

        listed = sa.get(f"{API}/mobile/logs", params={"company_id": a_id}, timeout=20)
        assert listed.status_code == 200, listed.text
        body = listed.json()
        assert body["total"] >= 1
        assert any(i["id"] == log_id for i in body["items"])
        row = next(i for i in body["items"] if i["id"] == log_id)
        assert row["message"] == "Stok ekranı çöktü"
        assert row["source"] == "mobile"
        assert row["level"] == "ERROR"

        # Other tenant cannot see or delete
        other = sb.get(f"{API}/mobile/logs", params={"company_id": a_id}, timeout=20)
        assert other.status_code == 403, other.text

        leak = sb.get(f"{API}/mobile/logs", params={"company_id": b_id}, timeout=20)
        assert leak.status_code == 200, leak.text
        assert all(i["id"] != log_id for i in leak.json().get("items") or [])

        forbidden_del = sb.delete(f"{API}/mobile/logs/{log_id}", params={"company_id": a_id}, timeout=20)
        assert forbidden_del.status_code == 403, forbidden_del.text

        # Missing message rejected
        bad = sa.post(f"{API}/mobile/logs", json={"company_id": a_id, "message": ""}, timeout=20)
        assert bad.status_code == 400, bad.text

        deleted = sa.delete(f"{API}/mobile/logs/{log_id}", params={"company_id": a_id}, timeout=20)
        assert deleted.status_code == 200, deleted.text
        after = sa.get(f"{API}/mobile/logs", params={"company_id": a_id}, timeout=20)
        assert after.status_code == 200
        assert all(i["id"] != log_id for i in after.json().get("items") or [])
