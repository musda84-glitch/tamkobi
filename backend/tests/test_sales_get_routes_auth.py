"""Sales GET routes: route-level auth and company resolution.

In-process TestClient and a memory database. No live server and no port 8021.
"""
from __future__ import annotations

import asyncio
import copy
import inspect
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-sales-get-routes-auth-jwt-secret-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import addons  # noqa: E402
import auth_utils  # noqa: E402
import pricing  # noqa: E402
import rbac  # noqa: E402
import saas  # noqa: E402
import server  # noqa: E402
from mysql_store import match_query, sort_docs  # noqa: E402

COMP_A = "A"
COMP_B = "B"
NEXUS = "comp_nexus_main_01"
DENY = "Bu şirket hesabına erişiminiz yok."


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

    def _note(self, op):
        self.db.writes.append({"coll": self.name, "op": op})

    def find(self, query=None, projection=None):
        matched = [d for d in self.docs if match_query(d, query or {})]
        return MemCursor(matched)

    async def find_one(self, query=None, projection=None):
        for doc in self.docs:
            if match_query(doc, query or {}):
                return copy.deepcopy(doc)
        return None

    async def count_documents(self, query=None):
        return sum(1 for doc in self.docs if match_query(doc, query or {}))

    async def distinct(self, field, query=None):
        seen = []
        for doc in self.docs:
            if not match_query(doc, query or {}):
                continue
            value = doc.get(field)
            if value not in seen:
                seen.append(value)
        return seen

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
        return SimpleNamespace(modified_count=0, matched_count=0)

    async def delete_many(self, query):
        self._note("delete_many")
        return SimpleNamespace(deleted_count=0)

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


def _user_a():
    return _user("user-a", [COMP_A], COMP_A)


def _routes():
    return [
        (server.list_orders, server.get_current_user, "/api/orders", {}),
        (server.list_quotes, server.get_current_user, "/api/quotes", {}),
        (server.list_projects, server.get_current_user, "/api/projects", {}),
        (server.list_surveys, server.get_current_user, "/api/surveys", {}),
        (server.contact_flags, server.get_current_user, "/api/contacts/flags", {}),
        (server.list_products, server.get_current_user, "/api/products", {}),
        (server.list_units, server.get_current_user, "/api/products/units", {}),
        (server.list_product_categories, server.get_current_user, "/api/products/categories", {}),
        (server.get_product_by_barcode, server.get_current_user, "/api/products/barcode/869A", {"barcode": "869A"}),
        (server.pos_lookup_receipt, server.get_current_user, "/api/pos/receipt/FIS-A", {"invoice_number": "FIS-A"}),
        (server.list_returns, server.get_current_user, "/api/returns", {}),
        (pricing.get_rules, pricing._user_dep, "/api/pricing/rules", {}),
        (server.list_marketplace_claims, server.get_current_user, "/api/marketplace/claims", {}),
        (server.list_marketplace_questions, server.get_current_user, "/api/marketplace/questions", {}),
    ]


