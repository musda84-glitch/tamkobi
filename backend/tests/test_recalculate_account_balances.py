"""Kayıtlı bakiye onarımı: hareket toplamına eşitlenir, hareket yazılmaz."""
from __future__ import annotations

import asyncio
import copy
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import account_balance
import balance_reconciliation
import server
from mysql_store import match_query

STORED = 949126.44
LEDGER = 327.58
DIFF = -948798.86


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
            return SimpleNamespace(modified_count=1, matched_count=1)
        return SimpleNamespace(modified_count=0, matched_count=0)

    async def delete_many(self, query):
        return SimpleNamespace(deleted_count=0)


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


def _user(role="admin", company="co", *, super_admin=False):
    return {
        "id": f"user-{company}",
        "name": "Ayşe",
        "company_ids": [company],
        "active_company_id": company,
        "role": role,
        "is_super_admin": super_admin,
    }


def _acc(aid, typ, balance, name, **extra):
    doc = {
        "_id": aid,
        "company_id": "co",
        "type": typ,
        "account_name": name,
        "bank_name": name,
        "currency": "TRY",
        "current_balance": balance,
    }
    doc.update(extra)
    return doc


@pytest.fixture
def db(monkeypatch):
    mem = MemoryDB()
    monkeypatch.setattr(server, "db", mem)
    return mem


def _seed(db):
    db.bank_accounts.docs["pos1"] = _acc(
        "pos1", "pos", STORED, "Trendyol POS", bank_reported_balance=1000,
    )
    db.bank_accounts.docs["cash1"] = _acc("cash1", "cash_box", 80, "Merkez Kasa")
    db.bank_accounts.docs["bank0"] = _acc("bank0", "bank", 10, "Sıfır Fark")
    db.bank_accounts.docs["okc1"] = _acc("okc1", "okc_pos", 5, "ÖKC")
    db.bank_accounts.docs["card1"] = _acc("card1", "credit_card", -500, "Şirket Kart")
    db.bank_accounts.docs["pool1"] = _acc(
        "pool1", "credit_card", 80, "Müşteri Kartları", is_customer_card_pool=True, card_owner="customer",
    )
    db.bank_accounts.docs["foreign"] = _acc("foreign", "pos", 50, "Başka POS", company_id="co2")
    txs = [
        {"_id": "tout", "company_id": "co", "account_id": "pos1", "target_account_id": "bank0",
         "type": "transfer", "amount": 11851.16, "source": "manual"},
        {"_id": "tin", "company_id": "co", "account_id": "bank0", "target_account_id": "pos1",
         "type": "transfer", "amount": 11851.16, "source": "manual"},
        {"_id": "settle", "company_id": "co", "account_id": "pos1", "type": "inflow",
         "amount": LEDGER, "source": "marketplace_settlement"},
        {"_id": "expected", "company_id": "co", "account_id": "pos1", "type": "inflow",
         "amount": 1000, "source": "marketplace_settlement_expected", "balance_posted": False},
        {"_id": "ledger", "company_id": "co", "account_id": "pos1", "type": "inflow",
         "amount": 500, "source": "ledger"},
        {"_id": "unposted", "company_id": "co", "account_id": "pos1", "type": "inflow",
         "amount": 200, "balance_posted": False},
        {"_id": "cashin", "company_id": "co", "account_id": "cash1", "type": "inflow",
         "amount": 15, "source": "manual"},
        {"_id": "bankin", "company_id": "co", "account_id": "bank0", "type": "inflow",
         "amount": 10, "source": "manual"},
    ]
    for tx in txs:
        db.bank_transactions.docs[tx["_id"]] = copy.deepcopy(tx)
    db.bank_connections.docs["conn1"] = {
        "_id": "conn1", "company_id": "co", "linked_account_id": "pos1", "provider_name": "Trendyol",
    }
    db.contacts.docs["ct"] = {"_id": "ct", "company_id": "co", "name": "Cari", "balance": 42.5}
    db.partners.docs["p"] = {"_id": "p", "company_id": "co", "name": "Ortak", "balance": 7}
    return set(db.bank_transactions.docs)


def _tx_ids(db):
    return set(db.bank_transactions.docs)


