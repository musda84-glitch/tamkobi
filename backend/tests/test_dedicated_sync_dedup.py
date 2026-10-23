"""Dedicated artımlı senkron ve banka external_id tekilleştirmesi.

Canlı veritabanına ve 8021 portuna bağlanmaz. DSN, VKN ve ETTN loglanmaz.
Rapor betiği yazmaz.
"""
from __future__ import annotations

import asyncio
import json
import os
import sqlite3
import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest
from cryptography.fernet import Fernet

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

import data_sync  # noqa: E402
import event_notify  # noqa: E402
import mysql_store  # noqa: E402
import notify  # noqa: E402
import server  # noqa: E402
import storage_dedicated  # noqa: E402
import storage_router  # noqa: E402
import storage_shared_v2  # noqa: E402
from bank_match_target import apply_partner_match  # noqa: E402
from dashboard_memdb import MemDB  # noqa: E402
from mysql_store import DuplicateKeyError  # noqa: E402
from storage_migrations.engine import apply  # noqa: E402
from storage_migrations.loader import load_migrations  # noqa: E402
from storage_migrations.session import connect  # noqa: E402
import scripts.bank_dup_report as bank_dup_report  # noqa: E402

CID = "comp_505a96e8"
EXT = "ext-bank-1"
SECRET_DESC = "gizli-aciklama-metni"


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    storage_router.reset()
    storage_dedicated.reset_pools()
    storage_shared_v2.reset_store()
    monkeypatch.delenv("STORAGE_ROUTER_ENABLED", raising=False)
    previous_db = server.db
    previous_sync = data_sync._db
    yield
    server.db = previous_db
    data_sync._db = previous_sync
    storage_router.reset()
    storage_dedicated.reset_pools()
    storage_shared_v2.reset_store()


def _run(coro):
    return asyncio.run(coro)


def _silence(monkeypatch):
    async def _no(*_args, **_kwargs):
        return False

    async def _skip(*_args, **_kwargs):
        return {"status": "skipped"}

    monkeypatch.setattr(event_notify, "inapp_enabled", _no)
    monkeypatch.setattr(event_notify, "queue_event_email", _skip)
    monkeypatch.setattr(notify, "dispatch_push", _skip)


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


def _apply_conn(connection):
    from storage_migrations.session import Session

    apply(Session(connection, "sqlite", read_only=False), confirm=True, dry_run=False)


class _Companies:
    def __init__(self, doc: dict):
        self.docs = [doc]
        self.name = "companies"

    async def find_one(self, query, projection=None):
        wanted = str((query or {}).get("_id") or "")
        for doc in self.docs:
            if str(doc.get("_id") or "") != wanted:
                continue
            if not projection:
                return dict(doc)
            out = {"_id": doc.get("_id")}
            for key, flag in projection.items():
                if key == "_id" or not flag or key not in doc:
                    continue
                out[key] = doc[key]
            return out
        return None


class _Catalog:
    """Şirket belgesi bellekte. Diğer koleksiyonlar yönlenir; katalog SQL'i yasak."""

    def __init__(self, doc: dict):
        self.companies = _Companies(doc)
        self._cols = {}
        self.catalog_sql = 0

    def __getitem__(self, name):
        if name == "companies":
            return self.companies
        coll = self._cols.get(name)
        if coll is None:
            coll = mysql_store.MySQLCollection(self, name)
            self._ban(coll)
            self._cols[name] = coll
        return coll

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return self[name]

    def _ban(self, coll):
        catalog = self

        async def ban(*_args, **_kwargs):
            catalog.catalog_sql += 1
            raise AssertionError("paylaşılan katalog")

        coll._fetch_rows = ban
        coll._save = ban
        coll._replace_rows = ban
        coll._delete_ids = ban


def _user(company_id: str) -> dict:
    return {
        "company_ids": [company_id],
        "active_company_id": company_id,
        "role": "admin",
    }


def _account(company_id: str) -> dict:
    return {
        "_id": "acc1",
        "company_id": company_id,
        "type": "bank",
        "account_name": "Vadesiz",
        "currency": "TRY",
        "current_balance": 10.0,
    }


def _connection(company_id: str) -> dict:
    return {
        "_id": "conn1",
        "company_id": company_id,
        "provider": "other",
        "linked_account_id": "acc1",
        "bank_account_number": "ACC-1",
        "status": "idle",
        "auto_match": False,
        "auto_sync": False,
        "synced_count": 0,
    }


