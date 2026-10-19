"""Pazaryeri ürün eşleştirme: stok kartı ve varyant yalnız çağıran firmadan.

Bellek içi sahte veritabanı ve TestClient. Canlı veritabanına, çalışan
sunucuya veya 8021 portuna bağlanmaz.
"""
from __future__ import annotations

import copy
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-marketplace-mapping-tenant-jwt-secret-not-default")
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
from mysql_store import apply_update, match_query, new_upsert_doc, sort_docs  # noqa: E402

COMP_A = "A"
COMP_B = "B"
UNAUTH = "Giriş yapmanız gerekiyor."
PRODUCT_MISSING = "Stok kartı bulunamadı."
VARIANT_MISSING = "Varyant bulunamadı."
MAPPING_MISSING = "Eşleştirme bulunamadı."
ALIAS_REQUIRED = "Ürün ve pazaryeri barkod/SKU gerekli."
MATCH_ALIAS = "869A-NEW"
MATCH_MESSAGE = (
    f"'{MATCH_ALIAS}' → Urun A eşleştirildi. "
    "Kârlılık ve stok düşümü bu ürün üzerinden hesaplanır."
)


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
        matched = [d for d in self.docs if match_query(d, query or {})]
        return MemCursor(matched)

    async def find_one(self, query=None, projection=None):
        for doc in self.docs:
            if match_query(doc, query or {}):
                return copy.deepcopy(doc)
        return None

    async def insert_one(self, doc):
        self.docs.append(copy.deepcopy(doc))
        return SimpleNamespace(inserted_id=doc.get("_id"))

    async def update_one(self, query, update, upsert=False):
        for i, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                self.docs[i] = apply_update(doc, update, query)
                return SimpleNamespace(modified_count=1, matched_count=1)
        if upsert:
            self.docs.append(new_upsert_doc(update, query))
            return SimpleNamespace(modified_count=0, matched_count=0, upserted_id=self.docs[-1].get("_id"))
        return SimpleNamespace(modified_count=0, matched_count=0)

    async def delete_one(self, query):
        for i, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                self.docs.pop(i)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


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


def _user(uid, company_ids, active):
    return {
        "_id": uid,
        "id": uid,
        "email": f"{uid}@example.com",
        "name": uid,
        "role": "admin",
        "is_active": True,
        "is_super_admin": False,
        "company_ids": list(company_ids),
        "active_company_id": active,
    }


def _seed(db):
    now = datetime.now(timezone.utc).isoformat()
    db.companies.docs.extend([
        {"_id": COMP_A, "name": "Firma A"},
        {"_id": COMP_B, "name": "Firma B"},
    ])
    db.products.docs.extend([
        {
            "_id": "pA",
            "company_id": COMP_A,
            "name": "Urun A",
            "sku": "SKU-A",
            "barcode": "869A",
            "variants": [{"variant_id": "var-a", "sku": "SKU-A-V", "name": "Varyant A"}],
            "marketplace_aliases": ["keep-a"],
        },
        {
            "_id": "pB",
            "company_id": COMP_B,
            "name": "B-SECRET",
            "sku": "B-SECRET-SKU",
            "barcode": "B-SECRET-BC",
            "variants": [{"variant_id": "var-b", "sku": "B-SECRET-V", "name": "Varyant B"}],
            "marketplace_aliases": ["keep-b"],
        },
    ])
    db.marketplace_mappings.docs.extend([
        {
            "_id": "map-a-old",
            "company_id": COMP_A,
            "channel": "trendyol",
            "marketplace_sku": "MAPPED-A",
            "product_id": "pA",
            "product_name": "Urun A",
            "sku": "SKU-A",
            "created_at": "2026-10-01T00:00:00",
        },
        {
            "_id": "map-a-new",
            "company_id": COMP_A,
            "channel": "trendyol",
            "marketplace_sku": "MAPPED-A2",
            "product_id": "pA",
            "product_name": "Urun A2",
            "sku": "SKU-A2",
            "created_at": "2026-10-02T00:00:00",
        },
        {
            "_id": "map-b",
            "company_id": COMP_B,
            "channel": "trendyol",
            "marketplace_sku": "B-SECRET-SKU",
            "product_id": "pB",
            "product_name": "B-SECRET",
            "sku": "B-SECRET-SKU",
            "created_at": "2026-10-03T00:00:00",
        },
    ])
    db.orders.docs.extend([
        {
            "_id": "ordA",
            "company_id": COMP_A,
            "channel": "trendyol",
            "order_date": now,
            "items": [
                {"sku": "MAPPED-A", "product_name": "Urun A", "product_id": "pA", "quantity": 1},
                {"sku": "UNMAPPED-A", "product_name": "Eslesmeyen A", "quantity": 1},
            ],
        },
        {
            "_id": "ordB",
            "company_id": COMP_B,
            "channel": "trendyol",
            "order_date": now,
            "items": [{"sku": "B-SECRET-SKU", "product_name": "B-SECRET", "product_id": "pB", "quantity": 1}],
        },
    ])


