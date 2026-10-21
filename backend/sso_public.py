"""Public GET /sso handoff. Mounted ahead of any SPA catch-all, with no auth dependency.

The admin app 303-redirects the browser to https://app.tamkobi.com/sso?code=...
This route exchanges that one-time code and 303s to the app path.
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException, Request
from fastapi.responses import RedirectResponse
from fastapi.routing import APIRoute

import auth_handoff
import host_audience as ha
from auth_utils import (
    SUPERADMIN_ACCESS_SECONDS,
    auth_cookie_kwargs,
    decode_access_payload,
    get_user_from_token,
)

_ROUTE_NAME = "public_sso_handoff"
# Cookie handoff hosts. b2b uses URL tokens and has no JWT audience check.
_SSO_KINDS = frozenset({ha.KIND_APP, ha.KIND_IK, ha.KIND_YNT, ha.KIND_SITE})


def safe_next_path(raw: str, fallback: str) -> str:
    """Same-origin path only. Reject protocol-relative and absolute URLs."""
    text = (raw or "").strip()
    if not text.startswith("/") or text.startswith("//") or text.startswith("/\\"):
        return fallback
    if "\\" in text or "://" in text or "\x00" in text:
        return fallback
    return text


def default_next_path(kind: str) -> str:
    if kind == ha.KIND_APP:
        return "/panel"
    if kind == ha.KIND_IK:
        return "/personelim"
    return "/sistem/sirketler"


def _sso_kind_or_401(request: Request) -> str:
    """Allow app, ik, ynt, and site. Reject b2b and any other kind before consume."""
    kind = ha.host_kind(request)
    if kind not in _SSO_KINDS:
        raise HTTPException(status_code=401, detail="Handoff bu host için geçerli değil")
    return kind


async def complete_sso_exchange(
    db, code: str, request: Request, *, next_query: str = ""
) -> dict:
    """Consume the code once and describe the cookie + redirect. Raises 401 on reuse."""
    import json as _json

    kind = _sso_kind_or_401(request)
    blob = await auth_handoff.consume_handoff(db, code)
    try:
        data = _json.loads(blob)
    except Exception:
        data = {"access_token": blob, "sa_return": ""}
    access = data.get("access_token") or ""
    sa_ret = data.get("sa_return") or ""
    if not access:
        raise HTTPException(status_code=401, detail="Geçersiz handoff")
    try:
        payload = decode_access_payload(access)
    except Exception:
        raise HTTPException(status_code=401, detail="Geçersiz handoff token")
    tok_aud = payload.get("aud")
    if kind == ha.KIND_APP and tok_aud != ha.AUD_APP:
        raise HTTPException(
            status_code=401, detail="Handoff bu host için geçerli değil"
        )
    if kind == ha.KIND_IK and tok_aud != ha.AUD_IK:
        raise HTTPException(
            status_code=401, detail="Handoff bu host için geçerli değil"
        )
    if kind == ha.KIND_YNT and tok_aud != ha.AUD_YNT:
        raise HTTPException(
            status_code=401, detail="Handoff bu host için geçerli değil"
        )
    if kind == ha.KIND_SITE and tok_aud not in (None, ha.AUD_SITE):
        raise HTTPException(
            status_code=401, detail="Handoff bu host için geçerli değil"
        )
    user = await get_user_from_token(access, db)
    fallback = default_next_path(kind)
    return {
        "access": access,
        "sa_return": sa_ret,
        "user": user,
        "kind": kind,
        "redirect": safe_next_path(next_query, fallback),
    }


def apply_sso_cookies(response, request: Request, done: dict) -> None:
    user = done["user"]
    max_age = SUPERADMIN_ACCESS_SECONDS if user.get("is_super_admin") else 7200
    response.set_cookie(
        key="access_token",
        value=done["access"],
        **auth_cookie_kwargs(request, max_age=max_age),
    )
    if done.get("sa_return") and done.get("kind") == ha.KIND_APP:
        response.set_cookie(
            key="sa_return",
            value=done["sa_return"],
            **auth_cookie_kwargs(request, max_age=7200),
        )


async def sso_landing(request: Request):
    """Public. No session required. Second use of a code is a clean 401."""
    code = (request.query_params.get("code") or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="Handoff kodu gerekli")
    import server

    done = await complete_sso_exchange(
        server.db,
        code,
        request,
        next_query=request.query_params.get("next") or "",
    )
    response = RedirectResponse(url=done["redirect"], status_code=303)
    response.headers["Cache-Control"] = "no-store"
    apply_sso_cookies(response, request, done)
    return response


def _sso_route() -> APIRoute:
    return APIRoute(
        "/sso",
        sso_landing,
        methods=["GET"],
        name=_ROUTE_NAME,
        include_in_schema=False,
    )


def mount_public_sso(app: Any) -> None:
    """Register GET /sso at the front of the route table.

    A later SPA catch-all (`/{path:path}` → index.html) must not win. The
    route has no auth dependency; non-/api middleware already skips it.
    """
    routes = list(app.router.routes)
    kept = [route for route in routes if getattr(route, "name", None) != _ROUTE_NAME]
    route = _sso_route()
    if route.dependant.dependencies:
        raise RuntimeError("GET /sso must stay public")
    app.router.routes = [route, *kept]