def _payload(external_id=EXT, *, amount=40.0):
    return {
        "external_id": external_id,
        "direction": "credit",
        "amount": amount,
        "currency": "TRY",
        "description": "ACME odeme",
        "counterparty": "ACME",
        "date": "2026-10-12",
        "is_simulated": False,
    }


def _record_docs(path: Path, collection: str) -> list:
    conn = sqlite3.connect(path)
    try:
        rows = conn.execute(
            "SELECT doc FROM storage_records WHERE collection = ?",
            (collection,),
        ).fetchall()
    finally:
        conn.close()
    return [json.loads(row[0]) for row in rows]


def _key_rows(path: Path) -> list:
    conn = sqlite3.connect(path)
    try:
        rows = conn.execute(
            "SELECT company_id, external_id, doc_id FROM storage_bank_external ORDER BY company_id, external_id",
        ).fetchall()
    finally:
        conn.close()
    return list(rows)


async def _sync_twice(company_id: str, payloads):
    calls = {"n": 0}

    async def fetch(_conn, _since):
        calls["n"] += 1
        batch = payloads[min(calls["n"] - 1, len(payloads) - 1)]
        return {"simulated": False, "balance": 50.0, "transactions": batch}

    with patch.object(server.bank_providers, "fetch_transactions", side_effect=fetch):
        first = await server._sync_bank_connection_core("conn1", days=7, company_id=company_id)
        second = await server._sync_bank_connection_core("conn1", days=7, company_id=company_id)
    return first, second


def test_migration_0007_opens_bank_key_without_docs_table():
    found = [item for item in load_migrations() if item.version == 7]
    assert len(found) == 1
    migration = found[0]
    text = " ".join(migration.steps + migration.mysql_steps).lower()
    assert "storage_bank_external" in text
    assert "docs" not in text.split()
    assert "utf8mb4_bin" in migration.mysql_steps[0]


def test_dedicated_sync_reads_storage_records(monkeypatch, tmp_path):
    """GET /api/sync dedicated şirkette 200 gövdesi döner ve storage_records okur."""
    previous, comm_service = _seal(monkeypatch, tmp_path)
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    path = tmp_path / "dedicated.db"
    dsn = f"sqlite:///{path}"
    try:
        _migrate(dsn)
        sealed = storage_router.seal_dedicated_dsn(dsn)
        company = {
            "_id": CID,
            "storage_mode": "dedicated",
            "storage_epoch": 1,
            "storage_write_lock": False,
            storage_router.DSN_FIELD: sealed,
        }
        catalog = _Catalog(company)
        data_sync.init(catalog)

        async def run():
            invoices = catalog["invoices"]
            await invoices.insert_one({
                "_id": "inv_old",
                "company_id": CID,
                "invoice_type": "sales",
                "status": "approved",
                "grand_total": 10,
            })
            await catalog["bank_transactions"].insert_one({
                "_id": "btx_old",
                "company_id": CID,
                "external_id": EXT,
                "amount": 5,
                "type": "inflow",
            })
            body = await data_sync.incremental_sync(
                company_id=CID,
                since=None,
                collections="invoices,bank_transactions",
                limit=100,
                user=_user(CID),
            )
            assert body["company_id"] == CID
            assert body["full"] is True
            inv = body["collections"]["invoices"]
            bank = body["collections"]["bank_transactions"]
            assert [row["id"] for row in inv["changed"]] == ["inv_old"]
            assert [row["id"] for row in bank["changed"]] == ["btx_old"]
            assert all("_row_updated_at" not in row for row in inv["changed"] + bank["changed"])
            cursor = inv["cursor"]
            assert cursor
            await invoices.insert_one({
                "_id": "inv_new",
                "company_id": CID,
                "invoice_type": "sales",
                "status": "draft",
                "grand_total": 3,
            })
            nxt = await data_sync.incremental_sync(
                company_id=CID,
                since=cursor,
                collections="invoices",
                limit=100,
                user=_user(CID),
            )
            assert nxt["full"] is False
            assert "inv_new" in [row["id"] for row in nxt["collections"]["invoices"]["changed"]]
            empty = await data_sync.incremental_sync(
                company_id=CID,
                since="2099-01-01T00:00:00+00:00",
                collections="invoices,bank_transactions",
                limit=100,
                user=_user(CID),
            )
            assert empty["collections"]["invoices"]["changed"] == []
            assert empty["collections"]["bank_transactions"]["changed"] == []
            await catalog["sync_tombstones"].insert_one({
                "_id": "tomb_inv_old",
                "collection": "invoices",
                "doc_id": "inv_old",
                "company_id": CID,
                "deleted_at": "2026-10-23T12:00:00+00:00",
            })
            deleted = await data_sync.incremental_sync(
                company_id=CID,
                since="2026-10-23T00:00:00+00:00",
                collections="invoices",
                limit=100,
                user=_user(CID),
            )
            assert "inv_old" in deleted["collections"]["invoices"]["deleted"]
            company["storage_write_lock"] = True
            storage_router.reset()
            locked = await data_sync.incremental_sync(
                company_id=CID,
                since=None,
                collections="invoices",
                limit=100,
                user=_user(CID),
            )
            assert "inv_old" in [row["id"] for row in locked["collections"]["invoices"]["changed"]]
            with pytest.raises(storage_router.StorageWriteLocked):
                await invoices.insert_one({
                    "_id": "inv_locked",
                    "company_id": CID,
                    "invoice_type": "sales",
                })

        _run(run())
        stored = _record_docs(path, "invoices")
        assert {row["_id"] for row in stored} == {"inv_old", "inv_new"}
        assert all("_row_updated_at" in row for row in stored)
        assert catalog.catalog_sql == 0
        assert "sqlite://" not in json.dumps(stored)
    finally:
        _restore(monkeypatch, previous, comm_service)


