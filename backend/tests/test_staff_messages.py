from staff_messages import (
    announce_title,
    announce_visible,
    group_title,
    inbox_from_rows,
    is_manager,
    manager_inbox_from_rows,
    merge_manager_directory,
    message_doc,
    normalize_body,
    preview_messages,
    public_announce,
    public_message,
    unread_for_reader,
    user_company_id,
    user_in_group,
    validate_body,
)


def test_normalize_and_validate_body():
    assert normalize_body("  merhaba  \n\n\n  davut ") == "merhaba\n\ndavut"
    assert validate_body("   ")[1] == "Mesaj yazın."
    assert validate_body("ok")[0] == "ok"


def test_manager_and_company():
    assert is_manager({"role": "admin"})
    assert is_manager({"role": "manager"})
    assert is_manager({"is_super_admin": True, "role": "personel"})
    assert not is_manager({"role": "personel"})
    assert user_company_id({"active_company_id": "c1", "company_ids": ["c2"]}) == "c1"
    assert user_company_id({"company_ids": ["c2"]}) == "c2"


def test_inbox_and_unread():
    rows = [
        {"_id": "m2", "employee_id": "e1", "employee_name": "Ali", "from_side": "staff", "body": "selam", "read_at": None},
        {"_id": "m1", "employee_id": "e1", "employee_name": "Ali", "from_side": "manager", "body": "tamam", "read_at": None},
        {"_id": "m0", "employee_id": "e2", "employee_name": "Ayşe", "from_side": "staff", "body": "izin", "read_at": "x"},
    ]
    inbox = inbox_from_rows(rows)
    assert inbox[0]["employee_id"] == "e1"
    assert inbox[0]["unread"] == 1
    assert inbox[1]["unread"] == 0
    assert unread_for_reader(rows[:2], "staff") == 1
    assert unread_for_reader(rows[:2], "manager") == 1
    assert preview_messages(rows, 1)[0]["id"] == "m2"


def test_message_doc_public():
    doc = message_doc(
        company_id="c1",
        employee_id="e1",
        employee_name="Ali",
        from_side="manager",
        from_user_id="u1",
        from_name="Yönetici",
        body="Montaja gel",
    )
    pub = public_message(doc)
    assert pub["id"]
    assert pub["from_side"] == "manager"
    assert pub["body"] == "Montaja gel"
    assert "created_at" in pub
    assert pub["thread_kind"] == "legacy"


def test_manager_inbox_and_group_helpers():
    assert group_title("  Ekip  ") == "Ekip"
    assert group_title("") == "Grup"
    group = {"member_user_ids": ["u1"], "member_employee_ids": ["e2"]}
    assert user_in_group(group, "u1")
    assert user_in_group(group, "", "e2")
    assert not user_in_group(group, "u9")
    rows = [
        {"_id": "m1", "to_user_id": "u1", "from_side": "staff", "body": "selam", "read_at": None},
        {"_id": "m2", "from_side": "manager", "from_user_id": "u2", "from_name": "Ayşe", "body": "ok", "read_at": None},
        {"_id": "m3", "group_id": "g1", "body": "grup", "read_at": None},
    ]
    inbox = manager_inbox_from_rows(rows, [{"id": "u1", "name": "Ali"}, {"id": "u2", "name": "Ayşe"}], "staff1")
    ids = [r["user_id"] for r in inbox]
    assert "u1" in ids and "u2" in ids
    assert inbox[0]["unread"] >= 1
    merged = merge_manager_directory(
        [{"user_id": "u1", "name": "Ali", "unread": 1, "last": {"body": "x"}}],
        [{"id": "u1", "name": "Ali"}, {"id": "u3", "name": "Can"}],
    )
    assert {r["user_id"] for r in merged} == {"u1", "u3"}


def test_inbox_hides_other_manager_dms():
    rows = [
        {"_id": "a", "employee_id": "e1", "employee_name": "Ali", "from_side": "staff", "to_user_id": "mgrA", "body": "özel", "read_at": None},
        {"_id": "b", "employee_id": "e1", "employee_name": "Ali", "from_side": "staff", "to_user_id": "mgrB", "body": "diğer", "read_at": None},
        {"_id": "c", "employee_id": "e2", "employee_name": "Ayşe", "from_side": "staff", "body": "genel", "read_at": None},
    ]
    inbox = inbox_from_rows(rows, "mgrA")
    assert [r["employee_id"] for r in inbox] == ["e1", "e2"]
    assert inbox[0]["last"]["body"] == "özel"


def test_announce_helpers():
    assert announce_title("  Toplantı  ") == "Toplantı"
    assert announce_title("") == "Duyuru"
    all_staff = {"employee_ids": [], "title": "Genel", "body": "yarın tatil"}
    targeted = {"employee_ids": ["e1"], "title": "Özel", "body": "sen gel"}
    assert announce_visible(all_staff, "e9")
    assert announce_visible(targeted, "e1")
    assert not announce_visible(targeted, "e9")
    assert announce_visible(targeted, "e9", manager=True)
    pub = public_announce({"_id": "a1", **all_staff, "from_name": "Mustafa"})
    assert pub["id"] == "a1"
    assert pub["title"] == "Genel"
