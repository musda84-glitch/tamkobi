"""Client IP behind the local nginx reverse proxy.

Uvicorn only sees 127.0.0.1. Nginx must set X-Real-IP / X-Forwarded-For
from $remote_addr (not $proxy_add_x_forwarded_for) so the client cannot
pick the login-lockout key. Direct connections to :8000 ignore XFF.
"""
from __future__ import annotations

from ipaddress import ip_address
from typing import Optional

_PROXY_PEERS = {"127.0.0.1", "::1"}


def _valid_ip(value: str) -> bool:
    try:
        ip_address(value)
        return True
    except ValueError:
        return False


def request_ip(request) -> str:
    peer = ""
    if getattr(request, "client", None) is not None:
        peer = (request.client.host or "").strip()
    headers = request.headers
    if peer in _PROXY_PEERS:
        real = (headers.get("x-real-ip") or "").strip()
        if real and _valid_ip(real):
            return real
        fwd = (headers.get("x-forwarded-for") or "").strip()
        if fwd:
            hop = fwd.split(",")[-1].strip()
            if hop and _valid_ip(hop):
                return hop
    return peer or "unknown"
