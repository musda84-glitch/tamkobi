"""PR2: GET görünürlüğü varsayılan enforce. Yetkili 200, yetkisiz 403.

Gölge davranış yalnız RBAC_GET_ENFORCE=shadow ile döner.
Yeni GET rotası modüle, paylaşılan listeye, portala veya çapraz satıra
bağlanmazsa test_rbac_get_routes_covered kırılır.
"""
import asyncio
import json
import os

os.environ.setdefault("JWT_SECRET", "test-rbac-pr2-get-enforcement-jwt-secret-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

from types import SimpleNamespace

from starlette.requests import Request
from starlette.responses import JSONResponse

import company_audit
import rbac


# Temel ekranların kendi GET'i. Çapraz seçici ve paylaşılan kabuk burada değil.
SCREEN_GETS = (
    ("/", "/api/dashboard/manager-summary"),
    ("/invoices", "/api/invoices"),
    ("/edoc-inbox", "/api/edocs/inbox"),
    ("/dis-ticaret", "/api/trade-files"),
    ("/contacts", "/api/contacts/flags"),
    ("/b2b-yonetim", "/api/companies/co/b2b-settings"),
    ("/installments", "/api/installments"),
    ("/reports", "/api/reports/sales"),
    ("/banking", "/api/banking/transactions"),
    ("/expenses", "/api/expenses"),
    ("/loans", "/api/loans"),
    ("/cheques", "/api/cheques"),
    ("/stock", "/api/products/reorder-preview"),
    ("/purchase-orders", "/api/purchase-orders"),
    ("/sayim", "/api/warehouses/stock-counts"),
    ("/quotes", "/api/quotes"),
    ("/projects", "/api/projects"),
    ("/surveys", "/api/surveys"),
    ("/ecommerce", "/api/marketplace/products"),
    ("/cargo", "/api/cargo/shipments"),
    ("/orders", "/api/orders"),
    ("/hizli-satis", "/api/pos/session"),
    ("/sevk", "/api/order-picks"),
    ("/warehouses", "/api/warehouses/transfers"),
    ("/vehicles", "/api/vehicles"),
    ("/production", "/api/production/recipes"),
    ("/atolye", "/api/production/work-orders"),
    ("/personnel", "/api/personnel/pending-requests"),
    ("/communication", "/api/comm/mail/messages"),
    ("/support", "/api/support/tickets"),
    ("/ai-advisor", "/api/ai/status"),
    ("/accountant", "/api/accountant/summary"),
    ("/settings", "/api/users"),
    ("/trash", "/api/trash"),
)

# /saha ve /mesai'nin ayrı liste GET'i yok. Saha siparişi /orders yazar;
# puantaj okuması /personnel altında handler süzgecindedir.
PORTAL_GETS = (
    ("portal_atolye", "/api/production/work-orders"),
    ("portal_atolye", "/api/production/work-orders/shopfloor-operators"),
    ("portal_pick", "/api/order-picks"),
    ("portal_sayim", "/api/warehouses/stock-counts"),
    ("portal_vehicles", "/api/vehicles"),
    ("portal_orders", "/api/orders"),
    ("portal_saha", "/api/products"),
)

LEVELS = ("none", "view", "edit", "delete")


def _perms(**kwargs):
    base = {key: "none" for key, _label in rbac.MODULES}
    base.update(kwargs)
    return base


def _user(role="clerk", **extra):
    base = {
        "id": "usr_p",
        "role": role,
        "email": "p@example.com",
        "name": role,
        "company_ids": ["co"],
        "active_company_id": "co",
    }
    base.update(extra)
    return base


def _role(code="clerk", permissions=None, features=None, name="Kayıt"):
    return {
        "code": code,
        "name": name,
        "permissions": permissions if permissions is not None else _perms(),
        "features": features or {},
    }


def _http(method, path, query="company_id=co", token="tok"):
    headers = [
        (b"host", b"app.tamkobi.com"),
        (b"authorization", f"Bearer {token}".encode()),
    ]
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method,
        "scheme": "https",
        "path": path,
        "raw_path": path.encode(),
        "query_string": query.encode(),
        "headers": headers,
        "client": ("203.0.113.50", 443),
        "server": ("app.tamkobi.com", 443),
    }
    request = Request(scope)
    request.scope["route"] = SimpleNamespace(path=path)
    return request


def _http_anon(method, path):
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method,
        "scheme": "https",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "headers": [(b"host", b"app.tamkobi.com")],
        "client": ("203.0.113.50", 443),
        "server": ("app.tamkobi.com", 443),
    }
    request = Request(scope)
    request.scope["route"] = SimpleNamespace(path=path)
    return request


def _json(payload, status=200):
    resp = JSONResponse(payload, status_code=status)

    async def _chunks():
        yield resp.body

    resp.body_iterator = _chunks()
    return resp


