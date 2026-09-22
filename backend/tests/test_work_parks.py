from work_parks import find_park, normalize_work_parks, office_assignment_view, office_task_row


def test_normalize_work_parks():
    assert normalize_work_parks(None) == []
    parks = normalize_work_parks(["Makina parkuru", {"id": "p2", "name": "Kaynak atölyesi"}, "  "])
    assert parks[0]["name"] == "Makina parkuru"
    assert parks[1] == {"id": "p2", "name": "Kaynak atölyesi"}
    assert find_park(parks, "p2")["name"] == "Kaynak atölyesi"
    assert find_park(parks, "missing") is None


def test_office_task_row():
    park = {"id": "makina", "name": "Makina parkuru"}
    row = office_task_row({"_id": "e1", "full_name": "Ali"}, park, "", "ot_1")
    assert row == {
        "id": "ot_1",
        "kind": "office",
        "title": "Makina parkuru",
        "park_id": "makina",
        "park_name": "Makina parkuru",
        "done": False,
        "assignee_id": "e1",
        "assignee_name": "Ali",
    }
    named = office_task_row({"id": "e1", "full_name": "Ali"}, park, "Torna", "ot_2")
    assert named["title"] == "Torna"
    view = office_assignment_view(named)
    assert view["kind"] == "office"
    assert view["project_name"] == "Makina parkuru"
