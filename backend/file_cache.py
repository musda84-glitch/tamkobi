"""Değişmeyen dosya yanıtları: Cache-Control, ETag, Last-Modified, 304.

Dosya gövdesi ve paylaşım token'ı burada tutulmaz, loglanmaz.
"""
from __future__ import annotations

import email.utils
import hashlib
from datetime import timezone
from typing import Optional

# immutable yok: yenileme If-None-Match gönderebilsin. Taze önbellek sunucuya gitmez.
PUBLIC_CACHE = "public, max-age=31536000"
PRIVATE_CACHE = "private, max-age=31536000"

_VALIDATORS: dict = {}
_MAX = 4096


def etag_for(path: str, size: int, mtime: Optional[float] = None) -> str:
    stamp = str(int(float(mtime) * 1000)) if mtime else "0"
    digest = hashlib.sha256(f"{path}|{int(size)}|{stamp}".encode()).hexdigest()[:16]
    return f'"{digest}"'


def remember(path: str, etag: str, mtime: Optional[float] = None, size: int = 0) -> None:
    if not path or not etag:
        return
    if len(_VALIDATORS) >= _MAX:
        _VALIDATORS.clear()
    _VALIDATORS[path] = {"etag": etag, "mtime": mtime, "size": int(size or 0)}


def recall(path: str) -> dict:
    return dict(_VALIDATORS.get(path) or {})


def forget(path: str) -> None:
    _VALIDATORS.pop(path, None)


def header(request, name: str) -> str:
    headers = getattr(request, "headers", None) or {}
    getter = getattr(headers, "get", None)
    if getter is None:
        return ""
    for key in (name, name.lower(), name.upper(), name.title()):
        try:
            val = getter(key)
        except Exception:
            val = None
        if val:
            return str(val)
    return ""


def etag_matches(header_value: str, etag: str) -> bool:
    raw = (header_value or "").strip()
    current = (etag or "").strip()
    if not raw or not current:
        return False
    if raw == "*":
        return True
    if current.startswith("W/"):
        current = current[2:].strip()
    for part in raw.split(","):
        token = part.strip()
        if token.startswith("W/"):
            token = token[2:].strip()
        if token == current:
            return True
    return False


def not_modified(request, etag: str, mtime: Optional[float]) -> bool:
    inm = header(request, "if-none-match")
    if inm:
        return etag_matches(inm, etag)
    ims = header(request, "if-modified-since")
    if ims and mtime:
        try:
            when = email.utils.parsedate_to_datetime(ims)
        except (TypeError, ValueError, OverflowError):
            return False
        if when is None:
            return False
        if when.tzinfo is None:
            when = when.replace(tzinfo=timezone.utc)
        return float(mtime) <= when.timestamp() + 1
    return False


def cache_control(public: bool) -> str:
    return PUBLIC_CACHE if public else PRIVATE_CACHE


def apply_validators(headers: Optional[dict], *, public: bool, etag: str = "", mtime: Optional[float] = None) -> dict:
    out = dict(headers or {})
    cc = str(out.get("Cache-Control") or "")
    if "no-store" in cc:
        return out
    out["Cache-Control"] = cache_control(public)
    if etag:
        out["ETag"] = etag
    if mtime:
        out["Last-Modified"] = email.utils.formatdate(float(mtime), usegmt=True)
    return out
