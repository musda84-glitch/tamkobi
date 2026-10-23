"""StorageRouter. Canlı veritabanına bağlanmaz.

Bayrak kapalıyken TenantDB bugünkü koleksiyonu döner. Bayrak açıkken
legacy aynı arka uçtur. shared_v2 ürün gibi koleksiyonları docs_v2'ye,
orders, invoices, stock_movements ve bank_transactions kendi tablolarına
gider; bağlantı açılmaz.
dedicated ayrı veritabanına gider; DSN yoksa açık hata verir, legacy'ye düşmez.
Bilinmeyen kip açık hata verir.
"""
from __future__ import annotations

import asyncio
import inspect
import os
import sys
import time
from pathlib import Path

import pytest
from cryptography.fernet import Fernet

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(Path(__file__).resolve().parent))

os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

from dashboard_memdb import MemDB  # noqa: E402
from models import Company  # noqa: E402
from schema_catalog import COLLECTIONS  # noqa: E402
import storage_router  # noqa: E402
import storage_shared_v2  # noqa: E402
import tenant_db  # noqa: E402
from storage_router import StorageModeError  # noqa: E402
from tenant_scope import TenantScope  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
CO_C = "co_c"


@pytest.fixture(autouse=True)
def _reset_router():
    import storage_shared_v2

    storage_router.reset()
    storage_shared_v2.reset_store()
    yield
    storage_router.reset()
    storage_shared_v2.reset_store()


def _scope(company_id=CO_A):
    return TenantScope(
        company_id=company_id,
        allowed=frozenset({company_id}),
        kind="user",
        actor_id="user-a",
        reason="test",
    )


def _company(**extra):
    return Company(
        name="A",
        tax_number="1",
        tax_office="VD",
        address="adres",
        city="İstanbul",
        phone="1",
        email="a@b.c",
        **extra,
    )


def test_schema_and_model_keep_dsn_off_new_documents():
    keys = COLLECTIONS["companies"]["keys"]
    assert "storage_mode" in keys
    assert "dedicated_dsn_ref" in keys
    assert Company.model_fields["storage_mode"].default is None
    assert Company.model_fields["dedicated_dsn_ref"].default is None
    body = _company().to_mongo()
    assert "storage_mode" not in body
    assert "dedicated_dsn_ref" not in body
    described = COLLECTIONS["companies"]["description"]
    assert "dedicated_dsn_ref" in described
    assert "okunmaz" in described


def test_company_update_allowlist_has_no_storage_write():
    text = (_BACKEND / "server.py").read_text(encoding="utf-8")
    start = text.index("async def update_company")
    chunk = text[start:text.index("\n@", start + 10)]
    assert "storage_mode" not in chunk
    assert "dedicated_dsn_ref" not in chunk
    saas = (_BACKEND / "saas.py").read_text(encoding="utf-8")
    assert "company_storage_view" in saas
    assert "storage_mode" not in saas[saas.index("async def apply_create_company"):saas.index("async def validate_company_delete")]


def test_view_is_read_only_and_hides_dsn():
    view = storage_router.company_storage_view(
        {"storage_mode": " LEGACY ", "dedicated_dsn_ref": "gAAAA-secret"}
    )
    assert view == {"storage_mode": "legacy"}
    assert storage_router.company_storage_view({}) == {"storage_mode": "legacy"}
    assert storage_router.company_storage_view(None) == {"storage_mode": "legacy"}
    assert storage_router.public_mode("shared_v2") == "shared_v2"


