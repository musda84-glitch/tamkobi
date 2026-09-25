"""Personel kartı konum izleme tercihleri: iş yeri + dış görev."""
from attendance import (
    DEFAULT_LOCATION_MODE,
    DEFAULT_LOCATION_TRACKING,
    append_location_move,
    build_location_exit_request,
    build_location_move,
    checkout_distance_blocks,
    combine_date_hm,
    ignore_location_move,
    location_exit_decision_message,
    location_exit_should_notify,
    location_logged_inside,
    location_moves_date_query,
    location_moves_from_record,
    location_ping_checks_out,
    overtime_move_public,
    parse_location_exit_decision,
    location_mode_for,
    merge_schedule,
    normalize_location_tracking,
    should_append_location_move,
    synthesize_location_moves,
)


def test_checkout_is_button_only_anywhere():
    assert checkout_distance_blocks() is False
    assert location_ping_checks_out() is False


def test_normalize_defaults():
    assert normalize_location_tracking(None) == DEFAULT_LOCATION_TRACKING
    assert normalize_location_tracking({}) == DEFAULT_LOCATION_TRACKING
    assert "field" in normalize_location_tracking(None)
    assert normalize_location_tracking(None)["field"] == DEFAULT_LOCATION_MODE


def test_normalize_clamps_interval_and_disables_continuous_when_off():
    lt = normalize_location_tracking({"enabled": False, "continuous": True, "interval_minutes": 999})
    assert lt["enabled"] is False
    assert lt["continuous"] is False
    assert lt["interval_minutes"] == 120
    assert "field" in lt
    lt2 = normalize_location_tracking({"enabled": True, "continuous": False, "interval_minutes": 0})
    assert lt2["interval_minutes"] == 0
    assert lt2["continuous"] is True


def test_normalize_zero_interval_means_continuous():
    lt = normalize_location_tracking({"enabled": True, "interval_minutes": 0})
    assert lt["enabled"] is True
    assert lt["continuous"] is True
    assert lt["interval_minutes"] == 0
    lt2 = normalize_location_tracking({"enabled": True, "continuous": True, "interval_minutes": 10})
    assert lt2["continuous"] is True
    assert lt2["interval_minutes"] == 0


def test_normalize_field_separate_from_company():
    lt = normalize_location_tracking({
        "enabled": False, "continuous": False, "interval_minutes": 15,
        "field": {"enabled": True, "continuous": True, "interval_minutes": 0},
    })
    assert lt["enabled"] is False
    assert lt["field"]["enabled"] is True
    assert lt["field"]["continuous"] is True
    assert lt["field"]["interval_minutes"] == 0


def test_location_mode_for_workplace():
    lt = {
        "enabled": False, "interval_minutes": 15,
        "field": {"enabled": True, "continuous": False, "interval_minutes": 5},
    }
    company = location_mode_for(lt, {"kind": "company"})
    assert company["enabled"] is False
    field = location_mode_for(lt, {"kind": "task"})
    assert field["enabled"] is True
    assert field["interval_minutes"] == 5


def test_normalize_field_exit_tolerance_hours():
    lt = normalize_location_tracking({
        "enabled": True, "interval_minutes": 15,
        "field": {"enabled": True, "continuous": True, "interval_minutes": 0, "exit_tolerance_hours": 3},
    })
    assert lt["field"]["exit_tolerance_hours"] == 3
    assert location_mode_for(lt, {"kind": "task"})["exit_tolerance_hours"] == 3
    clamped = normalize_location_tracking({"field": {"exit_tolerance_hours": 99}})
    assert clamped["field"]["exit_tolerance_hours"] == 12


def test_merge_schedule_require_geo_follows_employee_location_tracking():
    company = {"work_schedule": {"require_geo": True, "start": "09:00", "end": "18:00"}}
    emp_off = {"location_tracking": {"enabled": False, "continuous": True, "interval_minutes": 10}}
    s_off = merge_schedule(company, emp_off)
    assert s_off["require_geo"] is False
    assert s_off["location_tracking"]["enabled"] is False
    assert s_off["location_tracking"]["continuous"] is False
    assert s_off["location_tracking"]["interval_minutes"] == 10

    emp_on = {"location_tracking": {"enabled": True, "continuous": False, "interval_minutes": 5}}
    s_on = merge_schedule(company, emp_on)
    assert s_on["require_geo"] is True
    assert s_on["location_tracking"]["continuous"] is False
    assert s_on["location_tracking"]["interval_minutes"] == 5

    emp_cont = {"location_tracking": {"enabled": True, "continuous": False, "interval_minutes": 0}}
    s_cont = merge_schedule(company, emp_cont)
    assert s_cont["location_tracking"]["continuous"] is True
    assert s_cont["location_tracking"]["interval_minutes"] == 0


def test_location_exit_should_notify_after_tolerance():
    assert location_exit_should_notify(outside=True, tolerance_hours=0) is True
    assert location_exit_should_notify(outside=False, tolerance_hours=0) is False
    assert location_exit_should_notify(
        outside=True,
        first_left_at="2026-09-23T08:00:00+00:00",
        now="2026-09-23T09:00:00+00:00",
        tolerance_hours=2,
    ) is False
    assert location_exit_should_notify(
        outside=True,
        first_left_at="2026-09-23T08:00:00+00:00",
        now="2026-09-23T10:00:00+00:00",
        tolerance_hours=2,
    ) is True
    assert location_exit_should_notify(
        outside=True,
        tolerance_hours=0,
        existing={"status": "pending"},
    ) is False
    req = build_location_exit_request(
        distance_m=850,
        radius_m=300,
        tolerance_hours=2,
        workplace={"kind": "task", "task_title": "Montaj", "project_name": "Villa"},
        now="2026-09-23T10:00:00+00:00",
    )
    assert req["status"] == "pending"
    assert req["distance_m"] == 850
    assert req["tolerance_hours"] == 2
    assert req["wage_deduction"] is None


