"""Unit tests for platform maintenance / announcement notices."""
from datetime import datetime, timedelta, timezone

from platform_notices import (
    announcement_visible,
    maintenance_active,
    maintenance_upcoming,
    normalize_maintenance,
)


NOW = datetime(2026, 9, 23, 12, 0, tzinfo=timezone.utc)


def test_normalize_maintenance_defaults():
    m = normalize_maintenance({})
    assert m["enabled"] is False
    assert m["notify_popup"] is True
    assert "Güncelleme" in m["title"] or "güncelleme" in m["title"].lower() or m["title"]


def test_maintenance_active_window():
    m = {
        "enabled": True,
        "starts_at": (NOW - timedelta(hours=1)).isoformat(),
        "ends_at": (NOW + timedelta(hours=1)).isoformat(),
    }
    assert maintenance_active(m, now=NOW) is True
    assert maintenance_upcoming(m, now=NOW) is False


def test_maintenance_upcoming_before_start():
    m = {
        "enabled": True,
        "starts_at": (NOW + timedelta(hours=2)).isoformat(),
        "ends_at": (NOW + timedelta(hours=4)).isoformat(),
    }
    assert maintenance_active(m, now=NOW) is False
    assert maintenance_upcoming(m, now=NOW) is True


def test_maintenance_disabled():
    m = {"enabled": False, "starts_at": (NOW - timedelta(hours=1)).isoformat()}
    assert maintenance_active(m, now=NOW) is False
    assert maintenance_upcoming(m, now=NOW) is False


def test_announcement_visible_range():
    a = {
        "active": True,
        "starts_at": (NOW - timedelta(days=1)).isoformat(),
        "ends_at": (NOW + timedelta(days=1)).isoformat(),
    }
    assert announcement_visible(a, now=NOW) is True
    assert announcement_visible({**a, "active": False}, now=NOW) is False
    assert announcement_visible({**a, "ends_at": (NOW - timedelta(minutes=1)).isoformat()}, now=NOW) is False
