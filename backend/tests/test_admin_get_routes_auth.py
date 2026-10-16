"""Admin/system GET routes: route-level auth and company resolution.

In-process TestClient and a memory database. No live server and no port 8021.
BizimHesap warehouse HTTP is mocked; tokens stay masked.
"""
from __future__ import annotations

import asyncio
import copy
import inspect
import logging
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-admin-get-routes-auth-jwt-secret-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import addons  # noqa: E402
import auth_utils  # noqa: E402
import migration  # noqa: E402
import mobile_logs  # noqa: E402
import rbac  # noqa: E402
import saas  # noqa: E402
import server  # noqa: E402
import support_tickets  # noqa: E402
import trash  # noqa: E402
from mysql_store import match_query, new_upsert_doc, sort_docs  # noqa: E402

_CMP_OPS = ("$gt", "$gte", "$lt", "$lte")

COMP_A = "A"
COMP_B = "B"
NEXUS = "comp_nexus_main_01"
BH_SECRET = "bh-plain-token-9f3a"
WA_SECRET = "wa-plain-token-9f3a"
WA_SECRET_B = "wa-plain-token-b-77"
FUTURE = "2099-01-01T00:00:00+00:00"
PAST = "2000-01-01T00:00:00+00:00"
ADDON_HTTP = "Destek aracı kapalı: Destek talepleri. Platform yönetiminden açabilirsiniz."
ADDON_ROUTE = "Destek aracı kapalı: Destek talepleri."
DENY = "Bu şirket hesabına erişiminiz yok."


def _and_cmp(query):
    """Mongo ANDs every operator on a field. The in-memory matcher returns on the first."""
    if not isinstance(query, dict):
        return query
    out = {}
    extra = []
    for key, cond in query.items():
        if key in ("$and", "$or", "$nor") and isinstance(cond, list):
            out[key] = [_and_cmp(item) for item in cond]
            continue
        if isinstance(cond, dict) and sum(op in cond for op in _CMP_OPS) > 1:
            for op in _CMP_OPS:
                if op in cond:
                    extra.append({key: {op: cond[op]}})
            rest = {k: v for k, v in cond.items() if k not in _CMP_OPS}
            if rest:
                extra.append({key: rest})
            continue
        out[key] = cond
    if not extra:
        return out
    parts = ([out] if out else []) + extra
    return parts[0] if len(parts) == 1 else {"$and": parts}


def _docs_match(doc, query):
    return match_query(doc, _and_cmp(query or {}))


def _run(coro):
    return asyncio.run(coro)


class MemCursor:
    def __init__(self, docs):
        self._docs = docs
        self._sort = None

    def sort(self, key, direction=1):
        self._sort = [(key, direction)] if isinstance(key, str) else list(key)
        return self

    def limit(self, n):
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

    def _note(self, op):
        self.db.writes.append({"coll": self.name, "op": op})

    def find(self, query=None, projection=None):
        matched = [d for d in self.docs if _docs_match(d, query)]
        return MemCursor(matched)

    async def find_one(self, query=None, projection=None):
        for doc in self.docs:
            if _docs_match(doc, query):
                return copy.deepcopy(doc)
        return None

    async def count_documents(self, query=None):
        return sum(1 for doc in self.docs if _docs_match(doc, query))

    async def insert_one(self, doc):
        self._note("insert_one")
        self.docs.append(copy.deepcopy(doc))
        return SimpleNamespace(inserted_id=doc.get("_id"))

    async def insert_many(self, docs):
        self._note("insert_many")
        self.docs.extend(copy.deepcopy(list(docs)))
        return SimpleNamespace(inserted_ids=[d.get("_id") for d in docs])

    async def update_one(self, query, update, upsert=False):
        self._note("update_one")
        from mysql_store import apply_update

        for i, doc in enumerate(self.docs):
            if _docs_match(doc, query):
                self.docs[i] = apply_update(doc, update, query)
                return SimpleNamespace(modified_count=1, matched_count=1)
        if upsert:
            self.docs.append(new_upsert_doc(update, query))
            return SimpleNamespace(modified_count=0, matched_count=0, upserted_id=self.docs[-1].get("_id"))
        return SimpleNamespace(modified_count=0, matched_count=0)

    async def find_one_and_update(self, query, update, upsert=False, return_document=True):
        self._note("find_one_and_update")
        from mysql_store import apply_update

        for i, doc in enumerate(self.docs):
            if _docs_match(doc, query):
                before = copy.deepcopy(doc)
                self.docs[i] = apply_update(doc, update, query)
                return copy.deepcopy(self.docs[i] if return_document else before)
        if upsert:
            self.docs.append(new_upsert_doc(update, query))
            return copy.deepcopy(self.docs[-1])
        return None

    async def delete_one(self, query):
        self._note("delete_one")
        for i, doc in enumerate(self.docs):
            if _docs_match(doc, query):
                self.docs.pop(i)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def delete_many(self, query):
        self._note("delete_many")
        kept, deleted = [], 0
        for doc in self.docs:
            if _docs_match(doc, query):
                deleted += 1
            else:
                kept.append(doc)
        self.docs[:] = kept
        return SimpleNamespace(deleted_count=deleted)

    async def create_index(self, *args, **kwargs):
        return None


class MemDB:
    def __init__(self):
        self._cols = {}
        self.writes = []

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


