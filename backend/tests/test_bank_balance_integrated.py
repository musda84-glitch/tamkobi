"""Entegre banka hesabında current_balance çift sayılmaz.

Bellek içi. MONGO_URL canlıya gitmez; 8021 ve gerçek veritabanı yok.
"""
from __future__ import annotations

import asyncio
import copy
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException
from starlette.requests import Request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import expenses  # noqa: E402
import finance  # noqa: E402
import personnel_payments  # noqa: E402
import server  # noqa: E402
from finance_txn import CompensatingTxn  # noqa: E402
from mysql_store import apply_update, match_query, new_upsert_doc  # noqa: E402
from vpos.collect import _apply_balances  # noqa: E402

CO = "co-a"
BANK = "bank-kt"
KASA = "kasa"
KASA2 = "kasa-2"
POS = "pos-1"
SHOWN = 29045.42
REPORTED = 9045.42


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
        rows = list(self._docs)
        if length is not None:
            rows = rows[: int(length)]
        return copy.deepcopy(rows)


class MemoryCollection:
    def __init__(self, name):
        self.name = name
        self.docs = []

    def find(self, query=None, projection=None):
        matched = [copy.deepcopy(doc) for doc in self.docs if match_query(doc, query or {})]
        return _Cursor(matched)

    async def find_one(self, query=None, projection=None, sort=None):
        for doc in self.docs:
            if match_query(doc, query or {}):
                return copy.deepcopy(doc)
        return None

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

    async def find_one_and_update(self, query, update, upsert=False, return_document=True, projection=None):
        for index, doc in enumerate(self.docs):
            if not match_query(doc, query or {}):
                continue
            before = copy.deepcopy(doc)
            self.docs[index] = apply_update(doc, update, query)
            found = self.docs[index] if return_document else before
            return copy.deepcopy(found)
        if not upsert:
            return None
        created = new_upsert_doc(update, query)
        self.docs.append(created)
        return copy.deepcopy(created) if return_document else None

    async def delete_one(self, query):
        for index, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                del self.docs[index]
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def delete_many(self, query):
        before = len(self.docs)
        self.docs = [doc for doc in self.docs if not match_query(doc, query or {})]
        return SimpleNamespace(deleted_count=before - len(self.docs))

    async def count_documents(self, query=None):
        return sum(1 for doc in self.docs if match_query(doc, query or {}))


class MemoryDB:
    def __init__(self):
        self.name = f"tamkobi_test_bank_balance_{uuid.uuid4().hex[:8]}"
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


def _user():
    return {
        "id": "user-a",
        "_id": "user-a",
        "name": "Ayşe",
        "email": "ayse@firma.test",
        "company_ids": [CO],
        "active_company_id": CO,
        "role": "admin",
        "is_super_admin": False,
    }


@pytest.fixture
def db():
    mem = MemoryDB()
    prev = (server.db, expenses._db, finance._db)
    server.db = mem
    expenses._db = mem
    finance._db = mem
    try:
        yield mem
    finally:
        server.db, expenses._db, finance._db = prev


def _account(aid, *, balance, type_="bank", name="Hesap", company=CO):
    return {
        "_id": aid,
        "company_id": company,
        "type": type_,
        "account_name": name,
        "currency": "TRY",
        "current_balance": balance,
    }


async def _put(db, collection, doc):
    await db[collection].insert_one(doc)


def _balance(db, aid):
    row = next(doc for doc in db.bank_accounts.docs if doc["_id"] == aid)
    return float(row.get("current_balance") or 0)


def _contact_balance(db, cid):
    row = next(doc for doc in db.contacts.docs if doc["_id"] == cid)
    return float(row.get("balance") or 0)


async def _connect(db, account_id, conn_id="conn-kt"):
    await _put(db, "bank_connections", {
        "_id": conn_id,
        "company_id": CO,
        "linked_account_id": account_id,
        "provider": "kuveytturk",
        "provider_name": "Kuveyt Türk",
        "bank_account_number": "TR330006100519786457841326",
        "auto_match": False,
        "synced_count": 0,
        "auto_matched_count": 0,
    })


