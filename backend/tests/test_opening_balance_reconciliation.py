"""Banka açılış bakiyesi deftere yazılır; mutabakat farkı ve çift IBAN."""
from __future__ import annotations

import asyncio
import copy
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import account_balance
import balance_reconciliation
import server
from models import BankAccount, BankConnection
from mysql_store import match_query

IBAN = "TR330006100519786457841326"
IBAN_SPACED = "TR33 0006 1005 1978 6457 8413 26"


def _run(coro):
    return asyncio.run(coro)


class _Cursor:
    def __init__(self, docs):
        self._docs = docs

    def sort(self, *args, **kwargs):
        return self

    async def to_list(self, length=None):
        rows = self._docs if length is None else self._docs[:length]
        return copy.deepcopy(rows)


class MemoryCollection:
    def __init__(self):
        self.docs = {}

    async def insert_one(self, doc):
        stored = copy.deepcopy(doc)
        if not stored.get("_id"):
            stored["_id"] = "generated"
        self.docs[stored["_id"]] = stored
        return stored

    async def find_one(self, query, projection=None):
        for doc in self.docs.values():
            if match_query(doc, query or {}):
                return copy.deepcopy(doc)
        return None

    def find(self, query=None, projection=None):
        matched = [copy.deepcopy(d) for d in self.docs.values() if match_query(d, query or {})]
        return _Cursor(matched)

    async def update_one(self, query, update, upsert=False):
        for doc in self.docs.values():
            if not match_query(doc, query or {}):
                continue
            for key, value in (update.get("$set") or {}).items():
                doc[key] = value
            for key, value in (update.get("$inc") or {}).items():
                doc[key] = round(float(doc.get(key) or 0) + float(value), 2)
            for key in (update.get("$unset") or {}):
                doc.pop(key, None)
            return SimpleNamespace(modified_count=1, matched_count=1)
        return SimpleNamespace(modified_count=0, matched_count=0)

    async def delete_one(self, query):
        for doc_id, doc in list(self.docs.items()):
            if match_query(doc, query or {}):
                del self.docs[doc_id]
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def delete_many(self, query):
        removed = 0
        for doc_id, doc in list(self.docs.items()):
            if match_query(doc, query or {}):
                del self.docs[doc_id]
                removed += 1
        return SimpleNamespace(deleted_count=removed)

    async def count_documents(self, query=None):
        return sum(1 for doc in self.docs.values() if match_query(doc, query or {}))


class MemoryDB:
    def __init__(self):
        self._cols = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return self[name]

    def __getitem__(self, name):
        self._cols.setdefault(name, MemoryCollection())
        return self._cols[name]


def _user(company="co"):
    return {
        "id": f"user-{company}",
        "name": "Ayşe",
        "company_ids": [company],
        "active_company_id": company,
        "role": "admin",
    }


def _openings(db, account_id=None):
    rows = [d for d in db.bank_transactions.docs.values() if d.get("source") == "opening"]
    if account_id:
        rows = [d for d in rows if d.get("account_id") == account_id]
    return rows


@pytest.fixture
def db(monkeypatch):
    mem = MemoryDB()
    monkeypatch.setattr(server, "db", mem)
    return mem


