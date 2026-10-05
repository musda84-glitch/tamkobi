"""DELETE /personnel/payrolls/{id} — pending maaş kaydını çöpe taşır."""
import pytest
import requests

from conftest import API, TEST_COMPANY_ID

TIMEOUT = 30


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def test_delete_unknown_payroll_404(client):
    r = client.delete(f"{API}/personnel/payrolls/pay_missing_zzzz", timeout=TIMEOUT)
    assert r.status_code == 404, r.text


def test_delete_pending_payroll(client):
    emps = client.get(f"{API}/personnel/employees", params={"company_id": TEST_COMPANY_ID}, timeout=TIMEOUT)
    assert emps.status_code == 200, emps.text
    rows = emps.json()
    emp = next((e for e in rows if e.get("status") != "terminated"), None)
    assert emp, rows
    emp_id = emp.get("id") or emp.get("_id")
    period = "2026-11"
    gen = client.post(
        f"{API}/personnel/generate-payroll",
        json={"company_id": TEST_COMPANY_ID, "period": period, "employee_id": emp_id},
        timeout=TIMEOUT,
    )
    assert gen.status_code == 200, gen.text
    payrolls = gen.json().get("payrolls") or []
    row = next((p for p in payrolls if (p.get("id") or p.get("_id")) and p.get("status") != "paid"), None)
    if not row:
        listed = client.get(
            f"{API}/personnel/payrolls",
            params={"company_id": TEST_COMPANY_ID, "period": period},
            timeout=TIMEOUT,
        )
        assert listed.status_code == 200, listed.text
        body = listed.json()
        items = body if isinstance(body, list) else (body.get("payrolls") or [])
        row = next(
            (p for p in items if p.get("employee_id") in (emp_id, str(emp_id)) and p.get("status") != "paid"),
            None,
        )
    assert row, gen.json()
    pid = row.get("id") or row.get("_id")
    dr = client.delete(f"{API}/personnel/payrolls/{pid}", timeout=TIMEOUT)
    assert dr.status_code == 200, dr.text
    assert "çöp" in (dr.json().get("message") or "").lower() or dr.json().get("status") == "success"
    again = client.delete(f"{API}/personnel/payrolls/{pid}", timeout=TIMEOUT)
    assert again.status_code == 404, again.text
