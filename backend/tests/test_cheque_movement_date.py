"""Çek portföy hareketinin tarihi girişin İstanbul günüdür.

Keşide tarihi çek belgesinde kalır. Bellek içi MemDB.
cheques._db fixture içinde bağlanır. Modül ortam değişkeni yazmaz;
canlı API, port ve veritabanı kullanmaz.
"""
from __future__ import annotations

import asyncio
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "tests"))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import cheques  # noqa: E402
from dashboard_memdb import MemDB  # noqa: E402

CO_A = "co-a"
_ISTANBUL = ZoneInfo("Europe/Istanbul")


def _run(coro):
    return asyncio.run(coro)


def _istanbul_today() -> str:
    return datetime.now(_ISTANBUL).strftime("%Y-%m-%d")


def _user(company_id: str) -> dict:
    return {
        "company_ids": [company_id],
        "active_company_id": company_id,
        "is_super_admin": False,
        "role": "admin",
    }


@pytest.fixture
def db(monkeypatch):
    database = MemDB()
    monkeypatch.setattr(cheques, "_db", database)
    return database


async def _seed(db):
    await db.contacts.insert_one({
        "_id": "ct-a",
        "company_id": CO_A,
        "name": "Cari A",
        "balance": 1000.0,
        "opening_balance": 1000.0,
        "cheque_bond_balance": 0.0,
    })


def _portfolio_txs(db):
    return [tx for tx in db.bank_transactions.docs if tx.get("cheque_kind") == "portfolio"]


def test_single_cheque_keeps_issue_date_and_posts_entry_day(db):
    _run(_seed(db))
    today = _istanbul_today()

    saved = _run(cheques.create_cheque({
        "company_id": CO_A,
        "contact_id": "ct-a",
        "direction": "received",
        "instrument": "cheque",
        "amount": 25,
        "issue_date": "2026-10-01",
        "due_date": "2026-12-01",
        "serial_no": "SN-1",
    }, _user(CO_A)))

    assert saved["issue_date"] == "2026-10-01"
    assert saved["due_date"] == "2026-12-01"
    assert db.cheques.docs[0]["issue_date"] == "2026-10-01"
    assert db.cheques.docs[0]["due_date"] == "2026-12-01"
    txs = _portfolio_txs(db)
    assert len(txs) == 1
    assert txs[0]["date"] == today
    assert txs[0]["date"] != "2026-10-01"
    assert txs[0]["company_id"] == CO_A
    assert txs[0]["cheque_id"] == db.cheques.docs[0]["_id"]
    assert txs[0]["cheque_kind"] == "portfolio"
    assert "2026-10-01" not in (txs[0].get("description") or "")
    assert "2026-12-01" in (txs[0].get("description") or "")


def test_batch_movement_dates_are_entry_day_and_share_group(db):
    _run(_seed(db))
    today = _istanbul_today()
    issue_dates = ["2026-10-01", "2026-09-15", "2026-08-01"]

    saved = _run(cheques.create_cheques_batch({
        "company_id": CO_A,
        "contact_id": "ct-a",
        "direction": "received",
        "notes": "Toplu tahsilat",
        "items": [
            {"instrument": "cheque", "amount": 100, "due_date": "2026-11-01", "issue_date": issue_dates[0], "serial_no": "S1"},
            {"instrument": "promissory", "amount": 40.5, "due_date": "2026-11-02", "issue_date": issue_dates[1], "serial_no": "S2"},
            {"instrument": "cheque", "amount": 10, "due_date": "2026-11-03", "issue_date": issue_dates[2], "serial_no": "S3"},
        ],
    }, _user(CO_A)))

    gid = saved["receipt_group_id"]
    assert gid
    assert len(saved["items"]) == 3
    assert {row["receipt_group_id"] for row in saved["items"]} == {gid}
    assert [row["issue_date"] for row in saved["items"]] == issue_dates
    assert [doc["issue_date"] for doc in db.cheques.docs] == issue_dates
    txs = _portfolio_txs(db)
    assert len(txs) == 3
    assert {tx["date"] for tx in txs} == {today}
    assert {tx["receipt_group_id"] for tx in txs} == {gid}
    assert {tx["company_id"] for tx in txs} == {CO_A}
    assert all(tx["cheque_kind"] == "portfolio" for tx in txs)