def test_bank_account_opening_balance_writes_ledger_and_fark_is_zero(db):
    async def scenario():
        created = await server.create_bank_account(BankAccount(
            company_id="co", type="bank", bank_name="Enpara", account_name="Vadesiz",
            iban=IBAN, currency="TRY", current_balance=75,
        ))
        aid = created["id"]
        stored = await db.bank_accounts.find_one({"_id": aid})
        assert stored["current_balance"] == pytest.approx(75)
        openings = _openings(db, aid)
        assert len(openings) == 1
        assert openings[0]["source"] == "opening"
        assert openings[0]["type"] == "inflow"
        assert openings[0]["amount"] == pytest.approx(75)
        report = await balance_reconciliation.build_reconciliation(db, "co")
        row = next(r for r in report["accounts"] if r["id"] == aid)
        assert row["fark"] == pytest.approx(0)
        assert row["acilis_var"] is True

        pos = await server.create_bank_account(BankAccount(
            company_id="co", type="pos", bank_name="POS", account_name="Mağaza POS",
            currency="TRY", current_balance=12.5,
        ))
        card = await server.create_bank_account(BankAccount(
            company_id="co", type="credit_card", bank_name="Bonus", account_name="Şirket Kart",
            currency="TRY", current_balance=-80, card_owner="company",
        ))
        cash = await server.create_bank_account(BankAccount(
            company_id="co", type="cash_box", bank_name="Kasa", account_name="Merkez",
            currency="TRY", current_balance=10,
        ))
        zero = await server.create_bank_account(BankAccount(
            company_id="co", type="bank", bank_name="Boş", account_name="Sıfır",
            currency="TRY", current_balance=0,
        ))
        pool = await server.create_bank_account(BankAccount(
            company_id="co", type="credit_card", bank_name="Havuz", account_name="Müşteri",
            currency="TRY", current_balance=50, is_customer_card_pool=True, card_owner="customer",
        ))
        assert _openings(db, pos["id"])[0]["amount"] == pytest.approx(12.5)
        card_tx = _openings(db, card["id"])[0]
        assert card_tx["type"] == "outflow"
        assert card_tx["amount"] == pytest.approx(80)
        assert _openings(db, cash["id"])[0]["amount"] == pytest.approx(10)
        assert _openings(db, zero["id"]) == []
        assert _openings(db, pool["id"]) == []
        report = await balance_reconciliation.build_reconciliation(db, "co")
        by_id = {r["id"]: r for r in report["accounts"]}
        assert by_id[pos["id"]]["fark"] == pytest.approx(0)
        assert by_id[card["id"]]["fark"] == pytest.approx(0)
        assert by_id[pool["id"]]["fark"] == pytest.approx(0)
        assert not account_balance.opening_eligible({"type": "credit_card", "is_customer_card_pool": True})

    _run(scenario())


def test_put_balance_rewrites_opening_without_increment(db):
    async def scenario():
        created = await server.create_bank_account(BankAccount(
            company_id="co", type="bank", bank_name="Enpara", account_name="Vadesiz",
            currency="TRY", current_balance=75,
        ))
        aid = created["id"]
        updated = await server.update_bank_account(aid, {"current_balance": 100}, _user())
        assert updated["current_balance"] == pytest.approx(100)
        openings = _openings(db, aid)
        assert len(openings) == 1
        assert openings[0]["amount"] == pytest.approx(100)
        stored = await db.bank_accounts.find_one({"_id": aid})
        assert stored["current_balance"] == pytest.approx(100)
        await db.bank_transactions.insert_one({
            "_id": "manual",
            "company_id": "co",
            "account_id": aid,
            "type": "inflow",
            "amount": 5,
            "source": "manual",
            "date": "2026-10-10",
        })
        with pytest.raises(HTTPException) as exc:
            await server.update_bank_account(aid, {"current_balance": 999}, _user())
        assert exc.value.status_code == 400
        assert (await db.bank_accounts.find_one({"_id": aid}))["current_balance"] == pytest.approx(100)
        assert _openings(db, aid)[0]["amount"] == pytest.approx(100)

    _run(scenario())


def test_opening_action_closes_fark_is_idempotent_and_tenant_scoped(db):
    async def scenario():
        db.bank_accounts.docs["legacy"] = {
            "_id": "legacy",
            "company_id": "co",
            "type": "bank",
            "account_name": "Eski Enpara",
            "bank_name": "Enpara",
            "currency": "TRY",
            "current_balance": 629.44,
        }
        await db.bank_transactions.insert_one({
            "_id": "sync1",
            "company_id": "co",
            "account_id": "legacy",
            "type": "inflow",
            "amount": 100,
            "source": "bank_sync",
            "match_status": "unmatched",
            "date": "2026-10-10",
        })
        await db.bank_transactions.insert_one({
            "_id": "later",
            "company_id": "co",
            "account_id": "legacy",
            "type": "outflow",
            "amount": 0,
            "source": "manual",
            "date": "2026-11-01",
        })
        before = (await db.bank_accounts.find_one({"_id": "legacy"}))["current_balance"]
        report = await balance_reconciliation.build_reconciliation(db, "co")
        row = next(r for r in report["accounts"] if r["id"] == "legacy")
        assert row["fark"] == pytest.approx(529.44)
        assert row["acilis_var"] is False

        with pytest.raises(HTTPException) as denied:
            await server.save_opening_from_difference("legacy", _user("c2"))
        assert denied.value.status_code == 404
        assert (await db.bank_accounts.find_one({"_id": "legacy"}))["current_balance"] == pytest.approx(before)

        saved = await server.save_opening_from_difference("legacy", _user())
        assert saved["amount"] == pytest.approx(529.44)
        assert saved["date"] == "2026-10-09"
        assert saved["current_balance"] == pytest.approx(before)
        stored = await db.bank_accounts.find_one({"_id": "legacy"})
        assert stored["current_balance"] == pytest.approx(before)
        openings = _openings(db, "legacy")
        assert len(openings) == 1
        assert openings[0]["type"] == "inflow"
        assert openings[0]["source"] == "opening"
        assert openings[0]["date"] == "2026-10-09"
        report = await balance_reconciliation.build_reconciliation(db, "co")
        row = next(r for r in report["accounts"] if r["id"] == "legacy")
        assert row["fark"] == pytest.approx(0)
        assert row["acilis_var"] is True
        audits = list(db.company_audit_log.docs.values())
        assert len(audits) == 1
        assert audits[0]["record_id"] == "legacy"
        assert "529.44" in audits[0]["summary"]
        assert db.activity_logs.docs

        with pytest.raises(HTTPException) as again:
            await server.save_opening_from_difference("legacy", _user())
        assert again.value.status_code == 409
        assert len(_openings(db, "legacy")) == 1
        assert (await db.bank_accounts.find_one({"_id": "legacy"}))["current_balance"] == pytest.approx(before)
        assert len(db.company_audit_log.docs) == 1

    _run(scenario())


