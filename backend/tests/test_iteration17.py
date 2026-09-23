"""Iteration 17: work schedule, attendance auto-overtime, self-service check-in/out, confirm/dispute, banking retest."""
import os
import pytest
import requests
from dotenv import dotenv_values

fe = dotenv_values("/app/frontend/.env")
BASE = (os.environ.get("REACT_APP_BACKEND_URL") or fe.get("REACT_APP_BACKEND_URL")).rstrip("/")
API = f"{BASE}/api"
COMP = "comp_nexus_main_01"
DEFAULT_WS = {"start": "09:00", "end": "18:00", "break_minutes": 60, "work_days": [0, 1, 2, 3, 4],
              "late_tolerance_minutes": 10, "overtime_tolerance_minutes": 15,
              "count_early_as_overtime": False, "require_geo": True, "timezone": "Europe/Istanbul"}
TEST_DATES = ["2026-09-01", "2026-09-06", "2026-09-02", "2026-09-03", "2026-09-04"]


@pytest.fixture(scope="session")
def c():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def emp(c):
    r = c.get(f"{API}/personnel/employees?company_id={COMP}")
    assert r.status_code == 200, r.text
    emps = r.json()
    emps = emps if isinstance(emps, list) else emps.get("employees", [])
    assert emps, "No employees seeded"
    return emps[0]


@pytest.fixture(scope="session")
def emp2(c):
    r = c.get(f"{API}/personnel/employees?company_id={COMP}")
    emps = r.json()
    emps = emps if isinstance(emps, list) else emps.get("employees", [])
    return emps[1] if len(emps) > 1 else None


@pytest.fixture(scope="session")
def company_loc(c):
    r = c.get(f"{API}/companies/{COMP}")
    assert r.status_code == 200
    return (r.json() or {}).get("location")


@pytest.fixture(scope="session", autouse=True)
def cleanup(c, emp):
    yield
    # restore company work schedule
    c.put(f"{API}/companies/{COMP}/work-schedule", json=DEFAULT_WS)
    # remove employee override
    c.put(f"{API}/personnel/employees/{emp['id']}", json={"work_schedule": None})
    # unlink admin user
    me = c.get(f"{API}/auth/me")
    if me.status_code == 200:
        uid = (me.json().get("user") or {}).get("id")
        if uid:
            c.put(f"{API}/users/{uid}", json={"employee_id": None})


# ---------- Company work schedule ----------
class TestWorkSchedule:
    def test_get_schedule(self, c):
        r = c.get(f"{API}/companies/{COMP}/work-schedule")
        assert r.status_code == 200, r.text
        d = r.json()
        s = d["schedule"]
        assert s["start"] == "09:00" and s["end"] == "18:00"
        assert s["break_minutes"] == 60 and s["work_days"] == [0, 1, 2, 3, 4]
        assert s["late_tolerance_minutes"] == 10 and s["overtime_tolerance_minutes"] == 15
        assert s["timezone"] == "Europe/Istanbul"
        assert d["day_labels"][0] == "Pzt" and len(d["day_labels"]) == 7
        assert d["defaults"]["start"] == "09:00"

    def test_put_schedule_and_persist(self, c):
        r = c.put(f"{API}/companies/{COMP}/work-schedule",
                  json={"start": "08:30", "end": "17:30", "break_minutes": 45, "work_days": [0, 1, 2, 3, 4, 5]})
        assert r.status_code == 200, r.text
        s = r.json()["schedule"]
        assert s["start"] == "08:30" and s["end"] == "17:30" and s["break_minutes"] == 45
        assert s["work_days"] == [0, 1, 2, 3, 4, 5]
        g = c.get(f"{API}/companies/{COMP}/work-schedule").json()["schedule"]
        assert g["start"] == "08:30" and g["work_days"] == [0, 1, 2, 3, 4, 5]

    def test_put_invalid_end_before_start(self, c):
        r = c.put(f"{API}/companies/{COMP}/work-schedule", json={"start": "18:00", "end": "09:00"})
        assert r.status_code == 400, r.text

    def test_put_invalid_time(self, c):
        r = c.put(f"{API}/companies/{COMP}/work-schedule", json={"start": "abc", "end": "18:00"})
        assert r.status_code == 400, r.text

    def test_restore_default(self, c):
        r = c.put(f"{API}/companies/{COMP}/work-schedule", json=DEFAULT_WS)
        assert r.status_code == 200
        s = c.get(f"{API}/companies/{COMP}/work-schedule").json()["schedule"]
        assert s["start"] == "09:00" and s["end"] == "18:00" and s["work_days"] == [0, 1, 2, 3, 4]


