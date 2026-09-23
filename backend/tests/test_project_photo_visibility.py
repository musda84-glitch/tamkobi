from attendance import assignment_from_project, project_workflow
from project_photos import (
    apply_photo_visibility,
    customer_can_see_photo,
    employee_photo_row,
    group_stage_photos,
    photo_visibility,
    sanitize_stage_photos,
)


def test_employee_photo_starts_pending_and_hidden_from_customer():
    row = employee_photo_row(
        "/api/files/work.jpg",
        stage="active",
        stage_label="Uygulama",
        created_at="2026-09-23T10:00:00+00:00",
        uploaded_by="e1",
        task_id="t1",
    )
    assert photo_visibility(row) == "pending"
    assert customer_can_see_photo(row) is False
    groups = group_stage_photos([row], ["/api/files/work.jpg"], [{"key": "active", "label": "Uygulama"}])
    assert groups == []


def test_manager_can_show_or_hide_customer_photo():
    pending = employee_photo_row(
        "/api/files/work.jpg", stage="active", stage_label="Uygulama",
        created_at="2026-09-23", uploaded_by="e1", task_id="t1",
    )
    shown = apply_photo_visibility([pending], "/api/files/work.jpg", True)
    assert shown[0]["visibility"] == "show"
    assert customer_can_see_photo(shown[0]) is True
    hidden = apply_photo_visibility(shown, "/api/files/work.jpg", False)
    assert hidden[0]["visibility"] == "hide"
    assert group_stage_photos(hidden, ["/api/files/work.jpg"], [{"key": "active", "label": "Uygulama"}]) == []
    again = group_stage_photos(shown, ["/api/files/work.jpg"], [{"key": "active", "label": "Uygulama"}])
    assert again[0]["images"] == ["/api/files/work.jpg"]


def test_legacy_photos_remain_customer_visible():
    row = sanitize_stage_photos([{"url": "/api/files/old.jpg", "stage": "planning"}])[0]
    assert photo_visibility(row) == "show"
    assert customer_can_see_photo(row) is True


def test_assignment_includes_workflow_and_photos():
    proj = {
        "_id": "p1",
        "name": "Villa",
        "project_number": "PRJ-2026-0006",
        "status": "active",
        "latitude": 40.1,
        "longitude": 32.8,
        "address": "Ankara",
        "tasks": [
            {"id": "t1", "title": "Montaj", "assignee_id": "e1", "assignee_name": "Ali", "kind": "field"},
            {"id": "t2", "title": "Teslim", "done": True},
        ],
        "stage_photos": [employee_photo_row(
            "/api/files/work.jpg", stage="active", stage_label="Uygulama",
            created_at="2026-09-23", uploaded_by="e1", task_id="t1",
        )],
    }
    flow = project_workflow(proj)
    assert [x["title"] for x in flow] == ["Montaj", "Teslim"]
    assert flow[1]["done"] is True
    row = assignment_from_project(proj, proj["tasks"][0])
    assert row["project_id"] == "p1"
    assert row["latitude"] == 40.1
    assert len(row["workflow"]) == 2
    assert row["photos"][0]["visibility"] == "pending"
