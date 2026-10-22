"""GET/HEAD görünürlük kararı. Gölge mod engellemez; red yalnız loglanır."""
import asyncio
import hashlib
import json
import logging
from types import SimpleNamespace

from starlette.requests import Request
from starlette.responses import JSONResponse

import company_audit
import rbac


def _user(role="personel", **extra):
    base = {
        "id": "usr_p",
        "role": role,
        "company_ids": ["co_a"],
        "active_company_id": "co_a",
    }
    base.update(extra)
    return base


def _perms(**levels):
    perms = {key: "none" for key, _label in rbac.MODULES}
    perms.update(levels)
    return perms


def _role(code="personel", permissions=None, features=None):
    return {
        "code": code,
        "name": code,
        "permissions": permissions if permissions is not None else _perms(),
        "features": features or {},
    }


def _decision(user, role, path, method="GET"):
    return rbac.get_view_decision(user, role, path, method)


def test_personel_cannot_view_edocs_or_invoices():
    user = _user()
    role = _role(permissions=_perms())
    decision, reason = _decision(user, role, "/api/edocs/inbox")
    assert decision == "deny"
    assert reason == "module_denied"
    decision, reason = _decision(user, role, "/api/invoices")
    assert decision == "deny"
    assert reason == "module_denied"


def test_advisor_can_view_edocs():
    user = _user("advisor")
    role = _role("advisor", permissions=_perms(**{"/edoc-inbox": "view"}))
    decision, reason = _decision(user, role, "/api/edocs/inbox")
    assert (decision, reason) == ("allow", "module_view")


def test_admin_owner_and_super_admin_allow():
    path = "/api/edocs/inbox"
    assert _decision(_user("admin"), None, path)[0] == "allow"
    assert _decision(_user("owner"), None, path) == ("allow", "admin_role")
    assert _decision(_user("yönetici"), None, path)[0] == "allow"
    super_user = _user("personel", is_super_admin=True)
    assert _decision(super_user, _role(), path) == ("allow", "super_admin")


def test_personel_shared_and_skip_reads_allow():
    user = _user()
    role = _role()
    for path in (
        "/api/notifications",
        "/api/auth/me",
        "/api/personnel/me",
        "/api/companies/co_a",
        "/api/companies/co_a/workshop-zones",
        "/api/dashboard/stats",
        "/api/products/units",
        "/api/help/articles",
        "/api/geocode",
    ):
        decision, reason = _decision(user, role, path)
        assert decision == "allow", (path, decision, reason)


def test_screen_shell_without_role_filter_stays_on_module():
    templates = [template for _method, template in rbac.READ_SHARED_GET_ALLOWLIST]
    for banned in ("manager-summary", "ops-alerts", "b2b-settings", "privacy", "print-templates"):
        assert not any(banned in template for template in templates), banned
    user = _user()
    role = _role(permissions=_perms(**{"/": "none", "/settings": "none"}))
    assert _decision(user, role, "/api/dashboard/manager-summary")[0] == "deny"
    assert _decision(user, role, "/api/companies/co_a/b2b-settings")[0] == "deny"
    assert _decision(user, role, "/api/companies/co_a/privacy")[0] == "deny"
    assert _decision(user, role, "/api/companies/co_a/print-templates")[0] == "deny"
    # Pano kabuğu paylaşılan listededir; / view gerekmez.
    assert _decision(user, role, "/api/dashboard/stats")[0] == "allow"


def test_portal_orders_reads_follow_the_feature():
    user = _user()
    opened = _role(features={"portal_orders": True})
    closed = _role(features={})
    for path in (
        "/api/orders",
        "/api/orders/ord_1",
        "/api/orders/ord_1/cargo-label",
        "/api/integrations/cargo",
    ):
        assert _decision(user, opened, path)[0] == "allow", path
        assert _decision(user, closed, path)[0] == "deny", path
        assert _decision(user, opened, path, "HEAD")[0] == "allow", path


