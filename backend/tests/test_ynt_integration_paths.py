"""ynt host: e-fatura / İşNet entegrasyon yolları allowlist + audience gate."""
from __future__ import annotations

import os
import re
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

import auth_utils
import host_audience as ha
import rbac
from auth_utils import create_access_token


ROOT = Path(__file__).resolve().parents[2]
FRONTEND_YNT_SCAN = [
    ROOT / "frontend/src/components/saas",
    ROOT / "frontend/src/pages/SystemAdminPage.jsx",
    ROOT / "frontend/src/pages/SystemLoginPage.jsx",
    ROOT / "frontend/src/pages/System2FASetupPage.jsx",
    ROOT / "frontend/src/pages/WebsiteAdminPage.jsx",
    ROOT / "frontend/src/components/IsnetIntegrationPanel.jsx",
]

# `${API_URL}/foo` — API_URL already includes /api
_API_CALL_RE = re.compile(r"""\$\{(?:API_URL|apiUrl)\}/([a-zA-Z0-9_./${}-]+)""")


def _req(host: str, path: str = "/api/auth/me", peer: str = "203.0.113.9"):
    return SimpleNamespace(
        headers={"host": host},
        client=SimpleNamespace(host=peer),
        url=SimpleNamespace(path=path),
    )


def _ynt_app():
    """Minimal app: cookie → get_user_from_token + stub integration GETs."""
    app = FastAPI()
    db = MagicMock()
    db.users = MagicMock()
    db.users.find_one = AsyncMock(
        return_value={
            "_id": "sa1",
            "email": "sa@test.com",
            "is_super_admin": True,
            "is_active": True,
            "name": "SA",
        }
    )
    db.einvoice_settings = MagicMock()
    db.einvoice_settings.find_one = AsyncMock(return_value=None)

    @app.middleware("http")
    async def _aud_gate(request: Request, call_next):
        path = request.url.path or ""
        token = request.cookies.get("access_token") or ""
        auth = request.headers.get("authorization") or ""
        if auth.lower().startswith("bearer "):
            token = auth.split(" ", 1)[1].strip()
        if token and path.startswith("/api"):
            try:
                await auth_utils.get_user_from_token(token, db, request=request, path=path)
            except HTTPException as exc:
                return JSONResponse({"detail": exc.detail}, status_code=exc.status_code)
        return await call_next(request)

    @app.get("/api/einvoice/providers")
    async def providers():
        return [{"code": "isnet", "name": "İşNet"}]

    @app.get("/api/einvoice/settings")
    async def settings(company_id: str = ""):
        return {"company_id": company_id, "status": "simulated", "provider": ""}

    @app.get("/api/integrations/isnet/egress")
    async def egress():
        return {"egress_ips": ["1.2.3.4"], "production_ips": ["1.2.3.4"], "same_as_production": True}

    return app


@pytest.fixture
def ynt_client(monkeypatch):
    monkeypatch.setenv("YNT_HOST", "ynt.taiyazilim.com")
    return TestClient(_ynt_app())


def _cookie_for(*, aud: str, sa: bool):
    tok = create_access_token(
        "sa1",
        "sa@test.com",
        "admin",
        is_super_admin=sa,
        mfa=True,
        aud=aud,
    )
    return {"access_token": tok}


def test_is_ynt_allowed_integration_paths():
    assert ha.is_ynt_allowed_path("/api/einvoice/providers")
    assert ha.is_ynt_allowed_path("/api/einvoice/settings")
    assert ha.is_ynt_allowed_path("/api/einvoice/test")
    assert ha.is_ynt_allowed_path("/api/integrations/isnet/egress")
    assert ha.is_ynt_allowed_path("/api/integrations/isnet/save")
    assert ha.is_ynt_allowed_path("/api/integrations/isnet-portal/test")
    assert ha.is_ynt_allowed_path("/api/files/upload")
    assert ha.is_ynt_allowed_path("/api/public/plans")
    assert ha.is_ynt_allowed_path("/api/public/legal/kvkk")
    # DAR: genel tenant e-fatura inbox değil
    assert not ha.is_ynt_allowed_path("/api/einvoice/incoming/sync")
    assert not ha.is_ynt_allowed_path("/api/orders")