def _user(uid, company_ids, active, *, role="admin", superadmin=False, name=None):
    return {
        "_id": uid,
        "id": uid,
        "email": f"{uid}@example.com",
        "name": name or uid,
        "role": role,
        "is_active": True,
        "is_super_admin": superadmin,
        "company_ids": list(company_ids),
        "active_company_id": active,
        "user_number": f"U-{uid}",
    }


def _user_a():
    return _user("user-a", [COMP_A], COMP_A, name="Ali A")


def _user_b():
    return _user("user-b", [COMP_B], COMP_B, name="B-SECRET")


def _routes():
    return [
        (rbac.list_roles, rbac._user_dep, "/api/roles", {}),
        (rbac.list_users, rbac._user_dep, "/api/users", {}),
        (rbac.activity_logs, rbac._user_dep, "/api/activity-logs", {}),
        (saas.my_license, saas._user_dep, "/api/license/me", {}),
        (saas.license_companies, saas._user_dep, "/api/license/companies", {}),
        (migration.migration_batches, migration._user_dep, "/api/migration/batches", {}),
        (migration.bh_get_config, migration._user_dep, "/api/migration/bizimhesap/config", {}),
        (migration.bh_warehouses, migration._user_dep, "/api/migration/bizimhesap/warehouses", {}),
        (support_tickets.list_mine, support_tickets._user, "/api/support/tickets", {}),
        (trash.list_trash, trash._user_dep, "/api/trash", {}),
        (mobile_logs.list_mobile_logs, mobile_logs._user_dep, "/api/mobile/logs", {}),
        (server.whatsapp_logs, server.get_current_user, "/api/comm/whatsapp/logs", {}),
        (server.comm_history, server.get_current_user, "/api/comm/history", {}),
        (server.get_wa_settings, server.get_current_user, "/api/comm/whatsapp/settings", {}),
    ]