def test_update_issue_date_keeps_movement_date_amount_updates(db):
    _run(_seed(db))
    today = _istanbul_today()

    saved = _run(cheques.create_cheque({
        "company_id": CO_A,
        "contact_id": "ct-a",
        "direction": "received",
        "instrument": "cheque",
        "amount": 100,
        "issue_date": "2026-10-01",
        "due_date": "2026-12-01",
        "serial_no": "SN-2",
    }, _user(CO_A)))

    txs = _portfolio_txs(db)
    assert len(txs) == 1
    assert txs[0]["date"] == today
    assert txs[0]["amount"] == 100
    original_date = txs[0]["date"]
    original_description = txs[0]["description"]

    updated = _run(cheques.update_cheque(saved["id"], {
        "issue_date": "2026-09-01",
    }, _user(CO_A)))

    assert updated["issue_date"] == "2026-09-01"
    assert updated["due_date"] == "2026-12-01"
    assert db.cheques.docs[0]["issue_date"] == "2026-09-01"
    txs = _portfolio_txs(db)
    assert len(txs) == 1
    assert txs[0]["date"] == original_date
    assert txs[0]["amount"] == 100
    assert txs[0]["description"] == original_description
    assert "2026-09-01" not in (txs[0].get("description") or "")

    updated = _run(cheques.update_cheque(saved["id"], {
        "amount": 180,
        "due_date": "2026-12-20",
    }, _user(CO_A)))

    assert updated["issue_date"] == "2026-09-01"
    assert updated["amount"] == 180
    assert updated["due_date"] == "2026-12-20"
    txs = _portfolio_txs(db)
    assert len(txs) == 1
    assert txs[0]["date"] == original_date
    assert txs[0]["amount"] == 180
    assert "2026-12-20" in (txs[0].get("description") or "")
    assert txs[0]["company_id"] == CO_A


def test_contact_overview_virtual_row_uses_created_at_day(db, monkeypatch):
    import server

    _run(_seed(db))
    monkeypatch.setattr(server, "db", db)

    async def plant():
        rows = [
            {
                "_id": "ch-old",
                "number": "CEK-OLD",
                "amount": 40,
                "issue_date": "2026-10-01",
                "due_date": "2026-12-01",
                "created_at": "2026-09-15T21:30:00+00:00",
            },
            {
                "_id": "ch-day",
                "number": "CEK-DAY",
                "amount": 11,
                "issue_date": "2026-10-01",
                "due_date": "2026-12-01",
                "created_at": "2026-09-15T10:00:00+00:00",
            },
            {
                "_id": "ch-aware",
                "number": "CEK-AWARE",
                "amount": 12,
                "issue_date": "2026-01-01",
                "due_date": "2026-12-02",
                "created_at": datetime(2026, 9, 15, 21, 30, tzinfo=timezone.utc),
            },
            {
                "_id": "ch-naive",
                "number": "CEK-NAIVE",
                "amount": 13,
                "issue_date": "2026-01-02",
                "due_date": "2026-12-03",
                "created_at": datetime(2026, 9, 15, 21, 30),
            },
            {
                "_id": "ch-aware-day",
                "number": "CEK-AWARE-DAY",
                "amount": 14,
                "issue_date": "2026-01-03",
                "due_date": "2026-12-04",
                "created_at": datetime(2026, 9, 15, 10, 0, tzinfo=timezone.utc),
            },
            {
                "_id": "ch-naive-day",
                "number": "CEK-NAIVE-DAY",
                "amount": 16,
                "issue_date": "2026-01-04",
                "due_date": "2026-12-05",
                "created_at": datetime(2026, 9, 15, 10, 0),
            },
            {
                "_id": "ch-plain",
                "number": "CEK-PLAIN",
                "amount": 15,
                "issue_date": "2026-08-02",
                "due_date": "2026-11-02",
            },
            {
                "_id": "ch-blank",
                "number": "CEK-BLANK",
                "amount": 17,
                "due_date": "2026-11-03",
            },
            {
                "_id": "ch-bad",
                "number": "CEK-BAD",
                "amount": 18,
                "issue_date": "2026-07-01",
                "due_date": "2026-11-04",
                "created_at": "not-a-date",
            },
        ]
        for row in rows:
            await db.cheques.insert_one({
                "company_id": CO_A,
                "contact_id": "ct-a",
                "contact_name": "Cari A",
                "status": "open",
                "direction": "received",
                "instrument": "cheque",
                "currency": "TRY",
                **row,
            })

    _run(plant())
    before = {doc["_id"]: (doc.get("issue_date"), doc.get("due_date")) for doc in db.cheques.docs}
    overview = _run(server.get_contact_overview("ct-a", _user(CO_A)))
    payments = overview["payments"]
    by_cheque = {row.get("cheque_id"): row for row in payments if row.get("source") == "cheque"}
    old = by_cheque["ch-old"]
    assert old.get("virtual") is True
    assert old["date"] == "2026-09-16"
    assert old["account_name"] == "Çek Portföyü"
    assert old["cheque_kind"] == "portfolio"
    assert by_cheque["ch-day"]["date"] == "2026-09-15"
    assert by_cheque["ch-aware"]["date"] == "2026-09-16"
    assert by_cheque["ch-naive"]["date"] == "2026-09-16"
    assert by_cheque["ch-aware-day"]["date"] == "2026-09-15"
    assert by_cheque["ch-naive-day"]["date"] == "2026-09-15"
    plain = by_cheque["ch-plain"]
    assert plain.get("virtual") is True
    assert plain["date"] == "2026-08-02"
    assert by_cheque["ch-blank"]["date"] == ""
    assert by_cheque["ch-bad"]["date"] == "2026-07-01"
    cheques_by_id = {row["id"]: row for row in overview["cheques"]}
    assert cheques_by_id["ch-old"]["issue_date"] == "2026-10-01"
    assert cheques_by_id["ch-old"]["due_date"] == "2026-12-01"
    assert {doc["_id"]: (doc.get("issue_date"), doc.get("due_date")) for doc in db.cheques.docs} == before
    assert db.bank_transactions.docs == []
