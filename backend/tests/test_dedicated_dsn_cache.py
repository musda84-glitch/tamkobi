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
import bank_tx_page  # noqa: E402
import mysql_store  # noqa: E402
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


class LateCompanies:
    """İlk okuma DSN alanını düşürür. İkinci okuma mühürü verir."""

    def __init__(self, doc: dict, sealed: str = ""):
        self.doc = dict(doc)
        self.sealed = sealed
        self.reads = 0

    async def find_one(self, query, projection=None):
        self.reads += 1
        body = dict(self.doc)
        if self.reads >= 2 and self.sealed:
            body[storage_router.DSN_FIELD] = self.sealed
        if str((query or {}).get("_id") or "") != str(body.get("_id") or ""):
            return None
        if not projection:
            return body
        out = {"_id": body.get("_id")}
        for key, flag in projection.items():
            if key == "_id" or not flag:
                continue
            if key in body:
                out[key] = body[key]
        return out


class LateCatalog:
    def __init__(self, companies: LateCompanies):
        self.companies = companies

    def __getitem__(self, name):
        if name == "companies":
            return self.companies
        raise KeyError(name)


def test_dsn_reread_serves_every_collection(monkeypatch, tmp_path, caplog):
    """İlk katalog anlığı ref'siz. İkinci okuma yazmayı orders dahil her ada bırakır."""
    previous, comm_service = _seal(monkeypatch, tmp_path)
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    try:
        path = tmp_path / SECRET / "retry.db"
        path.parent.mkdir()
        dsn = f"sqlite:///{path}"
        _migrate(dsn)
        sealed = storage_router.seal_dedicated_dsn(dsn)
        company = {
            "_id": CO,
            "storage_mode": "dedicated",
            "storage_epoch": 1,
            "storage_write_lock": False,
        }
        companies = LateCompanies(company, sealed)
        db = LateCatalog(companies)
        contacts = LegacyColl(db, "contacts")
        orders = LegacyColl(db, "orders")

        async def run():
            contact = {"_id": "ct_worker", "company_id": CO, "name": "Cari"}
            routed = await storage_router.route_legacy_write(contacts, "insert_one", doc=contact)
            await routed.insert_one(contact)
            assert companies.reads == 2
            routed = await storage_router.route_legacy_write(
                contacts, "update_one",
                query={"_id": "ct_worker", "company_id": CO},
                update={"$set": {"name": "Cari-2"}},
            )
            await routed.update_one({"_id": "ct_worker", "company_id": CO}, {"$set": {"name": "Cari-2"}})
            order = {"_id": "ord_worker", "company_id": CO, "order_number": "S-1"}
            routed = await storage_router.route_legacy_write(orders, "insert_one", doc=order)
            await routed.insert_one(order)
            routed = await storage_router.route_legacy_write(
                orders, "update_many",
                query={"company_id": CO},
                update={"$set": {"printed": True}},
            )
            await routed.update_many({"company_id": CO}, {"$set": {"printed": True}})
            assert companies.reads == 2
            assert contacts.writes == []
            assert orders.writes == []

        with caplog.at_level(logging.DEBUG):
            asyncio.run(run())
        contact_body = _bodies(path, "contacts")
        order_body = _bodies(path, "orders")
        assert len(contact_body) == 1 and "Cari-2" in contact_body[0]
        assert len(order_body) == 1 and "printed" in order_body[0]
        assert SECRET not in caplog.text
        assert "sqlite://" not in caplog.text
    finally:
        _restore(monkeypatch, previous, comm_service)


def test_second_catalog_read_still_missing_dsn_writes_nothing(monkeypatch, tmp_path, caplog):
    """İkinci okuma da boşsa hata çıkar, sqlite dosyası açılmaz."""
    previous, comm_service = _seal(monkeypatch, tmp_path)
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    try:
        path = tmp_path / SECRET / "missing.db"
        company = {
            "_id": CO,
            "storage_mode": "dedicated",
            "storage_epoch": 1,
            "storage_write_lock": False,
        }
        companies = LateCompanies(company, "")
        db = LateCatalog(companies)
        orders = LegacyColl(db, "orders")

        async def run():
            with pytest.raises(DedicatedStorageError, match="DSN referansı yok"):
                await storage_router.route_legacy_write(
                    orders, "insert_one", doc={"_id": "ord_x", "company_id": CO},
                )
            with pytest.raises(DedicatedStorageError, match="DSN referansı yok"):
                await storage_router.route_legacy_write(
                    orders, "update_one",
                    query={"_id": "ord_x", "company_id": CO},
                    update={"$set": {"printed": True}},
                )
            with pytest.raises(DedicatedStorageError, match="DSN referansı yok"):
                await storage_router.route_legacy_write(
                    orders, "update_many",
                    query={"company_id": CO},
                    update={"$set": {"printed": True}},
                )
            assert companies.reads == 6
            assert orders.writes == []

        with caplog.at_level(logging.DEBUG):
            asyncio.run(run())
        assert not path.exists()
        assert SECRET not in caplog.text
        assert "sqlite://" not in caplog.text
    finally:
        _restore(monkeypatch, previous, comm_service)


