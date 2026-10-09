"""Banka eşleşmesinde kasa/hesap veya Ortaklar Hesabı hedefi."""
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

import partner_pay


def parse_match_target(value: Optional[str]) -> Tuple[str, str]:
    raw = str(value or "").strip()
    if raw.startswith("partner:"):
        return "partner", raw[8:]
    return "account", raw


def stored_match_target(kind: str, eid: str) -> str:
    return f"partner:{eid}" if kind == "partner" else eid


def partner_tx_type_for_bank_match(is_inflow: bool) -> str:
    """Banka↔ortak karşı hareket (kasa virmanı gibi ters işaret):
    banka çıkışı → ortak cebine Giriş (capital_in);
    banka girişi → ortak cebinden Çıkış (withdrawal).
    """
    return "withdrawal" if is_inflow else "capital_in"


def _norm_bank_tx_type(raw: Any) -> str:
    t = str(raw or "").strip().lower()
    if t in ("outflow", "debit"):
        return "outflow"
    if t in ("inflow", "credit"):
        return "inflow"
    return ""


async def repair_legacy_bank_match_directions(db, partner_id: Optional[str] = None) -> int:
    """Eski banka eşleşmesi: banka çıkışı yanlışlıkla withdrawal yazılmışsa capital_in yap.

    Eski kural banka yönüyle aynı yazıyordu; doğrusu karşı hareket (Vadesiz çıkışı → ortak Giriş).
    """
    q: Dict[str, Any] = {
        "$or": [
            {"source": "bank_match"},
            {"related_bank_tx_id": {"$exists": True, "$nin": [None, ""]}},
        ]
    }
    if partner_id:
        q = {"$and": [q, {"partner_id": partner_id}]}
    txs = await db.partner_transactions.find(q).to_list(20000)
    fixed = 0
    now = datetime.now(timezone.utc).isoformat()
    for tx in txs:
        if tx.get("type") not in ("withdrawal", "capital_in"):
            continue
        bank_type = _norm_bank_tx_type(tx.get("bank_tx_type"))
        if not bank_type and tx.get("related_bank_tx_id"):
            btx = await db.bank_transactions.find_one({"_id": tx["related_bank_tx_id"]})
            bank_type = _norm_bank_tx_type((btx or {}).get("type"))
        if not bank_type:
            continue
        want = partner_tx_type_for_bank_match(bank_type == "inflow")
        patch: Dict[str, Any] = {}
        if tx.get("bank_tx_type") != bank_type:
            patch["bank_tx_type"] = bank_type
        if tx.get("source") != "bank_match":
            patch["source"] = "bank_match"
        if tx.get("type") != want:
            patch["type"] = want
            patch["legacy_bank_match_repaired_at"] = now
        if not patch:
            continue
        await db.partner_transactions.update_one({"_id": tx["_id"]}, {"$set": patch})
        if "type" in patch:
            fixed += 1
    return fixed


async def apply_partner_match(db, tx: dict, partner_id: str, amount, is_inflow: bool) -> str:
    """Banka hareketi bakiyede; ortak cebi karşı giriş/çıkış ile güncelle (işaret ters)."""
    desc = f"{tx.get('account_name') or 'Hesap'}: {tx.get('description') or 'Banka eşleşmesi'}"
    bank_tx_type = "inflow" if is_inflow else "outflow"
    return await partner_pay.move(
        db,
        tx["company_id"],
        partner_id,
        float(amount or 0),
        partner_tx_type_for_bank_match(is_inflow),
        desc,
        date=tx.get("date"),
        extra={
            "related_bank_tx_id": tx.get("_id"),
            "source": "bank_match",
            "bank_tx_type": bank_tx_type,
        },
    )


async def reverse_partner_match(db, tx: dict) -> bool:
    ok = await partner_pay.reverse_one(db, {"related_bank_tx_id": tx["_id"], "source": "bank_match"})
    if ok:
        return True
    return await partner_pay.reverse_one(db, {"related_bank_tx_id": tx["_id"]})
