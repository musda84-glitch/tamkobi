"""Dedicated çöp silme: company_id'siz delete katalogda 0 satır siler.

İki şirket, bellek içi yönlendirici. Canlı veritabanına bağlanmaz.
İkinci silme 404'tür ve bakiyeyi bir daha tersine çevirmez.
"""
from __future__ import annotations

import asyncio
import copy
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

import server  # noqa: E402
import storage_router  # noqa: E402
import trash  # noqa: E402
from mysql_store import match_query  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
POS_TX = "tx-pos"
POS_ACC = "acc-pos"
PTX = "ptx-cari"
CASH_ACC = "acc-cash"
CASH_TX = "tx-cash"
PARTNER = "partner-1"
CARI = "cari-1"
CONTACT = "contact-1"


def _run(coro):
    return asyncio.run(coro)


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *args, **kwargs):
        return self

    async def to_list(self, length=None):
        rows = self.rows if length is None else self.rows[:length]
        return copy.deepcopy(rows)


class _RouterDB:
    """company_id varsa dedicated kova; yoksa paylaşılan katalog.

    Üretimdeki route_legacy_write ile aynı seçim: sorguda şirket yoksa
    dedicated satıra inilmez, katalogda 0 satır silinir.
    """

    def __init__(self):
        self.dedicated = {CO_A: {}, CO_B: {}}
        self.catalog = {}
        self.incs = []
        self._cols = {}

    def __getitem__(self, name):
        coll = self._cols.get(name)
        if coll is None:
            coll = _RoutedCollection(self, name)
            self._cols[name] = coll
        return coll

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return self[name]

    def bucket(self, collection, company_id):
        if company_id in self.dedicated:
            return self.dedicated[company_id].setdefault(collection, [])
        return self.catalog.setdefault(collection, [])


class _RoutedCollection:
    def __init__(self, db, name):
        self.db = db
        self.name = name

    def _company(self, query=None, doc=None):
        if isinstance(query, dict):
            cid = query.get("company_id")
            if isinstance(cid, str) and cid.strip():
                return cid.strip()
        if isinstance(doc, dict):
            cid = doc.get("company_id")
            if isinstance(cid, str) and str(cid).strip():
                return str(cid).strip()
        return None

    def _rows(self, query=None, doc=None):
        return self.db.bucket(self.name, self._company(query, doc))

    async def find_one(self, query=None, projection=None, sort=None):
        for doc in self._rows(query):
            if match_query(doc, query or {}):
                return copy.deepcopy(doc)
        return None

    def find(self, query=None, projection=None):
        rows = [doc for doc in self._rows(query) if match_query(doc, query or {})]
        return _Cursor(rows)

    async def count_documents(self, query=None):
        return sum(1 for doc in self._rows(query) if match_query(doc, query or {}))

    async def insert_one(self, doc):
        self._rows(doc=doc).append(copy.deepcopy(doc))
        return SimpleNamespace(inserted_id=doc.get("_id"))

    async def update_one(self, query, update, upsert=False):
        rows = self._rows(query)
        for doc in rows:
            if not match_query(doc, query or {}):
                continue
            cid = doc.get("company_id")
            for key, value in (update.get("$inc") or {}).items():
                self.db.incs.append((self.name, cid, doc.get("_id"), key, float(value)))
                doc[key] = float(doc.get(key) or 0) + float(value)
            for key, value in (update.get("$set") or {}).items():
                doc[key] = copy.deepcopy(value)
            for key in (update.get("$unset") or {}):
                doc.pop(key, None)
            return SimpleNamespace(matched_count=1, modified_count=1)
        return SimpleNamespace(matched_count=0, modified_count=0)

    async def delete_one(self, query):
        rows = self._rows(query)
        for index, doc in enumerate(rows):
            if match_query(doc, query or {}):
                del rows[index]
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def delete_many(self, query=None):
        rows = self._rows(query)
        kept = []
        removed = 0
        for doc in rows:
            if match_query(doc, query or {}):
                removed += 1
            else:
                kept.append(doc)
        rows[:] = kept
        return SimpleNamespace(deleted_count=removed)


def _user(company_id):
    return {
        "_id": "user-" + company_id,
        "role": "admin",
        "is_super_admin": False,
        "company_ids": [company_id],
        "active_company_id": company_id,
    }


