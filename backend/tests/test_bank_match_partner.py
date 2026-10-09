"""Banka eşleşmesi: Para nereden geldi / nereye gitti → Ortaklar Hesabı."""
import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from bank_match_target import (
    apply_partner_match,
    clear_bank_match_for_partner_tx,
    clear_bank_match_status,
    parse_match_target,
    partner_tx_type_for_bank_match,
    repair_legacy_bank_match_directions,
    resolve_bank_tx_id_for_partner_tx,
    reverse_partner_match,
    stored_match_target,
)
from partner_pay import ledger_totals, sync_partner_from_ledger


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_parse_and_store_partner_target():
    assert parse_match_target("partner:p1") == ("partner", "p1")
    assert parse_match_target("acc-9") == ("account", "acc-9")
    assert stored_match_target("partner", "p1") == "partner:p1"
    # Banka girişi → sermaye (Alacaklı ↑); banka çıkışı → çekiş (Alacaklı ↓)
    assert partner_tx_type_for_bank_match(True) == "capital_in"
    assert partner_tx_type_for_bank_match(False) == "withdrawal"


def test_apply_partner_match_inflow_is_capital_in():
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
    assert args[4] == "capital_in"
    assert kwargs["extra"]["related_bank_tx_id"] == "tx1"
    assert kwargs["extra"]["source"] == "bank_match"
    assert kwargs["extra"]["bank_tx_type"] == "inflow"


def test_apply_partner_match_outflow_is_withdrawal():
    """Ali Bal: bankadan ortağa ödeme Alacaklıyı düşürür (withdrawal)."""
    tx = {"_id": "tx2", "company_id": "comp", "account_name": "Vadesiz TL", "description": "Ali Bal"}
    with patch("bank_match_target.partner_pay.move", AsyncMock(return_value="Ali")) as move:
        _run(apply_partner_match(object(), tx, "p9", 80000, False))
    assert move.await_args.args[4] == "withdrawal"
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
        q = q or {}
        for d in self.docs:
            if all(d.get(k) == v for k, v in q.items()):
                return d
        return None

    async def update_one(self, q, upd):
        doc = await self.find_one(q)
        if not doc:
            return
        if "$set" in upd:
            doc.update(upd["$set"])
        for k in (upd.get("$unset") or {}):
            doc.pop(k, None)


def test_clear_bank_match_status_unmatches_without_touching_partner():
    """Ortak hareketi silinince banka satırı tekrar unmatched olur."""
    btxs = _FakeColl([
        {
            "_id": "btx1",
            "type": "outflow",
            "amount": 80000,
            "match_status": "matched",
            "target_account_id": "partner:ali",
            "target_account_name": "Ali BAL (Ortak)",
            "matched_via": "manual",
            "category": "Hesaplar Arası Virman",
        }
    ])
    db = MagicMock()
    db.bank_transactions = btxs
    ok = _run(clear_bank_match_status(db, "btx1"))
    assert ok is True
    assert btxs.docs[0]["match_status"] == "unmatched"
    assert "target_account_id" not in btxs.docs[0]
    assert btxs.docs[0]["category"] == "Banka Giden Ödeme"
    assert _run(clear_bank_match_status(db, "btx1")) is False  # zaten unmatched


def test_clear_bank_match_for_partner_tx_by_related_id():
    btxs = _FakeColl([
        {
            "_id": "btx-rel",
            "type": "outflow",
            "amount": 80000,
            "match_status": "matched",
            "target_account_id": "partner:ali",
            "category": "Hesaplar Arası Virman",
        }
    ])
    db = MagicMock()
    db.bank_transactions = btxs
    ptx = {"_id": "pt1", "partner_id": "ali", "amount": 80000, "related_bank_tx_id": "btx-rel", "source": "bank_match"}
    assert _run(resolve_bank_tx_id_for_partner_tx(db, ptx)) == "btx-rel"
    assert _run(clear_bank_match_for_partner_tx(db, ptx)) is True
    assert btxs.docs[0]["match_status"] == "unmatched"