def test_ynt_sa_integration_http_200(ynt_client, monkeypatch):
    monkeypatch.setenv("YNT_HOST", "ynt.taiyazilim.com")
    headers = {"host": "ynt.taiyazilim.com"}
    cookies = _cookie_for(aud=ha.AUD_YNT, sa=True)
    r1 = ynt_client.get("/api/einvoice/providers", headers=headers, cookies=cookies)
    assert r1.status_code == 200
    assert isinstance(r1.json(), list)
    r2 = ynt_client.get(
        "/api/einvoice/settings",
        params={"company_id": "comp_1"},
        headers=headers,
        cookies=cookies,
    )
    assert r2.status_code == 200
    assert r2.json().get("company_id") == "comp_1"
    r3 = ynt_client.get("/api/integrations/isnet/egress", headers=headers, cookies=cookies)
    assert r3.status_code == 200
    assert "egress_ips" in r3.json()


def test_ynt_app_aud_token_401(ynt_client, monkeypatch):
    monkeypatch.setenv("YNT_HOST", "ynt.taiyazilim.com")
    headers = {"host": "ynt.taiyazilim.com"}
    cookies = _cookie_for(aud=ha.AUD_APP, sa=True)
    r = ynt_client.get("/api/einvoice/providers", headers=headers, cookies=cookies)
    assert r.status_code == 401


def test_ynt_non_sa_403(ynt_client, monkeypatch):
    monkeypatch.setenv("YNT_HOST", "ynt.taiyazilim.com")
    headers = {"host": "ynt.taiyazilim.com"}
    cookies = _cookie_for(aud=ha.AUD_YNT, sa=False)
    r = ynt_client.get("/api/einvoice/providers", headers=headers, cookies=cookies)
    assert r.status_code == 403


def test_enforce_audience_allows_integration_paths(monkeypatch):
    monkeypatch.setenv("YNT_HOST", "ynt.taiyazilim.com")
    payload = {"aud": ha.AUD_YNT, "sa": True}
    for path in (
        "/api/einvoice/providers",
        "/api/einvoice/settings",
        "/api/integrations/isnet/egress",
        "/api/files/upload",
        "/api/public/plans",
    ):
        auth_utils.enforce_token_audience(payload, _req("ynt.taiyazilim.com", path), path=path)


# saas/** içinde ynt shell'e mount edilmeyen tenant panelleri
_TENANT_ONLY_SAAS = frozenset({
    "MyPlanPanel.jsx",
    "LicenseWidgets.jsx",
    "StorageManagerPanel.jsx",
})


def _iter_frontend_files():
    for entry in FRONTEND_YNT_SCAN:
        if entry.is_file():
            yield entry
        elif entry.is_dir():
            for p in entry.rglob("*"):
                if p.suffix in (".jsx", ".js", ".tsx", ".ts") and p.is_file():
                    if p.name in _TENANT_ONLY_SAAS:
                        continue
                    yield p


def _api_paths_from_source(text: str) -> set[str]:
    out = set()
    for m in _API_CALL_RE.finditer(text):
        raw = m.group(1).split("?", 1)[0]
        # Drop template segments like ${id}
        parts = []
        for seg in raw.strip("/").split("/"):
            if "${" in seg or seg.startswith(":"):
                break
            parts.append(seg)
        if not parts:
            continue
        path = "/api/" + "/".join(parts)
        out.add(path)
    return out


def test_ynt_frontend_api_paths_in_allowlist_or_public():
    """ynt UI (saas/System*/Isnet panel) çağrıları allowlist veya public olmalı."""
    skip_prefixes = (
        "/api/system",
        "/api/platform/admin",
        "/api/auth",
    )
    found = set()
    for f in _iter_frontend_files():
        text = f.read_text(encoding="utf-8", errors="ignore")
        found |= _api_paths_from_source(text)
    assert found, "ynt tarama hiç API yolu bulamadı"
    missing = []
    for path in sorted(found):
        if any(path == p or path.startswith(p.rstrip("/") + "/") or path.startswith(p) for p in skip_prefixes):
            continue
        allowed = (
            ha.is_ynt_allowed_path(path)
            or rbac.is_public_api_path(path, "GET")
            or rbac.is_public_api_path(path, "POST")
        )
        if not allowed:
            missing.append(path)
    assert not missing, f"ynt UI yolları allowlist'te yok: {missing}"