def test_shared_v2_sync_reads_company_store(monkeypatch, tmp_path):
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    connection = sqlite3.connect(tmp_path / "shared.db", isolation_level=None)
    try:
        _apply_conn(connection)
        storage_shared_v2.bind_sqlite(connection)
        company_id = "comp_shared_sync"
        catalog = _Catalog({
            "_id": company_id,
            "storage_mode": "shared_v2",
            "storage_epoch": 1,
            "storage_write_lock": False,
        })
        data_sync.init(catalog)

        async def run():
            await catalog["invoices"].insert_one({
                "_id": "inv_s",
                "company_id": company_id,
                "invoice_type": "sales",
                "grand_total": 1,
            })
            body = await data_sync.incremental_sync(
                company_id=company_id,
                since=None,
                collections="invoices",
                limit=20,
                user=_user(company_id),
            )
            assert [row["id"] for row in body["collections"]["invoices"]["changed"]] == ["inv_s"]

        _run(run())
        assert catalog.catalog_sql == 0
        rows = connection.execute(
            "SELECT doc FROM t_invoices WHERE company_id = ?",
            (company_id,),
        ).fetchall()
        assert len(rows) == 1
        assert "inv_s" in rows[0][0]
    finally:
        connection.close()


def test_legacy_same_external_id_inserts_once(monkeypatch):
    _silence(monkeypatch)
    company_id = "co_legacy_dedup"
    db = MemDB()
    db.bank_accounts.docs.append(_account(company_id))
    db.bank_connections.docs.append(_connection(company_id))
    server.db = db
    first, second = _run(_sync_twice(company_id, [[_payload(), _payload()], [_payload(), _payload()]]))
    rows = [
        doc for doc in db.bank_transactions.docs
        if doc.get("company_id") == company_id and doc.get("external_id") == EXT
    ]
    assert len(rows) == 1
    assert first["inserted"] == 1
    assert first["skipped"] == 1
    assert second["inserted"] == 0
    assert second["skipped"] == 2


def test_blank_external_id_is_not_collapsed(monkeypatch):
    _silence(monkeypatch)
    company_id = "co_legacy_blank"
    db = MemDB()
    db.bank_accounts.docs.append(_account(company_id))
    db.bank_connections.docs.append(_connection(company_id))
    server.db = db
    blank = _payload("")
    missing = _payload(None)
    missing.pop("external_id")

    async def fetch(_conn, _since):
        return {"simulated": False, "balance": None, "transactions": [blank, missing]}

    with patch.object(server.bank_providers, "fetch_transactions", side_effect=fetch):
        out = _run(server._sync_bank_connection_core("conn1", company_id=company_id))
    assert out["inserted"] == 2
    assert len(db.bank_transactions.docs) == 2