def test_portal_saha_opens_product_and_contact_pickers():
    user = _user()
    # Çapraz modül view yok; yalnız portal bayrağı karar versin.
    # (Varsayılan personelde /atolye edit olduğu için ürün satırı ayrıca allow olur.)
    opened = _role(features={"portal_saha": True})
    closed = _role(features={})
    assert _decision(user, opened, "/api/products") == ("allow", "cross_module")
    assert _decision(user, opened, "/api/contacts/search") == ("allow", "cross_module")
    assert _decision(user, closed, "/api/products")[0] == "deny"
    assert _decision(user, closed, "/api/contacts/search")[0] == "deny"
    sales_user = _user("sales")
    sales_role = _role("sales", features={"portal_saha": True})
    assert _decision(sales_user, sales_role, "/api/products")[0] == "deny"


def test_sales_with_orders_view_can_read_products_when_stock_is_none():
    user = _user("sales")
    role = _role("sales", permissions=_perms(**{"/orders": "view", "/stock": "none"}))
    assert _decision(user, role, "/api/products") == ("allow", "cross_module")
    assert _decision(user, role, "/api/products/prd_1")[0] == "allow"
    assert _decision(user, role, "/api/products/prd_1/movements")[0] == "deny"
    assert _decision(user, role, "/api/products/prd_1/purchase-costs")[0] == "deny"
    assert _decision(user, role, "/api/contacts/cnt_1/statement")[0] == "deny"


def test_atolye_and_production_view_bridge():
    production = _role("production", permissions=_perms(**{"/production": "view", "/atolye": "none"}))
    assert _decision(_user("production"), production, "/api/production/work-orders") == ("allow", "module_view")
    workshop = _role("atolye", permissions=_perms(**{"/atolye": "view", "/production": "none"}))
    assert _decision(_user("atolye"), workshop, "/api/production/recipes") == ("allow", "module_view")


def test_unmapped_path_and_missing_role_deny():
    user = _user()
    assert _decision(user, _role(), "/api/this-route-does-not-exist") == ("deny", "unmapped")
    assert _decision(user, None, "/api/invoices") == ("deny", "no_role")
    assert _decision(None, None, "/api/invoices") == ("deny", "no_user")


def test_get_extra_does_not_change_mutation_mapping():
    assert rbac.module_for_path("/api/e-invoice/inv_1/pdf") == "/invoices"
    assert rbac.module_for_get_path("/api/e-invoice/inv_1/pdf") == "/invoices"
    assert rbac.mutation_allowed(None, "/api/unknown-write", {"/invoices": "edit"}, "POST") is False
    assert rbac.mutation_allowed("/invoices", "/api/e-invoice/create", {"/invoices": "none"}, "POST") is False
    assert rbac.mutation_allowed("/invoices", "/api/e-invoice/create", {"/invoices": "edit"}, "POST") is True
    assert rbac.module_for_get_path("/api/integrations/cargo") == "/cargo"
    assert rbac.module_for_get_path("/api/integrations/ecommerce/mappings") == "/ecommerce"
    assert rbac.module_for_get_path("/api/integrations/isnet/egress") == "/settings"
    assert rbac.module_for_path("/api/integrations/isnet/egress") is None
    assert rbac.module_for_path("/api/integrations/isnet/save") == "/settings"
    assert rbac.module_for_get_path("/api/expense-budgets") == "/expenses"
    assert rbac.module_for_path("/api/expense-budgets") == "/expenses"
    assert rbac.module_for_get_path("/api/marketplace/products") == "/ecommerce"
    assert rbac.module_for_path("/api/marketplace/claims/c1/approve") == "/orders"
    assert rbac.module_for_get_path("/api/account/gib-credits") == "/settings"
    assert rbac.module_for_get_path("/api/label-templates") == "/stock"
    assert rbac.module_for_path("/api/label-templates") == "/stock"
    assert rbac.module_for_get_path("/api/personnel/attendance") == "/personnel"
    assert rbac.module_for_path("/api/personnel/attendance/att_1/confirm") == "/personnel"


