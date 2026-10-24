"""JSON kodlama döngü dışına alınır; doğrudan çağrı dict/list kalır."""
import asyncio
import json
from datetime import datetime, timezone
from decimal import Decimal

import pytest
from fastapi.encoders import jsonable_encoder
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import Response

import json_offload


def _stdlib(payload) -> bytes:
    return json.dumps(
        jsonable_encoder(payload),
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
    ).encode("utf-8")


def test_dump_matches_fastapi_json_bytes():
    payload = {
        "ad": "Şişli / İzmir",
        "money": 10.2,
        "tiny": 0.1,
        "big": 1.2e30,
        "ok": True,
        "z": None,
        "items": [{"id": "a", "qty": 2, "price": 19.99}],
        "when": datetime(2026, 10, 24, 12, 0, 1, 250000, tzinfo=timezone.utc),
        "dec": Decimal("10.50"),
    }
    assert json_offload.dump_json(payload) == _stdlib(payload)
    assert "Şişli".encode() in json_offload.dump_json(payload)


def test_non_str_key_falls_back_to_stdlib():
    assert json_offload.dump_json({1: "a"}) == _stdlib({1: "a"})


def test_nan_is_rejected():
    with pytest.raises(ValueError):
        json_offload.dump_json({"n": float("nan")})


def test_plain_dict_uses_orjson_when_installed():
    orjson = pytest.importorskip("orjson")
    payload = {"ad": "Şişli", "n": 1, "ok": True}
    assert json_offload.dump_json(payload) == orjson.dumps(payload)


def test_direct_call_returns_the_same_object():
    payload = {"changed": [1, 2, 3]}

    async def run():
        return await json_offload.maybe_offload(payload)

    assert asyncio.run(run()) is payload
    assert json_offload.http_json_active() is False


def test_http_mark_returns_response_and_resets():
    payload = {"ad": "Ğüşi", "n": 2}

    async def run():
        token = json_offload._HTTP.set(True)
        try:
            return await json_offload.maybe_offload(payload)
        finally:
            json_offload._HTTP.reset(token)

    response = asyncio.run(run())
    assert isinstance(response, Response)
    assert json.loads(response.body) == payload
    assert response.media_type == "application/json"
    assert json_offload.http_json_active() is False


def _http_scope():
    return {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "GET",
        "scheme": "http",
        "path": "/api/products",
        "raw_path": b"/api/products",
        "query_string": b"",
        "headers": [],
        "client": ("127.0.0.1", 9),
        "server": ("test", 80),
    }


def test_mark_is_visible_inside_base_http_middleware_task():
    seen = []

    async def endpoint(scope, receive, send):
        seen.append(json_offload.http_json_active())
        await send({"type": "http.response.start", "status": 200, "headers": []})
        await send({"type": "http.response.body", "body": b"{}", "more_body": False})

    class Outer(BaseHTTPMiddleware):
        async def dispatch(self, request, call_next):
            return await call_next(request)

    app = Outer(json_offload.OffloadJSONMark(endpoint))

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        seen.append(message["type"])

    asyncio.run(app(_http_scope(), receive, send))
    assert True in seen
    assert json_offload.http_json_active() is False


def test_lifespan_does_not_mark_http_json():
    seen = []

    async def endpoint(scope, receive, send):
        seen.append(json_offload.http_json_active())

    app = json_offload.OffloadJSONMark(endpoint)

    async def receive():
        return {"type": "lifespan.startup"}

    async def send(message):
        return None

    asyncio.run(app({"type": "lifespan", "asgi": {"version": "3.0"}}, receive, send))
    assert seen == [False]


def test_mark_resets_when_the_app_raises():
    async def endpoint(scope, receive, send):
        raise RuntimeError("boom")

    app = json_offload.OffloadJSONMark(endpoint)

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        return None

    with pytest.raises(RuntimeError):
        asyncio.run(app(_http_scope(), receive, send))
    assert json_offload.http_json_active() is False