def _seed(db):
    db.companies.docs.extend([
        {"_id": COMP_A, "name": "Firma A"},
        {"_id": COMP_B, "name": "Firma B"},
        {"_id": NEXUS, "name": "Nexus"},
    ])
    db.orders.docs.extend([
        {"_id": "ordA", "company_id": COMP_A, "order_number": "A-1", "customer_name": "Müşteri A",
         "order_status": "pending", "channel": "b2b", "order_date": "2026-10-16T12:00:00Z",
         "total_amount": 10, "grand_total": 10, "items": []},
        {"_id": "cartA", "company_id": COMP_A, "order_number": "A-CART", "customer_name": "Sepet A",
         "order_status": "active_cart", "is_active_cart": True, "source": "b2b_active_cart", "channel": "b2b",
         "order_date": "2026-10-16T11:00:00Z", "total_amount": 1, "grand_total": 1, "items": []},
        {"_id": "ordB", "company_id": COMP_B, "order_number": "B-1", "customer_name": "B-SECRET",
         "order_status": "pending", "channel": "b2b", "order_date": "2026-10-16T13:00:00Z",
         "total_amount": 99, "grand_total": 99, "items": []},
        {"_id": "cartB", "company_id": COMP_B, "order_number": "B-CART", "customer_name": "B-SECRET-CART",
         "order_status": "active_cart", "is_active_cart": True, "source": "b2b_active_cart", "channel": "b2b",
         "order_date": "2026-10-16T10:00:00Z", "total_amount": 2, "grand_total": 2, "items": []},
        {"_id": "ordN", "company_id": NEXUS, "order_number": "N-1", "customer_name": "NEXUS-ONLY",
         "order_status": "pending", "channel": "b2b", "order_date": "2026-10-16T14:00:00Z",
         "total_amount": 3, "grand_total": 3, "items": []},
    ])
    db.quotes.docs.extend([
        {"_id": "qA", "company_id": COMP_A, "quote_number": "TKF-A", "title": "Teklif A", "created_at": "2026-10-16T12:00:00Z", "items": []},
        {"_id": "qB", "company_id": COMP_B, "quote_number": "TKF-B", "title": "B-SECRET", "created_at": "2026-10-16T13:00:00Z", "items": []},
        {"_id": "qN", "company_id": NEXUS, "quote_number": "TKF-N", "title": "NEXUS-ONLY", "created_at": "2026-10-16T14:00:00Z", "items": []},
    ])
    db.projects.docs.extend([
        {"_id": "pA", "company_id": COMP_A, "project_number": "PRJ-A", "name": "Proje A", "status": "active", "created_at": "2026-10-16T12:00:00Z"},
        {"_id": "pB", "company_id": COMP_B, "project_number": "PRJ-B", "name": "B-SECRET", "status": "active", "created_at": "2026-10-16T13:00:00Z"},
        {"_id": "pN", "company_id": NEXUS, "project_number": "PRJ-N", "name": "NEXUS-ONLY", "status": "active", "created_at": "2026-10-16T14:00:00Z"},
    ])
    db.surveys.docs.extend([
        {"_id": "sA", "company_id": COMP_A, "survey_number": "KSF-A", "address": "Adres A", "created_at": "2026-10-16T12:00:00Z"},
        {"_id": "sB", "company_id": COMP_B, "survey_number": "KSF-B", "address": "B-SECRET", "created_at": "2026-10-16T13:00:00Z"},
        {"_id": "sN", "company_id": NEXUS, "survey_number": "KSF-N", "address": "NEXUS-ONLY", "created_at": "2026-10-16T14:00:00Z"},
    ])
    db.invoices.docs.extend([
        {"_id": "flagA", "company_id": COMP_A, "contact_id": "ctA", "payment_status": "unpaid", "status": "issued",
         "invoice_type": "sales", "invoice_number": "FLG-A", "due_date": "2020-01-01", "issue_date": "2020-01-01",
         "grand_total": 15, "paid_amount": 0},
        {"_id": "flagB", "company_id": COMP_B, "contact_id": "B-SECRET", "payment_status": "unpaid", "status": "issued",
         "invoice_type": "sales", "invoice_number": "FLG-B", "due_date": "2020-01-01", "issue_date": "2020-01-01",
         "grand_total": 77, "paid_amount": 0},
        {"_id": "fisA", "company_id": COMP_A, "invoice_number": "FIS-A", "invoice_type": "sales", "status": "issued",
         "payment_status": "paid", "grand_total": 20, "returned_amount": 0, "contact_name": "Müşteri A"},
        {"_id": "fisB", "company_id": COMP_B, "invoice_number": "FIS-B", "invoice_type": "sales", "status": "issued",
         "payment_status": "paid", "grand_total": 80, "returned_amount": 0, "contact_name": "B-SECRET"},
    ])
    db.products.docs.extend([
        {"_id": "prodA", "company_id": COMP_A, "name": "Ürün A", "sku": "SKU-A", "barcode": "869A",
         "category": "KatA", "unit": "BirimA", "sale_price": 10, "stock_quantity": 3, "type": "product", "is_active": True},
        {"_id": "prodB", "company_id": COMP_B, "name": "B-SECRET", "sku": "SKU-B", "barcode": "869B",
         "category": "KatB", "unit": "BirimB", "sale_price": 99, "stock_quantity": 1, "type": "product", "is_active": True},
        {"_id": "prodN", "company_id": NEXUS, "name": "NEXUS-ONLY", "sku": "SKU-N", "barcode": "869N",
         "category": "KatN", "unit": "BirimN", "sale_price": 1, "stock_quantity": 1, "type": "product", "is_active": True},
    ])
    db.units.docs.extend([
        {"_id": "uA", "company_id": COMP_A, "name": "BirimA"},
        {"_id": "uB", "company_id": COMP_B, "name": "BirimB"},
        {"_id": "uN", "company_id": NEXUS, "name": "BirimN"},
    ])
    db.product_categories.docs.extend([
        {"_id": "catA", "company_id": COMP_A, "name": "KatA"},
        {"_id": "catB", "company_id": COMP_B, "name": "KatB"},
    ])
    db.returns.docs.extend([
        {"_id": "retA", "company_id": COMP_A, "order_number": "A-1", "created_at": "2026-10-16T12:00:00Z"},
        {"_id": "retB", "company_id": COMP_B, "order_number": "B-SECRET", "created_at": "2026-10-16T13:00:00Z"},
    ])
    db.marketplace_claims.docs.extend([
        {"_id": "clA", "company_id": COMP_A, "status": "Created", "claim_date": "2026-10-16T12:00:00Z", "channel": "trendyol", "order_number": ""},
        {"_id": "clB", "company_id": COMP_B, "status": "Created", "claim_date": "2026-10-16T13:00:00Z", "channel": "trendyol",
         "order_number": "B-1", "customer_name": "B-SECRET"},
    ])
    db.marketplace_questions.docs.extend([
        {"_id": "quA", "company_id": COMP_A, "status": "WAITING_FOR_ANSWER", "text": "Soru A", "asked_at": "2026-10-16T12:00:00Z"},
        {"_id": "quB", "company_id": COMP_B, "status": "WAITING_FOR_ANSWER", "text": "B-SECRET", "asked_at": "2026-10-16T13:00:00Z"},
    ])
    db.pricing_rules.docs.extend([
        {"_id": "prA", "company_id": COMP_A, "channel": "trendyol", "margin_pct": 40.0, "rounding": "0.90"},
        {"_id": "prB", "company_id": COMP_B, "channel": "trendyol", "margin_pct": 99.0, "rounding": "0.99"},
        {"_id": "prN", "company_id": NEXUS, "channel": "trendyol", "margin_pct": 1.0, "rounding": "1"},
    ])


