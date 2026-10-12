"""Müşteriye giden linkler için kanonik genel site adresi (alt alan adına göre).

Geriye uyumlu: public_base_url() → site (platform_settings / PUBLIC_APP_URL / tamkobi.com).
Yeni: public_base_url_for(db, context) → site|app|b2b|ik.
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

CONTEXT_SITE = "site"
CONTEXT_APP = "app"
CONTEXT_B2B = "b2b"
CONTEXT_IK = "ik"
CONTEXT_YNT = "ynt"


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


def _root_from_site_base(site_base: str) -> str:
    try:
        host = urlparse(site_base).hostname or "tamkobi.com"
    except Exception:
        host = "tamkobi.com"
    host = host.lower()
    if host.startswith("www."):
        host = host[4:]
    return host


def resolve_public_base_url_for(
    context: str,
    *,
    platform_public_url: Optional[str] = None,
    explicit: Optional[str] = None,
) -> str:
    """context: site|app|b2b|ik|ynt. Env: PUBLIC_APP_HOST_URL, PUBLIC_B2B_URL, PUBLIC_IK_URL, PUBLIC_YNT_URL."""
    ctx = (context or CONTEXT_SITE).strip().lower()
    site = resolve_public_base_url(
        platform_public_url=platform_public_url,
        explicit=explicit if ctx == CONTEXT_SITE else None,
    )
    root = _root_from_site_base(site)

    if ctx == CONTEXT_APP:
        for candidate in (
            explicit,
            os.environ.get("PUBLIC_APP_HOST_URL"),
            f"https://app.{root}",
        ):
            n = normalize_public_base(candidate)
            if n:
                return n
        return f"https://app.{root}"

    if ctx == CONTEXT_B2B:
        # Client-supplied base_url is ignored for b2b (security).
        for candidate in (
            os.environ.get("PUBLIC_B2B_URL"),
            f"https://b2b.{root}",
        ):
            n = normalize_public_base(candidate)
            if n:
                return n
        return f"https://b2b.{root}"

    if ctx == CONTEXT_IK:
        for candidate in (
            explicit,
            os.environ.get("PUBLIC_IK_URL"),
            f"https://ik.{root}",
        ):
            n = normalize_public_base(candidate)
            if n:
                return n
        return f"https://ik.{root}"

    if ctx == CONTEXT_YNT:
        # Client-supplied base_url ignored for ynt (security).
        import host_audience as _ha
        for candidate in (
            os.environ.get("PUBLIC_YNT_URL"),
            _ha.public_host_url(_ha.KIND_YNT),
        ):
            n = normalize_public_base(candidate)
            if n:
                return n
        return _ha.public_host_url(_ha.KIND_YNT)

    # site
    return site


async def public_base_url(
    db: Any = None,
    *,
    explicit: str = "",
    request: Any = None,  # noqa: ARG001 — kasıtlı yok sayılır (Host sızıntısı yok)
) -> str:
    """DB'den platform public_url okuyup resolve_public_base_url uygular (site)."""
    platform_url = None
    if db is not None:
        st = await db.platform_settings.find_one({"_id": "platform"}) or {}
        platform_url = st.get("public_url")
    return resolve_public_base_url(
        platform_public_url=platform_url,
        explicit=(explicit or "").strip() or None,
    )


async def public_base_url_for(
    db: Any = None,
    context: str = CONTEXT_SITE,
    *,
    explicit: str = "",
    request: Any = None,  # noqa: ARG001
) -> str:
    """Alt alan adına göre kanonik taban URL."""
    platform_url = None
    if db is not None:
        st = await db.platform_settings.find_one({"_id": "platform"}) or {}
        platform_url = st.get("public_url")
    return resolve_public_base_url_for(
        context,
        platform_public_url=platform_url,
        explicit=(explicit or "").strip() or None,
    )
