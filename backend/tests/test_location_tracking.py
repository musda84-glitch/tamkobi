"""Personel kartı konum izleme tercihleri: iş yeri + dış görev."""
from attendance import (
    DEFAULT_LOCATION_MODE,
    DEFAULT_LOCATION_TRACKING,
    location_mode_for,
    merge_schedule,
    normalize_location_tracking,
)


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


def test_merge_schedule_without_employee_keeps_company_require_geo():
    company = {"work_schedule": {"require_geo": True}}
    s = merge_schedule(company, None)
    assert s["require_geo"] is True
    assert "location_tracking" not in s
