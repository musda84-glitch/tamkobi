"""public_base_url: loopback reddi, PUBLIC_APP_URL, platform public_url, share-link."""
from __future__ import annotations

import asyncio
import os
from unittest.mock import AsyncMock, MagicMock, patch
from urllib.parse import urlparse

import pytest

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


def test_rewrite_loopback_invoice_pdf_uses_public_app_url():
    """12.10.2026 MTE2026000000025: SMS/e-posta metnindeki 127.0.0.1 fatura linki app URL olur."""
    raw = (
        "Sayın müşterimiz,\n\n"
        "MTE2026000000025 numaralı faturanız hazırdır.\n"
        "PDF: http://127.0.0.1/api/invoices/mte25/pdf?t=sig.1\n"
        "Ayrıca http://127.0.0.1:8000/api/e-invoice/mte25/pdf?t=sig.2"
    )
    out = pu.rewrite_loopback_doc_urls(raw, "https://app.tamkobi.com")
    assert "127.0.0.1" not in out
    assert "https://app.tamkobi.com/api/invoices/mte25/pdf?t=sig.1" in out
    assert "https://app.tamkobi.com/api/e-invoice/mte25/pdf?t=sig.2" in out
    assert "MTE2026000000025" in out
    untouched = pu.rewrite_loopback_doc_urls(
        "PDF: https://app.tamkobi.com/api/invoices/mte25/pdf?t=ok",
        "https://app.tamkobi.com",
    )
    assert untouched == "PDF: https://app.tamkobi.com/api/invoices/mte25/pdf?t=ok"


def test_rewrite_outbound_ignores_request_host():
    fake_db = MagicMock()
    fake_db.platform_settings.find_one = AsyncMock(
        return_value={"_id": "platform", "public_url": "https://tamkobi.com"}
    )
    text = "PDF: http://localhost:3000/api/invoices/mte25/pdf?t=abc MTE2026000000025"

    async def run():
        with patch.dict(
            os.environ,
            {"PUBLIC_APP_URL": "", "PUBLIC_APP_HOST_URL": "http://127.0.0.1:3000"},
            clear=False,
        ):
            return await pu.rewrite_outbound_doc_text(fake_db, text)

    out = asyncio.run(run())
    assert out.startswith("PDF: https://app.tamkobi.com/api/invoices/mte25/pdf?t=abc")
    assert "127.0.0.1" not in out
    assert "localhost" not in out


def test_mail_customer_copy_rewrites_loopback_pdf():
    import mail_accounts

    fake_db = MagicMock()
    fake_db.platform_settings.find_one = AsyncMock(
        return_value={"_id": "platform", "public_url": "https://tamkobi.com"}
    )
    prev = mail_accounts._db
    mail_accounts._db = fake_db
    body = (
        "MTE2026000000025\n"
        "PDF: http://127.0.0.1/api/invoices/mte25/pdf?t=tok"
    )
    html = '<a href="http://127.0.0.1:8000/api/invoices/mte25/pdf?t=tok">PDF</a>'

    async def run():
        with patch.dict(os.environ, {"PUBLIC_APP_URL": "", "PUBLIC_APP_HOST_URL": ""}, clear=False):
            plain = await mail_accounts._rewrite_customer_copy(body)
            rich = await mail_accounts._rewrite_customer_copy(html)
            same = await mail_accounts._rewrite_customer_copy("şifre sıfırlama kodunuz 1234")
            return plain, rich, same

    try:
        plain, rich, same = asyncio.run(run())
    finally:
        mail_accounts._db = prev
    assert "https://app.tamkobi.com/api/invoices/mte25/pdf?t=tok" in plain
    assert "127.0.0.1" not in plain and "127.0.0.1" not in rich
    assert 'href="https://app.tamkobi.com/api/invoices/mte25/pdf?t=tok"' in rich
    assert same == "şifre sıfırlama kodunuz 1234"


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
    # Fatura paylaşım linkleri app alt alan adına gider
    assert out["url"].startswith("https://app.tamkobi.com/api/invoices/inv1/pdf?t=")
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
        ), patch.dict(
            os.environ,
            {
                "PUBLIC_APP_URL": "https://site.example.com",
                "PUBLIC_APP_HOST_URL": "https://app.example.com",
            },
            clear=False,
        ):
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
        ), patch.dict(
            os.environ,
            {"PUBLIC_APP_URL": "https://env.example.com", "PUBLIC_APP_HOST_URL": ""},
            clear=False,
        ):
            return await saas_docs.invoice_share_link("inv3", fake_req, kind="pdf", ttl_hours=1)

    out = asyncio.run(run())
    assert out["url"].startswith("https://app.firma.example/api/invoices/inv3/pdf?t=")


