"""Cari silme koruması: işlem varsa kart çöpe gidemez (pasife alınır)."""
from __future__ import annotations

from typing import Any, Dict, List, Tuple

# (koleksiyon, alan, etiket)
ACTIVITY_SOURCES: Tuple[Tuple[str, str, str], ...] = (
    ("invoices", "contact_id", "fatura"),
    ("orders", "contact_id", "sipariş"),
    ("quotes", "contact_id", "teklif"),
    ("surveys", "contact_id", "keşif"),
    ("projects", "contact_id", "proje"),
    ("bank_transactions", "contact_id", "kasa/banka hareketi"),
    ("partner_transactions", "contact_id", "ortak hareketi"),
    ("cheques", "contact_id", "çek/senet"),
    ("expenses", "contact_id", "masraf"),
    ("installments", "contact_id", "taksit"),
)

LABELS = {coll: label for coll, _field, label in ACTIVITY_SOURCES}


def activity_parts(counts: Dict[str, int]) -> List[str]:
    parts: List[str] = []
    for coll, _field, label in ACTIVITY_SOURCES:
        n = int(counts.get(coll) or 0)
        if n:
            parts.append(f"{n} {label}")
    return parts


def activity_block_message(counts: Dict[str, int], *, balance: float = 0.0) -> str:
    parts = activity_parts(counts)
    try:
        bal = abs(float(balance or 0))
    except (TypeError, ValueError):
        bal = 0.0
    if bal > 0.01:
        parts.append("açık bakiye")
    if not parts:
        return ""
    return "Bu caride işlem var, silinemez. Pasife alın. (" + ", ".join(parts) + ")"


def contact_is_active(contact: Dict[str, Any] | None) -> bool:
    if not contact:
        return True
    return contact.get("is_active") is not False


async def contact_activity_counts(db, contact_id: str) -> Dict[str, int]:
    out: Dict[str, int] = {}
    for coll, field, _label in ACTIVITY_SOURCES:
        try:
            n = await db[coll].count_documents({field: contact_id})
        except Exception:
            n = 0
        if n:
            out[coll] = int(n)
    return out
