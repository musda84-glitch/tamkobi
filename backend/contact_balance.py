"""Cari bakiyesini fatura + kasa/çek/fiş hareketlerinden hesaplar (kayma onarımı)."""
from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Tuple


def _num(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _is_dispatch(inv: dict) -> bool:
    return bool(inv) and (inv.get("invoice_type") == "dispatch" or inv.get("e_type") == "e_dispatch")


def invoice_balance_delta(inv: dict) -> float:
    """Onaylı fatura cari etkisi. İrsaliye / taslak / iptal → 0."""
    if not isinstance(inv, dict) or _is_dispatch(inv):
        return 0.0
    status = inv.get("status")
    if status in ("draft", "cancelled", "canceled", "void", "rejected"):
        return 0.0
    applied = bool(inv.get("effects_applied")) or status in ("approved", "sent_to_gib", "paid")
    if not applied:
        return 0.0
    total = _num(inv.get("local_total") if inv.get("local_total") is not None else inv.get("grand_total"))
    return total if inv.get("invoice_type") == "sales" else -total


def bank_tx_balance_delta(tx: dict) -> float:
    """Kasa/banka / çek portföy / borç fişi satırının cari etkisi.

    Masraf (source=expense) oluştururken cariye yazılmaz; burada da yok sayılır.
    """
    if not isinstance(tx, dict) or not tx.get("contact_id"):
        return 0.0
    if tx.get("type") == "transfer":
        return 0.0
    if tx.get("source") == "expense":
        return 0.0
    amt = _num(tx.get("amount"))
    return -amt if tx.get("type") == "inflow" else amt


def partner_tx_balance_delta(tx: dict) -> float:
    if not isinstance(tx, dict) or not tx.get("contact_id"):
        return 0.0
    amt = _num(tx.get("amount"))
    t = tx.get("type")
    if t == "withdrawal":
        return -amt
    if t == "capital_in":
        return amt
    return 0.0


def compute_contact_balance(
    *,
    opening_balance: float = 0.0,
    invoices: Optional[Iterable[dict]] = None,
    bank_txs: Optional[Iterable[dict]] = None,
    partner_txs: Optional[Iterable[dict]] = None,
) -> float:
    total = _num(opening_balance)
    for inv in invoices or []:
        total += invoice_balance_delta(inv)
    for tx in bank_txs or []:
        total += bank_tx_balance_delta(tx)
    for tx in partner_txs or []:
        total += partner_tx_balance_delta(tx)
    return round(total, 2)


def infer_opening_balance(stored_balance: float, movement_balance: float) -> float:
    """Eski BizimHesap kayıtlarında opening_balance yoksa kayıttan çıkar."""
    return round(_num(stored_balance) - _num(movement_balance), 2)


async def sync_contact_balance(db, contact_id: str) -> Tuple[float, Dict[str, Any]]:
    """Hareketlerden bakiyeyi yeniden hesapla; kaymayı düzelt. (new_balance, meta) döner."""
    contact = await db.contacts.find_one({"_id": contact_id})
    if not contact:
        return 0.0, {"ok": False, "reason": "missing"}

    invoices = await db.invoices.find({"contact_id": contact_id}).to_list(5000)
    bank_txs = await db.bank_transactions.find({"contact_id": contact_id}).to_list(5000)
    partner_txs = await db.partner_transactions.find({"contact_id": contact_id}).to_list(2000)

    movement = compute_contact_balance(
        opening_balance=0.0,
        invoices=invoices,
        bank_txs=bank_txs,
        partner_txs=partner_txs,
    )
    stored = _num(contact.get("balance"))
    opening = contact.get("opening_balance")
    if opening is None and contact.get("opening_balance_source"):
        opening = infer_opening_balance(stored, movement)
        await db.contacts.update_one(
            {"_id": contact_id},
            {"$set": {"opening_balance": opening}},
        )
    opening = _num(opening)

    live = compute_contact_balance(
        opening_balance=opening,
        invoices=invoices,
        bank_txs=bank_txs,
        partner_txs=partner_txs,
    )
    meta = {
        "ok": True,
        "opening_balance": opening,
        "movement_balance": movement,
        "previous_balance": stored,
        "balance": live,
        "repaired": abs(live - stored) > 0.005,
    }
    if meta["repaired"]:
        await db.contacts.update_one(
            {"_id": contact_id},
            {"$set": {"balance": live, "balance_synced_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()}},
        )
    return live, meta
