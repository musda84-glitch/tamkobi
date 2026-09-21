"""Sipariş düzenleme kilidi: onay ve taslak fatura serbest, kesilmiş e-belge kilit."""
from __future__ import annotations

from typing import Any, Mapping, Optional

ORDER_STATUS_EDIT_LOCK = frozenset({"cancelled", "returned", "delivered", "completed"})
E_DOCUMENT_TYPES = frozenset({"e_invoice", "e_archive", "e_export", "e_dispatch"})


def _doc(value: Optional[Mapping[str, Any]]) -> Mapping[str, Any]:
    return value or {}


def _issued_edocument(doc: Optional[Mapping[str, Any]]) -> bool:
    """Taslak ve kağıt belge e-belge kesimi sayılmaz."""
    if not doc:
        return False
    if str(doc.get("status") or "") in ("draft", "cancelled"):
        return False
    if str(doc.get("e_type") or "") == "paper":
        return False
    return str(doc.get("e_type") or "") in E_DOCUMENT_TYPES


def order_edit_block_reason(
    order: Mapping[str, Any],
    invoice: Optional[Mapping[str, Any]] = None,
    dispatch: Optional[Mapping[str, Any]] = None,
) -> Optional[str]:
    """None ise sipariş düzenlenebilir.

    Onaylanmış sipariş ve ona bağlı taslak fatura (invoice_id dolu, is_invoiced
    false) düzenlemeyi engellemez. Kilit yalnızca kesilmiş e-belgededir.
    """
    status = str(order.get("order_status") or order.get("status") or "")
    if status in ORDER_STATUS_EDIT_LOCK:
        return "Bu sipariş düzenlenemez."
    inv = _doc(invoice)
    if order.get("is_invoiced"):
        if not invoice:
            return "E-belge kesilmiş sipariş düzenlenemez."
        if str(inv.get("e_type") or "") == "paper":
            return None
        if _issued_edocument(inv) or str(inv.get("e_type") or "") in E_DOCUMENT_TYPES:
            return "E-belge kesilmiş sipariş düzenlenemez."
        if str(inv.get("status") or "") not in ("draft", "cancelled", ""):
            return "E-belge kesilmiş sipariş düzenlenemez."
    elif _issued_edocument(inv):
        return "E-belge kesilmiş sipariş düzenlenemez."
    if _issued_edocument(dispatch):
        return "E-belge kesilmiş sipariş düzenlenemez."
    return None
