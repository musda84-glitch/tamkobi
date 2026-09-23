"""Panel role modules: first-class keys must not inherit parent aliases (except Personelim→Mesaim)."""
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rbac import MODULES, DEFAULT_ROLES, API_MODULE_MAP, module_for_path, apply_forced_system_permissions, backfill_permissions  # noqa: E402
from saas import PANEL_MODULE_FROM, CATEGORIES, DESCRIPTIONS, CORE_MODULES, DEFAULT_MODULE_PRICES  # noqa: E402


FIRST_CLASS = (
    "/edoc-inbox", "/dis-ticaret", "/b2b-yonetim", "/saha", "/sayim", "/sevk",
    "/support", "/purchase-orders",
)


def test_first_class_modules_not_aliased_in_saas():
    for key in FIRST_CLASS:
        assert key not in PANEL_MODULE_FROM, f"{key} must be first-class (not aliased)"


def test_personelim_still_aliases_mesai():
    assert PANEL_MODULE_FROM.get("/personelim") == "/mesai"


def test_support_in_role_catalog():
    keys = {k for k, _ in MODULES}
    assert "/support" in keys
    assert CATEGORIES.get("/support") == "İletişim"
    assert "/support" in DESCRIPTIONS


def test_purchase_orders_in_role_catalog():
    keys = {k for k, _ in MODULES}
    assert "/purchase-orders" in keys
    assert CATEGORIES.get("/purchase-orders") == "Stok & Depo"
    assert "/purchase-orders" in DESCRIPTIONS
    assert "/purchase-orders" in DEFAULT_MODULE_PRICES


def test_support_api_maps_to_support_module():
    assert module_for_path("/api/support/tickets") == "/support"
    assert any(prefix == "/api/support" and mod == "/support" for prefix, mod in API_MODULE_MAP)


def test_purchase_orders_api_maps_to_own_module():
    assert module_for_path("/api/purchase-orders") == "/purchase-orders"
    assert module_for_path("/api/purchase-orders/abc/status") == "/purchase-orders"
    assert any(prefix == "/api/purchase-orders" and mod == "/purchase-orders" for prefix, mod in API_MODULE_MAP)


def test_default_roles_cover_support_and_finance():
    by_code = {r["code"]: r for r in DEFAULT_ROLES}
    assert by_code["accountant"]["permissions"].get("/expenses") == "edit"
    assert by_code["accountant"]["permissions"].get("/loans") == "edit"
    assert by_code["accountant"]["permissions"].get("/support") == "edit"
    assert by_code["accountant"]["permissions"].get("/purchase-orders") == "edit"
    assert by_code["accountant"]["permissions"].get("/hizli-satis") == "none"
    assert by_code["sales"]["permissions"].get("/support") == "edit"
    assert by_code["sales"]["permissions"].get("/purchase-orders") == "view"
    assert by_code["sales"]["permissions"].get("/mesai") == "view"
    assert by_code["sales"]["permissions"].get("/sevk") == "view"
    assert by_code["advisor"]["permissions"].get("/support") == "view"
    assert by_code["advisor"]["permissions"].get("/purchase-orders") == "view"
    assert by_code["advisor"]["permissions"].get("/dispatches") == "view"
    assert by_code["advisor"]["name"] == "Mali Müşavir"
    assert by_code["accountant"]["name"] == "Muhasebe"


def test_warehouse_and_production_role_matrix():
    by_code = {r["code"]: r for r in DEFAULT_ROLES}
    wh = by_code["warehouse"]["permissions"]
    assert wh.get("/purchase-orders") == "edit"
    assert wh.get("/contacts") == "view"
    assert wh.get("/mesai") == "view"
    prod = by_code["production"]["permissions"]
    assert prod.get("/orders") == "view"
    assert prod.get("/sevk") == "view"
    assert prod.get("/mesai") == "view"
    assert by_code["personel"]["permissions"].get("/communication") == "view"


def test_personel_and_production_cannot_open_stock_cards():
    by_code = {r["code"]: r for r in DEFAULT_ROLES}
    assert by_code["production"]["permissions"].get("/stock", "none") == "none"
    assert by_code["personel"]["name"] == "Personel"
    assert by_code["personel"]["permissions"].get("/stock", "none") == "none"
    assert by_code["personel"]["permissions"].get("/mesai") == "edit"
    assert by_code["personel"]["permissions"].get("/atolye") == "edit"
    assert by_code["personel"]["permissions"].get("/personnel", "none") == "none"
    assert by_code["warehouse"]["permissions"].get("/stock") == "edit"
    assert apply_forced_system_permissions("production", {"/stock": "view"})["/stock"] == "none"
    assert apply_forced_system_permissions("personel", {"/stock": "edit", "/personnel": "view"})["/stock"] == "none"
    assert apply_forced_system_permissions("warehouse", {"/stock": "edit"})["/stock"] == "edit"


def test_auth_license_key_keeps_first_class_modules():
    text = Path("/workspace/frontend/src/context/AuthContext.jsx").read_text()
    block = text.split("LICENSE_KEY")[1].split(";")[0]
    assert '"/edoc-inbox"' not in block
    assert '"/saha"' not in block
    assert '"/b2b-yonetim"' not in block
    assert '"/dis-ticaret"' not in block
    assert '"/purchase-orders"' not in block
    assert '"/personelim": "/mesai"' in block


def test_backfill_support_inherits_communication():
    filled = backfill_permissions({"/communication": "edit", "/orders": "view"})
    assert filled["/support"] == "edit"
    assert filled["/saha"] == "view"
    assert set(filled) >= {k for k, _ in MODULES}


def test_backfill_purchase_orders_inherits_stock():
    filled = backfill_permissions({"/stock": "edit"})
    assert filled["/purchase-orders"] == "edit"
    filled_none = backfill_permissions({"/stock": "none"})
    assert filled_none["/purchase-orders"] == "none"
    filled_explicit = backfill_permissions({"/stock": "edit", "/purchase-orders": "view"})
    assert filled_explicit["/purchase-orders"] == "view"


def test_saas_catalog_covers_non_core_modules():
    non_core = {k for k, _ in MODULES if k not in CORE_MODULES}
    assert set(CATEGORIES) == non_core
    assert set(DESCRIPTIONS) == non_core
    assert set(DEFAULT_MODULE_PRICES) == non_core


def test_system_roles_cover_all_module_keys():
    keys = {k for k, _ in MODULES}
    for role in DEFAULT_ROLES:
        perms = backfill_permissions(role["permissions"])
        assert set(perms) >= keys, f"{role['code']} missing module keys"
