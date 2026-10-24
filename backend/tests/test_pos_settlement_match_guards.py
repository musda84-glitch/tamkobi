"""POS eşleşme kilidi, masraf geri alma ve cari silmede kalan karşı kayıt.

Bellek içi depo. Canlı veritabanına bağlanmaz.
"""
from __future__ import annotations

import copy
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "tests"))

import account_balance  # noqa: E402
import bank_guard  # noqa: E402
import cheques  # noqa: E402
import contact_activity  # noqa: E402
import expenses  # noqa: E402
import server  # noqa: E402
import storage_router  # noqa: E402
import test_bank_pos_settlement as posfix  # noqa: E402
import test_dedicated_trash_delete as dedicated  # noqa: E402
import trash  # noqa: E402

_run = posfix._run
CO = posfix.CO
GROSS = posfix.GROSS
NET = posfix.NET
COMM = posfix.COMM


@pytest.fixture
def db(monkeypatch):
    database = posfix._DB()
    monkeypatch.setattr(server, "db", database)
    monkeypatch.setattr(expenses, "_db", database)
    return database


def test_double_apply_is_409_and_debits_pos_once(db):
    tx = posfix._seed(db, pos_balance=GROSS * 3)
    _run(posfix._match(tx))
    with pytest.raises(HTTPException) as ei:
        _run(posfix._match(tx))
    assert ei.value.status_code == 409
    assert posfix._balance(db, "pos1", CO) == pytest.approx(GROSS * 2)
    counters = [row for row in db.bank_transactions.docs if row.get("source") == "bank_match"]
    assert len(counters) == 1
    assert len([row for row in db.expenses.docs if row.get("company_id") == CO]) == 1
    stored = _run(db.bank_transactions.find_one({"_id": "tx1", "company_id": CO}))
    assert stored["match_status"] == "matched"


def test_second_unmatch_refunds_once(db):
    tx = posfix._seed(db)
    _run(posfix._match(tx))
    stored = _run(db.bank_transactions.find_one({"_id": "tx1", "company_id": CO}))
    _run(server._unmatch(stored))
    _run(server._unmatch(stored))
    assert posfix._balance(db, "pos1", CO) == pytest.approx(GROSS)
    assert not [row for row in db.bank_transactions.docs if row.get("source") == "bank_match"]


def test_bank_row_write_failure_rolls_back(db, monkeypatch):
    tx = posfix._seed(db)
    original = db.bank_transactions.update_one

    async def _boom(query, update, upsert=False):
        body = (update or {}).get("$set") or {}
        if query.get("match_status") == "matching" and body.get("match_status") == "matched":
            raise RuntimeError("banka satırı yazılamadı")
        return await original(query, update, upsert=upsert)

    monkeypatch.setattr(db.bank_transactions, "update_one", _boom)
    with pytest.raises(RuntimeError):
        _run(posfix._match(tx))
    assert posfix._balance(db, "pos1", CO) == pytest.approx(GROSS)
    assert not [row for row in db.bank_transactions.docs if row.get("source") == "bank_match"]
    assert db.expenses.docs == []
    stored = _run(db.bank_transactions.find_one({"_id": "tx1", "company_id": CO}))
    assert stored["match_status"] == "unmatched"
    assert "match_lock_at" not in stored
    assert "match_kind" not in stored


def test_custom_category_failure_removes_expense(db, monkeypatch):
    tx = posfix._seed(db)

    async def _boom(*_args, **_kwargs):
        raise RuntimeError("kategori yazılamadı")

    monkeypatch.setattr(expenses, "add_category_for_company", _boom)
    with pytest.raises(RuntimeError):
        _run(posfix._match(tx, category="Ozel POS"))
    assert db.expenses.docs == []
    assert posfix._balance(db, "pos1", CO) == pytest.approx(GROSS)
    assert not [row for row in db.bank_transactions.docs if row.get("source") == "bank_match"]
    stored = _run(db.bank_transactions.find_one({"_id": "tx1", "company_id": CO}))
    assert stored["match_status"] == "unmatched"


def test_trashing_bank_match_expense_clears_link_and_restore_is_blocked(db):
    posfix._seed(db)
    _run(db.bank_transactions.insert_one({
        "_id": "bank-row",
        "company_id": CO,
        "account_id": "bank1",
        "match_kind": "pos_settlement",
        "match_status": "matched",
        "expense_id": "exp-1",
        "expense_number": "MSR-9",
        "pos_commission": COMM,
        "source": "bank_sync",
    }))
    exp = {
        "_id": "exp-1",
        "company_id": CO,
        "source": "bank_match",
        "bank_transaction_id": "bank-row",
        "expense_number": "MSR-9",
        "payment_status": "paid",
        "account_id": "pos1",
        "total": COMM,
    }
    _run(db.expenses.insert_one(exp))
    _run(expenses.detach_bank_match_expense(exp, company_id=CO))
    row = _run(db.bank_transactions.find_one({"_id": "bank-row", "company_id": CO}))
    assert "expense_id" not in row
    assert "expense_number" not in row
    assert "pos_commission" not in row
    with pytest.raises(HTTPException) as ei:
        _run(server._restore_expense(exp, []))
    assert ei.value.status_code == 400
    assert "geri getirilemez" in ei.value.detail


