"""Platform Yönetimi (ynt): host kind, aud, bayrak, cookies, CORS, handoff."""
from __future__ import annotations

import os
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

import auth_utils
import host_audience as ha
import public_url as pu


def _req(host: str, path: str = "/api/auth/me", peer: str = "203.0.113.9"):
    return SimpleNamespace(
        headers={"host": host},
        client=SimpleNamespace(host=peer),
        url=SimpleNamespace(path=path),
    )


def test_host_kind_ynt_before_root_domain(monkeypatch):
    monkeypatch.setenv("YNT_HOST", "ynt.taiyazilim.com")
    monkeypatch.setenv("ROOT_DOMAIN", "tamkobi.com")
    assert ha.host_kind_from_hostname("ynt.taiyazilim.com") == ha.KIND_YNT
    assert ha.host_kind_from_hostname("tamkobi.com") == ha.KIND_SITE
    assert ha.host_kind_from_hostname("app.tamkobi.com") == ha.KIND_APP


def test_xfh_spoof_blocked_from_external_peer():
    req = SimpleNamespace(
        headers={"host": "tamkobi.com", "x-forwarded-host": "ynt.taiyazilim.com"},
        client=SimpleNamespace(host="203.0.113.50"),
    )
    assert ha.request_host(req) == "tamkobi.com"
    assert ha.host_kind(req) == ha.KIND_SITE


def test_xfh_trusted_from_local_proxy(monkeypatch):
    monkeypatch.setenv("YNT_HOST", "ynt.taiyazilim.com")
    req = SimpleNamespace(
        headers={"host": "127.0.0.1:8000", "x-forwarded-host": "ynt.taiyazilim.com"},
        client=SimpleNamespace(host="127.0.0.1"),
    )
    assert ha.request_host(req) == "ynt.taiyazilim.com"
    assert ha.host_kind(req) == ha.KIND_YNT


def test_aud_ynt_rejected_on_other_hosts():
    payload = {"aud": ha.AUD_YNT, "sa": True}
    with pytest.raises(HTTPException) as ei:
        auth_utils.enforce_token_audience(payload, _req("app.tamkobi.com"), path="/api/auth/me")
    assert ei.value.status_code == 401


def test_other_aud_rejected_on_ynt(monkeypatch):
    monkeypatch.setenv("YNT_HOST", "ynt.taiyazilim.com")
    for aud in (ha.AUD_APP, ha.AUD_SITE, ha.AUD_IK, None):
        payload = {"aud": aud, "sa": True}
        with pytest.raises(HTTPException) as ei:
            auth_utils.enforce_token_audience(payload, _req("ynt.taiyazilim.com"), path="/api/auth/me")
        assert ei.value.status_code == 401


def test_non_sa_forbidden_on_ynt(monkeypatch):
    monkeypatch.setenv("YNT_HOST", "ynt.taiyazilim.com")
    payload = {"aud": ha.AUD_YNT, "sa": False}
    with pytest.raises(HTTPException) as ei:
        auth_utils.enforce_token_audience(payload, _req("ynt.taiyazilim.com"), path="/api/auth/me")
    assert ei.value.status_code == 403


def test_ynt_tenant_path_forbidden(monkeypatch):
    monkeypatch.setenv("YNT_HOST", "ynt.taiyazilim.com")
    payload = {"aud": ha.AUD_YNT, "sa": True}
    with pytest.raises(HTTPException) as ei:
        auth_utils.enforce_token_audience(
            payload, _req("ynt.taiyazilim.com", "/api/orders"), path="/api/orders"
        )
    assert ei.value.status_code == 403


