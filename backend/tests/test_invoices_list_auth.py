"""GET /api/invoices: route-level auth and company resolution.

In-process TestClient and a memory database. No live server and no port 8021.
"""
from __future__ import annotations

import asyncio
import copy
import inspect
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-invoices-list-auth-jwt-secret-not-default-32b")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import addons  # noqa: E402
import auth_utils  # noqa: E402
import rbac  # noqa: E402
import saas  # noqa: E402
import server  # noqa: E402
from mysql_store import match_query, sort_docs  # noqa: E402

COMP_A = "A"
COMP_B = "B"
NEXUS = "comp_nexus_main_01"


def _legacy_query(company_id, type=None, project_id=None, include_cancelled=False):
    """Historical list_invoices filter, before this route grew a limit argument."""
    query = {"company_id": company_id}
    if type == "export":
        query["trade_kind"] = "export"
        query["invoice_type"] = {"$ne": "dispatch"}
    elif type == "import":
        query["trade_kind"] = "import"
        query["invoice_type"] = {"$ne": "dispatch"}
    elif type and type != "all":
        query["invoice_type"] = type
    else:
        query["invoice_type"] = {"$ne": "dispatch"}
    if project_id:
        query["project_id"] = project_id
    if not include_cancelled:
        query["status"] = {"$nin": ["cancelled", "canceled", "void"]}
    return query


def _legacy_ids(docs, company_id, type=None, project_id=None, include_cancelled=False, cap=1000):
    matched = [d for d in docs if match_query(d, _legacy_query(company_id, type, project_id, include_cancelled))]
    ordered = sort_docs(matched, [("created_at", -1)])
    return [d["_id"] for d in ordered[:cap]]


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
    def __init__(self, name, docs=None):
        self.name = name
        self.docs = list(docs or [])
        self.finds = []
        self.last_limits = []

    def find(self, query=None, projection=None):
        self.finds.append(copy.deepcopy(query))
        matched = [d for d in self.docs if match_query(d, query or {})]
        cur = MemCursor(matched)
        orig = cur.to_list
        owner = self

        async def to_list(length=None, _orig=orig, _owner=owner):
            _owner.last_limits.append(length)
            return await _orig(length)

        cur.to_list = to_list
        return cur

    async def find_one(self, query=None, projection=None):
        rows = [d for d in self.docs if match_query(d, query or {})]
        return copy.deepcopy(rows[0]) if rows else None

    async def create_index(self, *args, **kwargs):
        return None

    async def insert_one(self, doc):
        self.docs.append(doc)

    async def update_one(self, *args, **kwargs):
        return None

    async def delete_many(self, *args, **kwargs):
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

    async def _ensure(self):
        return None


def _user(uid, company_ids, active, *, superadmin=False):
    return {
        "_id": uid,
        "id": uid,
        "email": f"{uid}@example.com",
        "name": uid,
        "role": "admin",
        "is_active": True,
        "is_super_admin": superadmin,
        "company_ids": list(company_ids),
        "active_company_id": active,
    }


def _invoice(_id, company, created, **extra):
    doc = {
        "_id": _id,
        "company_id": company,
        "invoice_type": "sales",
        "status": "issued",
        "created_at": created,
        "invoice_number": _id,
        "grand_total": 10,
    }
    doc.update(extra)
    return doc


def _seed():
    return [
        _invoice("a1", COMP_A, "2026-10-16T10:00:00Z"),
        _invoice("a2", COMP_A, "2026-10-16T09:00:00Z"),
        _invoice("a3", COMP_A, "2026-10-16T11:00:00Z", status="cancelled"),
        _invoice("a4", COMP_A, "2026-10-16T08:00:00Z", status="canceled"),
        _invoice("a5", COMP_A, "2026-10-16T07:00:00Z", status="void"),
        _invoice("a6", COMP_A, "2026-10-16T12:00:00Z", invoice_type="dispatch"),
        _invoice("a7", COMP_A, "2026-10-16T06:00:00Z", trade_kind="export"),
        _invoice("a8", COMP_A, "2026-10-15T10:00:00Z", invoice_type="purchase", trade_kind="import"),
        _invoice("a9", COMP_A, "2026-10-14T10:00:00Z", invoice_type="purchase"),
        _invoice("a10", COMP_A, "2026-10-16T05:00:00Z", project_id="P1"),
        _invoice("a11", COMP_A, "2026-10-16T04:00:00Z", project_id="P2"),
        _invoice("a12", COMP_A, "2026-10-16T11:30:00Z", project_id="P1", status="cancelled"),
        _invoice("b1", COMP_B, "2026-10-16T13:00:00Z", invoice_number="B-ONLY", contact_name="B-SECRET"),
        _invoice("n1", NEXUS, "2026-10-16T14:00:00Z", invoice_number="NEXUS-ONLY"),
    ]


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture
def api():
    db = MemDB()
    db.users.docs.append(_user("user-a", [COMP_A], COMP_A))
    db.users.docs.append(_user("user-b", [COMP_B], COMP_B))
    db.users.docs.append(_user("user-sa", [], "", superadmin=True))
    db.users.docs.append(_user("user-sa-a", [COMP_A], COMP_A, superadmin=True))
    db.invoices.docs.extend(_seed())
    prev = (server.db, rbac._db, saas._db, addons._db)
    server.db = db
    rbac._db = db
    saas._db = db
    addons._db = db
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
        server.db, rbac._db, saas._db, addons._db = prev
        router.on_startup[:] = saved_up
        router.on_shutdown[:] = saved_down
        saas.invalidate()


