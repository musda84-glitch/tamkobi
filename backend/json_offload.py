"""Büyük JSON yanıtını event loop dışında kodla.

FastAPI dict/list dönüşünü döngü üzerinde jsonable_encoder + json.dumps ile
yazar. Ürün, senkron ve pano gövdelerinde bu yürüyüş 2 vCPU'luk süreçte diğer
istekleri de bekletir. HTTP isteğinde gövde bir iş parçacığında orjson ile
kodlanır. orjson yoksa veya türü tanımıyorsa stdlib json devreye girer.
Anlam aynıdır; küçük üs yazımı birebir olmayabilir (1e-7 ve 1e-07).
Doğrudan fonksiyon çağrısı (testler) nesneyi olduğu gibi alır.
"""
from __future__ import annotations

import asyncio
import contextvars
import json
import logging
import math
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from enum import Enum
from typing import Any
from uuid import UUID

from fastapi.encoders import decimal_encoder, jsonable_encoder
from starlette.responses import Response

_HTTP = contextvars.ContextVar("tamkobi_http_json", default=False)
_orjson: Any = False
_log = logging.getLogger("tamkobi.json")
_NONFINITE_LOG_CAP = 20


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


def _bad_number(val: Any, inf: float) -> bool:
    kind = type(val)
    if kind is float:
        return val != val or val == inf or val == -inf
    if kind is Decimal:
        return not val.is_finite()
    if isinstance(val, float):
        return not math.isfinite(val)
    return False


def _has_nonfinite(payload: Any) -> bool:
    """Yol dizisi kurmadan NaN/Infinity var mı bak. Sonlu gövde ucuz kalsın."""
    stack = [payload]
    append = stack.append
    pop = stack.pop
    inf = math.inf
    while stack:
        cur = pop()
        if _bad_number(cur, inf):
            return True
        if isinstance(cur, dict):
            seq = cur.values()
        elif isinstance(cur, (list, tuple)):
            seq = cur
        else:
            continue
        for val in seq:
            kind = type(val)
            if kind is str or kind is int or kind is bool or val is None:
                continue
            if kind is float or kind is Decimal or isinstance(val, float):
                if _bad_number(val, inf):
                    return True
                continue
            if kind is dict or kind is list or kind is tuple:
                append(val)
    return False


def _warn_nonfinite(payload: Any) -> None:
    """NaN/Infinity null'a düşmeden önce yol ve sayıyı yaz. Gövdeyi yazma."""
    try:
        if not _has_nonfinite(payload):
            return
    except Exception:
        return
    found = 0
    extra = 0

    def note(path: str, value: Any) -> None:
        nonlocal found, extra
        if found >= _NONFINITE_LOG_CAP:
            extra += 1
            return
        found += 1
        _log.warning("json nonfinite path=%s value=%s", path or "$", value)

    def walk(obj: Any, path: str) -> None:
        if isinstance(obj, float) and not math.isfinite(obj):
            note(path, obj)
            return
        if isinstance(obj, Decimal) and not obj.is_finite():
            note(path, obj)
            return
        if isinstance(obj, dict):
            for key, val in obj.items():
                step = str(key)
                walk(val, f"{path}.{step}" if path else step)
            return
        if isinstance(obj, (list, tuple)):
            for index, val in enumerate(obj):
                walk(val, f"{path}[{index}]")

    try:
        walk(payload, "")
    except Exception:
        return
    if extra:
        _log.warning("json nonfinite truncated extra=%s", extra)


def dump_json(payload: Any) -> bytes:
    """UTF-8, sıkıştırılmış JSON.

    NaN ve Infinity orjson'da null olur; yol uyarısı yazılır. stdlib yedek
    allow_nan=False ile 500 üretir. Küçük üs baytları orjson ile stdlib
    arasında değişebilir (1e-7 / 1e-07); sayı aynıdır.
    """
    lib = _lib()
    if lib is not None:
        try:
            _warn_nonfinite(payload)
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