def _snapshot(db, names):
    return {name: copy.deepcopy(getattr(db, name).docs) for name in names}


def _product(db, pid):
    for doc in db.products.docs:
        if doc.get("_id") == pid:
            return doc
    return None


def _mapping(db, mid):
    for doc in db.marketplace_mappings.docs:
        if doc.get("_id") == mid:
            return doc
    return None


def _no_b_secret(text):
    assert "B-SECRET" not in text
    assert "B-SECRET-SKU" not in text
    assert "B-SECRET-BC" not in text
    assert "B-SECRET-V" not in text


@pytest.fixture
def api():
    db = MemDB()
    db.users.docs.append(_user("user-a", [COMP_A], COMP_A))
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


def _auth():
    token = auth_utils.create_access_token("user-a", "user-a@example.com", "admin")
    return {"Authorization": f"Bearer {token}"}


def test_create_mapping_rejects_other_company_product(api):
    client, db = api
    before = _snapshot(db, ("marketplace_mappings", "products"))
    response = client.post(
        "/api/integrations/ecommerce/mappings",
        json={"channel": "trendyol", "marketplace_sku": "LEAK-CHECK", "product_id": "pB"},
        headers=_auth(),
    )
    assert response.status_code == 404, response.text
    assert response.json()["detail"] == PRODUCT_MISSING
    _no_b_secret(response.text)
    assert _snapshot(db, ("marketplace_mappings", "products")) == before
    assert _mapping(db, "map-b")["product_name"] == "B-SECRET"
    assert _mapping(db, "map-b")["sku"] == "B-SECRET-SKU"


def test_create_mapping_rejects_unknown_variant(api):
    client, db = api
    headers = _auth()
    before = _snapshot(db, ("marketplace_mappings", "products"))
    for variant_id in ("var-b", "no-such-variant"):
        response = client.post(
            "/api/integrations/ecommerce/mappings",
            json={
                "channel": "trendyol",
                "marketplace_sku": "VAR-CHECK",
                "product_id": "pA",
                "variant_id": variant_id,
            },
            headers=headers,
        )
        assert response.status_code == 404, response.text
        assert response.json()["detail"] == VARIANT_MISSING
        _no_b_secret(response.text)
        assert _snapshot(db, ("marketplace_mappings", "products")) == before

    ok = client.post(
        "/api/integrations/ecommerce/mappings",
        json={
            "channel": "trendyol",
            "marketplace_sku": "VAR-CHECK",
            "product_id": "pA",
            "variant_id": "var-a",
        },
        headers=headers,
    )
    assert ok.status_code == 200, ok.text
    body = ok.json()
    assert body["variant_id"] == "var-a"
    assert body["company_id"] == COMP_A
    assert body["product_id"] == "pA"
    stored = next(doc for doc in db.marketplace_mappings.docs if doc.get("marketplace_sku") == "VAR-CHECK")
    assert stored["variant_id"] == "var-a"
    assert stored["company_id"] == COMP_A
    assert stored["product_id"] == "pA"


