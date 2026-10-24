"""SVG dosya sunumu: betik çalışmaz, logo/ürün <img> türü bozulmaz.

Bellek içi koleksiyon. Canlı veritabanına ve 8021 portuna bağlanmaz.
Dosya gövdesi ve paylaşım token'ı loglanmaz.
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

os.environ.setdefault("JWT_SECRET", "test-svg-file-headers-jwt-secret-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import auth_utils  # noqa: E402
import server  # noqa: E402
import shopfloor_drawing  # noqa: E402
from dashboard_memdb import MemDB  # noqa: E402

APP = "tamkobi"
SVG_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox"
SCRIPT_SVG = (
    b"<?xml version='1.0'?>"
    b"<svg xmlns='http://www.w3.org/2000/svg'>"
    b"<script>window.__xss=1;alert(1)</script>"
    b"<rect width='10' height='10' style='fill:#036'/>"
    b"</svg>"
)
JPEG = b"\xff\xd8\xff" + b"jpeg-bytes-not-html" * 4
PNG = b"\x89PNG\r\n\x1a\n" + b"png-bytes" * 4
WEBP = b"RIFF" + b"\x00\x00\x00\x00" + b"WEBP" + b"webp-bytes" * 2
GIF = b"GIF89a" + b"gif-bytes" * 4


def _run(coro):
    return asyncio.run(coro)


def _storage(area: str, company: str = "compA", name: str = "logo.svg") -> str:
    return f"{APP}/accounts/{company}/{area}/{name}"


class _Req:
    def __init__(self, storage: str, *, bearer=None):
        self.headers = {}
        if bearer:
            self.headers["Authorization"] = f"Bearer {bearer}"
        self.cookies = {}
        self.url = SimpleNamespace(path=f"/api/files/{storage}")
        self.method = "GET"
        self.query_params = {}
        self.client = None


def _user(uid, companies, *, superadmin=False):
    return {
        "_id": uid,
        "email": f"{uid}@example.com",
        "role": "admin",
        "is_active": True,
        "is_super_admin": superadmin,
        "company_ids": list(companies),
        "active_company_id": companies[0] if companies else None,
    }


def _token(uid):
    return auth_utils.create_access_token(uid, f"{uid}@example.com", "admin")


@pytest.fixture
def files_db(monkeypatch):
    mem = MemDB()
    monkeypatch.setattr(server, "db", mem)
    state = {"calls": [], "payload": SCRIPT_SVG, "ctype": "image/svg+xml", "error": None}

    def _get(path):
        state["calls"].append(path)
        if state["error"] is not None:
            raise state["error"]
        return state["payload"], state["ctype"]

    monkeypatch.setattr(server, "get_object", _get)
    return mem, state


def _insert(mem, storage, company, content_type="image/svg+xml"):
    _run(mem.files.insert_one({
        "_id": "f-" + storage,
        "storage_path": storage,
        "company_id": company,
        "content_type": content_type,
        "is_deleted": False,
    }))


def _serve(storage, *, bearer=None, t=None, w=None, fmt=None):
    return _run(server.serve_file(storage, _Req(storage, bearer=bearer), w=w, fmt=fmt, t=t))


def _expect_404(storage, **kw):
    with pytest.raises(HTTPException) as exc:
        _serve(storage, **kw)
    assert exc.value.status_code == 404
    assert exc.value.detail == "Dosya bulunamadı."


def _assert_display_svg(resp, body: bytes):
    """image/svg+xml <img> için kalır. sandbox allow-scripts içermez, betik çalışmaz."""
    assert resp.status_code == 200
    assert resp.body == body
    assert resp.media_type == "image/svg+xml"
    assert resp.headers["content-type"].split(";")[0].strip() == "image/svg+xml"
    csp = resp.headers["content-security-policy"]
    assert csp == SVG_CSP
    assert csp == shopfloor_drawing.DISPLAY_SVG_CSP
    directives = [part.strip() for part in csp.split(";")]
    assert "default-src 'none'" in directives
    assert "style-src 'unsafe-inline'" in directives
    assert "sandbox" in directives
    assert "allow-scripts" not in csp
    assert resp.headers["x-content-type-options"] == "nosniff"
    disposition = resp.headers.get("content-disposition", "")
    assert "attachment" not in disposition
    assert b"<script>" in resp.body


def test_script_svg_document_cannot_execute(files_db):
    mem, state = files_db
    storage = _storage("products", name="mark.svg")
    _insert(mem, storage, "compA")
    state["payload"] = SCRIPT_SVG
    state["ctype"] = "image/svg+xml"
    resp = _serve(storage)
    _assert_display_svg(resp, SCRIPT_SVG)
    assert state["calls"] == [storage]


def test_product_and_company_logo_svg_stay_tokenless_for_img(files_db):
    mem, state = files_db
    state["payload"] = SCRIPT_SVG
    state["ctype"] = "image/svg+xml"
    for area, name in (("products", "urun.svg"), ("company", "logo.svg")):
        storage = _storage(area, name=name)
        _insert(mem, storage, "compA")
        resp = _serve(storage)
        _assert_display_svg(resp, SCRIPT_SVG)
    assert all("t=" not in call for call in state["calls"])


def test_svg_without_file_row_still_tokenless_when_area_is_public(files_db):
    _mem, state = files_db
    storage = _storage("quotes", name="gorsel.svg")
    state["payload"] = SCRIPT_SVG
    state["ctype"] = "image/svg+xml; charset=utf-8"
    resp = _serve(storage)
    _assert_display_svg(resp, SCRIPT_SVG)


@pytest.mark.parametrize(
    "name,payload,ctype",
    [
        ("photo.jpg", JPEG, "image/jpeg"),
        ("photo.png", PNG, "image/png"),
        ("photo.webp", WEBP, "image/webp"),
        ("photo.gif", GIF, "image/gif"),
    ],
)
def test_raster_product_images_stay_inline(files_db, name, payload, ctype):
    mem, state = files_db
    storage = _storage("products", name=name)
    _insert(mem, storage, "compA", content_type=ctype)
    state["payload"] = payload
    state["ctype"] = ctype
    resp = _serve(storage)
    assert resp.status_code == 200
    assert resp.body == payload
    assert resp.media_type == ctype
    assert "content-security-policy" not in resp.headers
    assert "content-disposition" not in resp.headers
    assert resp.headers.get("cache-control", "").startswith("public")


def test_sniffed_svg_bytes_are_not_served_as_active_svg(files_db):
    mem, state = files_db
    storage = _storage("products", name="photo.png")
    _insert(mem, storage, "compA", content_type="image/png")
    state["payload"] = SCRIPT_SVG
    state["ctype"] = "image/png"
    resp = _serve(storage)
    assert resp.status_code == 200
    assert resp.media_type == "image/png"
    assert resp.headers["x-content-type-options"] == "nosniff"
    assert resp.headers["content-security-policy"] == SVG_CSP
    assert "allow-scripts" not in resp.headers["content-security-policy"]
    assert "attachment" not in resp.headers.get("content-disposition", "")


def test_sensitive_svg_anonymous_is_404_and_member_gets_safe_headers(files_db):
    mem, state = files_db
    storage = _storage("expenses", name="not.svg")
    _insert(mem, storage, "compA")
    state["payload"] = SCRIPT_SVG
    state["ctype"] = "image/svg+xml"
    _expect_404(storage)
    assert state["calls"] == []
    _run(mem.users.insert_one(_user("ua", ["compA"])))
    _run(mem.users.insert_one(_user("ub", ["compB"])))
    _expect_404(storage, bearer=_token("ub"))
    assert state["calls"] == []
    resp = _serve(storage, bearer=_token("ua"))
    _assert_display_svg(resp, SCRIPT_SVG)
    assert state["calls"] == [storage]


def test_signed_svg_download_stays_attachment(files_db):
    mem, state = files_db
    storage = _storage("products", name="mark.svg")
    _insert(mem, storage, "compA")
    state["payload"] = SCRIPT_SVG
    resp = _serve(storage, t="signed-token")
    assert resp.media_type == "application/octet-stream"
    assert resp.headers["content-disposition"] == "attachment"
    assert resp.headers["x-content-type-options"] == "nosniff"
    assert resp.headers["content-security-policy"] == "sandbox"
    assert "allow-scripts" not in resp.headers["content-security-policy"]
    assert resp.body == SCRIPT_SVG


def test_resize_query_on_svg_still_blocks_script(files_db, monkeypatch):
    mem, state = files_db
    storage = _storage("company", name="logo.svg")
    _insert(mem, storage, "compA")
    state["payload"] = SCRIPT_SVG
    state["ctype"] = "image/svg+xml"

    def _get(path):
        state["calls"].append(path)
        if path != storage:
            raise FileNotFoundError(path)
        return state["payload"], state["ctype"]

    monkeypatch.setattr(server, "get_object", _get)
    resp = _serve(storage, w=128)
    _assert_display_svg(resp, SCRIPT_SVG)


def test_svg_cache_hit_keeps_img_type_and_blocks_script(files_db):
    mem, state = files_db
    storage = _storage("products", name="mark.svg")
    _insert(mem, storage, "compA")
    state["payload"] = SCRIPT_SVG
    state["ctype"] = "image/svg+xml"
    resp = _serve(storage, w=128)
    _assert_display_svg(resp, SCRIPT_SVG)
    assert resp.headers["x-image-cache"] == "hit"


def test_serve_does_not_log_svg_body_or_token(files_db, caplog):
    mem, state = files_db
    storage = _storage("products", name="mark.svg")
    _insert(mem, storage, "compA")
    marker = "SVG_BODY_MARKER_9f3c"
    token = "share-token-should-not-be-logged-9f3c"
    state["payload"] = SCRIPT_SVG + marker.encode()
    state["ctype"] = "image/svg+xml"
    with caplog.at_level(logging.DEBUG):
        resp = _serve(storage, t=token)
    assert resp.status_code == 200
    logged = caplog.text
    assert marker not in logged
    assert token not in logged
    assert "alert(1)" not in logged
