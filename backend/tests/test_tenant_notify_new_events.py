"""Firma bildirimleri: yeni olaylar aç/kapa, kilit ve uygulama içi kapı.

TestClient + bellek içi veritabanı. Canlı sunucu, 8021, MySQL ve tamkobi_p0 yok.
SMTP mock'lanır; sunucu doğrudan mail atmaz.
"""
from __future__ import annotations

import asyncio
from datetime import datetime
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

import attendance
import cash_approval
import event_notify
import notify
import order_pick
import pos_cashier as pc
from test_event_notify import FakeColl, _admin_user, _db, _ok_send, _sales_user
from test_notify_queue_events import _enable_cols

LEGACY = (
    "einvoice_incoming",
    "order_new",
    "gib_credits_low",
    "receivable_overdue",
)
APPROVAL = (
    "cash_approval",
    "pos_approval",
    "leave_request",
    "advance_request",
    "overtime_request",
)


def _run(coro):
    return asyncio.run(coro)


def _other_user():
    return {
        "_id": "u_other", "id": "u_other", "name": "Diğer",
        "company_ids": ["c2"], "active_company_id": "c2", "role": "admin",
    }


def _users():
    return {"admin": _admin_user(), "sales": _sales_user(), "other": _other_user()}


async def _auth(request: Request) -> dict:
    token = (request.headers.get("authorization") or "").removeprefix("Bearer ").strip()
    user = _users().get(token)
    if not user:
        raise HTTPException(status_code=401, detail="Giriş yapmanız gerekiyor.")
    return user


def _prepare():
    db = _db()
    event_notify.init(db, get_current_user=_auth)
    return db


def _client(db):
    event_notify.init(db, get_current_user=_auth)
    app = FastAPI()
    app.include_router(event_notify.router)
    return TestClient(app)


def _h(token):
    return {"Authorization": f"Bearer {token}"}


def _notes(db):
    return list(db.notifications.docs.values())


def _outbox(db):
    return list(db.notify_outbox.docs.values())


def test_tenant_prefs_auth_matrix():
    db = _prepare()
    client = _client(db)
    for method, kwargs in (
        ("get", {"params": {"company_id": "c1"}}),
        ("put", {"params": {"company_id": "c1"}, "json": {"events": {"order_new": {"email": False}}}}),
    ):
        res = getattr(client, method)("/api/notify/tenant-prefs", **kwargs)
        assert res.status_code == 401, res.text

    foreign_get = client.get("/api/notify/tenant-prefs", params={"company_id": "c2"}, headers=_h("admin"))
    assert foreign_get.status_code == 403
    foreign_put = client.put(
        "/api/notify/tenant-prefs",
        json={"company_id": "c2", "events": {"order_new": {"email": False}}},
        headers=_h("admin"),
    )
    assert foreign_put.status_code == 403

    denied = client.put(
        "/api/notify/tenant-prefs",
        params={"company_id": "c1"},
        json={"events": {"order_new": {"email": False}}},
        headers=_h("sales"),
    )
    assert denied.status_code == 403
    assert db.company_notify_tenant.docs == {}

    readable = client.get("/api/notify/tenant-prefs", params={"company_id": "c1"}, headers=_h("sales"))
    assert readable.status_code == 200


def test_default_view_keeps_legacy_four_and_locks_new_email():
    db = _prepare()
    client = _client(db)
    res = client.get("/api/notify/tenant-prefs", params={"company_id": "c1"}, headers=_h("admin"))
    assert res.status_code == 200, res.text
    body = res.json()
    assert set(body) == {"events", "labels"}
    assert set(body["events"]) == set(event_notify.FIRM_EVENTS)
    assert db.company_notify_tenant.docs == {}
    assert db.company_notify_prefs.docs == {}
    for ev in LEGACY:
        row = body["events"][ev]
        assert row["group"] == "sales_invoice"
        assert body["labels"][ev] == event_notify.EVENT_LABELS[ev]
        for field in ("inapp", "email"):
            ch = row[field]
            assert ch["platform"] is True
            assert ch["tenant"] is True
            assert ch["effective"] is True
            assert ch["locked"] is False
            assert ch["lock_reason"] is None
    for ev in event_notify.NEW_EVENTS:
        row = body["events"][ev]
        assert row["group"] == event_notify.EVENT_GROUPS[ev]
        assert body["labels"][ev] == event_notify.EVENT_LABELS[ev]
        email = row["email"]
        assert email["platform"] is False
        assert email["tenant"] is True
        assert email["effective"] is False
        assert email["locked"] is True
        assert email["lock_reason"] == "platform"
        inapp = row["inapp"]
        assert inapp["platform"] is True
        assert inapp["tenant"] is True
        assert inapp["effective"] is True
        if ev in APPROVAL:
            assert inapp["locked"] is True
            assert inapp["lock_reason"] == "approval"
        else:
            assert inapp["locked"] is False
            assert inapp["lock_reason"] is None
    assert event_notify._platform_flag({}, "email", "bank_sync") is False
    assert event_notify._platform_flag({}, "email", "einvoice_incoming") is True
    assert event_notify._platform_flag({}, "inapp", "attendance_alert") is True


