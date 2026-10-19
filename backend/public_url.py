"""Müşteriye giden linkler için kanonik genel site adresi (alt alan adına göre).

Geriye uyumlu: public_base_url() → site (platform_settings / PUBLIC_APP_URL / tamkobi.com).
Yeni: public_base_url_for(db, context) → site|app|b2b|ik.
Mutlak müşteri linki: public_link() / public_link_sync().
"""
from __future__ import annotations

import os
import re
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

# SMS / e-posta / WhatsApp metnindeki müşteri linki. Yalnız loopback kök değişir.
# Fatura PDF, e-belge, ekstre, dosya, teklif, proje, portal, davet, B2B, yenileme.
_LOOPBACK_DOC_RE = re.compile(
    r"https?://"
    r"(?:127\.0\.0\.1|localhost|0\.0\.0\.0|\[::1\])"
    r"(?::\d+)?"
    r"("
    r"/api/(?:invoices|e-invoice|public|files|quotes)/[^\s<>\"']+"
    r"|/(?:teklif|proje|ekstre|portal|davet|b2b|yenile)/[^\s<>\"']*"
    r")",
    re.IGNORECASE,
)


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


def _request_header(request: Any, name: str) -> str:
    """Yalnız gerçek metin başlığı. Host ve base_url okunmaz."""
    if request is None:
        return ""
    headers = getattr(request, "headers", None)
    if headers is None:
        return ""
    getter = getattr(headers, "get", None)
    if not callable(getter):
        return ""
    try:
        value = getter(name)
    except Exception:
        return ""
    if isinstance(value, str):
        return value.strip()
    return ""


def _forwarded_host_token(raw: str):
    """İlk X-Forwarded-Host değeri → (hostname, host[:port])."""
    first = (raw or "").split(",")[0].strip()
    if not first or any(ch in first for ch in " \t\r\n/\\"):
        return "", ""
    if first.startswith("["):
        end = first.find("]")
        if end <= 1:
            return "", ""
        hostname = first[1:end]
        rest = first[end + 1:]
        if rest and not re.fullmatch(r":\d{1,5}", rest):
            return "", ""
        return hostname, first
    if first.count(":") == 1:
        hostname, port = first.rsplit(":", 1)
        if port.isdigit():
            return hostname, first
    if ":" in first:
        return "", ""
    return first, first


def _host_on_public_root(hostname: str, root: str) -> bool:
    """İzinli liste: {kök} ve *.{kök}. Loopback reddedilir."""
    host = (hostname or "").strip().lower().rstrip(".")
    root_l = (root or "").strip().lower().rstrip(".")
    if not host or not root_l:
        return False
    if host in _INVALID_HOSTS or host.endswith(".localhost"):
        return False
    if host == root_l:
        return True
    return host.endswith("." + root_l)


def _forwarded_app_base(request: Any, root: str) -> str:
    """X-Forwarded-Host + X-Forwarded-Proto, yalnız izinli ve loopback olmayan host."""
    raw_host = _request_header(request, "x-forwarded-host") or _request_header(request, "X-Forwarded-Host")
    raw_proto = _request_header(request, "x-forwarded-proto") or _request_header(request, "X-Forwarded-Proto")
    if not raw_host or not raw_proto:
        return ""
    proto = raw_proto.split(",")[0].strip().lower()
    if proto not in ("http", "https"):
        return ""
    hostname, host_token = _forwarded_host_token(raw_host)
    if not _host_on_public_root(hostname, root):
        return ""
    return normalize_public_base(f"{proto}://{host_token}")


def _app_direct_sources_invalid(explicit: Optional[str], platform_public_url: Optional[str]) -> bool:
    """explicit, PUBLIC_APP_HOST_URL ve platform public_url hep geçersizse True."""
    if normalize_public_base(explicit):
        return False
    if normalize_public_base(os.environ.get("PUBLIC_APP_HOST_URL")):
        return False
    if normalize_public_base(platform_public_url):
        return False
    return True