# ---------- Manager attendance entry + auto overtime ----------
class TestManagerAttendance:
    def test_weekday_overtime_and_late(self, c, emp):
        # make sure company schedule default
        c.put(f"{API}/companies/{COMP}/work-schedule", json=DEFAULT_WS)
        r = c.post(f"{API}/personnel/attendance", json={"employee_id": emp["id"], "date": "2026-09-01",
                                                        "check_in": "09:25", "check_out": "20:10"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["hours"] == 9.75, d
        assert abs(d["overtime_hours"] - 2.17) < 0.02, d
        assert d["late_minutes"] == 15, d
        assert d["employee_confirmed"] is False
        assert d["source"] == "manager"
        assert d["status"] == "present"
        assert d["is_off_day"] is False

    def test_weekend_all_overtime(self, c, emp):
        r = c.post(f"{API}/personnel/attendance", json={"employee_id": emp["id"], "date": "2026-09-06",
                                                        "check_in": "10:00", "check_out": "14:00"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["is_off_day"] is True
        assert d["hours"] == 3.0, d
        assert d["overtime_hours"] == 3.0, d

    def test_early_leave(self, c, emp):
        r = c.post(f"{API}/personnel/attendance", json={"employee_id": emp["id"], "date": "2026-09-02",
                                                        "check_in": "09:00", "check_out": "17:30"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["early_leave_minutes"] == 30, d
        assert d["overtime_hours"] == 0, d

    def test_overtime_tolerance(self, c, emp):
        r = c.post(f"{API}/personnel/attendance", json={"employee_id": emp["id"], "date": "2026-09-03",
                                                        "check_in": "09:00", "check_out": "18:10"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["overtime_hours"] == 0, d
        assert d["late_minutes"] == 0, d

    def test_absent_then_checkin_becomes_present(self, c, emp):
        c.post(f"{API}/personnel/attendance", json={"employee_id": emp["id"], "date": "2026-09-04", "status": "absent"})
        r = c.post(f"{API}/personnel/attendance", json={"employee_id": emp["id"], "date": "2026-09-04",
                                                        "check_in": "09:00", "check_out": "18:00"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "present", r.json()

    def test_list_attendance_summary(self, c, emp):
        r = c.get(f"{API}/personnel/attendance?company_id={COMP}&month=2026-09")
        assert r.status_code == 200, r.text
        d = r.json()
        assert "schedule" in d and d["schedule"]["start"] == "09:00"
        row = next((s for s in d["summary"] if s["employee_id"] == emp["id"]), None)
        assert row, "employee missing from summary"
        for k in ("overtime_hours", "late_count", "late_minutes", "unconfirmed", "schedule", "has_override"):
            assert k in row, f"missing {k}"
        assert row["overtime_hours"] > 0
        assert row["late_count"] >= 1 and row["late_minutes"] >= 15
        assert row["unconfirmed"] >= 1
        rec = next((x for x in d["records"] if x["employee_id"] == emp["id"] and x["date"] == "2026-09-01"), None)
        assert rec, "record missing"
        for k in ("is_off_day", "late_minutes", "employee_confirmed"):
            assert k in rec
        assert all("_id" not in x for x in d["records"])


# ---------- Per-employee schedule override ----------
class TestEmployeeOverride:
    def test_override_applies(self, c, emp):
        r = c.put(f"{API}/personnel/employees/{emp['id']}", json={"work_schedule": {"start": "08:00", "end": "17:00"}})
        assert r.status_code == 200, r.text
        r = c.post(f"{API}/personnel/attendance", json={"employee_id": emp["id"], "date": "2026-09-03",
                                                        "check_in": "08:00", "check_out": "18:00"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["overtime_hours"] == 1.0, d
        assert d["late_minutes"] == 0, d
        summ = c.get(f"{API}/personnel/attendance?company_id={COMP}&month=2026-09").json()["summary"]
        row = next(s for s in summ if s["employee_id"] == emp["id"])
        assert row["has_override"] is True
        assert row["schedule"]["start"] == "08:00" and row["schedule"]["end"] == "17:00"

    def test_clear_override(self, c, emp):
        r = c.put(f"{API}/personnel/employees/{emp['id']}", json={"work_schedule": None})
        assert r.status_code == 200, r.text
        summ = c.get(f"{API}/personnel/attendance?company_id={COMP}&month=2026-09").json()["summary"]
        row = next(s for s in summ if s["employee_id"] == emp["id"])
        assert row["has_override"] is False
        assert row["schedule"]["start"] == "09:00"


# ---------- Self service ----------
class TestSelfService:
    @pytest.fixture(scope="class", autouse=True)
    def link_user(self, c, emp):
        me = c.get(f"{API}/auth/me")
        assert me.status_code == 200, me.text
        uid = (me.json().get("user") or {}).get("id")
        assert uid, me.text
        r = c.put(f"{API}/users/{uid}", json={"employee_id": emp["id"]})
        assert r.status_code == 200, r.text
        yield uid
        c.put(f"{API}/users/{uid}", json={"employee_id": None})

    def test_me_endpoint(self, c, emp):
        r = c.get(f"{API}/personnel/attendance/me")
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["employee"] and d["employee"]["id"] == emp["id"]
        assert d["schedule"]["start"] == "09:00"
        assert d["location"] and "latitude" in d["location"]
        assert len(d["now"]) == 5 and len(d["today_date"]) == 10
        assert "summary" in d and "records" in d

    def test_self_checkin_requires_geo(self, c):
        r = c.post(f"{API}/personnel/attendance/self", json={"action": "check_in"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("status") == "pending"
        assert "yönetici onayına" in (d.get("message") or "").lower() or "teyit" in (d.get("message") or "").lower()
        rec = d.get("record") or {}
        gcr = rec.get("geo_confirm_request") or {}
        assert gcr.get("status") == "pending"
        assert gcr.get("reason") == "location_off"
        assert not rec.get("check_in")
        dec = c.post(f"{API}/personnel/attendance/{rec['id']}/geo-confirm-decision", json={"decision": "reject"})
        assert dec.status_code == 200, dec.text

    def test_self_checkin_far_location(self, c):
        r = c.post(f"{API}/personnel/attendance/self",
                   json={"action": "check_in", "latitude": 39.9, "longitude": 32.8})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("status") == "pending"
        rec = d.get("record") or {}
        gcr = rec.get("geo_confirm_request") or {}
        assert gcr.get("status") == "pending"
        assert gcr.get("reason") == "offsite"
        assert not rec.get("check_in")
        dec = c.post(f"{API}/personnel/attendance/{rec['id']}/geo-confirm-decision", json={"decision": "reject"})
        assert dec.status_code == 200, dec.text

    def test_self_checkin_and_checkout(self, c, company_loc):
        assert company_loc, "company location missing"
        payload = {"latitude": company_loc["latitude"], "longitude": company_loc["longitude"], "accuracy_m": 10}
        today = c.get(f"{API}/personnel/attendance/me").json()["today_date"]
        r = c.post(f"{API}/personnel/attendance/self", json={"action": "check_in", **payload})
        if r.status_code == 400 and "giriş yapılmış" in r.json().get("detail", ""):
            pytest.skip("Already checked in today (rerun)")
        assert r.status_code == 200, r.text
        d = r.json()
        assert "olarak kaydedildi" in d["message"] and "Giriş" in d["message"]
        rec = d["record"]
        assert rec["source"] == "self" and rec["employee_confirmed"] is True
        assert rec["geo_check_in"] and rec["geo_check_in"]["distance_m"] is not None
        assert rec["date"] == today
        # duplicate check-in
        r2 = c.post(f"{API}/personnel/attendance/self", json={"action": "check_in", **payload})
        assert r2.status_code == 400 and "giriş yapılmış" in r2.json()["detail"]
        # check out
        r3 = c.post(f"{API}/personnel/attendance/self", json={"action": "check_out", **payload})
        assert r3.status_code == 200, r3.text
        assert "Çıkış" in r3.json()["message"]
        assert "sa çalışıldı" in r3.json()["message"] or "erken çıkış" in r3.json()["message"] or "fazla mesai" in r3.json()["message"]
        assert r3.json()["record"]["geo_check_out"]

    def test_confirm_and_dispute(self, c, emp):
        att = c.get(f"{API}/personnel/attendance?company_id={COMP}&month=2026-09").json()["records"]
        rec = next(r for r in att if r["employee_id"] == emp["id"] and r["date"] == "2026-09-01")
        aid = rec["id"]
        r = c.post(f"{API}/personnel/attendance/{aid}/dispute", json={"note": "çıkış 19:00 idi"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["dispute_note"] == "çıkış 19:00 idi"
        assert d["employee_confirmed"] is False
        notifs = c.get(f"{API}/notifications?company_id={COMP}")
        assert notifs.status_code == 200, notifs.text
        items = notifs.json()
        items = items if isinstance(items, list) else items.get("notifications", [])
        assert any("Puantaj itirazı" in (n.get("title") or "") for n in items), "dispute notification missing"
        r = c.post(f"{API}/personnel/attendance/{aid}/confirm", json={})
        assert r.status_code == 200, r.text
        assert r.json()["employee_confirmed"] is True

    def test_dispute_other_employee_forbidden(self, c, emp2):
        if not emp2:
            pytest.skip("second employee unavailable")
        cr = c.post(f"{API}/personnel/attendance", json={"employee_id": emp2["id"], "date": "2026-09-02",
                                                         "check_in": "09:00", "check_out": "18:00"})
        assert cr.status_code == 200, cr.text
        other_id = cr.json()["id"]
        r = c.post(f"{API}/personnel/attendance/{other_id}/dispute", json={"note": "olmaz"})
        assert r.status_code == 403, r.text

    def test_rbac_skip_no_403(self, c, emp):
        for path, method, body in [("/personnel/attendance/me", "get", None),
                                   ("/personnel/attendance/self", "post", {"action": "bad"})]:
            r = getattr(c, method)(f"{API}{path}", json=body) if body else c.get(f"{API}{path}")
            assert r.status_code != 403, f"{path} -> 403"


# ---------- Banking retest ----------
class TestBankingRetest:
    def test_delete_bank_match_tx_blocked(self, c):
        txs = c.get(f"{API}/banking/transactions?company_id={COMP}")
        assert txs.status_code == 200, txs.text
        data = txs.json()
        rows = data if isinstance(data, list) else data.get("transactions", [])
        target = next((t for t in rows if t.get("source") == "bank_match"), None)
        if not target:
            pytest.skip("no bank_match transaction present")
        r = c.delete(f"{API}/banking/transactions/{target['id']}")
        assert r.status_code == 400, r.text
        r2 = c.put(f"{API}/banking/transactions/{target['id']}", json={"description": "x"})
        assert r2.status_code == 400, r2.text

    def test_auto_match_with_account_filter(self, c):
        accs = c.get(f"{API}/banking/accounts?company_id={COMP}")
        assert accs.status_code == 200
        data = accs.json()
        rows = data if isinstance(data, list) else data.get("accounts", [])
        assert rows, "no bank accounts"
        r = c.post(f"{API}/banking/transactions/auto-match?account_id={rows[0]['id']}", json={})
        assert r.status_code == 200, r.text
