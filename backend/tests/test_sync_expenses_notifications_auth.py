"""GET /sync, masraf uçları ve bildirimler: oturum + şirket.

Bellek içi veritabanı ve TestClient. 8021'e veya canlı veritabanına bağlanmaz.
"""
from __future__ import annotations

import asyncio
import copy
import inspect
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.params import Query as QueryParam
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-sync-expenses-notifications-auth-jwt-secret")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import addons  # noqa: E402
import auth_utils  # noqa: E402
import data_sync  # noqa: E402
import employee_pay  # noqa: E402
import expenses  # noqa: E402
import help_center  # noqa: E402
import platform_v1  # noqa: E402
import rbac  # noqa: E402
import saas  # noqa: E402
import server  # noqa: E402
from mysql_store import apply_update, match_query, new_upsert_doc, sort_docs  # noqa: E402

COMP_A = "A"
COMP_B = "B"
NEXUS = "comp_nexus_main_01"
MONTH = "2026-10"
SECRETS = ("B-SECRET", "NEXUS-ONLY", "SECRET-HASH")


def _run(coro):
    return asyncio.run(coro)


class MemCursor:
    def __init__(self, docs):
        self._docs = docs
        self._sort = None

    def sort(self, key, direction=1):
        self._sort = [(key, direction)] if isinstance(key, str) else list(key)
        return self

    def _rows(self, length=None):
        rows = sort_docs(list(self._docs), self._sort) if self._sort else list(self._docs)
        if length is not None:
            rows = rows[: int(length)]
        return copy.deepcopy(rows)

    async def to_list(self, length=None):
        return self._rows(length)

    def __aiter__(self):
        rows = self._rows()

        async def _gen():
            for row in rows:
                yield row

        return _gen()


class MemColl:
    def __init__(self, name, db):
        self.name = name
        self.db = db
        self.docs = []

    def find(self, query=None, projection=None):
        self.db.finds.append({"coll": self.name, "query": copy.deepcopy(query)})
        matched = [d for d in self.docs if match_query(d, query or {})]
        return MemCursor(matched)

    async def find_one(self, query=None, projection=None):
        self.db.finds.append({"coll": self.name, "query": copy.deepcopy(query), "one": True})
        for doc in self.docs:
            if match_query(doc, query or {}):
                return copy.deepcopy(doc)
        return None

    async def count_documents(self, query=None):
        return sum(1 for doc in self.docs if match_query(doc, query or {}))

    async def insert_one(self, doc):
        self.db.writes.append({"coll": self.name, "op": "insert_one", "doc": copy.deepcopy(doc)})
        self.docs.append(copy.deepcopy(doc))
        return SimpleNamespace(inserted_id=doc.get("_id"))

    async def update_one(self, query, update, upsert=False):
        self.db.writes.append({"coll": self.name, "op": "update_one", "query": copy.deepcopy(query)})
        for i, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                self.docs[i] = apply_update(doc, update, query)
                return SimpleNamespace(modified_count=1, matched_count=1, upserted_id=None)
        if upsert:
            new_doc = new_upsert_doc(update, query)
            self.docs.append(new_doc)
            return SimpleNamespace(modified_count=0, matched_count=0, upserted_id=new_doc.get("_id"))
        return SimpleNamespace(modified_count=0, matched_count=0, upserted_id=None)

    async def delete_one(self, query):
        self.db.writes.append({"coll": self.name, "op": "delete_one", "query": copy.deepcopy(query)})
        for i, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                self.docs.pop(i)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def changed_since(self, since=None, company_id=None, limit=3000):
        self.db.sync_calls.append({
            "collection": self.name,
            "since": since,
            "company_id": company_id,
            "limit": limit,
        })
        rows = [d for d in self.docs if not company_id or d.get("company_id") == company_id]
        if since:
            rows = [d for d in rows if str(d.get("updated_at") or "") >= str(since)]
        rows = sort_docs(rows, [("updated_at", 1)])
        more = len(rows) > int(limit)
        rows = rows[: int(limit)]
        cursor = rows[-1].get("updated_at") if rows else since
        return copy.deepcopy(rows), cursor, more


