from attendance import (
    geo_target,
    pick_field_assignment,
    task_is_field,
    task_is_open,
    task_kind_of,
    workplace_payload,
    workplace_place_label,
)


def test_task_is_open():
    assert task_is_open({"title": "Montaj"})
    assert not task_is_open({"done": True})
    assert not task_is_open({"status": "completed"})
    assert not task_is_open({"status": "tamamlandi"})


def test_pick_prefers_due_today_then_coords():
    today = "2026-09-22"
    rows = [
        {"title": "Eski", "due_date": "2026-09-01", "project_status": "active", "latitude": 41, "longitude": 29},
        {"title": "Bugün konumsuz", "due_date": today, "project_status": "active"},
        {"title": "Bugün konumlu", "due_date": today, "project_status": "active", "latitude": 40, "longitude": 32},
        {"title": "Bitti", "done": True, "due_date": today, "latitude": 1, "longitude": 1},
        {"title": "Kapalı proje", "due_date": today, "project_status": "completed", "latitude": 2, "longitude": 2},
    ]
    picked = pick_field_assignment(rows, today)
    assert picked["title"] == "Bugün konumlu"


def test_office_task_is_not_field():
    assert task_kind_of({"kind": "office"}) == "office"
    assert task_kind_of({"kind": "iç"}) == "office"
    assert task_kind_of({"title": "Montaj"}) == "field"
    assert task_is_field({"kind": "field"})
    assert not task_is_field({"kind": "office"})
    today = "2026-09-22"
    picked = pick_field_assignment(
        [
            {"title": "Ofis", "kind": "office", "project_status": "active", "latitude": 41, "longitude": 29},
            {"title": "Saha", "kind": "field", "project_status": "active", "latitude": 40, "longitude": 32},
        ],
        today,
    )
    assert picked["title"] == "Saha"
    assert pick_field_assignment(
        [{"title": "Ofis", "kind": "office", "project_status": "active"}],
        today,
    ) is None


def test_pick_open_without_due():
    picked = pick_field_assignment(
        [{"title": "Keşif", "project_status": "active", "latitude": 39.9, "longitude": 32.8}],
        "2026-09-22",
    )
    assert picked["title"] == "Keşif"


def test_workplace_task_overrides_company():
    company = {"latitude": 41.0, "longitude": 29.0, "radius_m": 200, "label": "Ofis"}
    assignment = {
        "id": "t1", "title": "Montaj", "project_name": "Villa", "project_number": "PRJ-1",
        "latitude": 40.1, "longitude": 32.9, "address": "Ankara", "duration_days": 3,
    }
    w = workplace_payload(company, assignment)
    assert w["kind"] == "task"
    assert w["has_coords"] is True
    assert w["latitude"] == 40.1
    assert w["task_title"] == "Montaj"
    assert w["duration_days"] == 3
    assert geo_target(w)["latitude"] == 40.1
    assert workplace_place_label(w) == "Villa"


def test_field_task_without_coords_skips_company_geo():
    company = {"latitude": 41.0, "longitude": 29.0, "radius_m": 300, "label": "Ofis"}
    w = workplace_payload(company, {"id": "t2", "title": "Keşif", "project_name": "Saha"})
    assert w["kind"] == "task"
    assert w["has_coords"] is False
    assert geo_target(w) is None


def test_company_fallback():
    w = workplace_payload({"latitude": 41.0, "longitude": 29.0, "radius_m": 250, "label": "Merkez"}, None)
    assert w["kind"] == "company"
    assert w["radius_m"] == 250
    assert geo_target(w) is w


def test_no_workplace():
    assert workplace_payload(None, None) is None
    assert pick_field_assignment([], "2026-09-22") is None
