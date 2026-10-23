"""Dedicated DSN önbelleği ve pazaryeri yazma kilidi.

Canlı veritabanına ve 8021 portuna bağlanmaz. DSN, parola, ETTN ve VKN loglanmaz.
"""
from __future__ import annotations

import asyncio
import logging
import os
import sqlite3
import sys
from pathlib import Path

import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

from dashboard_memdb import MemDB  # noqa: E402
import server  # noqa: E402
import storage_dedicated  # noqa: E402
import storage_router  # noqa: E402
from storage_dedicated import DedicatedStorageError  # noqa: E402
from storage_migrations.engine import apply  # noqa: E402
from storage_migrations.session import connect  # noqa: E402

CO = "co_worker"
SECRET = "dsn-secret-token"
ETTN = "ETTN-GIZLI-TOKEN"
VKN = "VKN-GIZLI-TOKEN"
CUSTOMER = "Musteri-Gizli-Ad"


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    storage_router.reset()
    monkeypatch.delenv("STORAGE_ROUTER_ENABLED", raising=False)
    server.clear_marketplace_holds()
    yield
    server.clear_marketplace_holds()
    storage_router.reset()


def _seal(monkeypatch, tmp_path):
    previous = os.environ.get("CREDENTIAL_ENCRYPTION_KEY")
    monkeypatch.setenv("CREDENTIAL_ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    import comm_service

    comm_service.reset_fernet_for_tests()
    return previous, comm_service


def _restore(monkeypatch, previous, comm_service):
    if previous is None:
        monkeypatch.delenv("CREDENTIAL_ENCRYPTION_KEY", raising=False)
    else:
        monkeypatch.setenv("CREDENTIAL_ENCRYPTION_KEY", previous)
    comm_service.reset_fernet_for_tests()


def _migrate(dsn: str) -> None:
    session = connect(dsn, write=True)
    try:
        apply(session, confirm=True, dry_run=False)
    finally:
        session.close()


def _bodies(path: Path, collection: str) -> list:
    conn = sqlite3.connect(path)
    try:
        rows = conn.execute(
            "SELECT doc FROM storage_records WHERE collection = ?",
            (collection,),
        ).fetchall()
    finally:
        conn.close()
    return [row[0] for row in rows]


class Companies:
    """docs listesi yok. Projeksiyon istenen alanları döner."""

    def __init__(self, doc: dict):
        self.doc = doc
        self.reads = 0

    async def find_one(self, query, projection=None):
        self.reads += 1
        if str((query or {}).get("_id") or "") != str(self.doc.get("_id") or ""):
            return None
        if not projection:
            return dict(self.doc)
        out = {"_id": self.doc.get("_id")}
        for key, flag in projection.items():
            if key == "_id" or not flag:
                continue
            if key in self.doc:
                out[key] = self.doc[key]
        return out


class Catalog:
    def __init__(self, doc: dict):
        self.companies = Companies(doc)

    def __getitem__(self, name):
        if name == "companies":
            return self.companies
        raise KeyError(name)


class LegacyColl:
    def __init__(self, db, name: str):
        self._db = db
        self.name = name
        self.writes = []

    async def insert_one(self, doc):
        self.writes.append(doc)


class CountColl:
    def __init__(self, name: str):
        self.name = name
        self.updates = 0

    async def update_one(self, *args, **kwargs):
        self.updates += 1
        raise AssertionError(self.name)

    async def insert_one(self, *args, **kwargs):
        self.updates += 1
        raise AssertionError(self.name)

    async def find_one(self, *args, **kwargs):
        return None


class EffectDB(Catalog):
    def __init__(self, doc: dict):
        super().__init__(doc)
        self.contacts = CountColl("contacts")
        self.products = CountColl("products")
        self.invoices = CountColl("invoices")

    def __getitem__(self, name):
        return getattr(self, name)


def _sales_invoice() -> dict:
    return {
        "_id": "inv_worker",
        "company_id": CO,
        "invoice_type": "sales",
        "status": "approved",
        "contact_id": "cnt_worker",
        "grand_total": 10,
        "currency": "TRY",
        "ettn": ETTN,
        "contact_tax_id": VKN,
        "items": [{"product_id": "prd_worker", "quantity": 1, "unit_price": 10}],
    }


def test_worker_cached_as_legacy_writes_after_move(monkeypatch, tmp_path, caplog):
    """Taşımadan önce legacy önbelleği olan işçi, epoch 1 yazısını dedicated depoya bırakır."""
    previous, comm_service = _seal(monkeypatch, tmp_path)
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    clock = {"t": 1000.0}
    monkeypatch.setattr(storage_router, "_now", lambda: clock["t"])
    try:
        path = tmp_path / SECRET / "worker.db"
        path.parent.mkdir()
        dsn = f"sqlite:///{path}"
        _migrate(dsn)
        sealed = storage_router.seal_dedicated_dsn(dsn)
        assert SECRET not in sealed
        company = {
            "_id": CO,
            "storage_mode": "legacy",
            "storage_epoch": 0,
            "storage_write_lock": False,
        }
        db = Catalog(company)
        legacy = LegacyColl(db, "contacts")

        async def run():
            assert await storage_router.load_mode(db, CO) == "legacy"
            company["storage_mode"] = "dedicated"
            company["storage_epoch"] = 1
            company["dedicated_dsn_ref"] = sealed
            clock["t"] += storage_router.mode_ttl() + storage_router.lock_ttl() + 5
            assert await storage_router.load_mode(db, CO) == "dedicated"
            assert storage_dedicated.ref_ready(CO, 1) is False
            doc = {"_id": "ct_worker", "company_id": CO, "name": "Cari"}
            routed = await storage_router.route_legacy_write(legacy, "insert_one", doc=doc)
            assert routed is not None
            assert type(routed).__name__ == "DedicatedCollection"
            await routed.insert_one(doc)
            assert legacy.writes == []

        with caplog.at_level(logging.DEBUG):
            asyncio.run(run())
        bodies = _bodies(path, "contacts")
        assert len(bodies) == 1
        assert "ct_worker" in bodies[0]
        assert SECRET not in caplog.text
        assert "sqlite://" not in caplog.text
        assert ETTN not in caplog.text
    finally:
        _restore(monkeypatch, previous, comm_service)


def test_missing_dsn_ref_fails_before_invoice_writes(monkeypatch, tmp_path, caplog):
    """Ref gerçekten yoksa hata, cari/stok/fatura yazısından önce çıkar."""
    previous, comm_service = _seal(monkeypatch, tmp_path)
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    company = {
        "_id": CO,
        "storage_mode": "dedicated",
        "storage_epoch": 1,
        "storage_write_lock": False,
    }
    effect = EffectDB(company)
    legacy = LegacyColl(effect, "contacts")
    previous_db = server.db
    server.db = effect
    try:
        async def run():
            assert await storage_router.load_mode(effect, CO) == "dedicated"
            assert storage_dedicated.ref_ready(CO, 1) is False
            with pytest.raises(DedicatedStorageError, match="DSN referansı"):
                await storage_router.route_legacy_write(
                    legacy, "insert_one", doc={"_id": "ct_x", "company_id": CO, "name": "Cari"},
                )
            assert legacy.writes == []
            invoice = _sales_invoice()
            with pytest.raises(DedicatedStorageError, match="DSN referansı"):
                await server._reverse_invoice_effects(invoice)
            with pytest.raises(HTTPException) as caught:
                await server._commit_invoice_effects_update(invoice, invoice["_id"], {"notes": "n"}, True)
            assert caught.value.status_code == 500
            assert "geri alınamadı" in str(caught.value.detail)

        with caplog.at_level(logging.DEBUG):
            asyncio.run(run())
        assert effect.contacts.updates == 0
        assert effect.products.updates == 0
        assert effect.invoices.updates == 0
        assert SECRET not in caplog.text
        assert ETTN not in caplog.text
        assert VKN not in caplog.text
        assert "sqlite://" not in caplog.text
    finally:
        server.db = previous_db
        _restore(monkeypatch, previous, comm_service)


def test_marketplace_lock_keeps_order_for_next_sync(monkeypatch, caplog):
    """Yazma kilidi siparişi düşürmez. Sonraki senkron aynı gövdeyi yazar ve imleci ancak o zaman ilerletir."""
    db = MemDB()
    previous_db = server.db
    server.db = db
    gate = {"on": True}
    orders = db.orders
    real_insert = orders.insert_one
    real_update = orders.update_one

    async def insert_one(doc):
        if gate["on"]:
            raise storage_router.StorageWriteLocked(storage_router.WRITE_LOCK_MESSAGE, company_id="co_market")
        return await real_insert(doc)

    async def update_one(query, update, upsert=False):
        if gate["on"]:
            raise storage_router.StorageWriteLocked(storage_router.WRITE_LOCK_MESSAGE, company_id="co_market")
        return await real_update(query, update, upsert=upsert)

    orders.insert_one = insert_one
    orders.update_one = update_one

    async def _none(*_args, **_kwargs):
        return None

    monkeypatch.setattr(server, "_ensure_order_contact", _none)
    monkeypatch.setattr(server, "_attach_draft_invoice_on_intake", _none)
    monkeypatch.setattr(server, "_try_shopphp_settlement", _none)
    monkeypatch.setattr(server, "_notify_marketplace_inserted", _none)

    try:
        async def run():
            incoming = [
                {"channel": "hepsiburada", "order_number": "HB-1", "customer_name": CUSTOMER, "total_amount": 10, "items": []},
                {"channel": "hepsiburada", "order_number": "HB-2", "customer_name": CUSTOMER, "total_amount": 12, "items": []},
            ]
            locked = await server._upsert_marketplace_orders("co_market", incoming)
            assert locked["inserted"] == 0
            assert locked["held"] == 2
            assert await db.orders.count_documents({"company_id": "co_market"}) == 0
            assert len(server._marketplace_holds) == 2
            gate["on"] = False
            replayed = await server._replay_marketplace_holds("co_market")
            assert replayed["inserted"] == 2
            assert int(replayed.get("held") or 0) == 0
            assert server._marketplace_holds == {}
            rows = await db.orders.find({"company_id": "co_market"}).to_list(10)
            assert {row["order_number"] for row in rows} == {"HB-1", "HB-2"}

            gate["on"] = True
            await db.orders.delete_many({"company_id": "co_market"})
            await db.integration_configs.insert_one({
                "_id": "ch_hb",
                "company_id": "co_market",
                "channel": "hepsiburada",
                "channel_name": "Hepsiburada",
            })
            held_sync = await server._sync_ecommerce_channel_core("ch_hb", days=14)
            assert held_sync["status"] == "held"
            cfg = await db.integration_configs.find_one({"_id": "ch_hb", "company_id": "co_market"})
            assert cfg.get("last_synced_at") is None
            assert "bekletildi" in (cfg.get("last_error") or "")
            numbers = [row["doc"]["order_number"] for row in server._marketplace_holds.values()]
            assert numbers
            gate["on"] = False
            again = await server._sync_ecommerce_channel_core("ch_hb", days=3)
            assert again["status"] == "success"
            assert "held" not in again
            cfg = await db.integration_configs.find_one({"_id": "ch_hb", "company_id": "co_market"})
            assert cfg.get("last_synced_at")
            found = await db.orders.find({"company_id": "co_market", "order_number": {"$in": numbers}}).to_list(10)
            assert {row["order_number"] for row in found} == set(numbers)

        with caplog.at_level(logging.DEBUG):
            asyncio.run(run())
        assert CUSTOMER not in caplog.text
        assert ETTN not in caplog.text
        assert VKN not in caplog.text
    finally:
        server.db = previous_db
        server.clear_marketplace_holds()