class MemDB:
    def __init__(self):
        self._cols = {}
        self.finds = []
        self.writes = []
        self.sync_calls = []

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

    async def _ensure(self):
        return None


def _user(uid, company_ids, active, *, role="admin", superadmin=False, employee_id=None):
    doc = {
        "_id": uid,
        "id": uid,
        "email": f"{uid}@example.com",
        "name": uid,
        "role": role,
        "is_active": True,
        "is_super_admin": superadmin,
        "company_ids": list(company_ids),
        "active_company_id": active,
    }
    if employee_id:
        doc["employee_id"] = employee_id
    return doc


def _seed(db):
    db.invoices.docs.extend([
        {"_id": "invA", "company_id": COMP_A, "invoice_number": "A-1", "updated_at": "2026-10-16T10:00:00+00:00", "password_hash": "SECRET-HASH"},
        {"_id": "invA2", "company_id": COMP_A, "invoice_number": "A-2", "updated_at": "2026-10-16T11:00:00+00:00"},
        {"_id": "invB", "company_id": COMP_B, "invoice_number": "B-SECRET-INV", "contact_name": "B-SECRET-CARI", "updated_at": "2026-10-16T12:00:00+00:00"},
        {"_id": "invN", "company_id": NEXUS, "invoice_number": "NEXUS-ONLY", "updated_at": "2026-10-16T13:00:00+00:00"},
    ])
    db.contacts.docs.extend([
        {"_id": "cA", "company_id": COMP_A, "name": "Ali A", "updated_at": "2026-10-16T10:00:00+00:00"},
        {"_id": "cB", "company_id": COMP_B, "name": "B-SECRET-CONTACT", "updated_at": "2026-10-16T12:00:00+00:00"},
    ])
    db.bank_transactions.docs.extend([
        {"_id": "txA", "company_id": COMP_A, "description": "A tahsilat", "updated_at": "2026-10-16T10:00:00+00:00"},
        {"_id": "txB", "company_id": COMP_B, "description": "B-SECRET-BANK", "updated_at": "2026-10-16T12:00:00+00:00"},
    ])
    db.sync_tombstones.docs.extend([
        {"_id": "tA", "collection": "invoices", "doc_id": "goneA", "company_id": COMP_A, "deleted_at": "2026-10-16T09:00:00+00:00"},
        {"_id": "tB", "collection": "invoices", "doc_id": "B-SECRET-GONE", "company_id": COMP_B, "deleted_at": "2026-10-16T09:00:00+00:00"},
        {"_id": "tN", "collection": "invoices", "doc_id": "NEXUS-GONE", "company_id": NEXUS, "deleted_at": "2026-10-16T09:00:00+00:00"},
    ])
    db.expense_categories.docs.extend([
        {"_id": "catA", "company_id": COMP_A, "name": "Ozel A"},
        {"_id": "catB", "company_id": COMP_B, "name": "B-SECRET-CAT"},
    ])
    db.expenses.docs.extend([
        {
            "_id": "exA", "company_id": COMP_A, "date": f"{MONTH}-02", "category": "Yakıt",
            "description": "A yakit", "total": 90, "vat_amount": 0, "payment_status": "unpaid",
            "currency": "TRY", "expense_number": "MSR-A",
        },
        {
            "_id": "exB", "company_id": COMP_B, "date": f"{MONTH}-03", "category": "Yakıt",
            "description": "B-SECRET-EXP", "total": 999, "vat_amount": 0, "payment_status": "unpaid",
            "currency": "TRY", "expense_number": "MSR-B",
        },
        {
            "_id": "recB", "company_id": COMP_B, "date": "2026-09-01", "category": "Kira",
            "description": "B-SECRET-REC", "total": 10, "payment_status": "unpaid", "currency": "TRY",
            "is_recurring": True, "next_date": "2026-10-01", "recurrence": "monthly",
        },
    ])
    db.expense_budgets.docs.extend([
        {"_id": "budA", "company_id": COMP_A, "category": "Yakıt", "monthly_limit": 100},
        {"_id": "budB", "company_id": COMP_B, "category": "Yakıt", "monthly_limit": 50},
    ])
    db.notifications.docs.extend([
        {"_id": "nA1", "company_id": COMP_A, "title": "A yeni", "message": "A", "type": "license", "roles": ["admin", "personel"], "is_read": False, "created_at": "2026-10-16T12:00:00+00:00"},
        {"_id": "nA0", "company_id": COMP_A, "title": "A eski", "message": "A", "type": "license", "is_read": True, "created_at": "2026-10-16T08:00:00+00:00"},
        {"_id": "nAstaff", "company_id": COMP_A, "title": "A kisiye ozel", "message": "A", "type": "task", "user_id": "other-emp", "is_read": False, "created_at": "2026-10-16T11:00:00+00:00", "ref_type": "task", "ref_id": "taskA"},
        {"_id": "nB", "company_id": COMP_B, "title": "B-SECRET-NOTE", "message": "B-SECRET-NOTE", "type": "license", "is_read": False, "created_at": "2026-10-16T13:00:00+00:00"},
        {"_id": "nN", "company_id": NEXUS, "title": "NEXUS-ONLY-NOTE", "message": "NEXUS-ONLY", "type": "license", "is_read": False, "created_at": "2026-10-16T14:00:00+00:00"},
    ])