def _put(db, company_id, collection, doc):
    body = copy.deepcopy(doc)
    if company_id:
        body["company_id"] = company_id
    db.bucket(collection, company_id).append(body)
    return body


def _live(db, company_id, collection, doc_id):
    for doc in db.dedicated.get(company_id, {}).get(collection, []):
        if doc.get("_id") == doc_id:
            return doc
    return None


def _inc_sum(db, collection, company_id, field):
    return sum(
        delta for name, cid, _doc_id, key, delta in db.incs
        if name == collection and cid == company_id and key == field
    )


@pytest.fixture
def routed(monkeypatch):
    db = _RouterDB()
    monkeypatch.setattr(storage_router, "enabled", lambda: True)

    async def _decision(_db, company_id):
        if company_id in (CO_A, CO_B):
            return (storage_router.DEDICATED, 1, False)
        return (storage_router.LEGACY, 0, False)

    monkeypatch.setattr(storage_router, "storage_decision", _decision)
    previous = server.db
    server.db = db
    trash.init(db)
    yield db
    server.db = previous
    trash.init(previous)


def _seed(db):
    for company_id, pos_balance, cash_balance, partner_balance, cari_balance in (
        (CO_A, 130000.0, 70000.0, 5000.0, 0.0),
        (CO_B, 80000.0, 4242.0, 9000.0, 777.0),
    ):
        _put(db, company_id, "bank_accounts", {
            "_id": POS_ACC, "type": "pos", "account_name": "POS",
            "current_balance": pos_balance, "currency": "TRY",
        })
        _put(db, company_id, "bank_accounts", {
            "_id": CASH_ACC, "type": "cash_box", "account_name": "Kasa",
            "current_balance": cash_balance, "currency": "TRY",
        })
        _put(db, company_id, "bank_transactions", {
            "_id": POS_TX, "account_id": POS_ACC, "account_name": "POS",
            "type": "inflow", "amount": 30000.0, "source": "manual",
            "description": "POS tahsilat", "date": "2026-10-24",
        })
        _put(db, company_id, "partners", {
            "_id": PARTNER, "name": "Ortak", "balance": partner_balance,
            "total_withdrawn": 5000.0, "share_percent": 0,
        })
        _put(db, company_id, "contacts", {
            "_id": CARI, "name": "Cari Tahsilat", "balance": cari_balance,
        })
        _put(db, company_id, "contacts", {
            "_id": CONTACT, "name": "Bos Cari", "balance": 0.0,
        })
        _put(db, company_id, "partner_transactions", {
            "_id": PTX, "partner_id": PARTNER, "partner_name": "Ortak",
            "type": "withdrawal", "amount": 5000.0, "account_id": CASH_ACC,
            "contact_id": CARI, "contact_name": "Cari Tahsilat",
            "description": "Cari tahsilat", "date": "2026-10-24",
        })
        _put(db, company_id, "bank_transactions", {
            "_id": CASH_TX, "account_id": CASH_ACC, "account_name": "Kasa",
            "type": "outflow", "amount": 5000.0, "source": "partner",
            "partner_tx_id": PTX, "description": "Ortak: Cari tahsilat",
            "date": "2026-10-24",
        })


