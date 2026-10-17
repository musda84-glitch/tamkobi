"""Bildirim açma: üretilen link + ref, linksiz eski kaydın listeye düşmesi."""
import asyncio
from unittest.mock import AsyncMock, patch

import attendance
import cash_approval
import notify
import pos_cashier as pc
import staff_messages
from notify import MISSING_RECORD, resolve_notification_open
from test_notify_queue_events import _Stack, _enable_cols, _notes, _prepare, _run
from test_notification_targets import _Db


def test_cash_and_pos_links_carry_record_id():
    assert cash_approval.open_link("virman", "r1") == "/banking?approval=r1"
    assert cash_approval.open_link("partner_tx", "r2") == "/banking?tab=partners&approval=r2"
    db = _prepare()
    _enable_cols(db, "cash_approval_requests")
    pc._db = db

    async def _go():
        with _Stack(AsyncMock()):
            await pc._notify_approval("c1", {
                "_id": "ap1", "kind": "cancel_cart", "summary": "Sepet",
                "requested_by_name": "Ayşe",
            })
            await cash_approval.queue(
                db, company_id="c1", kind="partner_tx", payload={}, account_ids=[],
                summary="ortak", user={"_id": "u1", "name": "Ali"},
            )

    _run(_go())
    notes = _notes(db)
    pos = next(n for n in notes if n["type"] == "pos_approval")
    cash = next(n for n in notes if n["type"] == "cash_approval")
    assert pos["link"] == "/hizli-satis?onay=ap1"
    assert pos["ref_type"] == "pos_approval"
    assert pos["ref_id"] == "ap1"
    assert cash["ref_type"] == "cash_approval"
    assert "approval=" in cash["link"]
    assert cash["ref_id"] in cash["link"]
    assert "tab=partners" in cash["link"]


def test_leave_advance_overtime_links():
    assert attendance.approval_notify_link("leave_request", "lv1", "/personnel?tab=leaves") == "/personnel?tab=leaves&leave=lv1"
    assert attendance.approval_notify_link("advance_request", "ad1", "/personnel?tab=payroll") == "/personnel?tab=payroll&advance=ad1"
    assert attendance.approval_notify_link("overtime_confirm", "ot1", "/personnel?tab=attendance") == "/personnel?tab=attendance&overtime=ot1"
    assert attendance.approval_notify_link("yevmiye_adjustment", "yv1", "/personnel?tab=attendance") == "/personnel?tab=attendance&overtime=yv1"
    db = _prepare()
    smtp, _mail, prev = None, None, None
    from test_notify_attendance_events import _bind, _restore
    smtp, _mail, prev = _bind(db)

    async def _go():
        with _Stack(AsyncMock()):
            await attendance.notify_managers(
                "c1", "leave_request", "İzin", "3 gün",
                link="/personnel?tab=leaves&leave=lv1", ref_id="lv1", ref_type="leave_request",
            )
            await attendance.notify_managers(
                "c1", "advance_request", "Avans", "500",
                link="/personnel?tab=payroll&advance=ad1", ref_id="ad1", ref_type="advance_request",
            )
            await attendance.notify_managers(
                "c1", "overtime_confirm", "Mesai", "evet/hayır",
                link="/personnel?tab=attendance&overtime=ot1", ref_id="ot1", ref_type="overtime_request",
            )

    try:
        _run(_go())
    finally:
        _restore(prev)
    by_type = {n["type"]: n for n in _notes(db)}
    assert by_type["leave_request"]["link"] == "/personnel?tab=leaves&leave=lv1"
    assert by_type["leave_request"]["ref_type"] == "leave_request"
    assert by_type["leave_request"]["ref_id"] == "lv1"
    assert by_type["advance_request"]["link"] == "/personnel?tab=payroll&advance=ad1"
    assert by_type["advance_request"]["ref_type"] == "advance_request"
    assert by_type["advance_request"]["ref_id"] == "ad1"
    assert by_type["overtime_confirm"]["link"] == "/personnel?tab=attendance&overtime=ot1"
    assert by_type["overtime_confirm"]["ref_type"] == "overtime_request"
    assert by_type["overtime_confirm"]["ref_id"] == "ot1"
    assert smtp.await_count == 0


def test_staff_message_keeps_ref_and_existing_link():
    """App.js'te ayrı mesaj rotası yok; link ekranın mevcut değeri olarak kalır."""
    db = _prepare()
    staff_messages._db = db

    async def _go():
        with patch.object(notify, "dispatch_push", AsyncMock(return_value={"sent": 0})):
            await staff_messages._notify_new({
                "_id": "m1",
                "company_id": "c1",
                "from_user_id": "u1",
                "from_name": "Yönetici",
                "from_side": "manager",
                "body": "selam",
            }, emp={"_id": "e1", "user_id": "u2", "full_name": "Ali"})

    _run(_go())
    note = _notes(db)[0]
    assert note["type"] == "staff_message"
    assert note["ref_type"] == "staff_message"
    assert note["ref_id"] == "m1"
    assert note["link"] == "/"


def test_linkless_old_records_fall_back_to_list_pages():
    db = _Db(
        leave_requests=[{"_id": "lv1", "company_id": "c1"}],
        bonus_payments=[{"_id": "ad1", "company_id": "c1"}],
        attendance=[{"_id": "ot1", "company_id": "c1"}],
        cash_approval_requests=[{"_id": "c1req", "company_id": "c1"}],
        pos_approvals=[{"_id": "p1", "company_id": "c1"}],
    )

    async def _run():
        leave = await resolve_notification_open(db, {
            "company_id": "c1", "type": "leave_request", "title": "İzin", "message": "3 gün",
        })
        assert leave["exists"] is True
        assert leave["target"]["route"] == "/personnel?tab=leaves"
        found = await resolve_notification_open(db, {
            "company_id": "c1", "type": "leave_request", "ref_type": "leave_request", "ref_id": "lv1",
        })
        assert found["exists"] is True
        assert "leave=lv1" in found["target"]["route"]
        assert "tab=leaves" in found["target"]["route"]
        missing = await resolve_notification_open(db, {
            "company_id": "c1", "type": "advance_request", "ref_type": "advance_request", "ref_id": "gone",
        })
        assert missing["exists"] is False
        assert missing["message"] == MISSING_RECORD
        overtime = await resolve_notification_open(db, {
            "company_id": "c1", "type": "overtime_confirm", "ref_id": "ot1",
        })
        assert overtime["exists"] is True
        assert "overtime=ot1" in overtime["target"]["route"]
        assert overtime["target"]["route"].startswith("/personnel?tab=attendance")
        cash = await resolve_notification_open(db, {
            "company_id": "c1", "type": "cash_approval", "ref_type": "cash_approval", "ref_id": "c1req",
            "link": "/banking?tab=partners",
            "target": {"type": "cash_approval", "id": "c1req", "route": "/banking?tab=partners"},
        })
        assert cash["exists"] is True
        assert "tab=partners" in cash["target"]["route"]
        assert "approval=c1req" in cash["target"]["route"]
        pos = await resolve_notification_open(db, {
            "company_id": "c1", "type": "pos_approval", "ref_id": "missing-pos", "link": "/hizli-satis",
        })
        assert pos["exists"] is False
        assert pos["message"] == MISSING_RECORD

    asyncio.run(_run())
