"""Mesaim: çıkış konumdan bağımsız; atanan fazla mesai beklenen çıkışı uzatır."""
import os
import pytest
import requests
from dotenv import dotenv_values

from attendance import compute_day, DEFAULT_SCHEDULE, _add_minutes

fe = dotenv_values("/app/frontend/.env")
BASE = (os.environ.get("REACT_APP_BACKEND_URL") or fe.get("REACT_APP_BACKEND_URL") or "http://127.0.0.1:8000").rstrip("/")
API = f"{BASE}/api"
COMP = "comp_nexus_main_01"


# ---------- Unit: compute_day + assigned OT ----------
def test_compute_assigned_ot_extends_expected_end():
    sch = {**DEFAULT_SCHEDULE}
    rec = {"date": "2026-09-07", "check_in": "09:00", "check_out": "18:00", "assigned_overtime_hours": 2}
    out = compute_day(rec, sch)
    assert out["expected_end"] == "20:00"
    assert out["early_leave_minutes"] == 120
    assert out["overtime_hours"] == 0.0
    assert out["assigned_overtime_hours"] == 2.0


def test_compute_assigned_ot_checkout_on_time():
    sch = {**DEFAULT_SCHEDULE}
    rec = {"date": "2026-09-07", "check_in": "09:00", "check_out": "20:00", "assigned_overtime_hours": 2}
    out = compute_day(rec, sch)
    assert out["expected_end"] == "20:00"
    assert out["early_leave_minutes"] == 0
    assert out["overtime_hours"] == 2.0


def test_compute_assigned_ot_partial():
    sch = {**DEFAULT_SCHEDULE}
    rec = {"date": "2026-09-07", "check_in": "09:00", "check_out": "19:00", "assigned_overtime_hours": 2}
    out = compute_day(rec, sch)
    assert out["early_leave_minutes"] == 60
    assert out["overtime_hours"] == 1.0


def test_add_minutes_wrap():
    assert _add_minutes("23:30", 60) == "00:30"


# ---------- API ----------
@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    for email, pw in (
        ("admin@nexus.com", "admin123"),
        ("admin@tamkobi.com", "Admin123!"),
        ("admin@demo.com", "demo123"),
    ):
        r = s.post(f"{API}/auth/login", json={"email": email, "password": pw})
        if r.status_code == 200:
            return s
    pytest.skip("admin login failed")


@pytest.fixture(scope="module")
def emp(client):
    r = client.get(f"{API}/personnel/employees?company_id={COMP}")
    if r.status_code != 200:
        pytest.skip("employees unavailable")
    emps = r.json()
    emps = emps if isinstance(emps, list) else emps.get("employees", [])
    if not emps:
        pytest.skip("no employees")
    return emps[0]


@pytest.fixture(scope="module")
def company_loc(client):
    r = client.get(f"{API}/companies/{COMP}")
    if r.status_code != 200:
        return None
    return (r.json() or {}).get("location")


def test_assign_overtime_and_recompute(client, emp):
    date = "2026-09-11"
    eid = emp.get("id") or emp.get("_id")
    r = client.post(f"{API}/personnel/attendance", json={
        "employee_id": eid, "date": date, "check_in": "09:00", "check_out": "18:00", "status": "present",
    })
    assert r.status_code == 200, r.text

    r2 = client.put(f"{API}/personnel/attendance/assign-overtime", json={
        "employee_id": eid, "date": date, "hours": 2, "note": "proje teslimi",
    })
    assert r2.status_code == 200, r2.text
    body = r2.json()
    assert body["status"] == "success"
    rec = body["record"]
    assert rec["assigned_overtime_hours"] == 2
    assert rec["expected_end"] == "20:00"
    assert rec["early_leave_minutes"] == 120
    assert rec["overtime_hours"] == 0

    r3 = client.put(f"{API}/personnel/attendance/assign-overtime", json={
        "employee_id": eid, "date": date, "hours": 0,
    })
    assert r3.status_code == 200, r3.text
    assert r3.json()["record"]["assigned_overtime_hours"] == 0


def test_checkout_without_geo_allowed(client, company_loc):
    """Çıkış konum zorunlu olmamalı; giriş hâlâ konum ister."""
    if not company_loc:
        pytest.skip("company location missing")
    client.put(f"{API}/companies/{COMP}/work-schedule", json={
        "start": "09:00", "end": "18:00", "break_minutes": 60, "work_days": [0, 1, 2, 3, 4],
        "late_tolerance_minutes": 10, "overtime_tolerance_minutes": 15, "require_geo": True,
    })
    me = client.get(f"{API}/personnel/attendance/me")
    if me.status_code != 200 or not me.json().get("employee"):
        pytest.skip("current user not linked to employee")
    payload = {"latitude": company_loc["latitude"], "longitude": company_loc["longitude"], "accuracy_m": 10}

    bad = client.post(f"{API}/personnel/attendance/self", json={"action": "check_in"})
    assert bad.status_code == 400
    assert "Konum" in bad.json()["detail"] or "konum" in bad.json()["detail"].lower()

    cin = client.post(f"{API}/personnel/attendance/self", json={"action": "check_in", **payload})
    if cin.status_code == 400 and "giriş" in cin.json().get("detail", "").lower():
        pass
    else:
        assert cin.status_code == 200, cin.text

    cout = client.post(f"{API}/personnel/attendance/self", json={"action": "check_out"})
    if cout.status_code == 400 and "yapılmış" in cout.json().get("detail", "").lower():
        pytest.skip("already checked out today")
    assert cout.status_code == 200, cout.text
    assert "Çıkış" in cout.json()["message"]
    assert cout.json()["record"].get("check_out")
