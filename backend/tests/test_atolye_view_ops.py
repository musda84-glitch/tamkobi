"""Atölye tablet: view yetkisiyle iş emri / operatör PIN işlemleri."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rbac import backfill_permissions, mutation_allowed  # noqa: E402


def test_shopfloor_unlock_allowed_with_atolye_view():
    perms = {"/atolye": "view", "/production": "none"}
    assert mutation_allowed("/atolye", "/api/production/work-orders/shopfloor-unlock", perms) is True
    assert mutation_allowed("/atolye", "/api/production/work-orders/wo1/start", perms) is True
    assert mutation_allowed("/atolye", "/api/production/work-orders/wo1/finish", perms) is True


def test_shopfloor_blocked_when_atolye_none_and_no_production():
    perms = {"/atolye": "none", "/production": "none"}
    assert mutation_allowed("/atolye", "/api/production/work-orders/shopfloor-unlock", perms) is False


def test_shopfloor_allowed_via_production_edit():
    perms = {"/atolye": "none", "/production": "edit"}
    assert mutation_allowed("/atolye", "/api/production/work-orders/shopfloor-unlock", perms) is True


def test_other_modules_still_require_edit():
    perms = {"/stock": "view", "/atolye": "view"}
    assert mutation_allowed("/stock", "/api/products", perms) is False
    assert mutation_allowed("/stock", "/api/products", {"/stock": "edit"}) is True


def test_cargo_orders_exception_preserved():
    perms = {"/cargo": "none", "/orders": "edit"}
    assert mutation_allowed("/cargo", "/api/cargo/create-shipment", perms) is True
    assert mutation_allowed("/cargo", "/api/cargo/other", perms) is False


def test_backfill_inherits_atolye_from_production():
    filled = backfill_permissions({"/production": "edit"})
    assert filled["/atolye"] == "edit"
    filled2 = backfill_permissions({"/production": "view"})
    assert filled2["/atolye"] == "view"
    # explicit none is preserved
    filled3 = backfill_permissions({"/production": "edit", "/atolye": "none"})
    assert filled3["/atolye"] == "none"
