"""mail_service: console/smtp/ses drivers, platform priority, logs, suppressions, From/Reply-To."""
from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import mail_service


class FakeColl:
    def __init__(self, docs=None):
        self.docs = {d["_id"]: dict(d) for d in (docs or [])}

    async def find_one(self, q, *args, **kwargs):
        for d in self.docs.values():
            if self._match(d, q or {}):
                return dict(d)
        return None

    async def insert_one(self, doc):
        self.docs[doc["_id"]] = dict(doc)
        return MagicMock(inserted_id=doc["_id"])

    async def update_one(self, filt, upd, upsert=False):
        doc = None
        for d in self.docs.values():
            if self._match(d, filt):
                doc = d
                break
        if doc is None:
            if not upsert:
                return MagicMock(modified_count=0)
            doc = {"_id": filt.get("_id") or f"auto_{len(self.docs)}"}
            if "email" in filt:
                doc["email"] = filt["email"]
            self.docs[doc["_id"]] = doc
        if "$set" in upd:
            doc.update(upd["$set"])
        if "$setOnInsert" in upd:
            for k, v in upd["$setOnInsert"].items():
                doc.setdefault(k, v)
        return MagicMock(modified_count=1)

    def _match(self, d, q):
        for k, v in (q or {}).items():
            if str(k).startswith("$"):
                continue
            if isinstance(v, dict):
                if "$ne" in v and d.get(k) == v["$ne"]:
                    return False
                continue
            if d.get(k) != v:
                return False
        return True


@pytest.fixture
def db():
    database = MagicMock()
    database.mail_logs = FakeColl([])
    database.mail_suppressions = FakeColl([])
    mail_service.init(database)
    return database


def test_format_from_company_via_tamkobi():
    h = mail_service.format_from_header(
        from_email="bildirim@tamkobi.com",
        from_name="Acme Ltd",
        company_id="c1",
    )
    assert h == "Acme Ltd via TamKobi <bildirim@tamkobi.com>"
    h2 = mail_service.format_from_header(
        from_email="bildirim@tamkobi.com",
        from_name="Already via TamKobi",
        company_id="c1",
    )
    assert "via TamKobi via" not in h2
    plain = mail_service.format_from_header(from_email="bildirim@tamkobi.com", from_name="TamKobi")
    assert plain == "TamKobi <bildirim@tamkobi.com>"


def test_console_driver_logs_no_raise(db, monkeypatch):
    monkeypatch.setenv("MAIL_DRIVER", "console")
    monkeypatch.delenv("MAIL_SMTP_HOST", raising=False)

    async def _run():
        with patch.object(mail_service, "_resolve_platform_account", AsyncMock(return_value=None)):
            res = await mail_service.send_mail(
                "a@example.com", "Konu", "Merhaba", purpose="transactional",
            )
            return res

    res = asyncio.run(_run())
    assert res["status"] == "sent"
    assert res["driver"] == "console"
    assert res.get("provider_message_id", "").startswith("console-")
    logs = list(db.mail_logs.docs.values())
    assert len(logs) == 1
    assert logs[0]["status"] == "sent"
    assert logs[0]["driver"] == "console"
    assert logs[0]["to"] == ["a@example.com"]
    assert logs[0]["subject"] == "Konu"
    assert "body" not in logs[0]
    assert "html" not in logs[0]
    assert "attachments" not in logs[0]


