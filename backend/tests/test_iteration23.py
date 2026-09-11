"""Iteration 23 — Shift templates + bulk-assign (Toplu Ata)."""
import requests
import pytest
from conftest import API, TEST_COMPANY_ID

WEEK_START = "2026-09-21"  # Monday
LEAVE_DAY = "2026-09-22"  # Tuesday
DEPT = "Lojistik & Depo"


@pytest.fixture(scope="module")
def created():
    state = {"template_ids": [], "leave_id": None, "employee_ids": []}
    yield state
    # cleanup shift plans and leaves and templates
    try:
        r = requests.get(f"{API}/personnel/shifts?company_id={TEST_COMPANY_ID}&week_start={WEEK_START}", timeout=30)
        for row in r.json().get("rows", []):
            for c in row["cells"]:
                if c.get("planned") and c.get("id"):
                    requests.delete(f"{API}/personnel/shifts/{c['id']}", timeout=10)
    except Exception:
        pass
    for tid in state["template_ids"]:
        try:
            requests.delete(f"{API}/personnel/shift-templates/{tid}", timeout=10)
        except Exception:
            pass
    if state["leave_id"]:
        try:
            requests.delete(f"{API}/personnel/leaves/{state['leave_id']}", timeout=10)
        except Exception:
            pass


# ---------- Template CRUD ----------
def test_create_template_ok(created):
    body = {"company_id": TEST_COMPANY_ID, "name": "Sabah",
            "days": {"0": {"start": "08:00", "end": "16:00", "break_minutes": 30},
                     "1": {"start": "08:00", "end": "16:00", "break_minutes": 30},
                     "2": {"start": "08:00", "end": "16:00", "break_minutes": 30},
                     "3": {"start": "08:00", "end": "16:00", "break_minutes": 30},
                     "4": {"start": "08:00", "end": "16:00", "break_minutes": 30},
                     "5": {"off": True}}}
    r = requests.post(f"{API}/personnel/shift-templates", json=body, timeout=30)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["id"] and d["name"] == "Sabah"
    assert d["days"]["0"]["start"] == "08:00"
    assert d["days"]["5"]["off"] is True
    created["template_ids"].append(d["id"])
    created["tpl_id"] = d["id"]


def test_create_template_missing_name():
    r = requests.post(f"{API}/personnel/shift-templates", json={"company_id": TEST_COMPANY_ID, "days": {"0": {"start": "08:00", "end": "16:00"}}}, timeout=30)
    assert r.status_code == 400


def test_create_template_bad_hours():
    r = requests.post(f"{API}/personnel/shift-templates", json={"company_id": TEST_COMPANY_ID, "name": "Bad", "days": {"0": {"start": "18:00", "end": "10:00"}}}, timeout=30)
    assert r.status_code == 400


def test_list_templates(created):
    r = requests.get(f"{API}/personnel/shift-templates?company_id={TEST_COMPANY_ID}", timeout=30)
    assert r.status_code == 200
    ids = [t["id"] for t in r.json()]
    assert created["tpl_id"] in ids


# ---------- Bulk-assign happy path ----------
def test_bulk_assign_department(created):
    body = {"company_id": TEST_COMPANY_ID, "week_start": WEEK_START, "department": DEPT, "template_id": created["tpl_id"]}
    r = requests.post(f"{API}/personnel/shifts/bulk-assign", json=body, timeout=60)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["employees"] > 0
    assert d["saved"] == d["employees"] * 6  # 5 workdays + off Cmt (Sat) is also written
    assert "atandı" in d["message"]
    created["employees_count"] = d["employees"]

    # verify grid: dept employees have planned Mon 08:00-16:00 and Sat off
    r2 = requests.get(f"{API}/personnel/shifts?company_id={TEST_COMPANY_ID}&week_start={WEEK_START}", timeout=30)
    rows = [row for row in r2.json()["rows"] if row["department"] == DEPT]
    assert rows
    for row in rows:
        cells = {c["date"]: c for c in row["cells"]}
        mon = cells[WEEK_START]
        assert mon["planned"] and mon["start"] == "08:00" and mon["end"] == "16:00"
        sat = cells["2026-09-26"]
        assert sat["planned"] and sat["off"] is True