def test_integrated_pos_and_currency_mismatch_do_not_write(db):
    tx = posfix._seed(db)
    _run(db.bank_connections.insert_one({
        "_id": "conn-1",
        "company_id": CO,
        "linked_account_id": "pos1",
        "provider_name": "Kuveyt",
    }))
    before = posfix._snap(db)
    with pytest.raises(HTTPException) as integrated:
        _run(posfix._match(tx))
    assert integrated.value.status_code == 400
    assert "Entegre POS" in integrated.value.detail
    assert posfix._snap(db) == before

    db.bank_connections.docs.clear()
    for row in db.bank_accounts.docs:
        if row.get("_id") == "pos1":
            row["currency"] = "USD"
    before = posfix._snap(db)
    with pytest.raises(HTTPException) as mismatch:
        _run(posfix._match(tx))
    assert mismatch.value.status_code == 400
    assert "para birimi" in mismatch.value.detail
    assert posfix._snap(db) == before


def test_same_foreign_currency_still_releases_pos(db):
    tx = posfix._seed(db, tx=posfix._tx(currency="EUR"))
    for row in db.bank_accounts.docs:
        if row.get("_id") == "pos1":
            row["currency"] = "EUR"
    out = _run(posfix._match(tx))
    assert out["match_kind"] == "pos_settlement"
    assert posfix._balance(db, "pos1", CO) == pytest.approx(0)


def test_dedicated_reads_use_company_id(monkeypatch):
    monkeypatch.setattr(storage_router, "enabled", lambda: True)

    def _sync(_db, company_id):
        if company_id == CO:
            return (storage_router.DEDICATED, 1, False)
        return (storage_router.LEGACY, 0, False)

    monkeypatch.setattr(storage_router, "storage_decision_sync", _sync)

    class _Accounts:
        def __init__(self):
            self.queries = []

        async def find_one(self, query, projection=None):
            self.queries.append(copy.deepcopy(query))
            if query.get("company_id") == CO and query.get("_id") == "acc":
                return {"_id": "acc", "company_id": CO, "type": "bank"}
            if "company_id" not in query and query.get("_id") == "acc":
                return {"_id": "acc", "company_id": "co_b", "type": "credit_card"}
            return None

    accounts = _Accounts()
    db = type("DB", (), {"bank_accounts": accounts})()
    got = _run(bank_guard.assert_collection_allowed(db, "acc", company_id=CO))
    assert got["type"] == "bank"
    assert accounts.queries[-1]["company_id"] == CO

    cid = _run(account_balance._lookup_company_id(db, "acc", company_id=CO))
    assert cid == CO
    assert accounts.queries[-1]["company_id"] == CO

    monkeypatch.setattr(storage_router, "enabled", lambda: False)
    scoped = _run(bank_guard.assert_collection_allowed(db, "acc", company_id=CO))
    assert scoped["type"] == "bank"
    assert accounts.queries[-1]["company_id"] == CO
    with pytest.raises(HTTPException) as legacy:
        _run(bank_guard.assert_collection_allowed(db, "acc"))
    assert legacy.value.status_code == 400
    assert "company_id" not in accounts.queries[-1]

    year_db = posfix._DB()
    number = _run(expenses.next_msr_number(year_db, CO))
    assert number.endswith("-0001")
    assert "company_id" not in year_db.counters.docs[0]

    monkeypatch.setattr(storage_router, "enabled", lambda: True)
    private_db = posfix._DB()
    number = _run(expenses.next_msr_number(private_db, CO))
    assert number.endswith("-0001")
    assert private_db.counters.docs[0]["company_id"] == CO
    assert private_db.counters.docs[0]["_id"].endswith(CO)


@pytest.fixture
def routed(monkeypatch):
    db = dedicated._RouterDB()
    monkeypatch.setattr(storage_router, "enabled", lambda: True)

    async def _decision(_db, company_id):
        if company_id in (dedicated.CO_A, dedicated.CO_B):
            return (storage_router.DEDICATED, 1, False)
        return (storage_router.LEGACY, 0, False)

    monkeypatch.setattr(storage_router, "storage_decision", _decision)
    previous = server.db
    prev_expenses = expenses._db
    prev_cheques = cheques._db
    server.db = db
    expenses._db = db
    cheques._db = db
    trash.init(db)
    yield db
    server.db = previous
    expenses._db = prev_expenses
    cheques._db = prev_cheques
    trash.init(previous)


