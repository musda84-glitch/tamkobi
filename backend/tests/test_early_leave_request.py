"""Erken çıkış talebi: personel talep eder, yönetici onaylar/reddeder."""
import os
import uuid

import requests

BASE = (os.environ.get("REACT_APP_BACKEND_URL") or "http://127.0.0.1:8000").rstrip("/")
API = BASE + "/api"
ADMIN_EMAIL = "admin@nexus.com"
ADMIN_PASS = "admin123"


def _admin():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20)
    assert r.status_code == 200, r.text
    return s


def _link_employee(s, company_id, user_id, name):
    # Minimal employee card linked to user (best-effort; skip if API shape differs)
    r = s.get(f"{API}/personnel/employees", params={"company_id": company_id}, timeout=20)
    if r.status_code != 200:
        return None
    rows = r.json() if isinstance(r.json(), list) else r.json().get("employees") or []
    for e in rows:
        if e.get("user_id") == user_id or e.get("full_name") == name:
            return e.get("id") or e.get("_id")
    # create
    payload = {
        "company_id": company_id,
        "full_name": name,
        "user_id": user_id,
        "department": "Test",
        "position": "Tester",
        "status": "active",
    }
    cr = s.post(f"{API}/personnel/employees", json=payload, timeout=30)
    if cr.status_code not in (200, 201):
        return None
    body = cr.json()
    return body.get("id") or body.get("_id")


class TestEarlyLeaveRequest:
    def test_early_leave_requires_check_in(self):
        s = _admin()
        # Without being checked in, request should fail (403 no employee or 400)
        r = s.post(
            f"{API}/personnel/attendance/early-leave-request",
            json={"reason": "doktor randevusu"},
            timeout=20,
        )
        assert r.status_code in (400, 403), r.text

    def test_early_leave_reason_validation(self):
        s = _admin()
        r = s.post(
            f"{API}/personnel/attendance/early-leave-request",
            json={"reason": "ab"},
            timeout=20,
        )
        assert r.status_code in (400, 403), r.text
        if r.status_code == 400:
            assert "neden" in (r.json().get("detail") or "").lower() or "karakter" in (r.json().get("detail") or "").lower()
