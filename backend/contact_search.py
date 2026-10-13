"""Cari arama: Türkçe karakter duyarsız, kelimenin herhangi bir yerinde.

Tip filtresi yok — müşteri, tedarikçi ve ikisi birden döner. Pasif cariler gizlenir.
"""
from __future__ import annotations

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
) -> Dict[str, Any]:
    """Aktif carilerde sayfalı arama. Boş sorguda son kullanılanlar.

    Eşleşme veri kümesi kırpılmadan yapılır; sayfa yalnızca sonuçlara uygulanır.
    Böylece 1000+ kayıtta sondaki cari de bulunur.
    """
    active = [c for c in contacts if contact_is_active(c)]
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
        "total": total,
        "page": page_n,
        "limit": size,
        "has_more": start + len(items) < total,
    }
