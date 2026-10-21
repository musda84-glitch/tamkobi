"""POS bloke çözümü (mode=pos_settlement).

Bellek içi koleksiyon. Canlı veritabanı, port ve ağ yok.
Modül seviyesinde ortam değişkeni yazılmaz.
"""
from __future__ import annotations

import asyncio
import copy
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "tests"))

import expenses  # noqa: E402
import server  # noqa: E402
import tenant_scope  # noqa: E402
from dashboard_memdb import MemColl, MemDB, _split_field_ops  # noqa: E402
from mysql_store import apply_update, match_query, new_upsert_doc  # noqa: E402

CO = "co_a"
CO_B = "co_b"
NET = 47168.38
GROSS = 49000.0
COMM = 1831.62
DESC = "SANAL POS BLOKE YATIRIM"


def _run(coro):
    return asyncio.run(coro)


class _Coll(MemColl):
    """MemColl.update_one upsert yazmaz; kural ve MSR sayacı burada yazılır."""

    async def update_one(self, query, update, upsert=False):
        tenant_scope.check(self.name, "update_one", query=query, update=update, upsert=upsert)
        query = _split_field_ops(query or {})
        for i, doc in enumerate(self.docs):
            if not match_query(doc, query):
                continue
            self.docs[i] = apply_update(doc, update, query)
            return SimpleNamespace(modified_count=1, matched_count=1)
        if not upsert:
            return SimpleNamespace(modified_count=0, matched_count=0)
        created = new_upsert_doc(update, query)
        self.docs.append(copy.deepcopy(created))
        return SimpleNamespace(modified_count=0, matched_count=0, upserted_id=created.get("_id"))

    async def delete_one(self, query):
        tenant_scope.check(self.name, "delete_one", query=query)
        query = _split_field_ops(query or {})
        for i, doc in enumerate(self.docs):
            if match_query(doc, query):
                del self.docs[i]
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


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
    monkeypatch.setattr(server, "db", database)
    monkeypatch.setattr(expenses, "_db", database)
    return database


def _user(cid=CO):
    return {"id": f"u-{cid}", "company_ids": [cid], "active_company_id": cid}


def _put(db, name, doc):
    _run(getattr(db, name).insert_one(doc))


def _account(db, *, _id, cid, type_, balance, name):
    _put(db, "bank_accounts", {
        "_id": _id,
        "company_id": cid,
        "type": type_,
        "account_name": name,
        "current_balance": balance,
    })


def _tx(**over):
    doc = {
        "_id": "tx1",
        "company_id": CO,
        "account_id": "bank1",
        "account_name": "Vadesiz",
        "type": "inflow",
        "amount": NET,
        "description": DESC,
        "date": "2026-10-11",
        "currency": "TRY",
        "match_status": "unmatched",
        "source": "bank_sync",
    }
    doc.update(over)
    return doc


def _seed(db, *, pos_balance=GROSS, pos_type="pos", tx=None):
    _account(db, _id="bank1", cid=CO, type_="bank", balance=250000.0, name="Vadesiz")
    _account(db, _id="pos1", cid=CO, type_=pos_type, balance=pos_balance, name="Sanal POS")
    row = tx or _tx()
    _put(db, "bank_transactions", row)
    return row


def _snap(db):
    return {
        "accounts": copy.deepcopy(db.bank_accounts.docs),
        "txs": copy.deepcopy(db.bank_transactions.docs),
        "expenses": copy.deepcopy(db.expenses.docs),
    }


def _match(tx, **kw):
    return server._apply_match(
        tx,
        kw.get("contact_id"),
        kw.get("invoice_id"),
        kw.get("category", "POS Komisyonu"),
        learn=kw.get("learn", False),
        target_account_id=kw.get("target_account_id", "pos1"),
        as_expense=kw.get("as_expense", False),
        link_existing_id=kw.get("link_existing_id"),
        mode="pos_settlement",
        pos_gross=kw.get("pos_gross", GROSS),
        pos_commission=kw.get("pos_commission", COMM),
    )


