"""İK hostu: saha listeleri portal özelliğiyle açılır, kuralsız yazma 403 kalır."""
import asyncio
import json
import os

os.environ.setdefault("JWT_SECRET", "test-ik-portal-audience-jwt-secret-not-default-32b")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

from starlette.requests import Request
from starlette.responses import JSONResponse

import auth_utils
import company_audit
import rbac


def _user():
    return {
        "id": "usr_p",
        "_id": "usr_p",
        "role": "personel",
        "email": "p@example.com",
        "name": "Personel",
        "company_ids": ["co_a"],
        "active_company_id": "co_a",
        "is_active": True,
    }


def _role(features=None):
    return {
        "code": "personel",
        "name": "Personel",
        "permissions": {
            "/atolye": "none",
            "/sevk": "none",
            "/sayim": "none",
            "/vehicles": "none",
            "/warehouses": "none",
            "/personnel": "none",
            "/saha": "none",
        },
        "features": features or {},
    }


def _http(method: str, path: str, token: str, host: str):
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method,
        "scheme": "https",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"company_id=co_a",
        "headers": [
            (b"host", host.encode()),
            (b"authorization", f"Bearer {token}".encode()),
        ],
        "client": ("203.0.113.10", 443),
        "server": (host, 443),
    }
    return Request(scope)


def _detail(resp) -> str:
    try:
        data = json.loads(resp.body)
    except Exception:
        return ""
    detail = data.get("detail") if isinstance(data, dict) else ""
    return detail if isinstance(detail, str) else ""


def test_ik_helper_reads_are_get_only():
    assert rbac.ik_helper_read_feature("/api/warehouses", "GET") == "portal_sayim"
    assert rbac.ik_helper_read_feature("/api/warehouses/", "HEAD") == "portal_sayim"
    assert rbac.ik_helper_read_feature("/api/warehouses", "POST") is None
    assert rbac.ik_helper_read_feature("/api/warehouses/stock-counts", "GET") is None
    assert rbac.ik_helper_read_feature("/api/personnel/employees", "GET") == "portal_atolye"
    assert rbac.ik_helper_read_feature("/api/personnel/employees/e1", "GET") is None
    assert rbac.ik_helper_read_feature("/api/personnel/me", "GET") is None
    assert rbac.ik_helper_read_feature("/api/companies/co_a/work-parks", "GET") == "portal_atolye"
    assert rbac.ik_helper_read_feature("/api/companies/co_a/work-parks", "PUT") is None


def test_ik_personel_portal_gate(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-ik-portal-audience-jwt-secret-not-default-32b")
    monkeypatch.setenv("ROOT_DOMAIN", "tamkobi.com")

    async def _noop(*_a, **_k):
        return None

    class _Col:
        async def insert_one(self, _doc):
            return None

    class _DB:
        activity_logs = _Col()

        def __getitem__(self, _key):
            return self.activity_logs

    monkeypatch.setattr(company_audit, "safe_prepare", _noop)
    monkeypatch.setattr(company_audit, "safe_commit", _noop)
    monkeypatch.setattr(rbac, "_db", _DB())

    user = _user()
    granted = {k: True for k in rbac.PORTAL_FEATURE_KEYS}
    state = {"role": _role(granted)}

    async def _from_token(token, _db, request=None, path=None):
        payload = auth_utils.decode_access_payload(token)
        auth_utils.enforce_token_audience(
            payload, request, path=path or getattr(getattr(request, "url", None), "path", None),
        )
        return user

    async def _role_for(_user_doc, _company_id=None):
        return state["role"]

    monkeypatch.setattr(rbac, "get_user_from_token", _from_token)
    monkeypatch.setattr(rbac, "role_for", _role_for)

    ik_token = auth_utils.create_access_token("usr_p", "p@example.com", "personel", aud="ik")
    app_token = auth_utils.create_access_token("usr_p", "p@example.com", "personel", aud="app")
    mw = rbac.PermissionAndAuditMiddleware(app=lambda *_a, **_k: None)
    calls = {"n": 0}

    async def _next(_request):
        calls["n"] += 1
        resp = JSONResponse({"items": []})

        async def _chunks():
            yield resp.body

        # Starlette 0.37 JSONResponse gövdesi body'dedir; fiyat maskesi body_iterator okur.
        resp.body_iterator = _chunks()
        return resp

    async def hit(method, path, *, token=ik_token, host="ik.tamkobi.com"):
        calls["n"] = 0
        resp = await mw.dispatch(_http(method, path, token, host), _next)
        return resp.status_code, _detail(resp), calls["n"]

    async def _run():
        lists = (
            ("GET", "/api/production/work-orders"),
            ("GET", "/api/order-picks"),
            ("GET", "/api/warehouses/stock-counts"),
            ("GET", "/api/production/work-orders/performance"),
            ("GET", "/api/production/work-orders/shopfloor-settings"),
        )
        for method, path in lists:
            status, detail, n = await hit(method, path)
            assert status == 200 and n == 1, (method, path, status, detail)

        helpers = (
            ("GET", "/api/warehouses"),
            ("GET", "/api/personnel/employees"),
            ("GET", "/api/companies/co_a/work-parks"),
        )
        for method, path in helpers:
            status, detail, n = await hit(method, path)
            assert status == 200 and n == 1, (method, path, status, detail)

        # Listed field write still passes the ik gate when the feature is on.
        status, detail, n = await hit("POST", "/api/production/work-orders/shopfloor-unlock")
        assert status == 200 and n == 1, (status, detail)

        state["role"] = _role({})
        for method, path in lists:
            status, detail, n = await hit(method, path)
            assert status == 403 and n == 0, (method, path, status, detail)
            assert "yetkiniz yok" in detail.lower(), (method, path, detail)
        for method, path in helpers:
            status, detail, n = await hit(method, path)
            assert status == 403 and n == 0, (method, path, status, detail)
            assert "yetkiniz yok" in detail.lower(), (method, path, detail)

        # Self-service stays open without portal features.
        status, detail, n = await hit("GET", "/api/personnel/me")
        assert status == 200 and n == 1, (status, detail)

        state["role"] = _role(granted)
        blocked = (
            ("PUT", "/api/production/work-orders/shopfloor-settings"),
            ("POST", "/api/production/work-orders/shopfloor-settings"),
            ("POST", "/api/production/work-orders/trash-completed"),
            ("DELETE", "/api/production/work-orders/wo_1"),
            ("POST", "/api/warehouses"),
            ("POST", "/api/personnel/employees"),
            ("PUT", "/api/companies/co_a/work-parks"),
            ("GET", "/api/invoices"),
        )
        for method, path in blocked:
            status, detail, n = await hit(method, path)
            assert status == 403 and n == 0, (method, path, status, detail)
            assert "self-servis" in detail.lower(), (method, path, detail)

        # Feature on one portal does not open another helper.
        state["role"] = _role({"portal_atolye": True})
        status, detail, n = await hit("GET", "/api/warehouses")
        assert status == 403 and n == 0 and "yetkiniz yok" in detail.lower()
        status, _detail_s, n = await hit("GET", "/api/personnel/employees")
        assert status == 200 and n == 1

        # app host: yardımcı okuma özellik bayrağına bağlanmaz.
        state["role"] = _role({})
        status, detail, n = await hit(
            "GET", "/api/warehouses", token=app_token, host="app.tamkobi.com",
        )
        assert status == 200 and n == 1, (status, detail)

    asyncio.run(_run())
