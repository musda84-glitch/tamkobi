from attendance import (
    classify_self_punch_geo,
    decision_status_tr,
    geo_confirm_action_tr,
    geo_confirm_needs_manager,
    geo_confirm_reason_tr,
    parse_self_coords,
    self_punch_clock,
    self_punch_is_correction,
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
    assert geo_confirm_reason_tr("time_edit") == "saat düzeltme"
    assert geo_confirm_action_tr("check_in") == "Giriş"
    assert geo_confirm_action_tr("check_out") == "Çıkış"
    assert decision_status_tr("approved") == "onaylandı"
    assert decision_status_tr("rejected") == "reddedildi"


def test_self_punch_correction_uses_explicit_clock():
    assert self_punch_is_correction({"check_in": "06:55"}, "check_in") is True
    assert self_punch_is_correction({"check_out": "01:20"}, "check_out") is True
    assert self_punch_is_correction({"check_in": "06:55"}, "check_out") is False
    assert self_punch_clock({"action": "check_out", "time": "18:00"}, "check_out", "12:00") == "18:00"
    assert self_punch_clock({"action": "check_in"}, "check_in", "12:00") == "12:00"