class _Headers(dict):
    def get(self, key, default=None):
        if key in self:
            return dict.get(self, key, default)
        wanted = str(key).lower()
        for name, value in self.items():
            if str(name).lower() == wanted:
                return value
        return default


class _Req:
    """base_url okunursa test düşer. Host başlığı da sonuçta yer almamalı."""

    def __init__(self, headers=None, base_url="http://127.0.0.1:8000/"):
        self.headers = _Headers(headers or {})
        self._base_url = base_url
        self.base_url_reads = 0

    @property
    def base_url(self):
        self.base_url_reads += 1
        return self._base_url


def _loopback_db(public_url="http://127.0.0.1/"):
    fake_db = MagicMock()
    fake_db.platform_settings.find_one = AsyncMock(
        return_value={"_id": "platform", "public_url": public_url}
    )
    return fake_db


def _no_loopback(text: str):
    raw = text or ""
    assert "127.0.0.1" not in raw
    assert "localhost" not in raw
    assert "0.0.0.0" not in raw
    assert "[::1]" not in raw


def test_public_link_skips_loopback_platform_and_explicit():
    fake_db = _loopback_db()
    req = _Req({"host": "127.0.0.1:8000"})

    async def run():
        with patch.dict(os.environ, {"PUBLIC_APP_URL": "", "PUBLIC_APP_HOST_URL": ""}, clear=False):
            slashed = await pu.public_link(
                fake_db, "/teklif/x", explicit="http://localhost:3000", request=req,
            )
            bare = await pu.public_link(
                fake_db, "teklif/x", explicit="http://127.0.0.1/", request=req,
            )
            return slashed, bare

    slashed, bare = asyncio.run(run())
    assert slashed == "https://app.tamkobi.com/teklif/x"
    assert bare == slashed
    _no_loopback(slashed)
    assert req.base_url_reads == 0
    assert "127.0.0.1:8000" not in slashed


def test_public_link_uses_public_app_host_url():
    fake_db = _loopback_db()
    req = _Req({
        "host": "127.0.0.1:8000",
        "x-forwarded-host": "cdn.tamkobi.com",
        "x-forwarded-proto": "https",
    })

    async def run():
        with patch.dict(
            os.environ,
            {"PUBLIC_APP_URL": "", "PUBLIC_APP_HOST_URL": "https://app.example.com"},
            clear=False,
        ):
            return await pu.public_link(fake_db, "/teklif/x", explicit="http://localhost:3000", request=req)

    out = asyncio.run(run())
    assert out == "https://app.example.com/teklif/x"
    _no_loopback(out)
    assert req.base_url_reads == 0


def test_public_link_sync_skips_loopback_platform():
    with patch.dict(os.environ, {"PUBLIC_APP_URL": "", "PUBLIC_APP_HOST_URL": ""}, clear=False):
        out = pu.public_link_sync("teklif/x", "app", "http://127.0.0.1/")
    assert out == "https://app.tamkobi.com/teklif/x"
    _no_loopback(out)


