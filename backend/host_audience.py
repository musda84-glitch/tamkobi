"""Host → JWT audience mapping for subdomain split (site / app / b2b / ik)."""
from __future__ import annotations

import os
import re
from typing import Any, Optional
from urllib.parse import urlparse

ROOT_DOMAIN = (os.environ.get("ROOT_DOMAIN") or "tamkobi.com").strip().lower()

# Host kind constants
KIND_SITE = "site"
KIND_APP = "app"
KIND_B2B = "b2b"
KIND_IK = "ik"

# JWT aud values (match kinds used for cookie-bearing hosts)
AUD_SITE = "site"
AUD_APP = "app"
AUD_IK = "ik"

_PROXY_PEERS = frozenset({"127.0.0.1", "::1"})

_IK_SELF_SERVICE_PREFIXES = (
    "/api/personnel/me",
    "/api/personnel/messages",
    "/api/personnel/attendance/self",
    "/api/personnel/attendance/me",
    "/api/personnel/attendance/geo",
    "/api/personnel/attendance/early-leave-request",
    "/api/personnel/attendance/intraday-leave-request",
    "/api/personnel/leaves/self",
    "/api/personnel/leaves/me",
    "/api/personnel/bonuses/self",
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/me",
    "/api/auth/switch-company",
    "/api/auth/forgot-password",
    "/api/auth/reset/",
    "/api/auth/sso-exchange",
    "/api/license/me",
    "/api/version",
    "/api/health",
)


def root_domain() -> str:
    return ROOT_DOMAIN or "tamkobi.com"


def _strip_port(host: str) -> str:
    h = (host or "").strip().lower()
    if not h:
        return ""
    # [IPv6]:port
    if h.startswith("["):
        end = h.find("]")
        return h[: end + 1] if end != -1 else h
    return h.split(":", 1)[0]


def request_host(request: Any) -> str:
    """Host for audience: trust nginx Host; X-Forwarded-Host only from local proxy.

    Clients must not spoof aud by sending X-Forwarded-Host on a direct :8000 hit.
    """
    if request is None:
        return ""
    headers = getattr(request, "headers", None) or {}
    host = headers.get("host") or headers.get("Host") or ""
    peer = ""
    client = getattr(request, "client", None)
    if client is not None:
        peer = (getattr(client, "host", None) or "").strip()
    if peer in _PROXY_PEERS:
        xf = (headers.get("x-forwarded-host") or headers.get("X-Forwarded-Host") or "").split(",")[0].strip()
        if xf:
            host = xf
    return _strip_port(host)


def host_kind_from_hostname(hostname: str) -> str:
    """Map hostname to site|app|b2b|ik."""
    h = _strip_port(hostname)
    root = root_domain()
    if h in {root, f"www.{root}"}:
        return KIND_SITE
    if h == f"app.{root}":
        return KIND_APP
    if h == f"b2b.{root}":
        return KIND_B2B
    if h == f"ik.{root}":
        return KIND_IK
    # Local / unknown → site (legacy mobile + local API)
    return KIND_SITE


def host_kind(request: Any) -> str:
    return host_kind_from_hostname(request_host(request))


def audience_for_host_kind(kind: str) -> Optional[str]:
    """JWT aud for cookie-bearing hosts. b2b uses URL tokens (no aud)."""
    if kind == KIND_APP:
        return AUD_APP
    if kind == KIND_IK:
        return AUD_IK
    if kind == KIND_SITE:
        return AUD_SITE
    return None


def audience_for_request(request: Any) -> Optional[str]:
    return audience_for_host_kind(host_kind(request))


def public_host_url(kind: str) -> str:
    """https://… base for kind (no trailing slash)."""
    root = root_domain()
    if kind == KIND_APP:
        return f"https://app.{root}"
    if kind == KIND_B2B:
        return f"https://b2b.{root}"
    if kind == KIND_IK:
        return f"https://ik.{root}"
    return f"https://{root}"


def is_employee_user(user: dict) -> bool:
    """Çalışan = employee_id dolu ve rolü personel."""
    if not user:
        return False
    eid = user.get("employee_id")
    role = (user.get("role") or "").strip().lower()
    return bool(eid) and role == "personel"


def is_ik_self_service_path(path: str) -> bool:
    p = (path or "").split("?", 1)[0]
    for pref in _IK_SELF_SERVICE_PREFIXES:
        if pref.endswith("/"):
            if p == pref.rstrip("/") or p.startswith(pref):
                return True
        elif p == pref or p.startswith(pref + "/"):
            return True
    # Attendance self-service actions (path contains attendance id)
    if p.startswith("/api/personnel/attendance/") and any(
        p.endswith(s)
        for s in (
            "/confirm",
            "/dispute",
            "/early-leave-cancel",
            "/time-edit-decision",
        )
    ):
        return True
    # Project stage photo visibility (görev kartı / personelim)
    if p.startswith("/api/projects/") and p.endswith("/stage-photos/visibility"):
        return True
    return False


def is_super_admin_api_path(path: str) -> bool:
    p = (path or "").split("?", 1)[0]
    return p.startswith("/api/system") or p.startswith("/api/saas") or "/system/" in p


def default_cors_origins() -> list:
    root = root_domain()
    return [
        f"https://{root}",
        f"https://www.{root}",
        f"https://app.{root}",
        f"https://b2b.{root}",
        f"https://ik.{root}",
    ]


def parse_cors_origins_env() -> list:
    listed = [o.strip() for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip()]
    if listed:
        return listed
    return default_cors_origins()
