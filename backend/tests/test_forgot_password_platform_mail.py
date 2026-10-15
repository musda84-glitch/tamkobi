"""Şifre sıfırlama platform Destek kutusundan gider; firma mail hesabı kullanılmaz."""
import asyncio
from pathlib import Path
from unittest.mock import AsyncMock, patch

import platform_mail
from password_reset import (
    FORGOT_MAIL_UNAVAILABLE_MSG,
    PUBLIC_FORGOT_KEYS,
    forgot_mail_unavailable_response,
)


def _run(coro):
    return asyncio.run(coro)


def _match(doc, query):
    for key, cond in (query or {}).items():
        if isinstance(cond, dict) and "$ne" in cond:
            if doc.get(key) == cond["$ne"]:
                return False
            continue
        if doc.get(key) != cond:
            return False
    return True


class _Col:
    def __init__(self, rows=None):
        self.rows = {r["_id"]: dict(r) for r in (rows or [])}
        self.calls = 0

    async def find_one(self, query, projection=None):
        self.calls += 1
        for row in self.rows.values():
            if _match(row, query):
                return dict(row)
        return None

    def find(self, query=None, projection=None):
        rows = [dict(r) for r in self.rows.values() if _match(r, query or {})]

        class _Cursor:
            def __init__(self):
                self._rows = rows

            async def to_list(self, n=None):
                out = self._rows if n is None else self._rows[:n]
                return [dict(r) for r in out]

        return _Cursor()

    async def insert_one(self, doc):
        self.rows[doc["_id"]] = dict(doc)


class _Guard:
    def __init__(self):
        self.calls = 0

    async def find_one(self, *args, **kwargs):
        self.calls += 1
        raise AssertionError("firma mail hesabı şifre sıfırlamada kullanılmamalı")

    def find(self, *args, **kwargs):
        self.calls += 1
        raise AssertionError("firma mail hesabı şifre sıfırlamada kullanılmamalı")


def _server():
    return {
        "_id": "pms_ynt",
        "name": "Posta Sunucusu",
        "smtp_host": "smtp.tamkobi.example",
        "smtp_port": 587,
        "is_active": True,
    }


def _support():
    return {
        "_id": "pmb_destek",
        "email": "destek@tamkobi.com",
        "display_name": "TamKobi Destek",
        "password_enc": "destek-secret",
        "server_id": "pms_ynt",
        "is_default": False,
        "is_active": True,
        "purposes": ["support"],
        "created_at": "2024-01-01T00:00:00+00:00",
    }


def _default():
    return {
        "_id": "pmb_bildirim",
        "email": "bildirim@tamkobi.com",
        "display_name": "TamKobi",
        "password_enc": "bildirim-secret",
        "server_id": "pms_ynt",
        "is_default": True,
        "is_active": True,
        "purposes": ["transactional", "billing"],
        "created_at": "2020-01-01T00:00:00+00:00",
    }


class _DB:
    def __init__(self, boxes):
        self.platform_mail_servers = _Col([_server()])
        self.platform_mailboxes = _Col(boxes)
        self.platform_mail_logs = _Col([])
        # Bozuk firma hesabı: şifre çözülemez fernet jetonu. Akış buna bakmamalı.
        self.mail_accounts = _Guard()
        self.mail_accounts.rows = {
            "ma_broken": {
                "_id": "ma_broken",
                "company_id": "co_1",
                "email": "firma@musteri.com",
                "password_enc": "gAAAA" + ("A" * 40),
            }
        }


def _use(db):
    prev = platform_mail._db
    platform_mail.init(db)
    return prev


def _restore(prev):
    platform_mail._db = prev


def _logs(db):
    return list(db.platform_mail_logs.rows.values())