def _bind(db):
    prev = (
        server.db, data_sync._db, data_sync._current_user,
        expenses._db, expenses._current_user,
        rbac._db, saas._db, addons._db,
    )
    server.db = db
    data_sync._db = db
    data_sync._current_user = server.get_current_user
    expenses._db = db
    expenses._current_user = server.get_current_user
    rbac._db = db
    saas._db = db
    addons._db = db
    return prev


def _unbind(prev):
    (
        server.db, data_sync._db, data_sync._current_user,
        expenses._db, expenses._current_user,
        rbac._db, saas._db, addons._db,
    ) = prev


@pytest.fixture
def api():
    db = MemDB()
    db.users.docs.extend([
        _user("user-a", [COMP_A], COMP_A),
        _user("user-b", [COMP_B], COMP_B),
        _user("user-staff", [COMP_A], COMP_A, role="personel", employee_id="empA"),
        _user("user-sa", [], "", superadmin=True),
        _user("user-sa-a", [COMP_A], COMP_A, superadmin=True),
    ])
    _seed(db)
    prev = _bind(db)
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
        db.finds.clear()
        db.writes.clear()
        db.sync_calls.clear()
        yield client, db
    finally:
        if entered:
            client.__exit__(None, None, None)
        _unbind(prev)
        router.on_startup[:] = saved_up
        router.on_shutdown[:] = saved_down
        saas.invalidate()


def _token(uid, *, superadmin=False, role="admin"):
    return auth_utils.create_access_token(uid, f"{uid}@example.com", role, is_super_admin=superadmin)


def _auth(uid, *, superadmin=False, role="admin"):
    return {"Authorization": f"Bearer {_token(uid, superadmin=superadmin, role=role)}"}


def _no_foreign(text):
    for secret in SECRETS:
        assert secret not in text


def _ids_of(coll):
    return [d.get("_id") for d in coll.docs]


def _query_default_is_none(param):
    default = param.default
    if isinstance(default, QueryParam):
        return default.default is None
    return default is None