def _normalize_link_path(path: str) -> str:
    p = (path or "").strip()
    if not p:
        return ""
    if not p.startswith("/"):
        p = "/" + p
    return p


def _join_public_link(base: str, path: str, context: str) -> str:
    root = normalize_public_base(base)
    if not root:
        root = normalize_public_base(resolve_public_base_url_for(context)) or DEFAULT_PUBLIC_BASE_URL
    return f"{root.rstrip('/')}{_normalize_link_path(path)}"


def public_link_sync(
    path: str,
    context: str = CONTEXT_APP,
    platform_public_url: Optional[str] = None,
) -> str:
    """Senkron mutlak link. Sonuç loopback köklü olmaz."""
    base = resolve_public_base_url_for(
        context,
        platform_public_url=platform_public_url,
    )
    return _join_public_link(base, path, context)


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


def rewrite_loopback_doc_urls(text: Optional[str], public_base: str) -> str:
    """Müşteri linkindeki loopback kökü public app URL ile değiştirir.

    İstek Host / window.location (http://127.0.0.1) müşteri metnine yazılmaz.
    Başka adreslere dokunmaz.
    """
    raw = text or ""
    if not raw or not _LOOPBACK_DOC_RE.search(raw):
        return raw
    base = normalize_public_base(public_base) or resolve_public_base_url_for(CONTEXT_APP)
    base = normalize_public_base(base) or resolve_public_base_url_for(CONTEXT_APP)
    return _LOOPBACK_DOC_RE.sub(lambda m: f"{base}{m.group(1)}", raw)


async def rewrite_outbound_doc_text(db: Any, text: Optional[str]) -> str:
    """Giden SMS/e-posta/WhatsApp metnindeki loopback müşteri linklerini public app URL'sine çeker.

    Metinde loopback müşteri linki yoksa veritabanına bakmaz.
    """
    raw = text or ""
    if not raw or not _LOOPBACK_DOC_RE.search(raw):
        return raw
    try:
        base = await public_base_url_for(db, CONTEXT_APP)
    except Exception:
        base = resolve_public_base_url_for(CONTEXT_APP)
    return rewrite_loopback_doc_urls(raw, base)


async def public_base_url_for(
    db: Any = None,
    context: str = CONTEXT_SITE,
    *,
    explicit: str = "",
    request: Any = None,
) -> str:
    """Alt alan adına göre kanonik taban URL.

    X-Forwarded-Host/Proto yalnız son çaredir: explicit, PUBLIC_APP_HOST_URL ve
    platform public_url geçersizse, host loopback değilse ve {kök} / *.{kök}
    izin listesindeyse. Host başlığı ve request.base_url kullanılmaz.
    İstemci base_url b2b ve ynt için yok sayılmaya devam eder.
    """
    platform_url = None
    if db is not None:
        st = await db.platform_settings.find_one({"_id": "platform"}) or {}
        platform_url = st.get("public_url")
    explicit_norm = (explicit or "").strip() or None
    ctx = (context or CONTEXT_SITE).strip().lower()
    if ctx == CONTEXT_APP and _app_direct_sources_invalid(explicit_norm, platform_url):
        site = resolve_public_base_url(platform_public_url=platform_url)
        root = _root_from_site_base(site)
        forwarded = _forwarded_app_base(request, root)
        if forwarded:
            return forwarded
    return resolve_public_base_url_for(
        context,
        platform_public_url=platform_url,
        explicit=explicit_norm,
    )


async def public_link(
    db: Any = None,
    path: str = "",
    context: str = CONTEXT_APP,
    *,
    explicit: str = "",
    request: Any = None,
) -> str:
    """Mutlak müşteri linki. public_base_url_for ile kurulur; path '/' ile normalize edilir.

    Sonuç asla loopback köklü olmaz.
    """
    base = await public_base_url_for(
        db,
        context,
        explicit=explicit or "",
        request=request,
    )
    return _join_public_link(base, path, context)
