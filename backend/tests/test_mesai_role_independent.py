"""Mesaim and Stok & Depo child modules must not inherit parent role/license aliases."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from saas import PANEL_MODULE_FROM  # noqa: E402
from rbac import SELF_SERVICE_SUFFIXES, module_for_path  # noqa: E402


def test_mesai_not_aliased_to_personnel_in_saas():
    assert "/mesai" not in PANEL_MODULE_FROM


def test_stock_depot_children_not_aliased_in_saas():
    assert "/sayim" not in PANEL_MODULE_FROM
    assert "/sevk" not in PANEL_MODULE_FROM
    assert "/warehouses" not in PANEL_MODULE_FROM


def test_attendance_confirm_dispute_suffix_contract():
    """Dynamic confirm/dispute paths fall under /personnel in the prefix map;
    middleware remaps them to /mesai — keep suffix contract stable."""
    assert "/confirm" in SELF_SERVICE_SUFFIXES
    assert "/dispute" in SELF_SERVICE_SUFFIXES
    assert module_for_path("/api/personnel/attendance/att_1/confirm") == "/personnel"
    assert module_for_path("/api/personnel/employees") == "/personnel"
