"""PR1: yazma yetkisi deny-by-default, modül eşlemesi, atölye ve fiyat maskesi."""
import asyncio
import io
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

os.environ.setdefault("JWT_SECRET", "test-rbac-pr1-enforcement-jwt-secret-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

from starlette.requests import Request
from starlette.responses import JSONResponse, Response

import company_audit
import rbac


def _perms(**kwargs):
    base = {key: "none" for key, _label in rbac.MODULES}
    base.update(kwargs)
    return base


def _user(role="personel", companies=None, active="co_a"):
    companies = companies or ["co_a"]
    return {
        "id": "usr_p",
        "role": role,
        "email": "p@example.com",
        "name": role,
        "company_ids": list(companies),
        "active_company_id": active,
    }


def _role(code="personel", permissions=None, features=None, name=None):
    return {
        "code": code,
        "name": name or code,
        "permissions": permissions if permissions is not None else _perms(),
        "features": features or {},
    }


def _http(method, path, query="company_id=co_a", token="tok"):
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
    request.scope["route"] = SimpleNamespace(path=path)
    return request


def _json_request(method, path, payload, query="company_id=co_a"):
    raw = json.dumps(payload).encode()
    request = _http(method, path, query)
    request.scope["headers"].append((b"content-type", b"application/json"))
    request.scope["headers"].append((b"content-length", str(len(raw)).encode()))
    async def _receive():
        return {"type": "http.request", "body": raw, "more_body": False}
    request._receive = _receive
    return request


def _json(payload, status=200):
    resp = JSONResponse(payload, status_code=status)

    async def _chunks():
        yield resp.body

    resp.body_iterator = _chunks()
    return resp


def _install(monkeypatch, user, role_lookup):
    async def _noop(*_a, **_k):
        return None

    class _Col:
        async def insert_one(self, _doc):
            return None

    class _DB:
        activity_logs = _Col()

    async def _from_token(_token, _db, request=None, path=None):
        return user

    monkeypatch.setattr(company_audit, "safe_prepare", _noop)
    monkeypatch.setattr(company_audit, "safe_commit", _noop)
    monkeypatch.setattr(rbac, "_db", _DB())
    monkeypatch.setattr(rbac, "_license_guard", _noop)
    monkeypatch.setattr(rbac, "get_user_from_token", _from_token)
    monkeypatch.setattr(rbac, "role_for", role_lookup)
    import addons
    monkeypatch.setattr(addons, "guard_request", _noop)
    return rbac.PermissionAndAuditMiddleware(app=lambda *_a, **_k: None)


def _hit(mw, method, path, query="company_id=co_a", payload=None, content_type="application/json"):
    calls = {"n": 0}

    async def _next(_request):
        calls["n"] += 1
        if payload is None:
            return _json({"ok": True, "grand_total": 250, "total_amount": 250})
        if content_type.startswith("text/csv"):
            resp = Response(content=payload, media_type=content_type, status_code=200)
        elif "spreadsheetml" in content_type:
            resp = Response(content=payload, media_type=content_type, status_code=200)
        elif content_type == "application/pdf":
            resp = Response(content=payload, media_type=content_type, status_code=200)
        else:
            resp = _json(payload)
        return resp

    async def _run():
        resp = await mw.dispatch(_http(method, path, query), _next)
        body = b""
        if getattr(resp, "body", None):
            body = resp.body
        return resp.status_code, body, calls["n"], resp.headers.get("x-prices-masked")

    return asyncio.run(_run())


# --- modül eşlemesi ---

def test_listed_write_routes_map_to_modules():
    assert rbac.module_for_path("/api/e-invoice/create") == "/invoices"
    assert rbac.module_for_path("/api/e-invoice/inv_1/refresh-status") == "/invoices"
    assert rbac.module_for_path("/api/marketplace/claims/c1/approve") == "/orders"
    assert rbac.module_for_path("/api/marketplace/claims/sync") == "/orders"
    assert rbac.module_for_path("/api/marketplace/products/push") == "/ecommerce"
    assert rbac.module_for_path("/api/integrations/isnet/save") == "/settings"
    assert rbac.module_for_path("/api/integrations/isnet/test") == "/settings"
    assert rbac.module_for_path("/api/integrations/isnet-portal/save") == "/settings"
    assert rbac.module_for_path("/api/integrations/isnet-portal/test") == "/settings"
    assert rbac.module_for_path("/api/pricing/rules/trendyol") == "/stock"
    assert rbac.module_for_path("/api/dispatches/merge-to-invoice") == "/dispatches"
    assert rbac.module_for_path("/api/label-templates") == "/stock"
    assert rbac.module_for_path("/api/expense-budgets") == "/expenses"
    assert rbac.module_for_path("/api/tax-documents/doc_1") == "/accountant"
    assert "/b2b-yonetim" in {mod for _prefix, mod in rbac.API_MODULE_MAP}
    assert "/dispatches" in {mod for _prefix, mod in rbac.API_MODULE_MAP}
    assert "/saha" in {mod for _prefix, mod in rbac.API_MODULE_MAP}
    assert "/mesai" in {mod for _prefix, mod in rbac.API_MODULE_MAP}
    assert rbac.module_for_path("/api/companies/co_a/b2b-settings") == "/b2b-yonetim"
    assert rbac.module_for_path("/api/contacts/c1/b2b-access") == "/b2b-yonetim"
    assert rbac.module_for_path("/api/contacts/c1/b2b-portal") == "/b2b-yonetim"
    assert rbac.module_for_path("/api/invoices/inv_1/create-dispatch") == "/invoices"
    assert rbac.module_for_path("/api/orders/ord_1/create-dispatch") == "/orders"
    assert rbac.module_for_get_path("/api/label-templates") == "/stock"
    assert rbac.module_for_get_path("/api/personnel/attendance") == "/personnel"


def test_isnet_save_is_admin_only_even_with_settings_delete():
    perms = _perms(**{"/settings": "delete"})
    assert rbac.mutation_allowed("/settings", "/api/integrations/isnet/save", perms, "POST") is False
    assert rbac.mutation_allowed("/settings", "/api/integrations/isnet-portal/test", perms, "POST") is False


def test_merge_to_invoice_needs_dispatches_and_invoices():
    only_dispatch = _perms(**{"/dispatches": "edit", "/invoices": "none"})
    only_invoice = _perms(**{"/dispatches": "none", "/invoices": "edit"})
    both = _perms(**{"/dispatches": "edit", "/invoices": "edit"})
    path = "/api/dispatches/merge-to-invoice"
    assert rbac.mutation_allowed("/dispatches", path, only_dispatch, "POST") is False
    assert rbac.mutation_allowed("/dispatches", path, only_invoice, "POST") is False
    assert rbac.mutation_allowed("/dispatches", path, both, "POST") is True


def test_mesai_write_needs_mesai_and_personnel_self_service_stays():
    personel = _perms(**{"/mesai": "edit", "/personnel": "none"})
    manager = _perms(**{"/mesai": "edit", "/personnel": "edit"})
    hidden = _perms(**{"/mesai": "none", "/personnel": "edit"})
    assert rbac.mutation_allowed("/personnel", "/api/personnel/attendance", personel, "POST") is False
    assert rbac.mutation_allowed("/personnel", "/api/personnel/attendance", manager, "POST") is True
    assert rbac.mutation_allowed("/personnel", "/api/personnel/attendance", hidden, "POST") is False
    assert rbac.module_for_path("/api/personnel/attendance/att_1/confirm") == "/personnel"


def test_saha_edit_can_create_order_without_orders_edit():
    only_saha = _perms(**{"/saha": "edit", "/orders": "none"})
    view_only = _perms(**{"/saha": "view", "/orders": "none"})
    orders = _perms(**{"/saha": "none", "/orders": "edit"})
    assert rbac.mutation_allowed("/orders", "/api/orders", only_saha, "POST") is True
    assert rbac.mutation_allowed("/orders", "/api/orders", view_only, "POST") is False
    assert rbac.mutation_allowed("/orders", "/api/orders", orders, "POST") is True


def test_unmapped_mutation_is_denied():
    assert rbac.mutation_allowed(None, "/api/not-a-module", _perms(), "POST") is False
    assert rbac.rbac_get_enforce_mode() in ("off", "shadow", "enforce")


# --- middleware ---

_CASES = (
    ("POST", "/api/e-invoice/create", "/invoices", "edit"),
    ("POST", "/api/e-invoice/inv_1/refresh-status", "/invoices", "edit"),
    ("POST", "/api/marketplace/claims/c1/approve", "/orders", "edit"),
    ("PUT", "/api/pricing/rules/trendyol", "/stock", "edit"),
    ("POST", "/api/label-templates", "/stock", "edit"),
    ("PUT", "/api/expense-budgets", "/expenses", "edit"),
    ("DELETE", "/api/tax-documents/doc_1", "/accountant", "delete"),
    ("POST", "/api/companies/co_a/b2b-settings", "/b2b-yonetim", "edit"),
)


def test_listed_endpoints_403_without_permission_and_pass_with_it(monkeypatch):
    user = _user("sales")

    async def _lookup(_user_doc, company_id=None):
        return _lookup.role

    for method, path, module, level in _CASES:
        _lookup.role = _role("sales", _perms(), name="Satış")
        mw = _install(monkeypatch, user, _lookup)
        status, _body, n, _masked = _hit(mw, method, path)
        assert status == 403 and n == 0, (method, path, status)

        _lookup.role = _role("sales", _perms(**{module: level}), name="Satış")
        mw = _install(monkeypatch, user, _lookup)
        status, _body, n, _masked = _hit(mw, method, path)
        assert status == 200 and n == 1, (method, path, status)


def test_merge_endpoint_requires_both_modules(monkeypatch):
    user = _user("warehouse")

    async def _lookup(_user_doc, company_id=None):
        return _lookup.role

    _lookup.role = _role("warehouse", _perms(**{"/dispatches": "edit", "/invoices": "view"}), name="Depo")
    mw = _install(monkeypatch, user, _lookup)
    status, _body, n, _masked = _hit(mw, "POST", "/api/dispatches/merge-to-invoice")
    assert status == 403 and n == 0

    _lookup.role = _role("warehouse", _perms(**{"/dispatches": "edit", "/invoices": "edit"}), name="Depo")
    mw = _install(monkeypatch, user, _lookup)
    status, _body, n, _masked = _hit(mw, "POST", "/api/dispatches/merge-to-invoice")
    assert status == 200 and n == 1


def test_isnet_save_denied_for_settings_admin_allowed(monkeypatch):
    async def _lookup(_user_doc, company_id=None):
        return _role("manager", _perms(**{"/settings": "delete"}), name="Müdür")

    mw = _install(monkeypatch, _user("manager"), _lookup)
    status, _body, n, _masked = _hit(mw, "POST", "/api/integrations/isnet/save")
    assert status == 403 and n == 0

    async def _admin_lookup(_user_doc, company_id=None):
        return _role("admin", _perms(**{"/settings": "delete"}), name="Yönetici")

    mw = _install(monkeypatch, _user("admin"), _admin_lookup)
    status, _body, n, _masked = _hit(mw, "POST", "/api/integrations/isnet-portal/test")
    assert status == 200 and n == 1


def test_deny_by_default_blocks_personel_and_allows_admin(monkeypatch):
    path = "/api/this-write-has-no-module"

    async def _personel(_user_doc, company_id=None):
        return _role("personel", _perms(), name="Personel")

    mw = _install(monkeypatch, _user("personel"), _personel)
    status, body, n, _masked = _hit(mw, "POST", path)
    assert status == 403 and n == 0
    assert "eşlenmemiş" in body.decode()

    async def _admin(_user_doc, company_id=None):
        raise AssertionError("admin role_for çağrılmamalı")

    mw = _install(monkeypatch, _user("admin"), _admin)
    status, _body, n, _masked = _hit(mw, "POST", path)
    assert status == 200 and n == 1

    async def _owner(_user_doc, company_id=None):
        raise AssertionError("sahip role_for çağrılmamalı")

    mw = _install(monkeypatch, _user("owner"), _owner)
    status, _body, n, _masked = _hit(mw, "PUT", path)
    assert status == 200 and n == 1


def test_public_write_is_not_denied_by_default():
    assert rbac.is_public_api_path("/api/auth/login", "POST") is True
    assert rbac.mutation_route_covered("/api/auth/login", "POST") is True
    assert rbac.mutation_route_covered("/api/health/live", "GET") is True
    assert rbac.mutation_path_open("/api/onboarding/progress", "PUT") is True


def test_role_for_receives_request_company_id(monkeypatch):
    seen = {}
    user = _user("sales", companies=["co_a", "co_b"], active="co_a")

    async def _lookup(_user_doc, company_id=None):
        seen["cid"] = company_id
        if company_id == "co_b":
            return _role("sales", _perms(**{"/invoices": "none"}), name="Satış B")
        return _role("sales", _perms(**{"/invoices": "edit"}), name="Satış A")

    mw = _install(monkeypatch, user, _lookup)
    status, _body, n, _masked = _hit(mw, "POST", "/api/invoices", query="company_id=co_b")
    assert seen["cid"] == "co_b"
    assert status == 403 and n == 0

    status, _body, n, _masked = _hit(mw, "POST", "/api/invoices", query="company_id=co_a")
    assert seen["cid"] == "co_a"
    assert status == 200 and n == 1


def test_atolye_view_cannot_start_edit_can_portal_staff_can(monkeypatch):
    assert rbac.mutation_allowed("/atolye", "/api/production/work-orders/wo_1/start", {"/atolye": "view"}, "POST") is False
    assert rbac.mutation_allowed("/atolye", "/api/production/work-orders/wo_1/pause", {"/atolye": "view"}, "POST") is False
    assert rbac.mutation_allowed("/atolye", "/api/production/work-orders/wo_1/finish", {"/atolye": "view"}, "POST") is False
    assert rbac.mutation_allowed("/atolye", "/api/production/work-orders/wo_1/start", {"/atolye": "edit"}, "POST") is True

    user = _user("warehouse")

    async def _view(_user_doc, company_id=None):
        return _role("warehouse", _perms(**{"/atolye": "view", "/production": "none"}), name="Depo")

    mw = _install(monkeypatch, user, _view)
    status, _body, n, _masked = _hit(mw, "POST", "/api/production/work-orders/wo_1/start")
    assert status == 403 and n == 0

    async def _edit(_user_doc, company_id=None):
        return _role("warehouse", _perms(**{"/atolye": "edit"}), name="Depo")

    mw = _install(monkeypatch, user, _edit)
    status, _body, n, _masked = _hit(mw, "POST", "/api/production/work-orders/wo_1/start")
    assert status == 200 and n == 1

    async def _portal(_user_doc, company_id=None):
        return _role(
            "personel",
            _perms(**{"/atolye": "view", "/production": "none"}),
            features={"portal_atolye": True},
            name="Personel",
        )

    mw = _install(monkeypatch, _user("personel"), _portal)
    status, _body, n, _masked = _hit(mw, "POST", "/api/production/work-orders/wo_1/finish")
    assert status == 200 and n == 1, status


def test_cargo_label_403_when_feature_off(monkeypatch):
    async def _closed(_user_doc, company_id=None):
        return _role("sales", _perms(**{"/orders": "view"}), features={"order_cargo_label": False}, name="Satış")

    mw = _install(monkeypatch, _user("sales"), _closed)
    status, _body, n, _masked = _hit(mw, "GET", "/api/orders/ord_1/cargo-label")
    assert status == 403 and n == 0
    status, _body, n, _masked = _hit(mw, "GET", "/api/orders/ord_1/cargo-label/file")
    assert status == 403 and n == 0

    async def _open(_user_doc, company_id=None):
        return _role("sales", _perms(**{"/orders": "view"}), features={"order_cargo_label": True}, name="Satış")

    mw = _install(monkeypatch, _user("sales"), _open)
    status, _body, n, _masked = _hit(mw, "GET", "/api/orders/ord_1/cargo-label")
    assert status == 200 and n == 1


def test_view_prices_masks_post_json_and_exports(monkeypatch):
    user = _user("sales")

    async def _closed(_user_doc, company_id=None):
        return _role(
            "sales",
            _perms(**{"/invoices": "edit", "/accountant": "view", "/reports": "view"}),
            features={"view_prices": False},
            name="Satış",
        )

    mw = _install(monkeypatch, user, _closed)
    status, body, n, masked = _hit(mw, "POST", "/api/invoices", payload={"ok": True, "grand_total": 250, "invoice_number": "F-1"})
    data = json.loads(body)
    assert status == 200 and n == 1 and masked == "1"
    assert data["grand_total"] == 0
    assert data["invoice_number"] == "F-1"

    csv_body = "Belge No;Matrah;KDV;Toplam\nF-1;100,50;20,00;120,50\n".encode("utf-8")
    status, body, n, masked = _hit(
        mw, "GET", "/api/accountant/export", payload=csv_body, content_type="text/csv; charset=utf-8",
    )
    text = body.decode("utf-8")
    assert status == 200 and masked == "1"
    assert "120,50" not in text
    assert "100,50" not in text
    assert "F-1" in text
    assert ";0;" in text or text.endswith("0\n") or ";0\n" in text

    import openpyxl
    book = openpyxl.Workbook()
    sheet = book.active
    sheet.append(["sku", "grand_total", "quantity"])
    sheet.append(["Raf", 250, 2])
    buf = io.BytesIO()
    book.save(buf)
    status, body, n, masked = _hit(
        mw,
        "GET",
        "/api/reports/export",
        payload=buf.getvalue(),
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    assert status == 200 and masked == "1"
    loaded = openpyxl.load_workbook(io.BytesIO(body))
    assert loaded.active["B2"].value == 0
    assert loaded.active["A2"].value == "Raf"
    assert loaded.active["C2"].value == 2

    import saas_docs
    captured = {}

    async def _pdf_lookup(_user_doc, company_id=None):
        return _role("sales", _perms(**{"/invoices": "view"}), features={"view_prices": False}, name="Satış")

    mw = _install(monkeypatch, user, _pdf_lookup)

    async def _next(_request):
        captured["pdf"] = saas_docs.build_invoice_pdf(
            {"invoice_number": "F-9", "grand_total": 1250.5, "subtotal": 1000, "vat_total": 250.5, "items": [
                {"name": "Raf", "quantity": 2, "unit": "ad", "unit_price": 500, "total": 1000, "vat_rate": 20},
            ]},
            {"name": "Satıcı"},
            {"name": "Alıcı"},
        )
        captured["tl"] = saas_docs._tl(1250.5)
        return _json({"ok": True})

    async def _run():
        return await mw.dispatch(_http("GET", "/api/invoices/inv_1/pdf"), _next)

    resp = asyncio.run(_run())
    assert resp.status_code == 200
    assert captured["tl"] == "0,00 ₺"
    import pypdf
    reader = pypdf.PdfReader(io.BytesIO(captured["pdf"]))
    pdf_text = "\n".join((page.extract_text() or "") for page in reader.pages)
    assert "1.250,50" not in pdf_text
    assert "1.000,00" not in pdf_text
    assert "0,00" in pdf_text


def test_view_prices_on_leaves_post_amounts(monkeypatch):
    async def _open(_user_doc, company_id=None):
        return _role("sales", _perms(**{"/invoices": "edit"}), features={"view_prices": True}, name="Satış")

    mw = _install(monkeypatch, _user("sales"), _open)
    status, body, _n, masked = _hit(mw, "POST", "/api/invoices", payload={"grand_total": 250})
    assert status == 200 and masked is None
    assert json.loads(body)["grand_total"] == 250


def test_pricing_compute_allows_orders_view_rules_stay_stock_edit():
    orders_view = _perms(**{"/orders": "view", "/stock": "none"})
    stock_view = _perms(**{"/orders": "none", "/stock": "view"})
    neither = _perms(**{"/orders": "none", "/stock": "none"})
    assert rbac.mutation_allowed("/stock", "/api/pricing/compute", orders_view, "POST") is True
    assert rbac.mutation_allowed("/stock", "/api/pricing/compute", stock_view, "POST") is True
    assert rbac.mutation_allowed("/stock", "/api/pricing/compute", neither, "POST") is False
    assert rbac.mutation_allowed("/stock", "/api/pricing/rules/trendyol", orders_view, "PUT") is False
    assert rbac.mutation_allowed("/stock", "/api/pricing/rules/trendyol", stock_view, "PUT") is False
    assert rbac.mutation_allowed("/stock", "/api/pricing/rules/trendyol", _perms(**{"/stock": "edit"}), "PUT") is True


def test_pricing_compute_passes_and_rule_update_is_forbidden(monkeypatch):
    async def _lookup(_user_doc, company_id=None):
        return _role("sales", _perms(**{"/orders": "view", "/stock": "view"}), name="Satış")

    mw = _install(monkeypatch, _user("sales"), _lookup)
    status, _body, n, _masked = _hit(mw, "POST", "/api/pricing/compute")
    assert status == 200 and n == 1
    status, _body, n, _masked = _hit(mw, "PUT", "/api/pricing/rules/trendyol")
    assert status == 403 and n == 0


def test_label_template_uses_stock_edit_not_settings():
    stock = _perms(**{"/stock": "edit", "/settings": "none"})
    settings = _perms(**{"/stock": "none", "/settings": "delete"})
    view = _perms(**{"/stock": "view"})
    assert rbac.mutation_allowed("/stock", "/api/label-templates", stock, "POST") is True
    assert rbac.mutation_allowed("/stock", "/api/label-templates/tpl_1", stock, "PUT") is True
    assert rbac.mutation_allowed("/stock", "/api/label-templates/tpl_1", stock, "DELETE") is True
    assert rbac.mutation_allowed("/stock", "/api/label-templates", settings, "POST") is False
    assert rbac.mutation_allowed("/stock", "/api/label-templates/tpl_1", view, "DELETE") is False


def test_label_template_save_and_delete_with_stock_edit(monkeypatch):
    async def _lookup(_user_doc, company_id=None):
        return _role("warehouse", _perms(**{"/stock": "edit", "/settings": "none"}), name="Depo")

    mw = _install(monkeypatch, _user("warehouse"), _lookup)
    status, _body, n, _masked = _hit(mw, "POST", "/api/label-templates")
    assert status == 200 and n == 1
    status, _body, n, _masked = _hit(mw, "DELETE", "/api/label-templates/tpl_1")
    assert status == 200 and n == 1

    async def _settings(_user_doc, company_id=None):
        return _role("manager", _perms(**{"/settings": "delete", "/stock": "none"}), name="Müdür")

    mw = _install(monkeypatch, _user("manager"), _settings)
    status, _body, n, _masked = _hit(mw, "POST", "/api/label-templates")
    assert status == 403 and n == 0


def test_order_create_dispatch_allows_orders_edit_or_dispatches_edit():
    orders = _perms(**{"/orders": "edit", "/dispatches": "none"})
    dispatches = _perms(**{"/orders": "none", "/dispatches": "edit"})
    view = _perms(**{"/orders": "view", "/dispatches": "none"})
    invoices = _perms(**{"/invoices": "edit", "/dispatches": "none", "/orders": "none"})
    path = "/api/orders/ord_1/create-dispatch"
    assert rbac.module_for_path(path) == "/orders"
    assert rbac.mutation_allowed("/orders", path, orders, "POST") is True
    assert rbac.mutation_allowed("/orders", path, dispatches, "POST") is True
    assert rbac.mutation_allowed("/orders", path, view, "POST") is False
    invoice_path = "/api/invoices/inv_1/create-dispatch"
    assert rbac.module_for_path(invoice_path) == "/invoices"
    assert rbac.mutation_allowed("/invoices", invoice_path, invoices, "POST") is True
    assert rbac.mutation_allowed("/invoices", invoice_path, orders, "POST") is False


def test_order_create_dispatch_with_orders_edit(monkeypatch):
    async def _lookup(_user_doc, company_id=None):
        return _role("sales", _perms(**{"/orders": "edit", "/dispatches": "none"}), name="Satış")

    mw = _install(monkeypatch, _user("sales"), _lookup)
    status, _body, n, _masked = _hit(mw, "POST", "/api/orders/ord_1/create-dispatch")
    assert status == 200 and n == 1


def test_masked_product_update_keeps_stored_prices(monkeypatch):
    stored = {
        "_id": "prod_1",
        "company_id": "co_a",
        "name": "Raf",
        "sku": "R-1",
        "sale_price": 120,
        "purchase_price": 40,
        "variants": [{"id": "v1", "name": "Mavi", "sale_price": 90}],
    }
    saved = {}

    class _Products:
        async def find_one(self, query):
            if query.get("_id") == "prod_1" and query.get("company_id") == "co_a":
                return json.loads(json.dumps(stored))
            return None

    class _Logs:
        async def insert_one(self, _doc):
            return None

    class _DB:
        activity_logs = _Logs()
        products = _Products()

    async def _lookup(_user_doc, company_id=None):
        return _role("sales", _perms(**{"/stock": "edit"}), features={"view_prices": False}, name="Satış")

    mw = _install(monkeypatch, _user("sales"), _lookup)
    monkeypatch.setattr(rbac, "_db", _DB())
    payload = {
        "name": "Yeni Raf",
        "sku": "R-1",
        "sale_price": 0,
        "purchase_price": 0,
        "variants": [{"id": "v1", "name": "Kırmızı", "sale_price": 0}],
    }
    request = _json_request("PUT", "/api/products/prod_1", payload)

    async def _next(req):
        raw = await req.body()
        assert req.headers.get("content-length") == str(len(raw))
        body = json.loads(raw)
        saved["body"] = body
        doc = json.loads(json.dumps(stored))
        doc.update({k: v for k, v in body.items() if k not in ("id", "_id", "company_id")})
        saved["doc"] = doc
        return _json({"ok": True, "sale_price": doc["sale_price"]})

    async def _run():
        return await mw.dispatch(request, _next)

    resp = asyncio.run(_run())
    assert resp.status_code == 200
    assert saved["body"]["name"] == "Yeni Raf"
    assert saved["body"]["sale_price"] == 120
    assert saved["body"]["purchase_price"] == 40
    assert saved["body"]["variants"][0]["name"] == "Kırmızı"
    assert saved["body"]["variants"][0]["sale_price"] == 90
    assert saved["doc"]["sale_price"] == 120
    assert saved["doc"]["purchase_price"] == 40


def test_nonzero_price_is_saved_on_product_update(monkeypatch):
    stored = {"_id": "prod_1", "company_id": "co_a", "sale_price": 120, "purchase_price": 40}

    class _Products:
        async def find_one(self, query):
            if query.get("_id") == "prod_1" and query.get("company_id") == "co_a":
                return dict(stored)
            return None

    class _Logs:
        async def insert_one(self, _doc):
            return None

    class _DB:
        activity_logs = _Logs()
        products = _Products()

    async def _lookup(_user_doc, company_id=None):
        return _role("sales", _perms(**{"/stock": "edit"}), features={"view_prices": False}, name="Satış")

    mw = _install(monkeypatch, _user("sales"), _lookup)
    monkeypatch.setattr(rbac, "_db", _DB())
    saved = {}

    async def _next(req):
        saved["body"] = await req.json()
        return _json({"ok": True})

    async def _run():
        return await mw.dispatch(
            _json_request("PUT", "/api/products/prod_1", {"name": "Yeni Raf", "sale_price": 250, "purchase_price": 0}),
            _next,
        )

    resp = asyncio.run(_run())
    assert resp.status_code == 200
    assert saved["body"]["sale_price"] == 250
    assert saved["body"]["purchase_price"] == 40
    assert saved["body"]["name"] == "Yeni Raf"


def test_preserve_masked_money_keeps_real_amounts_and_unkeyed_lines():
    stored = {
        "sale_price": 120,
        "items": [
            {"id": "l1", "product_id": "p1", "unit_price": 80, "name": "Eski"},
            {"line_id": "l2", "unit_price": 40},
        ],
    }
    incoming = {
        "sale_price": "0",
        "purchase_price": 0,
        "items": [
            {"product_id": "p1", "name": "Yeni", "unit_price": 15},
            {"id": "l1", "unit_price": 0, "name": "Güncel"},
            {"line_id": "l2", "unit_price": 0.0},
            {"id": "l9", "unit_price": 33},
        ],
    }
    out = rbac.preserve_masked_money(incoming, stored)
    assert out["sale_price"] == 120
    assert out["purchase_price"] == 0
    assert "purchase_price" in out
    assert out["items"][0]["unit_price"] == 15
    assert out["items"][0]["name"] == "Yeni"
    assert out["items"][1]["unit_price"] == 80
    assert out["items"][1]["name"] == "Güncel"
    assert out["items"][2]["unit_price"] == 40
    assert out["items"][3]["unit_price"] == 33
    assert rbac.preserve_masked_money({"amount": 500}, {"amount": 10})["amount"] == 500
    assert rbac.preserve_masked_money({"sale_price": "0.0"}, {"sale_price": 75})["sale_price"] == 75


def test_record_payment_and_installment_keep_submitted_amount(monkeypatch):
    finds = {"n": 0}

    class _Docs:
        async def find_one(self, _query):
            finds["n"] += 1
            return {"_id": "doc", "company_id": "co_a", "amount": 1, "grand_total": 1}

    class _Logs:
        async def insert_one(self, _doc):
            return None

    class _DB:
        activity_logs = _Logs()
        invoices = _Docs()
        installments = _Docs()

    async def _lookup(_user_doc, company_id=None):
        return _role(
            "sales",
            _perms(**{
                "/invoices": "edit",
                "/installments": "edit",
                "/expenses": "edit",
                "/cheques": "edit",
                "/orders": "edit",
                "/quotes": "edit",
                "/contacts": "edit",
            }),
            features={"view_prices": False},
            name="Satış",
        )

    mw = _install(monkeypatch, _user("sales"), _lookup)
    monkeypatch.setattr(rbac, "_db", _DB())
    saved = {}

    async def _next(req):
        saved["body"] = await req.json()
        saved["length"] = req.headers.get("content-length")
        return _json({"ok": True})

    cases = (
        ("POST", "/api/invoices/inv_1/record-payment", {"amount": 500}),
        ("POST", "/api/installments/inst_1/pay", {"amount": 250}),
        ("POST", "/api/expenses/exp_1/pay", {"amount": 80}),
        ("POST", "/api/cheques/ch_1/collect", {"amount": 40}),
        ("POST", "/api/orders/ord_1/return", {"amount": 15}),
        ("POST", "/api/quotes/q_1/payment-plan", {"amount": 90}),
        ("POST", "/api/contacts/ct_1/vpos-collect", {"amount": 60}),
    )
    for method, path, payload in cases:
        async def _run(method=method, path=path, payload=payload):
            return await mw.dispatch(_json_request(method, path, payload), _next)

        resp = asyncio.run(_run())
        assert resp.status_code == 200, path
        assert saved["body"]["amount"] == payload["amount"], path
        assert saved["length"] == str(len(json.dumps(payload).encode())), path
    assert finds["n"] == 0


def test_new_line_without_id_keeps_price_on_order_update(monkeypatch):
    stored = {
        "_id": "ord_1",
        "company_id": "co_a",
        "items": [
            {"id": "l1", "product_id": "p1", "unit_price": 80, "name": "Eski"},
            {"id": "l2", "unit_price": 40},
        ],
    }

    class _Orders:
        async def find_one(self, query):
            if query.get("_id") == "ord_1" and query.get("company_id") == "co_a":
                return json.loads(json.dumps(stored))
            return None

    class _Logs:
        async def insert_one(self, _doc):
            return None

    class _DB:
        activity_logs = _Logs()
        orders = _Orders()

    async def _lookup(_user_doc, company_id=None):
        return _role("sales", _perms(**{"/orders": "edit"}), features={"view_prices": False}, name="Satış")

    mw = _install(monkeypatch, _user("sales"), _lookup)
    monkeypatch.setattr(rbac, "_db", _DB())
    saved = {}
    payload = {
        "items": [
            {"product_id": "p1", "name": "Yeni", "unit_price": 15},
            {"id": "l1", "unit_price": 0, "name": "Güncel"},
            {"id": "l2", "unit_price": 33},
        ]
    }

    async def _next(req):
        raw = await req.body()
        assert req.headers.get("content-length") == str(len(raw))
        saved["body"] = json.loads(raw)
        return _json({"ok": True})

    async def _run():
        return await mw.dispatch(_json_request("PUT", "/api/orders/ord_1", payload), _next)

    resp = asyncio.run(_run())
    assert resp.status_code == 200
    items = saved["body"]["items"]
    assert items[0]["unit_price"] == 15
    assert items[0]["name"] == "Yeni"
    assert items[1]["unit_price"] == 80
    assert items[1]["name"] == "Güncel"
    assert items[2]["unit_price"] == 33


def test_pdf_mask_loads_role_before_handler(monkeypatch):
    monkeypatch.setenv("RBAC_GET_ENFORCE", "off")
    calls = {"n": 0, "masked": None, "tl": None}

    async def _lookup(_user_doc, company_id=None):
        calls["n"] += 1
        assert calls["masked"] is None
        return _role("sales", _perms(**{"/invoices": "view"}), features={"view_prices": False}, name="Satış")

    mw = _install(monkeypatch, _user("sales"), _lookup)

    async def _next(_request):
        calls["masked"] = rbac.price_mask_active()
        import saas_docs
        calls["tl"] = saas_docs._tl(1250.5)
        return _json({"ok": True})

    async def _run():
        return await mw.dispatch(_http("GET", "/api/invoices/inv_1/pdf"), _next)

    resp = asyncio.run(_run())
    assert resp.status_code == 200
    assert calls["n"] == 1
    assert calls["masked"] is True
    assert calls["tl"] == "0,00 ₺"


# --- rota taraması ---

def _walk_writes(routes, found):
    from fastapi.routing import APIRoute
    for route in routes:
        if isinstance(route, APIRoute):
            methods = {str(method).upper() for method in (route.methods or ())}
            for method in methods & {"POST", "PUT", "PATCH", "DELETE"}:
                if route.path:
                    found.append((method, route.path))
        children = getattr(route, "routes", None)
        if children:
            _walk_writes(children, found)


def test_every_write_route_is_mapped_or_allowlisted():
    _LICENSE_GUARD = rbac._license_guard
    import server
    rbac.set_license_guard(_LICENSE_GUARD)
    found = []
    _walk_writes(server.app.routes, found)
    writes = sorted({(method, path) for method, path in found if path.startswith("/api")})
    assert writes, "yazma rotası bulunamadı"
    uncovered = [f"{method} {path}" for method, path in writes if not rbac.mutation_route_covered(path, method)]
    assert not uncovered, "Eşlenmemiş yazma uçları:\n" + "\n".join(uncovered)
    paths = [path for _method, path in writes]
    dead = []
    for method, template in rbac.MUTATION_UNMAPPED_ALLOWLIST:
        if not any(
            rbac._portal_template_match(template, rbac._portal_norm_path(path))
            for path in paths
        ):
            dead.append(f"{method} {template}")
    assert not dead, "Allowlist şablonu bir yazma rotasına denk gelmiyor:\n" + "\n".join(dead)
