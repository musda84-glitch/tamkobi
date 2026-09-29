"""System role catalog: manager seed, normalize, safe role_for fallback."""
import asyncio
import os
import sys
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rbac import (  # noqa: E402
    DEFAULT_ROLES,
    SYSTEM_ROLE_LABELS,
    normalize_role_code,
    role_for,
    role_label,
)


def test_system_role_codes_and_labels():
    codes = [r["code"] for r in DEFAULT_ROLES]
    assert codes[0] == "admin"
    assert "manager" in codes
    assert SYSTEM_ROLE_LABELS["manager"] == "Müdür"
    assert role_label("manager") == "Müdür"
    assert role_label("owner") == "Yönetici"


def test_normalize_role_aliases():
    assert normalize_role_code("owner") == "admin"
    assert normalize_role_code("Yönetici") == "admin"
    assert normalize_role_code("müdür") == "manager"
    assert normalize_role_code("sales") == "sales"
    assert normalize_role_code(None) == "admin"


def test_role_for_unknown_code_does_not_grant_admin():
    async def _run():
        personel = {
            "_id": "r1",
            "code": "personel",
            "name": "Personel",
            "is_system": True,
            "permissions": {"/": "view", "/mesai": "edit", "/atolye": "edit", "/stock": "none", "/personnel": "none"},
        }
        db = MagicMock()

        async def find_one(query):
            if query.get("code") == "typo_role":
                return None
            if query.get("code") == "personel":
                return dict(personel)
            return None

        db.roles.find_one = AsyncMock(side_effect=find_one)
        import rbac

        rbac._db = db
        rbac.ensure_roles = AsyncMock()
        out = await role_for({"role": "typo_role", "active_company_id": "c1"})
        assert out["code"] == "personel"
        assert out["permissions"].get("/settings", "none") != "delete"
        assert out["permissions"].get("/stock") == "none"

    asyncio.run(_run())


def test_role_for_owner_alias_maps_to_admin():
    async def _run():
        admin = {
            "_id": "r0",
            "code": "admin",
            "name": "Yönetici",
            "is_system": True,
            "permissions": {"/": "delete"},
        }
        db = MagicMock()
        db.roles.find_one = AsyncMock(return_value=dict(admin))
        import rbac

        rbac._db = db
        rbac.ensure_roles = AsyncMock()
        out = await role_for({"role": "owner", "active_company_id": "c1"})
        assert out["code"] == "admin"
        assert out["permissions"].get("/") == "delete"

    asyncio.run(_run())
