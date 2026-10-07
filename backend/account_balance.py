"""Kasa / banka bakiyesini hareketlerden hesaplar (açılış + kayma onarımı)."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional


def _num(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def tx_signed_amount(tx: dict, account_id: str) -> float:
    """Hesaba etki: giriş +, çıkış −. Ledger satırları kasa bakiyesine yazılmaz."""
    if not isinstance(tx, dict):
        return 0.0
    if tx.get("source") == "ledger":
        return 0.0
    aid = str(account_id or "")
    amt = _num(tx.get("amount"))
    kind = str(tx.get("type") or "")
    if kind == "transfer":
        if str(tx.get("account_id") or "") == aid:
            return -amt
        if str(tx.get("target_account_id") or "") == aid:
            return amt
        return 0.0
    if str(tx.get("account_id") or "") != aid:
        return 0.0
    if kind == "inflow":
        return amt
    if kind == "outflow":
        return -amt
    return 0.0


def movement_balance(txs: Iterable[dict], account_id: str) -> float:
    return round(sum(tx_signed_amount(t, account_id) for t in txs or []), 2)


async def fetch_account_txs(db, account_id: str) -> List[dict]:
    return await db.bank_transactions.find(
        {"$or": [{"account_id": account_id}, {"target_account_id": account_id}]},
    ).to_list(20000)


async def recalc_account_balance(db, account_id: str) -> float:
    txs = await fetch_account_txs(db, account_id)
    return movement_balance(txs, account_id)


def opening_tx_doc(acc: dict, amount: float) -> Optional[Dict[str, Any]]:
    amt = round(_num(amount), 2)
    if abs(amt) < 0.009:
        return None
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return {
        "_id": str(uuid.uuid4()),
        "company_id": acc.get("company_id"),
        "account_id": acc.get("_id") or acc.get("id"),
        "account_name": acc.get("account_name") or acc.get("bank_name"),
        "type": "inflow" if amt > 0 else "outflow",
        "category": "Açılış bakiyesi",
        "amount": abs(amt),
        "currency": acc.get("currency") or "TRY",
        "description": "Hesap açılış bakiyesi",
        "source": "opening",
        "date": today,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


async def ensure_opening_tx(db, acc: dict) -> Optional[dict]:
    """Yeni hesapta current_balance varsa deftere açılış hareketi yaz (bakiye zaten set)."""
    doc = opening_tx_doc(acc, acc.get("current_balance"))
    if not doc:
        return None
    await db.bank_transactions.insert_one(doc)
    return doc


async def sync_cash_box_balances(db, accounts: List[dict]) -> List[dict]:
    """Kasa kartı bakiyesi = hareket toplamı. Hareket yoksa 0 (sahte açılış silinir)."""
    for acc in accounts or []:
        if str(acc.get("type") or "") != "cash_box":
            continue
        aid = acc.get("_id") or acc.get("id")
        if not aid:
            continue
        moved = await recalc_account_balance(db, aid)
        stored = round(_num(acc.get("current_balance")), 2)
        if abs(moved - stored) >= 0.01:
            await db.bank_accounts.update_one({"_id": aid}, {"$set": {"current_balance": moved}})
            acc["current_balance"] = moved
    return accounts
