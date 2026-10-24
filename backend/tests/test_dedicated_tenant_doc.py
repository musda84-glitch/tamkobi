"""Dedicated depoda olup paylaşılan katalogda olmayan kayıt.

get_tenant_doc company_id'siz okursa Matek / Ersay yeni sipariş, taslak fatura
ve gelen e-belge 404 olur. Canlı veritabanına ve 8021 portuna bağlanmaz.
DSN, token, PIN, VKN ve ETTN loglanmaz.
"""
from __future__ import annotations

import asyncio
import copy
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

import edocs  # noqa: E402
import mysql_store  # noqa: E402
import server  # noqa: E402
import storage_dedicated  # noqa: E402
import storage_router  # noqa: E402
import tenant_access  # noqa: E402
from storage_migrations.engine import apply  # noqa: E402
from storage_migrations.session import connect  # noqa: E402

MATEK = "comp_505a96e8"
ERSAY = "comp_9039c0ec"
LEGACY = "co_legacy_shared"
VKN = "VKN-GIZLI-TOKEN"
ETTN = "ETTN-GIZLI-TOKEN"


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    storage_router.reset()
    storage_dedicated.reset_pools()
    storage_dedicated.forget_ref(MATEK)
    storage_dedicated.forget_ref(ERSAY)
    mysql_store.clear_hot_cache()
    monkeypatch.delenv("STORAGE_ROUTER_ENABLED", raising=False)
    yield
    storage_router.reset()
    storage_dedicated.reset_pools()
    storage_dedicated.forget_ref(MATEK)
    storage_dedicated.forget_ref(ERSAY)
    mysql_store.clear_hot_cache()


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


def _load_docs(path: Path, collection: str) -> list:
    conn = sqlite3.connect(path)
    try:
        rows = conn.execute(
            "SELECT doc FROM storage_records WHERE collection = ?",
            (collection,),
        ).fetchall()
    finally:
        conn.close()
    return [mysql_store.loads(row[0]) for row in rows]


def _by_id(rows, doc_id):
    for row in rows:
        if row.get("_id") == doc_id:
            return row
    return None


class _Companies:
    def __init__(self, docs):
        self.docs = [dict(doc) for doc in docs]


class _Store:
    """Paylaşılan katalog bellek içidir. company_id'li sorgu router'a gider."""

    def __init__(self, companies):
        self.companies = _Companies(companies)
        self._indexes = {}
        self._settings = None
        self.rows = {}
        self.catalog_reads = []
        self.catalog_writes = []
        self._cols = {}

    def __getitem__(self, name):
        if name == "companies":
            return self.companies
        if name not in self._cols:
            self._cols[name] = self._collection(name)
        return self._cols[name]

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return self[name]

    def _collection(self, name):
        coll = mysql_store.MySQLCollection(self, name)
        rows = self.rows.setdefault(name, [])
        parent = self

        async def _load_filtered(query=None):
            await mysql_store._block_shared_copy(coll, query=query, write=False)
            parent.catalog_reads.append((name, copy.deepcopy(query)))
            return [copy.deepcopy(doc) for doc in rows if mysql_store.match_query(doc, query or {})]

        async def _read_page(*_args, **_kwargs):
            return None

        async def _save(doc):
            body = copy.deepcopy(doc)
            parent.catalog_writes.append((name, body))
            rows[:] = [item for item in rows if item.get("_id") != body.get("_id")]
            rows.append(body)

        async def _distinct(_query=None):
            return []

        coll._load_filtered = _load_filtered
        coll._read_page = _read_page
        coll._save = _save
        coll.distinct_company_ids = _distinct
        return coll


def _company(company_id, mode, sealed=None):
    doc = {
        "_id": company_id,
        "storage_mode": mode,
        "storage_epoch": 1 if mode == "dedicated" else 0,
        "storage_write_lock": False,
    }
    if sealed:
        doc[storage_router.DSN_FIELD] = sealed
    return doc


def _user(company_id, *, role="admin", super_admin=False, companies=None):
    allowed = list(companies if companies is not None else [company_id])
    return {
        "company_ids": allowed,
        "active_company_id": company_id,
        "role": role,
        "is_super_admin": super_admin,
    }