def _token(uid, *, superadmin=False):
    return auth_utils.create_access_token(uid, f"{uid}@example.com", "admin", is_super_admin=superadmin)


def _auth(uid, *, superadmin=False):
    return {"Authorization": f"Bearer {_token(uid, superadmin=superadmin)}"}


def _ids(response):
    body = response.json()
    assert isinstance(body, list)
    return [row["id"] for row in body]


def test_route_signature_has_auth_and_no_nexus_default():
    sig = inspect.signature(server.list_invoices)
    assert sig.parameters["company_id"].default is None
    assert sig.parameters["type"].default is None
    assert sig.parameters["project_id"].default is None
    assert sig.parameters["include_cancelled"].default is False
    assert sig.parameters["limit"].default is None
    assert sig.parameters["user"].default.dependency is server.get_current_user
    src = inspect.getsource(server.list_invoices)
    assert "comp_nexus_main_01" not in src
    assert "resolve_company_id" in src


def test_no_token_is_401(api):
    client, db = api
    response = client.get("/api/invoices")
    assert response.status_code == 401
    assert db.invoices.finds == []
    assert "B-SECRET" not in response.text
    assert "NEXUS-ONLY" not in response.text


def test_other_company_is_403_and_returns_nothing(api):
    client, db = api
    response = client.get("/api/invoices", params={"company_id": COMP_B}, headers=_auth("user-a"))
    assert response.status_code == 403
    assert "B-ONLY" not in response.text
    assert "B-SECRET" not in response.text
    assert "NEXUS-ONLY" not in response.text
    assert all(q.get("company_id") != COMP_B for q in db.invoices.finds)


def test_direct_call_other_company_is_403_without_middleware(api):
    _client, db = api
    user_a = _user("user-a", [COMP_A], COMP_A)
    before = len(db.invoices.finds)
    with pytest.raises(HTTPException) as exc:
        _run(server.list_invoices(company_id=COMP_B, user=user_a))
    assert exc.value.status_code == 403
    assert db.invoices.finds[before:] == []


def test_missing_company_id_uses_active_company_only(api):
    client, db = api
    response = client.get("/api/invoices", headers=_auth("user-a"))
    assert response.status_code == 200, response.text
    assert _ids(response) == _legacy_ids(db.invoices.docs, COMP_A)
    assert "B-ONLY" not in response.text
    assert "NEXUS-ONLY" not in response.text
    assert db.invoices.finds[-1]["company_id"] == COMP_A
    assert "x-total-truncated" not in response.headers

    blank = client.get("/api/invoices", params={"company_id": "", "type": "all"}, headers=_auth("user-a"))
    assert blank.status_code == 200
    assert _ids(blank) == _legacy_ids(db.invoices.docs, COMP_A, type="all")


def test_direct_call_without_company_id_stays_on_active_company(api):
    _client, db = api
    user_a = _user("user-a", [COMP_A], COMP_A)
    rows = _run(server.list_invoices(company_id=None, user=user_a))
    assert [row["id"] for row in rows] == _legacy_ids(db.invoices.docs, COMP_A)
    assert db.invoices.finds[-1] == _legacy_query(COMP_A)
    blank = _run(server.list_invoices(company_id="", user=user_a))
    assert [row["id"] for row in blank] == _legacy_ids(db.invoices.docs, COMP_A)


@pytest.mark.parametrize(
    "params",
    [
        {},
        {"type": "all"},
        {"type": "sales"},
        {"type": "export"},
        {"type": "import"},
        {"project_id": "P1"},
        {"include_cancelled": True},
        {"type": "sales", "project_id": "P1", "include_cancelled": False},
        {"type": "all", "include_cancelled": True, "project_id": "P1"},
    ],
)
def test_filters_match_legacy_set_and_order(api, params):
    client, db = api
    response = client.get("/api/invoices", params={"company_id": COMP_A, **params}, headers=_auth("user-a"))
    assert response.status_code == 200, response.text
    assert _ids(response) == _legacy_ids(db.invoices.docs, COMP_A, **params)
    assert db.invoices.finds[-1] == _legacy_query(COMP_A, **params)
    assert "B-SECRET" not in response.text
    assert "NEXUS-ONLY" not in response.text
    assert response.headers.get("x-total-truncated") is None