def test_shared_v2_same_external_id_inserts_once(monkeypatch, tmp_path):
    _silence(monkeypatch)
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    connection = sqlite3.connect(tmp_path / "shared-bank.db", isolation_level=None)
    company_id = "comp_shared_bank"
    try:
        _apply_conn(connection)
        storage_shared_v2.bind_sqlite(connection)
        catalog = _Catalog({
            "_id": company_id,
            "storage_mode": "shared_v2",
            "storage_epoch": 1,
            "storage_write_lock": False,
        })
        server.db = catalog

        async def prepare():
            await catalog.bank_accounts.insert_one(_account(company_id))
            await catalog.bank_connections.insert_one(_connection(company_id))

        _run(prepare())
        first, second = _run(_sync_twice(company_id, [[_payload()], [_payload(), _payload()]]))
        rows = connection.execute(
            "SELECT doc FROM t_bank_transactions WHERE company_id = ?",
            (company_id,),
        ).fetchall()
        assert len(rows) == 1
        assert EXT in rows[0][0]
        assert first["inserted"] == 1
        assert second["inserted"] == 0
        assert second["skipped"] == 2
        assert catalog.catalog_sql == 0
    finally:
        connection.close()


def test_dedicated_same_external_id_inserts_once(monkeypatch, tmp_path):
    previous, comm_service = _seal(monkeypatch, tmp_path)
    _silence(monkeypatch)
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    path = tmp_path / "bank.db"
    dsn = f"sqlite:///{path}"
    company_id = CID
    try:
        _migrate(dsn)
        sealed = storage_router.seal_dedicated_dsn(dsn)
        catalog = _Catalog({
            "_id": company_id,
            "storage_mode": "dedicated",
            "storage_epoch": 1,
            "storage_write_lock": False,
            storage_router.DSN_FIELD: sealed,
        })
        server.db = catalog

        async def prepare():
            await catalog.bank_accounts.insert_one(_account(company_id))
            await catalog.bank_connections.insert_one(_connection(company_id))

        _run(prepare())
        first, second = _run(_sync_twice(company_id, [[_payload()], [_payload()]]))
        docs = _record_docs(path, "bank_transactions")
        matched = [doc for doc in docs if doc.get("external_id") == EXT]
        assert len(matched) == 1
        assert first["inserted"] == 1
        assert second["inserted"] == 0
        assert second["skipped"] == 1
        assert _key_rows(path) == [(company_id, EXT, matched[0]["_id"])]
        assert catalog.catalog_sql == 0
    finally:
        _restore(monkeypatch, previous, comm_service)


def test_dedicated_external_id_is_unique_per_company(monkeypatch, tmp_path):
    path = tmp_path / "keys.db"
    dsn = f"sqlite:///{path}"
    _migrate(dsn)
    left = storage_dedicated.DedicatedCollection("comp_a", "bank_transactions", dsn)
    right = storage_dedicated.DedicatedCollection("comp_b", "bank_transactions", dsn)

    async def run():
        await left.insert_one({"_id": "a1", "company_id": "comp_a", "external_id": EXT, "amount": 1})
        await right.insert_one({"_id": "b1", "company_id": "comp_b", "external_id": EXT, "amount": 2})
        with pytest.raises(DuplicateKeyError):
            await left.insert_one({"_id": "a2", "company_id": "comp_a", "external_id": f"  {EXT}  ", "amount": 3})
        real = storage_dedicated.DedicatedCollection._claim_bank_external

        def allow(self, session, doc, *, inserting):
            return None

        monkeypatch.setattr(storage_dedicated.DedicatedCollection, "_claim_bank_external", allow)
        await left.insert_one({
            "_id": "a_dup",
            "company_id": "comp_a",
            "external_id": "ext-dup",
            "amount": 4,
            "description": "eski",
        })
        await left.insert_one({
            "_id": "a_dup2",
            "company_id": "comp_a",
            "external_id": "ext-dup",
            "amount": 5,
        })
        monkeypatch.setattr(storage_dedicated.DedicatedCollection, "_claim_bank_external", real)
        updated = await left.update_one(
            {"_id": "a_dup", "company_id": "comp_a"},
            {"$set": {"description": "yama"}},
        )
        assert updated.modified_count == 1
        with pytest.raises(DuplicateKeyError):
            await left.insert_one({
                "_id": "a_dup3",
                "company_id": "comp_a",
                "external_id": "ext-dup",
                "amount": 6,
            })

    _run(run())
    keys = _key_rows(path)
    assert ("comp_a", EXT, "a1") in keys
    assert ("comp_b", EXT, "b1") in keys
    bodies = _record_docs(path, "bank_transactions")
    patched = next(doc for doc in bodies if doc["_id"] == "a_dup")
    assert patched["description"] == "yama"
    assert sum(1 for doc in bodies if doc.get("external_id") == "ext-dup") == 2


def _match(doc, query) -> bool:
    for key, expected in (query or {}).items():
        if isinstance(expected, dict) and "$in" in expected:
            if doc.get(key) not in expected["$in"]:
                return False
            continue
        if doc.get(key) != expected:
            return False
    return True


