"""İş emri istasyonu Firma Ayarları → Parkurlar listesinden çözülür."""
from work_parks import resolve_step_station, resolve_work_order_station, station_names_from_parks


def test_station_names_from_parks():
    assert station_names_from_parks([{"id": "a", "name": "CNC"}, {"name": "Montaj"}]) == ["CNC", "Montaj"]
    assert station_names_from_parks([], ["Genel", "X"]) == ["Genel", "X"]


def test_resolve_prefers_selected_park():
    parks = [{"name": "CNC OEMAK"}, {"name": "Montaj hattı"}]
    assert resolve_step_station({"name": "Kesim", "station": "Montaj hattı"}, parks) == "Montaj hattı"


def test_resolve_matches_step_name_to_park():
    parks = [{"name": "Kesim"}, {"name": "Montaj"}]
    assert resolve_step_station({"name": "Kesim", "station": ""}, parks) == "Kesim"
    assert resolve_step_station({"name": "Kesim", "station": "Genel"}, parks) == "Kesim"


def test_resolve_falls_back_to_first_park_instead_of_genel():
    parks = [{"name": "PVC bantlama"}, {"name": "Montaj"}]
    assert resolve_step_station({"name": "Üretim", "station": "Genel"}, parks) == "PVC bantlama"
    assert resolve_step_station({"name": "Üretim", "station": ""}, parks) == "PVC bantlama"


def test_resolve_genel_when_no_parks():
    assert resolve_step_station({"name": "Üretim", "station": ""}, []) == "Genel"
    assert resolve_step_station({"station": "Genel"}, None) == "Genel"


def test_resolve_work_order_station_override_beats_first_park():
    parks = [{"name": "CNC OEMAK"}, {"name": "PAKET YAPMA"}]
    # Boş adım normalde ilk parkura düşer; override seçimi korur.
    assert resolve_work_order_station({"name": "Üretim", "station": ""}, parks) == "CNC OEMAK"
    assert (
        resolve_work_order_station(
            {"name": "Üretim", "station": ""},
            parks,
            override="PAKET YAPMA",
        )
        == "PAKET YAPMA"
    )
