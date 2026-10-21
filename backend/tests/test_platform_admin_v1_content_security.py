"""admin-v1 destek eki: tam FastAPI uygulaması.

Kiracının yazdığı /api/files yolu ham depo anahtarı değildir. Dosya satırı
talebin şirketine bağlı değilse nesne okunmaz. Yanıt attachment ve nosniff taşır.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-admin-v1-content-security-jwt-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import platform_store as store  # noqa: E402
import saas  # noqa: E402
import storage_service  # noqa: E402
import support_tickets  # noqa: E402
from test_platform_admin_v1 import FakeDB, _issue, _signed_headers  # noqa: E402

_PARENT = "comp_parent"
_OTHER = "comp_other"
_GOOD = "accounts/comp_parent/sales_invoices/inv.pdf"
_SECRET = "accounts/comp_other/sales_invoices/secret.pdf"
_HTML = "support/page.html"


def _get(client, secret, key_id, path):
    headers, _, _nonce = _signed_headers(secret, key_id, "GET", path, b"")
    return client.get(path, headers=headers)


def _ticket(ticket_id, company_id, url, filename="ek.pdf"):
    return {
        "_id": ticket_id,
        "company_id": company_id,
        "messages": [{
            "id": "m1",
            "attachments": [{"url": url, "filename": filename, "content_type": "application/pdf"}],
        }],
    }


@pytest.fixture
def sec(monkeypatch):
    import server

    fake = FakeDB()
    seen = []

    def _object(path):
        seen.append(path)
        if path == _HTML:
            return b"<!doctype html><html><script>alert(1)</script></html>", "text/html"
        if path == _GOOD:
            return b"%PDF-1.4 ok", "application/pdf"
        if path == _SECRET:
            return b"secret-bytes", "application/pdf"
        raise AssertionError(path)

    prev = {
        "store": store._db,
        "saas": (saas._db, saas._current_user),
        "tickets": support_tickets._db,
        "server": server.db,
    }
    store.init(fake)
    saas.init(fake, None)
    saas.invalidate()
    support_tickets.init(fake, None)
    server.db = fake
    monkeypatch.setattr(storage_service, "get_object", _object)

    async def seed():
        await fake.companies.insert_one({"_id": _PARENT, "name": "Ust", "license_id": _PARENT})
        await fake.companies.insert_one({"_id": _OTHER, "name": "Diger", "license_id": _OTHER})
        await fake.support_tickets.insert_one(_ticket(
            "t_ok", _PARENT,
            "/api/files/" + _GOOD,
            'rapor.pdf";\r\nX-Injected: yes',
        ))
        await fake.support_tickets.insert_one(_ticket(
            "t_other", _PARENT, "/api/files/" + _SECRET + "?t=forged-token",
        ))
        await fake.support_tickets.insert_one(_ticket(
            "t_missing", _PARENT, "/api/files/support/missing.pdf",
        ))
        await fake.support_tickets.insert_one(_ticket(
            "t_html", _PARENT, "/api/files/" + _HTML,
        ))
        await fake.support_tickets.insert_one(_ticket(
            "t_dot", _PARENT, "/api/files/../../" + _SECRET,
        ))
        await fake.support_tickets.insert_one(_ticket(
            "t_deleted", _PARENT, "/api/files/support/old.pdf",
        ))
        await fake.files.insert_one({
            "_id": "f_good",
            "company_id": _PARENT,
            "storage_path": _GOOD,
            "is_deleted": False,
            "content_type": "application/pdf",
        })
        await fake.files.insert_one({
            "_id": "f_secret",
            "company_id": _OTHER,
            "storage_path": _SECRET,
            "is_deleted": False,
            "content_type": "application/pdf",
        })
        await fake.files.insert_one({
            "_id": "f_html",
            "company_id": _PARENT,
            "storage_path": _HTML,
            "is_deleted": False,
            "content_type": "text/html",
        })
        await fake.files.insert_one({
            "_id": "f_old",
            "company_id": _PARENT,
            "storage_path": "support/old.pdf",
            "is_deleted": True,
            "content_type": "application/pdf",
        })

    asyncio.run(seed())
    router = server.app.router
    saved_up = list(router.on_startup)
    saved_down = list(router.on_shutdown)
    router.on_startup.clear()
    router.on_shutdown.clear()
    client = TestClient(server.app)
    client.__enter__()
    try:
        yield client, fake, seen
    finally:
        client.__exit__(None, None, None)
        store.init(prev["store"])
        saas.init(prev["saas"][0], prev["saas"][1])
        support_tickets.init(prev["tickets"], None)
        server.db = prev["server"]
        saas.invalidate()


def test_support_attachment_requires_ticket_file_row(sec):
    client, db, seen = sec
    pub, secret = _issue(db, [store.SCOPE_ADMIN_SUPPORT_READ], name="support")

    def fetch(ticket_id):
        return _get(
            client, secret, pub["id"],
            f"/api/platform/admin-v1/support/tickets/{ticket_id}/attachments/m1/0",
        )

    other = fetch("t_other")
    assert other.status_code == 404
    assert seen == []
    assert b"secret-bytes" not in other.content

    missing = fetch("t_missing")
    assert missing.status_code == 404
    assert seen == []

    deleted = fetch("t_deleted")
    assert deleted.status_code == 404
    assert seen == []

    dotted = fetch("t_dot")
    assert dotted.status_code == 404
    assert seen == []
    assert b"secret-bytes" not in dotted.content

    html = fetch("t_html")
    assert html.status_code == 404
    assert seen == [_HTML]
    assert b"<html" not in html.content

    good = fetch("t_ok")
    assert good.status_code == 200, good.text
    assert good.content == b"%PDF-1.4 ok"
    assert seen[-1] == _GOOD
    disposition = good.headers.get("content-disposition") or ""
    assert disposition == 'attachment; filename="rapor.pdfX-Injected: yes"'
    assert "inline" not in disposition.lower()
    assert "\r" not in disposition
    assert "\n" not in disposition
    assert good.headers.get("x-injected") is None
    assert good.headers.get("x-content-type-options") == "nosniff"
    assert seen == [_HTML, _GOOD]
