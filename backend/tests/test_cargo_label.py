from cargo_label import extract_provider_label, pick_stored_label_url, resolve_from_docs


def test_prefers_order_then_created_shipment_url():
    assert pick_stored_label_url({"cargo_label_url": "https://ty/label.pdf"}) == "https://ty/label.pdf"
    assert pick_stored_label_url({}, {"label_url": "https://geliver/a.pdf"}) == "https://geliver/a.pdf"
    assert pick_stored_label_url({"cargo_label_url": "not-a-url"}) == ""
    assert pick_stored_label_url({"labelUrl": "https://cdn/x.png"}) == "https://cdn/x.png"


def test_marketplace_kind_for_trendyol_url():
    r = resolve_from_docs(
        {"channel": "trendyol", "cargo_tracking_number": "TR1", "cargo_label_url": "https://ty/l.pdf"},
    )
    assert r.source == "marketplace"
    assert r.as_json()["has_file"] is True


def test_created_kind_from_shipment():
    r = resolve_from_docs(
        {"channel": "saha", "cargo_shipment_id": "shp_1"},
        {"label_url": "https://geliver/l.pdf", "tracking_number": "YK1", "carrier_name": "Geliver"},
    )
    assert r.source == "created"
    assert r.cargo_tracking_number == "YK1"


def test_thermal_when_no_official_file():
    r = resolve_from_docs({"channel": "trendyol", "cargo_tracking_number": "TR1"})
    assert r.source == "thermal"
    assert r.as_json()["has_file"] is False


def test_extracts_trendyol_base64_and_url():
    assert extract_provider_label({"labelURL": "https://ty/a.pdf"})["label_url"] == "https://ty/a.pdf"
    assert extract_provider_label({"data": {"label": "A" * 50}})["pdf_base64"] == "A" * 50
    assert extract_provider_label({}) == {}
