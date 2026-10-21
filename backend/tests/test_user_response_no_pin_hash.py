"""Kullanıcı yanıtları atölye PIN hash'i, düz PIN ve pin_ver döndürmez. Canlı veritabanı yok."""
from __future__ import annotations

import copy
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import addons  # noqa: E402
import attendance  # noqa: E402
import auth_utils  # noqa: E402
import rbac  # noqa: E402
import saas  # noqa: E402
import server  # noqa: E402
import shopfloor_accounts as sfa  # noqa: E402
from mysql_store import apply_update, match_query, sort_docs  # noqa: E402

COMP = "co_pin"
ADMIN_PIN = "5829"
ATOLYE_PIN = "2468"
PLAIN_PIN = "7391"


class MemCursor:
    def __init__(self, docs):
        self._docs = docs
        self._sort = None

    def sort(self, key, direction=1):
        self._sort = [(key, direction)] if isinstance(key, str) else list(key)
        return self

    async def to_list(self, length=None):
        rows = sort_docs(list(self._docs), self._sort) if self._sort else list(self._docs)
        if length is not None:
            rows = rows[: int(length)]
        return copy.deepcopy(rows)


class MemColl:
    def __init__(self, name):
        self.name = name
        self.docs = []

    def find(self, query=None, projection=None):
        matched = [d for d in self.docs if match_query(d, query or {})]
        return MemCursor(matched)

    async def find_one(self, query=None, projection=None):
        for doc in self.docs:
            if match_query(doc, query or {}):
                return copy.deepcopy(doc)
        return None

    async def distinct(self, key, query=None):
        seen = []
        for doc in self.docs:
            if not match_query(doc, query or {}):
                continue
            val = doc.get(key)
            if val not in seen:
                seen.append(val)
        return seen

    async def count_documents(self, query=None):
        return sum(1 for doc in self.docs if match_query(doc, query or {}))

    async def insert_one(self, doc):
        self.docs.append(copy.deepcopy(doc))
        return None

    async def insert_many(self, docs):
        self.docs.extend(copy.deepcopy(list(docs)))
        return None

    async def update_one(self, query, update, upsert=False):
        for i, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                self.docs[i] = apply_update(doc, update, query)
                return type("R", (), {"matched_count": 1, "modified_count": 1})()
        return type("R", (), {"matched_count": 0, "modified_count": 0})()

    async def update_many(self, query, update):
        n = 0
        for i, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                self.docs[i] = apply_update(doc, update, query)
                n += 1
        return type("R", (), {"matched_count": n, "modified_count": n})()

    async def delete_many(self, query):
        self.docs[:] = [d for d in self.docs if not match_query(d, query or {})]
        return None


class MemDB:
    def __init__(self):
        self._cols = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = MemColl(name)
            self._cols[name] = coll
        return coll

    def __getitem__(self, name):
        return getattr(self, name)


def _user(uid, *, role, name, pin=None, account_type=None, stations=None):
    doc = {
        "_id": uid,
        "email": f"{uid}@example.com",
        "name": name,
        "role": role,
        "is_active": True,
        "is_super_admin": False,
        "company_ids": [COMP],
        "active_company_id": COMP,
        "user_number": f"U-{uid}",
        "preferences": {},
        "password_hash": auth_utils.hash_password("login-secret"),
        "punch_pin_hash": auth_utils.hash_password("1111"),
        "shopfloor_pin": pin or PLAIN_PIN,
        "shopfloor_pin_ver": 4 if pin else 1,
    }
    if pin:
        doc["shopfloor_pin_hash"] = auth_utils.hash_password(pin)
    if account_type:
        doc["account_type"] = account_type
    if stations is not None:
        doc["shopfloor_stations"] = list(stations)
    return doc


def _auth(uid, role="admin"):
    token = auth_utils.create_access_token(uid, f"{uid}@example.com", role)
    return {"Authorization": f"Bearer {token}"}


def _secret_key(key):
    return key == "shopfloor_pin" or key == "shopfloor_pin_ver" or str(key).endswith("pin_hash")


def _leaks(node):
    found = []
    if isinstance(node, dict):
        for key, value in node.items():
            if _secret_key(key):
                found.append(str(key))
            found.extend(_leaks(value))
    elif isinstance(node, list):
        for item in node:
            found.extend(_leaks(item))
    return found


def _assert_no_secret(response, where):
    assert response.status_code == 200, (where, response.text)
    assert "$2b$" not in response.text, where
    for secret in (ADMIN_PIN, ATOLYE_PIN, PLAIN_PIN):
        assert secret not in response.text, (where, secret)
    assert _leaks(response.json()) == [], (where, _leaks(response.json()))


