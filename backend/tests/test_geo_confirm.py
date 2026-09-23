from attendance import (
    classify_self_punch_geo,
    geo_confirm_action_tr,
    geo_confirm_needs_manager,
    geo_confirm_reason_tr,
    parse_self_coords,
)


LOC = {"latitude": 41.0, "longitude": 29.0, "radius_m": 300, "kind": "company", "label": "Firma"}


def test_parse_self_coords():
    assert parse_self_coords({}) == (None, None, None)
    assert parse_self_coords({"latitude": 41.1, "longitude": 29.2, "accuracy_m": 12}) == (41.1, 29.2, 12.0)


def test_classify_skip_without_target():
    assert classify_self_punch_geo(None, 41.0, 29.0)["verdict"] == "skip"
    assert classify_self_punch_geo({"label": "x"}, None, None)["verdict"] == "skip"


def test_classify_location_off_and_offsite():
    off = classify_self_punch_geo(LOC, None, None)
    assert off["verdict"] == "location_off"
    assert geo_confirm_needs_manager(off["verdict"])
    far = classify_self_punch_geo(LOC, 39.9, 32.8)
    assert far["verdict"] == "offsite"
    assert far["distance_m"] > 300
    near = classify_self_punch_geo(LOC, 41.0005, 29.0005)
    assert near["verdict"] == "onsite"
    assert not geo_confirm_needs_manager(near["verdict"])


def test_geo_confirm_labels():
    assert geo_confirm_reason_tr("location_off") == "konum kapalı"
    assert geo_confirm_reason_tr("offsite") == "iş yerinde değil"
    assert geo_confirm_action_tr("check_in") == "Giriş"
    assert geo_confirm_action_tr("check_out") == "Çıkış"
