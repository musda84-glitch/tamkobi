"""Cari arama: Türkçe karakter duyarsız, kelimenin herhangi bir yerinde.

Tip filtresi yok — müşteri, tedarikçi ve ikisi birden döner. Pasif cariler gizlenir.
"""
from __future__ import annotations

import asyncio
import re
from typing import Any, Dict, Iterable, List, Optional, Sequence

PAGE_SIZE = 20

# ş=s, ı=i, ğ=g, ü=u, ö=o, ç=c (büyükleri de). İ/I ayrıca fold_tr içinde i olur.
_TR_FOLD = str.maketrans({
    "ş": "s",
    "Ş": "s",
    "ı": "i",
    "İ": "i",
    "ğ": "g",
    "Ğ": "g",
    "ü": "u",
    "Ü": "u",
    "ö": "o",
    "Ö": "o",
    "ç": "c",
    "Ç": "c",
    "â": "a",
    "Â": "a",
    "î": "i",
    "Î": "i",
    "û": "u",
    "Û": "u",
})

# Ünvan (cari adı + ticari ünvan), kısa ad (içe aktarımda company_title),
# cari kodu (category / code / erp_code), VKN/TCKN, telefon, e-posta.
_TEXT_FIELDS = (
    "name",
    "company_title",
    "category",
    "code",
    "erp_code",
    "contact_code",
    "email",
    "phone",
    "tax_number_or_id",
)


def fold_tr(value: Any) -> str:
    """Büyük/küçük harf ve Türkçe karakter duyarsız karşılaştırma anahtarı."""
    s = str(value or "")
    s = s.replace("İ", "i").replace("I", "i")
    s = s.casefold()
    s = s.replace("\u0307", "")
    return s.translate(_TR_FOLD)


def contact_is_active(contact: Optional[dict]) -> bool:
    if not contact:
        return False
    v = contact.get("is_active", True)
    if v is None:
        return True
    if isinstance(v, str):
        return v.strip().lower() not in ("false", "0", "no", "pasif", "hayir", "hayır")
    return bool(v)


def contact_search_blob(contact: dict) -> str:
    parts: List[str] = []
    for key in _TEXT_FIELDS:
        raw = contact.get(key)
        if raw is None or raw == "":
            continue
        parts.append(fold_tr(raw))
    tax_digits = re.sub(r"\D", "", str(contact.get("tax_number_or_id") or ""))
    if tax_digits:
        parts.append(tax_digits)
    phone_digits = re.sub(r"\D", "", str(contact.get("phone") or ""))
    if phone_digits:
        parts.append(phone_digits)
    return " ".join(parts)


def contact_id(contact: dict) -> str:
    return str(contact.get("id") or contact.get("_id") or "")


_SUGGEST_STOP = {
    "ltd", "sti", "as", "san", "tic", "ve", "co", "inc", "limited",
    "anonim", "sirketi", "ticaret", "sanayi", "dis", "ic",
}

_WEAK_PARTY = {
    "gelen", "giden", "eft", "havale", "fast", "odeme", "banka", "hareketi",
    "ref", "havaleeft", "islem", "islemi",
}

_FIRMA_LABELS = ("firma adi", "firma unvani")

_FIRMA_CUT = re.compile(
    r"(?:\s*[·|•]\s*|\n|\s+-\s+|\s+(?:açıklama|aciklama)\s*[:\-])",
    re.IGNORECASE,
)


def _sig_tokens(text: str) -> List[str]:
    out: List[str] = []
    for raw in fold_tr(text).split():
        tok = raw.strip(".,;:()[]")
        if len(tok) < 3 or tok in _SUGGEST_STOP or tok.isdigit():
            continue
        out.append(tok)
    return out


def extract_firma_adi(text: str) -> str:
    """Açıklamadaki 'Firma Adı: MOR PLASTIK ISTANBUL' değerini çıkar.

    Etiket Türkçe büyük/küçük harf ve İ/ı duyarsızdır. Değer bir sonraki
    alan ayracı veya Açıklama etiketinde biter.
    """
    raw = str(text or "").replace("\u0307", "")
    if not raw.strip():
        return ""
    folded = fold_tr(raw)
    # fold_tr Türkçe harflerde uzunluğu korur; saparsa katlanmış metinden kesilir.
    source = raw if len(folded) == len(raw) else folded
    for label in _FIRMA_LABELS:
        idx = folded.find(label)
        if idx < 0:
            continue
        rest = source[idx + len(label):].lstrip(" \t:.-–—=/")
        cut = _FIRMA_CUT.split(rest, maxsplit=1)[0]
        name = " ".join(cut.split()).strip(" \t:.-–—")
        if name:
            return name[:120]
    return ""


def _party_name(text: str) -> str:
    """Karşı taraf alanındaki zayıf banka kelimelerini ayıkla."""
    raw = " ".join(str(text or "").replace("·", " ").replace("|", " ").replace("•", " ").split())
    if not raw or len(raw) > 80:
        return ""
    kept = []
    for word in raw.split():
        folded = fold_tr(word).strip(".,;:()[]")
        if not folded or folded in _WEAK_PARTY or folded.isdigit() or len(folded) < 2:
            continue
        kept.append(word.strip(".,;:"))
    if not kept or len(kept) > 6:
        return ""
    return " ".join(kept)[:120]


