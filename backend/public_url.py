"""Müşteriye giden linkler için kanonik genel site adresi.

Sıra: platform_settings.public_url → PUBLIC_APP_URL → https://tamkobi.com
localhost / 127.0.0.1 / 0.0.0.0 geçersiz sayılır; request Host/base_url kullanılmaz.
"""
from __future__ import annotations

import os
from typing import Any, Optional
from urllib.parse import urlparse

DEFAULT_PUBLIC_BASE_URL = "https://tamkobi.com"

_INVALID_HOSTS = frozenset({
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "[::1]",
})


def is_invalid_public_base(url: Optional[str]) -> bool:
    """Boş veya iç ağ / loopback adresi mi?"""
    raw = (url or "").strip()
    if not raw:
        return True
    candidate = raw if "://" in raw else f"https://{raw}"
    try:
        parsed = urlparse(candidate)
    except Exception:
        return True
    host = (parsed.hostname or "").strip().lower()
    if not host:
        return True
    if host in _INVALID_HOSTS:
        return True
    if host.endswith(".localhost"):
        return True
    return False


def normalize_public_base(url: Optional[str]) -> str:
    """Geçerliyse sondaki / olmadan döner; geçersizse boş string."""
    raw = (url or "").strip().rstrip("/")
    if not raw or is_invalid_public_base(raw):
        return ""
    if "://" not in raw:
        raw = f"https://{raw}"
    return raw.rstrip("/")


def resolve_public_base_url(
    *,
    platform_public_url: Optional[str] = None,
    env_url: Optional[str] = None,
    explicit: Optional[str] = None,
) -> str:
    """platform → PUBLIC_APP_URL → varsayılan. explicit yalnızca geçerliyse öncelikli."""
    env = os.environ.get("PUBLIC_APP_URL") if env_url is None else env_url
    for candidate in (explicit, platform_public_url, env, DEFAULT_PUBLIC_BASE_URL):
        normalized = normalize_public_base(candidate)
        if normalized:
            return normalized
    return DEFAULT_PUBLIC_BASE_URL


async def public_base_url(
    db: Any = None,
    *,
    explicit: str = "",
    request: Any = None,  # noqa: ARG001 — kasıtlı yok sayılır (Host sızıntısı yok)
) -> str:
    """DB'den platform public_url okuyup resolve_public_base_url uygular."""
    platform_url = None
    if db is not None:
        st = await db.platform_settings.find_one({"_id": "platform"}) or {}
        platform_url = st.get("public_url")
    return resolve_public_base_url(
        platform_public_url=platform_url,
        explicit=(explicit or "").strip() or None,
    )