def test_product_failure_undoes_contact_balance():
    """Cari $inc yazıldıktan sonra stok düşerse bakiye ve stok başa döner."""
    db = MemDB()
    previous = server.db
    server.db = db
    try:
        async def run():
            await db.contacts.insert_one({"_id": "cnt_worker", "company_id": CO, "balance": 10})
            await db.products.insert_one({"_id": "prd_worker", "company_id": CO, "stock_quantity": 5})
            await db.stock_lots.insert_one({
                "_id": "lot_worker", "company_id": CO, "quantity": 4, "is_active": True,
            })

            async def reject_stock(query, update, upsert=False):
                raise RuntimeError("stok yazılamadı")

            db.products.update_one = reject_stock
            invoice = _sales_invoice()
            invoice["items"] = [{
                "product_id": "prd_worker", "quantity": 1, "unit_price": 10, "lot_id": "lot_worker",
            }]
            with pytest.raises(RuntimeError, match="stok yazılamadı"):
                await server._apply_invoice_effects(invoice)
            contact = await db.contacts.find_one({"_id": "cnt_worker", "company_id": CO})
            product = await db.products.find_one({"_id": "prd_worker", "company_id": CO})
            lot = await db.stock_lots.find_one({"_id": "lot_worker", "company_id": CO})
            assert contact["balance"] == 10
            assert product["stock_quantity"] == 5
            assert lot["quantity"] == 4
            assert lot["is_active"] is True

        asyncio.run(run())
    finally:
        server.db = previous


def test_lot_failure_restores_snapshot(monkeypatch):
    """Lot yazısı düşerse miktar anlığı, cari ve stok birlikte geri alınır."""
    db = MemDB()
    previous = server.db
    server.db = db
    real_lot = server._apply_lot_delta

    async def boom(item, sign, company_id):
        await real_lot(item, sign, company_id)
        raise RuntimeError("lot yazılamadı")

    monkeypatch.setattr(server, "_apply_lot_delta", boom)
    try:
        async def run():
            await db.contacts.insert_one({"_id": "cnt_worker", "company_id": CO, "balance": 10})
            await db.products.insert_one({"_id": "prd_worker", "company_id": CO, "stock_quantity": 5})
            await db.stock_lots.insert_one({
                "_id": "lot_worker", "company_id": CO, "quantity": 4, "is_active": True,
            })
            invoice = _sales_invoice()
            invoice["items"] = [{
                "product_id": "prd_worker", "quantity": 1, "unit_price": 10, "lot_id": "lot_worker",
            }]
            with pytest.raises(RuntimeError, match="lot yazılamadı"):
                await server._apply_invoice_effects(invoice)
            contact = await db.contacts.find_one({"_id": "cnt_worker", "company_id": CO})
            product = await db.products.find_one({"_id": "prd_worker", "company_id": CO})
            lot = await db.stock_lots.find_one({"_id": "lot_worker", "company_id": CO})
            assert contact["balance"] == 10
            assert product["stock_quantity"] == 5
            assert lot["quantity"] == 4
            assert lot["is_active"] is True

        asyncio.run(run())
    finally:
        server.db = previous


