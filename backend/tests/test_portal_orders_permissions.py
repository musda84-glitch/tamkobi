"""Personel portal_orders: yalnız listedeki sipariş işlemleri. Bellek içi middleware."""
import asyncio
import json
import os

os.environ.setdefault("JWT_SECRET", "test-portal-orders-permissions-jwt-secret-not-default")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

from starlette.requests import Request
from starlette.responses import JSONResponse

import company_audit
import rbac

ALLOWED = (
    ("POST", "/api/orders/mark-form-printed"),
    ("POST", "/api/order-picks/ord_1/notify-missing"),
    ("POST", "/api/order-picks/ord_1/to-production"),
    ("POST", "/api/orders/ord_1/production-recipe"),
    ("GET", "/api/production/work-orders/stations"),
    ("GET", "/api/integrations/cargo"),
    ("GET", "/api/integrations/cargo/catalog"),
    ("POST", "/api/cargo/create-shipment"),
    ("POST", "/api/orders/ord_1/warehouse-ship"),
    ("GET", "/api/orders/ord_1/cargo-label"),
    ("GET", "/api/orders/ord_1/cargo-label/file"),
    ("POST", "/api/orders/mark-labels-printed"),
    ("GET", "/api/orders"),
    ("GET", "/api/orders/ord_1"),
)

DENIED_WRITES = (
    ("PUT", "/api/orders/ord_1"),
    ("DELETE", "/api/orders/ord_1"),
    ("POST", "/api/orders/ord_1/approve"),
    ("PUT", "/api/orders/ord_1/cargo-carrier"),
    ("POST", "/api/orders/ord_1/create-dispatch"),
    ("POST", "/api/invoices"),
    ("POST", "/api/invoices/inv_1/approve"),
)


def _user(role="personel"):
    return {
        "id": "usr_p",
        "_id": "usr_p",
        "role": role,
        "email": "p@example.com",
        "name": role,
        "company_ids": ["co_a"],
        "active_company_id": "co_a",
        "is_active": True,
    }


def _role(code="personel", features=None, permissions=None):
    base = {
        "personel": {
            "/orders": "none",
            "/cargo": "none",
            "/sevk": "none",
            "/atolye": "none",
            "/invoices": "none",
            "/saha": "view",
        },
        "sales": {"/orders": "edit", "/cargo": "edit", "/invoices": "edit"},
        "warehouse": {"/orders": "edit", "/cargo": "edit", "/invoices": "view"},
        "accountant": {"/orders": "view", "/cargo": "none", "/invoices": "edit"},
    }
    return {
        "code": code,
        "name": code,
        "permissions": permissions if permissions is not None else base[code],
        "features": features or {},
    }


def _http(method: str, path: str):
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
            (b"host", b"app.tamkobi.com"),
            (b"authorization", b"Bearer tok"),
        ],
        "client": ("203.0.113.10", 443),
        "server": ("app.tamkobi.com", 443),
    }
    return Request(scope)


def _json(payload, status=200):
    resp = JSONResponse(payload, status_code=status)

    async def _chunks():
        yield resp.body

    resp.body_iterator = _chunks()
    return resp


def test_portal_orders_is_default_off_and_not_an_area_prefix():
    assert "portal_orders" in rbac.PORTAL_FEATURE_KEYS
    label = next(lab for key, lab, _ in rbac.FEATURES if key == "portal_orders")
    assert label == "Siparişler (yazdır, eksik bildir, üretime al, kargola, kargo etiketi)"
    for code in ("personel", "sales", "warehouse", "accountant", "manager"):
        assert rbac.role_features({"code": code, "features": {}})["portal_orders"] is False
    assert rbac.role_features({"code": "personel", "features": {"portal_orders": True}})["portal_orders"] is True
    assert rbac.portal_area_for_path("/api/orders") is None
    assert rbac.portal_area_for_path("/api/orders/ord_1") is None
    assert rbac.portal_area_for_path("/api/cargo/create-shipment") is None
    assert rbac.portal_area_for_path("/api/integrations/cargo") is None
    # Örtüşen uçların ilk kuralı eski alan özelliği kalır.
    assert rbac.portal_rule_for_path("/api/order-picks/ord_1/notify-missing", "POST")[1] == "portal_pick"
    assert rbac.portal_rule_for_path("/api/order-picks/ord_1/to-production", "POST") is None
    assert rbac.portal_rule_for_path("/api/production/work-orders/stations", "GET")[1] == "portal_atolye"
    assert rbac.portal_orders_operation("/api/orders/ord_1/cargo-carrier", "PUT") is False
    assert rbac.portal_orders_operation("/api/orders", "POST") is False
    assert rbac.portal_orders_operation("/api/order-picks/ord_1/scan", "POST") is False
    assert rbac.portal_orders_operation("/api/production/work-orders/wo_1/start", "POST") is False


