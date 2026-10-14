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


def _is_pool_account(account: Optional[dict]) -> bool:
    return bool(account and account.get("type") == "credit_card" and account.get("is_customer_card_pool"))


def card_statement_signed_amount(tx: dict) -> Optional[float]:
    """Kredi kartı ekstre satırı (source=card_statement) bakiye kuralı.

    Ekstre satırı hesaba $inc yazılmaz; görünen borç ekstre kapanışıdır
    (current_balance = −total_debt). Bu satırlar hareket toplamına girmez (0).
    Banka ekstresi (bank_statement) bu kurala girmez; normal giriş/çıkış sayılır.
    Fark salt-okuma mutabakat raporunda görünür, otomatik düzeltilmez.
    """
    if not isinstance(tx, dict):
        return None
    if str(tx.get("source") or "") != "card_statement":
        return None
    return 0.0


def skips_account_balance(tx: dict, account: Optional[dict] = None, account_id: str = "") -> bool:
    """Hesap $inc yazılmayan satır. tx_signed_amount ve _reverse_tx_effects aynı kapıyı kullanır."""
    if not isinstance(tx, dict):
        return True
    if _is_pool_account(account):
        return True
    status = str(tx.get("status") or "").lower()
    if status in ("cancelled", "canceled", "void"):
        return True
    source = str(tx.get("source") or "")
    if source in ("ledger", "marketplace_settlement_expected", "card_statement"):
        return True
    if tx.get("balance_posted") is False:
        return True
    aid = str(account_id or "")
    if tx.get("customer_card_pool_ledger") and (
        str(tx.get("account_id") or "") == aid or str(tx.get("customer_card_account_id") or "") == aid
    ):
        return True
    if (
        tx.get("via_customer_card")
        and tx.get("account_id")
        and str(tx.get("account_id")) == str(tx.get("customer_card_account_id") or "")
        and str(tx.get("account_id")) == aid
    ):
        return True
    return False


def tx_signed_amount(tx: dict, account_id: str, account: Optional[dict] = None) -> float:
    """Hesaba etki: giriş +, çıkış −.

    `_reverse_tx_effects` (sign=+1) ile aynı hesap: source==ledger,
    customer_card_pool_ledger, via_customer_card + customer_card_account_id
    ve müşteri kart havuzu → 0. Transfer kaynak − / hedef +.
    İptal (status=cancelled) ve bakiyeye yazılmayan pazaryeri beklenen-eşleşme
    satırı da 0'dır. Kredi kartı ekstre satırı (card_statement) 0'dır.
    POS iptali karşı outflow (source=pos_cancel) normal çıkıştır.
    """
    if skips_account_balance(tx, account, account_id):
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


def movement_balance(txs: Iterable[dict], account_id: str, account: Optional[dict] = None) -> float:
    if _is_pool_account(account):
        return 0.0
    return round(sum(tx_signed_amount(t, account_id, account) for t in txs or []), 2)


def annotate_bank_tx(tx: dict, account_id: Optional[str] = None, account: Optional[dict] = None) -> dict:
    """Liste satırına bakiyenin bu hesaptaki işaretini ekler."""
    row = dict(tx or {})
    aid = str(account_id or row.get("account_id") or "")
    delta = tx_signed_amount(row, aid, account)
    row["balance_delta"] = delta
    if delta > 0:
        row["side"] = "in"
    elif delta < 0:
        row["side"] = "out"
    else:
        row["side"] = "zero"
    return row


def pos_cancel_outflow_doc(tx: dict, *, now_iso: str, today: str) -> Optional[Dict[str, Any]]:
    """POS satış inflow'unun karşı çıkışı. Orijinal kalır; kasa senkronu iptali geri almaz."""
    if not isinstance(tx, dict):
        return None
    if str(tx.get("type") or "") != "inflow":
        return None
    if not tx.get("account_id") or not tx.get("_id"):
        return None
    amt = round(abs(_num(tx.get("amount"))), 2)
    if amt < 0.009:
        return None
    return {
        "_id": str(uuid.uuid4()),
        "company_id": tx.get("company_id"),
        "account_id": tx.get("account_id"),
        "account_name": tx.get("account_name"),
        "type": "outflow",
        "category": "POS satış iptali",
        "amount": amt,
        "currency": tx.get("currency") or "TRY",
        "description": f"POS satış iptali: {tx.get('description') or ''}".strip(),
        "source": "pos_cancel",
        "related_bank_tx_id": tx.get("_id"),
        "invoice_id": tx.get("invoice_id"),
        "date": today,
        "created_at": now_iso,
    }


async def account_is_integrated(db, account_id: str) -> bool:
    """Bağlantı kaydı gerçek bir dict ise entegre. Eksik koleksiyon / sahte mock → değil."""
    if not account_id or db is None:
        return False
    try:
        import bank_guard
        conn = await bank_guard.get_connection_for_account(db, account_id)
    except Exception:
        return False
    return isinstance(conn, dict) and bool(conn.get("linked_account_id") or conn.get("_id"))


async def apply_balance_delta(db, account_id: str, delta: float) -> str:
    """Entegre hesapta bakiye yazılmaz ('integrated'). Diğerlerinde $inc ('posted')."""
    if not account_id or abs(_num(delta)) < 0.0000001:
        return "skipped"
    if await account_is_integrated(db, account_id):
        return "integrated"
    await db.bank_accounts.update_one({"_id": account_id}, {"$inc": {"current_balance": float(delta)}})
    return "posted"


async def fetch_account_txs(db, account_id: str) -> List[dict]:
    return await db.bank_transactions.find(
        {"$or": [{"account_id": account_id}, {"target_account_id": account_id}]},
    ).to_list(20000)


async def recalc_account_balance(db, account_id: str) -> float:
    acc = None
    try:
        acc = await db.bank_accounts.find_one({"_id": account_id})
    except Exception:
        acc = None
    if _is_pool_account(acc):
        return 0.0
    txs = await fetch_account_txs(db, account_id)
    return movement_balance(txs, account_id, acc)


async def annotate_listed_accounts(db, company_id: str, accounts: List[dict]) -> List[dict]:
    """Liste ucunda bakiye = recalc kontrolü. Kasa dışı hesaplarda yazma yok."""
    try:
        txs = await db.bank_transactions.find({"company_id": company_id}).to_list(50000)
    except Exception:
        return accounts
    grouped: Dict[str, List[dict]] = {}
    for tx in txs or []:
        for key in ("account_id", "target_account_id"):
            aid = tx.get(key)
            if aid:
                grouped.setdefault(str(aid), []).append(tx)
    for acc in accounts or []:
        aid = str(acc.get("id") or acc.get("_id") or "")
        if not aid:
            continue
        moved = movement_balance(grouped.get(aid, []), aid, acc)
        shown = round(_num(acc.get("current_balance")), 2)
        acc["ledger_balance"] = moved
        acc["balance_drift"] = (not _is_pool_account(acc)) and abs(shown - moved) >= 0.01
        reported = acc.get("bank_reported_balance")
        if reported is None:
            acc["bank_balance_drift"] = False
        else:
            acc["bank_balance_drift"] = abs(round(_num(reported), 2) - moved) >= 0.01
    return accounts


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
