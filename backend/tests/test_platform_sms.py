"""Platform SMS settings unit + live API smoke tests."""
import os
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import requests

from password_reset import (
    ERP_FORGOT_SMS_MSG,
    SMS_FAIL_PUBLIC_DETAIL,
    finalize_forgot_sms_result,
    forgot_channel,
    generic_forgot_response,
    mask_phone,
    sms_reset_message,
)


def test_forgot_channel_and_sms_helpers():
    assert forgot_channel("sms") == "sms"
    assert forgot_channel("phone") == "sms"
    assert forgot_channel("") == "email"
    assert mask_phone("05321234567") == "•••4567"
    assert mask_phone("12") == ""
    out = generic_forgot_response("sms")
    assert out["channel"] == "sms"
    assert out["message"] == ERP_FORGOT_SMS_MSG
    assert "reset_token" not in out
    msg = sms_reset_message(name="Ali", link="https://x/sifre/tok", brand="Demo")
    assert "Ali" in msg and "https://x/sifre/tok" in msg and len(msg) <= 400


def test_finalize_forgot_sms_never_exposes_link():
    dirty = {"status": "ok", "message": ERP_FORGOT_SMS_MSG, "reset_url": "https://evil", "reset_token": "tok"}
    failed = finalize_forgot_sms_result(dirty, sms_status="failed", sms_detail="provider down")
    assert "reset_url" not in failed
    assert "reset_token" not in failed
    assert failed["sms_status"] == "failed"
    assert failed["detail"] == SMS_FAIL_PUBLIC_DETAIL
    sent = finalize_forgot_sms_result({"status": "ok"}, sms_status="sent", sms_detail="•••4567")
    assert sent["sms_status"] == "sent"
    assert "4567" in sent["detail"]


def test_public_view_hides_password():
    import platform_sms
    import comm_service

    enc = comm_service.encrypt("secret-api")
    view = platform_sms._public_view({
        "_id": "platform_sms",
        "provider": "netgsm",
        "usercode": "user1",
        "password_enc": enc,
        "msgheader": "TAMKOBI",
        "is_active": True,
        "verified": True,
    })
    assert "password_enc" not in view
    assert view["has_password"] is True
    assert view["usercode"] == "user1"
    assert any(p["id"] == "netgsm" for p in view["providers"])


def test_notify_companies_sms_skips_when_inactive():
    import asyncio
    import platform_sms

    platform_sms._db = MagicMock()

    async def _run():
        with patch.object(platform_sms, "resolve_platform_sms_creds", AsyncMock(return_value=None)):
            return await platform_sms.notify_companies_sms("Merhaba")

    r = asyncio.run(_run())
    assert r["status"] == "skipped"
    assert r["sent"] == 0


def _load_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if not v:
        for path in ("/app/frontend/.env", "/workspace/frontend/.env"):
            try:
                for line in open(path):
                    if line.startswith("REACT_APP_BACKEND_URL="):
                        v = line.split("=", 1)[1].strip().strip('"').strip("'")
                        break
            except Exception:
                pass
            if v:
                break
    return (v or "http://127.0.0.1:8000").rstrip("/")


BASE_URL = _load_url()
API = BASE_URL + "/api"
ADMIN_EMAIL = "admin@nexus.com"
ADMIN_PASS = "admin123"


def _api_up():
    try:
        r = requests.get(f"{API}/health", timeout=3)
        return r.status_code < 500
    except Exception:
        return False


pytestmark_live = pytest.mark.skipif(not _api_up(), reason="backend API not running")


@pytestmark_live
class TestPlatformSmsLive:
    def _admin(self):
        s = requests.Session()
        r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASS}, timeout=20)
        assert r.status_code == 200, r.text
        return s

    def test_requires_auth(self):
        r = requests.get(f"{API}/system/sms", timeout=20)
        assert r.status_code == 401

    def test_get_put_settings(self):
        s = self._admin()
        r = s.get(f"{API}/system/sms", timeout=20)
        assert r.status_code == 200, r.text
        body = r.json()
        assert "providers" in body
        assert "purposes" in body
        assert "password_enc" not in body
        suffix = uuid.uuid4().hex[:6]
        r = s.put(
            f"{API}/system/sms",
            json={
                "provider": "netgsm",
                "usercode": f"u_{suffix}",
                "password": f"p_{suffix}",
                "msgheader": "TAMKOBI",
                "is_active": False,
            },
            timeout=20,
        )
        assert r.status_code == 200, r.text
        assert r.json()["usercode"] == f"u_{suffix}"
        assert r.json()["has_password"] is True
        assert r.json()["is_active"] is False

    def test_forgot_sms_unknown_phone_generic(self):
        r = requests.post(
            f"{API}/auth/forgot-password",
            json={"channel": "sms", "phone": "05999999999", "base_url": BASE_URL},
            timeout=20,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("channel") == "sms"
        assert "reset_token" not in d
        assert "reset_url" not in d
