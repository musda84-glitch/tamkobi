"""Netgsm REST v2 send response parsing + platform SMS detail safety."""
from __future__ import annotations

import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

import comm_service
import platform_sms


def test_sms_detail_text_dict_str_none():
    assert comm_service.sms_detail_text(None) == ""
    assert comm_service.sms_detail_text("hello") == "hello"
    assert comm_service.sms_detail_text("x" * 400) == "x" * 300
    dumped = comm_service.sms_detail_text({"code": "00", "jobid": "1"})
    assert "code" in dumped and "00" in dumped
    # must not raise — the bug was dict[:300]
    assert isinstance(dumped, str)
    assert len(dumped) <= 300


def test_parse_netgsm_send_success_00_jobid():
    data = {"code": "00", "jobid": "17377215342605050417149344", "description": "queued"}
    parsed = comm_service.parse_netgsm_send_response(data, http_status=200)
    assert parsed["ok"] is True
    assert parsed["code"] == "00"
    assert parsed["jobid"] == "17377215342605050417149344"
    assert parsed["error"] is None
    assert "queued" in (parsed["message"] or "")


def test_parse_netgsm_send_error_codes_turkish():
    for code, fragment in (
        ("20", "Mesaj"),
        ("30", "şifre"),
        ("40", "Gönderici"),
        ("50", "İYS"),
        ("51", "İYS"),
        ("70", "parametre"),
        ("80", "limit"),
        ("85", "çok fazla"),
    ):
        parsed = comm_service.parse_netgsm_send_response(
            {"code": code, "description": "fail"}, http_status=406
        )
        assert parsed["ok"] is False
        assert parsed["code"] == code
        err = parsed["error"] or ""
        assert fragment in err or fragment.lower() in err.lower()


def test_parse_netgsm_send_raw_dict_str_none_no_raise():
    for raw in (
        {"code": "70", "raw": {"nested": True}},
        "plain text error",
        None,
        ["list"],
        123,
    ):
        body = raw if isinstance(raw, dict) else {"raw": raw}
        parsed = comm_service.parse_netgsm_send_response(body, http_status=406)
        assert parsed["ok"] is False
        assert isinstance(comm_service.sms_detail_text(parsed.get("error") or parsed.get("raw")), str)


def test_netgsm_send_success_json(monkeypatch):
    payload = {"code": "00", "jobid": "JOB99", "description": "queued"}
    body_text = json.dumps(payload)

    class _Resp:
        status_code = 200
        text = body_text

        def json(self):
            return payload

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **k):
            return _Resp()

    monkeypatch.setattr(comm_service.httpx, "AsyncClient", _Client)
    creds = {"usercode": "u", "password": "p", "msgheader": "TAMKOBI"}
    res = asyncio.run(comm_service.netgsm_send(creds, [{"no": "5321234567", "msg": "Merhaba"}]))
    assert res["ok"] is True
    assert res["jobid"] == "JOB99"
    assert res["code"] == "00"


def test_netgsm_send_error_json(monkeypatch):
    payload = {"code": "30", "description": "invalid auth"}
    body_text = json.dumps(payload)

    class _Resp:
        status_code = 406
        text = body_text

        def json(self):
            return payload

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, *a, **k):
            return _Resp()

    monkeypatch.setattr(comm_service.httpx, "AsyncClient", _Client)
    creds = {"usercode": "u", "password": "p", "msgheader": "TAMKOBI"}
    res = asyncio.run(comm_service.netgsm_send(creds, [{"no": "5321234567", "msg": "Merhaba"}]))
    assert res["ok"] is False
    assert res["code"] == "30"
    assert "şifre" in (res["error"] or "").lower() or "API" in (res["error"] or "")
def test_send_platform_sms_raw_dict_no_500():
    """Reproduce KeyError: slice — provider returns raw dict; must log + return ok=False."""
    platform_sms._db = MagicMock()
    platform_sms._db.sms_logs = MagicMock()
    platform_sms._db.sms_logs.insert_one = AsyncMock()

    async def _fake_send(creds, messages, encoding="TR"):
        return {
            "ok": False,
            "jobid": None,
            "code": "30",
            "error": None,
            "message": None,
            # historical bug: platform_sms did (res.get("raw") or "")[:300]
            "raw": {"code": "30", "description": "auth"},
        }

    async def _run():
        with patch.object(
            platform_sms,
            "resolve_platform_sms_creds",
            AsyncMock(return_value={"provider": "netgsm", "usercode": "u", "password": "p", "msgheader": "TAMKOBI"}),
        ), patch.object(comm_service, "sms_send", _fake_send):
            return await platform_sms.send_platform_sms(phone="05321234567", message="test")

    out = asyncio.run(_run())
    assert out["ok"] is False
    assert isinstance(out["detail"], str)
    assert out["detail"]
    assert out["provider"] == "netgsm"
    platform_sms._db.sms_logs.insert_one.assert_awaited()


def test_send_platform_sms_success_returns_ok_fields():
    platform_sms._db = MagicMock()
    platform_sms._db.sms_logs = MagicMock()
    platform_sms._db.sms_logs.insert_one = AsyncMock()

    async def _fake_send(creds, messages, encoding="TR"):
        return {
            "ok": True,
            "jobid": "J1",
            "code": "00",
            "error": None,
            "message": "queued",
            "raw": {"code": "00", "jobid": "J1"},
        }

    async def _run():
        with patch.object(
            platform_sms,
            "resolve_platform_sms_creds",
            AsyncMock(return_value={"provider": "netgsm", "usercode": "u", "password": "p", "msgheader": "TAMKOBI"}),
        ), patch.object(comm_service, "sms_send", _fake_send):
            return await platform_sms.send_platform_sms(phone="05321234567", message="test")

    out = asyncio.run(_run())
    assert out["ok"] is True
    assert out["job_id"] == "J1"
    assert out["code"] == "00"
    assert out["status"] == "sent"


def test_send_test_endpoint_200_on_provider_failure():
    platform_sms._db = MagicMock()
    platform_sms._db.sms_logs = MagicMock()
    platform_sms._db.sms_logs.insert_one = AsyncMock()
    platform_sms._db.platform_settings = MagicMock()
    platform_sms._db.platform_settings.update_one = AsyncMock()

    async def _fake_send(**kwargs):
        return {
            "ok": False,
            "provider": "netgsm",
            "job_id": None,
            "code": "30",
            "detail": "auth fail",
            "status": "failed",
            "phone": "5321234567",
        }

    async def _run():
        with patch.object(platform_sms, "send_platform_sms", _fake_send):
            return await platform_sms.platform_sms_send_test({"phone": "05321234567"}, _={})

    out = asyncio.run(_run())
    assert out["ok"] is False
    assert "başarısız" in (out.get("message") or "").lower() or "fail" in (out.get("message") or "").lower()
    # endpoint itself must not raise → 200 at HTTP layer
    platform_sms._db.platform_settings.update_one.assert_awaited()


def test_company_sms_send_clips_dict_error():
    """_send_sms_to must tolerate dict error/raw without slicing crash."""
    err = comm_service.sms_detail_text({"code": "70", "description": "bad"}, limit=300)
    assert isinstance(err, str)
    assert "70" in err
