"""İş emri silme — yönetici onay kuyruğu."""
from work_order_trash_requests import KIND, build_trash_request, inbox_item, pending_ids_for_work_orders


def test_build_and_inbox_item():
    wo = {
        "_id": "wo1",
        "company_id": "c1",
        "order_id": "o1",
        "order_code": "URT-2026-1",
        "step_no": 4,
        "step_name": "Kesim",
        "product_name": "MDF Dolap",
        "station": "CNC",
    }
    doc = build_trash_request(wo, requested_by="Ali", reason="Yanlış adım", now_iso="2026-09-28T12:00:00+00:00")
    assert doc["status"] == "pending"
    assert doc["work_order_id"] == "wo1"
    assert doc["requested_by"] == "Ali"
    item = inbox_item({**doc, "_id": "req1"})
    assert item["kind"] == KIND
    assert item["id"] == "req1"
    assert "URT-2026-1" in item["detail"]
    assert item["employee_name"] == "Ali"


def test_pending_ids():
    ids = pending_ids_for_work_orders(
        [
            {"work_order_id": "a", "status": "pending"},
            {"work_order_id": "b", "status": "rejected"},
            {"work_order_id": "c", "status": "pending"},
        ]
    )
    assert ids == {"a", "c"}