def test_commit_failure_restores_invoice_and_old_effects():
    """Yeniden uygulama düşünce not eski kalır, cari eski etkisine döner."""
    db = MemDB()
    previous = server.db
    server.db = db
    try:
        async def run():
            await db.contacts.insert_one({"_id": "cnt_worker", "company_id": CO, "balance": 100})
            await db.products.insert_one({"_id": "prd_worker", "company_id": CO, "stock_quantity": 5})
            invoice = _sales_invoice()
            invoice["notes"] = "eski"
            invoice["effects_applied"] = True
            await db.invoices.insert_one(dict(invoice))
            real = db.products.update_one
            state = {"neg": 0}

            async def update_one(query, update, upsert=False):
                inc = (update or {}).get("$inc") or {}
                if float(inc.get("stock_quantity") or 0) < 0:
                    state["neg"] += 1
                    if state["neg"] == 1:
                        raise RuntimeError("stok yazılamadı")
                return await real(query, update, upsert=upsert)

            db.products.update_one = update_one
            with pytest.raises(HTTPException) as caught:
                await server._commit_invoice_effects_update(
                    invoice, invoice["_id"], {"notes": "yeni"}, True,
                )
            assert caught.value.status_code == 500
            assert "geri alındı" in str(caught.value.detail)
            saved = await db.invoices.find_one({"_id": invoice["_id"], "company_id": CO})
            contact = await db.contacts.find_one({"_id": "cnt_worker", "company_id": CO})
            product = await db.products.find_one({"_id": "prd_worker", "company_id": CO})
            assert saved["notes"] == "eski"
            assert saved.get("updated_at")
            assert contact["balance"] == 100
            assert product["stock_quantity"] == 5

        asyncio.run(run())
    finally:
        server.db = previous


def test_invoice_edit_stamps_updated_at(monkeypatch):
    """Düzenleme ve GİB kilitli vade/not yolu updated_at yazar."""
    db = MemDB()
    previous = server.db
    server.db = db
    try:
        async def run():
            draft = _sales_invoice()
            draft["status"] = "draft"
            draft["effects_applied"] = False
            draft["notes"] = "eski"
            await db.invoices.insert_one(dict(draft))
            updated = await server._commit_invoice_effects_update(
                draft, draft["_id"], {"notes": "yeni"}, False,
            )
            assert updated["notes"] == "yeni"
            assert updated.get("updated_at")

            locked = {
                "_id": "inv_gib",
                "company_id": CO,
                "status": "approved",
                "invoice_type": "sales",
                "e_type": "efatura",
                "einvoice_state": "sent",
                "notes": "eski not",
                "due_date": "2026-01-01",
            }
            await db.invoices.insert_one(locked)

            async def get_doc(*_args, **_kwargs):
                return await db.invoices.find_one({"_id": "inv_gib", "company_id": CO})

            monkeypatch.setattr(server.tenant_access, "get_tenant_doc", get_doc)
            out = await server.update_invoice("inv_gib", {"notes": "yeni not"}, {"company_id": CO})
            assert out["notes"] == "yeni not"
            assert out.get("updated_at")

        asyncio.run(run())
    finally:
        server.db = previous


class StartupCompanies:
    """docs listesi yok. Projeksiyon dedicated_dsn_ref alanını düşürür.

    Sorgudaki `_id` belge `_id` veya JSON `id` ile eşleşir.
    """

    def __init__(self, rows: list):
        self.rows = [dict(row) for row in rows]

    def _hit(self, doc: dict, want: str) -> bool:
        return str(doc.get("_id") or "") == want or str(doc.get("id") or "") == want

    def _shape(self, doc: dict, projection):
        body = dict(doc)
        if not projection:
            return body
        out = {"_id": body.get("_id")}
        for key, flag in projection.items():
            if key == "_id" or not flag or key == storage_router.DSN_FIELD:
                continue
            if key in body:
                out[key] = body[key]
        return out

    async def find_one(self, query, projection=None):
        want = str((query or {}).get("_id") or "")
        for doc in self.rows:
            if self._hit(doc, want):
                return self._shape(doc, projection)
        return None

    def find(self, query=None, projection=None):
        want = str((query or {}).get("_id") or "")
        rows = self.rows if not want else [doc for doc in self.rows if self._hit(doc, want)]
        return [self._shape(doc, projection) for doc in rows]


class StartupCatalog:
    def __init__(self, companies: StartupCompanies):
        self.companies = companies

    def __getitem__(self, name):
        if name == "companies":
            return self.companies
        raise KeyError(name)


