from user_company_access import (
    company_brief,
    filter_assignable_company_ids,
    normalize_company_ids,
    resolve_active_company_id,
)


def test_normalize_and_filter():
    assert normalize_company_ids(["a", "a", "", None, "b"]) == ["a", "b"]
    assert filter_assignable_company_ids(["x", "a", "y", "b"], ["a", "b", "c"]) == ["a", "b"]
    assert filter_assignable_company_ids([], ["a"]) == []


def test_resolve_active():
    assert resolve_active_company_id(["a", "b"], "b") == "b"
    assert resolve_active_company_id(["a", "b"], "gone") == "a"
    assert resolve_active_company_id([], "a") is None


def test_company_brief():
    assert company_brief({"_id": "c1", "name": "Matek", "tax_number": "1"})["id"] == "c1"
