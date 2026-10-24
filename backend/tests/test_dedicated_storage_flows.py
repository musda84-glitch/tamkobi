"""Dedicated kipte iki şirket: ödeme silme, virman, POS ayı, banka eşleme.

Kayıt yalnız sqlite dedicated depodadır. Paylaşılan katalog boştur.
Canlı veritabanına ve 8021 portuna bağlanmaz. DSN, VKN ve ETTN loglanmaz.
"""
from __future__ import annotations

import asyncio
import logging
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

import bank_rematch
import server
import storage_router
import tenant_access
import trash
from models import BankTransaction
from test_dedicated_tenant_doc import (
    ERSAY,
    MATEK,
    _by_id,
    _company,
    _load_docs,
    _open_dedicated,
    _put,
    _restore,
    _seal,
    _Store,
    _unuse,
    _use,
    _user,
)

VKN = "VKN-GIZLI-TOKEN"
ETTN = "ETTN-GIZLI-TOKEN"


def _bind(db):
    previous = _use(db)
    trash.init(db)
    return previous


def _open(monkeypatch, tmp_path):
    previous_key, comm = _seal(monkeypatch, tmp_path)
    monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
    sealed, paths = _open_dedicated(tmp_path, (MATEK, ERSAY))
    db = _Store([
        _company(MATEK, "dedicated", sealed[MATEK]),
        _company(ERSAY, "dedicated", sealed[ERSAY]),
    ])
    return previous_key, comm, db, paths


def test_payment_delete_reverses_dedicated_and_blocks_other_company(monkeypatch, tmp_path, caplog):
    previous_key, comm, db, paths = _open(monkeypatch, tmp_path)
    admin = _user(MATEK)
    other = _user(ERSAY)
    day, _end = bank_rematch.istanbul_month_bounds()

    async def seed():
        await _put(db, MATEK, "bank_accounts", {
            "_id": "acc_pay", "company_id": MATEK, "type": "bank",
            "account_name": "Kuveyt", "current_balance": 200.0, "currency": "TRY",
        })
        await _put(db, ERSAY, "bank_accounts", {
            "_id": "acc_pay", "company_id": ERSAY, "type": "bank",
            "account_name": "Kuveyt", "current_balance": 999.0, "currency": "TRY",
        })
        await _put(db, MATEK, "contacts", {
            "_id": "cnt_pay", "company_id": MATEK, "name": "Cari", "balance": 0.0,
        })
        await _put(db, ERSAY, "contacts", {
            "_id": "cnt_pay", "company_id": ERSAY, "name": "Cari", "balance": 77.0,
        })

    asyncio.run(seed())
    bound = _bind(db)
    try:
        async def run():
            tx = BankTransaction(
                company_id=MATEK,
                account_id="acc_pay",
                account_name="Kuveyt",
                type="outflow",
                category="Cari Ödeme",
                amount=40,
                description="Cari Ödeme",
                contact_id="cnt_pay",
                contact_name="Cari",
                date=day,
                source="manual",
            )
            created = await server.create_bank_transaction(tx, admin)
            assert created["company_id"] == MATEK
            assert created["category"] == "Cari Ödeme"
            matek_acc = _by_id(_load_docs(paths[MATEK], "bank_accounts"), "acc_pay")
            assert matek_acc["current_balance"] == 160.0
            matek_tx = [row for row in _load_docs(paths[MATEK], "bank_transactions") if row.get("contact_id") == "cnt_pay"]
            assert len(matek_tx) == 1
            assert _load_docs(paths[ERSAY], "bank_transactions") == []
            assert _by_id(_load_docs(paths[ERSAY], "bank_accounts"), "acc_pay")["current_balance"] == 999.0

            out = await server.delete_bank_transaction(created["id"], admin)
            assert out["status"] == "success"
            gone = _load_docs(paths[MATEK], "bank_transactions")
            assert all(row.get("_id") != created["id"] for row in gone)
            assert _by_id(_load_docs(paths[MATEK], "bank_accounts"), "acc_pay")["current_balance"] == 200.0
            assert _by_id(_load_docs(paths[MATEK], "contacts"), "cnt_pay")["balance"] == 0.0
            assert _by_id(_load_docs(paths[ERSAY], "bank_accounts"), "acc_pay")["current_balance"] == 999.0
            assert _by_id(_load_docs(paths[ERSAY], "contacts"), "cnt_pay")["balance"] == 77.0
            with pytest.raises(HTTPException) as missing:
                await server.delete_bank_transaction(created["id"], admin)
            assert missing.value.status_code == 404
            with pytest.raises(HTTPException) as foreign:
                await server.delete_bank_transaction(created["id"], other)
            assert foreign.value.status_code == 404
            assert db.catalog_writes == []

        with caplog.at_level(logging.DEBUG):
            asyncio.run(run())
    finally:
        _unuse(bound)
        _restore(monkeypatch, previous_key, comm)
    assert VKN not in caplog.text
    assert "sqlite://" not in caplog.text


