"""Fatura alıcı VKN/TCKN: belgede gerçek kimlik varsa o, yoksa cari kartı.

Yer tutucu (11111111111 vb.) belge VKN'si cariyi ezmez. Cari is_e_invoice_user
karar vermez. Modal ve issue_invoice aynı sırayı kullanır.
"""
from __future__ import annotations

import re
from typing import Any, Dict, Optional

from contact_tax import is_placeholder_tax_id

DOC_TAX_FIELDS = (
    "contact_tax_id",
    "buyer_tax_id",
    "customer_tax_id",
    "tax_number_or_id",
    "tax_id",
)
CONTACT_TAX_FIELDS = (
    "tax_number_or_id",
    "tax_id",
    "tax_number",
    "vkn",
    "tckn",
)


def digits(value: Any) -> str:
    return re.sub(r"\D", "", str(value or ""))


def first_tax_digits(src: Optional[dict], fields: tuple) -> str:
    card = src or {}
    for key in fields:
        d = digits(card.get(key))
        if d:
            return d
    return ""


def usable_tax(raw: Any) -> str:
    """Boş veya yer tutucu değilse rakamlar; aksi halde boş."""
    d = digits(raw)
    if not d or is_placeholder_tax_id(d):
        return ""
    return d


def contact_card_tax_id(contact: Optional[dict] = None) -> str:
    """Cari kartında ilk dolu VKN/TCKN (yalnız rakam)."""
    return first_tax_digits(contact, CONTACT_TAX_FIELDS)


def invoice_contact_tax_id(contact: Optional[dict] = None) -> str:
    """Sipariş→fatura: cari VKN'si, yoksa perakende yer tutucu."""
    return contact_card_tax_id(contact) or "11111111111"


def buyer_tax_choice(doc: Optional[dict], contact: Optional[dict] = None) -> Dict[str, Any]:
    """Sorgu VKN'si: belgede gerçek kimlik varsa o, değilse cari.

    Belge VKN'si boş veya yer tutucu ise cariye düşülür. Yer tutucu yalnız
    ikisi de boş/yer tutucu ise. mismatch yalnız ikisi de gerçek ve farklıysa.
    """
    src = doc or {}
    card = contact or {}
    doc_raw = first_tax_digits(src, DOC_TAX_FIELDS)
    contact_raw = contact_card_tax_id(card)
    doc_real = usable_tax(doc_raw)
    contact_real = usable_tax(contact_raw)
    if doc_real:
        tax, source = doc_real, "Belge"
    elif contact_real:
        tax, source = contact_real, "Cari"
    else:
        tax, source = "", ""
    return {
        "tax": tax,
        "doc_tax": doc_raw,
        "contact_tax": contact_raw,
        "mismatch": bool(doc_real and contact_real and doc_real != contact_real),
        "source": source,
        "placeholder": not doc_real and not contact_real,
    }