def resolve_suggest_name(suggest: str = "", counterparty: str = "") -> str:
    """Öneri sorgusu: önce açıklamadaki Firma Adı, yoksa karşı taraf adı."""
    extracted = extract_firma_adi(suggest) or extract_firma_adi(counterparty)
    if extracted:
        return extracted
    return _party_name(counterparty)


def suggestion_score(contact: dict, firma: str) -> int:
    """Firma adına yakınlık. Tek şehir/kelime eşleşmesi (yalnızca İstanbul) yetmez."""
    needle = fold_tr(firma).strip()
    if len(needle) < 3:
        return 0
    blobs = [fold_tr(contact.get(key) or "") for key in ("name", "company_title")]
    blobs = [b for b in blobs if b]
    if not blobs:
        return 0
    if any(b == needle for b in blobs):
        return 1000
    if any(needle in b for b in blobs):
        return 900
    if any(len(b) >= 4 and b in needle for b in blobs):
        return 860
    ntoks = _sig_tokens(needle)
    if not ntoks:
        return 0
    btoks = set()
    for blob in blobs:
        btoks.update(_sig_tokens(blob))
    hits = [tok for tok in ntoks if tok in btoks]
    if len(ntoks) >= 2 and len(hits) < 2:
        return 0
    if not hits:
        return 0
    return 200 + sum(len(tok) for tok in hits) * 10 + len(hits) * 40


def rank_contact_suggestions(contacts: Sequence[dict], firma: str, limit: int = 5) -> List[dict]:
    scored: List[tuple] = []
    for contact in contacts:
        score = suggestion_score(contact, firma)
        if score <= 0:
            continue
        scored.append((score, fold_tr(contact.get("name") or ""), contact_id(contact), contact))
    scored.sort(key=lambda row: (-row[0], row[1], row[2]))
    return [row[3] for row in scored[: max(1, int(limit or 5))]]


def recent_ids_from_scored(scored: Iterable[tuple], limit: int = 80) -> List[str]:
    """(timestamp, contact_id) çiftlerini yeniden eskiye, tekrarsız sırala."""
    rows = [(str(ts or ""), str(cid or "").strip()) for ts, cid in scored]
    rows.sort(key=lambda r: r[0], reverse=True)
    out: List[str] = []
    seen = set()
    for _ts, cid in rows:
        if not cid or cid in seen:
            continue
        seen.add(cid)
        out.append(cid)
        if len(out) >= limit:
            break
    return out


def search_contacts(
    contacts: Sequence[dict],
    q: str = "",
    *,
    page: int = 1,
    limit: int = PAGE_SIZE,
    recent_ids: Optional[Sequence[str]] = None,
    suggest: str = "",
    counterparty: str = "",
    exclude_types: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    """Aktif carilerde sayfalı arama. Boş sorguda son kullanılanlar.

    Eşleşme veri kümesi kırpılmadan yapılır; sayfa yalnızca sonuçlara uygulanır.
    Böylece 1000+ kayıtta sondaki cari de bulunur.

    suggest açıklamasındaki Firma Adı (yoksa counterparty) en yakın carileri
    `suggestions` olarak döner; sayfa listesinden ayrıdır.
    """
    active = [c for c in contacts if contact_is_active(c)]
    if exclude_types:
        banned = {str(t).strip().lower() for t in exclude_types if str(t).strip()}
        if banned:
            active = [c for c in active if str(c.get("type") or "").strip().lower() not in banned]
    firma = resolve_suggest_name(suggest, counterparty)
    suggestions = rank_contact_suggestions(active, firma) if firma else []
    folded = fold_tr(q).strip()
    if folded:
        matched = [c for c in active if folded in contact_search_blob(c)]
        matched.sort(key=lambda c: (fold_tr(c.get("name") or ""), contact_id(c)))
        ordered = matched
    else:
        by_id = {contact_id(c): c for c in active if contact_id(c)}
        ordered = []
        seen = set()
        for cid in recent_ids or []:
            key = str(cid)
            row = by_id.get(key)
            if not row or key in seen:
                continue
            ordered.append(row)
            seen.add(key)
        if not ordered:
            ordered = sorted(
                active,
                key=lambda c: str(c.get("updated_at") or c.get("created_at") or ""),
                reverse=True,
            )
    page_n = max(1, int(page or 1))
    size = int(limit or PAGE_SIZE)
    if size < 1:
        size = PAGE_SIZE
    if size > 50:
        size = 50
    start = (page_n - 1) * size
    items = ordered[start:start + size]
    total = len(ordered)
    return {
        "items": items,
        "suggestions": suggestions,
        "suggest_query": firma,
        "total": total,
        "page": page_n,
        "limit": size,
        "has_more": start + len(items) < total,
    }


async def search_contacts_off_loop(*args, **kwargs) -> Dict[str, Any]:
    """fold_tr taraması event loop'u 200–570 ms kilitliyordu. Eşleşme aynıdır."""
    return await asyncio.to_thread(search_contacts, *args, **kwargs)