def _sync(db, conn_id, *, balance, transactions):
    async def fetch(_conn, _since):
        return {
            "simulated": True,
            "balance": balance,
            "transactions": transactions,
        }

    with patch.object(server.bank_providers, "fetch_transactions", AsyncMock(side_effect=fetch)), \
         patch("event_notify.inapp_enabled", new=AsyncMock(return_value=True)), \
         patch("event_notify.queue_event_email", new=AsyncMock()):
        return _run(server._sync_bank_connection_core(conn_id, days=7))


def _tx(**kwargs):
    doc = {
        "_id": kwargs.get("_id") or "tx-1",
        "company_id": CO,
        "account_id": BANK,
        "account_name": "Kuveyt Türk Vadesiz",
        "type": "inflow",
        "amount": 150.0,
        "currency": "TRY",
        "date": "2026-10-10",
        "description": "HAVALE",
        "source": "bank_sync",
        "match_status": "matched",
    }
    doc.update(kwargs)
    doc["_id"] = kwargs.get("_id") or doc["_id"]
    return doc


def _match(tx_id, body):
    return server.match_bank_transaction(_request(), tx_id, body, user=_user())


def test_integrated_manual_then_sync_equals_bank_balance(db):
    """Manuel ödeme/tahsilat entegre bakiyeyi değiştirmez; senkron banka bakiyesine çeker."""

    async def prepare():
        await _put(db, "bank_accounts", _account(BANK, balance=SHOWN, name="Kuveyt Türk Vadesiz"))
        await _put(db, "bank_accounts", _account(KASA, balance=500.0, type_="cash_box", name="Kasa"))
        await _connect(db, BANK)
        acc = await db.bank_accounts.find_one({"_id": BANK, "company_id": CO})
        await finance._insert_statement_line(acc, {
            "date": "2026-10-20",
            "description": "Gelen havale",
            "amount": 20000,
            "kind": "diger",
        })
        with patch("expenses.assert_manual_allowed", new=AsyncMock()):
            await expenses._post_payment(
                {
                    "_id": "exp-manual",
                    "company_id": CO,
                    "expense_number": "MSR-2026-0009",
                    "description": "Kira",
                    "category": "Kira",
                    "total": 20000,
                    "currency": "TRY",
                },
                BANK,
                "2026-10-20",
            )

    _run(prepare())
    assert _balance(db, BANK) == pytest.approx(SHOWN)
    assert _balance(db, KASA) == pytest.approx(500.0)

    out = _sync(db, "conn-kt", balance=REPORTED, transactions=[{
        "external_id": "kt-20000",
        "direction": "debit",
        "amount": 20000,
        "currency": "TRY",
        "description": "Kira ödemesi",
        "counterparty": "Ev sahibi",
        "date": "2026-10-20",
        "is_simulated": True,
    }])
    stored = next(doc for doc in db.bank_accounts.docs if doc["_id"] == BANK)
    assert out["balance"] == pytest.approx(REPORTED)
    assert stored["current_balance"] == pytest.approx(REPORTED)
    assert stored["bank_reported_balance"] == pytest.approx(REPORTED)
    assert stored["current_balance"] != pytest.approx(SHOWN - 40000)