def test_route_signatures_drop_nexus_default_and_require_user():
    sync = inspect.signature(data_sync.incremental_sync)
    assert _query_default_is_none(sync.parameters["company_id"])
    assert sync.parameters["user"].default.dependency is data_sync._user_dep
    sync_src = inspect.getsource(data_sync.incremental_sync)
    assert "comp_nexus_main_01" not in sync_src
    assert "cid = tenant_access.resolve_company_id(user, company_id)" in sync_src
    assert "company_id=cid" in sync_src
    assert '"company_id": cid' in sync_src

    expense_gets = (
        expenses.list_categories,
        expenses.list_expenses,
        expenses.get_budgets,
    )
    for fn in expense_gets:
        sig = inspect.signature(fn)
        assert sig.parameters["company_id"].default is None
        assert sig.parameters["user"].default.dependency is expenses._user_dep
        src = inspect.getsource(fn)
        assert "comp_nexus_main_01" not in src
        assert "cid = tenant_access.resolve_company_id(user, company_id)" in src

    for fn in (expenses.add_category, expenses.create_expense, expenses.run_recurring, expenses.set_budgets):
        sig = inspect.signature(fn)
        assert sig.parameters["user"].default.dependency is expenses._user_dep
        src = inspect.getsource(fn)
        assert "comp_nexus_main_01" not in src
        assert 'resolve_company_id(user, req.get("company_id"))' in src

    assert "budgets_payload" in inspect.getsource(expenses.set_budgets)
    assert "add_category_for_company" in inspect.getsource(expenses.create_expense_for_company)
    assert "list_expenses_payload" in inspect.getsource(expenses.list_expenses)
    dash = inspect.getsource(server.dashboard_overview)
    assert "expenses.budgets_payload(company_id)" in dash
    assert "get_budgets" not in dash

    notes = inspect.getsource(server.list_notifications)
    assert 'sort("created_at", -1)' in notes
    assert ".to_list(80)" in notes
    assert "filter_notifications" in notes
    assert "comp_nexus_main_01" not in notes
    assert "resolve_company_id" in notes
    assert inspect.signature(server.list_notifications).parameters["user"].default.dependency is server.get_current_user

    target = inspect.getsource(server.notification_target_status)
    assert "assert_doc_company" in target
    assert "notification_visible" in target
    assert "except" not in target
    assert inspect.signature(server.notification_target_status).parameters["user"].default.dependency is server.get_current_user
    assert "data_sync.init(db, get_current_user)" in Path(server.__file__).read_text(encoding="utf-8")
    pay = inspect.getsource(employee_pay.scheduler_loop)
    assert "run_recurring_for_company" in pay
    assert "exp_mod.run_recurring(" not in pay
    assert "_current_user" in inspect.getsource(help_center.tenant_help_get)
    assert "_authenticate" in inspect.getsource(platform_v1.v1_help_get)


@pytest.mark.parametrize(
    "method,path,kwargs",
    [
        ("get", "/api/sync", {}),
        ("get", "/api/expenses/categories", {}),
        ("get", "/api/expenses", {}),
        ("get", "/api/expense-budgets", {}),
        ("post", "/api/expenses/categories", {"json": {"name": "Yeni"}}),
        ("post", "/api/expenses", {"json": {"description": "x", "amount": 10}}),
        ("post", "/api/expenses/run-recurring", {"json": {}}),
        ("put", "/api/expense-budgets", {"json": {"budgets": [{"category": "Yakıt", "monthly_limit": 1}]}}),
        ("get", "/api/notifications", {}),
        ("get", "/api/notifications/nA1/target", {}),
    ],
)
def test_no_token_is_401(api, method, path, kwargs):
    client, db = api
    before = copy.deepcopy(_ids_of(db.expenses) + _ids_of(db.expense_budgets) + _ids_of(db.expense_categories))
    response = getattr(client, method)(path, **kwargs)
    assert response.status_code == 401
    _no_foreign(response.text)
    assert _ids_of(db.expenses) + _ids_of(db.expense_budgets) + _ids_of(db.expense_categories) == before
    assert db.sync_calls == []


