"""Personel kartı özet: kalan alacak, fazla mesai, giriş/ayrılış, işten çıkar, performans."""
import os
import sys
import uuid
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from models import Employee  # noqa: E402
from attendance import (  # noqa: E402
    expected_work_dates,
    expand_leave_dates,
    performance_scores,
)

_frontend_env = dotenv_values("/app/frontend/.env") or dotenv_values("/workspace/frontend/.env") or {}
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _frontend_env.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
API = f"{BASE_URL}/api" if BASE_URL else ""
COMPANY = os.environ.get("TEST_COMPANY_ID") or "comp_nexus_main_01"
ADMIN = os.environ.get("TEST_ADMIN_EMAIL", "admin@nexus.com")
ADMIN_PW = os.environ.get("TEST_ADMIN_PASSWORD", "admin123")


def test_employee_model_keeps_end_date():
    e = Employee(
        company_id=COMPANY,
        full_name="Ayrılış Test",
        tc_kimlik="22222222222",
        department="Üretim",
        position="Operatör",
        phone="05550000000",
        email="end@test.local",
        salary=1,
        start_date="2026-01-01",
        end_date="2026-09-19",
        status="terminated",
    )
    dumped = e.to_mongo()
    assert dumped.get("end_date") == "2026-09-19"
    assert dumped.get("status") == "terminated"


def test_expected_work_dates_skips_weekend_and_clips_hire():
    days = expected_work_dates("2026-09", [0, 1, 2, 3, 4], hire_date="2026-09-02", today="2026-09-07")
    assert "2026-09-01" not in days
    assert "2026-09-02" in days  # Çar
    assert "2026-09-05" not in days  # Cmt
    assert "2026-09-06" not in days  # Paz
    assert days[-1] == "2026-09-07"


def test_expand_leave_only_approved():
    days = expand_leave_dates(
        [
            {"status": "approved", "start_date": "2026-09-03", "end_date": "2026-09-04"},
            {"status": "pending", "start_date": "2026-09-01", "end_date": "2026-09-01"},
        ],
        "2026-09-01",
        "2026-09-07",
    )
    assert days == {"2026-09-03", "2026-09-04"}


def test_performance_scores_checkin_checkout_leave_task():
    expected = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"]
    att = [
        {"date": "2026-09-01", "check_in": "09:00", "check_out": "18:00", "status": "present"},
        {"date": "2026-09-02", "check_in": "09:05", "status": "present"},
        {"date": "2026-09-04", "status": "leave"},
    ]
    leaves = [{"status": "approved", "start_date": "2026-09-04", "end_date": "2026-09-04"}]
    tasks = [{"done": True}, {"done": False}]
    perf = performance_scores(att, leaves, tasks, [], expected, "2026-09")
    assert perf["check_in"]["ok"] == 2
    assert perf["check_in"]["expected"] == 3
    assert perf["check_in"]["pct"] == 67
    assert perf["check_out"]["ok"] == 1
    assert perf["check_out"]["pct"] == 33
    assert perf["leave"]["approved_days"] == 1
    assert perf["leave"]["absent_days"] == 1
    assert perf["leave"]["pct"] == 50
    assert perf["task"] == {"pct": 50, "done": 1, "total": 2}
    assert perf["overall"] == round((67 + 33 + 50 + 50) / 4)


def test_performance_empty_expected_is_full():
    perf = performance_scores([], [], [], [], [], "2026-09")
    assert perf["check_in"]["pct"] == 100
    assert perf["leave"]["pct"] == 100
    assert perf["task"]["pct"] == 100
    assert perf["overall"] == 100


@pytest.fixture
def api_client():
    if not API:
        pytest.skip("REACT_APP_BACKEND_URL missing")
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": ADMIN, "password": ADMIN_PW}, timeout=30)
    if r.status_code != 200:
        pytest.skip(f"admin login unavailable: {r.status_code}")
    return s


def _make_emp(api_client, name, **extra):
    payload = {
        "company_id": COMPANY,
        "full_name": name,
        "tc_kimlik": f"3{uuid.uuid4().hex[:10]}",
        "department": "Üretim",
        "position": "Operatör",
        "phone": "05551112233",
        "email": f"card_{uuid.uuid4().hex[:8]}@test.local",
        "salary": 30000,
        "start_date": "2026-01-15",
    }
    payload.update(extra)
    r = api_client.post(f"{API}/personnel/employees", json=payload, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def test_card_includes_balance_overtime_performance(api_client):
    emp = _make_emp(api_client, "Kart Ozet Test")
    eid = emp["id"]
    r = api_client.get(f"{API}/personnel/employees/{eid}/card", timeout=30)
    assert r.status_code == 200, r.text
    c = r.json()
    for k in ("balance", "overtime", "performance"):
        assert k in c, k
    assert "remaining" in c["balance"]
    assert c["employee"]["start_date"] == "2026-01-15"
    assert c["employee"].get("end_date") in (None, "")
    ot = c["overtime"]
    for k in ("hours", "amount", "weekday_hours", "holiday_hours"):
        assert k in ot, k
    perf = c["performance"]
    for k in ("check_in", "check_out", "leave", "task", "overall"):
        assert k in perf, k
        if k != "overall":
            assert "pct" in perf[k]


def test_terminate_requires_confirm_then_sets_end_date(api_client):
    emp = _make_emp(api_client, "Isten Cikar Test")
    eid = emp["id"]
    denied = api_client.post(f"{API}/personnel/employees/{eid}/terminate", json={}, timeout=30)
    assert denied.status_code == 400, denied.text
    still = api_client.get(f"{API}/personnel/employees/{eid}/card", timeout=30).json()
    assert still["employee"].get("status") == "active"

    ok = api_client.post(
        f"{API}/personnel/employees/{eid}/terminate",
        json={"confirm": True, "end_date": "2026-09-19"},
        timeout=30,
    )
    assert ok.status_code == 200, ok.text
    body = ok.json()
    assert body["employee"]["status"] == "terminated"
    assert body["employee"]["end_date"] == "2026-09-19"

    card = api_client.get(f"{API}/personnel/employees/{eid}/card", timeout=30).json()
    assert card["employee"]["status"] == "terminated"
    assert card["employee"]["end_date"] == "2026-09-19"

    again = api_client.post(
        f"{API}/personnel/employees/{eid}/terminate",
        json={"confirm": True},
        timeout=30,
    )
    assert again.status_code == 400