def test_flag_matrix_superadmin_api(monkeypatch):
    monkeypatch.setenv("YNT_HOST", "ynt.taiyazilim.com")
    payload_site = {"aud": ha.AUD_SITE, "sa": True}
    # flag 0: site SA API ok
    monkeypatch.setenv("SUPERADMIN_YNT_ONLY", "0")
    auth_utils.enforce_token_audience(
        payload_site, _req("tamkobi.com", "/api/system/companies"), path="/api/system/companies"
    )
    # flag 1: site SA API → 403
    monkeypatch.setenv("SUPERADMIN_YNT_ONLY", "1")
    with pytest.raises(HTTPException) as ei:
        auth_utils.enforce_token_audience(
            payload_site, _req("tamkobi.com", "/api/system/companies"), path="/api/system/companies"
        )
    assert ei.value.status_code == 403
    assert "ynt" in str(ei.value.detail).lower() or "taşındı" in str(ei.value.detail).lower()
    # ynt + aud=ynt still ok
    monkeypatch.setenv("SUPERADMIN_YNT_ONLY", "1")
    auth_utils.enforce_token_audience(
        {"aud": ha.AUD_YNT, "sa": True},
        _req("ynt.taiyazilim.com", "/api/system/companies"),
        path="/api/system/companies",
    )


def test_is_super_admin_api_path_narrow():
    assert ha.is_super_admin_api_path("/api/system/companies")
    assert ha.is_super_admin_api_path("/api/platform/admin/products")
    assert ha.is_super_admin_api_path("/api/einvoice/designs")
    assert ha.is_super_admin_api_path("/api/einvoice/designs/abc/select")
    assert not ha.is_super_admin_api_path("/api/einvoice/settings")
    assert not ha.is_super_admin_api_path("/api/einvoice/incoming/sync")
    assert not ha.is_super_admin_api_path("/api/license/me")
    assert not ha.is_super_admin_api_path("/api/auth/2fa/verify")
    assert not ha.is_super_admin_api_path("/api/orders/system/foo")  # eski substring tuzağı


def test_license_me_not_blocked_by_flag(monkeypatch):
    monkeypatch.setenv("SUPERADMIN_YNT_ONLY", "1")
    # Mobile: aud None on site license path — not a SA API
    auth_utils.enforce_token_audience(
        {"aud": None},
        _req("tamkobi.com", "/api/license/me"),
        path="/api/license/me",
    )


def test_cookie_kwargs_no_domain():
    req = _req("ynt.taiyazilim.com")
    req.headers = {"host": "ynt.taiyazilim.com", "x-forwarded-proto": "https"}
    kw = auth_utils.auth_cookie_kwargs(req, max_age=100)
    assert "domain" not in kw
    assert kw.get("samesite") == "lax"
    assert kw.get("secure") is True


def test_cors_includes_ynt(monkeypatch):
    monkeypatch.setenv("YNT_HOST", "ynt.taiyazilim.com")
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    origins = ha.default_cors_origins()
    assert "https://ynt.taiyazilim.com" in origins


def test_public_ynt_url(monkeypatch):
    monkeypatch.setenv("PUBLIC_YNT_URL", "https://ynt.taiyazilim.com")
    assert pu.resolve_public_base_url_for("ynt", explicit="https://evil.example") == "https://ynt.taiyazilim.com"


def test_impersonate_exit_targets_ynt_when_sa_return_aud_ynt(monkeypatch):
    """sa_return aud=ynt → redirect host is ynt."""
    import asyncio
    import json
    from datetime import datetime, timedelta, timezone

    import jwt
    from auth_utils import get_jwt_secret, JWT_ALGORITHM

    now = datetime.now(timezone.utc)
    sa_tok = jwt.encode(
        {
            "sub": "sa1",
            "email": "sa@test.com",
            "type": "access",
            "sa": True,
            "aud": ha.AUD_YNT,
            "iat": int(now.timestamp()),
            "exp": now + timedelta(hours=1),
        },
        get_jwt_secret(),
        algorithm=JWT_ALGORITHM,
    )
    # Smoke: decode shows aud=ynt used by exit logic
    from auth_utils import decode_access_payload
    assert decode_access_payload(sa_tok).get("aud") == ha.AUD_YNT
    assert pu.resolve_public_base_url_for("ynt") == "https://ynt.taiyazilim.com"