def _open_dedicated(tmp_path, names):
    sealed = {}
    paths = {}
    for company_id in names:
        path = tmp_path / f"{company_id}.db"
        dsn = f"sqlite:///{path}"
        _migrate(dsn)
        sealed[company_id] = storage_router.seal_dedicated_dsn(dsn)
        paths[company_id] = path
    return sealed, paths


async def _put(db, company_id, collection, doc):
    await storage_dedicated.collection(db, company_id, collection).insert_one(dict(doc))


def _use(db):
    previous_server = server.db
    previous_edocs = edocs._db
    server.db = db
    edocs._db = db
    return previous_server, previous_edocs


def _unuse(previous):
    server.db, edocs._db = previous


def test_dedicated_only_order_invoice_and_edoc_skip_empty_catalog(monkeypatch, tmp_path, caplog):
    """Kayıt yalnız dedicated depoda. Sipariş durumu, fatura onay ve e-belge oraya yazılır."""
    previous_key, comm_service = _seal(monkeypatch, tmp_path)
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    try:
        sealed, paths = _open_dedicated(tmp_path, (MATEK, ERSAY))
        db = _Store([
            _company(MATEK, "dedicated", sealed[MATEK]),
            _company(ERSAY, "dedicated", sealed[ERSAY]),
        ])
        admin = _user(MATEK)
        other = _user(ERSAY)
        boss = _user(MATEK, super_admin=True)

        async def seed():
            await _put(db, MATEK, "orders", {
                "_id": "ord_status",
                "company_id": MATEK,
                "order_status": "pending",
                "channel": "manual",
                "order_number": "S-1",
            })
            await _put(db, MATEK, "orders", {
                "_id": "ord_inv",
                "company_id": MATEK,
                "order_status": "approved",
                "channel": "manual",
                "is_invoiced": False,
            })
            await _put(db, MATEK, "orders", {
                "_id": "ord_same",
                "company_id": MATEK,
                "order_status": "matek",
                "channel": "manual",
            })
            await _put(db, ERSAY, "orders", {
                "_id": "ord_same",
                "company_id": ERSAY,
                "order_status": "ersay",
                "channel": "manual",
            })
            await _put(db, MATEK, "invoices", {
                "_id": "inv_draft",
                "company_id": MATEK,
                "invoice_type": "sales",
                "status": "draft",
                "e_type": "paper",
                "items": [],
                "grand_total": 10,
                "order_id": "ord_inv",
                "invoice_number": "TASLAK-1",
            })
            await _put(db, MATEK, "contacts", {
                "_id": "cnt_matek",
                "company_id": MATEK,
                "type": "supplier",
                "name": "Tedarik",
                "tax_number_or_id": VKN,
                "balance": 0,
            })
            await _put(db, MATEK, "incoming_edocs", {
                "_id": "ed_only",
                "company_id": MATEK,
                "status": "pending",
                "kind": "invoice",
                "source": "manual",
                "number": "GELEN-1",
                "supplier": {"name": "Tedarik", "tax_id": VKN},
                "lines": [{
                    "name": "Hizmet",
                    "quantity": 1,
                    "unit_price": 10,
                    "total": 10,
                    "vat_rate": 20,
                }],
                "subtotal": 10,
                "vat_total": 2,
                "grand_total": 12,
                "ettn": ETTN,
            })

        asyncio.run(seed())
        bound = _use(db)
        try:
            async def run():
                own = await tenant_access.get_tenant_doc(
                    db, "orders", "ord_same", admin, not_found="Sipariş bulunamadı.",
                )
                assert own["order_status"] == "matek"
                assert own["company_id"] == MATEK
                foreign = await tenant_access.get_tenant_doc(
                    db, "orders", "ord_same", other, not_found="Sipariş bulunamadı.",
                )
                assert foreign["order_status"] == "ersay"
                assert foreign["company_id"] == ERSAY
                as_boss = await tenant_access.get_tenant_doc(
                    db, "orders", "ord_status", boss, not_found="Sipariş bulunamadı.",
                )
                assert as_boss["company_id"] == MATEK
                with pytest.raises(HTTPException) as missing:
                    await tenant_access.get_tenant_doc(
                        db, "orders", "ord_status", other, not_found="Sipariş bulunamadı.",
                    )
                assert missing.value.status_code == 404
                assert missing.value.detail == "Sipariş bulunamadı."

                status = await server.update_order_status("ord_status", {"status": "approved"}, admin)
                assert status["order_status"] == "approved"
                approved = await server.approve_invoice("inv_draft", admin)
                assert approved["status"] == "success"
                processed = await edocs.process_edoc("ed_only", {}, admin)
                assert processed["status"] == "success"
                with pytest.raises(HTTPException) as denied:
                    await server.update_order_status("ord_status", {"status": "cancelled"}, other)
                assert denied.value.status_code == 404
                assert denied.value.detail == "Sipariş bulunamadı."

            with caplog.at_level(logging.DEBUG):
                asyncio.run(run())
        finally:
            _unuse(bound)

        orders = _load_docs(paths[MATEK], "orders")
        invoices = _load_docs(paths[MATEK], "invoices")
        edoc_rows = _load_docs(paths[MATEK], "incoming_edocs")
        changed = _by_id(orders, "ord_status")
        linked = _by_id(orders, "ord_inv")
        draft = _by_id(invoices, "inv_draft")
        edoc = _by_id(edoc_rows, "ed_only")
        assert changed["order_status"] == "approved"
        assert changed["company_id"] == MATEK
        assert draft["status"] == "approved"
        assert draft["company_id"] == MATEK
        assert linked["is_invoiced"] is True
        assert linked["invoice_id"] == "inv_draft"
        assert edoc["status"] == "approved"
        assert edoc["company_id"] == MATEK
        created = [row for row in invoices if row.get("source") == "edoc_inbox"]
        assert len(created) == 1
        assert created[0]["company_id"] == MATEK
        assert db.catalog_writes == []
        ersay_orders = _load_docs(paths[ERSAY], "orders")
        assert _by_id(ersay_orders, "ord_same")["order_status"] == "ersay"
        assert _by_id(ersay_orders, "ord_status") is None
        assert VKN not in caplog.text
        assert ETTN not in caplog.text
        assert "sqlite://" not in caplog.text
        assert "gAAAA" not in caplog.text
    finally:
        _restore(monkeypatch, previous_key, comm_service)


