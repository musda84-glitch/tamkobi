"""Büyük JSON yanıtını event loop dışında kodla.

FastAPI dict/list dönüşünü döngü üzerinde jsonable_encoder + json.dumps ile
yazar. Ürün, senkron ve pano gövdelerinde bu yürüyüş 2 vCPU'luk süreçte diğer
istekleri de bekletir. HTTP isteğinde gövde bir iş parçacığında orjson ile
kodlanır; orjson yoksa veya türü tanımıyorsa stdlib json aynı baytları üretir.
Doğrudan fonksiyon çağrısı (testler) nesneyi olduğu gibi alır.
"""
from __future__ import annotations

import asyncio
import contextvars
import json
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from enum import Enum
from typing import Any
from uuid import UUID

from fastapi.encoders import decimal_encoder, jsonable_encoder
from starlette.responses import Response

_HTTP = contextvars.ContextVar("tamkobi_http_json", default=False)
_orjson: Any = False


def http_json_active() -> bool:
    return bool(_HTTP.get())


def _lib():
    global _orjson
    if _orjson is False:
        try:
            import orjson as lib
        except ImportError:
            _orjson = None
        else:
            _orjson = lib
    return _orjson


def _default(obj: Any) -> Any:
    if isinstance(obj, (datetime, date, time)):
        return obj.isoformat()
    if isinstance(obj, Decimal):
        return decimal_encoder(obj)
    if isinstance(obj, Enum):
        return obj.value
    if isinstance(obj, (bytes, bytearray)):
        return bytes(obj).decode()
    if isinstance(obj, (set, frozenset)):
        return list(obj)
    if isinstance(obj, timedelta):
        return obj.total_seconds()
    if isinstance(obj, UUID):
        return str(obj)
    return jsonable_encoder(obj)


def dump_json(payload: Any) -> bytes:
    """UTF-8, sıkıştırılmış JSON.

    NaN ve Infinity orjson'da null olur. stdlib json.dumps allow_nan=False
    bu değerlerde 500 üretirdi. Bu sıcak uçlar sayı alanlarında NaN beklemez.
    """
    lib = _lib()
    if lib is not None:
        try:
            return lib.dumps(
                payload,
                default=_default,
                option=lib.OPT_PASSTHROUGH_DATETIME,
            )
        except (TypeError, ValueError, RecursionError):
            pass
    encoded = jsonable_encoder(payload)
    return json.dumps(
        encoded,
        ensure_ascii=False,
        allow_nan=False,
        separators=(",", ":"),
    ).encode("utf-8")


async def maybe_offload(payload: Any):
    """HTTP değilse payload. HTTP ise kodlanmış JSON Response."""
    if not _HTTP.get():
        return payload
    body = await asyncio.to_thread(dump_json, payload)
    return Response(content=body, media_type="application/json")


class OffloadJSONMark:
    """HTTP kapsamında kodlamayı iş parçacığına alır.

    user_middleware sonuna eklenir. Böylece BaseHTTPMiddleware'in açtığı
    görevde, uç çalışmadan hemen önce bağlam yazılır.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        token = _HTTP.set(True)
        try:
            await self.app(scope, receive, send)
        finally:
            _HTTP.reset(token)