def test_virman_pos_month_and_settlement_stay_in_company(monkeypatch, tmp_path):
    previous_key, comm, db, paths = _open(monkeypatch, tmp_path)
    admin = _user(MATEK)
    day, _end = bank_rematch.istanbul_month_bounds()

    async def seed():
        for cid, bank_bal, pos_bal in ((MATEK, 100.0, 999.0), (ERSAY, 500.0, 111.0)):
            await _put(db, cid, "bank_accounts", {
                "_id": "acc_bank", "company_id": cid, "type": "bank",
                "account_name": "Banka", "current_balance": bank_bal, "currency": "TRY",
            })
            await _put(db, cid, "bank_accounts", {
                "_id": "acc_tgt", "company_id": cid, "type": "bank",
                "account_name": "Hedef", "current_balance": 10.0 if cid == MATEK else 80.0,
                "currency": "TRY",
            })
            await _put(db, cid, "bank_accounts", {
                "_id": "acc_pos", "company_id": cid, "type": "pos",
                "account_name": "POS", "current_balance": pos_bal, "currency": "TRY",
            })
        await _put(db, MATEK, "bank_transactions", {
            "_id": "tx_open", "company_id": MATEK, "account_id": "acc_pos",
            "type": "inflow", "amount": 500, "source": "opening",
            "date": "2020-01-01", "description": "Açılış",
        })
        await _put(db, MATEK, "bank_transactions", {
            "_id": "tx_bloke", "company_id": MATEK, "account_id": "acc_pos",
            "type": "outflow", "amount": 100, "source": "bank_match",
            "date": day, "description": "Banka ← POS: POS bloke çözümü",
        })
        await _put(db, ERSAY, "bank_transactions", {
            "_id": "tx_bloke", "company_id": ERSAY, "account_id": "acc_pos",
            "type": "outflow", "amount": 1, "source": "bank_match",
            "date": day, "description": "Ersay bloke",
        })

    asyncio.run(seed())
    bound = _bind(db)
    try:
        async def run():
            listed = await server.list_bank_accounts(MATEK, with_month=1, user=admin)
            by_id = {row["id"]: row for row in listed}
            assert by_id["acc_pos"]["current_balance"] == 400.0
            assert by_id["acc_pos"]["month_out"] == 100.0
            assert by_id["acc_pos"]["month_in"] == 0.0
            assert _by_id(_load_docs(paths[MATEK], "bank_accounts"), "acc_pos")["current_balance"] == 999.0

            await server._execute_virman({
                "company_id": MATEK,
                "source_account_id": "acc_bank",
                "target_account_id": "acc_tgt",
                "amount": 30,
                "description": "Virman",
                "date": day,
            })
            assert _by_id(_load_docs(paths[MATEK], "bank_accounts"), "acc_bank")["current_balance"] == 70.0
            assert _by_id(_load_docs(paths[MATEK], "bank_accounts"), "acc_tgt")["current_balance"] == 40.0
            assert _by_id(_load_docs(paths[ERSAY], "bank_accounts"), "acc_bank")["current_balance"] == 500.0
            assert _by_id(_load_docs(paths[ERSAY], "bank_accounts"), "acc_tgt")["current_balance"] == 80.0
            transfers = [row for row in _load_docs(paths[MATEK], "bank_transactions") if row.get("type") == "transfer"]
            assert len(transfers) == 1
            assert transfers[0]["company_id"] == MATEK
            assert _load_docs(paths[ERSAY], "bank_transactions") == [
                row for row in _load_docs(paths[ERSAY], "bank_transactions") if row["_id"] == "tx_bloke"
            ]

            listed = await server.list_bank_accounts(MATEK, with_month=1, user=admin)
            by_id = {row["id"]: row for row in listed}
            assert by_id["acc_bank"]["month_out"] == 30.0
            assert by_id["acc_tgt"]["month_in"] == 30.0
            assert by_id["acc_pos"]["month_out"] == 100.0
            assert by_id["acc_pos"]["current_balance"] == 400.0

            bank_tx = {
                "_id": "tx_settle", "company_id": MATEK, "account_id": "acc_bank",
                "account_name": "Banka", "type": "inflow", "amount": 100,
                "date": day, "description": "POS bloke", "match_status": "unmatched",
            }
            await _put(db, MATEK, "bank_transactions", bank_tx)
            # Brüt = net, komisyon 0. Masraf kaydı açılmaz.
            # Örtü yazılmadığı için depodaki 999 durur; çözüm brütün sığması için 500'e çekilir.
            import storage_dedicated
            await storage_dedicated.collection(db, MATEK, "bank_accounts").update_one(
                {"_id": "acc_pos", "company_id": MATEK},
                {"$set": {"current_balance": 500.0}},
            )
            matched = await server._apply_match(
                bank_tx, None, None, "POS Komisyonu",
                learn=False, target_account_id="acc_pos", mode="pos_settlement",
                pos_gross=100, pos_commission=0,
            )
            assert matched["company_id"] == MATEK
            assert matched["match_status"] == "matched"
            assert _by_id(_load_docs(paths[MATEK], "bank_accounts"), "acc_pos")["current_balance"] == 400.0
            counters = [
                row for row in _load_docs(paths[MATEK], "bank_transactions")
                if row.get("source") == "bank_match" and row.get("account_id") == "acc_pos" and row.get("date") == day
            ]
            assert any(float(row.get("amount") or 0) == 100 for row in counters)
            assert _by_id(_load_docs(paths[ERSAY], "bank_accounts"), "acc_pos")["current_balance"] == 111.0
            assert _by_id(_load_docs(paths[ERSAY], "bank_transactions"), "tx_bloke")["amount"] == 1

            listed = await server.list_bank_accounts(MATEK, with_month=1, user=admin)
            by_id = {row["id"]: row for row in listed}
            # Açılış 500 + bloke 100 + yeni çözüm 100. Banka girişi POS ayına yazılmaz.
            assert by_id["acc_pos"]["current_balance"] == 300.0
            assert by_id["acc_pos"]["month_out"] == 200.0
            assert by_id["acc_pos"]["month_in"] == 0.0
            assert by_id["acc_bank"]["month_in"] == 100.0
            assert db.catalog_writes == []

        asyncio.run(run())
    finally:
        _unuse(bound)
        _restore(monkeypatch, previous_key, comm)