def test_forwarded_ignored_when_platform_or_env_valid():
    fake_db = _loopback_db("https://firma.example/")
    req = _Req({
        "host": "127.0.0.1:8000",
        "x-forwarded-host": "files.firma.example",
        "x-forwarded-proto": "http",
    })

    async def run():
        with patch.dict(os.environ, {"PUBLIC_APP_URL": "", "PUBLIC_APP_HOST_URL": ""}, clear=False):
            return await pu.public_link(fake_db, "/teklif/x", request=req)

    out = asyncio.run(run())
    assert out == "https://app.firma.example/teklif/x"
    _no_loopback(out)
    assert req.base_url_reads == 0
    assert "http://127.0.0.1:8000/" not in out


def test_forwarded_loopback_and_evil_host_fall_back():
    fake_db = _loopback_db()

    async def one(host):
        req = _Req({
            "host": "127.0.0.1:8000",
            "x-forwarded-host": host,
            "x-forwarded-proto": "https",
        })
        with patch.dict(os.environ, {"PUBLIC_APP_URL": "", "PUBLIC_APP_HOST_URL": ""}, clear=False):
            out = await pu.public_link(fake_db, "/proje/x", request=req)
        assert req.base_url_reads == 0
        return out

    async def run():
        return [await one(host) for host in ("127.0.0.1", "evil.com", "localhost:3000")]

    outs = asyncio.run(run())
    assert outs == ["https://app.tamkobi.com/proje/x"] * 3
    for out in outs:
        _no_loopback(out)


_FORWARDED_BYPASS_HOSTS = (
    "evil.com?.tamkobi.com",
    "evil.com#.tamkobi.com",
    "evil.com@app.tamkobi.com",
    "evil.com;.tamkobi.com",
    "evil.com%2F.tamkobi.com",
    "evil-tamkobi.com",
    "tamkobi.com.evil.com",
    "app_tamkobi.com",
    "app.tamkobi.com:8443",
    "[::1]",
    "127.0.0.1",
    "x.localhost",
)


@pytest.mark.parametrize("host", _FORWARDED_BYPASS_HOSTS)
def test_forwarded_host_bypass_uses_app_root(host):
    fake_db = _loopback_db()
    req = _Req({
        "host": "127.0.0.1:8000",
        "x-forwarded-host": host,
        "x-forwarded-proto": "https",
    })

    async def run():
        with patch.dict(os.environ, {"PUBLIC_APP_URL": "", "PUBLIC_APP_HOST_URL": ""}, clear=False):
            return await pu.public_link(fake_db, "/teklif/T?t=1", request=req)

    out = asyncio.run(run())
    assert out == "https://app.tamkobi.com/teklif/T?t=1"
    assert urlparse(out).hostname == "app.tamkobi.com"
    assert req.base_url_reads == 0


def test_forwarded_https_allowed_host_keeps_query_path():
    fake_db = _loopback_db()
    req = _Req({
        "host": "127.0.0.1:8000",
        "x-forwarded-host": "cdn.tamkobi.com",
        "x-forwarded-proto": "https",
    })

    async def run():
        with patch.dict(os.environ, {"PUBLIC_APP_URL": "", "PUBLIC_APP_HOST_URL": ""}, clear=False):
            return await pu.public_link(fake_db, "/teklif/T?t=1", request=req)

    out = asyncio.run(run())
    assert out == "https://cdn.tamkobi.com/teklif/T?t=1"
    assert urlparse(out).hostname == "cdn.tamkobi.com"
    assert req.base_url_reads == 0


def test_forwarded_http_proto_falls_back_to_app_root():
    fake_db = _loopback_db()
    req = _Req({
        "host": "127.0.0.1:8000",
        "x-forwarded-host": "cdn.tamkobi.com",
        "x-forwarded-proto": "http",
    })

    async def run():
        with patch.dict(os.environ, {"PUBLIC_APP_URL": "", "PUBLIC_APP_HOST_URL": ""}, clear=False):
            return await pu.public_link(fake_db, "/teklif/T?t=1", request=req)

    out = asyncio.run(run())
    assert out == "https://app.tamkobi.com/teklif/T?t=1"
    assert urlparse(out).hostname == "app.tamkobi.com"
    assert "cdn.tamkobi.com" not in out
    assert req.base_url_reads == 0


