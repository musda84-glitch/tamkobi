from location_consent import (
    location_consent_accepted,
    location_consent_denied_detail,
    location_consent_store,
    location_signal_view,
    normalize_location_consent,
    validate_location_consent,
)
from notify import roles_for_type


def test_normalize_and_validate_location_consent():
    empty = normalize_location_consent(None)
    assert empty["accepted"] is False
    assert empty["required"] is True
    assert "panel" in empty["warning"]
    assert validate_location_consent({}) is not None
    assert validate_location_consent({"accept_kvkk": True}) is not None
    assert validate_location_consent({"accept_kvkk": True, "accept_share": True}) is None
    stored = location_consent_store({"accept_kvkk": True, "accept_share": True}, "2026-09-23T10:00:00+00:00")
    assert location_consent_accepted({"location_consent": stored}) is True
    assert location_consent_accepted({"location_consent": {"accept_kvkk": True}}) is False


def test_location_signal_view():
    assert location_signal_view({})["tone"] == "amber"
    assert location_signal_view({"location_last_ok": True})["label"] == "Konum alındı"
    assert location_signal_view({"location_last_ok": False})["tone"] == "red"


def test_location_unavailable_notifies_managers():
    assert "manager" in roles_for_type("location_unavailable")
    assert "admin" in roles_for_type("location_unavailable")
    assert "Mesaim" in location_consent_denied_detail()
