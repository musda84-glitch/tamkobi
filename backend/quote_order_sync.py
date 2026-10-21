"""Teklif ↔ sipariş ↔ fatura senkronunda döngü kilidi ve teklif atlama.

Dönüşüm bağları kodda şöyle yazılıyor:
- POST /quotes/{id}/convert-to-invoice: invoice.quote_id, quote.invoice_id, quote.invoice_number
- Sipariş taslağı / onay: invoice.order_id, invoice.source_order_id, order.invoice_id
- order.quote_id ve quote.order_id doluysa aynı company_id içinde okunur

Senkron kaynak belgeyi tekrar yazmaz. Kapsam bir istekte açılır, istek bitince kapanır.
"""
from __future__ import annotations

import contextvars
from typing import Any, Mapping, Optional

CLOSED_QUOTE_STATUSES = frozenset({
    "rejected",
    "cancelled",
    "canceled",
    "refused",
    "reddedildi",
    "reddedilmiş",
    "iptal",
    "iptal edildi",
})

_SEEN: contextvars.ContextVar[Optional[set]] = contextvars.ContextVar(
    "invoice_order_quote_sync_seen",
    default=None,
)


def sync_scope_enter():
    """Dış çağrı kapsam açar. İç içe çağrı None döner ve aynı kümeyi kullanır."""
    if _SEEN.get() is not None:
        return None
    return _SEEN.set(set())


def sync_scope_leave(token) -> None:
    if token is not None:
        _SEEN.reset(token)


def sync_claim(kind: str, doc_id: Any) -> bool:
    """False: bu turda belge zaten kaynak veya yazıldı; tekrar yazma."""
    if not doc_id:
        return False
    seen = _SEEN.get()
    if seen is None:
        return True
    key = (str(kind), str(doc_id))
    if key in seen:
        return False
    seen.add(key)
    return True


def quote_sync_skip_reason(quote: Optional[Mapping[str, Any]], company_id: Any) -> Optional[str]:
    """None ise teklif kalemleri güncellenebilir."""
    if not quote:
        return "missing"
    qc = str(quote.get("company_id") or "")
    cc = str(company_id or "")
    if not qc or not cc or qc != cc:
        return "company"
    status = str(quote.get("status") or "").strip().lower()
    if status in CLOSED_QUOTE_STATUSES:
        return "closed"
    return None


def same_company(doc: Optional[Mapping[str, Any]], company_id: Any) -> bool:
    if not doc or not company_id:
        return False
    return str(doc.get("company_id") or "") == str(company_id)