def test_clear_bank_match_for_partner_tx_fallback_without_related_id():
    """related_bank_tx_id yoksa hedef ortak + tutar ile eşleşme bulunur."""
    btxs = _FakeColl([
        {
            "_id": "btx-fb",
            "type": "outflow",
            "amount": 5000.0,
            "date": "2026-03-01",
            "match_status": "matched",
            "target_account_id": "partner:p9",
            "category": "Hesaplar Arası Virman",
        }
    ])
    db = MagicMock()
    db.bank_transactions = btxs
    ptx = {"_id": "pt9", "partner_id": "p9", "amount": 5000.0, "date": "2026-03-01", "source": "bank_match"}
    assert _run(resolve_bank_tx_id_for_partner_tx(db, ptx)) == "btx-fb"
    assert _run(clear_bank_match_for_partner_tx(db, ptx)) is True
    assert btxs.docs[0]["match_status"] == "unmatched"
    assert "target_account_id" not in btxs.docs[0]


def test_repair_pr1089_bank_outflow_capital_in_to_withdrawal():
    """#1089 yanlışlığı: banka çıkışı capital_in → withdrawal (Alacaklı ↓)."""
    ptxs = _FakeColl([
        {
            "_id": "pt1",
            "partner_id": "ali",
            "type": "capital_in",
            "amount": 80000,
            "source": "bank_match",
            "bank_tx_type": "outflow",
            "related_bank_tx_id": "btx1",
            "description": "Vadesiz TL Hesabı: ALİ BAL",
            "legacy_bank_match_repaired_at": "2026-10-09T18:00:00+00:00",
        },
        {
            "_id": "pt2",
            "partner_id": "ali",
            "type": "withdrawal",
            "amount": 1000,
            "source": "bank_match",
            "bank_tx_type": "outflow",
        },
        {
            "_id": "pt3",
            "partner_id": "ali",
            "type": "withdrawal",
            "amount": 500,
            "source": "bank_match",
            "bank_tx_type": "inflow",
        },
    ])
    db = MagicMock()
    db.partner_transactions = ptxs
    db.bank_transactions = _FakeColl([])
    n = _run(repair_legacy_bank_match_directions(db, "ali"))
    assert n == 2  # pt1 capital_in→withdrawal, pt3 withdrawal→capital_in
    assert ptxs.docs[0]["type"] == "withdrawal"
    assert ptxs.docs[1]["type"] == "withdrawal"
    assert ptxs.docs[2]["type"] == "capital_in"
    assert "legacy_bank_match_outflow_credit_undone_at" in ptxs.docs[0]


def test_ali_bal_856059_minus_80000_equals_776059():
    """Masraf onarımı sonrası 856059.78 − banka 80k ödeme = 776059.78 Alacaklı."""
    # Baseline (#1086): capital_in 816859.78 + expense masraf 39200 = 856059.78
    # #1089 yanlış: 80k banka çıkışı capital_in → +80000 (şişik)
    # Doğru: 80k withdrawal → 856059.78 - 80000 = 776059.78
    txs = [
        {"type": "capital_in", "amount": 816859.78},
        {"type": "credit", "amount": 39200.0, "expense_id": "exp", "source": "expense"},
        {
            "type": "capital_in",  # #1089 yanlış tipi
            "amount": 80000.0,
            "source": "bank_match",
            "bank_tx_type": "outflow",
            "related_bank_tx_id": "btx-ali",
        },
    ]
    wrong = ledger_totals(txs)
    assert wrong["balance"] == 936059.78  # 856059.78 + 80000

    ptxs = _FakeColl([
        {"_id": "a", "partner_id": "5a7cba2b", **txs[0]},
        {"_id": "b", "partner_id": "5a7cba2b", **txs[1]},
        {"_id": "c", "partner_id": "5a7cba2b", **txs[2]},
    ])
    partners = _FakeColl([{
        "_id": "5a7cba2b",
        "company_id": "c1",
        "name": "Ali",
        "balance": 936059.78,
        "total_capital_in": 896859.78,
        "total_withdrawn": 0,
        "total_profit_share": 0,
    }])
    db = MagicMock()
    db.partners = partners
    db.partner_transactions = ptxs
    db.bank_transactions = _FakeColl([])

    meta = _run(sync_partner_from_ledger(db, "5a7cba2b"))
    assert meta["bank_match_rows_repaired"] == 1
    assert ptxs.docs[2]["type"] == "withdrawal"
    assert meta["balance"] == 776059.78
    assert round(856059.78 - 80000.0, 2) == 776059.78
    assert partners.docs[0]["balance"] == 776059.78