def test_sync_other_company_is_403_and_direct_call_reads_nothing(api):
    client, db = api
    user_a = _user("user-a", [COMP_A], COMP_A)
    response = client.get("/api/sync", params={"company_id": COMP_B, "collections": "invoices,contacts,bank_transactions"}, headers=_auth("user-a"))
    assert response.status_code == 403
    _no_foreign(response.text)
    assert db.sync_calls == []
    with pytest.raises(HTTPException) as exc:
        _run(data_sync.incremental_sync(
            company_id=COMP_B, since=None, collections="invoices,contacts,bank_transactions", limit=100, user=user_a,
        ))
    assert exc.value.status_code == 403
    assert db.sync_calls == []


def _sync_ids(body, name):
    chunk = body["collections"][name]
    return [row["id"] for row in chunk["changed"]], chunk["deleted"]


@pytest.mark.parametrize(
    "params",
    [
        {"collections": "invoices,contacts,bank_transactions"},
        {"company_id": COMP_A, "collections": "invoices,contacts,bank_transactions"},
        {"company_id": "", "collections": "invoices,contacts,bank_transactions"},
        {"company_id": COMP_A, "collections": "invoices,contacts,bank_transactions", "since": "2026-10-16T08:30:00+00:00"},
        {"company_id": COMP_A, "collections": "nope,invoices", "since": "2020-01-01T00:00:00+00:00", "limit": 1},
    ],
)
def test_sync_never_returns_another_companys_invoice_contact_or_bank(api, params):
    client, db = api
    before = len(db.sync_calls)
    response = client.get("/api/sync", params=params, headers=_auth("user-a"))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["company_id"] == COMP_A
    assert set(body) == {"company_id", "since", "server_time", "full", "collections"}
    _no_foreign(response.text)
    calls = db.sync_calls[before:]
    assert calls
    assert all(call["company_id"] == COMP_A for call in calls)
    for name, chunk in body["collections"].items():
        assert set(chunk) == {"changed", "deleted", "cursor", "more", "complete"}
        assert name in data_sync.ALLOWED
        assert "B-SECRET-GONE" not in chunk["deleted"]
        assert "NEXUS-GONE" not in chunk["deleted"]
    if "invoices" in body["collections"] and body["full"]:
        changed, deleted = _sync_ids(body, "invoices")
        assert deleted == []
        assert "invB" not in changed and "invN" not in changed
        assert "invA" in changed
        assert "SECRET-HASH" not in response.text
        row = next(item for item in body["collections"]["invoices"]["changed"] if item["id"] == "invA")
        assert "_id" not in row and "password_hash" not in row
    if params.get("since") == "2026-10-16T08:30:00+00:00":
        assert body["full"] is False
        changed, deleted = _sync_ids(body, "invoices")
        assert changed == ["invA", "invA2"]
        assert deleted == ["goneA"]
        assert _sync_ids(body, "contacts")[0] == ["cA"]
        assert _sync_ids(body, "bank_transactions")[0] == ["txA"]
    if params.get("collections") == "nope,invoices":
        assert list(body["collections"]) == ["invoices"]
        assert body["collections"]["invoices"]["more"] is True
        assert [row["id"] for row in body["collections"]["invoices"]["changed"]] == ["invA"]