def test_put_rejects_closed_platform_approval_inapp_and_foreign_fields():
    db = _prepare()
    client = _client(db)

    def put(events, **extra):
        body = {"events": events, **extra}
        return client.put("/api/notify/tenant-prefs", params={"company_id": "c1"}, json=body, headers=_h("admin"))

    closed = put({"bank_sync": {"email": True}})
    assert closed.status_code == 422
    assert closed.json()["detail"] == event_notify.PLATFORM_CLOSED_DETAIL

    approval = put({"leave_request": {"inapp": False}})
    assert approval.status_code == 422
    assert approval.json()["detail"] == event_notify.APPROVAL_INAPP_DETAIL
    for ev in APPROVAL:
        res = put({ev: {"inapp": False}})
        assert res.status_code == 422
        assert res.json()["detail"] == event_notify.APPROVAL_INAPP_DETAIL

    unknown = put({"pos_approval_decision": {"email": False}})
    assert unknown.status_code == 422
    assert unknown.json()["detail"] == event_notify.PLATFORM_ONLY_DETAIL

    for events in (
        {"bank_sync": {"sms": False}},
        {"order_new": {"digest": "hourly"}},
        {"order_new": {"quiet_hours": {"enabled": True, "start": "22:00", "end": "08:00"}}},
    ):
        res = put(events)
        assert res.status_code == 422
        assert res.json()["detail"] == event_notify.PLATFORM_ONLY_DETAIL
    extra = client.put(
        "/api/notify/tenant-prefs",
        params={"company_id": "c1"},
        json={"extra_emails": ["a@b.com"]},
        headers=_h("admin"),
    )
    assert extra.status_code == 422
    assert extra.json()["detail"] == event_notify.PLATFORM_ONLY_DETAIL
    assert db.company_notify_tenant.docs == {}

    allowed_false = put({"bank_sync": {"email": False}})
    assert allowed_false.status_code == 200, allowed_false.text
    assert allowed_false.json()["events"]["bank_sync"]["email"]["tenant"] is False
    assert allowed_false.json()["events"]["bank_sync"]["email"]["effective"] is False

    approval_email = put({"cash_approval": {"email": False}})
    assert approval_email.status_code == 200, approval_email.text
    assert approval_email.json()["events"]["cash_approval"]["email"]["tenant"] is False
    assert approval_email.json()["events"]["cash_approval"]["inapp"]["tenant"] is True
    assert approval_email.json()["events"]["cash_approval"]["inapp"]["locked"] is True


def test_firm_email_flag_gates_outbox_and_smtp_stays_idle():
    db = _prepare()
    client = _client(db)
    send = AsyncMock(side_effect=_ok_send)

    async def _open_platform():
        await event_notify.save_prefs("c1", {
            "events": {"bank_sync": {"inapp": True, "email": True, "sms": False, "digest": "instant"}},
        })

    _run(_open_platform())
    closed = client.put(
        "/api/notify/tenant-prefs",
        params={"company_id": "c1"},
        json={"events": {"bank_sync": {"email": False}}},
        headers=_h("admin"),
    )
    assert closed.status_code == 200, closed.text

    async def _queue(key):
        with patch.object(event_notify.mail_service, "send_mail", send):
            return await event_notify.queue_event_email(
                "c1", "bank_sync", "1 yeni banka hareketi", "Vadesiz",
                link="/banking", dedupe_key=key,
            )

    skipped = _run(_queue("bank_sync:off"))
    assert skipped["status"] == "skipped"
    assert _outbox(db) == []
    assert send.await_count == 0

    opened = client.put(
        "/api/notify/tenant-prefs",
        params={"company_id": "c1"},
        json={"events": {"bank_sync": {"email": True}}},
        headers=_h("admin"),
    )
    assert opened.status_code == 200, opened.text
    assert opened.json()["events"]["bank_sync"]["email"]["effective"] is True
    queued = _run(_queue("bank_sync:on"))
    assert queued["status"] == "queued"
    assert len(_outbox(db)) == 1
    assert _outbox(db)[0]["event"] == "bank_sync"
    assert _outbox(db)[0]["status"] == "pending"
    assert send.await_count == 0
    audits = list(db.company_audit_log.docs.values())
    assert audits
    joined = " ".join(a.get("summary") or "" for a in audits)
    assert "Banka hareketi" in joined