class _Store:
    def __init__(self, bank, partners):
        self.bank_transactions = _Coll(bank)
        self.partner_transactions = _Coll(partners)


class _Coll:
    def __init__(self, docs):
        self.docs = docs

    def find(self, query=None, projection=None):
        rows = [doc for doc in self.docs if _match(doc, query)]

        class _Cursor:
            async def to_list(self, length=None):
                if length is None:
                    return list(rows)
                return list(rows)[: int(length)]

        return _Cursor()

    async def find_one(self, query=None, projection=None, sort=None, skip=0):
        for doc in self.docs:
            if _match(doc, query):
                return doc
        return None


def test_second_partner_match_reuses_existing_external_id():
    bank = [
        {"_id": "b1", "company_id": "co", "external_id": EXT, "account_name": "Vadesiz", "description": "eski"},
        {"_id": "b2", "company_id": "co", "external_id": EXT, "account_name": "Vadesiz", "description": "kopya"},
    ]
    partners = [{
        "_id": "pt1",
        "company_id": "co",
        "partner_name": "Ali",
        "source": "bank_match",
        "related_bank_tx_id": "b1",
    }]
    db = _Store(bank, partners)

    async def run():
        with patch("bank_match_target.partner_pay.move") as move:
            name = await apply_partner_match(db, bank[1], "partner1", 40, True)
        assert name == "Ali"
        move.assert_not_called()
        partners[0]["external_id"] = EXT
        with patch("bank_match_target.partner_pay.move") as move:
            again = await apply_partner_match(db, bank[0], "partner1", 40, True)
        assert again == "Ali"
        move.assert_not_called()

    _run(run())


def test_partner_match_without_external_id_still_moves():
    tx = {
        "_id": "tx1",
        "company_id": "co",
        "account_name": "Vadesiz",
        "description": "sermaye",
        "date": "2026-10-12",
    }

    async def run():
        with patch("bank_match_target.partner_pay.move", new=AsyncMock(return_value="Mustafa")) as move:
            name = await apply_partner_match(object(), tx, "p1", 25, True)
        assert name == "Mustafa"
        assert move.await_args.kwargs["extra"]["related_bank_tx_id"] == "tx1"
        assert "external_id" not in move.await_args.kwargs["extra"]

    _run(run())


def test_report_dry_run_writes_nothing(tmp_path, capsys):
    assert bank_dup_report.main([]) == 0
    assert "bağlantı açılmadı" in capsys.readouterr().out
    assert bank_dup_report.main(["--apply", "--bank-json", "x.json"]) == 2
    assert "--apply" in capsys.readouterr().err
    bank = tmp_path / "bank.json"
    partner = tmp_path / "partner.json"
    bank.write_text(json.dumps([
        {"_id": "b1", "company_id": "co", "external_id": EXT, "match_status": "matched", "description": SECRET_DESC, "amount": 99},
        {"_id": "b2", "company_id": "co", "external_id": EXT, "match_status": "unmatched", "description": SECRET_DESC},
        {"_id": "b3", "company_id": "co", "external_id": "tek"},
    ]), encoding="utf-8")
    partner.write_text(json.dumps([
        {"_id": "pt1", "company_id": "co", "related_bank_tx_id": "b1", "description": SECRET_DESC},
        {"_id": "pt2", "company_id": "other", "external_id": EXT},
    ]), encoding="utf-8")
    before_bank = bank.read_bytes()
    before_partner = partner.read_bytes()
    report = bank_dup_report.find_duplicates(
        json.loads(bank.read_text(encoding="utf-8")),
        json.loads(partner.read_text(encoding="utf-8")),
    )
    assert report["dry_run"] is True
    assert report["wrote"] is False
    assert report["duplicate_groups"] == 1
    row = report["companies"][0]
    assert row["copies"] == 2
    assert row["bank_transaction_ids"] == ["b1", "b2"]
    assert row["partner_transaction_ids"] == ["pt1"]
    assert row["match_status"] == {"matched": 1, "unmatched": 1}
    assert bank_dup_report.main([
        "--company", "co",
        "--bank-json", str(bank),
        "--partner-json", str(partner),
        "--dry-run",
    ]) == 0
    printed = capsys.readouterr().out
    assert "dry-run" in printed
    assert "yazım yok" in printed
    assert EXT in printed
    assert SECRET_DESC not in printed
    assert "99" not in printed
    assert bank.read_bytes() == before_bank
    assert partner.read_bytes() == before_partner
