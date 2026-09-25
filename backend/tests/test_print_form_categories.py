"""Print form categories linked from title_override."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from print_templates import (  # noqa: E402
    build_print_templates_response,
    form_category_key,
    prepare_save,
)


def test_form_category_key_stable():
    assert form_category_key("invoice", "PROFORMA") == "invoice__proforma"
    assert form_category_key("order", "Sevk Listesi") == "order__sevk-listesi"


def test_title_on_base_spawns_category():
    sets, result = prepare_save(
        "invoice",
        {"title_override": "PROFORMA", "primary_color": "#112233", "layout": "modern"},
        {},
    )
    assert "invoice" in sets
    assert sets["invoice"]["title_override"] == ""
    assert sets["invoice"]["primary_color"] == "#112233"
    cat_key = form_category_key("invoice", "PROFORMA")
    assert cat_key in sets
    assert sets[cat_key]["is_category"] is True
    assert sets[cat_key]["base_type"] == "invoice"
    assert sets[cat_key]["label"] == "PROFORMA"
    assert sets[cat_key]["title_override"] == "PROFORMA"
    assert sets[cat_key]["layout"] == "modern"
    assert result["created_category"] is True
    assert result["category_key"] == cat_key


def test_base_save_without_title_does_not_spawn():
    sets, result = prepare_save("quote", {"footer_note": "Merhaba", "title_override": "  "}, {})
    assert list(sets.keys()) == ["quote"]
    assert sets["quote"]["footer_note"] == "Merhaba"
    assert result.get("created_category") is not True


def test_response_includes_categories():
    stored = {
        "invoice": {"primary_color": "#000000"},
        "invoice__proforma": {
            "is_category": True,
            "base_type": "invoice",
            "label": "PROFORMA",
            "title_override": "PROFORMA",
            "layout": "bold",
        },
    }
    out = build_print_templates_response(stored)
    assert out["invoice"]["primary_color"] == "#000000"
    assert out["invoice__proforma"]["is_category"] is True
    assert out["invoice__proforma"]["label"] == "PROFORMA"
    assert "order" in out and "quote" in out and "dispatch" in out