def _seed(db):
    import comm_service

    db.companies.docs.extend([
        {"_id": COMP_A, "name": "Firma A", "tax_number": "1111111111", "city": "İstanbul", "cash_dual_approval": True},
        {"_id": COMP_B, "name": "B-SECRET", "tax_number": "2222222222", "city": "Ankara", "cash_dual_approval": False},
        {"_id": NEXUS, "name": "NEXUS-ONLY", "tax_number": "3333333333"},
    ])
    db.company_licenses.docs.append({
        "_id": COMP_B,
        "status": "active",
        "addon_overrides": {"support.tickets": False},
    })
    db.saas_plans.docs.append({
        "_id": "plan_starter",
        "code": "starter",
        "name": "Başlangıç",
        "modules": ["/invoices", "/support", "/communication"],
        "is_public": True,
        "sort": 1,
        "color": "slate",
        "price_monthly": 499,
        "price_yearly": 4990,
        "user_limit": 2,
        "company_limit": 1,
        "product_limit": 10,
        "contact_limit": 10,
        "storage_limit_mb": 100,
    })
    db.upgrade_requests.docs.extend([
        {"_id": "upA", "company_id": COMP_A, "status": "pending", "plan_name": "Pro A"},
        {"_id": "upB", "company_id": COMP_B, "status": "pending", "plan_name": "B-SECRET-PLAN"},
    ])
    db.user_invites.docs.extend([
        {"_id": "invA", "company_id": COMP_A, "email": "invite-a@example.com", "role": "sales", "accepted_at": None, "created_at": "2026-10-02T00:00:00+00:00", "employee_id": "empA"},
        {"_id": "invB", "company_id": COMP_B, "email": "invite-b@example.com", "role": "sales", "accepted_at": None, "created_at": "2026-10-02T00:00:00+00:00", "name": "B-SECRET-INVITE"},
    ])
    db.employees.docs.append({"_id": "empA", "full_name": "Ali Veli", "company_id": COMP_A})
    db.activity_logs.docs.extend([
        {"_id": "logA2", "company_id": COMP_A, "user_id": "user-a", "module": "/settings", "method": "GET", "path": "/api/roles", "created_at": "2026-10-02T10:00:00+00:00"},
        {"_id": "logA1", "company_id": COMP_A, "user_id": "user-x", "module": "/invoices", "method": "POST", "path": "/api/invoices", "created_at": "2026-10-01T10:00:00+00:00"},
        {"_id": "logB", "company_id": COMP_B, "user_id": "user-b", "module": "/settings", "method": "GET", "path": "/api/users", "detail": "B-SECRET-LOG", "created_at": "2026-10-03T10:00:00+00:00"},
        {"_id": "logN", "company_id": NEXUS, "user_id": "user-n", "module": "/settings", "detail": "NEXUS-ONLY", "created_at": "2026-10-04T10:00:00+00:00"},
    ])
    db.migration_batches.docs.extend([
        {"_id": "batchA", "company_id": COMP_A, "entity": "contacts", "entity_label": "Cariler", "source": "excel", "filename": "a.xlsx", "inserted_ids": ["1"], "updated": [], "skipped": 0, "failed": 0, "errors": [], "status": "done", "created_at": "2026-10-02T00:00:00+00:00"},
        {"_id": "batchB", "company_id": COMP_B, "entity": "contacts", "entity_label": "Cariler", "source": "excel", "filename": "B-SECRET.xlsx", "inserted_ids": [], "updated": [{"id": "x"}], "skipped": 1, "failed": 0, "errors": [{}], "status": "done", "created_at": "2026-10-03T00:00:00+00:00"},
    ])
    db.migration_api_configs.docs.append({
        "_id": "bhA",
        "company_id": COMP_A,
        "provider": "bizimhesap",
        "firm_id": "FIRM-A",
        "token_enc": comm_service.encrypt(BH_SECRET),
        "token_tail": BH_SECRET[-4:],
        "last_test": {"at": "2026-10-01T00:00:00+00:00", "product_count": 1},
        "last_import": None,
        "last_customer_import": None,
    })
    db.support_tickets.docs.extend([
        {
            "_id": "tA-new", "company_id": COMP_A, "number": "DST-2026-0002", "subject": "Açık talep",
            "category": "teknik", "priority": "normal", "status": "open",
            "messages": [{"id": "m1", "body": "merhaba", "is_internal": False}, {"id": "m2", "body": "gizli", "is_internal": True}],
            "updated_at": "2026-10-03T00:00:00+00:00", "created_at": "2026-10-03T00:00:00+00:00",
        },
        {
            "_id": "tA-old", "company_id": COMP_A, "number": "DST-2026-0001", "subject": "Kapalı talep",
            "category": "diger", "priority": "low", "status": "closed",
            "messages": [{"id": "m3", "body": "eski", "is_internal": False}],
            "updated_at": "2026-10-01T00:00:00+00:00", "created_at": "2026-10-01T00:00:00+00:00",
        },
        {
            "_id": "tB", "company_id": COMP_B, "number": "DST-2026-0009", "subject": "B-SECRET-TICKET",
            "category": "teknik", "priority": "high", "status": "open",
            "messages": [{"id": "mb", "body": "B-SECRET-TICKET", "is_internal": False}],
            "updated_at": "2026-10-04T00:00:00+00:00", "created_at": "2026-10-04T00:00:00+00:00",
        },
    ])
    db.trash.docs.extend([
        {"_id": "trA2", "company_id": COMP_A, "entity_type": "product", "label": "Ürün A", "collection": "products", "doc": {"_id": "pA", "name": "Ürün A", "sku": "SKU-A"}, "related": [], "note": "", "deleted_at": "2026-10-02T00:00:00+00:00", "expires_at": FUTURE},
        {"_id": "trA1", "company_id": COMP_A, "entity_type": "contact", "label": "Cari A", "collection": "contacts", "doc": {"_id": "cA", "name": "Cari A"}, "related": [], "note": "", "deleted_at": "2026-10-01T00:00:00+00:00", "expires_at": FUTURE},
        {"_id": "trAexp", "company_id": COMP_A, "entity_type": "contact", "label": "Eski A", "collection": "contacts", "doc": {"_id": "cOld"}, "related": [], "note": "", "deleted_at": "2020-01-01T00:00:00+00:00", "expires_at": PAST},
        {"_id": "trB", "company_id": COMP_B, "entity_type": "contact", "label": "B-SECRET-TRASH", "collection": "contacts", "doc": {"_id": "cB", "name": "B-SECRET-TRASH"}, "related": [], "note": "", "deleted_at": "2026-10-03T00:00:00+00:00", "expires_at": FUTURE},
    ])
    db.mobile_client_logs.docs.extend([
        {"_id": "mA2", "company_id": COMP_A, "source": "web", "level": "ERROR", "message": "panel patladı", "screen": "Trash", "user_email": "a@example.com", "path": "/trash", "created_at": "2026-10-02T00:00:00+00:00", "expires_at": FUTURE},
        {"_id": "mA1", "company_id": COMP_A, "source": "mobile", "level": "INFO", "message": "açıldı", "screen": "Home", "user_email": "a@example.com", "path": "/", "created_at": "2026-10-01T00:00:00+00:00", "expires_at": FUTURE},
        {"_id": "mB", "company_id": COMP_B, "source": "mobile", "level": "ERROR", "message": "B-SECRET-MLOG", "screen": "Home", "user_email": "b@example.com", "path": "/", "created_at": "2026-10-03T00:00:00+00:00", "expires_at": FUTURE},
    ])
    db.whatsapp_logs.docs.extend([
        {"_id": "waA2", "company_id": COMP_A, "contact_id": "ctA", "message": "merhaba", "created_at": "2026-10-02T00:00:00+00:00"},
        {"_id": "waA1", "company_id": COMP_A, "contact_id": "ctX", "message": "eski", "created_at": "2026-10-01T00:00:00+00:00"},
        {"_id": "waB", "company_id": COMP_B, "contact_id": "ctB", "message": "B-SECRET-WA", "created_at": "2026-10-03T00:00:00+00:00"},
    ])
    db.sms_logs.docs.extend([
        {"_id": "smsA", "company_id": COMP_A, "contact_id": "ctA", "ref_id": "refA", "message": "sms-a", "created_at": "2026-10-01T00:00:00+00:00"},
        {"_id": "smsB", "company_id": COMP_B, "contact_id": "ctB", "ref_id": "refB", "message": "B-SECRET-SMS", "created_at": "2026-10-03T00:00:00+00:00"},
    ])
    db.mail_logs.docs.extend([
        {"_id": "mailA", "company_id": COMP_A, "contact_id": "ctA", "ref_id": "refA", "subject": "mail-a", "created_at": "2026-10-02T00:00:00+00:00"},
        {"_id": "mailB", "company_id": COMP_B, "contact_id": "ctB", "ref_id": "refB", "subject": "B-SECRET-MAIL", "created_at": "2026-10-04T00:00:00+00:00"},
    ])
    db.whatsapp_settings.docs.extend([
        {"_id": "setA", "company_id": COMP_A, "phone_number_id": "pnA", "verify_token": "verify-a", "access_token_enc": comm_service.encrypt(WA_SECRET)},
        {"_id": "setB", "company_id": COMP_B, "phone_number_id": "pnB-SECRET", "verify_token": "verify-b", "access_token_enc": comm_service.encrypt(WA_SECRET_B)},
    ])