def _balance(db, account_id, cid):
    row = _run(db.bank_accounts.find_one({"_id": account_id, "company_id": cid}))
    return None if row is None else row.get("current_balance")


def test_happy_path_releases_gross_and_records_one_commission(db):
    tx = _seed(db)
    out = _run(_match(tx))

    assert _balance(db, "pos1", CO) == pytest.approx(0)
    assert _balance(db, "bank1", CO) == pytest.approx(250000.0)
    assert out["match_status"] == "matched"
    assert out["match_kind"] == "pos_settlement"
    assert out["matched_via"] == "manual"
    assert out["target_account_id"] == "pos1"
    assert out["target_account_name"] == "Sanal POS"
    assert out["pos_gross"] == pytest.approx(GROSS)
    assert out["pos_commission"] == pytest.approx(COMM)
    assert out["category"] == "POS Komisyonu"
    assert out["expense_id"]

    expenses_rows = [row for row in db.expenses.docs if row.get("company_id") == CO]
    assert len(expenses_rows) == 1
    exp = expenses_rows[0]
    assert exp["_id"] == out["expense_id"]
    assert exp["account_id"] == "pos1"
    assert exp["bank_transaction_id"] == "tx1"
    assert exp.get("bank_tx_id") in (None, "tx1")
    assert exp["category"] == "POS Komisyonu"
    assert exp["total"] == pytest.approx(COMM)
    assert exp["source"] == "bank_match"
    assert exp["company_id"] == CO

    counters = [row for row in db.bank_transactions.docs if row.get("source") == "bank_match"]
    assert len(counters) == 1
    assert counters[0]["related_bank_tx_id"] == "tx1"
    assert counters[0]["company_id"] == CO
    assert counters[0]["account_id"] == "pos1"
    assert counters[0]["type"] == "outflow"
    assert counters[0]["amount"] == pytest.approx(GROSS)


def test_partial_release_leaves_remainder_on_pos(db):
    tx = _seed(db, pos_balance=60000.0, pos_type="okc_pos")
    _run(_match(tx))
    assert _balance(db, "pos1", CO) == pytest.approx(11000.0)
    assert _balance(db, "bank1", CO) == pytest.approx(250000.0)


def test_unmatch_restores_pos_and_second_unmatch_is_400(db):
    tx = _seed(db)
    _run(_match(tx))
    stored = _run(db.bank_transactions.find_one({"_id": "tx1", "company_id": CO}))
    out = _run(server._unmatch(stored))

    assert out["match_status"] == "unmatched"
    assert "match_kind" not in out
    assert "pos_gross" not in out
    assert "pos_commission" not in out
    assert "expense_id" not in out
    assert _balance(db, "pos1", CO) == pytest.approx(GROSS)
    assert not [row for row in db.expenses.docs if row.get("company_id") == CO]
    assert not [row for row in db.bank_transactions.docs if row.get("source") == "bank_match" and row.get("company_id") == CO]

    with pytest.raises(HTTPException) as ei:
        _run(server.unmatch_bank_transaction("tx1", _user()))
    assert ei.value.status_code == 400
    assert _balance(db, "pos1", CO) == pytest.approx(GROSS)


