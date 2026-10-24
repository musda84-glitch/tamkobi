"""#1565 inceleme düzeltmeleri.

Yetim bakiye susar; matched_count==0 ve belge duruyorsa yazma geri alınır.
POS örtüsü entegre hesabı ve kesik listeyi atlar, drift'i gizlemez.
unpay company_id kullanır. Legacy company_id'siz kaydı okumaya devam eder.
"""
from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import account_balance
import pos_settlement
import server
import storage_dedicated
import tenant_access
from dashboard_memdb import MemDB
from test_dedicated_storage_flows import _bind, _open
from test_dedicated_tenant_doc import MATEK, _by_id, _load_docs, _put, _restore, _unuse, _user


def test_dedicated_update_one_matched_count_is_not_modified_count(monkeypatch, tmp_path):
    previous_key, comm, db, _paths = _open(monkeypatch, tmp_path)

    async def run():
        coll = storage_dedicated.collection(db, MATEK, "bank_accounts")
        missing = await coll.update_one(
            {"_id": "yok", "company_id": MATEK},
            {"$inc": {"current_balance": 5}},
        )
        assert missing.matched_count == 0
        assert missing.modified_count == 0
        await coll.insert_one({
            "_id": "acc", "company_id": MATEK, "type": "bank", "current_balance": 10.0,
        })
        hit = await coll.update_one(
            {"_id": "acc", "company_id": MATEK},
            {"$inc": {"current_balance": 5}},
        )
        assert hit.matched_count == 1
        assert hit.modified_count == 1
        same = await coll.update_one(
            {"_id": "acc", "company_id": MATEK},
            {"$set": {"current_balance": 15.0}},
        )
        assert same.matched_count == 1
        assert same.modified_count == 0

    try:
        asyncio.run(run())
    finally:
        _restore(monkeypatch, previous_key, comm)


def test_reverse_orphan_is_soft_and_real_miss_rolls_back(monkeypatch, tmp_path, caplog):
    previous_key, comm, db, paths = _open(monkeypatch, tmp_path)

    async def seed():
        await _put(db, MATEK, "bank_accounts", {
            "_id": "acc", "company_id": MATEK, "type": "bank",
            "account_name": "Kasa", "current_balance": 200.0,
        })
        await _put(db, MATEK, "contacts", {
            "_id": "cnt", "company_id": MATEK, "name": "Cari", "balance": 40.0,
        })
        await _put(db, MATEK, "bank_transactions", {
            "_id": "tx", "company_id": MATEK, "account_id": "acc",
            "type": "outflow", "amount": 40.0, "source": "manual",
            "description": "Cari Ödeme", "contact_id": "yok",
        })

    asyncio.run(seed())
    bound = _bind(db)
    try:
        async def run():
            with caplog.at_level("WARNING", logger="TamKobiERP"):
                await server._reverse_tx_effects({
                    "_id": "tx", "company_id": MATEK, "type": "outflow", "amount": 40.0,
                    "account_id": "acc", "contact_id": "yok", "source": "manual",
                }, -1)
            assert _by_id(_load_docs(paths[MATEK], "bank_accounts"), "acc")["current_balance"] == 240.0
            warnings = [rec.getMessage() for rec in caplog.records if rec.levelname == "WARNING"]
            assert "Yetim bakiye satırı atlandı." in warnings
            assert all("40" not in text and MATEK not in text for text in warnings)

            contacts = db.contacts

            async def miss(query, update, upsert=False):
                return SimpleNamespace(matched_count=0, modified_count=0)

            contacts.update_one = miss
            with pytest.raises(HTTPException) as raised:
                await server._reverse_tx_effects({
                    "_id": "tx2", "company_id": MATEK, "type": "outflow", "amount": 10.0,
                    "account_id": "acc", "contact_id": "cnt", "source": "manual",
                }, -1)
            assert raised.value.status_code == 404
            assert _by_id(_load_docs(paths[MATEK], "bank_accounts"), "acc")["current_balance"] == 240.0
            assert _by_id(_load_docs(paths[MATEK], "contacts"), "cnt")["balance"] == 40.0

            await _put(db, MATEK, "bank_transactions", {
                "_id": "tx_real", "company_id": MATEK, "account_id": "acc",
                "type": "outflow", "amount": 40.0, "source": "manual", "contact_id": "cnt",
            })
            with pytest.raises(HTTPException):
                await server.update_bank_transaction("tx_real", {"amount": 15}, _user(MATEK))
            assert _by_id(_load_docs(paths[MATEK], "bank_transactions"), "tx_real")["amount"] == 40.0
            assert _by_id(_load_docs(paths[MATEK], "bank_accounts"), "acc")["current_balance"] == 240.0

        asyncio.run(run())
    finally:
        _unuse(bound)
        _restore(monkeypatch, previous_key, comm)


