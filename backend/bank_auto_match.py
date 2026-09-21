"""Banka hareketi otomatik eşleşme: kural, geçmiş işlem, cari adı."""
from __future__ import annotations

import re
from typing import Any, Dict, Optional, Tuple

_STOP = {
    "eft", "havale", "ödeme", "odeme", "fatura", "tahsilat", "gelen", "giden",
    "ltd", "şti", "sti", "a.ş", "tl", "try", "the", "and",
}

_WORD = re.compile(r"[^a-z0-9ğüşöçı]+")


def match_pattern(text: str) -> str:
    t = re.sub(r"[\d\.,:/\-]+", " ", (text or "").lower())
    tokens = [w for w in t.split() if len(w) > 2 and w not in _STOP]
    return " ".join(tokens[:4])


def name_tokens(name: str) -> list[str]:
    return [t for t in _WORD.sub(" ", (name or "").lower()).split() if len(t) > 2 and t not in _STOP]


def contact_matches_text(contact_name: str, counterparty: str = "", description: str = "") -> bool:
    """Cari adı banka açıklamasında / karşı tarafta geçiyorsa eşleşir."""
    hay = f"{counterparty} {description}".lower()
    name = (contact_name or "").strip()
    if not name or not hay.strip():
        return False
    compact = re.sub(r"\s+", " ", name.lower())
    if len(compact) >= 5 and compact in hay:
        return True
    tokens = name_tokens(name)
    if tokens and all(t in hay for t in tokens[:2]):
        return True
    if len(tokens) == 1 and len(tokens[0]) >= 4 and tokens[0] in hay:
        return True
    return False


def pick_auto_match_source(
    rule: Optional[Dict[str, Any]],
    prior: Optional[Dict[str, Any]],
    suggestion: Optional[Dict[str, Any]],
) -> Tuple[Optional[str], Optional[Dict[str, Any]]]:
    """Önce öğrenilen kural, sonra daha önce işlenen hareket, sonra cari adı."""
    if rule:
        return "rule", rule
    if prior:
        return "history", prior
    if suggestion:
        return "cari", suggestion
    return None, None