def _install(monkeypatch, user, role):
    async def _noop(*_a, **_k):
        return None

    class _Col:
        async def insert_one(self, _doc):
            return None

    class _DB:
        activity_logs = _Col()

    async def _from_token(_token, _db, request=None, path=None):
        return user

    async def _role_for(_user_doc, _company_id=None):
        return role

    monkeypatch.setattr(company_audit, "safe_prepare", _noop)
    monkeypatch.setattr(company_audit, "safe_commit", _noop)
    monkeypatch.setattr(rbac, "_db", _DB())
    monkeypatch.setattr(rbac, "_license_guard", _noop)
    monkeypatch.setattr(rbac, "get_user_from_token", _from_token)
    monkeypatch.setattr(rbac, "role_for", _role_for)
    import addons
    monkeypatch.setattr(addons, "guard_request", _noop)
    return rbac.PermissionAndAuditMiddleware(app=lambda *_a, **_k: None)


def _hit(mw, method, path, query="company_id=co", anon=False):
    calls = {"n": 0}

    async def _next(_request):
        calls["n"] += 1
        return _json({"ok": True, "grand_total": 250, "total_amount": 250, "items": [{"unit_price": 10, "total": 10}]})

    request = _http_anon(method, path) if anon else _http(method, path, query)

    async def _run():
        resp = await mw.dispatch(request, _next)
        body = resp.body if getattr(resp, "body", None) else b""
        return resp.status_code, body, calls["n"], resp.headers.get("x-prices-masked")

    return asyncio.run(_run())


def test_screen_matrix_levels_and_portal(monkeypatch):
    monkeypatch.setenv("RBAC_GET_ENFORCE", "enforce")
    assert rbac.rbac_get_enforce_mode() == "enforce"
    user = _user("clerk")
    for module, path in SCREEN_GETS:
        for level in LEVELS:
            role = _role(permissions=_perms(**{module: level}))
            mw = _install(monkeypatch, user, role)
            status, _body, n, _masked = _hit(mw, "GET", path)
            if level == "none":
                assert status == 403 and n == 0, (module, path, level, status)
            else:
                assert status == 200 and n == 1, (module, path, level, status)

    personel = _user("personel")
    for feature, path in PORTAL_GETS:
        opened = _role("personel", _perms(), features={feature: True}, name="Personel")
        mw = _install(monkeypatch, personel, opened)
        status, _body, n, _masked = _hit(mw, "GET", path)
        assert status == 200 and n == 1, (feature, path, status)

        closed = _role("personel", _perms(), features={}, name="Personel")
        mw = _install(monkeypatch, personel, closed)
        status, _body, n, _masked = _hit(mw, "GET", path)
        assert status == 403 and n == 0, (feature, path, status)


def test_admin_super_and_public_stay_open(monkeypatch):
    monkeypatch.setenv("RBAC_GET_ENFORCE", "enforce")
    locked = _role(permissions=_perms())
    admin = _install(monkeypatch, _user("admin"), locked)
    status, _body, n, _masked = _hit(admin, "GET", "/api/invoices")
    assert status == 200 and n == 1
    super_user = _install(monkeypatch, _user("personel", is_super_admin=True), locked)
    status, _body, n, _masked = _hit(super_user, "GET", "/api/edocs/inbox")
    assert status == 200 and n == 1

    anon = _install(monkeypatch, None, None)
    for path in ("/api/health", "/api/auth/forgot-password", "/api/auth/reset/tok"):
        status, _body, n, _masked = _hit(anon, "GET", path, anon=True)
        assert status == 200 and n == 1, path
    status, _body, n, _masked = _hit(anon, "GET", "/api/invoices", anon=True)
    assert status == 401 and n == 0


def test_shared_shell_profile_search_files_and_scoped_lists(monkeypatch):
    monkeypatch.setenv("RBAC_GET_ENFORCE", "enforce")
    user = _user("personel")
    role = _role("personel", _perms(), name="Personel")
    mw = _install(monkeypatch, user, role)
    for path in (
        "/api/fx/rates",
        "/api/fx/quote",
        "/api/fx/currencies",
        "/api/expenses/categories",
        "/api/companies/co/support-session",
        "/api/search",
        "/api/notifications",
        "/api/personnel/me",
        "/api/files/logo.png",
        "/api/auth/me",
        "/api/dashboard/stats",
        "/api/dashboard/overview",
        "/api/personnel/leaves",
        "/api/personnel/payrolls",
        "/api/personnel/attendance",
        "/api/products/units",
        "/api/geocode",
    ):
        status, _body, n, _masked = _hit(mw, "GET", path)
        assert status == 200 and n == 1, path

    for path in (
        "/api/companies/co/privacy",
        "/api/dashboard/manager-summary",
        "/api/dashboard/ops-alerts",
        "/api/users",
        "/api/personnel/pending-requests",
        "/api/personnel/employees/emp_1/card",
    ):
        status, _body, n, _masked = _hit(mw, "GET", path)
        assert status == 403 and n == 0, path


