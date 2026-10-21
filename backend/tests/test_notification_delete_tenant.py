"""Bildirim silme: şirket ve kullanıcı kapsamı.

Bellek içi sahte veritabanı ve TestClient. Canlı veritabanına, çalışan
sunucuya veya 8021 portuna bağlanmaz.
"""
from __future__ import annotations

import copy
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-notification-delete-tenant-jwt-secret-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import auth_utils  # noqa: E402
import rbac  # noqa: E402
import server  # noqa: E402
from mysql_store import match_query  # noqa: E402

COMP_A = "A"
COMP_B = "B"
NOT_FOUND = "Bildirim bulunamadı."
UNREAD = "Yalnız okunan bildirimler silinebilir."
FORBIDDEN = "Bu bildirimi silemezsiniz."
DELETED = {"status": "success", "message": "Bildirim silindi."}


class MemColl:
    def __init__(self, name, db):
        self.name = name
        self.db = db
        self.docs = []

    async def find_one(self, query=None, projection=None):
        self.db.queries.append((self.name, "find_one", copy.deepcopy(query)))
        for doc in self.docs:
            if match_query(doc, query or {}):
                return copy.deepcopy(doc)
        return None

    async def delete_one(self, query):
        self.db.queries.append((self.name, "delete_one", copy.deepcopy(query)))
        for i, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                self.docs.pop(i)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


class MemDB:
    def __init__(self):
        self._cols = {}
        self.queries = []

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = MemColl(name, self)
            self._cols[name] = coll
        return coll

    def __getitem__(self, name):
        return getattr(self, name)


def _user(uid, company_ids, active, *, role="admin", employee_id=None):
    doc = {
        "_id": uid,
        "id": uid,
        "email": f"{uid}@example.com",
        "name": uid,
        "role": role,
        "is_active": True,
        "is_super_admin": False,
        "company_ids": list(company_ids),
        "active_company_id": active,
    }
    if employee_id:
        doc["employee_id"] = employee_id
    return doc


def _note(nid, company_id, *, read=False, user_id=None, employee_id=None, roles=None, title="not"):
    return {
        "_id": nid,
        "company_id": company_id,
        "type": "task_assigned" if user_id or employee_id else "license",
        "title": title,
        "message": title,
        "roles": list(roles) if roles is not None else (["admin"] if not user_id else []),
        "user_id": user_id,
        "employee_id": employee_id,
        "is_read": read,
        "created_at": "2026-10-16T12:00:00+00:00",
    }


def _seed(db):
    db.users.docs.extend([
        _user("user-a", [COMP_A], COMP_A),
        _user("user-b", [COMP_B], COMP_B),
        _user("user-staff", [COMP_A], COMP_A, role="personel", employee_id="empA"),
    ])
    db.notifications.docs.extend([
        _note("nA-read", COMP_A, read=True, title="A okundu"),
        _note("nA-unread", COMP_A, read=False, title="A okunmadi"),
        _note("nA-other", COMP_A, read=True, user_id="someone-else", employee_id="emp-other", title="A baskasina"),
        _note("nA-mine", COMP_A, read=True, user_id="user-staff", employee_id="empA", title="A bana"),
        _note("nB-read", COMP_B, read=True, title="B-SECRET-NOTE"),
        _note("nB-unread", COMP_B, read=False, title="B-SECRET-UNREAD"),
    ])
    db.contacts.docs.append({
        "_id": "cB",
        "company_id": COMP_B,
        "name": "B-SECRET-CARI",
        "balance": 1500.5,
        "status": "active",
    })


def _ids(db, company_id):
    return [d["_id"] for d in db.notifications.docs if d.get("company_id") == company_id]


def _doc(db, nid):
    for doc in db.notifications.docs:
        if doc["_id"] == nid:
            return doc
    return None


def _contact(db):
    return db.contacts.docs[0]


def _auth(uid, *, role="admin"):
    token = auth_utils.create_access_token(uid, f"{uid}@example.com", role)
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def api():
    db = MemDB()
    _seed(db)
    prev = (server.db, rbac._db)
    server.db = db
    rbac._db = db
    router = server.app.router
    saved_up = list(router.on_startup)
    saved_down = list(router.on_shutdown)
    router.on_startup.clear()
    router.on_shutdown.clear()
    client = TestClient(server.app)
    entered = False
    try:
        client.__enter__()
        entered = True
        db.queries.clear()
        yield client, db
    finally:
        if entered:
            client.__exit__(None, None, None)
        server.db, rbac._db = prev
        router.on_startup[:] = saved_up
        router.on_shutdown[:] = saved_down