def test_portal_orders_middleware_allow_list(monkeypatch):
    async def _noop(*_a, **_k):
        return None

    class _Col:
        async def insert_one(self, _doc):
            return None

    class _DB:
        activity_logs = _Col()

    monkeypatch.setattr(company_audit, "safe_prepare", _noop)
    monkeypatch.setattr(company_audit, "safe_commit", _noop)
    monkeypatch.setattr(rbac, "_db", _DB())

    state = {"user": _user(), "role": _role(features={"portal_orders": True})}

    async def _from_token(_token, _db, request=None, path=None):
        return state["user"]

    async def _role_for(_user_doc, _company_id=None):
        return state["role"]

    monkeypatch.setattr(rbac, "get_user_from_token", _from_token)
    monkeypatch.setattr(rbac, "role_for", _role_for)
    mw = rbac.PermissionAndAuditMiddleware(app=lambda *_a, **_k: None)
    calls = {"n": 0}

    async def _next(_request):
        calls["n"] += 1
        if _request.url.path.rstrip("/").endswith("/ord_1") and _request.method == "GET":
            return _json({
                "id": "ord_1",
                "grand_total": 250,
                "total_amount": 250,
                "items": [{"product_name": "Raf", "quantity": 1, "unit_price": 200, "total": 200}],
            })
        return _json({"ok": True})

    async def hit(method, path):
        calls["n"] = 0
        resp = await mw.dispatch(_http(method, path), _next)
        body = {}
        try:
            body = json.loads(resp.body)
        except Exception:
            body = {}
        return resp.status_code, body, calls["n"], resp.headers.get("x-prices-masked")

    async def _run():
        for method, path in ALLOWED:
            status, _body, n, _masked = await hit(method, path)
            assert status != 403 and n == 1, (method, path, status)

        for method, path in DENIED_WRITES:
            status, body, n, _masked = await hit(method, path)
            assert status == 403 and n == 0, (method, path, status, body)
            assert "yetkiniz yok" in str(body.get("detail", "")).lower()

        # Liste dışı toplama / iş emri uçlarına sızmaz.
        for method, path in (
            ("POST", "/api/order-picks/ord_1/scan"),
            ("POST", "/api/order-picks/ord_1/complete"),
            ("POST", "/api/production/work-orders/wo_1/start"),
            ("POST", "/api/orders"),
        ):
            status, _body, n, _masked = await hit(method, path)
            assert status == 403 and n == 0, (method, path, status)

        status, body, n, masked = await hit("GET", "/api/orders/ord_1")
        assert status == 200 and n == 1
        assert masked == "1"
        assert body["grand_total"] == 0
        assert body["total_amount"] == 0
        assert body["items"][0]["unit_price"] == 0
        assert body["items"][0]["total"] == 0
        assert body["items"][0]["quantity"] == 1
        assert body["items"][0]["product_name"] == "Raf"

        state["role"] = _role(features={})
        for method, path in (
            ("POST", "/api/orders/mark-form-printed"),
            ("POST", "/api/order-picks/ord_1/notify-missing"),
            ("POST", "/api/order-picks/ord_1/to-production"),
            ("POST", "/api/orders/ord_1/production-recipe"),
            ("POST", "/api/cargo/create-shipment"),
            ("POST", "/api/orders/ord_1/warehouse-ship"),
            ("POST", "/api/orders/mark-labels-printed"),
            ("GET", "/api/production/work-orders/stations"),
        ):
            status, _body, n, _masked = await hit(method, path)
            assert status == 403 and n == 0, (method, path, status)

        # Saha listesi özellik kapalıyken de okunur (portal alanı yok).
        status, _body, n, _masked = await hit("GET", "/api/orders")
        assert status == 200 and n == 1

        state["role"] = _role(features={"portal_pick": True})
        status, _body, n, _masked = await hit("POST", "/api/order-picks/ord_1/notify-missing")
        assert status == 200 and n == 1
        status, _body, n, _masked = await hit("POST", "/api/order-picks/ord_1/to-production")
        assert status == 403 and n == 0
        status, _body, n, _masked = await hit("POST", "/api/order-picks/ord_1/scan")
        assert status == 200 and n == 1

        state["role"] = _role(features={"portal_saha": True})
        status, _body, n, _masked = await hit("POST", "/api/orders")
        assert status == 200 and n == 1, status
        status, _body, n, _masked = await hit("POST", "/api/cargo/create-shipment")
        assert status == 403 and n == 0

        for code in ("sales", "warehouse"):
            state["user"] = _user(code)
            state["role"] = _role(code)
            status, _body, n, _masked = await hit("POST", "/api/cargo/create-shipment")
            assert status == 200 and n == 1, (code, status)
            status, _body, n, _masked = await hit("POST", "/api/orders/ord_1/warehouse-ship")
            assert status == 200 and n == 1, (code, status)

        state["user"] = _user("accountant")
        state["role"] = _role("accountant")
        status, body, n, _masked = await hit("POST", "/api/cargo/create-shipment")
        assert status == 403 and n == 0
        assert "yetkiniz yok" in str(body.get("detail", "")).lower()

    asyncio.run(_run())
