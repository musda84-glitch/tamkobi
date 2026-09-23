"""Unit tests for platform maintenance / announcement notices."""
from datetime import datetime, timedelta, timezone

from platform_notices import (
    AUDIENCE_ALL,
    AUDIENCE_SELECTED,
    STATUS_DRAFT,
    STATUS_PUBLISHED,
    announcement_targets_company,
    announcement_visible,
    maintenance_active,
    maintenance_upcoming,
    normalize_audience,
    normalize_company_ids,
    normalize_maintenance,
    normalize_status,
)


NOW = datetime(2026, 9, 23, 12, 0, tzinfo=timezone.utc)


def test_normalize_maintenance_defaults():
    m = normalize_maintenance({})
    assert m["enabled"] is False
    assert m["notify_popup"] is True
    assert m["audience"] == AUDIENCE_ALL
    assert m["company_ids"] == []
    assert "Güncelleme" in m["title"] or "güncelleme" in m["title"].lower() or m["title"]


def test_normalize_maintenance_selected_audience():
    m = normalize_maintenance({"audience": "selected", "company_ids": ["c1", "c1", " c2 "]})
    assert m["audience"] == AUDIENCE_SELECTED
    assert m["company_ids"] == ["c1", "c2"]


def test_selected_without_companies_falls_back_to_all():
    assert normalize_audience("selected", []) == AUDIENCE_ALL
    assert normalize_company_ids(["a", "", "a", "b"]) == ["a", "b"]


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
        "status": STATUS_PUBLISHED,
        "starts_at": (NOW - timedelta(days=1)).isoformat(),
        "ends_at": (NOW + timedelta(days=1)).isoformat(),
    }
    assert announcement_visible(a, now=NOW) is True
    assert announcement_visible({**a, "active": False}, now=NOW) is False
    assert announcement_visible({**a, "ends_at": (NOW - timedelta(minutes=1)).isoformat()}, now=NOW) is False


def test_draft_hidden_unless_demo():
    a = {
        "active": True,
        "status": STATUS_DRAFT,
        "starts_at": (NOW - timedelta(hours=1)).isoformat(),
    }
    assert announcement_visible(a, now=NOW) is False
    assert announcement_visible(a, now=NOW, include_drafts=True) is True
    assert normalize_status("draft") == STATUS_DRAFT
    assert normalize_status("bogus") == STATUS_PUBLISHED


def test_announcement_targets_company():
    all_a = {"audience": "all"}
    sel = {"audience": "selected", "company_ids": ["comp_a", "comp_b"]}
    assert announcement_targets_company(all_a, None) is True
    assert announcement_targets_company(all_a, "comp_x") is True
    assert announcement_targets_company(sel, None) is False
    assert announcement_targets_company(sel, "comp_a") is True
    assert announcement_targets_company(sel, "comp_z") is False


def test_demo_only_then_expand_to_all_fields():
    """DEMO’ya yayın → sonra tüm şirketlere aç: audience/company_ids dönüşümü."""
    demo_pub = {
        "audience": AUDIENCE_SELECTED,
        "company_ids": ["comp_demo"],
        "status": STATUS_PUBLISHED,
        "active": True,
    }
    assert announcement_targets_company(demo_pub, "comp_demo") is True
    assert announcement_targets_company(demo_pub, "comp_other") is False

    expanded = {
        "audience": normalize_audience("all", []),
        "company_ids": [],
        "status": STATUS_PUBLISHED,
    }
    assert expanded["audience"] == AUDIENCE_ALL
    assert announcement_targets_company(expanded, "comp_other") is True
    assert announcement_targets_company(expanded, "comp_demo") is True