def test_fresh_startup_resolves_dsn_without_mode_projection(monkeypatch, tmp_path, caplog):
    """Taze süreç: kip projeksiyonu mühürü taşımaz, koleksiyon açılışı şirket adıyla düşer.

    Tam belge okununca hem istek yazısı hem açılış ısıtması dedicated depoya gider.
    Satır kimliği ile JSON id ayrı olsa da ref şirket kimliğine bağlanır.
    """
    previous, comm_service = _seal(monkeypatch, tmp_path)
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    fresh = "comp_505a96e8"
    alias = "comp_9039c0ec"
    missing = "comp_missing"
    try:
        path_a = tmp_path / SECRET / "startup-a.db"
        path_b = tmp_path / SECRET / "startup-b.db"
        path_a.parent.mkdir()
        dsn_a = f"sqlite:///{path_a}"
        dsn_b = f"sqlite:///{path_b}"
        _migrate(dsn_a)
        _migrate(dsn_b)
        sealed_a = storage_router.seal_dedicated_dsn(dsn_a)
        sealed_b = storage_router.seal_dedicated_dsn(dsn_b)
        companies = StartupCompanies([
            {
                "_id": fresh,
                "storage_mode": "dedicated",
                "storage_epoch": 1,
                "storage_write_lock": False,
                storage_router.DSN_FIELD: sealed_a,
            },
            {
                "_id": "row_9039",
                "id": alias,
                "storage_mode": "dedicated",
                "storage_epoch": 1,
                "storage_write_lock": False,
                storage_router.DSN_FIELD: sealed_b,
            },
            {
                "_id": missing,
                "storage_mode": "dedicated",
                "storage_epoch": 1,
                "storage_write_lock": False,
            },
            {"_id": "comp_legacy", "storage_mode": "legacy"},
        ])
        db = StartupCatalog(companies)
        orders = LegacyColl(db, "orders")
        absent = tmp_path / "absent.db"

        async def run():
            assert await storage_router.load_mode(db, fresh) == "dedicated"
            assert storage_dedicated.ref_ready(fresh, 1) is False
            with pytest.raises(DedicatedStorageError) as first:
                storage_dedicated.collection(db, fresh, "orders")
            assert str(first.value) == f"Dedicated DSN referansı yok. company={fresh}"
            assert await storage_router.load_mode(db, alias) == "dedicated"
            assert storage_dedicated.ref_ready(alias, 1) is False
            with pytest.raises(DedicatedStorageError) as second:
                storage_dedicated.collection(db, alias, "orders")
            assert str(second.value) == f"Dedicated DSN referansı yok. company={alias}"

            order_a = {"_id": "ord_a", "company_id": fresh, "order_number": "S-A"}
            routed = await storage_router.route_legacy_write(orders, "insert_one", doc=order_a)
            await routed.insert_one(order_a)
            order_b = {"_id": "ord_b", "company_id": alias, "order_number": "S-B"}
            routed = await storage_router.route_legacy_write(orders, "insert_one", doc=order_b)
            await routed.insert_one(order_b)

            storage_router.reset()
            monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
            report = await storage_router.warm_dedicated_refs(db)
            by_id = {row["company_id"]: row["dedicated_dsn_ref"] for row in report}
            assert by_id == {fresh: "var", alias: "var", missing: "yok"}
            assert storage_dedicated.ref_ready(fresh, 1) is True
            assert storage_dedicated.ref_ready(alias, 1) is True
            assert storage_dedicated.ref_ready(missing, 1) is False
            storage_dedicated.collection(db, fresh, "orders")
            storage_dedicated.collection(db, alias, "products")
            with pytest.raises(DedicatedStorageError) as third:
                await storage_router.route_legacy_write(
                    orders, "insert_one", doc={"_id": "ord_x", "company_id": missing},
                )
            assert f"company={missing}" in str(third.value)
            warmed = {"_id": "ord_a2", "company_id": fresh, "order_number": "S-A2"}
            routed = await storage_router.route_legacy_write(orders, "insert_one", doc=warmed)
            await routed.insert_one(warmed)
            assert orders.writes == []

        with caplog.at_level(logging.INFO):
            asyncio.run(run())
        assert len(_bodies(path_a, "orders")) == 2
        assert len(_bodies(path_b, "orders")) == 1
        assert not absent.exists()
        text = caplog.text
        assert f"dedicated ref kontrol company={fresh} dedicated_dsn_ref=var" in text
        assert f"dedicated ref kontrol company={alias} dedicated_dsn_ref=var" in text
        assert f"dedicated ref kontrol company={missing} dedicated_dsn_ref=yok" in text
        assert SECRET not in text
        assert "gAAAA" not in text
        assert "sqlite://" not in text
    finally:
        _restore(monkeypatch, previous, comm_service)


class _MemoryCompanies:
    def __init__(self, doc: dict):
        self.docs = [dict(doc)]


class _ReadCatalog:
    def __init__(self, doc: dict):
        self.companies = _MemoryCompanies(doc)

    def __getitem__(self, name):
        if name == "companies":
            return self.companies
        raise KeyError(name)