def test_forwarded_allowed_host_is_last_resort():
    fake_db = _loopback_db()
    req = _Req({
        "host": "127.0.0.1:8000",
        "x-forwarded-host": "cdn.tamkobi.com",
        "x-forwarded-proto": "https",
    })

    async def run():
        with patch.dict(os.environ, {"PUBLIC_APP_URL": "", "PUBLIC_APP_HOST_URL": ""}, clear=False):
            return await pu.public_link(fake_db, "/ekstre/x", request=req)

    out = asyncio.run(run())
    assert out == "https://cdn.tamkobi.com/ekstre/x"
    _no_loopback(out)
    assert req.base_url_reads == 0
    assert "127.0.0.1:8000" not in out


def test_public_link_b2b_ignores_client_base():
    fake_db = _loopback_db()
    req = _Req({"host": "127.0.0.1:3000", "x-forwarded-host": "evil.com", "x-forwarded-proto": "http"})

    async def run():
        with patch.dict(
            os.environ,
            {"PUBLIC_APP_URL": "", "PUBLIC_APP_HOST_URL": "", "PUBLIC_B2B_URL": ""},
            clear=False,
        ):
            return await pu.public_link(
                fake_db, "/b2b/sifre/tok", context="b2b", explicit="http://127.0.0.1:3000", request=req,
            )

    out = asyncio.run(run())
    assert out == "https://b2b.tamkobi.com/b2b/sifre/tok"
    _no_loopback(out)
    assert req.base_url_reads == 0


def test_rewrite_loopback_customer_paths():
    raw = " ".join([
        "http://127.0.0.1/teklif/t",
        "http://localhost:3000/proje/t",
        "http://127.0.0.1:8000/api/public/statements/t/pdf",
        "http://[::1]/api/files/a.pdf?t=x",
        "http://0.0.0.0/ekstre/t",
        "http://127.0.0.1/portal/t",
        "http://localhost/davet/t",
        "http://127.0.0.1/b2b/sifre/t",
        "http://127.0.0.1/yenile/t",
        "http://127.0.0.1/api/quotes/t/pdf",
        "https://tamkobi.com/teklif/keep",
        "https://example.com/127.0.0.1",
        "http://127.0.0.1/login",
    ])
    out = pu.rewrite_loopback_doc_urls(raw, "https://app.tamkobi.com")
    assert "https://app.tamkobi.com/teklif/t" in out
    assert "https://app.tamkobi.com/proje/t" in out
    assert "https://app.tamkobi.com/api/public/statements/t/pdf" in out
    assert "https://app.tamkobi.com/api/files/a.pdf?t=x" in out
    assert "https://app.tamkobi.com/ekstre/t" in out
    assert "https://app.tamkobi.com/portal/t" in out
    assert "https://app.tamkobi.com/davet/t" in out
    assert "https://app.tamkobi.com/b2b/sifre/t" in out
    assert "https://app.tamkobi.com/yenile/t" in out
    assert "https://app.tamkobi.com/api/quotes/t/pdf" in out
    assert "https://tamkobi.com/teklif/keep" in out
    assert "https://example.com/127.0.0.1" in out
    assert "http://127.0.0.1/login" in out
    kept = out.replace("https://example.com/127.0.0.1", "").replace("http://127.0.0.1/login", "")
    _no_loopback(kept)


def test_mail_customer_copy_rewrites_quote_link():
    import mail_accounts

    fake_db = _loopback_db("https://tamkobi.com")
    prev = mail_accounts._db
    mail_accounts._db = fake_db
    body = "Onay: http://127.0.0.1/teklif/T"

    async def run():
        with patch.dict(os.environ, {"PUBLIC_APP_URL": "", "PUBLIC_APP_HOST_URL": ""}, clear=False):
            return await mail_accounts._rewrite_customer_copy(body)

    try:
        out = asyncio.run(run())
    finally:
        mail_accounts._db = prev
    assert out.count("https://app.tamkobi.com/teklif/T") == 1
    _no_loopback(out)