def test_platform_box_priority_over_env(db, monkeypatch):
    monkeypatch.setenv("MAIL_DRIVER", "console")
    plat = {
        "email": "bildirim@tamkobi.com",
        "display_name": "TamKobi",
        "smtp_host": "email-smtp.eu-central-1.amazonaws.com",
        "smtp_port": 587,
        "smtp_user": "AKIA",
        "password": "secret",
        "reply_to": "destek@tamkobi.com",
    }

    async def _run():
        with patch.object(mail_service, "_resolve_platform_account", AsyncMock(return_value=plat)), \
             patch.object(mail_service, "_send_via_smtp", AsyncMock(return_value="250 ok")) as smtp:
            res = await mail_service.send_mail(
                ["x@y.com"], "S", "T", purpose="billing", company_id="c9", from_name="Firma X",
            )
            assert smtp.await_count == 1
            msg = smtp.await_args.args[1]
            assert "Firma X via TamKobi" in msg["From"]
            assert "bildirim@tamkobi.com" in msg["From"]
            assert msg["Reply-To"] == "destek@tamkobi.com"
            return res

    res = asyncio.run(_run())
    assert res["status"] == "sent"
    assert res["driver"] == "platform_smtp"
    log = next(iter(db.mail_logs.docs.values()))
    assert log["purpose"] == "billing"
    assert log["company_id"] == "c9"
    assert log["provider_message_id"] == "250 ok"


def test_smtp_env_driver(db, monkeypatch):
    monkeypatch.setenv("MAIL_DRIVER", "smtp")
    monkeypatch.setenv("MAIL_SMTP_HOST", "email-smtp.eu-central-1.amazonaws.com")
    monkeypatch.setenv("MAIL_SMTP_PORT", "587")
    monkeypatch.setenv("MAIL_SMTP_USER", "user")
    monkeypatch.setenv("MAIL_SMTP_PASSWORD", "pass")
    monkeypatch.setenv("MAIL_FROM", "bildirim@tamkobi.com")
    monkeypatch.setenv("MAIL_REPLY_TO", "destek@tamkobi.com")

    async def _run():
        with patch.object(mail_service, "_resolve_platform_account", AsyncMock(return_value=None)), \
             patch.object(mail_service, "_send_via_smtp", AsyncMock(return_value="ok")) as smtp:
            res = await mail_service.send_mail("b@c.com", "Hi", "Body", reply_to="firma@demo.com")
            acc = smtp.await_args.args[0]
            assert acc["smtp_host"] == "email-smtp.eu-central-1.amazonaws.com"
            msg = smtp.await_args.args[1]
            assert msg["Reply-To"] == "firma@demo.com"
            return res

    res = asyncio.run(_run())
    assert res["status"] == "sent"
    assert res["driver"] == "smtp"


def test_ses_api_driver_mocked(db, monkeypatch):
    monkeypatch.setenv("MAIL_DRIVER", "ses")
    monkeypatch.setenv("MAIL_FROM", "bildirim@tamkobi.com")
    monkeypatch.setenv("MAIL_SES_REGION", "eu-central-1")

    async def _run():
        with patch.object(mail_service, "_resolve_platform_account", AsyncMock(return_value=None)), \
             patch.object(
                 mail_service, "_send_via_ses_api", AsyncMock(return_value="ses-msg-1"),
             ) as ses:
            res = await mail_service.send_mail("z@z.com", "Sub", "Txt", html="<p>x</p>")
            assert ses.await_count == 1
            return res

    res = asyncio.run(_run())
    assert res["status"] == "sent"
    assert res["driver"] == "ses"
    assert res["provider_message_id"] == "ses-msg-1"


def test_suppression_blocks_send(db, monkeypatch):
    monkeypatch.setenv("MAIL_DRIVER", "console")
    db.mail_suppressions.docs["s1"] = {
        "_id": "s1", "email": "bad@example.com", "reason": "bounce", "active": True,
    }

    async def _run():
        with patch.object(mail_service, "_resolve_platform_account", AsyncMock(return_value=None)), \
             patch.object(mail_service, "_send_via_console", AsyncMock(return_value="c1")) as cons:
            blocked = await mail_service.send_mail("bad@example.com", "S", "T")
            partial = await mail_service.send_mail(
                ["bad@example.com", "ok@example.com"], "S", "T",
            )
            assert cons.await_count == 1
            return blocked, partial

    blocked, partial = asyncio.run(_run())
    assert blocked["status"] == "failed"
    assert blocked["error"] == "suppressed"
    assert partial["status"] == "sent"
    assert partial["to"] == ["ok@example.com"]
    assert "bad@example.com" in (partial.get("suppressed") or [])


