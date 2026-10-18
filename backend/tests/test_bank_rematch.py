"""Banka hareketinde güvenli yeniden eşleştirme ve hesap listesi ay özeti.

Geçici belge deposunun adı tamkobi_test_* ile başlar. Canlı veritabanına
(MySQL/Mongo) ve canlı sunucuya bağlanmaz; sorgu mysql_store semantiğiyle
bellekte yürür.
"""
from __future__ import annotations

import asyncio
import copy
import sys
import uuid
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.requests import Request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import expenses  # noqa: E402
import server  # noqa: E402
from bank_rematch import istanbul_month_bounds  # noqa: E402
from mysql_store import (  # noqa: E402
    aggregate_rows,
    apply_update,
    match_query,
    new_upsert_doc,
    project_doc,
    sort_docs,
)

TEST_DB_NAME = f"tamkobi_test_bank_rematch_{uuid.uuid4().hex[:8]}"
_LIVE_DB_NAMES = {"tamkobi", "tamkobi_p0", "tamkobi_prod", "tamkobi_pushdown"}


def _run(coro):
    return asyncio.run(coro)


class _Cursor:
    def __init__(self, docs):
        self._docs = docs
        self._sort = None

    def sort(self, key, direction=1):
        self._sort = [(key, direction)] if isinstance(key, str) else list(key)
        return self

    async def to_list(self, length=None):
        rows = sort_docs(list(self._docs), self._sort) if self._sort else list(self._docs)
        if length is not None:
            rows = rows[: int(length)]
        return copy.deepcopy(rows)


class MemoryCollection:
    def __init__(self, name):
        self.name = name
        self.docs = []
        self.find_calls = []
        self.aggregate_calls = []

    def find(self, query=None, projection=None):
        self.find_calls.append(copy.deepcopy(query))
        matched = []
        for doc in self.docs:
            if match_query(doc, query or {}):
                matched.append(project_doc(doc, projection) if projection else copy.deepcopy(doc))
        return _Cursor(matched)

    def aggregate(self, pipeline):
        self.aggregate_calls.append(copy.deepcopy(pipeline))
        return _Cursor(aggregate_rows(self.docs, pipeline))

    async def find_one(self, query=None, projection=None, sort=None):
        rows = [doc for doc in self.docs if match_query(doc, query or {})]
        if sort:
            rows = sort_docs(rows, sort)
        if not rows:
            return None
        doc = rows[0]
        return project_doc(doc, projection) if projection else copy.deepcopy(doc)

    async def insert_one(self, doc):
        stored = copy.deepcopy(doc)
        if not stored.get("_id"):
            stored["_id"] = str(uuid.uuid4())
        self.docs.append(stored)
        return SimpleNamespace(inserted_id=stored["_id"])

    async def update_one(self, query, update, upsert=False):
        for index, doc in enumerate(self.docs):
            if not match_query(doc, query or {}):
                continue
            new_doc = apply_update(doc, update, query, is_insert=False)
            changed = new_doc != doc
            self.docs[index] = new_doc
            return SimpleNamespace(matched_count=1, modified_count=1 if changed else 0)
        if not upsert:
            return SimpleNamespace(matched_count=0, modified_count=0)
        created = new_upsert_doc(update, query)
        self.docs.append(created)
        return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=created.get("_id"))

    async def delete_one(self, query):
        for index, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                del self.docs[index]
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def count_documents(self, query=None):
        return sum(1 for doc in self.docs if match_query(doc, query or {}))


class MemoryDB:
    """Motor uyumlu geçici depo. Ağ yok; ad tamkobi_test_* olmak zorunda."""

    def __init__(self, name=TEST_DB_NAME):
        if not str(name).startswith("tamkobi_test_"):
            raise RuntimeError(f"test DB adı tamkobi_test_* olmalı, gelen: {name}")
        if name in _LIVE_DB_NAMES or name == getattr(server, "DB_NAME", None):
            raise RuntimeError(f"canlı veritabanı kullanılamaz: {name}")
        self.name = name
        self._cols = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return self[name]

    def __getitem__(self, name):
        coll = self._cols.get(name)
        if coll is None:
            coll = MemoryCollection(name)
            self._cols[name] = coll
        return coll


def _request() -> Request:
    return Request({
        "type": "http",
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/api/banking/transactions/x/match",
        "raw_path": b"/api/banking/transactions/x/match",
        "query_string": b"",
        "headers": [],
        "client": ("127.0.0.1", 9),
        "server": ("127.0.0.1", 9),
    })


