from work_parks import (
    append_office_task_photo,
    clear_duty_if_task,
    find_office_task,
    find_office_task_type,
    find_park,
    find_workshop_zone,
    is_assignment_done,
    mark_office_task_done,
    mark_project_task_done,
    normalize_office_task_types,
    normalize_work_parks,
    normalize_workshop_zones,
    office_assignment_view,
    office_task_row,
    office_task_types_for_company,
    station_names_from_parks,
    zone_names_from_list,
)


def test_normalize_work_parks():
    assert normalize_work_parks(None) == []
    parks = normalize_work_parks(["Makina parkuru", {"id": "p2", "name": "Kaynak atölyesi"}, "  "])
    assert parks[0]["name"] == "Makina parkuru"
    assert parks[1] == {"id": "p2", "name": "Kaynak atölyesi"}
    assert find_park(parks, "p2")["name"] == "Kaynak atölyesi"
    assert find_park(parks, "missing") is None


def test_normalize_workshop_zones():
    assert normalize_workshop_zones(None) == []
    zones = normalize_workshop_zones(["Kesim", {"id": "z2", "name": "Montaj"}, "  "])
    assert zones[0]["name"] == "Kesim"
    assert zones[1] == {"id": "z2", "name": "Montaj"}
    assert find_workshop_zone(zones, "z2")["name"] == "Montaj"
    assert zone_names_from_list(zones) == ["Kesim", "Montaj"]
    assert zone_names_from_list([], ["Paketleme", "QC"]) == ["Paketleme", "QC"]


def test_office_task_types_separate_from_parks():
    types = normalize_office_task_types(["Ambar sayım", {"id": "t1", "name": "CNC bakım"}])
    assert find_office_task_type(types, "t1")["name"] == "CNC bakım"
    company = {"work_parks": [{"id": "p1", "name": "OEMAK"}], "office_task_types": []}
    assert office_task_types_for_company(company)[0]["name"] == "OEMAK"
    company2 = {"work_parks": [{"id": "p1", "name": "OEMAK"}], "office_task_types": [{"id": "t9", "name": "İç iş"}]}
    assert office_task_types_for_company(company2)[0]["id"] == "t9"


def test_station_names_from_parks():
    assert station_names_from_parks([{"name": "Genel"}, "OEMAK", {"name": "OMAKSAN"}, "oemak"]) == ["Genel", "OEMAK", "OMAKSAN"]
    assert station_names_from_parks([], ["Montaj Hattı 1", "QC"]) == ["Montaj Hattı 1", "QC"]
    assert station_names_from_parks(["Genel"], ["QC", "Genel"]) == ["Genel"]


def test_office_task_row():
    task_type = {"id": "makina", "name": "Makina parkuru"}
    row = office_task_row({"_id": "e1", "full_name": "Ali"}, task_type, "", "ot_1")
    assert row["id"] == "ot_1"
    assert row["kind"] == "office"
    assert row["title"] == "Makina parkuru"
    assert row["task_type_id"] == "makina"
    assert row["task_type_name"] == "Makina parkuru"
    assert row["park_id"] == "makina"
    assert row["park_name"] == "Makina parkuru"
    assert row["assignee_id"] == "e1"
    named = office_task_row({"id": "e1", "full_name": "Ali"}, task_type, "Torna", "ot_2")
    assert named["title"] == "Torna"
    view = office_assignment_view(named)
    assert view["kind"] == "office"
    assert view["project_name"] == "Makina parkuru"
    assert view["task_type_name"] == "Makina parkuru"
    assert view["photos"] == []
    with_photo = {**named, "photos": [{"url": "/api/files/ot.jpg", "task_id": "ot_2"}]}
    assert [p["url"] for p in office_assignment_view(with_photo)["photos"]] == ["/api/files/ot.jpg"]
    tasks, found = append_office_task_photo([named], "ot_2", {"url": "/api/files/ot.jpg", "task_id": "ot_2"})
    assert found["photos"][0]["url"] == "/api/files/ot.jpg"
    assert find_office_task(tasks, "ot_2")["photos"]
    assert find_office_task(tasks, "missing") is None


def test_mark_office_task_done():
    open_row = office_task_row({"_id": "e1", "full_name": "Ali"}, {"id": "cnc", "name": "CNC OEMAK"}, "kesim yap", "ot_kesim")
    tasks, found = mark_office_task_done([open_row], "ot_kesim")
    assert found["done"] is True
    assert found["status"] == "completed"
    assert is_assignment_done(tasks[0])
    missing, none = mark_office_task_done(tasks, "other")
    assert none is None
    assert missing[0]["id"] == "ot_kesim"


def test_mark_project_task_done_and_clear_duty():
    rows = [
        {"id": "t1", "assignee_id": "e1", "title": "Keşif", "done": False},
        {"id": "t2", "assignee_id": "e2", "title": "Başka", "done": False},
    ]
    updated, found = mark_project_task_done(rows, "t1", "e1")
    assert found["done"] is True
    assert updated[1]["done"] is False
    stolen, miss = mark_project_task_done(rows, "t1", "e9")
    assert miss is None
    assert stolen[0]["done"] is False
    duty = {"task_id": "t1", "kind": "field"}
    assert clear_duty_if_task(duty, "t1") is None
    assert clear_duty_if_task(duty, "t9") == duty
