from notify import (
    filter_notifications,
    notification_doc,
    notification_visible,
    role_label,
    roles_for_type,
)


def test_roles_for_known_types():
    assert "warehouse" in roles_for_type("order_pick_missing")
    assert "production" in roles_for_type("order_pick_production")
    assert "accountant" in roles_for_type("attendance_late")
    assert roles_for_type("task_assigned") == []
    assert roles_for_type("unknown_type") == ["admin"]
    assert role_label("warehouse") == "Depo"


def test_admin_sees_all():
    note = {"type": "order_pick_missing", "title": "Depo eksik"}
    assert notification_visible(note, {"role": "admin"})
    assert notification_visible(note, {"is_super_admin": True, "role": "sales"})


def test_warehouse_sees_pick_missing_not_late():
    warehouse = {"role": "warehouse", "id": "u1"}
    assert notification_visible({"type": "order_pick_missing"}, warehouse)
    assert not notification_visible({"type": "attendance_late"}, warehouse)
    assert notification_visible({"type": "attendance_late"}, {"role": "accountant"})


def test_personal_note_reaches_assignee():
    note = {"type": "overtime_assigned", "user_id": "usr_1", "employee_id": "emp_9", "roles": []}
    assert notification_visible(note, {"id": "usr_1", "role": "sales"})
    assert notification_visible(note, {"_id": "other", "employee_id": "emp_9", "role": "production"})
    assert not notification_visible(note, {"id": "usr_2", "role": "sales"})


def test_role_assigned_visible_to_managers_and_assignee():
    note = notification_doc("c1", "role_assigned", "Rol atandı", "Ali · Depo", user_id="usr_ali")
    assert "admin" in note["roles"]
    assert notification_visible(note, {"role": "admin"})
    assert notification_visible(note, {"id": "usr_ali", "role": "warehouse"})
    assert not notification_visible(note, {"id": "usr_x", "role": "sales"})


def test_filter_keeps_matching_rows():
    rows = [
        {"type": "order_pick_missing", "title": "depo"},
        {"type": "attendance_late", "title": "geç"},
        {"type": "task_assigned", "title": "görev", "user_id": "u-wh", "roles": []},
    ]
    out = filter_notifications(rows, {"id": "u-wh", "role": "warehouse"})
    assert [n["title"] for n in out] == ["depo", "görev"]