def _no_foreign(text):
    assert "B-SECRET" not in text
    assert "NEXUS-ONLY" not in text
    assert BH_SECRET not in text
    assert WA_SECRET not in text
    assert WA_SECRET_B not in text


def _snapshot(db):
    return {name: copy.deepcopy(coll.docs) for name, coll in db._cols.items()}


def _bind(db):
    prev = (
        server.db, rbac._db, saas._db, addons._db, migration._db, trash._db,
        support_tickets._db, mobile_logs._db,
    )
    prev_user = (
        rbac._current_user, saas._current_user, migration._current_user, trash._current_user,
        support_tickets._current_user, mobile_logs._current_user,
    )
    server.db = db
    rbac._db = db
    saas._db = db
    addons._db = db
    migration._db = db
    trash._db = db
    support_tickets._db = db
    mobile_logs._db = db
    rbac._current_user = server.get_current_user
    saas._current_user = server.get_current_user
    migration._current_user = server.get_current_user
    trash._current_user = server.get_current_user
    support_tickets._current_user = server.get_current_user
    mobile_logs._current_user = server.get_current_user
    return prev, prev_user


def _unbind(prev, prev_user):
    (
        server.db, rbac._db, saas._db, addons._db, migration._db, trash._db,
        support_tickets._db, mobile_logs._db,
    ) = prev
    (
        rbac._current_user, saas._current_user, migration._current_user, trash._current_user,
        support_tickets._current_user, mobile_logs._current_user,
    ) = prev_user


@pytest.fixture
def api():
    db = MemDB()
    db.users.docs.extend([
        _user("user-a", [COMP_A], COMP_A, name="Ali A"),
        _user("user-b", [COMP_B], COMP_B, name="B-SECRET"),
        _user("user-sa", [], "", superadmin=True, name="Süper"),
        _user("user-sa-a", [COMP_A], COMP_A, superadmin=True, name="Süper A"),
    ])
    _seed(db)
    prev, prev_user = _bind(db)
    saas.invalidate()
    for cid in (COMP_A, COMP_B, NEXUS):
        _run(rbac.ensure_roles(cid))
        _run(rbac.ensure_roles(cid))
    calls = []

    async def _fake_bh_get(path, token, firm_id="", timeout=40.0):
        calls.append({"path": path, "firm_id": firm_id})
        return {"warehouses": [{"id": "whA", "name": "Depo A"}]}

    router = server.app.router
    saved_up = list(router.on_startup)
    saved_down = list(router.on_shutdown)
    router.on_startup.clear()
    router.on_shutdown.clear()
    client = TestClient(server.app)
    entered = False
    try:
        with patch("migration._bh_get", _fake_bh_get):
            client.__enter__()
            entered = True
            yield client, db, calls
    finally:
        if entered:
            client.__exit__(None, None, None)
        _unbind(prev, prev_user)
        router.on_startup[:] = saved_up
        router.on_shutdown[:] = saved_down
        saas.invalidate()


def _token(uid, *, superadmin=False):
    return auth_utils.create_access_token(uid, f"{uid}@example.com", "admin", is_super_admin=superadmin)


def _auth(uid, *, superadmin=False):
    return {"Authorization": f"Bearer {_token(uid, superadmin=superadmin)}"}


def test_route_signatures_have_auth_and_no_nexus_default():
    routes = _routes()
    assert len(routes) == 14
    for fn, dep, _path, _extra in routes:
        sig = inspect.signature(fn)
        assert sig.parameters["company_id"].default is None
        assert sig.parameters["user"].default.dependency is dep
        src = inspect.getsource(fn)
        assert "comp_nexus_main_01" not in src
        assert "resolve_company_id" in src
    assert "request" not in inspect.signature(saas.my_license).parameters
    assert "request" not in inspect.signature(saas.license_companies).parameters
    assert "request" not in inspect.signature(support_tickets.list_mine).parameters
    assert "request" not in inspect.signature(mobile_logs.list_mobile_logs).parameters
    assert list(inspect.signature(migration._bh_config_payload).parameters) == ["company_id"]
    assert list(inspect.signature(server._wa_settings_payload).parameters) == ["company_id"]
    migration_text = Path(migration.__file__).read_text(encoding="utf-8")
    server_text = Path(server.__file__).read_text(encoding="utf-8")
    assert "await bh_get_config(" not in migration_text
    assert migration_text.count("_bh_config_payload(") >= 2
    assert "await get_wa_settings(" not in server_text
    assert server_text.count("_wa_settings_payload(") >= 2
    assert 'req.get("company_id", "comp_nexus_main_01")' in inspect.getsource(migration.bh_put_config)
    assert 'req.get("company_id", "comp_nexus_main_01")' in inspect.getsource(server.save_wa_settings)
    assert "PermissionAndAuditMiddleware" in Path(rbac.__file__).read_text(encoding="utf-8")