def _ban_catalog(coll):
    async def boom(*_args, **_kwargs):
        raise AssertionError("paylaşılan katalog okundu")

    coll._load_filtered = boom
    coll._read_page = boom
    coll._fetch_rows = boom


def test_bank_reads_use_dedicated_store(monkeypatch, tmp_path, caplog):
    """Web ve mobil aynı GET uçlarını kullanır. Okuma dedicated depoya gider.

    Paylaşılan docs ve ham SQL boş 200 üretmez. DSN yoksa hata çıkar.
    Taşımanın yazarı katalogda kalır.
    """
    previous, comm_service = _seal(monkeypatch, tmp_path)
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    monkeypatch.setenv("MYSQL_STORE_SQL_PUSHDOWN", "1")
    fresh = "comp_505a96e8"
    try:
        path = tmp_path / SECRET / "bank.db"
        path.parent.mkdir()
        dsn = f"sqlite:///{path}"
        _migrate(dsn)
        sealed = storage_router.seal_dedicated_dsn(dsn)
        company = {
            "_id": fresh,
            "storage_mode": "dedicated",
            "storage_epoch": 1,
            "storage_write_lock": False,
            storage_router.DSN_FIELD: sealed,
        }
        db = _ReadCatalog(company)
        names = (
            "bank_transactions",
            "bank_accounts",
            "partners",
            "partner_transactions",
            "cash_approval_requests",
        )

        async def seed():
            for name in names:
                await storage_dedicated.collection(db, fresh, name).insert_one({
                    "_id": f"{name}_row",
                    "company_id": fresh,
                    "account_id": "acc_matek",
                    "partner_id": "par_matek",
                    "type": "outflow",
                    "amount": 40,
                    "date": "2026-10-01",
                    "description": "Matek havale",
                    "status": "pending",
                })

        asyncio.run(seed())

        async def run():
            found = {}
            for name in names:
                coll = mysql_store.MySQLCollection(db, name)
                _ban_catalog(coll)
                rows = await coll.find({"company_id": fresh}).sort("date", -1).to_list(50)
                assert [row["_id"] for row in rows] == [f"{name}_row"]
                one = await coll.find_one({"company_id": fresh, "_id": f"{name}_row"})
                assert one["_id"] == f"{name}_row"
                assert await coll.count_documents({"company_id": fresh}) == 1
                found[name] = rows
            txs = mysql_store.MySQLCollection(db, "bank_transactions")
            _ban_catalog(txs)
            db.bank_transactions = txs
            page = await bank_tx_page.list_account_transactions(
                db,
                {"_id": "acc_matek", "company_id": fresh, "account_name": "Matek", "type": "bank"},
                page=1,
                page_size=50,
            )
            assert page["total"] == 1
            assert page["page_size"] == 50
            assert page["items"][0]["id"] == "bank_transactions_row"
            assert page["items"][0]["description"] == "Matek havale"
            grouped = await txs.aggregate([
                {"$match": {"company_id": fresh, "type": "outflow"}},
                {"$group": {"_id": "$account_id", "month_out": {"$sum": "$amount"}}},
            ]).to_list(None)
            assert grouped and grouped[0]["_id"] == "acc_matek"
            assert float(grouped[0]["month_out"]) == 40.0

            shared = mysql_store.MySQLCollection(db, "bank_transactions")

            async def catalog_rows(*_args, **_kwargs):
                return [{"_id": "shared_tx", "company_id": fresh, "amount": 1}]

            shared._load_filtered = catalog_rows
            shared._read_page = catalog_rows
            with storage_router.bypass_write_lock(fresh):
                held = await shared.find({"company_id": fresh}).to_list(10)
            assert [row["_id"] for row in held] == ["shared_tx"]
            return found

        with caplog.at_level(logging.DEBUG):
            asyncio.run(run())
        assert SECRET not in caplog.text
        assert "gAAAA" not in caplog.text
        assert "sqlite://" not in caplog.text
    finally:
        _restore(monkeypatch, previous, comm_service)


