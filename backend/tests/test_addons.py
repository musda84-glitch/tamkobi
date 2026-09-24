"""AI & support add-ons: independent of ERP license modules (no live DB)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import addons


def test_catalog_keys_and_groups():
    keys = {a["key"] for a in addons.catalog()}
    assert keys == addons.ADDON_KEYS
    assert "ai.advisor" in keys and "ai.invoice" in keys and "ai.orders" in keys
    assert "ai.stock" in keys and "ai.b2b_cart" in keys
    assert "ai.finance_docs" in keys and "ai.migration" in keys
    assert "support.impersonate" in keys and "support.contact" in keys and "support.tickets" in keys
    advisor = addons.ADDON_BY_KEY["ai.advisor"]
    assert advisor["plan_module"] == "/ai-advisor"
    assert addons.ADDON_BY_KEY["support.impersonate"].get("lock_safe") is True


def test_resolve_defaults_without_plan():
    m = addons.resolve_map()
    assert m["ai.invoice"]["enabled"] is True
    assert m["ai.invoice"]["source"] == "default"
    assert m["ai.advisor"]["enabled"] is False
    assert m["ai.advisor"]["source"] == "plan"
    assert m["support.contact"]["enabled"] is True
    assert addons.enabled_map(m)["ai.orders"] is True


def test_advisor_follows_plan_until_overridden():
    m = addons.resolve_map(plan_modules={"/ai-advisor", "/invoices"})
    assert m["ai.advisor"]["enabled"] is True
    assert m["ai.advisor"]["source"] == "plan"
    m2 = addons.resolve_map(
        plan_modules={"/ai-advisor"},
        platform_defaults={"ai.advisor": False},
    )
    assert m2["ai.advisor"]["enabled"] is False
    assert m2["ai.advisor"]["source"] == "platform"
    m3 = addons.resolve_map(
        plan_modules={"/ai-advisor"},
        platform_defaults={"ai.advisor": False},
        company_overrides={"ai.advisor": True},
    )
    assert m3["ai.advisor"]["enabled"] is True
    assert m3["ai.advisor"]["source"] == "company"


def test_company_override_beats_platform_and_inherit_pops():
    m = addons.resolve_map(
        platform_defaults={"ai.invoice": False, "ai.orders": True},
        company_overrides={"ai.invoice": True},
    )
    assert m["ai.invoice"]["enabled"] is True and m["ai.invoice"]["source"] == "company"
    assert m["ai.orders"]["enabled"] is True and m["ai.orders"]["source"] == "platform"
    m2 = addons.resolve_map(
        platform_defaults={"ai.invoice": False},
        company_overrides={"ai.invoice": None},
    )
    assert m2["ai.invoice"]["enabled"] is False
    assert m2["ai.invoice"]["source"] == "platform"


def test_lock_turns_ai_off_keeps_lock_safe_support():
    m = addons.resolve_map(
        plan_modules={"/ai-advisor"},
        platform_defaults={"ai.invoice": True, "support.impersonate": True},
        company_overrides={"ai.stock": True, "support.contact": True},
        locked=True,
    )
    assert m["ai.advisor"]["enabled"] is False
    assert m["ai.invoice"]["enabled"] is False
    assert m["ai.stock"]["enabled"] is False
    assert m["ai.stock"]["source"] == "company"
    assert m["support.impersonate"]["enabled"] is True
    assert m["support.contact"]["enabled"] is True
    assert m["support.tickets"]["enabled"] is True


def test_addon_for_path_longest_prefix_and_statement():
    assert addons.addon_for_path("/api/ai/invoice-extract") == "ai.invoice"
    assert addons.addon_for_path("/api/ai/invoice-extract/confirm") == "ai.invoice"
    assert addons.addon_for_path("/api/ai/cheque-extract") == "ai.finance_docs"
    assert addons.addon_for_path("/api/ai/receipt-extract") == "ai.finance_docs"
    assert addons.addon_for_path("/api/ai/order-extract") == "ai.orders"
    assert addons.addon_for_path("/api/ai/product-extract") == "ai.stock"
    assert addons.addon_for_path("/api/ai/financial-advisor") == "ai.advisor"
    assert addons.addon_for_path("/api/ai/cashflow-forecast") == "ai.advisor"
    assert addons.addon_for_path("/api/loans/extract") == "ai.finance_docs"
    assert addons.addon_for_path("/api/migration/ai-map") == "ai.migration"
    assert addons.addon_for_path("/api/support/tickets") == "support.tickets"
    assert addons.addon_for_path("/api/banking/accounts/acc1/import-statement") == "ai.finance_docs"
    assert addons.addon_for_path("/api/invoices") is None
    assert addons.addon_for_path("/api/public/b2b/tok/ai-cart") is None
