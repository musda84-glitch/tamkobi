"""Personnel card remaining payable + meal/transport allowances."""
import pytest
import requests

from conftest import API, TEST_COMPANY_ID

CID = TEST_COMPANY_ID


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def emp(api):
    r = api.get(f"{API}/personnel/employees", params={"company_id": CID}, timeout=30)
    assert r.status_code == 200, r.text
    actives = [e for e in r.json() if e.get("status") == "active"]
    assert actives, "no active employees"
    return actives[0]


def _bal(card):
    return card.get("balance") or {}


def test_list_employees_includes_remaining_balance(api, emp):
    card = api.get(f"{API}/personnel/employees/{emp['id']}/card", timeout=30)
    assert card.status_code == 200, card.text
    listed = api.get(f"{API}/personnel/employees", params={"company_id": CID}, timeout=30)
    assert listed.status_code == 200, listed.text
    row = next(x for x in listed.json() if x.get("id") == emp["id"])
    assert "balance" in row
    assert "remaining" in row["balance"]
    assert round(float(row["balance"]["remaining"]), 2) == round(float((card.json().get("balance") or {}).get("remaining") or 0), 2)
    eid = emp["id"]
    prev_meal = float(emp.get("meal_allowance") or 0)
    prev_yol = float(emp.get("transport_allowance") or 0)
    try:
        before = _bal(api.get(f"{API}/personnel/employees/{eid}/card", timeout=30).json())
        meal, yol = 1750.0, 850.0
        r = api.put(f"{API}/personnel/employees/{eid}", json={"meal_allowance": meal, "transport_allowance": yol}, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert float(body.get("meal_allowance") or 0) == meal
        assert float(body.get("transport_allowance") or 0) == yol
        card = api.get(f"{API}/personnel/employees/{eid}/card", timeout=30)
        assert card.status_code == 200, card.text
        bal = _bal(card.json())
        assert float(bal["meal_allowance"]) == meal
        assert float(bal["transport_allowance"]) == yol
        assert float(bal["meal_due"]) <= meal
        assert float(bal["transport_due"]) <= yol
        expected = round(
            float(bal["unpaid_payroll"]) + float(bal["unpaid_expenses"]) + float(bal["meal_due"])
            + float(bal["transport_due"]) + float(bal.get("bonus_pending") or 0) - float(bal.get("advances") or 0),
            2,
        )
        assert float(bal["remaining"]) == expected
        delta = round(float(bal["meal_due"]) + float(bal["transport_due"]) - float(before.get("meal_due") or 0) - float(before.get("transport_due") or 0), 2)
        if before.get("remaining") is not None:
            assert round(float(bal["remaining"]) - float(before["remaining"]), 2) == delta
    finally:
        api.put(f"{API}/personnel/employees/{eid}", json={"meal_allowance": prev_meal, "transport_allowance": prev_yol}, timeout=30)


def test_alacak_and_borc_adjust_remaining(api, emp):
    eid = emp["id"]
    created = []
    try:
        before = float((_bal(api.get(f"{API}/personnel/employees/{eid}/card", timeout=30).json()).get("remaining") or 0))
        a = api.post(f"{API}/personnel/bonuses", json={
            "employee_id": eid, "type": "alacak", "amount": 400, "note": "TEST_ledger_alacak",
        }, timeout=30)
        assert a.status_code == 200, a.text
        created.append(a.json()["id"])
        mid = float((_bal(api.get(f"{API}/personnel/employees/{eid}/card", timeout=30).json()).get("remaining") or 0))
        assert mid == pytest.approx(before + 400, abs=0.01)
        b = api.post(f"{API}/personnel/bonuses", json={
            "employee_id": eid, "type": "borc", "amount": 150, "note": "TEST_ledger_borc",
        }, timeout=30)
        assert b.status_code == 200, b.text
        created.append(b.json()["id"])
        after = float((_bal(api.get(f"{API}/personnel/employees/{eid}/card", timeout=30).json()).get("remaining") or 0))
        assert after == pytest.approx(mid - 150, abs=0.01)
    finally:
        for bid in created:
            api.delete(f"{API}/personnel/bonuses/{bid}", timeout=30)


def test_bakiye_payment_reduces_remaining(api, emp):
    eid = emp["id"]
    bid = None
    try:
        before = float((_bal(api.get(f"{API}/personnel/employees/{eid}/card", timeout=30).json()).get("remaining") or 0))
        r = api.post(f"{API}/personnel/bonuses", json={
            "employee_id": eid, "type": "bakiye", "amount": 275, "note": "TEST_bakiye_pay",
        }, timeout=30)
        assert r.status_code == 200, r.text
        bid = r.json()["id"]
        after = float((_bal(api.get(f"{API}/personnel/employees/{eid}/card", timeout=30).json()).get("remaining") or 0))
        assert after == pytest.approx(before - 275, abs=0.01)
    finally:
        if bid:
            api.delete(f"{API}/personnel/bonuses/{bid}", timeout=30)