def test_sync_corrects_drift_and_leaves_balance_without_report(db):
    async def prepare():
        await _put(db, "bank_accounts", _account(BANK, balance=SHOWN, name="Kuveyt Türk Vadesiz"))
        await _put(db, "bank_accounts", _account("bank-gap", balance=1000.0, name="Diğer"))
        await _connect(db, BANK, "conn-kt")
        await _connect(db, "bank-gap", "conn-gap")

    _run(prepare())
    _sync(db, "conn-kt", balance=REPORTED, transactions=[{
        "external_id": "kt-1",
        "direction": "credit",
        "amount": 10,
        "currency": "TRY",
        "description": "EFT",
        "date": "2026-10-21",
        "is_simulated": True,
    }])
    fixed = next(doc for doc in db.bank_accounts.docs if doc["_id"] == BANK)
    assert fixed["current_balance"] == pytest.approx(REPORTED)
    assert fixed["bank_reported_balance"] == pytest.approx(REPORTED)

    _sync(db, "conn-gap", balance=None, transactions=[{
        "external_id": "gap-1",
        "direction": "credit",
        "amount": 50,
        "currency": "TRY",
        "description": "EFT",
        "date": "2026-10-21",
        "is_simulated": True,
    }])
    gap = next(doc for doc in db.bank_accounts.docs if doc["_id"] == "bank-gap")
    assert gap["current_balance"] == pytest.approx(1000.0)
    assert "bank_reported_balance" not in gap


def test_non_integrated_paths_still_increment(db):
    async def prepare():
        await _put(db, "bank_accounts", _account(KASA, balance=500.0, type_="cash_box", name="Kasa"))
        acc = await db.bank_accounts.find_one({"_id": KASA, "company_id": CO})
        await finance._insert_statement_line(acc, {
            "date": "2026-10-20",
            "description": "Tahsilat",
            "amount": 80,
            "kind": "diger",
        })
        await expenses._post_payment(
            {
                "_id": "exp-cash",
                "company_id": CO,
                "expense_number": "MSR-2026-0010",
                "description": "Yakıt",
                "category": "Yakıt",
                "total": 30,
                "currency": "TRY",
            },
            KASA,
            "2026-10-20",
        )

    _run(prepare())
    assert _balance(db, KASA) == pytest.approx(550.0)


def test_virman_unmatch_is_symmetric_and_integrated_target_is_not_written(db):
    async def scenario():
        await _put(db, "bank_accounts", _account(BANK, balance=SHOWN, name="Kuveyt Türk Vadesiz"))
        await _put(db, "bank_accounts", _account(KASA, balance=200.0, type_="cash_box", name="Kasa"))
        await _put(db, "bank_accounts", _account("bank-hedef", balance=700.0, name="Hedef Banka"))
        await _connect(db, BANK)
        await _connect(db, "bank-hedef", "conn-hedef")
        await _put(db, "bank_transactions", _tx(
            _id="tx-out", type="outflow", amount=80.0, match_status="unmatched",
            contact_id=None, description="VIRMAN",
        ))
        matched = await server._apply_match(
            await db.bank_transactions.find_one({"_id": "tx-out", "company_id": CO}),
            None, None, None, learn=False, target_account_id=KASA,
        )
        after = _balance(db, KASA)
        stored = await db.bank_transactions.find_one({"_id": "tx-out", "company_id": CO})
        await server._unmatch(stored)
        restored = _balance(db, KASA)
        counters = [
            doc for doc in db.bank_transactions.docs
            if doc.get("related_bank_tx_id") == "tx-out" and doc.get("source") == "bank_match"
        ]
        fresh = await db.bank_transactions.find_one({"_id": "tx-out", "company_id": CO})
        await server._apply_match(fresh, None, None, None, learn=False, target_account_id=KASA)
        again = await db.bank_transactions.find_one({"_id": "tx-out", "company_id": CO})
        await server._unmatch(again)
        with pytest.raises(HTTPException) as blocked:
            await server._apply_match(
                await db.bank_transactions.find_one({"_id": "tx-out", "company_id": CO}),
                None, None, None, learn=False, target_account_id="bank-hedef",
            )
        await _put(db, "bank_transactions", {
            "_id": "counter-int",
            "company_id": CO,
            "account_id": "bank-hedef",
            "type": "inflow",
            "amount": 80.0,
            "source": "bank_match",
            "related_bank_tx_id": "tx-linked",
        })
        await _put(db, "bank_transactions", _tx(
            _id="tx-linked", type="outflow", amount=80.0, match_status="matched",
            target_account_id="bank-hedef", target_account_name="Hedef Banka",
            description="ESKI VIRMAN",
        ))
        before_integrated = _balance(db, "bank-hedef")
        await server._unmatch(await db.bank_transactions.find_one({"_id": "tx-linked", "company_id": CO}))
        return matched, after, restored, counters, blocked.value, before_integrated

    matched, after, restored, counters, blocked, before_integrated = _run(scenario())
    assert matched["target_account_id"] == KASA
    assert after == pytest.approx(280.0)
    assert restored == pytest.approx(200.0)
    assert counters == []
    assert _balance(db, KASA) == pytest.approx(200.0)
    assert _balance(db, BANK) == pytest.approx(SHOWN)
    assert blocked.status_code == 400
    assert _balance(db, "bank-hedef") == pytest.approx(before_integrated)
    assert not any(doc.get("_id") == "counter-int" for doc in db.bank_transactions.docs)