def test_create_mapping_happy_path_unchanged(api):
    client, db = api
    response = client.post(
        "/api/integrations/ecommerce/mappings",
        json={"channel": "trendyol", "marketplace_sku": "HAPPY-SKU", "product_id": "pA"},
        headers=_auth(),
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["company_id"] == COMP_A
    assert body["channel"] == "trendyol"
    assert body["marketplace_sku"] == "HAPPY-SKU"
    assert body["product_id"] == "pA"
    assert body["product_name"] == "Urun A"
    assert body["sku"] == "SKU-A"
    assert body["sync_stock"] is True
    assert body["sync_price"] is True
    assert body["variant_id"] is None
    assert body["marketplace_product_id"] == ""
    assert body["id"]
    stored = next(doc for doc in db.marketplace_mappings.docs if doc.get("marketplace_sku") == "HAPPY-SKU")
    assert stored["company_id"] == COMP_A
    assert stored["product_id"] == "pA"
    assert stored["product_name"] == "Urun A"
    assert stored["sku"] == "SKU-A"
    assert stored["_id"] == body["id"]
    _no_b_secret(response.text)


def test_product_match_rejects_other_company_product(api):
    client, db = api
    before = _snapshot(db, ("products", "marketplace_mappings"))
    response = client.post(
        "/api/marketplace/product-match",
        json={"product_id": "pB", "alias": "sneaky-alias"},
        headers=_auth(),
    )
    assert response.status_code == 404, response.text
    assert response.json()["detail"] == PRODUCT_MISSING
    _no_b_secret(response.text)
    assert _snapshot(db, ("products", "marketplace_mappings")) == before
    assert _product(db, "pB")["marketplace_aliases"] == ["keep-b"]
    assert _product(db, "pA")["marketplace_aliases"] == ["keep-a"]


def test_product_match_happy_path(api):
    client, db = api
    headers = _auth()
    before = _snapshot(db, ("products",))
    empty = client.post(
        "/api/marketplace/product-match",
        json={"product_id": "pA", "alias": "   "},
        headers=headers,
    )
    assert empty.status_code == 400, empty.text
    assert empty.json()["detail"] == ALIAS_REQUIRED
    assert _snapshot(db, ("products",)) == before

    response = client.post(
        "/api/marketplace/product-match",
        json={"product_id": "pA", "alias": MATCH_ALIAS},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert response.json() == {"status": "success", "message": MATCH_MESSAGE}
    assert MATCH_ALIAS in _product(db, "pA")["marketplace_aliases"]
    assert "keep-a" in _product(db, "pA")["marketplace_aliases"]
    assert _product(db, "pB")["marketplace_aliases"] == ["keep-b"]


def test_product_match_requires_login(api):
    client, db = api
    before = _snapshot(db, ("products", "marketplace_mappings"))
    response = client.post(
        "/api/marketplace/product-match",
        json={"product_id": "pB", "alias": "sneaky-alias"},
    )
    assert response.status_code == 401, response.text
    assert response.json()["detail"] == UNAUTH
    _no_b_secret(response.text)
    assert _snapshot(db, ("products", "marketplace_mappings")) == before


def test_delete_mapping_other_company_404(api):
    client, db = api
    headers = _auth()
    denied = client.delete("/api/integrations/ecommerce/mappings/map-b", headers=headers)
    assert denied.status_code == 404, denied.text
    assert denied.json()["detail"] == MAPPING_MISSING
    _no_b_secret(denied.text)
    assert _mapping(db, "map-b")["company_id"] == COMP_B
    assert _mapping(db, "map-b")["marketplace_sku"] == "B-SECRET-SKU"

    removed = client.delete("/api/integrations/ecommerce/mappings/map-a-old", headers=headers)
    assert removed.status_code == 200, removed.text
    assert removed.json() == {"status": "success"}
    assert _mapping(db, "map-a-old") is None
    assert _mapping(db, "map-a-new") is not None
    assert _mapping(db, "map-b") is not None


def test_list_and_unmapped_stay_scoped(api):
    client, db = api
    headers = _auth()
    before = _snapshot(db, ("marketplace_mappings", "orders", "products"))
    listed = client.get("/api/integrations/ecommerce/mappings", headers=headers)
    assert listed.status_code == 200, listed.text
    assert [row["id"] for row in listed.json()] == ["map-a-new", "map-a-old"]
    assert "map-b" not in listed.text
    _no_b_secret(listed.text)

    unmapped = client.get("/api/integrations/ecommerce/unmapped", headers=headers)
    assert unmapped.status_code == 200, unmapped.text
    assert unmapped.json() == [{
        "channel": "trendyol",
        "marketplace_sku": "UNMAPPED-A",
        "product_name": "Eslesmeyen A",
        "has_local_product": False,
    }]
    assert "map-b" not in unmapped.text
    _no_b_secret(unmapped.text)
    assert _snapshot(db, ("marketplace_mappings", "orders", "products")) == before