def _user(company="co-a"):
    return {
        "id": "user-a",
        "_id": "user-a",
        "name": "Ayşe",
        "email": "ayse@firma.test",
        "company_ids": [company],
        "active_company_id": company,
        "role": "admin",
        "is_super_admin": False,
    }


def _tx(**kwargs):
    doc = {
        "_id": kwargs.get("_id") or "tx-1",
        "company_id": "co-a",
        "account_id": "acc-a",
        "account_name": "Vadesiz",
        "type": "inflow",
        "amount": 150.0,
        "currency": "TRY",
        "date": "2026-10-10",
        "description": "ACME MARKET ODEME",
        "source": "bank_sync",
        "match_status": "matched",
        "contact_id": "ct-a",
        "contact_name": "Cari A",
        "category": "Tahsilat",
    }
    doc.update(kwargs)
    doc["_id"] = kwargs.get("_id") or doc["_id"]
    return doc


@pytest.fixture
def db():
    mem = MemoryDB()
    assert mem.name.startswith("tamkobi_test_")
    assert not hasattr(mem, "_pool")
    prev_db = server.db
    prev_exp = expenses._db
    server.db = mem
    expenses._db = mem
    try:
        yield mem
    finally:
        server.db = prev_db
        expenses._db = prev_exp


async def _put(db, collection, doc):
    await db[collection].insert_one(doc)


async def _seed_contacts(db, balance_a=-150.0, balance_b=0.0):
    await _put(db, "contacts", {"_id": "ct-a", "company_id": "co-a", "name": "Cari A", "balance": balance_a})
    await _put(db, "contacts", {"_id": "ct-b", "company_id": "co-a", "name": "Cari B", "balance": balance_b})
    await _put(db, "contacts", {"_id": "ct-foreign", "company_id": "co-b", "name": "Yabancı", "balance": 40.0})
    await _put(db, "bank_accounts", {
        "_id": "acc-a", "company_id": "co-a", "account_name": "Vadesiz", "type": "bank", "current_balance": 500.0,
    })


def _match(tx_id, body, user=None):
    return server.match_bank_transaction(_request(), tx_id, body, user=user or _user())


def test_replace_moves_balance_from_contact_a_to_b(db):
    async def scenario():
        await _seed_contacts(db)
        await _put(db, "bank_transactions", _tx())
        out = await _match("tx-1", {"replace": True, "contact_id": "ct-b", "learn": False})
        stored = await db.bank_transactions.find_one({"_id": "tx-1"})
        contact_a = await db.contacts.find_one({"_id": "ct-a"})
        contact_b = await db.contacts.find_one({"_id": "ct-b"})
        return out, stored, contact_a, contact_b

    out, stored, contact_a, contact_b = _run(scenario())
    assert out["match_status"] == "matched"
    assert out["contact_id"] == "ct-b"
    assert out["contact_name"] == "Cari B"
    assert "Eşleşti:" in (out.get("description") or "")
    assert "Cari B" in out["description"]
    assert out.get("matched_by_name") == "Sistem"
    assert stored["match_status"] == "matched"
    assert stored["contact_id"] == "ct-b"
    assert contact_a["balance"] == pytest.approx(0.0)
    assert contact_b["balance"] == pytest.approx(-150.0)
    assert stored.get("match_status") != "rematching"


def test_replace_invalid_target_keeps_old_match(db):
    async def scenario():
        await _seed_contacts(db)
        await _put(db, "bank_transactions", _tx())
        with pytest.raises(HTTPException) as ei:
            await _match("tx-1", {"replace": True, "contact_id": "ct-foreign", "learn": False})
        missing = None
        try:
            await _match("tx-1", {"replace": True, "contact_id": "yok", "learn": False})
        except HTTPException as exc:
            missing = exc
        stored = await db.bank_transactions.find_one({"_id": "tx-1"})
        contact_a = await db.contacts.find_one({"_id": "ct-a"})
        contact_b = await db.contacts.find_one({"_id": "ct-b"})
        return ei.value, missing, stored, contact_a, contact_b

    foreign, missing, stored, contact_a, contact_b = _run(scenario())
    assert foreign.status_code == 400
    assert missing is not None and missing.status_code == 400
    assert stored["match_status"] == "matched"
    assert stored["contact_id"] == "ct-a"
    assert stored["contact_name"] == "Cari A"
    assert contact_a["balance"] == pytest.approx(-150.0)
    assert contact_b["balance"] == pytest.approx(0.0)


