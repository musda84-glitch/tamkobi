"""Unit tests for attendance dispute resolve/reject decision."""
import asyncio
import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_decide_attendance_dispute_approve():
    from attendance import decide_attendance_dispute

    rec = {
        "_id": "att1",
        "company_id": "c1",
        "employee_id": "e1",
        "employee_name": "Ali",
        "date": "2026-09-23",
        "dispute_note": "çıkış 19:00",
        "dispute_resolved": False,
    }
    updated = {**rec, "dispute_resolved": True, "dispute_resolution": "accepted"}
    db = MagicMock()
    db.attendance.find_one = AsyncMock(side_effect=[rec, updated])
    db.attendance.update_one = AsyncMock()
    db.employees.find_one = AsyncMock(return_value={"_id": "e1", "user_id": "u1"})

    with patch("attendance._db", db), patch("attendance._current_user", AsyncMock(return_value={"_id": "admin", "role": "admin"})), \
         patch("notify.insert_notification", AsyncMock()):
        out = _run(decide_attendance_dispute("att1", {"decision": "approve"}, MagicMock()))

    assert out["status"] == "success"
    assert "düzeltildi" in out["message"].lower()
    set_doc = db.attendance.update_one.await_args.args[1]["$set"]
    assert set_doc["dispute_resolved"] is True
    assert set_doc["dispute_resolution"] == "accepted"
    assert set_doc["employee_confirmed"] is False


def test_decide_attendance_dispute_reject():
    from attendance import decide_attendance_dispute

    rec = {
        "_id": "att1",
        "company_id": "c1",
        "employee_id": "e1",
        "employee_name": "Ali",
        "date": "2026-09-23",
        "dispute_note": "çıkış 19:00",
        "dispute_resolved": False,
    }
    db = MagicMock()
    db.attendance.find_one = AsyncMock(side_effect=[rec, {**rec, "dispute_resolved": True}])
    db.attendance.update_one = AsyncMock()
    db.employees.find_one = AsyncMock(return_value={"_id": "e1"})

    with patch("attendance._db", db), patch("attendance._current_user", AsyncMock(return_value={"_id": "admin", "role": "accountant"})), \
         patch("notify.insert_notification", AsyncMock()):
        out = _run(decide_attendance_dispute("att1", {"decision": "reject"}, MagicMock()))

    assert "reddedildi" in out["message"].lower()
    set_doc = db.attendance.update_one.await_args.args[1]["$set"]
    assert set_doc["dispute_resolution"] == "rejected"
    assert "employee_confirmed" not in set_doc


def test_decide_attendance_dispute_already_resolved():
    from attendance import decide_attendance_dispute

    rec = {"_id": "att1", "dispute_note": "x", "dispute_resolved": True}
    db = MagicMock()
    db.attendance.find_one = AsyncMock(return_value=rec)

    with patch("attendance._db", db), patch("attendance._current_user", AsyncMock(return_value={"role": "admin"})):
        with pytest.raises(HTTPException) as ei:
            _run(decide_attendance_dispute("att1", {"decision": "approve"}, MagicMock()))
    assert ei.value.status_code == 400
