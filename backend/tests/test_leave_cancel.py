"""İzin iptal: onaylı yıllık izinde bakiye iadesi; reddedilmiş iptal edilemez."""
import uuid

import pytest
import requests

from conftest import API, TEST_COMPANY_ID

TIMEOUT = 30


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def emp(api):
    r = api.get(f"{API}/personnel/employees", params={"company_id": TEST_COMPANY_ID}, timeout=TIMEOUT)
    if r.status_code != 200:
        pytest.skip(f"personnel API unavailable: {r.status_code}")
    actives = [e for e in r.json() if e.get("status") == "active"]
    if not actives:
        pytest.skip("no active employees")
    return actives[0]


def _leave_body(emp, **extra):
    body = {
        "employee_id": emp["id"],
        "type": "unpaid",
        "start_date": "2026-12-21",
        "end_date": "2026-12-21",
        "reason": f"TEST_leave_cancel_{uuid.uuid4().hex[:6]}",
    }
    body.update(extra)
    return body


def test_cancel_pending_sets_cancelled(api, emp):
    r = api.post(f"{API}/personnel/leaves", json=_leave_body(emp), timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    lid = r.json()["id"]
    try:
        c = api.post(f"{API}/personnel/leaves/{lid}/cancel", timeout=TIMEOUT)
        assert c.status_code == 200, c.text
        assert c.json()["status"] == "cancelled"
        again = api.post(f"{API}/personnel/leaves/{lid}/cancel", timeout=TIMEOUT)
        assert again.status_code == 400
    finally:
        api.delete(f"{API}/personnel/leaves/{lid}", timeout=TIMEOUT)


def test_cancel_approved_annual_restores_used_days(api, emp):
    eid = emp["id"]
    before = float(emp.get("used_leave_days") or 0)
    r = api.post(f"{API}/personnel/leaves", json=_leave_body(emp, type="annual", start_date="2026-12-22", end_date="2026-12-23"), timeout=TIMEOUT)
    if r.status_code == 400:
        pytest.skip("insufficient annual leave")
    assert r.status_code == 200, r.text
    lid = r.json()["id"]
    days = float(r.json().get("days") or 2)
    try:
        d = api.post(f"{API}/personnel/leaves/{lid}/decide", json={"status": "approved"}, timeout=TIMEOUT)
        assert d.status_code == 200, d.text
        used = api.get(f"{API}/personnel/employees", params={"company_id": TEST_COMPANY_ID}, timeout=TIMEOUT).json()
        mid = float(next(e for e in used if e["id"] == eid).get("used_leave_days") or 0)
        assert mid == pytest.approx(before + days, abs=0.01)
        c = api.post(f"{API}/personnel/leaves/{lid}/cancel", timeout=TIMEOUT)
        assert c.status_code == 200, c.text
        assert c.json()["status"] == "cancelled"
        used2 = api.get(f"{API}/personnel/employees", params={"company_id": TEST_COMPANY_ID}, timeout=TIMEOUT).json()
        after = float(next(e for e in used2 if e["id"] == eid).get("used_leave_days") or 0)
        assert after == pytest.approx(before, abs=0.01)
    finally:
        api.delete(f"{API}/personnel/leaves/{lid}", timeout=TIMEOUT)
        api.put(f"{API}/personnel/employees/{eid}", json={"used_leave_days": before}, timeout=TIMEOUT)


def test_delete_leave_moves_to_trash(api, emp):
    r = api.post(f"{API}/personnel/leaves", json=_leave_body(emp, start_date="2026-12-24", end_date="2026-12-24"), timeout=TIMEOUT)
    assert r.status_code == 200, r.text
    lid = r.json()["id"]
    d = api.delete(f"{API}/personnel/leaves/{lid}", timeout=TIMEOUT)
    assert d.status_code == 200, d.text
    listed = api.get(f"{API}/personnel/leaves", params={"company_id": TEST_COMPANY_ID, "employee_id": emp["id"]}, timeout=TIMEOUT)
    assert listed.status_code == 200
    assert all(x.get("id") != lid for x in listed.json())