def test_stale_catalog_copy_uses_dedicated_and_shared_only_is_404(monkeypatch, tmp_path):
    """Paylaşılan kopya eskiyse dedicated satır döner. Yalnız katalogdaki kopya 404 olur."""
    previous_key, comm_service = _seal(monkeypatch, tmp_path)
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    try:
        sealed, _paths = _open_dedicated(tmp_path, (MATEK,))
        db = _Store([_company(MATEK, "dedicated", sealed[MATEK])])
        db.rows["orders"] = [{
            "_id": "ord_stale",
            "company_id": MATEK,
            "order_status": "eski",
            "channel": "manual",
        }, {
            "_id": "ord_catalog",
            "company_id": MATEK,
            "order_status": "yalniz-katalog",
            "channel": "manual",
        }]
        user = _user(MATEK)

        async def seed():
            await _put(db, MATEK, "orders", {
                "_id": "ord_stale",
                "company_id": MATEK,
                "order_status": "guncel",
                "channel": "manual",
            })

        asyncio.run(seed())

        async def run():
            live = await tenant_access.get_tenant_doc(
                db, "orders", "ord_stale", user, not_found="Sipariş bulunamadı.",
            )
            assert live["order_status"] == "guncel"
            with pytest.raises(HTTPException) as raised:
                await tenant_access.get_tenant_doc(
                    db, "orders", "ord_catalog", user, not_found="Sipariş bulunamadı.",
                )
            assert raised.value.status_code == 404

        asyncio.run(run())
        assert db.rows["orders"][0]["order_status"] == "eski"
    finally:
        _restore(monkeypatch, previous_key, comm_service)