def test_no_firm_record_matches_today_for_every_event():
    prefs = event_notify.default_prefs("c1")
    legacy_only = {"events": {ev: {"inapp": True, "email": True} for ev in event_notify.TENANT_EVENTS}}
    tenants = (None, {}, {"events": {}}, event_notify.default_tenant("c1"), legacy_only)
    for ev in event_notify.FIRM_EVENTS:
        email_default = bool(event_notify._event_channel_default(ev)["email"])
        for tenant in tenants:
            ch = event_notify.effective_channel(prefs, tenant, ev)
            assert ch["inapp"] is True
            assert ch["email"] is email_default
            assert ch["sms"] is False
    bare = event_notify.effective_channel(prefs, None, "order_new")
    assert bare["digest"] == "batch"
    assert bare["email"] is True
    closed_legacy = event_notify.effective_channel(
        prefs, {"events": {"order_new": {"email": False}}}, "order_new",
    )
    assert closed_legacy["email"] is False
    assert closed_legacy["inapp"] is True
    opened = {
        "events": {"bank_sync": {"inapp": True, "email": True, "sms": True, "digest": "hourly"}},
    }
    for tenant in (None, event_notify.default_tenant("c1"), legacy_only):
        ch = event_notify.effective_channel(opened, tenant, "bank_sync")
        assert ch["email"] is True
        assert ch["inapp"] is True
        assert ch["sms"] is True
        assert ch["digest"] == "hourly"


def test_inapp_gate_skips_info_events_and_keeps_approvals():
    db = _prepare()
    db.attendance_alerts = FakeColl([])
    _enable_cols(db, "pos_events", "activity_logs", "cash_approval_requests")
    prev_att = attendance._db
    prev_pos = pc._db
    attendance._db = db
    pc._db = db
    push = AsyncMock(return_value={"sent": 0})

    async def _go():
        await event_notify.save_prefs("c1", {
            "events": {
                ev: {"inapp": True, "email": True, "sms": False, "digest": "instant"}
                for ev in ("bank_sync", "attendance_alert", "pos_daily_summary", "order_pick_production", "cash_approval", "leave_request")
            },
        })
        await event_notify.save_tenant_prefs("c1", {
            "bank_sync": {"inapp": False},
            "attendance_alert": {"inapp": False},
            "pos_daily_summary": {"inapp": False},
            "order_pick_production": {"inapp": False},
            "cash_approval": {"inapp": False},
            "leave_request": {"inapp": False},
        }, _admin_user())
        assert await event_notify.inapp_enabled("c1", "bank_sync") is False
        assert await event_notify.inapp_enabled("c1", "attendance_alert") is False
        with patch.object(notify, "dispatch_push", push):
            late = await attendance.notify_managers(
                "c1", "attendance_late", "Geç giriş", "Ali",
            )
            leave = await attendance.notify_managers(
                "c1", "leave_request", "İzin talebi: Ali", "3 gün.",
            )
            await pc.send_daily_summary("c1", force=True)
            await cash_approval.queue(
                db, company_id="c1", kind="virman", payload={}, account_ids=[],
                summary="100 ₺", user={"_id": "u1", "name": "Ali", "email": "ali@demo.com"},
            )
        return late, leave

    try:
        late, leave = _run(_go())
    finally:
        attendance._db = prev_att
        pc._db = prev_pos

    assert late["mail"]["status"] == "queued"
    assert leave["status"] == "sent"
    types = [n.get("type") for n in _notes(db)]
    assert "attendance_late" not in types
    assert "pos_daily_summary" not in types
    assert "leave_request" in types
    assert "cash_approval" in types
    assert push.await_count == 2
    events = {row["event"] for row in _outbox(db)}
    assert "attendance_alert" in events
    assert "pos_daily_summary" in events


