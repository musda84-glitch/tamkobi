"""Müşteri proje takibi: üretim adımları istasyon + durum/tarih; peçete → Üretimde."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from project_tracking import (  # noqa: E402
    format_public_dt,
    has_production_slip,
    public_production_stations,
    public_step_status,
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
    assert [(s["no"], s["station"]) for s in steps] == [
        (1, "KESİM EBATLAMA HOLZHER"),
        (2, "DELİK İŞLEMİ OMAKSAN"),
    ]
    blob = str(steps)
    assert "BEYAZ PARLAK" not in blob
    assert "J016" not in blob
    assert steps[0]["status"] == "waiting"
    assert steps[0]["status_label"] == "Başlamayı bekliyor"
    assert steps[0]["current"] is True
    assert steps[1]["current"] is False


def test_public_production_stations_live_status_and_times():
    steps = public_production_stations(
        [
            {"no": 1, "station": "KESİM EBATLAMA HOLZHER"},
            {"no": 2, "station": "DELİK İŞLEMİ OMAKSAN"},
            {"no": 3, "station": "CNC"},
        ],
        work_orders=[
            {
                "step_no": 1,
                "station": "KESİM EBATLAMA HOLZHER",
                "status": "done",
                "started_at": "2026-03-07T07:00:00+00:00",
                "finished_at": "2026-03-07T08:30:00+00:00",
            },
            {
                "step_no": 2,
                "station": "DELİK İŞLEMİ OMAKSAN",
                "status": "in_progress",
                "started_at": "2026-03-07T08:45:00+00:00",
                "finished_at": None,
            },
            {
                "step_no": 3,
                "station": "CNC",
                "status": "waiting",
            },
        ],
    )
    assert steps[0]["status"] == "done"
    assert steps[0]["status_label"] == "Tamamladı"
    assert steps[0]["current"] is False
    assert steps[0]["finished_at"] == "07.03.2026 11:30"
    assert steps[0]["at"] == "07.03.2026 11:30"

    assert steps[1]["status"] == "in_progress"
    assert steps[1]["status_label"] == "İşlemde"
    assert steps[1]["current"] is True
    assert steps[1]["started_at"] == "07.03.2026 11:45"
    assert steps[1]["at"] == "07.03.2026 11:45"

    assert steps[2]["status"] == "waiting"
    assert steps[2]["status_label"] == "Başlamayı bekliyor"
    assert steps[2]["current"] is False
    assert "at" not in steps[2]


def test_public_step_status_labels():
    assert public_step_status("ready") == ("waiting", "Başlamayı bekliyor")
    assert public_step_status("paused") == ("in_progress", "İşlemde")
    assert public_step_status("done") == ("done", "Tamamladı")


def test_format_public_dt_istanbul():
    assert format_public_dt("2026-03-07T08:30:00+00:00") == "07.03.2026 11:30"
    assert format_public_dt(None) is None
    assert format_public_dt("not-a-date") is None


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
