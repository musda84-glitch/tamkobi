"""Pure helpers for credit-card metadata and statement-to-cari matching (no I/O)."""
import re
from typing import Any, Dict, List, Optional

_TR_FOLD = str.maketrans({
    "ı": "i", "İ": "i", "I": "i", "i": "i",
    "ğ": "g", "Ğ": "g", "ü": "u", "Ü": "u",
    "ş": "s", "Ş": "s", "ö": "o", "Ö": "o",
    "ç": "c", "Ç": "c",
})
_NAME_SKIP = {"as", "ltd", "sti", "san", "tic", "ve", "the", "co", "inc", "anonim", "sirketi", "limited"}


def sanitize_card_fields(doc: Dict[str, Any]) -> Dict[str, Any]:
    """Never persist full PAN / CVV — last 4 digits and MM/YY only."""
    for secret in ("cvv", "cvc", "card_number", "pan", "full_pan", "card_cvv"):
        doc.pop(secret, None)
    digits = re.sub(r"\D", "", str(doc.get("card_last4") or ""))
    if digits:
        doc["card_last4"] = digits[-4:]
    elif "card_last4" in doc:
        doc["card_last4"] = None
    expiry = doc.get("card_expiry")
    if expiry not in (None, ""):
        m = re.search(r"(\d{1,2})\s*[/\-.]\s*(\d{2,4})", str(expiry))
        digits = re.sub(r"\D", "", str(expiry))
        if m:
            mm = int(m.group(1))
            yy = m.group(2)[-2:]
            doc["card_expiry"] = f"{mm:02d}/{yy}" if 1 <= mm <= 12 else None
        elif len(digits) >= 4:
            mm = int(digits[:2])
            doc["card_expiry"] = f"{mm:02d}/{digits[2:4]}" if 1 <= mm <= 12 else None
        else:
            doc["card_expiry"] = None
    holder = doc.get("card_holder")
    if holder is not None:
        doc["card_holder"] = str(holder).strip()[:80] or None
    if doc.get("card_limit") not in (None, ""):
        try:
            doc["card_limit"] = float(doc["card_limit"])
        except (TypeError, ValueError):
            doc["card_limit"] = None
    return doc


def fold_text(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").translate(_TR_FOLD).lower()).strip()


def match_statement_contact(description: str, contacts: List[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    hay = fold_text(description)
    if len(hay) < 3 or not contacts:
        return None
    best, best_score = None, 0
    for c in contacts:
        name = (c.get("name") or c.get("company_title") or "").strip()
        folded = fold_text(name)
        tax = re.sub(r"\D", "", str(c.get("tax_number_or_id") or ""))
        score = 0
        if tax and len(tax) >= 10 and tax in re.sub(r"\D", "", description or ""):
            score = 1000 + len(tax)
        elif folded and len(folded) >= 4 and folded in hay:
            score = 100 + len(folded)
        else:
            tokens = [t for t in folded.split() if len(t) >= 4 and t not in _NAME_SKIP]
            if tokens and all(t in hay for t in tokens[:2]):
                score = 50 + sum(len(t) for t in tokens[:2])
        if score > best_score:
            best, best_score = c, score
    return best if best_score >= 50 else None