def test_bank_sync_and_production_skip_inapp_when_firm_closes():
    import server

    db = _prepare()
    event_notify.init(db, get_current_user=_auth)
    _enable_cols(db, "bank_connections", "bank_accounts", "bank_transactions", "contacts", "bank_match_rules")
    _enable_cols(db, "orders", "order_pick_sessions", "products")
    db.bank_connections.docs["conn1"] = {
        "_id": "conn1", "company_id": "c1", "linked_account_id": "acc1",
        "provider": "generic", "auto_match": False,
    }
    db.bank_accounts.docs["acc1"] = {
        "_id": "acc1", "company_id": "c1", "account_name": "Vadesiz", "current_balance": 0,
    }
    db.orders.docs["ord1"] = {
        "_id": "ord1", "company_id": "c1", "order_number": "SP-1",
        "order_status": "approved", "items": [],
    }
    db.order_pick_sessions.docs["ses1"] = {
        "_id": "ses1", "company_id": "c1", "order_id": "ord1", "status": "open",
        "items": [{
            "product_id": "p1", "product_name": "Kalem",
            "ordered_qty": 2, "picked_qty": 0,
        }],
        "production_orders": [],
    }
    db.products.docs["p1"] = {"_id": "p1", "company_id": "c1", "name": "Kalem"}
    prev_db = server.db
    server.db = db
    order_pick.init(db, {"create_production_order": AsyncMock(return_value={"order_code": "UE-1"})})
    send = AsyncMock(side_effect=_ok_send)
    push = AsyncMock(return_value={"sent": 0})
    user = {"_id": "u1", "name": "Depo", "role": "admin", "company_ids": ["c1"], "active_company_id": "c1"}

    async def _doc(_db, _coll, oid, _user, not_found=""):
        found = await db.orders.find_one({"_id": oid})
        if not found:
            raise HTTPException(status_code=404, detail=not_found)
        return found

    async def _fetch(_conn, _since):
        return {
            "simulated": True, "balance": None,
            "transactions": [{
                "external_id": "ext-9", "direction": "credit", "amount": 10,
                "currency": "TRY", "description": "EFT", "date": "2026-10-16",
            }],
        }

    async def _go():
        await event_notify.save_prefs("c1", {
            "events": {
                "bank_sync": {"inapp": True, "email": True, "sms": False, "digest": "instant"},
                "order_pick_production": {"inapp": True, "email": True, "sms": False, "digest": "instant"},
            },
        })
        await event_notify.save_tenant_prefs("c1", {
            "bank_sync": {"inapp": False, "email": True},
            "order_pick_production": {"inapp": False, "email": True},
        }, _admin_user())
        with patch.object(notify, "dispatch_push", push), \
             patch.object(event_notify.mail_service, "send_mail", send), \
             patch("bank_providers.fetch_transactions", _fetch), \
             patch.object(order_pick.tenant_access, "get_tenant_doc", _doc):
            sync = await server._sync_bank_connection_core("conn1")
            produced = await order_pick.send_missing_to_production("ord1", user)
            return sync, produced

    try:
        sync, produced = _run(_go())
    finally:
        server.db = prev_db

    assert sync["inserted"] == 1
    assert produced["status"] == "ok"
    assert produced["created"]
    types = [n.get("type") for n in _notes(db)]
    assert "bank_sync" not in types
    assert "order_pick_production" not in types
    assert push.await_count == 0
    assert send.await_count == 0
    events = {row["event"] for row in _outbox(db)}
    assert events == {"bank_sync", "order_pick_production"}


def test_inapp_enabled_fails_open():
    db = _prepare()
    prev = attendance._db
    attendance._db = db
    db.attendance_alerts = FakeColl([])

    async def _boom(*_a, **_k):
        raise RuntimeError("db down")

    async def _go():
        with patch.object(event_notify, "get_prefs", _boom), \
             patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})):
            assert await event_notify.inapp_enabled("c1", "bank_sync") is True
            return await attendance.notify_managers(
                "c1", "attendance_missing", "Giriş yok", "Ali",
            )

    try:
        res = _run(_go())
    finally:
        attendance._db = prev
    assert res["status"] == "sent"
    assert [n.get("type") for n in _notes(db)] == ["attendance_missing"]


def test_queue_still_uses_effective_channel_without_direct_smtp():
    db = _prepare()
    send = AsyncMock(side_effect=_ok_send)

    async def _go():
        with patch.object(event_notify.mail_service, "send_mail", send):
            await event_notify.save_prefs("c1", {
                "events": {"pos_approval": {"inapp": True, "email": True, "sms": False, "digest": "instant"}},
            })
            await event_notify.save_tenant_prefs(
                "c1", {"pos_approval": {"email": False}}, _admin_user(),
            )
            closed = await event_notify.queue_event_email(
                "c1", "pos_approval", "POS onay bekliyor", "Ayşe",
                dedupe_key="pos_approval:closed",
            )
            await event_notify.save_tenant_prefs(
                "c1", {"pos_approval": {"email": True}}, _admin_user(),
            )
            opened = await event_notify.queue_event_email(
                "c1", "pos_approval", "POS onay bekliyor", "Ayşe",
                dedupe_key="pos_approval:open",
            )
            return closed, opened

    closed, opened = _run(_go())
    assert closed["status"] == "skipped"
    assert opened["status"] == "queued"
    assert send.await_count == 0
    assert len(_outbox(db)) == 1
    assert datetime.fromisoformat(_outbox(db)[0]["created_at"])