def test_update_orphan_contact_completes_and_restore_rolls_real_miss(monkeypatch, tmp_path):
    previous_key, comm, db, paths = _open(monkeypatch, tmp_path)

    async def seed():
        await _put(db, MATEK, "bank_accounts", {
            "_id": "acc", "company_id": MATEK, "type": "bank", "current_balance": 200.0,
        })
        await _put(db, MATEK, "contacts", {
            "_id": "cnt", "company_id": MATEK, "name": "Cari", "balance": 5.0,
        })
        await _put(db, MATEK, "bank_transactions", {
            "_id": "tx", "company_id": MATEK, "account_id": "acc",
            "type": "outflow", "amount": 40.0, "source": "manual", "contact_id": "yok",
        })

    asyncio.run(seed())
    bound = _bind(db)
    try:
        async def run():
            updated = await server.update_bank_transaction("tx", {"amount": 10}, _user(MATEK))
            assert updated["amount"] == 10.0
            assert _by_id(_load_docs(paths[MATEK], "bank_accounts"), "acc")["current_balance"] == 230.0

            contacts = db.contacts

            async def miss(query, update, upsert=False):
                return SimpleNamespace(matched_count=0, modified_count=0)

            contacts.update_one = miss
            before = _by_id(_load_docs(paths[MATEK], "bank_accounts"), "acc")["current_balance"]
            with pytest.raises(HTTPException) as raised:
                await server._restore_bank_tx({
                    "_id": "tx", "company_id": MATEK, "type": "outflow", "amount": 10.0,
                    "account_id": "acc", "contact_id": "cnt", "source": "manual",
                }, [])
            assert raised.value.status_code == 404
            assert _by_id(_load_docs(paths[MATEK], "bank_accounts"), "acc")["current_balance"] == before

        asyncio.run(run())
    finally:
        _unuse(bound)
        _restore(monkeypatch, previous_key, comm)


def test_overlay_skips_integrated_and_truncated_lists():
    manual = {"_id": "pos", "type": "pos", "current_balance": 999.0, "is_integrated": False}
    integrated = {"_id": "ipos", "type": "okc_pos", "current_balance": 50.0, "is_integrated": True}
    txs = [
        {"_id": "open", "account_id": "pos", "type": "inflow", "amount": 500, "source": "opening"},
        {"_id": "out", "account_id": "pos", "type": "outflow", "amount": 100, "source": "bank_match"},
        {"_id": "iopen", "account_id": "ipos", "type": "inflow", "amount": 10, "source": "opening"},
    ]
    account_balance.overlay_pos_movement_balances([manual, integrated], txs)
    assert manual["current_balance"] == 400.0
    assert integrated["current_balance"] == 50.0

    capped = {"_id": "pos", "type": "pos", "current_balance": 999.0}
    account_balance.overlay_pos_movement_balances([capped], txs, truncated=True)
    assert capped["current_balance"] == 999.0

    limited = {"_id": "pos", "type": "pos", "current_balance": 999.0}
    account_balance.overlay_pos_movement_balances([limited], [{}] * account_balance.COMPANY_TX_LIMIT)
    assert limited["current_balance"] == 999.0