def test_bank_read_missing_dsn_is_not_an_empty_catalog(monkeypatch, tmp_path, caplog):
    """DSN yoksa paylaşılan katalog boş liste dönmez."""
    previous, comm_service = _seal(monkeypatch, tmp_path)
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    fresh = "comp_505a96e8"
    try:
        company = {
            "_id": fresh,
            "storage_mode": "dedicated",
            "storage_epoch": 1,
            "storage_write_lock": False,
        }
        db = _ReadCatalog(company)
        coll = mysql_store.MySQLCollection(db, "bank_transactions")
        _ban_catalog(coll)

        async def run():
            with pytest.raises(DedicatedStorageError, match=rf"company={fresh}"):
                await coll.find({"company_id": fresh, "account_id": "acc_matek"}).to_list(50)
            with pytest.raises(DedicatedStorageError, match=rf"company={fresh}"):
                await coll.find_one({"company_id": fresh})
            with pytest.raises(DedicatedStorageError, match=rf"company={fresh}"):
                await coll.aggregate([
                    {"$match": {"company_id": fresh}},
                ]).to_list(None)

        with caplog.at_level(logging.DEBUG):
            asyncio.run(run())
        assert SECRET not in caplog.text
        assert "sqlite://" not in caplog.text
    finally:
        _restore(monkeypatch, previous, comm_service)


def test_database_name_is_not_the_company_id(monkeypatch, tmp_path, caplog):
    """tamkobi_c_505a96e8 veritabanı adıdır. DSN araması comp_505a96e8 kullanır."""
    previous, comm_service = _seal(monkeypatch, tmp_path)
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    fresh = "comp_505a96e8"
    try:
        assert storage_router.canonical_company_id(fresh) == fresh
        assert storage_router.canonical_company_id("comp_nexus_main_01") == "comp_nexus_main_01"
        assert storage_router.canonical_company_id("505a96e8") == "505a96e8"
        assert storage_router.canonical_company_id("c_505a96e8") == fresh
        assert storage_router.canonical_company_id("tamkobi_c_505a96e8") == fresh
        assert storage_router.dedicated_database_name(fresh) == "tamkobi_c_505a96e8"
        assert storage_router.dedicated_database_name("tamkobi_c_505a96e8") == "tamkobi_c_505a96e8"
        path = tmp_path / "alias.db"
        dsn = f"sqlite:///{path}"
        _migrate(dsn)
        sealed = storage_router.seal_dedicated_dsn(dsn)
        company = {
            "_id": fresh,
            "storage_mode": "dedicated",
            "storage_epoch": 1,
            "storage_write_lock": False,
            storage_router.DSN_FIELD: sealed,
        }

        class _AliasCompanies:
            def __init__(self, doc):
                self.docs = [dict(doc)]
                self.queries = []

            async def find_one(self, query, projection=None):
                self.queries.append(dict(query))
                if str((query or {}).get("_id") or "") == fresh:
                    return dict(self.docs[0])
                return None

        class _AliasDb:
            def __init__(self, doc):
                self.companies = _AliasCompanies(doc)

            def __getitem__(self, name):
                if name == "companies":
                    return self.companies
                raise KeyError(name)

        db = _AliasDb(company)

        async def run():
            mode = await storage_router.load_mode(db, "tamkobi_c_505a96e8")
            assert mode == "dedicated"
            assert db.companies.queries[0]["_id"] == fresh
            opened = storage_dedicated.collection(db, "c_505a96e8", "bank_transactions")
            assert opened.company_id == fresh
            await opened.insert_one({
                "_id": "tx_alias",
                "company_id": fresh,
                "amount": 1,
                "type": "outflow",
            })
            rows = await opened.find({"company_id": fresh}).to_list(5)
            assert [row["_id"] for row in rows] == ["tx_alias"]

        with caplog.at_level(logging.DEBUG):
            asyncio.run(run())
        assert SECRET not in caplog.text
        assert "gAAAA" not in caplog.text
        assert "sqlite://" not in caplog.text
    finally:
        _restore(monkeypatch, previous, comm_service)