def test_replace_false_keeps_already_matched_error(db):
    async def scenario():
        await _seed_contacts(db)
        await _put(db, "bank_transactions", _tx())
        with pytest.raises(HTTPException) as omitted:
            await _match("tx-1", {"contact_id": "ct-b"})
        with pytest.raises(HTTPException) as explicit:
            await _match("tx-1", {"replace": False, "contact_id": "ct-b"})
        with pytest.raises(HTTPException) as text_false:
            await _match("tx-1", {"replace": "false", "contact_id": "ct-b"})
        stored = await db.bank_transactions.find_one({"_id": "tx-1"})
        contact_a = await db.contacts.find_one({"_id": "ct-a"})
        return omitted.value, explicit.value, text_false.value, stored, contact_a

    omitted, explicit, text_false, stored, contact_a = _run(scenario())
    for exc in (omitted, explicit, text_false):
        assert exc.status_code == 400
        assert exc.detail == "Bu hareket zaten eşleştirilmiş."
    assert stored["match_status"] == "matched"
    assert stored["contact_id"] == "ct-a"
    assert contact_a["balance"] == pytest.approx(-150.0)


def test_replace_true_rejects_unmatched_and_non_sync(db):
    async def scenario():
        await _seed_contacts(db)
        await _put(db, "bank_transactions", _tx(_id="tx-open", match_status="unmatched", contact_id=None, contact_name=None))
        await _put(db, "bank_transactions", _tx(_id="tx-manual", source="manual"))
        with pytest.raises(HTTPException) as open_tx:
            await _match("tx-open", {"replace": True, "contact_id": "ct-b", "learn": False})
        with pytest.raises(HTTPException) as manual:
            await _match("tx-manual", {"replace": True, "contact_id": "ct-b", "learn": False})
        open_doc = await db.bank_transactions.find_one({"_id": "tx-open"})
        manual_doc = await db.bank_transactions.find_one({"_id": "tx-manual"})
        contact_b = await db.contacts.find_one({"_id": "ct-b"})
        return open_tx.value, manual.value, open_doc, manual_doc, contact_b

    open_exc, manual_exc, open_doc, manual_doc, contact_b = _run(scenario())
    assert open_exc.status_code == 400
    assert manual_exc.status_code == 400
    assert open_doc["match_status"] == "unmatched"
    assert manual_doc["match_status"] == "matched"
    assert manual_doc["contact_id"] == "ct-a"
    assert contact_b["balance"] == pytest.approx(0.0)


def test_second_replace_while_rematching_is_409(db):
    async def scenario():
        await _seed_contacts(db)
        await _put(db, "bank_transactions", _tx(match_status="rematching"))
        with pytest.raises(HTTPException) as ei:
            await _match("tx-1", {"replace": True, "contact_id": "ct-b", "learn": False})
        stored = await db.bank_transactions.find_one({"_id": "tx-1"})
        contact_a = await db.contacts.find_one({"_id": "ct-a"})
        contact_b = await db.contacts.find_one({"_id": "ct-b"})
        return ei.value, stored, contact_a, contact_b

    exc, stored, contact_a, contact_b = _run(scenario())
    assert exc.status_code == 409
    assert stored["match_status"] == "rematching"
    assert stored["contact_id"] == "ct-a"
    assert contact_a["balance"] == pytest.approx(-150.0)
    assert contact_b["balance"] == pytest.approx(0.0)


def test_replace_virman_deletes_counter_and_applies_new_account(db):
    async def scenario():
        await _seed_contacts(db)
        await _put(db, "bank_accounts", {
            "_id": "acc-t", "company_id": "co-a", "account_name": "Kasa", "type": "cash_box", "current_balance": 80.0,
        })
        await _put(db, "bank_accounts", {
            "_id": "acc-t2", "company_id": "co-a", "account_name": "POS", "type": "cash_box", "current_balance": 10.0,
        })
        await _put(db, "bank_transactions", _tx(
            _id="tx-v", type="outflow", amount=80.0, contact_id=None, contact_name=None,
            target_account_id="acc-t", target_account_name="Kasa", category="Hesaplar Arası Virman",
            description="VIRMAN KASA",
        ))
        await _put(db, "bank_transactions", {
            "_id": "counter-1", "company_id": "co-a", "account_id": "acc-t", "account_name": "Kasa",
            "type": "inflow", "amount": 80.0, "currency": "TRY", "source": "bank_match",
            "related_bank_tx_id": "tx-v", "date": "2026-10-10", "description": "karşı",
        })
        out = await _match("tx-v", {"replace": True, "target_account_id": "acc-t2", "learn": False})
        stored = await db.bank_transactions.find_one({"_id": "tx-v"})
        old_counter = await db.bank_transactions.find_one({"_id": "counter-1"})
        new_counter = await db.bank_transactions.find_one({"related_bank_tx_id": "tx-v", "source": "bank_match"})
        target = await db.bank_accounts.find_one({"_id": "acc-t"})
        target2 = await db.bank_accounts.find_one({"_id": "acc-t2"})
        return out, stored, old_counter, new_counter, target, target2

    out, stored, old_counter, new_counter, target, target2 = _run(scenario())
    assert out["match_status"] == "matched"
    assert stored["target_account_id"] == "acc-t2"
    assert stored.get("contact_id") is None
    assert old_counter is None
    assert new_counter is not None
    assert new_counter["_id"] != "counter-1"
    assert new_counter["account_id"] == "acc-t2"
    assert new_counter["type"] == "inflow"
    assert target["current_balance"] == pytest.approx(0.0)
    assert target2["current_balance"] == pytest.approx(90.0)
    assert "Eşleşti:" in (stored.get("description") or "")


