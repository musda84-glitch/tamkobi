"""Fatura alıcı VKN/TCKN: önce belgedeki contact_tax_id, yoksa cari kartı.

Modal ve issue_invoice aynı sırayı kullanır. Cari is_e_invoice_user karar vermez.
"""
from __future__ import annotations

import re
from typing import Any, Dict, Optional


def digits(value: Any) -> str:
    return re.sub(r"\D", "", str(value or ""))


def buyer_tax_choice(doc: Optional[dict], contact: Optional[dict] = None) -> Dict[str, Any]:
    """Sorgu VKN'si belgeden gelir; belge boşsa cariye düşülür.

    İkisi de dolu ve farklıysa mismatch=True. Karar yine belge VKN'si ile verilir.
    """
    src = doc or {}
    card = contact or {}
    doc_tax = digits(
        src.get("contact_tax_id")
        or src.get("buyer_tax_id")
        or src.get("customer_tax_id")
        or src.get("tax_number_or_id")
        or src.get("tax_id")
    )
    contact_tax = digits(card.get("tax_number_or_id") or card.get("tax_id"))
    return {
        "tax": doc_tax or contact_tax,
        "doc_tax": doc_tax,
        "contact_tax": contact_tax,
        "mismatch": bool(doc_tax and contact_tax and doc_tax != contact_tax),
    }
