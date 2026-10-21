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


def contact_matches_text(
    contact_name: str,
    counterparty: str = "",
    description: str = "",
    contact_title: str = "",
) -> bool:
    """Cari adı veya ticari ünvan banka metninde geçiyorsa eşleşir.

    İmza geriye uyumlu. Türkçe katlama ve Ltd/Şti/A.Ş. stop listesi
    contact_search üzerinden uygulanır; yalnız stop-word eşleşmez.
    """
    from contact_match import contact_texts_match

    return contact_texts_match(contact_name, contact_title, counterparty, description)


def contact_matches_text_any(names, counterparty: str = "", description: str = "") -> bool:
    """Birden fazla aday metin (ad, ünvan); herhangi biri tutarsa eşleşir."""
    for raw in names or []:
        if contact_matches_text(str(raw or ""), counterparty, description):
            return True
    return False


def match_actor_fields(user: Optional[Dict[str, Any]] = None) -> Dict[str, Optional[str]]:
    """Eşleştirmeyi yapan kullanıcı (yoksa Sistem). Marka/platform e-posta kullanılmaz."""
    if user is None:
        return {"matched_by_id": None, "matched_by_name": "Sistem"}
    import bank_tx
    name = bank_tx.display_actor_name(user)
    if not name:
        # Platform personeli / yasaklı etiket → şirket hareketine kimlik yazma
        return {"matched_by_id": None, "matched_by_name": "Sistem"}
    uid = user.get("id") or user.get("_id")
    return {"matched_by_id": str(uid) if uid else None, "matched_by_name": name}


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
