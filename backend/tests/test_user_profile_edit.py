"""User edit: phone normalize, email uniqueness, tenant 403, auth/me profile."""
import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import jwt
import pytest
from fastapi import HTTPException

import auth_utils
import rbac
import saas
from phone_norm import PHONE_TAKEN_MSG, phone_update_fields


class FakeColl:
    def __init__(self, docs=None):
        self.docs = {d["_id"]: dict(d) for d in (docs or [])}
        self.inserts = []
        self.update_many_calls = []

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

    async def update_many(self, filt, upd):
        self.update_many_calls.append((filt, upd))
        return MagicMock(modified_count=0)

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
    resets = FakeColl([])
    db = MagicMock()
    db.users = users
    db.roles = roles
    db.employees = emps
    db.activity_logs = logs
    db.password_resets = resets
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


def test_update_user_non_admin_403(rbac_db):
    actor = {"_id": "u_b", "company_ids": ["c1"], "active_company_id": "c1", "role": "sales"}

    async def _run():
        with patch.object(rbac, "_current_user", AsyncMock(return_value=actor)):
            return await rbac.update_user("u_a", {"name": "Hack"}, _req())

    with pytest.raises(HTTPException) as ei:
        asyncio.run(_run())
    assert ei.value.status_code == 403
    assert "yetki" in str(ei.value.detail).lower()


def test_update_user_email_change_revokes_sessions(rbac_db, monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-secret-for-session-revoke-32chars!!")
    actor = {"_id": "admin1", "name": "Admin", "company_ids": ["c1"], "active_company_id": "c1", "role": "admin"}

    async def _run():
        with patch.object(rbac, "_current_user", AsyncMock(return_value=actor)), \
             patch.object(rbac, "ensure_roles", AsyncMock()), \
             patch.object(rbac, "_notify_role_assigned", AsyncMock()):
            return await rbac.update_user(
                "u_a",
                {"email": "ali.revoked@co.com", "company_id": "c1"},
                _req(),
            )

    out = asyncio.run(_run())
    assert out["email"] == "ali.revoked@co.com"
    revoked_at = rbac_db.users.docs["u_a"].get("sessions_revoked_at")
    assert revoked_at, "email change must set sessions_revoked_at"

    past = datetime.now(timezone.utc) - timedelta(hours=1)
    old_tok = jwt.encode(
        {
            "sub": "u_a",
            "email": "a@co.com",
            "role": "sales",
            "type": "access",
            "iat": int(past.timestamp()),
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        },
        auth_utils.get_jwt_secret(),
        algorithm="HS256",
    )
    with pytest.raises(HTTPException) as ei:
        asyncio.run(auth_utils.get_user_from_token(old_tok, rbac_db))
    assert ei.value.status_code == 401
    assert "yenilenmeli" in ei.value.detail


def test_update_user_duplicate_phone_400(rbac_db):
    actor = {"_id": "admin1", "company_ids": ["c1"], "active_company_id": "c1", "role": "admin"}
    rbac_db.users.docs["u_b"]["phone"] = "05301112233"
    rbac_db.users.docs["u_b"]["phone_norm"] = "5301112233"

    async def _run():
        with patch.object(rbac, "_current_user", AsyncMock(return_value=actor)):
            return await rbac.update_user("u_b", {"phone": "0530 111 22 33"}, _req())

    with pytest.raises(HTTPException) as ei:
        asyncio.run(_run())
    assert ei.value.status_code == 400
    assert "telefon" in str(ei.value.detail).lower()


def test_update_user_keeps_own_phone_ok(rbac_db):
    actor = {"_id": "admin1", "company_ids": ["c1"], "active_company_id": "c1", "role": "admin"}

    async def _run():
        with patch.object(rbac, "_current_user", AsyncMock(return_value=actor)), \
             patch.object(rbac, "ensure_roles", AsyncMock()), \
             patch.object(rbac, "_notify_role_assigned", AsyncMock()):
            return await rbac.update_user(
                "u_a",
                {"phone": "0530 111 22 33", "company_id": "c1"},
                _req(),
            )

    out = asyncio.run(_run())
    assert out.get("phone_norm") == "5301112233" or rbac_db.users.docs["u_a"]["phone_norm"] == "5301112233"


def test_phone_taken_message_turkish():
    assert "telefon" in PHONE_TAKEN_MSG.lower()


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
