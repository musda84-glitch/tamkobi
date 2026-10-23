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
