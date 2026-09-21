"""Banka eşleşmesinde kasa/hesap veya Ortaklar Hesabı hedefi."""
from typing import Optional, Tuple

import partner_pay


def parse_match_target(value: Optional[str]) -> Tuple[str, str]:
    raw = str(value or "").strip()
    if raw.startswith("partner:"):
        return "partner", raw[8:]
    return "account", raw


def stored_match_target(kind: str, eid: str) -> str:
    return f"partner:{eid}" if kind == "partner" else eid


def partner_tx_type_for_bank_match(is_inflow: bool) -> str:
    return "capital_in" if is_inflow else "withdrawal"


async def apply_partner_match(db, tx: dict, partner_id: str, amount, is_inflow: bool) -> str:
    """Banka hareketi bakiyede; ortak hesabı nakit-siz sermaye / çekiş ile güncelle."""
    desc = f"{tx.get('account_name') or 'Hesap'}: {tx.get('description') or 'Banka eşleşmesi'}"
    return await partner_pay.move(
        db,
        tx["company_id"],
        partner_id,
        float(amount or 0),
        partner_tx_type_for_bank_match(is_inflow),
        desc,
        date=tx.get("date"),
        extra={"related_bank_tx_id": tx.get("_id"), "source": "bank_match"},
    )


async def reverse_partner_match(db, tx: dict) -> bool:
    ok = await partner_pay.reverse_one(db, {"related_bank_tx_id": tx["_id"], "source": "bank_match"})
    if ok:
        return True
    return await partner_pay.reverse_one(db, {"related_bank_tx_id": tx["_id"]})