def test_background_loops_do_not_call_these_routes():
    names = [fn.__name__ for fn, _dep, _path, _extra in _routes()]
    blobs = []
    for mod in (server, migration, trash, mobile_logs, support_tickets, saas, rbac):
        for name, obj in vars(mod).items():
            if not callable(obj):
                continue
            if "loop" not in name and not name.endswith("_tick"):
                continue
            try:
                blobs.append(inspect.getsource(obj))
            except (OSError, TypeError):
                continue
    text = "\n".join(blobs)
    for name in names:
        assert f"{name}(" not in text


def test_no_token_is_401(api):
    client, db, calls = api
    before = _snapshot(db)
    for _fn, _dep, path, extra in _routes():
        response = client.get(path, params=extra or None)
        assert response.status_code == 401, (path, response.text)
        assert response.json()["detail"] == "Giriş yapmanız gerekiyor."
        _no_foreign(response.text)
    assert _snapshot(db) == before
    assert calls == []


def test_other_company_is_403_and_returns_nothing(api):
    client, db, calls = api
    before = _snapshot(db)
    headers = _auth("user-a")
    for _fn, _dep, path, extra in _routes():
        response = client.get(path, params={"company_id": COMP_B, **extra}, headers=headers)
        assert response.status_code == 403, (path, response.text)
        assert response.json()["detail"] == DENY
        _no_foreign(response.text)
    assert _snapshot(db) == before
    assert calls == []


def test_direct_call_other_company_is_403_without_middleware(api):
    _client, db, calls = api
    user_a = _user_a()
    before = _snapshot(db)
    for fn, _dep, path, extra in _routes():
        with pytest.raises(HTTPException) as exc:
            _run(fn(company_id=COMP_B, user=user_a, **extra))
        assert exc.value.status_code == 403, path
        assert exc.value.detail == DENY
    assert _snapshot(db) == before
    assert calls == []


def test_missing_company_id_uses_active_company_only(api):
    client, db, _calls = api
    headers = _auth("user-a")
    user_a = _user_a()
    for fn, _dep, path, extra in _routes():
        response = client.get(path, params=extra or None, headers=headers)
        assert response.status_code == 200, (path, response.text)
        _no_foreign(response.text)
        direct = _run(fn(company_id=None, user=user_a, **extra))
        assert response.json() == direct
    blank = client.get("/api/activity-logs", params={"company_id": ""}, headers=headers)
    assert blank.status_code == 200
    assert [row["id"] for row in blank.json()] == ["logA2", "logA1"]
    _no_foreign(blank.text)
    assert _run(rbac.activity_logs(company_id="", user=user_a)) == blank.json()