def _http(method, path, query, token):
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method,
        "scheme": "https",
        "path": path,
        "raw_path": path.encode(),
        "query_string": query.encode(),
        "headers": [
            (b"host", b"app.tamkobi.com"),
            (b"authorization", f"Bearer {token}".encode()),
        ],
        "client": ("203.0.113.50", 443),
        "server": ("app.tamkobi.com", 443),
    }
    request = Request(scope)
    request.scope["route"] = SimpleNamespace(path="/api/edocs/inbox")
    return request


def _json(payload, status=200):
    resp = JSONResponse(payload, status_code=status)

    async def _chunks():
        yield resp.body

    resp.body_iterator = _chunks()
    return resp


def _install_middleware(monkeypatch, role):
    async def _noop(*_a, **_k):
        return None

    class _Col:
        async def insert_one(self, _doc):
            return None

    class _DB:
        activity_logs = _Col()

    user = {
        "id": "usr_secret_id_42",
        "role": "personel",
        "email": "ada@example.com",
        "name": "Ada Lovelace",
        "phone": "5551234567",
        "company_ids": ["comp_secret_99"],
        "active_company_id": "comp_secret_99",
    }

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
    rbac._RBAC_GET_DENY_LOG_AT.clear()
    return rbac.PermissionAndAuditMiddleware(app=lambda *_a, **_k: None)


def test_shadow_deny_returns_200_without_secrets(monkeypatch, caplog):
    monkeypatch.delenv("RBAC_GET_ENFORCE", raising=False)
    role = _role(permissions=_perms(**{"/edoc-inbox": "none", "/invoices": "none"}))
    mw = _install_middleware(monkeypatch, role)
    calls = {"n": 0}

    async def _next(_request):
        calls["n"] += 1
        return _json({"ok": True, "email": "ada@example.com"})

    query = "token=super-secret-token&email=ada@example.com&phone=5551234567"
    request = _http("GET", "/api/edocs/inbox", query, "super-secret-token")

    async def _run():
        with caplog.at_level(logging.WARNING, logger="rbac"):
            resp = await mw.dispatch(request, _next)
        return resp

    resp = asyncio.run(_run())
    assert resp.status_code == 200
    assert calls["n"] == 1
    lines = [rec.getMessage() for rec in caplog.records if rec.getMessage().startswith("rbac_get_would_deny")]
    assert len(lines) == 1
    text = lines[0]
    assert "method=GET" in text
    assert "route=/api/edocs/inbox" in text
    assert "module=/edoc-inbox" in text
    assert "reason=module_denied" in text
    assert "role=personel" in text
    user_hash = hashlib.sha256(b"usr_secret_id_42").hexdigest()[:12]
    company_hash = hashlib.sha256(b"comp_secret_99").hexdigest()[:12]
    assert f"user={user_hash}" in text
    assert f"company={company_hash}" in text
    for secret in (
        "super-secret-token",
        "ada@example.com",
        "Ada Lovelace",
        "5551234567",
        "usr_secret_id_42",
        "comp_secret_99",
        "203.0.113.50",
        "token=",
        "email=",
    ):
        assert secret not in text

    async def _again():
        with caplog.at_level(logging.WARNING, logger="rbac"):
            return await mw.dispatch(request, _next)

    asyncio.run(_again())
    lines = [rec.getMessage() for rec in caplog.records if rec.getMessage().startswith("rbac_get_would_deny")]
    assert len(lines) == 1