def test_legacy_mode_reads_and_writes_shared_catalog(monkeypatch, tmp_path):
    """Legacy kip paylaşılan katalogdadır. Durum yazması da oraya gider."""
    previous_key, comm_service = _seal(monkeypatch, tmp_path)
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    try:
        db = _Store([_company(LEGACY, "legacy")])
        db.rows["orders"] = [{
            "_id": "ord_legacy",
            "company_id": LEGACY,
            "order_status": "pending",
            "channel": "manual",
        }]
        user = _user(LEGACY)
        bound = _use(db)
        try:
            async def run():
                found = await tenant_access.get_tenant_doc(
                    db, "orders", "ord_legacy", user, not_found="Sipariş bulunamadı.",
                )
                assert found["order_status"] == "pending"
                out = await server.update_order_status("ord_legacy", {"status": "approved"}, user)
                assert out["order_status"] == "approved"

            asyncio.run(run())
        finally:
            _unuse(bound)
        assert db.rows["orders"][0]["order_status"] == "approved"
        assert db.rows["orders"][0]["company_id"] == LEGACY
        assert db.catalog_writes
    finally:
        _restore(monkeypatch, previous_key, comm_service)


def test_router_off_stays_on_catalog(monkeypatch, tmp_path):
    """Bayrak kapalıyken katalog okunur. Dedicated satır tek başına görünmez."""
    previous_key, comm_service = _seal(monkeypatch, tmp_path)
    try:
        sealed, _paths = _open_dedicated(tmp_path, (MATEK,))
        db = _Store([_company(MATEK, "dedicated", sealed[MATEK])])
        db.rows["orders"] = [{
            "_id": "ord_catalog",
            "company_id": MATEK,
            "order_status": "katalog",
            "channel": "manual",
        }]
        user = _user(MATEK)

        async def seed():
            await _put(db, MATEK, "orders", {
                "_id": "ord_only",
                "company_id": MATEK,
                "order_status": "dedicated",
                "channel": "manual",
            })

        asyncio.run(seed())

        async def run():
            found = await tenant_access.get_tenant_doc(
                db, "orders", "ord_catalog", user, not_found="Sipariş bulunamadı.",
            )
            assert found["order_status"] == "katalog"
            with pytest.raises(HTTPException) as raised:
                await tenant_access.get_tenant_doc(
                    db, "orders", "ord_only", user, not_found="Sipariş bulunamadı.",
                )
            assert raised.value.status_code == 404

        asyncio.run(run())
    finally:
        _restore(monkeypatch, previous_key, comm_service)


def test_super_admin_without_active_company_still_reads_catalog(monkeypatch, tmp_path):
    """Süper admin şirket seçmeden katalogdaki legacy kaydı okur. Başka dedicated kaydı almaz."""
    previous_key, comm_service = _seal(monkeypatch, tmp_path)
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    try:
        sealed, paths = _open_dedicated(tmp_path, (MATEK,))
        db = _Store([
            _company(MATEK, "dedicated", sealed[MATEK]),
            _company(LEGACY, "legacy"),
        ])
        db.rows["orders"] = [{
            "_id": "ord_legacy",
            "company_id": LEGACY,
            "order_status": "katalog",
            "channel": "manual",
        }]
        boss = {"is_super_admin": True, "company_ids": [], "role": "admin"}

        async def seed():
            await _put(db, MATEK, "orders", {
                "_id": "ord_only",
                "company_id": MATEK,
                "order_status": "dedicated",
                "channel": "manual",
            })

        asyncio.run(seed())

        async def run():
            found = await tenant_access.get_tenant_doc(
                db, "orders", "ord_legacy", boss, not_found="Sipariş bulunamadı.",
            )
            assert found["order_status"] == "katalog"
            assert found["company_id"] == LEGACY
            with pytest.raises(HTTPException) as raised:
                await tenant_access.get_tenant_doc(
                    db, "orders", "ord_only", boss, not_found="Sipariş bulunamadı.",
                )
            assert raised.value.status_code == 404

        asyncio.run(run())
        assert _by_id(_load_docs(paths[MATEK], "orders"), "ord_only")["order_status"] == "dedicated"
    finally:
        _restore(monkeypatch, previous_key, comm_service)