def test_dictionary_and_print_follow_the_module(monkeypatch):
    monkeypatch.setenv("RBAC_GET_ENFORCE", "enforce")
    user = _user("sales")
    bare = _role("sales", _perms(), name="Satış")
    mw = _install(monkeypatch, user, bare)
    status, _body, n, _masked = _hit(mw, "GET", "/api/companies/co/print-templates")
    assert status == 403 and n == 0
    status, _body, n, _masked = _hit(mw, "GET", "/api/gib/lookup")
    assert status == 403 and n == 0

    invoices = _role("sales", _perms(**{"/invoices": "view"}), name="Satış")
    mw = _install(monkeypatch, user, invoices)
    status, _body, n, _masked = _hit(mw, "GET", "/api/companies/co/print-templates")
    assert status == 200 and n == 1
    status, _body, n, _masked = _hit(mw, "GET", "/api/gib/lookup")
    assert status == 200 and n == 1

    mesai = _role("personel", _perms(**{"/mesai": "view"}), name="Personel")
    mw = _install(monkeypatch, _user("personel"), mesai)
    status, _body, n, _masked = _hit(mw, "GET", "/api/companies/co/work-schedule")
    assert status == 200 and n == 1
    assert rbac.module_for_path("/api/companies/co/work-schedule") == "/settings"

    b2b = _role("sales", _perms(**{"/b2b-yonetim": "view", "/settings": "none"}), name="Satış")
    mw = _install(monkeypatch, user, b2b)
    status, _body, n, _masked = _hit(mw, "GET", "/api/companies/co/b2b-settings")
    assert status == 200 and n == 1
    assert rbac.module_for_get_path("/api/demo/status") == "/"
    dash = _role("sales", _perms(**{"/": "view", "/settings": "none"}), name="Satış")
    mw = _install(monkeypatch, user, dash)
    status, _body, n, _masked = _hit(mw, "GET", "/api/demo/status")
    assert status == 200 and n == 1
    assert rbac.module_for_path("/api/fx/rates") == "/settings"
    assert rbac.mutation_allowed("/settings", "/api/fx/rates", _perms(), "PUT") is False
    assert rbac.mutation_allowed("/settings", "/api/fx/rates", _perms(**{"/settings": "edit"}), "PUT") is True


def test_view_prices_still_masks_allowed_gets(monkeypatch):
    monkeypatch.setenv("RBAC_GET_ENFORCE", "enforce")
    role = _role("sales", _perms(**{"/invoices": "view"}), features={"view_prices": False}, name="Satış")
    mw = _install(monkeypatch, _user("sales"), role)
    status, body, n, masked = _hit(mw, "GET", "/api/invoices")
    assert status == 200 and n == 1 and masked == "1"
    payload = json.loads(body)
    assert payload["grand_total"] == 0
    assert payload["total_amount"] == 0
    assert payload["items"][0]["unit_price"] == 0
    assert payload["ok"] is True


def test_shadow_env_restores_the_old_get(monkeypatch):
    monkeypatch.setenv("RBAC_GET_ENFORCE", "shadow")
    role = _role(permissions=_perms(**{"/invoices": "none"}), name="Kayıt")
    mw = _install(monkeypatch, _user("clerk"), role)
    status, _body, n, _masked = _hit(mw, "GET", "/api/invoices")
    assert status == 200 and n == 1
    monkeypatch.setenv("RBAC_GET_ENFORCE", "enforce")
    status, _body, n, _masked = _hit(mw, "GET", "/api/invoices")
    assert status == 403 and n == 0


def test_head_follows_get_and_post_stays_a_write(monkeypatch):
    monkeypatch.setenv("RBAC_GET_ENFORCE", "enforce")
    user = _user("sales")
    view = _role("sales", _perms(**{"/invoices": "view"}), name="Satış")
    mw = _install(monkeypatch, user, view)
    status, _body, n, _masked = _hit(mw, "HEAD", "/api/invoices")
    assert status == 200 and n == 1
    status, _body, n, _masked = _hit(mw, "POST", "/api/invoices")
    assert status == 403 and n == 0
    edit = _role("sales", _perms(**{"/invoices": "edit"}), name="Satış")
    mw = _install(monkeypatch, user, edit)
    status, _body, n, _masked = _hit(mw, "POST", "/api/invoices")
    assert status == 200 and n == 1


def test_unmapped_get_is_denied():
    user = _user("clerk")
    role = _role(permissions=_perms(**{"/": "delete"}))
    assert rbac.get_view_decision(user, role, "/api/brand-new-unmapped") == ("deny", "unmapped")
    assert rbac.get_view_route_bucket("/api/brand-new-unmapped") is None