def test_bulk_assign_unknown_dept(created):
    body = {"company_id": TEST_COMPANY_ID, "week_start": WEEK_START, "department": "Yok-Boyle-Depo", "template_id": created["tpl_id"]}
    r = requests.post(f"{API}/personnel/shifts/bulk-assign", json=body, timeout=30)
    assert r.status_code == 404


def test_bulk_assign_all_with_body_days(created):
    body = {"company_id": TEST_COMPANY_ID, "week_start": WEEK_START, "department": "all",
            "days": {"0": {"start": "10:00", "end": "18:00", "break_minutes": 60}}, "overwrite": False}
    r = requests.post(f"{API}/personnel/shifts/bulk-assign", json=body, timeout=60)
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["employees"] > created["employees_count"]  # more than one dept
    # For DEPT employees Monday already assigned => skipped_existing
    assert d["skipped_existing"] >= created["employees_count"]


def test_bulk_assign_employee_ids(created):
    # pick a single employee from DEPT
    r = requests.get(f"{API}/personnel/shifts?company_id={TEST_COMPANY_ID}&week_start={WEEK_START}", timeout=30)
    emp = next(row for row in r.json()["rows"] if row["department"] == DEPT)
    eid = emp["employee_id"]
    created["target_emp_id"] = eid
    body = {"company_id": TEST_COMPANY_ID, "week_start": WEEK_START, "employee_ids": [eid], "template_id": created["tpl_id"]}
    r = requests.post(f"{API}/personnel/shifts/bulk-assign", json=body, timeout=30)
    assert r.status_code == 200
    d = r.json()
    assert d["employees"] == 1


# ---------- Leave interaction ----------
def test_leave_skip_and_conflict(created):
    # First delete existing plans for target on LEAVE_DAY
    eid = created["target_emp_id"]
    r = requests.get(f"{API}/personnel/shifts?company_id={TEST_COMPANY_ID}&week_start={WEEK_START}", timeout=30)
    for row in r.json()["rows"]:
        if row["employee_id"] == eid:
            for c in row["cells"]:
                if c.get("planned") and c.get("id"):
                    requests.delete(f"{API}/personnel/shifts/{c['id']}", timeout=10)

    # Create a leave for LEAVE_DAY and approve it
    lv_body = {"company_id": TEST_COMPANY_ID, "employee_id": eid, "type": "unpaid",
               "start_date": LEAVE_DAY, "end_date": LEAVE_DAY, "days": 1, "reason": "TEST_it23"}
    r = requests.post(f"{API}/personnel/leaves", json=lv_body, timeout=30)
    assert r.status_code == 200, r.text
    leave_id = r.json()["id"]
    created["leave_id"] = leave_id
    r = requests.post(f"{API}/personnel/leaves/{leave_id}/decide", json={"status": "approved"}, timeout=30)
    assert r.status_code == 200

    # skip_leave=True
    body = {"company_id": TEST_COMPANY_ID, "week_start": WEEK_START, "employee_ids": [eid],
            "template_id": created["tpl_id"], "skip_leave": True, "overwrite": True}
    r = requests.post(f"{API}/personnel/shifts/bulk-assign", json=body, timeout=30)
    assert r.status_code == 200
    d = r.json()
    assert d["skipped_leave"] >= 1
    # verify LEAVE_DAY not planned
    r2 = requests.get(f"{API}/personnel/shifts?company_id={TEST_COMPANY_ID}&week_start={WEEK_START}", timeout=30)
    for row in r2.json()["rows"]:
        if row["employee_id"] == eid:
            cell = next(c for c in row["cells"] if c["date"] == LEAVE_DAY)
            assert cell["planned"] is False

    # skip_leave=False
    body["skip_leave"] = False
    r = requests.post(f"{API}/personnel/shifts/bulk-assign", json=body, timeout=30)
    assert r.status_code == 200
    d = r.json()
    assert len(d["conflicts"]) >= 1
    assert "Uyarı" in d["message"]


def test_delete_template_ok_and_404(created):
    tid = created["tpl_id"]
    r = requests.delete(f"{API}/personnel/shift-templates/{tid}", timeout=30)
    assert r.status_code == 200
    r = requests.delete(f"{API}/personnel/shift-templates/{tid}", timeout=30)
    assert r.status_code == 404
    created["template_ids"] = [t for t in created["template_ids"] if t != tid]
