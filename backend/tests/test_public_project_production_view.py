"""Müşteri proje takibi: üretim adımları yalnızca istasyon; peçete → Üretimde."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from project_tracking import (  # noqa: E402
    has_production_slip,
    public_production_stations,
    work_step_label,
)


def test_public_production_stations_masks_details():
    steps = public_production_stations([
        {
            "no": 1,
            "name": "Üretim — 280*210*18 BEYAZ PARLAK",
            "station": "KESİM EBATLAMA HOLZHER",
            "material_name": "280*210*18 BEYAZ PARLAK",
            "note": "J016_Parlak_Beyaz_MDF_18",
        },
        {
            "no": 2,
            "name": "Üretim — x",
            "station": "DELİK İŞLEMİ OMAKSAN",
            "note": "gizli",
        },
        {"no": 3, "name": "Üretim", "station": ""},
    ])
    assert steps == [
        {"no": 1, "station": "KESİM EBATLAMA HOLZHER"},
        {"no": 2, "station": "DELİK İŞLEMİ OMAKSAN"},
    ]
    blob = str(steps)
    assert "BEYAZ PARLAK" not in blob
    assert "J016" not in blob


def test_work_step_uretimde_when_production_slip_linked():
    assert work_step_label("active", {"production_order_id": "po1"}) == "Üretimde"
    assert work_step_label("active", {"production_steps": [{"station": "A"}]}) == "Üretimde"
    assert has_production_slip({"recipe_id": "r1"}) is True


def test_work_step_uygulama_without_production():
    assert work_step_label("active", {}) == "Uygulama"
    assert work_step_label("planning", {}) == "Uygulama"
    assert has_production_slip({}) is False


def test_work_step_beklemede_overrides_uretimde():
    assert work_step_label("on_hold", {"production_order_id": "po1"}) == "Beklemede"
