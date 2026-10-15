"""GET /api/desktop/latest: sürüm var, sürüm yok, GitHub hatası."""
import os
import sys

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-desktop-release-jwt-secret-not-default")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import auth_utils  # noqa: E402
import desktop_release  # noqa: E402

GITHUB = "https://api.github.com/repos/musda84-glitch/tamkobi/releases"


def _token():
    return auth_utils.create_access_token("usr_1", "a@example.com", "sales", aud="app")


async def _user_dep(request: Request) -> dict:
    token = auth_utils.session_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Giriş yapmanız gerekiyor.")
    payload = auth_utils.decode_access_payload(token)
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Geçersiz token türü")
    return {"id": payload["sub"], "role": payload.get("role") or "sales", "company_ids": ["co_a"]}


def _client():
    desktop_release.clear_cache()
    desktop_release.init(_user_dep)
    app = FastAPI()
    app.include_router(desktop_release.router)
    return TestClient(app, base_url="http://app.tamkobi.com")


def _release(tag, published, assets, body="Kiosk kabuğu", draft=False):
    return {
        "tag_name": tag,
        "draft": draft,
        "published_at": published,
        "body": body,
        "assets": assets,
    }


def _asset(name, url):
    return {"name": name, "browser_download_url": url}


class _Resp:
    def __init__(self, status, payload):
        self.status_code = status
        self._payload = payload
        self.request = httpx.Request("GET", GITHUB)

    def raise_for_status(self):
        if self.status_code >= 400:
            raise httpx.HTTPStatusError(
                "github",
                request=self.request,
                response=httpx.Response(self.status_code, request=self.request),
            )

    def json(self):
        return self._payload


class _Client:
    payload = []
    status = 200
    calls = 0
    error = None

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def get(self, url, headers=None, params=None):
        type(self).calls += 1
        assert url == GITHUB
        if self.error:
            raise self.error
        return _Resp(self.status, self.payload)


def setup_function():
    desktop_release.clear_cache()
    os.environ.pop("DESKTOP_DOWNLOAD_URL", None)
    _Client.payload = []
    _Client.status = 200
    _Client.calls = 0
    _Client.error = None


def _auth_client():
    client = _client()
    client.headers["Authorization"] = f"Bearer {_token()}"
    return client


def test_latest_release_returns_version_url_date_and_notes(monkeypatch):
    _Client.payload = [
        _release("v2.0.0", "2026-10-15T00:00:00Z", [_asset("app.zip", "https://cdn.example/app.zip")]),
        _release(
            "desktop-v1.2.3",
            "2026-10-14T12:00:00Z",
            [
                _asset("TamKobi_1.2.3_x64-setup.exe", "https://github.com/musda84-glitch/tamkobi/releases/download/desktop-v1.2.3/setup.exe"),
                _asset("TamKobi_1.2.3_x64_en-US.msi", "https://github.com/musda84-glitch/tamkobi/releases/download/desktop-v1.2.3/setup.msi"),
            ],
            body="Atölye kiosk",
        ),
        _release(
            "desktop-v0.9.0",
            "2026-01-01T00:00:00Z",
            [_asset("old.msi", "https://github.com/example/old.msi")],
            body="eski",
        ),
        _release("desktop-v9.9.9", "2026-11-01T00:00:00Z", [_asset("draft.msi", "https://github.com/example/draft.msi")], draft=True),
    ]
    monkeypatch.setattr(desktop_release.httpx, "AsyncClient", _Client)
    client = _auth_client()
    res = client.get("/api/desktop/latest")
    assert res.status_code == 200
    body = res.json()
    assert body["available"] is True
    assert body["version"] == "1.2.3"
    assert body["download_url"].endswith("setup.msi")
    assert body["published_at"] == "2026-10-14T12:00:00Z"
    assert body["notes"] == "Atölye kiosk"
    again = client.get("/api/desktop/latest")
    assert again.status_code == 200
    assert again.json()["version"] == "1.2.3"
    assert _Client.calls == 1


def test_env_download_url_overrides_github_asset(monkeypatch):
    _Client.payload = [
        _release(
            "desktop-v1.4.0",
            "2026-10-14T08:00:00Z",
            [_asset("setup.msi", "https://github.com/example/from-release.msi")],
            body="not",
        )
    ]
    monkeypatch.setenv("DESKTOP_DOWNLOAD_URL", "https://cdn.example/TamKobi_1.4.0_x64-setup.exe")
    monkeypatch.setattr(desktop_release.httpx, "AsyncClient", _Client)
    body = _auth_client().get("/api/desktop/latest").json()
    assert body["available"] is True
    assert body["version"] == "1.4.0"
    assert body["download_url"] == "https://cdn.example/TamKobi_1.4.0_x64-setup.exe"
    assert body["notes"] == "not"


def test_no_desktop_release_returns_available_false(monkeypatch):
    _Client.payload = [
        _release("v1.0.0", "2026-10-01T00:00:00Z", [_asset("app.msi", "https://github.com/example/app.msi")]),
    ]
    monkeypatch.setattr(desktop_release.httpx, "AsyncClient", _Client)
    res = _auth_client().get("/api/desktop/latest")
    assert res.status_code == 200
    assert res.json() == {"available": False}


def test_github_error_returns_available_false_not_500(monkeypatch):
    _Client.error = httpx.ConnectError("github down", request=httpx.Request("GET", GITHUB))
    monkeypatch.setattr(desktop_release.httpx, "AsyncClient", _Client)
    res = _auth_client().get("/api/desktop/latest")
    assert res.status_code == 200
    assert res.json() == {"available": False}


def test_github_http_error_with_env_url_still_downloads(monkeypatch):
    _Client.status = 502
    monkeypatch.setenv("DESKTOP_DOWNLOAD_URL", "https://cdn.example/TamKobi_0.3.1_x64-setup.exe")
    monkeypatch.setattr(desktop_release.httpx, "AsyncClient", _Client)
    res = _auth_client().get("/api/desktop/latest")
    assert res.status_code == 200
    body = res.json()
    assert body["available"] is True
    assert body["version"] == "0.3.1"
    assert body["download_url"].endswith("setup.exe")


def test_latest_requires_auth():
    res = _client().get("/api/desktop/latest")
    assert res.status_code == 401