def _snapshot(db):
    return {name: copy.deepcopy(coll.docs) for name, coll in db._cols.items()}


def _no_foreign(text):
    assert "B-SECRET" not in text
    assert "NEXUS-ONLY" not in text


def _ids(body):
    rows = body["items"] if isinstance(body, dict) and isinstance(body.get("items"), list) else body
    assert isinstance(rows, list)
    return [row["id"] for row in rows]


def _assert_own(path, body):
    if path == "/api/orders":
        assert isinstance(body, list)
        assert _ids(body) == ["ordA"]
    elif path == "/api/quotes":
        assert _ids(body) == ["qA"]
    elif path == "/api/projects":
        assert _ids(body) == ["pA"]
        assert body[0]["name"] == "Proje A"
        assert body[0]["quote_count"] == 0
    elif path == "/api/surveys":
        assert _ids(body) == ["sA"]
    elif path == "/api/contacts/flags":
        assert list(body) == ["ctA"]
        assert body["ctA"]["overdue_count"] == 1
        assert body["ctA"]["overdue_amount"] == 15
    elif path == "/api/products":
        assert isinstance(body, list)
        assert _ids(body) == ["prodA"]
        assert body[0]["purchase_costs"] == []
    elif path == "/api/products/units":
        assert body == [{"name": "BirimA", "count": 1}]
    elif path == "/api/products/categories":
        assert body == [{"name": "KatA", "count": 1}]
    elif path == "/api/products/barcode/869A":
        assert body["id"] == "prodA"
        assert body["barcode"] == "869A"
        assert body["matched_variant"] is None
    elif path == "/api/pos/receipt/FIS-A":
        assert body["invoice"]["id"] == "fisA"
        assert body["invoice"]["invoice_number"] == "FIS-A"
        assert body["fully_returned"] is False
        assert body["returned_amount"] == 0
        assert body["remaining"] == 20
    elif path == "/api/returns":
        assert _ids(body) == ["retA"]
    elif path == "/api/pricing/rules":
        assert body["trendyol"]["margin_pct"] == 40.0
        assert body["trendyol"]["rounding"] == "0.90"
        assert set(body) == {"trendyol"}
    elif path == "/api/marketplace/claims":
        assert _ids(body) == ["clA"]
        assert body[0]["cargo_arrived"] is False
    elif path == "/api/marketplace/questions":
        assert _ids(body) == ["quA"]
        assert body[0]["text"] == "Soru A"
    else:
        raise AssertionError(path)