def test_broken_company_mail_still_sends_from_support_box():
    db = _DB([_support(), _default()])
    prev = _use(db)
    sent = {}

    async def _smtp(account, to, subject, body, html=None, **kwargs):
        sent["account"] = account
        sent["to"] = list(to)
        sent["subject"] = subject

    async def _go():
        with patch("mail_accounts.load_mail_account", new=AsyncMock(side_effect=AssertionError("firma"))), \
             patch("mail_accounts.ensure_mail_password", new=AsyncMock(side_effect=AssertionError("decrypt"))):
            ready = await platform_mail.begin_password_reset_delivery(context="erp_reset")
            assert ready["ok"] is True
            return await platform_mail.dispatch_password_reset_mail(
                ready["sender"],
                to=["kullanici@firma.com"],
                subject="Acme şifre sıfırlama",
                body="baglanti",
                html="<p>baglanti</p>",
                context="erp_reset",
                company_id="co_1",
            )

    try:
        with patch("comm_service.smtp_send", _smtp):
            result = _run(_go())
    finally:
        _restore(prev)

    assert result["ok"] is True
    assert result["source"] == "support"
    assert result["from_email"] == "destek@tamkobi.com"
    assert sent["account"]["email"] == "destek@tamkobi.com"
    assert sent["account"]["password"] == "destek-secret"
    assert sent["to"] == ["kullanici@firma.com"]
    assert db.mail_accounts.calls == 0
    logs = _logs(db)
    assert len(logs) == 1
    assert logs[0]["status"] == "sent"
    assert logs[0]["from_email"] == "destek@tamkobi.com"
    assert logs[0]["mailbox_id"] == "pmb_destek"
    assert logs[0]["context"] == "erp_reset"
    assert logs[0]["to"] == ["kullanici@firma.com"]
    assert "password" not in logs[0]
    assert "gAAAA" not in str(logs[0])
    # Davet / hatırlatma / fatura varsayılan kutuda kalır.
    prev = _use(db)
    try:
        transactional = _run(platform_mail.resolve_smtp_account("transactional"))
        billing = _run(platform_mail.resolve_smtp_account("billing"))
    finally:
        _restore(prev)
    assert transactional["email"] == "bildirim@tamkobi.com"
    assert billing["email"] == "bildirim@tamkobi.com"


def test_missing_support_box_uses_default_mailbox():
    db = _DB([_default()])
    prev = _use(db)
    sent = {}

    async def _smtp(account, to, subject, body, html=None, **kwargs):
        sent["email"] = account["email"]

    async def _go():
        ready = await platform_mail.begin_password_reset_delivery(context="erp_reset")
        assert ready["ok"] is True
        assert ready["sender"]["source"] == "default"
        return await platform_mail.dispatch_password_reset_mail(
            ready["sender"],
            to=["a@b.com"],
            subject="Sıfırlama",
            body="x",
            context="erp_reset",
        )

    try:
        with patch("comm_service.smtp_send", _smtp):
            result = _run(_go())
    finally:
        _restore(prev)

    assert result["ok"] is True
    assert result["from_email"] == "bildirim@tamkobi.com"
    assert sent["email"] == "bildirim@tamkobi.com"
    assert db.mail_accounts.calls == 0
    logs = _logs(db)
    assert logs[0]["status"] == "sent"
    assert logs[0]["from_email"] == "bildirim@tamkobi.com"
    assert logs[0]["mailbox_id"] == "pmb_bildirim"


def test_no_support_and_no_default_is_safe_public_error():
    db = _DB([])
    prev = _use(db)

    async def _go():
        return await platform_mail.begin_password_reset_delivery(context="erp_reset")

    try:
        with patch.object(platform_mail.logger, "error") as err:
            ready = _run(_go())
    finally:
        _restore(prev)

    assert ready == {"ok": False}
    assert err.called
    logged = " ".join(str(part) for part in err.call_args[0])
    assert "Destek" in logged
    assert "varsayılan" in logged
    assert "kullanici@" not in logged
    logs = _logs(db)
    assert len(logs) == 1
    assert logs[0]["status"] == "failed"
    assert logs[0]["from_email"] is None
    assert logs[0]["context"] == "erp_reset"
    assert "Destek kutusu" in (logs[0]["error"] or "")
    assert "password" not in logs[0]

    public = forgot_mail_unavailable_response()
    again = forgot_mail_unavailable_response()
    assert public == again
    assert public["message"] == FORGOT_MAIL_UNAVAILABLE_MSG
    assert public["status"] == "ok"
    assert set(public) == set(PUBLIC_FORGOT_KEYS)
    text = public["message"].lower()
    assert "kayıtlı" not in text
    assert "hesap" not in text
    assert "@" not in public["message"]
    assert "bulunamadı" not in text


def test_forgot_handlers_do_not_use_company_mail():
    src = Path(__file__).resolve().parents[1].joinpath("server.py").read_text(encoding="utf-8")
    start = src.index("async def erp_forgot_password")
    end = src.index("\nasync def _erp_reset_doc", start)
    erp = src[start:end]
    assert "begin_password_reset_delivery" in erp
    assert "dispatch_password_reset_mail" in erp
    assert "_mail_account" not in erp
    assert "_send_tracked_mail" not in erp
    assert erp.index("begin_password_reset_delivery") < erp.index("db.users.find_one")
    assert "forgot_mail_unavailable_response" in erp

    b2b_start = src.index("async def b2b_forgot_password")
    b2b_end = src.index("\n@api_router.get(\"/public/b2b/reset/", b2b_start)
    b2b = src[b2b_start:b2b_end]
    assert "_mail_account" not in b2b
    assert "_send_tracked_mail" not in b2b
    assert b2b.index("begin_password_reset_delivery") < b2b.index("_b2b_find_contact")
    assert "forgot_mail_unavailable_response" in b2b
