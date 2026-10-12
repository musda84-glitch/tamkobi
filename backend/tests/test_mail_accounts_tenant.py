"""Firma mail API: tenant 403, decrypt → 409, şifre sızıntısı yok."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

import mail_accounts
import comm_service


class FakeColl:
    def __init__(self, docs=None):
        self.docs = {d["_id"]: dict(d) for d in (docs or [])}

    async def find_one(self, q):
        for d in self.docs.values():
            if all(d.get(k) == v for k, v in q.items() if not str(k).startswith("$")):
                return dict(d)
        return None

    async def update_one(self, filt, upd):
        doc = self.docs.get(filt.get("_id"))
        if not doc and "company_id" in filt:
            for d in self.docs.values():
                if d.get("company_id") == filt.get("company_id"):
                    doc = d
                    break
        if not doc:
            return MagicMock(modified_count=0)
        if "$set" in upd:
            doc.update(upd["$set"])
        return MagicMock(modified_count=1)

    async def delete_one(self, q):
        for _id, d in list(self.docs.items()):
            if all(d.get(k) == v for k, v in q.items()):
                del self.docs[_id]
                return MagicMock(deleted_count=1)
        return MagicMock(deleted_count=0)

    async def insert_one(self, doc):
        self.docs[doc["_id"]] = dict(doc)
        return MagicMock(inserted_id=doc["_id"])

    def find(self, q):
        rows = [dict(d) for d in self.docs.values() if all(d.get(k) == v for k, v in q.items())]

        class C:
            def sort(self, *a, **k):
                return self

            async def to_list(self, n):
                return rows[:n]

        return C()


@pytest.fixture
def setup_mail():
    acc_a = {
        "_id": "ma1",
        "company_id": "c1",
        "email": "a@firma.com",
        "password_enc": comm_service.encrypt("secret-a"),
        "imap_host": "imap.example.com",
        "imap_port": 993,
        "smtp_host": "smtp.example.com",
        "smtp_port": 587,
        "provider": "custom",
        "status": "connected",
    }
    acc_b = {
        "_id": "ma2",
        "company_id": "c2",
        "email": "b@other.com",
        "password_enc": comm_service.encrypt("secret-b"),
        "imap_host": "imap.example.com",
        "imap_port": 993,
        "smtp_host": "smtp.example.com",
        "smtp_port": 587,
        "provider": "custom",
        "status": "connected",
    }
    db = MagicMock()
    db.mail_accounts = FakeColl([acc_a, acc_b])
    db.mail_logs = FakeColl([])
    mail_accounts.init(db, get_current_user=AsyncMock(return_value={
        "_id": "u1", "company_ids": ["c1"], "active_company_id": "c1", "role": "admin",
    }))
    return db


def test_other_company_put_403(setup_mail):
    user = {"_id": "u1", "company_ids": ["c1"], "active_company_id": "c1"}

    async def _run():
        with pytest.raises(HTTPException) as ei:
            await mail_accounts.save_mail_account(
                {"company_id": "c2", "email": "x@y.com", "password": "x", "provider": "gmail"},
                user=user,
            )
        assert ei.value.status_code == 403

    asyncio.run(_run())


def test_other_company_flag_messages_send_403(setup_mail):
    user = {"_id": "u1", "company_ids": ["c1"], "active_company_id": "c1"}

    async def _flag():
        with pytest.raises(HTTPException) as ei:
            await mail_accounts.mail_flag("1", {"company_id": "c2", "flag": "read"}, user=user)
        assert ei.value.status_code == 403

    async def _messages():
        req = MagicMock()
        req.query_params = {"company_id": "c2"}
        with pytest.raises(HTTPException) as ei:
            await mail_accounts.mail_messages(req, company_id="c2", user=user)
        assert ei.value.status_code == 403

    asyncio.run(_flag())
    asyncio.run(_messages())


def test_decrypt_failure_409_needs_reauth(setup_mail):
    # Geçerli görünümlü ama bozuk Fernet token
    good = comm_service.encrypt("ok")
    setup_mail.mail_accounts.docs["ma1"]["password_enc"] = good[:20] + "XXXX" + good[24:]

    async def _run():
        with pytest.raises(HTTPException) as ei:
            await mail_accounts.load_mail_account("c1")
        assert ei.value.status_code == 409
        assert "yeniden girin" in ei.value.detail.lower() or "çözülemedi" in ei.value.detail.lower()
        assert setup_mail.mail_accounts.docs["ma1"]["status"] == "needs_reauth"

    asyncio.run(_run())


def test_mask_never_returns_password(setup_mail):
    raw = setup_mail.mail_accounts.docs["ma1"]
    masked = mail_accounts.mask_mail_account(raw)
    assert "password" not in masked
    assert "password_enc" not in masked
    assert masked["has_password"] is True


def test_get_account_own_company_ok(setup_mail):
    user = {"_id": "u1", "company_ids": ["c1"], "active_company_id": "c1"}

    async def _run():
        req = MagicMock()
        req.query_params = {}
        out = await mail_accounts.get_mail_account(req, company_id="c1", user=user)
        assert out["email"] == "a@firma.com"
        assert "password" not in out
        assert "password_enc" not in out

    asyncio.run(_run())