def _assert_foreign(path, body):
    if path == "/api/orders":
        assert _ids(body) == ["ordB"]
    elif path == "/api/quotes":
        assert _ids(body) == ["qB"]
    elif path == "/api/projects":
        assert _ids(body) == ["pB"]
    elif path == "/api/surveys":
        assert _ids(body) == ["sB"]
    elif path == "/api/contacts/flags":
        assert list(body) == ["B-SECRET"]
    elif path == "/api/products":
        assert _ids(body) == ["prodB"]
    elif path == "/api/products/units":
        assert [row["name"] for row in body] == ["BirimB"]
    elif path == "/api/products/categories":
        assert [row["name"] for row in body] == ["KatB"]
    elif path == "/api/products/barcode/869B":
        assert body["id"] == "prodB"
        assert body["name"] == "B-SECRET"
    elif path == "/api/pos/receipt/FIS-B":
        assert body["invoice"]["id"] == "fisB"
        assert body["invoice"]["contact_name"] == "B-SECRET"
    elif path == "/api/returns":
        assert _ids(body) == ["retB"]
    elif path == "/api/pricing/rules":
        assert body["trendyol"]["margin_pct"] == 99.0
    elif path == "/api/marketplace/claims":
        assert _ids(body) == ["clB"]
        assert body[0]["customer_name"] == "B-SECRET"
    elif path == "/api/marketplace/questions":
        assert body[0]["text"] == "B-SECRET"
    else:
        raise AssertionError(path)


@pytest.fixture
def api():
    db = MemDB()
    db.users.docs.append(_user("user-a", [COMP_A], COMP_A))
    db.users.docs.append(_user("user-b", [COMP_B], COMP_B))
    db.users.docs.append(_user("user-sa", [], "", superadmin=True))
    db.users.docs.append(_user("user-sa-a", [COMP_A], COMP_A, superadmin=True))
    _seed(db)
    prev = (server.db, rbac._db, saas._db, addons._db, pricing._db, pricing._current_user)
    server.db = db
    rbac._db = db
    saas._db = db
    addons._db = db
    pricing._db = db
    pricing._current_user = server.get_current_user
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
        server.db, rbac._db, saas._db, addons._db, pricing._db, pricing._current_user = prev
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
    for fn in (server.list_orders, server.list_products, server.list_quotes, server.list_projects, server.list_surveys):
        assert "request" not in inspect.signature(fn).parameters
    server_text = Path(server.__file__).read_text(encoding="utf-8")
    pricing_text = Path(pricing.__file__).read_text(encoding="utf-8")
    assert "_company_id_for_list" not in server_text
    assert "await get_rules(" not in pricing_text
    assert pricing_text.count("await _rules_payload(") >= 2
    for name in (
        "list_orders", "list_quotes", "list_projects", "list_surveys", "contact_flags",
        "list_products", "list_units", "list_product_categories", "get_product_by_barcode",
        "pos_lookup_receipt", "list_returns", "list_marketplace_claims", "list_marketplace_questions",
    ):
        assert f"await {name}(" not in server_text


def test_no_token_is_401(api):
    client, db = api
    before = _snapshot(db)
    for _fn, _dep, path, _extra in _routes():
        response = client.get(path)
        assert response.status_code == 401, (path, response.text)
        _no_foreign(response.text)
    assert _snapshot(db) == before
    assert db.writes == []


def test_other_company_is_403_and_returns_nothing(api):
    client, db = api
    before = _snapshot(db)
    headers = _auth("user-a")
    for _fn, _dep, path, _extra in _routes():
        response = client.get(path, params={"company_id": COMP_B}, headers=headers)
        assert response.status_code == 403, (path, response.text)
        assert response.json()["detail"] == DENY
        _no_foreign(response.text)
    assert _snapshot(db) == before
    assert db.writes == []