def test_parse_location_exit_decision_wage_deduction():
    assert parse_location_exit_decision({"decision": "ack"}) == {"decision": "ack", "wage_deduction": False}
    assert parse_location_exit_decision({"decision": "approve"}) == {"decision": "approve", "wage_deduction": False}
    assert parse_location_exit_decision({"decision": "deduct"}) == {"decision": "approve", "wage_deduction": True}
    assert parse_location_exit_decision({"decision": "approve", "wage_deduction": True}) == {"decision": "approve", "wage_deduction": True}
    assert parse_location_exit_decision({"decision": "reject", "wage_deduction": "evet"}) == {"decision": "reject", "wage_deduction": True}
    assert location_exit_decision_message("ack", False) == "Konum dışı çıkış: haberim var. Kesinti yok."
    assert location_exit_decision_message("approve", False) == "Konum dışı çıkış onaylandı (kesinti yok)."
    assert location_exit_decision_message("approve", True, 1500) == "Konum dışı çıkış: ücretten 1500 ₺ kesinti uygulandı."
    try:
        parse_location_exit_decision({"decision": "nope"})
        assert False
    except ValueError:
        pass


def test_merge_schedule_without_employee_keeps_company_require_geo():
    company = {"work_schedule": {"require_geo": True}}
    s = merge_schedule(company, None)
    assert s["require_geo"] is True
    assert "location_tracking" not in s


def test_synthesize_location_moves_from_punches_and_exit():
    rec = {
        "date": "2026-09-24",
        "check_in": "08:32",
        "check_out": "17:45",
        "geo_check_in": {"at": "2026-09-24T05:32:00+00:00"},
        "location_exit_request": {
            "status": "pending",
            "left_at": "2026-09-24T09:10:00+00:00",
            "place": "Villa",
        },
    }
    moves = synthesize_location_moves(rec)
    kinds = [m["kind"] for m in moves]
    assert kinds[0] == "enter"
    assert kinds[-1] == "leave"
    assert any(m["kind"] == "leave" and m["ignorable"] and m["place"] == "Villa" for m in moves)
    assert moves[0]["official"] is True
    assert moves[-1]["official"] is True


def test_location_logged_inside_follows_last_move():
    rec = {"location_moves": [
        build_location_move(kind="enter", at="2026-09-24T08:00:00+00:00", official=True),
        build_location_move(kind="leave", at="2026-09-24T12:00:00+00:00", ignorable=True),
    ]}
    assert location_logged_inside(rec) is False
    rec["location_moves"].append(build_location_move(kind="enter", at="2026-09-24T13:00:00+00:00", ignorable=True))
    assert location_logged_inside(rec) is True


def test_append_and_ignore_intraday_gap():
    rec = {"check_in": "08:00", "date": "2026-09-24"}
    leave = build_location_move(kind="leave", at="2026-09-24T12:05:00+00:00", ignorable=True)
    moves = append_location_move(rec, leave)
    assert any(m["kind"] == "enter" for m in moves)
    assert any(m["id"] == leave["id"] for m in moves)
    found = ignore_location_move(moves, leave["id"], now="2026-09-24T12:06:00+00:00")
    assert found and found["ignored"] is True
    official = next(m for m in moves if m["official"] and m["kind"] == "enter")
    try:
        ignore_location_move(moves, official["id"])
        assert False
    except ValueError:
        pass


def test_should_append_debounces_same_kind():
    existing = [build_location_move(kind="leave", at="2026-09-24T12:00:00+00:00")]
    assert should_append_location_move(existing, "leave", "2026-09-24T12:00:30+00:00") is False
    assert should_append_location_move(existing, "enter", "2026-09-24T12:00:30+00:00") is True
    assert should_append_location_move(existing, "leave", "2026-09-24T12:02:00+00:00") is True


def test_location_moves_date_query_periods():
    assert location_moves_date_query("month", "2026-09", "2026-09-24") == {"date": {"$regex": "^2026-09"}}
    q30 = location_moves_date_query("30d", "2026-09", "2026-09-24")
    assert q30["date"]["$gte"] == "2026-08-25"
    assert combine_date_hm("2026-09-24", "08:32") == "2026-09-24T08:32:00"
    assert location_moves_from_record({"location_moves": [{"kind": "lost", "at": "2026-09-24T10:00:00+00:00", "ignorable": True}]})[0]["kind"] == "lost"


def test_overtime_move_public_assigned_and_computed():
    assert overtime_move_public({}) is None
    assert overtime_move_public({"assigned_overtime_hours": 0, "overtime_hours": 0}) is None
    assigned = overtime_move_public({
        "_id": "att1",
        "date": "2026-09-20",
        "employee_id": "e1",
        "assigned_overtime_hours": 2.5,
        "assigned_overtime_start": "18:00",
        "assigned_overtime_end": "20:30",
        "assigned_overtime_note": "proje",
    })
    assert assigned["hours"] == 2.5
    assert assigned["kind"] == "assigned"
    assert assigned["can_delete"] is True
    assert assigned["start"] == "18:00"
    computed = overtime_move_public({"_id": "att2", "date": "2026-09-21", "overtime_hours": 1.25})
    assert computed["kind"] == "computed"
    assert computed["hours"] == 1.25
    assert computed["can_delete"] is False