def test_sync_does_not_change_fark_and_unmatched_totals(db):
    async def scenario():
        created = await server.create_bank_account(BankAccount(
            company_id="co", type="bank", bank_name="Enpara", account_name="Vadesiz",
            iban=IBAN, currency="TRY", current_balance=75,
        ))
        aid = created["id"]
        await db.bank_connections.insert_one({
            "_id": "conn1",
            "company_id": "co",
            "provider": "other",
            "linked_account_id": aid,
            "bank_account_number": IBAN,
            "auto_match": False,
            "synced_count": 0,
            "auto_matched_count": 0,
        })
        legacy_id = "legacy"
        db.bank_accounts.docs[legacy_id] = {
            "_id": legacy_id,
            "company_id": "co",
            "type": "bank",
            "account_name": "Eski",
            "bank_name": "Eski",
            "currency": "TRY",
            "current_balance": 75,
        }
        await db.bank_connections.insert_one({
            "_id": "conn-legacy",
            "company_id": "co",
            "provider": "other",
            "linked_account_id": legacy_id,
            "auto_match": False,
            "synced_count": 0,
            "auto_matched_count": 0,
        })

        async def fetch(conn, since):
            ext = "ext-" + str(conn.get("_id"))
            return {
                "simulated": True,
                "balance": 115,
                "transactions": [{
                    "external_id": ext,
                    "direction": "credit",
                    "amount": 40,
                    "description": "Gelen havale",
                    "counterparty": "Ali",
                    "currency": "TRY",
                    "is_simulated": True,
                    "date": "2026-10-12",
                }],
            }

        with patch.object(server.bank_providers, "fetch_transactions", AsyncMock(side_effect=fetch)):
            await server._sync_bank_connection_core("conn1", days=7)
            await server._sync_bank_connection_core("conn-legacy", days=7)

        report = await balance_reconciliation.build_reconciliation(db, "co")
        by_id = {r["id"]: r for r in report["accounts"]}
        opened = by_id[aid]
        assert opened["fark"] == pytest.approx(0)
        assert opened["gosterilen"] == pytest.approx(115)
        assert opened["hareket_toplami"] == pytest.approx(115)
        assert opened["eslesmemis_adet"] == 1
        assert opened["eslesmemis_tutar"] == pytest.approx(40)
        assert opened["banka_farki"] == pytest.approx(0)
        legacy = by_id[legacy_id]
        assert legacy["fark"] == pytest.approx(75)
        assert legacy["gosterilen"] == pytest.approx(115)
        assert legacy["hareket_toplami"] == pytest.approx(40)

        await db.bank_transactions.insert_one({
            "_id": "matched",
            "company_id": "co",
            "account_id": aid,
            "type": "inflow",
            "amount": 999,
            "source": "bank_sync",
            "match_status": "matched",
            "date": "2026-10-11",
        })
        await db.bank_transactions.insert_one({
            "_id": "out",
            "company_id": "co",
            "account_id": aid,
            "type": "outflow",
            "amount": 15,
            "source": "bank_sync",
            "match_status": "unmatched",
            "date": "2026-10-13",
        })
        await db.bank_transactions.insert_one({
            "_id": "manual",
            "company_id": "co",
            "account_id": aid,
            "type": "inflow",
            "amount": 8,
            "source": "manual",
            "date": "2026-10-13",
        })
        # Eşleşen ve manuel satırlar kolona girmez; eşleşmemiş işaretli toplam 40 - 15.
        fresh = await db.bank_accounts.find_one({"_id": aid})
        report = await balance_reconciliation.build_reconciliation(db, "co")
        row = next(r for r in report["accounts"] if r["id"] == aid)
        assert row["eslesmemis_adet"] == 2
        assert row["eslesmemis_tutar"] == pytest.approx(25)
        moved = account_balance.movement_balance(
            [t for t in db.bank_transactions.docs.values() if t.get("account_id") == aid or t.get("target_account_id") == aid],
            aid,
            fresh,
        )
        assert row["hareket_toplami"] == pytest.approx(moved)
        assert row["banka_farki"] == pytest.approx(round(115 - moved, 2))

    _run(scenario())


