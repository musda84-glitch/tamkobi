"""Destek oturumu + veri silme onay yanıtı."""
import asyncio
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock, MagicMock


def _db():
    db = MagicMock()
    db.support_sessions = MagicMock()
    db.deletion_confirmations = MagicMock()
    db.activity_logs = MagicMock()
    db.companies = MagicMock()
    db.support_sessions.update_many = AsyncMock()
    db.support_sessions.insert_one = AsyncMock()
    db.support_sessions.find_one = AsyncMock(return_value=None)
    db.support_sessions.update_one = AsyncMock()
    db.deletion_confirmations.find_one = AsyncMock(return_value=None)
    db.deletion_confirmations.insert_one = AsyncMock()
    db.deletion_confirmations.update_one = AsyncMock()
    db.activity_logs.insert_one = AsyncMock()
    return db


def test_create_and_public_session():
    import support_access

    db = _db()
    support_access.init(db, AsyncMock())

    async def run():
        doc = await support_access.create_session(
            company_id="co1",
            by_email="sa@platform.com",
            by_name="Platform",
            target_user_email="admin@co.com",
        )
        assert doc["_id"].startswith("ss_")
        assert doc["status"] == "active"
        pub = support_access.public_session(doc)
        assert pub["by"] == "sa@platform.com"
        assert pub["company_id"] == "co1"
        assert pub["started_at"]
        assert pub["expires_at"]

        expired = {**doc, "expires_at": (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()}
        assert support_access.public_session(expired) is None

    asyncio.run(run())
    db.support_sessions.insert_one.assert_awaited()


def test_reply_deletion_confirmation_approve():
    import support_access

    db = _db()
    support_access.init(db, AsyncMock())
    pending = {
        "_id": "dc_1",
        "company_id": "co1",
        "kind": "company_reset",
        "subject": "Sıfırlama",
        "body": "Onay?",
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    approved = {**pending, "status": "approved", "decision": "approve", "reply_message": "Onaylıyorum silinsin"}
    db.deletion_confirmations.find_one = AsyncMock(side_effect=[pending, approved])

    async def run():
        user = {"id": "u1", "role": "admin", "name": "Ali", "company_ids": ["co1"]}
        out = await support_access.reply_deletion_confirmation(
            "co1",
            "dc_1",
            {"decision": "approve", "message": "Onaylıyorum silinsin"},
            user,
        )
        assert out["item"]["status"] == "approved"
        assert "onay" in out["message"].lower()

    asyncio.run(run())


def test_reply_deletion_requires_message():
    import support_access
    from fastapi import HTTPException

    db = _db()
    support_access.init(db, AsyncMock())
    db.deletion_confirmations.find_one = AsyncMock(return_value={
        "_id": "dc_1", "company_id": "co1", "status": "pending",
    })

    async def run():
        user = {"id": "u1", "role": "admin", "name": "Ali", "company_ids": ["co1"]}
        try:
            await support_access.reply_deletion_confirmation(
                "co1", "dc_1", {"decision": "approve", "message": "x"}, user
            )
            assert False, "expected HTTPException"
        except HTTPException as e:
            assert e.status_code == 400
            assert "3" in e.detail

    asyncio.run(run())


def test_close_session_revokes():
    import support_access

    db = _db()
    support_access.init(db, AsyncMock())
    active = {
        "_id": "ss_abc",
        "company_id": "co1",
        "by_email": "sa@x.com",
        "by_name": "SA",
        "status": "active",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "expires_at": (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat(),
    }
    closed = {**active, "status": "revoked"}
    db.support_sessions.find_one = AsyncMock(side_effect=[active, closed])

    async def run():
        out = await support_access.close_session("ss_abc", ended_by="admin1", reason="revoked")
        assert out["status"] == "revoked"

    asyncio.run(run())
    db.support_sessions.update_one.assert_awaited()