def test_order_invoice_and_edoc_do_not_cross(monkeypatch, tmp_path, caplog):
    previous_key, comm, db, paths = _open(monkeypatch, tmp_path)
    admin = _user(MATEK)
    other = _user(ERSAY)

    async def seed():
        await _put(db, MATEK, "orders", {
            "_id": "ord_status", "company_id": MATEK, "order_status": "pending",
            "channel": "manual", "order_number": "S-1",
        })
        await _put(db, ERSAY, "orders", {
            "_id": "ord_status", "company_id": ERSAY, "order_status": "ersay",
            "channel": "manual",
        })
        await _put(db, MATEK, "orders", {
            "_id": "ord_inv", "company_id": MATEK, "order_status": "approved",
            "channel": "manual", "is_invoiced": False,
        })
        await _put(db, MATEK, "invoices", {
            "_id": "inv_draft", "company_id": MATEK, "invoice_type": "sales",
            "status": "draft", "e_type": "paper", "items": [], "grand_total": 10,
            "order_id": "ord_inv", "invoice_number": "TASLAK-1",
        })
        await _put(db, MATEK, "contacts", {
            "_id": "cnt_matek", "company_id": MATEK, "type": "supplier",
            "name": "Tedarik", "tax_number_or_id": VKN, "balance": 0,
        })
        await _put(db, MATEK, "incoming_edocs", {
            "_id": "ed_only", "company_id": MATEK, "status": "pending",
            "kind": "invoice", "source": "manual", "number": "GELEN-1",
            "supplier": {"name": "Tedarik", "tax_id": VKN},
            "lines": [{"name": "Hizmet", "quantity": 1, "unit_price": 10, "total": 10, "vat_rate": 20}],
            "subtotal": 10, "vat_total": 2, "grand_total": 12, "ettn": ETTN,
        })

    asyncio.run(seed())
    bound = _bind(db)
    try:
        import edocs

        async def run():
            status = await server.update_order_status("ord_status", {"status": "approved"}, admin)
            assert status["order_status"] == "approved"
            approved = await server.approve_invoice("inv_draft", admin)
            assert approved["status"] == "success"
            processed = await edocs.process_edoc("ed_only", {}, admin)
            assert processed["status"] == "success"
            with pytest.raises(HTTPException) as denied:
                await server.update_order_status("ord_inv", {"status": "cancelled"}, other)
            assert denied.value.status_code == 404

        with caplog.at_level(logging.DEBUG):
            asyncio.run(run())
    finally:
        _unuse(bound)
        _restore(monkeypatch, previous_key, comm)

    assert _by_id(_load_docs(paths[MATEK], "orders"), "ord_status")["order_status"] == "approved"
    assert _by_id(_load_docs(paths[ERSAY], "orders"), "ord_status")["order_status"] == "ersay"
    assert _by_id(_load_docs(paths[MATEK], "invoices"), "inv_draft")["status"] == "approved"
    assert _by_id(_load_docs(paths[MATEK], "incoming_edocs"), "ed_only")["status"] == "approved"
    assert db.catalog_writes == []
    assert VKN not in caplog.text
    assert ETTN not in caplog.text
    assert "sqlite://" not in caplog.text


