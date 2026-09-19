"""Gün içi izin: çıkış–dönüş aralığı onaylanınca çalışılan dakikadan düşülür."""
import os
import sys

import pytest
import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from attendance import (  # noqa: E402
    DEFAULT_SCHEDULE,
    approved_intraday_gap_minutes,
    compute_day,
)
from rbac import SKIP_PREFIXES  # noqa: E402

API = (os.environ.get("REACT_APP_BACKEND_URL") or "http://127.0.0.1:8000").rstrip("/") + "/api"


def _req(status, out="13:00", ret="14:30"):
    return {"intraday_leave_request": {"status": status, "out_time": out, "return_time": ret}}


def test_skip_prefix_for_self_service():
    assert any(p.endswith("/intraday-leave-request") for p in SKIP_PREFIXES)


def test_pending_does_not_subtract():
    rec = {"date": "2026-09-07", "check_in": "09:00", "check_out": "18:00", **_req("pending")}
    out = compute_day(rec, {**DEFAULT_SCHEDULE})
    assert out["intraday_leave_minutes"] == 0
    assert out["hours"] == 8.0


def test_approved_subtracts_gap():
    rec = {"date": "2026-09-07", "check_in": "09:00", "check_out": "18:00", **_req("approved")}
    out = compute_day(rec, {**DEFAULT_SCHEDULE})
    assert out["intraday_leave_minutes"] == 90
    assert out["hours"] == 6.5
    assert out["overtime_hours"] == 0


def test_approved_flag_without_status():
    rec = {
        "date": "2026-09-07",
        "check_in": "09:00",
        "check_out": "18:00",
        "intraday_leave_approved": True,
        **_req("pending", "12:00", "13:00"),
    }
    assert approved_intraday_gap_minutes(rec) == 60
    out = compute_day(rec, {**DEFAULT_SCHEDULE})
    assert out["hours"] == 7.0


def test_gap_clamped_to_check_window():
    rec = {
        "date": "2026-09-07",
        "check_in": "09:00",
        "check_out": "18:00",
        **_req("approved", "08:00", "10:00"),
    }
    assert approved_intraday_gap_minutes(rec) == 60
    out = compute_day(rec, {**DEFAULT_SCHEDULE})
    assert out["hours"] == 7.0


def test_rejected_does_not_subtract():
    rec = {"date": "2026-09-07", "check_in": "09:00", "check_out": "18:00", **_req("rejected")}
    out = compute_day(rec, {**DEFAULT_SCHEDULE})
    assert out["intraday_leave_minutes"] == 0
    assert out["hours"] == 8.0


class TestIntradayLeaveApi:
    def test_requires_times_and_reason(self):
        s = requests.Session()
        r = s.post(f"{API}/auth/login", json={"email": "admin@nexus.com", "password": "admin123"}, timeout=20)
        if r.status_code != 200:
            pytest.skip("admin login failed")
        bad = s.post(
            f"{API}/personnel/attendance/intraday-leave-request",
            json={"reason": "ab", "out_time": "14:00", "return_time": "16:00"},
            timeout=20,
        )
        if bad.status_code == 404:
            pytest.skip("canlı API henüz yeni rotayı yüklemedi")
        assert bad.status_code in (400, 403), bad.text
        missing = s.post(
            f"{API}/personnel/attendance/intraday-leave-request",
            json={"reason": "doktor randevusu"},
            timeout=20,
        )
        assert missing.status_code in (400, 403), missing.text
        order = s.post(
            f"{API}/personnel/attendance/intraday-leave-request",
            json={"reason": "doktor randevusu", "out_time": "16:00", "return_time": "14:00"},
            timeout=20,
        )
        assert order.status_code in (400, 403), order.text
        if order.status_code == 400:
            assert "sonra" in (order.json().get("detail") or "").lower()