def test_dedicated_deletes_once_and_second_attempt_is_404(routed):
    db = routed
    _seed(db)
    user = _user(CO_A)
    before_b = copy.deepcopy(db.dedicated[CO_B])

    out_tx = _run(server.delete_bank_transaction(POS_TX, user))
    assert out_tx["status"] == "success"
    assert _live(db, CO_A, "bank_transactions", POS_TX) is None
    assert _live(db, CO_A, "bank_accounts", POS_ACC)["current_balance"] == pytest.approx(100000.0)
    assert _inc_sum(db, "bank_accounts", CO_A, "current_balance") == pytest.approx(-30000.0)
    assert len([row for row in db.dedicated[CO_A]["trash"] if (row.get("doc") or {}).get("_id") == POS_TX]) == 1

    out_ptx = _run(server.delete_partner_transaction(PTX, user))
    assert out_ptx["status"] == "success"
    assert _live(db, CO_A, "partner_transactions", PTX) is None
    assert _live(db, CO_A, "bank_transactions", CASH_TX) is None
    assert _live(db, CO_A, "partners", PARTNER)["balance"] == pytest.approx(0.0)
    assert _live(db, CO_A, "contacts", CARI)["balance"] == pytest.approx(5000.0)
    assert _live(db, CO_A, "bank_accounts", CASH_ACC)["current_balance"] == pytest.approx(75000.0)
    assert _inc_sum(db, "partners", CO_A, "balance") == pytest.approx(-5000.0)
    assert _inc_sum(db, "contacts", CO_A, "balance") == pytest.approx(5000.0)

    out_contact = _run(server.delete_contact(CONTACT, user))
    assert out_contact["status"] == "success"
    assert _live(db, CO_A, "contacts", CONTACT) is None
    assert _inc_sum(db, "contacts", CO_A, "balance") == pytest.approx(5000.0)

    assert db.catalog == {}
    assert db.dedicated[CO_B] == before_b

    incs_after = list(db.incs)
    with pytest.raises(HTTPException) as tx_again:
        _run(server.delete_bank_transaction(POS_TX, user))
    with pytest.raises(HTTPException) as ptx_again:
        _run(server.delete_partner_transaction(PTX, user))
    with pytest.raises(HTTPException) as contact_again:
        _run(server.delete_contact(CONTACT, user))
    assert tx_again.value.status_code == 404
    assert ptx_again.value.status_code == 404
    assert contact_again.value.status_code == 404
    assert db.incs == incs_after
    assert _live(db, CO_A, "bank_accounts", POS_ACC)["current_balance"] == pytest.approx(100000.0)
    assert _live(db, CO_A, "partners", PARTNER)["balance"] == pytest.approx(0.0)
    assert _live(db, CO_A, "contacts", CARI)["balance"] == pytest.approx(5000.0)
    assert _live(db, CO_A, "bank_accounts", CASH_ACC)["current_balance"] == pytest.approx(75000.0)
    assert db.dedicated[CO_B] == before_b
    assert len([row for row in db.dedicated[CO_A]["trash"] if (row.get("doc") or {}).get("_id") == POS_TX]) == 1


def test_zero_delete_raises_and_reuses_existing_trash(routed):
    db = routed
    missing = {
        "_id": "gone", "company_id": CO_A, "amount": 10, "description": "yok",
    }
    with pytest.raises(HTTPException) as missing_exc:
        _run(trash.soft_delete("bank_transactions", missing, "bank_transaction", "yok"))
    assert missing_exc.value.status_code == 409
    assert "silinemedi" in missing_exc.value.detail.lower()
    assert db.dedicated[CO_A].get("trash", []) == []

    _put(db, CO_A, "trash", {
        "_id": "trash-existing",
        "collection": "bank_transactions",
        "entity_type": "bank_transaction",
        "company_id": CO_A,
        "doc": {"_id": "gone", "company_id": CO_A},
    })
    with pytest.raises(HTTPException) as again:
        _run(trash.soft_delete("bank_transactions", missing, "bank_transaction", "yok"))
    assert again.value.status_code == 409
    assert [row["_id"] for row in db.dedicated[CO_A]["trash"]] == ["trash-existing"]

    _put(db, CO_A, "contacts", {"_id": "c-live", "name": "Ali", "balance": 0})
    tid = _run(trash.soft_delete(
        "contacts",
        {"_id": "c-live", "company_id": CO_A, "name": "Ali", "balance": 0},
        "contact",
        "Ali",
    ))
    assert tid == "trash-existing" or tid
    assert _live(db, CO_A, "contacts", "c-live") is None
    originals = [row for row in db.dedicated[CO_A]["trash"] if (row.get("doc") or {}).get("_id") == "c-live"]
    assert len(originals) == 1
    assert originals[0]["_id"] == tid


