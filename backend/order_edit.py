"""Sipariş düzenleme kilidi: onay ve taslak fatura serbest; GİB'e kesilmiş e-belge kilit."""
from __future__ import annotations

import re
from typing import Any, Mapping, Optional

ORDER_STATUS_EDIT_LOCK = frozenset({"cancelled", "returned", "delivered", "completed"})
E_DOCUMENT_TYPES = frozenset({"e_invoice", "e_archive", "e_export", "e_dispatch"})
E_ISSUED_STATES = frozenset({"sent", "queued", "accepted"})
GIB_ISSUED_STATUSES = frozenset({
    "Başarıyla İletildi (GİB Onaylı)",
    "Kağıt Fatura (Matbu)",
    "n11 Faturam ile GİB'e iletildi",
    "İşNet SOAP API ile GİB'e iletildi",
    "İşNet Web Portal ile GİB'e iletildi",
    "e-İhracat GİB'e iletildi",
    "GİB'e Gönderildi",
    "Kuyrukta",
})


def _doc(value: Optional[Mapping[str, Any]]) -> Mapping[str, Any]:
    return value or {}


def _issued_edocument(doc: Optional[Mapping[str, Any]]) -> bool:
    """Yalnızca GİB'e iletilmiş / kuyruğa alınmış e-belge kilitler.

    Panelde onaylanmış ama henüz GİB'e gönderilmemiş e-fatura/e-arşiv
    (einvoice_state=draft, gib_status=Onaylandı) düzenlemeyi engellemez.
    """
    if not doc:
        return False
    if str(doc.get("status") or "") in ("draft", "cancelled"):
        return False
    e_type = str(doc.get("e_type") or "")
    if e_type == "paper" or e_type not in E_DOCUMENT_TYPES:
        return False
    state = str(doc.get("einvoice_state") or "").lower()
    if state == "error":
        return False
    if state in E_ISSUED_STATES:
        return True
    if doc.get("gib_tracking_id"):
        return True
    gs = str(doc.get("gib_status") or "")
    if re.match(r"^\s*hata\s*:", gs, re.I):
        return False
    if gs in GIB_ISSUED_STATUSES:
        return True
    # "Onaylandı" panel onayıdır; GİB iletimi değildir.
    if re.search(r"onaylandı\s*$", gs, re.I):
        return False
    if re.search(r"ileti|gönderildi|kuyrukta|n11 faturam|e-ihracat", gs, re.I):
        return True
    return False


def order_edit_block_reason(
    order: Mapping[str, Any],
    invoice: Optional[Mapping[str, Any]] = None,
    dispatch: Optional[Mapping[str, Any]] = None,
) -> Optional[str]:
    """None ise sipariş düzenlenebilir.

    Onaylanmış sipariş, taslak fatura ve panelde onaylı ama GİB'e
    gitmemiş e-belge düzenlemeyi engellemez.
    """
    status = str(order.get("order_status") or order.get("status") or "")
    if status in ORDER_STATUS_EDIT_LOCK:
        return "Bu sipariş düzenlenemez."
    inv = _doc(invoice)
    if _issued_edocument(inv):
        return "E-belge kesilmiş sipariş düzenlenemez."
    if _issued_edocument(dispatch):
        return "E-belge kesilmiş sipariş düzenlenemez."
    # Fatura satırı yoksa sipariş üzerindeki einvoice_state'e bak
    if not invoice and order.get("is_invoiced"):
        state = str(order.get("einvoice_state") or "").lower()
        if state in E_ISSUED_STATES:
            return "E-belge kesilmiş sipariş düzenlenemez."
    return None