def test_delete_helper_legacy_is_silent_and_dedicated_404(monkeypatch):
    class _Coll:
        def __init__(self):
            self.queries = []

        async def delete_one(self, query):
            self.queries.append(query)
            return SimpleNamespace(deleted_count=0)

    class _DB:
        def __init__(self):
            self.coll = _Coll()

        def __getitem__(self, name):
            return self.coll

    db = _DB()

    async def legacy(_db, company_id):
        return storage_router.LEGACY

    async def dedicated(_db, company_id):
        return storage_router.DEDICATED

    async def off(_db, company_id):
        return None

    async def run():
        monkeypatch.setattr(tenant_access, "_routed_mode", legacy)
        await tenant_access.delete_one_company(db, "bank_transactions", "tx1", MATEK)
        assert db.coll.queries[-1] == {"_id": "tx1"}
        monkeypatch.setattr(tenant_access, "_routed_mode", off)
        await tenant_access.delete_one_company(db, "bank_transactions", "tx1", MATEK)
        assert db.coll.queries[-1] == {"_id": "tx1"}
        monkeypatch.setattr(tenant_access, "_routed_mode", dedicated)
        with pytest.raises(HTTPException) as missing:
            await tenant_access.delete_one_company(db, "bank_transactions", "tx1", MATEK)
        assert missing.value.status_code == 404
        assert db.coll.queries[-1] == {"_id": "tx1", "company_id": MATEK}

    asyncio.run(run())
