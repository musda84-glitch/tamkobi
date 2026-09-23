"""Davet: e-posta + SMS + WhatsApp kanalları."""
from unittest.mock import AsyncMock, MagicMock, patch
import asyncio


def test_invite_requires_phone_for_sms():
    import rbac
    from fastapi import HTTPException

    rbac._db = MagicMock()
    rbac._db.users.find_one = AsyncMock(return_value=None)
    rbac._mail_account = AsyncMock()

    async def run():
        req = MagicMock()
        req.headers = {"origin": "http://localhost"}
        try:
            await rbac.invite_user(
                {"email": "a@t.com", "role": "sales", "channels": ["sms"], "company_id": "co"},
                req,
            )
            assert False, "expected HTTPException"
        except HTTPException as e:
            assert e.status_code == 400
            assert "telefon" in e.detail.lower()

    asyncio.run(run())


def test_invite_sends_sms_and_whatsapp_channels():
    import rbac

    db = MagicMock()
    db.users.find_one = AsyncMock(return_value=None)
    db.roles.find_one = AsyncMock(return_value={"code": "sales", "name": "Satış"})
    db.companies.find_one = AsyncMock(return_value={"_id": "co", "name": "Acme"})
    db.user_invites.delete_many = AsyncMock()
    db.user_invites.insert_one = AsyncMock()
    db.user_invites.update_one = AsyncMock()

    async def fake_sms(*a, **k):
        return {"sent": 1, "failed": 0, "message": "1 SMS gönderildi"}

    async def fake_wa(payload):
        return {"status": "simulated", "message_info": "sim", "wa_link": "https://wa.me/905551112233?text=x"}

    async def run():
        # server import during patch may overwrite rbac._db — rebind after patches open
        with patch.object(rbac, "ensure_roles", AsyncMock()), \
             patch.object(rbac, "_notify_role_assigned", AsyncMock()), \
             patch.object(rbac, "_mail_account", AsyncMock(side_effect=Exception("no mail"))), \
             patch("saas.check_user_limit", AsyncMock()), \
             patch("server._send_sms_to", AsyncMock(side_effect=fake_sms)), \
             patch("server.wa_send", AsyncMock(side_effect=fake_wa)):
            rbac._db = db
            req = MagicMock()
            req.headers = {"origin": "https://app.test"}
            out = await rbac.invite_user(
                {
                    "email": "b@t.com",
                    "phone": "05551112233",
                    "name": "Ali",
                    "role": "sales",
                    "channels": ["email", "sms", "whatsapp"],
                    "company_id": "co",
                    "base_url": "https://app.test",
                },
                req,
            )
            assert out.get("link")
            assert "sms" in out.get("delivery", {})
            assert out["delivery"]["whatsapp"].get("wa_link")
            assert "sms" in (out.get("channels") or [])

    asyncio.run(run())