def _snap(db):
    return {
        "bank": _balance(db, BANK),
        "kasa": _balance(db, KASA),
        "kasa2": _balance(db, KASA2),
        "pos": _balance(db, POS),
        "ct": _contact_balance(db, "ct"),
        "ct2": _contact_balance(db, "ct2"),
        "manual": _contact_balance(db, "ct-manual"),
        "paid": float(next(doc for doc in db.invoices.docs if doc["_id"] == "inv")["paid_amount"]),
        "expenses": [doc["_id"] for doc in db.expenses.docs],
        "counters": [
            (doc.get("account_id"), doc.get("related_bank_tx_id"))
            for doc in db.bank_transactions.docs
            if doc.get("source") == "bank_match"
        ],
    }


def test_rematch_transitions_touch_new_target_once(db):
    """Kaynak entegre bakiye sabit kalır; eski hedef döner, yeni hedef bir kez etkilenir."""

    async def scenario():
        await _put(db, "bank_accounts", _account(BANK, balance=SHOWN, name="Kuveyt Türk Vadesiz"))
        await _put(db, "bank_accounts", _account(KASA, balance=1000.0, type_="cash_box", name="Kasa"))
        await _put(db, "bank_accounts", _account(KASA2, balance=800.0, type_="cash_box", name="Kasa 2"))
        await _put(db, "bank_accounts", _account(POS, balance=500.0, type_="pos", name="Sanal POS"))
        await _connect(db, BANK)
        for cid, name in (("ct", "Cari"), ("ct2", "Cari 2"), ("ct-manual", "Eski Cari")):
            await _put(db, "contacts", {"_id": cid, "company_id": CO, "name": name, "balance": 0.0})
        db.contacts.docs[[d["_id"] for d in db.contacts.docs].index("ct-manual")]["balance"] = -40.0
        await _put(db, "invoices", {
            "_id": "inv", "company_id": CO, "contact_id": "ct2",
            "invoice_number": "FTR-1", "grand_total": 500.0, "paid_amount": 0.0,
        })
        await _put(db, "bank_transactions", _tx(
            _id="tx-in", type="inflow", amount=150.0, match_status="unmatched", description="TAHSILAT",
        ))
        await _put(db, "bank_transactions", _tx(
            _id="tx-out", type="outflow", amount=80.0, match_status="unmatched", description="ODEME",
        ))
        await _put(db, "bank_transactions", _tx(
            _id="tx-pos", type="inflow", amount=100.0, match_status="unmatched", description="POS BLOKE",
        ))
        await _put(db, "bank_transactions", {
            "_id": "manual-1", "company_id": CO, "account_id": KASA, "type": "inflow",
            "amount": 40.0, "contact_id": "ct-manual", "contact_name": "Eski Cari",
            "source": "manual", "date": "2026-10-09", "description": "Elle tahsilat",
        })
        await _put(db, "bank_transactions", _tx(
            _id="tx-link", type="inflow", amount=40.0, match_status="unmatched", description="AYNI HAVALE",
        ))

        await server._apply_match(
            await db.bank_transactions.find_one({"_id": "tx-in", "company_id": CO}),
            None, None, None, learn=False, target_account_id=KASA,
        )
        virman_kasa = _snap(db)
        await _match("tx-in", {"replace": True, "contact_id": "ct", "learn": False})
        cari = _snap(db)
        await _match("tx-in", {"replace": True, "contact_id": "ct", "learn": False})
        cari_again = _snap(db)
        await _match("tx-in", {"replace": True, "invoice_id": "inv", "learn": False})
        invoice = _snap(db)

        await server._apply_match(
            await db.bank_transactions.find_one({"_id": "tx-out", "company_id": CO}),
            None, None, "Yakıt", learn=False, as_expense=True,
        )
        expense = _snap(db)
        await _match("tx-out", {"replace": True, "target_account_id": KASA2, "learn": False})
        to_virman = _snap(db)
        await _match("tx-out", {"replace": True, "target_account_id": KASA2, "learn": False})
        virman_again = _snap(db)

        await server._apply_match(
            await db.bank_transactions.find_one({"_id": "tx-pos", "company_id": CO}),
            None, None, None, learn=False, target_account_id=KASA,
        )
        await _match("tx-pos", {
            "replace": True,
            "mode": "pos_settlement",
            "target_account_id": POS,
            "pos_gross": 110,
            "pos_commission": 10,
            "category": "POS Komisyonu",
            "learn": False,
        })
        pos = _snap(db)
        pos_tx = await db.bank_transactions.find_one({"_id": "tx-pos", "company_id": CO})
        await _match("tx-pos", {"replace": True, "contact_id": "ct", "learn": False})
        pos_to_cari = _snap(db)
        await _match("tx-pos", {"replace": True, "contact_id": "ct", "learn": False})
        pos_cari_again = _snap(db)

        await server._apply_match(
            await db.bank_transactions.find_one({"_id": "tx-link", "company_id": CO}),
            "ct-manual", None, "Tahsilat", learn=False, link_existing_id="manual-1",
        )
        linked = _snap(db)
        link_tx = await db.bank_transactions.find_one({"_id": "tx-link", "company_id": CO})
        await _match("tx-link", {"replace": True, "contact_id": "ct2", "learn": False})
        link_to_cari = _snap(db)
        gone = await db.bank_transactions.find_one({"_id": "tx-link", "company_id": CO})
        await _match("tx-link", {"replace": True, "contact_id": "ct2", "learn": False})
        link_again = _snap(db)
        return {
            "virman_kasa": virman_kasa,
            "cari": cari,
            "cari_again": cari_again,
            "invoice": invoice,
            "expense": expense,
            "to_virman": to_virman,
            "virman_again": virman_again,
            "pos": pos,
            "pos_tx": pos_tx,
            "pos_to_cari": pos_to_cari,
            "pos_cari_again": pos_cari_again,
            "linked": linked,
            "link_tx": link_tx,
            "link_to_cari": link_to_cari,
            "gone": gone,
            "link_again": link_again,
        }

    got = _run(scenario())
    assert got["virman_kasa"]["bank"] == pytest.approx(SHOWN)
    assert got["virman_kasa"]["kasa"] == pytest.approx(850.0)
    assert got["cari"]["kasa"] == pytest.approx(1000.0)
    assert got["cari"]["ct"] == pytest.approx(-150.0)
    assert got["cari"]["counters"] == []
    assert got["cari_again"] == got["cari"]

    assert got["invoice"]["ct"] == pytest.approx(0.0)
    assert got["invoice"]["ct2"] == pytest.approx(-150.0)
    assert got["invoice"]["paid"] == pytest.approx(150.0)
    assert got["invoice"]["bank"] == pytest.approx(SHOWN)

    assert len(got["expense"]["expenses"]) == 1
    assert got["expense"]["kasa2"] == pytest.approx(800.0)
    assert got["to_virman"]["expenses"] == []
    assert got["to_virman"]["kasa2"] == pytest.approx(880.0)
    assert ("kasa-2", "tx-out") in got["to_virman"]["counters"] or (KASA2, "tx-out") in got["to_virman"]["counters"]
    assert got["virman_again"]["kasa2"] == pytest.approx(880.0)
    assert got["virman_again"]["expenses"] == []
    assert got["virman_again"]["bank"] == pytest.approx(SHOWN)

    assert got["pos_tx"]["match_kind"] == "pos_settlement"
    assert got["pos_tx"]["pos_commission"] == pytest.approx(10)
    assert got["pos"]["pos"] == pytest.approx(390.0)
    assert got["pos"]["kasa"] == pytest.approx(1000.0)
    assert len(got["pos"]["expenses"]) == 1
    assert any(pair[0] == POS and pair[1] == "tx-pos" for pair in got["pos"]["counters"])
    assert got["pos_to_cari"]["pos"] == pytest.approx(500.0)
    assert got["pos_to_cari"]["expenses"] == []
    assert got["pos_to_cari"]["ct"] == pytest.approx(-100.0)
    assert not any(pair[1] == "tx-pos" for pair in got["pos_to_cari"]["counters"])
    assert got["pos_cari_again"]["ct"] == pytest.approx(-100.0)
    assert got["pos_cari_again"]["pos"] == pytest.approx(500.0)
    assert got["pos_to_cari"]["bank"] == pytest.approx(SHOWN)

    assert got["link_tx"]["linked_existing"] is True
    assert got["linked"]["manual"] == pytest.approx(-40.0)
    assert got["link_to_cari"]["manual"] == pytest.approx(-40.0)
    assert got["link_to_cari"]["ct2"] == pytest.approx(-190.0)
    assert got["gone"].get("linked_existing") in (None, False)
    assert not got["gone"].get("related_manual_tx_id")
    assert got["link_again"]["manual"] == pytest.approx(-40.0)
    assert got["link_again"]["ct2"] == pytest.approx(-190.0)
    assert got["link_again"]["bank"] == pytest.approx(SHOWN)


