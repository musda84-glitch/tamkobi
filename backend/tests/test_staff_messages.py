from staff_messages import (
    inbox_from_rows,
    is_manager,
    message_doc,
    normalize_body,
    preview_messages,
    public_message,
    unread_for_reader,
    user_company_id,
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