def test_sync_super_admin_explicit_company_and_missing_company(api):
    client, db = api
    missing = client.get("/api/sync", params={"collections": "invoices"}, headers=_auth("user-sa", superadmin=True))
    assert missing.status_code == 400
    assert db.sync_calls == []
    _no_foreign(missing.text)

    active = client.get("/api/sync", params={"collections": "invoices"}, headers=_auth("user-sa-a", superadmin=True))
    assert active.status_code == 200, active.text
    assert active.json()["company_id"] == COMP_A
    assert [row["id"] for row in active.json()["collections"]["invoices"]["changed"]] == ["invA", "invA2"]
    _no_foreign(active.text)

    foreign = client.get(
        "/api/sync",
        params={"company_id": COMP_B, "collections": "invoices,contacts,bank_transactions"},
        headers=_auth("user-sa", superadmin=True),
    )
    assert foreign.status_code == 200, foreign.text
    body = foreign.json()
    assert body["company_id"] == COMP_B
    assert [row["id"] for row in body["collections"]["invoices"]["changed"]] == ["invB"]
    assert [row["id"] for row in body["collections"]["contacts"]["changed"]] == ["cB"]
    assert [row["id"] for row in body["collections"]["bank_transactions"]["changed"]] == ["txB"]
    assert "A-1" not in foreign.text
    assert "NEXUS-ONLY" not in foreign.text
    assert all(call["company_id"] == COMP_B for call in db.sync_calls[-3:])


def test_expense_gets_use_active_company_and_reject_other_company(api):
    client, db = api
    user_a = _user("user-a", [COMP_A], COMP_A)
    cats = client.get("/api/expenses/categories", headers=_auth("user-a"))
    assert cats.status_code == 200, cats.text
    names = [row["name"] for row in cats.json()]
    assert "Ozel A" in names
    assert "B-SECRET-CAT" not in names
    assert names[: len(expenses.DEFAULT_CATEGORIES)] == list(expenses.DEFAULT_CATEGORIES)

    listed = client.get("/api/expenses", headers=_auth("user-a"))
    assert listed.status_code == 200, listed.text
    body = listed.json()
    assert [row["id"] for row in body["expenses"]] == ["exA"]
    assert body["summary"]["count"] == 1
    assert "B-SECRET-EXP" not in listed.text
    blank = client.get("/api/expenses", params={"company_id": ""}, headers=_auth("user-a"))
    assert blank.status_code == 200
    assert [row["id"] for row in blank.json()["expenses"]] == ["exA"]

    budgets = client.get("/api/expense-budgets", params={"month": MONTH}, headers=_auth("user-a"))
    assert budgets.status_code == 200, budgets.text
    fuel = next(row for row in budgets.json()["rows"] if row["category"] == "Yakıt")
    assert fuel["monthly_limit"] == 100
    assert fuel["spent"] == 90
    assert budgets.json()["month"] == MONTH
    assert "B-SECRET" not in budgets.text

    other = client.get("/api/expenses", params={"company_id": COMP_B}, headers=_auth("user-a"))
    assert other.status_code == 403
    _no_foreign(other.text)
    with pytest.raises(HTTPException) as exc:
        _run(expenses.list_expenses(company_id=COMP_B, user=user_a))
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as budgets_exc:
        _run(expenses.get_budgets(company_id=COMP_B, user=user_a))
    assert budgets_exc.value.status_code == 403

    own = client.get("/api/expenses", params={"company_id": COMP_A, "category": "Yakıt"}, headers=_auth("user-a"))
    assert own.status_code == 200
    assert [row["id"] for row in own.json()["expenses"]] == ["exA"]
    assert any(
        q["coll"] == "expenses" and q["query"].get("company_id") == COMP_A and q["query"].get("category") == "Yakıt"
        for q in db.finds
    )


