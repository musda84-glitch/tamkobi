"""Dosya önbelleği: ETag, 304, HEAD, küçük resim, yetkisiz red.

Bellek içi koleksiyon. Canlı veritabanına bağlanmaz.
Dosya gövdesi ve paylaşım token'ı loglanmaz. Orijinal baytların üzerine yazılmaz.
"""
from __future__ import annotations

import asyncio
import io
import logging
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from PIL import Image

os.environ.setdefault("JWT_SECRET", "test-file-image-cache-jwt-secret-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import auth_utils  # noqa: E402
import image_opt  # noqa: E402
import server  # noqa: E402
import storage_service  # noqa: E402
from dashboard_memdb import MemDB  # noqa: E402

APP = "tamkobi"


def _run(coro):
    return asyncio.run(coro)


def _jpeg(edge: int = 480) -> bytes:
    im = Image.effect_noise((edge, edge), 64).convert("RGB")
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=90)
    return buf.getvalue()


def _storage(area: str, company: str = "compA", name: str = "photo.jpg") -> str:
    return f"{APP}/accounts/{company}/{area}/{name}"


class _Req:
    def __init__(self, storage: str, *, bearer=None, method="GET", headers=None):
        self.headers = dict(headers or {})
        if bearer:
            self.headers["Authorization"] = f"Bearer {bearer}"
        self.cookies = {}
        self.url = SimpleNamespace(path=f"/api/files/{storage}")
        self.method = method
        self.query_params = {}
        self.client = None


def _user(uid, companies):
    return {
        "_id": uid,
        "email": f"{uid}@example.com",
        "role": "admin",
        "is_active": True,
        "is_super_admin": False,
        "company_ids": list(companies),
        "active_company_id": companies[0] if companies else None,
    }


def _token(uid):
    return auth_utils.create_access_token(uid, f"{uid}@example.com", "admin")


@pytest.fixture
def files_db(monkeypatch):
    mem = MemDB()
    monkeypatch.setattr(server, "db", mem)
    state = {"calls": [], "puts": [], "payload": b"", "ctype": "image/jpeg"}
    store = {}

    def _get(path):
        state["calls"].append(path)
        if path in store:
            return store[path]
        if state["payload"]:
            return state["payload"], state["ctype"]
        raise FileNotFoundError(path)

    def _put(path, data, content_type):
        state["puts"].append(path)
        store[path] = (data, content_type)
        return {"path": path, "size": len(data)}

    monkeypatch.setattr(server, "get_object", _get)
    monkeypatch.setattr(server, "put_object", _put)
    state["store"] = store
    return mem, state


def _insert(mem, storage, company, content_type="image/jpeg"):
    _run(mem.files.insert_one({
        "_id": "f-" + storage,
        "storage_path": storage,
        "company_id": company,
        "content_type": content_type,
        "is_deleted": False,
    }))


def _serve(storage, *, method="GET", headers=None, bearer=None, w=None, fmt=None, t=None):
    return _run(server.serve_file(
        storage,
        _Req(storage, bearer=bearer, method=method, headers=headers),
        w=w, fmt=fmt, t=t,
    ))


def test_public_image_has_long_cache_and_etag(files_db):
    mem, state = files_db
    storage = _storage("products")
    raw = _jpeg(120)
    state["payload"] = raw
    state["ctype"] = "image/jpeg"
    _insert(mem, storage, "compA")
    resp = _serve(storage)
    assert resp.status_code == 200
    assert resp.body == raw
    assert resp.headers["cache-control"].startswith("public")
    assert "max-age=31536000" in resp.headers["cache-control"]
    assert "immutable" not in resp.headers["cache-control"]
    assert resp.headers["etag"]


def test_second_request_is_304_without_storage_read(files_db):
    mem, state = files_db
    storage = _storage("products", name="again.jpg")
    raw = _jpeg(96)
    state["payload"] = raw
    _insert(mem, storage, "compA")
    first = _serve(storage)
    etag = first.headers["etag"]
    state["calls"].clear()
    second = _serve(storage, headers={"if-none-match": etag})
    assert second.status_code == 304
    assert second.body == b""
    assert second.headers["etag"] == etag
    assert state["calls"] == []


def test_sensitive_cache_is_private_and_anonymous_stays_404(files_db):
    mem, state = files_db
    storage = _storage("expenses", name="fis.jpg")
    state["payload"] = _jpeg(64)
    _insert(mem, storage, "compA")
    with pytest.raises(HTTPException) as exc:
        _serve(storage, method="HEAD")
    assert exc.value.status_code == 404
    assert state["calls"] == []
    _run(mem.users.insert_one(_user("ua", ["compA"])))
    _run(mem.users.insert_one(_user("ub", ["compB"])))
    with pytest.raises(HTTPException) as denied:
        _serve(storage, bearer=_token("ub"))
    assert denied.value.status_code == 404
    assert state["calls"] == []
    resp = _serve(storage, bearer=_token("ua"))
    assert resp.status_code == 200
    assert resp.headers["cache-control"].startswith("private")
    assert "public" not in resp.headers["cache-control"]
    assert resp.headers["etag"]