def test_seal_dedicated_dsn_is_not_plaintext(monkeypatch, tmp_path):
    previous = os.environ.get("CREDENTIAL_ENCRYPTION_KEY")
    monkeypatch.setenv("CREDENTIAL_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    import comm_service

    comm_service.reset_fernet_for_tests()
    try:
        raw = "mysql://user:s3cret@db.internal/app"
        sealed = storage_router.seal_dedicated_dsn(raw)
        assert sealed != raw
        assert "s3cret" not in sealed
        assert sealed.startswith("gAAAA")
        assert comm_service.decrypt(sealed) == raw
        with pytest.raises(ValueError):
            storage_router.seal_dedicated_dsn("  ")
    finally:
        if previous is None:
            monkeypatch.delenv("CREDENTIAL_ENCRYPTION_KEY", raising=False)
        else:
            monkeypatch.setenv("CREDENTIAL_ENCRYPTION_KEY", previous)
        comm_service.reset_fernet_for_tests()


def test_load_path_does_not_read_dsn_field():
    source = "\n".join(
        inspect.getsource(fn)
        for fn in (
            storage_router.load_mode,
            storage_router._read_sync,
            storage_router._mode_from_doc,
            storage_router.legacy_collection,
        )
    )
    assert "dedicated_dsn_ref" not in source
    assert "decrypt" not in source


def test_flag_off_skips_router_even_for_dedicated(monkeypatch):
    monkeypatch.delenv("STORAGE_ROUTER_ENABLED", raising=False)

    def boom(*_args, **_kwargs):
        raise AssertionError("router çağrılmamalı")

    monkeypatch.setattr(storage_router, "legacy_collection", boom)
    monkeypatch.setattr(storage_router, "load_mode", boom)
    db = MemDB()

    async def run():
        await db.companies.insert_one({"_id": CO_A, "storage_mode": "dedicated", "dedicated_dsn_ref": "gAAAA"})
        tdb = tenant_db.TenantDB(db, _scope())
        coll = tdb._collection("products")
        assert isinstance(coll, tenant_db.ScopedCollection)
        assert coll._raw is db.products
        assert tdb.help_articles is db.help_articles
        assert storage_router.read_count == 0

    asyncio.run(run())


def test_router_selects_legacy_backend_per_company(monkeypatch):
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    db = MemDB()

    async def run():
        await db.companies.insert_one({"_id": CO_A, "name": "A"})
        await db.companies.insert_one({"_id": CO_B, "storage_mode": "legacy"})
        await db.companies.insert_one({"_id": CO_C, "storage_mode": "shared_v2", "dedicated_dsn_ref": "gAAAA"})
        await db.companies.insert_one({"_id": "co_d", "storage_mode": "Dedicated"})
        await db.companies.insert_one({"_id": "co_e", "storage_mode": "glacier"})

        legacy = tenant_db.TenantDB(db, _scope(CO_A))._collection("products")
        explicit = tenant_db.TenantDB(db, _scope(CO_B))._collection("orders")
        assert isinstance(legacy, tenant_db.ScopedCollection)
        assert legacy._raw is db.products
        assert explicit._raw is db.orders

        shared = tenant_db.TenantDB(db, _scope(CO_C))._collection("products")
        assert type(shared._raw).__name__ == "SharedV2Collection"
        assert shared._raw.company_id == CO_C
        assert shared._raw.name == "products"
        assert storage_shared_v2.get_store().conn is None
        with pytest.raises(StorageModeError, match="DSN referansı yok"):
            storage_router.legacy_collection(db, "co_d", "products")
        with pytest.raises(StorageModeError, match="Bilinmeyen depolama kipi: glacier"):
            storage_router.legacy_collection(db, "co_e", "invoices")

        # İlk firmanın önbelleği diğer firmanın hatasını yutmaz.
        again = tenant_db.TenantDB(db, _scope(CO_A))._collection("products")
        assert again._raw is db.products

    asyncio.run(run())


def test_cache_refreshes_after_ttl(monkeypatch):
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    clock = {"t": 1_000.0}
    monkeypatch.setattr(storage_router, "_now", lambda: clock["t"])
    db = MemDB()

    async def run():
        await db.companies.insert_one({"_id": CO_A, "storage_mode": "legacy"})
        assert await storage_router.load_mode(db, CO_A) == "legacy"
        assert storage_router.read_count == 1
        await db.companies.update_one({"_id": CO_A}, {"$set": {"storage_mode": "shared_v2"}})
        assert await storage_router.load_mode(db, CO_A) == "legacy"
        assert storage_router.read_count == 1
        storage_router.legacy_collection(db, CO_A, "products")
        clock["t"] += storage_router.TTL_SECONDS
        assert await storage_router.load_mode(db, CO_A) == "shared_v2"
        assert storage_router.read_count == 2
        routed = storage_router.legacy_collection(db, CO_A, "products")
        assert type(routed).__name__ == "SharedV2Collection"
        assert routed.company_id == CO_A
        assert routed.name == "products"
        assert storage_shared_v2.get_store().conn is None
        assert storage_router.read_count == 2

    asyncio.run(run())


def test_warm_path_does_not_query_per_collection(monkeypatch):
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    db = MemDB()
    tenant_db.init(db)

    async def run():
        await db.companies.insert_one({"_id": CO_A, "name": "A"})
        async with tenant_db.for_company(CO_A, "gece") as handle:
            assert storage_router.read_count == 1
            for name in ("products", "orders", "invoices", "contacts"):
                coll = handle._collection(name)
                assert coll._raw is db[name]
            assert storage_router.read_count == 1
        async with tenant_db.for_company(CO_A, "yine") as handle:
            handle._collection("products")
            assert storage_router.read_count == 1

    asyncio.run(run())


def test_decrypt_is_not_used_while_resolving(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("CREDENTIAL_ENCRYPTION_KEY", Fernet.generate_key().decode())
    import comm_service

    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")

    def boom(*_args, **_kwargs):
        raise AssertionError("DSN okunmamalı")

    monkeypatch.setattr(comm_service, "decrypt", boom)
    db = MemDB()

    async def run():
        await db.companies.insert_one(
            {"_id": CO_A, "storage_mode": "legacy", "dedicated_dsn_ref": "gAAAA-ciphertext"}
        )
        mode = await storage_router.load_mode(db, CO_A)
        assert mode == "legacy"
        raw = storage_router.legacy_collection(db, CO_A, "products")
        assert raw is db.products

    asyncio.run(run())


def test_legacy_path_microbenchmark(monkeypatch):
    """Legacy yolunda ek sorgu ve belirgin gecikme olmamalı."""
    monkeypatch.delenv("STORAGE_ROUTER_ENABLED", raising=False)
    db = MemDB()
    scope = _scope()
    tdb = tenant_db.TenantDB(db, scope)
    loops = 2500

    def direct():
        name = "products"
        raw = db[name]
        kind_tenant = True
        if kind_tenant:
            return tenant_db.ScopedCollection(raw, scope)
        return raw

    def routed():
        return tdb._collection("products")

    direct()
    routed()
    t0 = time.perf_counter()
    for _ in range(loops):
        direct()
    base = time.perf_counter() - t0
    t1 = time.perf_counter()
    for _ in range(loops):
        routed()
    off = time.perf_counter() - t1
    assert storage_router.read_count == 0
    assert off <= base * 3 + 0.05, (off, base)

    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")

    async def warm():
        await db.companies.insert_one({"_id": CO_A})
        await storage_router.load_mode(db, CO_A)

    asyncio.run(warm())
    pinned = tenant_db.TenantDB(db, scope)
    before = storage_router.read_count

    def routed_on():
        return pinned._collection("products")

    routed_on()
    t2 = time.perf_counter()
    for _ in range(loops):
        routed_on()
    warmed = time.perf_counter() - t2
    assert storage_router.read_count == before
    assert warmed <= off * 3 + 0.05, (warmed, off)


class _AsyncCompanies:
    """Gerçek sürücü: async find_one, docs listesi yok."""

    def __init__(self):
        self.rows = {}
        self.reads = 0

    async def find_one(self, query, projection=None):
        self.reads += 1
        doc = self.rows.get(str((query or {}).get("_id") or ""))
        if not doc:
            return None
        if not projection:
            return dict(doc)
        out = {"_id": doc.get("_id")}
        if doc.get("storage_mode") is not None:
            out["storage_mode"] = doc.get("storage_mode")
        return out


class _RealishDB:
    def __init__(self):
        self.companies = _AsyncCompanies()
        self._cols = {}

    def __getitem__(self, name):
        if name == "companies":
            return self.companies
        coll = self._cols.get(name)
        if coll is None:
            coll = {"name": name}
            self._cols[name] = coll
        return coll


def test_expired_cache_rereads_real_driver(monkeypatch):
    """Soğuk önbellek gerçek sürücüye gitmez. Süresi dolunca katalog yeniden okunur.

    Kurulmuş TenantDB kendi kipini değiştirmez. Yeni kurulan örnek yeni kipi görür.
    """
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    clock = {"t": 5_000.0}
    monkeypatch.setattr(storage_router, "_now", lambda: clock["t"])
    text = (_BACKEND / "storage_router.py").read_text(encoding="utf-8")
    assert "Depolama kipi önbelleği boş" not in text
    db = _RealishDB()
    db.companies.rows[CO_A] = {"_id": CO_A, "storage_mode": "legacy", "storage_epoch": 1}
    db.companies.rows[CO_B] = {"_id": CO_B, "storage_mode": "shared_v2", "storage_epoch": 2}

    async def warm():
        assert await storage_router.load_mode(db, CO_A) == "legacy"
        assert await storage_router.load_mode(db, CO_B) == "shared_v2"

    asyncio.run(warm())
    assert db.companies.reads == 2
    live = tenant_db.TenantDB(db, _scope(CO_A))
    assert live._collection("products")._raw is db["products"]

    clock["t"] += storage_router.TTL_SECONDS + 1
    db.companies.rows[CO_A]["storage_mode"] = "shared_v2"
    db.companies.rows[CO_A]["storage_epoch"] = 3
    again = live._collection("orders")
    assert again._raw is db["orders"]
    assert db.companies.reads == 2

    late = tenant_db.TenantDB(db, _scope(CO_A))
    assert type(late._collection("products")._raw).__name__ == "SharedV2Collection"
    assert db.companies.reads == 3
    shared = tenant_db.TenantDB(db, _scope(CO_B))._collection("products")
    assert type(shared._raw).__name__ == "SharedV2Collection"
    assert shared._raw.company_id == CO_B
    assert storage_shared_v2.get_store().conn is None
    assert db.companies.reads == 4

    fresh = _RealishDB()
    unseen = tenant_db.TenantDB(fresh, _scope("co_new"))
    assert unseen._collection("products")._raw is fresh["products"]
    assert fresh.companies.reads == 0


def test_entry_point_reloads_when_cache_expired(monkeypatch):
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    clock = {"t": 8_000.0}
    monkeypatch.setattr(storage_router, "_now", lambda: clock["t"])
    db = _RealishDB()
    db.companies.rows[CO_A] = {"_id": CO_A, "storage_mode": "legacy"}
    tenant_db.init(db)

    async def run():
        async with tenant_db.for_company(CO_A, "gece") as handle:
            assert handle._collection("products")._raw is db["products"]
            assert db.companies.reads == 1
        clock["t"] += storage_router.TTL_SECONDS + 1
        db.companies.rows[CO_A]["storage_mode"] = "dedicated"
        async with tenant_db.for_company(CO_A, "yenile") as handle:
            with pytest.raises(StorageModeError, match="DSN referansı yok"):
                handle._collection("products")
        assert db.companies.reads == 3

    asyncio.run(run())


def test_cache_drops_oldest_past_max(monkeypatch):
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    monkeypatch.setattr(storage_router, "CACHE_MAX", 2)
    db = MemDB()

    async def run():
        for cid in ("c1", "c2", "c3"):
            await db.companies.insert_one({"_id": cid, "storage_mode": "legacy"})
            assert await storage_router.load_mode(db, cid) == "legacy"
        assert "c1" not in storage_router._cache
        assert list(storage_router._cache) == ["c2", "c3"]
        assert storage_router._cached("c2") == "legacy"
        await db.companies.insert_one({"_id": "c4", "storage_mode": "legacy"})
        assert await storage_router.load_mode(db, "c4") == "legacy"
        assert "c3" not in storage_router._cache
        assert list(storage_router._cache) == ["c2", "c4"]

    asyncio.run(run())


def test_existing_tenant_db_suite_same_with_flag_on(monkeypatch):
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    import test_tenant_db as existing

    storage_router.reset()
    existing.test_tenant_db_routes_kinds()
    storage_router.reset()
    existing.test_get_tenant_db_binds_resets_and_rejects()
    storage_router.reset()
    existing.test_for_company_and_b2b_contact_bind_and_isolate()