def test_validation_rejects_without_writes(db):
    tx = _seed(db, pos_balance=100.0)
    _account(db, _id="bank2", cid=CO, type_="bank", balance=10.0, name="İkinci Vadesiz")
    outflow = _tx(_id="tx-out", type="outflow", amount=NET)
    _put(db, "bank_transactions", outflow)
    before = _snap(db)
    with pytest.raises(HTTPException) as ei:
        _run(_match(outflow))
    assert ei.value.status_code == 400
    assert "yalnızca giriş" in ei.value.detail
    assert _snap(db) == before

    with pytest.raises(HTTPException) as ei:
        _run(_match(tx, pos_gross=100, pos_commission=0))
    assert ei.value.status_code == 400
    assert "küçük olamaz" in ei.value.detail
    assert _snap(db) == before

    with pytest.raises(HTTPException) as ei:
        _run(_match(tx, pos_gross=GROSS, pos_commission=-1))
    assert ei.value.status_code == 400
    assert "Komisyon negatif olamaz." in ei.value.detail
    assert _snap(db) == before

    over_commission = round(GROSS - NET, 2)
    with pytest.raises(HTTPException) as ei:
        _run(_match(tx, pos_gross=GROSS, pos_commission=over_commission))
    assert ei.value.status_code == 400
    assert "POS bakiyesini aşıyor" in ei.value.detail
    assert _snap(db) == before
    assert _balance(db, "pos1", CO) == pytest.approx(100.0)

    with pytest.raises(HTTPException) as ei:
        _run(_match(tx, target_account_id="bank2", pos_gross=GROSS, pos_commission=COMM))
    assert ei.value.status_code == 400
    assert "yalnızca POS" in ei.value.detail
    assert _snap(db) == before

    with pytest.raises(HTTPException) as ei:
        _run(_match(tx, target_account_id="missing-pos"))
    assert ei.value.status_code == 404
    assert ei.value.detail == "POS hesabı bulunamadı."
    assert _snap(db) == before

    with pytest.raises(HTTPException) as ei:
        _run(_match(tx, contact_id="cnt-1"))
    assert ei.value.status_code == 400
    assert "birlikte seçilemez" in ei.value.detail
    assert _snap(db) == before


def test_empty_company_id_fails_closed(db):
    tx = _tx(company_id="")
    _put(db, "bank_transactions", tx)
    _account(db, _id="pos1", cid=CO, type_="pos", balance=GROSS, name="Sanal POS")
    before = _snap(db)
    with pytest.raises(HTTPException) as ei:
        _run(_match(tx))
    assert ei.value.status_code == 400
    assert _snap(db) == before
    assert db.expenses.docs == []


def test_cross_company_pos_is_invisible_and_unmatch_is_isolated(db):
    _account(db, _id="bank1", cid=CO, type_="bank", balance=250000.0, name="Vadesiz")
    _account(db, _id="pos-b", cid=CO_B, type_="pos", balance=GROSS, name="POS B")
    _account(db, _id="pos-shared", cid=CO, type_="pos", balance=GROSS, name="Sanal POS")
    _account(db, _id="pos-shared", cid=CO_B, type_="pos", balance=GROSS, name="Sanal POS B")
    _put(db, "expenses", {
        "_id": "exp-b",
        "company_id": CO_B,
        "account_id": "pos-b",
        "total": 10,
        "category": "POS Komisyonu",
    })
    tx = _tx(_id="tx-cross")
    _put(db, "bank_transactions", tx)
    _put(db, "bank_transactions", {
        "_id": "counter-b",
        "company_id": CO_B,
        "account_id": "pos-b",
        "type": "outflow",
        "amount": 5,
        "source": "bank_match",
        "related_bank_tx_id": "tx-cross",
        "description": "CO_B karşı hareket",
    })

    with pytest.raises(HTTPException) as ei:
        _run(_match(tx, target_account_id="pos-b"))
    assert ei.value.status_code == 404
    assert ei.value.detail == "POS hesabı bulunamadı."
    assert _balance(db, "pos-b", CO_B) == pytest.approx(GROSS)
    assert _balance(db, "pos-shared", CO_B) == pytest.approx(GROSS)
    assert any(row.get("_id") == "exp-b" and row.get("company_id") == CO_B for row in db.expenses.docs)

    out = _run(_match(tx, target_account_id="pos-shared"))
    assert out["match_kind"] == "pos_settlement"
    assert _balance(db, "pos-shared", CO) == pytest.approx(0)
    assert _balance(db, "pos-shared", CO_B) == pytest.approx(GROSS)
    assert _balance(db, "pos-b", CO_B) == pytest.approx(GROSS)

    exp_id = out["expense_id"]
    db.expenses.docs.insert(0, {
        "_id": exp_id,
        "company_id": CO_B,
        "account_id": "pos-b",
        "total": 99,
        "bank_transaction_id": "tx-cross",
        "source": "bank_match",
    })
    stored = _run(db.bank_transactions.find_one({"_id": "tx-cross", "company_id": CO}))
    _run(server._unmatch(stored))

    assert _balance(db, "pos-shared", CO) == pytest.approx(GROSS)
    assert _balance(db, "pos-shared", CO_B) == pytest.approx(GROSS)
    assert _balance(db, "pos-b", CO_B) == pytest.approx(GROSS)
    assert any(row.get("_id") == "counter-b" and row.get("company_id") == CO_B for row in db.bank_transactions.docs)
    assert any(row.get("_id") == exp_id and row.get("company_id") == CO_B for row in db.expenses.docs)
    assert any(row.get("_id") == "exp-b" and row.get("company_id") == CO_B for row in db.expenses.docs)
    assert not any(
        row.get("company_id") == CO and row.get("source") == "bank_match"
        for row in db.bank_transactions.docs
    )