def test_replace_expense_deletes_expense_and_applies_contact(db):
    async def scenario():
        await _seed_contacts(db)
        await _put(db, "bank_transactions", _tx(
            _id="tx-e", type="outflow", amount=40.0, contact_id=None, contact_name=None,
            expense_id="exp-1", category="Masraf: Yakıt", description="SHELL YAKIT",
        ))
        await _put(db, "expenses", {
            "_id": "exp-1", "company_id": "co-a", "source": "bank_match",
            "bank_transaction_id": "tx-e", "amount": 40.0, "category": "Yakıt",
        })
        out = await _match("tx-e", {"replace": True, "contact_id": "ct-b", "learn": False})
        stored = await db.bank_transactions.find_one({"_id": "tx-e"})
        expense = await db.expenses.find_one({"_id": "exp-1"})
        contact_b = await db.contacts.find_one({"_id": "ct-b"})
        return out, stored, expense, contact_b

    out, stored, expense, contact_b = _run(scenario())
    assert out["match_status"] == "matched"
    assert out["contact_id"] == "ct-b"
    assert expense is None
    assert stored.get("expense_id") in (None, "")
    assert "expense_id" not in stored or not stored.get("expense_id")
    assert contact_b["balance"] == pytest.approx(40.0)
    assert "Eşleşti:" in (stored.get("description") or "")


def test_other_company_transaction_is_404(db):
    async def scenario():
        await _seed_contacts(db)
        await _put(db, "bank_transactions", _tx(_id="tx-b", company_id="co-b", contact_id="ct-foreign"))
        with pytest.raises(HTTPException) as ei:
            await _match("tx-b", {"replace": True, "contact_id": "ct-b"}, user=_user("co-a"))
        stored = await db.bank_transactions.find_one({"_id": "tx-b"})
        foreign = await db.contacts.find_one({"_id": "ct-foreign"})
        return ei.value, stored, foreign

    exc, stored, foreign = _run(scenario())
    assert exc.status_code == 404
    assert stored["company_id"] == "co-b"
    assert stored["match_status"] == "matched"
    assert stored["contact_id"] == "ct-foreign"
    assert foreign["balance"] == pytest.approx(40.0)


def test_apply_failure_leaves_unmatched_and_does_not_restore(db):
    """_apply_match hata verirse eski cari geri yazılmaz; durum rematching kalmaz."""
    async def scenario():
        await _seed_contacts(db)
        await _put(db, "bank_transactions", _tx())
        with pytest.raises(HTTPException) as ei:
            await _match("tx-1", {"replace": True, "target_account_id": "acc-a", "learn": False})
        stored = await db.bank_transactions.find_one({"_id": "tx-1"})
        contact_a = await db.contacts.find_one({"_id": "ct-a"})
        return ei.value, stored, contact_a

    exc, stored, contact_a = _run(scenario())
    assert exc.status_code == 400
    assert "kendi hesabı" in str(exc.detail)
    assert stored["match_status"] == "unmatched"
    assert stored["match_status"] != "rematching"
    assert not stored.get("contact_id")
    assert contact_a["balance"] == pytest.approx(0.0)