def test_direct_call_other_company_is_403_without_middleware(api):
    _client, db = api
    user_a = _user_a()
    before = _snapshot(db)
    for fn, _dep, path, extra in _routes():
        with pytest.raises(HTTPException) as exc:
            _run(fn(company_id=COMP_B, user=user_a, **extra))
        assert exc.value.status_code == 403, path
        assert exc.value.detail == DENY
    assert _snapshot(db) == before
    assert db.writes == []


def test_missing_company_id_uses_active_company_only(api):
    client, db = api
    headers = _auth("user-a")
    user_a = _user_a()
    for fn, _dep, path, extra in _routes():
        response = client.get(path, headers=headers)
        assert response.status_code == 200, (path, response.text)
        _no_foreign(response.text)
        _assert_own(path, response.json())
        direct = _run(fn(company_id=None, user=user_a, **extra))
        assert response.json() == direct
    blank = client.get("/api/quotes", params={"company_id": ""}, headers=headers)
    assert blank.status_code == 200
    assert _ids(blank.json()) == ["qA"]
    _no_foreign(blank.text)
    assert db.writes == []


def test_own_company_returns_only_own_records(api):
    client, db = api
    headers = _auth("user-a")
    for _fn, _dep, path, _extra in _routes():
        response = client.get(path, params={"company_id": COMP_A}, headers=headers)
        assert response.status_code == 200, (path, response.text)
        _no_foreign(response.text)
        _assert_own(path, response.json())
    hidden_barcode = client.get("/api/products/barcode/869B", headers=headers)
    assert hidden_barcode.status_code == 404
    _no_foreign(hidden_barcode.text)
    hidden_receipt = client.get("/api/pos/receipt/FIS-B", headers=headers)
    assert hidden_receipt.status_code == 404
    _no_foreign(hidden_receipt.text)
    assert db.writes == []


def test_quotes_projects_surveys_without_company_do_not_require_nexus(api):
    client, _db = api
    headers = _auth("user-a")
    user_a = _user_a()
    for path, fn, expected in (
        ("/api/quotes", server.list_quotes, ["qA"]),
        ("/api/projects", server.list_projects, ["pA"]),
        ("/api/surveys", server.list_surveys, ["sA"]),
    ):
        response = client.get(path, headers=headers)
        assert response.status_code == 200, (path, response.text)
        assert _ids(response.json()) == expected
        _no_foreign(response.text)
        direct = _run(fn(user=user_a))
        assert _ids(direct) == expected
        assert NEXUS not in user_a["company_ids"]


def test_orders_legacy_and_paged_are_isolated(api):
    client, db = api
    headers = _auth("user-a")
    user_a = _user_a()
    legacy = client.get("/api/orders", headers=headers)
    assert legacy.status_code == 200, legacy.text
    assert isinstance(legacy.json(), list)
    assert _ids(legacy.json()) == ["ordA"]
    _no_foreign(legacy.text)

    paged = client.get("/api/orders", params={"page": 1, "page_size": 20}, headers=headers)
    assert paged.status_code == 200, paged.text
    assert isinstance(paged.json(), dict)
    assert _ids(paged.json()) == ["ordA"]
    assert paged.json()["total"] == 1
    assert "summary" in paged.json()
    _no_foreign(paged.text)

    panel = client.get("/api/orders", params={"paged": True, "page": 1, "page_size": 20}, headers=headers)
    assert panel.status_code == 200, panel.text
    assert _ids(panel.json()) == ["ordA"]
    assert "items" in panel.json()
    _no_foreign(panel.text)

    exported = client.get("/api/orders", params={"export": True}, headers=headers)
    assert exported.status_code == 200, exported.text
    assert _ids(exported.json()) == ["ordA"]
    _no_foreign(exported.text)

    cart = client.get("/api/orders", params={"status": "active_cart"}, headers=headers)
    assert cart.status_code == 200, cart.text
    assert _ids(cart.json()) == ["cartA"]
    _no_foreign(cart.text)

    included = client.get("/api/orders", params={"include_active_cart": True}, headers=headers)
    assert included.status_code == 200, included.text
    assert _ids(included.json()) == ["cartA", "ordA"]
    _no_foreign(included.text)

    direct_legacy = _run(server.list_orders(company_id=None, user=user_a))
    direct_paged = _run(server.list_orders(company_id=None, page=1, page_size=20, user=user_a))
    assert _ids(direct_legacy) == ["ordA"]
    assert _ids(direct_paged) == ["ordA"]
    assert db.writes == []


