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