def test_personnel_and_vpos_skip_integrated_balance(db):
    async def scenario():
        await _put(db, "bank_accounts", _account(BANK, balance=SHOWN, name="Kuveyt Türk Vadesiz"))
        await _put(db, "bank_accounts", _account(KASA, balance=400.0, type_="cash_box", name="Kasa"))
        await _connect(db, BANK)
        await _put(db, "contacts", {"_id": "ct", "company_id": CO, "name": "Cari", "balance": 50.0})
        await _put(db, "bank_transactions", {
            "_id": "vpos-1", "company_id": CO, "account_id": BANK, "type": "inflow",
            "amount": 25.0, "effects": {"account": False, "contact": False},
        })
        emp = {"_id": "e1", "company_id": CO, "full_name": "Ali"}
        line = {"kind": "salary", "amount": 100.0, "account_id": BANK}
        with patch("personnel_payments.bank_guard.assert_manual_allowed", new=AsyncMock()):
            name = await personnel_payments._cash_out(
                db, emp, line, {"account_name": "Kuveyt Türk Vadesiz"},
                "2026-10-21", "2026-10", "mov-1", CompensatingTxn("pay"),
            )
        integrated_after = _balance(db, BANK)
        plain = await personnel_payments._cash_out(
            db, emp, {"kind": "salary", "amount": 40.0, "account_id": KASA},
            {"account_name": "Kasa"}, "2026-10-21", "2026-10", "mov-2", CompensatingTxn("pay"),
        )
        kasa_after = _balance(db, KASA)
        effects = await _apply_balances(db, "vpos-1", BANK, "ct", 25.0, company_id=CO)
        return name, integrated_after, plain, kasa_after, effects

    name, integrated_after, plain, kasa_after, effects = _run(scenario())
    assert name == "Kuveyt Türk Vadesiz"
    assert integrated_after == pytest.approx(SHOWN)
    assert plain == "Kasa"
    assert kasa_after == pytest.approx(360.0)
    assert effects["account"] is True
    assert effects["contact"] is True
    assert _balance(db, BANK) == pytest.approx(SHOWN)
    assert _contact_balance(db, "ct") == pytest.approx(25.0)