def test_reuse_does_not_insert_a_second_trash_copy(routed):
    db = routed
    _put(db, CO_A, "bank_transactions", {
        "_id": "tx-live", "account_id": "a", "type": "inflow", "amount": 1,
        "source": "manual", "description": "bir",
    })
    _put(db, CO_A, "trash", {
        "_id": "trash-tx",
        "collection": "bank_transactions",
        "entity_type": "bank_transaction",
        "company_id": CO_A,
        "doc": {"_id": "tx-live", "company_id": CO_A},
        "related": [],
    })
    tid = _run(trash.soft_delete(
        "bank_transactions",
        {"_id": "tx-live", "company_id": CO_A, "amount": 1, "description": "bir"},
        "bank_transaction",
        "bir",
    ))
    assert tid == "trash-tx"
    assert _live(db, CO_A, "bank_transactions", "tx-live") is None
    assert [row["_id"] for row in db.dedicated[CO_A]["trash"]] == ["trash-tx"]


def test_legacy_without_company_id_deletes_catalog_only(routed):
    db = routed
    _put(db, None, "contacts", {"_id": "legacy-1", "name": "Eski"})
    _put(db, CO_A, "contacts", {"_id": "legacy-1", "name": "Dedicated"})
    tid = _run(trash.soft_delete("contacts", {"_id": "legacy-1", "name": "Eski"}, "contact", "Eski"))
    assert tid
    assert db.catalog["contacts"] == []
    assert _live(db, CO_A, "contacts", "legacy-1")["name"] == "Dedicated"
    assert db.catalog["trash"][0]["doc"]["_id"] == "legacy-1"
    assert "company_id" not in db.catalog["trash"][0] or db.catalog["trash"][0].get("company_id") in (None, "")


def test_effect_failure_restores_bank_transaction(routed, monkeypatch):
    db = routed
    _seed(db)

    async def _boom(_tx, _sign=-1):
        raise RuntimeError("bakiye yazılamadı")

    monkeypatch.setattr(server, "_reverse_tx_effects", _boom)
    with pytest.raises(HTTPException) as exc:
        _run(server.delete_bank_transaction(POS_TX, _user(CO_A)))
    assert exc.value.status_code == 500
    assert "geri" in exc.value.detail.lower()
    assert _live(db, CO_A, "bank_transactions", POS_TX)["amount"] == 30000.0
    assert _live(db, CO_A, "bank_accounts", POS_ACC)["current_balance"] == pytest.approx(130000.0)
    assert db.incs == []
    assert db.dedicated[CO_A].get("trash", []) == []
    assert _live(db, CO_B, "bank_transactions", POS_TX)["amount"] == 30000.0


def test_partner_effect_failure_restores_transaction(routed, monkeypatch):
    db = routed
    _seed(db)

    async def _boom(_tx):
        raise RuntimeError("ortak bakiye yazılamadı")

    monkeypatch.setattr(server, "_reverse_partner_tx", _boom)
    with pytest.raises(HTTPException) as exc:
        _run(server.delete_partner_transaction(PTX, _user(CO_A)))
    assert exc.value.status_code == 500
    assert _live(db, CO_A, "partner_transactions", PTX)["amount"] == 5000.0
    assert _live(db, CO_A, "partners", PARTNER)["balance"] == pytest.approx(5000.0)
    assert _live(db, CO_A, "contacts", CARI)["balance"] == pytest.approx(0.0)
    assert _live(db, CO_A, "bank_transactions", CASH_TX) is not None
    assert _live(db, CO_A, "bank_accounts", CASH_ACC)["current_balance"] == pytest.approx(70000.0)
    assert db.dedicated[CO_A].get("trash", []) == []


def test_restore_inserts_into_dedicated_store(routed):
    db = routed
    _put(db, CO_A, "contacts", {"_id": CONTACT, "name": "Bos Cari", "balance": 0})
    _put(db, CO_B, "contacts", {"_id": CONTACT, "name": "Diger", "balance": 3})
    user = _user(CO_A)
    _run(server.delete_contact(CONTACT, user))
    assert _live(db, CO_A, "contacts", CONTACT) is None
    assert _live(db, CO_B, "contacts", CONTACT)["balance"] == 3
    trash_id = db.dedicated[CO_A]["trash"][0]["_id"]
    trash._hooks.clear()
    out = _run(trash.restore_trash_item(trash_id, user=user))
    assert out["status"] == "success"
    restored = _live(db, CO_A, "contacts", CONTACT)
    assert restored["company_id"] == CO_A
    assert restored["name"] == "Bos Cari"
    assert _live(db, CO_B, "contacts", CONTACT)["name"] == "Diger"
    assert db.catalog.get("contacts", []) == []