def test_thumb_is_stored_beside_original_and_reused(files_db):
    mem, state = files_db
    storage = _storage("products", name="big.jpg")
    raw = _jpeg(640)
    state["store"][storage] = (raw, "image/jpeg")
    state["payload"] = b""
    _insert(mem, storage, "compA", content_type="image/jpeg")
    calls = []
    real_to_thread = asyncio.to_thread

    async def _spy(fn, *args, **kwargs):
        calls.append(getattr(fn, "__name__", ""))
        return await real_to_thread(fn, *args, **kwargs)

    monkey = pytest.MonkeyPatch()
    monkey.setattr(server.asyncio, "to_thread", _spy)
    try:
        resp = _serve(storage, w=200)
    finally:
        monkey.undo()
    assert resp.status_code == 200
    assert resp.headers["x-image-cache"] == "miss"
    assert len(resp.body) < len(raw)
    cache_key = image_opt.resize_cache_path(storage, 200, "webp")
    assert cache_key != storage
    assert state["puts"] == [cache_key]
    assert state["store"][storage][0] == raw
    assert "make_thumbnail" in calls
    assert "_get" in calls
    state["calls"].clear()
    again = _serve(storage, w=200)
    assert again.status_code == 200
    assert again.headers["x-image-cache"] == "hit"
    assert again.body == resp.body
    assert storage not in state["calls"]


def test_head_uses_stat_and_skips_body_read(tmp_path, monkeypatch):
    mem = MemDB()
    monkeypatch.setattr(server, "db", mem)
    monkeypatch.setattr(storage_service, "LOCAL_ROOT", tmp_path)
    monkeypatch.setattr(storage_service, "_backend", "local")
    calls = []
    real_get = storage_service.get_object

    def _get(path):
        calls.append(path)
        return real_get(path)

    monkeypatch.setattr(server, "get_object", _get)
    storage = _storage("quotes", name="card.jpg")
    raw = _jpeg(80)
    storage_service.put_object(storage, raw, "image/jpeg")
    _insert(mem, storage, "compA")
    resp = _serve(storage, method="HEAD")
    assert resp.status_code == 200
    assert resp.body == b""
    assert resp.headers["content-length"] == str(len(raw))
    assert resp.headers["etag"]
    assert resp.headers.get("last-modified")
    assert resp.headers["cache-control"].startswith("public")
    assert calls == []
    etag = resp.headers["etag"]
    not_mod = _serve(storage, headers={"if-none-match": etag})
    assert not_mod.status_code == 304
    assert not_mod.body == b""
    assert calls == []


def test_if_modified_since_returns_304(tmp_path, monkeypatch):
    mem = MemDB()
    monkeypatch.setattr(server, "db", mem)
    monkeypatch.setattr(storage_service, "LOCAL_ROOT", tmp_path)
    monkeypatch.setattr(storage_service, "_backend", "local")
    storage = _storage("company", name="logo.jpg")
    storage_service.put_object(storage, _jpeg(40), "image/jpeg")
    resp = _serve(storage, headers={"if-modified-since": "Tue, 01 Jan 2099 00:00:00 GMT"})
    assert resp.status_code == 304
    assert resp.body == b""


def test_files_route_registers_head():
    paths = [getattr(route, "path", "") for route in server.api_router.routes]
    match = [
        route for route in server.api_router.routes
        if getattr(route, "path", "") in ("/files/{path:path}", "/api/files/{path:path}")
    ]
    assert match, paths
    methods = set(match[0].methods or [])
    assert "GET" in methods
    assert "HEAD" in methods


def test_thumb_etag_matches_on_revalidation(tmp_path, monkeypatch):
    mem = MemDB()
    monkeypatch.setattr(server, "db", mem)
    monkeypatch.setattr(storage_service, "LOCAL_ROOT", tmp_path)
    monkeypatch.setattr(storage_service, "_backend", "local")
    storage = _storage("products", name="print.jpg")
    raw = _jpeg(320)
    storage_service.put_object(storage, raw, "image/jpeg")
    _insert(mem, storage, "compA")
    first = _serve(storage, w=200)
    assert first.status_code == 200
    assert first.headers["x-image-cache"] == "miss"
    assert first.headers["etag"]
    assert first.headers.get("last-modified")
    assert "immutable" not in first.headers["cache-control"]
    etag = first.headers["etag"]
    head = _serve(storage, method="HEAD", w=200)
    assert head.status_code == 200
    assert head.body == b""
    assert head.headers["etag"] == etag
    assert head.headers.get("last-modified")
    assert int(head.headers["content-length"]) == len(first.body)
    again = _serve(storage, w=200, headers={"if-none-match": etag})
    assert again.status_code == 304
    assert again.body == b""
    assert again.headers["etag"] == etag
    assert again.headers.get("last-modified")


def test_serve_does_not_log_body_or_token(files_db, caplog):
    mem, state = files_db
    storage = _storage("products", name="quiet.jpg")
    marker = b"BODY_MARKER_9f3c"
    token = "share-token-should-not-be-logged-9f3c"
    state["payload"] = _jpeg(32) + marker
    _insert(mem, storage, "compA")
    with caplog.at_level(logging.DEBUG):
        resp = _serve(storage, t=token)
    assert resp.status_code == 200
    assert marker.decode() not in caplog.text
    assert token not in caplog.text
