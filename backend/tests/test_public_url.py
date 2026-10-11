"""public_base_url: loopback reddi, PUBLIC_APP_URL, platform public_url, share-link."""
from __future__ import annotations

import asyncio
import os
from unittest.mock import AsyncMock, MagicMock, patch

import public_url as pu


def test_is_invalid_loopback_and_empty():
    assert pu.is_invalid_public_base("")
    assert pu.is_invalid_public_base(None)
    assert pu.is_invalid_public_base("http://127.0.0.1")
    assert pu.is_invalid_public_base("http://127.0.0.1/")
    assert pu.is_invalid_public_base("https://localhost:3000")
    assert pu.is_invalid_public_base("http://0.0.0.0")
    assert pu.is_invalid_public_base("http://foo.localhost")
    assert not pu.is_invalid_public_base("https://tamkobi.com")
    assert not pu.is_invalid_public_base("https://app.example.com/")


def test_normalize_strips_slash_and_rejects_loopback():
    assert pu.normalize_public_base("https://tamkobi.com/") == "https://tamkobi.com"
    assert pu.normalize_public_base("http://127.0.0.1/") == ""
    assert pu.normalize_public_base("tamkobi.com") == "https://tamkobi.com"


def test_resolve_skips_invalid_platform_uses_default():
    with patch.dict(os.environ, {"PUBLIC_APP_URL": ""}, clear=False):
        assert (
            pu.resolve_public_base_url(platform_public_url="http://127.0.0.1/")
            == "https://tamkobi.com"
        )


def test_resolve_uses_public_app_url_when_platform_invalid():
    with patch.dict(os.environ, {"PUBLIC_APP_URL": "https://staging.example.com"}, clear=False):
        assert (
            pu.resolve_public_base_url(platform_public_url="http://localhost")
            == "https://staging.example.com"
        )


def test_resolve_prefers_valid_platform_over_env():
    with patch.dict(os.environ, {"PUBLIC_APP_URL": "https://env.example.com"}, clear=False):
        assert (
            pu.resolve_public_base_url(platform_public_url="https://platform.example.com/")
            == "https://platform.example.com"
        )


def test_resolve_explicit_valid_wins():
    with patch.dict(os.environ, {"PUBLIC_APP_URL": "https://env.example.com"}, clear=False):
        assert (
            pu.resolve_public_base_url(
                platform_public_url="https://platform.example.com",
                explicit="https://client.example.com/",
            )
            == "https://client.example.com"
        )


def test_resolve_explicit_invalid_falls_through():
    with patch.dict(os.environ, {"PUBLIC_APP_URL": "https://env.example.com"}, clear=False):
        assert (
            pu.resolve_public_base_url(
                platform_public_url="https://platform.example.com",
                explicit="http://127.0.0.1",
            )
            == "https://platform.example.com"
        )


def test_async_public_base_url_reads_db():
    fake_db = MagicMock()
    fake_db.platform_settings.find_one = AsyncMock(
        return_value={"_id": "platform", "public_url": "http://127.0.0.1/"}
    )
    with patch.dict(os.environ, {"PUBLIC_APP_URL": ""}, clear=False):
        out = asyncio.run(pu.public_base_url(fake_db))
    assert out == "https://tamkobi.com"


def test_invoice_share_link_rejects_loopback_platform_url():
    import saas_docs
    import signed_links

    fake_db = MagicMock()
    fake_db.platform_settings.find_one = AsyncMock(
        return_value={"_id": "platform", "public_url": "http://127.0.0.1/"}
    )
    fake_req = MagicMock()
    fake_req.base_url = "http://127.0.0.1:8000/"
    fake_user = {"id": "u1", "company_ids": ["c1"], "active_company_id": "c1"}

    async def run():
        with patch.object(saas_docs, "_db", fake_db), patch(
            "auth_utils.session_token", return_value="tok"
        ), patch(
            "auth_utils.get_user_from_token", AsyncMock(return_value=fake_user)
        ), patch(
            "tenant_access.get_tenant_doc", AsyncMock(return_value={"_id": "inv1", "company_id": "c1"})
        ), patch.dict(os.environ, {"PUBLIC_APP_URL": ""}, clear=False):
            return await saas_docs.invoice_share_link("inv1", fake_req, kind="pdf", ttl_hours=24)

    out = asyncio.run(run())
    assert out["url"].startswith("https://tamkobi.com/api/invoices/inv1/pdf?t=")
    assert "127.0.0.1" not in out["url"]
    assert signed_links.verify_doc_share_token("inv1", "invoices-pdf", out["token"])


def test_invoice_share_link_uses_env_when_platform_loopback():
    import saas_docs

    fake_db = MagicMock()
    fake_db.platform_settings.find_one = AsyncMock(
        return_value={"_id": "platform", "public_url": "http://localhost"}
    )
    fake_req = MagicMock()
    fake_req.base_url = "http://localhost:8000/"
    fake_user = {"id": "u1", "company_ids": ["c1"]}

    async def run():
        with patch.object(saas_docs, "_db", fake_db), patch(
            "auth_utils.session_token", return_value="tok"
        ), patch(
            "auth_utils.get_user_from_token", AsyncMock(return_value=fake_user)
        ), patch(
            "tenant_access.get_tenant_doc", AsyncMock(return_value={"_id": "inv2", "company_id": "c1"})
        ), patch.dict(os.environ, {"PUBLIC_APP_URL": "https://app.example.com"}, clear=False):
            return await saas_docs.invoice_share_link("inv2", fake_req, kind="pdf", ttl_hours=1)

    out = asyncio.run(run())
    assert out["url"].startswith("https://app.example.com/api/invoices/inv2/pdf?t=")


def test_invoice_share_link_uses_valid_platform_url():
    import saas_docs

    fake_db = MagicMock()
    fake_db.platform_settings.find_one = AsyncMock(
        return_value={"_id": "platform", "public_url": "https://firma.example/"}
    )
    fake_req = MagicMock()
    fake_req.base_url = "http://127.0.0.1:8000/"
    fake_user = {"id": "u1", "company_ids": ["c1"]}

    async def run():
        with patch.object(saas_docs, "_db", fake_db), patch(
            "auth_utils.session_token", return_value="tok"
        ), patch(
            "auth_utils.get_user_from_token", AsyncMock(return_value=fake_user)
        ), patch(
            "tenant_access.get_tenant_doc", AsyncMock(return_value={"_id": "inv3", "company_id": "c1"})
        ), patch.dict(os.environ, {"PUBLIC_APP_URL": "https://env.example.com"}, clear=False):
            return await saas_docs.invoice_share_link("inv3", fake_req, kind="pdf", ttl_hours=1)

    out = asyncio.run(run())
    assert out["url"].startswith("https://firma.example/api/invoices/inv3/pdf?t=")
