"""Banka eşleşmesi: Para nereden geldi / nereye gitti → Ortaklar Hesabı."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from bank_match_target import (
    apply_partner_match,
    parse_match_target,
    partner_tx_type_for_bank_match,
    repair_legacy_bank_match_directions,
    reverse_partner_match,
    stored_match_target,
)


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_parse_and_store_partner_target():
    assert parse_match_target("partner:p1") == ("partner", "p1")
    assert parse_match_target("acc-9") == ("account", "acc-9")
    assert stored_match_target("partner", "p1") == "partner:p1"
    # Banka çıkışı → ortak cebine Giriş; banka girişi → ortak Çıkış
    assert partner_tx_type_for_bank_match(True) == "withdrawal"
    assert partner_tx_type_for_bank_match(False) == "capital_in"


def test_apply_partner_match_inflow_is_withdrawal():
    tx = {
        "_id": "tx1",
        "company_id": "comp",
        "account_name": "Vakıf Bank",
        "description": "ortak sermaye",
        "date": "2026-09-21",
    }
    with patch("bank_match_target.partner_pay.move", AsyncMock(return_value="Mustafa")) as move:
        name = _run(apply_partner_match(object(), tx, "p1", 250, True))
    assert name == "Mustafa"
    args, kwargs = move.await_args
    assert args[2] == "p1"
    assert args[3] == 250.0
    assert args[4] == "withdrawal"
    assert kwargs["extra"]["related_bank_tx_id"] == "tx1"
    assert kwargs["extra"]["source"] == "bank_match"
    assert kwargs["extra"]["bank_tx_type"] == "inflow"


def test_apply_partner_match_outflow_is_capital_in():
    tx = {"_id": "tx2", "company_id": "comp", "account_name": "Vadesiz TL", "description": "Ali Bal"}
    with patch("bank_match_target.partner_pay.move", AsyncMock(return_value="Ali")) as move:
        _run(apply_partner_match(object(), tx, "p9", 80, False))
    assert move.await_args.args[4] == "capital_in"
    assert move.await_args.kwargs["extra"]["bank_tx_type"] == "outflow"


def test_reverse_partner_match_looks_up_bank_tx():
    with patch("bank_match_target.partner_pay.reverse_one", AsyncMock(side_effect=[False, True])) as rev:
        ok = _run(reverse_partner_match(object(), {"_id": "tx3"}))
    assert ok is True
    assert rev.await_args_list[0].args[1] == {"related_bank_tx_id": "tx3", "source": "bank_match"}
    assert rev.await_args_list[1].args[1] == {"related_bank_tx_id": "tx3"}


class _FakeCursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, n):
        return list(self.rows[:n])


class _FakeColl:
    def __init__(self, docs):
        self.docs = docs

    def find(self, q=None):
        # Test: sorguyu yok say, tüm dokümanları döndür (repair Python'da tip filtreler)
        rows = self.docs
        if isinstance(q, dict) and "partner_id" in q:
            rows = [d for d in rows if d.get("partner_id") == q["partner_id"]]
        elif isinstance(q, dict) and "$and" in q:
            pid = next((c.get("partner_id") for c in q["$and"] if isinstance(c, dict) and "partner_id" in c), None)
            if pid:
                rows = [d for d in rows if d.get("partner_id") == pid]
        return _FakeCursor(rows)

    async def find_one(self, q):
        _id = (q or {}).get("_id")
        return next((d for d in self.docs if d.get("_id") == _id), None)

    async def update_one(self, q, upd):
        doc = next((d for d in self.docs if d.get("_id") == (q or {}).get("_id")), None)
        if doc and "$set" in upd:
            doc.update(upd["$set"])


def test_repair_legacy_bank_outflow_withdrawal_to_capital_in():
    """Ali Bal: banka çıkışı eski tip withdrawal → capital_in (ortak Giriş)."""
    ptxs = _FakeColl([
        {
            "_id": "pt1",
            "partner_id": "ali",
            "type": "withdrawal",
            "amount": 80000,
            "source": "bank_match",
            "bank_tx_type": "outflow",
            "related_bank_tx_id": "btx1",
            "description": "Vadesiz TL Hesabı: ALİ BAL",
        },
        {
            "_id": "pt2",
            "partner_id": "ali",
            "type": "capital_in",
            "amount": 1000,
            "source": "bank_match",
            "bank_tx_type": "outflow",
        },
    ])
    db = MagicMock()
    db.partner_transactions = ptxs
    db.bank_transactions = _FakeColl([])
    n = _run(repair_legacy_bank_match_directions(db, "ali"))
    assert n == 1
    assert ptxs.docs[0]["type"] == "capital_in"
    assert ptxs.docs[1]["type"] == "capital_in"
    assert "legacy_bank_match_repaired_at" in ptxs.docs[0]
