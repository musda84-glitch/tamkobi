"""Integration GET routes: route-level auth and company resolution.

In-process TestClient and a memory database. No live server, no port 8021,
no MySQL. Trendyol, Geliver, and İşNet HTTP are mocked.
"""
from __future__ import annotations

import asyncio
import copy
import inspect
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-integrations-get-routes-auth-jwt-secret-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import addons  # noqa: E402
import auth_utils  # noqa: E402
import cargo_providers  # noqa: E402
import isnet  # noqa: E402
import marketplace_providers  # noqa: E402
import pricing  # noqa: E402
import rbac  # noqa: E402
import saas  # noqa: E402
import server  # noqa: E402
from mysql_store import match_query, new_upsert_doc, sort_docs  # noqa: E402

_CMP_OPS = ("$gt", "$gte", "$lt", "$lte")

COMP_A = "A"
COMP_B = "B"
NEXUS = "comp_nexus_main_01"
REST_PASSWORD = "REST-PLAIN-PASSWORD"
ISNET_PASSWORD = "ISNET-PLAIN-PASSWORD"
GELIVER_TOKEN = "GELIVER-PLAIN-TOKEN"
B_TOKEN = "B-SECRET-TOKEN"
B_API_SECRET = "B-SECRET-API-SECRET"
KEY_A = "key-a"
SECRET_A = "secret-a"
UNAUTH = "Giriş yapmanız gerekiyor."
FORBIDDEN = "Bu şirket hesabına erişiminiz yok."


def _and_cmp(query):
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

    def _rows(self, length=None):
        rows = sort_docs(list(self._docs), self._sort) if self._sort else list(self._docs)
        if length is not None:
            rows = rows[: int(length)]
        return copy.deepcopy(rows)

    async def to_list(self, length=None):
        return self._rows(length)


class MemColl:
    def __init__(self, name, db):
        self.name = name
        self.db = db
        self.docs = []

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
        self.docs.append(copy.deepcopy(doc))
        return SimpleNamespace(inserted_id=doc.get("_id"))

    async def update_one(self, query, update, upsert=False):
        from mysql_store import apply_update

        for i, doc in enumerate(self.docs):
            if _docs_match(doc, query):
                self.docs[i] = apply_update(doc, update, query)
                return SimpleNamespace(modified_count=1, matched_count=1)
        if upsert:
            self.docs.append(new_upsert_doc(update, query))
            return SimpleNamespace(modified_count=0, matched_count=0, upserted_id=self.docs[-1].get("_id"))
        return SimpleNamespace(modified_count=0, matched_count=0)

    async def create_index(self, *args, **kwargs):
        return None


class MemDB:
    def __init__(self):
        self._cols = {}

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