def test_delete_cari_payment_clears_pos_bank_and_balance(routed):
    db = routed
    user = dedicated._user(dedicated.CO_A)
    for company_id, pos_balance, bank_balance, contact_balance in (
        (dedicated.CO_A, 4800.0, 9000.0, 1000.0),
        (dedicated.CO_B, 4800.0, 9000.0, 1000.0),
    ):
        dedicated._put(db, company_id, "bank_accounts", {
            "_id": "acc-pos", "type": "pos", "account_name": "POS",
            "current_balance": pos_balance, "currency": "TRY",
        })
        dedicated._put(db, company_id, "bank_accounts", {
            "_id": "acc-bank", "type": "bank", "account_name": "Banka",
            "current_balance": bank_balance, "currency": "TRY",
        })
        dedicated._put(db, company_id, "contacts", {
            "_id": "cari-pay", "name": "Cari", "balance": contact_balance,
        })
        dedicated._put(db, company_id, "bank_transactions", {
            "_id": "open-pos", "account_id": "acc-pos", "type": "inflow",
            "amount": 5000.0, "source": "opening", "description": "Açılış",
            "date": "2026-10-01",
        })
        dedicated._put(db, company_id, "bank_transactions", {
            "_id": "open-bank", "account_id": "acc-bank", "type": "inflow",
            "amount": 10000.0, "source": "opening", "description": "Açılış",
            "date": "2026-10-01",
        })
        dedicated._put(db, company_id, "bank_transactions", {
            "_id": "pay-1", "account_id": "acc-bank", "account_name": "Banka",
            "type": "outflow", "amount": 1000.0, "source": "manual",
            "contact_id": "cari-pay", "contact_name": "Cari",
            "description": "Cari ödeme", "date": "2026-10-24",
            "match_kind": "pos_settlement", "expense_id": "exp-pos",
            "match_status": "matched",
        })
        dedicated._put(db, company_id, "bank_transactions", {
            "_id": "pos-counter", "account_id": "acc-pos", "account_name": "POS",
            "type": "outflow", "amount": 200.0, "source": "bank_match",
            "related_bank_tx_id": "pay-1", "description": "POS bloke çözümü",
            "date": "2026-10-24",
        })
        dedicated._put(db, company_id, "bank_transactions", {
            "_id": "linker", "account_id": "acc-bank", "type": "inflow",
            "amount": 1000.0, "source": "bank_sync", "match_status": "matched",
            "linked_existing": True, "related_manual_tx_id": "pay-1",
            "contact_id": "cari-pay", "contact_name": "Cari",
            "description": "Banka", "date": "2026-10-24",
        })
        dedicated._put(db, company_id, "expenses", {
            "_id": "exp-pos", "source": "bank_match", "bank_transaction_id": "pay-1",
            "expense_number": "MSR-1", "total": 50.0, "category": "POS Komisyonu",
            "description": "POS komisyonu", "payment_status": "paid",
        })
    before_b = copy.deepcopy(db.dedicated[dedicated.CO_B])
    out = _run(server.delete_bank_transaction("pay-1", user))
    assert out["status"] == "success"
    assert dedicated._live(db, dedicated.CO_A, "bank_transactions", "pay-1") is None
    assert dedicated._live(db, dedicated.CO_A, "bank_transactions", "pos-counter") is None
    assert dedicated._live(db, dedicated.CO_A, "expenses", "exp-pos") is None
    linker = dedicated._live(db, dedicated.CO_A, "bank_transactions", "linker")
    assert linker["match_status"] == "unmatched"
    assert "contact_id" not in linker
    assert "related_manual_tx_id" not in linker
    assert dedicated._live(db, dedicated.CO_A, "bank_accounts", "acc-pos")["current_balance"] == pytest.approx(5000.0)
    assert dedicated._live(db, dedicated.CO_A, "bank_accounts", "acc-bank")["current_balance"] == pytest.approx(10000.0)
    assert dedicated._live(db, dedicated.CO_A, "contacts", "cari-pay")["balance"] == pytest.approx(0.0)
    assert db.dedicated[dedicated.CO_B] == before_b


