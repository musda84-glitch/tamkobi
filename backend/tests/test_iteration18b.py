"""Iteration 18b: late check-in manager notification + bank match-rule suggestion end-to-end.

Requires seed helper: `python it18_helper.py link_admin seed_bank` style commands run by the test runner
(these are executed inside the fixtures below through it18_helper).
"""
import subprocess

import pytest
import requests

from conftest import API, TEST_COMPANY_ID

CID = TEST_COMPANY_ID
DEFAULT_WS = {"start": "09:00", "end": "18:00", "break_minutes": 60, "work_days": [0, 1, 2, 3, 4], "days": {},
              "late_tolerance_minutes": 10, "overtime_tolerance_minutes": 15, "count_early_as_overtime": False,
              "require_geo": True, "timezone": "Europe/Istanbul", "overtime_method": "legal",
              "overtime_multiplier": 1.5, "holiday_multiplier": 2.0, "monthly_hours_divisor": 225,
              "notify_missing_checkin": True, "notify_late_checkin": True}
PATTERN = "test_abonelik sunucu kirasi"


def helper(cmd):
    r = subprocess.run(["python", "it18_helper.py", cmd], cwd="/app/backend/tests", capture_output=True, text=True)
    return r.stdout.strip()


@pytest.fixture(scope="module")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def notifications(api, ntype):
    r = api.get(f"{API}/notifications", params={"company_id": CID}, timeout=30)
    assert r.status_code == 200, r.text
    items = r.json() if isinstance(r.json(), list) else r.json().get("notifications", [])
    return [x for x in items if x.get("type") == ntype]


# ---------- Late check-in notification ----------
class TestLateCheckinNotification:
    """Istanbul clock is early morning in this environment, so the work start is temporarily
    shifted (and today's weekday enabled) to make the self check-in count as late."""

    @pytest.fixture(scope="class", autouse=True)
    def setup(self, api):
        import datetime as dt
        wd = (dt.datetime.utcnow() + dt.timedelta(hours=3)).weekday()
        now_ist = dt.datetime.utcnow() + dt.timedelta(hours=3)
        start = (now_ist - dt.timedelta(minutes=45)).strftime("%H:%M")
        helper("link_admin")
        helper("reset_alerts")
        helper("del_today")
        r = api.put(f"{API}/companies/{CID}/work-schedule", json={
            **DEFAULT_WS, "start": start, "end": "23:00", "work_days": sorted(set(DEFAULT_WS["work_days"] + [wd])),
            "late_tolerance_minutes": 0, "notify_late_checkin": True}, timeout=30)
        assert r.status_code == 200, r.text
        yield
        api.put(f"{API}/companies/{CID}/work-schedule", json=DEFAULT_WS, timeout=30)
        helper("del_today")
        helper("unlink_admin")
        helper("reset_alerts")

    def test_late_checkin_creates_notification(self, api):
        loc = api.get(f"{API}/companies/{CID}", timeout=30).json()["location"]
        r = api.post(f"{API}/personnel/attendance/self", json={
            "action": "check_in", "latitude": loc["latitude"], "longitude": loc["longitude"], "accuracy_m": 10}, timeout=30)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["record"]["late_minutes"] > 0, body["record"]
        assert "geç" in body["message"]
        late = notifications(api, "attendance_late")
        assert late, "attendance_late notification missing"
        assert late[0]["title"].startswith("Geç giriş:"), late[0]

    def test_notify_late_disabled_creates_nothing(self, api):
        helper("del_today")
        helper("reset_alerts")
        import datetime as dt
        now_ist = dt.datetime.utcnow() + dt.timedelta(hours=3)
        wd = now_ist.weekday()
        start = (now_ist - dt.timedelta(minutes=45)).strftime("%H:%M")
        r = api.put(f"{API}/companies/{CID}/work-schedule", json={
            **DEFAULT_WS, "start": start, "end": "23:00", "work_days": sorted(set(DEFAULT_WS["work_days"] + [wd])),
            "late_tolerance_minutes": 0, "notify_late_checkin": False}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["schedule"]["notify_late_checkin"] is False
        s = api.post(f"{API}/personnel/attendance/self", json={
            "action": "check_in", "latitude": api.get(f"{API}/companies/{CID}").json()["location"]["latitude"],
            "longitude": api.get(f"{API}/companies/{CID}").json()["location"]["longitude"]}, timeout=30)
        assert s.status_code == 200, s.text
        assert s.json()["record"]["late_minutes"] > 0
        assert notifications(api, "attendance_late") == [], "notification created although notify_late_checkin=False"


# ---------- Bank match-rule suggestion end-to-end ----------
class TestRuleSuggestionFlow:
    state = {}

    @pytest.fixture(scope="class", autouse=True)
    def seed(self, api):
        helper("clean_bank")
        print(helper("seed_bank"))
        yield
        # unmatch anything still matched, then delete rows + rule
        for tx in api.get(f"{API}/banking/transactions/matched", params={"company_id": CID}, timeout=30).json():
            if str(tx.get("id", "")).startswith("tx_it18_"):
                api.post(f"{API}/banking/transactions/{tx['id']}/unmatch", timeout=30)
        for r in api.get(f"{API}/banking/match-rules", params={"company_id": CID}, timeout=30).json():
            if PATTERN in r["pattern"]:
                api.delete(f"{API}/banking/match-rules/{r['id']}", timeout=30)
        print(helper("clean_bank"))

    def test_two_matches_produce_suggestion(self, api):
        for i in (0, 1):
            r = api.post(f"{API}/banking/transactions/tx_it18_{i}/match",
                         json={"category": "TEST_Abonelik", "learn": False}, timeout=30)
            assert r.status_code == 200, r.text
        sug = api.get(f"{API}/banking/match-rule-suggestions", params={"company_id": CID}, timeout=30)
        assert sug.status_code == 200, sug.text
        rows = [x for x in sug.json() if x["pattern"] == PATTERN]
        assert rows, f"suggestion for '{PATTERN}' not returned: {sug.json()}"
        s = rows[0]
        assert s["count"] == 2, s
        assert s["consistent"] is True, s
        assert s["category"] == "TEST_Abonelik", s
        self.state["sug"] = s

    def test_accept_creates_rule_and_applies_pending(self, api):
        s = self.state["sug"]
        r = api.post(f"{API}/banking/match-rule-suggestions/accept", json={
            "company_id": CID, "pattern": s["pattern"], "contact_id": s.get("contact_id"),
            "target_account_id": s.get("target_account_id"), "category": s.get("category"), "apply_now": True}, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["rule"]["pattern"] == PATTERN, d["rule"]
        assert d["applied"] == 1, d  # the third pending tx with same pattern
        rules = api.get(f"{API}/banking/match-rules", params={"company_id": CID}, timeout=30).json()
        assert any(x["pattern"] == PATTERN for x in rules), rules

    def test_suggestion_disappears_after_rule(self, api):
        sug = api.get(f"{API}/banking/match-rule-suggestions", params={"company_id": CID}, timeout=30).json()
        assert not [x for x in sug if x["pattern"] == PATTERN], sug
