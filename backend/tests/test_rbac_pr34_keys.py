"""PR3+PR4: yeni modül anahtarları okuma anında eşlenir, uçlara bağlanır, diske toplu yazılmaz."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rbac import (  # noqa: E402
    API_MODULE_MAP,
    backfill_permissions,
    get_view_decision,
    mask_money,
    module_for_get_path,
    module_for_path,
    module_is_wired,
    mutation_allowed,
    permissions_to_store,
    present_permissions,
    redact_mismatch_warning,
)
from saas import CATEGORIES, CORE_MODULES, DEFAULT_MODULE_PRICES  # noqa: E402


def test_old_role_maps_new_keys_at_read_time():
    filled = backfill_permissions({"/settings": "edit", "/production": "view"})
    assert filled["/kontor"] == "edit"
    assert filled["/company-share"] == "edit"
    assert filled["/atolye"] == "view"
    explicit = backfill_permissions({
        "/settings": "edit",
        "/production": "edit",
        "/kontor": "none",
        "/company-share": "view",
        "/atolye": "delete",
    })
    assert explicit["/kontor"] == "none"
    assert explicit["/company-share"] == "view"
    assert explicit["/atolye"] == "delete"
    shown = present_permissions({"code": "sales", "permissions": {"/settings": "view", "/production": "none"}})
    assert shown["/kontor"] == "view"
    assert shown["/company-share"] == "view"
    assert shown["/atolye"] == "none"
    assert present_permissions({"code": "admin", "permissions": {}})["/kontor"] == "delete"


def test_permissions_to_store_does_not_persist_unread_keys():
    raw = {"/settings": "edit", "/invoices": "view"}
    stored = permissions_to_store(raw, backfill_permissions(raw))
    assert "/kontor" not in stored
    assert "/company-share" not in stored
    assert stored["/invoices"] == "view"
    kept = {"/settings": "none", "/kontor": "view"}
    stored_kept = permissions_to_store(kept, backfill_permissions(kept))
    assert stored_kept["/kontor"] == "view"
    assert "/company-share" not in stored_kept


def test_new_keys_hit_at_least_one_endpoint():
    assert module_for_path("/api/account/gib-credits") == "/kontor"
    assert module_for_get_path("/api/account/gib-credits") == "/kontor"
    assert module_for_get_path("/api/account/profile") == "/settings"
    assert module_for_path("/api/license/companies/coA/links") == "/company-share"
    assert module_for_path("/api/license/companies/coA/links/lnk_1/approve") == "/company-share"
    assert module_for_get_path("/api/license/companies/coA/link-invites") == "/company-share"
    assert module_for_path("/api/license/companies/coA/api-key") is None
    assert module_for_path("/api/license/companies/coA/api-key/rotate") is None
    assert module_is_wired("/kontor")
    assert module_is_wired("/company-share")
    for key in ("/atolye", "/banking", "/b2b-yonetim", "/personnel", "/reports"):
        assert module_is_wired(key), key
        assert any(mod == key for _prefix, mod in API_MODULE_MAP)
    assert "/kontor" in CORE_MODULES
    assert "/company-share" in CORE_MODULES
    assert "/kontor" not in CATEGORIES
    assert "/company-share" not in CATEGORIES
    assert "/kontor" not in DEFAULT_MODULE_PRICES
    assert "/company-share" not in DEFAULT_MODULE_PRICES


def test_company_share_get_is_not_a_license_skip():
    user = {"id": "u1", "role": "sales"}
    closed = {"code": "sales", "name": "Satış", "permissions": {"/company-share": "none", "/settings": "delete"}}
    assert get_view_decision(user, closed, "/api/license/companies/coA/links", "GET") == ("deny", "module_denied")
    opened = {"code": "sales", "name": "Satış", "permissions": {"/company-share": "view"}}
    assert get_view_decision(user, opened, "/api/license/companies/coA/link-invites", "GET") == ("allow", "module_view")
    assert get_view_decision(user, closed, "/api/license/companies/coA/api-key", "GET") == ("allow", "skip_prefix")
    view = {"/company-share": "view"}
    edit = {"/company-share": "edit"}
    path = "/api/license/companies/coA/links"
    assert mutation_allowed("/company-share", path, view, "POST") is False
    assert mutation_allowed("/company-share", path, edit, "POST") is True


def test_mask_money_hides_invoice_mismatch_amount():
    warning = "Fatura siparişten farklı (Fatura: 1.250,50 TL)"
    assert redact_mismatch_warning(warning) == "Fatura siparişten farklı"
    assert "TL" not in redact_mismatch_warning("Fark 1.250,50 TL")
    out = mask_money({
        "invoice_mismatch_warning": warning,
        "invoice_grand_total": 1250.5,
        "order_number": "B2B-1",
    })
    assert out["invoice_mismatch_warning"] == "Fatura siparişten farklı"
    assert "1.250,50" not in out["invoice_mismatch_warning"]
    assert out["invoice_grand_total"] == 0
    assert out["order_number"] == "B2B-1"