def test_other_company_delete_is_404_and_leaves_foreign_data(api):
    client, db = api
    before_notes = copy.deepcopy(db.notifications.docs)
    before_contact = copy.deepcopy(_contact(db))
    before_b = _ids(db, COMP_B)
    assert len(before_b) == 2

    foreign = client.delete("/api/notifications/nB-read", headers=_auth("user-a"))
    unread = client.delete("/api/notifications/nB-unread", headers=_auth("user-a"))
    missing = client.delete("/api/notifications/yok", headers=_auth("user-a"))

    assert foreign.status_code == 404
    assert foreign.json()["detail"] == NOT_FOUND
    assert unread.status_code == 404
    assert unread.json()["detail"] == NOT_FOUND
    assert missing.status_code == 404
    assert missing.json()["detail"] == NOT_FOUND
    assert "B-SECRET" not in foreign.text
    assert "B-SECRET" not in unread.text
    assert db.notifications.docs == before_notes
    assert _ids(db, COMP_B) == before_b
    assert _contact(db) == before_contact
    assert _contact(db)["balance"] == 1500.5
    assert _contact(db)["status"] == "active"
    assert _doc(db, "nB-read")["is_read"] is True
    assert all(op != "delete_one" for _name, op, _q in db.queries)
    assert all(
        q.get("company_id") == COMP_A
        for name, _op, q in db.queries
        if name == "notifications"
    )


def test_same_company_read_notification_deletes(api):
    client, db = api
    before_b = copy.deepcopy([d for d in db.notifications.docs if d["company_id"] == COMP_B])
    before_contact = copy.deepcopy(_contact(db))
    count_a = len(_ids(db, COMP_A))

    response = client.delete("/api/notifications/nA-read", headers=_auth("user-a"))

    assert response.status_code == 200
    assert response.json() == DELETED
    assert _doc(db, "nA-read") is None
    assert len(_ids(db, COMP_A)) == count_a - 1
    assert [d for d in db.notifications.docs if d["company_id"] == COMP_B] == before_b
    assert _contact(db) == before_contact
    deletes = [q for name, op, q in db.queries if name == "notifications" and op == "delete_one"]
    assert deletes == [{"_id": "nA-read", "company_id": COMP_A}]
    finds = [q for name, op, q in db.queries if name == "notifications" and op == "find_one"]
    assert finds == [{"_id": "nA-read", "company_id": COMP_A}]


def test_same_company_without_delete_permission_keeps_existing_errors(api):
    client, db = api
    other_before = copy.deepcopy(_doc(db, "nA-other"))
    unread_before = copy.deepcopy(_doc(db, "nA-unread"))
    count = len(db.notifications.docs)

    hidden = client.delete("/api/notifications/nA-other", headers=_auth("user-staff", role="personel"))
    unread = client.delete("/api/notifications/nA-unread", headers=_auth("user-a"))

    assert hidden.status_code == 403
    assert hidden.json()["detail"] == FORBIDDEN
    assert unread.status_code == 400
    assert unread.json()["detail"] == UNREAD
    assert _doc(db, "nA-other") == other_before
    assert _doc(db, "nA-unread") == unread_before
    assert len(db.notifications.docs) == count
    assert all(op != "delete_one" for _name, op, _q in db.queries)


def test_same_company_owner_can_delete_own_read_notification(api):
    client, db = api
    response = client.delete("/api/notifications/nA-mine", headers=_auth("user-staff", role="personel"))
    assert response.status_code == 200
    assert response.json() == DELETED
    assert _doc(db, "nA-mine") is None
    assert _doc(db, "nA-other") is not None
    assert _doc(db, "nB-read")["title"] == "B-SECRET-NOTE"


def test_no_token_is_401_and_deletes_nothing(api):
    client, db = api
    before = copy.deepcopy(db.notifications.docs)
    response = client.delete("/api/notifications/nA-read")
    assert response.status_code == 401
    assert db.notifications.docs == before
    assert db.queries == []