def test_pos_list_keeps_drift_skips_integrated_and_limit(monkeypatch, tmp_path):
    previous_key, comm, db, paths = _open(monkeypatch, tmp_path)
    admin = _user(MATEK)

    async def seed():
        await _put(db, MATEK, "bank_accounts", {
            "_id": "acc_pos", "company_id": MATEK, "type": "pos",
            "account_name": "POS", "current_balance": 999.0,
        })
        await _put(db, MATEK, "bank_accounts", {
            "_id": "acc_ipos", "company_id": MATEK, "type": "okc_pos",
            "account_name": "Entegre", "current_balance": 80.0,
        })
        await _put(db, MATEK, "bank_connections", {
            "_id": "conn", "company_id": MATEK, "linked_account_id": "acc_ipos",
            "provider_name": "Banka", "status": "active",
        })
        await _put(db, MATEK, "bank_transactions", {
            "_id": "tx_open", "company_id": MATEK, "account_id": "acc_pos",
            "type": "inflow", "amount": 500, "source": "opening", "date": "2020-01-01",
        })
        await _put(db, MATEK, "bank_transactions", {
            "_id": "tx_out", "company_id": MATEK, "account_id": "acc_pos",
            "type": "outflow", "amount": 100, "source": "bank_match", "date": "2020-02-01",
        })
        await _put(db, MATEK, "bank_transactions", {
            "_id": "tx_i", "company_id": MATEK, "account_id": "acc_ipos",
            "type": "inflow", "amount": 10, "source": "opening", "date": "2020-01-01",
        })

    asyncio.run(seed())
    bound = _bind(db)
    try:
        async def run():
            listed = await server.list_bank_accounts(MATEK, with_drift=1, user=admin)
            by_id = {row["id"]: row for row in listed}
            assert by_id["acc_pos"]["current_balance"] == 400.0
            assert by_id["acc_pos"]["ledger_balance"] == 400.0
            assert by_id["acc_pos"]["balance_drift"] is True
            assert by_id["acc_ipos"]["is_integrated"] is True
            assert by_id["acc_ipos"]["current_balance"] == 80.0
            assert by_id["acc_ipos"]["ledger_balance"] == 10.0
            assert by_id["acc_ipos"]["balance_drift"] is True
            assert _by_id(_load_docs(paths[MATEK], "bank_accounts"), "acc_pos")["current_balance"] == 999.0

            monkeypatch.setattr(account_balance, "COMPANY_TX_LIMIT", 1)
            capped = await server.list_bank_accounts(MATEK, user=admin)
            capped_pos = {row["id"]: row for row in capped}["acc_pos"]
            assert capped_pos["current_balance"] == 999.0

        asyncio.run(run())
    finally:
        _unuse(bound)
        _restore(monkeypatch, previous_key, comm)


def test_settlement_gate_uses_stored_balance_not_overlay(monkeypatch, tmp_path):
    """Örtü 400 gösterir; kayıtlı 999 brüt 500'e izin verir. İkisi bilinçli olarak ayrıdır."""
    previous_key, comm, db, paths = _open(monkeypatch, tmp_path)

    async def seed():
        await _put(db, MATEK, "bank_accounts", {
            "_id": "acc_pos", "company_id": MATEK, "type": "pos",
            "account_name": "POS", "current_balance": 999.0,
        })
        await _put(db, MATEK, "bank_transactions", {
            "_id": "tx_open", "company_id": MATEK, "account_id": "acc_pos",
            "type": "inflow", "amount": 500, "source": "opening", "date": "2020-01-01",
        })
        await _put(db, MATEK, "bank_transactions", {
            "_id": "tx_out", "company_id": MATEK, "account_id": "acc_pos",
            "type": "outflow", "amount": 100, "source": "bank_match", "date": "2020-02-01",
        })

    asyncio.run(seed())
    bound = _bind(db)
    try:
        async def run():
            listed = await server.list_bank_accounts(MATEK, user=_user(MATEK))
            shown = {row["id"]: row for row in listed}["acc_pos"]["current_balance"]
            assert shown == 400.0
            await pos_settlement.apply(
                db,
                {
                    "_id": "bank_in", "company_id": MATEK, "account_id": "bank",
                    "account_name": "Banka", "type": "inflow", "amount": 500,
                    "date": "2020-02-02",
                },
                pos_account_id="acc_pos",
                gross=500,
                commission=0,
                category="POS",
                actor=None,
            )
            stored = _by_id(_load_docs(paths[MATEK], "bank_accounts"), "acc_pos")["current_balance"]
            assert stored == 499.0
            again = await server.list_bank_accounts(MATEK, user=_user(MATEK))
            display = {row["id"]: row for row in again}["acc_pos"]["current_balance"]
            assert display == -100.0
            assert display != stored

        asyncio.run(run())
    finally:
        _unuse(bound)
        _restore(monkeypatch, previous_key, comm)