def test_learn_suggests_rate_but_auto_match_skips_and_virman_clears_it(db):
    tx = _seed(db)
    _run(_match(tx, learn=True))
    rule = _run(db.bank_match_rules.find_one({"company_id": CO}))
    assert rule["match_kind"] == "pos_settlement"
    assert rule["pos_commission_rate"] == pytest.approx(round(COMM / GROSS, 6))
    assert rule["target_account_id"] == "pos1"
    assert rule["company_id"] == CO

    nxt = _tx(_id="tx2")
    _put(db, "bank_transactions", nxt)
    rows = _run(server.list_unmatched_transactions(CO, _user()))
    suggested = next(row for row in rows if row.get("id") == "tx2")
    assert suggested["suggested_match_kind"] == "pos_settlement"
    assert suggested["suggested_pos_commission_rate"] == pytest.approx(round(COMM / GROSS, 6))
    assert suggested["suggested_pos_gross"] == pytest.approx(GROSS)

    before = _balance(db, "pos1", CO)
    loaded = _run(db.bank_transactions.find_one({"_id": "tx2", "company_id": CO}))
    _run(server._auto_process_bank_txs(CO, [loaded]))
    again = _run(db.bank_transactions.find_one({"_id": "tx2", "company_id": CO}))
    assert again["match_status"] == "unmatched"
    assert "match_kind" not in again
    assert _balance(db, "pos1", CO) == pytest.approx(before)

    _account(db, _id="kasa1", cid=CO, type_="cash", balance=0, name="Kasa")
    virman = _tx(_id="tx3", amount=100.0)
    _put(db, "bank_transactions", virman)
    _run(server._apply_match(
        virman, None, None, "Hesaplar Arası Virman",
        learn=True, target_account_id="kasa1",
    ))
    cleared = _run(db.bank_match_rules.find_one({"company_id": CO, "pattern": rule["pattern"]}))
    assert "match_kind" not in cleared
    assert "pos_commission_rate" not in cleared
    assert cleared.get("target_account_id") == "kasa1"


def test_expense_failure_rolls_back_pos_balance_and_counter(db, monkeypatch):
    tx = _seed(db)

    async def _boom(*_args, **_kwargs):
        raise RuntimeError("masraf yazılamadı")

    monkeypatch.setattr(expenses, "record_card_spend", _boom)
    with pytest.raises(RuntimeError):
        _run(_match(tx))
    assert _balance(db, "pos1", CO) == pytest.approx(GROSS)
    assert _balance(db, "bank1", CO) == pytest.approx(250000.0)
    assert not [row for row in db.bank_transactions.docs if row.get("source") == "bank_match"]
    assert db.expenses.docs == []
    stored = _run(db.bank_transactions.find_one({"_id": "tx1", "company_id": CO}))
    assert stored["match_status"] == "unmatched"
    assert "match_kind" not in stored