def test_expense_posts_other_company_403_writes_nothing(api):
    client, db = api
    user_a = _user("user-a", [COMP_A], COMP_A)
    before_exp = copy.deepcopy(db.expenses.docs)
    before_bud = copy.deepcopy(db.expense_budgets.docs)
    before_cat = copy.deepcopy(db.expense_categories.docs)

    created = client.post(
        "/api/expenses",
        json={"company_id": COMP_B, "description": "kacak", "amount": 40, "category": "Yakıt"},
        headers=_auth("user-a"),
    )
    assert created.status_code == 403
    _no_foreign(created.text)
    budgets = client.put(
        "/api/expense-budgets",
        json={"company_id": COMP_B, "budgets": [{"category": "Yakıt", "monthly_limit": 5}]},
        headers=_auth("user-a"),
    )
    assert budgets.status_code == 403
    category = client.post(
        "/api/expenses/categories",
        json={"company_id": COMP_B, "name": "Kacak Kat"},
        headers=_auth("user-a"),
    )
    assert category.status_code == 403
    recurring = client.post("/api/expenses/run-recurring", json={"company_id": COMP_B}, headers=_auth("user-a"))
    assert recurring.status_code == 403
    assert db.expenses.docs == before_exp
    assert db.expense_budgets.docs == before_bud
    assert db.expense_categories.docs == before_cat

    with pytest.raises(HTTPException) as exc:
        _run(expenses.create_expense({"company_id": COMP_B, "description": "kacak", "amount": 40}, user_a))
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as bud_exc:
        _run(expenses.set_budgets({"company_id": COMP_B, "budgets": [{"category": "Kira", "monthly_limit": 9}]}, user_a))
    assert bud_exc.value.status_code == 403
    assert db.expenses.docs == before_exp
    assert db.expense_budgets.docs == before_bud


def test_expense_posts_use_active_company_and_super_admin_explicit_company(api):
    client, db = api
    created = client.post(
        "/api/expenses",
        json={"description": "Aktif masraf", "amount": 12, "vat_rate": 0, "category": "Yakıt", "date": f"{MONTH}-16"},
        headers=_auth("user-a"),
    )
    assert created.status_code == 200, created.text
    body = created.json()
    assert body["company_id"] == COMP_A
    assert body["description"] == "Aktif masraf"
    stored = next(doc for doc in db.expenses.docs if doc.get("_id") == body["id"])
    assert stored["company_id"] == COMP_A
    assert all(doc.get("company_id") != COMP_B or doc["_id"] in ("exB", "recB") for doc in db.expenses.docs)

    named = client.post(
        "/api/expenses/categories",
        json={"name": "Saha"},
        headers=_auth("user-a"),
    )
    assert named.status_code == 200, named.text
    assert named.json() == {"name": "Saha"}
    assert any(doc.get("company_id") == COMP_A and doc.get("name") == "Saha" for doc in db.expense_categories.docs)
    assert not any(doc.get("name") == "Saha" and doc.get("company_id") != COMP_A for doc in db.expense_categories.docs)

    updated = client.put(
        "/api/expense-budgets",
        json={"budgets": [{"category": "Yemek", "monthly_limit": 80}]},
        headers=_auth("user-a"),
    )
    assert updated.status_code == 200, updated.text
    row = next(item for item in updated.json()["rows"] if item["category"] == "Yemek")
    assert row["monthly_limit"] == 80
    assert any(doc.get("company_id") == COMP_A and doc.get("category") == "Yemek" and doc.get("monthly_limit") == 80 for doc in db.expense_budgets.docs)
    assert not any(doc.get("company_id") == COMP_B and doc.get("category") == "Yemek" for doc in db.expense_budgets.docs)

    recurring = client.post("/api/expenses/run-recurring", json={}, headers=_auth("user-a"))
    assert recurring.status_code == 200, recurring.text
    assert "B-SECRET-REC" not in recurring.text
    assert not any(doc.get("company_id") == COMP_B and doc.get("recurring_parent_id") == "recB" for doc in db.expenses.docs)

    foreign = client.post(
        "/api/expenses",
        json={"company_id": COMP_B, "description": "Super masraf", "amount": 15, "vat_rate": 0, "date": f"{MONTH}-16"},
        headers=_auth("user-sa", superadmin=True),
    )
    assert foreign.status_code == 200, foreign.text
    assert foreign.json()["company_id"] == COMP_B
    assert any(doc.get("_id") == foreign.json()["id"] and doc.get("company_id") == COMP_B for doc in db.expenses.docs)

    missing = client.post(
        "/api/expenses",
        json={"description": "sirketsiz", "amount": 5},
        headers=_auth("user-sa", superadmin=True),
    )
    assert missing.status_code == 400


