"""Reçete hammadde birim maliyetinde KDV dahil/hariç."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from server import _material_unit_net, _recipe_costs  # noqa: E402


def test_material_unit_net_excl():
    assert _material_unit_net({"cost_per_unit": 120, "cost_includes_vat": False, "vat_rate": 20}) == 120


def test_material_unit_net_incl():
    net = _material_unit_net({"cost_per_unit": 120, "cost_includes_vat": True, "vat_rate": 20})
    assert abs(net - 100.0) < 1e-9


def test_material_unit_net_incl_zero_rate():
    assert _material_unit_net({"cost_per_unit": 50, "cost_includes_vat": True, "vat_rate": 0}) == 50


def test_recipe_costs_strips_vat_when_included():
    recipe = {
        "materials": [
            {"cost_per_unit": 120, "quantity": 2, "wastage_percent": 0, "cost_includes_vat": True, "vat_rate": 20},
            {"cost_per_unit": 50, "quantity": 1, "wastage_percent": 10, "cost_includes_vat": False, "vat_rate": 20},
        ],
        "labor_cost": 10,
        "overhead_cost": 0,
        "target_quantity": 1,
    }
    # net: 100*2 + 50*1.1 = 200 + 55 = 255 + labor 10 = 265
    costs = _recipe_costs(recipe)
    assert costs["material_cost"] == 255.0
    assert costs["total_estimated_cost"] == 265.0
    assert costs["unit_cost"] == 265.0