def test_products_legacy_paged_and_lite_are_isolated(api):
    client, db = api
    headers = _auth("user-a")
    legacy = client.get("/api/products", headers=headers)
    assert isinstance(legacy.json(), list)
    assert _ids(legacy.json()) == ["prodA"]
    assert "purchase_costs" in legacy.json()[0]
    _no_foreign(legacy.text)

    paged = client.get("/api/products", params={"page": 1, "page_size": 20}, headers=headers)
    assert paged.status_code == 200, paged.text
    assert _ids(paged.json()) == ["prodA"]
    assert paged.json()["total"] == 1
    assert "summary" in paged.json()
    assert paged.json()["items"][0]["purchase_costs"] == []
    _no_foreign(paged.text)

    lite = client.get("/api/products", params={"lite": True}, headers=headers)
    assert lite.status_code == 200, lite.text
    assert _ids(lite.json()) == ["prodA"]
    assert "purchase_costs" not in lite.json()[0]
    _no_foreign(lite.text)
    assert db.writes == []


def test_super_admin_follows_resolve_company_id(api):
    client, db = api
    for _fn, _dep, path, _extra in _routes():
        missing = client.get(path, headers=_auth("user-sa", superadmin=True))
        assert missing.status_code == 400, (path, missing.text)
        assert missing.json()["detail"] == "Şirket seçilmedi."
        _no_foreign(missing.text)
    with pytest.raises(HTTPException) as exc:
        _run(server.list_orders(user=_user("user-sa", [], "", superadmin=True)))
    assert exc.value.status_code == 400

    active = client.get("/api/orders", headers=_auth("user-sa-a", superadmin=True))
    assert active.status_code == 200, active.text
    assert _ids(active.json()) == ["ordA"]
    _no_foreign(active.text)

    foreign_paths = [
        ("/api/orders", "/api/orders"),
        ("/api/quotes", "/api/quotes"),
        ("/api/projects", "/api/projects"),
        ("/api/surveys", "/api/surveys"),
        ("/api/contacts/flags", "/api/contacts/flags"),
        ("/api/products", "/api/products"),
        ("/api/products/units", "/api/products/units"),
        ("/api/products/categories", "/api/products/categories"),
        ("/api/products/barcode/869B", "/api/products/barcode/869B"),
        ("/api/pos/receipt/FIS-B", "/api/pos/receipt/FIS-B"),
        ("/api/returns", "/api/returns"),
        ("/api/pricing/rules", "/api/pricing/rules"),
        ("/api/marketplace/claims", "/api/marketplace/claims"),
        ("/api/marketplace/questions", "/api/marketplace/questions"),
    ]
    headers = _auth("user-sa", superadmin=True)
    for path, shape in foreign_paths:
        response = client.get(path, params={"company_id": COMP_B}, headers=headers)
        assert response.status_code == 200, (path, response.text)
        _assert_foreign(shape, response.json())
    assert db.writes == []


def test_compute_prices_reads_the_same_rule_as_the_helper(api):
    client, _db = api
    seen = []

    async def marketplace_products(**kwargs):
        seen.append(kwargs.get("company_id"))
        return {"rows": [], "push_supported": False}

    fees = lambda cfg, ch: {"commission_rate": 0, "commission_vat_rate": 0, "service_fee": 0, "cargo_fee": 0}
    with patch.dict(pricing._deps, {"marketplace_products": marketplace_products, "channel_fees": fees}):
        priced = _run(pricing.compute_prices({"company_id": COMP_A, "channel": "trendyol"}))
        defaulted = _run(pricing.compute_prices({"channel": "trendyol"}))
    rules = client.get("/api/pricing/rules", headers=_auth("user-a"))
    assert rules.status_code == 200, rules.text
    helper = _run(pricing._rules_payload(COMP_A))
    assert rules.json() == helper
    assert priced["rule"] == helper["trendyol"]
    assert priced["rule"]["margin_pct"] == 40.0
    assert seen[0] == COMP_A
    assert seen[1] == NEXUS
    assert defaulted["channel"] == "trendyol"
    _no_foreign(rules.text)