def test_unpay_installment_scopes_company(monkeypatch):
    db = MemDB()
    db.installments.docs.extend([
        {"_id": "i1", "company_id": "A", "paid_amount": 10, "status": "paid", "amount": 10, "invoice_id": "inv"},
        {"_id": "i1", "company_id": "B", "paid_amount": 10, "status": "paid", "amount": 10, "invoice_id": "inv"},
    ])
    db.invoices.docs.extend([
        {"_id": "inv", "company_id": "A", "installment_plan": {"paid_count": 1}},
        {"_id": "inv", "company_id": "B", "installment_plan": {"paid_count": 1}},
    ])

    async def _doc(*_args, **_kwargs):
        return db.installments.docs[0]

    async def _rev(*_args, **_kwargs):
        return {"ok": True}

    monkeypatch.setattr(server.tenant_access, "get_tenant_doc", _doc)
    monkeypatch.setattr(server.linked_moves, "reverse_linked", _rev)
    previous = server.db
    server.db = db
    try:
        asyncio.run(server.unpay_installment("i1", {"company_id": "A", "active_company_id": "A", "company_ids": ["A"]}))
    finally:
        server.db = previous
    assert db.installments.docs[0]["status"] == "pending"
    assert db.installments.docs[0]["paid_amount"] == 0
    assert db.installments.docs[1]["status"] == "paid"
    assert db.invoices.docs[0]["installment_plan"]["paid_count"] == 0
    assert db.invoices.docs[1]["installment_plan"]["paid_count"] == 1


class _Rows:
    def __init__(self):
        self.rows = []

    async def find_one(self, query, projection=None):
        for row in self.rows:
            if all(row.get(key) == value for key, value in (query or {}).items()):
                return row
        return None


class _Fake:
    def __init__(self):
        self.contacts = _Rows()
        self.expenses = _Rows()
        self.products = _Rows()


def test_legacy_keeps_id_fallback_dedicated_does_not(monkeypatch):
    monkeypatch.delenv("STORAGE_ROUTER_ENABLED", raising=False)
    fake = _Fake()
    fake.contacts.rows.append({"_id": "c_old", "name": "Eski cari"})
    fake.expenses.rows.append({"_id": "e_old", "source": "manual"})
    fake.products.rows.append({"_id": "p_old", "name": "Eski ürün"})
    previous = server.db
    server.db = fake
    try:
        contact = asyncio.run(server._virman_load_contact("co", "c_old"))
        assert contact["name"] == "Eski cari"
        related = asyncio.run(server._linked_expense_related({"expense_id": "e_old"}))
        assert related[0]["docs"][0]["_id"] == "e_old"
        product = asyncio.run(server._pos_load_product("co", "p_old"))
        assert product["name"] == "Eski ürün"

        async def dedicated(_db, _company_id):
            return False

        monkeypatch.setattr(tenant_access, "legacy_unscoped_ok", dedicated)
        with pytest.raises(HTTPException) as raised:
            asyncio.run(server._virman_load_contact("co", "c_old"))
        assert raised.value.status_code == 404
        assert asyncio.run(server._linked_expense_related({"expense_id": "e_old", "company_id": "co"})) == []
        assert asyncio.run(server._pos_load_product("co", "p_old")) is None
    finally:
        server.db = previous