def test_super_admin_follows_resolve_company_id(api):
    client, db = api
    missing = client.get("/api/invoices", headers=_auth("user-sa", superadmin=True))
    assert missing.status_code == 400
    assert db.invoices.finds == []

    user_sa = _user("user-sa", [], "", superadmin=True)
    with pytest.raises(HTTPException) as exc:
        _run(server.list_invoices(user=user_sa))
    assert exc.value.status_code == 400

    active = client.get("/api/invoices", headers=_auth("user-sa-a", superadmin=True))
    assert active.status_code == 200, active.text
    assert _ids(active) == _legacy_ids(db.invoices.docs, COMP_A)
    assert "NEXUS-ONLY" not in active.text

    foreign = client.get(
        "/api/invoices",
        params={"company_id": COMP_B},
        headers=_auth("user-sa", superadmin=True),
    )
    assert foreign.status_code == 200, foreign.text
    assert _ids(foreign) == ["b1"]


def test_default_limit_is_1000_and_sets_truncation_header(api):
    client, db = api
    db.invoices.docs.clear()
    db.invoices.finds.clear()
    db.invoices.last_limits.clear()
    db.invoices.docs.extend(
        _invoice(f"i{i:04d}", COMP_A, f"2026-10-16T00:00:00.{i:04d}Z")
        for i in range(1000)
    )
    db.invoices.docs.append(_invoice("b-hidden", COMP_B, "2026-10-16T00:00:00.9999Z", invoice_number="B-ONLY"))
    exact = client.get("/api/invoices", params={"company_id": COMP_A}, headers=_auth("user-a"))
    assert exact.status_code == 200
    assert len(exact.json()) == 1000
    assert "x-total-truncated" not in exact.headers
    assert db.invoices.last_limits[-1] == 1001
    assert "B-ONLY" not in exact.text

    db.invoices.docs.append(_invoice("i1000", COMP_A, "2026-10-16T00:00:00.1000Z"))
    clipped = client.get("/api/invoices", headers=_auth("user-a"))
    assert clipped.status_code == 200
    ids = _ids(clipped)
    assert len(ids) == 1000
    assert ids[0] == "i1000"
    assert "i0000" not in ids
    assert clipped.headers.get("x-total-truncated") == "1"
    assert isinstance(clipped.json(), list)
    assert "B-ONLY" not in clipped.text


def test_limit_zero_is_422(api):
    client, db = api
    before = len(db.invoices.finds)
    response = client.get("/api/invoices", params={"company_id": COMP_A, "limit": 0}, headers=_auth("user-a"))
    assert response.status_code == 422
    assert "B-SECRET" not in response.text
    assert db.invoices.finds[before:] == []

    user_a = _user("user-a", [COMP_A], COMP_A)
    with pytest.raises(HTTPException) as exc:
        _run(server.list_invoices(company_id=COMP_A, limit=0, user=user_a))
    assert exc.value.status_code == 422
    with pytest.raises(HTTPException) as neg:
        _run(server.list_invoices(company_id=COMP_A, limit=-1, user=user_a))
    assert neg.value.status_code == 422


def test_limit_above_5000_is_clamped(api):
    client, db = api
    db.invoices.docs.clear()
    db.invoices.last_limits.clear()
    db.invoices.docs.extend(
        _invoice(f"k{i:05d}", COMP_A, f"{i:05d}")
        for i in range(5001)
    )
    db.invoices.docs.append(_invoice("b-hidden", COMP_B, "99999", invoice_number="B-ONLY"))
    response = client.get("/api/invoices", params={"company_id": COMP_A, "limit": 10000}, headers=_auth("user-a"))
    assert response.status_code == 200, response.text
    ids = _ids(response)
    assert len(ids) == 5000
    assert ids[0] == "k05000"
    assert "k00000" not in ids
    assert response.headers.get("x-total-truncated") == "1"
    assert db.invoices.last_limits[-1] == 5001
    assert "B-ONLY" not in response.text

    db.invoices.docs.clear()
    db.invoices.last_limits.clear()
    db.invoices.docs.extend(
        _invoice(f"s{i}", COMP_A, f"2026-10-16T00:00:0{i}Z")
        for i in range(3)
    )
    short = client.get("/api/invoices", params={"limit": 10000}, headers=_auth("user-a"))
    assert short.status_code == 200
    assert len(short.json()) == 3
    assert "x-total-truncated" not in short.headers
    assert db.invoices.last_limits[-1] == 5001