def test_read_and_write_share_decision_and_refuse_catalog(monkeypatch, tmp_path):
    """Yazılan satır aynı depodan okunur. Katalog yolu dedicated şirkete kapalıdır."""
    previous, comm_service = _seal(monkeypatch, tmp_path)
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    monkeypatch.setenv("MYSQL_STORE_SQL_PUSHDOWN", "1")
    fresh = "comp_505a96e8"
    try:
        path = tmp_path / "round.db"
        dsn = f"sqlite:///{path}"
        _migrate(dsn)
        sealed = storage_router.seal_dedicated_dsn(dsn)
        company = {
            "_id": fresh,
            "storage_mode": "dedicated",
            "storage_epoch": 1,
            "storage_write_lock": False,
            storage_router.DSN_FIELD: sealed,
        }
        db = _ReadCatalog(company)
        decisions = {"n": 0}
        real_decision = storage_router.storage_decision

        async def _count_decision(database, company_id):
            decisions["n"] += 1
            return await real_decision(database, company_id)

        monkeypatch.setattr(storage_router, "storage_decision", _count_decision)

        async def run():
            coll = mysql_store.MySQLCollection(db, "bank_transactions")

            async def ban(*_args, **_kwargs):
                raise AssertionError("paylaşılan katalog kullanıldı")

            coll._save = ban
            coll._replace_rows = ban
            coll._load_filtered = ban
            coll._read_page = ban
            coll._fetch_rows = ban
            await coll.insert_one({
                "_id": "tx_new",
                "company_id": fresh,
                "amount": 9,
                "type": "outflow",
                "account_id": "acc_matek",
            })
            rows = await coll.find({"company_id": fresh}).to_list(10)
            assert [row["_id"] for row in rows] == ["tx_new"]
            assert await coll.count_documents({"company_id": fresh}) == 1
            grouped = await coll.aggregate([
                {"$match": {"company_id": {"$eq": fresh}}},
                {"$group": {"_id": "$account_id", "n": {"$sum": 1}}},
            ]).to_list(None)
            assert grouped and grouped[0]["_id"] == "acc_matek"
            assert decisions["n"] >= 2

            async def no_route(*_args, **_kwargs):
                return None

            monkeypatch.setattr(storage_router, "route_legacy_read", no_route)
            monkeypatch.setattr(storage_router, "route_legacy_write", no_route)
            refused = mysql_store.MySQLCollection(db, "bank_transactions")
            refused._save = ban
            refused._replace_rows = ban
            refused._load_filtered = ban
            refused._read_page = ban
            refused._fetch_rows = ban
            with pytest.raises(storage_router.StorageModeError, match=r"katalogdan okunamaz"):
                await refused.find({"company_id": fresh}).to_list(5)
            with pytest.raises(storage_router.StorageModeError, match=r"katalogdan okunamaz"):
                await refused.aggregate([{"$match": {"company_id": fresh}}]).to_list(None)
            with pytest.raises(storage_router.StorageModeError, match=r"katalogdan okunamaz"):
                await refused.changed_since(company_id=fresh)
            with pytest.raises(storage_router.StorageModeError, match=r"katalogdan yazılamaz"):
                await refused.insert_one({"_id": "tx_skip", "company_id": fresh, "amount": 1})
            with pytest.raises(storage_router.StorageModeError, match=r"katalogdan yazılamaz"):
                await refused.update_one({"company_id": fresh}, {"$set": {"amount": 2}})

        asyncio.run(run())
        assert len(_bodies(path, "bank_transactions")) == 1
    finally:
        _restore(monkeypatch, previous, comm_service)


def test_sync_read_and_tenant_doc_skip_stale_catalog(monkeypatch, tmp_path):
    """Senkron okuma ve _id-only banka kaydı eski kopyayı başarılı dönmez."""
    previous, comm_service = _seal(monkeypatch, tmp_path)
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    fresh = "comp_505a96e8"
    try:
        path = tmp_path / "tenant.db"
        dsn = f"sqlite:///{path}"
        _migrate(dsn)
        sealed = storage_router.seal_dedicated_dsn(dsn)
        company = {
            "_id": fresh,
            "storage_mode": "dedicated",
            "storage_epoch": 1,
            "storage_write_lock": False,
            storage_router.DSN_FIELD: sealed,
        }
        user = {"company_ids": [fresh], "active_company_id": fresh, "role": "admin"}

        class _DocsDb:
            def __init__(self, doc):
                self.companies = _MemoryCompanies(doc)
                self.bank_accounts = None

            def __getitem__(self, name):
                if name == "companies":
                    return self.companies
                if name == "bank_accounts":
                    return self.bank_accounts
                raise KeyError(name)

        db = _DocsDb(company)
        coll = mysql_store.MySQLCollection(db, "bank_accounts")
        db.bank_accounts = coll
        shared = {
            "_id": "acc_matek",
            "company_id": fresh,
            "account_name": "eski",
            "balance": 1,
        }

        async def catalog_rows(query=None, *_args, **_kwargs):
            if isinstance(query, dict) and query.get("company_id"):
                raise AssertionError("paylaşılan katalog okundu")
            return [dict(shared)]

        coll._load_filtered = catalog_rows
        coll._read_page = catalog_rows

        async def seed():
            await storage_dedicated.collection(db, fresh, "bank_accounts").insert_one({
                "_id": "acc_matek",
                "company_id": fresh,
                "account_name": "guncel",
                "balance": 99,
                "type": "bank",
            })

        asyncio.run(seed())
        import tenant_access

        async def run():
            sync = mysql_store.SyncMySQLCollection(db, "bank_transactions")

            def boom(*_args, **_kwargs):
                raise AssertionError("paylaşılan katalog okundu")

            sync._load_filtered = boom
            sync._read_page = boom
            with pytest.raises(storage_router.StorageModeError, match=rf"company={fresh}"):
                sync.find({"company_id": fresh}).to_list(5)
            with pytest.raises(storage_router.StorageModeError, match=rf"company={fresh}"):
                sync.count_documents({"company_id": fresh})
            with pytest.raises(storage_router.StorageModeError, match=rf"company={fresh}"):
                sync.distinct("account_id", {"company_id": fresh})
            doc = await tenant_access.get_tenant_doc(db, "bank_accounts", "acc_matek", user)
            assert doc["account_name"] == "guncel"
            assert doc["balance"] == 99

        asyncio.run(run())

        async def missing():
            empty = mysql_store.MySQLCollection(db, "bank_accounts")

            async def only_shared(query=None, *_args, **_kwargs):
                if isinstance(query, dict) and query.get("company_id"):
                    raise AssertionError("paylaşılan katalog okundu")
                return [{"_id": "acc_only_shared", "company_id": fresh, "account_name": "eski"}]

            empty._load_filtered = only_shared
            empty._read_page = only_shared
            db.bank_accounts = empty
            with pytest.raises(HTTPException) as raised:
                await tenant_access.get_tenant_doc(db, "bank_accounts", "acc_only_shared", user)
            assert raised.value.status_code == 404

        asyncio.run(missing())
    finally:
        _restore(monkeypatch, previous, comm_service)