def test_head_uses_view_shadow_not_mutation(monkeypatch, caplog):
    monkeypatch.setenv("RBAC_GET_ENFORCE", "shadow")
    role = _role(permissions=_perms(**{"/invoices": "none"}))
    mw = _install_middleware(monkeypatch, role)
    calls = {"n": 0}

    async def _next(_request):
        calls["n"] += 1
        return _json({"ok": True})

    request = _http("HEAD", "/api/invoices", "email=ada@example.com", "super-secret-token")
    request.scope["route"] = SimpleNamespace(path="/api/invoices")

    async def _run():
        with caplog.at_level(logging.WARNING, logger="rbac"):
            return await mw.dispatch(request, _next)

    resp = asyncio.run(_run())
    assert resp.status_code == 200
    assert calls["n"] == 1
    lines = [rec.getMessage() for rec in caplog.records if "rbac_get_would_deny" in rec.getMessage()]
    assert len(lines) == 1
    assert "method=HEAD" in lines[0]
    assert "route=/api/invoices" in lines[0]
    assert "ada@example.com" not in lines[0]
    assert "super-secret-token" not in lines[0]


def test_enforce_blocks_and_off_skips_the_log(monkeypatch, caplog):
    role = _role(permissions=_perms(**{"/invoices": "none"}))
    mw = _install_middleware(monkeypatch, role)
    calls = {"n": 0}

    async def _next(_request):
        calls["n"] += 1
        return _json({"ok": True})

    request = _http("GET", "/api/invoices", "", "super-secret-token")
    request.scope["route"] = SimpleNamespace(path="/api/invoices")

    async def _hit():
        with caplog.at_level(logging.WARNING, logger="rbac"):
            return await mw.dispatch(request, _next)

    monkeypatch.setenv("RBAC_GET_ENFORCE", "enforce")
    resp = asyncio.run(_hit())
    assert resp.status_code == 403
    assert calls["n"] == 0

    monkeypatch.setenv("RBAC_GET_ENFORCE", "off")
    caplog.clear()
    resp = asyncio.run(_hit())
    assert resp.status_code == 200
    assert calls["n"] == 1
    assert not [rec for rec in caplog.records if "rbac_get_would_deny" in rec.getMessage()]


def test_literal_subresources_stay_on_the_primary_module():
    user = _user()
    opened = _role(features={"portal_saha": True})
    decision, reason = _decision(user, opened, "/api/products/reorder-preview")
    assert (decision, reason) == ("deny", "module_denied")
    decision, reason = _decision(user, opened, "/api/contacts/flags")
    assert (decision, reason) == ("deny", "module_denied")
    assert rbac.cross_module_view_matches("/api/products/reorder-preview") is False
    assert rbac.cross_module_view_matches("/api/contacts/flags") is False
    assert rbac.cross_module_view_matches("/api/products/units") is False
    assert rbac.cross_module_view_matches("/api/products/categories") is False
    assert _decision(user, opened, "/api/products") == ("allow", "cross_module")
    assert _decision(user, opened, "/api/products/prd_1") == ("allow", "cross_module")
    assert _decision(user, opened, "/api/contacts/search") == ("allow", "cross_module")
    assert _decision(user, opened, "/api/contacts/cnt_1") == ("allow", "cross_module")
    assert _decision(user, opened, "/api/products/units")[0] == "allow"
    with_contacts = _role(
        features={"portal_saha": True},
        permissions=_perms(**{"/contacts": "view"}),
    )
    assert _decision(user, with_contacts, "/api/contacts/flags") == ("allow", "module_view")
    with_stock = _role(
        features={"portal_saha": True},
        permissions=_perms(**{"/stock": "view"}),
    )
    assert _decision(user, with_stock, "/api/products/reorder-preview") == ("allow", "module_view")


def test_post_mutation_still_denies_personel(monkeypatch):
    monkeypatch.setenv("RBAC_GET_ENFORCE", "shadow")
    role = _role("personel", permissions=_perms(**{"/invoices": "none"}), features={})
    role["name"] = "Personel"
    mw = _install_middleware(monkeypatch, role)
    calls = {"n": 0}

    async def _next(_request):
        calls["n"] += 1
        return _json({"ok": True})

    request = _http("POST", "/api/invoices", "company_id=comp_secret_99", "super-secret-token")

    resp = asyncio.run(mw.dispatch(request, _next))
    assert resp.status_code == 403
    assert calls["n"] == 0