def test_partner_reverse_finds_single_candidate_without_regex(routed):
    db = routed
    dedicated._put(db, dedicated.CO_A, "partners", {
        "_id": "p1", "name": "Ortak", "balance": -400.0, "total_withdrawn": 400.0,
    })
    dedicated._put(db, dedicated.CO_A, "bank_accounts", {
        "_id": "cash", "type": "cash_box", "account_name": "Kasa",
        "current_balance": 1000.0, "currency": "TRY",
    })
    dedicated._put(db, dedicated.CO_A, "bank_transactions", {
        "_id": "cash-row", "account_id": "cash", "type": "outflow",
        "amount": 400.0, "source": "partner", "date": "2026-10-24",
        "description": "başka metin",
    })
    dedicated._put(db, dedicated.CO_B, "bank_transactions", {
        "_id": "cash-b", "account_id": "cash", "type": "outflow",
        "amount": 400.0, "source": "partner", "date": "2026-10-24",
        "description": "Ortak: regex",
    })
    tx = {
        "_id": "ptx-1", "company_id": dedicated.CO_A, "partner_id": "p1",
        "partner_name": "Ortak", "type": "withdrawal", "amount": 400.0,
        "account_id": "cash", "date": "2026-10-24",
    }
    _run(server._reverse_partner_tx(tx))
    assert dedicated._live(db, dedicated.CO_A, "bank_transactions", "cash-row") is None
    assert dedicated._live(db, dedicated.CO_A, "bank_accounts", "cash")["current_balance"] == pytest.approx(1400.0)
    assert dedicated._live(db, dedicated.CO_A, "partners", "p1")["balance"] == pytest.approx(0.0)
    assert dedicated._live(db, dedicated.CO_B, "bank_transactions", "cash-b")["description"] == "Ortak: regex"

    dedicated._put(db, dedicated.CO_A, "bank_transactions", {
        "_id": "dup-1", "account_id": "cash", "type": "outflow",
        "amount": 50.0, "source": "partner", "date": "2026-10-25",
    })
    dedicated._put(db, dedicated.CO_A, "bank_transactions", {
        "_id": "dup-2", "account_id": "cash", "type": "outflow",
        "amount": 50.0, "source": "partner", "date": "2026-10-25",
    })
    _run(server._reverse_partner_tx({
        **tx, "_id": "ptx-2", "amount": 50.0, "date": "2026-10-25",
    }))
    assert dedicated._live(db, dedicated.CO_A, "bank_transactions", "dup-1") is not None
    assert dedicated._live(db, dedicated.CO_A, "bank_transactions", "dup-2") is not None


def test_cheque_unwind_reverses_partner_leg(routed):
    db = routed
    dedicated._put(db, dedicated.CO_A, "partners", {
        "_id": "p1", "name": "Ortak", "balance": -500.0, "total_withdrawn": 500.0,
    })
    dedicated._put(db, dedicated.CO_A, "partner_transactions", {
        "_id": "leg-1", "partner_id": "p1", "partner_name": "Ortak",
        "type": "withdrawal", "amount": 500.0, "cheque_id": "ch-1",
        "date": "2026-10-24", "description": "Çek tahsil",
    })
    dedicated._put(db, dedicated.CO_B, "partner_transactions", {
        "_id": "leg-b", "partner_id": "p1", "type": "withdrawal",
        "amount": 500.0, "cheque_id": "ch-1", "date": "2026-10-24",
    })
    dedicated._put(db, dedicated.CO_B, "partners", {
        "_id": "p1", "name": "Ortak", "balance": -500.0, "total_withdrawn": 500.0,
    })
    _run(cheques._unwind_bank("ch-1", company_id=dedicated.CO_A))
    assert dedicated._live(db, dedicated.CO_A, "partner_transactions", "leg-1") is None
    assert dedicated._live(db, dedicated.CO_A, "partners", "p1")["balance"] == pytest.approx(0.0)
    assert dedicated._live(db, dedicated.CO_A, "partners", "p1")["total_withdrawn"] == pytest.approx(0.0)
    assert dedicated._live(db, dedicated.CO_B, "partner_transactions", "leg-b") is not None
    assert dedicated._live(db, dedicated.CO_B, "partners", "p1")["balance"] == pytest.approx(-500.0)


def test_contact_activity_counts_stay_in_company(routed):
    db = routed
    dedicated._put(db, dedicated.CO_A, "invoices", {"_id": "inv-a", "contact_id": "cari-x"})
    dedicated._put(db, dedicated.CO_B, "invoices", {"_id": "inv-b", "contact_id": "cari-x"})
    scoped = _run(contact_activity.contact_activity_counts(db, "cari-x", dedicated.CO_A))
    assert scoped.get("invoices") == 1
    other = _run(contact_activity.contact_activity_counts(db, "cari-x", dedicated.CO_B))
    assert other.get("invoices") == 1
