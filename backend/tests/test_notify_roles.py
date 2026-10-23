import asyncio
import copy
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import notify
from notify import (
    collect_dispatch_tokens,
    expo_push_messages,
    filter_notifications,
    is_expo_push_token,
    is_targeted_note,
    merge_push_tokens,
    notification_can_delete,
    notification_doc,
    notification_visible,
    pick_unread_for_push,
    push_visible,
    remove_push_token,
    replay_unread_to_token,
    role_label,
    roles_for_type,
    upsert_push_token,
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
    assert "manager" in roles_for_type("geo_confirm_request")
    assert "accountant" in roles_for_type("geo_confirm_request")
    assert roles_for_type("geo_confirm_decision") == []
    assert "accountant" in roles_for_type("bank_sync")
    assert "manager" in roles_for_type("early_leave_request")
    assert "accountant" in roles_for_type("early_leave_request")
    assert roles_for_type("task_assigned") == []
    assert roles_for_type("einvoice_incoming") == ["admin", "manager", "accountant"]
    assert roles_for_type("order_new") == ["admin", "manager", "sales"]
    assert roles_for_type("gib_credits_low") == ["admin"]
    assert roles_for_type("receivable_overdue") == ["admin", "accountant"]
    assert roles_for_type("unknown_type") == ["admin"]
    assert "manager" in roles_for_type("pos_approval")
    assert roles_for_type("pos_daily_summary") == ["admin", "manager"]
    assert role_label("warehouse") == "Depo"
    assert role_label("manager") == "Müdür"


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


def test_staff_admin_sees_bank_and_cash_broadcasts():
    staff_admin = {"role": "admin", "id": "u1", "employee_id": "emp_1"}
    bank = notification_doc("c1", "bank_sync", "2 yeni banka hareketi", "Enpara", link="/banking?tab=match")
    cash = notification_doc("c1", "cash_approval", "Kasa onayı", "500 ₺")
    pick = {"type": "order_pick_missing", "title": "depo"}
    assert notification_visible(bank, staff_admin)
    assert notification_visible(cash, staff_admin)
    assert not notification_visible(pick, staff_admin)


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
    msgs = expo_push_messages(
        ["ExponentPushToken[abc123]", "bad", "ExponentPushToken[abc123]"],
        note,
        {"ExponentPushToken[abc123]": "usr_1"},
    )
    assert len(msgs) == 1
    assert msgs[0]["to"] == "ExponentPushToken[abc123]"
    assert msgs[0]["title"] == "Yeni sipariş"
    assert msgs[0]["data"]["link"] == "/orders"
    assert msgs[0]["data"]["type"] == "b2b_order"
    assert msgs[0]["data"]["ref_type"] == "order"
    assert msgs[0]["data"]["ref_id"] == "o1"
    assert msgs[0]["data"]["user_id"] == "usr_1"
    assert msgs[0]["data"]["company_id"] == "c1"
    assert msgs[0]["channelId"] == "tamkobi_chime"
    assert msgs[0]["sound"] == "tamkobi.wav"
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


def test_only_read_visible_notes_can_be_deleted():
    unread = {"type": "bank_sync", "is_read": False}
    read = {"type": "bank_sync", "is_read": True}
    hidden = {"type": "task_assigned", "is_read": True, "user_id": "usr_x", "roles": []}
    admin = {"role": "admin", "id": "usr_admin"}
    staff = {"role": "warehouse", "id": "usr_wh"}
    assert not notification_can_delete(unread, admin)
    assert notification_can_delete(read, admin)
    assert not notification_can_delete(hidden, staff)
    assert not notification_can_delete(None, admin)


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


MGR = "ExponentPushToken[managerPhone001]"
ACC = "ExponentPushToken[accountantPhone1]"
PER = "ExponentPushToken[personnelPhone01]"
ADM = "ExponentPushToken[adminPhone000001]"
SHARED = "ExponentPushToken[sharedDevice0001]"
BLANK = "ExponentPushToken[blankUserDevice1]"


class _PushColl:
    def __init__(self):
        self.docs = {}

    def _match(self, doc, query):
        for key, expected in (query or {}).items():
            if key == "$or":
                if not any(self._match(doc, clause) for clause in expected):
                    return False
                continue
            if str(key).startswith("$"):
                continue
            current = doc.get(key)
            if isinstance(expected, dict):
                if "$in" in expected and current not in expected["$in"]:
                    return False
                if "$ne" in expected and current == expected["$ne"]:
                    return False
                continue
            if current != expected:
                return False
        return True

    async def find_one(self, query=None, *args, **kwargs):
        for doc in self.docs.values():
            if self._match(doc, query or {}):
                return copy.deepcopy(doc)
        return None

    def find(self, query=None, *args, **kwargs):
        rows = [copy.deepcopy(doc) for doc in self.docs.values() if self._match(doc, query or {})]

        class Cursor:
            def sort(self, *args, **kwargs):
                return self

            async def to_list(self, limit=None):
                if limit is None:
                    return list(rows)
                return list(rows)[:limit]

        return Cursor()

    async def update_one(self, filt, upd, upsert=False):
        found = None
        for doc in self.docs.values():
            if self._match(doc, filt or {}):
                found = doc
                break
        if found is None:
            if not upsert:
                return None
            doc = {}
            if "$setOnInsert" in (upd or {}):
                doc.update(upd["$setOnInsert"])
            if "$set" in (upd or {}):
                doc.update(upd["$set"])
            for key, value in (filt or {}).items():
                if not str(key).startswith("$") and not isinstance(value, dict):
                    doc.setdefault(key, value)
            if not doc.get("_id"):
                doc["_id"] = f"row{len(self.docs)}"
            self.docs[str(doc["_id"])] = doc
            return None
        if "$set" in (upd or {}):
            found.update(upd["$set"])
        if "$addToSet" in (upd or {}):
            for key, value in upd["$addToSet"].items():
                current = found.get(key)
                if not isinstance(current, list):
                    current = []
                    found[key] = current
                items = value.get("$each") if isinstance(value, dict) and "$each" in value else [value]
                for item in items or []:
                    if item not in current:
                        current.append(item)
        return None

    async def delete_many(self, query):
        class Result:
            deleted_count = 0

        doomed = [key for key, doc in self.docs.items() if self._match(doc, query or {})]
        for key in doomed:
            del self.docs[key]
        Result.deleted_count = len(doomed)
        return Result()


class _PushDB:
    def __init__(self):
        self.push_tokens = _PushColl()
        self.users = _PushColl()
        self.notifications = _PushColl()

    def add_user(self, uid, role, **extra):
        doc = {
            "_id": uid,
            "id": uid,
            "role": role,
            "is_active": True,
            "is_super_admin": False,
            "active_company_id": "c1",
            "company_ids": ["c1"],
        }
        doc.update(extra)
        self.users.docs[uid] = doc
        return doc

    def add_token(self, token, user_id, company_id="c1"):
        self.push_tokens.docs[token] = {
            "_id": token,
            "token": token,
            "user_id": user_id,
            "company_id": company_id,
        }


def _run(coro):
    return asyncio.run(coro)


async def _sent(db, note):
    captured = {}

    async def fake_send(messages):
        captured["messages"] = list(messages)
        return {"sent": len(messages), "tickets": [], "errors": 0}

    with patch.object(notify, "send_expo_push", fake_send):
        await notify.dispatch_push(db, note)
    return captured.get("messages") or []


def test_push_payload_user_and_company_are_per_token():
    note = notification_doc("c1", "einvoice_incoming", "Gelen e-belge", "1 fatura", link="/edoc-inbox")
    msgs = expo_push_messages([MGR, ACC], note, {MGR: "usr_mgr", ACC: "usr_acc"})
    assert [m["to"] for m in msgs] == [MGR, ACC]
    assert msgs[0]["data"]["user_id"] == "usr_mgr"
    assert msgs[1]["data"]["user_id"] == "usr_acc"
    assert msgs[0]["data"]["company_id"] == "c1"
    assert msgs[1]["data"]["company_id"] == "c1"
    assert msgs[0]["data"]["type"] == "einvoice_incoming"
    assert msgs[0]["data"]["link"] == "/edoc-inbox"
    msgs[0]["data"]["user_id"] = "changed"
    assert msgs[1]["data"]["user_id"] == "usr_acc"


def test_company_broadcast_skips_personnel_and_blank_tokens():
    db = _PushDB()
    db.add_user("usr_mgr", "manager")
    db.add_user("usr_acc", "accountant")
    db.add_user("usr_per", "personel")
    db.add_user("usr_adm", "admin")
    db.add_token(MGR, "usr_mgr")
    db.add_token(ACC, "usr_acc")
    db.add_token(PER, "usr_per")
    db.add_token(ADM, "usr_adm")
    db.add_token(BLANK, "")
    note = notification_doc("c1", "einvoice_incoming", "Gelen e-belge", "1 fatura")
    assert note["roles"] == ["admin", "manager", "accountant"]
    messages = _run(_sent(db, note))
    targets = {m["to"]: m["data"]["user_id"] for m in messages}
    assert PER not in targets
    assert BLANK not in targets
    assert targets[MGR] == "usr_mgr"
    assert targets[ACC] == "usr_acc"
    assert targets[ADM] == "usr_adm"
    assert {m["data"]["company_id"] for m in messages} == {"c1"}


def test_personal_push_goes_only_to_recipient_token():
    db = _PushDB()
    db.add_user("usr_mgr", "manager")
    db.add_user("usr_per", "personel")
    db.add_user("usr_adm", "admin")
    db.add_token(MGR, "usr_mgr")
    db.add_token(PER, "usr_per")
    db.add_token(ADM, "usr_adm")
    note = notification_doc("c1", "task_assigned", "Görev", "sana", user_id="usr_mgr", roles=[])
    assert is_targeted_note(note)
    messages = _run(_sent(db, note))
    assert [m["to"] for m in messages] == [MGR]
    assert messages[0]["data"]["user_id"] == "usr_mgr"
    assert messages[0]["data"]["company_id"] == "c1"


def test_personal_employee_push_reaches_linked_user_only():
    db = _PushDB()
    db.add_user("usr_per", "personel", employee_id="emp_9")
    db.add_user("usr_adm", "admin")
    db.add_token(PER, "usr_per")
    db.add_token(ADM, "usr_adm")
    note = notification_doc("c1", "overtime_assigned", "Mesai", "sana", employee_id="emp_9")
    messages = _run(_sent(db, note))
    assert [m["to"] for m in messages] == [PER]
    assert messages[0]["data"]["user_id"] == "usr_per"
    assert messages[0]["data"]["company_id"] == "c1"


def test_rebound_token_follows_the_new_user_and_unregister_stops_push():
    db = _PushDB()
    db.add_user("usr_mgr", "manager")
    db.add_user("usr_per", "personel")
    _run(upsert_push_token(db, user_id="usr_mgr", company_id="c1", token=SHARED))
    _run(upsert_push_token(db, user_id="usr_per", company_id="c1", token=SHARED))
    row = _run(db.push_tokens.find_one({"token": SHARED}))
    assert row["user_id"] == "usr_per"
    assert row["company_id"] == "c1"
    assert len(db.push_tokens.docs) == 1
    assert _run(remove_push_token(db, SHARED, "usr_mgr")) == 0
    assert _run(db.push_tokens.find_one({"token": SHARED}))["user_id"] == "usr_per"

    _run(upsert_push_token(db, user_id="usr_mgr", company_id="c1", token=MGR))
    note = notification_doc("c1", "einvoice_incoming", "Gelen e-belge", "yönetici")
    messages = _run(_sent(db, note))
    assert SHARED not in {m["to"] for m in messages}
    assert MGR in {m["to"] for m in messages}
    mgr_msg = next(m for m in messages if m["to"] == MGR)
    assert mgr_msg["data"]["user_id"] == "usr_mgr"
    assert mgr_msg["data"]["company_id"] == "c1"

    assert _run(remove_push_token(db, SHARED, "usr_per")) == 1
    assert _run(db.push_tokens.find_one({"token": SHARED})) is None
    again = _run(_sent(db, note))
    assert SHARED not in {m["to"] for m in again}
    assert MGR in {m["to"] for m in again}


def test_replay_unread_uses_registering_user_id():
    db = _PushDB()
    user = db.add_user("usr_per", "personel")
    note = notification_doc("c1", "task_assigned", "Görev", "sana", user_id="usr_per", roles=[])
    db.notifications.docs[note["_id"]] = note
    captured = {}

    async def fake_send(messages):
        captured["messages"] = list(messages)
        return {"sent": len(messages), "tickets": [], "errors": 0}

    async def go():
        with patch.object(notify, "send_expo_push", fake_send):
            return await replay_unread_to_token(db, user=user, company_id="c1", token=PER)

    result = _run(go())
    assert result["sent"] == 1
    assert captured["messages"][0]["to"] == PER
    assert captured["messages"][0]["data"]["user_id"] == "usr_per"
    assert captured["messages"][0]["data"]["company_id"] == "c1"


AGAIN = "ExponentPushToken[sameDeviceNewTok1]"
FRESH = "ExponentPushToken[newDevicePhone0001]"


def _ok_tickets(messages):
    return {"sent": len(messages), "tickets": [{"status": "ok", "id": f"t{i}"} for i in range(len(messages))], "errors": 0}


def test_dispatch_stamps_device_and_replay_skips_same_device():
    """Başarılı push cihazı yazar. Aynı device_id yeniden kaydolunca o kayıt gitmez; yeni cihaz alır."""
    db = _PushDB()
    user = db.add_user("usr_mgr", "manager")
    db.add_user("usr_per", "personel")
    captured = {"batches": []}

    async def fake_send(messages):
        captured["batches"].append(list(messages))
        return _ok_tickets(messages)

    async def go():
        await upsert_push_token(
            db, user_id="usr_mgr", company_id="c1", token=MGR, device_id=" phone-a ",
        )
        await upsert_push_token(
            db, user_id="usr_per", company_id="c1", token=PER, device_id="phone-per",
        )
        pushed = notification_doc(
            "c1", "order_new", "Yeni sipariş", "WEB",
            link="/orders", ref_type="order", ref_id="ord-1",
        )
        hidden = {**notification_doc("c1", "order_new", "Okundu", "eski"), "is_read": True}
        db.notifications.docs[pushed["_id"]] = pushed
        db.notifications.docs[hidden["_id"]] = hidden
        with patch.object(notify, "send_expo_push", fake_send):
            await notify.dispatch_push(db, pushed)
            stored = await db.notifications.find_one({"_id": pushed["_id"]})
            assert stored["pushed_device_ids"] == ["phone-a"]
            assert stored["pushed_at"]
            missed = notification_doc("c1", "order_new", "Token yokken", "kaçan")
            db.notifications.docs[missed["_id"]] = missed
            await remove_push_token(db, MGR, "usr_mgr")
            again = await upsert_push_token(
                db, user_id="usr_mgr", company_id="c1", token=AGAIN, device_id="phone-a",
            )
            assert again["replay"] is True
            replay = await replay_unread_to_token(
                db, user=user, company_id="c1", token=AGAIN, device_id="phone-a",
            )
            fresh = await upsert_push_token(
                db, user_id="usr_mgr", company_id="c1", token=FRESH, device_id="phone-b",
            )
            assert fresh["replay"] is True
            replay_new = await replay_unread_to_token(
                db, user=user, company_id="c1", token=FRESH, device_id="phone-b",
            )
            return stored, replay, replay_new, missed["_id"]

    stored, replay, replay_new, missed_id = _run(go())
    assert stored["pushed_device_ids"] == ["phone-a"]
    assert replay["sent"] == 1
    same_device = captured["batches"][1]
    assert [m["data"]["notification_id"] for m in same_device] == [missed_id]
    assert same_device[0]["to"] == AGAIN
    assert same_device[0]["data"]["user_id"] == "usr_mgr"
    assert same_device[0]["data"]["company_id"] == "c1"
    assert PER not in {m["to"] for batch in captured["batches"] for m in batch}
    assert replay_new["sent"] == 2
    new_device = captured["batches"][2]
    assert {m["to"] for m in new_device} == {FRESH}
    assert {m["data"]["user_id"] for m in new_device} == {"usr_mgr"}
    assert {m["data"]["company_id"] for m in new_device} == {"c1"}
    titles = {m["title"] for m in new_device}
    assert titles == {"Yeni sipariş", "Token yokken"}
    assert "Okundu" not in titles
    reread = _run(db.notifications.find_one({"_id": stored["_id"]}))
    assert reread["pushed_device_ids"] == ["phone-a", "phone-b"]


def test_error_ticket_does_not_mark_device_pushed():
    db = _PushDB()
    user = db.add_user("usr_mgr", "manager")

    async def fake_send(messages):
        tickets = []
        for msg in messages:
            if msg["to"] == ACC:
                tickets.append({"status": "error", "details": {"error": "InvalidCredentials"}})
            else:
                tickets.append({"status": "ok", "id": "ok-1"})
        return {"sent": len(messages), "tickets": tickets, "errors": 1}

    async def go():
        await upsert_push_token(db, user_id="usr_mgr", company_id="c1", token=MGR, device_id="phone-ok")
        await upsert_push_token(db, user_id="usr_mgr", company_id="c1", token=ACC, device_id="phone-bad")
        note = notification_doc("c1", "order_new", "Yeni sipariş", "WEB")
        db.notifications.docs[note["_id"]] = note
        with patch.object(notify, "send_expo_push", fake_send):
            await notify.dispatch_push(db, note)
            stored = await db.notifications.find_one({"_id": note["_id"]})
            await remove_push_token(db, ACC, "usr_mgr")
            await upsert_push_token(db, user_id="usr_mgr", company_id="c1", token=FRESH, device_id="phone-bad")
            captured = {}

            async def replay_send(messages):
                captured["messages"] = list(messages)
                return _ok_tickets(messages)

            with patch.object(notify, "send_expo_push", replay_send):
                replay = await replay_unread_to_token(
                    db, user=user, company_id="c1", token=FRESH, device_id="phone-bad",
                )
        return stored, replay, captured

    stored, replay, captured = _run(go())
    assert stored["pushed_device_ids"] == ["phone-ok"]
    assert replay["sent"] == 1
    assert captured["messages"][0]["to"] == FRESH
    assert "phone-bad" not in stored["pushed_device_ids"]


def test_get_notifications_hides_push_device_stamp():
    """GET /notifications cihaz damgasını döndürmez; veritabanındaki belge durur."""
    import inspect

    import server

    db = _PushDB()
    user = db.add_user("usr_mgr", "manager")
    secret = "dev-secret-9f3a"
    stamped_at = "2026-10-20T12:00:00+00:00"
    note = notification_doc("c1", "order_new", "Yeni sipariş", "WEB", link="/orders", ref_type="order", ref_id="ord-9")
    note["pushed_device_ids"] = [secret]
    note["pushed_at"] = stamped_at
    db.notifications.docs[note["_id"]] = note
    assert "present_notification" in inspect.getsource(server.list_notifications)

    async def listed(unread_only=False):
        previous = server.db
        server.db = db
        try:
            return await server.list_notifications(user=user, unread_only=unread_only)
        finally:
            server.db = previous

    rows = _run(listed())
    unread = _run(listed(True))
    for payload in (rows, unread):
        assert len(payload) == 1
        row = payload[0]
        assert row["id"] == note["_id"]
        assert row["title"] == "Yeni sipariş"
        assert row["type"] == "order_new"
        assert row["company_id"] == "c1"
        assert row["message"] == "WEB"
        assert row["target"]["type"] == "order"
        assert "pushed_device_ids" not in row
        assert "pushed_at" not in row
        assert secret not in repr(row)
    stored = db.notifications.docs[note["_id"]]
    assert stored["pushed_device_ids"] == [secret]
    assert stored["pushed_at"] == stamped_at
    assert stored["_id"] == note["_id"]


def test_concurrent_stamps_keep_both_device_ids():
    db = _PushDB()
    note = notification_doc("c1", "order_new", "Yeni sipariş", "WEB")
    note["pushed_device_ids"] = ["phone-old"]
    db.notifications.docs[note["_id"]] = note
    left = dict(note)
    right = dict(note)
    left["pushed_device_ids"] = list(note["pushed_device_ids"])
    right["pushed_device_ids"] = list(note["pushed_device_ids"])

    async def go():
        await asyncio.gather(
            notify._stamp_pushed_devices(db, left, ["phone-a"]),
            notify._stamp_pushed_devices(db, right, ["phone-b"]),
        )
        return await db.notifications.find_one({"_id": note["_id"]})

    stored = _run(go())
    assert left["pushed_device_ids"] == ["phone-old", "phone-a"]
    assert right["pushed_device_ids"] == ["phone-old", "phone-b"]
    assert set(stored["pushed_device_ids"]) == {"phone-old", "phone-a", "phone-b"}
    assert stored["pushed_at"]


def _hours_ago(hours: float) -> str:
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()


def test_push_visible_ignores_admin_sees_all_shortcut():
    admin = {"_id": "usr_adm", "id": "usr_adm", "role": "admin"}
    super_admin = {"_id": "usr_root", "role": "sales", "is_super_admin": True}
    staff_admin = {"role": "admin", "id": "u1", "employee_id": "emp_1"}
    other = notification_doc(
        "c1", "attendance_checkout_reminder", "Çıkış hatırlatması", "19:00",
        user_id="usr_emp", employee_id="emp_1", roles=[],
    )
    own = notification_doc("c1", "task_assigned", "Görev", "sana", user_id="usr_adm", roles=[])
    bank = notification_doc("c1", "bank_sync", "Banka", "3 hareket")
    assert notification_visible(other, admin)
    assert notification_visible(other, super_admin)
    assert filter_notifications([other, own, bank], admin) == [other, own, bank]
    assert not push_visible(other, admin)
    assert not push_visible(other, super_admin)
    assert push_visible(own, admin)
    assert push_visible(bank, admin)
    assert push_visible(bank, staff_admin)
    assert not push_visible({"type": "order_pick_missing"}, staff_admin)
    assert not notify.replay_note_current(other)
    assert not notify.replay_note_current({**bank, "created_at": _hours_ago(3)})
    assert notify.replay_note_current(bank)


def test_admin_replay_skips_other_staff_and_stale_reminders():
    """Personel kartı olmayan yönetici, başkasının hatırlatmasını ve 2 saatten eski kaydı almaz."""
    db = _PushDB()
    admin = db.add_user("usr_adm", "admin")
    db.add_user("usr_emp", "personel", employee_id="emp_1")
    db.add_token(PER, "usr_emp")
    other = notification_doc(
        "c1", "attendance_checkout_reminder", "Çıkış hatırlatması", "19:00",
        user_id="usr_emp", employee_id="emp_1", roles=[],
    )
    foreign = notification_doc(
        "c1", "task_assigned", "Başkasının görevi", "personel",
        user_id="usr_emp", employee_id="emp_1", roles=[],
    )
    own = notification_doc("c1", "task_assigned", "Görev", "sana", user_id="usr_adm", roles=[])
    bank = notification_doc("c1", "bank_sync", "Banka", "3 hareket")
    stale = notification_doc("c1", "order_new", "Eski sipariş", "saatler önce")
    stale["created_at"] = _hours_ago(3)
    own_reminder = notification_doc(
        "c1", "attendance_checkin_reminder", "Giriş hatırlatması", "şimdi",
        user_id="usr_adm", roles=[],
    )
    for note in (other, foreign, own, bank, stale, own_reminder):
        db.notifications.docs[note["_id"]] = note

    async def go():
        saved = await upsert_push_token(
            db, user_id="usr_adm", company_id="c1", token=ADM, device_id="admin-phone",
        )
        batches = []

        async def fake_send(messages):
            batches.append(list(messages))
            return _ok_tickets(messages)

        with patch.object(notify, "send_expo_push", fake_send):
            live = await notify.dispatch_push(db, other)
            replay = await replay_unread_to_token(
                db, user=admin, company_id="c1", token=ADM, device_id="admin-phone",
            )
        return saved, live, replay, batches

    saved, live, replay, batches = _run(go())
    assert saved["replay"] is True
    assert live["sent"] == 1
    assert [m["to"] for m in batches[0]] == [PER]
    replayed = batches[1]
    assert {m["title"] for m in replayed} == {"Görev", "Banka"}
    assert {m["to"] for m in replayed} == {ADM}
    assert {m["data"]["user_id"] for m in replayed} == {"usr_adm"}
    assert replay["count"] == 2
    listed = filter_notifications(
        list(db.notifications.docs.values()), admin,
    )
    assert other["_id"] in {n["_id"] for n in listed}
    assert foreign["_id"] in {n["_id"] for n in listed}


def test_same_device_token_refresh_does_not_replay_again():
    db = _PushDB()
    user = db.add_user("usr_mgr", "manager")
    batches = []

    async def fake_send(messages):
        batches.append(list(messages))
        return _ok_tickets(messages)

    async def register(token, device):
        out = await upsert_push_token(
            db, user_id="usr_mgr", company_id="c1", token=token, device_id=device,
        )
        sent = 0
        if out.get("replay"):
            with patch.object(notify, "send_expo_push", fake_send):
                result = await replay_unread_to_token(
                    db, user=user, company_id="c1", token=token, device_id=device,
                )
                sent = int(result.get("sent") or 0)
        return out, sent

    async def go():
        first_note = notification_doc("c1", "order_new", "İlk", "sipariş")
        db.notifications.docs[first_note["_id"]] = first_note
        first = await register(MGR, "phone-a")
        missed = notification_doc("c1", "order_new", "Arada", "kaçan")
        db.notifications.docs[missed["_id"]] = missed
        second = await register(AGAIN, " phone-a ")
        third = await register(FRESH, "phone-b")
        row = await db.push_tokens.find_one({"token": AGAIN, "company_id": "c1"})
        original = await db.push_tokens.find_one({"token": MGR, "company_id": "c1"})
        return first, second, third, row, original

    first, second, third, row, original = _run(go())
    assert first[0]["replay"] is True and first[1] == 1
    assert second[0]["replay"] is False and second[1] == 0
    assert third[0]["replay"] is True and third[1] == 2
    assert row["device_id"] == "phone-a"
    assert row["replayed_at"] == original["replayed_at"]
    assert [len(batch) for batch in batches] == [1, 2]
    assert batches[0][0]["title"] == "İlk"
    assert {m["title"] for m in batches[1]} == {"İlk", "Arada"}