@pytest.fixture
def api(monkeypatch):
    monkeypatch.setenv("LOG_DB_PERSIST", "0")
    monkeypatch.setenv("JWT_SECRET", "test-user-pin-hash-response-secret-not-default")
    monkeypatch.setenv("TAMKOBI_BACKGROUND_JOBS", "0")
    db = MemDB()
    db.companies.docs.append({
        "_id": COMP,
        "name": "PIN Firma",
        "work_parks": [{"name": "CNC"}],
    })
    db.users.docs.extend([
        _user("admin-pin", role="admin", name="Admin PIN", pin=ADMIN_PIN),
        _user("atolye-pin", role="production", name="Atolye PIN", pin=ATOLYE_PIN, account_type="atolye", stations=["CNC"]),
        _user("plain-user", role="sales", name="Pinsiz", pin=None),
    ])
    prev = (server.db, rbac._db, saas._db, addons._db, attendance._db, sfa._db, rbac._current_user, sfa._current_user)
    server.db = db
    rbac._db = db
    saas._db = db
    addons._db = db
    attendance._db = db
    sfa._db = db
    rbac._current_user = server.get_current_user
    sfa._current_user = server.get_current_user
    saas.invalidate()
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
        yield client, db
    finally:
        if entered:
            client.__exit__(None, None, None)
        server.db, rbac._db, saas._db, addons._db, attendance._db, sfa._db, rbac._current_user, sfa._current_user = prev
        router.on_startup[:] = saved_up
        router.on_shutdown[:] = saved_down
        saas.invalidate()


def _row(body, uid):
    rows = body["users"] if isinstance(body, dict) and "users" in body else body
    return next(row for row in rows if row.get("id") == uid or row.get("_id") == uid)


def test_user_responses_hide_pin_hash(api):
    client, db = api
    admin = _auth("admin-pin")

    listed = client.get("/api/users", params={"company_id": COMP}, headers=admin)
    _assert_no_secret(listed, "GET /users")
    users = listed.json()["users"]
    assert _row(listed.json(), "admin-pin")["has_shopfloor_pin"] is True
    assert _row(listed.json(), "atolye-pin")["has_shopfloor_pin"] is True
    assert _row(listed.json(), "plain-user")["has_shopfloor_pin"] is False
    assert len(users) == 3

    for uid, flag in (("admin-pin", True), ("atolye-pin", True), ("plain-user", False)):
        me = client.get("/api/auth/me", headers=_auth(uid, "admin" if uid == "admin-pin" else "production" if uid == "atolye-pin" else "sales"))
        _assert_no_secret(me, f"GET /auth/me {uid}")
        assert me.json()["user"]["has_shopfloor_pin"] is flag

        edited = client.put(f"/api/users/{uid}", json={"name": f"Ad {uid}"}, headers=admin)
        _assert_no_secret(edited, f"PUT /users/{uid}")
        assert edited.json()["has_shopfloor_pin"] is flag
        assert edited.json()["name"] == f"Ad {uid}"

    admin_account = client.put(
        "/api/users/admin-pin/shopfloor-account",
        json={"company_id": COMP, "account_type": "standard", "shopfloor_stations": []},
        headers=admin,
    )
    _assert_no_secret(admin_account, "PUT shopfloor-account admin")
    assert admin_account.json()["has_shopfloor_pin"] is True
    assert admin_account.json()["account_type"] == "standard"

    atolye_account = client.put(
        "/api/users/atolye-pin/shopfloor-account",
        json={"company_id": COMP, "account_type": "atolye", "shopfloor_stations": ["CNC"]},
        headers=admin,
    )
    _assert_no_secret(atolye_account, "PUT shopfloor-account atolye")
    assert atolye_account.json()["has_shopfloor_pin"] is True
    assert atolye_account.json()["shopfloor_stations"] == ["CNC"]

    plain_account = client.put(
        "/api/users/plain-user/shopfloor-account",
        json={"company_id": COMP, "account_type": "standard", "shopfloor_stations": []},
        headers=admin,
    )
    _assert_no_secret(plain_account, "PUT shopfloor-account plain")
    assert plain_account.json()["has_shopfloor_pin"] is False

    for uid, pin in (("admin-pin", ADMIN_PIN), ("atolye-pin", ATOLYE_PIN)):
        stored = next(doc for doc in db.users.docs if doc["_id"] == uid)
        assert str(stored["shopfloor_pin_hash"]).startswith("$2b$")
        assert auth_utils.verify_password(pin, stored["shopfloor_pin_hash"])
        assert stored.get("shopfloor_pin_ver") == 4
    plain = next(doc for doc in db.users.docs if doc["_id"] == "plain-user")
    assert "shopfloor_pin_hash" not in plain
    assert plain.get("punch_pin_hash")
    assert plain.get("shopfloor_pin") == PLAIN_PIN
