import asyncio

import attendance
import staff_messages
from dashboard_memdb import MemDB
from staff_messages import (
    announce_title,
    announce_visible,
    build_panel_chats,
    filter_panel_chats,
    group_title,
    inbox_from_rows,
    is_manager,
    is_manager_role,
    manager_inbox_from_rows,
    merge_manager_directory,
    message_doc,
    normalize_body,
    page_panel_chats,
    panel_unread_total,
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
    assert is_manager({"role": "Yönetici"})
    assert is_manager({"role": "custom", "role_name": "Yönetici"})
    assert is_manager({"is_super_admin": True, "role": "personel"})
    assert not is_manager({"role": "personel"})
    assert is_manager_role("rol_x", "Yönetici")
    assert is_manager_role("lead", None, {"/personnel": "edit", "/settings": "edit"})
    assert not is_manager_role("sales", "Satış", {"/quotes": "edit"})
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


def _mgr_row(mid, body, read_at=None, company_id="c1", employee_id="", created_at="2026-10-01T12:00:00"):
    return {
        "_id": mid,
        "company_id": company_id,
        "employee_id": employee_id,
        "from_side": "manager",
        "from_user_id": "mgrA",
        "from_name": "Mustafa",
        "to_user_id": "mgrB",
        "to_name": "Ayşe",
        "body": body,
        "created_at": created_at,
        "read_at": read_at,
    }


def test_panel_counts_manager_dm_and_skips_other_company():
    managers = {"mgrA", "mgrB"}
    names = {"mgrA": {"name": "Mustafa"}, "mgrB": {"name": "Ayşe"}}
    rows = [
        _mgr_row("a", "gel", created_at="2026-10-02T10:00:00"),
        _mgr_row("b", "eski", read_at="ok", created_at="2026-10-01T10:00:00"),
        _mgr_row("c", "diger-sirket", company_id="c2", created_at="2026-10-03T10:00:00"),
        {
            "_id": "s1",
            "company_id": "c1",
            "employee_id": "e1",
            "employee_name": "Ali",
            "from_side": "staff",
            "from_user_id": "staff1",
            "to_user_id": "",
            "body": "izin",
            "created_at": "2026-10-02T09:00:00",
            "read_at": None,
        },
    ]
    # İK gelen kutusu boş employee_id satırını yine atlar.
    legacy = inbox_from_rows(rows, "mgrB")
    assert [r["employee_id"] for r in legacy] == ["e1"]
    assert legacy[0]["unread"] == 1
    chats = build_panel_chats(
        rows,
        reader_user_id="mgrB",
        manager_ids=managers,
        reader_is_manager=True,
        managers_by_id=names,
        company_id="c1",
    )
    assert panel_unread_total(chats) == 2
    by_key = {c["key"]: c for c in chats}
    assert by_key["m:mgrA"]["unread"] == 1
    assert by_key["m:mgrA"]["name"] == "Mustafa"
    assert "diger-sirket" not in str(chats)
    read_rows = [{**rows[0], "read_at": "now"}, *rows[1:]]
    after = build_panel_chats(
        read_rows,
        reader_user_id="mgrB",
        manager_ids=managers,
        reader_is_manager=True,
        managers_by_id=names,
        company_id="c1",
    )
    assert panel_unread_total(after) == 1
    # Personel kartı dolu yönetici-yönetici DM'i de personel sohbetine karışmaz.
    linked = _mgr_row("d", "kartli", employee_id="empA", created_at="2026-10-04T10:00:00")
    linked_chats = build_panel_chats(
        [linked],
        reader_user_id="mgrB",
        manager_ids=managers,
        reader_is_manager=True,
        managers_by_id=names,
        company_id="c1",
    )
    assert linked_chats[0]["kind"] == "manager"
    assert linked_chats[0]["unread"] == 1
    page, nxt = page_panel_chats(chats, limit=1, cursor="0")
    assert len(page) == 1
    assert nxt == "1"
    only_unread = filter_panel_chats(chats, unread_only=True)
    assert all(c["unread"] > 0 for c in only_unread)


def test_panel_inbox_pages_past_400_and_drops_when_read():
    """Canlı veritabanına ve 8021 portuna bağlanmaz."""
    db = MemDB()
    prev = staff_messages._db
    prev_att = attendance._db
    staff_messages._db = db
    attendance._db = db

    async def _go():
        await db.users.insert_one({
            "_id": "mgrB", "role": "admin", "name": "Ayşe",
            "active_company_id": "c1", "company_ids": ["c1"], "company_id": "c1",
        })
        await db.users.insert_one({
            "_id": "mgrA", "role": "manager", "name": "Mustafa",
            "active_company_id": "c1", "company_ids": ["c1"], "company_id": "c1",
        })
        for i in range(401):
            stamp = f"2026-10-01T{i // 3600:02d}:{(i // 60) % 60:02d}:{i % 60:02d}"
            await db.staff_messages.insert_one(_mgr_row(
                f"m{i:04d}", f"n{i}", created_at=stamp,
            ))
        await db.staff_messages.insert_one(_mgr_row(
            "other", "diger-sirket", company_id="c2", created_at="2026-12-01T00:00:00",
        ))
        reader = {
            "_id": "mgrB", "role": "admin", "name": "Ayşe",
            "active_company_id": "c1", "company_ids": ["c1"],
        }
        data = await staff_messages._panel_inbox(reader, limit=10)
        assert data["unread_total"] == 401
        assert data["next_cursor"] is None
        assert len(data["chats"]) == 1
        assert data["chats"][0]["key"] == "m:mgrA"
        blob = str(data)
        assert "diger-sirket" not in blob
        marked = await staff_messages._read_messages({"to_user_id": "mgrA"}, reader)
        assert int(marked["updated"]) >= 401
        again = await staff_messages._panel_inbox(reader, limit=10)
        assert again["unread_total"] == 0

    try:
        asyncio.run(_go())
    finally:
        staff_messages._db = prev
        attendance._db = prev_att
