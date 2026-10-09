"""Şirket masrafını ortak öder → ortak alacaklı (credit), para çekişi değil."""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from partner_pay import (  # noqa: E402
    balance_inc,
    is_legacy_expense_withdrawal,
    sync_partner_from_ledger,
    tx_display_label,
)


class FakeCollection:
    def __init__(self):
        self.docs = []

    def _match(self, d, q):
        return all(d.get(k) == v for k, v in (q or {}).items() if not isinstance(v, dict))

    async def find_one(self, q=None, projection=None):
        return next((d for d in self.docs if self._match(d, q)), None)

    def find(self, q=None, projection=None):
        rows = [d for d in self.docs if self._match(d, q)]
        return FakeCursor(rows)

    async def update_one(self, q, update):
        d = await self.find_one(q)
        if not d:
            return
        for k, v in (update.get("$inc") or {}).items():
            d[k] = float(d.get(k) or 0) + float(v)
        d.update(update.get("$set") or {})


class FakeCursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, n):
        return list(self.rows[:n])


class FakeDb:
    def __init__(self):
        self.partners = FakeCollection()
        self.partner_transactions = FakeCollection()


def test_expense_credit_increases_partner_claim():
    assert balance_inc("credit", 4000) == {"balance": 4000}
    assert balance_inc("withdrawal", 4000) == {"balance": -4000, "total_withdrawn": 4000}


def test_expense_credit_display_label():
    label = tx_display_label({"type": "credit", "expense_id": "e1", "source": "expense", "amount": 4000})
    assert "Masraf" in label
    assert "Para Çekişi" not in label


def test_legacy_expense_withdrawal_detected():
    assert is_legacy_expense_withdrawal({"type": "withdrawal", "expense_id": "e1"})
    assert is_legacy_expense_withdrawal({"type": "withdrawal", "source": "expense"})
    assert not is_legacy_expense_withdrawal({"type": "withdrawal", "description": "Para çek"})
    assert not is_legacy_expense_withdrawal({"type": "credit", "expense_id": "e1"})


def test_sync_repairs_legacy_expense_withdrawal_balance():
    """withdrawal masraf → credit: bakiyeye +2× tutar (39.200 → +78.400 → 856.059,78)."""
    db = FakeDb()
    db.partners.docs.append({
        "_id": "p1",
        "company_id": "c1",
        "name": "Ortak",
        "balance": 777659.78,
        "total_capital_in": 816059.78,
        "total_withdrawn": 39200.0,
        "total_profit_share": 0,
    })
    db.partner_transactions.docs.extend([
        {"_id": "t1", "partner_id": "p1", "type": "capital_in", "amount": 816059.78},
        {
            "_id": "t2",
            "partner_id": "p1",
            "type": "withdrawal",
            "amount": 39200.0,
            "expense_id": "exp-1",
            "source": "expense",
        },
        # Gerçek para çekişi — dokunulmaz
        {"_id": "t3", "partner_id": "p1", "type": "withdrawal", "amount": 5000.0, "description": "Nakit çekim"},
    ])
    # Yanlış ledger: 816059.78 - 39200 - 5000 = 771859.78
    # Onarım sonrası: 816059.78 + 39200 - 5000 = 850259.78 (+78.400)
    meta = asyncio.run(sync_partner_from_ledger(db, "p1"))
    assert meta["expense_rows_repaired"] == 1
    assert db.partner_transactions.docs[1]["type"] == "credit"
    assert db.partner_transactions.docs[2]["type"] == "withdrawal"
    assert meta["balance"] == 850259.78
    assert round(meta["balance"] - 771859.78, 2) == 78400.0
    assert db.partners.docs[0]["balance"] == 850259.78
    assert meta["total_withdrawn"] == 5000.0


def test_sync_repairs_user_reported_gap():
    """Kart −777.659,78 → −856.059,78 (saklanan +78.400 alacak)."""
    db = FakeDb()
    db.partners.docs.append({
        "_id": "5a7cba2b",
        "company_id": "c1",
        "name": "Ortak",
        "balance": 777659.78,
        "total_capital_in": 0,
        "total_withdrawn": 39200.0,
        "total_profit_share": 0,
    })
    db.partner_transactions.docs.extend([
        {"_id": "a", "partner_id": "5a7cba2b", "type": "capital_in", "amount": 816859.78},
        {
            "_id": "b",
            "partner_id": "5a7cba2b",
            "type": "withdrawal",
            "amount": 39200.0,
            "expense_id": "exp-masraf",
            "source": "expense",
        },
    ])
    meta = asyncio.run(sync_partner_from_ledger(db, "5a7cba2b"))
    assert meta["expense_rows_repaired"] == 1
    # Yanlış: 816859.78 - 39200 = 777659.78 → kart −777.659,78
    # Doğru:  816859.78 + 39200 = 856059.78 → kart −856.059,78
    assert meta["balance"] == 856059.78
    assert meta["previous"]["balance"] == 777659.78
    assert round(meta["balance"] - meta["previous"]["balance"], 2) == 78400.0