def test_happy_path_matches_legacy_shape(api):
    client, db, calls = api
    headers = _auth("user-a")
    user_a = _user_a()

    roles = client.get("/api/roles", params={"company_id": COMP_A}, headers=headers)
    assert roles.status_code == 200, roles.text
    body = roles.json()
    assert body == _run(rbac.list_roles(company_id=COMP_A, user=user_a))
    assert body["policies"] == {"cash_dual_approval": True}
    assert body["modules"]
    assert body["levels"]
    assert {row["code"] for row in body["roles"]} >= {"admin", "personel"}
    assert all(row["company_id"] == COMP_A for row in body["roles"])
    admin = next(row for row in body["roles"] if row["code"] == "admin")
    assert admin["user_count"] == 1
    _no_foreign(roles.text)

    users = client.get("/api/users", params={"company_id": COMP_A}, headers=headers)
    assert users.status_code == 200, users.text
    assert users.json() == _run(rbac.list_users(company_id=COMP_A, user=user_a))
    listed = users.json()["users"]
    assert [row["email"] for row in listed] == ["user-a@example.com"]
    assert listed[0]["role_name"] == "Yönetici"
    assert listed[0]["company_ids"] == [COMP_A]
    assert "password_hash" not in listed[0]
    invite = users.json()["invites"][0]
    assert invite["email"] == "invite-a@example.com"
    assert invite["employee_name"] == "Ali Veli"
    assert users.json()["assignable_companies"] == [{"id": COMP_A, "name": "Firma A", "tax_number": "1111111111"}]
    _no_foreign(users.text)

    logs = client.get("/api/activity-logs", params={"company_id": COMP_A}, headers=headers)
    assert logs.status_code == 200, logs.text
    assert [row["id"] for row in logs.json()] == ["logA2", "logA1"]
    assert logs.json() == _run(rbac.activity_logs(company_id=COMP_A, user=user_a))
    filtered = client.get("/api/activity-logs", params={"company_id": COMP_A, "user_id": "user-a", "module": "/settings", "limit": 1}, headers=headers)
    assert [row["id"] for row in filtered.json()] == ["logA2"]
    assert filtered.json() == _run(rbac.activity_logs(company_id=COMP_A, user_id="user-a", module="/settings", limit=1, user=user_a))
    _no_foreign(logs.text)

    license_me = client.get("/api/license/me", params={"company_id": COMP_A}, headers=headers)
    assert license_me.status_code == 200, license_me.text
    lic = license_me.json()
    assert lic == _run(saas.my_license(company_id=COMP_A, user=user_a))
    for key in (
        "company_id", "license_id", "plan_id", "plan_name", "status", "status_label", "locked",
        "modules", "addons", "catalog", "plans", "users", "companies", "pending_request",
        "user_limit", "company_limit", "company_count", "days_left", "expires_at",
        "product_count", "contact_count", "storage_bytes", "company_ids",
    ):
        assert key in lic
    assert lic["company_id"] == COMP_A
    assert lic["license_id"] == COMP_A
    assert lic["status"] == "active"
    assert lic["locked"] is False
    assert lic["users"] == 1
    assert lic["company_count"] == 1
    assert [row["id"] for row in lic["companies"]] == [COMP_A]
    assert lic["companies"][0]["name"] == "Firma A"
    assert lic["companies"][0]["primary"] is True
    assert lic["pending_request"]["id"] == "upA"
    assert lic["pending_request"]["plan_name"] == "Pro A"
    assert [row["id"] for row in lic["plans"]] == ["plan_starter"]
    assert lic["plans"][0]["modules"] == ["/invoices", "/support", "/communication"]
    assert isinstance(lic["catalog"], list) and lic["catalog"]
    assert lic["modules"]["/"] is True
    _no_foreign(license_me.text)
    cookie = client.get("/api/license/me", params={"company_id": COMP_A}, cookies={"access_token": _token("user-a")})
    assert cookie.status_code == 200, cookie.text
    assert cookie.request.headers.get("authorization") is None
    assert cookie.json() == lic

    companies = client.get("/api/license/companies", params={"company_id": COMP_A}, headers=headers)
    assert companies.status_code == 200, companies.text
    assert companies.json() == _run(saas.license_companies(company_id=COMP_A, user=user_a))
    assert companies.json()["license_id"] == COMP_A
    assert companies.json()["company_count"] == 1
    assert [row["id"] for row in companies.json()["companies"]] == [COMP_A]
    _no_foreign(companies.text)

    batches = client.get("/api/migration/batches", params={"company_id": COMP_A}, headers=headers)
    assert batches.status_code == 200, batches.text
    assert batches.json() == _run(migration.migration_batches(company_id=COMP_A, user=user_a))
    assert batches.json() == [{
        "id": "batchA", "entity": "contacts", "entity_label": "Cariler", "source": "excel", "filename": "a.xlsx",
        "inserted": 1, "updated": 0, "skipped": 0, "failed": 0, "status": "done",
        "created_at": "2026-10-02T00:00:00+00:00", "rolled_back_at": None, "error_count": 0,
    }]
    _no_foreign(batches.text)

    config = client.get("/api/migration/bizimhesap/config", params={"company_id": COMP_A}, headers=headers)
    assert config.status_code == 200, config.text
    assert config.json() == _run(migration.bh_get_config(company_id=COMP_A, user=user_a))
    assert config.json() == _run(migration._bh_config_payload(COMP_A))
    assert config.json()["configured"] is True
    assert config.json()["firm_id"] == "FIRM-A"
    assert config.json()["token_mask"] == "••••" + BH_SECRET[-4:]
    assert "token_enc" not in config.json()
    assert BH_SECRET not in config.text
    _no_foreign(config.text)

    warehouses = client.get("/api/migration/bizimhesap/warehouses", params={"company_id": COMP_A}, headers=headers)
    assert warehouses.status_code == 200, warehouses.text
    assert warehouses.json() == {"warehouses": [{"id": "whA", "name": "Depo A"}], "count": 1}
    assert warehouses.json() == _run(migration.bh_warehouses(company_id=COMP_A, user=user_a))
    assert calls and all(item["path"] == "/warehouses" and item["firm_id"] == "FIRM-A" for item in calls)
    assert BH_SECRET not in warehouses.text

    tickets = client.get("/api/support/tickets", params={"company_id": COMP_A}, headers=headers)
    assert tickets.status_code == 200, tickets.text
    assert tickets.json() == _run(support_tickets.list_mine(company_id=COMP_A, user=user_a))
    assert [row["id"] for row in tickets.json()] == ["tA-new", "tA-old"]
    assert tickets.json()[0]["status_label"] == "Açık"
    assert tickets.json()[0]["message_count"] == 1
    assert "messages" not in tickets.json()[0]
    opened = client.get("/api/support/tickets", params={"company_id": COMP_A, "status": "open"}, headers=headers)
    assert [row["id"] for row in opened.json()] == ["tA-new"]
    assert opened.json() == _run(support_tickets.list_mine(company_id=COMP_A, status="open", user=user_a))
    _no_foreign(tickets.text)

    bin_ = client.get("/api/trash", params={"company_id": COMP_A}, headers=headers)
    assert bin_.status_code == 200, bin_.text
    assert bin_.json() == _run(trash.list_trash(company_id=COMP_A, user=user_a))
    assert [row["id"] for row in bin_.json()["items"]] == ["trA2", "trA1"]
    assert bin_.json()["total"] == 2
    assert bin_.json()["retention_days"] == 30
    assert "trAexp" not in str(bin_.json())
    typed = client.get("/api/trash", params={"company_id": COMP_A, "entity_type": "contact", "q": "cari"}, headers=headers)
    assert [row["id"] for row in typed.json()["items"]] == ["trA1"]
    assert typed.json()["total"] == 2
    assert typed.json() == _run(trash.list_trash(company_id=COMP_A, entity_type="contact", q="cari", user=user_a))
    _no_foreign(bin_.text)

    mobile = client.get("/api/mobile/logs", params={"company_id": COMP_A}, headers=headers)
    assert mobile.status_code == 200, mobile.text
    assert mobile.json() == _run(mobile_logs.list_mobile_logs(company_id=COMP_A, user=user_a))
    assert [row["id"] for row in mobile.json()["items"]] == ["mA2", "mA1"]
    assert mobile.json()["total"] == 2
    assert mobile.json()["retention_days"] == 30
    narrowed = client.get("/api/mobile/logs", params={"company_id": COMP_A, "source": "web", "level": "ERROR", "q": "panel", "limit": 1}, headers=headers)
    assert [row["id"] for row in narrowed.json()["items"]] == ["mA2"]
    assert narrowed.json()["total"] == 1
    assert narrowed.json() == _run(mobile_logs.list_mobile_logs(company_id=COMP_A, source="web", level="ERROR", q="panel", limit=1, user=user_a))
    _no_foreign(mobile.text)

    wa_logs = client.get("/api/comm/whatsapp/logs", params={"company_id": COMP_A}, headers=headers)
    assert wa_logs.status_code == 200, wa_logs.text
    assert [row["id"] for row in wa_logs.json()] == ["waA2", "waA1"]
    assert wa_logs.json() == _run(server.whatsapp_logs(company_id=COMP_A, user=user_a))
    by_contact = client.get("/api/comm/whatsapp/logs", params={"company_id": COMP_A, "contact_id": "ctA"}, headers=headers)
    assert [row["id"] for row in by_contact.json()] == ["waA2"]
    _no_foreign(wa_logs.text)

    history = client.get("/api/comm/history", params={"company_id": COMP_A}, headers=headers)
    assert history.status_code == 200, history.text
    assert [(row["id"], row["channel"]) for row in history.json()] == [("mailA", "email"), ("smsA", "sms")]
    assert history.json() == _run(server.comm_history(company_id=COMP_A, user=user_a))
    by_ref = client.get("/api/comm/history", params={"company_id": COMP_A, "contact_id": "ctA", "ref_id": "refA"}, headers=headers)
    assert by_ref.json() == _run(server.comm_history(company_id=COMP_A, contact_id="ctA", ref_id="refA", user=user_a))
    _no_foreign(history.text)

    settings = client.get("/api/comm/whatsapp/settings", params={"company_id": COMP_A}, headers=headers)
    assert settings.status_code == 200, settings.text
    view = settings.json()
    assert view == _run(server.get_wa_settings(company_id=COMP_A, user=user_a))
    assert view == _run(server._wa_settings_payload(COMP_A))
    assert view["company_id"] == COMP_A
    assert view["phone_number_id"] == "pnA"
    assert view["verify_token"] == "verify-a"
    assert view["has_token"] is True
    assert view["status"] == "connected"
    assert view["webhook_url"] == "/api/comm/whatsapp/webhook"
    assert "access_token" not in view
    assert "access_token_enc" not in view
    assert WA_SECRET not in settings.text
    assert "pnB-SECRET" not in settings.text
    _no_foreign(settings.text)


