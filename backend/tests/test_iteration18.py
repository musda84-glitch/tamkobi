"""Iteration 18: per-day work schedule, overtime pay (legal/fixed), payroll overtime + 2nd salary,
attendance alerts (missing / late check-in), bank match-rule suggestions."""
import datetime as dt

import pytest
import requests

from conftest import API, TEST_COMPANY_ID

CID = TEST_COMPANY_ID
DEFAULT_WS = {"start": "09:00", "end": "18:00", "break_minutes": 60, "work_days": [0, 1, 2, 3, 4], "days": {},
              "late_tolerance_minutes": 10, "overtime_tolerance_minutes": 15, "count_early_as_overtime": False,
              "require_geo": True, "timezone": "Europe/Istanbul", "overtime_method": "legal",
              "overtime_multiplier": 1.5, "holiday_multiplier": 2.0, "monthly_hours_divisor": 225,
              "notify_missing_checkin": True, "notify_late_checkin": True}
PERIOD = "2026-09"
TEST_DATES = ["2026-09-01", "2026-09-05", "2026-09-06", "2026-09-07"]


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


def put_ws(api, body):
    return api.put(f"{API}/companies/{CID}/work-schedule", json=body, timeout=30)


def post_att(api, emp_id, date, ci, co):
    return api.post(f"{API}/personnel/attendance", json={"employee_id": emp_id, "date": date, "check_in": ci, "check_out": co}, timeout=30)


@pytest.fixture(scope="module", autouse=True)
def cleanup(api, emp):
    yield
    # restore company schedule + employee fields; delete created attendance
    put_ws(api, DEFAULT_WS)
    api.put(f"{API}/personnel/employees/{emp['id']}", json={
        "payroll_salary": None, "second_salary": 0, "overtime_method": None,
        "overtime_hourly_rate": None, "work_schedule": None}, timeout=30)