def test_einvoice_share_link_rejects_loopback():
    import e_invoice

    fake_db = _loopback_db()
    fake_req = _Req()
    fake_user = {"id": "u1", "company_ids": ["c1"], "active_company_id": "c1"}

    async def run():
        with patch.object(e_invoice, "_db", fake_db), patch(
            "auth_utils.session_token", return_value="tok"
        ), patch(
            "auth_utils.get_user_from_token", AsyncMock(return_value=fake_user)
        ), patch(
            "tenant_access.get_tenant_doc", AsyncMock(return_value={"_id": "inv1", "company_id": "c1"})
        ), patch.dict(os.environ, {"PUBLIC_APP_URL": "", "PUBLIC_APP_HOST_URL": ""}, clear=False):
            return await e_invoice.einvoice_share_link("inv1", fake_req, kind="pdf", ttl_hours=24)

    out = asyncio.run(run())
    assert out["url"].startswith("https://app.tamkobi.com/api/e-invoice/inv1/pdf?t=")
    assert "t=" in out["url"]
    _no_loopback(out["url"])
    assert fake_req.base_url_reads == 0


def _assert_single_public_link(text: str, link: str):
    assert text.count(link) == 1
    _no_loopback(text)


def test_send_quote_approval_rewrites_message_before_append():
    import server

    quote = {
        "_id": "q1",
        "company_id": "c1",
        "contact_id": "ct1",
        "contact_name": "Ali",
        "quote_number": "TKF1",
        "title": "Teklif",
        "items": [],
        "grand_total": 10,
        "status": "draft",
        "approval": {"token": "T"},
    }
    user = {"id": "u1", "company_ids": ["c1"], "active_company_id": "c1"}
    body = {
        "channels": ["sms", "email", "whatsapp"],
        "phone": "5551112233",
        "email": "ali@musteri.com",
        "message": "Teklif: http://127.0.0.1/teklif/T",
        "base_url": "http://127.0.0.1:3000",
    }
    request = _Req({"host": "127.0.0.1:8000"})
    fake_db = _loopback_db()
    fake_db.contacts.find_one = AsyncMock(return_value={"_id": "ct1", "phone": "5551112233", "email": "ali@musteri.com"})
    fake_db.companies.find_one = AsyncMock(return_value={"_id": "c1", "name": "Firma"})
    fake_db.quotes.update_one = AsyncMock()
    fake_db.whatsapp_settings.find_one = AsyncMock(return_value={})
    fake_db.whatsapp_logs.insert_one = AsyncMock()
    sms = AsyncMock(return_value={"status": "sent", "sent": 1, "failed": 0, "simulated": False, "message": "ok"})
    mail = AsyncMock(return_value={"_id": "log1"})
    account = AsyncMock(return_value={"email": "from@firma.com"})
    link = "https://app.tamkobi.com/teklif/T"

    async def run():
        with patch.dict(os.environ, {"PUBLIC_APP_URL": "", "PUBLIC_APP_HOST_URL": ""}, clear=False), \
             patch.object(server, "db", fake_db), \
             patch.object(server.tenant_access, "get_tenant_doc", AsyncMock(return_value=quote)), \
             patch.object(server, "_fill_stock_codes", AsyncMock()), \
             patch.object(server, "_send_sms_to", sms), \
             patch.object(server, "_mail_account", account), \
             patch.object(server, "_send_tracked_mail", mail):
            return await server.send_quote_approval("q1", body, request, user)

    out = asyncio.run(run())
    assert out["link"] == link
    _no_loopback(out["link"])
    _assert_single_public_link(sms.await_args.args[2], link)
    _assert_single_public_link(mail.await_args.kwargs["body"], link)
    html = mail.await_args.kwargs["html"]
    _no_loopback(html)
    assert html.count(link) == 2
    wa = out["results"]["whatsapp"]["wa_link"]
    _no_loopback(wa)
    assert wa.count("app.tamkobi.com/teklif/T") == 1
    logged = fake_db.whatsapp_logs.insert_one.await_args.args[0]
    _assert_single_public_link(logged["message"], link)
    assert request.base_url_reads == 0