def test_support_addon_closed_keeps_error_and_open_lists(api):
    client, _db, calls = api
    closed = client.get("/api/support/tickets", params={"company_id": COMP_B}, headers=_auth("user-b"))
    assert closed.status_code == 403, closed.text
    body = closed.json()
    assert body["detail"] == ADDON_HTTP
    assert body["code"] == "addon_disabled"
    assert body["addon"] == "support.tickets"
    assert "B-SECRET-TICKET" not in closed.text
    with pytest.raises(HTTPException) as exc:
        _run(support_tickets.list_mine(company_id=COMP_B, user=_user_b()))
    assert exc.value.status_code == 403
    assert exc.value.detail == ADDON_ROUTE
    opened = client.get("/api/support/tickets", params={"company_id": COMP_A}, headers=_auth("user-a"))
    assert opened.status_code == 200, opened.text
    assert [row["id"] for row in opened.json()] == ["tA-new", "tA-old"]
    assert calls == []


def test_super_admin_follows_resolve_company_id(api):
    client, _db, calls = api
    missing = client.get("/api/roles", headers=_auth("user-sa", superadmin=True))
    assert missing.status_code == 400, missing.text
    assert missing.json()["detail"] == "Şirket seçilmedi."
    _no_foreign(missing.text)
    with pytest.raises(HTTPException) as exc:
        _run(rbac.list_roles(user=_user("user-sa", [], "", superadmin=True)))
    assert exc.value.status_code == 400

    active = client.get("/api/activity-logs", headers=_auth("user-sa-a", superadmin=True))
    assert active.status_code == 200, active.text
    assert [row["id"] for row in active.json()] == ["logA2", "logA1"]
    assert "NEXUS-ONLY" not in active.text
    assert "B-SECRET" not in active.text

    foreign_roles = client.get("/api/roles", params={"company_id": COMP_B}, headers=_auth("user-sa", superadmin=True))
    assert foreign_roles.status_code == 200, foreign_roles.text
    assert foreign_roles.json()["policies"] == {"cash_dual_approval": False}
    assert all(row["company_id"] == COMP_B for row in foreign_roles.json()["roles"])

    foreign_users = client.get("/api/users", params={"company_id": COMP_B}, headers=_auth("user-sa", superadmin=True))
    assert foreign_users.status_code == 200, foreign_users.text
    assert [row["name"] for row in foreign_users.json()["users"]] == ["B-SECRET"]
    assert "user-a@example.com" not in foreign_users.text

    foreign_logs = client.get("/api/activity-logs", params={"company_id": COMP_B}, headers=_auth("user-sa", superadmin=True))
    assert [row["id"] for row in foreign_logs.json()] == ["logB"]
    assert foreign_logs.json()[0]["detail"] == "B-SECRET-LOG"

    foreign_license = client.get("/api/license/me", params={"company_id": COMP_B}, headers=_auth("user-sa", superadmin=True))
    assert foreign_license.status_code == 200, foreign_license.text
    assert foreign_license.json()["company_id"] == COMP_B
    assert [row["id"] for row in foreign_license.json()["companies"]] == [COMP_B]
    assert foreign_license.json()["pending_request"]["plan_name"] == "B-SECRET-PLAN"
    assert foreign_license.json()["addons"]["support.tickets"] is False
    assert all(row["id"] != COMP_A and row["name"] != "Firma A" for row in foreign_license.json()["companies"])

    foreign_companies = client.get("/api/license/companies", params={"company_id": COMP_B}, headers=_auth("user-sa", superadmin=True))
    assert [row["id"] for row in foreign_companies.json()["companies"]] == [COMP_B]

    foreign_trash = client.get("/api/trash", params={"company_id": COMP_B}, headers=_auth("user-sa", superadmin=True))
    assert foreign_trash.status_code == 200, foreign_trash.text
    assert [row["label"] for row in foreign_trash.json()["items"]] == ["B-SECRET-TRASH"]
    assert "Cari A" not in foreign_trash.text

    foreign_config = client.get("/api/migration/bizimhesap/config", params={"company_id": COMP_B}, headers=_auth("user-sa", superadmin=True))
    assert foreign_config.status_code == 200, foreign_config.text
    assert foreign_config.json()["configured"] is False
    assert foreign_config.json()["firm_id"] == ""
    assert foreign_config.json()["token_mask"] == ""
    assert BH_SECRET not in foreign_config.text
    assert "FIRM-A" not in foreign_config.text

    foreign_warehouses = client.get("/api/migration/bizimhesap/warehouses", params={"company_id": COMP_B}, headers=_auth("user-sa", superadmin=True))
    assert foreign_warehouses.status_code == 400, foreign_warehouses.text
    assert foreign_warehouses.json()["detail"] == "Önce BizimHesap token'ını kaydedin."
    assert BH_SECRET not in foreign_warehouses.text
    assert calls == []