def test_duplicate_iban_connection_rejected_and_warnings(db):
    async def scenario():
        first = await server.create_bank_account(BankAccount(
            company_id="co", type="bank", bank_name="Enpara", account_name="Vadesiz TL",
            iban=IBAN, account_number="1001", currency="TRY", current_balance=0,
        ))
        second = await server.create_bank_account(BankAccount(
            company_id="co", type="bank", bank_name="Enpara", account_name="Vadesiz TL",
            iban=IBAN_SPACED, account_number="1001", currency="TRY", current_balance=0,
        ))
        other = await server.create_bank_account(BankAccount(
            company_id="c2", type="bank", bank_name="Enpara", account_name="Başka",
            iban=IBAN, currency="TRY", current_balance=0,
        ))
        numbered_a = await server.create_bank_account(BankAccount(
            company_id="co", type="pos", bank_name="POS", account_name="POS A",
            account_number="555", currency="TRY", current_balance=0,
        ))
        numbered_b = await server.create_bank_account(BankAccount(
            company_id="co", type="pos", bank_name="POS", account_name="POS B",
            account_number="555", currency="TRY", current_balance=0,
        ))

        async def ok_test(doc):
            return {"ok": True, "simulated": True, "message": "ok"}

        with patch.object(server.bank_providers, "test_connection", AsyncMock(side_effect=ok_test)):
            created = await server.create_bank_connection(BankConnection(
                company_id="co", provider="other", linked_account_id=first["id"],
            ), _user())
            assert created["id"]
            with pytest.raises(HTTPException) as clash:
                await server.create_bank_connection(BankConnection(
                    company_id="co", provider="other", linked_account_id=second["id"],
                    bank_account_number=IBAN_SPACED,
                ), _user())
            assert clash.value.status_code == 400
            assert "IBAN" in clash.value.detail
            assert IBAN not in clash.value.detail
            assert "…1326" in clash.value.detail
            other_conn = await server.create_bank_connection(BankConnection(
                company_id="c2", provider="other", linked_account_id=other["id"],
            ), _user("c2"))
            assert other_conn["id"]
            await server.create_bank_connection(BankConnection(
                company_id="co", provider="other", linked_account_id=numbered_a["id"],
                bank_account_number="555",
            ), _user())
            await server.create_bank_connection(BankConnection(
                company_id="co", provider="other", linked_account_id=numbered_b["id"],
                bank_account_number="555",
            ), _user())

        # Eski veri: engel gelmeden önce aynı IBAN'a ikinci bağlantı yazılmış olabilir.
        await db.bank_connections.insert_one({
            "_id": "legacy-dup",
            "company_id": "co",
            "provider": "other",
            "linked_account_id": second["id"],
            "bank_account_number": IBAN,
        })
        assert len(db.bank_connections.docs) == 5
        report = await balance_reconciliation.build_reconciliation(db, "co")
        kinds = {w["tur"] for w in report["uyarilar"]}
        assert "cift_iban" in kinds
        assert "cift_hesap_no" in kinds
        assert "cift_hesap_adi" not in kinds
        iban_warn = next(w for w in report["uyarilar"] if w["tur"] == "cift_iban")
        assert "Enpara" in iban_warn["mesaj"]
        assert "…1326" in iban_warn["mesaj"]
        assert IBAN not in iban_warn["mesaj"]
        for warning in report["uyarilar"]:
            assert IBAN not in warning["mesaj"]
            assert "Aynı adlı" not in warning["mesaj"]

    _run(scenario())