def test_dashboard_budget_warnings_come_from_budgets_payload(api):
    _client, db = api
    overview = _run(server.dashboard_overview(company_id=COMP_A))
    payload = _run(expenses.budgets_payload(COMP_A))
    assert overview["budget_warnings"] == payload["warnings"]
    assert overview["budget_warnings"]
    assert all(row["category"] != "B-SECRET-CAT" for row in overview["budget_warnings"])
    fuel = next(row for row in overview["budget_warnings"] if row["category"] == "Yakıt")
    assert fuel["spent"] == 90
    assert fuel["monthly_limit"] == 100
    b_queries = [q for q in db.finds if q["coll"] in ("expense_budgets", "expenses", "expense_categories")]
    assert b_queries
    assert all((q["query"] or {}).get("company_id") in (None, COMP_A) for q in b_queries)


def test_notifications_company_scope_filter_and_target(api):
    client, db = api
    user_a = _user("user-a", [COMP_A], COMP_A)
    user_staff = _user("user-staff", [COMP_A], COMP_A, role="personel", employee_id="empA")
    listed = client.get("/api/notifications", headers=_auth("user-a"))
    assert listed.status_code == 200, listed.text
    ids = [row["id"] for row in listed.json()]
    assert ids == ["nA1", "nAstaff", "nA0"]
    _no_foreign(listed.text)
    assert any(
        q["coll"] == "notifications" and q["query"].get("company_id") == COMP_A and q["query"].get("is_read") is not False
        for q in db.finds
    )

    unread = client.get("/api/notifications", params={"unread_only": True}, headers=_auth("user-a"))
    assert unread.status_code == 200
    assert [row["id"] for row in unread.json()] == ["nA1", "nAstaff"]

    other = client.get("/api/notifications", params={"company_id": COMP_B}, headers=_auth("user-a"))
    assert other.status_code == 403
    _no_foreign(other.text)
    with pytest.raises(HTTPException) as exc:
        _run(server.list_notifications(company_id=COMP_B, user=user_a))
    assert exc.value.status_code == 403

    own_target = client.get("/api/notifications/nA1/target", headers=_auth("user-a"))
    assert own_target.status_code == 200, own_target.text
    assert own_target.json()["exists"] is True

    hidden = client.get("/api/notifications/nAstaff/target", headers=_auth("user-staff", role="personel"))
    assert hidden.status_code == 403
    assert hidden.json()["detail"] == "Bu bildirimi açamazsınız."

    foreign_target = client.get("/api/notifications/nB/target", headers=_auth("user-a"))
    assert foreign_target.status_code == 404
    _no_foreign(foreign_target.text)
    missing = client.get("/api/notifications/yok/target", headers=_auth("user-a"))
    assert missing.status_code == 404
    with pytest.raises(HTTPException) as missing_exc:
        _run(server.notification_target_status("nB", user_a))
    assert missing_exc.value.status_code == 404
    with pytest.raises(HTTPException) as staff_exc:
        _run(server.notification_target_status("nAstaff", user_staff))
    assert staff_exc.value.status_code == 403

    staff_list = client.get("/api/notifications", headers=_auth("user-staff", role="personel"))
    assert staff_list.status_code == 200
    assert "nAstaff" not in [row["id"] for row in staff_list.json()]
    assert "nA1" in [row["id"] for row in staff_list.json()]

    super_list = client.get("/api/notifications", params={"company_id": COMP_B}, headers=_auth("user-sa", superadmin=True))
    assert super_list.status_code == 200, super_list.text
    assert [row["id"] for row in super_list.json()] == ["nB"]
    super_target = client.get("/api/notifications/nB/target", headers=_auth("user-sa", superadmin=True))
    assert super_target.status_code == 200, super_target.text
    bare = client.get("/api/notifications", headers=_auth("user-sa", superadmin=True))
    assert bare.status_code == 400
