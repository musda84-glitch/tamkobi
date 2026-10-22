"""Üretim emri adım özeti — liste satırında tamamlanan / güncel adımlar."""
import server


def test_production_steps_summary_marks_done_and_current():
    ws = [
        {"step_no": 1, "step_name": "Kesim", "status": "done", "operator_name": "Ali"},
        {"step_no": 2, "step_name": "Montaj", "status": "in_progress", "operator_name": "Ayşe"},
        {"step_no": 3, "step_name": "Paketleme", "status": "ready"},
    ]
    out = server._production_steps_summary(ws)
    assert out["done"] == 1
    assert out["total"] == 3
    assert out["current_step_name"] == "Montaj"
    assert out["current_operator"] == "Ayşe"
    assert [s["name"] for s in out["steps"]] == ["Kesim", "Montaj", "Paketleme"]
    assert out["steps"][0]["done"] is True
    assert out["steps"][0]["current"] is False
    assert out["steps"][1]["done"] is False
    assert out["steps"][1]["current"] is True
    assert out["steps"][2]["done"] is False
    assert out["steps"][2]["current"] is False  # sıradaki ready ama Montaj sürerken current değil
    assert out["steps"][0]["started_at"] is None
    assert out["steps"][0]["material_stock_deducted"] is False


def test_production_steps_summary_passes_real_times_and_consumption():
    ws = [
        {
            "step_no": 1,
            "step_name": "Kesim",
            "status": "done",
            "operator_name": "Ali",
            "station": "CNC",
            "started_at": "2026-10-20T06:10:00+00:00",
            "finished_at": "2026-10-20T08:25:00+00:00",
            "material_name": "MDF",
            "material_stock_deducted": True,
            "material_stock_qty": 1,
            "finish_unit": "plaka",
        },
        {"step_no": 2, "step_name": "Bant", "status": "waiting"},
    ]
    out = server._production_steps_summary(ws)
    first = out["steps"][0]
    assert first["started_at"] == "2026-10-20T06:10:00+00:00"
    assert first["finished_at"] == "2026-10-20T08:25:00+00:00"
    assert first["station"] == "CNC"
    assert first["material_stock_deducted"] is True
    assert first["material_stock_qty"] == 1
    assert first["finish_unit"] == "plaka"
    second = out["steps"][1]
    assert second["started_at"] is None
    assert second["finished_at"] is None
    assert second["material_name"] is None
    assert second["material_stock_deducted"] is False
    assert second["material_stock_qty"] is None