def test_save_views_stay_masked_and_match_payload(api, caplog):
    client, db, _calls = api
    caplog.set_level(logging.DEBUG)
    headers = _auth("user-a")

    saved_bh = _run(migration.bh_put_config({"token": BH_SECRET, "firm_id": "FIRM-N"}))
    assert saved_bh == _run(migration._bh_config_payload(NEXUS))
    assert saved_bh["configured"] is True
    assert saved_bh["firm_id"] == "FIRM-N"
    assert saved_bh["token_mask"] == "••••" + BH_SECRET[-4:]
    assert "token" not in saved_bh
    assert BH_SECRET not in str(saved_bh)
    stored = next(d for d in db.migration_api_configs.docs if d.get("company_id") == NEXUS and d.get("provider") == "bizimhesap")
    import comm_service
    assert stored["token_enc"] != BH_SECRET
    assert comm_service.decrypt(stored["token_enc"]) == BH_SECRET
    still_a = client.get("/api/migration/bizimhesap/config", params={"company_id": COMP_A}, headers=headers)
    assert still_a.json()["firm_id"] == "FIRM-A"
    assert "FIRM-N" not in still_a.text

    saved_wa = _run(server.save_wa_settings({
        "phone_number_id": "pnN",
        "verify_token": "vtN",
        "access_token": WA_SECRET,
    }))
    assert saved_wa == _run(server._wa_settings_payload(NEXUS))
    assert saved_wa["company_id"] == NEXUS
    assert saved_wa["phone_number_id"] == "pnN"
    assert saved_wa["verify_token"] == "vtN"
    assert saved_wa["has_token"] is True
    assert saved_wa["status"] == "connected"
    assert "access_token" not in saved_wa
    assert "access_token_enc" not in saved_wa
    assert WA_SECRET not in str(saved_wa)
    stored_wa = next(d for d in db.whatsapp_settings.docs if d.get("company_id") == NEXUS)
    assert stored_wa["access_token_enc"] != WA_SECRET
    assert comm_service.decrypt(stored_wa["access_token_enc"]) == WA_SECRET
    still_settings = client.get("/api/comm/whatsapp/settings", params={"company_id": COMP_A}, headers=headers)
    assert still_settings.json()["phone_number_id"] == "pnA"
    assert "pnN" not in still_settings.text
    assert WA_SECRET not in caplog.text
    assert WA_SECRET_B not in caplog.text
    assert BH_SECRET not in caplog.text