def test_preview_lists_pos_drift_and_apply_sets_ledger_without_new_movements(db):
    admin = _user()
    tx_ids = _seed(db)

    async def scenario():
        preview = await server.recalculate_account_balances({}, admin)
        assert preview["dry_run"] is True
        by_id = {row["id"]: row for row in preview["accounts"]}
        assert set(by_id) == {"pos1", "cash1", "okc1"}
        pos = by_id["pos1"]
        assert pos["stored"] == pytest.approx(STORED)
        assert pos["ledger"] == pytest.approx(LEDGER)
        assert pos["diff"] == pytest.approx(DIFF)
        assert pos["type"] == "pos"
        assert pos["name"] == "Trendyol POS"
        assert pos["movement_count"] == 6
        assert pos["integrated"] is True
        assert pos["bank_reported_balance"] == pytest.approx(1000)
        assert preview["affected_count"] == 3
        assert "card1" not in by_id and "pool1" not in by_id and "bank0" not in by_id
        assert db.bank_accounts.docs["pos1"]["current_balance"] == pytest.approx(STORED)
        assert "balance_recalculated_at" not in db.bank_accounts.docs["pos1"]
        assert _tx_ids(db) == tx_ids
        assert not db.company_audit_log.docs

        listed_before = copy.deepcopy(db.bank_accounts.docs)
        tx_before = copy.deepcopy(db.bank_transactions.docs)
        await server.list_bank_accounts("co", with_drift=1)
        await balance_reconciliation.build_reconciliation(db, "co")
        assert db.bank_accounts.docs == listed_before
        assert db.bank_transactions.docs == tx_before

        await account_balance.sync_cash_box_balances(db, [
            copy.deepcopy(db.bank_accounts.docs["cash1"]),
            copy.deepcopy(db.bank_accounts.docs["pos1"]),
        ])
        assert db.bank_accounts.docs["cash1"]["current_balance"] == pytest.approx(15)
        assert db.bank_accounts.docs["pos1"]["current_balance"] == pytest.approx(STORED)

        applied = await server.recalculate_account_balances({
            "dry_run": False,
            "company_id": "co",
            "account_ids": ["pos1", "foreign", "card1", "pool1"],
            "expected_stored": {"pos1": STORED, "card1": -500, "pool1": 80},
        }, admin)
        assert applied["dry_run"] is False
        assert applied["affected_count"] == 1
        outcomes = {row["id"]: row["outcome"] for row in applied["results"]}
        assert outcomes["pos1"] == "ok"
        assert outcomes["foreign"] == "error"
        assert outcomes["card1"] == "skipped"
        assert outcomes["pool1"] == "skipped"
        stored = db.bank_accounts.docs["pos1"]
        assert stored["current_balance"] == pytest.approx(LEDGER)
        assert stored["balance_recalculated_by"] == admin["id"]
        assert stored["balance_recalculated_at"]
        assert stored["bank_reported_balance"] == pytest.approx(1000)
        assert db.bank_accounts.docs["foreign"]["current_balance"] == pytest.approx(50)
        assert db.bank_accounts.docs["card1"]["current_balance"] == pytest.approx(-500)
        assert db.bank_accounts.docs["pool1"]["current_balance"] == pytest.approx(80)
        assert db.bank_accounts.docs["okc1"]["current_balance"] == pytest.approx(5)
        assert _tx_ids(db) == tx_ids
        assert all(tx.get("source") != "opening" for tx in db.bank_transactions.docs.values())
        assert db.contacts.docs["ct"]["balance"] == pytest.approx(42.5)
        assert db.partners.docs["p"]["balance"] == pytest.approx(7)
        audits = list(db.company_audit_log.docs.values())
        assert len(audits) == 1
        assert audits[0]["record_id"] == "pos1"
        assert audits[0]["user_id"] == admin["id"]
        assert "949126.44" in audits[0]["summary"]
        assert "327.58" in audits[0]["summary"]

        again = await server.recalculate_account_balances({
            "dry_run": False,
            "account_ids": ["pos1"],
            "expected_stored": {"pos1": STORED},
        }, admin)
        assert again["affected_count"] == 0
        assert again["results"][0]["outcome"] == "skipped"
        assert db.bank_accounts.docs["pos1"]["current_balance"] == pytest.approx(LEDGER)
        assert len(db.company_audit_log.docs) == 1
        assert _tx_ids(db) == tx_ids

    _run(scenario())


def test_dry_run_default_does_not_write_and_zero_diff_is_omitted(db):
    admin = _user()
    _seed(db)

    async def scenario():
        before = copy.deepcopy(db.bank_accounts.docs)
        preview = await server.recalculate_account_balances({"account_ids": ["bank0", "pos1"]}, admin)
        assert preview["dry_run"] is True
        assert [row["id"] for row in preview["accounts"]] == ["pos1"]
        assert db.bank_accounts.docs == before
        with pytest.raises(HTTPException) as missing_ids:
            await server.recalculate_account_balances({"dry_run": False}, admin)
        assert missing_ids.value.status_code == 400
        assert db.bank_accounts.docs == before

    _run(scenario())


def test_race_after_preview_does_not_write(db):
    admin = _user()
    tx_ids = _seed(db)

    async def scenario():
        preview = await server.recalculate_account_balances({"account_ids": ["pos1"]}, admin)
        assert preview["accounts"][0]["stored"] == pytest.approx(STORED)
        db.bank_accounts.docs["pos1"]["current_balance"] = 100
        applied = await server.recalculate_account_balances({
            "dry_run": False,
            "account_ids": ["pos1"],
            "expected_stored": {"pos1": preview["accounts"][0]["stored"]},
        }, admin)
        assert applied["affected_count"] == 0
        assert applied["results"][0]["outcome"] == "error"
        assert "değişti" in applied["results"][0]["reason"]
        assert "önizle" in applied["results"][0]["reason"]
        assert db.bank_accounts.docs["pos1"]["current_balance"] == 100
        assert "balance_recalculated_at" not in db.bank_accounts.docs["pos1"]
        assert not db.company_audit_log.docs
        assert _tx_ids(db) == tx_ids

    _run(scenario())


def test_non_admin_forbidden_and_other_company_account_not_found(db):
    _seed(db)
    admin = _user()

    async def scenario():
        before = copy.deepcopy(db.bank_accounts.docs)
        with pytest.raises(HTTPException) as denied:
            await server.recalculate_account_balances({"dry_run": True}, _user(role="accountant"))
        assert denied.value.status_code == 403
        with pytest.raises(HTTPException) as apply_denied:
            await server.recalculate_account_balances({
                "dry_run": False,
                "account_ids": ["pos1"],
                "expected_stored": {"pos1": STORED},
            }, _user(role="personel"))
        assert apply_denied.value.status_code == 403
        with pytest.raises(HTTPException) as missing:
            await server.recalculate_account_balances({
                "dry_run": False,
                "account_ids": ["foreign"],
                "expected_stored": {"foreign": 50},
            }, admin)
        assert missing.value.status_code == 404
        with pytest.raises(HTTPException) as other_company:
            await server.recalculate_account_balances(
                {"dry_run": True, "company_id": "co2", "account_ids": ["foreign"]},
                admin,
            )
        assert other_company.value.status_code == 403
        assert db.bank_accounts.docs == before
        assert not db.company_audit_log.docs

    _run(scenario())