def test_reconcile_dry_run_reports_counts_without_connecting(tmp_path):
    """1455/1465 farkı raporlanır. Betik bağlantı açmaz, --apply yazmaz."""
    import importlib.util

    path = Path(__file__).resolve().parents[1] / "scripts" / "storage_reconcile.py"
    spec = importlib.util.spec_from_file_location("storage_reconcile_offline", path)
    reconcile = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reconcile)
    shared = {
        "bank_accounts": [f"a{i}" for i in range(8)],
        "bank_transactions": [f"t{i}" for i in range(1455)],
        "contacts": [f"c{i}" for i in range(2374)],
        "partner_transactions": [f"p{i}" for i in range(76)],
        "stock_movements": [f"s{i}" for i in range(86)],
    }
    dedicated = {name: list(ids) for name, ids in shared.items()}
    dedicated["bank_transactions"] = list(shared["bank_transactions"]) + [f"new{i}" for i in range(10)]
    rows = reconcile.compare_collections(shared, dedicated)
    by_name = {row["collection"]: row for row in rows}
    bank = by_name["bank_transactions"]
    assert bank["shared"] == 1455
    assert bank["dedicated"] == 1465
    assert bank["only_shared"] == 0
    assert bank["only_dedicated"] == 10
    assert by_name["contacts"]["shared"] == 2374
    assert by_name["contacts"]["dedicated"] == 2374
    assert by_name["bank_accounts"]["only_dedicated"] == 0
    assert by_name["partner_transactions"]["only_shared"] == 0
    assert by_name["stock_movements"]["shared"] == 86
    text = reconcile.render_report(rows)
    assert "dry-run" in text
    assert "gAAAA" not in text
    assert "sqlite://" not in text
    assert SECRET not in text
    assert reconcile.main([]) == 0
    assert reconcile.main(["--apply"]) == 2
    blob = {
        "bank_transactions": [{"_id": "t0", "amount": 10, "note": "gizli"}, "new0"],
    }
    folder = tmp_path / "ids"
    folder.mkdir()
    shared_path = folder / "shared.json"
    dedicated_path = folder / "dedicated.json"
    shared_path.write_text('{"bank_transactions": ["t0"]}', encoding="utf-8")
    dedicated_path.write_text(
        __import__("json").dumps(blob),
        encoding="utf-8",
    )
    assert reconcile.main([
        "--shared-json", str(shared_path),
        "--dedicated-json", str(dedicated_path),
    ]) == 0
    captured = reconcile.compare_collections(
        {"bank_transactions": ["t0"]},
        reconcile._load_ids(str(dedicated_path)),
    )
    assert captured[0]["only_dedicated_ids"] == ["new0"]
    assert "gizli" not in reconcile.render_report(captured)