class _RoleLookupError(RuntimeError):
    """role_for kasıtlı olarak düşer. Mesaj gizli alan taşır; loga yazılmamalı."""


def test_role_for_error_shadow_passes_and_enforce_closes(monkeypatch, caplog):
    role = _role(permissions=_perms(**{"/invoices": "none"}))
    mw = _install_middleware(monkeypatch, role)
    secret = "token=super-secret-token email=ada@example.com phone=5551234567 q=company_id=comp_secret_99"

    async def _boom(_user_doc, _company_id=None):
        raise _RoleLookupError(secret)

    monkeypatch.setattr(rbac, "role_for", _boom)
    calls = {"n": 0}

    async def _next(_request):
        calls["n"] += 1
        return _json({"ok": True, "email": "ada@example.com"})

    query = "token=super-secret-token&email=ada@example.com"
    request = _http("GET", "/api/invoices", query, "super-secret-token")
    request.scope["route"] = SimpleNamespace(path="/api/invoices")

    async def _hit():
        with caplog.at_level(logging.WARNING, logger="rbac"):
            return await mw.dispatch(request, _next)

    monkeypatch.setenv("RBAC_GET_ENFORCE", "shadow")
    resp = asyncio.run(_hit())
    assert resp.status_code == 200
    assert calls["n"] == 1
    lines = [rec for rec in caplog.records if rec.getMessage().startswith("rbac_get_view_error")]
    assert len(lines) == 1
    text = lines[0].getMessage()
    assert "method=GET" in text
    assert "route=/api/invoices" in text
    assert "error=_RoleLookupError" in text
    assert lines[0].exc_info is None
    for hidden in (
        secret,
        "super-secret-token",
        "ada@example.com",
        "5551234567",
        "comp_secret_99",
        "token=",
        "email=",
    ):
        assert hidden not in text
    body = resp.body.decode()
    assert "super-secret-token" not in body
    assert secret not in body

    monkeypatch.setenv("RBAC_GET_ENFORCE", "off")
    caplog.clear()
    calls["n"] = 0

    async def _off_view(*_a, **_k):
        raise _RoleLookupError(secret)

    monkeypatch.setattr(rbac, "_shadow_get_view", _off_view)
    resp = asyncio.run(_hit())
    assert resp.status_code == 200
    assert calls["n"] == 1
    off_lines = [rec.getMessage() for rec in caplog.records if rec.getMessage().startswith("rbac_get_view_error")]
    assert len(off_lines) == 1
    assert "error=_RoleLookupError" in off_lines[0]
    assert secret not in off_lines[0]
    assert "super-secret-token" not in off_lines[0]

    monkeypatch.setenv("RBAC_GET_ENFORCE", "enforce")
    caplog.clear()
    calls["n"] = 0
    resp = asyncio.run(_hit())
    assert resp.status_code == 403
    assert calls["n"] == 0
    enforce_lines = [rec.getMessage() for rec in caplog.records if "rbac_get_view_error" in rec.getMessage()]
    assert enforce_lines
    assert secret not in enforce_lines[0]
    assert "super-secret-token" not in enforce_lines[0]
    denied = resp.body.decode()
    assert secret not in denied
    assert "super-secret-token" not in denied
    assert "ada@example.com" not in denied
    assert "_RoleLookupError" not in denied


def _priced_invoice():
    return {
        "grand_total": 250,
        "total_amount": 250,
        "email": "ada@example.com",
        "items": [{"product_name": "Raf", "quantity": 1, "unit_price": 200, "total": 200}],
    }