# ---------- 1) GET work-schedule defaults ----------
class TestWorkScheduleGet:
    def test_defaults(self, api):
        r = api.get(f"{API}/companies/{CID}/work-schedule", timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        s = d["schedule"]
        assert isinstance(s.get("days"), dict)
        assert s["overtime_method"] == "legal"
        assert s["overtime_multiplier"] == 1.5
        assert s["holiday_multiplier"] == 2.0
        assert s["monthly_hours_divisor"] == 225
        assert s["notify_missing_checkin"] is True
        assert s["notify_late_checkin"] is True
        assert set(d["overtime_methods"].keys()) == {"legal", "fixed"}
        assert d["day_labels"][5] == "Cmt"


# ---------- 2) Per-day company schedule ----------
class TestPerDaySchedule:
    def test_save_days_and_compute(self, api, emp):
        r = put_ws(api, {**DEFAULT_WS, "work_days": [0, 1, 2, 3, 4, 5], "days": {"5": {"start": "10:00", "end": "14:00", "break_minutes": 0}}})
        assert r.status_code == 200, r.text
        s = r.json()["schedule"]
        assert s["days"]["5"] == {"start": "10:00", "end": "14:00", "break_minutes": 0}
        assert 5 in s["work_days"]
        # persistence
        s2 = api.get(f"{API}/companies/{CID}/work-schedule", timeout=30).json()["schedule"]
        assert s2["days"]["5"]["end"] == "14:00"

        # Saturday 2026-09-05 is a Friday? -> 2026-09-05 is Saturday
        assert dt.date(2026, 9, 5).weekday() == 5
        ar = post_att(api, emp["id"], "2026-09-05", "10:00", "16:00")
        assert ar.status_code == 200, ar.text
        rec = ar.json()
        assert rec["is_off_day"] is False
        assert rec["hours"] == 6.0
        assert rec["overtime_hours"] == 2.0

    def test_invalid_day_window_rejected(self, api):
        r = put_ws(api, {**DEFAULT_WS, "work_days": [0, 1, 2, 3, 4, 5], "days": {"5": {"start": "15:00", "end": "14:00"}}})
        assert r.status_code == 400, r.text
        assert "bitiş" in r.json()["detail"].lower()

    def test_revert_days(self, api):
        r = put_ws(api, {**DEFAULT_WS, "work_days": [0, 1, 2, 3, 4], "days": {}})
        assert r.status_code == 200
        assert r.json()["schedule"]["days"] == {}


# ---------- 3) Employee compensation + per-employee per-day override ----------
class TestEmployeeCompensation:
    def test_set_fields_and_card(self, api, emp):
        r = api.put(f"{API}/personnel/employees/{emp['id']}", json={
            "payroll_salary": 45000, "second_salary": 5000, "overtime_method": None,
            "overtime_hourly_rate": None, "work_schedule": {"days": {"0": {"end": "19:00"}}}}, timeout=30)
        assert r.status_code == 200, r.text
        card = api.get(f"{API}/personnel/employees/{emp['id']}/card", timeout=30)
        assert card.status_code == 200
        e = card.json()["employee"]
        assert e["payroll_salary"] == 45000
        assert e["second_salary"] == 5000
        assert e["work_schedule"]["days"]["0"]["end"] == "19:00"
        assert "_id" not in e

    def test_employee_day_override_applies(self, api, emp):
        assert dt.date(2026, 9, 7).weekday() == 0
        r = post_att(api, emp["id"], "2026-09-07", "09:00", "19:30")
        assert r.status_code == 200, r.text
        rec = r.json()
        assert rec["overtime_hours"] == 0.5, rec

    def test_clear_employee_schedule(self, api, emp):
        r = api.put(f"{API}/personnel/employees/{emp['id']}", json={"work_schedule": None}, timeout=30)
        assert r.status_code == 200
        assert r.json().get("work_schedule") is None


# ---------- 4) Overtime pay preview: legal + fixed ----------
class TestOvertimePreview:
    def test_create_records(self, api, emp):
        # neutralise records created by earlier classes so the period holds only these two rows
        for d in ("2026-09-05", "2026-09-07"):
            api.post(f"{API}/personnel/attendance", json={"employee_id": emp["id"], "date": d, "status": "absent"}, timeout=30)
        r1 = post_att(api, emp["id"], "2026-09-01", "09:00", "20:00")
        assert r1.status_code == 200, r1.text
        assert r1.json()["overtime_hours"] == 2.0
        assert dt.date(2026, 9, 6).weekday() == 6
        r2 = post_att(api, emp["id"], "2026-09-06", "10:00", "13:00")
        assert r2.status_code == 200, r2.text
        assert r2.json()["is_off_day"] is True
        assert r2.json()["overtime_hours"] == 2.0  # 3h - 60min break

    def test_legal_method(self, api, emp):
        r = api.get(f"{API}/personnel/overtime-preview", params={"company_id": CID, "period": PERIOD}, timeout=30)
        assert r.status_code == 200, r.text
        row = next(x for x in r.json()["rows"] if x["employee_id"] == emp["id"])
        assert row["method"] == "legal"
        assert row["hourly_base"] == 200.0
        assert row["weekday_rate"] == 300.0
        assert row["holiday_rate"] == 400.0
        assert row["weekday_hours"] == 2.0, row
        assert row["holiday_hours"] == 2.0, row
        assert row["amount"] == 1400.0, row

    def test_fixed_method(self, api, emp):
        api.put(f"{API}/personnel/employees/{emp['id']}", json={"overtime_method": "fixed", "overtime_hourly_rate": 150}, timeout=30)
        r = api.get(f"{API}/personnel/overtime-preview", params={"company_id": CID, "period": PERIOD}, timeout=30)
        row = next(x for x in r.json()["rows"] if x["employee_id"] == emp["id"])
        assert row["method"] == "fixed"
        assert row["weekday_rate"] == 150.0
        # expected per spec: holiday rate = 150 * 2/1.5 = 200 -> 2*150 + 2*200 = 700
        assert row["holiday_rate"] == 200.0, row
        assert row["amount"] == 700.0, row

    def test_reset_to_legal(self, api, emp):
        r = api.put(f"{API}/personnel/employees/{emp['id']}", json={"overtime_method": None, "overtime_hourly_rate": None}, timeout=30)
        assert r.status_code == 200


# ---------- 5) Payroll generation with overtime + second salary ----------
class TestPayroll:
    def test_generate(self, api, emp):
        r = api.post(f"{API}/personnel/generate-payroll", json={"company_id": CID, "period": PERIOD}, timeout=60)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "fazla mesai ücreti eklendi" in body["message"], body["message"]
        p = next(x for x in body["payrolls"] if x["employee_id"] == emp["id"])
        assert p["gross_salary"] == 45000
        assert p["net_salary"] == emp.get("salary")
        assert p["second_salary"] == 5000
        assert p["overtime_pay"] == 1400.0, p
        assert p["overtime_hours"] == 4.0
        assert p["overtime_rate"]["method"] == "legal"
        expected = round(p["net_salary"] + p["overtime_pay"] + p["second_salary"] + p["bonus"] - p["deduction"] - p["advance_payment"], 2)
        assert p["final_payable"] == expected
        assert "_id" not in p

    def test_regenerate_is_upsert(self, api, emp):
        api.post(f"{API}/personnel/generate-payroll", json={"company_id": CID, "period": PERIOD}, timeout=60)
        r = api.get(f"{API}/personnel/payrolls", params={"company_id": CID, "period": PERIOD}, timeout=30)
        assert r.status_code == 200, r.text
        rows = [x for x in r.json() if x["employee_id"] == emp["id"] and x["period"] == PERIOD]
        assert len(rows) == 1, f"duplicate payrolls: {len(rows)}"


# ---------- 6) Attendance alerts ----------
class TestAttendanceAlerts:
    def test_run_alerts(self, api):
        istanbul_wd = (dt.datetime.utcnow() + dt.timedelta(hours=3)).weekday()
        ws = {**DEFAULT_WS, "work_days": sorted(set(DEFAULT_WS["work_days"] + [istanbul_wd]))}
        assert put_ws(api, ws).status_code == 200
        r = api.post(f"{API}/personnel/attendance/run-alerts", params={"company_id": CID, "force": True}, timeout=60)
        assert r.status_code == 200, r.text
        results = r.json()["results"]
        assert results, "no alert results returned"
        res = results[0]
        assert res["status"] == "sent", res
        assert isinstance(res["missing"], list) and res["missing"]
        assert res["mail"]["status"] == "skipped", res["mail"]

        # duplicate on second run
        r2 = api.post(f"{API}/personnel/attendance/run-alerts", params={"company_id": CID, "force": True}, timeout=60)
        assert r2.json()["results"][0]["status"] == "duplicate", r2.json()

        n = api.get(f"{API}/notifications", params={"company_id": CID}, timeout=30)
        assert n.status_code == 200, n.text
        items = n.json() if isinstance(n.json(), list) else n.json().get("notifications", [])
        miss = [x for x in items if x.get("type") == "attendance_missing"]
        assert miss, "attendance_missing notification not created"
        assert miss[0]["title"].startswith("Giriş yapmayan"), miss[0]
        put_ws(api, DEFAULT_WS)


# ---------- 7) Bank match-rule suggestions ----------
class TestRuleSuggestions:
    def test_endpoint_shape(self, api):
        r = api.get(f"{API}/banking/match-rule-suggestions", params={"company_id": CID}, timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        for x in data:
            assert x["count"] >= 2
            assert "pattern" in x and "consistent" in x