def _user(uid, company_ids, active, *, role="admin", superadmin=False):
    return {
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


def _routes():
    dep = server.get_current_user
    return [
        (server.isnet_support_pack, dep, "/api/integrations/isnet/support-pack"),
        (server.list_mappings, dep, "/api/integrations/ecommerce/mappings"),
        (server.unmapped_items, dep, "/api/integrations/ecommerce/unmapped"),
        (server.list_ecommerce_integrations, dep, "/api/integrations/ecommerce"),
        (server.ecommerce_channel_catalog, dep, "/api/integrations/ecommerce/catalog"),
        (server.marketplace_profitability, dep, "/api/marketplace/profitability"),
        (server.product_profitability, dep, "/api/marketplace/product-profitability"),
        (server.marketplace_products, dep, "/api/marketplace/products"),
        (server.marketplace_push_logs, dep, "/api/marketplace/push-logs"),
        (server.cargo_catalog, dep, "/api/integrations/cargo/catalog"),
        (server.list_cargo_integrations, dep, "/api/integrations/cargo"),
        (server.cargo_geliver_balance, dep, "/api/cargo/geliver-balance"),
        (server.cargo_auto_runs, dep, "/api/cargo/auto-ship/runs"),
        (server.list_cargo_shipments, dep, "/api/cargo/shipments"),
    ]


def _seed(db):
    now = datetime.now(timezone.utc).isoformat()
    today = now[:10]
    db.companies.docs.extend([
        {"_id": COMP_A, "name": "Firma A"},
        {"_id": COMP_B, "name": "Firma B"},
        {"_id": NEXUS, "name": "Nexus"},
    ])
    db.einvoice_settings.docs.extend([
        {"_id": "esA", "company_id": COMP_A, "provider": "isnet", "mode": "test", "username": "user-a",
         "password_enc": ISNET_PASSWORD, "company_tax_id": "1111111111"},
        {"_id": "esB", "company_id": COMP_B, "provider": "isnet", "username": "B-SECRET",
         "password_enc": "B-SECRET-PASSWORD", "company_tax_id": "2222222222"},
    ])
    db.marketplace_mappings.docs.extend([
        {"_id": "map-a-old", "company_id": COMP_A, "channel": "trendyol", "marketplace_sku": "MAPPED-A",
         "product_name": "Urun A", "created_at": "2026-10-01T00:00:00"},
        {"_id": "map-a-new", "company_id": COMP_A, "channel": "trendyol", "marketplace_sku": "MAPPED-A2",
         "product_name": "Urun A2", "created_at": "2026-10-02T00:00:00"},
        {"_id": "map-b", "company_id": COMP_B, "channel": "trendyol", "marketplace_sku": "B-SECRET-SKU",
         "product_name": "B-SECRET", "created_at": "2026-10-03T00:00:00"},
    ])
    db.orders.docs.extend([
        {"_id": "ordA", "company_id": COMP_A, "channel": "trendyol", "order_number": "ORD-A",
         "order_date": now, "order_status": "approved", "customer_name": "Alici A", "total_amount": 120,
         "items": [
             {"sku": "MAPPED-A", "product_name": "Urun A", "barcode": "869A-CACHE", "quantity": 2,
              "unit_price": 60, "total": 120, "product_id": "pA"},
             {"sku": "UNMAPPED-A", "product_name": "Eslesmeyen A", "quantity": 1, "unit_price": 1, "total": 1},
         ]},
        {"_id": "ordA-b2b", "company_id": COMP_A, "channel": "b2b", "order_number": "ORD-B2B",
         "order_date": now, "order_status": "approved", "total_amount": 999,
         "items": [{"sku": "B2B-SKU", "product_name": "B2B kalem", "quantity": 1, "total": 999}]},
        {"_id": "ordA-set", "company_id": COMP_A, "channel": "manual", "order_number": "ORD-SET",
         "order_date": now, "order_status": "approved", "total_amount": 1,
         "settlement": {"date": today, "gross": 10, "deductions": 2, "net": 8}},
        {"_id": "ordB", "company_id": COMP_B, "channel": "trendyol", "order_number": "B-SECRET-ORD",
         "order_date": now, "order_status": "approved", "customer_name": "B-SECRET", "total_amount": 999,
         "items": [{"sku": "B-SECRET-SKU", "product_name": "B-SECRET", "barcode": "B-SECRET-BC", "quantity": 1, "total": 999}],
         "settlement": {"date": today, "gross": 99, "deductions": 9, "net": 90}},
    ])
    db.products.docs.extend([
        {"_id": "pA", "company_id": COMP_A, "name": "Urun A", "sku": "SKU-A", "barcode": "869A-CACHE",
         "sale_price": 70, "purchase_price": 20, "stock_quantity": 5},
        {"_id": "pB", "company_id": COMP_B, "name": "B-SECRET", "sku": "B-SECRET-SKU", "barcode": "B-SECRET-BC",
         "sale_price": 9, "purchase_price": 1, "stock_quantity": 1},
    ])
    db.integration_configs.docs.extend([
        {"_id": "cfg-a", "company_id": COMP_A, "channel": "trendyol", "channel_name": "Trendyol",
         "api_key": KEY_A, "api_secret": SECRET_A, "supplier_id": "sup-a", "is_active": True,
         "rest_email": "a@example.com", "rest_password_enc": REST_PASSWORD},
        {"_id": "cfg-a-shop", "company_id": COMP_A, "channel": "shopphp", "channel_name": "ShopPHP",
         "api_key": "", "api_secret": "", "is_active": False},
        {"_id": "cfg-b", "company_id": COMP_B, "channel": "hepsiburada", "channel_name": "B-SECRET",
         "api_key": "B-SECRET-KEY", "api_secret": B_API_SECRET, "supplier_id": "sup-b",
         "rest_email": "b@example.com", "rest_password_enc": "B-SECRET-REST"},
    ])
    db.marketplace_product_cache.docs.extend([
        {"_id": "cacheA", "company_id": COMP_A, "channel": "trendyol", "fetched_at": "2026-10-01T00:00:00",
         "items": [{"barcode": "869A-CACHE", "title": "Onbellek", "stock_code": "SA", "product_main_id": "m1",
                    "sale_price": 10.0, "list_price": 12.0, "quantity": 3}]},
        {"_id": "cacheB", "company_id": COMP_B, "channel": "trendyol", "fetched_at": "2026-10-01T00:00:00",
         "items": [{"barcode": "B-SECRET-BC", "title": "B-SECRET", "stock_code": "SB", "sale_price": 9.0,
                    "list_price": 9.0, "quantity": 1}]},
    ])
    db.marketplace_push_logs.docs.extend([
        {"_id": "log-a-old", "company_id": COMP_A, "channel": "trendyol", "created_at": "2026-10-01T00:00:00",
         "items": [{"barcode": "OLD"}], "batch_request_id": "batch-old", "status": "COMPLETED"},
        {"_id": "log-a-new", "company_id": COMP_A, "channel": "trendyol", "created_at": "2026-10-02T00:00:00",
         "items": [{"barcode": "869A-CACHE"}], "batch_request_id": "batch-a", "status": "SENT"},
        {"_id": "log-b", "company_id": COMP_B, "channel": "trendyol", "created_at": "2026-10-03T00:00:00",
         "items": [{"barcode": "B-SECRET-BC"}], "batch_request_id": "batch-b", "status": "SENT"},
    ])
    db.cargo_configs.docs.extend([
        {"_id": "cargo-a", "company_id": COMP_A, "carrier_code": "geliver", "carrier_name": "Geliver",
         "api_key": GELIVER_TOKEN, "status": "connected", "is_active": True},
        {"_id": "cargo-b", "company_id": COMP_B, "carrier_code": "navlungo", "carrier_name": "B-SECRET",
         "api_key": B_TOKEN, "status": "connected", "is_active": True},
    ])
    db.cargo_auto_runs.docs.extend([
        {"_id": "run-a-old", "company_id": COMP_A, "created_at": "2026-10-01T00:00:00", "created": 1},
        {"_id": "run-a-new", "company_id": COMP_A, "created_at": "2026-10-02T00:00:00", "created": 2},
        {"_id": "run-b", "company_id": COMP_B, "created_at": "2026-10-03T00:00:00", "created": 9},
    ])
    db.cargo_shipments.docs.extend([
        {"_id": "shp-a-old", "company_id": COMP_A, "shipment_date": "2026-10-01T00:00:00", "tracking_number": "TRK-OLD"},
        {"_id": "shp-a-new", "company_id": COMP_A, "shipment_date": "2026-10-03T00:00:00", "tracking_number": "TRK-NEW"},
        {"_id": "shp-b", "company_id": COMP_B, "shipment_date": "2026-10-04T00:00:00", "tracking_number": "B-SECRET-TRK"},
    ])


class FakeTrendyol:
    calls = []

    def __init__(self, cfg):
        self.cfg = cfg
        FakeTrendyol.calls.append(cfg)

    async def products(self):
        return [{
            "barcode": "869-LIVE", "title": "Canli Urun", "stockCode": "LIVE", "productMainId": "live1",
            "salePrice": 15, "listPrice": 18, "quantity": 4, "approved": True, "onSale": True,
            "brand": "Marka", "categoryName": "Kategori", "images": [{"url": "http://img.example/a"}], "vatRate": 20,
        }]

    async def batch_status(self, batch_id):
        return {"status": "COMPLETED", "itemCount": 1, "items": [], "batchRequestId": batch_id}

    async def close(self):
        return None


class _HttpResp:
    def __init__(self, status_code=200, text="ok"):
        self.status_code = status_code
        self.text = text
        self.content = text.encode()


class _HttpClient:
    posts = []

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return None

    async def post(self, url, *args, **kwargs):
        _HttpClient.posts.append(url)
        return _HttpResp()

    async def get(self, url, *args, **kwargs):
        return _HttpResp()


def _no_foreign(text):
    assert "B-SECRET" not in text
    assert B_TOKEN not in text
    assert B_API_SECRET not in text
    assert "B-SECRET-PASSWORD" not in text
    assert "B-SECRET-REST" not in text
    assert NEXUS not in text or "comp_nexus_main_01" not in text


def _snapshot(db):
    return {name: copy.deepcopy(coll.docs) for name, coll in db._cols.items()}


@pytest.fixture
def api():
    db = MemDB()
    db.users.docs.extend([
        _user("user-a", [COMP_A], COMP_A),
        _user("user-b", [COMP_B], COMP_B),
        _user("user-sa", [], "", superadmin=True),
        _user("user-sa-a", [COMP_A], COMP_A, superadmin=True),
    ])
    _seed(db)
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
    FakeTrendyol.calls = []
    _HttpClient.posts = []
    geliver_calls = []

    async def _balance(cfg, token=None):
        geliver_calls.append(cfg)
        if cfg.get("company_id") == COMP_B:
            return 7.0
        return 42.5

    async def _egress():
        return ["203.0.113.5"]

    async def _diag():
        return {"soap": {"ips": [], "tcp_ok": False, "tls_ok": False, "error": None}, "rest": {}}

    client = TestClient(server.app)
    entered = False
    try:
        with patch.object(marketplace_providers, "TrendyolClient", FakeTrendyol), \
             patch.object(cargo_providers, "geliver_fetch_balance", _balance), \
             patch.object(isnet, "detect_egress_ips", _egress), \
             patch.object(isnet, "diagnose_live_soap_path", _diag), \
             patch.object(isnet, "resolve_host_ipv4", lambda host: []), \
             patch.object(isnet.httpx, "AsyncClient", _HttpClient):
            client.__enter__()
            entered = True
            yield client, db, geliver_calls
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


def test_route_signatures_have_auth_and_no_nexus_default():
    routes = _routes()
    assert len(routes) == 14
    for fn, dep, _path in routes:
        sig = inspect.signature(fn)
        assert sig.parameters["company_id"].default is None
        assert sig.parameters["user"].default.dependency is dep
        src = inspect.getsource(fn)
        assert "comp_nexus_main_01" not in src
        assert "cid = tenant_access.resolve_company_id(user, company_id)" in src
    payload = inspect.getsource(server.marketplace_products_payload)
    assert "comp_nexus_main_01" not in payload
    assert "resolve_company_id" not in payload
    assert "marketplace_products_payload(cid, channel, refresh)" in inspect.getsource(server.marketplace_products)
    assert ".to_list(1000)" in inspect.getsource(server.list_mappings)
    assert '.sort("created_at", -1)' in inspect.getsource(server.list_mappings)
    assert ".to_list(1000)" in inspect.getsource(server.unmapped_items)
    assert ".to_list(5000)" in inspect.getsource(server.unmapped_items)
    assert ".to_list(100)" in inspect.getsource(server.list_ecommerce_integrations)
    assert 'c.pop("rest_password_enc", None)' in inspect.getsource(server.list_ecommerce_integrations)
    assert ".to_list(500)" in inspect.getsource(server.ecommerce_channel_catalog)
    assert ".to_list(2000)" in inspect.getsource(server.marketplace_profitability)
    assert ".to_list(5000)" in inspect.getsource(server.marketplace_profitability)
    assert "rows[:300]" in inspect.getsource(server.marketplace_profitability)
    assert "top[:10]" in inspect.getsource(server.marketplace_profitability)
    assert ".to_list(3000)" in inspect.getsource(server.product_profitability)
    assert ".to_list(5000)" in inspect.getsource(server.marketplace_products_payload)
    assert ".to_list(30)" in inspect.getsource(server.marketplace_push_logs)
    assert "logs[:10]" in inspect.getsource(server.marketplace_push_logs)
    assert ".to_list(100)" in inspect.getsource(server.cargo_catalog)
    assert ".to_list(100)" in inspect.getsource(server.list_cargo_integrations)
    assert "mask_config" in inspect.getsource(server.list_cargo_integrations)
    assert ".to_list(20)" in inspect.getsource(server.cargo_auto_runs)
    assert '.sort("created_at", -1)' in inspect.getsource(server.cargo_auto_runs)
    assert ".to_list(100)" in inspect.getsource(server.list_cargo_shipments)
    assert '.sort("shipment_date", -1)' in inspect.getsource(server.list_cargo_shipments)
    init_line = [line for line in Path(server.__file__).read_text(encoding="utf-8").splitlines() if "pricing.init(" in line]
    assert init_line == [
        'pricing.init(db, {"channel_fees": _channel_fees, "marketplace_products": marketplace_products_payload, "mail_account": _mail_account, "wa_send": wa_send}, get_current_user)'
    ]
    assert "cid=company_id" in inspect.getsource(pricing.compute_prices)


def test_backend_callers_are_only_the_definitions():
    names = [fn.__name__ for fn, _dep, _path in _routes()]
    root = _BACKEND
    for py in root.rglob("*.py"):
        if "tests" in py.parts or "docker" in py.parts:
            continue
        lines = py.read_text(encoding="utf-8").splitlines()
        for name in names:
            pattern = re.compile(rf"(?<![\w]){re.escape(name)}\(")
            for line in lines:
                if not pattern.search(line):
                    continue
                if f"def {name}(" in line:
                    continue
                raise AssertionError(f"{py}:{line.strip()}")


def test_background_loops_do_not_call_these_routes():
    names = [fn.__name__ for fn, _dep, _path in _routes()]
    blobs = []
    for mod in (server, pricing, cargo_providers, marketplace_providers):
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
    assert "_marketplace_auto_sync_loop" in text
    for name in names:
        assert f"{name}(" not in text


def test_no_token_is_401(api):
    client, db, geliver_calls = api
    before = _snapshot(db)
    calls_before = len(FakeTrendyol.calls)
    posts_before = len(_HttpClient.posts)
    for _fn, _dep, path in _routes():
        response = client.get(path)
        assert response.status_code == 401, (path, response.text)
        assert response.json()["detail"] == UNAUTH
        _no_foreign(response.text)
    assert _snapshot(db) == before
    assert FakeTrendyol.calls[calls_before:] == []
    assert _HttpClient.posts[posts_before:] == []
    assert geliver_calls == []


def test_other_company_is_403_and_returns_nothing(api):
    client, db, geliver_calls = api
    before = _snapshot(db)
    headers = _auth("user-a")
    for _fn, _dep, path in _routes():
        response = client.get(path, params={"company_id": COMP_B, "refresh": "true", "check": "true"}, headers=headers)
        assert response.status_code == 403, (path, response.text)
        assert response.json()["detail"] == FORBIDDEN
        _no_foreign(response.text)
    assert _snapshot(db) == before
    assert FakeTrendyol.calls == []
    assert _HttpClient.posts == []
    assert geliver_calls == []


def test_direct_call_other_company_is_403_without_middleware(api):
    _client, db, geliver_calls = api
    user_a = _user("user-a", [COMP_A], COMP_A)
    before = _snapshot(db)
    for fn, _dep, path in _routes():
        kwargs = {"company_id": COMP_B, "user": user_a}
        if "channel" in inspect.signature(fn).parameters:
            kwargs["channel"] = "trendyol"
        if "refresh" in inspect.signature(fn).parameters:
            kwargs["refresh"] = True
        if "check" in inspect.signature(fn).parameters:
            kwargs["check"] = True
        with pytest.raises(HTTPException) as exc:
            _run(fn(**kwargs))
        assert exc.value.status_code == 403, path
        assert exc.value.detail == FORBIDDEN
    assert _snapshot(db) == before
    assert FakeTrendyol.calls == []
    assert geliver_calls == []


def test_missing_company_id_uses_active_company_only(api):
    client, db, _geliver = api
    headers = _auth("user-a")
    user_a = _user("user-a", [COMP_A], COMP_A)
    for fn, _dep, path in _routes():
        response = client.get(path, headers=headers)
        assert response.status_code == 200, (path, response.text)
        _no_foreign(response.text)
        direct = _run(fn(company_id=None, user=user_a))
        if path.endswith("/support-pack"):
            assert response.json()["request_xml"] == direct["request_xml"]
            assert "1111111111" in response.json()["response_txt"]
            assert ISNET_PASSWORD not in response.text
            continue
        assert response.json() == direct
    blank = client.get("/api/integrations/ecommerce/mappings", params={"company_id": ""}, headers=headers)
    assert blank.status_code == 200, blank.text
    assert [row["id"] for row in blank.json()] == ["map-a-new", "map-a-old"]
    _no_foreign(blank.text)
    assert "map-b" not in blank.text


def test_happy_path_matches_shape_and_hides_secrets(api):
    client, db, geliver_calls = api
    headers = _auth("user-a")
    params = {"company_id": COMP_A}

    pack = client.get("/api/integrations/isnet/support-pack", params=params, headers=headers)
    assert pack.status_code == 200, pack.text
    body = pack.json()
    assert "HealthCheck" in body["request_xml"]
    assert "1111111111" in body["response_txt"]
    assert ISNET_PASSWORD not in pack.text
    assert "password_enc" not in pack.text
    assert "B-SECRET-PASSWORD" not in pack.text
    assert body["support_email"]
    assert _HttpClient.posts

    mappings = client.get("/api/integrations/ecommerce/mappings", params=params, headers=headers)
    assert mappings.status_code == 200, mappings.text
    assert [row["id"] for row in mappings.json()] == ["map-a-new", "map-a-old"]
    assert mappings.json()[0]["marketplace_sku"] == "MAPPED-A2"

    unmapped = client.get("/api/integrations/ecommerce/unmapped", params=params, headers=headers)
    assert unmapped.status_code == 200, unmapped.text
    assert unmapped.json() == [{
        "channel": "trendyol",
        "marketplace_sku": "UNMAPPED-A",
        "product_name": "Eslesmeyen A",
        "has_local_product": False,
    }]

    ecom = client.get("/api/integrations/ecommerce", params=params, headers=headers)
    assert ecom.status_code == 200, ecom.text
    rows = ecom.json()
    assert [row["id"] for row in rows] == ["cfg-a", "cfg-a-shop"]
    trendyol = rows[0]
    assert trendyol["api_key"] == KEY_A
    assert trendyol["api_secret"] == SECRET_A
    assert trendyol["rest_configured"] is True
    assert trendyol["rest_email"] == "a@example.com"
    assert "rest_password_enc" not in trendyol
    assert REST_PASSWORD not in ecom.text
    assert B_API_SECRET not in ecom.text

    catalog = client.get("/api/integrations/ecommerce/catalog", params=params, headers=headers)
    assert catalog.status_code == 200, catalog.text
    groups = {g["group"]: {c["code"]: c for c in g["channels"]} for g in catalog.json()["groups"]}
    assert groups["Pazaryerleri"]["trendyol"]["added"] is True
    assert groups["Pazaryerleri"]["trendyol"]["live_api"]
    assert groups["Pazaryerleri"]["hepsiburada"]["added"] is False
    assert groups["e-Ticaret Altyapıları"]["shopphp"]["added"] is True

    profit = client.get("/api/marketplace/profitability", params={**params, "days": 30}, headers=headers)
    assert profit.status_code == 200, profit.text
    pdata = profit.json()
    assert pdata["days"] == 30
    assert pdata["total"]["orders"] == 1
    assert pdata["total"]["revenue"] == 120
    assert pdata["total"]["net_profit"] == 16.05
    assert pdata["total"]["commission"] == 30.96
    assert pdata["total"]["margin_pct"] == 13.4
    assert pdata["settlement"] == {"count": 1, "gross": 10, "deductions": 2, "net": 8}
    assert [row["order_number"] for row in pdata["orders"]] == ["ORD-A"]
    assert pdata["orders"][0]["net_profit"] == 16.05
    assert pdata["orders"][0]["product_cost"] == 40
    assert pdata["orders"][0]["commission"] == 25.8
    assert pdata["orders"][0]["commission_vat"] == 5.16
    assert pdata["orders"][0]["service_fee"] == 12.99
    assert [ch["channel"] for ch in pdata["channels"]] == ["trendyol", "shopphp"]
    assert pdata["channels"][0]["revenue"] == 120
    assert pdata["channels"][0]["orders"] == 1
    assert pdata["channels"][1]["orders"] == 0
    assert pdata["top_products"][0]["product_name"] == "Urun A"
    assert pdata["top_products"][0]["gross_profit"] == 80
    assert pdata["low_margin"] == []
    filtered = client.get("/api/marketplace/profitability", params={**params, "channel": "shopphp"}, headers=headers)
    assert filtered.json()["total"]["orders"] == 0
    assert filtered.json()["orders"] == []

    products_profit = client.get("/api/marketplace/product-profitability", params={**params, "days": 90}, headers=headers)
    assert products_profit.status_code == 200, products_profit.text
    prow = products_profit.json()
    assert prow["days"] == 90
    assert [row["product_id"] for row in prow["rows"]] == ["pA"]
    assert prow["rows"][0]["net_profit"] == 16.05
    assert prow["rows"][0]["qty"] == 2
    assert prow["rows"][0]["commission"] == 30.96
    assert prow["rows"][0]["cost"] == 40
    assert [row["name"] for row in prow["products"]] == ["Urun A"]
    assert any(item["key"] == "unmapped-a" for item in prow["unmatched"])
    assert "B-SECRET" not in products_profit.text

    products = client.get("/api/marketplace/products", params={**params, "channel": "trendyol"}, headers=headers)
    assert products.status_code == 200, products.text
    pdata = products.json()
    assert pdata["live"] is True
    assert pdata["push_supported"] is True
    assert pdata["count"] == 1
    assert pdata["matched"] == 1
    assert pdata["fetched_at"] == "2026-10-01T00:00:00"
    assert pdata["rows"][0]["barcode"] == "869A-CACHE"
    assert pdata["rows"][0]["title"] == "Onbellek"
    assert pdata["rows"][0]["product_id"] == "pA"
    assert pdata["rows"][0]["local_price"] == 70
    assert pdata["rows"][0]["price_diff"] == -60
    assert pdata["rows"][0]["stock_diff"] == -2
    assert pdata["products"][0]["id"] == "pA"
    assert FakeTrendyol.calls == []

    logs = client.get("/api/marketplace/push-logs", params={**params, "channel": "trendyol"}, headers=headers)
    assert logs.status_code == 200, logs.text
    assert [row["id"] for row in logs.json()] == ["log-a-new", "log-a-old"]
    assert logs.json()[0]["sent"] == 1
    assert logs.json()[0]["status"] == "SENT"
    assert logs.json()[0]["batch_request_id"] == "batch-a"
    assert FakeTrendyol.calls == []

    cargo_cat = client.get("/api/integrations/cargo/catalog", params=params, headers=headers)
    assert cargo_cat.status_code == 200, cargo_cat.text
    installed = {row["carrier_code"]: row["installed"] for row in cargo_cat.json()}
    assert installed["geliver"] is True
    assert installed["navlungo"] is False
    assert len(cargo_cat.json()) == len(server.CARGO_CATALOG)

    cargo = client.get("/api/integrations/cargo", params=params, headers=headers)
    assert cargo.status_code == 200, cargo.text
    assert [row["id"] for row in cargo.json()] == ["cargo-a"]
    assert cargo.json()[0]["api_key"] == "••••••••"
    assert cargo.json()[0]["has_api_key"] is True
    assert GELIVER_TOKEN not in cargo.text
    assert B_TOKEN not in cargo.text

    balance = client.get("/api/cargo/geliver-balance", params=params, headers=headers)
    assert balance.status_code == 200, balance.text
    assert balance.json() == {"ok": True, "balance": 42.5, "currency": "TRY"}
    assert geliver_calls and geliver_calls[0]["company_id"] == COMP_A
    assert geliver_calls[0]["api_key"] == GELIVER_TOKEN
    assert GELIVER_TOKEN not in balance.text

    runs = client.get("/api/cargo/auto-ship/runs", params=params, headers=headers)
    assert runs.status_code == 200, runs.text
    assert [row["id"] for row in runs.json()] == ["run-a-new", "run-a-old"]

    shipments = client.get("/api/cargo/shipments", params=params, headers=headers)
    assert shipments.status_code == 200, shipments.text
    assert [row["id"] for row in shipments.json()] == ["shp-a-new", "shp-a-old"]
    assert shipments.json()[0]["tracking_number"] == "TRK-NEW"
    _no_foreign(shipments.text)
    assert db.cargo_configs.docs[0]["api_key"] == GELIVER_TOKEN
    assert db.integration_configs.docs[0]["rest_password_enc"] == REST_PASSWORD


def test_refresh_and_check_use_only_the_callers_integration(api):
    client, db, geliver_calls = api
    headers = _auth("user-a")
    before_posts = len(_HttpClient.posts)
    before_geliver = len(geliver_calls)

    refreshed = client.get(
        "/api/marketplace/products",
        params={"company_id": COMP_A, "channel": "trendyol", "refresh": "true"},
        headers=headers,
    )
    assert refreshed.status_code == 200, refreshed.text
    body = refreshed.json()
    assert body["rows"][0]["barcode"] == "869-LIVE"
    assert body["rows"][0]["title"] == "Canli Urun"
    assert body["rows"][0]["sale_price"] == 15
    assert body["count"] == 1
    assert body["live"] is True
    assert len(FakeTrendyol.calls) == 1
    cfg = FakeTrendyol.calls[0]
    assert cfg["company_id"] == COMP_A
    assert cfg["_id"] == "cfg-a"
    assert cfg["api_key"] == KEY_A
    assert cfg["api_secret"] == SECRET_A
    assert cfg["supplier_id"] == "sup-a"
    cached = next(d for d in db.marketplace_product_cache.docs if d["_id"] == "cacheA")
    assert cached["items"][0]["barcode"] == "869-LIVE"

    active = client.get(
        "/api/marketplace/products",
        params={"channel": "trendyol", "refresh": "true"},
        headers=headers,
    )
    assert active.status_code == 200, active.text
    assert len(FakeTrendyol.calls) == 2
    assert FakeTrendyol.calls[1]["company_id"] == COMP_A
    assert FakeTrendyol.calls[1]["api_key"] == KEY_A

    denied = client.get(
        "/api/marketplace/products",
        params={"company_id": COMP_B, "channel": "trendyol", "refresh": "true"},
        headers=headers,
    )
    assert denied.status_code == 403, denied.text
    assert len(FakeTrendyol.calls) == 2
    assert "B-SECRET" not in denied.text

    checked = client.get(
        "/api/marketplace/push-logs",
        params={"company_id": COMP_A, "channel": "trendyol", "check": "true"},
        headers=headers,
    )
    assert checked.status_code == 200, checked.text
    assert checked.json()[0]["id"] == "log-a-new"
    assert checked.json()[0]["status"] == "COMPLETED"
    assert checked.json()[0]["checked_at"]
    assert checked.json()[1]["status"] == "COMPLETED"
    assert len(FakeTrendyol.calls) == 3
    assert FakeTrendyol.calls[2]["company_id"] == COMP_A
    assert FakeTrendyol.calls[2]["api_key"] == KEY_A
    stored = next(d for d in db.marketplace_push_logs.docs if d["_id"] == "log-a-new")
    assert stored["status"] == "COMPLETED"
    untouched = next(d for d in db.marketplace_push_logs.docs if d["_id"] == "log-b")
    assert untouched["status"] == "SENT"

    denied_logs = client.get(
        "/api/marketplace/push-logs",
        params={"company_id": COMP_B, "channel": "trendyol", "check": "true"},
        headers=headers,
    )
    assert denied_logs.status_code == 403, denied_logs.text
    assert len(FakeTrendyol.calls) == 3
    assert _HttpClient.posts[before_posts:] == []
    assert geliver_calls[before_geliver:] == []


def test_super_admin_follows_resolve_company_id(api):
    client, _db, _geliver = api
    missing = client.get("/api/integrations/ecommerce/mappings", headers=_auth("user-sa", superadmin=True))
    assert missing.status_code == 400, missing.text
    assert missing.json()["detail"] == "Şirket seçilmedi."
    _no_foreign(missing.text)
    with pytest.raises(HTTPException) as exc:
        _run(server.list_mappings(user=_user("user-sa", [], "", superadmin=True)))
    assert exc.value.status_code == 400

    active = client.get("/api/integrations/ecommerce/mappings", headers=_auth("user-sa-a", superadmin=True))
    assert active.status_code == 200, active.text
    assert [row["id"] for row in active.json()] == ["map-a-new", "map-a-old"]
    _no_foreign(active.text)

    headers = _auth("user-sa", superadmin=True)
    foreign = client.get("/api/integrations/ecommerce/mappings", params={"company_id": COMP_B}, headers=headers)
    assert foreign.status_code == 200, foreign.text
    assert [row["id"] for row in foreign.json()] == ["map-b"]

    catalog = client.get("/api/integrations/ecommerce/catalog", params={"company_id": COMP_B}, headers=headers)
    groups = {g["group"]: {c["code"]: c["added"] for c in g["channels"]} for g in catalog.json()["groups"]}
    assert groups["Pazaryerleri"]["hepsiburada"] is True
    assert groups["Pazaryerleri"]["trendyol"] is False

    profit = client.get("/api/marketplace/profitability", params={"company_id": COMP_B}, headers=headers)
    assert profit.status_code == 200, profit.text
    assert [row["order_number"] for row in profit.json()["orders"]] == ["B-SECRET-ORD"]
    assert profit.json()["settlement"]["gross"] == 99

    cargo = client.get("/api/integrations/cargo", params={"company_id": COMP_B}, headers=headers)
    assert cargo.status_code == 200, cargo.text
    assert cargo.json()[0]["id"] == "cargo-b"
    assert cargo.json()[0]["api_key"] == "••••••••"
    assert B_TOKEN not in cargo.text

    balance = client.get("/api/cargo/geliver-balance", params={"company_id": COMP_B}, headers=headers)
    assert balance.status_code == 200, balance.text
    assert balance.json() == {"ok": False, "balance": None, "currency": "TRY"}

    for _fn, _dep, path in _routes():
        opened = client.get(path, params={"company_id": COMP_B}, headers=headers)
        assert opened.status_code == 200, (path, opened.text)
