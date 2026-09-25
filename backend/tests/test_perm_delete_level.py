"""Permission levels: none < view < edit < delete."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rbac import LEVELS, LEVEL_META, level_allows, mutation_allowed  # noqa: E402


def test_levels_include_delete():
    assert LEVELS == ("none", "view", "edit", "delete")
    assert [x["key"] for x in LEVEL_META] == list(LEVELS)
    assert any(x["key"] == "delete" and "Sil" in x["label"] for x in LEVEL_META)


def test_level_allows_hierarchy():
    assert level_allows("view", "view") is True
    assert level_allows("edit", "view") is True
    assert level_allows("delete", "edit") is True
    assert level_allows("edit", "delete") is False
    assert level_allows("view", "edit") is False
    assert level_allows("none", "view") is False


def test_delete_requires_delete_level():
    perms = {"/invoices": "edit"}
    assert mutation_allowed("/invoices", "/api/invoices/1", perms, "POST") is True
    assert mutation_allowed("/invoices", "/api/invoices/1", perms, "PUT") is True
    assert mutation_allowed("/invoices", "/api/invoices/1", perms, "DELETE") is False
    assert mutation_allowed("/invoices", "/api/invoices/1", {"/invoices": "delete"}, "DELETE") is True


def test_bulk_delete_requires_delete_level():
    perms = {"/orders": "edit"}
    assert mutation_allowed("/orders", "/api/orders/bulk-delete", perms, "POST") is False
    assert mutation_allowed("/orders", "/api/orders/bulk-delete", {"/orders": "delete"}, "POST") is True


def test_delete_implies_edit_mutations():
    perms = {"/stock": "delete"}
    assert mutation_allowed("/stock", "/api/products", perms, "POST") is True
    assert mutation_allowed("/stock", "/api/products/1", perms, "DELETE") is True
