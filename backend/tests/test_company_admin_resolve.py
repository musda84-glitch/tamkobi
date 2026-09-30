"""Company admin / member resolution for system license drawer."""
import asyncio
import os
import sys
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import saas  # noqa: E402


def test_tenant_user_query_includes_active_company():
    q = saas.tenant_user_query("comp_x")
    assert q["$and"][1] == {"is_super_admin": {"$ne": True}}
    clause = q["$and"][0]
    assert {"company_ids": "comp_x"} in clause["$or"]
    assert {"active_company_id": "comp_x"} in clause["$or"]


def test_member_brief_maps_owner_role():
    brief = saas._member_brief({
        "_id": "usr_1",
        "name": "Ali",
        "email": "ali@matek.test",
        "role": "owner",
        "password_hash": "x",
        "is_active": True,
    })
    assert brief["id"] == "usr_1"
    assert brief["email"] == "ali@matek.test"
    assert brief["role"] == "owner"
    assert brief["role_label"] == "Yönetici"
    assert brief["has_password"] is True
    assert brief["is_platform"] is False


def test_resolve_admin_by_active_company_and_owner_role():
    async def _run():
        db = MagicMock()
        saas._db = db

        owner = {
            "_id": "usr_owner",
            "email": "owner@matek.test",
            "name": "Owner",
            "role": "owner",
            "active_company_id": "comp_matek",
            "company_ids": [],
            "password_hash": "hash",
            "is_active": True,
        }

        async def find_one(query, projection=None):
            # First call: tenant + admin roles
            and_parts = query.get("$and") or []
            roles = query.get("role")
            if and_parts and roles and "$in" in roles:
                # Simulate match on active_company_id + owner
                for part in and_parts:
                    if "$or" in part:
                        return owner
            return None

        db.users.find_one = AsyncMock(side_effect=find_one)
        db.users.find = MagicMock()
        out = await saas.resolve_company_admin("comp_matek", {"_id": "comp_matek", "email": "info@matek.test"})
        assert out is not None
        assert out["email"] == "owner@matek.test"

    asyncio.run(_run())


def test_resolve_admin_falls_back_to_company_email():
    async def _run():
        db = MagicMock()
        saas._db = db
        by_email = {
            "_id": "usr_mail",
            "email": "info@matek.test",
            "name": "Matek Admin",
            "role": "admin",
            "password_hash": "hash",
            "company_ids": ["other"],
            "is_active": True,
        }

        async def find_one(query, projection=None):
            if query.get("email") == "info@matek.test":
                return by_email
            return None

        empty_cursor = MagicMock()
        empty_cursor.sort = MagicMock(return_value=empty_cursor)
        empty_cursor.to_list = AsyncMock(return_value=[])

        db.users.find_one = AsyncMock(side_effect=find_one)
        db.users.find = MagicMock(return_value=empty_cursor)
        out = await saas.resolve_company_admin(
            "comp_matek",
            {"_id": "comp_matek", "email": "info@matek.test"},
        )
        assert out["email"] == "info@matek.test"
        assert out["name"] == "Matek Admin"

    asyncio.run(_run())
