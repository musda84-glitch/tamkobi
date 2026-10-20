"""Çek/senet tahsilat grubu: tek makbuz, toplu giriş, kiracı sınırı.

Bellek içi MemDB. cheques._db fixture içinde bağlanır.
Modül ortam değişkeni yazmaz; canlı API, port ve veritabanı kullanmaz.
"""
from __future__ import annotations

import asyncio
import copy
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.routing import Match

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "tests"))

import cheques  # noqa: E402
from dashboard_memdb import MemColl, MemDB  # noqa: E402

CO_A = "co-a"
CO_B = "co-b"


def _run(coro):
    return asyncio.run(coro)


def _user(company_id: str) -> dict:
    return {
        "company_ids": [company_id],
        "active_company_id": company_id,
        "is_super_admin": False,
        "role": "admin",
    }


class _Coll(MemColl):
    async def delete_many(self, query=None):
        from mysql_store import match_query

        query = query or {}
        kept = []
        removed = 0
        for doc in self.docs:
            if match_query(doc, query):
                removed += 1
            else:
                kept.append(doc)
        self.docs[:] = kept
        return SimpleNamespace(deleted_count=removed)


class _DB(MemDB):
    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = _Coll(name, self)
            self._cols[name] = coll
        return coll


@pytest.fixture
def db(monkeypatch):
    database = _DB()
    monkeypatch.setattr(cheques, "_db", database)
    return database


async def _seed(db):
    await db.contacts.insert_one({
        "_id": "ct-a",
        "company_id": CO_A,
        "name": "Cari A",
        "balance": 1000.0,
        "cheque_bond_balance": 0.0,
    })
    await db.contacts.insert_one({
        "_id": "ct-b",
        "company_id": CO_B,
        "name": "Cari B",
        "balance": 500.0,
        "cheque_bond_balance": 0.0,
    })


def _contact(db, contact_id):
    return next(doc for doc in db.contacts.docs if doc["_id"] == contact_id)


def _item(amount, serial, *, instrument="cheque", due="2026-12-01", bank="Garanti"):
    return {
        "instrument": instrument,
        "amount": amount,
        "due_date": due,
        "serial_no": serial,
        "bank_name": bank,
    }


def test_single_create_mints_receipt_group_on_cheque_and_bank_tx(db):
    _run(_seed(db))

    saved = _run(cheques.create_cheque({
        "company_id": CO_A,
        "contact_id": "ct-a",
        "direction": "received",
        "instrument": "cheque",
        "amount": 25,
        "due_date": "2026-12-01",
        "serial_no": "SN-1",
        "bank_name": "Garanti",
    }, _user(CO_A)))

    gid = saved["receipt_group_id"]
    assert isinstance(gid, str) and gid.strip()
    assert saved["amount"] == 25
    assert len(db.cheques.docs) == 1
    assert db.cheques.docs[0]["receipt_group_id"] == gid
    assert db.cheques.docs[0]["company_id"] == CO_A
    assert len(db.bank_transactions.docs) == 1
    tx = db.bank_transactions.docs[0]
    assert tx["receipt_group_id"] == gid
    assert tx["company_id"] == CO_A
    assert tx["cheque_id"] == db.cheques.docs[0]["_id"]
    assert tx["source"] == "cheque"
    assert _contact(db, "ct-a")["balance"] == 975


def test_given_receipt_group_id_is_kept(db):
    _run(_seed(db))

    saved = _run(cheques.create_cheque({
        "company_id": CO_A,
        "contact_id": "ct-a",
        "direction": "issued",
        "instrument": "promissory",
        "amount": 10,
        "receipt_group_id": "  grp-keep  ",
    }, _user(CO_A)))

    assert saved["receipt_group_id"] == "grp-keep"
    assert db.cheques.docs[0]["receipt_group_id"] == "grp-keep"
    assert db.bank_transactions.docs[0]["receipt_group_id"] == "grp-keep"
    assert _contact(db, "ct-a")["balance"] == 1010


