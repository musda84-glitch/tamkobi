"""Banka, kasa, POS ve üretime gönderme: e-posta yalnız notify_outbox + ortak şablon."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

import attendance
import cash_approval
import event_notify
import notify
import order_pick
import pos_cashier as pc
import public_url
from test_event_notify import FakeColl, _admin_user, _db, _mail_patch, _ok_send

APP = "https://app.tamkobi.com"
NEW = (
    "bank_sync",
    "cash_approval",
    "pos_approval",
    "pos_daily_summary",
    "order_pick_production",
)


def _run(coro):
    return asyncio.run(coro)


def _req(company_id="c1"):
    req = type("R", (), {})()
    req.query_params = {"company_id": company_id}
    return req


def _prepare():
    db = _db()
    event_notify.init(db)
    return db


def _patched(send):
    return (
        _mail_patch(send),
        patch.object(public_url, "public_base_url_for", AsyncMock(return_value=APP)),
        patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})),
    )


class _Stack:
    def __init__(self, send):
        self.send = send
        self._cms = None

    def __enter__(self):
        from contextlib import ExitStack
        stack = ExitStack()
        for cm in _patched(self.send):
            stack.enter_context(cm)
        self._cms = stack
        return stack.__enter__()

    def __exit__(self, *exc):
        return self._cms.__exit__(*exc)


async def _email_on(event, *, digest="instant", cap=None, sms=False):
    body = {
        "events": {
            event: {"inapp": True, "email": True, "sms": sms, "digest": digest},
        },
    }
    if cap is not None:
        body["daily_email_cap"] = cap
    await event_notify.save_prefs("c1", body)


def _notes(db):
    return list(db.notifications.docs.values())


def _outbox(db):
    return list(db.notify_outbox.docs.values())


def test_new_event_defaults_keep_legacy_four():
    prefs = event_notify.default_prefs("c1")
    assert prefs["events"]["order_new"]["digest"] == "batch"
    assert prefs["events"]["einvoice_incoming"]["email"] is True
    assert prefs["events"]["einvoice_incoming"]["inapp"] is True
    for ev in NEW:
        ch = prefs["events"][ev]
        assert ch == {"inapp": True, "email": False, "sms": False, "digest": "instant"}
        assert event_notify.EVENT_LABELS[ev]
    assert set(event_notify.default_tenant("c1")["events"]) == set(event_notify.TENANT_EVENTS)
    for ev in event_notify.TENANT_EVENTS:
        assert event_notify.EVENT_DEFAULT_CHANNEL[ev] == event_notify.DEFAULT_CHANNEL


def test_missing_new_event_key_email_stays_off():
    db = _prepare()
    db.company_notify_prefs.docs["cnp_c1"] = {
        "_id": "cnp_c1",
        "company_id": "c1",
        "events": {
            "einvoice_incoming": {"inapp": True, "email": True, "sms": False, "digest": "instant"},
            "order_new": {"inapp": True, "email": False, "sms": True, "digest": "hourly"},
        },
        "extra_emails": ["keep@demo.com"],
    }

    async def _go():
        out = await event_notify.get_prefs("c1")
        presented = await event_notify.present_prefs(out)
        return out, presented

    out, presented = _run(_go())
    stored = db.company_notify_prefs.docs["cnp_c1"]["events"]
    assert "bank_sync" not in stored
    assert out["events"]["einvoice_incoming"]["email"] is True
    assert out["events"]["order_new"]["email"] is False
    assert out["events"]["order_new"]["sms"] is True
    assert out["events"]["order_new"]["digest"] == "hourly"
    for ev in NEW:
        assert out["events"][ev]["email"] is False
        assert out["events"][ev]["inapp"] is True
        assert presented["events"][ev]["email"] is False
        bare = event_notify.effective_channel({"events": stored}, None, ev)
        assert bare["email"] is False
        assert bare["inapp"] is True
    forced = event_notify.effective_channel(
        {"events": {"bank_sync": {"inapp": True, "email": True, "sms": False, "digest": "instant"}}},
        {"events": {"bank_sync": {"inapp": False, "email": False}}},
        "bank_sync",
    )
    assert forced["email"] is True
    assert forced["inapp"] is True


def test_tenant_get_four_put_new_event_422():
    db = _prepare()
    admin = _admin_user()

    async def _go():
        got = await event_notify.get_notify_tenant_prefs_route(_req(), company_id="c1", user=admin)
        with pytest.raises(HTTPException) as ei:
            await event_notify.put_notify_tenant_prefs_route(
                {"events": {"bank_sync": {"email": True}}}, _req(), admin,
            )
        return got, ei.value

    got, err = _run(_go())
    assert err.status_code == 422
    assert err.detail == event_notify.PLATFORM_ONLY_DETAIL
    assert set(got["events"]) == set(event_notify.TENANT_EVENTS)
    assert set(got["labels"]) == set(event_notify.TENANT_EVENTS)
    assert "bank_sync" not in got["events"]
    assert db.company_notify_tenant.docs == {}
    with pytest.raises(HTTPException) as direct:
        event_notify.parse_tenant_update({"events": {"order_pick_production": {"inapp": False}}})
    assert direct.value.status_code == 422


def test_queue_skips_legacy_and_closed_email_without_smtp():
    db = _prepare()
    send = AsyncMock(side_effect=_ok_send)

    async def _go():
        with _Stack(send):
            legacy = await event_notify.queue_event_email(
                "c1", "einvoice_incoming", "Belge", "mesaj", dedupe_key="einv:x",
            )
            closed = await event_notify.queue_event_email(
                "c1", "bank_sync", "1 yeni banka hareketi", "Vadesiz",
                link="/banking", dedupe_key="bank_sync:acc:tx1",
            )
            await _email_on("cash_approval", digest="hourly")
            hourly = await event_notify.queue_event_email(
                "c1", "cash_approval", "Kasa", "mesaj", link="/banking",
                dedupe_key="cash_approval:r1",
            )
            return legacy, closed, hourly

    legacy, closed, hourly = _run(_go())
    assert legacy == {"status": "skipped", "reason": "bad_args"}
    assert closed["status"] == "skipped"
    assert hourly["status"] == "queued"
    assert send.await_count == 0
    assert len(_outbox(db)) == 1
    row = _outbox(db)[0]
    assert row["event"] == "cash_approval"
    assert row["digest"] == "hourly"
    assert row["status"] == "pending"
    assert row["channels"] == {"email": True, "sms": False}
    due = datetime.fromisoformat(row["due_at"])
    assert due > datetime.now(timezone.utc)
    assert _notes(db) == []


def test_queue_instant_flushes_with_shared_layout_and_defers_on_cap():
    db = _prepare()
    send = AsyncMock(side_effect=_ok_send)

    async def _go():
        with _Stack(send):
            await _email_on("bank_sync")
            queued = await event_notify.queue_event_email(
                "c1", "bank_sync", "2 yeni banka hareketi", "Vadesiz: 2 yeni hareket",
                link="/banking?account_id=acc1", ref_type="bank_tx", ref_id="tx1",
                dedupe_key="bank_sync:acc1:tx1",
            )
            assert send.await_count == 0
            again = await event_notify.queue_event_email(
                "c1", "bank_sync", "2 yeni banka hareketi", "Vadesiz",
                dedupe_key="bank_sync:acc1:tx1",
            )
            await event_notify.flush_notify_outbox()
            await _email_on("pos_approval", cap=0)
            capped = await event_notify.queue_event_email(
                "c1", "pos_approval", "POS onay bekliyor", "Ayşe",
                link="/hizli-satis?onay=p1", dedupe_key="pos_approval:p1",
            )
            await event_notify.flush_notify_outbox()
            return queued, again, capped

    queued, again, capped = _run(_go())
    assert queued["status"] == "queued"
    assert again["status"] == "duplicate"
    assert capped["status"] == "queued"
    assert send.await_count == 1
    call = send.await_args_list[0]
    html = call.kwargs["html"]
    assert "tk-card" in html and "tk-bar" in html
    assert "Banka hareketi (senkron)" in html
    assert "Uygulamada aç" in html
    assert f"{APP}/banking?account_id=acc1" in html
    sent = [r for r in _outbox(db) if r["event"] == "bank_sync"]
    deferred = [r for r in _outbox(db) if r["event"] == "pos_approval"]
    assert sent[0]["status"] == "sent"
    assert deferred[0]["status"] == "deferred"
    assert _notes(db) == []


def test_queue_swallows_errors():
    db = _prepare()

    async def _boom(*_a, **_k):
        raise RuntimeError("db down")

    async def _go():
        with patch.object(event_notify, "_dedupe_seen", _boom):
            return await event_notify.queue_event_email(
                "c1", "pos_daily_summary", "özet", "mesaj", dedupe_key="pos_daily_summary:2026-10-16",
            )

    assert _run(_go()) == {"status": "error"}
    assert _outbox(db) == []


def _enable_cols(db, *names):
    for name in names:
        setattr(db, name, FakeColl([]))
    return db


def test_bank_sync_inapp_same_email_queued_not_sent():
    import server

    db = _prepare()
    _enable_cols(db, "bank_connections", "bank_accounts", "bank_transactions", "contacts", "bank_match_rules")
    db.bank_connections.docs["conn1"] = {
        "_id": "conn1", "company_id": "c1", "linked_account_id": "acc1",
        "provider": "generic", "bank_account_number": "TR330006100519786457841326",
        "auto_match": False,
    }
    db.bank_accounts.docs["acc1"] = {
        "_id": "acc1", "company_id": "c1", "account_name": "Vadesiz", "current_balance": 0,
    }
    prev_db = server.db
    server.db = db
    send = AsyncMock(side_effect=_ok_send)

    async def _fetch(_conn, _since):
        return {
            "simulated": True,
            "balance": None,
            "transactions": [{
                "external_id": "ext-1", "direction": "credit", "amount": 10,
                "currency": "TRY", "description": "EFT", "counterparty": "ACME",
                "date": "2026-10-16", "is_simulated": True,
            }],
        }

    async def _go():
        with _Stack(send), patch("bank_providers.fetch_transactions", _fetch):
            await _email_on("bank_sync")
            out = await server._sync_bank_connection_core("conn1")
            assert send.await_count == 0
            note = _notes(db)[0]
            movement = notify.bank_movement_target(
                account_id="acc1", tx_id=note["ref_id"], account_name="Vadesiz", pending=True,
            )
            expected = notify.notification_doc(
                "c1", "bank_sync", note["title"], note["message"],
                link=movement["route"], ref_type=movement["type"], ref_id=movement["id"],
                target=movement,
            )
            assert out["status"] == "success" and out["inserted"] == 1
            assert note["type"] == expected["type"] == "bank_sync"
            assert note["roles"] == expected["roles"]
            assert note["link"] == expected["link"]
            assert note["target"] == expected["target"]
            assert note["ref_type"] == expected["ref_type"]
            assert note["ref_id"] == expected["ref_id"]
            key = f"bank_sync:acc1:{note['ref_id']}"
            assert any(d.get("dedupe_key") == key for d in db.notify_event_dedupe.docs.values())
            assert len(_outbox(db)) == 1
            assert _outbox(db)[0]["event"] == "bank_sync"
            dup = await event_notify.queue_event_email(
                "c1", "bank_sync", note["title"], note["message"], dedupe_key=key,
            )
            assert dup["status"] == "duplicate"
            assert len(_outbox(db)) == 1
            await event_notify.flush_notify_outbox()
            return out

    try:
        _run(_go())
    finally:
        server.db = prev_db
    assert send.await_count == 1
    assert "tk-card" in send.await_args.kwargs["html"]


def test_bank_sync_survives_queue_error_and_default_skips_mail():
    import server

    db = _prepare()
    _enable_cols(db, "bank_connections", "bank_accounts", "bank_transactions", "contacts", "bank_match_rules")
    db.bank_connections.docs["conn1"] = {
        "_id": "conn1", "company_id": "c1", "linked_account_id": "acc1",
        "provider": "generic", "auto_match": False,
    }
    db.bank_accounts.docs["acc1"] = {
        "_id": "acc1", "company_id": "c1", "account_name": "Vadesiz", "current_balance": 0,
    }
    prev_db = server.db
    server.db = db

    async def _fetch(_conn, _since):
        return {
            "simulated": True, "balance": None,
            "transactions": [{
                "external_id": "ext-2", "direction": "credit", "amount": 5,
                "currency": "TRY", "description": "EFT", "date": "2026-10-16",
            }],
        }

    async def _go():
        with patch("bank_providers.fetch_transactions", _fetch), \
             patch("event_notify.queue_event_email", AsyncMock(side_effect=RuntimeError("boom"))):
            out = await server._sync_bank_connection_core("conn1")
        return out

    try:
        out = _run(_go())
    finally:
        server.db = prev_db
    assert out["status"] == "success" and out["inserted"] == 1
    assert _notes(db)[0]["type"] == "bank_sync"
    assert _outbox(db) == []


def test_cash_approval_queues_email_and_survives_errors():
    db = _prepare()
    _enable_cols(db, "cash_approval_requests", "bank_connections")
    send = AsyncMock(side_effect=_ok_send)
    user = {"_id": "u1", "name": "Ali", "email": "ali@demo.com"}

    async def _go():
        with _Stack(send):
            await _email_on("cash_approval")
            first = await cash_approval.queue(
                db, company_id="c1", kind="virman", payload={}, account_ids=[],
                summary="100 ₺", user=user,
            )
            assert send.await_count == 0
            note = _notes(db)[0]
            assert note["type"] == "cash_approval"
            assert note["title"] == "Kasa/banka işlemi onay bekliyor"
            assert note["message"] == "Ali: 100 ₺. Diğer yöneticinin onayı gerekli."
            assert note["link"] == "/banking"
            assert note["ref_type"] == "cash_approval"
            assert note["ref_id"] == first["request_id"]
            assert note["roles"] == notify.roles_for_type("cash_approval")
            assert note["target"]["type"] == "cash_approval"
            assert note["target"]["route"] == "/banking"
            assert len(_outbox(db)) == 1
            dup = await event_notify.queue_event_email(
                "c1", "cash_approval", note["title"], note["message"],
                dedupe_key=f"cash_approval:{first['request_id']}",
            )
            assert dup["status"] == "duplicate"
            assert len(_outbox(db)) == 1
            with patch("event_notify.queue_event_email", AsyncMock(side_effect=RuntimeError("boom"))):
                second = await cash_approval.queue(
                    db, company_id="c1", kind="virman", payload={}, account_ids=[],
                    summary="50 ₺", user=user,
                )
            assert second["status"] == "pending_approval"
            return first

    first = _run(_go())
    assert first["status"] == "pending_approval"
    assert db.cash_approval_requests.docs[first["request_id"]]["status"] == "pending"
    assert send.await_count == 0


def test_pos_approval_and_daily_summary_queue_without_smtp():
    db = _prepare()
    _enable_cols(db, "pos_events", "activity_logs", "pos_approvals")
    prev = pc._db
    pc._db = db
    send = AsyncMock(side_effect=_ok_send)
    req = {
        "_id": "ap1", "kind": "cancel_cart", "summary": "Sepet iptali",
        "requested_by_name": "Ayşe",
    }

    async def _go():
        with _Stack(send):
            await _email_on("pos_approval")
            await pc._notify_approval("c1", req)
            assert send.await_count == 0
            note = next(n for n in _notes(db) if n["type"] == "pos_approval")
            assert note["title"] == "POS onay bekliyor"
            assert note["roles"] == ["admin", "manager"]
            assert note["link"] == "/hizli-satis?onay=ap1"
            assert note["ref_type"] == "pos_approval"
            assert note["ref_id"] == "ap1"
            assert note["target"]["route"] == "/hizli-satis?onay=ap1"
            assert note.get("kind") == "cancel_cart"
            assert len(_outbox(db)) == 1
            dup = await event_notify.queue_event_email(
                "c1", "pos_approval", note["title"], note["message"],
                dedupe_key="pos_approval:ap1",
            )
            assert dup["status"] == "duplicate"
            await _email_on("pos_daily_summary")
            db.pos_events.docs["e1"] = {
                "_id": "e1", "company_id": "c1", "kind": "refund", "amount": 12,
                "created_at": datetime.now(timezone.utc).isoformat(),
            }
            first = await pc.send_daily_summary("c1", force=True)
            second = await pc.send_daily_summary("c1", force=True)
            assert first["status"] == "sent" and second["status"] == "sent"
            daily = [n for n in _notes(db) if n["type"] == "pos_daily_summary"]
            assert daily
            assert daily[0]["roles"] == ["admin", "manager"]
            assert daily[0]["link"] == "/settings?tab=pos_rules"
            assert daily[0]["ref_type"] == "pos_daily_summary"
            rows = [r for r in _outbox(db) if r["event"] == "pos_daily_summary"]
            assert len(rows) == 1
            assert send.await_count == 0
            with patch("event_notify.queue_event_email", AsyncMock(side_effect=RuntimeError("boom"))):
                queued = await pc.queue_approval(
                    company_id="c1",
                    session={"_id": "s1", "terminal_id": "t1", "cashier_name": "Ayşe", "cashier_user_id": "u1", "cart": {}},
                    kind="cancel_cart", payload={}, summary="Sepet", user={"_id": "u1", "name": "Ayşe"},
                )
            assert queued["status"] == "pending_approval"
            boom = await pc.send_daily_summary("c1", force=True)
            assert boom["status"] == "sent"

    try:
        _run(_go())
    finally:
        pc._db = prev


def test_order_pick_production_skips_smtp_and_keeps_inapp_target():
    db = _prepare()
    _enable_cols(db, "orders", "order_pick_sessions", "products")
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
    prev_smtp, prev_mail = attendance._smtp_send_fn, attendance._mail_account_fn
    smtp = AsyncMock()
    attendance._smtp_send_fn = smtp
    attendance._mail_account_fn = AsyncMock(return_value={"email": "firma@demo.com"})
    created = AsyncMock(return_value={"order_code": "UE-1"})
    order_pick.init(db, {"create_production_order": created})
    send = AsyncMock(side_effect=_ok_send)
    user = {"_id": "u1", "name": "Depo", "role": "admin", "company_ids": ["c1"], "active_company_id": "c1"}

    async def _doc(_db, _coll, oid, _user, not_found=""):
        found = await db.orders.find_one({"_id": oid})
        if not found:
            raise HTTPException(status_code=404, detail=not_found)
        return found

    async def _go():
        with _Stack(send), \
             patch.object(order_pick.tenant_access, "get_tenant_doc", _doc), \
             patch.object(attendance, "notify_managers", AsyncMock()) as managers:
            await _email_on("order_pick_production")
            out = await order_pick.send_missing_to_production("ord1", user)
            assert out["status"] == "ok"
            assert created.await_count == 1
            assert managers.await_count == 0
            assert smtp.await_count == 0
            assert send.await_count == 0
            note = _notes(db)[0]
            assert note["type"] == "order_pick_production"
            assert note["title"] == "Üretime alındı: SP-1"
            assert note["link"] == "/production?tab=orders"
            assert note["roles"] == notify.roles_for_type("order_pick_production")
            assert note["ref_type"] == "order_pick"
            assert note["ref_id"] == "ord1"
            assert note["target"] == {"type": "order", "id": "", "route": "/production?tab=orders"}
            assert len(_outbox(db)) == 1
            key = "order_pick_production:ord1:1"
            assert any(d.get("dedupe_key") == key for d in db.notify_event_dedupe.docs.values())
            dup = await event_notify.queue_event_email(
                "c1", "order_pick_production", note["title"], note["message"], dedupe_key=key,
            )
            assert dup["status"] == "duplicate"
            assert len(_outbox(db)) == 1
            with patch("event_notify.queue_event_email", AsyncMock(side_effect=RuntimeError("boom"))):
                db.order_pick_sessions.docs["ses1"]["production_orders"] = []
                db.order_pick_sessions.docs["ses1"]["items"][0]["picked_qty"] = 0
                again = await order_pick.send_missing_to_production("ord1", user)
            assert again["status"] == "ok"
            assert again["created"]
            assert smtp.await_count == 0
            return out

    try:
        _run(_go())
    finally:
        attendance._smtp_send_fn = prev_smtp
        attendance._mail_account_fn = prev_mail
    assert smtp.await_count == 0
