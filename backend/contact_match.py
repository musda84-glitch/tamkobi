"""Cari adı ve ticari ünvan için ortak eşleşme.

Yeni normalizer yok: contact_search.fold_tr, _sig_tokens, _SUGGEST_STOP
ve suggestion_score yeniden kullanılır. Yasal ekler (Ltd, Şti, A.Ş., San, Tic)
mevcut stop listesine düşsün diye yalnız nokta boşluğa çevrilir.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple

from contact_search import _SUGGEST_STOP, _WEAK_PARTY, _sig_tokens, fold_tr, suggestion_score

_SCAN_PROJ = {"name": 1, "company_title": 1, "tax_number_or_id": 1}
_SAFE_SCORE = 900


def party_sig(text: str) -> List[str]:
    """Anlamlı tokenlar. Noktalı ekler (A.Ş., Ltd.) stop listesine düşer."""
    cleaned = re.sub(r"\.", " ", str(text or ""))
    return [tok for tok in _sig_tokens(cleaned) if tok not in _WEAK_PARTY and tok not in _SUGGEST_STOP]


def _texts(contact: dict) -> List[Tuple[str, str]]:
    out: List[Tuple[str, str]] = []
    name = str(contact.get("name") or "").strip()
    title = str(contact.get("company_title") or "").strip()
    if name:
        out.append(("name", name))
    if title:
        out.append(("company_title", title))
    return out


def field_score(field: str, hay: str) -> int:
    """Tek alan banka/ekstre skoru. Stop-word'den ibaret taraf 0."""
    if not party_sig(field) or not party_sig(hay):
        return 0
    score = suggestion_score({"name": field}, hay)
    if score:
        return score
    ft = party_sig(field)
    ht = set(party_sig(hay))
    if len(ft) >= 2 and all(tok in ht for tok in ft):
        return 200 + sum(len(tok) for tok in ft) * 10 + len(ft) * 40
    if len(ft) == 1 and len(ft[0]) >= 4 and ft[0] in ht:
        return 200 + len(ft[0]) * 10
    folded = " ".join(fold_tr(field).split())
    hay_folded = " ".join(fold_tr(hay).split())
    if len(folded) >= 5 and folded in hay_folded:
        return 860
    return 0


def party_score(field: str, needle: str) -> int:
    """E-belge skoru. Ek farkı (San. / Sanayi, Ltd. Şti.) 900'e yükselir."""
    score = field_score(field, needle)
    ntoks = party_sig(needle)
    ftoks = party_sig(field)
    if len(ntoks) >= 2 and len(ftoks) >= 2 and (
        ftoks[: len(ntoks)] == ntoks or ntoks[: len(ftoks)] == ftoks
    ):
        score = max(score, _SAFE_SCORE)
    return score


def normalized_exact(hay: str, field: str) -> bool:
    ft = party_sig(field)
    ht = party_sig(hay)
    if not ft or not ht:
        return False
    if ht == ft:
        return True
    return fold_tr(hay).strip() == fold_tr(field).strip()


def bank_match_rank(contact: dict, counterparty: str = "", description: str = "") -> Tuple[int, str]:
    """VKN tam > ticari ünvan tam/normalize > cari adı tam > kısmi ünvan > kısmi ad."""
    hay = " ".join(part for part in (counterparty or "", description or "") if str(part).strip()).strip()
    if not hay:
        return 0, ""
    digits = re.sub(r"\D", "", hay)
    tax = re.sub(r"\D", "", str(contact.get("tax_number_or_id") or ""))
    if len(tax) >= 10 and tax in digits:
        return 3000 + len(tax), "tax_number_or_id"
    title = str(contact.get("company_title") or "").strip()
    name = str(contact.get("name") or "").strip()
    title_score = field_score(title, hay) if title else 0
    name_score = field_score(name, hay) if name else 0
    if title_score and normalized_exact(hay, title):
        return 2000 + min(title_score, 900), "company_title"
    if name_score and normalized_exact(hay, name):
        return 1000 + min(name_score, 900), "name"
    if title_score >= name_score and title_score:
        return 700 + min(title_score, 200), "company_title"
    if name_score:
        return 400 + min(name_score, 200), "name"
    return 0, ""


def contact_texts_match(name: str, title: str, counterparty: str = "", description: str = "") -> bool:
    rank, _field = bank_match_rank(
        {"name": name or "", "company_title": title or ""},
        counterparty,
        description,
    )
    return rank > 0


def pick_bank_contact(contacts: Sequence[dict], counterparty: str = "", description: str = "") -> Optional[dict]:
    best: Optional[dict] = None
    best_rank = 0
    best_field = ""
    for contact in contacts:
        rank, field = bank_match_rank(contact, counterparty, description)
        if rank > best_rank:
            best, best_rank, best_field = contact, rank, field
    if not best:
        return None
    chosen = dict(best)
    if best_field:
        chosen["matched_on"] = best_field
    return chosen


def best_party_score(contact: dict, needle: str) -> Tuple[int, str]:
    best_score = 0
    best_field = ""
    for key, text in _texts(contact):
        score = party_score(text, needle)
        if score > best_score or (score == best_score and score and key == "company_title" and best_field != "company_title"):
            best_score, best_field = score, key
    return best_score, best_field


def order_identity_ors(name: str, customer_company: Optional[str] = None) -> List[Dict[str, Any]]:
    """Sipariş müşterisi: ad ve ticari ünvan ayrı ayrı, name ve company_title üzerinde."""
    ors: List[Dict[str, Any]] = []
    seen = set()
    for raw in (name, customer_company):
        text = str(raw or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        ors.append({"name": text})
        ors.append({"company_title": text})
    return ors


async def find_contact_by_party_name(db: Any, company_id: str, name: str) -> Optional[dict]:
    """Önce prefix regex (name veya company_title), yoksa fold edilmiş güvenli eşik."""
    raw = str(name or "").strip()
    cid = str(company_id or "").strip()
    if not raw or not cid:
        return None
    rx = {"$regex": f"^{re.escape(raw[:60])}", "$options": "i"}
    found = await db.contacts.find_one(
        {"company_id": cid, "$or": [{"name": rx}, {"company_title": rx}]},
    )
    if found:
        return found
    if not party_sig(raw):
        return None
    rows = await db.contacts.find({"company_id": cid}, _SCAN_PROJ).to_list(10000)
    best = None
    best_key = (-1, 0)
    for row in rows:
        score, field = best_party_score(row, raw)
        if score < _SAFE_SCORE:
            continue
        key = (score, 1 if field == "company_title" else 0)
        if key > best_key:
            best, best_key = row, key
    return best