def test_skip_ledger_still_skips_payment_and_balance(db):
    _run(_seed(db))

    saved = _run(cheques.create_cheque({
        "company_id": CO_A,
        "contact_id": "ct-a",
        "direction": "received",
        "instrument": "promissory",
        "amount": 15,
        "skip_ledger": True,
    }, _user(CO_A)))

    assert saved["receipt_group_id"]
    assert saved["skip_ledger"] is True
    assert db.bank_transactions.docs == []
    assert _contact(db, "ct-a")["balance"] == 1000


def test_batch_three_items_share_one_group_and_move_balance(db):
    _run(_seed(db))

    saved = _run(cheques.create_cheques_batch({
        "company_id": CO_A,
        "contact_id": "ct-a",
        "direction": "received",
        "notes": "Toplu tahsilat",
        "items": [
            _item(100, "S1", due="2026-11-01"),
            _item(40.5, "S2", instrument="promissory", due="2026-11-02", bank="İş"),
            _item(10, "S3", due="2026-11-03", bank="Ziraat"),
        ],
    }, _user(CO_A)))

    gid = saved["receipt_group_id"]
    assert gid
    assert saved["total"] == 150.5
    assert len(saved["items"]) == 3
    assert {row["receipt_group_id"] for row in saved["items"]} == {gid}
    assert [row["serial_no"] for row in saved["items"]] == ["S1", "S2", "S3"]
    assert len(db.cheques.docs) == 3
    assert {doc["receipt_group_id"] for doc in db.cheques.docs} == {gid}
    assert {doc["company_id"] for doc in db.cheques.docs} == {CO_A}
    assert len(db.bank_transactions.docs) == 3
    assert {tx["receipt_group_id"] for tx in db.bank_transactions.docs} == {gid}
    assert {tx["company_id"] for tx in db.bank_transactions.docs} == {CO_A}
    assert _contact(db, "ct-a")["balance"] == 849.5
    assert _contact(db, "ct-a")["cheque_bond_balance"] == 150.5


def test_batch_rejects_zero_amount_without_writing(db):
    _run(_seed(db))

    with pytest.raises(HTTPException) as exc:
        _run(cheques.create_cheques_batch({
            "contact_id": "ct-a",
            "direction": "received",
            "items": [_item(10, "S1"), _item(0, "S2"), _item(5, "S3")],
        }, _user(CO_A)))

    assert exc.value.status_code == 400
    assert "Kalem 1" in str(exc.value.detail)
    assert db.cheques.docs == []
    assert db.bank_transactions.docs == []
    assert _contact(db, "ct-a")["balance"] == 1000


def test_batch_other_company_contact_is_404(db):
    _run(_seed(db))

    with pytest.raises(HTTPException) as exc:
        _run(cheques.create_cheques_batch({
            "contact_id": "ct-b",
            "direction": "received",
            "items": [_item(10, "S1"), _item(20, "S2")],
        }, _user(CO_A)))

    assert exc.value.status_code == 404
    assert db.cheques.docs == []
    assert db.bank_transactions.docs == []
    assert _contact(db, "ct-a")["balance"] == 1000
    assert _contact(db, "ct-b")["balance"] == 500


def test_batch_rolls_back_partial_writes(db, monkeypatch):
    _run(_seed(db))
    real = cheques._post_cari_payment
    calls = {"n": 0}

    async def flaky(doc):
        calls["n"] += 1
        if calls["n"] == 2:
            raise RuntimeError("yazma yarım kaldı")
        return await real(doc)

    monkeypatch.setattr(cheques, "_post_cari_payment", flaky)

    with pytest.raises(RuntimeError):
        _run(cheques.create_cheques_batch({
            "contact_id": "ct-a",
            "direction": "received",
            "items": [_item(10, "S1"), _item(20, "S2"), _item(30, "S3")],
        }, _user(CO_A)))

    assert db.cheques.docs == []
    assert db.bank_transactions.docs == []
    assert _contact(db, "ct-a")["balance"] == 1000