def test_retry_twice_then_failed(db, monkeypatch):
    monkeypatch.setenv("MAIL_DRIVER", "smtp")
    monkeypatch.setenv("MAIL_SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("MAIL_SMTP_PASSWORD", "x")

    async def _run():
        with patch.object(mail_service, "_resolve_platform_account", AsyncMock(return_value=None)), \
             patch.object(mail_service, "_send_via_smtp", AsyncMock(side_effect=RuntimeError("down"))), \
             patch.object(mail_service.asyncio, "sleep", AsyncMock()):
            return await mail_service.send_mail("a@b.com", "S", "T")

    res = asyncio.run(_run())
    assert res["status"] == "failed"
    assert "down" in (res.get("error") or "")
    logs = list(db.mail_logs.docs.values())
    assert len(logs) == 1
    assert logs[0]["status"] == "failed"


def test_send_mail_does_not_raise(db, monkeypatch):
    monkeypatch.setenv("MAIL_DRIVER", "smtp")
    # missing SMTP config
    monkeypatch.delenv("MAIL_SMTP_HOST", raising=False)
    monkeypatch.delenv("MAIL_SMTP_PASSWORD", raising=False)

    async def _run():
        with patch.object(mail_service, "_resolve_platform_account", AsyncMock(return_value=None)):
            return await mail_service.send_mail("a@b.com", "S", "T")

    res = asyncio.run(_run())
    assert res["status"] == "failed"


def test_sns_bounce_webhook_suppresses(db, monkeypatch):
    monkeypatch.setenv("MAIL_SNS_SKIP_VERIFY", "1")
    message = json.dumps({
        "notificationType": "Bounce",
        "bounce": {
            "bounceType": "Permanent",
            "bouncedRecipients": [{"emailAddress": "bounce@me.com", "diagnosticCode": "550"}],
        },
    })
    payload = {"Type": "Notification", "Message": message}

    class FakeReq:
        async def body(self):
            return json.dumps(payload).encode()

    async def _run():
        return await mail_service.ses_sns_webhook(FakeReq())

    out = asyncio.run(_run())
    assert out["ok"] is True
    assert out["suppressed"] == 1
    row = next(d for d in db.mail_suppressions.docs.values() if d.get("email") == "bounce@me.com")
    assert row["reason"] == "bounce"
    assert row["active"] is True


def test_sns_complaint_webhook(db, monkeypatch):
    monkeypatch.setenv("MAIL_SNS_SKIP_VERIFY", "1")
    message = json.dumps({
        "notificationType": "Complaint",
        "complaint": {
            "complainedRecipients": [{"emailAddress": "spam@me.com"}],
            "complaintFeedbackType": "abuse",
        },
    })
    payload = {"Type": "Notification", "Message": message}

    class FakeReq:
        async def body(self):
            return json.dumps(payload).encode()

    asyncio.run(mail_service.ses_sns_webhook(FakeReq()))
    assert any(d.get("email") == "spam@me.com" and d.get("reason") == "complaint"
               for d in db.mail_suppressions.docs.values())


def test_sns_bad_signature_rejected(db, monkeypatch):
    monkeypatch.delenv("MAIL_SNS_SKIP_VERIFY", raising=False)
    payload = {"Type": "Notification", "Message": "{}", "Signature": "x", "SigningCertURL": "https://evil.example/cert.pem"}

    class FakeReq:
        async def body(self):
            return json.dumps(payload).encode()

    async def _run():
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as ei:
            await mail_service.ses_sns_webhook(FakeReq())
        assert ei.value.status_code == 403

    asyncio.run(_run())


def test_public_allowlist_includes_ses_webhook():
    import rbac
    assert rbac.is_public_api_path("/api/mail/webhooks/ses", "POST")
