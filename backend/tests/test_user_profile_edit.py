"""User edit: phone normalize, email uniqueness, tenant 403, auth/me profile."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

import rbac
import saas
from phone_norm import phone_update_fields


class FakeColl:
    def __init__(self, docs=None):
        self.docs = {d["_id"]: dict(d) for d in (docs or [])}
        self.inserts = []

    async def find_one(self, q):
        if not q:
            return None
        if "_id" in q and len(q) == 1:
            d = self.docs.get(q["_id"])
            return dict(d) if d else None
        for d in self.docs.values():
            ok = True
            for k, v in q.items():
                if d.get(k) != v:
                    ok = False
                    break
            if ok:
                return dict(d)
        return None

    async def update_one(self, filt, upd):
        doc = await self.find_one(filt if "_id" in filt else {"_id": filt.get("_id")})
        if not doc and "_id" in filt:
            doc = self.docs.get(filt["_id"])
            doc = dict(doc) if doc else None
        if not doc:
            return MagicMock(modified_count=0)
        _id = doc["_id"]
        if "$set" in upd:
            self.docs[_id].update(upd["$set"])
        if "$unset" in upd:
            for k in upd["$unset"]:
                self.docs[_id].pop(k, None)
        return MagicMock(modified_count=1)

    async def insert_one(self, doc):
        self.inserts.append(dict(doc))
        if "_id" in doc:
            self.docs[doc["_id"]] = dict(doc)
        return MagicMock(inserted_id=doc.get("_id"))


def _req():
    r = MagicMock()
    return r


@pytest.fixture
def rbac_db():
    users = FakeColl([
        {
            "_id": "u_a",
            "email": "a@co.com",
            "name": "Ali",
            "phone": "05301112233",
            "phone_norm": "5301112233",
            "role": "sales",
            "company_ids": ["c1"],
            "active_company_id": "c1",
            "is_active": True,
        },
        {
            "_id": "u_b",
            "email": "b@co.com",
            "name": "Bora",
            "phone": "",
            "role": "sales",
            "company_ids": ["c1"],
            "active_company_id": "c1",
            "is_active": True,
        },
        {
            "_id": "u_other",
            "email": "x@other.com",
            "name": "Other",
            "role": "admin",
            "company_ids": ["c2"],
            "active_company_id": "c2",
            "is_active": True,
        },
    ])
    roles = FakeColl([{"_id": "r1", "company_id": "c1", "code": "sales", "name": "Satış"}])
    emps = FakeColl([])
    logs = FakeColl([])
    db = MagicMock()
    db.users = users
    db.roles = roles
    db.employees = emps
    db.activity_logs = logs
    rbac._db = db
    return db


def test_phone_update_fields_normalize():
    f = phone_update_fields("0530 111 22 33")
    assert f["phone_norm"] == "5301112233"
    assert "530" in f["phone"] or f["phone"].startswith("0")


def test_update_user_phone_and_email(rbac_db):
    actor = {"_id": "admin1", "name": "Admin", "company_ids": ["c1"], "active_company_id": "c1", "role": "admin"}

    async def _run():
        with patch.object(rbac, "_current_user", AsyncMock(return_value=actor)), \
             patch.object(rbac, "ensure_roles", AsyncMock()), \
             patch.object(rbac, "_notify_role_assigned", AsyncMock()):
            return await rbac.update_user(
                "u_a",
                {"name": "Ali Veli", "phone": "+90 530 111 22 33", "email": "ali.new@co.com", "company_id": "c1"},
                _req(),
            )

    out = asyncio.run(_run())
    assert out["name"] == "Ali Veli"
    assert out.get("phone_norm") == "5301112233" or rbac_db.users.docs["u_a"]["phone_norm"] == "5301112233"
    assert rbac_db.users.docs["u_a"]["email"] == "ali.new@co.com"
    assert rbac_db.activity_logs.inserts, "email change should write audit"


def test_update_user_email_conflict(rbac_db):
    actor = {"_id": "admin1", "company_ids": ["c1"], "active_company_id": "c1", "role": "admin"}

    async def _run():
        with patch.object(rbac, "_current_user", AsyncMock(return_value=actor)):
            return await rbac.update_user("u_a", {"email": "b@co.com"}, _req())

    with pytest.raises(HTTPException) as ei:
        asyncio.run(_run())
    assert ei.value.status_code == 400
    assert "e-posta" in str(ei.value.detail).lower()


def test_update_user_other_company_403(rbac_db):
    actor = {"_id": "admin1", "company_ids": ["c1"], "active_company_id": "c1", "role": "admin"}

    async def _run():
        with patch.object(rbac, "_current_user", AsyncMock(return_value=actor)):
            return await rbac.update_user("u_other", {"name": "Hack"}, _req())

    with pytest.raises(HTTPException) as ei:
        asyncio.run(_run())
    assert ei.value.status_code == 403


def test_system_update_user_accepts_phone():
    users = FakeColl([{
        "_id": "sa1",
        "email": "sa@tamkobi.com",
        "name": "SA",
        "is_super_admin": True,
        "is_active": True,
        "role": "admin",
        "company_ids": [],
    }])
    saas._db = MagicMock()
    saas._db.users = users
    saas._db.companies = FakeColl([])

    async def _run():
        with patch.object(saas, "_companies_map", AsyncMock(return_value={})), \
             patch.object(saas, "_super_admin_count", AsyncMock(return_value=2)):
            return await saas.system_update_user(
                "sa1",
                {"name": "Super", "email": "sa@tamkobi.com", "phone": "0530 999 88 77"},
                admin={"_id": "sa1"},
            )

    out = asyncio.run(_run())
    assert out["name"] == "Super"
    assert users.docs["sa1"]["phone_norm"] == "5309998877"
