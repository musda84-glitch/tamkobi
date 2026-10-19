"""POST /api/users personel bağlaması oturum firmasıyla sınırlıdır.

create_company_user, employee_id verilmişse personeli yalnız resolve_company_id
ile çözülen şirkette arar. Başka şirketin ya da olmayan personel 404 döner;
kullanıcı bu kontrolden önce yazılmaz. Bellek içi MemDB (dashboard_memdb).
Canlı veritabanına, 8021 portuna ve e-posta gönderimine bağlanmaz.
"""
from __future__ import annotations

import asyncio
import copy
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

os.environ.setdefault("JWT_SECRET", "test-rbac-create-user-tenant-jwt-secret-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import rbac  # noqa: E402
import saas  # noqa: E402
from dashboard_memdb import MemColl, MemDB, _split_field_ops  # noqa: E402
from mysql_store import apply_update, match_query, new_upsert_doc, project_doc  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
CO_C = "co_c"

_RESPONSE_KEYS = {
    "id",
    "email",
    "name",
    "role",
    "company_ids",
    "active_company_id",
    "is_active",
    "employee_id",
    "phone",
    "phone_norm",
    "preferences",
    "user_number",
    "created_at",
    "role_name",
    "message",
}


def _run(coro):
    return asyncio.run(coro)


def _user(*company_ids, active=None, role="admin", super_admin=False):
    ids = list(company_ids)
    return {
        "_id": "user-" + "-".join(ids or ["super"]),
        "id": "user-" + "-".join(ids or ["super"]),
        "email": "user@example.com",
        "name": "Kullanıcı",
        "role": role,
        "is_active": True,
        "is_super_admin": super_admin,
        "company_ids": ids,
        "active_company_id": active if active is not None else (ids[0] if ids else ""),
    }


def _body(**extra):
    body = {
        "name": "Yeni Kullanıcı",
        "email": "yeni@example.com",
        "password": "sifre12",
        "role": "sales",
    }
    body.update(extra)
    return body


class _TenantMemColl(MemColl):
    """delete_many, sayaç upsert ve find_one_and_update. dashboard_memdb değişmez."""

    async def update_one(self, query, update, upsert=False):
        result = await super().update_one(query, update, upsert=False)
        if result.matched_count or not upsert:
            return result
        doc = new_upsert_doc(update, query)
        self.docs.append(doc)
        return SimpleNamespace(modified_count=0, matched_count=0, upserted_id=doc.get("_id"))

    async def delete_many(self, query):
        query = _split_field_ops(query or {})
        kept = []
        deleted = 0
        for doc in self.docs:
            if match_query(doc, query):
                deleted += 1
            else:
                kept.append(doc)
        self.docs[:] = kept
        return SimpleNamespace(deleted_count=deleted)

    async def find_one_and_update(self, query, update, upsert=False, return_document=True, projection=None):
        query = _split_field_ops(query or {})
        for i, doc in enumerate(self.docs):
            if match_query(doc, query):
                self.docs[i] = apply_update(doc, update, query)
                found = self.docs[i]
                return project_doc(found, projection) if projection else copy.deepcopy(found)
        if upsert:
            doc = new_upsert_doc(update, query)
            self.docs.append(doc)
            return project_doc(doc, projection) if projection else copy.deepcopy(doc)
        return None


class _TenantMemDB(MemDB):
    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = _TenantMemColl(name, self)
            self._cols[name] = coll
        return coll


def _bind(monkeypatch):
    db = _TenantMemDB()
    prev = (rbac._db, saas._db, saas.check_user_limit)
    rbac._db = db
    saas._db = db

    async def _unlimited(_company_id):
        return None

    monkeypatch.setattr(saas, "check_user_limit", _unlimited)
    return db, prev


def _restore(prev):
    rbac._db, saas._db, saas.check_user_limit = prev


async def _seed(db):
    rows = (
        ("emp_a", CO_A, "Personel A", "personel-a@example.com"),
        ("emp_b", CO_B, "Personel B", "personel-b@example.com"),
        ("emp_c", CO_C, "Personel C", "personel-c@example.com"),
    )
    for eid, cid, name, email in rows:
        await db.employees.insert_one({
            "_id": eid,
            "company_id": cid,
            "full_name": name,
            "email": email,
        })
        await rbac.ensure_roles(cid)


def _snapshot(db):
    return {name: copy.deepcopy(coll.docs) for name, coll in db._cols.items()}


def _assert_same(before, db):
    after = _snapshot(db)
    assert set(after) == set(before)
    for name, docs in before.items():
        assert after[name] == docs


async def _employee(db, eid):
    return await db.employees.find_one({"_id": eid})


def _assert_response(out, *, email, name, company_id, employee_id):
    assert set(out) == _RESPONSE_KEYS
    assert "password_hash" not in out
    assert out["id"].startswith("usr_")
    assert out["email"] == email
    assert out["name"] == name
    assert out["role"] == "sales"
    assert out["role_name"] == "Satış"
    assert out["company_ids"] == [company_id]
    assert out["active_company_id"] == company_id
    assert out["is_active"] is True
    assert out["employee_id"] == employee_id
    assert out["phone"] == ""
    assert out["phone_norm"] is None
    assert out["preferences"] == {}
    assert out["user_number"].startswith("U-")
    assert out["created_at"]
    assert out["message"] == f"{name} eklendi. {email} ile giriş yapabilir."


def test_other_company_employee_does_not_create_user(monkeypatch):
    """A yöneticisi B personeline bağlanamaz; kullanıcı, personel ve bildirim yazılmaz."""
    db, prev = _bind(monkeypatch)

    async def run():
        await _seed(db)
        before_emps = copy.deepcopy(db.employees.docs)
        user = _user(CO_A)
        with pytest.raises(HTTPException) as exc:
            await rbac.create_company_user(_body(employee_id="emp_b"), user)
        assert exc.value.status_code == 404
        assert exc.value.detail == "Personel bulunamadı."
        assert db.users.docs == []
        assert db.employees.docs == before_emps
        emp_b = await _employee(db, "emp_b")
        assert "user_id" not in emp_b
        assert emp_b["email"] == "personel-b@example.com"
        assert db.notifications.docs == []
        assert await db.counters.find_one({"_id": "USER_NO"}) is None

    try:
        _run(run())
    finally:
        _restore(prev)


def test_other_company_id_is_forbidden_and_writes_nothing(monkeypatch):
    """Body company_id üyelik dışında 403; hiçbir koleksiyon değişmez."""
    db, prev = _bind(monkeypatch)

    async def run():
        await _seed(db)
        before = _snapshot(db)
        user = _user(CO_A)
        with pytest.raises(HTTPException) as exc:
            await rbac.create_company_user(_body(company_id=CO_B, employee_id="emp_b"), user)
        assert exc.value.status_code == 403
        assert exc.value.detail == "Bu şirket hesabına erişiminiz yok."
        _assert_same(before, db)
        assert "users" not in db._cols or db.users.docs == []
        assert "notifications" not in db._cols or db.notifications.docs == []

    try:
        _run(run())
    finally:
        _restore(prev)


def test_missing_employee_does_not_create_user(monkeypatch):
    """Olmayan personel 404; kullanıcı oluşmaz."""
    db, prev = _bind(monkeypatch)

    async def run():
        await _seed(db)
        before_emps = copy.deepcopy(db.employees.docs)
        user = _user(CO_A)
        with pytest.raises(HTTPException) as exc:
            await rbac.create_company_user(_body(employee_id="emp_yok"), user)
        assert exc.value.status_code == 404
        assert exc.value.detail == "Personel bulunamadı."
        assert db.users.docs == []
        assert db.employees.docs == before_emps
        assert db.notifications.docs == []
        assert await db.counters.find_one({"_id": "USER_NO"}) is None

    try:
        _run(run())
    finally:
        _restore(prev)


def test_same_company_employee_links_user(monkeypatch):
    """A personeliyle kullanıcı A'da oluşur; personel user_id ve email güncellenir."""
    db, prev = _bind(monkeypatch)

    async def run():
        await _seed(db)
        updates = []
        orig = db.employees.update_one

        async def wrapped(query, update, upsert=False):
            updates.append(copy.deepcopy(query))
            return await orig(query, update, upsert=upsert)

        db.employees.update_one = wrapped
        user = _user(CO_A)
        email = "a-kullanici@example.com"
        name = "Ali Yönetilen"
        out = await rbac.create_company_user(
            _body(email=email, name=name, employee_id="emp_a"),
            user,
        )
        _assert_response(out, email=email, name=name, company_id=CO_A, employee_id="emp_a")
        stored = await db.users.find_one({"email": email})
        assert stored["company_ids"] == [CO_A]
        assert stored["active_company_id"] == CO_A
        assert stored["employee_id"] == "emp_a"
        assert stored["role"] == "sales"
        assert stored["_id"] == out["id"]
        emp_a = await _employee(db, "emp_a")
        assert emp_a["user_id"] == out["id"]
        assert emp_a["email"] == email
        assert emp_a["full_name"] == "Personel A"
        assert emp_a["company_id"] == CO_A
        emp_b = await _employee(db, "emp_b")
        assert "user_id" not in emp_b
        assert emp_b["email"] == "personel-b@example.com"
        assert updates == [{"_id": "emp_a", "company_id": CO_A}]
        assert len(db.notifications.docs) == 1
        note = db.notifications.docs[0]
        assert note["company_id"] == CO_A
        assert note["employee_id"] == "emp_a"
        assert note["ref_id"] == "emp_a"
        assert note["user_id"] == out["id"]
        assert note["type"] == "role_assigned"

    try:
        _run(run())
    finally:
        _restore(prev)


def test_without_employee_id_creates_user_and_leaves_personnel(monkeypatch):
    """employee_id yoksa kullanıcı oluşur, personel ve diğer firmanın daveti değişmez."""
    db, prev = _bind(monkeypatch)

    async def run():
        await _seed(db)
        before_emps = copy.deepcopy(db.employees.docs)
        await db.user_invites.insert_one({
            "_id": "inv_a",
            "company_id": CO_A,
            "email": "yeni@example.com",
            "accepted_at": None,
        })
        await db.user_invites.insert_one({
            "_id": "inv_b",
            "company_id": CO_B,
            "email": "yeni@example.com",
            "accepted_at": None,
        })
        updates = []
        orig = db.employees.update_one

        async def wrapped(query, update, upsert=False):
            updates.append(copy.deepcopy(query))
            return await orig(query, update, upsert=upsert)

        db.employees.update_one = wrapped
        user = _user(CO_A)
        out = await rbac.create_company_user(_body(), user)
        _assert_response(
            out,
            email="yeni@example.com",
            name="Yeni Kullanıcı",
            company_id=CO_A,
            employee_id=None,
        )
        stored = await db.users.find_one({"_id": out["id"]})
        assert stored["employee_id"] is None
        assert stored["company_ids"] == [CO_A]
        assert db.employees.docs == before_emps
        assert updates == []
        invites = {row["_id"]: row for row in db.user_invites.docs}
        assert "inv_a" not in invites
        assert invites["inv_b"]["company_id"] == CO_B
        assert invites["inv_b"]["email"] == "yeni@example.com"
        assert len(db.notifications.docs) == 1
        assert db.notifications.docs[0]["employee_id"] is None
        assert db.notifications.docs[0]["company_id"] == CO_A

    try:
        _run(run())
    finally:
        _restore(prev)


def test_multi_company_admin_uses_requested_company_employee(monkeypatch):
    """A ve C üyesi, company_id=C ile C personeline bağlanır; A personeli 404."""
    db, prev = _bind(monkeypatch)

    async def run():
        await _seed(db)
        user = _user(CO_A, CO_C, active=CO_A)
        email = "c-kullanici@example.com"
        out = await rbac.create_company_user(
            _body(company_id=CO_C, email=email, name="C Kullanıcı", employee_id="emp_c"),
            user,
        )
        _assert_response(out, email=email, name="C Kullanıcı", company_id=CO_C, employee_id="emp_c")
        emp_c = await _employee(db, "emp_c")
        assert emp_c["user_id"] == out["id"]
        assert emp_c["email"] == email
        emp_a_before = await _employee(db, "emp_a")
        with pytest.raises(HTTPException) as exc:
            await rbac.create_company_user(
                _body(company_id=CO_C, email="yanlis@example.com", name="Yanlış", employee_id="emp_a"),
                user,
            )
        assert exc.value.status_code == 404
        assert exc.value.detail == "Personel bulunamadı."
        assert await db.users.find_one({"email": "yanlis@example.com"}) is None
        assert len(db.users.docs) == 1
        emp_a = await _employee(db, "emp_a")
        assert emp_a == emp_a_before
        assert "user_id" not in emp_a
        notes = [n for n in db.notifications.docs if n.get("employee_id") == "emp_a"]
        assert notes == []

    try:
        _run(run())
    finally:
        _restore(prev)


def test_super_admin_without_company_is_400(monkeypatch):
    """Süper admin şirket seçmeden 400 alır; kayıt yazılmaz."""
    db, prev = _bind(monkeypatch)

    async def run():
        await _seed(db)
        before = _snapshot(db)
        user = _user(super_admin=True)
        with pytest.raises(HTTPException) as exc:
            await rbac.create_company_user(_body(employee_id="emp_a"), user)
        assert exc.value.status_code == 400
        assert exc.value.detail == "Şirket seçilmedi."
        _assert_same(before, db)

    try:
        _run(run())
    finally:
        _restore(prev)
