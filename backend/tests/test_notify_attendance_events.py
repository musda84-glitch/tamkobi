"""Personel/mesai yönetici bildirimleri: e-posta yalnız notify_outbox + ortak şablon."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

import attendance
import event_notify
import notify
from test_event_notify import FakeColl
from test_notify_queue_events import _Stack, _notes, _outbox, _prepare, _run

STAFF_EVENTS = (
    "attendance_alert",
    "leave_request",
    "advance_request",
    "overtime_request",
)
TYPE_EVENT = {
    "attendance_late": "attendance_alert",
    "attendance_missing": "attendance_alert",
    "attendance_habit": "attendance_alert",
    "geo_confirm_request": "attendance_alert",
    "location_exit": "attendance_alert",
    "task_site_presence": "attendance_alert",
    "location_unavailable": "attendance_alert",
    "leave_request": "leave_request",
    "early_leave_request": "leave_request",
    "intraday_leave_request": "leave_request",
    "advance_request": "advance_request",
    "overtime_confirm": "overtime_request",
    "yevmiye_adjustment": "overtime_request",
}
LEGACY_TENANT = (
    "einvoice_incoming",
    "order_new",
    "gib_credits_low",
    "receivable_overdue",
)


def _bind(db):
    db.attendance_alerts = FakeColl([])
    prev = (attendance._db, attendance._smtp_send_fn, attendance._mail_account_fn)
    attendance._db = db
    smtp = AsyncMock()
    mail_account = AsyncMock(return_value={"email": "firma@demo.com"})
    attendance._smtp_send_fn = smtp
    attendance._mail_account_fn = mail_account
    return smtp, mail_account, prev


def _restore(prev):
    attendance._db, attendance._smtp_send_fn, attendance._mail_account_fn = prev


async def _email_on(*events, cap=None):
    body = {
        "events": {
            ev: {"inapp": True, "email": True, "sms": False, "digest": "instant"}
            for ev in events
        },
    }
    if cap is not None:
        body["daily_email_cap"] = cap
    await event_notify.save_prefs("c1", body)


def test_notify_managers_skips_smtp_and_keeps_roles():
    db = _prepare()
    smtp, mail_account, prev = _bind(db)
    send = AsyncMock()

    async def _go():
        with _Stack(send):
            res = await attendance.notify_managers(
                "c1", "leave_request", "İzin talebi: Ayşe", "3 gün izin.",
                link="/personnel?tab=leaves",
            )
            return res

    try:
        res = _run(_go())
    finally:
        _restore(prev)
    assert res["status"] == "sent"
    assert res["mail"]["status"] == "skipped"
    assert smtp.await_count == 0
    assert mail_account.await_count == 0
    assert send.await_count == 0
    assert _outbox(db) == []
    notes = _notes(db)
    assert len(notes) == 1
    assert notes[0]["type"] == "leave_request"
    assert notes[0]["roles"] == notify.roles_for_type("leave_request")
    assert notes[0]["roles"] == ["admin", "manager", "accountant"]
    assert notes[0]["link"] == "/personnel?tab=leaves"


def test_default_skips_outbox_enabled_email_renders_shared_layout():
    db = _prepare()
    smtp, mail_account, prev = _bind(db)
    send = AsyncMock(return_value={"status": "sent", "to": ["admin@demo.com"], "driver": "platform_smtp"})

    async def _go():
        with _Stack(send):
            closed = await attendance.notify_managers(
                "c1", "leave_request", "İzin talebi: Ayşe", "Kapalıyken kuyruk yok.",
            )
            assert _outbox(db) == []
            assert send.await_count == 0
            await _email_on("leave_request")
            opened = await attendance.notify_managers(
                "c1", "leave_request", "İzin talebi: Ayşe", "Yıllık izin: 3 gün.",
                link="/personnel?tab=leaves",
            )
            assert send.await_count == 0
            await event_notify.flush_notify_outbox()
            return closed, opened

    try:
        closed, opened = _run(_go())
    finally:
        _restore(prev)
    assert closed["mail"]["status"] == "skipped"
    assert opened["status"] == "sent"
    assert opened["mail"]["status"] == "queued"
    assert smtp.await_count == 0
    assert mail_account.await_count == 0
    assert send.await_count == 1
    html = send.await_args.kwargs["html"]
    assert "tk-card" in html and "tk-bar" in html
    assert "İzin talebi" in html
    assert "Yıllık izin: 3 gün." in html
    assert "Uygulamada aç" in html
    rows = _outbox(db)
    assert len(rows) == 1
    assert rows[0]["event"] == "leave_request"
    assert rows[0]["ref_type"] == "attendance"
    assert rows[0]["status"] == "sent"
    assert rows[0]["channels"] == {"email": True, "sms": False}
    assert len(_notes(db)) == 2


def test_type_map_queues_mapped_event_and_skips_unmapped():
    db = _prepare()
    smtp, _, prev = _bind(db)
    send = AsyncMock()

    async def _go():
        with _Stack(send):
            await _email_on(*STAFF_EVENTS)
            results = []
            for ntype, event in TYPE_EVENT.items():
                res = await attendance.notify_managers(
                    "c1", ntype, f"Başlık {ntype}", f"Mesaj {ntype}",
                    dedupe_key=f"map:{ntype}",
                )
                results.append((ntype, event, res))
            missing = await attendance.notify_managers(
                "c1", "order_pick_missing", "Depo eksik: SP-1", "Kalem yok.",
                link="/production?tab=missing&order=ord1",
            )
            return results, missing

    try:
        results, missing = _run(_go())
    finally:
        _restore(prev)
    assert attendance.MANAGER_NOTIFY_EVENTS == TYPE_EVENT
    assert smtp.await_count == 0
    assert send.await_count == 0
    rows = _outbox(db)
    assert len(rows) == len(TYPE_EVENT)
    by_title = {row["title"]: row for row in rows}
    for ntype, event, res in results:
        assert res["status"] == "sent"
        assert res["mail"]["status"] == "queued"
        assert res["mail"]["event"] == event
        row = by_title[f"Başlık {ntype}"]
        assert row["event"] == event
        assert row["ref_type"] == "attendance"
        assert row["message"] == f"Mesaj {ntype}"
    assert missing["status"] == "sent"
    assert missing["mail"]["status"] == "skipped"
    assert all(row["event"] != "order_pick_missing" for row in rows)
    pick = [n for n in _notes(db) if n["type"] == "order_pick_missing"]
    assert len(pick) == 1
    assert pick[0]["roles"] == notify.roles_for_type("order_pick_missing")
    assert pick[0]["roles"] == ["admin", "manager", "warehouse"]
    late = [n for n in _notes(db) if n["type"] == "attendance_late"]
    assert late[0]["roles"] == ["admin", "manager", "accountant"]


def test_dedupe_second_call_is_duplicate_and_outbox_stays_one():
    db = _prepare()
    smtp, _, prev = _bind(db)
    send = AsyncMock()

    async def _go():
        with _Stack(send):
            await _email_on("attendance_alert")
            first = await attendance.notify_managers(
                "c1", "attendance_missing", "Giriş yapmayan 2 personel", "Ali, Ayşe",
                dedupe_key="missing:2026-10-16",
            )
            second = await attendance.notify_managers(
                "c1", "attendance_missing", "Giriş yapmayan 2 personel", "Ali, Ayşe",
                dedupe_key="missing:2026-10-16",
            )
            return first, second

    try:
        first, second = _run(_go())
    finally:
        _restore(prev)
    assert first["status"] == "sent"
    assert first["mail"]["status"] == "queued"
    assert second == {"status": "duplicate", "mail": {"status": "skipped"}}
    assert len(_outbox(db)) == 1
    assert _outbox(db)[0]["event"] == "attendance_alert"
    assert len(_notes(db)) == 1
    assert len(db.attendance_alerts.docs) == 1
    assert smtp.await_count == 0
    assert send.await_count == 0
    key = "c1:attendance_missing:missing:2026-10-16"
    assert any(d.get("dedupe_key") == "attendance_missing:missing:2026-10-16" for d in db.notify_event_dedupe.docs.values())
    assert key in db.notify_event_dedupe.docs


def test_tenant_events_unchanged_and_new_events_are_platform_only():
    db = _prepare()
    assert event_notify.TENANT_EVENTS == LEGACY_TENANT
    assert set(event_notify.default_tenant("c1")["events"]) == set(LEGACY_TENANT)
    prefs = event_notify.default_prefs("c1")
    for ev in STAFF_EVENTS:
        assert ev in event_notify.NEW_EVENTS
        assert ev not in event_notify.TENANT_EVENTS
        assert event_notify.EVENT_LABELS[ev]
        assert prefs["events"][ev] == {"inapp": True, "email": False, "sms": False, "digest": "instant"}
        with pytest.raises(HTTPException) as ei:
            event_notify.parse_tenant_update({"events": {ev: {"email": True}}})
        assert ei.value.status_code == 422
        assert ei.value.detail == event_notify.PLATFORM_ONLY_DETAIL
    forced = event_notify.effective_channel(
        {"events": {"leave_request": {"inapp": True, "email": True, "sms": False, "digest": "instant"}}},
        {"events": {"leave_request": {"inapp": False, "email": False}}},
        "leave_request",
    )
    assert forced["email"] is True
    assert forced["inapp"] is True

    async def _go():
        return await event_notify.tenant_prefs_view("c1")

    view = _run(_go())
    assert set(view["events"]) == set(LEGACY_TENANT)
    assert set(view["labels"]) == set(LEGACY_TENANT)
    for ev in STAFF_EVENTS:
        assert ev not in view["events"]
        assert ev not in view["labels"]
    assert db.company_notify_tenant.docs == {}


def test_daily_email_cap_applies_to_staff_events():
    db = _prepare()
    smtp, _, prev = _bind(db)
    send = AsyncMock(return_value={"status": "sent", "to": ["admin@demo.com"], "driver": "platform_smtp"})

    async def _go():
        with _Stack(send):
            await _email_on("leave_request", "advance_request", cap=1)
            first = await attendance.notify_managers(
                "c1", "leave_request", "İzin talebi: Ali", "1 gün.",
            )
            await event_notify.flush_notify_outbox()
            second = await attendance.notify_managers(
                "c1", "advance_request", "Avans talebi: Ali", "5.000 TL.",
            )
            await event_notify.flush_notify_outbox()
            return first, second

    try:
        first, second = _run(_go())
    finally:
        _restore(prev)
    assert first["mail"]["status"] == "queued"
    assert second["mail"]["status"] == "queued"
    assert smtp.await_count == 0
    assert send.await_count == 1
    by_event = {row["event"]: row for row in _outbox(db)}
    assert by_event["leave_request"]["status"] == "sent"
    assert by_event["advance_request"]["status"] == "deferred"
    assert len(_notes(db)) == 2


def test_queue_error_is_swallowed_and_inapp_remains():
    db = _prepare()
    smtp, _, prev = _bind(db)

    async def _go():
        with patch("event_notify.queue_event_email", AsyncMock(side_effect=RuntimeError("boom"))), \
             patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})):
            return await attendance.notify_managers(
                "c1", "overtime_confirm", "Fazla mesai", "Onay bekliyor.",
            )

    try:
        res = _run(_go())
    finally:
        _restore(prev)
    assert res["status"] == "sent"
    assert res["mail"]["status"] == "skipped"
    assert smtp.await_count == 0
    assert _outbox(db) == []
    assert _notes(db)[0]["type"] == "overtime_confirm"
    assert _notes(db)[0]["roles"] == ["admin", "manager", "accountant"]