def test_accounts_with_month_and_last_synced_at(db):
    async def scenario():
        start, end = istanbul_month_bounds()
        start_day = date.fromisoformat(start)
        prev = (start_day - timedelta(days=1)).isoformat()
        mid = start_day.replace(day=min(15, 28)).isoformat()
        await _put(db, "bank_accounts", {
            "_id": "acc-a", "company_id": "co-a", "account_name": "A Vadesiz", "type": "bank",
            "current_balance": 10.0, "bank_reported_balance": 10.0,
        })
        await _put(db, "bank_accounts", {
            "_id": "acc-b", "company_id": "co-a", "account_name": "B Kasa", "type": "bank", "current_balance": 3.0,
        })
        await _put(db, "bank_connections", {
            "_id": "conn-a", "company_id": "co-a", "linked_account_id": "acc-a",
            "provider_name": "Enpara", "status": "connected", "last_synced_at": "2026-10-18T07:00:00+00:00",
        })
        txs = [
            {"_id": "in-open", "company_id": "co-a", "account_id": "acc-a", "type": "inflow", "amount": 100,
             "date": start, "source": "bank_sync", "match_status": "unmatched"},
            {"_id": "in-matched", "company_id": "co-a", "account_id": "acc-a", "type": "inflow", "amount": 40,
             "date": mid, "source": "bank_sync", "match_status": "matched"},
            {"_id": "out-open", "company_id": "co-a", "account_id": "acc-a", "type": "outflow", "amount": 25,
             "date": mid, "source": "bank_sync", "match_status": "unmatched"},
            {"_id": "prev", "company_id": "co-a", "account_id": "acc-a", "type": "inflow", "amount": 999,
             "date": prev, "source": "bank_sync", "match_status": "unmatched"},
            {"_id": "next", "company_id": "co-a", "account_id": "acc-a", "type": "inflow", "amount": 50,
             "date": end, "source": "bank_sync", "match_status": "unmatched"},
            {"_id": "other-co", "company_id": "co-b", "account_id": "acc-a", "type": "inflow", "amount": 500,
             "date": mid, "source": "bank_sync", "match_status": "unmatched"},
            {"_id": "other-acc", "company_id": "co-a", "account_id": "acc-b", "type": "inflow", "amount": 7,
             "date": mid, "source": "manual", "match_status": "matched"},
        ]
        for tx in txs:
            await _put(db, "bank_transactions", tx)
        user = _user()
        plain = await server.list_bank_accounts("co-a", user=user)
        plain_aggs = len(db.bank_transactions.aggregate_calls)
        drifted = await server.list_bank_accounts("co-a", with_drift=1, user=user)
        drift_aggs = len(db.bank_transactions.aggregate_calls)
        month = await server.list_bank_accounts("co-a", with_month=1, user=user)
        both = await server.list_bank_accounts("co-a", with_drift=1, with_month=1, user=user)
        return plain, drifted, month, both, plain_aggs, drift_aggs, start, end

    plain, drifted, month, both, plain_aggs, drift_aggs, start, end = _run(scenario())
    assert plain_aggs == 0
    assert drift_aggs == 0
    by_id = {row["id"]: row for row in plain}
    assert "month_in" not in by_id["acc-a"]
    assert "month_out" not in by_id["acc-a"]
    assert "unmatched_count" not in by_id["acc-a"]
    assert "ledger_balance" not in by_id["acc-a"]
    assert by_id["acc-a"]["last_synced_at"] == "2026-10-18T07:00:00+00:00"
    assert by_id["acc-a"]["is_integrated"] is True
    assert by_id["acc-b"]["last_synced_at"] is None
    assert by_id["acc-b"]["is_integrated"] is False
    drift_a = next(row for row in drifted if row["id"] == "acc-a")
    assert "ledger_balance" in drift_a
    assert "month_in" not in drift_a
    month_by = {row["id"]: row for row in month}
    assert month_by["acc-a"]["month_in"] == pytest.approx(140.0)
    assert month_by["acc-a"]["month_out"] == pytest.approx(25.0)
    assert month_by["acc-a"]["unmatched_count"] == 2
    assert month_by["acc-b"]["month_in"] == pytest.approx(7.0)
    assert month_by["acc-b"]["month_out"] == pytest.approx(0.0)
    assert month_by["acc-b"]["unmatched_count"] == 0
    assert month_by["acc-a"]["last_synced_at"] == "2026-10-18T07:00:00+00:00"
    assert len(db.bank_transactions.aggregate_calls) == 2
    match = db.bank_transactions.aggregate_calls[-1][0]["$match"]
    assert match["company_id"] == "co-a"
    assert set(match["account_id"]["$in"]) == {"acc-a", "acc-b"}
    assert {"date": {"$gte": start}} in match["$and"]
    assert {"date": {"$lt": end}} in match["$and"]
    assert start.endswith("-01") and end.endswith("-01")
    both_a = next(row for row in both if row["id"] == "acc-a")
    assert both_a["month_in"] == pytest.approx(140.0)
    assert "ledger_balance" in both_a
    assert "balance_drift" in both_a
