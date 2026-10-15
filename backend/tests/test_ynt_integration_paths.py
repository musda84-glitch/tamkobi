"""ynt host: e-fatura / İşNet entegrasyon yolları allowlist + audience gate."""
from __future__ import annotations

import os
import re

os.environ.setdefault("JWT_SECRET", "test-ynt-integrity-jwt-secret-not-default-32b")
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
# ynt kabuğu: saas panelleri + /sistem sayfaları (CompanyDetail dahil).
FRONTEND_YNT_SCAN = [
    ROOT / "frontend/src/components/saas",
    ROOT / "frontend/src/pages/SystemAdminPage.jsx",
    ROOT / "frontend/src/pages/SystemLoginPage.jsx",
    ROOT / "frontend/src/pages/System2FASetupPage.jsx",
    ROOT / "frontend/src/pages/WebsiteAdminPage.jsx",
    ROOT / "frontend/src/pages/CompanyDetailPage.jsx",
    ROOT / "frontend/src/components/IsnetIntegrationPanel.jsx",
    ROOT / "frontend/src/components/SmsCenter.jsx",
]

# saas/** içinde ynt'ye mount edilmeyen kiracı çağrıları.
# Bu dosyalar taranır; yalnızca bu önekler muaf. Yeni bir kiracı yolu testi düşürür.
_TENANT_CALL_ALLOW = {
    "MyPlanPanel.jsx": ("/api/license", "/api/payments"),
    "LicenseWidgets.jsx": ("/api/license",),
    "StorageManagerPanel.jsx": ("/api/storage/me",),
}

# `${API_URL}/foo` — API_URL already includes /api
_API_CALL_RE = re.compile(r"""\$\{(?:API_URL|apiUrl)\}/([a-zA-Z0-9_./${}-]+)""")
_API_PLUS_RE = re.compile(r"""(?:API_URL|apiUrl)\s*\+\s*["'](/[^"']+)["']""")
# Bileşenin apiBase="/..." prop'u (ör. platform paneli)
_API_BASE_PROP_RE = re.compile(r"""apiBase\s*=\s*["'](/[^"']+)["']""")
# SystemAdminPage: axios.get(`${API_URL}${path}`) + grab("/system/overview")
_QUOTED_API_RE = re.compile(
    r"""["'](/(?:system|auth|admin|platform|public|einvoice|integrations|comm|files|license|payments|storage|saas)[a-zA-Z0-9_./${}-]*)["']"""
)


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
    assert ha.is_ynt_allowed_path("/api/einvoice/designs")
    assert ha.is_ynt_allowed_path("/api/einvoice/designs/abc/select")
    assert ha.is_ynt_allowed_path("/api/integrations/isnet/egress")
    assert ha.is_ynt_allowed_path("/api/integrations/isnet/save")
    assert ha.is_ynt_allowed_path("/api/integrations/isnet-portal/test")
    assert ha.is_ynt_allowed_path("/api/files/upload")
    assert ha.is_ynt_allowed_path("/api/public/plans")
    assert ha.is_ynt_allowed_path("/api/public/legal/kvkk")
    assert ha.is_ynt_allowed_path("/api/public/help/articles")
    assert ha.is_ynt_allowed_path("/api/system/help/articles")
    assert ha.is_ynt_allowed_path("/api/comm/sms/settings")
    assert ha.is_ynt_allowed_path("/api/comm/sms/logs")
    assert ha.is_ynt_allowed_path("/api/comm/sms/verify")
    # DAR: genel tenant e-fatura inbox / diğer comm değil
    assert not ha.is_ynt_allowed_path("/api/einvoice/incoming/sync")
    assert not ha.is_ynt_allowed_path("/api/orders")
    assert not ha.is_ynt_allowed_path("/api/comm/mail/settings")


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


def _iter_frontend_files():
    for entry in FRONTEND_YNT_SCAN:
        if entry.is_file():
            yield entry
        elif entry.is_dir():
            for p in entry.rglob("*"):
                if p.suffix not in (".jsx", ".js", ".tsx", ".ts") or not p.is_file():
                    continue
                if ".test." in p.name or p.name.endswith(".spec.js"):
                    continue
                yield p


def _normalize_api_path(raw: str) -> str:
    raw = (raw or "").split("?", 1)[0].strip()
    if not raw:
        return ""
    parts = []
    for seg in raw.strip("/").split("/"):
        if "${" in seg or seg.startswith(":"):
            break
        parts.append(seg)
    if not parts:
        return ""
    if parts[0] == "api":
        return "/" + "/".join(parts)
    return "/api/" + "/".join(parts)


def _api_paths_from_source(text: str) -> set[str]:
    out = set()
    for m in _API_CALL_RE.finditer(text):
        path = _normalize_api_path(m.group(1))
        if path:
            out.add(path)
    for m in _API_PLUS_RE.finditer(text):
        path = _normalize_api_path(m.group(1))
        if path:
            out.add(path)
    for m in _API_BASE_PROP_RE.finditer(text):
        path = _normalize_api_path(m.group(1))
        if path:
            out.add(path)
    if "API_URL" in text or "apiUrl" in text:
        for m in _QUOTED_API_RE.finditer(text):
            path = _normalize_api_path(m.group(1))
            if path:
                out.add(path)
    return out


def _tenant_exempt(filename: str, path: str) -> bool:
    prefs = _TENANT_CALL_ALLOW.get(filename) or ()
    for pref in prefs:
        base = pref.rstrip("/")
        if path == base or path.startswith(base + "/") or path.startswith(pref):
            return True
    return False


def test_ynt_frontend_api_paths_in_allowlist_or_public():
    """saas, SystemAdmin, CompanyDetail ve /sistem sayfalarındaki axios/fetch yolları ynt allowlist'te olmalı."""
    skip_prefixes = (
        "/api/system",
        "/api/platform/admin",
        "/api/auth",
    )
    found = []
    for f in _iter_frontend_files():
        text = f.read_text(encoding="utf-8", errors="ignore")
        for path in _api_paths_from_source(text):
            found.append((f.name, path))
    assert found, "ynt tarama hiç API yolu bulamadı"
    missing = []
    for name, path in sorted(set(found)):
        if any(path == p or path.startswith(p.rstrip("/") + "/") or path.startswith(p) for p in skip_prefixes):
            continue
        if _tenant_exempt(name, path):
            continue
        allowed = (
            ha.is_ynt_allowed_path(path)
            or rbac.is_public_api_path(path, "GET")
            or rbac.is_public_api_path(path, "POST")
        )
        if not allowed:
            missing.append(f"{name}: {path}")
    assert not missing, f"ynt UI yolları allowlist'te yok: {missing}"
    names = {name for name, _path in found}
    assert "CompanyDetailPage.jsx" in names
    assert "SystemAdminPage.jsx" in names
    integrity_hits = [
        f"{name}: {path}"
        for name, path in found
        if "/integrity" in path
    ]
    assert not integrity_hits, f"veri tutarlılığı aracı kalkmış olmalı: {integrity_hits}"