def test_receipt_returns_only_caller_company(db):
    _run(_seed(db))
    gid = "shared-group"

    async def plant():
        await db.cheques.insert_one({
            "_id": "a-late",
            "company_id": CO_A,
            "receipt_group_id": gid,
            "number": "CEK-A-2",
            "instrument": "cheque",
            "direction": "received",
            "status": "open",
            "contact_id": "ct-a",
            "contact_name": "Cari A",
            "amount": 20,
            "currency": "TRY",
            "issue_date": "2026-10-02",
            "due_date": "2026-12-02",
            "serial_no": "A2",
        })
        await db.cheques.insert_one({
            "_id": "a-early",
            "company_id": CO_A,
            "receipt_group_id": gid,
            "number": "CEK-A-1",
            "instrument": "cheque",
            "direction": "received",
            "status": "open",
            "contact_id": "ct-a",
            "contact_name": "Cari A",
            "amount": 10,
            "currency": "TRY",
            "issue_date": "2026-10-01",
            "due_date": "2026-12-01",
            "serial_no": "A1",
        })
        await db.cheques.insert_one({
            "_id": "b-same",
            "company_id": CO_B,
            "receipt_group_id": gid,
            "number": "CEK-B-1",
            "instrument": "cheque",
            "direction": "received",
            "status": "open",
            "contact_id": "ct-b",
            "contact_name": "Cari B",
            "amount": 99,
            "currency": "TRY",
            "issue_date": "2026-10-01",
            "due_date": "2026-12-01",
            "serial_no": "B1",
        })

    _run(plant())
    body = _run(cheques.cheque_receipt_group(group_id=gid, company_id=CO_A, user=_user(CO_A)))
    assert body["receipt_group_id"] == gid
    assert [row["number"] for row in body["cheques"]] == ["CEK-A-1", "CEK-A-2"]
    assert body["total"] == 30
    assert all(row["id"] != "b-same" for row in body["cheques"])
    leaked = copy.deepcopy(db.cheques.docs)
    assert any(doc["_id"] == "b-same" and doc["company_id"] == CO_B for doc in leaked)

    other = _run(cheques.cheque_receipt_group(group_id=gid, user=_user(CO_B)))
    assert [row["number"] for row in other["cheques"]] == ["CEK-B-1"]

    with pytest.raises(HTTPException) as exc:
        _run(cheques.cheque_receipt_group(group_id="missing-group", user=_user(CO_A)))
    assert exc.value.status_code == 404


def _matched_endpoint(method: str, path: str):
    scope = {
        "type": "http",
        "method": method,
        "path": path,
        "root_path": "",
        "scheme": "http",
        "headers": [],
        "query_string": b"",
    }
    for route in cheques.router.routes:
        match, _child = route.matches(scope)
        if match == Match.FULL:
            return route.endpoint.__name__
    return None


def test_receipt_and_batch_do_not_fall_through_to_cheque_id():
    names = []
    for route in cheques.router.routes:
        path = getattr(route, "path", "") or ""
        methods = getattr(route, "methods", None) or set()
        endpoint = getattr(route, "endpoint", None)
        names.append((path, methods, getattr(endpoint, "__name__", "")))

    def index(pred):
        for i, item in enumerate(names):
            if pred(item):
                return i
        return -1

    receipt_at = index(lambda item: item[0].endswith("/cheques/receipt") and "GET" in item[1])
    batch_at = index(lambda item: item[0].endswith("/cheques/batch") and "POST" in item[1])
    id_at = index(lambda item: item[0].endswith("/cheques/{cheque_id}") and "GET" in item[1])
    assert receipt_at != -1 and id_at != -1 and receipt_at < id_at
    assert batch_at != -1 and batch_at < id_at
    assert _matched_endpoint("GET", "/api/cheques/receipt") == "cheque_receipt_group"
    assert _matched_endpoint("POST", "/api/cheques/batch") == "create_cheques_batch"
    assert _matched_endpoint("GET", "/api/cheques/receipt") != "get_cheque"
    assert _matched_endpoint("GET", "/api/cheques/not-a-group") == "get_cheque"
