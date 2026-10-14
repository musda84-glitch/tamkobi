"""Şirket SMS: firma paneli RBAC, ynt yazması 403 + audit, özet sır sızdırmaz."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

import company_sms
import rbac


def test_sms_settings_map_to_company_settings_not_communication():
    assert rbac.module_for_path("/api/comm/sms/settings") == "/settings"
    assert rbac.module_for_path("/api/comm/sms/verify") == "/settings"
    assert rbac.module_for_path("/api/comm/sms/balance") == "/settings"
    assert rbac.module_for_path("/api/comm/sms/send") == "/communication"
    assert rbac.module_for_path("/api/comm/sms/logs") == "/communication"


def test_admin_may_edit_settings_sales_may_not():
    assert company_sms.settings_allows("admin", {}, "edit") is True
    assert company_sms.settings_allows("owner", {}, "view") is True
    sales = {"/settings": "none", "/communication": "edit"}
    assert company_sms.settings_allows("sales", sales, "view") is False
    assert company_sms.settings_allows("sales", sales, "edit") is False
    assert company_sms.settings_allows("manager", {"/settings": "none"}, "edit") is False


def test_require_settings_denies_non_admin():
    user = {"role": "sales", "id": "u-sales"}

    async def run():
        with patch(
            "rbac.role_for",
            new=AsyncMock(return_value={"permissions": {"/settings": "none", "/communication": "edit"}}),
        ):
            await company_sms.require_company_sms_settings(user, "comp_1", "edit")

    with pytest.raises(HTTPException) as ei:
        asyncio.run(run())
    assert ei.value.status_code == 403


def test_require_settings_allows_company_admin_without_db():
    user = {"role": "admin", "id": "u-admin"}

    async def run():
        with patch("rbac.role_for", new=AsyncMock()) as role_for:
            await company_sms.require_company_sms_settings(user, "comp_1", "edit")
            role_for.assert_not_awaited()

    asyncio.run(run())


def test_ynt_write_is_403_and_audited():
    user = {"id": "sa1", "email": "sa@test", "is_super_admin": True, "_token_aud": "ynt"}
    request = MagicMock()
    audit = AsyncMock()

    async def run():
        with patch("platform_store.write_audit", audit), patch("client_ip.request_ip", return_value="203.0.113.8"):
            await company_sms.reject_ynt_company_sms(
                request,
                user,
                write=True,
                action="sms.settings.save",
                company_id="comp_matek",
                method="PUT",
                path="/api/comm/sms/settings",
            )

    with pytest.raises(HTTPException) as ei:
        asyncio.run(run())
    assert ei.value.status_code == 403
    assert "Ayarlar" in str(ei.value.detail)
    audit.assert_awaited()
    kwargs = audit.await_args.kwargs
    assert kwargs["action"] == "company_sms.write_denied"
    assert kwargs["target_id"] == "comp_matek"
    assert kwargs["details"]["attempt"] == "sms.settings.save"
    assert kwargs["details"]["method"] == "PUT"
    assert "password" not in kwargs["details"]


def test_ynt_read_of_operator_settings_is_403_without_audit():
    user = {"id": "sa1", "_token_aud": "ynt", "is_super_admin": True}
    audit = AsyncMock()

    async def run():
        with patch("platform_store.write_audit", audit):
            await company_sms.reject_ynt_company_sms(
                MagicMock(),
                user,
                write=False,
                action="sms.settings.read",
                company_id="comp_matek",
                method="GET",
                path="/api/comm/sms/settings",
            )

    with pytest.raises(HTTPException) as ei:
        asyncio.run(run())
    assert ei.value.status_code == 403
    audit.assert_not_awaited()


def test_app_session_is_not_treated_as_ynt():
    user = {"id": "u1", "role": "admin", "_token_aud": "app"}
    request = MagicMock()

    async def run():
        with patch("host_audience.host_kind", return_value="app"):
            await company_sms.reject_ynt_company_sms(
                request,
                user,
                write=True,
                action="sms.settings.save",
                company_id="comp_1",
                method="PUT",
                path="/api/comm/sms/settings",
            )

    asyncio.run(run())


def test_summary_has_no_secrets():
    class _Cursor:
        def __init__(self, rows):
            self.rows = rows

        def sort(self, *args, **kwargs):
            return self

        async def to_list(self, limit):
            return self.rows[:limit]

    class _Logs:
        def find(self, query):
            return _Cursor([{"created_at": "2026-10-12T09:15:00+00:00", "status": "sent"}])

        async def count_documents(self, query):
            assert query.get("status") == "failed"
            return 3

    class _Settings:
        async def find_one(self, query):
            return {
                "_id": "sms1",
                "company_id": query["company_id"],
                "provider": "netgsm",
                "usercode": "8500000000",
                "password_enc": "enc-secret",
                "msgheader": "MATEK",
                "is_active": True,
                "verified": True,
            }

    db = MagicMock()
    db.sms_settings = _Settings()
    db.sms_logs = _Logs()

    out = asyncio.run(company_sms.company_sms_summary(db, "comp_matek"))
    blob = str(out)
    assert out["connected"] is True
    assert out["operator"] == "Netgsm"
    assert out["last_sent_at"] == "2026-10-12T09:15:00+00:00"
    assert out["error_count"] == 3
    assert out["readonly"] is True
    assert "password" not in out
    assert "usercode" not in out
    assert "8500000000" not in blob
    assert "enc-secret" not in blob
    assert "MATEK" not in blob
