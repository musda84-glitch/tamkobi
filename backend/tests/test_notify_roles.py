from notify import (
    collect_dispatch_tokens,
    expo_push_messages,
    filter_notifications,
    is_expo_push_token,
    is_targeted_note,
    merge_push_tokens,
    notification_doc,
    notification_visible,
    pick_unread_for_push,
    role_label,
    roles_for_type,
    user_ids_of,
)


def test_roles_for_known_types():
    assert "warehouse" in roles_for_type("order_pick_missing")
    assert "production" in roles_for_type("order_pick_production")
    assert "accountant" in roles_for_type("attendance_late")
    assert "accountant" in roles_for_type("advance_request")
    assert "manager" in roles_for_type("yevmiye_adjustment")
    assert "accountant" in roles_for_type("yevmiye_adjustment")
    assert "manager" in roles_for_type("location_exit")
    assert "accountant" in roles_for_type("location_exit")
    assert "accountant" in roles_for_type("bank_sync")
    assert roles_for_type("task_assigned") == []
    assert roles_for_type("unknown_type") == ["admin"]
    assert role_label("warehouse") == "Depo"


def test_admin_sees_all():
    note = {"type": "order_pick_missing", "title": "Depo eksik"}
    assert notification_visible(note, {"role": "admin"})
    assert notification_visible(note, {"is_super_admin": True, "role": "sales"})


def test_staff_admin_sees_only_assigned():
    mine = {"type": "task_assigned", "title": "bana", "employee_id": "emp_1", "roles": []}
    other = {"type": "task_assigned", "title": "başkasına", "employee_id": "emp_9", "roles": []}
    broadcast = {"type": "order_pick_production", "title": "üretim"}
    staff_admin = {"role": "admin", "id": "u1", "employee_id": "emp_1"}
    assert notification_visible(mine, staff_admin)
    assert not notification_visible(other, staff_admin)
    assert not notification_visible(broadcast, staff_admin)


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


def test_company_admin_would_receive_bank_sync_push():
    note = notification_doc("c1", "bank_sync", "3 yeni banka hareketi", "Enpara", link="/banking")
    admin = {"_id": "usr_admin", "role": "admin", "active_company_id": "c1"}
    staff = {"_id": "usr_wh", "role": "warehouse", "active_company_id": "c1"}
    assert notification_visible(note, admin)
    assert not notification_visible(note, staff)
    assert user_ids_of(admin) == ["usr_admin"]


def test_expo_push_token_and_payload():
    assert is_expo_push_token("ExponentPushToken[abc123]")
    assert is_expo_push_token("ExpoPushToken[xyz]")
    assert not is_expo_push_token("fcm:abc")
    assert not is_expo_push_token("")
    note = notification_doc("c1", "b2b_order", "Yeni sipariş", "N11 · 2 kalem", link="/orders", ref_type="order", ref_id="o1")
    msgs = expo_push_messages(["ExponentPushToken[abc123]", "bad", "ExponentPushToken[abc123]"], note)
    assert len(msgs) == 1
    assert msgs[0]["to"] == "ExponentPushToken[abc123]"
    assert msgs[0]["title"] == "Yeni sipariş"
    assert msgs[0]["data"]["link"] == "/orders"
    assert msgs[0]["channelId"] == "tamkobi"
    assert msgs[0]["badge"] == 1


def test_broadcast_notes_also_use_company_push_tokens():
    note = notification_doc("c1", "bank_sync", "1 yeni banka hareketi", "Vadesiz")
    targeted = notification_doc("c1", "task_assigned", "Görev", "sana", user_id="usr_1", employee_id="emp_1")
    assert not is_targeted_note(note)
    assert is_targeted_note(targeted)
    user_tok = ["ExponentPushToken[admin]"]
    company_tok = ["ExponentPushToken[admin]", "ExponentPushToken[phone]", "bad"]
    assert collect_dispatch_tokens(user_tok, company_tok, targeted=False) == [
        "ExponentPushToken[admin]",
        "ExponentPushToken[phone]",
    ]
    assert collect_dispatch_tokens(user_tok, company_tok, targeted=True) == ["ExponentPushToken[admin]"]
    assert merge_push_tokens([], ["ExpoPushToken[x]"]) == ["ExpoPushToken[x]"]


def test_unread_panel_notes_are_queued_for_phone():
    admin = {"_id": "usr_admin", "role": "admin", "active_company_id": "c1"}
    rows = [
        notification_doc("c1", "bank_sync", "1 yeni banka hareketi", "Vadesiz TL Hesabı"),
        notification_doc("c1", "b2b_order", "Yeni B2B siparişi", "B2B-2026-0010"),
        notification_doc("c1", "quote_response", "TKF-2026-0017 ONAYLANDI", "Mustafa BAL"),
        {**notification_doc("c1", "bank_sync", "eski", "okundu"), "is_read": True},
        notification_doc("c1", "task_assigned", "Gizli görev", "başkasına", user_id="usr_x", roles=[]),
    ]
    picked = pick_unread_for_push(rows, admin, limit=3)
    assert [n["title"] for n in picked] == [
        "1 yeni banka hareketi",
        "Yeni B2B siparişi",
        "TKF-2026-0017 ONAYLANDI",
    ]
    staff = {"_id": "usr_wh", "role": "warehouse", "active_company_id": "c1"}
    assert pick_unread_for_push(rows, staff) == []