def test_send_project_tracking_rewrites_message_before_append():
    import server

    project = {
        "_id": "p1",
        "company_id": "c1",
        "contact_id": "ct1",
        "contact_name": "Ali",
        "project_number": "PRJ1",
        "name": "Mutfak",
        "tracking": {"token": "T", "sent_count": 0},
    }
    user = {"id": "u1", "company_ids": ["c1"], "active_company_id": "c1"}
    body = {
        "channels": ["sms", "email", "whatsapp"],
        "phone": "5551112233",
        "email": "ali@musteri.com",
        "message": "Takip: http://127.0.0.1/proje/T",
        "base_url": "http://localhost:3000",
    }
    request = _Req({"host": "127.0.0.1:8000"})
    fake_db = _loopback_db()
    fake_db.contacts.find_one = AsyncMock(return_value={"_id": "ct1"})
    fake_db.companies.find_one = AsyncMock(return_value={"_id": "c1", "name": "Firma"})
    fake_db.projects.update_one = AsyncMock()
    fake_db.whatsapp_settings.find_one = AsyncMock(return_value={})
    fake_db.whatsapp_logs.insert_one = AsyncMock()
    sms = AsyncMock(return_value={"status": "sent", "sent": 1, "failed": 0, "simulated": False, "message": "ok"})
    mail = AsyncMock(return_value={"_id": "log1"})
    account = AsyncMock(return_value={"email": "from@firma.com"})
    link = "https://app.tamkobi.com/proje/T"

    async def run():
        with patch.dict(os.environ, {"PUBLIC_APP_URL": "", "PUBLIC_APP_HOST_URL": ""}, clear=False), \
             patch.object(server, "db", fake_db), \
             patch.object(server.tenant_access, "get_tenant_doc", AsyncMock(return_value=project)), \
             patch.object(server, "_send_sms_to", sms), \
             patch.object(server, "_mail_account", account), \
             patch.object(server, "_send_tracked_mail", mail):
            return await server.send_project_tracking("p1", body, request, user)

    out = asyncio.run(run())
    assert out["link"] == link
    _no_loopback(out["link"])
    _assert_single_public_link(sms.await_args.args[2], link)
    _assert_single_public_link(mail.await_args.kwargs["body"], link)
    html = mail.await_args.kwargs["html"]
    _no_loopback(html)
    assert html.count(link) == 2
    wa = out["results"]["whatsapp"]["wa_link"]
    _no_loopback(wa)
    assert wa.count("app.tamkobi.com/proje/T") == 1
    assert request.base_url_reads == 0


def test_wa_send_link_has_no_loopback():
    import server

    fake_db = _loopback_db("https://tamkobi.com")
    fake_db.whatsapp_settings.find_one = AsyncMock(return_value={})
    fake_db.whatsapp_logs.insert_one = AsyncMock()

    async def run():
        with patch.dict(os.environ, {"PUBLIC_APP_URL": "", "PUBLIC_APP_HOST_URL": ""}, clear=False), \
             patch.object(server, "db", fake_db):
            return await server.wa_send({
                "company_id": "c1",
                "phone": "5551112233",
                "message": "PDF: http://127.0.0.1:8000/api/public/statements/T/pdf ve http://localhost/teklif/T",
            })

    out = asyncio.run(run())
    _no_loopback(out["message"])
    _no_loopback(out["wa_link"])
    assert out["message"].count("https://app.tamkobi.com/api/public/statements/T/pdf") == 1
    assert out["message"].count("https://app.tamkobi.com/teklif/T") == 1
    assert out["wa_link"].count("app.tamkobi.com/teklif/T") == 1
    assert out["wa_link"].count("app.tamkobi.com/api/public/statements/T/pdf") == 1
