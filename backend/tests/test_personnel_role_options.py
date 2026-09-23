"""Personnel role-options for employee position dropdown."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rbac import DEFAULT_ROLES  # noqa: E402


def test_default_roles_have_names_for_position():
    names = {r["name"] for r in DEFAULT_ROLES}
    assert "Üretim" in names
    assert "Satış" in names
    assert "Personel" in names


def test_role_options_route_registered():
    import server

    paths = {getattr(r, "path", None) for r in server.api_router.routes}
    assert "/personnel/role-options" in paths or any(
        (getattr(r, "path", "") or "").endswith("/personnel/role-options") for r in server.api_router.routes
    )
    assert any("role-options" in (getattr(r, "path", "") or "") for r in server.api_router.routes)