def test_view_lookup_failure_masks_prices(monkeypatch, caplog):
    monkeypatch.setenv("RBAC_GET_ENFORCE", "shadow")
    secret = "token=super-secret-token email=ada@example.com phone=5551234567"
    mw = _install_middleware(monkeypatch, _role(features={"view_prices": False}))
    lookups = {"n": 0}

    async def _boom(_user_doc, _company_id=None):
        lookups["n"] += 1
        raise _RoleLookupError(secret)

    monkeypatch.setattr(rbac, "role_for", _boom)

    async def _next(_request):
        return _json(_priced_invoice())

    request = _http("GET", "/api/invoices", "email=ada@example.com&token=super-secret-token", "super-secret-token")
    request.scope["route"] = SimpleNamespace(path="/api/invoices")

    async def _hit():
        with caplog.at_level(logging.WARNING, logger="rbac"):
            return await mw.dispatch(request, _next)

    resp = asyncio.run(_hit())
    body = json.loads(resp.body)
    assert resp.status_code == 200
    assert resp.headers.get("x-prices-masked") == "1"
    assert body["grand_total"] == 0
    assert body["total_amount"] == 0
    assert body["items"][0]["unit_price"] == 0
    assert body["items"][0]["total"] == 0
    assert body["items"][0]["quantity"] == 1
    assert body["items"][0]["product_name"] == "Raf"
    assert body["email"] == "ada@example.com"
    assert lookups["n"] == 2
    logged = " ".join(rec.getMessage() for rec in caplog.records)
    assert secret not in logged
    assert "super-secret-token" not in logged
    assert "ada@example.com" not in logged

    closed = _role(features={"view_prices": False})
    lookups["n"] = 0

    async def _once_then_role(_user_doc, _company_id=None):
        lookups["n"] += 1
        if lookups["n"] == 1:
            raise _RoleLookupError(secret)
        return closed

    monkeypatch.setattr(rbac, "role_for", _once_then_role)
    caplog.clear()
    resp = asyncio.run(_hit())
    body = json.loads(resp.body)
    assert resp.status_code == 200
    assert resp.headers.get("x-prices-masked") == "1"
    assert body["grand_total"] == 0
    assert body["items"][0]["unit_price"] == 0
    assert lookups["n"] == 2

    async def _admin(_token, _db, request=None, path=None):
        return {
            "id": "usr_secret_id_42",
            "role": "admin",
            "email": "ada@example.com",
            "name": "Ada Lovelace",
            "company_ids": ["comp_secret_99"],
            "active_company_id": "comp_secret_99",
        }

    monkeypatch.setattr(rbac, "get_user_from_token", _admin)
    monkeypatch.setattr(rbac, "role_for", _boom)
    lookups["n"] = 0
    caplog.clear()
    resp = asyncio.run(_hit())
    body = json.loads(resp.body)
    assert resp.status_code == 200
    assert resp.headers.get("x-prices-masked") is None
    assert body["grand_total"] == 250
    assert body["total_amount"] == 250
    assert body["items"][0]["unit_price"] == 200
    assert body["items"][0]["total"] == 200
    assert lookups["n"] == 0


def test_get_resolves_role_once(monkeypatch):
    monkeypatch.setenv("RBAC_GET_ENFORCE", "shadow")
    role = _role(permissions=_perms(**{"/invoices": "view"}), features={"view_prices": False})
    mw = _install_middleware(monkeypatch, role)
    calls = {"n": 0}

    async def _counted(_user_doc, _company_id=None):
        calls["n"] += 1
        return role

    monkeypatch.setattr(rbac, "role_for", _counted)

    async def _next(_request):
        return _json({"grand_total": 250, "ok": True})

    request = _http("GET", "/api/invoices", "email=ada@example.com", "super-secret-token")
    request.scope["route"] = SimpleNamespace(path="/api/invoices")
    resp = asyncio.run(mw.dispatch(request, _next))
    assert resp.status_code == 200
    assert calls["n"] <= 1
    assert calls["n"] == 1
    assert resp.headers.get("x-prices-masked") == "1"
