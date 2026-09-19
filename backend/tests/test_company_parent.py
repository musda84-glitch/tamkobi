"""Parent/subsidiary company links on a shared license."""
from saas import resolved_parent_id, would_create_cycle


def test_resolved_parent_explicit_wins():
    assert resolved_parent_id({"_id": "b", "license_id": "a", "parent_company_id": "c"}) == "c"


def test_resolved_parent_falls_back_to_license_holder():
    assert resolved_parent_id({"_id": "b", "license_id": "a"}) == "a"
    assert resolved_parent_id({"id": "tamkobi", "license_id": "deneme"}) == "deneme"


def test_primary_company_has_no_parent():
    assert resolved_parent_id({"_id": "a", "license_id": "a"}) is None
    assert resolved_parent_id({"_id": "a", "license_id": "a", "parent_company_id": "a"}) is None
    assert resolved_parent_id(None) is None


def test_cycle_when_parent_is_under_child():
    lookup = {
        "a": {"_id": "a", "license_id": "a"},
        "b": {"_id": "b", "license_id": "a", "parent_company_id": "a"},
        "c": {"_id": "c", "license_id": "a", "parent_company_id": "b"},
    }
    assert would_create_cycle("a", "c", lookup) is True
    assert would_create_cycle("b", "c", lookup) is True
    assert would_create_cycle("c", "a", lookup) is False
    assert would_create_cycle("c", "b", lookup) is False
    assert would_create_cycle("x", "x", lookup) is True
    assert would_create_cycle("x", "", lookup) is True
